import { grantStarter } from '../../src/town/TownRules'
import { TownEquipment } from '../../src/town/TownEquipment'
import { MemoryStorage } from '../helpers/memoryStorage'
import { describe,expect,it } from 'vitest'
import { addCareerItem, careerItemAllocated, careerItemTotal } from '../../src/career/CareerInventory'
import {
claimCareerBattle,
cloneCareerProfile,
createCareerProfile,
purchaseCareerContent,
resolveCareerRank,
promoteCareer
} from '../../src/career/CareerProfile'
import {
parseCareerProfile, CareerProfileStore, CAREER_STORAGE_KEY
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


describe('Commander melee appointment and save migration', () => {
  it('grants only on formal Commander appointment while preserving selected melee and bow', () => {
    let profile = createCareerProfile('roman')
    profile.totalMerit = 20000
    addCareerItem(profile, 'paladin_sword_t4', 1)
    addCareerItem(profile, 'bow_t5', 1)
    profile.equipment = { ...profile.equipment, ranged: 'bow_t5' }
    // Merit alone, and each lower appointment, must not award Commander equipment.
    expect(careerItemTotal(parseCareerProfile(profile)!, 'sword_t5')).toBe(0)
    for (const rank of ['soldier', 'veteran', 'captain']) {
      profile = promoteCareer(profile)!
      expect(profile.rank).toBe(rank)
      expect(careerItemTotal(profile, 'sword_t5')).toBe(0)
    }
    const equipment = new TownEquipment(() => profile, next => { profile = next; return true })
    expect(equipment.equipWeapon('paladin_sword_t4')).toBe(true)
    expect(profile.meleeSelectionOrigin).toBe('custom')
    const promoted = promoteCareer(profile)!
    expect(profile.rank).toBe('captain')
    expect(profile.commanderMeleeGranted).toBeUndefined()
    expect(promoted.commanderMeleeGranted).toBe(true)
    expect(promoted.equipment).toEqual({ melee: 'paladin_sword_t4', ranged: 'bow_t5' })
    expect(careerItemTotal(promoted, 'sword_t5')).toBe(1)
    expect(careerItemAllocated(promoted, 'sword_t5')).toBe(0)
    expect(careerItemTotal(promoted, 'bow_t5')).toBe(1)
    expect(promoteCareer(promoted)).toBeNull()
  })

  it('auto-equips the Commander reward when the starter was never explicitly replaced', () => {
    let profile = grantStarter(createCareerProfile('roman'), 'gladius_rusty')
    // Automatic combat fallback must not become an explicit player selection.
    profile.equipment = {}
    new TownEquipment(() => profile, next => { profile = next; return true }).prepareForCombat()
    expect(profile.equipment?.melee).toBe('gladius_rusty')
    expect(profile.meleeSelectionOrigin).toBe('starter')
    profile.rank = 'captain'; profile.totalMerit = 20000
    const restored = parseCareerProfile(profile)!
    expect(restored.meleeSelectionOrigin).toBe('starter')
    const promoted = promoteCareer(restored)!
    expect(promoted.equipment?.melee).toBe('sword_t5')
    expect(careerItemTotal(promoted, 'sword_t5')).toBe(1)
    expect(careerItemAllocated(promoted, 'sword_t5')).toBe(1)
    expect(careerItemTotal(promoted, 'gladius_rusty')).toBe(1)
  })

  it('persists a legacy Viking grant once alongside purchased stock and never replaces sold rewards', () => {
    const profile = createCareerProfile('viking')
    profile.rank = 'commander'; profile.totalMerit = 20000
    addCareerItem(profile, 'paladin_mace_t4', 1)
    addCareerItem(profile, 'axe_t5', 2)
    profile.equipment = { melee: 'paladin_mace_t4' }
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, JSON.stringify({ ...profile, commanderMeleeGranted: 'invalid' })]] })
    const store = new CareerProfileStore(storage)
    const loaded = store.loadChecked().profile!
    expect(loaded.equipment?.melee).toBe('paladin_mace_t4')
    expect(careerItemTotal(loaded, 'axe_t5')).toBe(3)
    expect(careerItemTotal(loaded, 'bow_t5')).toBe(0)
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).commanderMeleeGranted).toBe(true)
    expect(store.loadChecked().profile).toEqual(loaded)
    addCareerItem(loaded, 'axe_t5', -3)
    expect(store.save(loaded)).toBe(true)
    expect(careerItemTotal(store.loadChecked().profile!, 'axe_t5')).toBe(0)
  })

  it('withholds a migrated grant on save failure then atomically saves and equips an unselected melee', () => {
    const profile = createCareerProfile('roman')
    profile.rank = 'commander'; profile.totalMerit = 20000
    const original = JSON.stringify(profile)
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, original]], failWrites: true })
    const store = new CareerProfileStore(storage)
    const failed = store.loadChecked()
    expect(failed.profile).toBeNull(); expect(failed.error).toBeTruthy()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(original)
    storage.failWrites = false
    const loaded = store.loadChecked().profile!
    expect(loaded.equipment?.melee).toBe('sword_t5')
    expect(careerItemTotal(loaded, 'sword_t5')).toBe(1)
    expect(careerItemAllocated(loaded, 'sword_t5')).toBe(1)
    expect(store.loadChecked().profile).toEqual(loaded)
  })
})

it('round-trips an isolated retirement checkpoint and rejects a corrupted ending without replacing the save', () => {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'; profile.totalMerit = 20000
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  expect(store.loadChecked().profile?.careerRetirement).toBeUndefined()
  profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42.5, outcome: 'fallen' }
  expect(store.save(profile)).toBe(true)
  const loaded = store.loadChecked().profile!
  expect(loaded.rank).toBe('commander')
  expect(loaded.careerRetirement).toEqual(profile.careerRetirement)
  const copy = cloneCareerProfile(loaded)
  expect(copy.careerRetirement).not.toBe(loaded.careerRetirement)
  copy.careerRetirement!.combatElapsedSeconds = 99
  expect(loaded.careerRetirement!.combatElapsedSeconds).toBe(42.5)
  const saved = storage.getItem(CAREER_STORAGE_KEY)
  delete profile.careerRetirement.outcome
  expect(parseCareerProfile(profile)).toBeNull()
  expect(store.save(profile)).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  const corrupted = JSON.stringify(profile)
  storage.setItem(CAREER_STORAGE_KEY, corrupted)
  const rejected = store.loadChecked()
  expect(rejected.profile).toBeNull()
  expect(rejected.error).toBeTruthy()
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(corrupted)
})
