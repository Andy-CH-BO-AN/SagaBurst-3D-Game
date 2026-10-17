import { townStationSpec } from './TownGarrison'
import type { TownActorSpec } from './TownRules'
import type { PersonalActorCheckpoint, PersonalActorPosition, PersonalSquadMission } from '../career/CareerPersonalSquadMission'
import type { EaglePad } from '../career/EaglePadReservations'
import type { EagleFlightSnapshot } from '../movement/EagleFlightController'
import { getTerrainHeight } from '../world/Terrain'
import { townEagleRoster, TOWN_EAGLE_PAIRS, type TownEaglePad } from './TownEagleGarrison'
import type { TownEagleGarrisonState } from './TownEagleGarrisonState'
import { TOWN_LAYOUT_VERSION } from './TownLayout'
import { returnPersonalMissionToHR } from '../career/CareerPersonalSquadMission'

type GroundHeight = (x: number, z: number) => number
interface GroundPosition { x: number; y: number; z: number; yaw: number }
export interface PersonalTownMigrationLayout {
  muster: readonly PersonalActorPosition[]
  eaglePads: readonly EaglePad[]
  /** The shared allocator may supply an existing allocation to older checkpoints without an identity. */
  padForMember?: (memberId: string) => EaglePad | undefined
}

/** Resolve the durable return intent against the actual home's legal muster and allocated pads. */
export function placePersonalMissionAtHR(saved: PersonalSquadMission, layout: PersonalTownMigrationLayout,
  terrainHeight: GroundHeight = getTerrainHeight): PersonalSquadMission {
  if (!saved.returnToHR || saved.sceneKey !== 'town-home') return saved
  const next = returnPersonalMissionToHR(saved)!
  for (const [index, id] of next.memberIds.entries()) {
    const member = next.members[id], slot = layout.muster[index]
    if (!member || !slot) continue
    member.position = { ...slot, y: terrainHeight(slot.x, slot.z) }
    const pad = layout.padForMember?.(id)
    if (pad) member.eaglePadId = pad.id
  }
  // The spawn owner consumes this flag after capturing the parked-mount intent for its jobs.
  next.layoutVersion = TOWN_LAYOUT_VERSION
  return next
}

// Historical private home centres, keyed by the checkpoint's layout version.
// They are migration evidence, not live candidates or ownership assignments.
const LEGACY_PRIVATE_EAGLE_PADS: Readonly<Record<number, readonly EaglePad[]>> = {
  1: [
    { id: 'private-eagle-pad:1', x: -30.686291501015234, z: -31.68629150101524, yaw: 0 },
    { id: 'private-eagle-pad:2', x: -27.217927479819405, z: -49.122934917841434, yaw: 0 },
    { id: 'private-eagle-pad:3', x: -24.221752543372723, z: -69.60702759368145, yaw: 0 },
  ],
  2: [-95, -65, -35].map((x, index) => ({ id: `private-eagle-pad:${index + 1}`, x, z: 65, yaw: Math.PI })),
  3: [-90, -60, -30].map((x, index) => ({ id: `private-eagle-pad:${index + 1}`, x, z: 56, yaw: Math.PI })),
}

function groundPosition(pad: EaglePad, terrainHeight: GroundHeight): GroundPosition {
  return { x: pad.x, y: terrainHeight(pad.x, pad.z), z: pad.z, yaw: pad.yaw }
}
function groundedFlight(flight: EagleFlightSnapshot, yaw: number): EagleFlightSnapshot {
  return { ...flight, yaw, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } }
}
function translatedRider(position: GroundPosition, oldMount: PersonalActorPosition, newMount: GroundPosition, terrainHeight: GroundHeight): GroundPosition
function translatedRider(position: PersonalActorPosition, oldMount: PersonalActorPosition, newMount: GroundPosition, terrainHeight: GroundHeight): PersonalActorPosition
function translatedRider(position: PersonalActorPosition, oldMount: PersonalActorPosition, newMount: GroundPosition, terrainHeight: GroundHeight): PersonalActorPosition {
  return { ...position, x: position.x + newMount.x - oldMount.x, z: position.z + newMount.z - oldMount.z,
    ...(position.y !== undefined ? { y: position.y + newMount.y - (oldMount.y ?? terrainHeight(oldMount.x, oldMount.z)) } : {}), yaw: newMount.yaw }
}
function wasAtLegacyPrivateHome(position: PersonalActorPosition, padId: string, version: number): boolean {
  const home = LEGACY_PRIVATE_EAGLE_PADS[version]?.find(home => home.id === padId)
  return !!home && Math.hypot(position.x - home.x, position.z - home.z) <= 1
}

// Authored home centres from layout v2 (a02745e) and v3 (245446e).
// Version 1 used runtime placement search and did not persist the old home:
// its current grounded position alone is not evidence of parking at that home.
const LEGACY_GARRISON_HOMES: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [[-95, -75], [-65, -75], [-35, -75], [-95, -25], [-65, -25]],
  3: [[-85, -63], [-57, -75], [-29, -75], [-85, -18], [-57, -22]],
}
function nearGroundHome(position: GroundPosition, x: number, z: number, terrainHeight: GroundHeight): boolean {
  return Math.hypot(position.x - x, position.z - z) <= 1
    && Math.abs(position.y - terrainHeight(x, z)) <= 1
}

