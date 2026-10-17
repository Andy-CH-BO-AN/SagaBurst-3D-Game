import { SiegeConvoy, evacuateAbandonedRamp, fallFromDestroyedRamp } from './SiegeConvoy'
import type { SiegeRampId } from './MobileSiegeRampPolicy'
import type { CampaignSiegeCheckpoint } from './CampaignSiegeCheckpoint'
import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { BreachEntrance } from '../navigation/AvailableBreachEntrances'
import { AIType, type NPC } from '../world/NPC'
import { getTerrainHeight, type EntityCollisionBody, type ObstacleData } from '../world/Terrain'
import type { OutpostWalkways } from './CampaignOutpostWalkways'
import type { CampaignGateController, CampaignBreachController } from './CampaignGate'
import { reconcileCampaignGateSiege } from './CampaignGate'
import { allocateSiegeRampCrews, getSiegeRampPlacement, placeSiegeRampCrew, isSiegeRampCrewCandidate } from './MobileSiegeRampPolicy'
import { MobileSiegeRamp } from './MobileSiegeRamp'
import type { MobileSiegeRampState } from './MobileSiegeRampController'

/** Shared Campaign Outpost scene owner: physical entrances, convoy ownership and event-driven reassignment. */
export class CampaignSiegeAssault {
  readonly ramps: MobileSiegeRamp[] = []
  readonly entrances
  private readonly unsubscribers: (() => void)[] = []
  private readonly perimeter: { obstacle: ObstacleData; entrance: BreachEntrance }[] = []
  private readonly pendingDeployment = new Set<string>()
  private readonly stagingActors: NPC[] = []
  private readonly convoy = new SiegeConvoy<SiegeRampId>()
  private prepared = false
  private restoredActors: CampaignSiegeCheckpoint['actors'] = {}
  private disposed = false
  private observedRevision = -1
  private readonly gateEntrance: BreachEntrance

