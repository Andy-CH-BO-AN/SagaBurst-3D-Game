import { describe, expect, it } from 'vitest'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { resolveCareerPlayerMaxHp } from '../../src/career/CareerPlayerProfile'
import { resolveCombatSkill, resolveSkillAdjustedMaxHp, resolveSkillProgressionAward, skillStatesEqual } from '../../src/rpg/CombatSkillProgression'
import { MAX_SKILL_LEVEL, SkillManager, createDefaultSkillState, normalizeSkillState, resolveMeleeSkillId, skillDamageMultiplier, skillHpBonus } from '../../src/rpg/SkillManager'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'

function damageEvent(
  method: 'melee' | 'projectile' | 'mount-impact',
  targetType: 'npc' | 'mount' | 'structure',
  appliedDamage: number,
  weaponId?: string,
): CombatEvent {
  return {
    type: 'damage_applied',
    source: {
      actorId: 'player',
      actorType: 'player',
      allegiance: 'PLAYER' as never,
      characterFaction: 'roman',
    },
    target: {
      targetId: targetType === 'mount' ? 'mount:test' : targetType === 'structure' ? 'structure:test' : 'npc:test',
      targetType,
      name: 'target',
    },
    method,
    weaponId,
    requestedDamage: appliedDamage,
    appliedDamage,
  }
}

