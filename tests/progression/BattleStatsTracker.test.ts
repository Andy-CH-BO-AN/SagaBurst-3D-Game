import { describe, expect, it, onTestFinished } from 'vitest'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import {
  CombatEventStream,
  type CombatActorRef,
  type CombatTargetRef,
} from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'

function playerSource(): CombatActorRef {
  return {
    actorId: 'player',
    actorType: 'player',
    allegiance: Faction.PLAYER,
    characterFaction: 'viking',
  }
}

function squadSource(squadId: 1 | 2 | 3 = 2): CombatActorRef {
  return {
    actorId: `npc-squad-${squadId}`,
    actorType: 'npc',
    allegiance: Faction.PLAYER,
    characterFaction: 'viking',
    presetId: 'viking_berserker',
    squadId,
  }
}

function enemySource(): CombatActorRef {
  return {
    actorId: 'enemy',
    actorType: 'npc',
    allegiance: Faction.ENEMY,
    characterFaction: 'roman',
    presetId: 'roman_heavy_infantry',
  }
}

function npcTarget(id: string, squadId?: 1 | 2 | 3): CombatTargetRef {
  return {
    targetId: id,
    targetType: 'npc',
    name: id,
    allegiance: squadId ? Faction.PLAYER : Faction.ENEMY,
    characterFaction: squadId ? 'viking' : 'roman',
    squadId,
  }
}

function mockSquadNpc(id: string, squadId: 1 | 2 | 3, dead = false): any {
  return {
    combatantId: id,
    faction: Faction.PLAYER,
    squadId,
    dead,
  }
}

