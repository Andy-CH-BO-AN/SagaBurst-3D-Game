import { describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'

describe('NPC FOLLOW order movement and transitions', () => {
  it('smooths a captain turn instead of instantly swinging followers across the road', () => {
    const scene = new THREE.Scene()
    const leader = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Leader', 1, false)
    onTestFinished(() => leader.dispose())
    const follower = new NPC(scene, 0, -10, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
    onTestFinished(() => follower.dispose())
    follower.assignFollowTarget(leader, 0, new THREE.Vector3(0, 0, -10), 7.5)
    leader.group.rotation.y = Math.PI
    const internal = follower as unknown as {
      _updateFormationMovement: (dt: number, peers: NPC[], obstacles: never[], skip: boolean, navigation: null) => void
      formationTarget: { position: THREE.Vector3; speedLimit?: number }
    }
    internal._updateFormationMovement(.016, [], [], true, null)
    expect(internal.formationTarget.position.z).toBeLessThan(-8)
    expect(internal.formationTarget.speedLimit).toBe(7.5)
  })

  it('keeps an arrived cavalry formation stationary through small plaza collision pushes', () => {
    const scene = new THREE.Scene()
    const rider = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Reserve', 1, true)
    onTestFinished(() => rider.dispose())
    // Movement-only boundary: this does not exercise Mount locomotion or rider lifecycle.
    const mount = {
      group: new THREE.Group(),
      baseSpeed: 7,
      addControlledMovement(direction: THREE.Vector3, speed: number, dt: number) { this.group.position.addScaledVector(direction, speed * dt) },
    }
    rider.mount = mount as unknown as Mount
    rider.assignFormationTarget(1, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1))
    const internal = rider as unknown as {
      _updateFormationMovement: (dt: number, peers: NPC[], obstacles: never[], skip: boolean, navigation: null) => void
      formationTarget: { reached: boolean }
    }
    internal._updateFormationMovement(.1, [], [], true, null)
    expect(internal.formationTarget.reached).toBe(true)
    mount.group.position.x = 2.8
    internal._updateFormationMovement(.1, [], [], true, null)
    expect(mount.group.position.x).toBe(2.8)
    mount.group.position.x = 3.8
    internal._updateFormationMovement(.1, [], [], true, null)
    expect(mount.group.position.x).toBeLessThan(3.8)
  })

  it('clears FOLLOW when switching to FORMATION, ATTACK, DEFEND, or CHARGE', () => {
    const scene = new THREE.Scene()
    const leader = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Leader', 1, false)
    onTestFinished(() => leader.dispose())
    const follower = new NPC(scene, 0, 5, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
    onTestFinished(() => follower.dispose())
    follower.assignFollowTarget(leader, 2)
    expect(follower.tacticalOrder).toBe('follow')
    expect(follower.activeFollowTarget).toBe(leader)

    follower.assignFormationTarget(7, new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, 1))
    expect(follower.tacticalOrder).toBe('formation')
    expect(follower.activeFollowTarget).toBeNull()
    for (const order of ['attack', 'defend', 'charge'] as const) {
      follower.assignFollowTarget(leader, 2)
      follower.setTacticalOrder(order)
      expect(follower.tacticalOrder).toBe(order)
      expect(follower.activeFollowTarget).toBeNull()
    }
  })

  it('temporarily fights nearby enemies and resumes the same FOLLOW target afterward', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const leader = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Leader', 1, false)
    onTestFinished(() => leader.dispose())
    const follower = new NPC(scene, 0, 3, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
    onTestFinished(() => follower.dispose())
    const enemy = new NPC(scene, 0, 6, Faction.BANDIT, 'viking', AIType.MELEE, 'Enemy', 1, false)
    onTestFinished(() => enemy.dispose())
    follower.assignFollowTarget(leader, 0)
    follower.update(.016, player, [follower, leader, enemy], [leader, enemy], [], null as never, () => {}, () => {}, true)
    expect((follower as unknown as { followCombatActive: boolean }).followCombatActive).toBe(true)
    expect(follower.activeFollowTarget).toBe(leader)

    enemy.takeDamage(9999)
    follower.update(.016, player, [follower, leader], [leader], [], null as never, () => {}, () => {}, true)
    expect((follower as unknown as { followCombatActive: boolean }).followCombatActive).toBe(false)
    expect(follower.tacticalOrder).toBe('follow')
    expect(follower.activeFollowTarget).toBe(leader)
  })

  it('charges a distant enemy after Follow instead of returning to spawn patrol waypoints', () => {
    const scene = new THREE.Scene(), player = new Player(scene)
    onTestFinished(() => player.dispose())
    const leader = new NPC(scene, 0, 80, Faction.PLAYER, 'roman', AIType.MELEE, 'Captain', 2, false)
    onTestFinished(() => leader.dispose())
    const follower = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Rider', 2, false)
    onTestFinished(() => follower.dispose())
    const enemy = new NPC(scene, 0, 600, Faction.ENEMY, 'viking', AIType.MELEE, 'Enemy', 2, false)
    onTestFinished(() => enemy.dispose())
    follower.group.position.z = 80
    follower.assignFollowTarget(leader, 0)
    follower.setTacticalOrder('charge')
    for (let frame = 0; frame < 10; frame++) {
      follower.update(.05, player, [leader, follower, enemy], [], [], null as never, () => {}, () => {}, true)
      expect(follower.currentState).toBe(AIState.CHASE)
    }
    expect(follower.group.position.z).toBeGreaterThan(80)
    enemy.takeDamage(99999)
    const stopped = follower.group.position.z
    for (let frame = 0; frame < 10; frame++) follower.update(.05, player, [leader, follower, enemy], [], [], null as never, () => {}, () => {}, true)
    expect(follower.group.position.z).toBe(stopped)
  })
})
