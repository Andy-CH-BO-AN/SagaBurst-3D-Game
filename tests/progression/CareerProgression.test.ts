import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it } from 'vitest'
import { applyCareerClass, careerClassOffer, unlockedCareerClasses } from '../../src/career/CareerElitePromotion'
import { addCareerItem, careerItemAllocated, careerItemTotal } from '../../src/career/CareerInventory'
import { resolveCareerHeroAsset } from '../../src/career/CareerPlayerProfile'
import { claimCareerBattle, cloneCareerProfile, createCareerProfile, promoteCareer, purchaseCareerContent, resolveCareerRank, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { canAppointCareerRank } from '../../src/career/CareerPromotionAuthority'
import { areOrdinaryTownServicesPeaceful, canStartOrdinaryTownHostility, validateOrdinaryRetirementCommit } from '../../src/career/CareerRetirement'

import { applyT4Class, currentT4Class, t4ClassOffer, unlockedT4Classes } from '../../src/career/CareerT4Promotion'
import { claimCareerTutorialReward, commitCareerTutorial, deferCareerTutorial, hasCareerTutorialHorse, recordCareerTutorialOperation, startCareerTutorial } from '../../src/career/CareerTutorial'
import { CAREER_TUTORIAL_OPERATIONS } from '../../src/career/CareerTutorialState'
import { calculateMerit } from '../../src/career/MeritCalculator'
import type { BattleStatsSnapshot } from '../../src/combat/BattleStatsTracker'
import { TownEquipment } from '../../src/town/TownEquipment'
import { grantStarter, settleTown } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

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

describe('T5 雙職業任命', () => {
  const captain = (total: number) => { const p = createCareerProfile('roman'); Object.assign(p, careerRankFixture(p.faction, 'captain')); p.totalMerit = total; p.availableMerit = 777; return p }
  it('驗證 T5 雙職業首次任命門檻、第二職業購買切換與非法紀錄拒絕', () => {
    expect(careerClassOffer(captain(20000), 'byzantine-cataphract')).toMatchObject({ kind: 'merit-locked', shortfall: 10000 })
    const commander = applyCareerClass(captain(20000), 'roman-commander')!
    expect(commander).toMatchObject({ rank: 'commander', eliteClass: null, availableMerit: 777, unlockedCareerClasses: ['roman-commander'] })
    const stale = captain(80000); stale.enlistmentMeritBase = 51000; stale.availableMerit = 100000
    expect(applyCareerClass(stale, 'byzantine-cataphract')).toBeNull()
    const p = captain(30000), next = applyCareerClass(p, 'byzantine-cataphract')!
    expect(next).toMatchObject({ rank: 'commander', eliteClass: 'byzantine-cataphract', availableMerit: 777, totalMerit: 30000, unlockedCareerClasses: ['byzantine-cataphract'] })
    expect(next.ownedWeapons).not.toContain('byzantine_standard_lance_t5'); expect(next.ownedArmors).not.toContain('byzantine_eagle_shield_t5')
    expect(resolveCareerHeroAsset(parseCareerProfile(next)!)).toBe('byzantine-cataphract-t5')
    expect(p.rank).toBe('captain')
    const viking = createCareerProfile('viking'); Object.assign(viking, careerRankFixture(viking.faction, 'captain')); viking.totalMerit = 30000
    expect(careerClassOffer(viking, 'byzantine-cataphract').kind).toBe('unavailable')

    // 第二職業只扣可用軍功並永久解鎖；之後免費切換不重複扣款
    const first = applyCareerClass(captain(20000), 'roman-commander')!
    first.availableMerit = 29999
    expect(careerClassOffer(first, 'byzantine-cataphract')).toMatchObject({ kind: 'insufficient-merit', shortfall: 1 })
    expect(applyCareerClass(first, 'byzantine-cataphract')).toBeNull()
    first.availableMerit = 30500
    const bought = applyCareerClass(first, 'byzantine-cataphract')!
    expect(bought).toMatchObject({ eliteClass: 'byzantine-cataphract', availableMerit: 500, totalMerit: first.totalMerit, enlistmentMeritBase: first.enlistmentMeritBase })
    expect(bought.unlockedCareerClasses).toEqual(['roman-commander', 'byzantine-cataphract'])
    expect(applyCareerClass(bought, 'byzantine-cataphract')).toBeNull() // no repeat purchase
    const back = applyCareerClass(bought, 'roman-commander')!
    expect(back).toMatchObject({ eliteClass: null, availableMerit: 500 })
    expect(back.inventory).toEqual(first.inventory); expect(back.equipment).toEqual(first.equipment); expect(back.commanderMeleeGranted).toBe(true)
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(first)).toBe(true)
    storage.failWrites = true
    expect(store.save(bought)).toBe(false); expect(store.load()).toMatchObject({ availableMerit: 30500, eliteClass: null })
    storage.failWrites = false
    expect(store.save(bought)).toBe(true); expect(store.save(back)).toBe(true)
    expect(store.load()).toMatchObject({ eliteClass: null, availableMerit: 500, unlockedCareerClasses: ['roman-commander', 'byzantine-cataphract'] })
    expect(store.save(first)).toBe(false)

    // Missing current class records and contradictory unlocks are rejected.
    expect(parseCareerProfile({ ...commander, unlockedCareerClasses: undefined })).toBeNull()
    const bad = applyCareerClass(captain(30000), 'byzantine-cataphract')!
    expect(parseCareerProfile({ ...bad, unlockedCareerClasses: ['roman-commander'] })).toBeNull()
    expect(parseCareerProfile({ ...bad, totalMerit: 29999 })).toBeNull()
    expect(parseCareerProfile({ ...bad, totalMerit: 29999, unlockedCareerClasses: ['roman-commander', 'byzantine-cataphract'] })).not.toBeNull()
    expect(parseCareerProfile({ ...bad, faction: 'viking' })).toBeNull()
    expect(parseCareerProfile({ ...bad, ...careerRankFixture((bad).faction, 'captain'), rank: 'captain' })).toBeNull()
  })
})

