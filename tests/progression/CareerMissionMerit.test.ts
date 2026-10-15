import { describe,expect,it } from 'vitest'
import { calculateRecruitMissionMerit } from '../../src/career/CareerMissionMeritPolicy'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import { claimCareerMission,createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { calculateMerit } from '../../src/career/MeritCalculator'
import type { PlayerBattleStats } from '../../src/combat/BattleStatsTracker'
import { MemoryStorage } from '../helpers/memoryStorage'

function stats(damageDealt: number, survived = false): PlayerBattleStats {
  return { damageDealt, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived }
}

describe('mission merit ownership', () => {
  it.each([[19, 0], [20, 1]] as const)('awards %s effective damage as %s merit at the shared mission threshold', (damage, expected) => {
    expect(calculateMerit({ player: stats(damage), squads: [] }, 'defeat', 'defense', 'mission').characterDamage).toBe(expected)
  })

  it('saves an enemy-town offense reward once and rejects a second claim after reload', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { ...createActiveCareerMission('assault-merit', 0, 1, 0, 'assault-merit'), kind: 'enemy-town-assault' }
    const result = claimCareerMission(profile, 'assault-merit', 'victory', { ...stats(40), structureDamage: 40 })
    expect(result.profile.activeMission?.result?.merit).toEqual({ damage: 4, kills: 0, contribution: 80, total: 84 })
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(result.profile)).toBe(true)
    expect(claimCareerMission(store.load()!, 'assault-merit', 'victory', stats(999)).meritAwarded).toBe(0)
  })

  it('credits an Outpost victory after player death and prevents a duplicate reward', () => {
    const profile = createCareerProfile('roman')
    profile.activeOutpostMission = { id: 'outpost-merit', kind: 'outpost-defense', stageId: 1, acceptedAt: 0 }
    const battle = { player: stats(40), squads: [] }
    const claim = claimCareerOutpost(profile, 'outpost-merit', 'victory', battle)
    expect(claim.meritBreakdown).toMatchObject({ characterDamage: 2, victory: 80, survival: 0, total: 82 })
    expect(claim.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 1 })
    expect(claimCareerOutpost(claim.profile, 'outpost-merit', 'victory', battle).alreadyClaimed).toBe(true)
  })

  it('preserves recruit victory contribution after death while an uninvolved spectator earns none', () => {
    expect(calculateRecruitMissionMerit(stats(40), 'victory')).toEqual(calculateRecruitMissionMerit(stats(40, true), 'victory'))
    expect(calculateRecruitMissionMerit(stats(0), 'victory')).toEqual({ damage: 0, kills: 0, contribution: 0, total: 0 })
  })
})
