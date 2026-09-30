import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { CareerMissionMeritBreakdown, CareerMissionOutcome } from './CareerMissionState'

export const RECRUIT_MISSION_MERIT_RULES = {
  damagePerPoint: 20,
  kill: 6,
  maxContributionBonus: 12,
  damageForFullContributionBonus: 150,
} as const

/** Recruit missions intentionally do not use the campaign +80 victory / +20 survival policy. */
export function calculateRecruitMissionMerit(
  stats: Pick<BattleStatsSnapshot['player'], 'damageDealt' | 'kills' | 'survived'>,
  outcome: CareerMissionOutcome,
): CareerMissionMeritBreakdown {
  const appliedDamage = Math.max(0, stats.damageDealt)
  const kills = Math.max(0, Math.floor(stats.kills))
  if (appliedDamage <= 0 && kills <= 0) return { damage: 0, kills: 0, contribution: 0, total: 0 }

  const damageMerit = Math.floor(appliedDamage / RECRUIT_MISSION_MERIT_RULES.damagePerPoint)
  const killMerit = kills * RECRUIT_MISSION_MERIT_RULES.kill
  const contribution = outcome === 'victory' && stats.survived
    ? Math.round(Math.min(
      RECRUIT_MISSION_MERIT_RULES.maxContributionBonus,
      appliedDamage / RECRUIT_MISSION_MERIT_RULES.damageForFullContributionBonus
        * RECRUIT_MISSION_MERIT_RULES.maxContributionBonus,
    ))
    : 0
  return {
    damage: damageMerit,
    kills: killMerit,
    contribution,
    total: damageMerit + killMerit + contribution,
  }
}

