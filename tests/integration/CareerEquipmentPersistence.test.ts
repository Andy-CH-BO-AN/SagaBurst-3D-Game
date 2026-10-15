import { describe, expect, it } from 'vitest'
import { availableCareerItem, careerItemAllocated } from '../../src/career/CareerInventory'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { WeaponWheel } from '../../src/player/WeaponWheel'
import { TownEquipment } from '../../src/town/TownEquipment'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('Career equipment persistence wiring', () => {
  it.each([
    ['negative alias quantity', { spear_t4: 2, lance_t4: -1 }],
    ['overflow after merging aliases', { spear_t4: Number.MAX_SAFE_INTEGER, lance_t4: 1 }],
  ])('rejects %s instead of hiding invalid quantities during migration', (_scenario, quantities) => {
    expect(parseCareerProfile({ ...createCareerProfile('roman'), inventory: { version: 1, quantities } })).toBeNull()
  })
  it('merges both T4 polearm quantities and migrates player, HR and Town allocations without losing or duplicating copies', () => {
    const raw = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 60000,
      ownedWeapons: ['lance_t4', 'spear_t4'], inventory: { version: 1, quantities: { lance_t4: 3, spear_t4: 2 } },
      equipment: { melee: 'lance_t4' },
      personalSquad: { members: [{ id: 'personal:alias', type: 'soldier', equipment: { melee: 'lance_t4', ranged: null, shield: null, mount: null } }] },
      townEquipment: { roman: { version: 1, actors: { 'civilian-0': { melee: { itemId: 'lance_t4', source: 'inventory' }, ranged: null, shield: null, mount: null } }, nativeReserve: [] } },
    }
    const storage = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, JSON.stringify(raw)]] })
    const store = new CareerProfileStore(storage), loaded = store.load()!
    expect(loaded).not.toBeNull()
    expect(loaded.inventory?.quantities).toEqual({ spear_t4: 5 })
    expect(loaded.ownedWeapons).toEqual(['spear_t4'])
    expect(loaded.equipment?.melee).toBe('spear_t4')
    expect(loaded.personalSquad?.members[0].equipment?.melee).toBe('spear_t4')
    expect(loaded.townEquipment?.roman?.actors['civilian-0'].melee?.itemId).toBe('spear_t4')
    expect(careerItemAllocated(loaded, 'spear_t4')).toBe(3)
    expect(availableCareerItem(loaded, 'spear_t4')).toBe(2)
    expect(new TownEquipment(() => loaded, () => true).inventoryStacks.map(({ item }) => item.id)).toEqual(['spear_t4'])
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(JSON.stringify(raw))
    expect(store.save(loaded)).toBe(true)
    expect(store.load()?.inventory?.quantities).toEqual({ spear_t4: 5 })
    expect(storage.getItem(CAREER_STORAGE_KEY)).not.toContain('lance_t4')
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
