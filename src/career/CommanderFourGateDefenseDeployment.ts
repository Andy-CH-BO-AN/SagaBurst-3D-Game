import * as THREE from 'three'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { siegeDefensePlans } from './TownDefenseRoster'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import type { TownSiegeSectorRoster } from './TownFourGateSiege'
import { TOWN_CITY, TOWN_GATES, TOWN_GARRISON_EAGLE_SITES, TOWN_PRIVATE_EAGLE_SITES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { townRampartHeight, type TownRampartLayout } from '../town/TownRamparts'
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

function wallStations(gateId: TownGateId, role: 'melee' | 'spear' | 'ranged', layout: TownRampartLayout,
  obstacles: readonly ObstacleData[], mounted: boolean): Station[] {
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  const outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  // Clockwise wall surfaces have their exterior on this positive lateral side.
  const radius = mounted ? MOUNT_RADIUS : FOOT_RADIUS
  // A horse needs clearance from the rail, even when its native rider is infantry.
  const lateral = mounted ? role === 'spear' ? -2.8 : role === 'ranged' ? 2.9 : 0
    : role === 'spear' ? -2.2 : role === 'ranged' ? 3.8 : 2.9
  const supportHeight = (x: number, z: number): number | null => {
    if (!mounted) return townRampartHeight(layout, x, z)
    for (const deck of layout.decks) if (deck.surface.mounted) {
      const height = getWalkRampHeight(deck.surface, x, z)
      if (height !== null) return height
    }
    return null
  }
  const stations: Station[] = []
  for (const { surface } of layout.wallSpans.filter(span => span.gateId === gateId)) {
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
      if (role === 'ranged') {
        const origin = new THREE.Vector3(x, y + (mounted ? 2.6 : 1.6), z)
        const target = origin.clone().addScaledVector(outward, 24)
        target.y = getTerrainHeight(target.x, target.z) + 1.3
        if (findBlockingProjectileObstacleAlongPath(origin, target, obstacles)) continue
      }
      stations.push(station)
    }
  }
  return stations.sort((a, b) => Math.hypot(a.x - gate.x, a.z - gate.z) - Math.hypot(b.x - gate.x, b.z - gate.z)
    || a.x - b.x || a.z - b.z)
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
  return stations.sort((a, b) => Math.hypot(a.x - gate.x, a.z - gate.z) - Math.hypot(b.x - gate.x, b.z - gate.z)
    || a.x - b.x || a.z - b.z)
}

/** Relocates the complete native roster only. It never creates, equips or renames an actor.
 * Supply the full roster, including dead actors, so checkpoint sector identities stay stable.
 * Native Wall/Gate membership is independent of equipment and official squad membership.
 * Live equipment only changes the supported body envelope and firing position.
 * Air riders retain their native eagle owner and are intentionally absent from ground sectors.
 */
export function planCommanderFourGateDefenseDeployment(roster: readonly TownActorSpec[], layout: TownRampartLayout,
  obstacles: readonly ObstacleData[], equipment?: (actor: TownActorSpec) => CommanderFourGateDefenseEquipment): CommanderFourGateDefenseDeployment {
  if (new Set(roster.map(actor => actor.id)).size !== roster.length) throw new Error('Duplicate native Town actor identity')
  const byId = new Map(roster.map(actor => [actor.id, actor]))
  // Acceptance uses canonical authored slots, then intersects with actual residents.
  // Passing extra service residents back through allocation would duplicate the trainer.
  const squads = commanderGateDefenseSlots().map(squad => ({ ...squad, actorIds: squad.actorIds.filter(id => byId.has(id)) }))
  const plans = siegeDefensePlans(roster)
  const nativeCavalryIds = new Set(plans.flatMap(plan => plan.cavalry))
  const gatesByActor = new Map(plans.flatMap(plan => [...plan.infantry, ...plan.cavalry].map(id => [id, plan.gateId] as const)))
  // Opt-in service Commander has no unitKind, but remains part of the native eight squads.
  for (const squad of squads) for (const id of squad.actorIds) {
    const actor = byId.get(id)
    if (actor && !gatesByActor.has(id) && actor.duty !== 'eagle_garrison') {
      gatesByActor.set(id, squad.squadId <= 2 ? 'north' : squad.squadId <= 4 ? 'south' : squad.squadId <= 6 ? 'east' : 'west')
      if (actor.mounted || actor.role === 'ranger') nativeCavalryIds.add(id)
    }
  }
  const stations = new Map<string, Station>(), occupied: OccupiedStation[] = []
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
      let point: Station | undefined
      while (candidates.length) {
        const candidate = candidates[0]
        if (occupied.every(other => Math.abs(candidate.y - other.station.y) > 3.6
          || Math.hypot(candidate.x - other.station.x, candidate.z - other.station.z) >= radius + other.radius + 1.1)) {
          point = candidate
          break
        }
        candidates.shift()
      }
      if (!point) throw new Error(`No legal ${sector.gateId} defense station for ${actor.id}`)
      stations.set(actor.id, point); occupied.push({ station: point, radius })
    }
    // Allocate limited clear firing gaps first; melee and spears use separate depth lanes.
    for (const role of ['ranged', 'melee', 'spear'] as const) {
      const members = wall.filter(({ state }) => (state.ranged ? 'ranged' : state.spear ? 'spear' : 'melee') === role)
      if (!members.length) continue
      // Reserve the larger bodies first, so earlier foot slots cannot strand a horse.
      for (const mounted of [true, false]) {
        const matching = members.filter(({ state }) => state.mounted === mounted)
        if (!matching.length) continue
        const candidates = wallStations(sector.gateId, role, layout, obstacles, mounted)
        for (const { actor } of matching) assign(actor, candidates, mounted ? MOUNT_RADIUS : FOOT_RADIUS)
      }
    }
    if (cavalry.length) {
      const candidates = cavalryStations(sector.gateId, obstacles)
      for (const { actor } of cavalry) assign(actor, candidates, MOUNT_RADIUS)
    }
  }
  return { sectors, stations, squads }
}
