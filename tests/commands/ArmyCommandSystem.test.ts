import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'
import { countArmyHudRoster } from '../../src/battle/ArmyCommandHudRoster'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import type { OfficialCommandAuthority } from '../../src/career/CareerCommandAuthority'
import type { PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { InventoryManager } from '../../src/rpg/InventoryManager'

import { createArmyCommandHarness as controllerHarness, type CommandRecipientFixture } from '../helpers/armyCommandHarness'

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

  it('refreshes same-squad progressive additions and casualties without rebuilding an unchanged HUD', () => {
    const actors: CommandRecipientFixture[] = [
      { combatantId: 'official:0', faction: Faction.TOWN, squadId: 1, dead: false },
      { combatantId: 'personal:test', faction: Faction.PLAYER, squadId: 'personal', dead: false },
    ]
    const ids = new Set(['official:0', 'official:1', 'personal:test'])
    const h = controllerHarness(actors, null, null, null, 'viking', 'squad', true, undefined,
      { accepts: npc => ids.has(npc.combatantId), enabled: () => true })
    h.ui.render.mockClear()
    h.controller.update()
    expect(h.ui.render).not.toHaveBeenCalled()

    actors.push({ combatantId: 'official:1', faction: Faction.TOWN, squadId: 1, dead: false },
      { combatantId: 'unassigned', faction: Faction.PLAYER, squadId: 1, dead: false })
    h.controller.update()
    expect(h.ui.render).toHaveBeenCalledOnce()
    expect(h.ui.render.mock.calls.at(-1)![0].map(entry => [entry.target, entry.summary])).toEqual([
      ['squad:1', '2/2'], ['squad:personal', '1/1'], ['all', '3/3'],
    ])
    h.controller.update()
    expect(h.ui.render).toHaveBeenCalledOnce()

    actors[0].dead = true
    h.controller.update()
    expect(h.ui.render).toHaveBeenCalledTimes(2)
    expect(h.ui.render.mock.calls.at(-1)![0].map(entry => [entry.target, entry.summary])).toEqual([
      ['squad:1', '1/2'], ['squad:personal', '1/1'], ['all', '2/3'],
    ])
    h.controller.update()
    expect(h.ui.render).toHaveBeenCalledTimes(2)
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

  it('drops the old 3/29 and command selection when a new mission authorizes 20 different IDs', () => {
    const actors: CommandRecipientFixture[] = Array.from({ length: 3 }, (_, index) => ({
      combatantId: `a:${index}`, faction: Faction.TOWN, squadId: 1, dead: false, setTacticalOrder: vi.fn(),
    }))
    const official = (missionId: string, size: number): OfficialCommandAuthority => ({
      type: 'mission-official', missionId, townFaction: 'roman', squadId: 1,
      actorIds: Array.from({ length: size }, (_, index) => `${missionId}:${index}`),
      contribution: emptyPersonalContribution(),
      members: Object.fromEntries(Array.from({ length: size }, (_, index) => [
        `${missionId}:${index}`, { status: missionId === 'a' && index >= 3 ? 'dead' : 'reserve' },
      ])),
    })
    let current = official('a', 29), deploying = false
    const provider = () => careerCommandHudRoster({
      sceneKey: 'town:roman', faction: 'roman', missionId: current.missionId,
      official: current, officialPending: deploying, actors: actors as Array<{ combatantId: string; dead: boolean }>,
    })
    const h = controllerHarness(actors, null, null, null, 'roman', 'squad', true, undefined,
      { accepts: npc => current.actorIds.includes(npc.combatantId), enabled: () => true }, provider)
    expect(h.ui.render.mock.lastCall![0].map(entry => [entry.target, entry.summary])).toEqual([
      ['squad:1', '3/29'], ['all', '3/29'],
    ])
    h.input.press('1'); h.controller.update(); h.input.press('3'); h.controller.update()
    expect(h.ui.render.mock.lastCall![0][0].order).toBe('defend')

    current = official('b', 20); deploying = true; actors.length = 0
    h.controller.update()
    expect(h.controller.selected).toBeNull()
    expect(h.ui.render.mock.lastCall![0].map(entry => [entry.target, entry.summary, entry.order])).toEqual([
      ['squad:1', '0/20 · 部署中 20', 'attack'], ['all', '0/20 · 部署中 20', 'attack'],
    ])
    actors.push({ combatantId: 'b:0', squadId: 1, faction: Faction.TOWN, dead: false })
    h.controller.update()
    expect(h.ui.render.mock.lastCall![0][0].summary).toBe('1/20 · 部署中 19')
    deploying = false // Failed/unavailable placements cannot remain reported as deployed.
    h.controller.update()
    expect(h.ui.render.mock.lastCall![0][0].summary).toBe('1/20 · 未部署 19')
  })

  it('does not reuse squad:1 from a completed battle in town free-roam or a different scene', () => {
    const actors: CommandRecipientFixture[] = [{ combatantId: 'battle:1', squadId: 1, faction: Faction.TOWN, dead: false }]
    let scene = 'eagle:battle', missionId = 'battle', town = false
    const source = () => careerCommandHudRoster({
      sceneKey: scene, faction: 'viking', ...(town ? {} : { missionId }),
      official: town ? {
        type: 'town-command', squadId: 1, townFaction: 'viking', actorIds: ['town:1'], contribution: emptyPersonalContribution(),
      } : {
        type: 'mission-official', missionId, squadId: 1, townFaction: 'viking',
        actorIds: ['battle:1'], contribution: emptyPersonalContribution(),
      }, actors: actors as Array<{ combatantId: string; dead: boolean }>,
    })
    const h = controllerHarness(actors, null, null, null, 'viking', 'squad', true, undefined,
      { accepts: npc => town ? npc.combatantId === 'town:1' : npc.combatantId === 'battle:1', enabled: () => true }, source)
    expect(h.ui.render.mock.lastCall![0][0].summary).toBe('1/1')
    town = true; scene = 'town:home'; actors.splice(0, 1, { combatantId: 'town:1', squadId: 1, faction: Faction.TOWN, dead: false })
    h.controller.update()
    expect(h.ui.render.mock.lastCall![0][0].summary).toBe('1/1')
    // Even with identical display counts, the saved identity and authority changed.
    h.input.press('1'); h.controller.update()
    town = false; missionId = 'next'; scene = 'outpost:next'; actors.length = 0
    h.controller.update()
    expect(h.controller.selected).toBeNull()
    expect(h.ui.render.mock.lastCall![0][0].summary).toBe('0/1 · 未部署 1')
  })

  it('counts one eagle rider, pending infantry and casualties exactly once without counting HR reserves', () => {
    const personal: PersonalSquadMission = {
      squadId: 'personal', sceneKey: 'town-home', state: 'DEPLOYING',
      memberIds: ['personal:eagle', 'personal:infantry', 'personal:fallen', 'personal:reserve'],
      members: {
        'personal:eagle': { status: 'reserve' }, 'personal:infantry': { status: 'reserve' },
        'personal:fallen': { status: 'dead', hp: 0 }, 'personal:reserve': { status: 'reserve' },
      },
      contribution: emptyPersonalContribution(),
    }
    const input = (actors: Array<{ combatantId: string; dead: boolean }>, pending: string[]) =>
      careerCommandHudRoster({ sceneKey: 'town:roman', faction: 'roman', personal, personalPendingIds: pending, actors })
    const waiting = countArmyHudRoster(input([], ['personal:eagle', 'personal:infantry']), 'all')
    expect(waiting).toMatchObject({ alive: 0, total: 3, pending: 2, deployed: 0, dead: 1, reserve: 1 })
    // A rider and mount are one combatant ID, including duplicate runtime references.
    const rider = { combatantId: 'personal:eagle', dead: false }
    const boarded = countArmyHudRoster(input([rider, rider], ['personal:eagle', 'personal:infantry']), 'squad:personal')
    expect(boarded).toMatchObject({ total: 3, alive: 1, deployed: 1, pending: 1, dead: 1 })
    rider.dead = true
    const casualties = countArmyHudRoster(input([rider], ['personal:infantry']), 'all')
    expect(casualties).toMatchObject({ total: 3, alive: 0, dead: 2, pending: 1 })
    // If spawning or eagle pad reservation fails, reserve cannot masquerade as a deployed rider.
    expect(countArmyHudRoster(input([], []), 'all')).toMatchObject({ total: 1, pending: 0, alive: 0, reserve: 3 })
    personal.members['personal:infantry'].status = 'deployed'
    expect(countArmyHudRoster(input([], []), 'all')).toMatchObject({ total: 2, pending: 0, alive: 0, missing: 1 })
    personal.members['personal:infantry'].status = 'exited'
    expect(countArmyHudRoster(input([], []), 'all')).toMatchObject({ total: 1, exited: 1, reserve: 2 })
  })
})
