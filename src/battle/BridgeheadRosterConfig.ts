/** Shared roster sizes for mission creation, deployment and save validation. */
export const BRIDGEHEAD_SQUAD_SIZE = 25
export const BRIDGEHEAD_FRIENDLY_SQUADS = 8
export const BRIDGEHEAD_ENEMY_SQUADS_PER_ROLE = 6
export const BRIDGEHEAD_FRIENDLIES = BRIDGEHEAD_FRIENDLY_SQUADS * BRIDGEHEAD_SQUAD_SIZE
export const BRIDGEHEAD_ENEMIES = BRIDGEHEAD_ENEMY_SQUADS_PER_ROLE * 2 * BRIDGEHEAD_SQUAD_SIZE

/** Historical layout stays explicit so an accepted battle retains its saved strength. */
const LEGACY_ENEMY_SQUADS_PER_ROLE = 4
export function bridgeheadEnemySquadsPerRole(count: number): 4 | 6 | undefined {
  return ([LEGACY_ENEMY_SQUADS_PER_ROLE, BRIDGEHEAD_ENEMY_SQUADS_PER_ROLE] as const)
    .find(squads => count === squads * 2 * BRIDGEHEAD_SQUAD_SIZE)
}

export function isBridgeheadEnemyCount(count: number): boolean {
  return bridgeheadEnemySquadsPerRole(count) !== undefined
}
