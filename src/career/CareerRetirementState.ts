export type CareerRetirementPhase = 'departing' | 'mobilizing' | 'final-stand' | 'completed'
export type CareerRetirementOutcome = 'escaped' | 'fallen'

/** Persistence only. Runtime transitions and the final battle belong to later work. */
export interface CareerRetirementState {
  version: 1
  phase: CareerRetirementPhase
  acceptedAt: number
  combatElapsedSeconds: number
  mobilization?: { version: 1; commandRevoked: true; refillCompleted: true; formationPrepared: true }
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
  const receipt = raw.mobilization as Partial<NonNullable<CareerRetirementState['mobilization']>> | undefined
  if (receipt !== undefined && (phase === 'departing' || !receipt || typeof receipt !== 'object'
    || receipt.version !== 1 || receipt.commandRevoked !== true || receipt.refillCompleted !== true || receipt.formationPrepared !== true)) return null
  return { version: 1, phase, acceptedAt, combatElapsedSeconds,
    ...(receipt ? { mobilization: { version: 1 as const, commandRevoked: true as const, refillCompleted: true as const, formationPrepared: true as const } } : {}),
    ...(outcome === 'escaped' || outcome === 'fallen' ? { outcome } : {}) }
}
