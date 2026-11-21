import { describe,expect,it } from 'vitest'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { resolveActivePlayerSkillProgressionAward, resolveSkillProgressionAward } from '../../src/rpg/CombatSkillProgression'
import { normalizeSkillState, SkillManager } from '../../src/rpg/SkillManager'
import { skillStatesEqual } from '../../src/rpg/CombatSkillProgression'
import { unarmedDamage } from '../../src/combat/UnarmedCombat'
import { applyTownSkillXp, type TownSkillXpPorts } from '../../src/town/TownSkillProgression'
import { createCareerProfile } from '../../src/career/CareerProfile'
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

/** The real skills and profile; only the scene's save scheduling and player effects are recorded. */
function townSkillPorts() {
  const skills = new SkillManager(), live = { profile: createCareerProfile('roman') }
  const record = { eligible: true, dirty: false, scheduled: 0, flushed: 0, levelUps: [] as number[] }
  const ports: TownSkillXpPorts = {
    canAward: () => record.eligible, profile: () => live.profile, publishProfile: next => { live.profile = next },
    skillState: () => skills.skillState, addXp: (skill, xp) => skills.addXp(skill, xp), syncPlayerLevels() {},
    markDirty: () => { record.dirty = true }, flushNow: () => { record.flushed++ },
    scheduleFlush: () => { record.scheduled++ }, onLevelUp: levels => { record.levelUps.push(levels) },
  }
  return { ports, record, skills, live }
}

