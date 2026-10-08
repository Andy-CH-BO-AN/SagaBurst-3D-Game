import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { AIType, Faction, NPC } from '../../src/world/NPC'

describe('Mounted NPC tactical movement', () => {
  it('clears real NPC follow/formation when charging and derives movement from mounted speed', () => {
  const scene = new THREE.Scene()
  const rider = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Captain', 1, true)
    onTestFinished(() => rider.dispose())
  // Movement-only boundary: this records speed and displacement, without a real Mount.
  const movement = vi.fn((direction: THREE.Vector3, speed: number, dt: number) => { rider.mount!.group.position.addScaledVector(direction, speed * dt) })
  rider.mount = { group: new THREE.Group(), baseSpeed: 12, dead: false, addControlledMovement: movement } as unknown as NPC['mount']
  rider.assignFormationTarget(1, new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, 1), 12)
  const internal = rider as unknown as { _updateFormationMovement: (dt: number, peers: NPC[], obstacles: never[], skip: boolean, navigation: null) => void }
  internal._updateFormationMovement(.1, [], [], true, null)
  expect(movement).toHaveBeenCalled(); expect(movement.mock.calls[0][1]).toBe(12)
  for (let frame = 0; frame < 50; frame++) internal._updateFormationMovement(.1, [], [], true, null)
  expect(rider.combatPosition.z).toBeGreaterThan(50)
  const leader = new NPC(scene, 0, 100, Faction.PLAYER, 'roman', AIType.MELEE, 'Leader', 1, false)
    onTestFinished(() => leader.dispose())
  rider.assignFollowTarget(leader, 0)
  expect(rider.tacticalOrder).toBe('follow')
  rider.setTacticalOrder('charge')
  expect(rider.formationCommandId).toBeNull(); expect(rider.tacticalOrder).toBe('charge')
})
})
