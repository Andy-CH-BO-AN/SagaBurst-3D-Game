import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../helpers/veteranFieldFixture'
import { claimCareerMission } from '../../src/career/CareerProfile'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class {
  update(): void {}
  hide(): void {}
  dispose(): void {}
} }))

const fixtures: VeteranFieldFixture[] = []
afterEach(() => {
  fixtures.splice(0).reverse().forEach(fixture => fixture.dispose())
  vi.restoreAllMocks()
})
function field(options: VeteranFieldFixtureOptions) {
  const fixture = createVeteranFieldFixture(options)
  fixtures.push(fixture)
  return fixture
}

function finishField(setup: VeteranFieldFixture) {
  setup.enemies.forEach(npc => npc.takeDamage(999999))
  const stats = { damageDealt: 40, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
  const result = claimCareerMission(setup.profile(), setup.profile().activeMission!.id, 'victory', stats)
  Object.assign(setup.profile(), result.profile)
}

describe('VeteranFieldControllerLifecycle', () => {
  it('persists the final 120 seconds before resolving a Player-dead NPC-survived victory', () => {
    const setup = field({ templateId: 'veteran-tragedy-of-the-scouts' })
    expect(setup.start).toBe(true)
    setup.controller.updateFlow(119.9, 0)
    expect(setup.profile().activeMission?.survivalElapsed).toBeCloseTo(119.9)
    setup.player.dead = true
    setup.controller.updateFlow(.1, 0)
    expect(setup.profile().activeMission?.survivalElapsed).toBe(120)
    expect(setup.controller.survivalElapsedSeconds).toBe(120)
    expect(setup.controller.evaluate(true)).toBe('victory')
    expect(setup.profile().activeMission?.survivalElapsed).toBe(120)
    expect(setup.profile().activeMission?.phase).toBe('ENGAGING')
  })

  it('fails VI before the deadline when both Player and all NPC allies are dead', () => {
    const setup = field({ templateId: 'veteran-tragedy-of-the-scouts' })
    setup.player.dead = true
    setup.actors.forEach(npc => (npc.dead = true))
    setup.controller.updateFlow(119.9, 0)
    expect(setup.controller.evaluate(true)).toBe('failure')
  })

  it('elects a living leader and lets a sole surviving Player walk home', () => {
    const setup = field({ templateId: 'veteran-scout-hunters' })
    setup.controller.missionLeader!.takeDamage(999999)
    finishField(setup)
    expect(setup.controller.startReturning()).toBe(true)
    expect(setup.controller.missionLeader!.dead).toBe(false)
    const home = setup.leader!.formationTarget!.position.clone()
    setup.actors.forEach(npc => npc.takeDamage(999999))
    setup.stepFrame()
    expect(setup.controller.partyReturned).toBe(true)
    setup.player.group.position.copy(home)
    expect(setup.controller.returnComplete).toBe(true)
  })

  it('keeps the result and existing orders when saving the return fails', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    finishField(setup)
    const leader = setup.leader!
    leader.assignFormationTarget.mockClear()
    setup.setSaving(false)
    expect(setup.controller.startReturning()).toBe(false)
    expect(setup.controller.phase).toBe('RESULT')
    expect(leader.assignFormationTarget).not.toHaveBeenCalled()
  })

})
