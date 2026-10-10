import type { PersonalActorCheckpoint, PersonalActorPosition, PersonalSquadMission } from '../career/CareerPersonalSquadMission'
import type { EaglePad } from '../career/EaglePadReservations'
import type { EagleFlightSnapshot } from '../movement/EagleFlightController'
import { getTerrainHeight } from '../world/Terrain'
import { townEagleRoster, type TownEaglePad } from './TownEagleGarrison'
import type { TownEagleGarrisonState } from './TownEagleGarrisonState'
import { TOWN_LAYOUT_VERSION } from './TownLayout'

type GroundHeight = (x: number, z: number) => number
interface GroundPosition { x: number; y: number; z: number; yaw: number }
export interface PersonalTownMigrationLayout {
  muster: readonly PersonalActorPosition[]
  eaglePads: readonly EaglePad[]
  /** The shared allocator may supply an existing allocation to older checkpoints without an identity. */
  padForMember?: (memberId: string) => EaglePad | undefined
}

// Version 1's three private homes were shared by both town factions. They are
// migration evidence, not live layout candidates or new ownership assignments.
const LEGACY_PRIVATE_EAGLE_PADS: readonly EaglePad[] = [
  { id: 'private-eagle-pad:1', x: -30.686291501015234, z: -31.68629150101524, yaw: 0 },
  { id: 'private-eagle-pad:2', x: -27.217927479819405, z: -49.122934917841434, yaw: 0 },
  { id: 'private-eagle-pad:3', x: -24.221752543372723, z: -69.60702759368145, yaw: 0 },
]

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
function wasAtLegacyPrivateHome(position: PersonalActorPosition, padId: string | undefined): boolean {
  return LEGACY_PRIVATE_EAGLE_PADS.some(home => (!padId || home.id === padId)
    && Math.abs(position.x - home.x) <= 12 && Math.abs(position.z - home.z) <= 7)
}

/** Relocate only resident eagles parked at their old base, once per layout version.
 * Flight, rider fall and casualty snapshots retain their exact positions and state.
 */
export function migrateTownEagleGarrisonLayout(saved: TownEagleGarrisonState | undefined, sceneKey: string,
  pads: readonly TownEaglePad[], terrainHeight: GroundHeight = getTerrainHeight): TownEagleGarrisonState | undefined {
  if (!saved || saved.sceneKey !== sceneKey || (saved.layoutVersion ?? 1) >= TOWN_LAYOUT_VERSION) return saved
  const byPad = new Map(pads.map(pad => [pad.id, pad]))
  const standby = new Map(townEagleRoster({ pads: [...pads] }).map(spec => [spec.id, spec]))
  return { ...saved, layoutVersion: TOWN_LAYOUT_VERSION, pairs: saved.pairs.map(pair => {
    const pad = byPad.get(pair.homePadId)
    if (!pad || pair.hp <= 0 || pair.mount.hp <= 0 || pair.fall?.active
      || pair.mount.flight.phase !== 'grounded' || pair.duty === 'sortie' || pair.duty === 'casualty') return pair
    const point = groundPosition(pad, terrainHeight)
    const spec = standby.get(pair.riderId.replace('enemy-town:', ''))
    const position = pair.mounted ? translatedRider(pair.position, pair.mount.position, point, terrainHeight)
      : pair.duty === 'standby' && spec ? { x: spec.x, y: terrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? pad.yaw }
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
      && (actor.boarding || wasAtLegacyPrivateHome(actor.mount.position, actor.eaglePadId))) {
      const point = groundPosition(pad, terrainHeight)
      next = { ...next, mount: { ...actor.mount, position: point, flight: groundedFlight(actor.mount.flight, pad.yaw) },
        ...(actor.mount.mounted && actor.position ? { position: translatedRider(actor.position, actor.mount.position, point, terrainHeight) } : {}) }
    }
    if (actor.formation && (actor.boarding || saved.state === 'RETURNING')) {
      const target = actor.boarding ? pad : pad && actor.mount?.mounted && actor.mount.hp > 0 ? pad : layout.muster[index]
      if (target) next = { ...next, formation: { ...actor.formation,
        position: { x: target.x, y: terrainHeight(target.x, target.z), z: target.z, yaw: target.yaw }, reached: false } }
    }
    members[id] = next
  }
  return { ...saved, layoutVersion: TOWN_LAYOUT_VERSION, members }
}
