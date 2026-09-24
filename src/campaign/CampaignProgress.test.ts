import { describe, expect, it } from 'vitest'
import {
  completeDefenseCampaignStage,
  getDefenseCampaignUnlockedStage,
  isDefenseCampaignStageUnlocked,
  parseDefenseCampaignSetupTarget,
  type CampaignProgressStorage,
} from './CampaignProgress'

function memoryStorage(): CampaignProgressStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('Defense Campaign progress', () => {
  it('parses only valid next-stage setup targets', () => {
    expect(parseDefenseCampaignSetupTarget({
      defenderFaction: 'viking',
      stageId: 2,
    })).toEqual({ defenderFaction: 'viking', stageId: 2 })

    expect(parseDefenseCampaignSetupTarget({
      defenderFaction: 'roman',
      stageId: 9,
    })).toEqual({ defenderFaction: 'roman', stageId: 9 })

    expect(parseDefenseCampaignSetupTarget({
      defenderFaction: 'viking',
      stageId: 10,
    })).toBeNull()
    expect(parseDefenseCampaignSetupTarget({
      defenderFaction: 'enemy',
      stageId: 2,
    })).toBeNull()
  })

  it('starts both defender factions at Stage 1', () => {
    const storage = memoryStorage()
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(1)
    expect(getDefenseCampaignUnlockedStage('viking', storage)).toBe(1)
  })

  it('unlocks only the next stage for the faction that cleared', () => {
    const storage = memoryStorage()

    expect(completeDefenseCampaignStage('roman', 1, storage)).toBe(2)
    expect(isDefenseCampaignStageUnlocked('roman', 2, storage)).toBe(true)
    expect(isDefenseCampaignStageUnlocked('roman', 3, storage)).toBe(false)
    expect(getDefenseCampaignUnlockedStage('viking', storage)).toBe(1)
  })

  it('never regresses progress when replaying an earlier stage', () => {
    const storage = memoryStorage()
    completeDefenseCampaignStage('roman', 1, storage)
    completeDefenseCampaignStage('roman', 2, storage)

    expect(completeDefenseCampaignStage('roman', 1, storage)).toBe(3)
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(3)
  })

  it('rejects skipped completion and caps sequential progress at Stage 9', () => {
    const storage = memoryStorage()
    expect(completeDefenseCampaignStage('viking', 5, storage)).toBe(1)

    for (let stage = 1; stage <= 9; stage++) {
      completeDefenseCampaignStage(
        'viking',
        stage as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
        storage,
      )
    }
    expect(getDefenseCampaignUnlockedStage('viking', storage)).toBe(9)
  })
})
