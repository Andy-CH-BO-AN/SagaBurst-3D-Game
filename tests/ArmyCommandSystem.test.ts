import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  ArmyCommandController,
  getArmyCommandShortcut,
  getArmyCommandShortcuts,
} from '../src/battle/ArmyCommandController'
import { armyCommandTargetLabel } from '../src/ui/ArmyCommandUI'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { STAMINA_DRAIN, SPRINT_MULTIPLIER } from '../src/movement/MovementBalance'

function controllerHarness(npcs: any[]) {
  const pressed = new Set<string>()
  const input = {
    consumeKeyPress: (code: string) => {
      if (!pressed.has(code)) return false
      pressed.delete(code)
      return true
    },
    press: (digit: string) => pressed.add(`Digit${digit}`),
  }
  const ui = {
    render: vi.fn(),
    showFeedback: vi.fn(),
  }
  const controller = new ArmyCommandController(npcs, 'viking', input as any, ui as any)
  return { controller, input, ui }
}

describe('Army command keyboard mapping and filtering', () => {
  it('labels the submenu with the selected unit group', () => {
    expect(armyCommandTargetLabel('viking_spearman')).toBe('槍兵')
    expect(armyCommandTargetLabel('viking_archer')).toBe('弓兵')
    expect(armyCommandTargetLabel('viking_berserker')).toBe('維京資深戰士')
    expect(armyCommandTargetLabel('all')).toBe('全軍命令')
  })

  it('maps Viking and Roman shortcuts to preset ids and ALL', () => {
    expect(getArmyCommandShortcuts('viking').map(entry => entry.target)).toEqual([
      'viking_berserker', 'viking_spearman', 'viking_archer',
      'viking_sword_cavalry', 'viking_lancer', 'viking_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcuts('roman').map(entry => entry.target)).toEqual([
      'roman_heavy_infantry', 'roman_spearman', 'roman_archer', 'roman_javelin_infantry',
      'roman_sword_cavalry', 'roman_lancer', 'roman_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcut('viking', '7')).toBe('all')
    expect(getArmyCommandShortcut('roman', '8')).toBe('all')
  })

  it('uses edge-triggered submenu flow, filters to PLAYER faction, and leaves enemies alone', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const otherAlly = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy, otherAlly])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)
    h.controller.update() // Holding the key does not reselect or issue a command.
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()

    h.input.press('2')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('defend')
    expect(otherAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('ALL commands every player-faction NPC and formation is a placeholder', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy])

    h.input.press('7')
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('列陣功能尚未開放')

    h.input.press('7')
    h.controller.update()
    h.input.press('3')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('consumes invalid submenu digits so they cannot select a group after exit', () => {
    const h = controllerHarness([])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.press('6')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.press('5')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('updates desired state but never dispatches a command to dead NPCs', () => {
    const deadAlly = { faction: Faction.PLAYER, presetId: 'viking_spearman', dead: true, setTacticalOrder: vi.fn() }
    const h = controllerHarness([deadAlly])
    h.input.press('2')
    h.controller.update()
    h.input.press('3')
    h.controller.update()
    expect(deadAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('槍兵 → 衝鋒')
  })
})

function createNpc(
  scene: THREE.Scene,
  faction: Faction,
  characterFaction: 'viking' | 'roman',
  presetId: any,
  loadout: any,
  z: number,
  cavalry = false,
) {
  return new NPC(scene, 0, z, faction, characterFaction, AIType.MELEE, String(presetId), 2, cavalry, loadout, presetId)
}

describe('NPC TacticalOrder and active equipment stance', () => {
  it('defaults to Attack and performs Viking Veteran Charge -> Attack -> Defend transitions', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    expect(npc.tacticalOrder).toBe('attack')
    expect(npc.activeCombatKind).toBe('sword')
    expect(npc.shieldId).toBe('round_shield_t2')

    npc.setTacticalOrder('charge')
    expect(npc.shieldId).toBeNull()
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('attack')
    expect(npc.shieldId).toBeNull()
    npc.setTacticalOrder('defend')
    expect(npc.shieldId).toBe('round_shield_t2')
  })

  it('switches Spearman Lance ↔ same-tier Sword with live range, damage, and lance state', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_spearman', {
      meleeWeaponId: 'steel_lance', secondaryMeleeWeaponId: 'steel_sword', shieldId: null, mountId: null,
    }, 0)
    expect(npc.meleeWeaponId).toBe('steel_lance')
    expect(npc.isUsingLance).toBe(true)
    expect(npc.meleeAttackRadius).toBe(3.9)

    npc.setTacticalOrder('charge')
    expect(npc.meleeWeaponId).toBe('steel_sword')
    expect(npc.isUsingLance).toBe(false)
    expect(npc.activeCombatKind).toBe('sword')
    expect(npc.meleeAttackRadius).toBe(1.8)
    expect(npc.meleeDamage).toBe(25)

    npc.setTacticalOrder('defend')
    expect(npc.meleeWeaponId).toBe('steel_lance')
    expect(npc.isUsingLance).toBe(true)
    expect(npc.meleeAttackRadius).toBe(3.9)
  })

  it('switches Viking Archer to sticky melee Charge stance without changing ammo', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_archer', {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 0)
    const arrows = (npc as any).arrows
    expect(npc.activeCombatKind).toBe('bow')
    npc.setTacticalOrder('charge')
    expect((npc as any).arrows).toBe(arrows)
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('attack')
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('defend')
    expect(npc.activeCombatKind).toBe('bow')
    expect((npc as any).arrows).toBe(arrows)
  })

  it('moves a ranged Viking Archer from ATTACK to CHASE immediately on Charge', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const archer = createNpc(scene, Faction.PLAYER, 'viking', 'viking_archer', {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ;(archer as any).state = AIState.ATTACK
    archer.setTacticalOrder('charge')
    expect(archer.currentState).toBe(AIState.CHASE)
    const before = archer.position.z
    archer.update(0.1, player, [archer, enemy], [], [], null as any, () => {}, () => {})
    expect(archer.position.z).toBeGreaterThan(before)
    expect(archer.sprinting).toBe(true)
  })

  it('does not apply Viking foot stance to Roman or Viking cavalry', () => {
    const roman = createNpc(new THREE.Scene(), Faction.PLAYER, 'roman', 'roman_spearman', {
      meleeWeaponId: 'steel_lance', shieldId: null, mountId: null,
    }, 0)
    roman.setTacticalOrder('charge')
    expect(roman.meleeWeaponId).toBe('steel_lance')

    const cavalry = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_lancer', {
      meleeWeaponId: 'steel_lance', shieldId: null, mountId: 'horse',
    }, 0, true)
    cavalry.setTacticalOrder('charge')
    expect(cavalry.meleeWeaponId).toBe('steel_lance')
  })
})

describe('NPC defend and charge movement policy', () => {
  it('Defend holds position outside weapon range', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 20)
    ally.setTacticalOrder('defend')
    const start = ally.position.clone()
    for (let i = 0; i < 20; i++) ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.position.distanceTo(start)).toBeLessThan(0.001)
    expect(ally.currentState).not.toBe(AIState.CHASE)
  })

  it('Charge sprints while stamina is available, then keeps normal chase and regenerates', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    const before = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(true)
    expect(ally.position.z).toBeGreaterThan(before + 4.8 * SPRINT_MULTIPLIER * 0.1 * 1.2)
    expect(ally.staminaValue).toBeCloseTo(100 - STAMINA_DRAIN * 0.1, 5)

    ;(ally as any).stamina = 0
    const exhaustedBefore = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(exhaustedBefore)
    expect(ally.staminaValue).toBeGreaterThan(0)
  })

  it('keeps an active Charge sprint latched below threshold until stamina reaches zero', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    ;(ally as any).stamina = 11
    for (let i = 0; i < 4; i++) {
      ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
      expect(ally.sprinting).toBe(true)
    }
    expect(ally.staminaValue).toBe(0)
    const beforeNormalChase = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(beforeNormalChase)
  })
})
