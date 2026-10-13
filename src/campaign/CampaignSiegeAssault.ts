import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { BreachEntrance } from '../navigation/AvailableBreachEntrances'
import { AIType, type NPC } from '../world/NPC'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../world/Terrain'
import type { OutpostWalkways } from './CampaignOutpostWalkways'
import type { CampaignGateController, CampaignBreachController } from './CampaignGate'
import { reconcileCampaignGateSiege } from './CampaignGate'
import { allocateSiegeRampCrews, getSiegeRampPlacement, placeSiegeRampCrew } from './MobileSiegeRampPolicy'
import { MobileSiegeRamp } from './MobileSiegeRamp'
import type { MobileSiegeRampState } from './MobileSiegeRampController'

/** Standard Campaign scene owner: physical entrances, convoy ownership and event-driven reassignment. */
export class CampaignSiegeAssault {
  readonly ramps: MobileSiegeRamp[] = []
  readonly entrances
  private readonly unsubscribers: (() => void)[] = []
  private readonly perimeter: { obstacle: ObstacleData; entrance: BreachEntrance }[] = []
  private disposed = false
  private observedRevision = -1
  private readonly gateEntrance: BreachEntrance

  constructor(private readonly scene: THREE.Scene, private readonly obstacles: ObstacleData[],
    readonly walkways: OutpostWalkways, private readonly navigation: NavigationWorld,
    private readonly gate: CampaignGateController, private readonly breach: CampaignBreachController,
    private readonly actors: () => readonly NPC[],
    private readonly registerHit: (ramp: MobileSiegeRamp) => void,
    private readonly unregisterHit: (ramp: MobileSiegeRamp) => void,
    private readonly blockers: () => readonly THREE.Vector3[] = () => []) {
    if (!navigation.outpostNav) throw new Error('Siege assault requires outpost navigation')
    this.entrances = navigation.outpostNav.entrances
    this.gateEntrance = this.groundEntrance('gate', gate.siegeObstacle, 'gate')
    for (const obstacle of obstacles) {
      if (obstacle.damageable?.kind !== 'palisade') continue
      const entrance = this.groundEntrance(obstacle.damageable.root.name, obstacle, 'palisade')
      this.perimeter.push({ obstacle, entrance })
      this.unsubscribers.push(obstacle.damageable.onDestroyed(() => this.refreshPhysicalEntrances()))
    }
    this.unsubscribers.push(gate.onStateChange(() => this.refreshPhysicalEntrances()))
    this.refreshPhysicalEntrances()
  }

  private groundEntrance(id: string, obstacle: ObstacleData, type: 'gate' | 'palisade'): BreachEntrance {
    const position = obstacle.box.getCenter(new THREE.Vector3())
    position.y = getTerrainHeight(position.x, position.z)
    const zSign = this.walkways.layout.zSign
    const axis = obstacle.box.max.x - obstacle.box.min.x > obstacle.box.max.z - obstacle.box.min.z ? 'z' : 'x'
    const normal = axis === 'x' ? -Math.sign(position.x) : obstacle.damageable?.root.name.includes('rear') ? -zSign : zSign
    const approach = position.clone(), exit = position.clone()
    approach[axis] -= normal * 3; exit[axis] += normal * 3
    approach.y = getTerrainHeight(approach.x, approach.z); exit.y = getTerrainHeight(exit.x, exit.z)
    return { id, type, position, approach, exit, mounted: true, walkable: true, faction: null, connectionId: id }
  }

  prepare(specs: NpcSpawnSpec[]): void {
    if (this.ramps.length || this.disposed) throw new Error('Siege wave already prepared or disposed')
    // Establish the same stable IDs used by the wave queue before making any assignments.
    specs.forEach((spec, index) => { spec.actorId ??= `attackers:${index}` })
    try {
      for (const crew of allocateSiegeRampCrews(specs)) {
        const placement = getSiegeRampPlacement(this.walkways.layout, crew.side)
        const ramp = new MobileSiegeRamp(this.scene, crew, placement, this.gate.attackerFaction,
          this.obstacles, (vehicle, state) => this.onRampState(vehicle, state))
        this.ramps.push(ramp)
        placeSiegeRampCrew(specs, crew, placement)
        this.registerHit(ramp)
      }
    } catch (error) { this.dispose(); throw error }
  }

  register(npc: NPC, spec: NpcSpawnSpec): void {
    if (spec.siegeRamp) {
      const ramp = this.ramps.find(vehicle => vehicle.assignment.id === spec.siegeRamp!.id)
      if (!ramp || this.disposed) throw new Error('Missing siege vehicle during crew spawn')
      ramp.register(npc)
    } else if (npc.characterFaction === this.gate.attackerFaction) this.route(npc)
  }

