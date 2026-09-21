import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  DeathFadeController,
  DEATH_FADE_TOTAL_SECONDS,
} from './DeathFade'

describe('DeathFadeController', () => {
  it('fades the character and attached weapon, then stops rendering the root at 3 seconds', () => {
    const root = new THREE.Group()
    const sharedBodyMaterial = new THREE.MeshBasicMaterial({ opacity: 0.8 })
    const sharedWeaponMaterial = new THREE.MeshBasicMaterial({ opacity: 1 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedBodyMaterial)
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), sharedWeaponMaterial)
    body.add(weapon)
    root.add(body)

    const fade = new DeathFadeController()
    fade.start(root)

    expect(body.material).not.toBe(sharedBodyMaterial)
    expect(weapon.material).not.toBe(sharedWeaponMaterial)

    fade.update(root, 2.25)
    expect(root.visible).toBe(true)
    expect((body.material as THREE.Material).opacity).toBeCloseTo(0.8)

    fade.update(root, 0.375)
    expect((body.material as THREE.Material).opacity).toBeCloseTo(0.4)
    expect((weapon.material as THREE.Material).opacity).toBeCloseTo(0.5)
    expect(sharedBodyMaterial.opacity).toBeCloseTo(0.8)
    expect(sharedWeaponMaterial.opacity).toBeCloseTo(1)

    fade.update(root, DEATH_FADE_TOTAL_SECONDS - 2.625)
    expect(root.visible).toBe(false)

    fade.reset(root)
    expect(root.visible).toBe(true)
    expect((body.material as THREE.Material).opacity).toBeCloseTo(0.8)
    expect((weapon.material as THREE.Material).opacity).toBeCloseTo(1)
  })
})
