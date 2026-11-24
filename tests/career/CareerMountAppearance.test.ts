import { afterEach, describe, expect, it, vi } from 'vitest'
import { CareerMountController, careerMountAppearanceVariant } from '../../src/career/CareerMountController'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { addCareerItem } from '../../src/career/CareerInventory'
import { MountArmor } from '../../src/combat/MountArmor'
import { Vector3 } from 'three'
import { MemoryStorage } from '../helpers/memoryStorage'
import { HorseAssetRegistry } from '../../src/world/HorseAssetRegistry'
import * as MountModule from '../../src/world/Mount'
import { sellTownProduct } from '../../src/town/TownRules'

// The Mount render constructor is the external boundary: a numeric stand-in with the
// HP/armor rules the controller reads. No scene, actor, model or visual is constructed.
interface MountStub { type: string; maxHp: number; currentHp: number; armorImpactMax: number; armorImpactRemaining: number
  setAppearanceVariant: ReturnType<typeof vi.fn> }
function stubMountConstruction(setAppearanceVariant = vi.fn()) {
  const built: MountStub[] = []
  vi.spyOn(MountModule, 'Mount').mockImplementation(function (_scene: unknown, type: string) {
    const armored = type === MountModule.MountType.ARMORED_HORSE
    const mount = { type, maxHp: armored ? 600 : 100, currentHp: armored ? 600 : 100, armorImpactMax: armored ? 50 : 0, armorImpactRemaining: 0,
      dead: false, isFlyingMount: false, isAirborne: false, onDeathCallbacks: [], group: { position: new Vector3(), rotation: { y: 0 } },
      restoreArmor(value?: number) { mount.armorImpactRemaining = value ?? mount.armorImpactMax },
      setAppearanceVariant, setCameraDistance() {}, update() {}, dispose() {} }
    built.push(mount)
    return mount as unknown as MountModule.Mount
  })
  return built
}
/** Real controller over a saving store; only the Player boundary is a numeric double. */
function controllerFor(read: () => CareerProfile, commit: (profile: CareerProfile) => boolean) {
  const player = { isFalling: false, isMounted: false, currentMount: null as unknown, facingYaw: 0,
    combatPosition: new Vector3(), position: new Vector3(),
    mountVehicle(mount: unknown) { player.currentMount = mount; player.isMounted = true },
    dismountFromMount() { player.currentMount = null; player.isMounted = false } }
  return new CareerMountController({} as never, () => player as never, read, commit, () => [], () => [])
}
function savingStore(initial: CareerProfile, memory = new MemoryStorage()) {
  const store = new CareerProfileStore(memory)
  expect(store.save(cloneCareerProfile(initial))).toBe(true)
  let current = cloneCareerProfile(initial)
  return { store, memory, read: () => current,
    commit: (next: CareerProfile) => { if (!store.save(next)) return false; current = cloneCareerProfile(next); return true } }
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
    const save = savingStore(profile())
    const apply = vi.fn(() => {
      expect(save.store.load()!.horseAppearanceVariant).toBe(variant)
      expect(save.read().horseAppearanceVariant).toBe(variant)
    })
    stubMountConstruction(apply)
    const owner = controllerFor(save.read, save.commit)
    expect(owner.activate('horse')).toBe(true)
    const before = save.read()
    expect(owner.setAppearanceVariant(variant)).toBe(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(variant)
    expect(careerMountAppearanceVariant(save.store.load()!)).toBe(variant)
    expect(owner.statusText).toBe('戰馬毛色已保存。')
    expect([save.read().availableMerit, save.read().selectedMountId]).toEqual([before.availableMerit, before.selectedMountId])
  })

  it('purges unowned mount armor on resale and syncOwnership so re-purchasing starts with full 50 armor', () => {
    const current = profile(); addCareerItem(current, 'armored-horse', 1)
    current.mountArmor = { 'armored-horse': 0 }
    vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockReturnValue(true)
    const built = stubMountConstruction()
    let read = current
    const controller = controllerFor(() => read, next => { read = next; return true })
    const sold = sellTownProduct(current, 'armored-horse')
    expect(sold.sold).toBe(true)
    expect(sold.profile.mountArmor).toBeUndefined()
    read = sold.profile
    controller.syncOwnership()
    // Re-purchase after the ownership sync: the new armored horse is not the depleted one.
    const bought = cloneCareerProfile(sold.profile); addCareerItem(bought, 'armored-horse', 1)
    read = bought
    controller.syncOwnership()
    expect(controller.activate('armored-horse')).toBe(true)
    expect(built.map(mount => mount.armorImpactRemaining)).toEqual([50])
    expect(read.mountArmor).toBeUndefined()
  })

  it('persists mount armor during town hostile combat without activeMission, retains 10/50 across reload and retries a failed save', () => {
    const current = profile()
    addCareerItem(current, 'armored-horse', 1)
    current.selectedMountId = 'armored-horse'
    current.townEvent = { id: 'town-hostile-1', state: 'hostile' }
    current.mountArmor = { 'armored-horse': 50 }
    vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockReturnValue(true)
    const built = stubMountConstruction()
    const save = savingStore(current)
    const controller = controllerFor(save.read, save.commit)
    expect(controller.activate('armored-horse')).toBe(true)
    const [mount] = built
    expect(mount.armorImpactRemaining).toBe(50)
    mount.armorImpactRemaining = 10
    controller.update(0.016)
    expect(save.read().mountArmor).toEqual({ 'armored-horse': 10 })
    expect(save.store.load()!.mountArmor).toEqual({ 'armored-horse': 10 })

    // Reload from the saved profile: the summoned horse keeps 10/50.
    const reloaded = savingStore(save.store.load()!)
    expect(controllerFor(reloaded.read, reloaded.commit).activate('armored-horse')).toBe(true)
    expect(built[1].armorImpactRemaining).toBe(10)

    // A failed save is not reported as persisted: the next frame retries without new damage.
    save.memory.writable = false
    mount.armorImpactRemaining = 5
    controller.update(0.016)
    expect(save.store.load()!.mountArmor).toEqual({ 'armored-horse': 10 })
    save.memory.writable = true
    controller.update(0.016)
    expect(save.store.load()!.mountArmor).toEqual({ 'armored-horse': 5 })
  })
})
