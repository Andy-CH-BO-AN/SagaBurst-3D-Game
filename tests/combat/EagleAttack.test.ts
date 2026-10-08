import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { EagleAttack } from '../../src/combat/EagleAttack'
import type { PhysicalCombatTarget } from '../../src/combat/ShieldBlocking'

function fixture() {
  const attack = new EagleAttack()
  const sockets = Array.from({ length: 3 }, () => new THREE.Object3D())
  sockets.forEach(socket => { socket.position.y = 1 })
  const group = new THREE.Group(); group.position.set(0, 0, 4)
  const target: PhysicalCombatTarget = { group, combatPosition: group.position, isMounted: false }
  const ownGroup = new THREE.Group()
  const ownMount = { group: ownGroup, combatPosition: ownGroup.position, isMounted: false, riderNpc: null, riderPlayer: null }
  return { attack, sockets, target, ownMount }
}

describe('Eagle attack shared swept contacts (zero actors)', () => {
  it('does not deal damage before windup or after the active window', () => {
    const { attack, sockets, target, ownMount } = fixture()
    attack.start(sockets)
    attack.advance(.1); sockets.forEach(socket => { socket.position.z = 4 }); attack.sample(sockets)
    expect(attack.trace([target], [], ownMount)).toHaveLength(0)
    attack.advance(.3); attack.sample(sockets)
    expect(attack.trace([target], [], ownMount)).toHaveLength(1)
    const secondGroup = new THREE.Group(); secondGroup.position.z = 4
    attack.advance(.1); attack.sample(sockets)
    expect(attack.trace([{ group: secondGroup, combatPosition: secondGroup.position, isMounted: false }], [], ownMount)).toHaveLength(0)
  })
  it('sweeps a fast-moving claw and all three sockets share one victim ledger', () => {
    const { attack, sockets, target, ownMount } = fixture()
    attack.start(sockets); attack.advance(.16); attack.sample(sockets)
    attack.advance(.1); sockets.forEach(socket => { socket.position.z = 8 }); attack.sample(sockets)
    const contacts = attack.trace([target], [], ownMount)
    expect(contacts).toHaveLength(1)
    expect(contacts[0].attackSource).toBe('xongkoro')
    expect(contacts[0].kind).toBe('body')
    attack.advance(.05); sockets.forEach(socket => { socket.position.z = 0 }); attack.sample(sockets)
    expect(attack.trace([target], [], ownMount)).toHaveLength(0)
  })
  it('an intervening wall stops claw damage and cancel restores the pose immediately', () => {
    const { attack, sockets, target, ownMount } = fixture()
    attack.start(sockets); attack.advance(.16); attack.sample(sockets)
    attack.advance(.1); sockets.forEach(socket => { socket.position.z = 8 }); attack.sample(sockets)
    const wall = { box: new THREE.Box3(new THREE.Vector3(-3, -1, 2), new THREE.Vector3(3, 4, 2.1)), isBarricade: false }
    expect(attack.trace([target], [], ownMount, [wall])).toHaveLength(0)
    expect(attack.weight).toBe(1)
    attack.cancel()
    expect(attack.weight).toBe(0)
    expect(attack.trace([target], [], ownMount)).toHaveLength(0)
  })
  it('respects cooldown and starts a fresh victim ledger on the next attack', () => {
    const { attack, sockets, target, ownMount } = fixture()
    sockets.forEach(socket => { socket.position.z = 4 })
    expect(attack.start(sockets)).toBe(true)
    attack.advance(.2); attack.sample(sockets)
    expect(attack.trace([target], [], ownMount)).toHaveLength(1)
    expect(attack.start(sockets)).toBe(false)
    attack.advance(.8)
    expect(attack.start(sockets)).toBe(true)
    attack.advance(.2); attack.sample(sockets)
    expect(attack.trace([target], [], ownMount)).toHaveLength(1)
  })
})