describe('T4 雙職業任命（聖騎士／百夫長）', () => {
  const veteran = (total: number, faction: 'roman' | 'viking' = 'roman') => { const p = createCareerProfile(faction); Object.assign(p, careerRankFixture(p.faction, 'veteran')); p.totalMerit = total; p.availableMerit = 333; return p }
  it('驗證 T4 雙職業（聖騎士／百夫長）任命門檻、第二職業購買切換與非法紀錄拒絕', () => {
    expect(['paladin', 'centurion'].map(id => t4ClassOffer(veteran(4999), id as 'paladin').kind)).toEqual(['merit-locked', 'merit-locked'])
    expect(t4ClassOffer(veteran(5000), 'paladin').kind).toBe('appoint')
    expect(t4ClassOffer(veteran(6999), 'centurion')).toMatchObject({ kind: 'merit-locked', shortfall: 1 })
    expect(applyT4Class(veteran(6999), 'centurion')).toBeNull()
    const stale = veteran(20000); stale.enlistmentMeritBase = 13001 // earlier enlistments never count
    expect(t4ClassOffer(stale, 'centurion').kind).toBe('merit-locked')
    const centurion = applyT4Class(veteran(7000), 'centurion')!
    expect(centurion).toMatchObject({ rank: 'captain', t4Specialization: 'centurion', unlockedT4Classes: ['centurion'], availableMerit: 333, totalMerit: 7000 })
    expect(resolveCareerHeroAsset(parseCareerProfile(centurion)!)).toBe('roman-centurion-t4')
    // The generic one-step authority refuses Veteran → Captain (both factions), and a Centurion-only save below 7,000 is rejected.
    expect(canAppointCareerRank(veteran(7000), 'captain')).toBe(false)
    expect(parseCareerProfile({ ...centurion, totalMerit: 6999 })).toBeNull()
    expect(promoteCareer(veteran(5000))?.t4Specialization).toBe('paladin')
    const viking = veteran(5000, 'viking')
    expect(t4ClassOffer(viking, 'paladin').kind).toBe('unavailable')
    expect(canAppointCareerRank(viking, 'captain')).toBe(false)
    expect(resolveCareerHeroAsset(promoteCareer(viking)!)).toBe('viking-hero-t4')

    // 第二職業只扣可用軍功並永久解鎖；免費切換不重複扣款或任命，舊畫面不能回收解鎖
    const paladin = applyT4Class(veteran(5000), 'paladin')!
    paladin.availableMerit = 6999
    expect(t4ClassOffer(paladin, 'centurion')).toMatchObject({ kind: 'insufficient-merit', shortfall: 1 })
    paladin.availableMerit = 7500
    const bought = applyT4Class(paladin, 'centurion')!
    expect(bought).toMatchObject({ rank: 'captain', t4Specialization: 'centurion', availableMerit: 500, totalMerit: 5000, unlockedT4Classes: ['paladin', 'centurion'] })
    expect(bought.tutorial).toEqual(paladin.tutorial) // no second appointment receipt
    expect(applyT4Class(bought, 'centurion')).toBeNull()
    const back = applyT4Class(bought, 'paladin')!
    expect(back).toMatchObject({ t4Specialization: 'paladin', availableMerit: 500 })
    expect(back.equipment).toEqual(paladin.equipment); expect(back.inventory).toEqual(paladin.inventory)
    expect(applyT4Class(applyT4Class(veteran(7000), 'centurion')!, 'paladin')).toBeNull() // 333 < 5,000
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(paladin)).toBe(true)
    storage.failWrites = true
    expect(store.save(bought)).toBe(false); expect(store.load()).toMatchObject({ t4Specialization: 'paladin', availableMerit: 7500 })
    storage.failWrites = false
    expect(store.save(bought)).toBe(true); expect(store.save(back)).toBe(true)
    expect(store.load()).toMatchObject({ t4Specialization: 'paladin', availableMerit: 500, unlockedT4Classes: ['paladin', 'centurion'] })
    expect(store.save(paladin)).toBe(false) // stale scene: would drop the unlock and restore the spent merit

    // 現行 Captain 保存明確職業；非法 ID／重複／矛盾被拒；T4 升 T5 依 PR #453，T4 面板不服務 Commander
    const appointed = promoteCareer(veteran(5000))!
    const parsed = parseCareerProfile(appointed)!
    expect([currentT4Class(parsed), unlockedT4Classes(parsed)]).toEqual(['paladin', ['paladin']])
    expect(resolveCareerHeroAsset(parsed)).toBe('roman-hero-t4')
    for (const bad of [{ t4Specialization: 'legate' }, { unlockedT4Classes: ['centurion', 'centurion'] }, { unlockedT4Classes: ['paladin'] },
      { unlockedT4Classes: [] }, { faction: 'viking' }, { rank: 'veteran' }]) expect(parseCareerProfile({ ...centurion, ...bad })).toBeNull()
    centurion.totalMerit = 20000
    const commander = applyCareerClass(centurion, 'roman-commander')!
    expect(commander).toMatchObject({ rank: 'commander', eliteClass: null, unlockedCareerClasses: ['roman-commander'], unlockedT4Classes: ['centurion'] })
    const loaded = parseCareerProfile(commander)!
    expect(resolveCareerHeroAsset(loaded)).toBe('roman-hero-t5')
    expect(currentT4Class(loaded)).toBeNull(); expect(t4ClassOffer(loaded, 'paladin').kind).toBe('unavailable')
    centurion.totalMerit = 30000
    expect(resolveCareerHeroAsset(applyCareerClass(centurion, 'byzantine-cataphract')!)).toBe('byzantine-cataphract-t5')
    const reset = settleTown({ ...cloneCareerProfile(centurion), townEvent: { id: 'e', state: 'hostile' } }, 'e', 'town_defeated')
    expect([reset.t4Specialization, reset.unlockedT4Classes]).toEqual([undefined, undefined])
  })
})

