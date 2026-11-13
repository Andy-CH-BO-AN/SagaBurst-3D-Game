import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { showEquipmentLoadNotice } from '../../src/ui/EquipmentLoadNotice'
import { BYZANTINE_EQUIPMENT_WAIT_MS, byzantineEquipmentStatus, isEquipmentDemanded, isEquipmentReady, prepareByzantineEquipment, resetHighTierEquipmentForTest } from '../../src/world/HighTierEquipment'

describe('Shared immediate weapon wheel', () => {

  it('excludes a ranged weapon from shields through equip and save/load', () => {
    const ranged = 'wooden_shortbow'
    const inv = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: ranged, shieldId: 'scutum_t1' }, 'maki-archer-t4', 'roman')
    expect(inv.equippedMelee?.id).toBe('gladius_rusty')
    inv.addWeapon('paladin_mace_t4')
    expect(inv.equipWeapon('paladin_mace_t4')).toBe(true)
    expect(inv.equipWeapon(ranged)).toBe(true)
    const restored = new InventoryManager(undefined, 'maki-archer-t4', 'roman'); restored.loadSaveState(inv.saveState)
    expect(restored.isEquipped(ranged)).toBe(true)
    expect(restored.equippedShield).toBeNull()
    restored.equipWeapon('scutum_t1')
    const guarded = new InventoryManager(undefined, 'maki-archer-t4', 'roman'); guarded.loadSaveState(restored.saveState)
    expect(guarded.isEquipped(ranged)).toBe(false)
    expect(guarded.isEquipped('scutum_t1')).toBe(true)
    guarded.unequipShield()
    expect(guarded.isEquipped(ranged)).toBe(false)
  })

  it('discards invalid saved items without converting IDs or granting replacement stock', () => {
    const inv = new InventoryManager(undefined, 'maki-archer-t4')
    inv.loadSaveState({ items: [{ id: 'lance_t4', quantity: 1 }, { id: 'maki-ranger-bow', quantity: 1 },
      { id: 'missing-weapon', quantity: 1 }, { id: 'paladin_mace_t4', quantity: 2 }, { id: 'maki-ranger-bow-ranged', quantity: 1 }],
      equippedMeleeId: 'lance_t4', equippedRangedId: 'maki-ranger-bow-ranged' })
    expect(inv.equippedMelee?.id).toBe('paladin_mace_t4')
    expect(inv.saveState.items).toEqual([{ id: 'paladin_mace_t4', quantity: 2 }, { id: 'maki-ranger-bow-ranged', quantity: 1 }])
    expect(inv.canEquipWeapon('lance_t4')).toBe(false)
    expect(inv.canEquipWeapon('maki-ranger-bow')).toBe(false)
    expect(inv.isEquipped('maki-ranger-bow-ranged')).toBe(true)
    const saved = inv.saveState
    inv.loadSaveState(saved)
    expect(inv.saveState).toEqual(saved)
  })
})

vi.mock('../../src/ui/EquipmentLoadNotice', () => ({ showEquipmentLoadNotice: vi.fn() }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {
  async parseAsync() { return { scene: { traverse() {} } } }
} }))
const gltfLoads = { next: [] as Array<() => Promise<unknown>>, count: 0 }
const LANCE = 'byzantine_standard_lance_t5'
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })

describe('InventoryManager model availability and demand ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    gltfLoads.count = 0; gltfLoads.next = []
    resetHighTierEquipmentForTest()
    vi.stubGlobal('fetch', () => { gltfLoads.count++; return (gltfLoads.next.shift() ?? (() => new Promise(() => {})))() })
  })
  afterEach(() => { resetHighTierEquipmentForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(showEquipmentLoadNotice).mockClear() })

