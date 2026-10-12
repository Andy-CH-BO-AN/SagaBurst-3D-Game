import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { clonePersonalMission } from './CareerPersonalSquadMission'
import type { CareerProfileStore } from './CareerProfileStore'

export const CAREER_RECOVERY_NOTICE_KEY = 'sagaburst_career_recovery_notice'

export type CareerMissionRecoveryStatus = 'recovered' | 'stale' | 'storage-error'

/** Technical cancellation, never battle settlement: no merit, rank, claims or battle stats change. */
export function prepareFailedCareerMissionReturn(profile: CareerProfile, missionId: string): CareerProfile | null {
  const mission = profile.activeMission?.id === missionId ? profile.activeMission
    : profile.activeOutpostMission?.id === missionId ? profile.activeOutpostMission : undefined
  if (!mission) return null

  const next = cloneCareerProfile(profile)
  if (next.activeMission?.id === missionId) delete next.activeMission
  else if (next.activeOutpostMission?.id === missionId) delete next.activeOutpostMission

  // Preserve the existing Town checkpoint where available. A mission may have
  // advanced its own checkpoint since acceptance; retain wounds/casualties by ID
  // without restoring any actor at an Outpost coordinate on the Town map.
  if (mission.personalSquad) {
    const checkpoint = next.personalSquadRuntime
      ? clonePersonalMission(next.personalSquadRuntime) : clonePersonalMission(mission.personalSquad)
    const members = mission.personalSquad.members
    const known = new Set(checkpoint.memberIds)
    for (const id of mission.personalSquad.memberIds) {
      if (!known.has(id)) continue
      const saved = members[id]
      if (!saved || saved.status === 'exited') continue
      const previous = checkpoint.members[id]
      if (saved.status === 'dead' || saved.hp === 0) {
        checkpoint.members[id] = { ...saved, status: 'dead' }
      } else if (saved.status === 'deployed') {
        // A partially deployed actor returns to reserve, keeping its recorded
        // damage for subsequent HR refit rather than teleporting into Town.
        checkpoint.members[id] = { ...previous, ...saved, status: 'reserve' }
      }
    }
    checkpoint.sceneKey = 'town-home'
    checkpoint.state = 'RESERVE'
    checkpoint.pendingMemberIds = []
    delete checkpoint.playerLastPosition
    next.personalSquadRuntime = checkpoint
  }
  return next
}

/** Re-read the latest save, and mutate only the failed mission ID. Never save a stale snapshot. */
export function recoverFailedCareerMission(store: Pick<CareerProfileStore, 'loadChecked' | 'save'>,
  missionId: string): CareerMissionRecoveryStatus {
  const loaded = store.loadChecked()
  if (!loaded.profile || loaded.error) return 'storage-error'
  const next = prepareFailedCareerMissionReturn(loaded.profile, missionId)
  if (!next) return 'stale'
  return store.save(next) ? 'recovered' : 'storage-error'
}
