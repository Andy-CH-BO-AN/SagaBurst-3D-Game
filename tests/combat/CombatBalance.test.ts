import { describe, expect, it } from 'vitest'
import { calculateLanceChargeDamage, getAntiCavalryMultiplier, getBerserkerModifiers, getNpcRangedAttackRange } from '../../src/combat/CombatBalance'
import { applyHeroIncomingDamage, applyHeroMeleeDamage, applyHeroOutgoingDamage, getHeroCombatModifiers, heroMeleeAttackSpeed, HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../../src/battle/HeroCombatProfile'
import { resolveSkillAdjustedMaxHp } from '../../src/rpg/CombatSkillProgression'
import { resolveCareerCombatProfile, resolveCareerPlayerMaxHp } from '../../src/career/CareerPlayerProfile'
import { calculatePlayerMeleeDamage } from '../../src/combat/PlayerMeleeDamage'
import { NPC } from '../../src/world/NPC'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { punchEventsBetween, punchExtension, unarmedDamage } from '../../src/combat/UnarmedCombat'


describe('Combat damage eligibility', () => {
  it('拳擊跨越多個接觸點時每拳只發出一次，左右拳動作與事件同步', () => {
    const first = punchEventsBetween(0, 1, false)
    expect(first.map(event => event.hand)).toEqual(['right', 'left', 'right'])
    const last = punchEventsBetween(1, 2, false)
    expect(last.map(event => event.index)).toEqual([3])
    expect(punchEventsBetween(.18, .18, false)).toEqual([])
    for (const event of [...first, ...last]) expect(punchExtension(event.time, event.hand, false)).toBeCloseTo(1)
  })
  it('持盾拳擊僅動右拳，徒手傷害沿用技能與角色倍率', () => {
    const events = punchEventsBetween(0, 2, true)
    expect(events.map(event => event.hand)).toEqual(['right', 'right', 'right', 'right'])
    for (const event of events) expect(punchExtension(event.time, 'left', true)).toBe(0)
    expect(unarmedDamage(1)).toBe(5)
    expect(unarmedDamage(2, 'byzantine-cataphract-t5')).toBe(30)
  })
  it('拜占庭軍旗槍以既有衝鋒門檻計算九百四十五傷害，普通指揮官不變', () => {
    const weapon = WEAPONS.byzantine_standard_lance_t5
    const input = { baseDamage: weapon.damageMax, combatKind: weapon.combatKind, isLance: true,
      isMounted: true, mountSpeed: 12, oneHandedMultiplier: 1, faction: 'roman' as const, hasShield: true }
    expect(calculatePlayerMeleeDamage({ ...input, heroAssetId: 'byzantine-cataphract-t5' })).toEqual({ damage: 945, isCharge: true })
    expect(applyHeroIncomingDamage(100, 'byzantine-cataphract')).toBe(40)
    expect(getHeroCombatModifiers('roman-commander')!.maxHp).toBe(850)
    expect(getHeroCombatModifiers('viking-commander')!.maxHp).toBe(900)
  })
  it('百夫長是獨立的 Career T4 職業數值；聖騎士、維京 T4、遊俠與 T5 原值不變', () => {
    expect(HERO_COMBAT_PROFILES.centurion).toEqual({ maxHp: 700, damageMultiplier: 2.2, damageTakenMultiplier: .6, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 })
    expect(HERO_COMBAT_PROFILES.praetorian).toEqual({ maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: .7, attackSpeedMultiplier: 1, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 })
    expect([HERO_COMBAT_PROFILES.varangian.maxHp, HERO_COMBAT_PROFILES.ranger.maxHp, HERO_COMBAT_PROFILES['roman-commander'].maxHp, HERO_COMBAT_PROFILES['byzantine-cataphract'].maxHp]).toEqual([500, 300, 850, 1000])
    expect([HERO_COMBAT_PROFILE_BY_ASSET['roman-centurion-t4'], HERO_COMBAT_PROFILE_BY_ASSET['roman-hero-t4']]).toEqual(['centurion', 'praetorian'])
    const captain = { faction: 'roman' as const, rank: 'captain' as const, eliteClass: null, skills: undefined }
    expect(resolveCareerCombatProfile({ ...captain, t4Specialization: 'centurion' })).toBe('centurion')
    // Skill progression is applied by its existing owner on top of the profile base.
    expect(resolveCareerPlayerMaxHp({ ...captain, t4Specialization: 'centurion' })).toBe(resolveSkillAdjustedMaxHp(700, undefined))
    expect(resolveCareerPlayerMaxHp(captain)).toBe(resolveSkillAdjustedMaxHp(500, undefined))
    expect(applyHeroMeleeDamage(100, 'centurion')).toBeCloseTo(220); expect(applyHeroIncomingDamage(100, 'centurion')).toBeCloseTo(60)
    expect(heroMeleeAttackSpeed('centurion')).toBe(1)
  })
  it('維京重甲 T4／T5：更耐打、單擊更重、攻速略低但近戰 DPS 略高、移動（含騎乘乘數）較慢；普通版原值不變', () => {
    expect(HERO_COMBAT_PROFILES['dragon-oathguard']).toEqual({ maxHp: 550, damageMultiplier: 2.3, damageTakenMultiplier: .85, attackSpeedMultiplier: 1.4, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 })
    expect(HERO_COMBAT_PROFILES['ironblood-warlord']).toEqual({ maxHp: 1000, damageMultiplier: 2.4, meleeDamageMultiplier: 2.9, damageTakenMultiplier: .7, attackSpeedMultiplier: 1.45, meleeAttackSpeedMultiplier: 1.6, moveSpeedMultiplier: 1, rangedAttackRangeMultiplier: 1 })
    expect(HERO_COMBAT_PROFILES.varangian).toEqual({ maxHp: 500, damageMultiplier: 2, damageTakenMultiplier: 1, attackSpeedMultiplier: 1.5, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 })
    expect(HERO_COMBAT_PROFILES['viking-commander']).toEqual({ maxHp: 900, damageMultiplier: 2.2, meleeDamageMultiplier: 2.6, damageTakenMultiplier: .8, attackSpeedMultiplier: 1.55, meleeAttackSpeedMultiplier: 1.7, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 })
    for (const [heavy, normal] of [['dragon-oathguard', 'varangian'], ['ironblood-warlord', 'viking-commander']] as const) {
      const dps = (id: typeof heavy | typeof normal) => applyHeroMeleeDamage(1, id) * heroMeleeAttackSpeed(id)
      expect(applyHeroMeleeDamage(100, heavy)).toBeGreaterThan(applyHeroMeleeDamage(100, normal))
      expect(heroMeleeAttackSpeed(heavy)).toBeLessThan(heroMeleeAttackSpeed(normal))
      expect(dps(heavy)).toBeGreaterThan(dps(normal)); expect(dps(heavy)).toBeLessThan(dps(normal) * 1.1)
      expect(applyHeroIncomingDamage(100, heavy)).toBeLessThan(applyHeroIncomingDamage(100, normal))
      // Player/NPC multiply this into both foot and mounted speed; the heavy class is slower in both.
      expect(getHeroCombatModifiers(heavy)!.moveSpeedMultiplier).toBeLessThan(getHeroCombatModifiers(normal)!.moveSpeedMultiplier)
    }
    const viking = { faction: 'viking' as const, eliteClass: null, skills: undefined }
    expect(resolveCareerCombatProfile({ ...viking, rank: 'captain', t4Specialization: 'dragon-oathguard' })).toBe('dragon-oathguard')
    expect(resolveCareerCombatProfile({ ...viking, rank: 'captain' })).toBe('varangian')
    expect(resolveCareerCombatProfile({ ...viking, rank: 'commander', eliteClass: 'ironblood-warlord', t4Specialization: 'dragon-oathguard' })).toBe('ironblood-warlord')
    expect(resolveCareerPlayerMaxHp({ ...viking, rank: 'commander', eliteClass: 'ironblood-warlord' })).toBe(resolveSkillAdjustedMaxHp(1000, undefined))
    const axe = { baseDamage: 80, combatKind: WEAPONS.axe_t5.combatKind, isLance: false, isMounted: false, mountSpeed: 0, oneHandedMultiplier: 1, faction: 'viking' as const, hasShield: true }
    expect(calculatePlayerMeleeDamage({ ...axe, heroAssetId: 'viking-heavy-hero-t5' }).damage).toBe(232)
  })
  it('doubles ground bow engagement only, retaining ranger and javelin rules', () => {
    expect(getNpcRangedAttackRange('bow', false)).toBe(100)
    expect(getNpcRangedAttackRange('bow', true)).toBe(60)
    const rangerRange = getHeroCombatModifiers('ranger')!.rangedAttackRangeMultiplier
    expect(getNpcRangedAttackRange('bow', false) * rangerRange).toBe(200)
    expect(getNpcRangedAttackRange('bow', true) * rangerRange).toBe(120)
    expect(getNpcRangedAttackRange('javelin', false)).toBe(30)
    expect(getNpcRangedAttackRange('javelin', true)).toBe(15)
  })

  it('uses Viking Commander melee overrides once on Player and NPC while retaining ranged and unshielded eligibility', () => {
    const input = { baseDamage: WEAPONS.axe_t5.damageMax, combatKind: WEAPONS.axe_t5.combatKind,
      isLance: false, isMounted: false, mountSpeed: 0, oneHandedMultiplier: 1,
      faction: 'viking' as const, hasShield: true, heroAssetId: 'viking-hero-t5' as const }
    // Call the real scalar damage method without constructing an actor or model.
    const npcDamage = (NPC.prototype as unknown as { _calcLanceDamage(damage: number, mounted: boolean): number })._calcLanceDamage
    const npc = { meleeCombatKind: 'sword', hasActiveShield: true, characterFaction: 'viking',
      isMounted: false, pendingLanceChargeSpeed: 0, combatProfileId: 'viking-commander' }
    expect(calculatePlayerMeleeDamage(input).damage).toBe(208)
    expect(npcDamage.call(npc, 80, false)).toBe(208)
    expect(heroMeleeAttackSpeed('viking-commander')).toBe(1.7)
    expect(getHeroCombatModifiers('viking-commander')).toMatchObject({ maxHp: 900, attackSpeedMultiplier: 1.55, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 })
    expect(applyHeroOutgoingDamage(80, 'viking-commander')).toBe(176)
    expect(applyHeroIncomingDamage(100, 'viking-commander')).toBe(80)
    input.hasShield = npc.hasActiveShield = false
    expect(calculatePlayerMeleeDamage(input).damage).toBeCloseTo(249.6)
    expect(npcDamage.call(npc, 80, false)).toBeCloseTo(249.6)
    const berserker = getBerserkerModifiers('viking', false, 'sword', false)
    expect(heroMeleeAttackSpeed('viking-commander') * berserker.meleeAttackRateMultiplier).toBe(2.04)
    for (const [id, damage, speed] of [[null, 80, 1], ['varangian', 160, 1.5], ['praetorian', 160, 1], ['ranger', 104, 1], ['roman-commander', 176, 1.15]] as const) {
      expect(applyHeroMeleeDamage(80, id)).toBe(damage)
      expect(heroMeleeAttackSpeed(id)).toBe(speed)
    }
  })
  it('uses its required anti-cavalry multipliers', () => {
    const cases = [
      ['lance', false, true, 2],
      ['lance', true, true, 1],
      ['lance', false, false, 1],
    ] as const
    for (const [kind, mounted, targetMounted, expected] of cases) {
      expect(getAntiCavalryMultiplier(kind, mounted, targetMounted)).toBe(expected)
    }
  })

  it('toggles berserker damage and movement modifiers based on shield presence for foot swordsmen', () => {
    expect(getBerserkerModifiers('viking', false, 'sword', false)).toMatchObject({
      active: true, moveSpeedMultiplier: 1.3, meleeDamageMultiplier: 1.2, meleeAttackRateMultiplier: 1.2,
    })
    expect(getBerserkerModifiers('viking', false, 'sword', true)).toMatchObject({
      active: false, moveSpeedMultiplier: 1, meleeDamageMultiplier: 1, meleeAttackRateMultiplier: 1,
    })
  })

  it('calculates mounted lance charge damage at the 10 m/s threshold', () => {
    expect(calculateLanceChargeDamage(45, 'lance', true, 10)).toMatchObject({
      isCharge: false, skipImpact: false, damage: 45,
    })
    expect(calculateLanceChargeDamage(45, 'lance', true, 10.01)).toMatchObject({
      isCharge: true, skipImpact: true, damage: 135,
    })
  })
})
