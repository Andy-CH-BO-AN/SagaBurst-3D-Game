import type { AerialPosition } from './CareerAerialState'
import type { ActiveCareerMission } from './CareerMissionState'
import type { EagleFlightSnapshot } from '../movement/EagleFlightController'
import type { PlayerBattleStatsCheckpoint } from '../combat/BattleStatsTracker'

export type CareerRetirementPhase = 'departing' | 'mobilizing' | 'final-stand' | 'completed'
export type CareerRetirementOutcome = 'escaped' | 'fallen'

/** Finale-only counters. Private contributions never merge into Player or Career merit. */
export interface CareerRetirementStats {
  player: PlayerBattleStatsCheckpoint
  personal: PlayerBattleStatsCheckpoint
}

/** Durable checkpoint; phase and elapsed changes belong to the retirement state owners. */
export interface CareerRetirementState {
  version: 1
  phase: CareerRetirementPhase
  acceptedAt: number
  combatElapsedSeconds: number
  mobilization?: { version: 1; commandRevoked: true; refillCompleted: true; formationPrepared: true }
  outcome?: CareerRetirementOutcome
}

/** Ordinary resource snapshots may advance without rewriting the irreversible phase.
 * Falling riders continue to use the existing CareerAerialState checkpoint.
 */
export interface CareerRetirementRuntime {
  /** Absent on older saves; their finale counters start at zero. */
  stats?: CareerRetirementStats
  player: {
    position: AerialPosition
    hp: number
    stamina: number
    arrows: number
    shieldImpact: number
    shieldDurability?: Record<string, number>
    mounted: boolean
  }
  mountState?: ActiveCareerMission['mountState']
  mount?: { position: AerialPosition; hp: number; flight?: EagleFlightSnapshot }
}

export function parseCareerRetirementState(value: unknown): CareerRetirementState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1
    || typeof raw.acceptedAt !== 'number' || !Number.isInteger(raw.acceptedAt) || raw.acceptedAt < 0
    || typeof raw.combatElapsedSeconds !== 'number' || !Number.isFinite(raw.combatElapsedSeconds)
    || raw.combatElapsedSeconds < 0) return null
  const { phase, acceptedAt, combatElapsedSeconds, outcome } = raw
  if (phase !== 'departing' && phase !== 'mobilizing' && phase !== 'final-stand' && phase !== 'completed') return null
  if (phase === 'completed') {
    if (outcome !== 'escaped' && outcome !== 'fallen') return null
  } else if (outcome !== undefined || (phase !== 'final-stand' && combatElapsedSeconds !== 0)) return null
  const receipt = raw.mobilization as Partial<NonNullable<CareerRetirementState['mobilization']>> | undefined
  if (receipt !== undefined && (phase === 'departing' || !receipt || typeof receipt !== 'object'
    || receipt.version !== 1 || receipt.commandRevoked !== true || receipt.refillCompleted !== true || receipt.formationPrepared !== true)) return null
  return { version: 1, phase, acceptedAt, combatElapsedSeconds,
    ...(receipt ? { mobilization: { version: 1 as const, commandRevoked: true as const, refillCompleted: true as const, formationPrepared: true as const } } : {}),
    ...(outcome === 'escaped' || outcome === 'fallen' ? { outcome } : {}) }
}
