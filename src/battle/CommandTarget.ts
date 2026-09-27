import type { UnitPresetId } from './UnitPresetCatalog'

export const MAX_COMMAND_SQUADS = 8
export const TARGET_COMMAND_SQUAD_SIZE = 10

export type SquadId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type SquadCommandTarget = `squad:${SquadId}`
export type CommandGroupingMode = 'preset' | 'squad'
export type ArmyCommandTarget = UnitPresetId | SquadCommandTarget | 'all'

export interface CommandTargetUnit {
  presetId?: UnitPresetId
  squadId?: SquadId
}

export function squadCommandTarget(squadId: SquadId): SquadCommandTarget {
  return `squad:${squadId}`
}

export function isSquadCommandTarget(target: ArmyCommandTarget): target is SquadCommandTarget {
  return target.startsWith('squad:')
}

export function squadIdFromCommandTarget(target: SquadCommandTarget): SquadId {
  return Number(target.slice('squad:'.length)) as SquadId
}

export function matchesArmyCommandTarget(
  unit: CommandTargetUnit,
  target: ArmyCommandTarget,
): boolean {
  if (target === 'all') return true
  if (isSquadCommandTarget(target)) return unit.squadId === squadIdFromCommandTarget(target)
  return unit.presetId === target
}
