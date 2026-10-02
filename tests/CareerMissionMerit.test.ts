import { describe, expect, it } from 'vitest'
import type { PlayerBattleStats } from '../src/combat/BattleStatsTracker'
import { calculateRecruitMissionMerit } from '../src/career/CareerMissionMeritPolicy'
import { RECRUIT_MISSION_CATALOG } from '../src/career/CareerMissionCatalog'
import { createActiveCareerMission, type ActiveCareerMission } from '../src/career/CareerMissionState'
import { claimCareerMission, createCareerProfile } from '../src/career/CareerProfile'
import { claimCareerOutpost } from '../src/career/CareerOutpostMission'
import { calculateMerit } from '../src/career/MeritCalculator'
import { parseCareerProfile } from '../src/career/CareerProfileStore'

function playerStats(damageDealt: number, survived = true): PlayerBattleStats {
  return { damageDealt, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived }
}

const damageCases = [[0, 0], [19, 0], [20, 1], [39, 1], [40, 2], [59, 2], [60, 3]] as const
const missionKinds = ['bandit', 'patrol', 'town-defense', 'enemy-town-assault', 'cavalry-sweep'] as const

describe('Unified mission damage merit', () => {
  describe.each(missionKinds)('%s claims', kind => {
    it.each(damageCases)('awards %s effective damage as %s damage merit', (damage, expectedMerit) => {
      const profile = createCareerProfile('roman')
      const template = RECRUIT_MISSION_CATALOG.find(mission => mission.kind === kind)!
      const targetCampId = kind === 'town-defense' || kind === 'enemy-town-assault' ? -1 : 0
      profile.activeMission = { ...createActiveCareerMission(template.id, targetCampId, 1, 0, 'merit-test'), kind } satisfies ActiveCareerMission
      const claim = claimCareerMission(profile, 'merit-test', 'victory', playerStats(damage))
      expect(claim.profile.activeMission?.result?.merit.damage).toBe(expectedMerit)
      const loaded = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
      expect(loaded.activeMission?.result?.merit.damage).toBe(expectedMerit)
      expect(claimCareerMission(loaded, 'merit-test', 'victory', playerStats(damage)).meritAwarded).toBe(0)
    })
  })

  describe.each(['outpost-defense', 'outpost-relief'] as const)('%s claims', kind => {
    it.each(damageCases)('awards %s effective damage as %s damage merit', (damage, expectedMerit) => {
      const profile = createCareerProfile('roman')
      profile.activeOutpostMission = { id: 'outpost-merit', kind, stageId: 1, acceptedAt: 0 }
      const claim = claimCareerOutpost(profile, 'outpost-merit', 'victory', { player: playerStats(damage), squads: [] })
      expect(claim.meritBreakdown.characterDamage).toBe(expectedMerit)
      expect(claim.profile.outpostBattleRecords?.[0].merit.characterDamage).toBe(expectedMerit)
    })
  })

  it('uses the same 20 damage threshold for mission structures and retains offense bonuses', () => {
    const player = { ...playerStats(40, false), structureDamage: 40, kills: 2, gateBreaches: 1 }
    expect(calculateMerit({ player, squads: [] }, 'victory', 'offense', 'mission')).toEqual({
      victory: 80, kills: 16, characterDamage: 2, survival: 0, structureDamage: 2, gateBreaches: 25, total: 125,
    })
  })

  it('includes the unified structure rate in enemy-town mission claims', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { ...createActiveCareerMission('assault-merit', 0, 0, 0, 'assault-merit'), kind: 'enemy-town-assault' }
    const claim = claimCareerMission(profile, 'assault-merit', 'victory', { ...playerStats(40, false), structureDamage: 40 })
    expect(claim.profile.activeMission?.result?.merit).toEqual({ damage: 4, kills: 0, contribution: 80, total: 84 })
  })

  it('keeps the existing campaign damage rates', () => {
    const player = { ...playerStats(200), structureDamage: 200 }
    expect(calculateMerit({ player, squads: [] }, 'victory', 'offense')).toMatchObject({ characterDamage: 4, structureDamage: 2 })
  })
})

describe('Mission victory merit after player death', () => {
  it.each([20, 40, 150, 200])('awards the same recruit victory contribution for %s damage alive or dead', damage => {
    const alive = calculateRecruitMissionMerit(playerStats(damage), 'victory')
    const dead = calculateRecruitMissionMerit(playerStats(damage, false), 'victory')
    expect(dead).toEqual(alive)
    expect(dead.contribution).toBeGreaterThan(0)
    expect(calculateRecruitMissionMerit(playerStats(damage, false), 'failure').contribution).toBe(0)
  })

  it('preserves spectator zero and kill rewards', () => {
    expect(calculateRecruitMissionMerit(playerStats(0, false), 'victory')).toEqual({ damage: 0, kills: 0, contribution: 0, total: 0 })
    expect(calculateRecruitMissionMerit({ ...playerStats(40, false), kills: 2 }, 'victory')).toEqual({ damage: 2, kills: 12, contribution: 3, total: 17 })
  })
})
