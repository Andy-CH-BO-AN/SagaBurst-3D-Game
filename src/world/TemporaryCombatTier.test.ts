import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { UNIT_PRESETS } from '../battle/UnitPresetCatalog'
import { AIType, Faction, NPC } from './NPC'
import { Player } from '../player/Player'

describe('NPC temporary combat tier', () => {
  it('lets a melee cavalry actor shoot a temporary T3 bow and restores its original weapons', () => {
    const scene = new THREE.Scene()
    const original = UNIT_PRESETS.roman_sword_cavalry.tierLoadouts[2]
    const bow = UNIT_PRESETS.roman_horse_archer.tierLoadouts[3]
    const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Town Cavalry', 2, true,
      { ...original }, 'roman_sword_cavalry', undefined, 'melee_cavalry-0')
    const initialPosition = npc.combatPosition.clone()
    npc.applyTemporaryCombatLoadout({ ...bow }, 3, 1)
    expect(npc.combatPosition).toEqual(initialPosition)
    expect(npc.rangedWeaponId).toBe(bow.rangedWeaponId)
    expect(npc.hasActiveRangedWeapon).toBe(true)
    const player = new Player(scene)
    player.group.position.set(0, npc.combatPosition.y, 25)
    let shots = 0
    for (let frame = 0; frame < 200; frame++) {
      npc.update(.05, player, [npc], [], [], null as any, () => {}, () => { shots++ }, true)
    }
    expect(shots).toBeGreaterThan(0)
    npc.restoreCombatLoadout()
    expect(npc.tier).toBe(2)
    expect(npc.squadId).toBeUndefined()
    expect(npc.meleeWeaponId).toBe(original.meleeWeaponId)
    expect(npc.rangedWeaponId ?? null).toBe(original.rangedWeaponId ?? null)
    expect(npc.hasActiveRangedWeapon).toBe(false)
    npc.dispose(); player.dispose()
  })

  it('walks a temporarily equipped actor to formation over multiple frames without teleporting', () => {
    const scene = new THREE.Scene()
    const preset = UNIT_PRESETS.roman_sword_cavalry
    const npc = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Captain', 4, false,
      { ...preset.tierLoadouts[3], mountId: null }, preset.id)
    const start = npc.combatPosition.clone()
    const target = start.clone().add(new THREE.Vector3(20, 0, 0))
    const player = new Player(scene)
    npc.applyTemporaryCombatLoadout({ ...UNIT_PRESETS.roman_lancer.tierLoadouts[3], mountId: null }, 4, 1)
    npc.assignFormationTarget(9000, target, new THREE.Vector3(1, 0, 0), 7.5)
    expect(npc.combatPosition).toEqual(start)
    let frames = 0
    for (; frames < 100 && !npc.isFormationTargetReached(9000); frames++) {
      const before = npc.combatPosition.clone()
      npc.update(.05, player, [], [], [], null as any, () => {}, () => {}, true)
      expect(Math.hypot(npc.combatPosition.x - before.x, npc.combatPosition.z - before.z)).toBeLessThan(1)
    }
    expect(frames).toBeGreaterThan(10)
    expect(npc.isFormationTargetReached(9000)).toBe(true)
    expect(npc.combatPosition.distanceTo(target)).toBeLessThan(2)
    npc.dispose(); player.dispose()
  })

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
