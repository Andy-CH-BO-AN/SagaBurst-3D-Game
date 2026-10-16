import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { townEquipmentSquads } from '../../src/career/CareerTownEquipment'
import {
  commanderTownSquadLabel,
  resolveCommanderTownTargetLabel,
  COMMANDER_TOWN_SQUAD_LABELS,
} from '../../src/career/CommanderTownSquadLabels'
import { ArmyCommandUI, armyCommandTargetLabel } from '../../src/ui/ArmyCommandUI'
import { squadCommandTarget, type SquadCommandTarget, type SquadId } from '../../src/battle/CommandTarget'
import { Faction } from '../../src/world/NPC'
import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Commander Town Squad Labels and HUD alignment', () => {
  it('aligns Commander Town command squad targets with Tab equipment squad tabs from single source of truth', () => {
    const profile = createCareerProfile('roman')
    profile.personalSquad = {
      members: [{
        id: 'hr-1',
        type: 'soldier',
        originalHirePrice: 100,
        equipment: { melee: null, ranged: null, shield: null, mount: null },
      }],
    }
    const equipmentSquads = townEquipmentSquads(profile)

    // Verify 1..8, personal, civilians align with Tab equipment names
    for (let id = 1 as SquadId; id <= 8; id = (id + 1) as SquadId) {
      const target = squadCommandTarget(id)
      const label = resolveCommanderTownTargetLabel(target)
      expect(label).toBe(COMMANDER_TOWN_SQUAD_LABELS[id])
      const matchingTab = equipmentSquads.find(squad => squad.id === id)
      expect(matchingTab?.name).toBe(label)
    }

    const personalLabel = resolveCommanderTownTargetLabel('squad:personal')
    expect(personalLabel).toBe('HR 私兵')
    expect(equipmentSquads.find(squad => squad.id === 'personal')?.name).toBe('HR 私兵')

    const civilianLabel = resolveCommanderTownTargetLabel('squad:civilians')
    expect(civilianLabel).toBe('平民／商人')
    expect(equipmentSquads.find(squad => squad.id === 'civilian')?.name).toBe('平民／商人')

    // Alias check
    expect(commanderTownSquadLabel('civilian')).toBe('平民／商人')
  })

  it('preserves context isolation for missions and non-town contexts', () => {
    // Non-town / default context: uses generic numbering
    expect(armyCommandTargetLabel('squad:1')).toBe('第 1 隊')
    expect(armyCommandTargetLabel('squad:2')).toBe('第 2 隊')
    expect(armyCommandTargetLabel('squad:personal')).toBe('Personal Squad · 私人小隊')
    expect(armyCommandTargetLabel('squad:civilians')).toBe('Civilian Squad · 平民／商人')

    // Mission Commander context: only official squad:1 gets the mission label
    const missionLabel = 'Mission Squad · 任務部隊'
    expect(armyCommandTargetLabel('squad:1', missionLabel)).toBe(missionLabel)
    expect(armyCommandTargetLabel('squad:2', missionLabel)).toBe('第 2 隊')
    expect(armyCommandTargetLabel('squad:8', missionLabel)).toBe('第 8 隊')

    // Non-squad targets (preset or all) remain unaffected by resolver
    expect(armyCommandTargetLabel('all', resolveCommanderTownTargetLabel)).toBe('全軍命令')
    expect(armyCommandTargetLabel('viking_berserker', resolveCommanderTownTargetLabel)).toBe('維京資深戰士')
    expect(resolveCommanderTownTargetLabel('all')).toBeUndefined()
    expect(resolveCommanderTownTargetLabel(null)).toBeUndefined()
  })

  it('guarantees consistent naming across cards, submenu title, and formation placement', () => {
    const testSquads: Array<{ target: SquadCommandTarget; expected: string }> = [
      { target: 'squad:1', expected: '北門步兵隊' },
      { target: 'squad:2', expected: '北門騎兵／指揮隊' },
      { target: 'squad:7', expected: '西門與機動部隊' },
      { target: 'squad:8', expected: '城鎮巨鷹巡邏隊' },
      { target: 'squad:personal', expected: 'HR 私兵' },
      { target: 'squad:civilians', expected: '平民／商人' },
    ]

    for (const { target, expected } of testSquads) {
      const cardLabel = resolveCommanderTownTargetLabel(target)
      const submenuTitle = armyCommandTargetLabel(target, resolveCommanderTownTargetLabel)
      const formationTitle = `${armyCommandTargetLabel(target, resolveCommanderTownTargetLabel).replace('命令', '')} — 列陣位置`

      expect(cardLabel).toBe(expected)
      expect(submenuTitle).toBe(expected)
      expect(formationTitle).toBe(`${expected} — 列陣位置`)
    }
  })

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