describe('BattleStatsTracker', () => {
  it('counts explicitly registered Town allies but ignores enemy actors with colliding squad ids', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events)
    onTestFinished(() => tracker.dispose())
    const townAlly = { combatantId: 'borrowed-captain', faction: Faction.TOWN, squadId: 2, dead: false }
    const enemyWithSameSquad = { combatantId: 'enemy-captain', faction: Faction.ENEMY, squadId: 2, dead: false }
    tracker.registerNpc(townAlly as any, true)
    tracker.registerNpc(enemyWithSameSquad as any)

    const townSource: CombatActorRef = { ...squadSource(2), actorId: 'borrowed-captain', allegiance: Faction.TOWN }
    const collidingEnemySource: CombatActorRef = { ...squadSource(2), actorId: 'enemy-captain', allegiance: Faction.ENEMY }
    const townTarget: CombatTargetRef = { ...npcTarget('borrowed-captain', 2), allegiance: Faction.TOWN }
    const collidingEnemyTarget: CombatTargetRef = { ...npcTarget('enemy-captain', 2), allegiance: Faction.ENEMY }
    events.emit({ type: 'damage_applied', source: townSource, target: npcTarget('enemy-1'), method: 'melee', requestedDamage: 7, appliedDamage: 7 })
    events.emit({ type: 'damage_applied', source: collidingEnemySource, target: npcTarget('enemy-2'), method: 'melee', requestedDamage: 13, appliedDamage: 13 })
    events.emit({ type: 'damage_applied', source: collidingEnemySource, target: townTarget, method: 'melee', requestedDamage: 11, appliedDamage: 11 })
    events.emit({ type: 'damage_applied', source: playerSource(), target: collidingEnemyTarget, method: 'melee', requestedDamage: 17, appliedDamage: 17 })

    const snapshot = tracker.snapshot([townAlly, enemyWithSameSquad] as any, { dead: false } as any)
    expect(snapshot.squads).toEqual([expect.objectContaining({
      squadId: 2, damageDealt: 7, damageTaken: 11, startingMembers: 1, survivors: 1, casualties: 0,
    })])
  })
  it('stream-aggregates player and squad combat stats without retaining an event log', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events)
    onTestFinished(() => tracker.dispose())

    const squadNpcA = mockSquadNpc('s2-a', 2, false)
    const squadNpcB = mockSquadNpc('s2-b', 2, true)
    const squadNpcC = mockSquadNpc('s2-c', 2, false)
    tracker.registerNpc(squadNpcA)
    tracker.registerNpc(squadNpcB)
    tracker.registerNpc(squadNpcC)
    tracker.registerNpc(squadNpcA) // duplicate registration must not inflate starting strength

    events.emit({
      type: 'damage_applied',
      source: playerSource(),
      target: npcTarget('enemy-1'),
      method: 'melee',
      requestedDamage: 80,
      appliedDamage: 3,
    })
    events.emit({
      type: 'damage_applied',
      source: squadSource(2),
      target: npcTarget('enemy-2'),
      method: 'projectile',
      requestedDamage: 25,
      appliedDamage: 25,
    })
    events.emit({
      type: 'damage_applied',
      source: enemySource(),
      target: {
        targetId: 'player',
        targetType: 'player',
        name: 'Player',
        allegiance: Faction.PLAYER,
        characterFaction: 'viking',
      },
      method: 'melee',
      requestedDamage: 17,
      appliedDamage: 17,
    })
    events.emit({
      type: 'damage_applied',
      source: enemySource(),
      target: npcTarget('s2-a', 2),
      method: 'projectile',
      requestedDamage: 9,
      appliedDamage: 9,
    })
    events.emit({
      type: 'actor_killed',
      source: playerSource(),
      target: npcTarget('enemy-1'),
      method: 'melee',
    })
    events.emit({
      type: 'actor_killed',
      source: squadSource(2),
      target: npcTarget('enemy-2'),
      method: 'projectile',
    })
    events.emit({
      type: 'structure_damaged',
      source: playerSource(),
      target: {
        targetId: 'gate-1',
        targetType: 'structure',
        name: 'Gate',
        structureKind: 'gate',
      },
      method: 'melee',
      requestedDamage: 40,
      appliedDamage: 40,
      hpRatio: 0.2,
    })
    events.emit({
      type: 'structure_destroyed',
      source: playerSource(),
      target: {
        targetId: 'gate-1',
        targetType: 'structure',
        name: 'Gate',
        structureKind: 'gate',
      },
      method: 'melee',
    })
    events.emit({
      type: 'structure_damaged',
      source: squadSource(2),
      target: {
        targetId: 'wall-1',
        targetType: 'structure',
        name: 'Palisade',
        structureKind: 'palisade',
      },
      method: 'siege',
      requestedDamage: 55,
      appliedDamage: 55,
      hpRatio: 0.4,
    })
    events.emit({
      type: 'structure_destroyed',
      source: squadSource(2),
      target: {
        targetId: 'wall-1',
        targetType: 'structure',
        name: 'Palisade',
        structureKind: 'palisade',
      },
      method: 'siege',
    })

    const snapshot = tracker.snapshot(
      [squadNpcA, squadNpcB, squadNpcC] as any,
      { dead: false } as any,
    )

    expect(snapshot.player).toEqual({
      damageDealt: 3,
      damageTaken: 17,
      kills: 1,
      structureDamage: 40,
      structuresDestroyed: 1,
      gateBreaches: 1,
      survived: true,
    })
    expect(snapshot.squads).toEqual([{
      squadId: 2,
      damageDealt: 25,
      damageTaken: 9,
      kills: 1,
      structureDamage: 55,
      structuresDestroyed: 1,
      gateBreaches: 0,
      startingMembers: 3,
      survivors: 2,
      casualties: 1,
    }])
  })

  it('does not count structure damage or breaches for defense-role stats', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, false)
    onTestFinished(() => tracker.dispose())
    const squadNpc = mockSquadNpc('defender-1', 1, false)
    tracker.registerNpc(squadNpc)

    events.emit({
      type: 'structure_damaged',
      source: playerSource(),
      target: {
        targetId: 'gate-defense',
        targetType: 'structure',
        name: 'Gate',
        structureKind: 'gate',
      },
      method: 'melee',
      requestedDamage: 500,
      appliedDamage: 500,
      hpRatio: 0,
    })
    events.emit({
      type: 'structure_destroyed',
      source: playerSource(),
      target: {
        targetId: 'gate-defense',
        targetType: 'structure',
        name: 'Gate',
        structureKind: 'gate',
      },
      method: 'melee',
    })
    events.emit({
      type: 'structure_damaged',
      source: squadSource(1),
      target: {
        targetId: 'wall-defense',
        targetType: 'structure',
        name: 'Palisade',
        structureKind: 'palisade',
      },
      method: 'siege',
      requestedDamage: 300,
      appliedDamage: 300,
      hpRatio: 0,
    })
    events.emit({
      type: 'structure_destroyed',
      source: squadSource(1),
      target: {
        targetId: 'wall-defense',
        targetType: 'structure',
        name: 'Palisade',
        structureKind: 'palisade',
      },
      method: 'siege',
    })

    const snapshot = tracker.snapshot([squadNpc] as any, { dead: false } as any)
    expect(snapshot.player).toMatchObject({
      structureDamage: 0,
      structuresDestroyed: 0,
      gateBreaches: 0,
    })
    expect(snapshot.squads[0]).toMatchObject({
      structureDamage: 0,
      structuresDestroyed: 0,
      gateBreaches: 0,
    })
  })

  it('handles large event volume as counters and returns one compact snapshot', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events)
    onTestFinished(() => tracker.dispose())

    for (let i = 0; i < 10_000; i++) {
      events.emit({
        type: 'damage_applied',
        source: playerSource(),
        target: npcTarget('enemy'),
        method: 'melee',
        requestedDamage: 1,
        appliedDamage: 1,
      })
    }

    const snapshot = tracker.snapshot([], { dead: true } as any)
    expect(snapshot.player.damageDealt).toBe(10_000)
    expect(snapshot.player.survived).toBe(false)
    expect(snapshot.squads).toEqual([])
  })

  it('calculates squad survival only when snapshot is requested', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events)
    onTestFinished(() => tracker.dispose())
    const first = mockSquadNpc('first', 1, false)
    const second = mockSquadNpc('second', 1, false)

    tracker.registerNpc(first)
    tracker.registerNpc(second)

    expect(tracker.snapshot([first, second] as any, { dead: false } as any).squads[0]).toMatchObject({
      startingMembers: 2,
      survivors: 2,
      casualties: 0,
    })

    second.dead = true
    expect(tracker.snapshot([first, second] as any, { dead: false } as any).squads[0]).toMatchObject({
      startingMembers: 2,
      survivors: 1,
      casualties: 1,
    })
  })

  it('stops aggregating after dispose', () => {
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events)
    onTestFinished(() => tracker.dispose())
    tracker.dispose()

    events.emit({
      type: 'damage_applied',
      source: playerSource(),
      target: npcTarget('enemy'),
      method: 'melee',
      requestedDamage: 10,
      appliedDamage: 10,
    })

    expect(tracker.snapshot([], { dead: false } as any).player.damageDealt).toBe(0)
  })
})
