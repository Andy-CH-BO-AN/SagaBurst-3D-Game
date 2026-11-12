import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import {
  BYZANTINE_EQUIPMENT_RETRY_MS, BYZANTINE_EQUIPMENT_WAIT_MS, byzantineEquipmentStatus,
  createT5BowBody, HighTierEquipmentService, isEquipmentUsable, preloadHighTierEquipment, resetHighTierEquipmentForTest,
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
  const actor = Object.assign(Object.create(NPC.prototype) as GatedActor, {
    _tier: 5, _faction: Faction.ENEMY, _aiType: AIType.MELEE, state: AIState.IDLE, rangedActive: false, townArmed: false,
    heldMeleeWeaponId: 'steel_lance', selectedMeleeWeaponId: 'steel_lance', heldShieldId: null, selectedShieldId: null,
    animator: { cancel: vi.fn(), setEquipment: vi.fn() }, rebuildShield: vi.fn(),
  })
  if (shieldId) actor.shieldId = shieldId
  return actor
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
    const actor = actorHolding(null)
    actor.shieldId = 'centurion_aquila_shield_t4'
    expect(isEquipmentUsable('centurion_aquila_shield_t4', actor)).toBe(false)
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

  it('isolates concurrent and delayed GLB loader responses across generations without corrupting shared cache', async () => {
    const service = new HighTierEquipmentService()
    type Deferred<T> = { promise: Promise<T>; resolve: (val: T) => void; reject: (err: any) => void }
    const createDeferred = <T>(): Deferred<T> => {
      let resolve!: (val: T) => void
      let reject!: (err: any) => void
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }

    const makeFakeGltf = (tag: string) => ({
      scene: Object.assign(new (THREE as any).Group(), {
        userData: { tag },
        updateMatrixWorld: vi.fn(),
        traverse: vi.fn(),
        clone: vi.fn(function (this: any) { return this }),
      }),
    } as any)

    const gen1Deferreds = new Map<string, Deferred<any>>()
    const gen2Deferreds = new Map<string, Deferred<any>>()
    let currentGen = 1

    const fakeLoader = {
      loadAsync: vi.fn((path: string) => {
        const def = createDeferred<any>()
        if (currentGen === 1) gen1Deferreds.set(path, def)
        else gen2Deferreds.set(path, def)
        return def.promise
      }),
    }

    // Gen 1 starts
    const run1 = service.preloadHighTierEquipment(fakeLoader as any)
    expect(gen1Deferreds.size).toBeGreaterThan(0)

    // Gen 1: A rejects, B stays pending
    const paths = [...gen1Deferreds.keys()]
    const pathA = paths[0], pathB = paths[1]
    gen1Deferreds.get(pathA)!.reject(new Error('Gen 1 pathA load failed'))

    await expect(run1).rejects.toThrow('Gen 1 pathA load failed')
    // Shared cache does not expose partial templates
    expect(() => service.template('spear_t4')).toThrow()
    expect(() => service.createT5BowBody()).toThrow()

    // Gen 2 starts
    currentGen = 2
    const run2 = service.preloadHighTierEquipment(fakeLoader as any)
    for (const [path, def] of gen2Deferreds) {
      def.resolve(makeFakeGltf(`gen2-${path}`))
    }
    await expect(run2).resolves.toBeUndefined()
    // Gen 2 succeeded and published
    const gen2Spear = service.template('spear_t4')
    expect(gen2Spear.scene.userData.tag).toContain('gen2-')

    // Now the old Gen 1 pathB late-resolves
    gen1Deferreds.get(pathB)!.resolve(makeFakeGltf(`gen1-late-${pathB}`))
    await vi.advanceTimersByTimeAsync(0)

    // Shared cache remains Gen 2! Old Gen 1 late resolution did NOT overwrite or corrupt cache
    expect(service.template('spear_t4').scene.userData.tag).toContain('gen2-')
  })

  it('releases demand on equipment change or actor disposal, suppressing notices for inactive items while keeping active shared demands', async () => {
    // 1. Owner 1 equips A. Then switches to B. A fails -> NO notice!
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_lance', rangedWeaponId: 'elven_runebow', shieldId: null })
    inventory.addWeapon(LANCE)
    inventory.equipWeapon(LANCE) // Owner 1 demands LANCE
    expect(gltfLoads.count).toBe(1)

    inventory.equipWeapon('steel_lance') // Owner 1 switches to steel_lance, releasing LANCE demand!
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(byzantineEquipmentStatus(LANCE)).toBe('failed')
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled() // Suppressed because Owner 1 released demand!

    // 2. Two active owners share SHIELD. Owner 1 disposes -> Owner 2 still has demand -> Failure notifies!
    const actor1 = actorHolding(null), actor2 = actorHolding(null)
    actor1.shieldId = SHIELD
    actor2.shieldId = SHIELD

    // Actor 1 changes shield away
    actor1.shieldId = 'scutum_t1' // releases SHIELD demand for actor1

    // SHIELD fails
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(byzantineEquipmentStatus(SHIELD)).toBe('failed')
    // Actor 2 still holds demand, so notification IS shown!
    expect(showEquipmentLoadNotice).toHaveBeenCalledTimes(1)

    // 3. Actor 2 also disposes -> Subsequent failures/retries do NOT notify
    vi.mocked(showEquipmentLoadNotice).mockClear()
    actor2.shieldId = 'scutum_t1' // releases SHIELD demand for actor2
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_RETRY_MS + BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled()
  })
})
