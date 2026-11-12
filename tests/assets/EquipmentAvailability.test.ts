import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import {
  BYZANTINE_EQUIPMENT_RETRY_MS, BYZANTINE_EQUIPMENT_WAIT_MS, byzantineEquipmentStatus,
  createT5BowBody, isEquipmentUsable, preloadHighTierEquipment, resetHighTierEquipmentForTest,
} from '../../src/world/HighTierEquipment'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'
import { showEquipmentLoadNotice } from '../../src/ui/EquipmentLoadNotice'

const gltfLoads = vi.hoisted(() => ({ next: [] as Array<() => Promise<unknown>>, count: 0 }))
const bowError = vi.hoisted(() => ({ current: undefined as Error | undefined }))

vi.mock('three', async importOriginal => {
  const real = await importOriginal<typeof import('three')>()
  class FakeGroup {
    add = vi.fn()
    traverse = vi.fn()
    clone() { return this }
  }
  return {
    ...real,
    Group: FakeGroup,
  }
})

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async loadAsync(path: string) {
      if (bowError.current && path.includes('bow.glb')) {
        return {
          scene: {
            updateMatrixWorld() { throw bowError.current },
            traverse() {},
          },
        }
      }
      return { scene: { traverse() {}, updateMatrixWorld() {} } }
    }
    async parseAsync() { return { scene: { traverse() {} } } }
  },
}))
vi.mock('../../src/ui/EquipmentLoadNotice', () => ({ showEquipmentLoadNotice: vi.fn() }))

const LANCE = 'byzantine_standard_lance_t5', SHIELD = 'byzantine_eagle_shield_t5'
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })

interface GatedActor {
  meleeWeaponId: string | null
  shieldId: string | null
  hasActiveShield: boolean
  rebuildShield: ReturnType<typeof vi.fn>
  _adoptLoadedEquipment(): void
}
/** Real equipment slots and adoption; mesh rebuilding is the external boundary. */
function actorHolding(shieldId: string | null): GatedActor {
  return Object.assign(Object.create(NPC.prototype) as GatedActor, {
    _tier: 5, _faction: Faction.ENEMY, _aiType: AIType.MELEE, state: AIState.IDLE, rangedActive: false, townArmed: false,
    heldMeleeWeaponId: 'steel_lance', selectedMeleeWeaponId: 'steel_lance', heldShieldId: shieldId, selectedShieldId: shieldId,
    animator: { cancel: vi.fn(), setEquipment: vi.fn() }, rebuildShield: vi.fn(),
  })
}

describe('Equipment waiting for its model', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    gltfLoads.count = 0
    gltfLoads.next = []
    bowError.current = undefined
    resetHighTierEquipmentForTest()
    vi.stubGlobal('fetch', () => {
      gltfLoads.count++
      return (gltfLoads.next.shift() ?? (() => new Promise(() => {})))()
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.mocked(showEquipmentLoadNotice).mockClear()
    resetHighTierEquipmentForTest()
  })

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

  it('lets an NPC block with the eagle shield only after its model loads, and retries a failure on a paced schedule', async () => {
    gltfLoads.next.push(() => Promise.reject(new Error('404')))
    const spawned = actorHolding(null), reequipped = actorHolding('scutum_t1')
    spawned.shieldId = SHIELD
    reequipped.shieldId = SHIELD
    await vi.advanceTimersByTimeAsync(0)
    expect(byzantineEquipmentStatus(SHIELD)).toBe('failed')

    expect([spawned.shieldId, spawned.hasActiveShield]).toEqual([null, false])
    expect([reequipped.shieldId, reequipped.hasActiveShield]).toEqual(['scutum_t1', true])
    expect(spawned.meleeWeaponId).toBe('steel_lance')
    spawned._adoptLoadedEquipment()
    expect(spawned.rebuildShield).not.toHaveBeenCalled()
    expect(gltfLoads.count).toBe(1)

    gltfLoads.next.push(() => Promise.resolve(response()))
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_RETRY_MS)
    spawned._adoptLoadedEquipment()
    expect(gltfLoads.count).toBe(2)
    await vi.advanceTimersByTimeAsync(0)

    for (const actor of [spawned, reequipped]) {
      actor._adoptLoadedEquipment()
      expect(actor.rebuildShield).toHaveBeenCalledTimes(1)
      expect([actor.shieldId, actor.hasActiveShield]).toEqual([SHIELD, true])
    }
    expect(spawned.meleeWeaponId).toBe('steel_lance')
  })

  it('allows scene entry preload to complete and time out without notifying player for unselected equipment', async () => {
    let completed = false
    void preloadHighTierEquipment().then(() => { completed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(completed).toBe(true)

    // Unselected items time out after 20s without showing load notice
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled()

    // Formal selection of the failed equipment prompts player and does not enable combat effect
    expect(isEquipmentUsable('centurion_aquila_shield_t4')).toBe(false)
    expect(showEquipmentLoadNotice).toHaveBeenCalledTimes(1)
  })

  it('rejects preload cleanly on bow_t5 geometry error without exposing partial body, and succeeds on retry', async () => {
    bowError.current = new Error('corrupt bow geometry')
    await expect(preloadHighTierEquipment()).rejects.toThrow('corrupt bow geometry')
    expect(() => createT5BowBody()).toThrow('T5 bow was not preloaded')

    bowError.current = undefined
    await expect(preloadHighTierEquipment()).resolves.toBeUndefined()
    expect(createT5BowBody()).toBeDefined()
  })
})
