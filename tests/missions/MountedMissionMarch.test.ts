import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MountedMissionMarchController } from '../../src/career/MountedMissionMarch'
import type { NPC } from '../../src/world/NPC'

function rider(name: string, x = 0): {
  name: string
  dead: boolean
  combatPosition: THREE.Vector3
  mount: { baseSpeed: number; dead?: boolean } | null
  setTacticalOrder: ReturnType<typeof vi.fn>
  assignFormationTarget: ReturnType<typeof vi.fn>
  assignFollowTarget: ReturnType<typeof vi.fn>
} {
  return {
    name, dead: false, combatPosition: new THREE.Vector3(x, 0, 0), mount: { baseSpeed: 12 },
    setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(),
  }
}

describe('MountedMissionMarchController squad scaling', () => {

  it('replaces a fallen squad leader without prematurely charging', () => {
    const leader = rider('dead-leader'); leader.dead = true
    const follower = rider('follower')
    const accepted = vi.fn(() => true)
    const controller = new MountedMissionMarchController([leader, follower] as unknown as NPC[], new THREE.Vector3(100, 0, 0), vi.fn(), accepted, vi.fn(), false, {
      leaderDeathMode: 'replace',
      squads: [{ leader: leader as unknown as NPC, members: [leader, follower] as unknown as NPC[] }],
    })
    expect(() => controller.start()).not.toThrow()
    controller.update()
    expect(controller.hasCharged).toBe(false)
    expect(accepted).not.toHaveBeenCalled()
    expect(follower.assignFormationTarget).toHaveBeenCalled()
    expect(follower.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('resumes the same march with a surviving leader and foot followers without replaying voices', () => {
    const leader = rider('captain')
    const deputy = rider('deputy')
    const follower = rider('follower'); follower.mount = null
    const follow = vi.fn()
    const accepted = vi.fn(() => true)
    const target = new THREE.Vector3(100, 0, 0)
    const controller = new MountedMissionMarchController([leader, deputy, follower] as unknown as NPC[], target, follow, accepted, vi.fn(), false, {
      leaderDeathMode: 'replace',
      squads: [{ leader: leader as unknown as NPC, members: [leader, deputy, follower] as unknown as NPC[] }],
    })
    controller.start()
    leader.dead = true
    deputy.combatPosition.set(-20, 0, 0)
    controller.update(false)
    expect(deputy.assignFormationTarget).not.toHaveBeenCalled()
    controller.resumeTravel()
    expect(deputy.assignFormationTarget.mock.calls[0][1]).toEqual(target)
    expect(deputy.assignFormationTarget.mock.calls[0][3]).toBe(7.5)
    expect(follower.assignFollowTarget.mock.lastCall?.[0]).toBe(deputy)
    expect(follow).toHaveBeenCalledTimes(1)
    expect(accepted).not.toHaveBeenCalled()
    expect(controller.hasCharged).toBe(false)
  })
})


describe('Mounted mission player ownership handover', () => {
  it('excludes a claimed second squad from travel and charge, then resumes its original AI on dismissal', () => {
    // Four cheap command-capable doubles; no actor or mount materialization.
    const group = [rider('first'), rider('first-member'), rider('second'), rider('second-member')]
    const actors = group as unknown as NPC[], claimed = new Set<NPC>()
    const controller = new MountedMissionMarchController(actors, new THREE.Vector3(100, 0, 0), vi.fn(), () => true, vi.fn(), false, {
      leaderDeathMode: 'replace', leaderMode: 'independent',
      acceptsActor: npc => !claimed.has(npc),
      squads: [{ leader: actors[0], members: actors.slice(0, 2) }, { leader: actors[2], members: actors.slice(2) }],
    })
    controller.start()
    actors.slice(2).forEach(npc => claimed.add(npc))
    group.forEach(npc => { npc.assignFormationTarget.mockClear(); npc.assignFollowTarget.mockClear(); npc.setTacticalOrder.mockClear() })
    controller.resumeTravel()
    controller.engage()
    expect(group[0].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    expect(group[1].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    for (const npc of group.slice(2)) {
      expect(npc.assignFormationTarget).not.toHaveBeenCalled()
      expect(npc.assignFollowTarget).not.toHaveBeenCalled()
      expect(npc.setTacticalOrder).not.toHaveBeenCalled()
    }
    claimed.delete(actors[2]); controller.resumeActor(actors[2])
    expect(group[2].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    expect(group[3].setTacticalOrder).not.toHaveBeenCalled()
  })
})
