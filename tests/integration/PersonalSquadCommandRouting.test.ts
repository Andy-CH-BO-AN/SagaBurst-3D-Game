import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import type { PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Personal Squad command lifecycle routing', () => {
  it('keeps private ALL and its identity separate from all eight official squads; ineffective Dismiss keeps the command', () => {
    const official = Array.from({ length: 8 }, (_, i) => ({ squadId: i + 1, setTacticalOrder: vi.fn() }))
    const personal = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 'personal', dead: false,
      tacticalOrder: 'defend', setTacticalOrder: vi.fn((order: string) => { personal.tacticalOrder = order }) }
    const issue = vi.fn(() => false)
    const { controller, input, ui } = controllerHarness([personal], null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    const entries = ui.render.mock.lastCall![0]
    expect(entries.map((entry: any) => entry.target)).toEqual(['squad:personal', 'all'])
    input.pressAll(); controller.update(); input.press('2'); controller.update()
    expect(personal.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    input.press('9'); controller.update(); input.press('6'); controller.update()
    expect(issue).toHaveBeenCalledExactlyOnceWith('dismiss')
    expect(personal.tacticalOrder).toBe('charge')
    for (const unit of official) expect(unit.setTacticalOrder).not.toHaveBeenCalled()
    personal.tacticalOrder = 'defend'; ui.render.mockClear(); controller.update()
    expect(ui.render.mock.lastCall![0][0]).toMatchObject({ target: 'squad:personal', order: 'defend' })
  })

  it('allows existing ALL → Follow me with an empty reserve runtime and routes Dismiss only to its owner', () => {
    const issue = vi.fn(() => true), npcs: any[] = []
    const { controller, input } = controllerHarness(npcs, null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    input.pressAll(); controller.update()
    input.press('5'); controller.update()
    expect(issue).toHaveBeenLastCalledWith('follow')
    const member = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 1, dead: false, setTacticalOrder: vi.fn() }
    npcs.push(member)
    input.pressAll(); controller.update(); input.press('6'); controller.update()
    expect(issue).toHaveBeenLastCalledWith('dismiss')
    expect(member.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('does not handle Personal Squad commands while a formal mission blocks the owner', () => {
    const issue = vi.fn(() => false)
    const { controller, input } = controllerHarness([], null, null, null, 'roman', 'squad', true, { issue, enabled: () => false })
    input.pressAll(); controller.update(); input.press('5'); controller.update()
    expect(issue).not.toHaveBeenCalled()
  })

  it('does not report success for reserve or repeated returning Dismiss', () => {
    const issue = vi.fn(() => false)
    const { controller, input, ui } = controllerHarness([], null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    for (let attempt = 0; attempt < 2; attempt++) {
      input.pressAll(); controller.update(); input.press('6'); controller.update()
    }
    expect(issue).toHaveBeenCalledTimes(2)
    expect(ui.showFeedback).not.toHaveBeenCalled()
    expect(controller.isSubmenuOpen).toBe(false)
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
