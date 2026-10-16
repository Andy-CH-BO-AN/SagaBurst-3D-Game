import {
  CIVILIAN_SQUAD_ID,
  PERSONAL_SQUAD_ID,
  isSquadCommandTarget,
  squadIdFromCommandTarget,
  type ArmyCommandTarget,
  type SquadId,
  type SquadIdentity,
} from '../battle/CommandTarget'

export const COMMANDER_TOWN_SQUAD_LABELS: Readonly<Record<SquadIdentity, string>> = Object.freeze({
  1: '北門步兵隊',
  2: '北門騎兵／指揮隊',
  3: '南門步兵隊',
  4: '南門騎兵隊',
  5: '東門步兵隊',
  6: '東門騎兵隊',
  7: '西門與機動部隊',
  8: '城鎮巨鷹巡邏隊',
  [PERSONAL_SQUAD_ID]: 'HR 私兵',
  [CIVILIAN_SQUAD_ID]: '平民／商人',
})

/**
 * Returns the official Commander Town display name for a squad identity.
 * Accepts numeric squad IDs (1..8), 'personal', 'civilians', and 'civilian' (equipment tab alias).
 */
export function commanderTownSquadLabel(id: SquadIdentity | 'civilian' | number | string): string | undefined {
  if (id === 'civilian') return COMMANDER_TOWN_SQUAD_LABELS[CIVILIAN_SQUAD_ID]
  if (typeof id === 'number' && id >= 1 && id <= 8) {
    return COMMANDER_TOWN_SQUAD_LABELS[id as SquadId]
  }
  if (id === PERSONAL_SQUAD_ID || id === CIVILIAN_SQUAD_ID) {
    return COMMANDER_TOWN_SQUAD_LABELS[id]
  }
  return undefined
}

/**
 * Resolves an ArmyCommandTarget (e.g. 'squad:1' .. 'squad:8', 'squad:personal', 'squad:civilians')
 * to its Commander Town squad label. Returns undefined for presets or 'all'.
 */
export function resolveCommanderTownTargetLabel(target: ArmyCommandTarget | null | undefined): string | undefined {
  if (!target || !isSquadCommandTarget(target)) return undefined
  const squadId = squadIdFromCommandTarget(target)
  return commanderTownSquadLabel(squadId)
}