/** Relocate only resident eagles parked at their old base, once per layout version.
 * Flight, rider fall and casualty snapshots retain their exact positions and state.
 */
export function migrateTownEagleGarrisonLayout(saved: TownEagleGarrisonState | undefined, sceneKey: string,
  pads: readonly TownEaglePad[], terrainHeight: GroundHeight = getTerrainHeight): TownEagleGarrisonState | undefined {
  if (!saved || saved.sceneKey !== sceneKey || (saved.layoutVersion ?? 1) >= TOWN_LAYOUT_VERSION) return saved
  const byPad = new Map(pads.map(pad => [pad.id, pad]))
  const oldHomes = LEGACY_GARRISON_HOMES[saved.layoutVersion ?? 1]
  const standby = new Map(townEagleRoster({ pads: [...pads] }).map(spec => [spec.id, spec]))
  return { ...saved, layoutVersion: TOWN_LAYOUT_VERSION, pairs: saved.pairs.map(pair => {
    const pad = byPad.get(pair.homePadId)
    if (!pad || pair.hp <= 0 || pair.mount.hp <= 0 || pair.fall?.active
      || pair.mount.flight.phase !== 'grounded' || pair.duty === 'sortie' || pair.duty === 'casualty') return pair
    const oldHome = oldHomes?.[TOWN_EAGLE_PAIRS.findIndex(home => home.homePadId === pair.homePadId)]
    if (!oldHome || !nearGroundHome(pair.mount.position, oldHome[0], oldHome[1], terrainHeight)) return pair
    const point = groundPosition(pad, terrainHeight)
    const spec = standby.get(pair.riderId.replace('enemy-town:', ''))
    const position = pair.mounted ? translatedRider(pair.position, pair.mount.position, point, terrainHeight)
      : pair.duty === 'standby' && spec && nearGroundHome(pair.position, oldHome[0] + 4, oldHome[1], terrainHeight) ? { x: spec.x, y: terrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? pad.yaw }
        : pair.position
    return { ...pair, position,
      mount: { ...pair.mount, position: point, flight: groundedFlight(pair.mount.flight, pad.yaw) } }
  }) }
}

/** Rebase home destinations without moving soldiers still walking or flying.
 * A grounded private eagle away from the old base remains at its saved location.
 */
export function migratePersonalTownLayout(saved: PersonalSquadMission | undefined, sceneKey: string,
  layout: PersonalTownMigrationLayout, terrainHeight: GroundHeight = getTerrainHeight): PersonalSquadMission | undefined {
  if (!saved || saved.sceneKey !== sceneKey || (saved.layoutVersion ?? 1) >= TOWN_LAYOUT_VERSION) return saved
  const byPad = new Map(layout.eaglePads.map(pad => [pad.id, pad]))
  const members = { ...saved.members }
  for (const [index, id] of saved.memberIds.entries()) {
    const actor = saved.members[id]
    if (!actor || actor.status === 'dead' || actor.status === 'exited' || actor.hp === 0) continue
    const padId = actor.eaglePadId ?? layout.padForMember?.(id)?.id
    const pad = padId ? byPad.get(padId) : undefined
    let next: PersonalActorCheckpoint = pad && !actor.eaglePadId ? { ...actor, eaglePadId: pad.id } : actor
    if (pad && actor.mount?.flight?.phase === 'grounded' && actor.mount.hp > 0 && !actor.fall?.active
      && wasAtLegacyPrivateHome(actor.mount.position, pad.id, saved.layoutVersion ?? 1)) {
      const point = groundPosition(pad, terrainHeight)
      next = { ...next, mount: { ...actor.mount, position: point, flight: groundedFlight(actor.mount.flight, pad.yaw) },
        ...(actor.mount.mounted && actor.position ? { position: translatedRider(actor.position, actor.mount.position, point, terrainHeight) } : {}) }
    }
    if (actor.formation && (actor.boarding || saved.state === 'RETURNING')) {
      // Boarding follows the actual mount, including one legitimately parked away from home.
      const boardingMount = actor.boarding && next.mount && next.mount.hp > 0 && next.mount.flight?.phase === 'grounded'
        ? next.mount.position : undefined
      const target = actor.boarding ? boardingMount ?? pad : pad && actor.mount?.mounted && actor.mount.hp > 0 ? pad : layout.muster[index]
      if (target) next = { ...next, formation: { ...actor.formation,
        position: { x: target.x, y: boardingMount?.y ?? terrainHeight(target.x, target.z), z: target.z, yaw: target.yaw }, reached: false } }
    }
    members[id] = next
  }
  return { ...saved, layoutVersion: TOWN_LAYOUT_VERSION, members }
}

/** The first XYZ checkpoint completes this migration. Active commands retain exact X/Z,
 * and every modern checkpoint (including a deliberately grounded guard) keeps its Y.
 */
export function migrateTownRampartPosition(position: PersonalActorPosition, spec: TownActorSpec | undefined,
  playerCommanded: boolean, mounted: boolean, ranged: boolean): PersonalActorPosition {
  if (position.y !== undefined || playerCommanded || !spec) return position
  const station = townStationSpec(spec, mounted, ranged)
  return station.garrison?.kind === 'rampart'
    ? { ...position, x: station.x, y: station.y, z: station.z } : position
}
