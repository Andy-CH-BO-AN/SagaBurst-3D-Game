import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FOLLOW_THRESHOLDS, followLocalOffset, followSlotWorldPosition } from '../src/battle/FollowOrder'
import { AIType, Faction, NPC } from '../src/world/NPC'
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

  it('chooses the first living friendly once when the current leader dies', () => {
    const deadLeader = { id: 'captain', dead: true }
    const deadFirst = { id: 'friendly-0', dead: true }
    const livingFirst = { id: 'friendly-1', dead: false }
    const livingSecond = { id: 'friendly-2', dead: false }
    expect(selectLivingMissionLeader(deadLeader, [deadLeader, deadFirst, livingFirst, livingSecond])).toBe(livingFirst)
    expect(selectLivingMissionLeader(livingFirst, [livingFirst, livingSecond])).toBe(livingFirst)
  })
})
