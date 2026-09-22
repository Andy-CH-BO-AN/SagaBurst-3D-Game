import { describe, expect, it } from 'vitest'
import {
  getRomanCampaignStage,
  isRomanCampaignStageId,
  ROMAN_CAMPAIGN_RULES,
  ROMAN_CAMPAIGN_STAGES,
  ROMAN_CAMPAIGN_TIMINGS,
  type TierCounts,
} from './CampaignConfig'

function sumTierCounts(counts: TierCounts): number {
  return counts[1] + counts[2] + counts[3]
}

function sumPresetCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

describe('Roman Campaign configuration', () => {
  it('defines exactly nine sequential stages', () => {
    expect(ROMAN_CAMPAIGN_STAGES).toHaveLength(9)
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps deployment and reinforcement timing authoritative', () => {
    expect(ROMAN_CAMPAIGN_TIMINGS.deploymentSeconds).toBe(60)
    expect(ROMAN_CAMPAIGN_TIMINGS.reinforcementDelaySeconds).toBe(180)
  })

  it('encodes the Roman campaign outcome rules without consuming a player slot', () => {
    expect(ROMAN_CAMPAIGN_RULES.playerFaction).toBe('roman')
    expect(ROMAN_CAMPAIGN_RULES.playerConsumesDeploymentSlot).toBe(false)
    expect(ROMAN_CAMPAIGN_RULES.playerCountsAsOriginalDefender).toBe(true)
    expect(ROMAN_CAMPAIGN_RULES.initialRomanOrder).toBe('defend')
    expect(ROMAN_CAMPAIGN_RULES.victoryRequiresVikingElimination).toBe(true)
    expect(ROMAN_CAMPAIGN_RULES.lockDefeatWhenOriginalRomanForceEliminated).toBe(true)
    expect(ROMAN_CAMPAIGN_RULES.continueSimulationAfterDefeat).toBe(true)
  })

  it('matches the intended Roman deployment progression', () => {
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.romanDeployment.maxUnits)).toEqual([
      50, 55, 60, 60, 60, 60, 60, 60, 60,
    ])
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.romanDeployment.cavalryCap)).toEqual([
      10, 10, 10, 10, 10, 10, 20, 40, null,
    ])

    expect(getRomanCampaignStage(1).romanDeployment.tierCapacity).toEqual({ 1: 0, 2: 50, 3: 0 })
    expect(getRomanCampaignStage(2).romanDeployment.tierCapacity).toEqual({ 1: 5, 2: 50, 3: 0 })
    expect(getRomanCampaignStage(3).romanDeployment.tierCapacity).toEqual({ 1: 5, 2: 55, 3: 0 })
    expect(getRomanCampaignStage(4).romanDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 10 })
    expect(getRomanCampaignStage(5).romanDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 30 })
    expect(getRomanCampaignStage(6).romanDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 60 })
  })

  it('matches the intended Viking army growth and 4:2:2:1:1 composition', () => {
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.vikingAssault.totalUnits)).toEqual([
      100, 110, 120, 130, 140, 150, 160, 180, 200,
    ])

    for (const stage of ROMAN_CAMPAIGN_STAGES) {
      expect(sumPresetCounts(stage.vikingAssault.presetCounts)).toBe(stage.vikingAssault.totalUnits)
      expect(sumTierCounts(stage.vikingAssault.tierCounts)).toBe(stage.vikingAssault.totalUnits)

      const unit = stage.vikingAssault.totalUnits / 10
      expect(stage.vikingAssault.presetCounts).toEqual({
        viking_berserker: unit * 4,
        viking_spearman: 0,
        viking_archer: unit * 2,
        viking_sword_cavalry: unit * 2,
        viking_lancer: unit,
        viking_horse_archer: unit,
      })
    }
  })

  it('makes Viking quality progression explicit for stages four through six', () => {
    expect(getRomanCampaignStage(4).vikingAssault.tierCounts).toEqual({ 1: 0, 2: 100, 3: 30 })
    expect(getRomanCampaignStage(5).vikingAssault.tierCounts).toEqual({ 1: 0, 2: 70, 3: 70 })
    expect(getRomanCampaignStage(6).vikingAssault.tierCounts).toEqual({ 1: 0, 2: 30, 3: 120 })
    expect(getRomanCampaignStage(7).vikingAssault.tierCounts).toEqual({ 1: 0, 2: 0, 3: 160 })
  })

  it('upgrades the fixed Roman sword cavalry reinforcement by campaign chapter', () => {
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.reinforcement.count)).toEqual(
      new Array(9).fill(50),
    )
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.reinforcement.presetId)).toEqual(
      new Array(9).fill('roman_sword_cavalry'),
    )
    expect(ROMAN_CAMPAIGN_STAGES.map(stage => stage.reinforcement.tier)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3,
    ])
  })

  it('validates campaign stage ids', () => {
    expect(isRomanCampaignStageId(1)).toBe(true)
    expect(isRomanCampaignStageId(9)).toBe(true)
    expect(isRomanCampaignStageId(0)).toBe(false)
    expect(isRomanCampaignStageId(10)).toBe(false)
    expect(isRomanCampaignStageId(1.5)).toBe(false)
  })
})
