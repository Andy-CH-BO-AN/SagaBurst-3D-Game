import { vi } from 'vitest'
import { ArmyCommandController, type ArmyCommandAuthority } from '../../src/battle/ArmyCommandController'
import type { TacticalOrder } from '../../src/battle/TacticalOrder'
import type { NPC, Faction } from '../../src/world/NPC'
import type { PlayerInput } from '../../src/player/PlayerInput'
import type { ArmyCommandUI } from '../../src/ui/ArmyCommandUI'
import type { FormationController } from '../../src/battle/FormationController'
import type { InventoryManager } from '../../src/rpg/InventoryManager'

/** Dispatch-only records; these do not stand in for real actor AI, HP or movement. */
export interface CommandRecipientFixture {
  faction?: Faction
  combatantId?: string
  presetId?: string
  squadId?: number | string
  dead?: boolean
  tacticalOrder?: string
  setTacticalOrder?: (order: TacticalOrder) => void
}

export type CommandFormationFixture = Partial<Pick<FormationController,
  'isPlacementMode' | 'setCompletionHandler' | 'beginPlacement' | 'updatePlacement' |
  'confirmPlacement' | 'cancelPlacement' | 'updateCompletion'>>

export function createArmyCommandHarness(
  npcs: CommandRecipientFixture[],
  formation: CommandFormationFixture | null = null,
  canIssueOrder: ((order: TacticalOrder) => boolean) | null = null,
  inventory: InventoryManager | null = null,
  faction: 'viking' | 'roman' = 'viking',
  grouping: 'preset' | 'squad' = 'preset',
  commandsEnabled = true,
  personalCommands?: { issue(order: TacticalOrder | 'dismiss'): boolean; enabled(): boolean },
  authority?: ArmyCommandAuthority,
) {
  const pressed = new Set<string>()
  const consume = (code: string) => {
    if (!pressed.has(code)) return false
    pressed.delete(code)
    return true
  }
  let wheelSteps = 0
  const input = {
    consumeKeyPress: consume,
    consumeKeyE: () => consume('KeyE'),
    consumeLeftClick: () => consume('MouseLeft'),
    consumeLeftGesture: () => { pressed.delete('MouseLeft') },
    consumeMiddleClick: () => consume('MouseMiddle'),
    consumeWheelStep: (): -1 | 0 | 1 => {
      if (wheelSteps > 0) {
        wheelSteps--
        return 1
      }
      if (wheelSteps < 0) {
        wheelSteps++
        return -1
      }
      return 0
    },
    press: (digit: string) => pressed.add(`Digit${digit}`),
    pressAll: () => pressed.add('Backquote'),
    pressKey: (code: string) => pressed.add(code),
    pressE: () => pressed.add('KeyE'),
    clickLeft: () => pressed.add('MouseLeft'),
    clickMiddle: () => pressed.add('MouseMiddle'),
    wheel: (steps: number) => { wheelSteps += steps },
  }
  const ui = {
    setEnabled: vi.fn<ArmyCommandUI['setEnabled']>(),
    render: vi.fn<ArmyCommandUI['render']>(),
    renderPlacement: vi.fn<ArmyCommandUI['renderPlacement']>(),
    showFeedback: vi.fn<ArmyCommandUI['showFeedback']>(),
  }
  // Only controller-facing fields are supplied: no DOM/input listeners, AI or full formation runtime.
  const controller = new ArmyCommandController(
    npcs as unknown as NPC[],
    faction,
    input as unknown as PlayerInput,
    ui as unknown as ArmyCommandUI,
    formation as FormationController | null,
    null,
    'attack',
    canIssueOrder,
    inventory,
    grouping,
    commandsEnabled,
    personalCommands,
    authority,
  )
  return { controller, input, ui }
}
