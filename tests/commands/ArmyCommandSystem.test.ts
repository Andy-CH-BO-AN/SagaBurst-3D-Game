import { describe, expect, it, vi } from 'vitest'
import type { SquadIdentity } from '../../src/battle/CommandTarget'
import type { OfficialCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/world/NPC'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptCommanderMission, COMMANDER_BRIDGEHEAD_ID } from '../../src/career/CommanderMissionCatalog'
import { CareerCommandHudTypes } from '../../src/career/CareerCommandHudTypes'

import { createArmyCommandHarness as controllerHarness, type CommandRecipientFixture } from '../helpers/armyCommandHarness'

describe('Army command roster, dispatch and submenu', () => {
  it('retains accepted infantry types through pending deployment and complete squad casualties, including Squad 8', () => {
    const profile = acceptCommanderMission({ ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000 },
      COMMANDER_BRIDGEHEAD_ID, 'hud-bridge')!
    const types = new CareerCommandHudTypes()
    let pending = true
    const source = () => careerCommandHudRoster({ sceneKey: 'bridge:hud-bridge', faction: 'roman', missionId: 'hud-bridge',
      official: profile.activeMission!.officialSquad, officialPending: pending, unitTypes: types.read(profile), actors: [] })
    const h = controllerHarness([], null, null, null, 'roman', 'squad', true, undefined,
      { accepts: () => false, enabled: () => true }, source)
    const entry = () => h.ui.render.mock.lastCall![0].find(row => row.target === 'squad:8')!
    expect(entry().units).toEqual({ icons: '🏹', description: '🏹 弓兵' })
    expect(entry().summary).toBe('0/25 · 部署中 25')
    const authority = profile.activeMission!.officialSquad!
    authority.members = Object.fromEntries(authority.actorIds.map(id => [id, { status: 'dead' as const, hp: 0 }]))
    pending = false; h.controller.update()
    expect(entry().summary).toBe('0/25 · 陣亡 25')
    expect(entry().units).toEqual({ icons: '🏹', description: '🏹 弓兵' })
    expect(h.ui.render.mock.lastCall![0].filter(row => row.target !== 'all')).toHaveLength(8)
  })

  it('commits a direct ALL order before mutations and excludes dead, returning and unowned records', () => {
    const events: string[] = []
    const record = (id: string, squadId: SquadIdentity, dead = false) => ({ combatantId: id, squadId, dead,
      faction: Faction.TOWN, setTacticalOrder: vi.fn(() => { events.push(id) }) })
    const actors = [record('north', 1), record('east', 2), record('private', 'personal'), record('resident', 'civilians'),
      record('fallen', 2, true), record('returning', 2), record('bystander', 'civilians')]
    let saved = false
    const beforeIssue = vi.fn(() => { events.push('save'); return saved })
    const onIssued = vi.fn()
    const h = controllerHarness(actors, null, null, null, 'roman', 'squad', true, undefined,
      { accepts: npc => !['returning', 'bystander'].includes(npc.combatantId), enabled: () => true, beforeIssue }, undefined, onIssued)
    h.input.pressAll(); h.controller.update(); h.input.press('3'); h.controller.update()
    expect(events).toEqual(['save'])
    expect(onIssued).not.toHaveBeenCalled()
    for (const actor of actors) expect(actor.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.render.mock.lastCall![0].find(entry => entry.target === 'all')?.order).toBe('attack')
    saved = true; events.length = 0
    h.input.pressAll(); h.controller.update(); h.input.press('3'); h.controller.update()
    expect(beforeIssue).toHaveBeenLastCalledWith('defend', 'all', actors.slice(0, 4))
    expect(events).toEqual(['save', 'north', 'east', 'private', 'resident'])
    for (const actor of actors.slice(4)) expect(actor.setTacticalOrder).not.toHaveBeenCalled()
    expect(onIssued).toHaveBeenCalledWith('defend', 'all')
  })

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
      ['squad:1', '3/29 · 陣亡 26'], ['all', '3/29 · 陣亡 26'],
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
})
