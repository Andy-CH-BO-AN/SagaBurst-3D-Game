import { describe, expect, it, vi } from 'vitest'
import { Faction } from '../../src/world/NPC'
import { InventoryManager } from '../../src/rpg/InventoryManager'

import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Army command and weapon input ownership', () => {
  it.each([
    ['viking', 'steel_sword', 'runic_greatsword', 'recurve_longbow'],
    ['roman', 'gladius_standard', 'centurion_blade', 'pilum_standard'],
  ] as const)('cycles only owned %s melee weapons in both directions without changing command selection', (faction, meleeId, nextMeleeId, rangedId) => {
    const inventory = new InventoryManager({ meleeWeaponId: meleeId, rangedWeaponId: rangedId, shieldId: null })
    inventory.addWeapon(nextMeleeId)
    const equip = vi.spyOn(inventory, 'equipWeapon')
    const ally = { faction: Faction.PLAYER, presetId: faction === 'roman' ? 'roman_spearman' : 'viking_spearman' }
    const h = controllerHarness([ally], null, null, inventory, faction)
    const initialHighlight = h.ui.render.mock.calls.at(-1)?.[3]

    h.input.wheel(1)
    h.controller.update()
    expect(h.controller.wheelMode).toBe('weapon')
    expect(equip).toHaveBeenLastCalledWith(nextMeleeId)
    expect(inventory.equippedRanged.id).toBe(rangedId)
    expect(h.ui.render.mock.calls.at(-1)?.[3]).toBe(initialHighlight)
    expect(h.ui.render.mock.calls.at(-1)?.[5]).toBe('weapon')
    expect(h.ui.render.mock.calls.at(-1)?.[6]).toBe(inventory.equippedMelee.name)

    h.input.wheel(1)
    h.controller.update()
    expect(equip).toHaveBeenLastCalledWith(meleeId)
    h.input.wheel(-1)
    h.controller.update()
    expect(equip).toHaveBeenLastCalledWith(nextMeleeId)
    expect(equip).toHaveBeenCalledTimes(3)
  })

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

  it.each([
    ['viking', 'steel_sword', 'recurve_longbow'],
    ['roman', 'gladius_standard', 'pilum_standard'],
  ] as const)('leaves a single owned %s melee weapon equipped while ignoring the ranged weapon', (faction, meleeId, rangedId) => {
    const inventory = new InventoryManager({ meleeWeaponId: meleeId, rangedWeaponId: rangedId, shieldId: null })
    const equip = vi.spyOn(inventory, 'equipWeapon')
    const h = controllerHarness([], null, null, inventory, faction)
    h.input.wheel(3)
    h.controller.update()
    h.input.wheel(-3)
    h.controller.update()
    expect(equip).not.toHaveBeenCalled()
    expect(inventory.equippedMelee.id).toBe(meleeId)
    expect(inventory.equippedRanged.id).toBe(rangedId)
  })

  it('ignores unavailable melee weapons after inventory changes', () => {
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null })
    inventory.addWeapon('runic_greatsword')
    inventory.loadSaveState({ items: [{ id: 'steel_sword', quantity: 1 }] })
    const equip = vi.spyOn(inventory, 'equipWeapon')
    const h = controllerHarness([], null, null, inventory)
    h.input.wheel(3)
    h.controller.update()
    h.input.wheel(-3)
    h.controller.update()
    expect(equip).not.toHaveBeenCalled()
    expect(inventory.equippedMelee.id).toBe('steel_sword')
  })

  it('keeps weapon wheel ownership in a shortcut-opened submenu and lets Q go back', () => {
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null })
    inventory.addWeapon('runic_greatsword')
    const h = controllerHarness([{ faction: Faction.PLAYER, presetId: 'viking_spearman' }], null, null, inventory)
    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)
    h.input.wheel(1)
    h.controller.update()
    expect(h.ui.render.mock.calls.at(-1)?.[4]).toBe(0)
    expect(h.ui.render.mock.calls.at(-1)?.[6]).toBe(inventory.equippedMelee.name)
    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    expect(h.controller.wheelMode).toBe('weapon')
  })

  it('uses Q to leave formation placement before changing wheel mode', () => {
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
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

  it('returns from formation placement to the command menu with Backquote', () => {
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(h.controller.isFormationPlacementMode).toBe(true)

    h.input.pressAll()
    h.controller.update()
    expect(formation.cancelPlacement).toHaveBeenCalledOnce()
    expect(h.controller.isFormationPlacementMode).toBe(false)
    expect(h.controller.isSubmenuOpen).toBe(true)
    expect(h.controller.selected).toBe('all')

    h.input.pressAll()
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })
})
