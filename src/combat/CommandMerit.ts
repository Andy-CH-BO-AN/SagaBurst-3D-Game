import type { PlayerBattleStats, PlayerBattleStatsCheckpoint } from './BattleStatsTracker'

export type PersonalCombatContribution = Pick<PlayerBattleStatsCheckpoint,
  'damageDealt' | 'kills' | 'structureDamage' | 'structuresDestroyed' | 'gateBreaches'>

export function emptyPersonalContribution(): PersonalCombatContribution {
  return { damageDealt: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
}

export function mergePersonalMerit(player: PlayerBattleStats, contribution: PersonalCombatContribution): PlayerBattleStats {
  return { ...player, damageDealt: player.damageDealt + contribution.damageDealt,
    kills: player.kills + contribution.kills, structureDamage: player.structureDamage + contribution.structureDamage,
    structuresDestroyed: player.structuresDestroyed + contribution.structuresDestroyed,
    gateBreaches: player.gateBreaches + contribution.gateBreaches }
}
