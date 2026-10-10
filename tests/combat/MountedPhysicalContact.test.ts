import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { ShieldCollider, WeaponSweep, traceCombatSegment, type CombatContact } from '../../src/combat/ShieldBlocking'
import { MountType } from '../../src/world/Mount'

import { createMountedCombatActors } from '../helpers/mountedCombatActors'
vi.mock('../../src/world/XongkoroVisual', async () => ({
  XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble,
}))
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Mounted physical first contact', () => {
  it.each(Object.values(MountType))('%s: low segments hit the mount, high segments hit the rider', type => {
    const { rider, mount } = fixture(type), contact: CombatContact = { kind: 'body', time: Infinity }
    expect(traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), contact)).toBe(true)
    expect(contact.kind).toBe('mount'); expect(contact.mount).toBe(mount)
    const y = rider.group.position.y + 1.2
    expect(traceCombatSegment(rider, new THREE.Vector3(0, y, 3), new THREE.Vector3(0, y, -3), contact)).toBe(true)
    expect(contact.kind).toBe('body'); expect(contact.mount).toBeUndefined()
  })

  it.each([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])('follows mount heading %s, parent scale and proxy offset', heading => {
    const { mount } = fixture()
    mount.group.rotation.y = heading
    mount.group.scale.set(1.2, 1, 1.1)
    mount.group.updateWorldMatrix(true, true)
    const local = (x: number, y: number, z: number) => mount.group.localToWorld(new THREE.Vector3(x, y, z))
    const contact: CombatContact = { kind: 'body', time: Infinity }
    expect(traceCombatSegment(mount, local(0, .8, 3), local(0, .8, -3), contact)).toBe(true)
    expect(contact.time).toBeCloseTo(.3); expect(contact.kind).toBe('mount')
    expect(traceCombatSegment(mount, local(.7, .8, 3), local(.7, .8, -3), contact)).toBe(false)
  })

  it('xongkoro torso and head contacts follow posed anatomy while wing-envelope air remains empty', () => {
    const { mount } = fixture(MountType.XONGKORO)
    mount.group.rotation.set(-.4, .7, .3, 'YXZ')
    const head = mount.aimColliders[1]
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(mount.group.quaternion)
    const contact: CombatContact = { kind: 'body', time: Infinity }
    const oldTorso = mount.aimCollider.getWorldPosition(new THREE.Vector3())
    mount.eagleVisual!.torsoSocket.position.y += 3
    const posedTorso = oldTorso.clone().add(new THREE.Vector3(0, 3, 0).applyQuaternion(mount.group.quaternion))
    expect(traceCombatSegment(mount, posedTorso.clone().addScaledVector(direction, -2), posedTorso.clone().addScaledVector(direction, 2), contact)).toBe(true)
    expect(contact.kind).toBe('mount')
    expect(traceCombatSegment(mount, oldTorso.clone().addScaledVector(direction, -2), oldTorso.clone().addScaledVector(direction, 2), contact)).toBe(false)
    for (const extension of [0, 1.5]) {
      mount.eagleVisual!.headAttackSocket.position.z += extension
      const center = head.getWorldPosition(new THREE.Vector3())
      expect(traceCombatSegment(mount, center.clone().addScaledVector(direction, -2), center.clone().addScaledVector(direction, 2), contact)).toBe(true)
      expect(contact.kind).toBe('mount')
      expect(contact.mount).toBe(mount)
    }
    const emptyWingSpace = mount.group.localToWorld(new THREE.Vector3(7, 1.8, 1.7))
    expect(traceCombatSegment(mount, emptyWingSpace.clone().addScaledVector(direction, -.5), emptyWingSpace.clone().addScaledVector(direction, .5), contact)).toBe(false)
  })

  it('compares shield, rider and mount rather than giving shield implicit priority', () => {
    const { scene, rider, mount } = fixture()
    const pivot = new THREE.Group(); scene.add(pivot)
    pivot.position.set(0, 50.8, 1.6)
    rider.shieldCollider = new ShieldCollider(pivot, rider.shield); rider.shieldCollider.setModel('scutum_t1')
    const out: CombatContact = { kind: 'body', time: Infinity }
    traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), out)
    expect(out.kind).toBe('shield')
    pivot.position.z = .2
    traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), out)
    expect(out.kind).toBe('mount'); expect(out.mount).toBe(mount)
  })

  it.each(['sword', 'lance'])('%s sweep consumes the first mount/body contact across targets', weapon => {
    const { rider, mount } = fixture(), sweep = new WeaponSweep()
    const length = weapon === 'lance' ? 3.9 : 1.8
    for (const [y, expected] of [[50.8, 'mount'], [rider.group.position.y + 1.2, 'body']] as const) {
      sweep.reset()
      sweep.capture(new THREE.Vector3(-length / 2, y, 3), new THREE.Vector3(length / 2, y, 3))
      sweep.capture(new THREE.Vector3(-length / 2, y, -3), new THREE.Vector3(length / 2, y, -3))
      expect(sweep.traceFirst([rider], [mount])?.kind).toBe(expected)
    }
  })
})
