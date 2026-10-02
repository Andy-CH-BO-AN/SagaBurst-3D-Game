import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { UNIT_PRESETS } from '../battle/UnitPresetCatalog'
import { AIType, Faction, NPC } from './NPC'

describe('NPC temporary combat tier', () => {
  it('uses a temporary Veteran tier and restores the Town tier and loadout after death', () => {
    const scene = new THREE.Scene()
    const preset = UNIT_PRESETS.roman_sword_cavalry
    const npc = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Town Cavalry', 2, true,
      { ...preset.tierLoadouts[2] }, preset.id, undefined, 'melee_cavalry-0')
    expect(npc.tier).toBe(2)
    expect(npc.squadId).toBeUndefined()
    expect(npc.meleeWeaponId).toBe(preset.tierLoadouts[2].meleeWeaponId)

    npc.applyTemporaryCombatLoadout({ ...UNIT_PRESETS.roman_lancer.tierLoadouts[3] }, 3, 1)
    expect(npc.tier).toBe(3)
    expect(npc.squadId).toBe(1)
    expect(npc.meleeWeaponId).toBe(UNIT_PRESETS.roman_lancer.tierLoadouts[3].meleeWeaponId)
    npc.applyTemporaryCombatLoadout({ ...preset.tierLoadouts[3] })
    expect(npc.tier).toBe(3)
    expect(npc.meleeWeaponId).toBe(preset.tierLoadouts[3].meleeWeaponId)

    npc.restoreCombatHealth(37.5)
    expect(npc.hp).toBe(37.5)
    npc.takeDamage(100000)
    expect(npc.dead).toBe(true)
    npc.restoreCombatLoadout()
    expect(npc.dead).toBe(true)
    expect(npc.tier).toBe(2)
    expect(npc.squadId).toBeUndefined()
    expect(npc.meleeWeaponId).toBe(preset.tierLoadouts[2].meleeWeaponId)
    expect(npc.shieldId).toBe(preset.tierLoadouts[2].shieldId)
    npc.dispose()
  })
})
