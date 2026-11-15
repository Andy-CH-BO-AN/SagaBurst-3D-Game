import { describe, expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCareerTutorialDuelMission } from '../../src/career/CareerDuelState'
import { acceptCommanderMission, COMMANDER_DECAPITATION_ID } from '../../src/career/CommanderMissionCatalog'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { TownScene } from '../../src/town/TownScene'
import { careerRankFixture } from '../helpers/careerRankFixture'

/** Real scene readiness and Commander getters, with deployment data only; no scene or actors. */
function readiness(profile: CareerProfile) {
  const deployment = {
    readProfile: () => profile, rosterCommitPending: false,
    startedMissionId: undefined as string | undefined,
  }
  const defense = Object.assign(Object.create(CommanderTownMissionController.prototype) as Pick<CommanderTownMissionController, 'active' | 'ready'>, deployment)
  const town = Object.assign(Object.create(TownScene.prototype) as { readonly deploymentReady: boolean }, {
    profile, mission: { ready: true }, defense, personalSquad: { ready: true },
  })
  return { town, defense }
}

describe('Town gameplay deployment readiness', () => {
  it('runs Town and Captain tutorial travel when the inactive Commander controller has no deployment', () => {
    const profile = createCareerProfile('roman'), { town, defense } = readiness(profile)
    expect(defense.ready).toBe(false)
    expect(town.deploymentReady).toBe(true)
    profile.activeMission = createCareerTutorialDuelMission(profile, 'roman_sword_cavalry', 'captain', 'ranger')!
    expect(profile.activeMission).toBeDefined()
    expect(defense.active).toBeUndefined()
    expect(town.deploymentReady).toBe(true)
  })

  it('holds an active Commander mission until its own roster and personal squad are ready', () => {
    const base = createCareerProfile('roman')
    Object.assign(base, careerRankFixture('roman', 'commander'), { totalMerit: 20_000, availableMerit: 20_000 })
    const profile = acceptCommanderMission(base, COMMANDER_DECAPITATION_ID, 'deployment')!
    const { town, defense } = readiness(profile)
    expect(defense.active?.id).toBe('deployment')
    expect(town.deploymentReady).toBe(false)
    Object.assign(defense, { startedMissionId: 'deployment', rosterCommitPending: true })
    expect(town.deploymentReady).toBe(false)
    Object.assign(defense, { rosterCommitPending: false })
    Object.assign(town, { personalSquad: { ready: false } })
    expect(town.deploymentReady).toBe(false)
    Object.assign(town, { personalSquad: { ready: true } })
    expect(town.deploymentReady).toBe(true)
  })
})
