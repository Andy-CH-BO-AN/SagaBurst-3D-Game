import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Army command formation completion wiring', () => {
  it('does not mark a missing ALL preset as formation when confirming placement', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const deadArcher = {
      faction: Faction.PLAYER,
      presetId: 'viking_archer',
      dead: true,
      setTacticalOrder: vi.fn(),
    }
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(() => {
        formation.isPlacementMode = false
        return { accepted: true, count: 1, commandId: 7, participants: [spearman] }
      }),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([spearman, deadArcher], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    h.input.pressE()
    h.controller.update()

    const hud = h.ui.render.mock.calls.at(-1)?.[0] as ReadonlyArray<{ key: string; order: string }>
    expect(hud.find(entry => entry.key === '3')?.order).toBe('attack')
    expect(hud.find(entry => entry.key === '2')?.order).toBe('formation')
    expect(hud.find(entry => entry.key === '`')?.order).toBe('mixed')
  })

  it('does not show a defend completion message after ALL Formation is overwritten', () => {
    const participant = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    let completionHandler: ((commandId: number, target: string, participants: any[], status: string) => void) | undefined
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn((handler) => { completionHandler = handler }),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(() => {
        formation.isPlacementMode = false
        return { accepted: true, count: 1, commandId: 12, participants: [participant] }
      }),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([participant], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    h.input.clickLeft()
    h.controller.update()
    h.input.pressAll()
    h.controller.update()
    h.input.press('3')
    h.controller.update()

    const feedbackCount = h.ui.showFeedback.mock.calls.length
    completionHandler?.(12, 'all', [participant], 'abandoned')
    expect(h.ui.showFeedback).toHaveBeenCalledTimes(feedbackCount)
  })
})