describe('維京 T4／T5 雙職業（瓦良格隊長／龍誓重衛、維京指揮官／鐵血戰帥）', () => {
  const at = (rank: CareerProfile['rank'], total: number, available = 333) => { const p = createCareerProfile('viking'); Object.assign(p, careerRankFixture(p.faction, rank)); p.totalMerit = total; p.availableMerit = available; return p }
  it('驗證維京 T4／T5 雙職業任命、購買切換與非法紀錄拒絕', () => {
    expect(t4ClassOffer(at('veteran', 6999), 'dragon-oathguard')).toMatchObject({ kind: 'merit-locked', shortfall: 1 })
    expect(t4ClassOffer(at('veteran', 5000), 'varangian').kind).toBe('appoint')
    expect(t4ClassOffer(at('veteran', 7000), 'centurion').kind).toBe('unavailable')
    expect(t4ClassOffer(createCareerProfile('roman'), 'dragon-oathguard').kind).toBe('unavailable')
    const oathguard = applyT4Class(at('veteran', 7000), 'dragon-oathguard')!
    expect(oathguard).toMatchObject({ rank: 'captain', t4Specialization: 'dragon-oathguard', unlockedT4Classes: ['dragon-oathguard'], availableMerit: 333 })
    expect(resolveCareerHeroAsset(parseCareerProfile(oathguard)!)).toBe('viking-heavy-hero-t4')
    const varangian = applyT4Class(at('veteran', 5000, 7000), 'varangian')!
    const bought = applyT4Class(varangian, 'dragon-oathguard')!
    expect(bought).toMatchObject({ t4Specialization: 'dragon-oathguard', availableMerit: 0, unlockedT4Classes: ['varangian', 'dragon-oathguard'] })
    expect(bought.tutorial).toEqual(varangian.tutorial)
    expect(applyT4Class(bought, 'varangian')).toMatchObject({ t4Specialization: 'varangian', availableMerit: 0 })
    expect(applyT4Class(bought, 'paladin')).toBeNull()

    // T5 道路：舊維京 Commander 僅推導維京指揮官；30,000 才可直選鐵血戰帥
    const legacy = parseCareerProfile(promoteCareer(promoteCareer(at('veteran', 20000, 30000))!)!)!
    expect([legacy.rank, resolveCareerHeroAsset(legacy), unlockedCareerClasses(legacy)]).toEqual(['commander', 'viking-hero-t5', ['viking-commander']])
    expect(careerClassOffer(legacy, 'ironblood-warlord')).toMatchObject({ kind: 'purchase', cost: 30000 })
    expect(careerClassOffer(at('captain', 29999), 'ironblood-warlord')).toMatchObject({ kind: 'merit-locked', shortfall: 1 })
    expect(careerClassOffer(at('captain', 30000), 'byzantine-cataphract').kind).toBe('unavailable')
    const warlord = applyCareerClass(applyT4Class(at('veteran', 30000), 'dragon-oathguard')!, 'ironblood-warlord')!
    expect(warlord).toMatchObject({ rank: 'commander', eliteClass: 'ironblood-warlord', unlockedCareerClasses: ['ironblood-warlord'], unlockedT4Classes: ['dragon-oathguard'], availableMerit: 333 })
    const loaded = parseCareerProfile(warlord)!
    expect([resolveCareerHeroAsset(loaded), currentT4Class(loaded), t4ClassOffer(loaded, 'varangian').kind]).toEqual(['viking-heavy-hero-t5', null, 'unavailable'])
    expect(applyCareerClass(loaded, 'viking-commander')).toBeNull()

    // 存檔拒絕非法紀錄
    expect(parseCareerProfile({ ...oathguard, totalMerit: 6999 })).toBeNull()
    expect(parseCareerProfile({ ...oathguard, totalMerit: 5000, unlockedT4Classes: ['varangian', 'dragon-oathguard'] })).not.toBeNull()
    expect(unlockedT4Classes(parseCareerProfile(promoteCareer(at('veteran', 9000))!)!)).toEqual(['varangian'])
    for (const bad of [{ t4Specialization: 'centurion' }, { unlockedT4Classes: ['dragon-oathguard', 'paladin'] }, { unlockedT4Classes: ['dragon-oathguard', 'dragon-oathguard'] },
      { unlockedT4Classes: ['varangian'] }, { unlockedCareerClasses: ['viking-commander'] }]) expect(parseCareerProfile({ ...oathguard, ...bad })).toBeNull()
    for (const bad of [{ unlockedCareerClasses: ['dragon-oathguard'] }, { unlockedCareerClasses: ['ironblood-warlord', 'roman-commander'] }, { faction: 'roman' },
      { totalMerit: 29999 }, { eliteClass: 'byzantine-cataphract' }]) expect(parseCareerProfile({ ...warlord, ...bad })).toBeNull()
    expect(parseCareerProfile({ ...warlord, totalMerit: 29999, unlockedCareerClasses: ['viking-commander', 'ironblood-warlord'] })).not.toBeNull()
    const reset = settleTown({ ...cloneCareerProfile(warlord), townEvent: { id: 'e', state: 'hostile' } }, 'e', 'town_defeated')
    expect([reset.faction, reset.rank, reset.eliteClass, reset.unlockedCareerClasses, reset.t4Specialization, reset.unlockedT4Classes]).toEqual(['roman', 'recruit', null, undefined, undefined, undefined])
  })
})

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
    expect(purchase.profile.tutorial?.purchases.weaponIds).toEqual(['viking_axe_t3'])
    expect(profile.tutorial?.purchases.weaponIds).toEqual([])
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
    Object.assign(profile, careerRankFixture(profile.faction, 'recruit'));
    addCareerItem(profile, 'horse', 1)
    expect(hasCareerTutorialHorse(profile)).toBe(false)

    const duplicate = purchaseCareerContent(profile, {
      kind: 'mount',
      id: 'horse',
      cost: 200,
      requiredTier: 1,
    })
    expect(duplicate.purchased).toBe(true)
    expect(duplicate.profile.availableMerit).toBe(100)
    expect(careerItemTotal(duplicate.profile, 'horse')).toBe(2)
    expect(duplicate.profile.tutorial?.purchases.horse).toBe(true)
    expect(hasCareerTutorialHorse(duplicate.profile)).toBe(true)
    expect(profile.tutorial?.purchases.horse).toBe(false)

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
      expect(profile.tutorial?.captain.status).toBe(rank === 'captain' ? 'available' : 'locked')
      expect(profile.tutorial?.commander.status).toBe('locked')
      expect(careerItemTotal(profile, 'sword_t5')).toBe(0)
    }
    const equipment = new TownEquipment(() => profile, next => { profile = next; return true })
    expect(equipment.equipWeapon('paladin_sword_t4')).toBe(true)
    expect(profile.meleeSelectionOrigin).toBe('custom')
    const promoted = promoteCareer(profile)!
    expect(profile.rank).toBe('captain')
    expect(profile.commanderMeleeGranted).toBeUndefined()
    expect(promoted.commanderMeleeGranted).toBe(true)
    expect(promoted.tutorial?.commander.status).toBe('available')
    expect(promoted.equipment).toEqual({ melee: 'paladin_sword_t4', ranged: 'bow_t5' })
    expect(careerItemTotal(promoted, 'sword_t5')).toBe(1)
    expect(careerItemAllocated(promoted, 'sword_t5')).toBe(0)
    expect(careerItemTotal(promoted, 'bow_t5')).toBe(1)
    expect(promoteCareer(promoted)).toBeNull()
  })

  it('auto-equips the Commander reward when the starter was never explicitly replaced', () => {
    let profile = grantStarter(createCareerProfile('roman'), 'gladius_rusty')
    // An empty equipment selection stays empty until the ordinary appointment reward.
    profile.equipment = {}
    new TownEquipment(() => profile, next => { profile = next; return true }).prepareForCombat()
    expect(profile.equipment?.melee).toBeUndefined()
    expect(profile.meleeSelectionOrigin).toBe('starter')
    Object.assign(profile, careerRankFixture(profile.faction, 'captain')); profile.totalMerit = 20000
    const restored = parseCareerProfile(profile)!
    expect(restored.meleeSelectionOrigin).toBe('starter')
    const promoted = promoteCareer(restored)!
    expect(promoted.equipment?.melee).toBe('sword_t5')
    expect(careerItemTotal(promoted, 'sword_t5')).toBe(1)
    expect(careerItemAllocated(promoted, 'sword_t5')).toBe(1)
    expect(careerItemTotal(promoted, 'gladius_rusty')).toBe(1)
  })
})