describe('Career skill progression', () => {
  it('scales each skill from 1x at Lv.1 to exactly 3x at Lv.50', () => {
    expect(skillDamageMultiplier(1)).toBe(1)
    expect(skillDamageMultiplier(MAX_SKILL_LEVEL)).toBe(3)
    expect(skillDamageMultiplier(25)).toBeCloseTo(1 + (24 / 49) * 2)
  })

  it('grants +246 max HP across five Lv.50 skills', () => {
    const state = createDefaultSkillState()
    expect(skillHpBonus(state)).toBe(1)

    for (const skill of Object.values(state)) skill.level = 50
    expect(skillHpBonus(state)).toBe(246)
    expect(resolveSkillAdjustedMaxHp(200, state)).toBe(446)

    const profile = createCareerProfile('roman')
    profile.rank = 'captain'
    profile.skills = state
    expect(resolveCareerPlayerMaxHp(profile, 200)).toBe(746)
  })

  it('migrates legacy Archery progress into Ranged and clamps invalid values', () => {
    const state = normalizeSkillState({
      oneHanded: { level: 0, xp: -1 },
      archery: { level: 12, xp: 250 },
      twoHanded: { level: 99, xp: 9999 },
    })

    expect(state.oneHanded).toEqual({ level: 1, xp: 0 })
    expect(state.ranged).toEqual({ level: 12, xp: 250 })
    expect(state.twoHanded).toEqual({ level: 50, xp: 0 })
    expect(state.mountedImpact).toEqual({ level: 1, xp: 0 })
  })

  it('classifies one-handed and two-handed melee from the actual attack stance', () => {
    expect(resolveMeleeSkillId(WEAPONS.viking_axe_t2, false)).toBe('twoHanded')
    expect(resolveMeleeSkillId(WEAPONS.viking_axe_t2, true)).toBe('oneHanded')
    expect(resolveMeleeSkillId({ animationKind: 'greatsword' }, false)).toBe('twoHanded')
    expect(resolveMeleeSkillId(WEAPONS.steel_sword, false)).toBe('oneHanded')
    expect(resolveMeleeSkillId(WEAPONS.steel_lance, false)).toBe('oneHanded')
  })

  it('routes sword and axe damage into the correct melee skill', () => {
    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'npc', 25, WEAPONS.steel_sword.id),
      WEAPONS.steel_sword,
      false,
    )).toEqual({ skill: 'oneHanded', xp: 25 })

    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'npc', 40, WEAPONS.viking_axe_t2.id),
      WEAPONS.viking_axe_t2,
      false,
    )).toEqual({ skill: 'twoHanded', xp: 40 })

    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'npc', 40, WEAPONS.viking_axe_t2.id),
      WEAPONS.viking_axe_t2,
      true,
    )).toEqual({ skill: 'oneHanded', xp: 40 })
  })

  it('grants melee, ranged, and mounted-impact XP when the damaged target is a mount', () => {
    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'mount', 80, WEAPONS.viking_axe_t2.id),
      WEAPONS.viking_axe_t2,
      false,
    )).toEqual({ skill: 'twoHanded', xp: 80 })

    expect(resolveSkillProgressionAward(
      damageEvent('projectile', 'mount', 35, WEAPONS.elven_runebow.id),
      WEAPONS.steel_sword,
      false,
    )).toEqual({ skill: 'ranged', xp: 35 })

    expect(resolveSkillProgressionAward(
      damageEvent('mount-impact', 'mount', 18),
      WEAPONS.steel_sword,
      false,
    )).toEqual({ skill: 'mountedImpact', xp: 18 })
  })

  it('never grants skill XP for structure damage', () => {
    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'structure', 100, WEAPONS.steel_sword.id),
      WEAPONS.steel_sword,
      false,
    )).toBeNull()
  })

  it('uses only the damage_applied event so mount death cannot double count progression', () => {
    const hit = resolveSkillProgressionAward(
      damageEvent('projectile', 'mount', 100, WEAPONS.elven_runebow.id),
      WEAPONS.steel_sword,
      false,
    )
    const killEvent = {
      type: 'actor_killed',
      source: {
        actorId: 'player', actorType: 'player', allegiance: 'PLAYER', characterFaction: 'roman',
      },
      target: { targetId: 'npc:rider', targetType: 'npc', name: 'rider' },
      method: 'projectile',
      contact: { kind: 'mount', time: .1 },
      weaponId: WEAPONS.elven_runebow.id,
    } as CombatEvent

    expect(hit).toEqual({ skill: 'ranged', xp: 100 })
    expect(resolveSkillProgressionAward(killEvent, WEAPONS.steel_sword, false)).toBeNull()
  })

  it('uses the selected melee skill multiplier for axe and greatsword stances', () => {
    const manager = new SkillManager()
    manager.setSkillState({
      oneHanded: { level: 1, xp: 0 },
      twoHanded: { level: 50, xp: 0 },
    })

    expect(manager.getMultiplier(resolveCombatSkill('melee', WEAPONS.viking_axe_t2, false)!)).toBe(3)
    expect(manager.getMultiplier(resolveCombatSkill('melee', WEAPONS.viking_axe_t2, true)!)).toBe(1)
    expect(manager.getMultiplier(resolveCombatSkill('melee', { animationKind: 'greatsword' }, false)!)).toBe(3)
  })

  it('does not gate NPC progression by allegiance, covering hostile-town retaliation', () => {
    const event = damageEvent('melee', 'npc', 22, WEAPONS.steel_sword.id) as Extract<CombatEvent, { type: 'damage_applied' }>
    event.target.allegiance = 'TOWN' as never
    expect(resolveSkillProgressionAward(event, WEAPONS.steel_sword, false)).toEqual({
      skill: 'oneHanded',
      xp: 22,
    })
  })

  it('keeps Lv.50 hits state-stable so persistence can skip redundant saves', () => {
    const manager = new SkillManager()
    manager.setSkillState({ oneHanded: { level: 50, xp: 0 } })
    const before = manager.skillState

    expect(manager.addXp('oneHanded', 999)).toBe(0)
    expect(skillStatesEqual(before, manager.skillState)).toBe(true)
  })

  it('maps ranged and mounted-impact methods independently of melee equipment', () => {
    expect(resolveCombatSkill('projectile', WEAPONS.viking_axe_t2, false)).toBe('ranged')
    expect(resolveCombatSkill('mount-impact', WEAPONS.viking_axe_t2, false)).toBe('mountedImpact')
  })
})
