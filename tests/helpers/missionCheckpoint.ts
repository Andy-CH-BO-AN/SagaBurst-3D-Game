import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import type { CareerProfile } from '../../src/career/CareerProfile'

/** Supplies the real checkpoint module to existing prototype-based controller fixtures. */
export function withMissionCheckpoint<T>(controller: T): T {
  const host = controller as unknown as {
    checkpoint: CareerMissionCheckpoint
    readProfile(): CareerProfile
    commit(profile: CareerProfile): boolean
  }
  host.checkpoint = new CareerMissionCheckpoint(() => host.readProfile(), profile => host.commit(profile))
  return controller
}