function retirementProfile(): CareerProfile {
  const profile = createCareerProfile('roman')
  Object.assign(profile, careerRankFixture(profile.faction, 'commander'));
  profile.totalMerit = 20000
  profile.commanderMeleeGranted = true
  profile.inventory = { version: 1, quantities: {} }
  profile.equipment = {}
  profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123,
    combatElapsedSeconds: 42.5, outcome: 'fallen' }
  return profile
}

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
    { activeRace: { version: 1, deployed: false, id: 'new-race', raceId: 'race-1', scheduleVersion: 3, phase: 'guiding',
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

describe('Career tutorial durable transactions', () => {

  it('keeps the final operation and fixed reward atomic on failed storage, retries once and never pays a replay', () => {
    const profile = createCareerProfile('roman')
    const session = startCareerTutorial(profile, 'recruit')!
    for (const operation of CAREER_TUTORIAL_OPERATIONS.recruit.flat().slice(0, -1)) {
      expect(recordCareerTutorialOperation(profile, 'recruit', operation)).toBe(true)
    }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    storage.failWrites = true
    const claim = (candidate: CareerProfile) => recordCareerTutorialOperation(candidate, 'recruit', 'dismounted')
    expect(commitCareerTutorial(store, session.careerId, claim, session.id)).toEqual({ ok: false, reason: 'save-failed' })
    expect(store.load()!.totalMerit).toBe(0)
    expect(store.load()!.tutorial?.recruit.step).toBe('dismounted')
    expect(store.load()!.tutorial?.rewards.recruit).toBeUndefined()
    storage.failWrites = false
    const saved = commitCareerTutorial(store, session.careerId, claim, session.id)
    expect(saved.ok).toBe(true)
    expect(store.load()).toMatchObject({ totalMerit: 100, availableMerit: 100, rank: 'recruit', tutorial: { rewards: { recruit: 100 }, recruit: { status: 'completed' } } })
    expect(commitCareerTutorial(store, session.careerId, claim, session.id)).toEqual({ ok: false, reason: 'rejected' })
    const replay = store.load()!
    deferCareerTutorial(replay, 'recruit')
    expect(startCareerTutorial(replay, 'recruit', true)).not.toBeNull()
    for (const operation of CAREER_TUTORIAL_OPERATIONS.recruit.flat()) recordCareerTutorialOperation(replay, 'recruit', operation)
    expect(claimCareerTutorialReward(replay, 'recruit')).toBe(0)
    expect(store.save(replay)).toBe(true)
    expect(store.load()!.totalMerit).toBe(100)
    expect(store.load()!.lifetimeStats.battles).toBe(0)
    expect(store.load()!.skills).toEqual(profile.skills)
  })
})


it('isolates the current Career writer and reader while leaving historical storage untouched', () => {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  const historical = JSON.stringify({ version: 1, faction: 'roman', merit: 400, unlockedWeapons: ['gladius_rusty'] })
  storage.setItem('sagaburst_career_v1', historical)
  expect(store.loadChecked()).toEqual({ profile: null })
  const current = createCareerProfile('viking')
  expect(store.save(current)).toBe(true)
  expect(store.load()).toEqual(current)
  expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!).version).toBe(2)
  expect(storage.getItem('sagaburst_career_v1')).toBe(historical)
})

