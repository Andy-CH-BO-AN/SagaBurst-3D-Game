import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Campaign command gate wiring', () => {
  it('ignores Attack and Charge while campaign command gating says no enemy exists', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const h = controllerHarness(
      [spearman],
      null,
      order => order !== 'attack' && order !== 'charge',
    )

    h.input.pressAll()
    h.controller.update()
    h.input.press('1')
    h.controller.update()
    expect(spearman.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('部署階段：敵軍尚未進場')

    h.input.pressAll()
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(spearman.setTacticalOrder).not.toHaveBeenCalled()

    h.input.pressAll()
    h.controller.update()
    h.input.press('3')
    h.controller.update()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('defend')
  })
})
