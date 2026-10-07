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
  it('marches all four squads and triggers one shared charge', () => {
    const squads = Array.from({ length: 4 }, (_, index) => {
      const leader = rider('leader-' + index)
      const member = rider('member-' + index)
      return { leader, member, spec: { leader: leader as unknown as NPC, members: [leader, member] as unknown as NPC[], leaderOffset: new THREE.Vector3(index * 10, 0, index * -2) } }
    })
    const follow = vi.fn((finished?: () => void) => finished?.())
    const accepted = vi.fn(() => true)
    const chargeVoice = vi.fn()
    const breach = new THREE.Vector3(100, 0, 0)
    const controller = new MountedMissionMarchController(
      squads.flatMap(({ leader, member }) => [leader, member]) as unknown as NPC[], breach, follow, accepted, chargeVoice, false,
      { squads: squads.map(squad => squad.spec) as unknown as NonNullable<ConstructorParameters<typeof MountedMissionMarchController>[6]>['squads'], marchTarget: breach, chargeDistance: 10 },
    )

    controller.start()
    expect(follow).toHaveBeenCalledTimes(1)
    for (const [index, squad] of squads.entries()) {
      expect(squad.leader.assignFormationTarget).toHaveBeenCalledTimes(1)
      const leaderTarget = squad.leader.assignFormationTarget.mock.calls[0][1] as THREE.Vector3
      expect(leaderTarget.x).toBe(100 + index * 10)
      expect(leaderTarget.z).toBeCloseTo(index * -2)
      expect(squad.member.assignFollowTarget).toHaveBeenCalledTimes(1)
      expect(squad.member.assignFollowTarget.mock.calls[0][0]).toBe(squad.leader)
    }
    controller.update()
    expect(accepted).not.toHaveBeenCalled()
    squads[0].leader.combatPosition.copy(breach)
    controller.update()
    controller.update()
    expect(accepted).toHaveBeenCalledTimes(1)
    expect(chargeVoice).toHaveBeenCalledTimes(1)
    expect(controller.hasCharged).toBe(true)
    for (const { leader, member } of squads) {
      expect(leader.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
      expect(member.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    }
  })

  it('restores a charged mission without replaying Follow or Charge', () => {
    const group = [rider('captain'), rider('member'), rider('ranger'), rider('member-2')]
    const follow = vi.fn()
    const accepted = vi.fn()
    const charge = vi.fn()
    const controller = new MountedMissionMarchController(group as unknown as NPC[], new THREE.Vector3(), follow, accepted, charge, true, {
      squads: [
        { leader: group[0] as unknown as NPC, members: group.slice(0, 2) as unknown as NPC[] },
        { leader: group[2] as unknown as NPC, members: group.slice(2) as unknown as NPC[] },
      ],
    })
    controller.start()
    controller.update()
    expect(follow).not.toHaveBeenCalled()
    expect(accepted).not.toHaveBeenCalled()
    expect(charge).not.toHaveBeenCalled()
    expect(controller.hasCharged).toBe(true)
    for (const npc of group) expect(npc.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
  })

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

  it('resumes living riders on foot when their saved mounts died', () => {
    const target = new THREE.Vector3(20, 0, 0)
    const leader = rider('captain', 20)
    const member = rider('member', 20)
    leader.mount = null
    member.mount = null
    const accepted = vi.fn(() => true)
    const controller = new MountedMissionMarchController([leader, member] as unknown as NPC[], target, vi.fn(), accepted, vi.fn(), false, {
      squads: [{ leader: leader as unknown as NPC, members: [leader, member] as unknown as NPC[] }],
    })

    expect(() => controller.start()).not.toThrow()
    expect(() => controller.update()).not.toThrow()
    expect(accepted).toHaveBeenCalledTimes(1)
    expect(member.assignFollowTarget).toHaveBeenCalledTimes(1)
    expect(member.assignFollowTarget.mock.calls[0][0]).toBe(leader)
  })
})
