import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { WeaponWheel } from '../../src/player/WeaponWheel'
import { TownEquipment } from '../../src/town/TownEquipment'
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
  it('Career selection persists exclusivity, respects failed writes and restores after returning', () => {
    let profile = createCareerProfile('roman')
    profile.ownedWeapons = ['gladius_rusty', 'pilum_basic']
    profile.ownedArmors = ['scutum_t1']
    let canSave = true
    const inv = new TownEquipment(() => profile, next => { if (!canSave) return false; profile = next; return true })
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
    const store = new CareerProfileStore(new MemoryStorage())
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
