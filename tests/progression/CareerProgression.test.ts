import { describe,expect,it } from 'vitest'
import { careerItemTotal } from '../../src/career/CareerInventory'
import {
claimCareerBattle,
createCareerProfile,
purchaseCareerContent,
resolveCareerRank
} from '../../src/career/CareerProfile'
import {
parseCareerProfile
} from '../../src/career/CareerProfileStore'
import {
calculateMerit
} from '../../src/career/MeritCalculator'
import type { BattleStatsSnapshot } from '../../src/combat/BattleStatsTracker'

function stats(overrides: Partial<BattleStatsSnapshot['player']> = {}): BattleStatsSnapshot {
  return {
    player: {
      damageDealt: 0,
      damageTaken: 0,
      kills: 0,
      structureDamage: 0,
      structuresDestroyed: 0,
      gateBreaches: 0,
      survived: true,
      ...overrides,
    },
    squads: [],
  }
}

describe('Career merit calculation', () => {
  it('awards victory, kills, actual damage and survival merit', () => {
    expect(calculateMerit(
      stats({ damageDealt: 2280, kills: 2, survived: true }),
      'victory',
      'defense',
    )).toEqual({
      victory: 80,
      kills: 16,
      characterDamage: 44,
      survival: 20,
      structureDamage: 0,
      gateBreaches: 0,
      total: 160,
    })
  })

  it('only awards structure and breach merit to offense battles', () => {
    const battleStats = stats({
      damageDealt: 450,
      kills: 1,
      structureDamage: 380,
      gateBreaches: 2,
      survived: false,
    })
    expect(calculateMerit(battleStats, 'defeat', 'defense').total).toBe(16)
    expect(calculateMerit(battleStats, 'defeat', 'offense').total).toBe(69)
  })
})

describe('Career progression and spending', () => {

  it('adds battle merit to both lifetime and spendable balances', () => {
    const profile = createCareerProfile('roman')
    profile.totalMerit = 290
    profile.availableMerit = 40
    profile.rank = resolveCareerRank(profile.totalMerit)

    const claim = claimCareerBattle(profile, {
      battleId: 'career-battle-001',
      outcome: 'victory',
      role: 'defense',
      stats: stats({ damageDealt: 500, kills: 2, survived: true }),
    })

    expect(claim.meritAwarded).toBe(126)
    expect(claim.profile.totalMerit).toBe(416)
    expect(claim.profile.availableMerit).toBe(166)
    expect(claim.newRank).toBe('recruit') // Merit qualifies; only the captain appoints.
  })

  it('spending merit never reduces lifetime merit or rank', () => {
    const profile = createCareerProfile('viking')
    profile.totalMerit = 5200
    profile.availableMerit = 3200
    profile.rank = resolveCareerRank(profile.totalMerit)

    const purchase = purchaseCareerContent(profile, {
      kind: 'weapon',
      id: 'viking_axe_t3',
      cost: 1200,
      requiredTier: 3,
    })

    expect(purchase.purchased).toBe(true)
    expect(purchase.spentMerit).toBe(1200)
    expect(purchase.profile.totalMerit).toBe(5200)
    expect(purchase.profile.availableMerit).toBe(2000)
    expect(purchase.profile.rank).toBe('captain')
    expect(purchase.profile.ownedWeapons).toEqual(['viking_axe_t3'])
  })

  it('blocks purchases above the unlocked tier', () => {
    const profile = createCareerProfile('roman')
    profile.totalMerit = 900
    profile.availableMerit = 9999
    profile.rank = resolveCareerRank(profile.totalMerit)

    const result = purchaseCareerContent(profile, {
      kind: 'hero',
      id: 'roman-hero-t4',
      cost: 3000,
      requiredTier: 4,
    })

    expect(result.purchased).toBe(false)
    expect(result.reason).toBe('tier-locked')
    expect(result.profile.availableMerit).toBe(9999)
    expect(result.profile.ownedHeroes).toEqual([])
  })

  it('charges for duplicate tradable ownership and blocks insufficient balance', () => {
    const profile = createCareerProfile('viking')
    profile.totalMerit = 5000
    profile.availableMerit = 100
    profile.rank = 'captain'
    profile.ownedMounts.push('horse')

    const duplicate = purchaseCareerContent(profile, {
      kind: 'mount',
      id: 'horse',
      cost: 50,
      requiredTier: 1,
    })
    expect(duplicate.purchased).toBe(true)
    expect(duplicate.profile.availableMerit).toBe(50)
    expect(careerItemTotal(duplicate.profile, 'horse')).toBe(2)

    const expensive = purchaseCareerContent(profile, {
      kind: 'mount',
      id: 'black-cat',
      cost: 500,
      requiredTier: 4,
    })
    expect(expensive.reason).toBe('insufficient-merit')
    expect(expensive.profile.availableMerit).toBe(100)
  })

  it('claims each battle only once', () => {
    const profile = createCareerProfile('viking')
    const first = claimCareerBattle(profile, {
      battleId: 'battle-once',
      outcome: 'victory',
      role: 'defense',
      stats: stats({ damageDealt: 500 }),
    })
    const duplicate = claimCareerBattle(first.profile, {
      battleId: 'battle-once',
      outcome: 'victory',
      role: 'defense',
      stats: stats({ damageDealt: 9999, kills: 99 }),
    })
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile).toEqual(first.profile)
  })
})

