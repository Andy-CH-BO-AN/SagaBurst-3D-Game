import { areOrdinaryTownServicesPeaceful, canStartOrdinaryTownHostility, validateOrdinaryRetirementCommit } from '../../src/career/CareerRetirement'
import { parseCareerRetirementState } from '../../src/career/CareerRetirementState'
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
promoteCareer, type CareerProfile
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
      cost: 900,
      requiredTier: 3,
    })

    expect(purchase.purchased).toBe(true)
    expect(purchase.spentMerit).toBe(900)
    expect(purchase.profile.totalMerit).toBe(5200)
    expect(purchase.profile.availableMerit).toBe(2300)
    expect(purchase.profile.rank).toBe('captain')
    expect(purchase.profile.ownedWeapons).toEqual(['viking_axe_t3'])
  })

  it.each([
    { kind: 'hero', id: 'roman-hero-t4', cost: 3000, requiredTier: 4 },
    { kind: 'mount', id: 'xongkoro', cost: 10000, requiredTier: 4 },
  ] as const)('keeps $id purchase rank-gated despite sufficient merit', request => {
    const profile = createCareerProfile('roman')
    profile.totalMerit = 900
    profile.availableMerit = 20000
    profile.rank = resolveCareerRank(profile.totalMerit)
    const original = structuredClone(profile)
    const result = purchaseCareerContent(profile, request)

    expect(result.purchased).toBe(false)
    expect(result.reason).toBe('tier-locked')
    expect(result.spentMerit).toBe(0)
    expect(result.profile).toEqual(original)
    expect(profile).toEqual(original)
  })

  it('charges for duplicate tradable ownership and blocks insufficient balance', () => {
    const profile = createCareerProfile('viking')
    profile.totalMerit = 5000
    profile.availableMerit = 300
    profile.rank = 'recruit'
    profile.ownedMounts.push('horse')

    const duplicate = purchaseCareerContent(profile, {
      kind: 'mount',
      id: 'horse',
      cost: 200,
      requiredTier: 1,
    })
    expect(duplicate.purchased).toBe(true)
    expect(duplicate.profile.availableMerit).toBe(100)
    expect(careerItemTotal(duplicate.profile, 'horse')).toBe(2)

    const expensive = purchaseCareerContent(profile, {
      kind: 'mount',
      id: 'snow-leopard',
      cost: 9000,
      requiredTier: 5,
    })
    expect(expensive.reason).toBe('insufficient-merit')
    expect(expensive.profile).toEqual(profile)
    expect(profile.availableMerit).toBe(300)
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

function retirementProfile(): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'
  profile.totalMerit = 20000
  profile.commanderMeleeGranted = true
  profile.inventory = { version: 1, quantities: {} }
  profile.equipment = {}
  profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123,
    combatElapsedSeconds: 42.5, outcome: 'fallen' }
  return profile
}

it('round-trips minimal retirement progress and resource snapshots without sharing mutable state', () => {
  const profile = retirementProfile()
  profile.retirementRuntime = {
    player: { position: { x: 1, y: 2, z: -318, yaw: 0.4 }, hp: 17, stamina: 21,
      arrows: 3, shieldImpact: 4, shieldDurability: { shield_t1: 0 }, mounted: true },
    mountState: { activeMountId: 'horse', hp: { horse: 9 }, unavailable: ['corgi'] },
    mount: { position: { x: 1, y: 2, z: -318, yaw: 0.4 }, hp: 9 },
  }
  const original = structuredClone(profile)
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const loaded = store.loadChecked().profile!
  expect(loaded).toEqual(original)
  expect(profile).toEqual(original)
  const copy = cloneCareerProfile(loaded)
  copy.careerRetirement!.combatElapsedSeconds = 99
  copy.retirementRuntime!.player.hp = 90
  copy.retirementRuntime!.player.shieldDurability!.shield_t1 = 90
  copy.retirementRuntime!.mountState!.hp.horse = 90
  copy.retirementRuntime!.mount!.position.x = 90
  expect(loaded).toEqual(original)
})

