import { Box3, Vector3 } from 'three'
import { MobileSiegeRampController, type MobileSiegeRampState } from '../../src/campaign/MobileSiegeRampController'
import { SIEGE_RAMP, siegeRampDeckHeightAt, siegeRampRearHeightAt, type TownSiegeRampId } from '../../src/campaign/MobileSiegeRampPolicy'
import type { MobileSiegeRamp, MobileSiegeRampSnapshot } from '../../src/campaign/MobileSiegeRamp'
import type { TownFourGateSiegeOptions, TownSiegeGate, TownSiegeWorld } from '../../src/career/TownFourGateSiege'
import type { TownSiegeRampAssignment, TownSiegeRampPlacement } from '../../src/career/TownFourGateSiegePolicy'
import type { TownDockSite } from '../../src/town/TownDockPassages'
import { TOWN_GATES, type TownGateId } from '../../src/town/TownLayout'
import type { TownRampartLayout } from '../../src/town/TownRamparts'
import type { CampaignGateState } from '../../src/campaign/CampaignGate'
import type { ObstacleData, WalkRampSurface } from '../../src/world/Terrain'
import { DAMAGEABLE_OBSTACLE_HP, type DamageableObstacle } from '../../src/world/DamageableObstacle'
import type { NPC } from '../../src/world/NPC'
import { TownFourGateSiege } from '../../src/career/TownFourGateSiege'
import { createTownSiegeCrewSlots } from '../../src/career/TownFourGateSiegePolicy'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { ActorDouble, asNpc } from './careerActorDoubles'

/** Gate leaf state and HP with the real one-way destroyed rule; no hinges or meshes. */
export class GateDouble implements TownSiegeGate {
  private current: CampaignGateState = 'closed'
  private readonly listeners = new Set<(state: CampaignGateState) => void>()
  /** The gate leaves' hit volume; attackable while the gate stands. */
  readonly siegeObstacle: ObstacleData = { box: new Box3(), isBarricade: true, damageable: this.leafHits() }
  private leafHits(): DamageableObstacle {
    const destroyed = () => this.current === 'destroyed'
    return { get destroyed() { return destroyed() }, isDamageableBy: () => true } as unknown as DamageableObstacle
  }
  readonly damageable = { currentHp: 2080, takeDamage: (amount: number) => {
    this.damageable.currentHp = Math.max(0, this.damageable.currentHp - amount)
    if (this.damageable.currentHp === 0) this.destroy()
    return amount
  } }
  get state(): CampaignGateState { return this.current }
  private set(state: CampaignGateState): boolean {
    if (this.current === state || this.current === 'destroyed') return false
    this.current = state
    for (const listener of this.listeners) listener(state)
    return true
  }
  open(): boolean { return this.set('open') }
  close(): boolean { return this.set('closed') }
  destroy(): boolean { return this.set('destroyed') }
  onStateChange(listener: (state: CampaignGateState) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener) }
  }
}

/** Opt-in siege world: the real rampart layout, gate doubles, and dock passages that enforce the eight-site rule. */
export function townSiegeWorld(layout: TownRampartLayout, obstacles: ObstacleData[] = []): TownSiegeWorld & { gates: Map<TownGateId, GateDouble>; openDocks: Set<TownSiegeRampId> } {
  let configured = false
  const openDocks = new Set<TownSiegeRampId>()
  return {
    obstacles, fortifications: { rampartLayout: layout }, openDocks,
    gates: new Map(TOWN_GATES.map(gate => [gate.id, new GateDouble()])),
    siegeDockPassages: {
      isRailObstacle: () => false,
      configure(sites: readonly TownDockSite[]) {
        if (configured || sites.length !== 8 || new Set(sites.map(s => s.rampId)).size !== 8) throw new Error('Expected eight unique dock passages')
        configured = true
      },
      setOpen(id: TownSiegeRampId, value: boolean) {
        if (!configured) throw new Error('Dock passages not configured')
        if (value) openDocks.add(id); else openDocks.delete(id)
      },
    },
  }
}

type Changed = (ramp: MobileSiegeRamp<TownSiegeRampId>, state: MobileSiegeRampState) => void

