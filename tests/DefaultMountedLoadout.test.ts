import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { DEFAULT_SAVE, PlayerSaveData, SaveManager } from '../src/save/SaveManager'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { calculateLanceChargeDamage } from '../src/combat/CombatBalance'
import { Mount, MountState, MountType } from '../src/world/Mount'
import { VIKING_PLAYER_SPAWN } from '../src/battle/BattleSpawner'
import { reconcileLoadedMounts, resolveMountSpawnPosition, resolveMountSpawnY } from '../src/Game'
import { Player } from '../src/player/Player'

describe('Default Mounted Loadout & Inventory', () => {
  let inventory: InventoryManager

  beforeEach(() => {
    inventory = new InventoryManager()
  })

  it('initializes default inventory with elite heavy cavalry items (lance, greatsword, runebow, t3 shield)', () => {
    const stacks = inventory.inventoryStacks
    const itemIds = stacks.map(s => s.item.id)

    expect(itemIds).toContain('steel_lance')
    expect(itemIds).toContain('runic_greatsword')
    expect(itemIds).toContain('elven_runebow')
    expect(itemIds).toContain('round_shield_t3')

    const lanceStack = stacks.find(s => s.item.id === 'steel_lance')
    const greatswordStack = stacks.find(s => s.item.id === 'runic_greatsword')
    const runebowStack = stacks.find(s => s.item.id === 'elven_runebow')
    const shieldStack = stacks.find(s => s.item.id === 'round_shield_t3')

    expect(lanceStack?.quantity).toBe(1)
    expect(greatswordStack?.quantity).toBe(1)
    expect(runebowStack?.quantity).toBe(1)
    expect(shieldStack?.quantity).toBe(1)
  })

  it('equips Steel Lance, Elven Runebow, and Round Shield T3 by default', () => {
    expect(inventory.equippedMelee.id).toBe('steel_lance')
    expect(inventory.equippedRanged.id).toBe('elven_runebow')
    expect(inventory.equippedShield?.id).toBe('round_shield_t3')

    expect(inventory.isEquipped('steel_lance')).toBe(true)
    expect(inventory.isEquipped('elven_runebow')).toBe(true)
    expect(inventory.isEquipped('round_shield_t3')).toBe(true)
  })

  it('keeps Runic Greatsword owned in backpack without default equipping', () => {
    expect(inventory.isEquipped('runic_greatsword')).toBe(false)
    const stacks = inventory.inventoryStacks
    const greatsword = stacks.find(s => s.item.id === 'runic_greatsword')
    expect(greatsword).toBeDefined()
    expect(greatsword?.item.tier).toBe(3)
  })

  it('allows equipping Runic Greatsword on foot/dismount via standard inventory flow', () => {
    const success = inventory.equipWeapon('runic_greatsword')
    expect(success).toBe(true)
    expect(inventory.equippedMelee.id).toBe('runic_greatsword')
    expect(inventory.isEquipped('runic_greatsword')).toBe(true)
    expect(inventory.isEquipped('steel_lance')).toBe(false)
    expect(inventory.equippedMelee.damageMax).toBe(45)
    expect(inventory.equippedMelee.animationKind).toBe('sword')

    // Shield remains equipped and the unified one-handed sword keeps it in the guard hand.
    expect(inventory.equippedShield?.id).toBe('round_shield_t3')
  })
})

describe('Lance Charge Bonus Production Behavior', () => {
  it('triggers 3x damage multiplier and sets skipImpact when charging at speed > 10 with steel_lance', () => {
    const lance = WEAPONS['steel_lance']
    expect(lance.isLance).toBe(true)

    const result = calculateLanceChargeDamage(lance.isLance === true, 12.0, lance.damageMax)
    expect(result.damage).toBe(135.0) // 45 * 3
    expect(result.skipImpact).toBe(true)
  })

  it('does not trigger charge bonus when moving at or below speed threshold 10', () => {
    const lance = WEAPONS['steel_lance']
    const trotResult = calculateLanceChargeDamage(lance.isLance === true, 10.0, lance.damageMax)
    expect(trotResult.damage).toBe(45.0)
    expect(trotResult.skipImpact).toBe(false)

    const walkResult = calculateLanceChargeDamage(lance.isLance === true, 5.0, lance.damageMax)
    expect(walkResult.damage).toBe(45.0)
    expect(walkResult.skipImpact).toBe(false)
  })

  it('does not trigger charge bonus for non-lance weapons even at high speed', () => {
    const sword = WEAPONS['steel_sword']
    const result = calculateLanceChargeDamage(sword.isLance === true, 12.0, sword.damageMax)
    expect(result.damage).toBe(25.0)
    expect(result.skipImpact).toBe(false)
  })
})

describe('Mount Class Real Lifecycle Transitions', () => {
  it('transitions actual Mount instance through IDLE -> CONTROLLED -> IDLE -> DEAD states', () => {
    const scene = new THREE.Scene()
    // MountType.CORGI constructs procedurally without requiring external GLB preload
    const mount = new Mount(scene, MountType.CORGI, 0, 0)

    // 1. Initial idle state
    expect(mount.state).toBe(MountState.IDLE)
    expect(mount.availableForPlayer).toBe(true)
    expect(mount.dead).toBe(false)

    // 2. Mounted state
    mount.state = MountState.CONTROLLED
    expect(mount.state).toBe(MountState.CONTROLLED)
    expect(mount.availableForPlayer).toBe(false)

    // 3. Dismounted by player
    mount.releaseRider()
    expect(mount.state).toBe(MountState.IDLE)
    expect(mount.availableForPlayer).toBe(true)

    // 4. Fatal damage
    const hitSuccess = mount.takeDamage(mount.maxHp + 10)
    expect(hitSuccess).toBe(true)
    expect(mount.state).toBe(MountState.DEAD)
    expect(mount.dead).toBe(true)
    expect(mount.availableForPlayer).toBe(false)

    mount.dispose()
  })
})

