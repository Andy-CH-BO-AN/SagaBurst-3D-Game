import { describe, expect, it, vi } from 'vitest'
import { CareerMountController, careerMountAppearanceVariant } from '../../src/career/CareerMountController'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { addCareerItem } from '../../src/career/CareerInventory'
import { MountArmor } from '../../src/combat/MountArmor'
import { MemoryStorage } from '../helpers/memoryStorage'
import { HorseAssetRegistry, type HorseAppearanceVariant } from '../../src/world/HorseAssetRegistry'

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

  it.each([0, 1, 2] as const)('commits coat %i before updating the live horse and survives clone/save/reload', variant => {
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

  it('keeps the saved and live coat when persistence rejects the change', () => {
    const p = profile(), apply = vi.fn(), commit = vi.fn(() => false)
    expect(entry(() => p, commit, apply).setAppearanceVariant(2)).toBe(false)
    expect(p.horseAppearanceVariant).toBe(0); expect(apply).not.toHaveBeenCalled()
  })

  it('blocks appearance changes during a race before persisting or touching the mount', () => {
    // This boundary reads only the presence of the race, not its runtime/render state.
    const p = profile(); p.activeRace = {} as NonNullable<CareerProfile['activeRace']>
    const apply = vi.fn(), commit = vi.fn()
    expect(entry(() => p, commit, apply).setAppearanceVariant(1)).toBe(false)
    expect(commit).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
  })

  it('normalizes a legacy save without an appearance to grey independently of legacy horse tier', () => {
    const p = profile(); delete p.horseAppearanceVariant
    p.ownedHorseTiers = [3]; p.selectedMountId = 'horse-t3'
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(p)))!
    expect(loaded.selectedMountId).toBe('horse')
    expect(careerMountAppearanceVariant(loaded)).toBe(0)
  })

  it('reports explicit error and preserves save state without substituting an ordinary horse when armored warhorse asset is unavailable', async () => {
    HorseAssetRegistry.resetForTesting()
    const current = profile(); addCareerItem(current, 'armored-horse', 1)
    current.rank = 'commander'; current.selectedMountId = 'armored-horse'
    current.activeMission = { kind: 'outpost-relief', mountState: { activeMountId: 'armored-horse', hp: { 'armored-horse': 600 }, unavailable: [] } } as unknown as CareerProfile['activeMission']
    const preloadSpy = vi.spyOn(HorseAssetRegistry, 'preloadArmored').mockRejectedValue(new Error('GLB 404'))
    const controller = Object.create(CareerMountController.prototype) as CareerMountController
    Object.assign(controller as unknown as object, {
      scene: {}, player: () => ({ isFalling: false, currentMount: null }), readProfile: () => current,
      commit: vi.fn(() => true), obstacles: () => [], occupied: () => [], sceneKey: () => 'town-home', options: {},
      hp: new Map([['armored-horse', 600]]), armorImpact: new Map([['armored-horse', 50]]), unavailable: new Set(),
      active: null, requestSeq: 0, pending: null, statusText: '',
    })

    // Restoring active mount when armored horse is unavailable fails cleanly without mutating selectedMountId
    expect(controller.restoreActiveMount()).toBe(false)
    expect(controller.activeMountId).toBeNull()
    expect(current.selectedMountId).toBe('armored-horse')
    expect(controller.statusText).toContain('重甲戰馬資源載入失敗')

    // Explicit activation triggers preloadArmored, coalesces duplicate clicks, and reports failure
    expect(controller.activate('armored-horse')).toBe(false)
    expect(controller.activate('armored-horse')).toBe(false)
    expect(preloadSpy).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(controller.activeMountId).toBeNull()
    expect(current.selectedMountId).toBe('armored-horse')
    expect(controller.statusText).toContain('重甲戰馬資源載入失敗')
    preloadSpy.mockRestore()
  })
})
