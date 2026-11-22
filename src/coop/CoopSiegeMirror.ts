/**
 * LAN co-op: the Town four-gate siege vehicles and gates on the guest's screen.
 *
 * The host's `TownFourGateSiege` owns every rule (crew, movement gate, docking, damage). The guest
 * page runs no siege simulation, so the host sends each vehicle's placement and live state, and the
 * guest builds display-only vehicles that follow it (`MobileSiegeRamp.mirror`). Their collision
 * boxes and walk surfaces join the guest's obstacles, so the guest stands on, climbs and is blocked
 * by the same vehicles; docked bridges open the same rampart passages; gates follow the host's
 * open/closed/destroyed state and HP.
 */
import * as THREE from 'three'
import type { CampaignGateState } from '../campaign/CampaignGate'
import type { MobileSiegeRamp } from '../campaign/MobileSiegeRamp'
import type { MobileSiegeRampState } from '../campaign/MobileSiegeRampController'
import { SIEGE_RAMP, type TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import type { TownFourGateSiege, TownSiegeGate } from '../career/TownFourGateSiege'
import type { TownSiegeRampAssignment, TownSiegeRampPlacement } from '../career/TownFourGateSiegePolicy'
import type { TownDockPassages } from '../town/TownDockPassages'
import type { TownGateId } from '../town/TownLayout'
import type { TownSiegeAirspace } from '../town/TownSiegeAirspace'
import type { ObstacleData, WalkRampSurface } from '../world/Terrain'

type Vec = { x: number; y: number; z: number }

export interface CoopSiegeRampWire {
  assignment: TownSiegeRampAssignment
  faction: 'roman' | 'viking'
  placement: {
    side: TownSiegeRampPlacement['side']
    start: Vec; dock: Vec; deckConnection: Vec
    surface: WalkRampSurface
    dirX?: number; dirZ: number
    terrainAnchor?: 'deck'
    passage: { point: Vec; halfWidth: number }
  }
  state: MobileSiegeRampState
  distance: number
  dockingProgress: number
  hp: number
  /** Metres per second while pushing; the guest extrapolates between messages. */
  speed: number
}

export interface CoopSiegeGateWire { id: TownGateId; state: CampaignGateState; hp: number }
export interface CoopSiegeWire { ramps: CoopSiegeRampWire[]; gates: CoopSiegeGateWire[] }

const RAMP_STATES: ReadonlySet<string> = new Set(['DEPLOYING', 'PUSHING', 'DOCKING', 'DOCKED', 'ABANDONED', 'DESTROYED'])
const GATE_STATES: ReadonlySet<string> = new Set(['closed', 'open', 'destroyed'])
const vec = (v: Vec): Vec => ({ x: v.x, y: v.y, z: v.z })
const finite = (...values: unknown[]): boolean => values.every(value => typeof value === 'number' && Number.isFinite(value))
const finiteVec = (v: unknown): v is Vec => Boolean(v) && finite((v as Vec).x, (v as Vec).y, (v as Vec).z)

/** Host: the live siege state, or null before the vehicles exist. */
export function coopSiegeWire(siege: TownFourGateSiege | undefined, gates: ReadonlyMap<TownGateId, TownSiegeGate>): CoopSiegeWire | null {
  if (!siege?.ramps.size) return null
  return {
    ramps: [...siege.ramps.values()].map(ramp => {
      const p = ramp.placement as TownSiegeRampPlacement
      return {
        assignment: structuredClone(ramp.assignment as TownSiegeRampAssignment),
        faction: ramp.faction,
        placement: {
          side: p.side, start: vec(p.start), dock: vec(p.dock), deckConnection: vec(p.deckConnection), surface: { ...p.surface },
          ...(p.dirX !== undefined ? { dirX: p.dirX } : {}), dirZ: p.dirZ, ...(p.terrainAnchor ? { terrainAnchor: p.terrainAnchor } : {}),
          passage: { point: vec(p.passage.point), halfWidth: p.passage.halfWidth },
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
    return Boolean(p && a && typeof a.id === 'string' && typeof a.gateId === 'string' && Array.isArray(a.pusherIds) && Array.isArray(a.assaultIds)
      && (ramp.faction === 'roman' || ramp.faction === 'viking') && RAMP_STATES.has(ramp.state)
      && finite(ramp.distance, ramp.dockingProgress, ramp.hp, ramp.speed, p.dirZ, p.passage?.halfWidth)
      && (p.dirX === undefined || finite(p.dirX))
      && finiteVec(p.start) && finiteVec(p.dock) && finiteVec(p.deckConnection) && finiteVec(p.passage?.point)
      && p.surface && finite(p.surface.startX, p.surface.startZ, p.surface.startY, p.surface.dirX, p.surface.dirZ,
        p.surface.halfWidth, p.surface.length, p.surface.landing, p.surface.topY))
  })
  const gates = wire.gates.filter((gate): gate is CoopSiegeGateWire => typeof gate?.id === 'string' && GATE_STATES.has(gate.state) && finite(gate.hp))
  return { ramps, gates }
}

function placementOf(wire: CoopSiegeRampWire): TownSiegeRampPlacement {
  const p = wire.placement, id = wire.assignment.id
  const v = (point: Vec) => new THREE.Vector3(point.x, point.y, point.z)
  return {
    id, side: p.side, gateId: wire.assignment.gateId, start: v(p.start), dock: v(p.dock), deckConnection: v(p.deckConnection),
    surface: { ...p.surface }, ...(p.dirX !== undefined ? { dirX: p.dirX } : {}), dirZ: p.dirZ,
    ...(p.terrainAnchor ? { terrainAnchor: p.terrainAnchor } : {}),
    passage: { rampId: id, gateId: wire.assignment.gateId, point: v(p.passage.point), halfWidth: p.passage.halfWidth },
    // Only the host plans routes and escorts; the guest's display never reads the clearance volume.
    clearance: new THREE.Box3(),
  }
}

export interface CoopSiegeWorld {
  readonly obstacles: ObstacleData[]
  readonly siegeDockPassages?: Pick<TownDockPassages, 'configure' | 'setOpen' | 'isConfigured'>
  readonly siegeAirspace?: Pick<TownSiegeAirspace, 'add' | 'remove'>
  readonly gates: ReadonlyMap<TownGateId, TownSiegeGate>
}

export type CoopSiegeRampFactory = (assignment: TownSiegeRampAssignment, placement: TownSiegeRampPlacement,
  faction: 'roman' | 'viking', shared: ObstacleData[]) => MobileSiegeRamp<TownSiegeRampId>

interface MirrorRamp { ramp: MobileSiegeRamp<TownSiegeRampId>; target: CoopSiegeRampWire; receivedAt: number; shown: number; key: string; airspace: boolean }

const SNAP_DISTANCE = 4

/** Guest-side owner of the mirrored siege vehicles; created on the first host message. */
export class CoopSiegeMirror {
  private readonly ramps = new Map<TownSiegeRampId, MirrorRamp>()
  private time = 0

  constructor(private readonly world: CoopSiegeWorld, private readonly createRamp: CoopSiegeRampFactory) {}

  get rampCount(): number { return this.ramps.size }

  apply(wire: CoopSiegeWire): void {
    const passages = this.world.siegeDockPassages
    if (passages && !passages.isConfigured && wire.ramps.length === 8) {
      try { passages.configure(wire.ramps.map(ramp => placementOf(ramp).passage)) }
      catch (error) { console.warn('[coop] siege dock passages', error) }
    }
    for (const target of wire.ramps) {
      const id = target.assignment.id
      let entry = this.ramps.get(id)
      if (!entry) {
        let ramp: MobileSiegeRamp<TownSiegeRampId>
        try { ramp = this.createRamp(target.assignment, placementOf(target), target.faction, this.world.obstacles) }
        catch (error) { console.warn('[coop] could not mirror siege vehicle', error); continue }
        this.world.siegeAirspace?.add(ramp.obstacles)
        entry = { ramp, target, receivedAt: this.time, shown: target.distance, key: '', airspace: true }
        this.ramps.set(id, entry)
      }
      entry.target = target
      entry.receivedAt = this.time
      if (passages?.isConfigured) passages.setOpen(id, target.state === 'DOCKED')
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
    for (const entry of this.ramps.values()) {
      const { target, ramp } = entry
      const age = this.time - entry.receivedAt
      const predicted = Math.min(ramp.controller.travelDistance, target.distance + (target.state === 'PUSHING' ? target.speed * age : 0))
      entry.shown = Math.abs(predicted - entry.shown) > SNAP_DISTANCE || dt === 0 && entry.key === '' ? predicted : entry.shown + (predicted - entry.shown) * k
      const docking = target.state === 'DOCKING' ? Math.min(1, target.dockingProgress + age / SIEGE_RAMP.dockSeconds) : target.dockingProgress
      const key = `${target.state}|${entry.shown.toFixed(3)}|${docking.toFixed(3)}|${target.hp}`
      if (key === entry.key) continue
      entry.key = key
      ramp.mirror({ state: target.state, distance: entry.shown, dockingProgress: docking, hp: target.hp })
      if (entry.airspace && ramp.damageable.destroyed) { this.world.siegeAirspace?.remove(ramp.obstacles); entry.airspace = false }
    }
  }

  dispose(): void {
    for (const entry of this.ramps.values()) {
      if (entry.airspace) this.world.siegeAirspace?.remove(entry.ramp.obstacles)
      entry.ramp.dispose()
    }
    this.ramps.clear()
  }
}