it('refuses unsupported or incomplete current-key data without replacing the original bytes', () => {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  const current = createCareerProfile('roman')
  for (const bytes of [JSON.stringify({ ...current, version: 1 }), JSON.stringify({ ...current, inventory: undefined }), '{broken', '', 'false']) {
    storage.setItem(CAREER_STORAGE_KEY, bytes)
    expect(store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
    expect(store.save(current)).toBe(false)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
  }
})

it('rejects malformed current merit balances without zeroing or overwriting them', () => {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  const current = createCareerProfile('roman')
  for (const field of ['totalMerit', 'availableMerit'] as const) {
    for (const invalid of [undefined, '100', null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = { ...current, [field]: invalid }
      expect(parseCareerProfile(malformed), `${field}: ${String(invalid)}`).toBeNull()
      const bytes = JSON.stringify(malformed)
      storage.setItem(CAREER_STORAGE_KEY, bytes)
      expect(store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
      expect(store.save(current)).toBe(false)
      expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    }
  }
  storage.removeItem(CAREER_STORAGE_KEY)
  const valid = { ...current, totalMerit: 200, availableMerit: 37 }
  expect(store.save(valid)).toBe(true)
  expect(store.loadChecked().profile).toMatchObject({ totalMerit: 200, availableMerit: 37 })
})
