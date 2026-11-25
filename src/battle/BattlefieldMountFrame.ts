interface BattlefieldMountFrameEffects {
  updateInteractions(dt: number): void
  isCombatLocked(): boolean
  updateImpactDamage(): void
  persistPersonalOutpost(dt: number): void
}

/** Runs mount movement and player interactions before checking for impact damage. */
export function runBattlefieldMountFrame(
  dt: number,
  effects: BattlefieldMountFrameEffects,
  now?: () => number,
): { mountInteractionMs: number; impactMs: number } | undefined {
  const mountStartedAt = now?.() ?? 0
  effects.updateInteractions(dt)

  const impactStartedAt = now?.() ?? 0
  if (!effects.isCombatLocked()) effects.updateImpactDamage()
  effects.persistPersonalOutpost(dt)

  if (now) return { mountInteractionMs: impactStartedAt - mountStartedAt, impactMs: now() - impactStartedAt }
}
