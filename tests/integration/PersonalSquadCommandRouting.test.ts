import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { createArmyCommandHarness as controllerHarness, type CommandRecipientFixture } from '../helpers/armyCommandHarness'

describe('Personal Squad command lifecycle routing', () => {

  it('keeps personal ALL identity and preserves its command when Dismiss through either selection is rejected', () => {
    const personal = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 'personal', dead: false,
      tacticalOrder: 'defend', setTacticalOrder: vi.fn((order: string) => { personal.tacticalOrder = order }) }
    const issue = vi.fn(() => false)
    const { controller, input, ui } = controllerHarness([personal], null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    const entries = ui.render.mock.lastCall![0]
    expect(entries.map(entry => entry.target)).toEqual(['squad:personal', 'all'])
    input.pressAll(); controller.update(); input.press('2'); controller.update()
    expect(personal.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    ui.showFeedback.mockClear()
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 0) input.press('9')
      else input.pressAll()
      controller.update(); input.press('6'); controller.update()
    }
    expect(issue).toHaveBeenCalledTimes(2)
    expect(personal.tacticalOrder).toBe('charge')
    expect(ui.showFeedback).not.toHaveBeenCalled()
    expect(controller.isSubmenuOpen).toBe(false)
    personal.tacticalOrder = 'defend'; ui.render.mockClear(); controller.update()
    expect(ui.render.mock.lastCall![0][0]).toMatchObject({ target: 'squad:personal', order: 'defend' })
  })

  it('deploys the current HR roster once through ALL → Follow and routes Dismiss only to its owner', () => {
    const profile = createCareerProfile('roman')
    profile.personalSquad = { members: ['returned', 'casualty', 'new'].map(id => ({ id: `personal:${id}`, type: 'soldier' as const })) }
    const mission: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
      memberIds: ['personal:returned', 'personal:casualty'], contribution: emptyPersonalContribution(),
      members: { 'personal:returned': { status: 'exited' }, 'personal:casualty': { status: 'dead', hp: 0 } } }
    const scheduler = new NpcSpawnScheduler()
    // Real Follow and scheduler queues, with no materialization or scene/model constructors.
    const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
      actors: [], mission, state: 'RESERVE', read: () => profile,
      player: () => ({ dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }),
      options: { scheduler }, muster: profile.personalSquad.members.map((_, index) => ({ x: index * 5, z: 0, yaw: 0 })),
      pending: new Map(), batches: [], commandRevision: 0, returnCommand: -1000,
      boarding: new Map(), returningOnFoot: new Set(), awaitingEaglePad: new Set(),
      eaglePads: new EaglePadReservations([]), reservedEagleOwners: new Set(), standbyIds: new Set(), standbyBatches: new Set(), homeArrivals: new Set(), standbyFailures: new Map(),
    }) as Pick<PersonalSquadRuntime, 'follow' | 'dismiss' | 'checkpoint' | 'hudPendingIds' | 'cancelPendingSpawns' | 'canRefit' | 'updateLifecycle'>
    const issue = vi.fn((order: string) => order === 'follow' ? runtime.follow() : runtime.dismiss()), npcs: CommandRecipientFixture[] = []
    const { controller, input } = controllerHarness(npcs, null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    try {
      input.pressAll(); controller.update(); input.press('5'); controller.update()
      expect(issue).toHaveBeenLastCalledWith('follow')
      expect(runtime.hudPendingIds).toEqual(['personal:returned', 'personal:new'])
      expect(runtime.checkpoint()).toMatchObject({ memberIds: ['personal:returned', 'personal:casualty', 'personal:new'],
        members: { 'personal:casualty': { status: 'dead', hp: 0 } } })
      input.pressAll(); controller.update(); input.press('5'); controller.update()
      expect(scheduler.pending).toBe(2)
      const member = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 1, dead: false, setTacticalOrder: vi.fn() }
      npcs.push(member)
      input.pressAll(); controller.update(); input.press('6'); controller.update()
      expect(issue).toHaveBeenLastCalledWith('dismiss')
      expect(member.setTacticalOrder).not.toHaveBeenCalled()
      expect(scheduler.pending).toBe(0)
    } finally { runtime.cancelPendingSpawns() }
  })

  it('sends tactical orders only to deployed private members while HR standby still answers Follow', () => {
    // Real accept predicate (TownScene: personal owner → acceptsCommand) on a numeric ownership seam.
    const member = (id: string) => {
      const npc = { combatantId: id, faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 'personal', dead: false,
        tacticalOrder: 'defend', setTacticalOrder: vi.fn((order: string) => { npc.tacticalOrder = order }) }
      return npc
    }
    const deployed = member('personal:old'), hire = member('personal:new')
    const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
      state: 'ACTIVE', options: { hasHR: true }, actorSet: new Set([deployed, hire]), standbyIds: new Set(['personal:new']),
    }) as Pick<PersonalSquadRuntime, 'acceptsCommand'> & { state: string }
    const issue = vi.fn(() => true)
    const { controller, input } = controllerHarness([deployed, hire], null, null, null, 'roman', 'squad', true, undefined,
      { accepts: npc => runtime.acceptsCommand(npc), enabled: () => true, issue })
    input.press('9'); controller.update(); input.press('2'); controller.update()
    input.pressAll(); controller.update(); input.press('1'); controller.update()
    expect(deployed.setTacticalOrder.mock.calls).toEqual([['charge'], ['attack']])
    expect(hire.setTacticalOrder).not.toHaveBeenCalled()
    // The whole squad on HR standby has no tactical recipient; Follow still reaches the owner.
    runtime.state = 'RESERVE'
    input.press('9'); controller.update(); input.press('2'); controller.update()
    input.pressAll(); controller.update(); input.press('1'); controller.update()
    expect(deployed.setTacticalOrder).toHaveBeenCalledTimes(2)
    expect(hire.setTacticalOrder).not.toHaveBeenCalled()
    // ALL → Follow reaches the private owner (TownScene routes it to `personalSquad.follow()`).
    input.pressAll(); controller.update(); input.press('5'); controller.update()
    expect(issue).toHaveBeenCalledExactlyOnceWith('follow', 'all')
  })

  it('does not handle Personal Squad commands while a formal mission blocks the owner', () => {
    const issue = vi.fn(() => false)
    const { controller, input } = controllerHarness([], null, null, null, 'roman', 'squad', true, { issue, enabled: () => false })
    input.pressAll(); controller.update(); input.press('5'); controller.update()
    expect(issue).not.toHaveBeenCalled()
  })

  it('lets a reserve-only HR squad receive Follow without treating reserves as deployed troops', () => {
    const saved: PersonalSquadMission = {
      squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
      memberIds: ['personal:eagle', 'personal:foot'],
      members: { 'personal:eagle': { status: 'reserve' }, 'personal:foot': { status: 'reserve' } },
      contribution: emptyPersonalContribution(),
    }
    let pending: string[] = []
    const issue = vi.fn((order: string, target: string) => {
      if (order !== 'follow' || target !== 'squad:personal') return false
      pending = ['personal:eagle']; return true
    })
    const provider = () => careerCommandHudRoster({
      sceneKey: 'town:roman', faction: 'roman', personal: saved, personalPendingIds: pending, actors: [],
    })
    const { controller, input, ui } = controllerHarness([], null, null, null, 'roman', 'squad', true, undefined,
      { accepts: () => false, enabled: () => true, issue }, provider)
    expect(ui.render.mock.lastCall![0].map(entry => [entry.target, entry.summary])).toEqual([
      ['squad:personal', '0/0 · 待命 2'], ['all', '0/0'],
    ])
    input.press('9'); controller.update(); input.press('5'); controller.update()
    expect(issue).toHaveBeenCalledWith('follow', 'squad:personal')
    expect(ui.render.mock.lastCall![0].map(entry => [entry.target, entry.summary])).toEqual([
      ['squad:personal', '0/1 · 部署中 1 · 待命 1'], ['all', '0/1 · 部署中 1'],
    ])
  })
})
