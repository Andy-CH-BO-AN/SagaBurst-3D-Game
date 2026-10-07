import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { Mount, MountType } from '../../src/world/Mount'
import { reconcileLoadedMounts } from '../../src/Game'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('reconcileLoadedMounts Production Behavior', () => {
  it('disposes startingHorse and avoids duplicated mounts on mounted or unmounted save load', () => {
    const scene = new THREE.Scene()
    const startingHorse = new Mount(scene, MountType.CORGI, 0, 0)
    onTestFinished(() => startingHorse.dispose())
    const mounts: Mount[] = [startingHorse]

    // 1. Load mounted save: startingHorse disposed and removed, new mount added
    const newLoadedMount = new Mount(scene, MountType.CORGI, 10, 20)
    onTestFinished(() => newLoadedMount.dispose())
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
})
