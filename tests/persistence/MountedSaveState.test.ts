import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { DEFAULT_SAVE, PlayerSaveData, SaveManager } from '../../src/save/SaveManager'
import { resolveMountSpawnPosition, resolveMountSpawnY } from '../../src/Game'
import { MemoryStorage } from '../helpers/memoryStorage'

describe('SaveManager Persistence & Migration Compatibility', () => {
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

  it('contract: DEFAULT_SAVE schema aligns with default mounted elite loadout', () => {
    expect(DEFAULT_SAVE.inventory.equippedMeleeId).toBe('steel_lance')
    expect(DEFAULT_SAVE.inventory.equippedRangedId).toBe('elven_runebow')
    expect(DEFAULT_SAVE.inventory.equippedShieldId).toBe('round_shield_t3')

    const defaultIds = DEFAULT_SAVE.inventory.items?.map(i => i.id)
    expect(defaultIds).toContain('steel_lance')
    expect(defaultIds).toContain('runic_greatsword')
    expect(defaultIds).toContain('elven_runebow')
    expect(defaultIds).toContain('round_shield_t3')
  })

  it('round-trips xongkoro flight and HP, and a separate pending rider fall through JSON storage', () => {
    const flight = { phase: 'cruise' as const, yaw: .7, pitch: .2, bank: -.3, speed: 13.333333333,
      velocity: { x: 8, y: 2, z: 10 } }
    expect(saveManager.save({ ...DEFAULT_SAVE, mountData: {
      isMounted: true, type: 'xongkoro', hp: 83.5, position: { x: 40, y: 60, z: 20 }, flight,
    } })).toBe(true)
    const loaded = saveManager.load()
    expect(loaded.mountData).toMatchObject({ type: 'xongkoro', hp: 83.5, flight })
    const falling = { active: true, highestFeetY: 71.4, velocity: { x: 8, y: -10, z: 10 } }
    expect(saveManager.save({ ...DEFAULT_SAVE, hp: 50, position: { x: 40, y: 60, z: 20 }, falling })).toBe(true)
    expect(saveManager.load()).toMatchObject({ hp: 50, falling, mountData: undefined })
  })

  it('drops malformed optional aerial fields at the JSON boundary while retaining the existing save', () => {
    mockStorage.setItem('wdyh_save_v1', JSON.stringify({
      ...DEFAULT_SAVE, hp: 50, position: { x: 40, y: 60, z: 20 },
      falling: { active: true, highestFeetY: 71.4 },
      mountData: { isMounted: true, type: 'xongkoro', hp: '200',
        flight: { phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 13 } },
    }))
    const loaded = saveManager.load()
    expect(loaded).toMatchObject({ hp: 50, position: { x: 40, y: 60, z: 20 }, mountData: { isMounted: true, type: 'xongkoro' } })
    expect(loaded.falling).toBeUndefined()
    expect(loaded.mountData?.flight).toBeUndefined()
    expect(loaded.mountData?.hp).toBeUndefined()
  })

  it('contract: preserves full inventory items and equippedShieldId across save and load', () => {
    const inventory = new InventoryManager()
    const state = inventory.saveState

    const saveData: PlayerSaveData = {
      ...DEFAULT_SAVE,
      inventory: state,
    }

    expect(saveManager.save(saveData)).toBe(true)
    const loaded = saveManager.load()

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
    expect(freshInv.equippedMelee.id).toBe('steel_lance')
    expect(freshInv.equippedRanged.id).toBe('elven_runebow')
    expect(freshInv.equippedShield?.id).toBe('round_shield_t3')
    expect(freshInv.isEquipped('runic_greatsword')).toBe(false)
  })

  it('existing save migration: does NOT give free T3 weapons to legacy saves without items/shield', () => {
    const legacySave = {
      position: { x: 5, y: 0.95, z: 12 },
      hp: 85,
      stamina: 90,
      arrows: 24,
      skills: {
        oneHanded: { level: 2, xp: 50 },
        archery: { level: 1, xp: 20 },
      },
      inventory: {
        ownedWeaponIds: ['steel_sword', 'recurve_longbow'],
        equippedMeleeId: 'steel_sword',
        equippedRangedId: 'recurve_longbow',
      },
    }

    mockStorage.setItem('wdyh_save_v1', JSON.stringify(legacySave))
    const loaded = saveManager.load()

    const loadedItemIds = loaded.inventory.items?.map(i => i.id)
    expect(loadedItemIds).toEqual(['steel_sword', 'recurve_longbow'])
    expect(loadedItemIds).not.toContain('steel_lance')
    expect(loadedItemIds).not.toContain('runic_greatsword')
    expect(loadedItemIds).not.toContain('round_shield_t3')

    expect(loaded.inventory.equippedShieldId).toBeNull()
    expect(loaded.inventory.equippedMeleeId).toBe('steel_sword')
    expect(loaded.inventory.equippedRangedId).toBe('recurve_longbow')
  })

  it('contract: correctly serializes and deserializes mounted vs unmounted save data', () => {
    // 1. Mounted save
    const mountedSave: PlayerSaveData = {
      ...DEFAULT_SAVE,
      mountData: {
        isMounted: true,
        type: 'HORSE',
        appearanceVariant: 1,
      },
    }
    saveManager.save(mountedSave)
    let loaded = saveManager.load()
    expect(loaded.mountData?.isMounted).toBe(true)
    expect(loaded.mountData?.type).toBe('HORSE')
    expect(loaded.mountData?.appearanceVariant).toBe(1)

    // 2. Unmounted save
    const unmountedSave: PlayerSaveData = {
      ...DEFAULT_SAVE,
      mountData: undefined,
    }
    saveManager.save(unmountedSave)
    loaded = saveManager.load()
    expect(loaded.mountData).toBeUndefined()
  })

  it('backward compatibility: legacy save lacking mountData.position falls back to player position with undefined mountY', () => {
    const legacySave: PlayerSaveData = {
      ...DEFAULT_SAVE,
      position: { x: 12, y: 1.8, z: 34 },
      mountData: {
        isMounted: true,
        type: 'HORSE',
      },
    }
    const resolvedPos = resolveMountSpawnPosition(legacySave)
    expect(resolvedPos).toEqual({ x: 12, y: 1.8, z: 34 })

    const resolvedY = resolveMountSpawnY(legacySave)
    expect(resolvedY).toBeUndefined()
  })
})
