/**
 * LAN co-op: mobile siege vehicles and gates on the guest's screen (Town four-gate siege, battlefield Outposts).
 *
 * The host's siege owner (`TownFourGateSiege`, `CampaignSiegeAssault`) runs every rule: crew, movement
 * gate, docking and damage. The guest page runs no siege simulation, so the host sends each vehicle's
 * placement and live state, and the guest builds display-only vehicles that follow it
 * (`MobileSiegeRamp.mirror`). Their collision boxes and walk surfaces join the guest's obstacles, so the
 * guest stands on, climbs and is blocked by the same vehicles; docked bridges open the scene's own dock
 * passage; gates follow the host's open/closed/destroyed state and HP. The guest's hits on these
 * structures travel through the co-op structure keys (`coopSiegeStructures`).
 */
import * as THREE from 'three'
import type { CampaignGateState } from '../campaign/CampaignGate'
import type { MobileSiegeRamp } from '../campaign/MobileSiegeRamp'
import type { MobileSiegeRampState } from '../campaign/MobileSiegeRampController'
import { SIEGE_RAMP, type MobileSiegeRampId, type SiegeRampAssignment, type SiegeRampPlacement } from '../campaign/MobileSiegeRampPolicy'
import type { TownDockSite } from '../town/TownDockPassages'
import type { TownGateId } from '../town/TownLayout'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import type { ObstacleData, WalkRampSurface } from '../world/Terrain'

type Vec = { x: number; y: number; z: number }
type AnyRamp = MobileSiegeRamp<MobileSiegeRampId>

/** Town vehicles carry their gate sector; Outpost vehicles do not. */
export type CoopSiegeAssignment = SiegeRampAssignment<MobileSiegeRampId> & { gateId?: TownGateId }
/** Town vehicles carry their rampart dock site; Outpost docks use the walkway side. */
export type CoopSiegePlacement = SiegeRampPlacement<MobileSiegeRampId> & { gateId?: TownGateId; passage?: TownDockSite }

export interface CoopSiegeRampWire {
  assignment: CoopSiegeAssignment
  faction: 'roman' | 'viking'
  placement: {
    side: SiegeRampPlacement['side']
    start: Vec; dock: Vec; deckConnection: Vec
    surface: WalkRampSurface
    dirX?: number; dirZ: number
    terrainAnchor?: 'deck'
    passage?: { point: Vec; halfWidth: number }
  }
  state: MobileSiegeRampState
  distance: number
  dockingProgress: number
  hp: number
  /** Metres per second while pushing; the guest extrapolates between messages. */
  speed: number
}

export interface CoopSiegeGateWire { id: string; state: CampaignGateState; hp: number }
export interface CoopSiegeWire { ramps: CoopSiegeRampWire[]; gates: CoopSiegeGateWire[] }

/** The gate surface both siege owners use (`CampaignGateController`). */
export interface CoopSiegeGate {
  readonly state: CampaignGateState
  readonly damageable: DamageableObstacle
  open(): boolean
  close(occupied?: boolean): boolean
  destroy(): boolean
}

const RAMP_STATES: ReadonlySet<string> = new Set(['DEPLOYING', 'PUSHING', 'DOCKING', 'DOCKED', 'ABANDONED', 'DESTROYED'])
const GATE_STATES: ReadonlySet<string> = new Set(['closed', 'open', 'destroyed'])
const vec = (v: Vec): Vec => ({ x: v.x, y: v.y, z: v.z })
const finite = (...values: unknown[]): boolean => values.every(value => typeof value === 'number' && Number.isFinite(value))
const finiteVec = (v: unknown): v is Vec => Boolean(v) && finite((v as Vec).x, (v as Vec).y, (v as Vec).z)

/** Both pages' structure keys: the host reads its siege owner, the guest its mirror; gates by scene id. */
export function coopSiegeStructures(ramps: Iterable<AnyRamp>, gates: ReadonlyMap<string, CoopSiegeGate>,
  into = new Map<string, DamageableObstacle>()): Map<string, DamageableObstacle> {
  for (const ramp of ramps) into.set(`ramp:${ramp.assignment.id}`, ramp.damageable)
  for (const [id, gate] of gates) into.set(`gate:${id}`, gate.damageable)
  return into
}

