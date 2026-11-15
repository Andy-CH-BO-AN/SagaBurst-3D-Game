import type { PersonalActorPosition,PersonalSquadMission } from '../career/CareerPersonalSquadMission'
import { returnPersonalMissionToHR } from '../career/CareerPersonalSquadMission'
import type { EaglePad } from '../career/EaglePadReservations'
import { TOWN_LAYOUT_VERSION } from './TownLayout'

export interface PersonalTownHomeLayout {
  muster: readonly PersonalActorPosition[]
  eaglePads: readonly EaglePad[]
  padForMember?: (memberId: string) => EaglePad | undefined
}

export function placePersonalMissionAtHR(saved: PersonalSquadMission, layout: PersonalTownHomeLayout): PersonalSquadMission {
  if (saved.sceneKey !== 'town-home') return saved
  if (!saved.returnToHR) return saved
  const next = returnPersonalMissionToHR(saved)!
  for (const id of next.memberIds) {
    const pad = layout.padForMember?.(id)
    if (pad) next.members[id].eaglePadId = pad.id
  }
  next.layoutVersion = TOWN_LAYOUT_VERSION
  return next
}
