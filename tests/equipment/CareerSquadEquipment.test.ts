import { describe, expect, it } from 'vitest'
import { availableCareerItem, careerItemAllocated, careerItemTotal, careerItemTotals, type PersonalEquipmentSlot } from '../../src/career/CareerInventory'
import { changePersonalEquipment, recruitPersonalSquadMember, sellPersonalSquadMember, sellPersonalSquadMembers, type PersonalSquadAuthority, type PersonalSquadMemberType } from '../../src/career/CareerPersonalSquad'
import { cloneCareerProfile, createCareerProfile, type CareerProfile, type CareerRank } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { T4_RANGER_BOW_RANGED_ID } from '../../src/rpg/WeaponDatabase'
import { TownEquipment } from '../../src/town/TownEquipment'
import { personalMemberLoadout } from '../../src/town/TownPersonalSquadController'
import { purchaseTownEquipment, purchaseTownMount, sellTownProduct } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

function harness(rank: CareerRank = 'captain', faction: CareerProfile['faction'] = 'roman') {
  let profile: CareerProfile = { ...createCareerProfile(faction), rank, totalMerit: 60000, availableMerit: 60000 }
  const storage = new MemoryStorage()
  const store = new CareerProfileStore(storage)
  const authority: PersonalSquadAuthority = { state: 'RESERVE' }
  const read = () => profile
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  return { read, save, store, authority, fail: () => { storage.failWrites = true }, set: (next: CareerProfile) => { profile = next },
    hire(type: PersonalSquadMemberType = 'soldier') { const result = recruitPersonalSquadMember(profile, type, save); expect(result.recruited).toBe(true); return profile.personalSquad!.members.at(-1)!.id },
    buy(id: string) { const result = ['horse', 'corgi', 'black-cat', 'xongkoro'].includes(id) ? purchaseTownMount(profile, id) : purchaseTownEquipment(profile, id); expect(result.purchased).toBe(true); expect(save(result.profile)).toBe(true) },
    change(id: string, slot: PersonalEquipmentSlot, item: string | null) { return changePersonalEquipment(read, authority, id, slot, item, save) },
    sell(id: string) { return sellPersonalSquadMember(read, authority, id, save) },
    sellMany(ids: string[]) { return sellPersonalSquadMembers(read, authority, ids, save) },
  }
}
function balanced(profile: CareerProfile) {
  for (const [id, count] of Object.entries(careerItemTotals(profile))) {
    expect(availableCareerItem(profile, id) + careerItemAllocated(profile, id)).toBe(count)
    expect(careerItemAllocated(profile, id)).toBeLessThanOrEqual(count)
  }
}
describe('Shared Career quantity inventory and personal equipment', () => {
  it('blocks T5 shop purchases before formal Commander appointment despite sufficient merit', () => {
    const h = harness('captain'), before = cloneCareerProfile(h.read())
    const result = purchaseTownEquipment(h.read(), 'axe_t5', 2)
    expect(result).toMatchObject({ purchased: false, spentMerit: 0, reason: 'tier-locked' })
    expect(result.profile).toEqual(before)
    expect(h.read()).toEqual(before)
  })
  it('purchases and allocates a cross-faction T5 weapon through the existing bulk inventory transaction', () => {
    const h = harness('commander', 'viking')
    const result = purchaseTownEquipment(h.read(), 'sword_t5', 2)
    expect(result).toMatchObject({ purchased: true, spentMerit: 5000 })
    expect(h.save(result.profile)).toBe(true)
    const equipment = new TownEquipment(h.read, h.save)
    expect(equipment.equipWeapon('sword_t5')).toBe(true)
    const loaded = h.store.load()!
    expect(loaded.availableMerit).toBe(55000)
    expect(loaded.equipment?.melee).toBe('sword_t5')
    expect(careerItemTotal(loaded, 'sword_t5')).toBe(2)
    expect(availableCareerItem(loaded, 'sword_t5')).toBe(1)
    balanced(loaded)
  })

  it('rejects removing the only weapon, swaps Sword for Lance, and sells the released Sword', () => {
    const h = harness(), id = h.hire(), before = cloneCareerProfile(h.read())
    expect(h.change(id, 'melee', null).reason).toBe('last-weapon'); expect(h.read()).toEqual(before)
    expect(h.change(id, 'melee', 'unknown-weapon').reason).toBe('invalid-item'); expect(h.read()).toEqual(before)
    expect(sellTownProduct(h.read(), 'gladius_rusty').sold).toBe(false)
    h.buy('heavy_lance'); const totals = { ...h.read().inventory!.quantities }
    expect(h.change(id, 'melee', 'heavy_lance').changed).toBe(true)
    expect(h.read().inventory!.quantities).toEqual(totals)
    expect(availableCareerItem(h.read(), 'gladius_rusty')).toBe(1)
    const sold = sellTownProduct(h.read(), 'gladius_rusty'); expect(sold.sold).toBe(true); h.save(sold.profile)
    expect(careerItemTotal(h.read(), 'gladius_rusty')).toBe(0)
    const loaded = h.store.load()!; expect(personalMemberLoadout(loaded.personalSquad!.members[0], 'roman')).toMatchObject({ tier: 3, loadout: { meleeWeaponId: 'heavy_lance' } })
    balanced(loaded)
  })
  it('preserves all three NPC slots through bow and shield swaps, persistence and quantity allocation', () => {
    const h = harness(), id = h.hire(); h.buy('recurve_longbow'); h.buy('elven_runebow'); h.buy('scutum_t3')
    expect(h.change(id, 'ranged', 'recurve_longbow').changed).toBe(true)
    expect(h.read().personalSquad!.members[0].equipment).toMatchObject({ melee: 'gladius_rusty', ranged: 'recurve_longbow', shield: 'scutum_t2' })
    expect(availableCareerItem(h.read(), 'scutum_t2')).toBe(0)
    expect(h.change(id, 'shield', 'scutum_t3').changed).toBe(true)
    expect(h.change(id, 'ranged', 'elven_runebow').changed).toBe(true)
    const loaded = h.store.load()!
    expect(loaded.personalSquad!.members[0].equipment).toMatchObject({ melee: 'gladius_rusty', ranged: 'elven_runebow', shield: 'scutum_t3' })
    expect(personalMemberLoadout(loaded.personalSquad!.members[0], 'roman').loadout).toMatchObject({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'elven_runebow', shieldId: 'scutum_t3' })
    expect(availableCareerItem(loaded, 'recurve_longbow')).toBe(1)
    expect(availableCareerItem(loaded, 'scutum_t2')).toBe(1)
    expect(sellTownProduct(loaded, 'scutum_t3').sold).toBe(false)
    balanced(loaded)
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
  it('equips Ranger weapons normally and never restores a deliberately removed default on reload', () => {
    const h = harness(), id = h.hire('ranger')
    expect(h.read().availableMerit).toBe(59500)
    expect(h.read().personalSquad!.members[0].equipment).toEqual({ melee: 'centurion_blade', ranged: T4_RANGER_BOW_RANGED_ID, shield: null, mount: 'horse' })
    expect(availableCareerItem(h.read(), 'centurion_blade')).toBe(0)
    h.buy('heavy_lance'); h.buy('scutum_t2')
    expect(h.change(id, 'melee', 'heavy_lance').changed).toBe(true)
    expect(h.change(id, 'shield', 'scutum_t2').changed).toBe(true)
    expect(h.change(id, 'ranged', null).changed).toBe(true)
    expect(availableCareerItem(h.read(), T4_RANGER_BOW_RANGED_ID)).toBe(1)
    expect(h.change(id, 'melee', null).reason).toBe('last-weapon')
    expect(h.change(id, 'shield', null).changed).toBe(true)
    const loaded = h.store.load()!
    expect(loaded.personalSquad!.members[0].equipment).toEqual({ melee: 'heavy_lance', ranged: null, shield: null, mount: 'horse' })
    expect(personalMemberLoadout(loaded.personalSquad!.members[0], 'roman')).toMatchObject({ tier: 4, mounted: true,
      hero: { combatProfileId: 'ranger' }, loadout: { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, reversibleRangedSwitch: true } })
    expect(careerItemTotal(loaded, T4_RANGER_BOW_RANGED_ID)).toBe(1)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded)
    balanced(loaded)
  })
  it('preserves old/new weapons and existing shield allocations on failed saves', () => {
    const h = harness(), id = h.hire(); h.buy('heavy_lance'); h.buy('recurve_longbow'); const before = cloneCareerProfile(h.read()), disk = h.store.load()
    h.fail(); expect(h.change(id, 'melee', 'heavy_lance').reason).toBe('save-failed'); expect(h.change(id, 'ranged', 'recurve_longbow').reason).toBe('save-failed')
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
  })
  it('rejects equipment and sale while the squad is active', () => {
    const state = 'ACTIVE' as const
    const h = harness(), id = h.hire(), before = cloneCareerProfile(h.read()); Object.assign(h.authority, { state })
    expect(h.change(id, 'mount', null).reason).toBe('not-reserve'); expect(h.sell(id).reason).toBe('not-reserve'); expect(h.read()).toEqual(before)
  })
})
describe('Atomic HR release and refunds', () => {
  it('removes one worn copy while preserving copies allocated to Player and another member', () => {
    const h = harness(), a = h.hire(), b = h.hire(); for (let i = 0; i < 3; i++) h.buy('heavy_lance')
    h.change(a, 'melee', 'heavy_lance'); h.change(b, 'melee', 'heavy_lance')
    const equipment = new TownEquipment(h.read, h.save); expect(equipment.equipWeapon('heavy_lance')).toBe(true)
    const before = cloneCareerProfile(h.read()); expect(h.sell(a).sold).toBe(true)
    expect(careerItemTotal(h.read(), 'heavy_lance')).toBe(2); expect(availableCareerItem(h.read(), 'heavy_lance')).toBe(0)
    expect(h.read().equipment).toEqual(before.equipment); expect(h.read().personalSquad!.members[0]).toEqual(before.personalSquad!.members[1])
    expect(careerItemTotal(h.read(), 'gladius_rusty')).toBe(2); expect(availableCareerItem(h.read(), 'gladius_rusty')).toBe(2)
    expect(careerItemTotal(h.read(), 'scutum_t2')).toBe(1); balanced(h.read())
  })
  it('rolls back member, allocations and currency when saving a release fails', () => {
    const h = harness(), id = h.hire('captain'), before = cloneCareerProfile(h.read()), disk = h.store.load()
    h.fail(); expect(h.sell(id).reason).toBe('save-failed'); expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
  })
})
describe('Batch shop and HR resale', () => {
  it('rejects a stale member in a bulk release before selling any valid member', () => {
    const h = harness(), ids = [h.hire(), h.hire('captain')], before = cloneCareerProfile(h.read())
    let saves = 0
    const save = (next: CareerProfile) => { saves++; return h.save(next) }
    expect(sellPersonalSquadMembers(h.read, h.authority, [ids[0], 'personal:missing'], save).reason).toBe('missing-member')
    expect(saves).toBe(0); expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(before)
  })
  it('retains the entire squad, inventory and funds when the final bulk save fails', () => {
    const h = harness(), ids = [h.hire(), h.hire('captain'), h.hire('ranger')], before = cloneCareerProfile(h.read())
    h.fail(); expect(h.sellMany(ids).reason).toBe('save-failed')
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(before)
  })
})
describe('Inventory migration and normalization', () => {
  it('migrates legacy ownership and HR gear once, deduplicating Horse aliases', () => {
    const legacy = { ...createCareerProfile('roman'), totalMerit: 6000, rank: 'captain', ownedWeapons: ['gladius_standard', 'gladius_standard', T4_RANGER_BOW_RANGED_ID],
      ownedMounts: ['horse', 'horse-t1', 'horse-t2'], ownedHorseTiers: [1, 2, 3], equipment: { melee: 'gladius_standard' },
      personalSquad: { members: [{ id: 'personal:s', type: 'soldier' }, { id: 'personal:c', type: 'captain' }, { id: 'personal:r', type: 'ranger' }] } }
    const loaded = parseCareerProfile(legacy)!
    expect(careerItemTotal(loaded, 'gladius_standard')).toBe(2); expect(availableCareerItem(loaded, 'gladius_standard')).toBe(0)
    expect(careerItemTotal(loaded, T4_RANGER_BOW_RANGED_ID)).toBe(2)
    expect(availableCareerItem(loaded, T4_RANGER_BOW_RANGED_ID)).toBe(1)
    expect(careerItemTotal(loaded, 'horse')).toBe(3); expect(loaded.personalSquad!.members.map(member => member.originalHirePrice)).toEqual([50, 500, 500])
    expect(parseCareerProfile(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded); balanced(loaded)
  })
  it('rejects a save that allocates one weapon copy to two Ranger squad members', () => {
    const h = harness(); h.hire('ranger'); h.hire('ranger')
    const invalid = cloneCareerProfile(h.read()); invalid.inventory!.quantities.centurion_blade = 1
    expect(parseCareerProfile(invalid)).toBeNull()
  })
  it('atomically migrates legacy Ranger and resident receipts once, preserving choices and mounts across failed-save retry', () => {
    const legacy: CareerProfile = { ...createCareerProfile('viking'), rank: 'captain', totalMerit: 6000, availableMerit: 1234,
      inventory: { version: 1, quantities: { heavy_lance: 1, scutum_t2: 1, [T4_RANGER_BOW_RANGED_ID]: 1, horse: 1, 'black-cat': 1, xongkoro: 1 } },
      equipment: { ranged: T4_RANGER_BOW_RANGED_ID }, personalSquad: { members: [
        { id: 'personal:ghost', type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } },
        { id: 'personal:custom', type: 'ranger', equipment: { melee: 'heavy_lance', ranged: null, shield: 'scutum_t2', mount: 'horse' } },
        { id: 'personal:empty', type: 'ranger', equipment: { melee: null, ranged: null, shield: null, mount: 'black-cat' } },
      ] }, townEquipment: { viking: { version: 1, nativeReserve: [], actors: {
        merchant: { melee: { itemId: 'paladin_sword_t4', source: 'native', nativeId: 'viking/merchant/melee' },
          ranged: null, shield: { itemId: 'paladin_shield_t4', source: 'native', nativeId: 'viking/merchant/shield' }, mount: null },
        'civilian-0': { melee: null, ranged: null, shield: null, mount: null },
      } } } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), bytes = JSON.stringify(legacy)
    storage.setItem(CAREER_STORAGE_KEY, bytes); storage.failWrites = true
    let writes = 0
    const write = storage.setItem.bind(storage)
    storage.setItem = (key, value) => { writes++; write(key, value) }
    expect(store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    expect(writes).toBe(1)
    storage.failWrites = false
    const loaded = store.loadChecked().profile!
    expect(loaded).not.toBeNull()
    expect(loaded.availableMerit).toBe(1234)
    expect(loaded.inventory!.quantities).toEqual({ ...legacy.inventory!.quantities, viking_axe_t3: 2, [T4_RANGER_BOW_RANGED_ID]: 3 })
    expect(loaded.personalSquad!.members[1].equipment).toEqual(legacy.personalSquad!.members[1].equipment)
    expect(loaded.personalSquad!.members.map(member => member.equipment!.mount)).toEqual(['xongkoro', 'horse', 'black-cat'])
    expect(loaded.personalSquad!.members.every(member => member.rangerEquipmentVersion === 1)).toBe(true)
    expect(loaded.townEquipment!.viking).toMatchObject({ residentEquipmentVersion: 1, actors: {
      merchant: { melee: { itemId: 'sword_t5', source: 'native', nativeId: 'viking/merchant/melee' } },
      'civilian-0': { melee: { itemId: 'gladius_rusty', source: 'native', nativeId: 'viking/civilian-0/melee' } },
    } })
    expect(availableCareerItem(loaded, 'viking_axe_t3')).toBe(0)
    expect(availableCareerItem(loaded, T4_RANGER_BOW_RANGED_ID)).toBe(0)
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!)).toEqual(loaded)
    expect(store.loadChecked().profile).toEqual(loaded)
    expect(writes).toBe(2)
    balanced(loaded)
  })
})