  constructor(private readonly scene: THREE.Scene, private readonly obstacles: ObstacleData[],
    readonly walkways: OutpostWalkways, private readonly navigation: NavigationWorld,
    private readonly gate: CampaignGateController, private readonly breach: CampaignBreachController,
    private readonly actors: () => readonly NPC[],
    private readonly registerHit: (ramp: MobileSiegeRamp) => void,
    private readonly unregisterHit: (ramp: MobileSiegeRamp) => void,
    private readonly blockers: () => readonly EntityCollisionBody[] = () => [],
    private readonly acceptsOrders: (npc: NPC) => boolean = () => true) {
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

  get isPrepared(): boolean { return this.prepared }

  /** A restored zero-tower initial plan can be followed by the remaining Commander wave. */
  trackDeployment(plan: readonly NpcSpawnSpec[]): void {
    if (!this.prepared || this.disposed || this.ramps.length) throw new Error('Cannot extend siege convoy deployment')
    for (const spec of plan) if (spec.characterFaction === this.gate.attackerFaction && spec.actorId) this.pendingDeployment.add(spec.actorId)
  }

  prepare(plan: NpcSpawnSpec[], saved?: CampaignSiegeCheckpoint): void {
    if (this.prepared || this.disposed) throw new Error('Siege wave already prepared or disposed')
    this.prepared = true
    const specs = plan.filter(spec => spec.characterFaction === this.gate.attackerFaction)
    if (saved?.breached) this.breach.restoreBreached()
    this.restoredActors = saved?.actors ?? {}
    for (const { obstacle, entrance } of this.perimeter) {
      if (saved?.destroyedPalisadeIds.includes(entrance.id)) obstacle.damageable!.destroy()
    }
    // Establish the same stable IDs used by the wave queue before making any assignments.
    specs.forEach((spec, index) => { spec.actorId ??= `attackers:${index}` })
    for (const spec of specs) this.pendingDeployment.add(spec.actorId!)
    try {
      const stagingZ = specs.reduce((nearest, spec) => this.walkways.layout.zSign > 0
        ? Math.max(nearest, spec.z) : Math.min(nearest, spec.z), this.walkways.layout.zSign > 0 ? -Infinity : Infinity)
      const assignments = saved ? saved.ramps.map(ramp => ramp.assignment) : allocateSiegeRampCrews(specs, this.gate.attackerFaction)
      for (const crew of assignments) {
        const checkpoint = saved?.ramps.find(ramp => ramp.assignment.id === crew.id)
        if ([...crew.pusherIds, ...crew.assaultIds].some(id => !specs.some(spec => spec.actorId === id
          && isSiegeRampCrewCandidate(spec, this.gate.attackerFaction)))) throw new Error('Saved siege crew is outside the attacker roster')
        const placement = getSiegeRampPlacement(this.walkways.layout, crew.side, checkpoint?.stagingZ ?? stagingZ)
        const ramp = new MobileSiegeRamp(this.scene, crew, placement, this.gate.attackerFaction,
          this.obstacles, (vehicle, state) => this.onRampState(vehicle, state))
        this.ramps.push(ramp)
        if (checkpoint) ramp.restore(checkpoint)
        if (ramp.controller.assigned) {
          placeSiegeRampCrew(specs, crew, placement)
          if (checkpoint) for (const spec of specs.filter(spec => spec.siegeRamp?.id === crew.id)) {
            spec.z += ramp.position.z - placement.start.z
            spec.spawnY = spec.siegeRamp!.role === 'assault' ? ramp.position.y : getTerrainHeight(spec.x, spec.z)
          }
        }
        if (!ramp.damageable.destroyed) this.registerHit(ramp)
        if (ramp.controller.state === 'DOCKED') this.onRampState(ramp, 'DOCKED')
      }
      // Reserve each convoy corridor before construction of ordinary actors.
      // Keep row spacing while moving only overlapping roster slots behind the rear.
      for (const ramp of this.ramps.filter(ramp => ramp.controller.assigned)) {
        const rear = ramp.surface.startZ - ramp.placement.dirZ * 6
        for (const spec of specs) {
          if (spec.siegeRamp || Math.abs(spec.x - ramp.position.x) > ramp.surface.halfWidth + 1.5) continue
          const forward = (spec.z - rear) * ramp.placement.dirZ
          if (forward >= 0) {
            spec.z -= ramp.placement.dirZ * (ramp.surface.length + 12)
            let attempts = 0
            while (specs.some(other => other !== spec && Math.abs(other.x - spec.x) < 3
              && Math.abs(other.z - spec.z) < 3) && attempts++ < 200) spec.z -= ramp.placement.dirZ * 3.2
            if (attempts >= 200) throw new Error('No clear siege staging slot')
          }
        }
      }
    } catch (error) { this.dispose(); throw error }
  }

  register(npc: NPC, spec: NpcSpawnSpec): void {
    if (this.disposed) throw new Error('Siege assault disposed during registration')
    if (!this.pendingDeployment.has(spec.actorId ?? npc.combatantId)) {
      if (spec.siegeRamp) throw new Error('Invalid siege crew registration outside prepared wave')
      return
    }
    const restored = this.restoredActors[npc.combatantId]
    if (restored) {
      npc.campaignEntranceId = restored.entranceId
      npc.campaignBreachCompleted = restored.breachCompleted
    }
    const assignedRamp = this.ramps.find(vehicle => [...vehicle.assignment.pusherIds, ...vehicle.assignment.assaultIds].includes(npc.combatantId))
    if (spec.siegeRamp || assignedRamp) {
      const ramp = assignedRamp
      if (spec.siegeRamp && ramp?.assignment.id !== spec.siegeRamp.id) throw new Error('Mismatched siege crew vehicle')
      if (!ramp || this.disposed) throw new Error('Missing siege vehicle during crew spawn')
      ramp.register(npc)
      if (ramp.controller.state === 'ABANDONED') this.resumeAbandonedEvacuation(npc, ramp)
    } else if (npc.characterFaction === this.gate.attackerFaction) {
      this.route(npc)
      npc.siegeTransport = 'siege-deployment'
      this.stagingActors.push(npc)
    }
    this.pendingDeployment.delete(spec.actorId ?? npc.combatantId)
    if (this.pendingDeployment.size === 0) {
      for (const actor of this.stagingActors) actor.siegeTransport = null
      this.stagingActors.length = 0
    }
  }

  snapshot(): CampaignSiegeCheckpoint | undefined {
    if (!this.prepared || this.disposed) return undefined
    return { version: 1, breached: this.breach.breached, ramps: this.ramps.map(ramp => ramp.snapshot()),
      actors: { ...this.restoredActors, ...Object.fromEntries(this.actors()
        .filter(npc => npc.characterFaction === this.gate.attackerFaction && npc.combatOwnership !== 'player-personal')
        .map(npc => [npc.combatantId, { entranceId: npc.campaignEntranceId, breachCompleted: npc.campaignBreachCompleted }])) },
      destroyedPalisadeIds: this.perimeter.filter(entry => entry.obstacle.damageable!.destroyed).map(entry => entry.entrance.id) }
  }

  /** Safe to call inside the existing one-shot breach callback, before issuing orders. */
  refreshPhysicalEntrances(): void {
    if (this.disposed) return
    if (this.gate.state !== 'closed') this.entrances.set(this.gateEntrance)
    else this.entrances.remove('gate')
    for (const { obstacle, entrance } of this.perimeter) {
      if (obstacle.damageable!.destroyed) this.entrances.set(entrance)
    }
    if (this.entrances.hasWalkable) this.breach.trigger()
  }

  private resumeAbandonedEvacuation(npc: NPC, ramp: MobileSiegeRamp): void {
    evacuateAbandonedRamp(npc, ramp)
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
      for (const npc of this.actors()) fallFromDestroyedRamp(npc, ramp)
    }
    if (state === 'DOCKED' || state === 'DESTROYED' || state === 'ABANDONED') {
      for (const npc of ramp.crew.values()) {
        if (npc.dead) continue
        if (state === 'ABANDONED') this.resumeAbandonedEvacuation(npc, ramp)
        this.route(npc, state === 'DOCKED' ? ramp.assignment.id : undefined)
      }
    }
  }

