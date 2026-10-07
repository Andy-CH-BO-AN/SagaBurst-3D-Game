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

  // Scheduler budget is shared; per-mission borrowing and roster wiring lives in VeteranFieldBorrowing.
  it('creates only missing Scout Hunters NPCs one per frame and waits for the full official roster', () => {
    const h = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    const borrowed = h.residents.map(r => ({ npc: r.npc, position: r.npc.combatPosition.clone() }))
    borrowed.forEach(({ npc }) => { npc.hp = 41 })
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.npcFactories).toHaveLength(0); expect(h.controller.ready).toBe(false)
    const expected = h.roster.enemy.length + h.roster.friendly.filter(unit => unit.source !== 'town').length
    for (let i = 1; i <= expected; i++) {
      h.spawnDriver.advanceFrame()
      expect(h.npcFactories).toHaveLength(i)
      if (i < expected) { h.controller.updateFlow(600, 0); expect(h.controller.ready).toBe(false); expect(h.controller.evaluate(true)).toBeNull() }
    }
    expect(h.controller.ready).toBe(true)
    expect(h.actors).toHaveLength(h.roster.friendly.length)
    expect(h.enemies).toHaveLength(h.roster.enemy.length)
    borrowed.forEach(({ npc, position }) => {
      expect(h.actors).toContain(npc); expect(npc.hp).toBe(41)
      expect(npc.combatPosition.x).toBe(position.x); expect(npc.combatPosition.z).toBe(position.z)
    })
  })

  it('cancels queued materialization and disposes owned assets exactly once when cleanup is repeated', () => {
    const setup = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    expect(setup.controller.startActiveMission()).toBe(true)
    setup.spawnDriver.advanceFrame()
    const batches = [...setup.controller.spawnBatches]
    const npc = setup.npcFactories[0].npc
    const mount = setup.mountFactories[0]
    const disposeNpc = vi.spyOn(npc, 'dispose')
    const disposeMount = vi.spyOn(mount, 'dispose')
    setup.dispose()
    setup.dispose()
    setup.spawnDriver.advanceFrame()
    expect(batches.every(batch => batch.status === 'cancelled')).toBe(true)
    expect(setup.scheduler.pending).toBe(0)
    expect(setup.npcFactories).toHaveLength(1)
    expect(disposeNpc).toHaveBeenCalledOnce()
    expect(disposeMount).toHaveBeenCalledOnce()
    expect(setup.residents.every(({ npc, homeMount }) => npc.disposed && (!homeMount || homeMount.disposed))).toBe(true)
  })

  it('keeps readiness and cancellation isolated between concurrently constructed field fixtures', () => {
    const first = field({ templateId: 'veteran-village-intercept', autoStart: false })
    const second = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    first.controller.startActiveMission()
    second.controller.startActiveMission()
    first.spawnDriver.advanceFrame()
    expect(first.npcFactories).toHaveLength(1)
    expect(second.npcFactories).toHaveLength(0)
    first.dispose()
    expect(second.deploy()).toBe(true)
    expect(second.controller.ready).toBe(true)
    expect(second.actors.map(actor => actor.combatantId)).toEqual(second.roster.friendly.map(unit => unit.actorId))
  })
})