describe('SaveManager Persistence & Migration Compatibility', () => {
  let saveManager: SaveManager
  let mockStorage: Map<string, string>

  beforeEach(() => {
    mockStorage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
    })
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

    mockStorage.set('wdyh_save_v1', JSON.stringify(legacySave))
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

  it('round-trip: mounted save/load preserves distinct mount ground position vs rider saddle position and restores authoritative saddle transform', () => {
    const scene = new THREE.Scene()
    const mount = new Mount(scene, MountType.CORGI, 15, 25)
    mount.group.position.set(15, 0.5, 25)

    const player = new Player(scene)
    player.isMounted = true
    player.currentMount = mount
    player.syncMountTransform()

    // Rider saddle position differs from mount ground position (y is elevated and z has saddle offset)
    const riderPos = player.position.clone()
    expect(riderPos.y).toBeGreaterThan(mount.group.position.y + 0.5)

    // Save matching Game._saveGame() logic (mount ground position in mountData.position)
    const saveData: PlayerSaveData = {
      ...DEFAULT_SAVE,
      position: { x: riderPos.x, y: riderPos.y, z: riderPos.z },
      mountData: {
        isMounted: true,
        type: mount.type,
        position: {
          x: mount.group.position.x,
          y: mount.group.position.y,
          z: mount.group.position.z,
        },
      },
    }

    saveManager.save(saveData)
    const loadedData = saveManager.load()

    expect(loadedData.mountData?.position).toEqual({ x: 15, y: 0.5, z: 25 })
    expect(loadedData.position.y).not.toBe(loadedData.mountData?.position?.y)

    // Reconstruct via Game._loadGame() production path
    const mountSpawnPos = resolveMountSpawnPosition(loadedData)
    const mountSpawnY = resolveMountSpawnY(loadedData)
    expect(mountSpawnPos.x).toBe(15)
    expect(mountSpawnPos.z).toBe(25)
    expect(mountSpawnY).toBe(0.5)

    // Restore Mount through production constructor path with mountSpawnY directly (no manual position.y override)
    const restoredMount = new Mount(scene, MountType.CORGI, mountSpawnPos.x, mountSpawnPos.z, mountSpawnY)

    // 1. Restore player stats & baseline position first (as in Game._loadGame)
    player.setPosition(loadedData.position.x, loadedData.position.y, loadedData.position.z)

    // 2. Perform mounting as authoritative final transform state
    player.isMounted = true
    player.currentMount = restoredMount
    restoredMount.state = MountState.CONTROLLED
    player.syncMountTransform()

    // Assert restored mount constructor placed it exactly at original x, y, z
    expect(restoredMount.group.position.x).toBe(15)
    expect(restoredMount.group.position.y).toBe(0.5)
    expect(restoredMount.group.position.z).toBe(25)

    // Restore the anatomical rider socket, including clearance above the physical saddle.
    const expectedPelvis = restoredMount.getRiderPelvisSeatWorld(new THREE.Vector3())
    const saddleSurface = restoredMount.getSaddleSeatWorld(new THREE.Vector3())
    expect(expectedPelvis.y - saddleSurface.y).toBeCloseTo(0.17, 3)

    expect(player.position.x).toBeCloseTo(expectedPelvis.x, 3)
    expect(player.position.y).toBeCloseTo(expectedPelvis.y + 0.95, 3) // PLAYER_HALF_HEIGHT
    expect(player.position.z).toBeCloseTo(expectedPelvis.z, 3)

    mount.dispose()
    restoredMount.dispose()
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

describe('reconcileLoadedMounts Production Behavior', () => {
  it('disposes startingHorse and avoids duplicated mounts on mounted or unmounted save load', () => {
    const scene = new THREE.Scene()
    const startingHorse = new Mount(scene, MountType.CORGI, 0, 0)
    const mounts: Mount[] = [startingHorse]

    // 1. Load mounted save: startingHorse disposed and removed, new mount added
    const newLoadedMount = new Mount(scene, MountType.CORGI, 10, 20)
    const res1 = reconcileLoadedMounts(mounts, startingHorse, null, newLoadedMount)

    expect(res1.mounts.length).toBe(1)
    expect(res1.mounts[0]).toBe(newLoadedMount)
    expect(res1.startingHorse).toBeNull()
    expect(res1.loadedSaveMount).toBe(newLoadedMount)

    // 2. Load unmounted save: previous loadedSaveMount disposed and removed, no new mount added
    const res2 = reconcileLoadedMounts(res1.mounts, null, res1.loadedSaveMount, null)

    expect(res2.mounts.length).toBe(0)
    expect(res2.startingHorse).toBeNull()
    expect(res2.loadedSaveMount).toBeNull()
  })

  it('spawn position constant matches Viking baseline', () => {
    expect(VIKING_PLAYER_SPAWN.x).toBe(0)
    expect(VIKING_PLAYER_SPAWN.z).toBe(145)
  })
})
