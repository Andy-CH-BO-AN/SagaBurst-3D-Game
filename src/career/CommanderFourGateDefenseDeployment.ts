import * as THREE from 'three'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { COMMANDER_TOWN_GATE_ORDER } from './CommanderTownRoster'
import type { TownSiegeSectorRoster } from './TownFourGateSiege'
import { TOWN_CITY, TOWN_GATES, TOWN_GARRISON_EAGLE_SITES, TOWN_PRIVATE_EAGLE_SITES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { surfaceBox, townRampartHeight, type TownRampartLayout } from '../town/TownRamparts'
import { commanderFourGateGarrisonSlots, commanderFourGateMissionSquads, FOUR_GATE_RESERVE_SQUAD } from './CommanderFourGateDefenseRoster'
import { FOUR_GATE_GROUND_FRONT } from '../town/TownGateBarricades'
import { gatehousePoint } from '../town/TownGatehouse'
import type { TownActorSpec } from '../town/TownRules'
import { eagleLandingFootprint } from '../world/EagleLanding'
import { EAGLE_APPROACH, eagleApproachDistance } from '../world/EagleApproach'
import { findBlockingProjectileObstacleAlongPath, getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../world/Terrain'

interface StationPose { x: number; y: number; z: number; yaw: number }
type GateStation = StationPose & { gateId: TownGateId; kind: 'wall' | 'cavalry' }
type Station = GateStation | (StationPose & { kind: 'reserve' })
export interface CommanderFourGateDefenseEquipment {
  ranged: boolean
  spear?: boolean
}
export interface CommanderFourGateDefenseDeployment {
  sectors: TownSiegeSectorRoster[]
  stations: Map<string, Station>
}

type OccupiedStation = { station: Station; radius: number }
const FOOT_RADIUS = .6

/** Placement-time checks use the same physical volumes and walk surfaces as live NPCs. */
function clearStation(station: Station, radius: number, height: number, obstacles: readonly ObstacleData[]): boolean {
  for (const obstacle of obstacles) {
    if (obstacle.physicalPassable) continue
    const box = obstacle.box
    if (station.x + radius <= box.min.x || station.x - radius >= box.max.x
      || station.z + radius <= box.min.z || station.z - radius >= box.max.z
      || station.y >= box.max.y - .001 || station.y + height <= box.min.y + .001) continue
    if (obstacle.walkSurface) {
      const support = getWalkRampHeight(obstacle.walkSurface, station.x, station.z)
      // As in live foot physics, an adjacent slope's coarse box is not a wall.
      if (support === null || station.y >= support - .001) continue
    }
    return false
  }
  return true
}

function clearOutwardShot(station: Station, outward: THREE.Vector3, obstacles: readonly ObstacleData[], reach = 24): boolean {
  const origin = new THREE.Vector3(station.x, station.y + 1.6, station.z)
  const target = origin.clone().addScaledVector(outward, reach)
  target.y = getTerrainHeight(target.x, target.z) + 1.3
  return !findBlockingProjectileObstacleAlongPath(origin, target, obstacles)
}

/** Gate-local archer posts: first the two windows of each gate tower (|x| 8.3 / 12.3, between them
 * is solid wall), then the gallery between the towers, clear of the centre statue: a parapet rank and
 * a staggered rear rank. Window and rear posts shoot out only at longer range. */
const GATEHOUSE_ARCHER_POSTS = [
  ...[8.3, -8.3, 12.3, -12.3].map(lateral => ({ lateral, local: 2.6, reach: 60 })),
  // 2.35m apart: the station allocator needs at least 2.3m between foot bodies, with float margin.
  ...[1.65, -1.65, 4, -4, 6.35, -6.35].map(lateral => ({ lateral, local: 3.15, reach: 24 })),
  ...[2.825, -2.825, 5.175, -5.175].map(lateral => ({ lateral, local: 1.1, reach: 90 })),
] as const

/** Foot archers' first posts: the gate tower windows, then the gallery between the towers.
 * The same body, support and outward-shot checks as wall posts decide which remain legal. */
function gatehouseArcherStations(gateId: TownGateId, layout: TownRampartLayout, obstacles: readonly ObstacleData[]): GateStation[] {
  const house = layout.gatehouses?.find(house => house.gate.id === gateId)
  if (!house) return []
  const gate = house.gate, outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  const stations: GateStation[] = []
  for (const { lateral, local, reach } of GATEHOUSE_ARCHER_POSTS) {
    const point = gatehousePoint(gate, lateral, local, 0)
    const y = getWalkRampHeight(house.deck, point.x, point.z)
    if (y === null || [[FOOT_RADIUS, 0], [-FOOT_RADIUS, 0], [0, FOOT_RADIUS], [0, -FOOT_RADIUS]].some(([dx, dz]) => {
      const h = getWalkRampHeight(house.deck, point.x + dx, point.z + dz)
      return h === null || Math.abs(h - y) > .4
    })) continue
    const station: GateStation = { gateId, kind: 'wall', x: point.x, y, z: point.z, yaw: gate.yaw }
    if (clearStation(station, FOOT_RADIUS, 2.3, obstacles) && clearOutwardShot(station, outward, obstacles, reach)) stations.push(station)
  }
  return stations
}

type WallRole = 'melee' | 'spear' | 'ranged'

function wallStations(gateId: TownGateId, role: WallRole, layout: TownRampartLayout,
  obstacles: readonly ObstacleData[]): GateStation[] {
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  const outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  // Clockwise wall surfaces have their exterior on this positive lateral side.
  const lateral = role === 'spear' ? -2.2 : role === 'ranged' ? 3.8 : 2.9
  const radius = FOOT_RADIUS
  const stations: GateStation[] = []
  const spans = layout.wallSpans.filter(span => span.gateId === gateId), reach = Math.abs(lateral) + radius
  // Every span band below lies inside this gate-wide band, so it keeps exactly the decks any
  // span can match, in their original order; each span then filters only that shorter list.
  const gateBand = spans.reduce((box, { surface }) => box.union(surfaceBox(surface)), new THREE.Box3()).expandByScalar(reach)
  gateBand.min.y = -Infinity; gateBand.max.y = Infinity
  const gateDecks = layout.decks.filter(deck => gateBand.intersectsBox(deck.box))
  for (const { surface } of spans) {
    // Every sample of this span stays inside this band, so farther decks can never
    // answer. Retaining deck order keeps the first matching surface unchanged.
    const band = surfaceBox(surface).expandByScalar(reach)
    band.min.y = -Infinity; band.max.y = Infinity
    const decks = gateDecks.filter(deck => band.intersectsBox(deck.box))
    const supportHeight = (x: number, z: number) => townRampartHeight({ decks }, x, z)
    // These points fall between the authored crenels, independently of deck subdivision.
    for (const along of [.4, 2.55, 4.65]) {
      if (along > surface.length - .25) continue
      const x = surface.startX + surface.dirX * along + surface.dirZ * lateral
      const z = surface.startZ + surface.dirZ * along - surface.dirX * lateral
      if (Math.hypot(x - gate.x, z - gate.z) < 12
        || layout.corners.some(corner => Math.hypot(x - corner.x, z - corner.z) < 8)) continue
      const y = supportHeight(x, z)
      if (y === null) continue
      // The full body footprint must remain supported, including real slope/landing seams.
      if ([[radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([dx, dz]) => {
        const h = supportHeight(x + dx, z + dz)
        return h === null || Math.abs(h - y) > .4
      })) continue
      const station: GateStation = { gateId, kind: 'wall', x, y, z, yaw: gate.yaw }
      if (!clearStation(station, radius, 2.3, obstacles)) continue
      if (role === 'ranged' && !clearOutwardShot(station, outward, obstacles)) continue
      stations.push(station)
    }
  }
  return nearestGateFirst(stations, gate)
}

function* groundStations(gateId: TownGateId, obstacles: readonly ObstacleData[], role: WallRole): Generator<GateStation> {
  const radius = FOOT_RADIUS
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  // Landing pads have no solid ground collider. Retain the same full wing and
  // approach corridors reserved by Town scenery for native/private eagle duty.
  const eaglePads = [...TOWN_GARRISON_EAGLE_SITES, ...TOWN_PRIVATE_EAGLE_SITES]
    .map(pad => eagleLandingFootprint(pad).union(eagleLandingFootprint({
      x: pad.x - Math.sin(pad.yaw) * eagleApproachDistance(40),
      z: pad.z - Math.cos(pad.yaw) * eagleApproachDistance(40), yaw: pad.yaw,
    })).expandByScalar(radius + EAGLE_APPROACH.trackingMargin))
  const front = FOUR_GATE_GROUND_FRONT
  const firingLanes = role === 'ranged' ? [front - 2, front + 4].flatMap(depth =>
    [-24, -14.5, -8.5, 0, 8.5, 14.5, 24].map(lateral => {
      const p = townGatePoint(gate, lateral, depth)
      return new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z) + 1.4, p.z)
    })) : []
  // Cover the portal with two staggered spear ranks. Use the wider yard for
  // reserves and ranged firing positions, checking the centre of each rank first.
  const spacing = 2.4
  for (let row = 0; row < 14; row++) for (let slot = 0; slot < (role === 'spear' && row < 2 ? 7 - row : 33); slot++) {
    const depth = front + (role === 'spear' ? 0 : role === 'melee' ? 3 * spacing : 4 * spacing) + row * spacing
    const side = slot % 2 === 0 ? 1 : -1
    const lateral = row % 2 === 0 ? side * Math.ceil(slot / 2) * spacing : side * (Math.floor(slot / 2) + .5) * spacing
    const p = townGatePoint(gate, lateral, depth)
    if (p.x - radius <= TOWN_CITY.minX || p.x + radius >= TOWN_CITY.maxX
      || p.z - radius <= TOWN_CITY.minZ || p.z + radius >= TOWN_CITY.maxZ) continue
    if (eaglePads.some(box => p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z)) continue
    const station: GateStation = { gateId, kind: 'cavalry', ...p, y: getTerrainHeight(p.x, p.z) }
    if (!clearStation(station, radius, 2.3, obstacles)) continue
    if (role === 'ranged') {
      const origin = new THREE.Vector3(station.x, station.y + 1.6, station.z)
      if (!firingLanes.some(target => origin.distanceTo(target) <= COMBAT_BALANCE.javelin.footAttackRange
        && !findBlockingProjectileObstacleAlongPath(origin, target, obstacles))) continue
    }
    yield station
  }
}

/** Nearest the gate first, then x, then z; each distance is computed once per station. */
function nearestGateFirst(stations: GateStation[], gate: { x: number; z: number }): GateStation[] {
  return stations.map(station => ({ station, distance: Math.hypot(station.x - gate.x, station.z - gate.z) }))
    .sort((a, b) => a.distance - b.distance || a.station.x - b.station.x || a.station.z - b.station.z)
    .map(({ station }) => station)
}

/** Largest body separation any occupancy check can require: two foot soldiers plus clearance. */
const MAX_STATION_SEPARATION = FOOT_RADIUS * 2 + 1.1
/** Wider than that separation, so occupants outside the 3x3 neighbouring cells can never conflict. */
const OCCUPANCY_CELL = Math.ceil(MAX_STATION_SEPARATION + .1)

class StationOccupancy {
  private readonly cells = new Map<string, OccupiedStation[]>()

  /** Same rule as checking every occupant: a body is clear vertically or by horizontal separation. */
  isClear(candidate: Station, radius: number): boolean {
    const cx = Math.floor(candidate.x / OCCUPANCY_CELL), cz = Math.floor(candidate.z / OCCUPANCY_CELL)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of this.cells.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (!(Math.abs(candidate.y - other.station.y) > 3.6
          || Math.hypot(candidate.x - other.station.x, candidate.z - other.station.z) >= radius + other.radius + 1.1)) return false
      }
    }
    return true
  }

  add(station: Station, radius: number): void {
    const key = `${Math.floor(station.x / OCCUPANCY_CELL)},${Math.floor(station.z / OCCUPANCY_CELL)}`
    const cell = this.cells.get(key)
    if (cell) cell.push({ station, radius })
    else this.cells.set(key, [{ station, radius }])
  }
}

