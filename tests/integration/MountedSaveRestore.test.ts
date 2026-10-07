import { describe, expect, it, beforeEach, afterEach, beforeAll, vi, onTestFinished } from 'vitest'
import { installCorgiTestAsset } from '../helpers/corgiAsset'
import * as THREE from 'three'
import { DEFAULT_SAVE, PlayerSaveData, SaveManager } from '../../src/save/SaveManager'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import { resolveMountSpawnPosition, resolveMountSpawnY } from '../../src/Game'
import { Player } from '../../src/player/Player'
import { MemoryStorage } from '../helpers/memoryStorage'

beforeAll(() => installCorgiTestAsset())

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

  it('round-trip: mounted save/load preserves distinct mount ground position vs rider saddle position and restores authoritative saddle transform', () => {
    const scene = new THREE.Scene()
    const mount = new Mount(scene, MountType.CORGI, 15, 25)
    onTestFinished(() => mount.dispose())
    mount.group.position.set(15, 0.5, 25)

    const player = new Player(scene)
    onTestFinished(() => player.dispose())
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
    onTestFinished(() => restoredMount.dispose())

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
})
