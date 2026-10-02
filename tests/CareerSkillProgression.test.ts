import { describe, expect, it } from 'vitest'
import type { CombatEvent } from '../src/combat/CombatAttribution'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { resolveCareerPlayerMaxHp } from '../src/career/CareerPlayerProfile'
import {
  resolveCombatSkill,
  resolveSkillAdjustedMaxHp,
  resolveSkillProgressionAward,
  skillStatesEqual,
} from '../src/rpg/CombatSkillProgression'
import {
  MAX_SKILL_LEVEL,
  SkillManager,
  createDefaultSkillState,
  normalizeSkillState,
  resolveMeleeSkillId,
  skillDamageMultiplier,
  skillHpBonus,
} from '../src/rpg/SkillManager'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { DEFAULT_SAVE, SaveManager } from '../src/save/SaveManager'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

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

  it('grants up to +196 max HP across four Lv.50 skills', () => {
    const state = createDefaultSkillState()
    expect(skillHpBonus(state)).toBe(0)

    for (const skill of Object.values(state)) skill.level = 50
    expect(skillHpBonus(state)).toBe(196)
    expect(resolveSkillAdjustedMaxHp(200, state)).toBe(396)

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
      weaponId: WEAPONS.elven_runebow.id,
    } as CombatEvent

    expect(hit).toEqual({ skill: 'ranged', xp: 100 })
    expect(resolveSkillProgressionAward(killEvent, WEAPONS.steel_sword, false)).toBeNull()
  })

  it('keeps Lv.50 hits state-stable so persistence can skip redundant saves', () => {
    const manager = new SkillManager()
    manager.setSkillState({ oneHanded: { level: 50, xp: 0 } })
    const before = manager.skillState

    expect(manager.addXp('oneHanded', 999)).toBe(0)
    expect(skillStatesEqual(before, manager.skillState)).toBe(true)
  })

  it('persists all four skills through Career save/reload', () => {
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    const profile = createCareerProfile('roman')
    profile.skills = {
      oneHanded: { level: 7, xp: 12 },
      twoHanded: { level: 8, xp: 23 },
      ranged: { level: 9, xp: 34 },
      mountedImpact: { level: 10, xp: 45 },
    }

    expect(store.save(profile)).toBe(true)
    expect(store.load()?.skills).toEqual(profile.skills)
  })

  it('persists all four skills through regular save/reload', () => {
    const storage = new MemoryStorage()
    const store = new SaveManager(storage)
    const skills = {
      oneHanded: { level: 3, xp: 10 },
      twoHanded: { level: 4, xp: 20 },
      ranged: { level: 5, xp: 30 },
      mountedImpact: { level: 6, xp: 40 },
    }
    const save = {
      ...DEFAULT_SAVE,
      position: { ...DEFAULT_SAVE.position },
      inventory: { ...DEFAULT_SAVE.inventory },
      skills,
    }

    expect(store.save(save)).toBe(true)
    expect(store.load().skills).toEqual(skills)
  })

  it('maps ranged and mounted-impact methods independently of melee equipment', () => {
    expect(resolveCombatSkill('projectile', WEAPONS.viking_axe_t2, false)).toBe('ranged')
    expect(resolveCombatSkill('mount-impact', WEAPONS.viking_axe_t2, false)).toBe('mountedImpact')
  })
})
