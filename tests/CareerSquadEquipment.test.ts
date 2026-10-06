import { describe, expect, it } from 'vitest'
import { createCareerProfile, cloneCareerProfile, type CareerProfile, type CareerRank } from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { changePersonalEquipment, recruitPersonalSquadMember, sellPersonalSquadMember, type PersonalSquadAuthority, type PersonalSquadMemberType } from '../src/career/CareerPersonalSquad'
import { availableCareerItem, careerItemTotal, careerItemTotals, careerItemAllocated, type PersonalEquipmentSlot } from '../src/career/CareerInventory'
import { purchaseTownEquipment, purchaseTownMount, sellTownProduct, townResalePrice } from '../src/town/TownRules'
import { TownEquipment } from '../src/town/TownEquipment'
import { canUseCareerMount } from '../src/career/CareerMountController'
import { personalMemberLoadout } from '../src/town/TownPersonalSquadController'
import { prepareEnemyTownAssaultEquipment } from '../src/career/EnemyTownAssault'

function harness(rank: CareerRank = 'captain') {
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank, totalMerit: 60000, availableMerit: 60000 }
  let raw = ''
  let failSave = false
  const store = new CareerProfileStore({ getItem: () => raw || null, setItem: (_: string, value: string) => { if (failSave) throw Error('quota'); raw = value } } as Storage)
  const authority: PersonalSquadAuthority = { state: 'RESERVE' }
  const read = () => profile
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  return { read, save, store, authority, fail: () => { failSave = true }, set: (next: CareerProfile) => { profile = next },
    hire(type: PersonalSquadMemberType = 'soldier') { const result = recruitPersonalSquadMember(profile, type, save); expect(result.recruited).toBe(true); return profile.personalSquad!.members.at(-1)!.id },
    buy(id: string) { const result = ['horse', 'corgi', 'black-cat'].includes(id) ? purchaseTownMount(profile, id) : purchaseTownEquipment(profile, id); expect(result.purchased).toBe(true); expect(save(result.profile)).toBe(true) },
    change(id: string, slot: PersonalEquipmentSlot, item: string | null) { return changePersonalEquipment(read, authority, id, slot, item, save) },
    sell(id: string) { return sellPersonalSquadMember(read, authority, id, save) },
  }
}
function balanced(profile: CareerProfile) {
  for (const [id, count] of Object.entries(careerItemTotals(profile))) {
    expect(availableCareerItem(profile, id) + careerItemAllocated(profile, id)).toBe(count)
    expect(careerItemAllocated(profile, id)).toBeLessThanOrEqual(count)
  }
}
describe('Shared Career quantity inventory and personal equipment', () => {
  it.each(['soldier', 'captain', 'ranger'] as const)('grants %s equipment once, allocated immediately; reload never grants again', type => {
    const h = harness(); h.hire(type)
    const before = cloneCareerProfile(h.read())
    for (const id of Object.values(before.personalSquad!.members[0].equipment!)) if (id) expect(availableCareerItem(before, id)).toBe(0)
    for (let i = 0; i < 4; i++) { const loaded = h.store.load()!; expect(loaded.inventory).toEqual(before.inventory); expect(h.save(loaded)).toBe(true) }
    balanced(h.read()); expect(h.read().ownedWeapons.some(id => id.startsWith('maki-ranger-bow'))).toBe(false)
  })
  it('rejects removing the only weapon, swaps Sword for Lance, and sells the released Sword', () => {
    const h = harness(), id = h.hire(), before = cloneCareerProfile(h.read())
    expect(h.change(id, 'melee', null).reason).toBe('last-weapon'); expect(h.read()).toEqual(before)
    expect(h.change(id, 'melee', 'unknown-weapon').reason).toBe('invalid-item'); expect(h.read()).toEqual(before)
    expect(sellTownProduct(h.read(), 'gladius_standard').sold).toBe(false)
    h.buy('heavy_lance'); const totals = { ...h.read().inventory!.quantities }
    expect(h.change(id, 'melee', 'heavy_lance').changed).toBe(true)
    expect(h.read().inventory!.quantities).toEqual(totals)
    expect(availableCareerItem(h.read(), 'gladius_standard')).toBe(1)
    const sold = sellTownProduct(h.read(), 'gladius_standard'); expect(sold.sold).toBe(true); h.save(sold.profile)
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(0)
    const loaded = h.store.load()!; expect(personalMemberLoadout(loaded.personalSquad!.members[0], 'roman')).toMatchObject({ tier: 2, loadout: { meleeWeaponId: 'heavy_lance' } })
    balanced(loaded)
  })
  it('supports melee plus ranged; incompatible shields return to available stock atomically', () => {
    const h = harness(), id = h.hire(); h.buy('recurve_longbow')
    expect(h.change(id, 'ranged', 'recurve_longbow').changed).toBe(true)
    expect(h.read().personalSquad!.members[0].equipment).toMatchObject({ melee: 'gladius_standard', ranged: 'recurve_longbow', shield: null })
    expect(availableCareerItem(h.read(), 'scutum_t2')).toBe(1)
    expect(h.change(id, 'shield', 'scutum_t2').changed).toBe(true)
    expect(availableCareerItem(h.read(), 'recurve_longbow')).toBe(1)
    h.change(id, 'ranged', 'recurve_longbow'); expect(h.change(id, 'melee', null).changed).toBe(true)
    const before = cloneCareerProfile(h.read())
    expect(h.change(id, 'shield', 'scutum_t2').reason).toBe('last-weapon'); expect(h.read()).toEqual(before)
    balanced(h.read())
  })
  it('purchases three identical weapons, assigns two, and prevents a third claimant after Player takes one', () => {
    const h = harness(), a = h.hire(), b = h.hire(), c = h.hire()
    for (let i = 0; i < 3; i++) h.buy('heavy_lance')
    h.change(a, 'melee', 'heavy_lance'); h.change(b, 'melee', 'heavy_lance')
    expect(careerItemTotal(h.read(), 'heavy_lance')).toBe(3); expect(availableCareerItem(h.read(), 'heavy_lance')).toBe(1)
    const equipment = new TownEquipment(h.read, h.save); expect(equipment.equipWeapon('heavy_lance')).toBe(true)
    equipment.sheathAll(); expect(availableCareerItem(h.read(), 'heavy_lance')).toBe(0)
    expect(h.change(c, 'melee', 'heavy_lance').reason).toBe('no-available-item')
    expect(equipment.unequipWeapon('heavy_lance')).toBe(true); expect(h.change(c, 'melee', 'heavy_lance').changed).toBe(true)
    expect(equipment.equipWeapon('heavy_lance')).toBe(false); balanced(h.read())
  })
  it('shares two Black Cats between Player and a member, rejecting a third allocation', () => {
    const h = harness(), a = h.hire('captain'), b = h.hire('ranger')
    h.buy('black-cat'); h.buy('black-cat'); expect(h.change(a, 'mount', 'black-cat').changed).toBe(true)
    expect(h.change(b, 'mount', 'black-cat').reason).toBe('no-available-item')
    expect(canUseCareerMount(h.read(), 'black-cat')).toBe(true)
    expect(availableCareerItem(h.read(), 'horse')).toBe(1); balanced(h.read())
  })
  it('respects shared allocations when preparing existing enemy-town equipment, releasing an incompatible bow', () => {
    const h = harness(); h.hire(); h.buy('recurve_longbow')
    const equipment = new TownEquipment(h.read, h.save); expect(equipment.equipWeapon('recurve_longbow')).toBe(true)
    const withoutFreeShield = prepareEnemyTownAssaultEquipment(h.read())
    expect(withoutFreeShield.equipment?.ranged).toBe('recurve_longbow'); expect(withoutFreeShield.equipment?.shield).toBeNull()
    h.buy('scutum_t3')
    const prepared = prepareEnemyTownAssaultEquipment(h.read())
    expect(prepared.equipment?.shield).toBe('scutum_t3'); expect(prepared.equipment?.ranged).toBeUndefined()
    expect(availableCareerItem(prepared, 'recurve_longbow')).toBe(1); expect(h.save(prepared)).toBe(true); balanced(prepared)
  })
  it.each(['melee', 'ranged', 'shield'] as const)('locks Maki %s in domain', slot => {
    const h = harness(), id = h.hire('ranger'); h.buy('steel_sword'); h.buy('recurve_longbow')
    const before = cloneCareerProfile(h.read()); expect(h.change(id, slot, slot === 'ranged' ? 'recurve_longbow' : 'steel_sword').reason).toBe('fixed-equipment')
    expect(h.change(id, slot, null).reason).toBe('fixed-equipment'); expect(h.read()).toEqual(before)
  })
  it.each(['soldier', 'captain', 'ranger'] as const)('allows %s to swap and remove mounts without regenerating Horse', type => {
    const h = harness(), id = h.hire(type); h.buy('corgi')
    const release = cloneCareerProfile(h.read()); delete release.selectedMountId; h.save(release)
    expect(h.change(id, 'mount', 'corgi').changed).toBe(true)
    const spec = personalMemberLoadout(h.read().personalSquad!.members[0], 'roman'); expect(spec.loadout.mountId).toBe('corgi')
    expect(h.change(id, 'mount', null).changed).toBe(true); expect(personalMemberLoadout(h.read().personalSquad!.members[0], 'roman').mounted).toBe(false)
    expect(availableCareerItem(h.read(), 'corgi')).toBe(1); expect(careerItemTotal(h.read(), 'horse')).toBe(type === 'soldier' ? 0 : 1)
    if (type === 'ranger') expect(spec.loadout).toMatchObject({ meleeWeaponId: 'maki-ranger-bow', shieldId: null })
  })
  it('preserves old/new weapons and incompatible shield allocations on failed saves', () => {
    const h = harness(), id = h.hire(); h.buy('heavy_lance'); h.buy('recurve_longbow'); const before = cloneCareerProfile(h.read()), disk = h.store.load()
    h.fail(); expect(h.change(id, 'melee', 'heavy_lance').reason).toBe('save-failed'); expect(h.change(id, 'ranged', 'recurve_longbow').reason).toBe('save-failed')
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
  })
  it.each(['DEPLOYING', 'ACTIVE', 'RETURNING'] as const)('rejects equipment and sale during whole-squad %s', state => {
    const h = harness(), id = h.hire(), before = cloneCareerProfile(h.read()); Object.assign(h.authority, { state })
    expect(h.change(id, 'mount', null).reason).toBe('not-reserve'); expect(h.sell(id).reason).toBe('not-reserve'); expect(h.read()).toEqual(before)
  })
})
describe('Atomic HR release and refunds', () => {
  it.each([['captain', 'soldier', 40], ['captain', 'captain', 400], ['captain', 'ranger', 400],
    ['commander', 'soldier', 45], ['commander', 'captain', 450], ['commander', 'ranger', 450]] as const)('%s sells %s for %i, retaining tradable assets', (rank, type, refund) => {
    const h = harness(rank), id = h.hire(type), before = cloneCareerProfile(h.read())
    expect(h.sell(id)).toMatchObject({ sold: true, refund }); const after = h.read()
    expect(after.availableMerit).toBe(before.availableMerit + refund); expect(after.totalMerit).toBe(before.totalMerit)
    expect(after.skills).toEqual(before.skills); expect(after.lifetimeStats).toEqual(before.lifetimeStats)
    expect(after.inventory).toEqual(before.inventory); expect(after.personalSquad!.members).toHaveLength(0)
    for (const [item, count] of Object.entries(careerItemTotals(after))) expect(availableCareerItem(after, item)).toBe(count)
    expect(h.sell(id)).toMatchObject({ sold: false, reason: 'missing-member' }); expect(h.read()).toEqual(after)
    expect(Object.keys(careerItemTotals(after)).some(item => item.startsWith('maki-ranger-bow'))).toBe(false)
  })
  it('uses the current rank, actual hire cost, and releases exchanged equipment in one save', () => {
    const h = harness(), id = h.hire('captain'); h.buy('heavy_lance'); h.change(id, 'melee', 'heavy_lance')
    const current = cloneCareerProfile(h.read()); current.rank = 'commander'; current.personalSquad!.members[0].originalHirePrice = 501; h.set(current)
    expect(h.sell(id)).toMatchObject({ sold: true, refund: 450 }); expect(availableCareerItem(h.read(), 'heavy_lance')).toBe(1)
  })
  it('rolls back member, allocations, and currency on failure; disallows other ranks and non-roster actors', () => {
    const h = harness(), id = h.hire('captain'), before = cloneCareerProfile(h.read()), disk = h.store.load()
    h.fail(); expect(h.sell(id).reason).toBe('save-failed'); expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
    for (const rank of ['recruit', 'soldier', 'veteran'] as const) { h.set({ ...before, rank }); expect(h.sell(id).reason).toBe('rank-locked') }
    h.set(before); for (const id of ['hr-officer', 'patrol-a', 'town-resident']) expect(h.sell(id).reason).toBe('missing-member')
  })
})
describe('Inventory migration and normalization', () => {
  it('migrates legacy ownership and HR gear once, deduplicating Horse aliases', () => {
    const legacy = { ...createCareerProfile('roman'), totalMerit: 6000, rank: 'captain', ownedWeapons: ['gladius_standard', 'gladius_standard'],
      ownedMounts: ['horse', 'horse-t1', 'horse-t2'], ownedHorseTiers: [1, 2, 3], equipment: { melee: 'gladius_standard' },
      personalSquad: { members: [{ id: 'personal:s', type: 'soldier' }, { id: 'personal:c', type: 'captain' }, { id: 'personal:r', type: 'ranger' }] } }
    const loaded = parseCareerProfile(legacy)!
    expect(careerItemTotal(loaded, 'gladius_standard')).toBe(2); expect(availableCareerItem(loaded, 'gladius_standard')).toBe(0)
    expect(careerItemTotal(loaded, 'horse')).toBe(3); expect(loaded.personalSquad!.members.map(member => member.originalHirePrice)).toEqual([50, 500, 500])
    expect(parseCareerProfile(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded); balanced(loaded)
  })
  it('removes illegal Maki allocations without creating stock or losing growth', () => {
    const h = harness(), id = h.hire('ranger'), raw = cloneCareerProfile(h.read())
    Object.assign(raw.personalSquad!.members[0].equipment!, { melee: 'steel_sword', ranged: 'recurve_longbow', shield: 'scutum_t3' })
    const loaded = parseCareerProfile(raw)!
    expect(loaded.inventory).toEqual(h.read().inventory); expect(loaded.totalMerit).toBe(raw.totalMerit)
    expect(loaded.personalSquad!.members[0]).toMatchObject({ id, equipment: { melee: null, ranged: null, shield: null, mount: 'horse' } })
  })
  it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s without overwriting storage', count => {
    const h = harness(); h.hire(); const before = h.store.load(), invalid = cloneCareerProfile(h.read()); invalid.inventory!.quantities.gladius_standard = count
    expect(h.store.save(invalid)).toBe(false); expect(h.store.load()).toEqual(before)
  })
  it('rejects unknown IDs, overallocations, missing new-schema gear, and unarmed hired members', () => {
    const h = harness(); h.hire(); h.hire()
    const invalid = cloneCareerProfile(h.read()); invalid.inventory!.quantities.gladius_standard = 1; expect(parseCareerProfile(invalid)).toBeNull()
    invalid.inventory!.quantities.gladius_standard = 2; invalid.inventory!.quantities.fake = 2; expect(parseCareerProfile(invalid)).toBeNull()
    delete invalid.inventory!.quantities.fake; delete invalid.personalSquad!.members[0].equipment; expect(parseCareerProfile(invalid)).toBeNull()
    invalid.personalSquad!.members[0].equipment = { melee: null, ranged: null, shield: null, mount: null }; expect(parseCareerProfile(invalid)).toBeNull()
  })
  it('clones counts and nested equipment independently and reports the permitted resale profit', () => {
    const h = harness(); h.hire(); const copy = cloneCareerProfile(h.read()); copy.inventory!.quantities.gladius_standard = 9; copy.personalSquad!.members[0].equipment!.melee = 'steel_sword'
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(1)
    expect(townResalePrice(h.read(), 'gladius_standard') + 40 - 50).toBe(310)
  })
})
