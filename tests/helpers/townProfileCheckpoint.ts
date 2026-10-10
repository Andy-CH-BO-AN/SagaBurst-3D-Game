import { TownScene } from '../../src/town/TownScene'
import type { CareerProfile } from '../../src/career/CareerProfile'
import type { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import type { MissionCommitOptions } from '../../src/town/TownMissionSettlement'
import { careerCheckpointPlayer } from './careerCheckpointPlayer'

interface TownProfileCheckpoint {
  profile: CareerProfile
  player: ReturnType<typeof careerCheckpointPlayer>
  outskirts?: TownOutskirtsWarfareController
  commit(profile: CareerProfile, options?: MissionCommitOptions): boolean
  persistPersonalSquad(dt: number, force?: boolean): void
  restoreOutskirtsCheckpoint(): void
}

/** Real Town commit/periodic/restore callers with data-only dependencies: 0 actors, mounts or worlds. */
export function townProfileCheckpoint(profile: CareerProfile, store: CareerProfileStore): TownProfileCheckpoint {
  return Object.assign(Object.create(TownScene.prototype) as TownProfileCheckpoint, {
    profile, store, player: careerCheckpointPlayer(), world: { faction: profile.faction },
    skills: { skillState: profile.skills }, careerSkillSaveTimer: null, careerSaveFailures: 0,
    personalSaveElapsed: 0, personalCriticalState: '',
  })
}
