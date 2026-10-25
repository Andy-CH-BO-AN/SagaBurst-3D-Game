import { describe, expect, it, vi } from 'vitest'
import { canRecruitPersonalSquad, recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { cloneCareerProfile, createCareerProfile, type CareerRank } from '../../src/career/CareerProfile'
import { MemoryStorage } from '../helpers/memoryStorage'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { PERSONAL_RECRUITMENT_ROLES, resolvePersonalRecruitment, type PersonalRecruitmentChoice } from '../../src/career/CareerRecruitmentCatalog'
import { careerItemAllocated, careerItemTotal } from '../../src/career/CareerInventory'
function profile(rank: CareerRank = 'captain') { return { ...createCareerProfile('roman'), rank, totalMerit: 60000, availableMerit: 60000 } }
describe('Personal Squad recruitment and durable identity', () => {
  it.each(['captain'] as const)('requires formal Commander rank to hire T5 even with 60,000 merit at %s', rank => {
    const current = profile(rank), before = cloneCareerProfile(current), save = vi.fn(() => true)
    expect(canRecruitPersonalSquad(current, 'commander')).toBe(false)
    expect(recruitPersonalSquadMember(current, 'commander', save)).toMatchObject({ recruited: false, reason: 'rank-locked' })
    expect(current).toEqual(before); expect(save).not.toHaveBeenCalled()
  })
  it('shares the thirty-member cap across Soldier, Captain, Ranger and Commander without spending on member 31', () => {
    let current = profile('commander')
    const types = ['soldier', 'captain', 'ranger', 'commander'] as const
    current.personalSquad = { members: Array.from({ length: 30 }, (_, index) => ({
      id: 'personal:' + index, type: types[index % types.length],
    })) }
    const save = vi.fn(() => true), old = cloneCareerProfile(current)
    expect(recruitPersonalSquadMember(current, 'commander', save)).toMatchObject({ recruited: false, reason: 'squad-full' })
    expect(current).toEqual(old); expect(save).not.toHaveBeenCalled()
  })
  it.each([['commander', 58000]] as const)('stages %s roster, inventory and deduction atomically and preserves all on storage failure', (type, merit) => {
    const current = profile('commander'), before = cloneCareerProfile(current), snapshots: unknown[] = []
    class FailedStorage extends MemoryStorage {
      override setItem(_key: string, value: string): void { snapshots.push(JSON.parse(value)); throw new Error('quota') }
    }
    const storage = new FailedStorage()
    const store = new CareerProfileStore(storage)
    const result = recruitPersonalSquadMember(current, type, next => store.save(next))
    expect(result).toMatchObject({ recruited: false, reason: 'save-failed' })
    expect(current).toEqual(before)
    expect(snapshots[0]).toMatchObject({ availableMerit: merit, personalSquad: { members: [{ type, characterTier: 5, heroArchetype: 'commander' }] }, inventory: { quantities: { gladius_standard: 1, scutum_t2: 1, horse: 1 } } })
    expect(recruitPersonalSquadMember(current, type, () => { throw Error('quota') }).recruited).toBe(false)
    expect(current).toEqual(before)
  })
  it.each(['roman', 'viking'] as const)('resolves the thirty legal %s catalog products with authoritative prices, HP and initial allocations', faction => {
    const identities = [
      { characterTier: 1, price: 100, hp: faction === 'roman' ? 100 : 90 },
      { characterTier: 2, price: 200, hp: faction === 'roman' ? 150 : 135 },
      { characterTier: 3, price: 300, hp: faction === 'roman' ? 200 : 180 },
      { characterTier: 4, heroArchetype: 'captain', price: 500, hp: 500 },
      { characterTier: 4, heroArchetype: 'ranger', price: 500, hp: 300 },
      { characterTier: 5, heroArchetype: 'commander', price: 2000, hp: faction === 'roman' ? 850 : 950 },
    ] as const
    const swordIds = faction === 'roman' ? ['gladius_rusty', 'gladius_standard'] : ['rusty_dagger', 'steel_sword']
    const products = identities.flatMap(identity => PERSONAL_RECRUITMENT_ROLES.map(recruitmentRole => {
      const choice = { characterTier: identity.characterTier, ...('heroArchetype' in identity ? { heroArchetype: identity.heroArchetype } : {}), recruitmentRole }
      return { choice, identity, product: resolvePersonalRecruitment(faction, choice)! }
    }))
    expect(products).toHaveLength(30)
    for (const { choice, identity, product } of products) {
      const low = identity.characterTier <= 3, sword = swordIds[low ? 0 : 1]
      const expectedEquipment = {
        archer: { melee: sword, ranged: low ? 'wooden_shortbow' : 'recurve_longbow', shield: null },
        swordsman: { melee: sword, ranged: null, shield: `${faction === 'roman' ? 'scutum' : 'round_shield'}_t${low ? 1 : 2}` },
        javelin: { melee: sword, ranged: low ? 'pilum_basic' : 'pilum_standard', shield: null },
        axeman: { melee: low ? 'viking_axe_t1' : 'viking_axe_t2', ranged: null, shield: `${faction === 'roman' ? 'scutum' : 'round_shield'}_t${low ? 1 : 2}` },
        spearman: { melee: low ? 'hunting_spear' : 'steel_lance', ranged: null, shield: null },
      }[choice.recruitmentRole]
      expect(product).toMatchObject({ ...choice, price: identity.price, maxHp: identity.hp,
        equipment: { ...expectedEquipment, mount: low ? null : 'horse' } })
    }
  })
  it.each([
    { characterTier: 3, heroArchetype: 'ranger', recruitmentRole: 'archer' },
    { characterTier: 5, heroArchetype: 'captain', recruitmentRole: 'swordsman' },
    { characterTier: 4, recruitmentRole: 'spearman' },
    { characterTier: 2, recruitmentRole: 'lancer' },
  ])('rejects malformed recruitment $characterTier/$heroArchetype/$recruitmentRole before staging or saving', input => {
    const current = profile('commander'), before = cloneCareerProfile(current), save = vi.fn(() => true), createId = vi.fn(() => 'personal:bad')
    expect(recruitPersonalSquadMember(current, input as PersonalRecruitmentChoice, save, createId)).toMatchObject({ recruited: false, reason: 'invalid-product' })
    expect(current).toEqual(before); expect(save).not.toHaveBeenCalled(); expect(createId).not.toHaveBeenCalled()
  })
  it('preserves merit and allocations when the chosen higher-tier recruit is unaffordable', () => {
    const current = { ...profile(), availableMerit: 299 }, before = cloneCareerProfile(current), save = vi.fn(() => true)
    expect(recruitPersonalSquadMember(current, { characterTier: 3, recruitmentRole: 'javelin' }, save)).toMatchObject({ recruited: false, reason: 'insufficient-merit' })
    expect(current).toEqual(before); expect(save).not.toHaveBeenCalled()
  })
  it('persists a T3 javelin recruit with its owned backup sword and catalog price despite forged UI grants', () => {
    const current = { ...profile(), faction: 'viking' as const }, store = new CareerProfileStore(new MemoryStorage())
    const choice = { characterTier: 3 as const, recruitmentRole: 'javelin' as const, price: 1, maxHp: 9999, equipment: { melee: 'axe_t5', mount: 'black-cat' } }
    const result = recruitPersonalSquadMember(current, choice, next => store.save(next), () => 'personal:javelin')
    expect(result.recruited).toBe(true)
    const loaded = store.load()!
    expect(loaded).toMatchObject({ totalMerit: 60000, availableMerit: 59700, personalSquad: { members: [
      { id: 'personal:javelin', type: 'soldier', characterFaction: 'viking', characterTier: 3, recruitmentRole: 'javelin', originalHirePrice: 300,
        equipment: { melee: 'rusty_dagger', ranged: 'pilum_basic', shield: null, mount: null } },
    ] } })
    expect(careerItemTotal(loaded, 'rusty_dagger')).toBe(1); expect(careerItemAllocated(loaded, 'rusty_dagger')).toBe(1)
    expect(careerItemTotal(loaded, 'pilum_basic')).toBe(1); expect(careerItemAllocated(loaded, 'pilum_basic')).toBe(1)
    expect(careerItemTotal(loaded, 'axe_t5')).toBe(0); expect(careerItemTotal(loaded, 'black-cat')).toBe(0)
    const afterCareerFactionChange = parseCareerProfile({ ...loaded, faction: 'roman' })!
    expect(afterCareerFactionChange.personalSquad).toEqual(loaded.personalSquad)
    expect(afterCareerFactionChange.inventory).toEqual(loaded.inventory)
  })
})
