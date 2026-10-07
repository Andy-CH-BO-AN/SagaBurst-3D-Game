import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'
import { InventoryManager } from '../../src/rpg/InventoryManager'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Soldier command capability wiring', () => {
  it('blocks keyboard, wheel commands and formation while retaining weapon switching', () => {
    const unit = { faction: Faction.PLAYER, presetId: 'viking_berserker', dead: false, setTacticalOrder: vi.fn() }
    const formation = { setCompletionHandler: vi.fn(), beginPlacement: vi.fn(), updateCompletion: vi.fn() }
    const inventory = new InventoryManager({ meleeWeaponId: 'viking_axe_t1', rangedWeaponId: '', shieldId: null })
    inventory.addWeapon('hunting_spear')
    const { controller, input, ui } = controllerHarness([unit], formation, null, inventory, 'viking', 'squad', false)
    expect(ui.setEnabled).toHaveBeenCalledWith(false)
    expect(ui.render).not.toHaveBeenCalled()
    input.pressAll(); input.pressKey('KeyQ'); input.press('1'); input.press('4'); input.clickMiddle()
    controller.update(); controller.postUpdate()
    expect(controller.selected).toBeNull()
    expect(controller.isSubmenuOpen).toBe(false)
    expect(controller.wheelMode).toBe('weapon')
    expect(unit.setTacticalOrder).not.toHaveBeenCalled()
    expect(formation.beginPlacement).not.toHaveBeenCalled()
    expect(formation.updateCompletion).not.toHaveBeenCalled()
    input.wheel(1); controller.update()
    expect(inventory.equippedMelee.id).toBe('hunting_spear')
    expect(unit.setTacticalOrder).not.toHaveBeenCalled()
  })
})
