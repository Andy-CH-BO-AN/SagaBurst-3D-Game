import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'
import { InventoryManager } from '../../src/rpg/InventoryManager'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Army command roster, dispatch and submenu', () => {
  it('commands explicit Town allies and personal members separately while excluding unassigned PLAYER troops', () => {
    const official = { combatantId: 'official', faction: Faction.TOWN, squadId: 1, setTacticalOrder: vi.fn() }
    const personal = { combatantId: 'personal:test', faction: Faction.PLAYER, squadId: 'personal', setTacticalOrder: vi.fn() }
    const bystander = { combatantId: 'bystander', faction: Faction.PLAYER, squadId: 1, setTacticalOrder: vi.fn() }
    const acceptedIds = new Set(['official', 'personal:test'])
    const issue = vi.fn(() => true)
    const h = controllerHarness([official, personal, bystander], null, null, null, 'viking', 'squad', true, undefined,
      { accepts: npc => acceptedIds.has(npc.combatantId), enabled: () => true, issue })
    const entries = h.ui.render.mock.calls.at(-1)![0]
    expect(entries.map(entry => [entry.target, entry.summary])).toEqual([['squad:1', '1/1'], ['squad:personal', '1/1'], ['all', '2/2']])
    h.input.press('1'); h.controller.update(); h.input.press('2'); h.controller.update()
    expect(official.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(personal.setTacticalOrder).not.toHaveBeenCalled()
    expect(bystander.setTacticalOrder).not.toHaveBeenCalled()
    h.input.press('9'); h.controller.update(); h.input.press('5'); h.controller.update()
    expect(issue).toHaveBeenCalledWith('follow', 'squad:personal')
    h.input.pressAll(); h.controller.update(); h.input.press('3'); h.controller.update()
    expect(official.setTacticalOrder).toHaveBeenLastCalledWith('defend')
    expect(personal.setTacticalOrder).toHaveBeenLastCalledWith('defend')
    expect(bystander.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('closes a pending command when the Player dies and removes revoked command membership', () => {
    const actor = { combatantId: 'official', faction: Faction.TOWN, squadId: 1, setTacticalOrder: vi.fn() }
    let alive = true, authorized = true
    const h = controllerHarness([actor], null, null, null, 'viking', 'squad', true, undefined,
      { accepts: () => authorized, enabled: () => alive })
    h.input.press('1'); h.controller.update()
    alive = false; h.input.press('2'); h.controller.update()
    expect(actor.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(false)
    alive = true; authorized = false; h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)![0].map(entry => entry.target)).toEqual(['all'])
  })

  it('routes weapon wheel input to the replacement character inventory without mutating the previous one', () => {
    const previous = new InventoryManager()
    const before = previous.saveState
    const next = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_basic', shieldId: null })
    const h = controllerHarness([], null, null, previous, 'viking', 'preset', false)
    h.controller.setInventory(next)
    h.input.wheel(1)
    h.controller.update()
    expect(next.isEquipped('pilum_basic')).toBe(true)
    expect(previous.saveState).toEqual(before)
  })
  it('shows only unit presets that actually entered the battle, plus ALL', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemyArcher = { faction: Faction.ENEMY, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([spearman, enemyArcher])

    const entries = h.ui.render.mock.calls.at(-1)?.[0] as ReadonlyArray<{ target: string }>
    expect(entries.map(entry => entry.target)).toEqual(['viking_spearman', 'all'])
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('viking_spearman')
  })

  it('adds a newly spawned friendly preset to the command roster', () => {
    const npcs: any[] = [
      { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() },
    ]
    const h = controllerHarness(npcs)
    npcs.push({ faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() })

    h.controller.update()

    const entries = h.ui.render.mock.calls.at(-1)?.[0] as ReadonlyArray<{ target: string }>
    expect(entries.map(entry => entry.target)).toEqual([
      'viking_spearman',
      'viking_archer',
      'all',
    ])
  })

  it('keeps a preset in the command roster after it has entered battle once', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const archer = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const npcs: any[] = [spearman, archer]
    const h = controllerHarness(npcs)

    npcs.splice(1, 1)
    h.controller.update()

    const entries = h.ui.render.mock.calls.at(-1)?.[0] as ReadonlyArray<{ target: string }>
    expect(entries.map(entry => entry.target)).toContain('viking_archer')
  })

  it('includes ALL in wheel navigation and confirms it with middle-click', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const archer = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([spearman, archer])

    // Preserve the first actual unit as the default highlight.
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('viking_spearman')

    // ALL sits immediately before the first unit in wheel order.
    h.input.pressKey('KeyQ')
    h.controller.update()
    h.input.wheel(-1)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('all')

    h.input.clickMiddle()
    h.controller.update()
    expect(h.controller.selected).toBe('all')

    // Attack is highlighted by default; middle click applies it to the whole army.
    h.input.clickMiddle()
    h.controller.update()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('attack')
    expect(archer.setTacticalOrder).toHaveBeenCalledWith('attack')
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('uses wheel highlight and middle-click to select a unit then issue a command', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const archer = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([spearman, archer])

    // First present unit is highlighted by default; wheel down selects the next.
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('viking_spearman')
    h.input.pressKey('KeyQ')
    h.controller.update()
    h.input.wheel(1)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('viking_archer')

    // Middle click enters that unit's command panel with Attack highlighted.
    h.input.clickMiddle()
    h.controller.update()
    expect(h.controller.selected).toBe('viking_archer')
    expect(h.ui.render.mock.calls.at(-1)?.[4]).toBe(0)

    // Scroll down twice: Attack -> Charge -> Defend, then middle click confirms.
    h.input.wheel(2)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[4]).toBe(2)

    h.input.clickMiddle()
    h.controller.update()
    expect(archer.setTacticalOrder).toHaveBeenCalledWith('defend')
    expect(spearman.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('clamps wheel selection at the first and last visible option', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const archer = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([spearman, archer])

    h.input.pressKey('KeyQ')
    h.controller.update()
    h.input.wheel(-3)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('all')

    h.input.wheel(10)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('viking_archer')
  })

  it('uses edge-triggered submenu flow, filters to PLAYER faction, and leaves enemies alone', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const otherAlly = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy, otherAlly])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)
    h.controller.update() // Holding the key does not reselect or issue a command.
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()

    h.input.press('3')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('defend')
    expect(otherAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('ALL commands every player-faction NPC while formation is handled by its placement controller', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy])

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.pressAll()
    h.controller.update()
    h.input.pressAll()
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('uses Q or Backquote to go back from the command menu and consumes invalid submenu digits', () => {
    const spearman = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const h = controllerHarness([spearman])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.press('6')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    expect(h.controller.wheelMode).toBe('weapon')

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.pressAll()
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('updates desired state but never dispatches a command to dead NPCs', () => {
    const deadAlly = { faction: Faction.PLAYER, presetId: 'viking_spearman', dead: true, setTacticalOrder: vi.fn() }
    const h = controllerHarness([deadAlly])
    h.input.press('2')
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(deadAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('槍兵 → 衝鋒')
  })

  it('switches to squad grouping and commands only the selected mixed squad', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      squadId: 1,
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const horseArcher = {
      faction: Faction.PLAYER,
      presetId: 'viking_horse_archer',
      squadId: 1,
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const otherSquad = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      squadId: 2,
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const h = controllerHarness([spearman, horseArcher, otherSquad], null, null, null, 'viking', 'squad')

    expect(h.controller.grouping).toBe('squad')

    const hud = h.ui.render.mock.calls.at(-1)?.[0] as ReadonlyArray<{ target: string; summary?: string }>
    expect(hud.find(entry => entry.target === 'squad:1')?.summary).toBe('2/2')
    expect(hud.find(entry => entry.target === 'squad:2')?.summary).toBe('1/1')
    expect(hud.find(entry => entry.target === 'all')?.summary).toBe('3/3')

    h.input.press('1')
    h.controller.update()
    expect(h.controller.selected).toBe('squad:1')

    h.input.press('2')
    h.controller.update()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(horseArcher.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(otherSquad.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('第 1 隊 → 衝鋒')
  })
})
