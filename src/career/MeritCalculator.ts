import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { RECRUIT_MISSION_MERIT_RULES } from './CareerMissionMeritPolicy'

export type CareerBattleOutcome = 'victory' | 'defeat' | 'draw'
export type CareerBattleRole = 'defense' | 'offense'

export interface MeritBreakdown {
  victory: number
  kills: number
  characterDamage: number
  survival: number
  structureDamage: number
  gateBreaches: number
  total: number
}

export const MERIT_RULES = {
  victory: 80,
  kill: 8,
  characterDamagePer100: 2,
  survival: 20,
  structureDamagePer100: 1,
  gateBreach: 25,
} as const

export function calculateMerit(
  stats: BattleStatsSnapshot,
  outcome: CareerBattleOutcome,
  role: CareerBattleRole,
  damagePolicy: 'battle' | 'mission' = 'battle',
): MeritBreakdown {
  const player = stats.player
  const victory = outcome === 'victory' ? MERIT_RULES.victory : 0
  const kills = Math.max(0, Math.floor(player.kills)) * MERIT_RULES.kill
  const characterDamage = damagePolicy === 'mission'
    ? Math.floor(Math.max(0, player.damageDealt) / RECRUIT_MISSION_MERIT_RULES.damagePerPoint)
    : Math.floor(Math.max(0, player.damageDealt) / 100) * MERIT_RULES.characterDamagePer100
  const survival = player.survived ? MERIT_RULES.survival : 0
  const structureDamage = role === 'offense'
    ? Math.floor(Math.max(0, player.structureDamage) / 100) * MERIT_RULES.structureDamagePer100
    : 0
  const gateBreaches = role === 'offense'
    ? Math.max(0, Math.floor(player.gateBreaches)) * MERIT_RULES.gateBreach
    : 0

  return {
    victory,
    kills,
    characterDamage,
    survival,
    structureDamage,
    gateBreaches,
    total: victory + kills + characterDamage + survival + structureDamage + gateBreaches,
  }
}
