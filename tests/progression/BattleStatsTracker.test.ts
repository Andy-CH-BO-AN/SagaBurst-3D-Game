import { careerTownSceneRoster } from '../../src/career/CareerFieldSceneContext'
import { describe, expect, it, onTestFinished } from 'vitest'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import {
  CombatEventStream,
  type CombatActorRef,
  type CombatTargetRef,
} from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'
import type { NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { createMissionCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy, createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { acceptCareerOutpost, careerOutpostCommandMeritPolicy, claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'

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
  it('keeps official and private contributions separate, sums merit once, and resumes both checkpoints', () => {
    const events = new CombatEventStream()
    const official = { ...squadSource(1), actorId: 'borrowed', allegiance: Faction.TOWN }
    const personal: CombatActorRef = { ...squadSource(1), actorId: 'personal:test', squadId: 'personal', ownership: 'player-personal' }
    const policy = {
      acceptsSource: (source: CombatActorRef) => source.actorId === personal.actorId,
      initialMemberIds: [personal.actorId],
      official: { acceptsSource: (source: CombatActorRef) => source.actorId === official.actorId, initialMemberIds: [official.actorId] },
    }
    const tracker = new BattleStatsTracker(events, true, undefined, {}, policy)
    onTestFinished(() => tracker.dispose())
    for (const [source, appliedDamage] of [[playerSource(), 3], [official, 7], [personal, 11]] as const) {
      events.emit({ type: 'damage_applied', source, target: npcTarget('enemy'), method: 'projectile', requestedDamage: 100, appliedDamage })
      events.emit({ type: 'actor_killed', source, target: npcTarget('enemy'), method: 'projectile' })
    }
    for (const [source, appliedDamage] of [[official, 4], [personal, 9]] as const) {
      events.emit({ type: 'damage_applied', source: enemySource(), target: { targetId: source.actorId, targetType: 'npc',
        name: source.actorId, allegiance: source.allegiance, characterFaction: source.characterFaction, squadId: source.squadId },
        method: 'melee', requestedDamage: 100, appliedDamage })
    }
    const player = { dead: false } as Player
    const actors = [{ combatantId: 'borrowed', dead: true, squadId: 1 },
      { combatantId: 'personal:test', dead: false, squadId: 'personal' }] as unknown as NPC[]
    const snapshot = tracker.snapshot(actors, player)
    expect(snapshot.player).toMatchObject({ damageDealt: 3, kills: 1 })
    expect(snapshot.meritPlayer).toMatchObject({ damageDealt: 21, kills: 3, damageTaken: 0 })
    expect(snapshot.squads).toEqual([
      expect.objectContaining({ squadId: 1, damageDealt: 7, damageTaken: 4, kills: 1, startingMembers: 1, casualties: 1 }),
      expect.objectContaining({ squadId: 'personal', damageDealt: 11, damageTaken: 9, kills: 1, startingMembers: 1, survivors: 1 }),
    ])
    const resumed = new BattleStatsTracker(new CombatEventStream(), true, undefined, tracker.checkpoint(),
      { ...policy, initialContribution: tracker.commandCheckpoint(),
        official: { ...policy.official, initialContribution: tracker.officialCommandCheckpoint() } })
    onTestFinished(() => resumed.dispose())
    expect(resumed.snapshot(actors, player)).toEqual(snapshot)
    tracker.freeze()
    events.emit({ type: 'actor_killed', source: official, target: npcTarget('late-enemy'), method: 'projectile' })
    expect(tracker.officialCommandCheckpoint()).toEqual({ ...emptyPersonalContribution(), damageDealt: 7, kills: 1, damageTaken: 4 })
  })

  it('resumes two official squads through the Career store without duplicating merit or moving departed survivors to Squad 1', () => {
    const profile = createCareerProfile('viking')
    profile.rank = 'commander'; profile.totalMerit = 20000
    const mission = createActiveCareerMission('captain-cavalry-command', 0, 2, 0, 'multi-merit')
    profile.activeMission = mission
    mission.phase = 'ENGAGING'; mission.friendlyActorIds = ['north', 'south', 'departed']
    mission.officialSquad = createMissionCommandAuthority(mission.id, 'viking', 'commander', ['north'], [
      { squadId: 1, actorIds: ['north'] }, { squadId: 2, actorIds: ['south', 'departed'] },
    ])
    mission.officialSquad.members = { departed: { status: 'exited', hp: 15 } }
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    onTestFinished(() => tracker.dispose())
    const north: CombatActorRef = { ...squadSource(1), actorId: 'north', ownership: 'mission-official' }
    const south: CombatActorRef = { ...squadSource(2), actorId: 'south', ownership: 'mission-official' }
    for (const [source, damage] of [[north, 7], [south, 11]] as const) {
      events.emit({ type: 'damage_applied', source, target: npcTarget(mission.targetActorIds[source === north ? 0 : 1]), method: 'projectile', requestedDamage: damage, appliedDamage: damage })
      events.emit({ type: 'actor_killed', source, target: npcTarget(mission.targetActorIds[source === north ? 0 : 1]), method: 'projectile' })
    }
    for (const [source, damage] of [[north, 3], [south, 5]] as const) events.emit({ type: 'damage_applied',
      source: { ...enemySource(), actorId: mission.targetActorIds[0] },
      target: npcTarget(source.actorId, source.squadId as 1 | 2), method: 'melee', requestedDamage: damage, appliedDamage: damage })
    const actors = [{ combatantId: 'north', squadId: 1, dead: true }, { combatantId: 'south', squadId: 2, dead: false }] as unknown as NPC[]
    const snapshot = tracker.snapshot(actors, { dead: false } as Player)
    expect(snapshot.meritPlayer).toMatchObject({ damageDealt: 18, kills: 2 })
    expect(snapshot.squads).toEqual([
      expect.objectContaining({ squadId: 1, damageDealt: 7, damageTaken: 3, startingMembers: 1, survivors: 0, casualties: 1 }),
      expect.objectContaining({ squadId: 2, damageDealt: 11, damageTaken: 5, startingMembers: 2, survivors: 2, casualties: 0 }),
      expect.objectContaining({ squadId: 'personal', startingMembers: 0 }),
    ])
    mission.officialSquad.contribution = tracker.officialCommandCheckpoint()
    expect(mission.officialSquad.contribution.damageTaken).toBe(8)
    for (const saved of tracker.officialSquadCheckpoints()) {
      mission.officialSquad.squads!.find(squad => squad.squadId === saved.squadId)!.contribution = saved.contribution
    }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!.activeMission!
    const resumed = new BattleStatsTracker(new CombatEventStream(), true, undefined, {}, careerMissionCommandMeritPolicy(loaded))
    onTestFinished(() => resumed.dispose())
    expect(resumed.snapshot(actors, { dead: false } as Player)).toEqual(snapshot)
    // A departed soldier still visible in the scene must be counted just once.
    expect(resumed.snapshot([...actors, { combatantId: 'departed', squadId: 2, dead: false } as NPC], { dead: false } as Player).squads[1].survivors).toBe(2)
  })

  it('credits Roman Maki against the enemy army gate and rejects her own army gate regardless of visual faction', () => {
    const ranger = careerTownSceneRoster({ faction: 'roman' }).find(entry => entry.spec.id === 'ranger')!
    const mission = createActiveCareerMission('captain-siege-command', -1, 1, 0, 'maki-gates')
    mission.kind = 'enemy-town-assault'; mission.phase = 'ENGAGING'
    mission.officialSquad = createMissionCommandAuthority(mission.id, 'roman', 'commander', [], [
      { squadId: 2, actorIds: [ranger.spec.id] },
    ])
    const source: CombatActorRef = { actorId: ranger.spec.id, actorType: 'npc', squadId: 2,
      allegiance: ranger.allegiance, characterFaction: ranger.characterFaction, ownership: 'mission-official' }
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event), {}, careerMissionCommandMeritPolicy(mission))
    onTestFinished(() => tracker.dispose())
    for (const characterFaction of ['viking', 'roman'] as const) {
      const target: CombatTargetRef = { targetId: `${characterFaction}:gate`, targetType: 'structure',
        name: 'Gate', structureKind: 'gate', characterFaction }
      const damage = { type: 'structure_damaged' as const, source, target, method: 'siege' as const,
        requestedDamage: 13, appliedDamage: 13, hpRatio: .5 }
      const destroyed = { type: 'structure_destroyed' as const, source, target, method: 'siege' as const }
      expect(acceptsCareerMissionStat(mission, damage)).toBe(characterFaction === 'viking')
      expect(acceptsCareerMissionStat(mission, destroyed)).toBe(characterFaction === 'viking')
      events.emit(damage); events.emit(destroyed)
    }
    expect(tracker.officialCommandCheckpoint()).toEqual({ ...emptyPersonalContribution(),
      structureDamage: 13, structuresDestroyed: 1, gateBreaches: 1 })
    expect(tracker.snapshot([], { dead: false } as Player).meritPlayer).toMatchObject({
      structureDamage: 13, structuresDestroyed: 1, gateBreaches: 1,
    })
  })

  it('keeps commanded civilian damage and kills outside both official and personal merit', () => {
    const mission = createActiveCareerMission('captain-cavalry-command', 0, 2, 0, 'civilian-merit')
    mission.phase = 'ENGAGING'
    mission.officialSquad = createMissionCommandAuthority(mission.id, 'viking', 'commander', [], [
      { squadId: 1, actorIds: ['official'] },
    ])
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    onTestFinished(() => tracker.dispose())
    const official: CombatActorRef = { ...squadSource(1), actorId: 'official', ownership: 'mission-official' }
    const civilian: CombatActorRef = { ...squadSource(1), actorId: 'civilian:0', squadId: 'civilians', ownership: 'player-civilian' }
    for (const [source, damage, targetId] of [[official, 7, mission.targetActorIds[0]], [civilian, 99, mission.targetActorIds[1]]] as const) {
      events.emit({ type: 'damage_applied', source, target: npcTarget(targetId), method: 'melee', requestedDamage: damage, appliedDamage: damage })
      events.emit({ type: 'actor_killed', source, target: npcTarget(targetId), method: 'melee' })
    }
    expect(tracker.officialCommandCheckpoint()).toEqual({ ...emptyPersonalContribution(), damageDealt: 7, kills: 1 })
    expect(tracker.commandCheckpoint()).toEqual(emptyPersonalContribution())
    expect(tracker.snapshot([], { dead: false } as Player).meritPlayer).toMatchObject({ damageDealt: 7, kills: 1 })
  })

  it.each(['personal', 'official'] as const)('gates all %s squad counters on accepted source and event while preserving valid events', kind => {
    const events = new CombatEventStream()
    const source: CombatActorRef = { ...squadSource(1), actorId: kind,
      squadId: kind === 'personal' ? 'personal' : 1,
      ownership: kind === 'personal' ? 'player-personal' : 'mission-official' }
    const tracker = new BattleStatsTracker(events, true, undefined, {}, {
      acceptsSource: candidate => kind === 'personal' && candidate.actorId === source.actorId,
      acceptsEvent: event => event.target.targetId === 'accepted',
      initialMemberIds: kind === 'personal' ? [source.actorId] : [],
      official: { acceptsSource: candidate => kind === 'official' && candidate.actorId === source.actorId,
        initialMemberIds: kind === 'official' ? [source.actorId] : [] },
    })
    onTestFinished(() => tracker.dispose())
    for (const [actorId, targetId] of [[source.actorId, 'accepted'], ['unaccepted-source', 'accepted'], [source.actorId, 'other-mission']]) {
      const captured = { ...source, actorId }, target = { ...npcTarget(targetId), structureKind: 'gate' as const }
      events.emit({ type: 'damage_applied', source: captured, target, method: 'melee', requestedDamage: 7, appliedDamage: 7 })
      events.emit({ type: 'actor_killed', source: captured, target, method: 'melee' })
      events.emit({ type: 'structure_damaged', source: captured, target: { ...target, targetType: 'structure' }, method: 'siege', requestedDamage: 11, appliedDamage: 11, hpRatio: .5 })
      events.emit({ type: 'structure_destroyed', source: captured, target: { ...target, targetType: 'structure' }, method: 'siege' })
    }
    expect(tracker.snapshot([], { dead: false } as Player).squads.find(squad => squad.squadId === source.squadId)).toMatchObject({
      damageDealt: 7, kills: 1, structureDamage: 11, structuresDestroyed: 1, gateBreaches: 1,
    })
  })

  it('never adds player events or an overlapping NPC to command merit more than once', () => {
    const events = new CombatEventStream(), tracker = new BattleStatsTracker(events, true, undefined, {}, {
      acceptsSource: () => true,
      official: { acceptsSource: () => true },
    })
    onTestFinished(() => tracker.dispose())
    for (const source of [playerSource(), squadSource(1)]) events.emit({ type: 'damage_applied', source,
      target: npcTarget('enemy'), method: 'melee', requestedDamage: 10, appliedDamage: 10 })
    expect(tracker.snapshot([], { dead: false } as Player).meritPlayer?.damageDealt).toBe(20)
    expect(tracker.commandCheckpoint().damageDealt).toBe(10)
    expect(tracker.officialCommandCheckpoint().damageDealt).toBe(0)
  })

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


describe('Regular Outpost official merit settlement', () => {
  it('merges two accepted official squads and HR once, preserves source boundaries, and resumes their saved contributions', () => {
    const profile = acceptCareerOutpost({ ...createCareerProfile('viking'), rank: 'commander', totalMerit: 20000,
      personalSquad: { members: [{ id: 'personal:outpost', type: 'soldier' }] } }, 1, 'outpost-merit')!
    const mission = profile.activeOutpostMission!, official = mission.officialSquad!
    const first: CombatActorRef = { ...squadSource(1), actorId: official.squads![0].actorIds[0], ownership: 'mission-official' }
    const second: CombatActorRef = { ...squadSource(2), actorId: official.squads![1].actorIds[0], ownership: 'mission-official' }
    const personal: CombatActorRef = { ...squadSource(1), actorId: 'personal:outpost', squadId: 'personal', ownership: 'player-personal' }
    mission.personalSquad!.members[personal.actorId].status = 'deployed'
    let active = false
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, false, undefined, {}, careerOutpostCommandMeritPolicy(mission, () => mission,
      event => active && event.target.allegiance === Faction.ENEMY && event.target.targetId.startsWith('outpost-merit:attackers:')))
    onTestFinished(() => tracker.dispose())
    const hit = (source: CombatActorRef, damage: number, target = npcTarget('outpost-merit:attackers:0')) =>
      events.emit({ type: 'damage_applied', source, target, method: 'melee', requestedDamage: damage, appliedDamage: damage })
    hit(first, 999)
    active = true
    for (const [source, damage] of [[first, 20], [second, 40], [personal, 10]] as const) {
      hit(source, damage)
      events.emit({ type: 'actor_killed', source, target: npcTarget('outpost-merit:attackers:0'), method: 'melee' })
    }
    const rejected: CombatActorRef[] = [
      { ...first, actorId: 'outpost-merit:attackers:0' }, { ...first, squadId: 2 },
      { ...first, ownership: 'player-personal' }, { ...first, ownership: 'town-command' },
      { ...first, allegiance: Faction.ENEMY },
    ]
    for (const source of rejected) hit(source, 999)
    hit(first, 999, npcTarget('next-mission:attackers:0'))
    const snapshot = tracker.snapshot([], { dead: false } as Player)
    expect(snapshot.meritPlayer).toMatchObject({ damageDealt: 70, kills: 3 })
    expect(snapshot.player).toMatchObject({ damageDealt: 0, kills: 0 })
    expect(tracker.officialCommandCheckpoint()).toMatchObject({ damageDealt: 60, kills: 2 })
    expect(tracker.commandCheckpoint()).toMatchObject({ damageDealt: 10, kills: 1 })
    expect(snapshot.squads.find(squad => squad.squadId === 1)).toMatchObject({ damageDealt: 20, kills: 1 })
    expect(snapshot.squads.find(squad => squad.squadId === 2)).toMatchObject({ damageDealt: 40, kills: 1 })
    expect(snapshot.squads.find(squad => squad.squadId === 'personal')).toMatchObject({ damageDealt: 10, kills: 1 })
    for (const saved of tracker.officialSquadCheckpoints()) {
      expect(saved.contribution).toMatchObject({ damageDealt: saved.squadId === 1 ? 20 : saved.squadId === 2 ? 40 : 0,
        kills: saved.squadId === 1 || saved.squadId === 2 ? 1 : 0 })
    }
    official.contribution = tracker.officialCommandCheckpoint()
    for (const saved of tracker.officialSquadCheckpoints()) official.squads!.find(squad => squad.squadId === saved.squadId)!.contribution = saved.contribution
    mission.personalSquad!.contribution = tracker.commandCheckpoint()
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!
    const resumed = new BattleStatsTracker(new CombatEventStream(), false, undefined, {}, careerOutpostCommandMeritPolicy(restored.activeOutpostMission!))
    onTestFinished(() => resumed.dispose())
    expect(resumed.snapshot([], { dead: false } as Player)).toEqual(snapshot)
    const claim = claimCareerOutpost(restored, mission.id, 'victory', resumed.snapshot([], { dead: false } as Player))
    expect(claim.meritAwarded).toBe(127)
    expect(claim.meritBreakdown).toMatchObject({ characterDamage: 3, kills: 24, victory: 80, survival: 20 })
    expect(store.save(claim.profile)).toBe(true)
    const duplicate = claimCareerOutpost(store.load()!, mission.id, 'victory', snapshot)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
  })
})
