/**
 * CampaignConfig.ts
 * Authoritative faction-neutral domain configuration for Campaign mode.
 *
 * Campaign type and faction are independent:
 * - defense: either Roman or Viking can defend using the same stage curve.
 * - offense: either Roman or Viking can attack using a separate stage curve (added later).
 *
 * UI, spawning, siege AI, terrain, and runtime state transitions consume these
 * values but do not redefine them.
 */
import type { UnitPresetId, UnitTier } from '../battle/UnitPresetCatalog'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { CharacterFaction } from '../world/CharacterVisuals'

export type CampaignType = 'defense' | 'offense'
export type CampaignFaction = CharacterFaction
export type CampaignStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type CampaignUnitRole =
  | 'frontline'
  | 'ranged'
  | 'sword_cavalry'
  | 'lancer'
  | 'horse_archer'

export type TierCounts = Readonly<Record<UnitTier, number>>
export type CampaignRoleCounts = Readonly<Record<CampaignUnitRole, number>>

export interface DefenseDeploymentRules {
  /** Original deployment pool before the chapter-specific +20 bonus slots. */
  baseMaxUnits: number
  /** Chapter-specific tier that receives the extra deployment slots. */
  bonusTier: UnitTier
  bonusSlots: number
  /**
   * Shared T2+T3 pool for early stages. null when individual tier caps and
   * maxUnits already fully enforce the chapter bonus rule.
   */
  upperTierPoolCap: number | null
  /** Maximum number of defender NPCs after applying the bonus slots. */
  maxUnits: number
  /**
   * Per-tier capacity after applying the chapter bonus.
   * The base pool rule still prevents bonus slots from leaking into other tiers.
   */
  tierCapacity: TierCounts
  /** Mounted defender NPC cap. null means unrestricted. */
  cavalryCap: number | null
}

export interface CampaignArmyConfig {
  totalUnits: number
  roleCounts: CampaignRoleCounts
  tierCounts: TierCounts
}

export interface CampaignReinforcementConfig {
  role: CampaignUnitRole
  count: number
  tier: UnitTier
}

export interface DefenseCampaignStageConfig {
  id: CampaignStageId
  defenderDeployment: DefenseDeploymentRules
  attackerArmy: CampaignArmyConfig
  reinforcement: CampaignReinforcementConfig
}

export const DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING = {
  /** Relief cavalry appears behind the attacking army, then rides into battle. */
  distanceFromCenter: 250,
} as const

export const DEFENSE_CAMPAIGN_TIMINGS = {
  /** Attacker army does not exist during this deployment window. */
  deploymentSeconds: 60,
  /** Measured from the start of the assault, not from scene load. */
  reinforcementDelaySeconds: 120,
} as const

export const DEFENSE_CAMPAIGN_RULES = {
  playerConsumesDeploymentSlot: false,
  playerCountsAsOriginalDefender: true,
  initialDefenderOrder: 'defend' as TacticalOrder,
  /** Applies only before the reinforcement wave has actually spawned. */
  lockDefeatWhenPlayerAndOriginalDefendersEliminated: true,
  continueSimulationAfterDefeat: true,
  /** Defender-side elimination becomes terminal only after the reinforcement wave exists. */
  finishDefenderEliminationAfterReinforcement: true,
} as const

export const CAMPAIGN_ROLE_PRESETS: Readonly<
  Record<CampaignFaction, Readonly<Record<CampaignUnitRole, UnitPresetId>>>
> = {
  roman: {
    frontline: 'roman_heavy_infantry',
    ranged: 'roman_javelin_infantry',
    sword_cavalry: 'roman_sword_cavalry',
    lancer: 'roman_lancer',
    horse_archer: 'roman_horse_archer',
  },
  viking: {
    frontline: 'viking_berserker',
    ranged: 'viking_archer',
    sword_cavalry: 'viking_sword_cavalry',
    lancer: 'viking_lancer',
    horse_archer: 'viking_horse_archer',
  },
}

export function resolveCampaignRolePreset(
  faction: CampaignFaction,
  role: CampaignUnitRole,
): UnitPresetId {
  return CAMPAIGN_ROLE_PRESETS[faction][role]
}

export function opposingCampaignFaction(faction: CampaignFaction): CampaignFaction {
  return faction === 'roman' ? 'viking' : 'roman'
}

function tierCounts(t1: number, t2: number, t3: number): TierCounts {
  return { 1: t1, 2: t2, 3: t3 }
}

/**
 * Shared assault composition for Defense Campaign:
 * 40% frontline, 20% ranged, 20% sword cavalry, 10% lancer, 10% horse archer.
 *
 * Faction resolution is deferred:
 * - Roman ranged -> Javelin Infantry
 * - Viking ranged -> Archer
 */
