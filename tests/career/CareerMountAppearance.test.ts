import { afterEach, describe, expect, it, vi } from 'vitest'
import { CareerMountController, careerMountAppearanceVariant } from '../../src/career/CareerMountController'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { addCareerItem } from '../../src/career/CareerInventory'
import { MountArmor } from '../../src/combat/MountArmor'
import { Vector3 } from 'three'
import { MemoryStorage } from '../helpers/memoryStorage'
import { HorseAssetRegistry, type HorseAppearanceVariant } from '../../src/world/HorseAssetRegistry'
import { sellTownProduct } from '../../src/town/TownRules'

// Exercise the transaction owner without a scene, Player or Mount constructor.
interface AppearanceEntry { setAppearanceVariant(variant: HorseAppearanceVariant): boolean }
function entry(readProfile: () => CareerProfile, commit: (profile: CareerProfile) => boolean,
  setAppearanceVariant = vi.fn()): AppearanceEntry {
  return Object.assign(Object.create(CareerMountController.prototype) as AppearanceEntry, {
    readProfile, commit, active: { mount: { setAppearanceVariant } },
  })
}
function profile(): CareerProfile {
  const p = createCareerProfile('roman'); addCareerItem(p, 'horse', 1); return p
}

afterEach(() => { vi.restoreAllMocks(); HorseAssetRegistry.resetForTesting() })

