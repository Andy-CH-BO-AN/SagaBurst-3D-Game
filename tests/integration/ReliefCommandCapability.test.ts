import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { ArmyCommandController } from '../../src/battle/ArmyCommandController'
import { ArmyCommandUI } from '../../src/ui/ArmyCommandUI'
import { PlayerInput } from '../../src/player/PlayerInput'
import { InventoryManager } from '../../src/rpg/InventoryManager'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

function launch(faction: 'roman' | 'viking' = 'roman') { return createCareerOutpostLaunch(acceptCareerOutpostRelief(ready(faction), 'relief')!) }

describe('Relief command capability wiring', () => {
  it('disables commands and HUD but keeps weapon wheel switching', () => {
  let step = 1
  const input = { consumeWheelStep: () => { const value = step; step = 0; return value }, consumeKeyPress: vi.fn(() => true) }
  const ui = { setEnabled: vi.fn() }, inventory = new InventoryManager()
  const weapon = inventory.equippedMelee.id
  const config = launch()
  const controller = new ArmyCommandController([], 'roman', input as unknown as PlayerInput, ui as unknown as ArmyCommandUI,
    null, null, 'defend', null, inventory, 'preset', config.capabilities!.playerCommandsEnabled)
  controller.update()
  expect(ui.setEnabled).toHaveBeenCalledWith(false)
  expect(input.consumeKeyPress).not.toHaveBeenCalled(); expect(controller.wheelMode).toBe('weapon'); expect(controller.isSubmenuOpen).toBe(false)
  expect(inventory.equippedMelee.id).not.toBe(weapon)
})
})
