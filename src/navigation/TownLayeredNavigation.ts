import * as THREE from 'three'
import { TownWatchtowerNavigation } from './TownWatchtowerNavigation'
import type { CommandWatchtowerLayout } from '../town/TownCommandWatchtowerLayout'
import { crossingGateBreach, gateBreachLane, gateBreachProgress, hasClearedGateBreach } from './GateBreachPortal'
import { AvailableBreachEntrances, type BreachEntrance } from './AvailableBreachEntrances'
import { TOWN_CITY, TOWN_GATES, TOWN_GATE_ASSAULT_APPROACH, townGatePoint, type TownGateId } from '../town/TownLayout'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../world/Terrain'
import { GATEHOUSE_SHELL, gatehouseLocal, gatehousePoint, gatehouseSection, TOWN_GATEHOUSE, type TownGatehouse } from '../town/TownGatehouse'
import { townRampartHeight, type TownRamp, type TownRampartLayout } from '../town/TownRamparts'

import type { CampaignGateController } from '../campaign/CampaignGate'

/** Open span between the towers (mounted body radius kept clear) and the rampart point just behind a gallery. */
const GATEHOUSE_PASSAGE = GATEHOUSE_SHELL.inner - 1.2
const GALLERY_EXIT = TOWN_GATEHOUSE.deckRear - 1.6
const SURFACE_CELL = 4
const NO_GATEHOUSES: readonly TownGatehouse[] = []

interface TownMountedMuster {
  interior: { minX: number; maxX: number; minZ: number; maxZ: number }
  exit: THREE.Vector3
  actors: ReadonlySet<string>
}

/** Directional slope lanes keep ascending and descending Town ramp streams separated. */
export function townRampLane(actorId: string | undefined, mounted: boolean, ascending: boolean, halfWidth: number): number {
  if (!actorId) return 0
  // Positive lateral points toward the wall opening; negative toward the interior rail.
  const sign = ascending ? 1 : -1
  if (mounted) return sign * Math.min(1.1, Math.max(0, halfWidth - 1.25))
  const minLane = 0.55
  const maxLane = Math.max(minLane, halfWidth - 0.85)
  let hash = 2166136261
  for (let i = 0; i < actorId.length; i++) hash = Math.imul(hash ^ actorId.charCodeAt(i), 16777619)
  const slot = (hash >>> 0) % 3
  return sign * (minLane + slot * (maxLane - minLane) / 2)
}

/** Prevents crowd separation from reversing forward progress along a rail-bounded Town ramp. */
export function applyTownRampSeparation(moveDir: THREE.Vector3, separation: THREE.Vector3, onTownRamp: boolean): void {
  if (!onTownRamp) {
    moveDir.add(separation).normalize()
    return
  }
  separation.y = 0
  const forwardDot = separation.dot(moveDir)
  if (forwardDot < 0) separation.addScaledVector(moveDir, -forwardDot)
  const len = separation.length()
  if (len > 0.75) separation.multiplyScalar(0.75 / len)
  moveDir.add(separation).normalize()
}

