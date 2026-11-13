import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { showEquipmentLoadNotice } from '../../src/ui/EquipmentLoadNotice'
import {
  BYZANTINE_EQUIPMENT_WAIT_MS,
  createT5BowBody, HighTierEquipmentService,
  preloadHighTierEquipment, resetHighTierEquipmentForTest
} from '../../src/world/HighTierEquipment'

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

describe('HighTierEquipment preload publication', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bowError.current = undefined
    resetHighTierEquipmentForTest()
    vi.stubGlobal('fetch', () => new Promise(() => {}))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.mocked(showEquipmentLoadNotice).mockClear()
    resetHighTierEquipmentForTest()
  })

it('allows scene entry preload to complete and time out without notifying player for unselected equipment', async () => {
    let completed = false
    void preloadHighTierEquipment().then(() => { completed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(completed).toBe(true)

    // Unselected items time out after 20s without showing load notice
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled()

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
    onTestFinished(() => service.dispose())
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
})