  /** Safe to call inside the existing one-shot breach callback, before issuing orders. */
  refreshPhysicalEntrances(): void {
    if (this.disposed) return
    if (this.gate.state !== 'closed') this.entrances.set(this.gateEntrance)
    else this.entrances.remove('gate')
    for (const { obstacle, entrance } of this.perimeter) {
      if (obstacle.damageable!.destroyed) this.entrances.set(entrance)
    }
  }

  private onRampState(ramp: MobileSiegeRamp, state: MobileSiegeRampState): void {
    if (state === 'DOCKED') {
      this.walkways.setDockPassage(ramp.assignment.side, true)
      const surface = ramp.surface
      const approach = new THREE.Vector3(surface.startX, surface.startY, surface.startZ - surface.dirZ * 2.2)
      approach.y = getTerrainHeight(approach.x, approach.z)
      this.entrances.set({ id: ramp.assignment.id, type: ramp.assignment.id, walkable: true, mounted: true,
        position: ramp.position.clone(), approach, exit: ramp.placement.deckConnection.clone(),
        faction: null, connectionId: ramp.assignment.id, surface, side: ramp.assignment.side })
      this.breach.trigger()
    } else if (state === 'DESTROYED') {
      this.entrances.remove(ramp.assignment.id)
      this.walkways.setDockPassage(ramp.assignment.side, false)
      this.unregisterHit(ramp)
      // Includes actors who joined after Dock. Deck actors are not relocated or deleted.
      for (const npc of this.actors()) {
        if (npc.dead || npc.isMounted) continue
        const height = getWalkRampHeight(ramp.surface, npc.position.x, npc.position.z)
          ?? getWalkRampHeight(ramp.bridgeSurface, npc.position.x, npc.position.z)
        if (height !== null && Math.abs(npc.position.y - height) < .8) {
          npc.siegeEvacuation = null
          npc.pendingFall.begin(npc.position, new THREE.Vector3())
        }
      }
    }
    if (state === 'DOCKED' || state === 'DESTROYED' || state === 'ABANDONED') {
      for (const npc of ramp.crew.values()) {
        if (npc.dead) continue
        if (state === 'ABANDONED' && ramp.assignment.assaultIds.includes(npc.combatantId)) {
          const surface = ramp.surface
          npc.siegeEvacuation = new THREE.Vector3(surface.startX, surface.startY, surface.startZ - surface.dirZ * 2)
        }
        this.route(npc, state === 'DOCKED' ? ramp.assignment.id : undefined)
      }
    }
  }

  private route(npc: NPC, preferred?: string): void {
    if (npc.dead || npc.siegeTransport || npc.characterFaction !== this.gate.attackerFaction
      || npc.combatOwnership === 'player-personal') return
    const previous = npc.campaignEntranceId
    const currentLayer = this.navigation.outpostNav!.getNavLayer(npc.combatPosition)
    const entry = this.entrances.select(npc.combatPosition, npc.isMounted, npc.characterFaction,
      point => currentLayer !== 'ground' || this.navigation.areConnected(npc.combatPosition, point),
      preferred ?? previous)
    npc.campaignEntranceId = entry?.id ?? null
    if (entry) {
      if (previous !== entry.id) {
        npc.assignSiegeObstacle(null)
        npc.setTacticalOrder(npc.aiType === AIType.RANGED ? 'attack' : 'charge')
      }
    } else if (this.gate.state === 'closed' && !npc.campaignBreachCompleted) npc.assignSiegeObstacle(this.gate.siegeObstacle)
  }

  update(dt: number): void {
    if (this.disposed) return
    const actors = this.actors()
    const blockers = this.blockers()
    for (const ramp of this.ramps) ramp.update(dt, actors, blockers)
    if (this.observedRevision !== this.entrances.revision) {
      this.navigation.sync(this.obstacles)
      this.observedRevision = this.entrances.revision
      for (const npc of actors) this.route(npc)
    }
    reconcileCampaignGateSiege({ gate: this.gate, breachController: this.breach, npcs: actors,
      attackerFaction: this.gate.attackerFaction, availableEntrances: this.entrances })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers.length = 0
    for (const ramp of this.ramps) {
      this.walkways.setDockPassage(ramp.assignment.side, false)
      this.unregisterHit(ramp); ramp.dispose()
    }
    this.entrances.clear()
    this.ramps.length = 0
  }
}
