import * as THREE from 'three'
import { MobileSiegeRamp } from '../campaign/MobileSiegeRamp'
import type { MobileSiegeRampState } from '../campaign/MobileSiegeRampController'
import { placeSiegeRampCrew, type TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import { SiegeConvoy, evacuateAbandonedRamp, fallFromDestroyedRamp } from '../campaign/SiegeConvoy'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { AIType, type NPC } from '../world/NPC'
import type { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, type EntityCollisionBody } from '../world/Terrain'
import type { TownWorld } from '../town/TownWorld'
import { TOWN_GATES, type TownGateId } from '../town/TownLayout'
import { snapshotCommandActor, restoreCommandActor } from './CareerCommandActorCheckpoint'
import { allocateTownSiegeCrews, isTownSiegeDockConnected, planTownSiegeRamps, townSiegeFrame, type TownSiegeCrewSlot, type TownSiegeRampAssignment } from './TownFourGateSiegePolicy'
import { TownGateBreachPolicy, type TownGateBreachEvent } from './TownGateBreachPolicy'
import { parseTownFourGateSiegeCheckpoint, type TownFourGateSiegeCheckpoint, type TownSiegeActorCheckpoint } from './TownFourGateSiegeCheckpoint'

export interface TownSiegeSectorRoster {
  gateId: TownGateId
  wallActorIds: readonly string[]
  cavalryActorIds: readonly string[]
  /** Optional PR8 attack roster; Crew are included automatically and may also be listed here. */
  attackerActorIds?: readonly string[]
}
export interface TownFourGateSiegeOptions {
  scene: THREE.Scene
  world: TownWorld
  navigation: NavigationWorld
  /** Reuse the caller's once-per-frame grid, never scan the army separately per vehicle. */
  grid: SpatialGrid<NPC>
  actors(): readonly NPC[]
  sectors: readonly TownSiegeSectorRoster[]
  /** Official authority / native duty owner decides; HR ownership is never transferred. */
  acceptsOrders(npc: NPC): boolean
  registerHit(ramp: MobileSiegeRamp<TownSiegeRampId>): void
  unregisterHit(ramp: MobileSiegeRamp<TownSiegeRampId>): void
  blockers?(): readonly EntityCollisionBody[]
}

/** Opt-in scene adapter. Vehicles, crew readiness, moving platforms, damage and
 * convoy avoidance remain the Campaign production owners; this owns Town topology/events only.
 */
export class TownFourGateSiege {
  readonly ramps = new Map<TownSiegeRampId, MobileSiegeRamp<TownSiegeRampId>>()
  readonly policy: TownGateBreachPolicy
  private readonly rampList: MobileSiegeRamp<TownSiegeRampId>[] = []
  private readonly crewRamps = new Map<string, MobileSiegeRamp<TownSiegeRampId>>()
  private readonly actorsById = new Map<string, NPC>()
  private readonly pending = new Set<string>()
  private readonly departedActors = new Map<string, TownSiegeActorCheckpoint>()
  private readonly routeEligibility = new Map<string, boolean>()
  private readonly playerCommands = new Set<string>()
  private readonly convoy = new SiegeConvoy<TownSiegeRampId>()
  private readonly neighbors: NPC[] = []
  private readonly unsubscribe: (() => void)[] = []
  private readonly saved?: TownFourGateSiegeCheckpoint
  private readonly hitRegistered = new Set<TownSiegeRampId>()
  private readonly sectorById = new Map<TownGateId, TownSiegeSectorRoster>()
  private readonly attackerIds = new Set<string>()
  private readonly actorSectors = new Map<string, TownGateId>()
  private restoring = false
  private disposed = false
  private prepared = false
  private faction: 'roman' | 'viking' = 'roman'
  private observedRevision = -1

  constructor(private readonly options: TownFourGateSiegeOptions, checkpoint?: unknown) {
    if (!options.world.siegeDockPassages || !options.navigation.townNav) throw new Error('Four-gate siege requires an opt-in TownWorld and Town navigation')
    if (checkpoint !== undefined) {
      this.saved = parseTownFourGateSiegeCheckpoint(checkpoint)
      if (!this.saved) throw new Error('Invalid Town four-gate checkpoint')
    }
    for (const sector of options.sectors) {
      if (this.sectorById.has(sector.gateId) || !TOWN_GATES.some(g => g.id === sector.gateId)) throw new Error('Duplicate/invalid siege sector')
      this.sectorById.set(sector.gateId, sector)
      for (const id of [...sector.wallActorIds, ...sector.cavalryActorIds, ...(sector.attackerActorIds ?? [])]) {
        if (this.actorSectors.has(id)) throw new Error('Actor belongs to multiple siege sectors')
        this.actorSectors.set(id, sector.gateId)
      }
      for (const id of sector.attackerActorIds ?? []) this.attackerIds.add(id)
    }
    this.policy = new TownGateBreachPolicy(event => this.dispatch(event), this.saved?.gates)
    for (const id of this.saved?.playerCommandedActorIds ?? []) this.playerCommands.add(id)
  }
  get entrances() { return this.options.navigation.townNav!.siegeEntrances }
  get ready(): boolean { return this.prepared && !this.disposed && this.pending.size === 0 }
  get savedActors() { return this.saved?.actors }

  /** Plans and validates all eight before creating a vehicle or cutting any rail. */
  prepare(slots: TownSiegeCrewSlot[]): void {
    if (this.prepared || this.disposed) throw new Error('Town siege already prepared/disposed')
    const { world, navigation } = this.options, passages = world.siegeDockPassages!
    const assignments = allocateTownSiegeCrews(slots)
    this.faction = slots[0].spec.characterFaction
    if (slots.some(s => s.spec.characterFaction !== this.faction) || this.saved && this.saved.faction !== this.faction) throw new Error('Town siege faction mismatch')
    for (const gate of this.saved?.gates ?? []) {
      const sector = this.sectorById.get(gate.gateId)
      if (gate.releasedWallActorIds.some(id => !sector?.wallActorIds.includes(id))
        || gate.releasedCavalryActorIds.some(id => !sector?.cavalryActorIds.includes(id))) throw new Error('Checkpoint released actor is outside its sector')
    }
    const placements = planTownSiegeRamps(world.fortifications.rampartLayout, world.obstacles, obstacle => passages.isRailObstacle(obstacle))
    for (const assignment of assignments) {
      const saved = this.saved?.ramps.find(r => r.assignment.id === assignment.id)
      if (this.saved && (!saved || !this.sameCrew(assignment, saved.assignment))) throw new Error('Checkpoint crew differs from mission roster')
      if (saved) {
        const p = placements.find(p => p.id === assignment.id)!
        const expected = p.start.clone().addScaledVector(new THREE.Vector3(p.dirX!, 0, p.dirZ), saved.distance)
        const rearX = p.surface.startX + saved.position.x - p.dock.x, rearZ = p.surface.startZ + saved.position.z - p.dock.z
        const expectedY = getTerrainHeight(rearX, rearZ) + .04 + p.surface.topY - p.surface.startY
        if (Math.abs(saved.position.y - expectedY) > .01 || Math.abs(saved.stagingZ - p.start.z) > .01 || Math.hypot(expected.x - saved.position.x, expected.z - saved.position.z) > .01
          || Math.abs(saved.travelDistance - p.start.distanceTo(p.dock.clone().setY(p.start.y))) > .01) throw new Error('Checkpoint does not match Town ramp geometry')
      }
    }
    this.restoring = true
    try {
      passages.configure(placements.map(p => p.passage))
      for (const assignment of assignments) {
        const placement = placements.find(p => p.id === assignment.id)!
        const ramp = new MobileSiegeRamp(this.options.scene, assignment, placement, this.faction, world.obstacles,
          (vehicle, state) => this.onRampState(vehicle, state))
        this.ramps.set(assignment.id, ramp); this.rampList.push(ramp)
        const saved = this.saved?.ramps.find(r => r.assignment.id === assignment.id)
        if (saved) ramp.restore(saved)
        const specs = slots.map(slot => slot.spec)
        placeSiegeRampCrew(specs, assignment, placement)
        for (const id of [...assignment.pusherIds, ...assignment.assaultIds]) {
          if (this.actorSectors.has(id) && (!this.attackerIds.has(id) || this.actorSectors.get(id) !== assignment.gateId)) throw new Error('Crew cannot also be a Town defender or another sector')
          this.attackerIds.add(id)
          this.actorSectors.set(id, (assignment as TownSiegeRampAssignment).gateId)
          this.crewRamps.set(id, ramp)
          const actor = this.saved?.actors[id]
          if (actor?.status === 'dead' || actor?.status === 'exited') {
            ramp.controller.register({ combatantId: id, dead: true })
          } else {
            if (this.playerCommands.has(id)) ramp.controller.register({ combatantId: id, dead: true })
            this.pending.add(id)
          }
        }
        if (!ramp.damageable.destroyed) { this.options.registerHit(ramp); this.hitRegistered.add(assignment.id) }
        if (ramp.controller.state === 'DOCKED') this.onRampState(ramp, 'DOCKED')
      }
      for (const id of this.actorSectors.keys()) {
        if (this.crewRamps.has(id)) continue
        const actor = this.saved?.actors[id]
        if (actor?.status !== 'dead' && actor?.status !== 'exited') this.pending.add(id)
      }
      for (const [id, gate] of world.gates) {
        const saved = this.saved?.gates.find(g => g.gateId === id)
        if (saved?.gateState === 'destroyed') gate.destroy()
        else {
          if (saved?.gateState === 'open') gate.open(); else gate.close()
          if (saved && saved.hp < gate.damageable.currentHp) gate.damageable.takeDamage(gate.damageable.currentHp - saved.hp)
        }
        this.refreshGate(id)
        this.unsubscribe.push(gate.onStateChange(() => this.refreshGate(id)))
      }
      this.prepared = true
      navigation.townNav!.siegeActive = true
      navigation.sync(world.obstacles)
    } catch (error) { this.dispose(); throw error }
    finally { this.restoring = false }
  }
  private sameCrew(a: TownSiegeRampAssignment, b: TownSiegeRampAssignment): boolean {
    return a.id === b.id && a.gateId === b.gateId && a.side === b.side
      && a.pusherIds.every(id => b.pusherIds.includes(id)) && a.assaultIds.every(id => b.assaultIds.includes(id))
  }

  /** Call once from the original scheduler job, after the actor's saved resources are restored. */
  register(npc: NPC): void {
    if (!this.prepared || this.disposed || this.actorsById.has(npc.combatantId) || this.departedActors.has(npc.combatantId)) throw new Error('Invalid Town siege actor registration')
    this.actorsById.set(npc.combatantId, npc)
    npc.townSiegeGateId = this.actorSectors.get(npc.combatantId) ?? null
    const saved = this.saved?.actors[npc.combatantId]
    if (saved) {
      if (saved.status === 'dead' || saved.status === 'exited') throw new Error('Cannot respawn a departed siege actor')
      restoreCommandActor(npc, saved)
      npc.campaignEntranceId = saved.entranceId; npc.campaignBreachCompleted = saved.breachCompleted
    }
    const ramp = this.crewRamps.get(npc.combatantId)
    if (ramp) {
      if (!this.playerCommands.has(npc.combatantId)) ramp.register(npc)
      if (ramp.controller.state === 'ABANDONED') evacuateAbandonedRamp(npc, ramp)
      if (ramp.controller.state === 'DOCKED' && !saved) this.route(npc, ramp.assignment.id)
    }
    this.pending.delete(npc.combatantId)
  }
  /** A caller-owned departure preserves this identity/resources and permanently removes its pushing contribution. */
  exit(npc: NPC): void {
    if (this.actorsById.get(npc.combatantId) !== npc) return
    this.crewRamps.get(npc.combatantId)?.releaseCrew(npc)
    this.convoy.release(npc)
    this.departedActors.set(npc.combatantId, { ...snapshotCommandActor(npc, undefined, 'exited'),
      entranceId: npc.campaignEntranceId, breachCompleted: npc.campaignBreachCompleted })
    this.actorsById.delete(npc.combatantId)
    npc.campaignEntranceId = null; npc.townSiegeGateId = null
  }
  /** Caller must forward every explicit player command, including Defend. */
  notifyPlayerOrder(npc: NPC): void {
    if (!this.actorsById.has(npc.combatantId)) return
    this.playerCommands.add(npc.combatantId); this.convoy.release(npc)
    this.crewRamps.get(npc.combatantId)?.releaseCrew(npc)
    npc.campaignEntranceId = null; npc.assignSiegeObstacle(null)
  }
  private accepts(npc: NPC): boolean {
    return !npc.dead && !this.departedActors.has(npc.combatantId) && npc.combatOwnership !== 'player-personal' && !this.playerCommands.has(npc.combatantId)
      && npc.tacticalOrder !== 'follow' && !npc.hasFormationTarget && this.options.acceptsOrders(npc)
  }
  private dispatch(event: TownGateBreachEvent): string[] {
    const sector = this.sectorById.get(event.gateId)
    if (!sector || this.restoring) return []
    const issued: string[] = []
    for (const id of event.kind === 'wall' ? sector.wallActorIds : sector.cavalryActorIds) {
      const npc = this.actorsById.get(id)
      if (!npc || !this.accepts(npc)) continue
      if (event.kind === 'wall') npc.releaseOutpostRampartGarrison()
      npc.setTacticalOrder(event.kind === 'wall' ? 'attack' : 'charge'); issued.push(id)
    }
    return issued
  }
  private refreshGate(gateId: TownGateId): void {
    const gate = this.options.world.gates.get(gateId)!, frame = townSiegeFrame(gateId), id = `town-siege-gate:${gateId}`
    if (gate.state === 'closed') this.entrances.remove(id)
    else {
      const position = new THREE.Vector3(frame.gate.x, getTerrainHeight(frame.gate.x, frame.gate.z), frame.gate.z)
      const approach = position.clone().addScaledVector(frame.outward, 5), exit = position.clone().addScaledVector(frame.inward, 5)
      approach.y = getTerrainHeight(approach.x, approach.z); exit.y = getTerrainHeight(exit.x, exit.z)
      this.entrances.set({ id, gateId, type: 'gate', position, approach, exit, walkable: true, mounted: true, faction: null, connectionId: id })
    }
    if (!this.restoring) this.policy.gate(gateId, gate.state)
    else this.policy.gates.get(gateId)!.gateState = gate.state
  }
  private onRampState(ramp: MobileSiegeRamp<TownSiegeRampId>, state: MobileSiegeRampState): void {
    const assignment = ramp.assignment as TownSiegeRampAssignment, passages = this.options.world.siegeDockPassages!
    if (state === 'DOCKED') {
      if (!isTownSiegeDockConnected(this.options.world.fortifications.rampartLayout, ramp.bridgeSurface, ramp.placement.deckConnection))
        throw new Error(`Town siege bridge failed physical dock contact: ${assignment.id}`)
      const s = ramp.surface
      passages.setOpen(assignment.id, true)
      const approach = new THREE.Vector3(s.startX - s.dirX * 2.2, s.startY, s.startZ - s.dirZ * 2.2)
      approach.y = getTerrainHeight(approach.x, approach.z)
      this.entrances.set({ id: assignment.id, gateId: assignment.gateId, type: 'siege-ramp', position: ramp.position.clone(), approach,
        exit: ramp.placement.deckConnection.clone(), walkable: true, mounted: true, faction: null, connectionId: assignment.id,
        surface: s, bridgeSurface: ramp.bridgeSurface, side: assignment.side })
      if (!this.restoring) this.policy.ramp(assignment.gateId, assignment.side, true)
    } else if (state === 'DESTROYED') {
      passages.setOpen(assignment.id, false); this.entrances.remove(assignment.id)
      if (this.hitRegistered.delete(assignment.id)) this.options.unregisterHit(ramp)
      if (!this.restoring) {
        this.policy.ramp(assignment.gateId, assignment.side, false)
        for (const npc of this.options.actors()) fallFromDestroyedRamp(npc, ramp)
      }
    }
    if (!this.restoring && ['DOCKED', 'ABANDONED', 'DESTROYED'].includes(state)) for (const npc of ramp.crew.values()) {
      if (state === 'ABANDONED') evacuateAbandonedRamp(npc, ramp)
      this.route(npc, state === 'DOCKED' ? assignment.id : undefined)
    }
  }
  private route(npc: NPC, preferred?: TownSiegeRampId): void {
    if (!this.attackerIds.has(npc.combatantId) || npc.siegeTransport || !this.accepts(npc) || npc.campaignBreachCompleted) return
    const gateId = this.actorSectors.get(npc.combatantId)!, nav = this.options.navigation
    const preferredId = preferred ?? npc.campaignEntranceId
    const candidates = this.entrances.select(npc.combatPosition, npc.isMounted, npc.characterFaction,
      point => nav.townNav!.isElevated(npc.combatPosition) || nav.areConnected(npc.combatPosition, point), preferredId)
    // Same-gate routes only. PR8 may explicitly opt into a verified cross-sector policy later.
    const entry = candidates?.gateId === gateId ? candidates : [...this.entrances.entries.values()].find(e => e.gateId === gateId
      && e.walkable && (!npc.isMounted || e.mounted) && nav.areConnected(npc.combatPosition, e.approach))
    const previous = npc.campaignEntranceId
    npc.campaignEntranceId = entry?.id ?? null
    if (entry) {
      npc.assignSiegeObstacle(null)
      if (previous !== entry.id) npc.setTacticalOrder(npc.aiType === AIType.RANGED ? 'attack' : 'charge')
    } else if (this.options.world.gates.get(gateId)!.state === 'closed') npc.assignSiegeObstacle(this.options.world.gates.get(gateId)!.siegeObstacle)
  }

  update(dt: number): void {
    if (!this.ready) return
    const { world, grid, navigation } = this.options, blockers = this.options.blockers?.() ?? []
    for (const ramp of this.ramps.values()) {
      // Enough radius for the full sloped carrier; reuse caller grid and scratch array.
      const radius = ramp.surface.length + ramp.surface.landing + 10
      ramp.update(dt, grid.getNearbyInto(ramp.position, radius, this.neighbors), blockers)
    }
    if (this.observedRevision !== this.entrances.revision) {
      navigation.sync(world.obstacles); this.observedRevision = this.entrances.revision
      for (const npc of this.actorsById.values()) this.route(npc)
    }
    // A deployment/formation hold may end without a topology revision. Admit
    // newly released AI actors once, while retaining explicit player receipts.
    for (const npc of this.actorsById.values()) if (this.attackerIds.has(npc.combatantId)) {
      const eligible = !npc.siegeTransport && this.accepts(npc)
      if (eligible && !this.routeEligibility.get(npc.combatantId)) this.route(npc)
      this.routeEligibility.set(npc.combatantId, eligible)
    }
    for (const npc of this.options.actors()) {
      if (!this.attackerIds.has(npc.combatantId) || npc.mount?.isFlyingMount || npc.siegeTransport || !this.accepts(npc)) {
        this.convoy.release(npc); continue
      }
      this.convoy.update(npc, this.rampList)
    }
  }
  snapshot(): TownFourGateSiegeCheckpoint {
    if (!this.ready) throw new Error('Cannot checkpoint partial Town siege deployment')
    const actors = { ...this.saved?.actors, ...Object.fromEntries(this.departedActors) }
    for (const npc of this.actorsById.values()) actors[npc.combatantId] = { ...snapshotCommandActor(npc),
      entranceId: npc.campaignEntranceId, breachCompleted: npc.campaignBreachCompleted }
    return { version: 1, faction: this.faction,
      ramps: [...this.ramps.values()].map(ramp => ({ ...ramp.snapshot(), assignment: structuredClone(ramp.assignment as TownSiegeRampAssignment), travelDistance: ramp.controller.travelDistance })),
      gates: this.policy.snapshot().map(gate => ({ ...gate, hp: this.options.world.gates.get(gate.gateId)!.damageable.currentHp })),
      actors, playerCommandedActorIds: [...this.playerCommands] }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.convoy.dispose()
    for (const off of this.unsubscribe.splice(0)) off()
    for (const ramp of this.ramps.values()) {
      this.options.world.siegeDockPassages!.setOpen(ramp.assignment.id, false)
      if (this.hitRegistered.delete(ramp.assignment.id)) this.options.unregisterHit(ramp)
      ramp.dispose()
    }
    this.entrances.clear(); this.options.navigation.townNav!.siegeActive = false
    for (const npc of this.actorsById.values()) { npc.campaignEntranceId = null; npc.townSiegeGateId = null; npc.siegeBypassTarget = null }
    this.ramps.clear(); this.rampList.length = 0; this.crewRamps.clear(); this.pending.clear(); this.attackerIds.clear(); this.routeEligibility.clear(); this.actorsById.clear(); this.departedActors.clear()
  }
}
