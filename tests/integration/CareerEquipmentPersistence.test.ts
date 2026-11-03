import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { WeaponWheel } from '../../src/player/WeaponWheel'
import { TownEquipment } from '../../src/town/TownEquipment'
import { purchaseTownEquipment } from '../../src/town/TownRules'
import { addCareerItem } from '../../src/career/CareerInventory'
import { deferCareerTutorial } from '../../src/career/CareerTutorial'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('Career equipment persistence wiring', () => {
  it('reports invalid equipment saves without converting retired IDs or overwriting the original', () => {
    const raw = { ...createCareerProfile('roman'), inventory: { version: 1, quantities: { lance_t4: 1, spear_t4: 2 } },
      equipment: { melee: 'lance_t4' } }
    const bytes = JSON.stringify(raw)
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, bytes]] })
    const store = new CareerProfileStore(storage)
    expect(store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    expect(parseCareerProfile({ ...raw, inventory: { version: 1, quantities: { 'maki-ranger-bow': 1 } } })).toBeNull()
  })
  it('keeps an unarmed Career empty until its first saved purchase, then persists selection exclusivity and failed writes', () => {
    let profile = createCareerProfile('roman')
    deferCareerTutorial(profile, 'recruit')
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    profile = store.load()!
    let canSave = true
    const commit = (next: typeof profile) => { if (!canSave || !store.save(next)) return false; profile = next; return true }
    const inv = new TownEquipment(() => profile, commit)
    inv.prepareForCombat()
    expect(inv.saveState.items).toEqual([])
    expect(inv.meleeEnabled || inv.rangedEnabled || inv.shieldEnabled).toBe(false)
    expect(new WeaponWheel().cycle(inv, 1)).toBeNull()
    expect(profile.ownedWeapons).toEqual([])
    expect(profile.starterWeaponId).toBeUndefined()
    // The first permanent weapon comes from the same canonical transaction as the Town shop.
    profile.totalMerit = 100; profile.availableMerit = 100
    const purchase = purchaseTownEquipment(profile, 'gladius_rusty')
    expect(purchase.purchased).toBe(true)
    expect(commit(purchase.profile)).toBe(true)
    expect(profile.availableMerit).toBe(0)
    expect(profile.ownedWeapons).toEqual(['gladius_rusty'])
    expect(profile.tutorial?.purchases.weaponIds).toEqual(['gladius_rusty'])
    expect(profile.starterWeaponId).toBeUndefined()
    expect(inv.equipWeapon('gladius_rusty')).toBe(true)
    expect(store.load()!.equipment?.melee).toBe('gladius_rusty')
    addCareerItem(profile, 'pilum_basic', 1)
    addCareerItem(profile, 'scutum_t1', 1)
    expect(commit(profile)).toBe(true)
    expect(inv.rangedEnabled).toBe(false)
    expect(inv.equipWeapon('pilum_basic')).toBe(true)
    expect(inv.equipWeapon('scutum_t1')).toBe(true)
    expect(profile.equipment?.ranged).toBeUndefined()
    canSave = false
    expect(inv.equipWeapon('pilum_basic')).toBe(false)
    expect(inv.isEquipped('scutum_t1')).toBe(true)
    canSave = true
    expect(inv.equipWeapon('pilum_basic')).toBe(true)
    expect(profile.equipment?.shield).toBeNull()
    expect(store.save(profile)).toBe(true)
    profile = store.load()!
    const returned = new TownEquipment(() => profile, () => true)
    returned.prepareForCombat()
    expect(returned.isEquipped('pilum_basic')).toBe(true)
    expect(returned.equippedShield).toBeNull()
    returned.sheathAll()
    expect(new WeaponWheel().cycle(returned, 1)).toBe('pilum_basic')
  })
})
