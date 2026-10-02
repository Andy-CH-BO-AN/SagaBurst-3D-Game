import { describe, expect, it } from 'vitest'
import {
  MAX_SKILL_LEVEL,
  createDefaultSkillState,
  normalizeSkillState,
  resolveMeleeSkillId,
  skillDamageMultiplier,
  skillHpBonus,
} from '../src/rpg/SkillManager'
import { createCareerProfile } from '../src/career/CareerProfile'
import { resolveCareerPlayerMaxHp } from '../src/career/CareerPlayerProfile'
import { WEAPONS } from '../src/rpg/WeaponDatabase'

describe('Career skill progression', () => {
  it('scales each skill from 1x at Lv.1 to exactly 3x at Lv.50', () => {
    expect(skillDamageMultiplier(1)).toBe(1)
    expect(skillDamageMultiplier(MAX_SKILL_LEVEL)).toBe(3)
    expect(skillDamageMultiplier(25)).toBeCloseTo(1 + (24 / 49) * 2)
  })

  it('grants up to +196 max HP across four Lv.50 skills', () => {
    const state = createDefaultSkillState()
    expect(skillHpBonus(state)).toBe(0)

    for (const skill of Object.values(state)) skill.level = 50
    expect(skillHpBonus(state)).toBe(196)

    const profile = createCareerProfile('roman')
    profile.rank = 'captain'
    profile.skills = state
    expect(resolveCareerPlayerMaxHp(profile, 200)).toBe(696)
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

  it('classifies axe stance separately from one-handed melee', () => {
    expect(resolveMeleeSkillId(WEAPONS.viking_axe_t2, false)).toBe('twoHanded')
    expect(resolveMeleeSkillId(WEAPONS.viking_axe_t2, true)).toBe('oneHanded')
    expect(resolveMeleeSkillId(WEAPONS.steel_sword, false)).toBe('oneHanded')
    expect(resolveMeleeSkillId(WEAPONS.steel_lance, false)).toBe('oneHanded')
  })
})