function attackerRoleCounts(totalUnits: number): CampaignRoleCounts {
  if (totalUnits % 10 !== 0) {
    throw new Error(`Defense Campaign attacker size must be divisible by 10: ${totalUnits}`)
  }

  const unit = totalUnits / 10
  return {
    frontline: unit * 4,
    ranged: unit * 2,
    sword_cavalry: unit * 2,
    lancer: unit,
    horse_archer: unit,
  }
}

export const DEFENSE_CAMPAIGN_BONUS_DEFENDER_SLOTS = 20

function defenseStage(
  id: CampaignStageId,
  baseMaxUnits: number,
  baseTierCapacity: TierCounts,
  bonusTier: UnitTier,
  cavalryCap: number | null,
  attackerTotal: number,
  attackerTiers: TierCounts,
  reinforcementTier: UnitTier,
  bonusSlots = DEFENSE_CAMPAIGN_BONUS_DEFENDER_SLOTS,
): DefenseCampaignStageConfig {
  const tierCapacity = {
    ...baseTierCapacity,
    [bonusTier]: baseTierCapacity[bonusTier] + bonusSlots,
  } as TierCounts

  return {
    id,
    defenderDeployment: {
      baseMaxUnits,
      bonusTier,
      bonusSlots,
      upperTierPoolCap: bonusTier === 1 ? baseTierCapacity[2] : null,
      maxUnits: baseMaxUnits + bonusSlots,
      tierCapacity,
      cavalryCap,
    },
    attackerArmy: {
      totalUnits: attackerTotal,
      roleCounts: attackerRoleCounts(attackerTotal),
      tierCounts: attackerTiers,
    },
    reinforcement: {
      role: 'sword_cavalry',
      count: 50,
      tier: reinforcementTier,
    },
  }
}

/**
 * Shared Defense Campaign progression for either defender faction.
 *
 * - Stage 1 gains 30 additional T1 defender slots.
 * - Stages 2-3 add 20 slots as T1 capacity.
 * - Stages 4-6 add those 20 slots as T2 capacity.
 * - Stages 7-9 add those 20 slots as T3 capacity.
 * - Existing T3 unlocks and cavalry-cap progression remain additive.
 *
 * Attacker T3 mix for stages 4-6 is explicit so balance changes remain data-only:
 *   S4 = 100 T2 + 30 T3
 *   S5 = 70 T2 + 70 T3
 *   S6 = 30 T2 + 120 T3
 */
export const DEFENSE_CAMPAIGN_STAGES: readonly DefenseCampaignStageConfig[] = [
  defenseStage(1, 50, tierCounts(0, 50, 10), 1, 10, 100, tierCounts(0, 100, 0), 1, 30),
  defenseStage(2, 55, tierCounts(5, 50, 10), 1, 10, 110, tierCounts(0, 110, 0), 1),
  defenseStage(3, 60, tierCounts(5, 55, 10), 1, 10, 120, tierCounts(0, 120, 0), 1),

  defenseStage(4, 60, tierCounts(0, 60, 10), 2, 10, 130, tierCounts(0, 100, 30), 2),
  defenseStage(5, 60, tierCounts(0, 60, 30), 2, 10, 140, tierCounts(0, 70, 70), 2),
  defenseStage(6, 60, tierCounts(0, 60, 60), 2, 10, 150, tierCounts(0, 30, 120), 2),

  defenseStage(7, 60, tierCounts(0, 60, 60), 3, 20, 160, tierCounts(0, 0, 160), 3),
  defenseStage(8, 60, tierCounts(0, 60, 60), 3, 40, 180, tierCounts(0, 0, 180), 3),
  defenseStage(9, 60, tierCounts(0, 60, 60), 3, null, 200, tierCounts(0, 0, 200), 3),
]

export function getDefenseDeploymentBaseUsed(
  rules: DefenseDeploymentRules,
  tierTotals: TierCounts,
): number {
  const bonusUsed = Math.min(tierTotals[rules.bonusTier], rules.bonusSlots)
  return tierTotals[1] + tierTotals[2] + tierTotals[3] - bonusUsed
}

export function isCampaignStageId(value: number): value is CampaignStageId {
  return Number.isInteger(value) && value >= 1 && value <= DEFENSE_CAMPAIGN_STAGES.length
}

export function getDefenseCampaignStage(id: CampaignStageId): DefenseCampaignStageConfig {
  const config = DEFENSE_CAMPAIGN_STAGES[id - 1]
  if (!config || config.id !== id) {
    throw new Error(`Defense Campaign stage ${id} is not configured`)
  }
  return config
}
