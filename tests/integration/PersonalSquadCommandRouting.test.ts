import { describe, expect, it, vi } from 'vitest'
import { careerCommandHudRoster } from '../../src/career/CareerCommandHudRoster'
import type { PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Vector3, Euler } from 'three'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { migratePersonalTownLayout } from '../../src/town/TownLayoutMigration'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import { Faction } from '../../src/world/NPC'

import { createArmyCommandHarness as controllerHarness, type CommandRecipientFixture } from '../helpers/armyCommandHarness'

describe('Personal Squad command lifecycle routing', () => {
  it('keeps private ALL and its identity separate from all eight official squads; ineffective Dismiss keeps the command', () => {
    const official = Array.from({ length: 8 }, (_, i) => ({ squadId: i + 1, setTacticalOrder: vi.fn() }))
    const personal = { faction: Faction.PLAYER, presetId: 'roman_sword_cavalry', squadId: 'personal', dead: false,
      tacticalOrder: 'defend', setTacticalOrder: vi.fn((order: string) => { personal.tacticalOrder = order }) }
    const issue = vi.fn(() => false)
    const { controller, input, ui } = controllerHarness([personal], null, null, null, 'roman', 'squad', true, { issue, enabled: () => true })
    const entries = ui.render.mock.lastCall![0]
    expect(entries.map(entry => entry.target)).toEqual(['squad:personal', 'all'])
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
    const issue = vi.fn(() => true), npcs: CommandRecipientFixture[] = []
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

// Exercise the real restore/transfer consumer with numeric actor boundaries only.
// No Runtime/NPC/Mount constructor, scene, geometry or model is materialized.
function boardingHarness() {
  const home = { id: 'private-eagle-pad:1', x: -85, y: 0, z: 54, yaw: 0 }
  const eaglePads = new EaglePadReservations([home]); eaglePads.reserve('personal:eagle')
  const mount = {
    dead: false, currentHp: 200, maxHp: 200, isFlyingMount: true,
    group: { position: new Vector3(home.x, 0, home.z), rotation: new Euler() },
    flight: { phase: 'grounded', restore: vi.fn() },
    get isAirborne() { return this.flight.phase !== 'grounded' },
  }
  const point = new Vector3(home.x, 0, home.z)
  const actor = {
    combatantId: 'personal:eagle', dead: false, hp: 100, missionMovement: false,
    group: { position: point, rotation: new Euler() }, combatPosition: point,
    mount: undefined as Mount | undefined,
    restoreCombatHealth: vi.fn(), restoreCombatAmmo: vi.fn(), setTacticalOrder: vi.fn(),
    setEagleFlightOrder: vi.fn(), assignFormationTarget: vi.fn<NPC['assignFormationTarget']>(),
    mountVehicle: vi.fn((vehicle: Mount) => { actor.mount = vehicle }),
  }
  // Typed seams adapt only the actor/mount API consumed by these private owners.
  const npc = actor as unknown as NPC, vehicle = mount as unknown as Mount
  interface RestoreTransferSeam {
    restoreActor(npc: NPC, saved: PersonalActorCheckpoint, changedScene: boolean, index: number): void
    updateEagleTransfers(): void
  }
  const runtime = Object.assign(Object.create(PersonalSquadRuntime.prototype), {
    state: 'ACTIVE', command: 'defend', returnCommand: -1000, eaglePads,
    memberMounts: new Map([[actor.combatantId, vehicle]]), boarding: new Map(),
  }) as RestoreTransferSeam
  return { home, mount, actor, npc, runtime }
}

describe('Personal Squad boarding restore and contact', () => {
  it('restores a migrated off-base boarding target, follows a moving mount and boards only at live contact', () => {
    const h = boardingHarness()
    const saved: PersonalSquadMission = {
      squadId: 'personal', sceneKey: 'town-home', layoutVersion: 3, state: 'ACTIVE',
      memberIds: ['personal:eagle'], contribution: emptyPersonalContribution(),
      members: { 'personal:eagle': { status: 'deployed', boarding: true, hp: 49,
        eaglePadId: h.home.id, position: { x: h.home.x, y: 0, z: h.home.z, yaw: 0 },
        mount: { hp: 73, mounted: false, position: { x: 20, y: 0, z: 30, yaw: 0 },
          flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } } } } },
    }
    const migrated = migratePersonalTownLayout(saved, 'town-home', { eaglePads: [h.home], muster: [] }, () => 0)!
    h.runtime.restoreActor(h.npc, migrated.members['personal:eagle'], false, 0)
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([20, 0, 30])
    h.mount.group.position.set(24, 3, 31)
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([24, 3, 31])
    h.actor.group.position.set(23, 3, 31)
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).toHaveBeenCalledExactlyOnceWith(h.mount)
    expect(h.actor.setTacticalOrder).toHaveBeenCalledWith('defend')
  })

  it('keeps ordinary home boarding but waits for touchdown and vertical proximity to the actual mount', () => {
    const h = boardingHarness()
    h.runtime.restoreActor(h.npc, { status: 'deployed', boarding: true }, false, 0)
    expect(h.actor.assignFormationTarget.mock.lastCall![1].toArray()).toEqual([-85, 0, 54])
    h.mount.flight.phase = 'cruise'
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    h.mount.flight.phase = 'grounded'; h.mount.group.position.y = 8
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).not.toHaveBeenCalled()
    h.mount.group.position.y = 0
    h.runtime.updateEagleTransfers()
    expect(h.actor.mountVehicle).toHaveBeenCalledExactlyOnceWith(h.mount)
  })
})