type SurfaceBounds = { minX: number; minZ: number; maxX: number; maxZ: number }
/** getWalkRampHeight's oriented rectangle: along [0, length + landing], lateral ±halfWidth. */
function surfaceBounds(s: { startX: number; startZ: number; dirX: number; dirZ: number; length: number; landing: number; halfWidth: number }): SurfaceBounds {
  const run = s.length + s.landing, ax = s.dirX * run, az = s.dirZ * run, lx = -s.dirZ * s.halfWidth, lz = s.dirX * s.halfWidth
  const xs = [s.startX + lx, s.startX - lx, s.startX + ax + lx, s.startX + ax - lx]
  const zs = [s.startZ + lz, s.startZ - lz, s.startZ + az + lz, s.startZ + az - lz]
  return { minX: Math.min(...xs) - 1e-6, maxX: Math.max(...xs) + 1e-6, minZ: Math.min(...zs) - 1e-6, maxZ: Math.max(...zs) + 1e-6 }
}
function buildSurfaceIndex(decks: TownRampartLayout['decks'], ramps: readonly TownRamp[], houses: readonly TownGatehouse[], counts: string) {
  // gatehouseSection rejects beyond towerOuter + 5 on either axis before any surface test.
  const reach = TOWN_GATEHOUSE.towerOuter + 5
  const items: Array<{ kind: 'decks' | 'ramps' | 'houses'; index: number; bounds: SurfaceBounds }> = [
    ...decks.map((deck, index) => ({ kind: 'decks' as const, index, bounds: surfaceBounds(deck.surface) })),
    ...ramps.map((ramp, index) => ({ kind: 'ramps' as const, index, bounds: surfaceBounds(ramp.surface) })),
    ...houses.map((house, index) => ({ kind: 'houses' as const, index, bounds: { minX: house.gate.x - reach - 1e-6, maxX: house.gate.x + reach + 1e-6, minZ: house.gate.z - reach - 1e-6, maxZ: house.gate.z + reach + 1e-6 } })),
  ]
  const minX = Math.min(0, ...items.map(i => i.bounds.minX)), minZ = Math.min(0, ...items.map(i => i.bounds.minZ))
  const maxX = Math.max(0, ...items.map(i => i.bounds.maxX)), maxZ = Math.max(0, ...items.map(i => i.bounds.maxZ))
  const cols = Math.max(1, Math.ceil((maxX - minX) / SURFACE_CELL) + 1), rows = Math.max(1, Math.ceil((maxZ - minZ) / SURFACE_CELL) + 1)
  const cells: Array<{ decks: number[]; ramps: number[]; houses: number[] } | undefined> = new Array(cols * rows)
  // Items are appended per kind in ascending layout index, preserving first-match order.
  for (const { kind, index, bounds } of items) {
    for (let row = Math.floor((bounds.minZ - minZ) / SURFACE_CELL); row <= Math.floor((bounds.maxZ - minZ) / SURFACE_CELL); row++) {
      for (let col = Math.floor((bounds.minX - minX) / SURFACE_CELL); col <= Math.floor((bounds.maxX - minX) / SURFACE_CELL); col++) {
        const cell = cells[row * cols + col] ??= { decks: [], ramps: [], houses: [] }
        cell[kind].push(index)
      }
    }
  }
  return { decks, ramps, houses, counts, minX, minZ, cols, rows, cells }
}

export interface TownNavigationStep {
  ground: boolean
  blocked?: boolean
  tower?: boolean
  entranceId?: string
}

export interface TownGateApproach {
  id: TownGateId
  approach: THREE.Vector3
  gate: Pick<CampaignGateController, 'state' | 'siegeObstacle'>
}

/** Town layout adapter. Ground approaches still use NavigationWorld's bounded A*.
 * Elevated travel follows a small perimeter graph, never a second navigation grid.
 */
export class TownLayeredNavigation {
  /** Empty and inactive in every existing Town mode. */
  readonly siegeEntrances = new AvailableBreachEntrances()
  siegeActive = false
  private mountedMuster?: TownMountedMuster

  setMountedMuster(interior: TownMountedMuster['interior'], exit: THREE.Vector3, actors: readonly string[]): void {
    this.mountedMuster = { interior, exit, actors: new Set(actors) }
  }

