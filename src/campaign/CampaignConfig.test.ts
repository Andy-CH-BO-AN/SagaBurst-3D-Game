import { describe, expect, it } from 'vitest'
import {
  DEFENSE_CAMPAIGN_RULES,
  DEFENSE_CAMPAIGN_STAGES,
  DEFENSE_CAMPAIGN_TIMINGS,
  getDefenseCampaignStage,
  isCampaignStageId,
  opposingCampaignFaction,
  resolveCampaignRolePreset,
  type CampaignRoleCounts,
  type TierCounts,
} from './CampaignConfig'

function sumTierCounts(counts: TierCounts): number {
  return counts[1] + counts[2] + counts[3]
}

function sumRoleCounts(counts: CampaignRoleCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

describe('Defense Campaign configuration', () => {
  it('defines exactly nine sequential stages', () => {
    expect(DEFENSE_CAMPAIGN_STAGES).toHaveLength(9)
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps deployment and reinforcement timing authoritative', () => {
    expect(DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds).toBe(60)
    expect(DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds).toBe(120)
  })

  it('keeps defense outcome rules faction-neutral', () => {
    expect(DEFENSE_CAMPAIGN_RULES.playerConsumesDeploymentSlot).toBe(false)
    expect(DEFENSE_CAMPAIGN_RULES.playerCountsAsOriginalDefender).toBe(true)
    expect(DEFENSE_CAMPAIGN_RULES.initialDefenderOrder).toBe('defend')
    expect(DEFENSE_CAMPAIGN_RULES.lockDefeatWhenPlayerAndOriginalDefendersEliminated).toBe(true)
    expect(DEFENSE_CAMPAIGN_RULES.continueSimulationAfterDefeat).toBe(true)
    expect(DEFENSE_CAMPAIGN_RULES.finishDefenderEliminationAfterReinforcement).toBe(true)
  })

  it('resolves the same campaign roles for both factions', () => {
    expect(resolveCampaignRolePreset('roman', 'frontline')).toBe('roman_heavy_infantry')
    expect(resolveCampaignRolePreset('roman', 'ranged')).toBe('roman_javelin_infantry')
    expect(resolveCampaignRolePreset('roman', 'sword_cavalry')).toBe('roman_sword_cavalry')
    expect(resolveCampaignRolePreset('roman', 'lancer')).toBe('roman_lancer')
    expect(resolveCampaignRolePreset('roman', 'horse_archer')).toBe('roman_horse_archer')

    expect(resolveCampaignRolePreset('viking', 'frontline')).toBe('viking_berserker')
    expect(resolveCampaignRolePreset('viking', 'ranged')).toBe('viking_archer')
    expect(resolveCampaignRolePreset('viking', 'sword_cavalry')).toBe('viking_sword_cavalry')
    expect(resolveCampaignRolePreset('viking', 'lancer')).toBe('viking_lancer')
    expect(resolveCampaignRolePreset('viking', 'horse_archer')).toBe('viking_horse_archer')
  })

  it('resolves the opposing faction symmetrically', () => {
    expect(opposingCampaignFaction('roman')).toBe('viking')
    expect(opposingCampaignFaction('viking')).toBe('roman')
  })

  it('matches the intended defender deployment progression', () => {
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.maxUnits)).toEqual([
      80, 75, 80, 80, 80, 80, 80, 80, 80,
    ])
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.cavalryCap)).toEqual([
      10, 10, 10, 10, 10, 10, 20, 40, null,
    ])

    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.baseMaxUnits)).toEqual([
      50, 55, 60, 60, 60, 60, 60, 60, 60,
    ])
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.bonusTier)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3,
    ])
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.bonusSlots)).toEqual([
      30, 20, 20, 20, 20, 20, 20, 20, 20,
    ])

    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.defenderDeployment.upperTierPoolCap)).toEqual([
      50, 50, 55, null, null, null, null, null, null,
    ])

    expect(getDefenseCampaignStage(1).defenderDeployment.tierCapacity).toEqual({ 1: 30, 2: 50, 3: 10 })
    expect(getDefenseCampaignStage(2).defenderDeployment.tierCapacity).toEqual({ 1: 25, 2: 50, 3: 10 })
    expect(getDefenseCampaignStage(3).defenderDeployment.tierCapacity).toEqual({ 1: 25, 2: 55, 3: 10 })
    expect(getDefenseCampaignStage(4).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 80, 3: 10 })
    expect(getDefenseCampaignStage(5).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 80, 3: 30 })
    expect(getDefenseCampaignStage(6).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 80, 3: 60 })
    expect(getDefenseCampaignStage(7).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 80 })
    expect(getDefenseCampaignStage(8).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 80 })
    expect(getDefenseCampaignStage(9).defenderDeployment.tierCapacity).toEqual({ 1: 0, 2: 60, 3: 80 })
  })

  it('matches the intended attacker growth and 4:2:2:1:1 role composition', () => {
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.attackerArmy.totalUnits)).toEqual([
      100, 110, 120, 130, 140, 150, 160, 180, 200,
    ])

    for (const stage of DEFENSE_CAMPAIGN_STAGES) {
      expect(sumRoleCounts(stage.attackerArmy.roleCounts)).toBe(stage.attackerArmy.totalUnits)
      expect(sumTierCounts(stage.attackerArmy.tierCounts)).toBe(stage.attackerArmy.totalUnits)

      const unit = stage.attackerArmy.totalUnits / 10
      expect(stage.attackerArmy.roleCounts).toEqual({
        frontline: unit * 4,
        ranged: unit * 2,
        sword_cavalry: unit * 2,
        lancer: unit,
        horse_archer: unit,
      })
    }
  })

  it('makes attacker quality progression explicit for stages four through six', () => {
    expect(getDefenseCampaignStage(4).attackerArmy.tierCounts).toEqual({ 1: 0, 2: 100, 3: 30 })
    expect(getDefenseCampaignStage(5).attackerArmy.tierCounts).toEqual({ 1: 0, 2: 70, 3: 70 })
    expect(getDefenseCampaignStage(6).attackerArmy.tierCounts).toEqual({ 1: 0, 2: 30, 3: 120 })
    expect(getDefenseCampaignStage(7).attackerArmy.tierCounts).toEqual({ 1: 0, 2: 0, 3: 160 })
  })

  it('upgrades faction-neutral sword cavalry reinforcement by chapter', () => {
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.reinforcement.count)).toEqual(
      new Array(9).fill(50),
    )
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.reinforcement.role)).toEqual(
      new Array(9).fill('sword_cavalry'),
    )
    expect(DEFENSE_CAMPAIGN_STAGES.map(stage => stage.reinforcement.tier)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3,
    ])
  })

  it('validates campaign stage ids', () => {
    expect(isCampaignStageId(1)).toBe(true)
    expect(isCampaignStageId(9)).toBe(true)
    expect(isCampaignStageId(0)).toBe(false)
    expect(isCampaignStageId(10)).toBe(false)
    expect(isCampaignStageId(1.5)).toBe(false)
  })
})
