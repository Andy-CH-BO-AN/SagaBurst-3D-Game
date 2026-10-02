import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { ActiveCareerMission } from './CareerMissionState'

export interface CareerMissionCheckpointReason {
  immediate: boolean
  periodic?: boolean
  force?: boolean
}

const PERIODIC_CHECKPOINT_SECONDS = 5

/** Owns the checkpoint clock and commit acknowledgement, not mission snapshot rules.
 * Failed writes retain the clock; callers supply a fresh snapshot on each attempt.
 */
export class CareerMissionCheckpoint {
  private elapsed = 0

  constructor(
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
  ) {}

  advance(dt: number): void { this.elapsed += Math.max(0, dt) }

  persist(snapshot: () => ActiveCareerMission, reason: CareerMissionCheckpointReason): boolean {
    if (!reason.immediate && !(reason.periodic && (reason.force || this.elapsed >= PERIODIC_CHECKPOINT_SECONDS))) return false
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = snapshot()
    const saved = this.commit(profile)
    if (saved) this.reset()
    return saved
  }

  reset(): void { this.elapsed = 0 }
}
