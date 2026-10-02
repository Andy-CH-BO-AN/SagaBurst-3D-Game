import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CombatEventStream, type CombatEvent } from '../src/combat/CombatAttribution'
import { damageNpc, damageObstacle } from '../src/combat/DamageRouter'
import { calculateMountImpactDamage } from '../src/combat/CombatBalance'
import { resolveMountImpacts } from '../src/combat/MountImpact'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { resolveCareerPlayerMaxHp } from '../src/career/CareerPlayerProfile'
import {
  resolveActivePlayerSkillProgressionAward,
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
import { MountState } from '../src/world/Mount'
import { Faction } from '../src/world/NPC'
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



  it('allows projectile damage after death but blocks Ranged progression at impact time', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const footNpc: any = {
      dead: false,
      faction: Faction.ENEMY,
      shieldId: null,
      isMounted: false,
      mount: null,
      hp: 100,
      name: 'Late Projectile Target',
      combatantId: 'late-projectile-target',
      characterFaction: 'viking',
      takeDamage(amount: number) {
        if (this.dead) return false
        this.hp = Math.max(0, this.hp - amount)
        this.dead = this.hp <= 0
        return true
      },
      get hpRatio() { return this.hp / 100 },
    }
    damageNpc(footNpc, 35, {
      source: {
        actorId: 'player',
        actorType: 'player',
        allegiance: 'PLAYER' as never,
        characterFaction: 'roman',
      },
      method: 'projectile',
      weaponId: WEAPONS.elven_runebow.id,
      emit: stream.emit,
    })

    const enemyMount: any = {
      currentHp: 100,
      maxHp: 100,
      dead: false,
      mountDisplayName: '戰馬',
      group: { uuid: 'late-projectile-mount' },
      takeDamage(amount: number) {
        if (this.dead) return false
        this.currentHp = Math.max(0, this.currentHp - amount)
        this.dead = this.currentHp <= 0
        return true
      },
    }
    const mountedNpc: any = {
      dead: false,
      faction: Faction.ENEMY,
      shieldId: null,
      isMounted: true,
      mount: enemyMount,
      name: 'Late Mounted Target',
      combatantId: 'late-mounted-target',
      characterFaction: 'viking',
      dismountFromMount() {
        this.isMounted = false
        this.mount = null
      },
    }
    damageNpc(mountedNpc, 35, {
      source: {
        actorId: 'player',
        actorType: 'player',
        allegiance: 'PLAYER' as never,
        characterFaction: 'roman',
      },
      method: 'projectile',
      weaponId: WEAPONS.elven_runebow.id,
      emit: stream.emit,
    })

    expect(footNpc.hp).toBe(65)
    expect(enemyMount.currentHp).toBe(65)

    const damageEvents = events.filter(
      (event): event is Extract<CombatEvent, { type: 'damage_applied' }> => event.type === 'damage_applied',
    )
    expect(damageEvents.map(event => event.target.targetType)).toEqual(['npc', 'mount'])

    for (const event of damageEvents) {
      expect(resolveActivePlayerSkillProgressionAward(
        event,
        { dead: true, observer: true },
        WEAPONS.steel_sword,
        false,
      )).toBeNull()

      expect(resolveActivePlayerSkillProgressionAward(
        event,
        { dead: false, spectatorOnly: true, observer: false },
        WEAPONS.steel_sword,
        false,
      )).toBeNull()

      expect(resolveActivePlayerSkillProgressionAward(
        event,
        { dead: false, observer: true },
        WEAPONS.steel_sword,
        false,
      )).toBeNull()

      expect(resolveActivePlayerSkillProgressionAward(
        event,
        { dead: false, observer: false },
        WEAPONS.steel_sword,
        false,
      )).toEqual({ skill: 'ranged', xp: 35 })
    }
  })

  it('applies Mounted Impact damage multiplier before awarding actual-damage XP', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const playerMount: any = {
      state: MountState.CONTROLLED,
      dead: false,
      skipImpactThisFrame: false,
      movementSpeed: 10,
      isSprinting: false,
      group: { position: new THREE.Vector3(0, 0, 2), uuid: 'player-mount' },
      previousPosition: new THREE.Vector3(0, 0, 0),
      canImpact: () => true,
    }
    const player: any = {
      currentMount: playerMount,
      characterFaction: 'roman',
      targetable: true,
    }
    const npc: any = {
      dead: false,
      faction: Faction.ENEMY,
      shieldId: null,
      isMounted: false,
      mount: null,
      hp: 100,
      name: 'Impact Target',
      combatantId: 'impact-target',
      characterFaction: 'viking',
      combatPosition: new THREE.Vector3(0, 0, 1),
      takeDamage(amount: number) {
        if (this.dead) return false
        this.hp = Math.max(0, this.hp - amount)
        this.dead = this.hp <= 0
        return true
      },
      get hpRatio() { return this.hp / 100 },
    }

    resolveMountImpacts([playerMount], player, [npc], 1, {
      onDamagePlayer: () => ({
        hitSuccess: false,
        requestedDamage: 0,
        appliedDamage: 0,
        targetId: 'player',
        targetName: 'Player',
        killed: false,
        hpRatio: 1,
        isMountHit: false,
        mountDied: false,
      }),
      combatEvents: stream.emit,
      playerDamageMultiplier: 3,
    })

    const expectedDamage = calculateMountImpactDamage(10, false) * 3
    expect(100 - npc.hp).toBe(expectedDamage)
    const award = events
      .map(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword, false))
      .find(Boolean)
    expect(award).toEqual({ skill: 'mountedImpact', xp: expectedDamage })
  })

  it('routes player mount collision into an enemy mount and grants only actual Mounted Impact XP', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const playerMount: any = {
      state: MountState.CONTROLLED,
      dead: false,
      skipImpactThisFrame: false,
      movementSpeed: 10,
      isSprinting: false,
      group: { position: new THREE.Vector3(0, 0, 2), uuid: 'player-mount-mounted-target' },
      previousPosition: new THREE.Vector3(0, 0, 0),
      canImpact: () => true,
    }
    const player: any = {
      currentMount: playerMount,
      characterFaction: 'roman',
      targetable: true,
    }

    const enemyMount: any = {
      currentHp: 50,
      maxHp: 50,
      dead: false,
      mountDisplayName: '戰馬',
      group: { uuid: 'enemy-mount' },
      takeDamage(amount: number) {
        if (this.dead) return false
        this.currentHp = Math.max(0, this.currentHp - amount)
        this.dead = this.currentHp <= 0
        return true
      },
    }
    const enemyNpc: any = {
      dead: false,
      faction: Faction.ENEMY,
      shieldId: null,
      isMounted: true,
      mount: enemyMount,
      name: 'Mounted Impact Target',
      combatantId: 'mounted-impact-target',
      characterFaction: 'viking',
      combatPosition: new THREE.Vector3(0, 0, 1),
      dismountFromMount() {
        this.isMounted = false
        this.mount = null
      },
    }

    resolveMountImpacts([playerMount], player, [enemyNpc], 1, {
      onDamagePlayer: () => ({
        hitSuccess: false,
        requestedDamage: 0,
        appliedDamage: 0,
        targetId: 'player',
        targetName: 'Player',
        killed: false,
        hpRatio: 1,
        isMountHit: false,
        mountDied: false,
      }),
      combatEvents: stream.emit,
      playerDamageMultiplier: 3,
    })

    const damageEvents = events.filter(
      (event): event is Extract<CombatEvent, { type: 'damage_applied' }> => event.type === 'damage_applied',
    )
    expect(damageEvents).toHaveLength(1)
    expect(damageEvents[0].target.targetType).toBe('mount')
    expect(damageEvents[0].appliedDamage).toBe(50)
    expect(enemyMount.currentHp).toBe(0)
    expect(enemyNpc.isMounted).toBe(false)

    const awards = damageEvents
      .map(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword, false))
      .filter(Boolean)
    expect(awards).toEqual([{ skill: 'mountedImpact', xp: 50 }])
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

  it('integrates DamageRouter mount routing with melee progression without double counting on mount death', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const mount = {
      currentHp: 80,
      maxHp: 80,
      dead: false,
      mountDisplayName: '戰馬',
      group: { uuid: 'mount-integration' },
      takeDamage(amount: number) {
        if (this.dead) return false
        this.currentHp = Math.max(0, this.currentHp - amount)
        if (this.currentHp <= 0) this.dead = true
        return true
      },
    }
    const npc: any = {
      shieldId: null,
      isMounted: true,
      mount,
      name: 'Mounted Enemy',
      combatantId: 'mounted-enemy',
      faction: 'ENEMY',
      characterFaction: 'roman',
      presetId: undefined,
      squadId: undefined,
      dismountFromMount() {
        this.isMounted = false
        this.mount = null
      },
    }

    const result = damageNpc(npc, 100, {
      source: {
        actorId: 'player',
        actorType: 'player',
        allegiance: 'PLAYER' as never,
        characterFaction: 'roman',
      },
      method: 'melee',
      weaponId: WEAPONS.viking_axe_t2.id,
      emit: stream.emit,
    })

    expect(result.isMountHit).toBe(true)
    expect(result.appliedDamage).toBe(80)
    expect(npc.isMounted).toBe(false)

    const awards = events
      .map(event => resolveSkillProgressionAward(event, WEAPONS.viking_axe_t2, false))
      .filter(Boolean)
    expect(awards).toEqual([{ skill: 'twoHanded', xp: 80 }])
  })

  it('integrates DamageRouter ranged mount damage with Ranged progression', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const mount = {
      currentHp: 100,
      maxHp: 100,
      dead: false,
      mountDisplayName: '戰馬',
      group: { uuid: 'mount-ranged' },
      takeDamage(amount: number) {
        this.currentHp = Math.max(0, this.currentHp - amount)
        this.dead = this.currentHp <= 0
        return true
      },
    }
    const npc: any = {
      shieldId: null,
      isMounted: true,
      mount,
      name: 'Mounted Archer Target',
      combatantId: 'mounted-ranged-target',
      faction: 'ENEMY',
      characterFaction: 'roman',
      dismountFromMount() {
        this.isMounted = false
        this.mount = null
      },
    }

    damageNpc(npc, 35, {
      source: {
        actorId: 'player',
        actorType: 'player',
        allegiance: 'PLAYER' as never,
        characterFaction: 'roman',
      },
      method: 'projectile',
      weaponId: WEAPONS.elven_runebow.id,
      emit: stream.emit,
    })

    const award = events
      .map(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword, false))
      .find(Boolean)
    expect(award).toEqual({ skill: 'ranged', xp: 35 })
  })

  it('integrates structure routing and emits no skill progression award', () => {
    const events: CombatEvent[] = []
    const stream = new CombatEventStream()
    stream.subscribe(event => events.push(event))

    const obstacle: any = {
      root: { uuid: 'gate-1' },
      displayName: 'Gate',
      ownerFaction: 'roman',
      kind: 'gate',
      takeDamage(amount: number) {
        return { appliedDamage: amount, hpRatio: 0.5, destroyed: false }
      },
    }

    damageObstacle(obstacle, 50, {
      source: {
        actorId: 'player',
        actorType: 'player',
        allegiance: 'PLAYER' as never,
        characterFaction: 'roman',
      },
      method: 'melee',
      weaponId: WEAPONS.steel_sword.id,
      emit: stream.emit,
    })

    expect(events.length).toBeGreaterThan(0)
    expect(events.every(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword, false) === null)).toBe(true)
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
