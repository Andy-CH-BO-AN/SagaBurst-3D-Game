import * as THREE from 'three'
import { commanderGateDefenseSlots, commanderTownGateForSquad, type CommanderTownRosterVersion } from './CommanderTownRoster'
import { siegeDefensePlans } from './TownDefenseRoster'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import type { TownSiegeSectorRoster } from './TownFourGateSiege'
import { TOWN_CITY, TOWN_GATES, TOWN_GARRISON_EAGLE_SITES, TOWN_PRIVATE_EAGLE_SITES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { surfaceBox, townRampartHeight, type TownRampartLayout } from '../town/TownRamparts'
import { gatehousePoint } from '../town/TownGatehouse'
import type { TownActorSpec } from '../town/TownRules'
import { eagleLandingFootprint } from '../world/EagleLanding'
import { EAGLE_APPROACH, eagleApproachDistance } from '../world/EagleApproach'
import { findBlockingProjectileObstacleAlongPath, getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../world/Terrain'

export interface CommanderFourGateDefenseStation {
  gateId: TownGateId
  kind: 'wall' | 'cavalry'
  x: number
  y: number
  z: number
  yaw: number
}
export interface CommanderFourGateDefenseEquipment {
  mounted: boolean
  ranged: boolean
  spear?: boolean
  flying?: boolean
}
export interface CommanderFourGateDefenseDeployment {
  sectors: TownSiegeSectorRoster[]
  stations: Map<string, CommanderFourGateDefenseStation>
  /** Existing official eight squads, never a second command system. */
  squads: OfficialCommandSquad[]
}

type Station = CommanderFourGateDefenseStation
type OccupiedStation = { station: Station; radius: number }
const FOOT_RADIUS = .6, MOUNT_RADIUS = 1.25

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

function clearOutwardShot(station: Station, outward: THREE.Vector3, mounted: boolean, obstacles: readonly ObstacleData[], reach = 24): boolean {
  const origin = new THREE.Vector3(station.x, station.y + (mounted ? 2.6 : 1.6), station.z)
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
function gatehouseArcherStations(gateId: TownGateId, layout: TownRampartLayout, obstacles: readonly ObstacleData[]): Station[] {
  const house = layout.gatehouses?.find(house => house.gate.id === gateId)
  if (!house) return []
  const gate = house.gate, outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  const stations: Station[] = []
  for (const { lateral, local, reach } of GATEHOUSE_ARCHER_POSTS) {
    const point = gatehousePoint(gate, lateral, local, 0)
    const y = getWalkRampHeight(house.deck, point.x, point.z)
    if (y === null || [[FOOT_RADIUS, 0], [-FOOT_RADIUS, 0], [0, FOOT_RADIUS], [0, -FOOT_RADIUS]].some(([dx, dz]) => {
      const h = getWalkRampHeight(house.deck, point.x + dx, point.z + dz)
      return h === null || Math.abs(h - y) > .4
    })) continue
    const station: Station = { gateId, kind: 'wall', x: point.x, y, z: point.z, yaw: gate.yaw }
    if (clearStation(station, FOOT_RADIUS, 2.3, obstacles) && clearOutwardShot(station, outward, false, obstacles, reach)) stations.push(station)
  }
  return stations
}

type WallRole = 'melee' | 'spear' | 'ranged'

function wallStations(gateId: TownGateId, role: WallRole, layout: TownRampartLayout,
  obstacles: readonly ObstacleData[], mounted: boolean): Station[] {
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  const outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  // Clockwise wall surfaces have their exterior on this positive lateral side.
  const radius = mounted ? MOUNT_RADIUS : FOOT_RADIUS
  // A horse needs clearance from the rail, even when its native rider is infantry.
  const lateral = mounted ? role === 'spear' ? -2.8 : role === 'ranged' ? 2.9 : 0
    : role === 'spear' ? -2.2 : role === 'ranged' ? 3.8 : 2.9
  const stations: Station[] = []
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
    const supportHeight = (x: number, z: number): number | null => {
      if (!mounted) return townRampartHeight({ decks }, x, z)
      for (const deck of decks) if (deck.surface.mounted) {
        const height = getWalkRampHeight(deck.surface, x, z)
        if (height !== null) return height
      }
      return null
    }
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
      const station: Station = { gateId, kind: 'wall', x, y, z, yaw: gate.yaw }
      if (!clearStation(station, radius, mounted ? 3.6 : 2.3, obstacles)) continue
      if (role === 'ranged' && !clearOutwardShot(station, outward, mounted, obstacles)) continue
      stations.push(station)
    }
  }
  return nearestGateFirst(stations, gate)
}

function cavalryStations(gateId: TownGateId, obstacles: readonly ObstacleData[]): Station[] {
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  const stations: Station[] = []
  // Landing pads have no solid ground collider. Retain the same full wing and
  // approach corridors reserved by Town scenery for native/private eagle duty.
  const eaglePads = [...TOWN_GARRISON_EAGLE_SITES, ...TOWN_PRIVATE_EAGLE_SITES]
    .map(pad => eagleLandingFootprint(pad).union(eagleLandingFootprint({
      x: pad.x - Math.sin(pad.yaw) * eagleApproachDistance(40),
      z: pad.z - Math.cos(pad.yaw) * eagleApproachDistance(40), yaw: pad.yaw,
    })).expandByScalar(MOUNT_RADIUS + EAGLE_APPROACH.trackingMargin))
  // Both sides of the real gate, leaving its central approach free for the charge.
  for (let row = 0; row < 12; row++) for (let column = 0; column < 14; column++) for (const side of [-1, 1]) {
    const p = townGatePoint(gate, side * (10 + column * 4.5), 16 + row * 5.5)
    if (p.x - MOUNT_RADIUS <= TOWN_CITY.minX || p.x + MOUNT_RADIUS >= TOWN_CITY.maxX
      || p.z - MOUNT_RADIUS <= TOWN_CITY.minZ || p.z + MOUNT_RADIUS >= TOWN_CITY.maxZ) continue
    if (eaglePads.some(box => p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z)) continue
    const station: Station = { gateId, kind: 'cavalry', ...p, y: getTerrainHeight(p.x, p.z) }
    if (clearStation(station, MOUNT_RADIUS, 3.6, obstacles)) stations.push(station)
  }
  return nearestGateFirst(stations, gate)
}

/** Nearest the gate first, then x, then z; each distance is computed once per station. */
function nearestGateFirst(stations: Station[], gate: { x: number; z: number }): Station[] {
  return stations.map(station => ({ station, distance: Math.hypot(station.x - gate.x, station.z - gate.z) }))
    .sort((a, b) => a.distance - b.distance || a.station.x - b.station.x || a.station.z - b.station.z)
    .map(({ station }) => station)
}

/** Largest body separation any occupancy check can require: two mounts plus clearance. */
const MAX_STATION_SEPARATION = MOUNT_RADIUS * 2 + 1.1
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

/** Relocates the complete native roster only. It never creates, equips or renames an actor.
 * Supply the full roster, including dead actors, so checkpoint sector identities stay stable.
 * Native Wall/Gate membership is independent of equipment and official squad membership.
 * Live equipment only changes the supported body envelope and firing position.
 * Air riders retain their native eagle owner and are intentionally absent from ground sectors.
 */
export interface CommanderFourGateGarrisonMember { actorId: string; gateId: TownGateId; role: 'archer' | 'infantry' }

export function planCommanderFourGateDefenseDeployment(roster: readonly TownActorSpec[], layout: TownRampartLayout,
  obstacles: readonly ObstacleData[], equipment?: (actor: TownActorSpec) => CommanderFourGateDefenseEquipment, rosterVersion: CommanderTownRosterVersion = 2,
  garrison: readonly CommanderFourGateGarrisonMember[] = []): CommanderFourGateDefenseDeployment {
  if (new Set(roster.map(actor => actor.id)).size !== roster.length) throw new Error('Duplicate native Town actor identity')
  const byId = new Map(roster.map(actor => [actor.id, actor]))
  // Acceptance uses canonical authored slots, then intersects with actual residents.
  // Passing extra service residents back through allocation would duplicate the trainer.
  const squads = commanderGateDefenseSlots(undefined, rosterVersion).map(squad => ({ ...squad, actorIds: squad.actorIds.filter(id => byId.has(id)) }))
  const plans = siegeDefensePlans(roster)
  const nativeCavalryIds = new Set(plans.flatMap(plan => plan.cavalry))
  const gatesByActor = new Map(plans.flatMap(plan => [...plan.infantry, ...plan.cavalry].map(id => [id, plan.gateId] as const)))
  // Opt-in service Commander has no unitKind, but remains part of the native eight squads.
  for (const squad of squads) for (const id of squad.actorIds) {
    const actor = byId.get(id)
    if (actor && actor.duty !== 'eagle_garrison' && (rosterVersion === 2 || !gatesByActor.has(id))) {
      gatesByActor.set(id, commanderTownGateForSquad(squad.squadId))
      if (rosterVersion === 2 ? squad.squadId % 2 === 0 : actor.mounted || actor.role === 'ranger') nativeCavalryIds.add(id)
      else nativeCavalryIds.delete(id)
    }
  }
  const stations = new Map<string, Station>(), occupied = new StationOccupancy()
  // Within one allocation the layout and obstacles are fixed, so each gate/role/body station list is
  // computed once and shared by native lanes and the mission garrison. Every consumer gets its own copy.
  const wallLists = new Map<string, Station[]>(), gatehouseLists = new Map<TownGateId, Station[]>()
  const wallFor = (gateId: TownGateId, role: WallRole, mounted: boolean): Station[] => {
    const key = `${gateId}:${role}:${mounted}`
    let list = wallLists.get(key)
    if (!list) wallLists.set(key, list = wallStations(gateId, role, layout, obstacles, mounted))
    return [...list]
  }
  const gatehouseFor = (gateId: TownGateId): Station[] => {
    let list = gatehouseLists.get(gateId)
    if (!list) gatehouseLists.set(gateId, list = gatehouseArcherStations(gateId, layout, obstacles))
    return [...list]
  }
  // How far each candidate list has been consumed; the rejected prefix is skipped once per list.
  const consumed = new Map<Station[], number>()
  const sectors: TownSiegeSectorRoster[] = TOWN_GATES.map(gate => ({ gateId: gate.id, wallActorIds: [], cavalryActorIds: [] }))
  for (const sector of sectors) {
    const actors = roster.filter(actor => gatesByActor.get(actor.id) === sector.gateId && actor.duty !== 'eagle_garrison')
      .map(actor => ({ actor, state: equipment?.(actor) ?? {
        mounted: actor.mounted || actor.role === 'ranger', ranged: actor.unitKind === 'ranged' || actor.unitKind === 'archer',
        spear: actor.unitKind === 'spearman', flying: false,
      } })).filter(({ state }) => !state.flying)
    const wall = actors.filter(({ actor }) => !nativeCavalryIds.has(actor.id))
    const cavalry = actors.filter(({ actor }) => nativeCavalryIds.has(actor.id))
    sector.wallActorIds = wall.map(({ actor }) => actor.id)
    sector.cavalryActorIds = cavalry.map(({ actor }) => actor.id)
    const assign = (actor: TownActorSpec, candidates: Station[], radius: number) => {
      // Occupancy only grows during this allocation. A rejected candidate can
      // never become legal for the remaining equal-radius members of this group.
      // Discard that prefix once instead of rescanning it for every actor; the
      // first legal candidate and authored placement order stay unchanged.
      let point: Station | undefined, next = consumed.get(candidates) ?? 0
      while (next < candidates.length) {
        const candidate = candidates[next]
        if (occupied.isClear(candidate, radius)) {
          point = candidate
          break
        }
        next++
      }
      consumed.set(candidates, next)
      if (!point) throw new Error(`No legal ${sector.gateId} defense station for ${actor.id}`)
      stations.set(actor.id, point); occupied.add(point, radius)
    }
    // Allocate limited clear firing gaps first; melee and spears use separate depth lanes.
    for (const role of ['ranged', 'melee', 'spear'] as const) {
      const members = wall.filter(({ state }) => (state.ranged ? 'ranged' : state.spear ? 'spear' : 'melee') === role)
      if (!members.length) continue
      // Reserve the larger bodies first, so earlier foot slots cannot strand a horse.
      for (const mounted of [true, false]) {
        const matching = members.filter(({ state }) => state.mounted === mounted)
        if (!matching.length) continue
        const candidates = [...(role === 'ranged' && !mounted ? gatehouseFor(sector.gateId) : []), ...wallFor(sector.gateId, role, mounted)]
        for (const { actor } of matching) assign(actor, candidates, mounted ? MOUNT_RADIUS : FOOT_RADIUS)
      }
    }
    const yard = cavalryStations(sector.gateId, obstacles)
    for (const { actor } of cavalry) assign(actor, yard, MOUNT_RADIUS)
    // Mission garrison after every native post, all on the wall: archers take the next clear
    // firing gaps, infantry the melee lane, then the spear lane. A docked ramp releases them with the sector.
    const members = garrison.filter(member => member.gateId === sector.gateId)
    if (members.length) {
      const ranged = [...gatehouseFor(sector.gateId), ...wallFor(sector.gateId, 'ranged', false)]
      const melee = [...wallFor(sector.gateId, 'melee', false), ...wallFor(sector.gateId, 'spear', false)]
      for (const member of members) assign({ id: member.actorId } as TownActorSpec, member.role === 'archer' ? ranged : melee, FOOT_RADIUS)
      sector.wallActorIds = [...sector.wallActorIds, ...members.map(member => member.actorId)]
    }
  }
  return { sectors, stations, squads }
}
