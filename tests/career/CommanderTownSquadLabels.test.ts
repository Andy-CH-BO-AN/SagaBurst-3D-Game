import { describe, expect, it, vi } from 'vitest'
import {
  resolveCommanderTownTargetLabel,
} from '../../src/career/CommanderTownSquadLabels'
import { ArmyCommandUI } from '../../src/ui/ArmyCommandUI'
import { Faction } from '../../src/world/NPC'
import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Commander Town Squad Labels and HUD alignment', () => {

  it('triggers immediate HUD re-render on resolver change and avoids duplicate re-render on identical resolver', () => {
    // 1. Direct ArmyCommandUI test: dirty-check and version tracking
    const ui = Object.create(ArmyCommandUI.prototype) as ArmyCommandUI
    const changeEvents: number[] = []
    ui.setOnOfficialSquadLabelChanged(() => {
      changeEvents.push(ui.getLabelOptionVersion())
    })

    expect(ui.getLabelOptionVersion()).toBe(0)
    // First assignment: changed -> returns true, version increments, listener notified
    expect(ui.setOfficialSquadLabel(resolveCommanderTownTargetLabel)).toBe(true)
    expect(ui.getLabelOptionVersion()).toBe(1)
    expect(changeEvents).toEqual([1])

    // Duplicate assignment with identical reference: unchanged -> returns false, version stable, listener not notified
    expect(ui.setOfficialSquadLabel(resolveCommanderTownTargetLabel)).toBe(false)
    expect(ui.getLabelOptionVersion()).toBe(1)
    expect(changeEvents).toEqual([1])

    // Switching to undefined / different resolver: changed -> returns true, version increments, listener notified
    expect(ui.setOfficialSquadLabel(undefined)).toBe(true)
    expect(ui.getLabelOptionVersion()).toBe(2)
    expect(changeEvents).toEqual([1, 2])

    // 2. ArmyCommandController test: verifies instant re-render upon resolver switch with unchanged roster
    const actor = { combatantId: 'guard-1', faction: Faction.PLAYER, squadId: 2, setTacticalOrder: vi.fn() }
    const h = controllerHarness([actor], null, null, null, 'roman', 'squad', true)

    // Initial render before resolver set: squad:2 uses default label '第 2 隊'
    const initialRenderCalls = h.ui.render.mock.calls.length
    expect(initialRenderCalls).toBeGreaterThan(0)
    const initialEntry = h.ui.render.mock.lastCall![0].find(e => e.target === 'squad:2')
    expect(initialEntry?.label).toBe('第 2 隊')

    // Setting official resolver: immediately triggers controller re-render with updated label
    const changed = h.ui.setOfficialSquadLabel(resolveCommanderTownTargetLabel)
    expect(changed).toBe(true)
    expect(h.ui.render.mock.calls.length).toBe(initialRenderCalls + 1)
    const updatedEntry = h.ui.render.mock.lastCall![0].find(e => e.target === 'squad:2')
    expect(updatedEntry?.label).toBe('北門騎兵／指揮隊')

    // Setting identical resolver again: no re-render
    const changedAgain = h.ui.setOfficialSquadLabel(resolveCommanderTownTargetLabel)
    expect(changedAgain).toBe(false)
    expect(h.ui.render.mock.calls.length).toBe(initialRenderCalls + 1)

    // Subsequent frame update with same state: no duplicate re-render
    h.controller.update()
    expect(h.ui.render.mock.calls.length).toBe(initialRenderCalls + 1)
  })
})
