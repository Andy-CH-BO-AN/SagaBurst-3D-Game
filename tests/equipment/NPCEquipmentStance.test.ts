import { createTacticalNpc, type TacticalNpcArgs } from '../helpers/tacticalNpc'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { Faction } from '../../src/world/NPC'

function createNpc(...args: TacticalNpcArgs) {
  return createTacticalNpc(npc => onTestFinished(() => npc.dispose()), ...args)
}

describe('NPC tactical equipment stance', () => {
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