  private route(npc: NPC, preferred?: string): void {
    if (npc.dead || npc.siegeTransport || npc.characterFaction !== this.gate.attackerFaction
      || npc.combatOwnership === 'player-personal' || !this.acceptsOrders(npc)) return
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
    // Ordinary attackers must walk around a live convoy, not climb its rear
    // ramp and deadlock the vehicle's body-safety stop. Keep the chosen side
    // until they have passed the front; all locomotion/collision stays in NPC.
    for (const npc of actors) {
      if (npc.dead || npc.siegeTransport || npc.characterFaction !== this.gate.attackerFaction
        || npc.combatOwnership === 'player-personal' || !this.acceptsOrders(npc) || npc.mount?.isFlyingMount) continue
      this.convoy.update(npc, this.ramps)
    }
    if (this.pendingDeployment.size === 0) for (const ramp of this.ramps) ramp.update(dt, actors, blockers)
    if (this.observedRevision !== this.entrances.revision) {
      this.navigation.sync(this.obstacles)
      this.observedRevision = this.entrances.revision
      for (const npc of actors) this.route(npc)
    }
    reconcileCampaignGateSiege({ gate: this.gate, breachController: this.breach, npcs: actors.filter(npc => this.acceptsOrders(npc)),
      attackerFaction: this.gate.attackerFaction, availableEntrances: this.entrances })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.convoy.dispose()
    for (const actor of this.stagingActors) actor.siegeTransport = null
    this.stagingActors.length = 0
    this.pendingDeployment.clear()
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
