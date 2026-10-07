import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { damageNpc, damageObstacle } from '../../src/combat/DamageRouter'
import { calculateMountImpactDamage } from '../../src/combat/CombatBalance'
import { resolveMountImpacts } from '../../src/combat/MountImpact'
import { resolveActivePlayerSkillProgressionAward, resolveSkillProgressionAward } from '../../src/rpg/CombatSkillProgression'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { MountState } from '../../src/world/Mount'
import { Faction } from '../../src/world/NPC'
import { damageMount } from '../../src/combat/DamageRouter'
import { MountType } from '../../src/world/Mount'

import { createMountedCombatActors, createMountedDamageContext as ctx } from '../helpers/mountedCombatActors'
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Damage progression wiring', () => {
  it('allows projectile damage after death but blocks Ranged progression at impact time', () => {
    const { events, stream } = createCombatEventRecorder(onTestFinished)

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
      contact: { kind: 'mount', time: .1 },
      weaponId: WEAPONS.elven_runebow.id,
      emit: stream.emit,
    })

    const enemyMount: any = {
      currentHp: 100,
      maxHp: 100,
      dead: false,
      displayName: '戰馬', mountDisplayName: '戰馬',
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
      contact: { kind: 'mount', time: .1 },
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
    const { events, stream } = createCombatEventRecorder(onTestFinished)

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
        hitSuccess: false, blockedImpact: 0,
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
    const { events, stream } = createCombatEventRecorder(onTestFinished)

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
      displayName: '戰馬', mountDisplayName: '戰馬',
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
        hitSuccess: false, blockedImpact: 0,
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

  it('integrates DamageRouter mount routing with melee progression without double counting on mount death', () => {
    const { events, stream } = createCombatEventRecorder(onTestFinished)

    const mount = {
      currentHp: 80,
      maxHp: 80,
      dead: false,
      displayName: '戰馬', mountDisplayName: '戰馬',
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
      contact: { kind: 'mount', time: .1 },
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
    const { events, stream } = createCombatEventRecorder(onTestFinished)

    const mount = {
      currentHp: 100,
      maxHp: 100,
      dead: false,
      displayName: '戰馬', mountDisplayName: '戰馬',
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
      contact: { kind: 'mount', time: .1 },
      weaponId: WEAPONS.elven_runebow.id,
      emit: stream.emit,
    })

    const award = events
      .map(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword, false))
      .find(Boolean)
    expect(award).toEqual({ skill: 'ranged', xp: 35 })
  })

  it('integrates structure routing and emits no skill progression award', () => {
    const { events, stream } = createCombatEventRecorder(onTestFinished)

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
})

describe('Mounted actor damage progression wiring', () => {
  it.each(['melee', 'projectile'] as const)('%s XP uses actual damage for both mount and NPC targets', method => {
    const { rider, mount, player } = fixture(), events: CombatEvent[] = []
    damageNpc(rider, 30, ctx(player, 'body', undefined, method, events))
    mount.currentHp = 20
    damageMount(mount, 30, ctx(player, 'mount', mount, method, events))
    expect(events.map(e => 'target' in e && e.target.targetType)).toEqual(['npc', 'mount'])
    expect(events.map(e => resolveSkillProgressionAward(e, WEAPONS.steel_sword, false)?.xp)).toEqual([30, 20])
  })
})