it('gives the player no combat effect until the lance loads, retries after a timeout and keeps the saved selection', async () => {
    const inventory = new InventoryManager({ meleeWeaponId: LANCE, rangedWeaponId: 'elven_runebow', shieldId: 'round_shield_t1' })
    inventory.addWeapon('steel_lance')

    // Forever-pending load: selected and saved, but neither stats nor model apply. Other slots are untouched.
    expect(inventory.activeMelee).toBeUndefined()
    expect(gltfLoads.count).toBe(1)
    expect(inventory.saveState.equippedMeleeId).toBe(LANCE)
    expect(inventory.equippedShield?.id).toBe('round_shield_t1')
    expect(inventory.equippedRanged.id).toBe('elven_runebow')

    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(byzantineEquipmentStatus(LANCE)).toBe('failed')
    expect(showEquipmentLoadNotice).toHaveBeenCalledTimes(1)
    expect(inventory.activeMelee).toBeUndefined()
    expect(gltfLoads.count).toBe(1) // paced: no retry on every frame

    // Re-equipping starts a brand new request at once.
    let finishRetry = (_: unknown) => {}
    gltfLoads.next.push(() => new Promise(resolve => { finishRetry = resolve }))
    inventory.equipWeapon('steel_lance')
    expect(inventory.activeMelee?.id).toBe('steel_lance')
    inventory.equipWeapon(LANCE)
    expect(gltfLoads.count).toBe(2)
    expect(inventory.activeMelee?.id).toBe('steel_lance') // the original stays in hand until the new one is ready

    const reentered = new InventoryManager({ meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null })
    reentered.addWeapon(LANCE)
    expect(reentered.activeMelee?.id).toBe('steel_lance')
    reentered.loadSaveState(inventory.saveState)
    expect(reentered.activeMelee).toBeUndefined() // save re-entry never promotes another weapon to stand in

    finishRetry(response())
    await vi.advanceTimersByTimeAsync(0)
    expect(byzantineEquipmentStatus(LANCE)).toBe('ready')
    expect(inventory.activeMelee?.id).toBe(LANCE)
    expect(reentered.activeMelee?.id).toBe(LANCE)
    expect(gltfLoads.count).toBe(2)
  })

it('separates status query from equipment selection: browsing backpack does not create demand or trigger failure notices', async () => {
    void prepareByzantineEquipment(['centurion_aquila_shield_t4'])
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null })
    inventory.addWeapon('centurion_aquila_shield_t4')

    // Viewing backpack item availability is a pure query without side-effects
    expect(inventory.itemAvailability('centurion_aquila_shield_t4')).toBe('模型載入中，暫時無法使用')
    expect(isEquipmentReady('centurion_aquila_shield_t4')).toBe(false)
    expect(isEquipmentDemanded('centurion_aquila_shield_t4')).toBe(false)

    // Background preload times out: unequipped item does NOT prompt player
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(byzantineEquipmentStatus('centurion_aquila_shield_t4')).toBe('failed')
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled()
    expect(isEquipmentDemanded('centurion_aquila_shield_t4')).toBe(false)

    // Formal equipping acquires demand, prompts player, and gives no fake shield stats
    inventory.equipWeapon('centurion_aquila_shield_t4')
    expect(isEquipmentDemanded('centurion_aquila_shield_t4')).toBe(true)
    expect(showEquipmentLoadNotice).toHaveBeenCalledTimes(1)
    expect(inventory.equippedShield).toBeNull() // unready model does not grant shield combat stats

    // Unequipping releases demand cleanly
    inventory.unequipShield()
    expect(isEquipmentDemanded('centurion_aquila_shield_t4')).toBe(false)
  })

it('releases an abandoned selection before its timeout without notifying the player', async () => {
  const inventory = new InventoryManager({ meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null })
  inventory.addWeapon(LANCE)
  inventory.equipWeapon(LANCE)
  expect(isEquipmentDemanded(LANCE)).toBe(true)
  inventory.equipWeapon('steel_lance')
  expect(isEquipmentDemanded(LANCE)).toBe(false)
  await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
  expect(byzantineEquipmentStatus(LANCE)).toBe('failed')
  expect(showEquipmentLoadNotice).not.toHaveBeenCalled()
  inventory.dispose()
})
})