describe('Career skill progression', () => {
  it('applies a player unarmed XP award to live skills and the Town profile, saved lazily', () => {
    const { ports, record, skills, live } = townSkillPorts()
    const event = damageEvent('melee', 'npc', 5, 'unarmed')
    applyTownSkillXp(resolveActivePlayerSkillProgressionAward(event, { dead: false, spectatorOnly: false, observer: false }, WEAPONS.viking_axe_t3, true)!, ports)
    expect(skills.skillState.unarmed).toEqual({ level: 1, xp: 10 })
    expect(skills.skillState.oneHanded.xp).toBe(0); expect(skills.skillState.twoHanded.xp).toBe(0)
    expect(live.profile.skills!.unarmed.xp).toBe(10)
    expect(record).toMatchObject({ dirty: true, scheduled: 1, flushed: 0, levelUps: [] })
    // A dead, spectating or observing player, and the duel tutorial, earn nothing further.
    record.eligible = false
    applyTownSkillXp({ skill: 'unarmed', xp: 10 }, ports)
    record.eligible = true; live.profile.activeMission = { duelTutorialCareerId: 'career' } as never
    applyTownSkillXp({ skill: 'unarmed', xp: 10 }, ports)
    expect(skills.skillState.unarmed.xp).toBe(10); expect(record.scheduled).toBe(1)
  })
  it('flushes at once and reports the levels when an XP award levels a skill', () => {
    const { ports, record, skills, live } = townSkillPorts()
    skills.addXp('unarmed', skills.getXpNeeded(1) - 1)
    applyTownSkillXp({ skill: 'unarmed', xp: 2 }, ports)
    expect(skills.skillState.unarmed.level).toBe(2)
    expect(live.profile.skills!.unarmed.level).toBe(2)
    expect(record).toMatchObject({ dirty: true, scheduled: 0, flushed: 1, levelUps: [1] })
  })
  it('徒手技能倍率、傷害事件雙倍 XP 結算與升級曲線完整驗證', () => {
    const manager = new SkillManager()
    expect(manager.getMultiplier('unarmed')).toBe(1)
    manager.setSkillState({ unarmed: { level: 50 }, oneHanded: { level: 50 }, twoHanded: { level: 50 }, ranged: { level: 50 }, mountedImpact: { level: 50 } })
    expect(manager.getMultiplier('unarmed')).toBe(5)
    expect(unarmedDamage(manager.getMultiplier('unarmed'))).toBe(25)
    expect(unarmedDamage(manager.getMultiplier('unarmed'), 'byzantine-cataphract-t5')).toBe(75)
    for (const id of ['oneHanded', 'twoHanded', 'ranged', 'mountedImpact'] as const) expect(manager.getMultiplier(id)).toBe(3)

    // 雙倍徒手 XP
    const fresh = new SkillManager(), before = fresh.skillState
    const event = damageEvent('melee', 'npc', 5, 'unarmed')
    expect(resolveSkillProgressionAward(event, WEAPONS.viking_axe_t3, false)).toEqual({ skill: 'unarmed', xp: 10 })
    const award = resolveSkillProgressionAward(event, WEAPONS.viking_axe_t3, true)!
    fresh.addXp(award.skill, award.xp)
    expect(fresh.skillState).toMatchObject({ unarmed: { level: 1, xp: 10 }, oneHanded: { level: 1, xp: 0 }, twoHanded: { level: 1, xp: 0 } })
    expect(skillStatesEqual(before, fresh.skillState)).toBe(false)
    expect(before.unarmed.xp).toBe(0)
    expect(resolveSkillProgressionAward(damageEvent('melee', 'mount', 5, 'unarmed'))).toEqual({ skill: 'unarmed', xp: 10 })
    expect(resolveSkillProgressionAward(damageEvent('melee', 'npc', 0, 'unarmed'))).toBeNull()

    // 升級曲線與 HP 加成
    const curve = new SkillManager(), hp = curve.getMaxHpBonus()
    expect(curve.addXp('unarmed', 122500)).toBe(49)
    expect(curve.skillState.unarmed).toEqual({ level: 50, xp: 0 })
    expect(curve.getMaxHpBonus() - hp).toBe(49)
    const copy = curve.skillState; copy.unarmed.level = 1
    expect(curve.skillState.unarmed.level).toBe(50)
    expect(curve.addXp('unarmed', 100)).toBe(0)
  })
  it('awards eagle melee to mountedImpact from attack metadata independent of the held sword', () => {
    const event = damageEvent('melee', 'npc', 60, WEAPONS.steel_sword.id)
    if (event.type !== 'damage_applied') throw new Error('expected damage event')
    event.attackSource = 'xongkoro'
    expect(resolveSkillProgressionAward(event, WEAPONS.steel_sword, true)).toEqual({ skill: 'mountedImpact', xp: 60 })
    expect(resolveSkillProgressionAward(event)).toEqual({ skill: 'mountedImpact', xp: 60 })
    event.weaponId = 'unarmed'
    expect(resolveSkillProgressionAward(event)).toEqual({ skill: 'mountedImpact', xp: 60 })
  })

  it('clamps invalid current skill values', () => {
    const state = normalizeSkillState({
      oneHanded: { level: 0, xp: -1 },
      ranged: { level: 12, xp: 250 },
      twoHanded: { level: 99, xp: 9999 },
    })

    expect(state.oneHanded).toEqual({ level: 1, xp: 0 })
    expect(state.ranged).toEqual({ level: 12, xp: 250 })
    expect(state.twoHanded).toEqual({ level: 50, xp: 0 })
    expect(state.mountedImpact).toEqual({ level: 1, xp: 0 })
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

  it('trains Armor Break only from Impact the player spends on NPC shields and mount barding', () => {
    const blocked = (actorType: 'player' | 'npc', targetType: 'npc' | 'mount' | 'player', blockedImpact: number): CombatEvent => ({
      type: 'hit_blocked', method: 'melee', weaponId: WEAPONS.steel_sword.id, blockedImpact,
      source: { actorId: actorType, actorType, allegiance: 'PLAYER' as never, characterFaction: 'roman' },
      target: { targetId: `${targetType}:test`, targetType, name: 'target' },
    })
    expect(resolveSkillProgressionAward(blocked('player', 'npc', 15))).toEqual({ skill: 'armorBreak', xp: 300 })
    expect(resolveSkillProgressionAward(blocked('player', 'mount', 40))).toEqual({ skill: 'armorBreak', xp: 800 })
    // An NPC hitting a shield, or the player's own shield being hit, never trains the player's Armor Break.
    expect(resolveSkillProgressionAward(blocked('npc', 'npc', 15))).toBeNull()
    expect(resolveSkillProgressionAward(blocked('npc', 'player', 15))).toBeNull()

    const manager = new SkillManager()
    manager.addXp('armorBreak', 100)
    expect(manager.skillState.armorBreak).toEqual({ level: 2, xp: 0 })
    expect(manager.getMaxHpBonus()).toBe(2)
  })

  it('never awards skill XP for fall, structure, or non-damage kill events', () => {
    expect(resolveSkillProgressionAward(damageEvent('fall', 'npc', 150), WEAPONS.steel_sword)).toBeNull()
    expect(resolveSkillProgressionAward(
      damageEvent('melee', 'structure', 100, WEAPONS.steel_sword.id),
      WEAPONS.steel_sword,
      false,
    )).toBeNull()

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
    expect(resolveSkillProgressionAward(killEvent, WEAPONS.steel_sword, false)).toBeNull()
  })

})
