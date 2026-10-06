import type { UnitPresetId, UnitTier } from './UnitPresetCatalog'

export const MAX_COMMAND_SQUADS = 8
export const TARGET_COMMAND_SQUAD_SIZE = 10
export const MAX_COMMAND_SQUAD_SIZE = 30

export type SquadId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const PERSONAL_SQUAD_ID = 'personal' as const
export type SquadIdentity = SquadId | typeof PERSONAL_SQUAD_ID
export type SquadCommandTarget = `squad:${SquadIdentity}`
export type CommandGroupingMode = 'preset' | 'squad'
export type ArmyCommandTarget = UnitPresetId | SquadCommandTarget | 'all'

export interface SquadAssignment {
  presetId: UnitPresetId
  tier: UnitTier
  squadId: SquadId
  count: number
}

export interface CommandTargetUnit {
  presetId?: UnitPresetId
  squadId?: SquadIdentity
}

export function squadCommandTarget(squadId: SquadIdentity): SquadCommandTarget {
  return `squad:${squadId}`
}

export function isSquadCommandTarget(target: ArmyCommandTarget): target is SquadCommandTarget {
  return target.startsWith('squad:')
}

export function squadIdFromCommandTarget(target: SquadCommandTarget): SquadIdentity {
  if (target === 'squad:personal') return PERSONAL_SQUAD_ID
  return Number(target.slice('squad:'.length)) as SquadId
}

export function squadDisplayOrder(id: SquadIdentity): number { return id === PERSONAL_SQUAD_ID ? 9 : id }
export function squadLabel(id: SquadIdentity): string {
  return id === PERSONAL_SQUAD_ID ? 'Personal Squad · 私人小隊' : `第 ${id} 隊`
}

export function matchesArmyCommandTarget(
  unit: CommandTargetUnit,
  target: ArmyCommandTarget,
): boolean {
  if (target === 'all') return true
  if (isSquadCommandTarget(target)) return unit.squadId === squadIdFromCommandTarget(target)
  return unit.presetId === target
}
