import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { ActiveCareerMission } from './CareerMissionState'

export interface CareerMissionCheckpointReason {
  immediate: boolean
  periodic?: boolean
  force?: boolean
  manual?: boolean
  /** Supplied only by a complete runtime snapshot, after the frame's combat updates. */
  deathMissionId?: string
}

export interface CareerMissionCheckpointOptions {
  /** When false, mid-mission periodic/immediate auto-saves are skipped; only `force` or `manual` commits. */
  autoSave?: boolean
}

const PERIODIC_CHECKPOINT_SECONDS = 5

/** Owns the checkpoint clock and commit acknowledgement, not mission snapshot rules.
 * Failed writes retain the clock; callers supply a fresh snapshot on each attempt.
 */
export class CareerMissionCheckpoint {
  private elapsed = 0
  private acknowledgedDeathMissionId?: string
  readonly autoSave: boolean

  constructor(
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    options: CareerMissionCheckpointOptions = {},
  ) {
    this.autoSave = options.autoSave ?? true
  }

  advance(dt: number): void { this.elapsed += Math.max(0, dt) }

  persist(snapshot: () => ActiveCareerMission, reason: CareerMissionCheckpointReason): boolean {
    if (!this.autoSave && !reason.manual && !reason.force) return false
    const pendingDeath = reason.deathMissionId !== undefined && reason.deathMissionId !== this.acknowledgedDeathMissionId
    if (!reason.manual && !reason.immediate && !pendingDeath && !(reason.periodic && (reason.force || this.elapsed >= PERIODIC_CHECKPOINT_SECONDS))) return false
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = snapshot()
    const saved = this.commit(profile)
    if (saved) {
      this.elapsed = 0
      if (reason.deathMissionId === profile.activeMission.id && profile.activeMission.playerDead) {
        this.acknowledgedDeathMissionId = reason.deathMissionId
      }
    }
    return saved
  }

  reset(): void { this.elapsed = 0; this.acknowledgedDeathMissionId = undefined }
}
