import { describe,expect,it,onTestFinished } from 'vitest'
import { acceptCareerOutpost,careerOutpostCommandMeritPolicy,claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import {
CombatEventStream,
type CombatActorRef,
type CombatTargetRef,
} from '../../src/combat/CombatAttribution'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import type { Player } from '../../src/player/Player'
import type { NPC } from '../../src/world/NPC'
import { Faction } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'

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
    tracker.registerNpc(townAlly as unknown as NPC, true)
    tracker.registerNpc(enemyWithSameSquad as unknown as NPC)

    const townSource: CombatActorRef = { ...squadSource(2), actorId: 'borrowed-captain', allegiance: Faction.TOWN }
    const collidingEnemySource: CombatActorRef = { ...squadSource(2), actorId: 'enemy-captain', allegiance: Faction.ENEMY }
    const townTarget: CombatTargetRef = { ...npcTarget('borrowed-captain', 2), allegiance: Faction.TOWN }
    const collidingEnemyTarget: CombatTargetRef = { ...npcTarget('enemy-captain', 2), allegiance: Faction.ENEMY }
    events.emit({ type: 'damage_applied', source: townSource, target: npcTarget('enemy-1'), method: 'melee', requestedDamage: 7, appliedDamage: 7 })
    events.emit({ type: 'damage_applied', source: collidingEnemySource, target: npcTarget('enemy-2'), method: 'melee', requestedDamage: 13, appliedDamage: 13 })
    events.emit({ type: 'damage_applied', source: collidingEnemySource, target: townTarget, method: 'melee', requestedDamage: 11, appliedDamage: 11 })
    events.emit({ type: 'damage_applied', source: playerSource(), target: collidingEnemyTarget, method: 'melee', requestedDamage: 17, appliedDamage: 17 })

    const snapshot = tracker.snapshot([townAlly, enemyWithSameSquad] as unknown as NPC[], { dead: false } as Player)
    expect(snapshot.squads).toEqual([expect.objectContaining({
      squadId: 2, damageDealt: 7, damageTaken: 11, startingMembers: 1, survivors: 1, casualties: 0,
    })])
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

    expect(tracker.snapshot([], { dead: false } as Player).player.damageDealt).toBe(0)
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
