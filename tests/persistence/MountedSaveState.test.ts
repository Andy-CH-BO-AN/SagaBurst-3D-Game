import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { DEFAULT_SAVE, PlayerSaveData, SaveManager } from '../../src/save/SaveManager'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('SaveManager current-format persistence', () => {
  let saveManager: SaveManager

  let mockStorage: MemoryStorage

  beforeEach(() => {
    mockStorage = new MemoryStorage()
    vi.stubGlobal('localStorage', mockStorage)
    saveManager = new SaveManager()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips xongkoro flight and HP, and a separate pending rider fall through JSON storage', () => {
    const flight = { phase: 'cruise' as const, yaw: .7, pitch: .2, bank: -.3, speed: 13.333333333,
      velocity: { x: 8, y: 2, z: 10 } }
    expect(saveManager.save({ ...DEFAULT_SAVE, mountData: {
      isMounted: true, type: 'xongkoro', hp: 83.5, position: { x: 40, y: 60, z: 20 }, flight,
    } })).toBe(true)
    const loaded = saveManager.load()!
    expect(loaded.mountData).toMatchObject({ type: 'xongkoro', hp: 83.5, flight })
    const falling = { active: true, highestFeetY: 71.4, velocity: { x: 8, y: -10, z: 10 } }
    expect(saveManager.save({ ...DEFAULT_SAVE, hp: 50, position: { x: 40, y: 60, z: 20 }, falling })).toBe(true)
    expect(saveManager.load()).toMatchObject({ hp: 50, falling })
    expect(saveManager.load()?.mountData).toBeUndefined()
  })

  it('rejects malformed aerial state without changing the stored bytes', () => {
    const bytes = JSON.stringify({ ...DEFAULT_SAVE, hp: 50,
      mountData: { isMounted: true, type: 'xongkoro', hp: 80, position: { x: 1, y: 40, z: 2 },
        flight: { phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 13 } } })
    mockStorage.setItem('sagaburst_game_v2', bytes)
    expect(saveManager.load()).toBeNull()
    expect(saveManager.save(DEFAULT_SAVE)).toBe(false)
    expect(mockStorage.getItem('sagaburst_game_v2')).toBe(bytes)
  })

  it('contract: preserves full inventory items and equippedShieldId across save and load', () => {
    const inventory = new InventoryManager()
    const state = inventory.saveState

    const saveData: PlayerSaveData = {
      ...DEFAULT_SAVE,
      inventory: state,
    }

    expect(saveManager.save(saveData)).toBe(true)
    const loaded = saveManager.load()!

    expect(loaded.inventory.equippedMeleeId).toBe('steel_lance')
    expect(loaded.inventory.equippedRangedId).toBe('elven_runebow')
    expect(loaded.inventory.equippedShieldId).toBe('round_shield_t3')

    const loadedIds = loaded.inventory.items?.map(i => i.id)
    expect(loadedIds).toEqual(
      expect.arrayContaining(['steel_lance', 'runic_greatsword', 'elven_runebow', 'round_shield_t3'])
    )

    // Restore to a fresh InventoryManager
    const freshInv = new InventoryManager()
    freshInv.loadSaveState(loaded.inventory)
    expect(freshInv.equippedMelee?.id).toBe('steel_lance')
    expect(freshInv.equippedRanged.id).toBe('elven_runebow')
    expect(freshInv.equippedShield?.id).toBe('round_shield_t3')
    expect(freshInv.isEquipped('runic_greatsword')).toBe(false)
  })

  it('ignores historical storage and rejects an unsupported format without rewriting either key', () => {
    const bytes = JSON.stringify({ version: 1, hp: 85, inventory: { ownedWeaponIds: ['steel_sword'] } })
    mockStorage.setItem('wdyh_save_v1', bytes)
    expect(saveManager.load()).toBeNull()
    expect(saveManager.hasSave()).toBe(false)
    expect(mockStorage.getItem('wdyh_save_v1')).toBe(bytes)
    mockStorage.setItem('sagaburst_game_v2', bytes)
    expect(saveManager.load()).toBeNull()
    expect(saveManager.save(DEFAULT_SAVE)).toBe(false)
    expect(mockStorage.getItem('sagaburst_game_v2')).toBe(bytes)
  })
})
