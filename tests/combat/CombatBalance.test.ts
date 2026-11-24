import { careerRankFixture } from '../helpers/careerRankFixture'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { calculateLanceChargeDamage, getAntiCavalryMultiplier, getBerserkerModifiers, getNpcRangedAttackRange } from '../../src/combat/CombatBalance'
import { applyHeroIncomingDamage, applyHeroMeleeDamage, applyHeroOutgoingDamage, getHeroCombatModifiers, heroMeleeAttackSpeed, HERO_COMBAT_PROFILE_BY_ASSET, HERO_COMBAT_PROFILES } from '../../src/battle/HeroCombatProfile'
import { resolveSkillAdjustedMaxHp } from '../../src/rpg/CombatSkillProgression'
import { resolveCareerCombatProfile, resolveCareerPlayerMaxHp } from '../../src/career/CareerPlayerProfile'
import { calculateNpcMeleeDamage, calculatePlayerMeleeDamage } from '../../src/combat/PlayerMeleeDamage'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { drainFistStrikes, punchEventsBetween, punchExtension, traceFistStrike, unarmedDamage, type FistStrike } from '../../src/combat/UnarmedCombat'
import { ShieldCollider, ShieldState, type PhysicalCombatTarget } from '../../src/combat/ShieldBlocking'
import { parsePunchTiming } from '../../src/world/HumanoidAssetRegistry'
import { NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'


describe('Combat damage eligibility', () => {
  it('拳擊跨越多個接觸點時每拳只發出一次，左右拳動作與事件同步', () => {
    const first = punchEventsBetween(0, 1, false)
    expect(first.map(event => event.hand)).toEqual(['right', 'left', 'right'])
    const last = punchEventsBetween(1, 2, false)
    expect(last.map(event => event.index)).toEqual([3])
    expect(punchEventsBetween(.18, .18, false)).toEqual([])
    for (const event of [...first, ...last]) expect(punchExtension(event.time, event.hand, false)).toBeCloseTo(1)

    const base = { clip: 'punchCombo' as const, source: 'Meshy' as const, sourceClip: 'x', loop: false, duration: 1, punchHands: ['left', 'right'] as ('left' | 'right')[] }
    expect(() => parsePunchTiming({ ...base, events: { punch0: .5, punch1: .4 } })).toThrow()
    expect(() => parsePunchTiming({ ...base, events: { punch0: .2, punch1: 1.2 } })).toThrow()
    expect(parsePunchTiming({ ...base, punchHands: undefined })).toBeUndefined()
  })
  it('持盾拳擊僅動右拳，徒手傷害沿用技能與角色倍率', () => {
    const events = punchEventsBetween(0, 2, true)
    expect(events.map(event => event.hand)).toEqual(['right', 'right', 'right', 'right'])
    for (const event of events) expect(punchExtension(event.time, 'left', true)).toBe(0)
    expect(unarmedDamage(1)).toBe(5)
    expect(unarmedDamage(2, 'byzantine-cataphract-t5')).toBe(30)
  })
  it('百夫長是獨立的 Career T4 職業：依專精與資產路由，比禁衛軍更耐打、單擊更重且攻速不變', () => {
    expect([HERO_COMBAT_PROFILE_BY_ASSET['roman-centurion-t4'], HERO_COMBAT_PROFILE_BY_ASSET['roman-hero-t4']]).toEqual(['centurion', 'praetorian'])
    const captain = { faction: 'roman' as const, ...careerRankFixture('roman', 'captain'), skills: undefined }
    expect(resolveCareerCombatProfile({ ...captain, t4Specialization: 'centurion' })).toBe('centurion')
    expect(resolveCareerCombatProfile(captain)).toBe('praetorian')
    // Skill progression is applied by its existing owner on top of the routed profile base.
    const centurionHp = resolveCareerPlayerMaxHp({ ...captain, t4Specialization: 'centurion' })
    const praetorianHp = resolveCareerPlayerMaxHp(captain)
    expect(centurionHp).toBe(resolveSkillAdjustedMaxHp(HERO_COMBAT_PROFILES.centurion.maxHp, undefined))
    expect(praetorianHp).toBe(resolveSkillAdjustedMaxHp(HERO_COMBAT_PROFILES.praetorian.maxHp, undefined))
    expect(centurionHp).toBeGreaterThan(praetorianHp)
    expect(applyHeroIncomingDamage(100, 'centurion')).toBeLessThan(applyHeroIncomingDamage(100, 'praetorian'))
    expect(applyHeroMeleeDamage(100, 'centurion')).toBeGreaterThan(applyHeroMeleeDamage(100, 'praetorian'))
    expect(applyHeroMeleeDamage(100, 'centurion')).toBeCloseTo(220); expect(applyHeroIncomingDamage(100, 'centurion')).toBeCloseTo(60)
    expect(heroMeleeAttackSpeed('centurion')).toBe(1)
  })
  it('維京重甲 T4／T5：更耐打、單擊更重、攻速略低但近戰 DPS 略高、移動（含騎乘乘數）較慢，並由 Career 專精／精英職業路由', () => {
    for (const [heavy, normal] of [['dragon-oathguard', 'varangian'], ['ironblood-warlord', 'viking-commander']] as const) {
      const dps = (id: typeof heavy | typeof normal) => applyHeroMeleeDamage(1, id) * heroMeleeAttackSpeed(id)
      expect(applyHeroMeleeDamage(100, heavy)).toBeGreaterThan(applyHeroMeleeDamage(100, normal))
      expect(heroMeleeAttackSpeed(heavy)).toBeLessThan(heroMeleeAttackSpeed(normal))
      expect(dps(heavy)).toBeGreaterThan(dps(normal)); expect(dps(heavy)).toBeLessThan(dps(normal) * 1.1)
      expect(applyHeroIncomingDamage(100, heavy)).toBeLessThan(applyHeroIncomingDamage(100, normal))
      expect(getHeroCombatModifiers(heavy)!.maxHp).toBeGreaterThan(getHeroCombatModifiers(normal)!.maxHp)
      // Player/NPC multiply this into both foot and mounted speed; the heavy class is slower in both.
      expect(getHeroCombatModifiers(heavy)!.moveSpeedMultiplier).toBeLessThan(getHeroCombatModifiers(normal)!.moveSpeedMultiplier)
    }
    const viking = { faction: 'viking' as const, eliteClass: null, skills: undefined }
    expect(resolveCareerCombatProfile({ ...viking, ...careerRankFixture((viking).faction, 'captain'), rank: 'captain', t4Specialization: 'dragon-oathguard' })).toBe('dragon-oathguard')
    expect(resolveCareerCombatProfile({ ...viking, ...careerRankFixture((viking).faction, 'captain'), rank: 'captain' })).toBe('varangian')
    expect(resolveCareerCombatProfile({ ...viking, ...careerRankFixture((viking).faction, 'commander'), rank: 'commander', eliteClass: 'ironblood-warlord', t4Specialization: 'dragon-oathguard' })).toBe('ironblood-warlord')
    expect(resolveCareerPlayerMaxHp({ ...viking, ...careerRankFixture((viking).faction, 'commander'), rank: 'commander', eliteClass: 'ironblood-warlord' })).toBe(resolveSkillAdjustedMaxHp(HERO_COMBAT_PROFILES['ironblood-warlord'].maxHp, undefined))
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
    const baseDamage = 80
    const input = { baseDamage, combatKind: 'sword' as const,
      isLance: false, isMounted: false, mountSpeed: 0, oneHandedMultiplier: 1,
      faction: 'viking' as const, hasShield: true, heroAssetId: 'viking-hero-t5' as const }
    const npc = { baseDamage, combatKind: 'sword' as const, isMounted: false, chargeSpeed: 0,
      faction: 'viking' as const, hasShield: true, targetIsMounted: false, combatProfileId: 'viking-commander' as const }
    expect(calculatePlayerMeleeDamage(input).damage).toBe(208)
    expect(calculateNpcMeleeDamage(npc)).toEqual({ damage: 208, skipImpact: false })
    expect(heroMeleeAttackSpeed('viking-commander')).toBe(1.7)
    expect(getHeroCombatModifiers('viking-commander')).toMatchObject({ maxHp: 900, attackSpeedMultiplier: 1.55, moveSpeedMultiplier: 1.2, rangedAttackRangeMultiplier: 1 })
    expect(applyHeroOutgoingDamage(baseDamage, 'viking-commander')).toBe(176)
    expect(applyHeroIncomingDamage(100, 'viking-commander')).toBe(80)
    input.hasShield = npc.hasShield = false
    expect(calculatePlayerMeleeDamage(input).damage).toBeCloseTo(249.6)
    expect(calculateNpcMeleeDamage(npc).damage).toBeCloseTo(249.6)
    const berserker = getBerserkerModifiers('viking', false, 'sword', false)
    expect(heroMeleeAttackSpeed('viking-commander') * berserker.meleeAttackRateMultiplier).toBe(2.04)
    for (const [id, damage, speed] of [[null, 80, 1], ['varangian', 160, 1.5], ['praetorian', 160, 1], ['ranger', 104, 1], ['roman-commander', 176, 1.15]] as const) {
      expect(applyHeroMeleeDamage(baseDamage, id)).toBe(damage)
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

  it('calculates mounted lance charge damage at the charge threshold and applies Byzantine bonus', () => {
    expect(calculateLanceChargeDamage(45, 'lance', true, 10)).toMatchObject({
      isCharge: false, skipImpact: false, damage: 45,
    })
    const charged = calculateLanceChargeDamage(45, 'lance', true, 10.01)
    expect(charged.isCharge).toBe(true)
    expect(charged.skipImpact).toBe(true)
    expect(charged.damage).toBeGreaterThan(45)

    // Byzantine T5 flag spear applies its unique charge bonus while ordinary commander does not (#486 absorbed)
    const weapon = WEAPONS.byzantine_standard_lance_t5
    const input = { baseDamage: weapon.damageMax, combatKind: weapon.combatKind, isLance: true,
      isMounted: true, mountSpeed: 12, oneHandedMultiplier: 1, faction: 'roman' as const, hasShield: true }
    const byzantineResult = calculatePlayerMeleeDamage({ ...input, heroAssetId: 'byzantine-cataphract-t5' })
    const regularResult = calculatePlayerMeleeDamage({ ...input, heroAssetId: 'roman-hero-t4' as any })
    expect(byzantineResult.isCharge).toBe(true)
    expect(byzantineResult.damage).toBeGreaterThan(regularResult.damage)

    // NPC lances: a mounted charge above 10 m/s triples damage and suppresses that frame's mount impact;
    // a foot lance doubles against a mounted target; the sword-only berserker bonus never applies to a lance.
    const npcLance = { baseDamage: 45, combatKind: 'lance' as const, isMounted: true, chargeSpeed: 10,
      faction: 'viking' as const, hasShield: false, targetIsMounted: false }
    expect(calculateNpcMeleeDamage(npcLance)).toEqual({ damage: 45, skipImpact: false })
    expect(calculateNpcMeleeDamage({ ...npcLance, chargeSpeed: 10.01 })).toEqual({ damage: 135, skipImpact: true })
    expect(calculateNpcMeleeDamage({ ...npcLance, isMounted: false, chargeSpeed: 12, targetIsMounted: true })).toEqual({ damage: 90, skipImpact: false })

    // The NPC contact caller: a charge latched before the contact frame is spent once, and its hit
    // suppresses the ridden mount's impact for that frame. Plain rider state, no actor construction.
    const npcContact = NPC.prototype as unknown as { _calcLanceDamage(this: object, baseDamage: number, targetIsMounted: boolean): number }
    const rider = { meleeCombatKind: 'lance', hasActiveShield: false, characterFaction: 'viking', isMounted: true,
      combatProfileId: undefined, pendingLanceChargeSpeed: 10.01, mount: { movementSpeed: 0, skipImpactThisFrame: false } }
    expect(npcContact._calcLanceDamage.call(rider, 45, false)).toBe(135)
    expect(rider.pendingLanceChargeSpeed).toBe(0)
    expect(rider.mount.skipImpactThisFrame).toBe(true)
    rider.mount.skipImpactThisFrame = false
    expect(npcContact._calcLanceDamage.call(rider, 45, false)).toBe(45)
    expect(rider.mount.skipImpactThisFrame).toBe(false)
  })
})

/** A standing body on the ground at z, with the optional shield held at (0, 1, .5); plain math data, no model. */
function fistTarget(z: number, shieldId?: string): PhysicalCombatTarget {
  const position = new THREE.Vector3(0, 0, z)
  const target: PhysicalCombatTarget = { group: { position } as THREE.Object3D, combatPosition: position, isMounted: false }
  if (shieldId) {
    const shield = new ShieldState(); shield.equip(shieldId)
    const pivot = { matrixWorld: new THREE.Matrix4().makeTranslation(0, 1, .5), updateWorldMatrix() {} } as Pick<THREE.Object3D, 'matrixWorld' | 'updateWorldMatrix'>
    target.shield = shield
    target.shieldCollider = new ShieldCollider(pivot as THREE.Object3D, shield); target.shieldCollider.setModel(shieldId)
  }
  return target
}
/** One straight jab from the attacker at the origin, reaching z = .85 (.905 with the fist radius). */
const jab = (): FistStrike => ({ from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) })

describe('Unarmed fist contact', () => {
  it('lands only where the body is within 0.8m of the attacker (inclusive)', () => {
    const inRange = fistTarget(1.1), outOfRange = fistTarget(1.101)
    expect(traceFistStrike(jab(), new THREE.Vector3(), [inRange], [])).toMatchObject({ kind: 'body', target: inRange, attackSource: 'unarmed' })
    expect(traceFistStrike(jab(), new THREE.Vector3(), [outOfRange], [])).toBeUndefined()
  })
  it('does not reach a body behind an obstacle in the punch path', () => {
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-.5, .5, .55), new THREE.Vector3(.5, 1.5, .6)), isBarricade: false }
    expect(traceFistStrike(jab(), new THREE.Vector3(), [fistTarget(1)], [obstacle])).toBeUndefined()
  })
  it('meets a raised shield before the body behind it', () => {
    const target = fistTarget(1, 'scutum_t1')
    expect(traceFistStrike(jab(), new THREE.Vector3(), [target], [])).toMatchObject({ kind: 'shield', target })
  })
  it('hands each queued punch to the damage caller once, in world space', () => {
    const pending = [jab(), jab()]
    const toWorld = new THREE.Matrix4().makeTranslation(2, 0, 0)
    const drained = drainFistStrikes(pending, toWorld)
    expect(drained.map(strike => strike.to.toArray())).toEqual([[2, 1, .85], [2, 1, .85]])
    expect(pending).toEqual([])
    expect(drainFistStrikes(pending, toWorld)).toEqual([])
    // Player's queue is drained the same way: the frame after a punch lands, nothing is replayed.
    const playerQueue = { group: { matrixWorld: toWorld, updateWorldMatrix() {} }, pendingFistStrikes: [jab()] }
    const consume = () => (Player.prototype.consumeFistStrikes as (this: object) => FistStrike[]).call(playerQueue)
    expect(consume().map(strike => strike.from.toArray())).toEqual([[2, 1, .4]])
    expect(consume()).toEqual([])
  })
})
