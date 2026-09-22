/**
 * CampaignConfig.ts
 * Authoritative domain configuration for the Roman Campaign.
 *
 * This module is intentionally gameplay-agnostic: UI, spawning, siege AI, terrain,
 * and runtime state transitions consume these values but do not redefine them.
 */
import type {
  RomanPresetId,
  UnitTier,
  VikingPresetId,
} from '../battle/UnitPresetCatalog'
import type { TacticalOrder } from '../battle/TacticalOrder'

export type RomanCampaignStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type TierCounts = Readonly<Record<UnitTier, number>>
export type VikingPresetCounts = Readonly<Record<VikingPresetId, number>>

export interface RomanDeploymentRules {
  /** Maximum number of Roman NPC defenders the player may deploy. The player does not consume a slot. */
  maxUnits: number
  /**
   * Per-tier slot capacity. Total capacity may exceed maxUnits in later stages so the
   * player can freely mix tiers while staying within the stage total.
   */
  tierCapacity: TierCounts
  /** Mounted Roman NPC cap. null means unrestricted. */
  cavalryCap: number | null
}

export interface VikingAssaultConfig {
  totalUnits: number
  presetCounts: VikingPresetCounts
  tierCounts: TierCounts
}

export interface RomanReinforcementConfig {
  presetId: RomanPresetId
  count: number
  tier: UnitTier
}

export interface RomanCampaignStageConfig {
  id: RomanCampaignStageId
  romanDeployment: RomanDeploymentRules
  vikingAssault: VikingAssaultConfig
  reinforcement: RomanReinforcementConfig
}

export const ROMAN_CAMPAIGN_TIMINGS = {
  /** Enemy army does not exist during this deployment window. */
  deploymentSeconds: 60,
  /** Measured from the start of the Viking assault, not from scene load. */
  reinforcementDelaySeconds: 180,
} as const

export const ROMAN_CAMPAIGN_RULES = {
  playerFaction: 'roman',
  playerConsumesDeploymentSlot: false,
  playerCountsAsOriginalDefender: true,
  initialRomanOrder: 'defend' as TacticalOrder,
  victoryRequiresVikingElimination: true,
  lockDefeatWhenPlayerAndOriginalDefendersEliminated: true,
  continueSimulationAfterDefeat: true,
} as const

function tierCounts(t1: number, t2: number, t3: number): TierCounts {
  return { 1: t1, 2: t2, 3: t3 }
}

/**
 * Viking assault composition remains 4:2:2:1:1 across Veteran, Archer,
 * Sword Cavalry, Lancer, and Horse Archer. Spearmen are intentionally absent
 * from the current Roman Campaign assault roster.
 */
function vikingPresetCounts(totalUnits: number): VikingPresetCounts {
  if (totalUnits % 10 !== 0) {
    throw new Error(`Viking campaign army size must be divisible by 10: ${totalUnits}`)
  }

  const unit = totalUnits / 10
  return {
    viking_berserker: unit * 4,
    viking_spearman: 0,
    viking_archer: unit * 2,
    viking_sword_cavalry: unit * 2,
    viking_lancer: unit,
    viking_horse_archer: unit,
  }
}

function stage(
  id: RomanCampaignStageId,
  maxUnits: number,
  tierCapacity: TierCounts,
  cavalryCap: number | null,
  vikingTotal: number,
  vikingTiers: TierCounts,
  reinforcementTier: UnitTier,
): RomanCampaignStageConfig {
  return {
    id,
    romanDeployment: {
      maxUnits,
      tierCapacity,
      cavalryCap,
    },
    vikingAssault: {
      totalUnits: vikingTotal,
      presetCounts: vikingPresetCounts(vikingTotal),
      tierCounts: vikingTiers,
    },
    reinforcement: {
      presetId: 'roman_sword_cavalry',
      count: 50,
      tier: reinforcementTier,
    },
  }
}

/**
 * Roman Campaign progression:
 * - Stages 1-3: grow the Roman deployment while Viking numbers rise.
 * - Stages 4-6: keep Romans at 60 and progressively unlock T3 slots.
 * - Stages 7-9: Romans are fully T3-capable and cavalry restrictions open up.
 *
 * Viking T3 mix for stages 4-6 is deliberately explicit here so later balance
 * passes change data rather than runtime logic:
 *   S4 = 100 T2 + 30 T3
 *   S5 = 70 T2 + 70 T3
 *   S6 = 30 T2 + 120 T3
 */
export const ROMAN_CAMPAIGN_STAGES: readonly RomanCampaignStageConfig[] = [
  stage(1, 50, tierCounts(0, 50, 0), 10, 100, tierCounts(0, 100, 0), 1),
  stage(2, 55, tierCounts(5, 50, 0), 10, 110, tierCounts(0, 110, 0), 1),
  stage(3, 60, tierCounts(5, 55, 0), 10, 120, tierCounts(0, 120, 0), 1),

  stage(4, 60, tierCounts(0, 60, 10), 10, 130, tierCounts(0, 100, 30), 2),
  stage(5, 60, tierCounts(0, 60, 30), 10, 140, tierCounts(0, 70, 70), 2),
  stage(6, 60, tierCounts(0, 60, 60), 10, 150, tierCounts(0, 30, 120), 2),

  stage(7, 60, tierCounts(0, 60, 60), 20, 160, tierCounts(0, 0, 160), 3),
  stage(8, 60, tierCounts(0, 60, 60), 40, 180, tierCounts(0, 0, 180), 3),
  stage(9, 60, tierCounts(0, 60, 60), null, 200, tierCounts(0, 0, 200), 3),
]

export function isRomanCampaignStageId(value: number): value is RomanCampaignStageId {
  return Number.isInteger(value) && value >= 1 && value <= ROMAN_CAMPAIGN_STAGES.length
}

export function getRomanCampaignStage(id: RomanCampaignStageId): RomanCampaignStageConfig {
  const config = ROMAN_CAMPAIGN_STAGES[id - 1]
  if (!config || config.id !== id) {
    throw new Error(`Roman Campaign stage ${id} is not configured`)
  }
  return config
}