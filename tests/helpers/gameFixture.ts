import { Game } from '../../src/Game'
import type { BattleSpawnPlan } from '../../src/battle/BattleSpawner'

export interface GameTestApi {
  _executeBattleSpawnPlan(plan: BattleSpawnPlan, progress?: (text: string) => void): Promise<import('../../src/world/NPC').NPC[]>
  _disposeCareerOutpostBattleActors(): void
}

/** Build a prototype-based Game test double with the required fields visible at its call site. */
export function createGameTestFixture<T extends object>(fields: T, overrides: Partial<T> = {}): GameTestApi & T {
  return Object.assign(Object.create(Game.prototype) as object, fields, overrides) as GameTestApi & T
}