describe('Career profile persistence', () => {

  it('migrates the pre-merge single-merit/unlocked field shape safely', () => {
    const parsed = parseCareerProfile({
      version: 1,
      faction: 'roman',
      merit: 950,
      rank: 'commander',
      unlockedWeapons: ['gladius_rusty'],
      unlockedShields: ['scutum_t1'],
      unlockedMounts: ['horse'],
      unlockedHeroes: ['roman-hero-t4'],
      claimedBattleIds: [],
      lifetimeStats: {},
    })

    expect(parsed).toMatchObject({
      faction: 'roman',
      totalMerit: 950,
      availableMerit: 950,
      rank: 'veteran',
      ownedWeapons: ['gladius_rusty'],
      ownedArmors: ['scutum_t1'],
      ownedMounts: ['horse'],
      ownedHeroes: ['roman-hero-t4'],
    })
  })

  it('preserves spendable merit above lifetime earned merit and rejects bad faction/version', () => {
    const parsed = parseCareerProfile({
      version: 1,
      faction: 'viking',
      totalMerit: 1000,
      availableMerit: 9000,
      ownedWeapons: [],
      ownedArmors: [],
      ownedMounts: [],
      ownedHeroes: [],
      lifetimeStats: {},
      claimedBattleIds: [],
    })
    expect(parsed?.availableMerit).toBe(9000)

    expect(parseCareerProfile({ version: 1, faction: 'gaul' })).toBeNull()
    expect(parseCareerProfile({ version: 2, faction: 'roman' })).toBeNull()
  })

  it('restores active mission casualties, phase, route and defense progress', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = {
      id: 'reload-mission', templateId: 'recruit-bandits-01', kind: 'bandit', targetCampId: 0,
      phase: 'RETURNING', targetActorIds: ['target-a', 'target-b'], friendlyActorIds: ['captain', 'melee_infantry-0'],
      deadTargetActorIds: ['target-a', 'unknown'], deadFriendlyActorIds: ['melee_infantry-0'],
      playerStats: { damageDealt: 310, damageTaken: 20, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      routeStage: 7, patrolStage: 2, defenseElapsed: 19.5, acceptedAt: 1,
    }
    const parsed = parseCareerProfile(profile)
    expect(parsed?.activeMission).toMatchObject({
      id: 'reload-mission', phase: 'RETURNING', deadTargetActorIds: ['target-a'],
      deadFriendlyActorIds: ['melee_infantry-0'], playerStats: { damageDealt: 310, kills: 2 }, routeStage: 7, patrolStage: 2, defenseElapsed: 19.5,
    })
  })
})
