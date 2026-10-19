import { townEagleRoster } from '../town/TownEagleGarrison'
import { getTerrainHeight } from '../world/Terrain'
import type { TownEaglePairState } from '../town/TownEagleGarrisonState'
import type { CareerProfile } from './CareerProfile'
import type { TownCommandSquadState } from './CareerCommandAuthority'
import { stageTownEaglePlayerCommand } from '../town/TownEagleGarrisonController'
import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'

/** Peaceful Town air authority never substitutes for a formal mission grant. */
export interface TownAirCommandSquadState {
  type: 'town-air-command'
  squadId: 8
  townFaction: CharacterFaction
  sceneKey: string
  actorIds: string[]
  commandedActorIds: string[]
  members: Record<string, PersonalActorCheckpoint>
}
export const TOWN_AIR_COMMAND_IDS: readonly string[] = TOWN_EAGLE_PAIRS.map(pair => pair.riderId)

export function parseTownAirCommandSquad(value: unknown): TownAirCommandSquadState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<TownAirCommandSquadState>
  if (raw.type !== 'town-air-command' || raw.squadId !== 8
    || (raw.townFaction !== 'roman' && raw.townFaction !== 'viking') || raw.sceneKey !== `town:${raw.townFaction}`
    || !Array.isArray(raw.actorIds) || raw.actorIds.length > 5
    || raw.actorIds.some(id => !TOWN_AIR_COMMAND_IDS.includes(id)) || new Set(raw.actorIds).size !== raw.actorIds.length
    || !Array.isArray(raw.commandedActorIds) || raw.commandedActorIds.some(id => !raw.actorIds!.includes(id))
    || new Set(raw.commandedActorIds).size !== raw.commandedActorIds.length || !raw.members) return undefined
  const members: TownAirCommandSquadState['members'] = {}
  for (const id of raw.actorIds) {
    const member = parseCommandActorCheckpoint(raw.members[id])
    if (!member) return undefined
    members[id] = member
  }
  return { type: 'town-air-command', squadId: 8, townFaction: raw.townFaction, sceneKey: raw.sceneKey,
    actorIds: TOWN_AIR_COMMAND_IDS.filter(id => raw.actorIds!.includes(id)),
    commandedActorIds: TOWN_AIR_COMMAND_IDS.filter(id => raw.commandedActorIds!.includes(id)), members }
}
export function cloneTownAirCommandSquad(value: TownAirCommandSquadState): TownAirCommandSquadState {
  return { ...value, actorIds: [...value.actorIds], commandedActorIds: [...value.commandedActorIds],
    members: Object.fromEntries(Object.entries(value.members).map(([id, member]) => [id, parseCommandActorCheckpoint(member)!])) }
}

/** One-way retirement, preserving resources and native cooldowns. Old command-slot numbers
 * never become claims on the new western cavalry. Repeated parses are idempotent. */
export function retireNativeTownAirCommand(profile: CareerProfile, previousTown?: TownCommandSquadState): void {
  const air = profile.townAirCommandSquad
  const oldTownClaims = previousTown?.commandRank === 'commander' ? previousTown.commandedActorIds ?? [] : []
  const mission = profile.activeMission
  const missionAir = mission?.officialSquad
  const legacyMissionClaims = missionAir?.squads?.filter(squad => missionAir.commandedSquadIds?.includes(squad.squadId))
    .flatMap(squad => squad.actorIds).filter(id => TOWN_AIR_COMMAND_IDS.includes(id)) ?? []
  const ids = [...new Set([...(air?.commandedActorIds ?? []), ...oldTownClaims, ...legacyMissionClaims])]
    .filter(id => TOWN_AIR_COMMAND_IDS.includes(id))
  let native = profile.townEagleGarrisons?.[profile.faction]
  if (ids.length) {
    // Early command saves can predate the parallel garrison checkpoint. Recover
    // their original resources, rather than spawning fresh HP/ammo at the pads.
    const pairs = [...(native?.pairs ?? [])]
    for (const spec of townEagleRoster()) {
      if (!ids.includes(spec.id) || pairs.some(pair => pair.riderId === spec.id)) continue
      const member = air?.members[spec.id] ?? previousTown?.members?.[spec.id] ?? missionAir?.members?.[spec.id]
      if (!member?.position || !member.mount) continue
      const position = (p: typeof member.position) => ({ ...p, y: p.y ?? getTerrainHeight(p.x, p.z) })
      const pair: TownEaglePairState = { riderId: spec.id, mountId: spec.eagle!.mountId, homePadId: spec.eagle!.homePadId,
        duty: member.hp === 0 || member.mount.hp === 0 ? 'casualty' : member.mount.mounted ? 'sortie' : 'standby',
        hp: member.hp ?? 0, ammo: member.ammo ?? 0, position: position(member.position), mounted: member.mount.mounted,
        refitAllowed: false, ...(member.fall ? { fall: member.fall } : {}),
        mount: { hp: member.mount.hp, position: position(member.mount.position), flight: member.mount.flight ?? {
          phase: 'grounded', yaw: member.mount.position.yaw, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 },
        } } }
      pairs.push(pair)
    }
    if (pairs.length) native = { ...native, version: 1, sceneKey: `town:${profile.faction}`, pairs }
  }
  if (ids.length && native) profile.townEagleGarrisons = { ...profile.townEagleGarrisons,
    [profile.faction]: stageTownEaglePlayerCommand(native, ids, false,
      !profile.activeMission && !profile.activeOutpostMission && profile.townEvent?.state !== 'hostile') }
  if (air) profile.townAirCommandSquad = { ...air, commandedActorIds: [] }
  if (profile.townCommandSquad?.commandedActorIds) profile.townCommandSquad.commandedActorIds =
    profile.townCommandSquad.commandedActorIds.filter(id => !TOWN_AIR_COMMAND_IDS.includes(id))
  // Keep legacy accepted membership/progress, retiring only command intent for native air.
  if (missionAir?.commandedSquadIds) missionAir.commandedSquadIds = missionAir.commandedSquadIds.filter(id =>
    missionAir.squads?.find(squad => squad.squadId === id)?.actorIds.some(actorId => !TOWN_AIR_COMMAND_IDS.includes(actorId)))
}
