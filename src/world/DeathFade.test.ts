import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  DeathFadeController,
  DEATH_DESPAWN_DELAY_SECONDS,
} from './DeathFade'

describe('DeathFadeController', () => {
  it('keeps the actor visible for 3 seconds, then hides the whole root without changing materials', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshBasicMaterial({ opacity: 0.8 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), material)
    body.add(weapon)
    root.add(body)

    const death = new DeathFadeController()
    death.start(root)

    death.update(root, DEATH_DESPAWN_DELAY_SECONDS - 0.01)
    expect(root.visible).toBe(true)
    expect(body.material).toBe(material)
    expect(weapon.material).toBe(material)
    expect(material.opacity).toBe(0.8)

    death.update(root, 0.01)
    expect(root.visible).toBe(false)
    expect(body.material).toBe(material)
    expect(weapon.material).toBe(material)
  })

  it('shows the actor again when reset for respawn', () => {
    const root = new THREE.Group()
    const death = new DeathFadeController()

    death.start(root)
    death.update(root, DEATH_DESPAWN_DELAY_SECONDS)
    expect(root.visible).toBe(false)

    death.reset(root)
    expect(root.visible).toBe(true)
  })
})
