import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import type { UnitLoadout } from '../../src/battle/UnitPresetCatalog'

// Permanent equipment owns native actor behavior; asset parsing has independent owners.
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))

function actor(profile?: 'roman-commander'): NPC {
  const npc = new NPC(new THREE.Scene(), 0, 0, Faction.TOWN, 'viking', AIType.MELEE, 'equipped soldier', profile ? 4 : 2,
    false, { meleeWeaponId: 'steel_lance', secondaryMeleeWeaponId: 'steel_sword', shieldId: null, mountId: null },
    'viking_spearman', 1, 'gate:north:0', undefined, undefined, profile)
  onTestFinished(() => npc.dispose())
  return npc
}

describe('NPC permanent Career equipment', () => {
  it('preflights valid, incompatible, temporary and falling equipment without changing the actor or input', () => {
    const npc = actor()
    npc.takeDamage(9)
    const canonical = npc.loadout, hp = npc.hp, action = npc.combatAnimationAction
    const selected: UnitLoadout = { meleeWeaponId: 'paladin_sword_t4', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: 'horse' }
    const input = { ...selected }
    expect(npc.canApplyCareerEquipment(selected)).toBe(true)
    expect(npc.canApplyCareerEquipment({ ...selected, shieldId: 'scutum_t2' })).toBe(false)
    expect(selected).toEqual(input)
    expect(npc.loadout).toBe(canonical)
    expect(npc.meleeWeaponId).toBe('steel_lance')
    expect(npc.aiType).toBe(AIType.MELEE)
    expect(npc.mount).toBeNull()
    expect(npc.combatAmmo).toBe(0)
    expect(npc.hp).toBe(hp)
    expect(npc.combatAnimationAction).toBe(action)
    npc.applyTemporaryCombatLoadout({ meleeWeaponId: 'rusty_dagger', shieldId: null })
    expect(npc.canApplyCareerEquipment(selected)).toBe(false)
    expect(npc.meleeWeaponId).toBe('rusty_dagger')
    npc.restoreCombatLoadout()
    npc.pendingFall.begin(npc.position.clone(), new THREE.Vector3(0, -1, 0))
    const fall = npc.fallSnapshot
    expect(npc.canApplyCareerEquipment(selected)).toBe(false)
    expect(npc.fallSnapshot).toEqual(fall)
    expect(npc.loadout).toBe(canonical)
  })

  it('keeps a transferred native slot empty through commands, refit and Town restoration instead of granting its preset again', () => {
    const npc = actor(), body = npc.characterVisualGroup
    const saved: UnitLoadout = { meleeWeaponId: 'paladin_sword_t4', secondaryMeleeWeaponId: null, shieldId: 'paladin_shield_t4', mountId: null }
    npc.takeDamage(17)
    const hp = npc.hp
    expect(npc.applyCareerEquipment(saved, 4)).toBe(true)
    saved.meleeWeaponId = 'steel_lance'
    expect(npc.loadout?.meleeWeaponId).toBe('paladin_sword_t4')
    expect(npc.meleeDamage).toBe(60)
    expect(npc.hp).toBe(hp)
    expect(npc.maxHp).toBe(200)
    expect(npc.combatProfileId).toBeUndefined()
    expect(npc.characterVisualGroup).toBe(body)
    npc.setTacticalOrder('charge'); npc.setTacticalOrder('defend')
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(npc.shieldId).toBe('paladin_shield_t4')
    npc.applyTemporaryCombatLoadout({ meleeWeaponId: 'hunting_spear', shieldId: null })
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'viking_axe_t3' })).toBe(false)
    npc.restoreCombatLoadout()
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    npc.takeDamage(1000); npc.restoreForTown()
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(npc.loadout?.secondaryMeleeWeaponId).toBeNull()
    npc.refitCombat()
    expect(npc.shieldId).toBe('paladin_shield_t4')
  })

  it('does not lower the T5 profile, HP or character instance when changing its weapon', () => {
    const npc = actor('roman-commander'), body = npc.characterVisualGroup
    npc.takeDamage(100)
    const hp = npc.hp
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'rusty_dagger', shieldId: null }, 1)).toBe(true)
    expect(npc.hp).toBe(hp)
    expect(npc.maxHp).toBe(850)
    expect(npc.tier).toBe(4)
    expect(npc.combatProfileId).toBe('roman-commander')
    expect(npc.characterVisualGroup).toBe(body)
  })

  it('initializes a first bow, then preserves ammunition across bow changes and temporary removal while updating native ranged AI', () => {
    const npc = actor()
    npc.takeDamage(12)
    const hp = npc.hp
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null })).toBe(true)
    expect(npc.aiType).toBe(AIType.RANGED)
    expect(npc.combatAmmo).toBe(30)
    npc.restoreCombatAmmo(7)
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'elven_runebow', shieldId: null })).toBe(true)
    expect(npc.combatAmmo).toBe(7)
    expect(npc.rangedDamage).toBe(52.5)
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: null })).toBe(true)
    expect(npc.aiType).toBe(AIType.MELEE)
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null })).toBe(true)
    expect(npc.combatAmmo).toBe(7)
    expect(npc.hp).toBe(hp)
  })

  it('lets a configured civilian fire its bow through native combat without inventing unarmed damage at close range', () => {
    // Two real NPCs, one Player, no Mount/TownWorld/GLB: ranged AI must emit a real projectile event.
    const scene = new THREE.Scene(), player = new Player(scene)
    onTestFinished(() => player.dispose())
    player.group.position.set(200, 0, 200)
    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'civilian', 2, false,
      { meleeWeaponId: null, rangedWeaponId: null, shieldId: null }, undefined, 'civilians', 'civilian-0',
      undefined, undefined, undefined, undefined, 'civilian')
    onTestFinished(() => npc.dispose())
    const target = new NPC(scene, 0, 12, Faction.ENEMY, 'roman', AIType.MELEE, 'enemy', 2, false,
      { meleeWeaponId: 'steel_sword', shieldId: null }, 'roman_heavy_infantry')
    onTestFinished(() => target.dispose())
    expect(npc.applyCareerEquipment({ meleeWeaponId: null, rangedWeaponId: 'recurve_longbow', shieldId: null })).toBe(true)
    npc.armTownCivilian('gladius_rusty'); npc.setMissionCombatTarget(target); npc.setTacticalOrder('defend')
    const arrows = vi.fn(), hits = vi.fn()
    const step = () => npc.update(.05, player, [npc, target], [target], [], { setFill: () => {} }, hits, arrows, true)
    let frames = 0
    while (!arrows.mock.calls.length && frames++ < 100) step()
    expect(arrows).toHaveBeenCalled()
    expect(npc.combatAmmo).toBe(29)
    expect(npc.meleeWeaponId).toBeNull()
    target.group.position.copy(npc.group.position).z += 1
    for (let frame = 0; frame < 80; frame++) step()
    expect(hits).not.toHaveBeenCalled()
    npc.disarmTownCivilian(); npc.armTownCivilian('gladius_rusty')
    expect(npc.loadout?.rangedWeaponId).toBe('recurve_longbow')
    expect(npc.meleeWeaponId).toBeNull()
    expect(npc.hp).toBe(50)
  })

  it('keeps worn shield durability and rejects incompatible fields before touching canonical or active equipment', () => {
    const npc = actor()
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', shieldId: 'scutum_t2' })).toBe(true)
    npc.shield.shieldImpactRemaining = 3
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'viking_axe_t3', shieldId: 'scutum_t2' })).toBe(true)
    expect(npc.shield.shieldImpactRemaining).toBe(3)
    const canonical = npc.loadout
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: 'scutum_t2' })).toBe(false)
    expect(npc.loadout).toBe(canonical)
    expect(npc.meleeWeaponId).toBe('viking_axe_t3')
    expect(npc.shield.shieldImpactRemaining).toBe(3)
    npc.takeDamage(1000)
    expect(npc.canApplyCareerEquipment({ meleeWeaponId: 'steel_sword' })).toBe(false)
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword' })).toBe(false)
    expect(npc.loadout).toBe(canonical)
  })
})