/** Vehicle body over the real crew/lifecycle controller: placement start, push along its rail and snapshot/restore. */
export class SiegeRampDouble {
  readonly position: Vector3
  readonly surface: WalkRampSurface
  readonly bridgeSurface: WalkRampSurface
  readonly controller: MobileSiegeRampController<TownSiegeRampId>
  readonly obstacles: ObstacleData[] = []
  readonly crew = new Map<string, NPC>()
  readonly damageable = { destroyed: false, currentHp: DAMAGEABLE_OBSTACLE_HP.siege_ramp }
  disposed = false
  constructor(readonly assignment: TownSiegeRampAssignment, readonly placement: TownSiegeRampPlacement, changed: Changed,
    private readonly onUpdate: (ramp: SiegeRampDouble) => void = () => {}) {
    this.position = placement.start.clone()
    const s = placement.surface
    this.surface = { ...s, startX: s.startX + placement.start.x - placement.dock.x, startZ: s.startZ + placement.start.z - placement.dock.z }
    this.surface.startY = siegeRampRearHeightAt(placement, this.surface.startX, this.surface.startZ)
    this.bridgeSurface = { startX: this.position.x, startZ: this.position.z, startY: this.position.y, dirX: placement.dirX ?? 0,
      dirZ: placement.dirZ, halfWidth: SIEGE_RAMP.halfWidth, length: SIEGE_RAMP.bridgeLength, landing: 0, topY: placement.deckConnection.y }
    this.controller = new MobileSiegeRampController(assignment,
      Math.hypot(placement.start.x - placement.dock.x, placement.start.z - placement.dock.z), state => changed(this.asRamp(), state))
  }
  asRamp(): MobileSiegeRamp<TownSiegeRampId> { return this as unknown as MobileSiegeRamp<TownSiegeRampId> }
  register(npc: NPC): void {
    this.controller.register(npc); this.crew.set(npc.combatantId, npc)
    if (this.controller.assigned && !npc.dead) npc.siegeTransport = this.assignment.id
  }
  releaseCrew(npc: NPC): void {
    this.controller.withdraw(npc.combatantId); this.crew.delete(npc.combatantId); npc.siegeTransport = null
  }
  snapshot(): MobileSiegeRampSnapshot<TownSiegeRampId> {
    return { assignment: structuredClone(this.assignment), stagingZ: this.placement.start.z,
      position: { x: this.position.x, y: this.position.y, z: this.position.z }, hp: this.damageable.currentHp,
      state: this.controller.state, distance: this.controller.distance, dockingProgress: this.controller.dockingProgress }
  }
  restore(saved: MobileSiegeRampSnapshot<TownSiegeRampId>): void {
    this.controller.restore(saved)
    this.position.set(saved.position.x, saved.position.y, saved.position.z)
    this.damageable.currentHp = saved.hp; this.damageable.destroyed = saved.hp === 0
  }
  update(dt: number): void {
    this.onUpdate(this)
    const movement = this.controller.advance(Math.min(dt, .1), () => true)
    if (movement <= 0) return
    this.position.x += movement * (this.placement.dirX ?? 0); this.position.z += movement * this.placement.dirZ
    this.position.y = siegeRampDeckHeightAt(this.placement, this.position.x, this.position.z)
  }
  dispose(): void { this.disposed = true; this.controller.dispose() }
}

/** Production-shaped createRamp port that records each vehicle by assignment id. */
export function recordingRampFactory(onUpdate?: (ramp: SiegeRampDouble) => void): TownFourGateSiegeOptions['createRamp'] & { ramps: Map<TownSiegeRampId, SiegeRampDouble> } {
  const ramps = new Map<TownSiegeRampId, SiegeRampDouble>()
  const create = (assignment: TownSiegeRampAssignment, placement: TownSiegeRampPlacement, _faction: 'roman' | 'viking',
    _shared: ObstacleData[], changed: Changed) => {
    const ramp = new SiegeRampDouble(assignment, placement, changed, onUpdate)
    ramps.set(assignment.id, ramp)
    return ramp.asRamp()
  }
  return Object.assign(create, { ramps })
}


type SiegeSetup = Pick<TownFourGateSiegeOptions, 'sectors'> & Partial<Pick<TownFourGateSiegeOptions, 'actors' | 'attackerRole' | 'navigation' | 'acceptsOrders'>>
  & { obstacles?: ObstacleData[]; layout?: TownRampartLayout; onRampUpdate?: (ramp: SiegeRampDouble) => void; checkpoint?: unknown }

/** The real siege adapter over the gate/dock world doubles; `townNav` defaults to the real layered navigation. */
export function townSiege(setup: SiegeSetup) {
  const layout = setup.layout ?? getTownRampartLayout(), world = townSiegeWorld(layout, setup.obstacles)
  const createRamp = recordingRampFactory(setup.onRampUpdate)
  const navigation = setup.navigation ?? { townNav: new TownLayeredNavigation(layout, () => true), areConnected: () => true, sync: () => false }
  const siege = new TownFourGateSiege({ createRamp, world, navigation, grid: new SpatialGrid<NPC>(), actors: setup.actors ?? (() => []),
    sectors: setup.sectors, acceptsOrders: setup.acceptsOrders ?? (() => true), attackerRole: setup.attackerRole,
    registerHit: () => {}, unregisterHit: () => {} }, setup.checkpoint)
  return { siege, world, navigation, ramps: createRamp.ramps }
}

/** A prepared siege whose eighty vehicle crew are registered, so update() runs. */
export function preparedTownSiege(setup: SiegeSetup) {
  const h = townSiege(setup), slots = createTownSiegeCrewSlots('viking')
  h.siege.prepare(slots)
  for (const slot of slots) h.siege.register(asNpc(new ActorDouble(slot.spec.actorId!, { faction: slot.spec.faction, characterFaction: 'viking', x: slot.spec.x, z: slot.spec.z })))
  return h
}
