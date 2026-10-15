import { describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { Faction } from '../../src/world/NPC'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Army command and weapon input ownership', () => {

  it('routes wheel to existing command selection after Q and back to weapons after another Q', () => {
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null })
    inventory.addWeapon('runic_greatsword')
    const equip = vi.spyOn(inventory, 'equipWeapon')
    const h = controllerHarness([{ faction: Faction.PLAYER, presetId: 'viking_spearman' }], null, null, inventory)

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.wheelMode).toBe('command')
    expect(h.ui.render.mock.calls.at(-1)?.[5]).toBe('command')
    h.input.wheel(-1)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe('all')
    expect(equip).not.toHaveBeenCalled()

    h.input.clickMiddle()
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)
    h.input.wheel(1)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[4]).toBe(1)
    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    expect(h.controller.wheelMode).toBe('command')

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.wheelMode).toBe('weapon')
    h.input.wheel(1)
    h.controller.update()
    expect(equip).toHaveBeenCalledWith('runic_greatsword')
  })

  it('uses Q to leave formation placement before changing wheel mode', () => {
    let placing = false
    const formation = {
      get isPlacementMode() { return placing },
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { placing = true }),
      updatePlacement: vi.fn(),
      cancelPlacement: vi.fn(() => { placing = false }),
    }
    const h = controllerHarness([], formation)
    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(h.controller.isFormationPlacementMode).toBe(true)
    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(formation.cancelPlacement).toHaveBeenCalledOnce()
    expect(h.controller.wheelMode).toBe('weapon')
    expect(h.controller.isSubmenuOpen).toBe(true)
  })
})
