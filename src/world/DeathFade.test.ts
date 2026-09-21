import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  applyDeathFadeWarmupVariant,
  DeathFadeController,
  DEATH_FADE_TOTAL_SECONDS,
} from './DeathFade'

function makeCharacter(sharedMaterial: THREE.Material): {
  root: THREE.Group
  mesh: THREE.Mesh
} {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial)
  mesh.castShadow = true
  root.add(mesh)
  return { root, mesh }
}

describe('DeathFadeController', () => {
  it('keeps death start allocation-free and uses shared fade variants across actors', () => {
    const sharedMaterial = new THREE.MeshBasicMaterial({ opacity: 1 })
    const a = makeCharacter(sharedMaterial)
    const b = makeCharacter(sharedMaterial)
    const fadeA = new DeathFadeController()
    const fadeB = new DeathFadeController()

    fadeA.prepare(a.root)
    fadeB.prepare(b.root)

    fadeA.start(a.root)
    fadeB.start(b.root)

    // start() must not swap/clone materials on the death frame.
    expect(a.mesh.material).toBe(sharedMaterial)
    expect(b.mesh.material).toBe(sharedMaterial)

    fadeA.update(a.root, 2.25)
    fadeB.update(b.root, 2.25)

    // Both actors reuse the same prebuilt bucket material instead of cloning
    // one material per corpse.
    expect(a.mesh.material).not.toBe(sharedMaterial)
    expect(a.mesh.material).toBe(b.mesh.material)
    expect((a.mesh.material as THREE.Material).alphaHash).toBe(true)
    expect((a.mesh.material as THREE.Material).transparent).toBe(false)
    expect(a.mesh.castShadow).toBe(false)
    expect(sharedMaterial.opacity).toBe(1)
  })

  it('changes only material references while fading and hides the root at 3 seconds', () => {
    const source = new THREE.MeshBasicMaterial({ opacity: 0.8 })
    const { root, mesh } = makeCharacter(source)
    const fade = new DeathFadeController()
    fade.prepare(root)
    fade.start(root)

    fade.update(root, 2.25)
    const firstBucket = mesh.material as THREE.Material
    const firstBucketVersion = firstBucket.version

    fade.update(root, 0.375)
    const laterBucket = mesh.material as THREE.Material

    expect(laterBucket).not.toBe(firstBucket)
    expect(laterBucket.opacity).toBeLessThan(firstBucket.opacity)
    expect(firstBucket.version).toBe(firstBucketVersion)
    expect(source.version).toBe(0)

    fade.update(root, DEATH_FADE_TOTAL_SECONDS - 2.625)
    expect(root.visible).toBe(false)

    fade.reset(root)
    expect(root.visible).toBe(true)
    expect(mesh.material).toBe(source)
    expect(mesh.castShadow).toBe(true)
  })

  it('prepares the alpha-hash shader variant for render warmup and restores originals', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xff0000 })
    const { root, mesh } = makeCharacter(source)

    const restore = applyDeathFadeWarmupVariant(root)

    expect(mesh.material).not.toBe(source)
    expect((mesh.material as THREE.Material).alphaHash).toBe(true)

    restore()
    expect(mesh.material).toBe(source)
  })
})
