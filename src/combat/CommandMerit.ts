import type { PlayerBattleStats, PlayerBattleStatsCheckpoint } from './BattleStatsTracker'

export type PersonalCombatContribution = Pick<PlayerBattleStatsCheckpoint,
  'damageDealt' | 'kills' | 'structureDamage' | 'structuresDestroyed' | 'gateBreaches'> & {
    /** Persist the squad's incoming damage independently; it never contributes to Player merit. */
    damageTaken?: number
  }

export function emptyPersonalContribution(): PersonalCombatContribution {
  return { damageDealt: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
}

export function mergePersonalMerit(player: PlayerBattleStats, ...contributions: PersonalCombatContribution[]): PlayerBattleStats {
  const result = { ...player }
  for (const contribution of contributions) {
    result.damageDealt += contribution.damageDealt
    result.kills += contribution.kills
    result.structureDamage += contribution.structureDamage
    result.structuresDestroyed += contribution.structuresDestroyed
    result.gateBreaches += contribution.gateBreaches
  }
  return result
}
