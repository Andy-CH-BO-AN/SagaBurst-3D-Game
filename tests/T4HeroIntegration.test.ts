import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  calculateArmyTotal,
  createEmptyBattleConfig,
  MAX_CUSTOM_T4_PER_SIDE,
  validateBattleConfig,
} from '../src/battle/BattleConfig'
import { BattleSpawner } from '../src/battle/BattleSpawner'
import { T4_COMBAT_PROFILES, T4_UNIT_PROFILES, applyHeroIncomingDamage, applyHeroOutgoingDamage } from '../src/battle/T4HeroCatalog'
import { CUSTOM_BATTLE_UNIT_TIERS, BASE_UNIT_TIERS, ROMAN_PRESET_IDS, VIKING_PRESET_IDS, UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { createDefaultDefensePlayerLoadout, createDefenseCampaignWaveConfig, validateDefenseCampaignLaunchConfig } from '../src/campaign/DefenseCampaignLaunch'
import { resolveMakiEquipmentMode } from '../src/world/MakiRangerEquipment'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { CharacterCombatAnimator } from '../src/world/CharacterCombatAnimator'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { getRangedDamageMultiplier } from '../src/combat/CombatBalance'

function battle() {
  const config = createEmptyBattleConfig()
  config.viking.viking_berserker![1] = 1
  config.roman.roman_heavy_infantry![1] = 1
  return config
}

describe('T4 Hero Custom Battle domain', () => {
  it('keeps Campaign tiers separate and counts T4 toward the army total', () => {
    expect(BASE_UNIT_TIERS).toEqual([1, 2, 3])
    expect(CUSTOM_BATTLE_UNIT_TIERS).toEqual([1, 2, 3, 4])
    const config = battle()
    config.viking.viking_archer![4] = 3
    expect(calculateArmyTotal(config.viking)).toBe(4)
    expect(validateBattleConfig(config).valid).toBe(true)
  })

  it('enforces the per-side total independently of player Hero and 200-unit cap', () => {
    const config = battle()
    config.playerHeroId = 'maki-archer-t4'
    config.viking.viking_berserker![4] = 1
    config.viking.viking_spearman![4] = 1
    config.viking.viking_archer![4] = 1
    config.roman.roman_archer![4] = MAX_CUSTOM_T4_PER_SIDE
    expect(validateBattleConfig(config).valid).toBe(true)
    config.viking.viking_lancer![4] = 1
    expect(validateBattleConfig(config).valid).toBe(false)
    config.viking.viking_lancer![4] = 0
    config.roman.roman_lancer![4] = 1
    expect(validateBattleConfig(config).valid).toBe(false)
    config.roman.roman_lancer![4] = 0
    config.viking.viking_berserker![1] = 197
    expect(validateBattleConfig(config).valid).toBe(true)
    config.viking.viking_berserker![1] = 198
    expect(validateBattleConfig(config).valid).toBe(false)
  })

  it('rejects forged Hero ids and malformed T4 counts', () => {
    const config = battle()
    expect(validateBattleConfig({ ...config, playerHeroId: 'unknown' }).valid).toBe(false)
    config.viking.viking_archer![4] = Number.NaN
    expect(validateBattleConfig(config).valid).toBe(false)
  })

  it('maps every preset to the expected Hero and mount without changing allegiance or T3 loadout', () => {
    const expected = {
      viking_berserker: ['viking-hero-t4', null],
      viking_spearman: ['viking-hero-t4', null],
      viking_archer: ['maki-archer-t4', null],
      viking_sword_cavalry: ['viking-hero-t4', 'black-cat'],
      viking_lancer: ['viking-hero-t4', 'black-cat'],
      viking_horse_archer: ['viking-hero-t4', 'black-cat'],
      roman_heavy_infantry: ['roman-hero-t4', null],
      roman_spearman: ['roman-hero-t4', null],
      roman_archer: ['maki-archer-t4', null],
      roman_javelin_infantry: ['roman-hero-t4', null],
      roman_sword_cavalry: ['roman-hero-t4', 'corgi'],
      roman_lancer: ['roman-hero-t4', 'corgi'],
      roman_horse_archer: ['roman-hero-t4', 'corgi'],
    } as const
    const config = battle()
    for (const presetId of [...VIKING_PRESET_IDS, ...ROMAN_PRESET_IDS]) {
      const faction = presetId.startsWith('viking') ? 'viking' : 'roman'
      config[faction][presetId as keyof typeof config[typeof faction]]![4] = 1
      const profile = T4_UNIT_PROFILES[presetId]
      expect([profile.visualAssetId, profile.mountOverride]).toEqual(expected[presetId])
      const spec = BattleSpawner.createSpawnPlan(config).npcSpecs.find(unit => unit.presetId === presetId && unit.tier === 4)!
      expect(spec.characterFaction).toBe(faction)
      expect(spec.visualAssetId).toBe(profile.visualAssetId)
      expect(spec.combatProfileId).toBe(profile.combatProfileId)
      expect(spec.loadout).toMatchObject({ mountId: profile.mountOverride })
      expect(spec.cavalry).toBe(Boolean(UNIT_PRESETS[presetId].tierLoadouts[3].mountId))
      config[faction][presetId as keyof typeof config[typeof faction]]![4] = 0
    }
    const ordinary = BattleSpawner.createSpawnPlan(config).npcSpecs
    expect(ordinary.every(unit => unit.tier < 4 && unit.visualAssetId === undefined)).toBe(true)
  })

  it('applies each Hero modifier once and leaves ordinary damage untouched', () => {
    expect(T4_COMBAT_PROFILES.praetorian.maxHp).toBe(500)
    expect(applyHeroIncomingDamage(100, 'praetorian')).toBe(70)
    expect(applyHeroOutgoingDamage(100, 'praetorian')).toBe(200)
    expect(T4_COMBAT_PROFILES.praetorian.attackSpeedMultiplier).toBe(1)
    expect(T4_COMBAT_PROFILES.praetorian.moveSpeedMultiplier).toBe(1)
    expect(T4_COMBAT_PROFILES.varangian.maxHp).toBe(500)
    expect(T4_COMBAT_PROFILES.varangian.attackSpeedMultiplier).toBe(1.5)
    expect(T4_COMBAT_PROFILES.varangian.moveSpeedMultiplier).toBe(1.2)
    expect(applyHeroOutgoingDamage(100, 'varangian')).toBe(200)
    expect(applyHeroIncomingDamage(100, 'varangian')).toBe(100)
    expect(T4_COMBAT_PROFILES.ranger.maxHp).toBe(300)
    expect(applyHeroOutgoingDamage(100, 'ranger')).toBe(130)
    expect(T4_COMBAT_PROFILES.ranger.moveSpeedMultiplier).toBe(1.3)
    expect(T4_COMBAT_PROFILES.ranger.rangedAttackRangeMultiplier).toBe(2)
    expect(T4_COMBAT_PROFILES.ranger.attackSpeedMultiplier).toBe(1)
    expect(applyHeroOutgoingDamage(29.4)).toBe(29.4)
    expect(applyHeroIncomingDamage(100)).toBe(100)
    expect(resolveMakiEquipmentMode(1)).toBe('ranged')
    expect(resolveMakiEquipmentMode(0)).toBe('ammo-exhausted')
  })

  it('initializes NPC Hero HP and applies incoming reduction only once', () => {
    const scene = new THREE.Scene()
    const praetorian = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Praetorian', 4, false,
      { meleeWeaponId: 'centurion_blade', rangedWeaponId: null, shieldId: null, mountId: null },
      'roman_heavy_infantry', undefined, undefined, undefined, 'roman-hero-t4', 'praetorian')
    expect(praetorian.maxHp).toBe(500)
    praetorian.takeDamage(100)
    expect(praetorian.hp).toBe(430)
    praetorian.respawn()
    expect(praetorian.hp).toBe(500)
    const ordinary = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Ordinary', 3, false,
      { meleeWeaponId: 'centurion_blade', rangedWeaponId: null, shieldId: null, mountId: null })
    ordinary.takeDamage(100)
    expect(ordinary.hp).toBe(ordinary.maxHp - 100)
  })

  it('uses T3 bow projectile speed and multiplies Varangian ranged damage once', () => {
    const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, 'viking', AIType.RANGED, 'Varangian Archer', 4, true,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: 'black-cat' },
      'viking_horse_archer', undefined, undefined, undefined, 'viking-hero-t4', 'varangian')
    expect(npc.maxHp).toBe(500)
    expect(npc.rangedDamage).toBe(WEAPONS.elven_runebow.damageMax * getRangedDamageMultiplier('bow') * 2)
    expect(npc.rangedProjectileSpeed).toBe(WEAPONS.elven_runebow.arrowSpeedMax)
  })

  it('speeds action clips without advancing the whole animator clock', () => {
    const animation = { has: vi.fn(() => true), play: vi.fn(), update: vi.fn(), setEquipmentState: vi.fn() }
    const rig = { animation } as any
    const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    expect(animator.start('axeAttack2H', 1.5)).toBe(true)
    animator.update(0.1)
    expect(animation.play).toHaveBeenCalledWith('axeAttack2H', expect.objectContaining({ timeScale: 1.5 }))
    expect(animation.update).toHaveBeenCalledWith(0.1, 0)
    animator.cancel()
    animator.update(0.1)
    expect(animation.update).toHaveBeenLastCalledWith(0.1, 0)
  })

  it('keeps the Campaign player Hero separate from defender and attacker NPC heroes', () => {
    const launch = {
      type: 'defense' as const,
      defenderFaction: 'roman' as const,
      stageId: 1 as const,
      defenderArmy: { roman_heavy_infantry: { 1: 1, 2: 0, 3: 0 } },
      playerLoadout: createDefaultDefensePlayerLoadout('roman'),
      playerHeroId: 'viking-hero-t4' as const,
    }
    expect(validateDefenseCampaignLaunchConfig(launch).valid).toBe(true)
    expect(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders')).npcSpecs.filter(spec => spec.tier === 4)).toHaveLength(0)
    expect(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers')).npcSpecs.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs.filter(spec => spec.tier === 4)).toHaveLength(0)
    expect(validateDefenseCampaignLaunchConfig({ ...launch, defenderArmy: { roman_heavy_infantry: { 1: 1, 2: 0, 3: 0, 4: 1 } } }).valid).toBe(true)
    expect(validateDefenseCampaignLaunchConfig({ ...launch, playerHeroId: 'invalid' }).valid).toBe(false)
  })
})
