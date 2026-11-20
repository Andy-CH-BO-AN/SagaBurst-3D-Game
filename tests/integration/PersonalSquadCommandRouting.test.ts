import { careerRankFixture } from '../helpers/careerRankFixture'
import { TownScene } from '../../src/town/TownScene'
import { commanderGateDefenseSlots } from '../../src/career/CommanderTownRoster'
import { createMissionCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import type { CareerProfile } from '../../src/career/CareerProfile'
import type { ArmyCommandTarget } from '../../src/battle/CommandTarget'
import { describe, expect, it, vi } from 'vitest'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/world/NPC'
import { createArmyCommandHarness as controllerHarness, type CommandRecipientFixture } from '../helpers/armyCommandHarness'
import { standbyHarness } from '../helpers/personalSquadRuntimeHarness'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'

/** Only command ports are installed; no TownScene/actor constructor runs. */
function nativeDismissFixture() {
  const profile = createCareerProfile('roman')
  Object.assign(profile, careerRankFixture(profile.faction, 'commander'));
  const squads = commanderGateDefenseSlots()
  const mission = { ...createActiveCareerMission('legacy-defense', 0, 0, 0, 'ground-defense'), kind: 'commander-four-gate-defense' as const }
  mission.phase = 'ENGAGING'
  mission.officialSquad = createMissionCommandAuthority(mission.id, 'roman', 'commander', [], squads)
  mission.officialSquad.commandedSquadIds = [8]
  profile.activeMission = mission
  const actor = { combatantId: squads.find(squad => squad.squadId === 8)!.actorIds[0], dead: false,
    squadId: 8, faction: Faction.TOWN, combatOwnership: 'mission-official' }
  const returned = vi.fn(), commit = vi.fn((next: CareerProfile) => { scene.profile = next; return true })
  const scene = Object.assign(Object.create(TownScene.prototype) as {
    profile: CareerProfile
    issuePartyOrder(order: 'dismiss', target: ArmyCommandTarget): boolean
  }, { profile, commandActors: [] as typeof actor[], residents: [], world: { faction: 'roman' },
    commit, snapshotOfficialActor: () => ({ status: 'deployed', hp: 60 }),
    defense: { returnPlayerCommand: returned }, playMissionVoice: vi.fn(),
  })
  return { scene, actor, returned, commit, activate: () => Object.assign(scene, { commandActors: [actor] }) }
}

describe('Personal Squad command lifecycle routing', () => {

  it('does not let an empty legacy air-slot Dismiss revoke the current west ground squad', () => {
    const h = nativeDismissFixture()
    expect(h.scene.issuePartyOrder('dismiss', 'squad:8')).toBe(false)
    expect(h.scene.profile.activeMission!.officialSquad!.commandedSquadIds).toEqual([8])
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.returned).not.toHaveBeenCalled()
  })

  it('hands a live west ground squad Dismiss back to its defense owner after the command save', () => {
    const h = nativeDismissFixture(); h.activate()
    expect(h.scene.issuePartyOrder('dismiss', 'squad:8')).toBe(true)
    expect(h.scene.profile.activeMission!.officialSquad!.commandedSquadIds).toEqual([])
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.returned).toHaveBeenCalledExactlyOnceWith(h.actor)
    expect(h.commit.mock.invocationCallOrder[0]).toBeLessThan(h.returned.mock.invocationCallOrder[0])
  })

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
    const mission: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
      memberIds: ['personal:returned', 'personal:casualty'], contribution: emptyPersonalContribution(),
      members: { 'personal:returned': { status: 'exited' }, 'personal:casualty': { status: 'dead', hp: 0 } } }
    // Real runtime restored from the saved HR checkpoint; Follow only queues scheduler jobs here.
    const h = standbyHarness(['returned', 'casualty', 'new'].map(id => ({ id: `personal:${id}` })), { saved: mission })
    const runtime = h.runtime
    runtime.restoreMission(mission)
    const issue = vi.fn((order: string) => order === 'follow' ? runtime.follow() : runtime.dismiss()), npcs: CommandRecipientFixture[] = []
    const { controller, input } = controllerHarness(npcs, null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    try {
      input.pressAll(); controller.update(); input.press('5'); controller.update()
      expect(issue).toHaveBeenLastCalledWith('follow')
      expect(runtime.hudPendingIds).toEqual(['personal:returned', 'personal:new'])
      expect(runtime.checkpoint()).toMatchObject({ memberIds: ['personal:returned', 'personal:casualty', 'personal:new'],
        members: { 'personal:casualty': { status: 'dead', hp: 0 } } })
      input.pressAll(); controller.update(); input.press('5'); controller.update()
      expect(h.scheduler.pending).toBe(2)
      const member = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 1, dead: false, setTacticalOrder: vi.fn() }
      npcs.push(member)
      input.pressAll(); controller.update(); input.press('6'); controller.update()
      expect(issue).toHaveBeenLastCalledWith('dismiss')
      expect(member.setTacticalOrder).not.toHaveBeenCalled()
      expect(h.scheduler.pending).toBe(0)
    } finally { runtime.cancelPendingSpawns() }
  })

  it('sends tactical orders only to deployed private members while HR standby still answers Follow', () => {
    // Real runtime: one member deployed by Follow, then a later hire standing on HR standby.
    const h = standbyHarness([{ id: 'personal:old' }])
    h.runtime.materializeStandby(); h.flush()
    expect(h.runtime.follow()).toBe(true)
    expect(recruitPersonalSquadMember(h.profile, 'soldier', next => { h.profile = next; return true }, () => 'personal:new').recruited).toBe(true)
    h.runtime.materializeStandby(); h.flush()
    const [deployed, hire] = h.actors
    const hireOrder = hire.tacticalOrder
    const issue = vi.fn(() => true)
    // TownScene's accept predicate for the personal owner is `acceptsCommand`.
    const { controller, input } = controllerHarness(h.actors, null, null, null, 'roman', 'squad', true, undefined,
      { accepts: npc => h.runtime.acceptsCommand(npc), enabled: () => true, issue })
    input.press('9'); controller.update(); input.press('2'); controller.update()
    expect([deployed.tacticalOrder, hire.tacticalOrder]).toEqual(['charge', hireOrder])
    input.pressAll(); controller.update(); input.press('1'); controller.update()
    expect([deployed.tacticalOrder, hire.tacticalOrder]).toEqual(['attack', hireOrder])
    // Once the whole squad is back on HR standby there is no tactical recipient; Follow still reaches the owner.
    expect(h.runtime.dismiss()).toBe(true)
    deployed.arrived = true; h.runtime.updateLifecycle()
    expect(h.runtime.state).toBe('RESERVE')
    const standbyOrders = [deployed.tacticalOrder, hire.tacticalOrder]
    input.press('9'); controller.update(); input.press('2'); controller.update()
    input.pressAll(); controller.update(); input.press('1'); controller.update()
    expect([deployed.tacticalOrder, hire.tacticalOrder]).toEqual(standbyOrders)
    expect(issue).not.toHaveBeenCalled()
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
