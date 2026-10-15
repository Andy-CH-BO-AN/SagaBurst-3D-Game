import { describe,expect,it } from 'vitest'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { resolveSkillProgressionAward,skillStatesEqual } from '../../src/rpg/CombatSkillProgression'
import { SkillManager,normalizeSkillState,resolveMeleeSkillId } from '../../src/rpg/SkillManager'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'

function damageEvent(
  method: 'melee' | 'projectile' | 'mount-impact' | 'fall',
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
  it('awards eagle melee to mountedImpact from attack metadata independent of the held sword', () => {
    const event = damageEvent('melee', 'npc', 60, WEAPONS.steel_sword.id)
    if (event.type !== 'damage_applied') throw new Error('expected damage event')
    event.attackSource = 'xongkoro'
    expect(resolveSkillProgressionAward(event, WEAPONS.steel_sword, true)).toEqual({ skill: 'mountedImpact', xp: 60 })
    expect(resolveSkillProgressionAward(event)).toEqual({ skill: 'mountedImpact', xp: 60 })
  })

  it('fall damage never awards weapon or mountedImpact XP to the original attacker', () => {
    expect(resolveSkillProgressionAward(damageEvent('fall', 'npc', 150), WEAPONS.steel_sword)).toBeNull()
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

  it('keeps Lv.50 hits state-stable so persistence can skip redundant saves', () => {
    const manager = new SkillManager()
    manager.setSkillState({ oneHanded: { level: 50, xp: 0 } })
    const before = manager.skillState

    expect(manager.addXp('oneHanded', 999)).toBe(0)
    expect(skillStatesEqual(before, manager.skillState)).toBe(true)
  })
})