/** Host: the live siege state, or null when there is nothing to show. */
export function coopSiegeWire(ramps: Iterable<AnyRamp>, gates: ReadonlyMap<string, CoopSiegeGate>): CoopSiegeWire | null {
  const list = [...ramps]
  if (!list.length && !gates.size) return null
  return {
    ramps: list.map(ramp => {
      const p = ramp.placement as CoopSiegePlacement
      return {
        assignment: structuredClone(ramp.assignment as CoopSiegeAssignment),
        faction: ramp.faction,
        placement: {
          side: p.side, start: vec(p.start), dock: vec(p.dock), deckConnection: vec(p.deckConnection), surface: { ...p.surface },
          ...(p.dirX !== undefined ? { dirX: p.dirX } : {}), dirZ: p.dirZ, ...(p.terrainAnchor ? { terrainAnchor: p.terrainAnchor } : {}),
          ...(p.passage ? { passage: { point: vec(p.passage.point), halfWidth: p.passage.halfWidth } } : {}),
        },
        state: ramp.controller.state, distance: ramp.controller.distance, dockingProgress: ramp.controller.dockingProgress,
        hp: ramp.damageable.currentHp, speed: ramp.controller.currentSpeed,
      }
    }),
    gates: [...gates].map(([id, gate]) => ({ id, state: gate.state, hp: gate.damageable.currentHp })),
  }
}

/** Guest: drops malformed entries rather than the whole message. */
export function parseCoopSiegeWire(value: unknown): CoopSiegeWire | null {
  const wire = value as Partial<CoopSiegeWire> | null | undefined
  if (!wire || !Array.isArray(wire.ramps) || !Array.isArray(wire.gates)) return null
  const ramps = wire.ramps.filter((ramp): ramp is CoopSiegeRampWire => {
    const p = ramp?.placement, a = ramp?.assignment
    return Boolean(p && a && typeof a.id === 'string' && Array.isArray(a.pusherIds) && Array.isArray(a.assaultIds)
      && (a.gateId === undefined || typeof a.gateId === 'string')
      && (ramp.faction === 'roman' || ramp.faction === 'viking') && RAMP_STATES.has(ramp.state)
      && finite(ramp.distance, ramp.dockingProgress, ramp.hp, ramp.speed, p.dirZ)
      && (p.dirX === undefined || finite(p.dirX))
      && finiteVec(p.start) && finiteVec(p.dock) && finiteVec(p.deckConnection)
      && (p.passage === undefined || finiteVec(p.passage.point) && finite(p.passage.halfWidth))
      && p.surface && finite(p.surface.startX, p.surface.startZ, p.surface.startY, p.surface.dirX, p.surface.dirZ,
        p.surface.halfWidth, p.surface.length, p.surface.landing, p.surface.topY))
  })
  const gates = wire.gates.filter((gate): gate is CoopSiegeGateWire => typeof gate?.id === 'string' && GATE_STATES.has(gate.state) && finite(gate.hp))
  return { ramps, gates }
}

/** The vehicle placement the host planned, rebuilt as math data for the guest's carrier. */
export function coopSiegePlacement(wire: CoopSiegeRampWire): CoopSiegePlacement {
  const p = wire.placement, id = wire.assignment.id, gateId = wire.assignment.gateId
  const v = (point: Vec) => new THREE.Vector3(point.x, point.y, point.z)
  return {
    id, side: p.side, start: v(p.start), dock: v(p.dock), deckConnection: v(p.deckConnection),
    surface: { ...p.surface }, ...(p.dirX !== undefined ? { dirX: p.dirX } : {}), dirZ: p.dirZ,
    ...(p.terrainAnchor ? { terrainAnchor: p.terrainAnchor } : {}),
    ...(gateId ? { gateId } : {}),
    ...(p.passage && gateId ? { passage: { rampId: id as TownDockSite['rampId'], gateId, point: v(p.passage.point), halfWidth: p.passage.halfWidth } } : {}),
  }
}