/** Keep the two gate release sectors in lockstep with the accepted command roster. */
export function planCommanderFourGateDefenseDeployment(missionId: string, roster: readonly TownActorSpec[],
  layout: TownRampartLayout, obstacles: readonly ObstacleData[],
  equipment: (actor: TownActorSpec) => CommanderFourGateDefenseEquipment): CommanderFourGateDefenseDeployment {
  const byId = new Map(roster.map(actor => [actor.id, actor]))
  if (byId.size !== roster.length) throw new Error('Duplicate native Town actor identity')
  const squads = commanderFourGateMissionSquads(missionId)
  const added = new Map(commanderFourGateGarrisonSlots(missionId).map(member => [member.actorId, member]))
  const stations = new Map<string, Station>(), occupied = new StationOccupancy()
  const reserve = squads.find(squad => squad.squadId === FOUR_GATE_RESERVE_SQUAD)!
  for (const id of reserve.actorIds) {
    const actor = byId.get(id)
    if (!actor || actor.y === undefined || actor.yaw === undefined) throw new Error('Missing Town Center reserve post: ' + id)
    stations.set(id, { kind: 'reserve', x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw })
  }
  const assign = (id: string, candidates: Iterator<GateStation>, gateId: TownGateId) => {
    for (let candidate = candidates.next(); !candidate.done; candidate = candidates.next()) {
      const station = candidate.value
      if (!occupied.isClear(station, FOOT_RADIUS)) continue
      stations.set(id, station); occupied.add(station, FOOT_RADIUS)
      return
    }
    throw new Error(`No legal ${gateId} defense station for ${id}`)
  }
  const sectors = COMMANDER_TOWN_GATE_ORDER.map((gateId, index): TownSiegeSectorRoster => {
    const wallActorIds = squads[index * 2].actorIds, cavalryActorIds = squads[index * 2 + 1].actorIds
    const gallery = gatehouseArcherStations(gateId, layout, obstacles)
    const ranged = [...gallery, ...wallStations(gateId, 'ranged', layout, obstacles)].values()
    const spears = wallStations(gateId, 'spear', layout, obstacles)
    const melee = wallStations(gateId, 'melee', layout, obstacles)
    const spearPosts = spears.values(), meleePosts = melee.values()
    const wallNative = wallActorIds.filter(id => !added.has(id)).map(id => {
      const actor = byId.get(id)
      if (!actor) throw new Error('Missing wall defender: ' + id)
      return { id, state: equipment(actor) }
    })
    // The native archers take the firing gaps first. Preserve the native wall
    // lanes, then assign reinforcement archers, melee and spearmen.
    for (const { id, state } of wallNative) if (state.ranged) assign(id, ranged, gateId)
    for (const { id, state } of wallNative) if (!state.ranged && !state.spear) assign(id, meleePosts, gateId)
    for (const { id, state } of wallNative) if (!state.ranged && state.spear) assign(id, spearPosts, gateId)
    const extraMelee = [...melee, ...spears].values()
    for (const id of wallActorIds) {
      const member = added.get(id)
      if (member) assign(id, member.role === 'archer' ? ranged : member.role === 'spear' ? spearPosts : extraMelee, gateId)
    }
    for (const role of ['spear', 'ranged', 'melee'] as const) {
      const yard = groundStations(gateId, obstacles, role)
      for (const id of cavalryActorIds) {
        const unit = byId.get(id)
        const assignedRole = unit ? unit.unitKind === 'spearman' ? 'spear' : unit.unitKind : added.get(id)?.role
        if (assignedRole === role) assign(id, yard, gateId)
      }
    }
    if (cavalryActorIds.some(id => !stations.has(id))) throw new Error('Incomplete ground deployment: ' + gateId)
    return { gateId, wallActorIds, cavalryActorIds }
  })
  return { sectors, stations }
}