describe('Career horse appearance transactions', () => {
  it('roundtrips depleted owned mount armor and migrates an old snow leopard without repairing a saved zero', () => {
    const store = new CareerProfileStore(new MemoryStorage()), current = profile()
    addCareerItem(current, 'armored-horse', 1); addCareerItem(current, 'snow-leopard', 1)
    current.selectedMountId = 'armored-horse'; current.mountArmor = { 'armored-horse': 0, 'snow-leopard': 17 }
    expect(store.save(cloneCareerProfile(current))).toBe(true)
    const loaded = store.load()!
    expect(loaded.selectedMountId).toBe('armored-horse')
    expect(loaded.mountArmor).toEqual({ 'armored-horse': 0, 'snow-leopard': 17 })
    const restored = new MountArmor('ARMORED_HORSE'); restored.restore(loaded.mountArmor!['armored-horse'])
    expect(restored.remaining).toBe(0)
    delete current.mountArmor
    const legacy = parseCareerProfile(current)!
    const leopard = new MountArmor('SNOW_LEOPARD'); leopard.restore(legacy.mountArmor?.['snow-leopard'])
    expect(leopard.remaining).toBe(50)
  })

  it('commits a changed coat before updating the live horse and survives clone/save/reload', () => {
    const variant = 1 as const
    const store = new CareerProfileStore(new MemoryStorage())
    let current = profile()
    const apply = vi.fn(() => {
      expect(store.load()!.horseAppearanceVariant).toBe(variant)
      expect(current.horseAppearanceVariant).toBe(variant)
    })
    const owner = entry(() => current, next => {
      if (!store.save(next)) return false
      current = cloneCareerProfile(next); return true
    }, apply)
    expect(owner.setAppearanceVariant(variant)).toBe(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(variant)
    expect(careerMountAppearanceVariant(store.load()!)).toBe(variant)
    expect(current.availableMerit).toBe(0)
    expect(current.selectedMountId).toBeUndefined()
  })

  it('normalizes a legacy save without an appearance to grey independently of legacy horse tier', () => {
    const p = profile(); delete p.horseAppearanceVariant
    p.ownedHorseTiers = [3]; p.selectedMountId = 'horse-t3'
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(p)))!
    expect(loaded.selectedMountId).toBe('horse')
    expect(careerMountAppearanceVariant(loaded)).toBe(0)
  })

  it('purges unowned mount armor on resale and syncOwnership so re-purchasing starts with full 50 armor', () => {
    const current = profile(); addCareerItem(current, 'armored-horse', 1)
    current.mountArmor = { 'armored-horse': 0 }
    const sold = sellTownProduct(current, 'armored-horse')
    expect(sold.sold).toBe(true)
    expect(sold.profile.mountArmor).toBeUndefined()
    const controller = Object.create(CareerMountController.prototype) as CareerMountController
    const armorImpact = new Map([['armored-horse', 0]])
    Object.assign(controller as unknown as object, {
      readProfile: () => sold.profile, sceneKey: () => 'town-home', options: {},
      hp: new Map(), unavailable: new Set(), armorImpact, active: null, cancelPending: vi.fn(),
    })
    controller.syncOwnership()
    expect(armorImpact.has('armored-horse')).toBe(false)
    const fresh = new MountArmor('ARMORED_HORSE')
    fresh.restore(armorImpact.get('armored-horse'))
    expect(fresh.remaining).toBe(50)
  })

  it('persists mount armor during town hostile combat without activeMission and retains 10/50 across reload', () => {
    const memory = new MemoryStorage()
    const store = new CareerProfileStore(memory)
    let current = profile()
    addCareerItem(current, 'armored-horse', 1)
    current.selectedMountId = 'armored-horse'
    current.activeMission = undefined
    current.townEvent = { id: 'town-hostile-1', state: 'hostile' }
    current.mountArmor = { 'armored-horse': 50 }
    expect(store.save(cloneCareerProfile(current))).toBe(true)

    const mountMock = {
      currentHp: 600,
      maxHp: 600,
      armorImpactMax: 50,
      armorImpactRemaining: 10,
      dead: false,
      isFlyingMount: false,
      group: { position: new Vector3() },
      setCameraDistance: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    }

    const controller = Object.create(CareerMountController.prototype) as CareerMountController
    Object.assign(controller as unknown as object, {
      player: () => ({ position: new Vector3() }),
      readProfile: () => current,
      commit: vi.fn((next: CareerProfile) => {
        if (!store.save(next)) return false
        current = cloneCareerProfile(next)
        return true
      }),
      obstacles: () => [],
      hp: new Map([['armored-horse', 600]]),
      armorImpact: new Map([['armored-horse', 50]]),
      unavailable: new Set(),
      active: { id: 'armored-horse', mount: mountMock },
      resourcesDirty: false,
      statusText: '',
    })

    controller.update(0.016)

    expect(current.mountArmor).toEqual({ 'armored-horse': 10 })
    const saved = store.load()!
    expect(saved.mountArmor).toEqual({ 'armored-horse': 10 })

    // Reload with saved profile: retains 10/50
    const reloadedArmorMap = new Map<string, number>()
    if (saved.mountArmor) {
      for (const [id, value] of Object.entries(saved.mountArmor)) {
        if (typeof value === 'number') reloadedArmorMap.set(id, value)
      }
    }
    expect(reloadedArmorMap.get('armored-horse')).toBe(10)
    const reloadedArmor = new MountArmor('ARMORED_HORSE')
    reloadedArmor.restore(reloadedArmorMap.get('armored-horse'))
    expect(reloadedArmor.remaining).toBe(10)

    // Save failure must return false and mark resourcesDirty, not pretend persistence succeeded
    memory.writable = false
    const failingMountMock = { ...mountMock, armorImpactRemaining: 5 }
    const failingController = Object.create(CareerMountController.prototype) as CareerMountController
    Object.assign(failingController as unknown as object, {
      player: () => ({ position: new Vector3() }),
      readProfile: () => current,
      commit: vi.fn((next: CareerProfile) => store.save(next)),
      obstacles: () => [],
      hp: new Map([['armored-horse', 600]]),
      armorImpact: new Map([['armored-horse', 10]]),
      unavailable: new Set(),
      active: { id: 'armored-horse', mount: failingMountMock },
      resourcesDirty: false,
      statusText: '',
    })
    failingController.update(0.016)
    expect((failingController as any).resourcesDirty).toBe(true)
  })
})
