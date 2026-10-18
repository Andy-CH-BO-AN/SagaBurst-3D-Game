import { describe, expect, it, vi } from 'vitest'
import { CareerMountController, careerMountAppearanceVariant } from '../../src/career/CareerMountController'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { addCareerItem } from '../../src/career/CareerInventory'
import { MemoryStorage } from '../helpers/memoryStorage'
import type { HorseAppearanceVariant } from '../../src/world/HorseAssetRegistry'

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
})
