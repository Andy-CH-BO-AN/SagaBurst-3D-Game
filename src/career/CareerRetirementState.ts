export type CareerRetirementPhase = 'departing' | 'mobilizing' | 'final-stand' | 'completed'
export type CareerRetirementOutcome = 'escaped' | 'fallen'

/** Persistence only. Runtime transitions and the final battle belong to later work. */
export interface CareerRetirementState {
  version: 1
  phase: CareerRetirementPhase
  acceptedAt: number
  combatElapsedSeconds: number
  outcome?: CareerRetirementOutcome
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
  return { version: 1, phase, acceptedAt, combatElapsedSeconds,
    ...(outcome === 'escaped' || outcome === 'fallen' ? { outcome } : {}) }
}