  private resolveMountedMusterExit(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3,
    actorId: string): TownNavigationStep | null {
    const muster = this.mountedMuster
    if (!muster?.actors.has(actorId)) return null
    const { interior, exit } = muster
    const indoors = ({ x, z }: THREE.Vector3) => x >= interior.minX && x <= interior.maxX
      && z >= interior.minZ && z <= interior.maxZ
    const onExitLane = ({ x, z }: THREE.Vector3) => z > interior.maxZ && z < exit.z && Math.abs(x - exit.x) <= 2
    if (indoors(goal) || onExitLane(goal) || current.z >= exit.z - .75) return null
    if (!indoors(current) && !onExitLane(current)) return null
    const inAisle = Math.abs(current.x - exit.x) <= .9
    // Leave a side bay across its row before following the open aisle through the door.
    // The existing ground follower and body collision still own both moves.
    if (inAisle) out.copy(exit)
    else out.set(exit.x, current.y, current.z)
    return { ground: true }
  }
  private readonly gateApproaches = new Map<TownGateId, TownGateApproach>()
  /** Live physical gate state; registration never opens or damages a gate. */
  setSiegeGates(gates: ReadonlyMap<TownGateId, TownGateApproach['gate']>): void {
    this.gateApproaches.clear()
    for (const spec of TOWN_GATES) {
      const gate = gates.get(spec.id)
      if (!gate) continue
      const p = townGatePoint(spec, 0, -TOWN_GATE_ASSAULT_APPROACH)
      this.gateApproaches.set(spec.id, { id: spec.id, gate,
        approach: new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z) })
    }
  }
  /** Only after ordinary human/entrance navigation has failed. Component checks
   * reuse the ground topology; no A* is run for the four candidate approaches. */
  selectClosedGateApproach(current: THREE.Vector3, goal: THREE.Vector3,
    accepts: (obstacle: ObstacleData) => boolean, sector?: TownGateId | null, preferred?: TownGateId): TownGateApproach | null {
    const outside = current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX
      || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ
    const insideGoal = goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX
      && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
    if (!outside || (!insideGoal && !this.isElevated(goal)) || this.isElevated(current) || this.rampAt(current)
      || Math.abs(current.y - getTerrainHeight(current.x, current.z)) > 1.1) return null
    const valid = (entry: TownGateApproach) => (!sector || entry.id === sector) && entry.gate.state === 'closed'
      && accepts(entry.gate.siegeObstacle) && this.connected(current, entry.approach)
    const prior = preferred ? this.gateApproaches.get(preferred) : undefined
    if (prior && valid(prior)) return prior
    let nearest: TownGateApproach | null = null, distance = Infinity
    for (const entry of this.gateApproaches.values()) {
      if (!valid(entry)) continue
      const d = current.distanceToSquared(entry.approach)
      if (d < distance) { nearest = entry; distance = d }
    }
    return nearest
  }
  watchtower: TownWatchtowerNavigation | null = null
  setWatchtower(layout: CommandWatchtowerLayout): void { this.watchtower = new TownWatchtowerNavigation(layout) }
  constructor(readonly layout: TownRampartLayout, private readonly connected: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false) {}
  rampAt(p: THREE.Vector3): TownRamp | undefined {
    const ramps = this.layout.ramps
    for (const index of this.surfaceCandidates(p).ramps) {
      const y = getWalkRampHeight(ramps[index].surface, p.x, p.z)
      if (y !== null && Math.abs(p.y - y) < 1.1) return ramps[index]
    }
    return undefined
  }
  isElevated(p: THREE.Vector3): boolean {
    if (this.gatehouseAt(p)) return true
    // townRampartHeight: the first deck (layout order) whose surface covers x/z.
    const decks = this.layout.decks
    for (const index of this.surfaceCandidates(p).decks) {
      const y = getWalkRampHeight(decks[index].surface, p.x, p.z)
      if (y !== null) return Math.abs(p.y - y) < 1.3
    }
    return false
  }
  /** Static X/Z broad phase over decks, native ramps and gatehouses: each cell lists the
   * layout indices whose complete footprint may cover it, in layout order, so every
   * first-match query returns exactly what a full ordered scan returns. Rebuilt when a
   * layout array is replaced or resized (ramps are registered after construction). */
  private surfaceIndex?: { decks: unknown; ramps: unknown; houses: unknown; counts: string; minX: number; minZ: number; cols: number; rows: number
    cells: Array<{ decks: number[]; ramps: number[]; houses: number[] } | undefined> }
  private static readonly NO_SURFACES = { decks: [] as number[], ramps: [] as number[], houses: [] as number[] }
  private surfaceCandidates(p: { x: number; z: number }): { decks: readonly number[]; ramps: readonly number[]; houses: readonly number[] } {
    const { decks, ramps } = this.layout, houses = this.layout.gatehouses ?? NO_GATEHOUSES
    const counts = `${decks.length}:${ramps.length}:${houses.length}`
    let index = this.surfaceIndex
    if (!index || index.decks !== decks || index.ramps !== ramps || index.houses !== houses || index.counts !== counts) {
      index = this.surfaceIndex = buildSurfaceIndex(decks, ramps, houses, counts)
    }
    const col = Math.floor((p.x - index.minX) / SURFACE_CELL), row = Math.floor((p.z - index.minZ) / SURFACE_CELL)
    if (!(col >= 0 && col < index.cols && row >= 0 && row < index.rows)) return TownLayeredNavigation.NO_SURFACES
    return index.cells[row * index.cols + col] ?? TownLayeredNavigation.NO_SURFACES
  }
  private projection(p: THREE.Vector3): { distance: number; point: THREE.Vector3 } {
    let best = Infinity, distance = 0, offset = 0, point = p.clone()
    for (let i = 0; i < 4; i++) {
      const a = this.layout.corners[i], b = this.layout.corners[(i + 1) % 4], length = this.layout.lengths[i]
      const t = THREE.MathUtils.clamp(((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length ** 2, 0, 1)
      const q = a.clone().lerp(b, t), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2
      if (d < best) { best = d; distance = offset + t * length; point = q }
      offset += length
    }
    point.y = townRampartHeight(this.layout, point.x, point.z) ?? point.y
    return { distance, point }
  }
  private pointAt(distance: number): THREE.Vector3 {
    let d = (distance % this.layout.perimeter + this.layout.perimeter) % this.layout.perimeter
    for (let i = 0; i < 4; i++) {
      if (d <= this.layout.lengths[i]) {
        const p = this.layout.corners[i].clone().lerp(this.layout.corners[(i + 1) % 4], d / this.layout.lengths[i])
        p.y = townRampartHeight(this.layout, p.x, p.z) ?? p.y; return p
      }
      d -= this.layout.lengths[i]
    }
    return this.layout.corners[0].clone()
  }
  private alongRing(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3): void {
    const a = this.projection(current), b = this.projection(goal), perimeter = this.layout.perimeter
    const delta = ((b.distance - a.distance + perimeter * 1.5) % perimeter) - perimeter / 2
    if (Math.abs(delta) < 3) { out.copy(goal); return }
    // First align with the centre aisle before turning a corner.
    if (Math.hypot(a.point.x - current.x, a.point.z - current.z) > 1) { out.copy(a.point); return }
    out.copy(this.pointAt(a.distance + Math.sign(delta) * Math.min(3, Math.abs(delta))))
  }
  private gatehouseAt(p: THREE.Vector3): TownGatehouse | null {
    const houses = this.layout.gatehouses
    if (!houses) return null
    for (const index of this.surfaceCandidates(p).houses) if (gatehouseSection(houses[index], p) !== null) return houses[index]
    return null
  }
  /** The rampart walk runs level into each gallery between the towers. Leave a
   * gallery through that open span, then reuse the existing ring. */
  private galleryThreshold(house: TownGatehouse, p: THREE.Vector3, z: number): THREE.Vector3 {
    const local = gatehouseLocal(house.gate, p)
    return gatehousePoint(house.gate, THREE.MathUtils.clamp(local.x, -GATEHOUSE_PASSAGE, GATEHOUSE_PASSAGE), z, house.floorY)
  }
  private alongElevated(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3): TownNavigationStep {
    const from = this.gatehouseAt(current), to = this.gatehouseAt(goal)
    if (!from && !to) { this.alongRing(current, goal, out); return { ground: false } }
    const near = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z) <= .3
    if (from && from === to) {
      // One open level: gallery corridor, tower rooms and the joining strip.
      const lane = this.galleryThreshold(from, current, TOWN_GATEHOUSE.galleryCenter)
      const crossing = (gatehouseLocal(from.gate, current).z < TOWN_GATEHOUSE.deckBack + .2) !== (gatehouseLocal(from.gate, goal).z < TOWN_GATEHOUSE.deckBack + .2)
      out.copy(crossing && Math.abs(gatehouseLocal(from.gate, goal).x) > GATEHOUSE_PASSAGE && !near(current, lane) ? lane : goal)
    } else if (from) {
      const lane = this.galleryThreshold(from, current, TOWN_GATEHOUSE.galleryCenter), exit = this.galleryThreshold(from, current, GALLERY_EXIT)
      out.copy(Math.abs(gatehouseLocal(from.gate, current).x) > GATEHOUSE_PASSAGE + .2 && !near(current, lane) ? lane : exit)
    } else if (to) {
      const entry = this.galleryThreshold(to, goal, GALLERY_EXIT), local = gatehouseLocal(to.gate, current)
      // Once in the open span behind the gallery, keep heading in; the ring would pull back to its entry point.
      const inSpan = Math.abs(local.x) <= GATEHOUSE_PASSAGE + .3 && local.z >= GALLERY_EXIT - .3 && local.z <= TOWN_GATEHOUSE.deckRear + .3
      if (inSpan || near(current, entry)) out.copy(Math.abs(gatehouseLocal(to.gate, goal).x) > GATEHOUSE_PASSAGE ? this.galleryThreshold(to, goal, TOWN_GATEHOUSE.galleryCenter) : goal)
      else this.alongRing(current, entry, out)
    }
    // NPC Follow/Formation caps movement at precise tower waypoints.
    return { ground: false, tower: true }
  }
  private clampGatehouseFollow(out: THREE.Vector3, leader: THREE.Vector3, spacing: number): boolean {
    const house = this.gatehouseAt(leader)
    if (!house) return false
    // Trail back along the route a leader actually took: tower room → gallery
    // lane (through the room's gallery opening) → open span → rampart walk.
    // Never cut straight across a tower wall.
    const route = [leader.clone()]
    const lane = this.galleryThreshold(house, leader, TOWN_GATEHOUSE.galleryCenter)
    if (Math.abs(gatehouseLocal(house.gate, leader).x) > GATEHOUSE_PASSAGE + .2) route.push(lane)
    route.push(this.galleryThreshold(house, leader, GALLERY_EXIT))
    let remaining = spacing
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], length = Math.hypot(b.x - a.x, b.z - a.z)
      if (remaining <= length) { out.copy(a).lerp(b, length > 0 ? remaining / length : 0); out.y = house.floorY; return true }
      remaining -= length
    }
    const exit = route[route.length - 1], along = this.projection(exit).distance, side = gatehouseLocal(house.gate, leader).x < 0 ? -1 : 1
    const outward = this.projection(gatehousePoint(house.gate, side * 20, GALLERY_EXIT, house.floorY)).distance
    const sign = Math.sign(((outward - along + this.layout.perimeter * 1.5) % this.layout.perimeter) - this.layout.perimeter / 2) || 1
    out.copy(this.pointAt(along + sign * remaining))
    return true
  }
  clampFollow(out: THREE.Vector3, leader: THREE.Vector3, slot: number, mounted: boolean): void {
    const spacing = (slot + 1) * (mounted ? 3.5 : 1.7)
    if (this.watchtower?.clampFollow(out, leader) || this.clampGatehouseFollow(out, leader, spacing)) return
    if (this.isElevated(leader)) { out.copy(this.pointAt(this.projection(leader).distance - spacing)); return }
    const ramp = this.rampAt(leader)
    if (!ramp) return
    const s = ramp.surface, along = (leader.x - s.startX) * s.dirX + (leader.z - s.startZ) * s.dirZ - spacing
    if (along < 0) { out.copy(ramp.entrance).addScaledVector(new THREE.Vector3(s.dirX, 0, s.dirZ), along); return }
    out.set(s.startX + s.dirX * along, s.startY + (s.topY - s.startY) * Math.min(1, along / s.length), s.startZ + s.dirZ * along)
  }
  private nativeRampUsable(ramp: TownRamp, mounted: boolean): boolean {
    return !mounted || Boolean(ramp.surface.mounted && ramp.surface.halfWidth >= 1.6)
  }
  private interiorSiegeExit(current: THREE.Vector3, goal: THREE.Vector3, mounted: boolean,
    preferredId?: string | null, sectorId?: TownGateId | null): BreachEntrance | null {
    if (!this.siegeActive || goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
      || current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ) return null
    const onRamp = this.rampAt(current)
    if (!onRamp && Math.abs(current.y - getTerrainHeight(current.x, current.z)) > 1.1 || this.isElevated(goal) || this.rampAt(goal)) return null
    if (!onRamp && this.connected(current, goal)) return null
    const hasStair = onRamp ? this.nativeRampUsable(onRamp, mounted) : this.layout.ramps.some(r => this.nativeRampUsable(r, mounted) && this.connected(current, r.entrance))
    if (!hasStair) return null
    const valid = (e: BreachEntrance) => this.siegeEntranceUsable(e, mounted, sectorId) && Boolean(e.surface)
      && this.isElevated(e.exit) && this.connected(e.approach, goal)
    const prior = preferredId ? this.siegeEntrances.entries.get(preferredId) : undefined
    if (prior && valid(prior)) return prior
    let selected: BreachEntrance | null = null, cost = Infinity
    for (const e of this.siegeEntrances.entries.values()) {
      if (!valid(e)) continue
      const distance = current.distanceTo(e.exit) + e.approach.distanceTo(goal)
      if (distance < cost) { selected = e; cost = distance }
    }
    return selected
  }
  /** null means ordinary ground travel; ground=true preserves wall/gate topology. */
  resolveMoveTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3, entranceId?: string | null, mounted = false, sectorId?: TownGateId | null, actorId?: string): TownNavigationStep | null {
    const musterExit = mounted && actorId ? this.resolveMountedMusterExit(current, goal, out, actorId) : null
    if (musterExit) return musterExit
    const transfer = this.interiorSiegeExit(current, goal, mounted, entranceId, sectorId)
    if (transfer) {
      const step = this.resolveMoveTarget(current, transfer.exit, out, transfer.id, mounted, sectorId, actorId)
      if (step) step.entranceId = transfer.id
      return step
    }
    const siege = this.resolveSiegeTarget(current, goal, out, entranceId, mounted, sectorId, actorId)
    if (siege) return siege
    const onDeck = this.isElevated(current), onRamp = this.rampAt(current)
    if (!onDeck && !onRamp) {
      const tower = this.watchtower?.resolve(current, goal, out)
      if (tower) return tower
    } else if (this.watchtower && this.watchtower.surfaceAt(goal) >= 0) {
      // Leave the existing rampart through its own stairs before ground A* can
      // approach the tower. Never route straight off a wall toward its entrance.
      goal = this.watchtower.approach
    }
    const toDeck = this.isElevated(goal), toRamp = this.rampAt(goal)
    // Once a descent reaches ground, release the entrance to ordinary A* and
    // friendly avoidance. Recapturing nearby ground movers here traps them in
    // the 0.3m entrance tolerance forever, even when their goal is on ground.
    if (!onDeck && !toDeck && !onRamp && !toRamp) return null
    if (onDeck && toDeck && !onRamp) return this.alongElevated(current, goal, out)
    const ascending = toDeck || Boolean(toRamp)
    const carrier = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
    const interiorTransfer = ascending && !onRamp && Boolean(carrier?.surface && goal.distanceToSquared(carrier.exit) < .01)
    let ramp = onRamp ?? toRamp
    if (!ramp) {
      const p = ascending ? current : goal
      let bestDistSq = Infinity
      for (let i = 0; i < this.layout.ramps.length; i++) {
        const candidate = this.layout.ramps[i]
        if (!this.nativeRampUsable(candidate, mounted) || (interiorTransfer && !this.connected(current, candidate.entrance))) continue
        const distSq = p.distanceToSquared(candidate.entrance)
        if (distSq < bestDistSq) {
          bestDistSq = distSq
          ramp = candidate
        }
      }
    }
    if (!ramp || !this.nativeRampUsable(ramp, mounted)) { out.copy(current); return { ground: true, blocked: true } }
    const s = ramp.surface
    const lane = townRampLane(actorId, mounted, ascending, s.halfWidth)
    const offsetLateral = (base: THREE.Vector3, target: THREE.Vector3, groundY = false) => {
      if (lane === 0) { target.copy(base); return }
      target.set(base.x - s.dirZ * lane, base.y, base.z + s.dirX * lane)
      if (groundY) target.y = getTerrainHeight(target.x, target.z)
    }
    if (onRamp) {
      if (onRamp === toRamp) { out.copy(goal); return { ground: false } }
      const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
      const lateral = (current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX
      if (ascending) {
        // Clear the landing corner rail post before turning onto the bridge.
        const turnAlong = s.length + (mounted ? 2.2 : 1.7)
        if (along >= turnAlong) out.copy(ramp.connection)
        else offsetLateral(ramp.landing, out)
      } else {
        const clearLateral = Math.max(0.25, s.halfWidth - (mounted ? 1.15 : 0.65))
        if (along >= s.length && Math.abs(lateral) > clearLateral) {
          const stayAlong = Math.min(along, s.length + 4)
          out.set(s.startX + s.dirX * stayAlong - s.dirZ * lane, s.topY, s.startZ + s.dirZ * stayAlong + s.dirX * lane)
        } else {
          offsetLateral(ramp.entrance, out, true)
        }
      }
      return { ground: false }
    }
    if (onDeck) {
      const link = this.layout.decks.find(d => d.id === `landing:${ramp.gateId}`)!
      if (getWalkRampHeight(link.surface, current.x, current.z) !== null) out.copy(ramp.landing)
      else return this.alongElevated(current, ramp.connection, out)
      return { ground: false }
    }
    const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
    const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
    if (!(along >= -3.2 && along <= .6 && lateral < s.halfWidth - .5)) { offsetLateral(ramp.entrance, out, true); return { ground: true } }
    out.set(s.startX + s.dirX - s.dirZ * lane, s.startY + (s.topY - s.startY) / s.length, s.startZ + s.dirZ + s.dirX * lane)
    return { ground: false }
  }
  hasClearedSiegeGate(current: THREE.Vector3, entranceId: string | null, mounted: boolean): boolean {
    const entry = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
    return Boolean(this.siegeActive && entry && hasClearedGateBreach(entry, current, mounted))
  }
  private onSiegeSurface(entry: BreachEntrance, p: THREE.Vector3): boolean {
    if (entry.surface) {
      const height = getWalkRampHeight(entry.surface, p.x, p.z)
      if (height !== null && Math.abs(p.y - height) < 1.1) return true
    }
    if (entry.bridgeSurface) {
      const height = getWalkRampHeight(entry.bridgeSurface, p.x, p.z)
      if (height !== null && Math.abs(p.y - height) < 1.1) return true
    }
    return false
  }
  private siegeEntranceUsable(entry: BreachEntrance, mounted: boolean, sectorId?: TownGateId | null): boolean {
    return entry.walkable && (!mounted || entry.mounted
      && (!entry.surface || entry.surface.halfWidth >= 1.6)
      && (!entry.bridgeSurface || entry.bridgeSurface.halfWidth >= 1.6))
      && (!sectorId || entry.gateId === sectorId)
  }
  private resolveSiegeTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3,
    entranceId: string | null | undefined, mounted: boolean, sectorId?: TownGateId | null, actorId?: string): TownNavigationStep | null {
    if (!this.siegeActive || this.rampAt(current)) return null
    const outside = current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ
    const goalInside = goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
    const eligible = (entry: BreachEntrance) => this.siegeEntranceUsable(entry, mounted, sectorId)
    let goalCarrier: BreachEntrance | undefined
    for (const candidate of this.siegeEntrances.entries.values()) if (eligible(candidate) && this.onSiegeSurface(candidate, goal)) { goalCarrier = candidate; break }
    // Interior goals use the native stairs. Exterior ground goals may leave by
    // any live same-sector carrier whose rear approach connects to the goal.
    const descending = !this.isElevated(goal) && !this.rampAt(goal) && !goalInside
    if (this.isElevated(current)) {
      let carrier = goalCarrier
      if (!carrier && descending) {
        const preferred = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
        const valid = (e: BreachEntrance) => eligible(e) && Boolean(e.surface) && this.connected(e.approach, goal)
        if (preferred && valid(preferred)) carrier = preferred
        else {
          let cost = Infinity
          for (const candidate of this.siegeEntrances.entries.values()) {
            if (!valid(candidate)) continue
            const distance = current.distanceTo(candidate.exit) + candidate.approach.distanceTo(goal)
            if (distance < cost) { carrier = candidate; cost = distance }
          }
        }
      }
      if (!carrier) return null
      if (current.distanceTo(carrier.exit) > .8) return this.alongElevated(current, carrier.exit, out)
      else out.copy(carrier.position)
      return { ground: false }
    }
    // A live surface may extend beyond the perimeter, including its full rear slope.
    let aboard: BreachEntrance | undefined
    for (const entry of this.siegeEntrances.entries.values()) {
      if (!eligible(entry)) continue
      if (this.onSiegeSurface(entry, current)) { aboard = entry; break }
    }
    // A preferred assault entrance does not own unrelated exterior pursuit.
    if (!aboard && outside && descending && !goalCarrier) return null
    const preferred = entranceId ? this.siegeEntrances.entries.get(entranceId)
      : sectorId && actorId && (goalInside || this.isElevated(goal))
        ? crossingGateBreach(this.siegeEntrances.entries.values(), current, mounted, sectorId) : undefined
    let entry = aboard ?? (preferred && eligible(preferred) ? preferred : undefined)
    if (!entry && goalCarrier && this.connected(current, goalCarrier.approach)) entry = goalCarrier
    if (!entry && (goalInside || this.isElevated(goal))) {
      entry = this.siegeEntrances.select(current, mounted, null, approach => this.connected(current, approach), undefined, eligible) ?? undefined
    }
    // Centre-inside is not body-clear: retain the preferred portal until the
    // whole mounted/foot footprint has passed the wall plane before chasing laterally.
    const crossingPortal = entry === preferred && entry?.portal && actorId && !hasClearedGateBreach(entry, current, mounted)
    if (!aboard && !outside && !crossingPortal) return null
    if (!entry || !entry.walkable || mounted && !entry.mounted) {
      if (goalInside || this.isElevated(goal) || entranceId) { out.copy(current); return { ground: true, blocked: true } }
      return null
    }
    if (!entry.surface) {
      if (entry.portal && actorId && entry.type === 'gate') {
        const p = gateBreachProgress(entry, current), approach = gateBreachProgress(entry, entry.approach)
        const radius = mounted ? 1.25 : .6
        const lane = gateBreachLane(actorId, mounted, entry.portal.halfWidth)
        // Once admitted into the opening, keep moving through it. Euclidean
        // distance to the old approach must not send a crossing actor backwards.
        const crossing = p.along >= approach.along - 1
          && Math.abs(p.lateral) + radius <= entry.portal.halfWidth
        out.copy(crossing ? entry.exit : entry.approach)
        out.x += -p.dz * lane; out.z += p.dx * lane
        return { ground: true }
      }
      out.copy(current.distanceTo(entry.approach) > 1 ? entry.approach : entry.exit)
      return { ground: true }
    }
    const s = entry.surface
    const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
    const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
    if (!aboard && !(along >= -3 && along <= .6 && lateral < s.halfWidth - .6)) {
      out.copy(entry.approach); return { ground: true }
    }
    if (aboard && goalCarrier === entry) { out.copy(goal); return { ground: false } }
    if (aboard && descending) {
      // Align on the flat deck/bridge before committing to the slope centreline.
      const lateralOffset = (current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX
      if (along > s.length && Math.abs(lateralOffset) > .25) {
        out.set(s.startX + s.dirX * along, s.topY, s.startZ + s.dirZ * along)
      } else out.copy(entry.approach)
      return { ground: false }
    }
    if (aboard && along >= s.length + s.landing - .6) out.copy(entry.exit)
    else {
      const targetAlong = aboard ? s.length + s.landing - .3 : 1
      out.set(s.startX + s.dirX * targetAlong, s.startY + (s.topY - s.startY) * Math.min(1, targetAlong / s.length), s.startZ + s.dirZ * targetAlong)
    }
    return { ground: false }
  }

}