it('rejects corrupted retirement saves without overwriting persisted bytes', () => {
  const profile = retirementProfile()
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const saved = storage.getItem(CAREER_STORAGE_KEY)
  // Rank normalization must not admit a retirement checkpoint below Commander.
  expect(store.save({ ...profile, totalMerit: 5200 })).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  const invalidRuntime = { ...profile, retirementRuntime: { player: {
    position: { x: 0, y: 0, z: 0, yaw: 0 }, hp: Number.NaN, stamina: 0,
    arrows: 0, shieldImpact: 0, mounted: false,
  } } }
  expect(store.save(invalidRuntime)).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  delete profile.careerRetirement!.outcome
  expect(store.save(profile)).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  const corrupted = JSON.stringify(profile)
  storage.setItem(CAREER_STORAGE_KEY, corrupted)
  const rejected = store.loadChecked()
  expect(rejected.profile).toBeNull()
  expect(rejected.error).toBeTruthy()
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(corrupted)
})

it('preserves retirement ownership while allowing ordinary resource commits', () => {
  const loaded = retirementProfile()
  // Town commits must preserve every retirement-owned field.
  const stale = cloneCareerProfile(loaded)
  delete stale.careerRetirement
  expect(validateOrdinaryRetirementCommit(loaded, stale)).toEqual({ allowed: false, reason: 'retirement-checkpoint-missing' })
  // Every persisted field is owned by retirement, even when the proposed save parses.
  for (const change of [{ version: 2 }, { phase: 'final-stand', outcome: undefined },
    { acceptedAt: 124 }, { combatElapsedSeconds: 43 }, { outcome: 'escaped' }]) {
    const altered = { ...cloneCareerProfile(loaded), careerRetirement: { ...loaded.careerRetirement!, ...change } }
    expect(validateOrdinaryRetirementCommit(loaded, altered as typeof loaded)).toEqual({ allowed: false, reason: 'retirement-checkpoint-changed' })
  }
  expect(canStartOrdinaryTownHostility(createCareerProfile('roman'))).toBe(true)
  expect(areOrdinaryTownServicesPeaceful(createCareerProfile('roman'))).toBe(true)
  expect(areOrdinaryTownServicesPeaceful(createCareerProfile('roman'), true)).toBe(false)
  for (const phase of ['departing', 'mobilizing', 'final-stand', 'completed'] as const) {
    const current: CareerProfile = { ...cloneCareerProfile(loaded), careerRetirement: {
      version: 1, phase, acceptedAt: 123, combatElapsedSeconds: 0,
      ...(phase === 'completed' ? { outcome: 'fallen' as const } : {}),
    } }
    expect(canStartOrdinaryTownHostility(current)).toBe(false)
    // Hints, talk, markers and stale service callbacks share this saved-phase gate.
    expect(current.townEvent).toBeUndefined()
    expect(areOrdinaryTownServicesPeaceful(current)).toBe(phase === 'departing' || phase === 'mobilizing')
    const hostile: CareerProfile = { ...cloneCareerProfile(current), townEvent: { id: 'ordinary-retaliation', state: 'hostile' } }
    expect(areOrdinaryTownServicesPeaceful(hostile)).toBe(false)
    expect(validateOrdinaryRetirementCommit(current, hostile)).toEqual({ allowed: false, reason: 'retirement-town-hostility' })
    // Do not rewrite legacy events or prevent existing casualty persistence.
    expect(validateOrdinaryRetirementCommit(hostile, cloneCareerProfile(hostile))).toEqual({ allowed: true })
    expect(validateOrdinaryRetirementCommit(hostile, { ...hostile, townEvent: { id: 'replacement', state: 'hostile' } }))
      .toEqual({ allowed: false, reason: 'retirement-town-hostility' })
  }
  const receipt = { version: 1 as const, commandRevoked: true as const, refillCompleted: true as const, formationPrepared: true as const }
  const receipted = { ...cloneCareerProfile(loaded), careerRetirement: { ...loaded.careerRetirement!, mobilization: receipt } }
  const equalReceipt = { ...cloneCareerProfile(receipted), careerRetirement: { ...receipted.careerRetirement,
    mobilization: { formationPrepared: true as const, refillCompleted: true as const, commandRevoked: true as const, version: 1 as const } } }
  expect(equalReceipt.careerRetirement.mobilization).not.toBe(receipt)
  expect(validateOrdinaryRetirementCommit(receipted, equalReceipt)).toEqual({ allowed: true })
  expect(validateOrdinaryRetirementCommit(receipted, loaded)).toEqual({ allowed: false, reason: 'retirement-checkpoint-changed' })
  for (const change of [{ version: 2 }, { commandRevoked: false }, { refillCompleted: false }, { formationPrepared: false }]) {
    const altered = { ...receipted, careerRetirement: { ...receipted.careerRetirement, mobilization: { ...receipt, ...change } } }
    expect(validateOrdinaryRetirementCommit(receipted, altered as typeof loaded)).toEqual({ allowed: false, reason: 'retirement-checkpoint-changed' })
  }
  const rider = { actorId: 'player', mountId: 'horse' as const, position: { x: 0, y: 0, z: 0, yaw: 0 },
    mountPosition: { x: 0, y: 0, z: 0, yaw: 0 }, hp: 100, mountHp: 100, stamina: 100, mounted: true, dead: false, checkpoint: 0 }
  const newWork: Partial<typeof loaded>[] = [
    { activeMission: { id: 'new-mission', templateId: 'recruit-bandits-01', targetCampId: 0,
      phase: 'RETURNING', targetActorIds: [], friendlyActorIds: [], acceptedAt: 124 } },
    { activeOutpostMission: { id: 'new-outpost', kind: 'outpost-defense', stageId: 1, acceptedAt: 124 } },
    { activeRace: { version: 1, deployed: false, id: 'new-race', raceId: 'race-1', phase: 'guiding',
      countdownSeconds: 0, elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0,
      player: rider, opponent: { ...rider, actorId: 'opponent' } } },
  ]
  for (const work of newWork) {
    expect(validateOrdinaryRetirementCommit(loaded, { ...cloneCareerProfile(loaded), ...work }))
      .toEqual({ allowed: false, reason: 'retirement-new-work' })
  }
  const ordinary = cloneCareerProfile(loaded)
  ordinary.availableMerit += 1
  expect(validateOrdinaryRetirementCommit(loaded, ordinary)).toEqual({ allowed: true })
  expect(ordinary.careerRetirement).toEqual(loaded.careerRetirement)
  expect(ordinary.careerRetirement).not.toBe(loaded.careerRetirement)
})

it('round-trips a prepared retirement receipt and rejects incomplete or misplaced receipts', () => {
  const receipt = { version: 1 as const, commandRevoked: true as const,
    refillCompleted: true as const, formationPrepared: true as const }
  const progress = { version: 1 as const, phase: 'mobilizing' as const,
    acceptedAt: 123, combatElapsedSeconds: 0, mobilization: receipt }
  const parsed = parseCareerRetirementState(JSON.parse(JSON.stringify(progress)))!
  expect(parsed).toEqual(progress)
  expect(parsed.mobilization).not.toBe(receipt)
  for (const invalid of [null, {}, { ...receipt, version: 2 }, { ...receipt, commandRevoked: false },
    { ...receipt, refillCompleted: false }, { ...receipt, formationPrepared: false }]) {
    expect(parseCareerRetirementState({ ...progress, mobilization: invalid })).toBeNull()
  }
  expect(parseCareerRetirementState({ ...progress, phase: 'departing' })).toBeNull()
})
