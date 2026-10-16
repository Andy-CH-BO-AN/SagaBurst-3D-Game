import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { townEquipmentSquads } from '../../src/career/CareerTownEquipment'
import {
  commanderTownSquadLabel,
  resolveCommanderTownTargetLabel,
  COMMANDER_TOWN_SQUAD_LABELS,
} from '../../src/career/CommanderTownSquadLabels'
import { armyCommandTargetLabel } from '../../src/ui/ArmyCommandUI'
import { squadCommandTarget, type SquadCommandTarget, type SquadId } from '../../src/battle/CommandTarget'

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
})