/** What the scene lends the mirror: its obstacle list, gates and dock/airspace hooks. */
export interface CoopSiegeWorld {
  readonly obstacles: ObstacleData[]
  readonly gates: ReadonlyMap<string, CoopSiegeGate>
  createRamp(assignment: CoopSiegeAssignment, placement: CoopSiegePlacement, faction: 'roman' | 'viking', shared: ObstacleData[]): AnyRamp
  /** Called once with every vehicle, before the first dock opens (Town rampart passages). */
  configureDocks?(ramps: readonly CoopSiegeRampWire[]): void
  setDockOpen?(ramp: CoopSiegeRampWire, open: boolean): void
  addAirspace?(obstacles: ObstacleData[]): void
  removeAirspace?(obstacles: ObstacleData[]): void
}

interface MirrorRamp { ramp: AnyRamp; target: CoopSiegeRampWire; receivedAt: number; shown: number; key: string; airspace: boolean; docked: boolean }

const SNAP_DISTANCE = 4

/** Guest-side owner of the mirrored siege vehicles; created on the first host message. */
export class CoopSiegeMirror {
  private readonly entries = new Map<string, MirrorRamp>()
  private docksConfigured = false
  private time = 0

  constructor(private readonly world: CoopSiegeWorld) {}

  get ramps(): AnyRamp[] { return [...this.entries.values()].map(entry => entry.ramp) }

  apply(wire: CoopSiegeWire): void {
    if (!this.docksConfigured && wire.ramps.length && this.world.configureDocks) {
      this.docksConfigured = true
      try { this.world.configureDocks(wire.ramps) } catch (error) { console.warn('[coop] siege dock passages', error) }
    }
    for (const target of wire.ramps) {
      const id = target.assignment.id
      let entry = this.entries.get(id)
      if (!entry) {
        let ramp: AnyRamp
        try { ramp = this.world.createRamp(target.assignment, coopSiegePlacement(target), target.faction, this.world.obstacles) }
        catch (error) { console.warn('[coop] could not mirror siege vehicle', error); continue }
        this.world.addAirspace?.(ramp.obstacles)
        entry = { ramp, target, receivedAt: this.time, shown: target.distance, key: '', airspace: true, docked: false }
        this.entries.set(id, entry)
      }
      entry.target = target
      entry.receivedAt = this.time
      const docked = target.state === 'DOCKED'
      if (docked !== entry.docked) {
        entry.docked = docked
        try { this.world.setDockOpen?.(target, docked) } catch (error) { console.warn('[coop] siege dock passage', error) }
      }
    }
    for (const gate of wire.gates) {
      const local = this.world.gates.get(gate.id)
      if (!local) continue
      if (gate.state === 'destroyed') { if (local.state !== 'destroyed') local.destroy(); continue }
      if (gate.hp < local.damageable.currentHp) local.damageable.takeDamage(local.damageable.currentHp - gate.hp)
      if (gate.state === 'open') local.open(); else local.close()
    }
    this.present(0)
  }

  /** Per frame: extrapolate pushing vehicles between the host's messages. */
  update(dt: number): void {
    this.time += dt
    this.present(dt)
  }

  private present(dt: number): void {
    const k = 1 - Math.exp(-Math.max(0, dt) * 8)
    for (const entry of this.entries.values()) {
      const { target, ramp } = entry
      const age = this.time - entry.receivedAt
      const predicted = Math.min(ramp.controller.travelDistance, target.distance + (target.state === 'PUSHING' ? target.speed * age : 0))
      entry.shown = Math.abs(predicted - entry.shown) > SNAP_DISTANCE || entry.key === '' ? predicted : entry.shown + (predicted - entry.shown) * k
      const docking = target.state === 'DOCKING' ? Math.min(1, target.dockingProgress + age / SIEGE_RAMP.dockSeconds) : target.dockingProgress
      const key = `${target.state}|${entry.shown.toFixed(3)}|${docking.toFixed(3)}|${target.hp}`
      if (key === entry.key) continue
      entry.key = key
      ramp.mirror({ state: target.state, distance: entry.shown, dockingProgress: docking, hp: target.hp })
      if (entry.airspace && ramp.damageable.destroyed) { this.world.removeAirspace?.(ramp.obstacles); entry.airspace = false }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.airspace) this.world.removeAirspace?.(entry.ramp.obstacles)
      if (entry.docked) try { this.world.setDockOpen?.(entry.target, false) } catch (error) { console.warn('[coop] siege dock passage', error) }
      entry.ramp.dispose()
    }
    this.entries.clear()
  }
}
