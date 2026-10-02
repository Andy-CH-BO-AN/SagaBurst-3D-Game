import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FOLLOW_THRESHOLDS, followLocalOffset, followSlotWorldPosition, returnFollowLocalOffset } from '../src/battle/FollowOrder'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import type { Mount } from '../src/world/Mount'
import { Player } from '../src/player/Player'
import { selectLivingMissionLeader } from '../src/career/BanditMissionController'

describe('FOLLOW tactical geometry', () => {
  it('assigns ten stable, distinct slots instead of one leader position', () => {
    const first = Array.from({ length: 10 }, (_, index) => followLocalOffset(index))
    const second = Array.from({ length: 10 }, (_, index) => followLocalOffset(index))
    expect(new Set(first.map(slot => `${slot.x}:${slot.z}`)).size).toBe(10)
    expect(second.map(slot => slot.toArray())).toEqual(first.map(slot => slot.toArray()))
    expect(first.every(slot => slot.length() >= FOLLOW_THRESHOLDS.infantrySpacing)).toBe(true)
  })

  it('rotates local slots with leader heading', () => {
    const local = new THREE.Vector3(2, 0, -3)
    expect(followSlotWorldPosition(new THREE.Vector3(10, 0, 20), 0, local).toArray()).toEqual([12, 0, 17])
    const turned = followSlotWorldPosition(new THREE.Vector3(10, 0, 20), Math.PI / 2, local)
    expect(turned.x).toBeCloseTo(7)
    expect(turned.z).toBeCloseTo(18)
  })

  it('uses wider mounted spacing and centralized movement thresholds', () => {
    expect(followLocalOffset(0, true).length()).toBeGreaterThan(followLocalOffset(0, false).length())
    expect(FOLLOW_THRESHOLDS.holdDistance).toBeLessThan(FOLLOW_THRESHOLDS.runDistance)
    expect(FOLLOW_THRESHOLDS.runDistance).toBeLessThan(FOLLOW_THRESHOLDS.regroupDistance)
  })

  it('fits all eighteen large-mission followers within the Town return muster', () => {
    const returning = Array.from({ length: 18 }, (_, index) => returnFollowLocalOffset(index, 18))
    expect(new Set(returning.map(slot => `${slot.x}:${slot.z}`)).size).toBe(18)
    expect(Math.max(...returning.map(slot => slot.length()))).toBeLessThan(18)
    expect(followLocalOffset(17).length()).toBeGreaterThan(18)
  })

  it('smooths a captain turn instead of instantly swinging followers across the road', () => {
    const scene = new THREE.Scene()
    const leader = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Leader', 1, false)
    const follower = new NPC(scene, 0, -10, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
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
    const follower = new NPC(scene, 0, 5, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
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
    const leader = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Leader', 1, false)
    const follower = new NPC(scene, 0, 3, Faction.TOWN, 'roman', AIType.MELEE, 'Follower', 1, false)
    const enemy = new NPC(scene, 0, 6, Faction.BANDIT, 'viking', AIType.MELEE, 'Enemy', 1, false)
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
    const leader = new NPC(scene, 0, 80, Faction.PLAYER, 'roman', AIType.MELEE, 'Captain', 2, false)
    const follower = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Rider', 2, false)
    const enemy = new NPC(scene, 0, 600, Faction.ENEMY, 'viking', AIType.MELEE, 'Enemy', 2, false)
    follower.group.position.z = 80
    follower.assignFollowTarget(leader, 0)
    follower.setTacticalOrder('charge')
    for (let frame = 0; frame < 10; frame++) {
      follower.update(.05, player, [leader, follower, enemy], [], [], null as never, () => {}, () => {}, true)
      expect(follower.state).toBe(AIState.CHASE)
    }
    expect(follower.group.position.z).toBeGreaterThan(80)
    enemy.takeDamage(99999)
    const stopped = follower.group.position.z
    for (let frame = 0; frame < 10; frame++) follower.update(.05, player, [leader, follower, enemy], [], [], null as never, () => {}, () => {}, true)
    expect(follower.group.position.z).toBe(stopped)
  })

  it('chooses the first living friendly once when the current leader dies', () => {
    const deadLeader = { id: 'captain', dead: true }
    const deadFirst = { id: 'friendly-0', dead: true }
    const livingFirst = { id: 'friendly-1', dead: false }
    const livingSecond = { id: 'friendly-2', dead: false }
    expect(selectLivingMissionLeader(deadLeader, [deadLeader, deadFirst, livingFirst, livingSecond])).toBe(livingFirst)
    expect(selectLivingMissionLeader(livingFirst, [livingFirst, livingSecond])).toBe(livingFirst)
  })
})
