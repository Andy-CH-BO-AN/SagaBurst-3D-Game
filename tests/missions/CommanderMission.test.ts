import { describe, expect, it } from 'vitest'
import { officialActorSquadId, officialCommandAcceptsActor } from '../../src/career/CareerCommandAuthority'
import { claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptCommanderMission, availableCommanderMissions, COMMANDER_DECAPITATION_ID, COMMANDER_FORMER_COMMANDER_SLOT, COMMANDER_LAST_STAND_ID, COMMANDER_SKY_RAID_ID, recordCommanderObjectiveDeath } from '../../src/career/CommanderMissionCatalog'
import { remainingCommanderAttackers } from '../../src/career/CommanderOutpost'
import { type CombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/combat/CombatFaction'
import { MemoryStorage } from '../helpers/memoryStorage'

function commander(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  const profile = createCareerProfile(faction)
  profile.rank = 'commander'
  profile.totalMerit = 20_000
  profile.availableMerit = 20_000
  return profile
}

function accepted(templateId: string, faction: 'roman' | 'viking' = 'roman', personal = false): CareerProfile {
  const profile = commander(faction)
  if (personal) profile.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
  const next = acceptCommanderMission(profile, templateId, `test:${templateId}`)
  if (!next?.activeMission) throw new Error(`Could not accept ${templateId}`)
  return next
}

function source(overrides: Partial<CombatActorRef> = {}): CombatActorRef {
  return {
    actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman',
    ...overrides,
  }
}

function killed(by: CombatActorRef, targetId: string, targetType: 'npc' | 'mount' = 'npc'): CombatEvent {
  return {
    type: 'actor_killed', source: by,
    target: { targetId, targetType, name: targetId, allegiance: Faction.ENEMY, characterFaction: 'viking' },
    method: 'melee',
  }
}

describe('Commander mission board policy', () => {

  it('records repeatable Tier 5 victories once and makes every mission available again after return', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID)
    const missionId = profile.activeMission!.id
    const stats = { damageDealt: 20, damageTaken: 0, kills: 1, structureDamage: 0,
      structuresDestroyed: 0, gateBreaches: 0, survived: true }

    const first = claimCareerMission(profile, missionId, 'victory', stats)
    expect(first.profile.careerMissionCompletionsByTier?.[5]).toBe(1)
    expect(first.profile.completedCareerMissionTemplateIds).toContain(COMMANDER_SKY_RAID_ID)
    expect(claimCareerMission(first.profile, missionId, 'victory', { ...stats, damageDealt: 999 }).alreadyClaimed).toBe(true)

    const returned = clearCareerMission(first.profile, missionId)
    expect(availableCommanderMissions(returned)).toHaveLength(3)
  })
})

describe('Commander mission roster contracts', () => {

  it('keeps every command squad usable when its first roster member is dead', () => {
    const mission = accepted(COMMANDER_LAST_STAND_ID).activeMission!
    const authority = mission.officialSquad!
    for (const squad of authority.squads!) {
      authority.members = { ...authority.members, [squad.actorIds[0]]: { status: 'dead', hp: 0 } }
      const survivorId = squad.actorIds[1]
      expect(officialCommandAcceptsActor(authority, {
        combatantId: survivorId, squadId: officialActorSquadId(authority, survivorId), faction: Faction.PLAYER,
        combatOwnership: 'mission-official', dead: false,
      })).toBe(true)
    }
  })
})

describe('Commander objective, merit and persistence', () => {

  it('deduplicates native NPC deaths and accepts only Player, official, or accepted HR sources', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID, 'roman', true)
    const mission = profile.activeMission!
    const targets = mission.targetActorIds
    const officialId = mission.friendlyActorIds[0]
    const official = source({ actorId: officialId, actorType: 'npc', allegiance: Faction.TOWN,
      ownership: 'mission-official', squadId: officialActorSquadId(mission.officialSquad!, officialId) })
    const personal = source({ actorId: 'personal:hr-1', actorType: 'npc', ownership: 'player-personal', squadId: 'personal' })

    expect(recordCommanderObjectiveDeath(mission, killed(source(), targets[0]))).toBe(true)
    expect(recordCommanderObjectiveDeath(mission, killed(source(), targets[0]))).toBe(false)
    expect(recordCommanderObjectiveDeath(mission, killed(official, targets[1]))).toBe(true)
    expect(recordCommanderObjectiveDeath(mission, killed(personal, targets[2]))).toBe(true)
    expect(recordCommanderObjectiveDeath(mission, killed(source({ actorId: 'resident', actorType: 'npc' }), targets[3]))).toBe(false)
    expect(recordCommanderObjectiveDeath(mission, killed(source(), 'bandit:not-native'))).toBe(false)
    expect(recordCommanderObjectiveDeath(mission, killed(source(), targets[4], 'mount'))).toBe(false)
    expect(mission.deadTargetActorIds).toEqual(targets.slice(0, 3))
  })

  it('completes Decapitation only for the enemy Commander identity, never a guard or former Commander', () => {
    const mission = accepted(COMMANDER_DECAPITATION_ID).activeMission!
    const formerId = mission.friendlyActorIds[0]
    expect(formerId).toContain(COMMANDER_FORMER_COMMANDER_SLOT)
    expect(formerId).not.toBe(mission.targetActorIds[0])

    expect(recordCommanderObjectiveDeath(mission, killed(source(), 'melee_infantry-0'))).toBe(false)
    expect(recordCommanderObjectiveDeath(mission, killed(source(), formerId))).toBe(false)
    expect(recordCommanderObjectiveDeath(mission, killed(source(), 'commander'))).toBe(true)
    expect(mission.deadTargetActorIds).toEqual(['commander'])
  })

  it('round-trips deployment, actor, authority and Tier 5 state through real storage JSON', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID, 'viking', true)
    const mission = profile.activeMission!
    const targetId = mission.targetActorIds[0]
    const friendlyId = mission.friendlyActorIds[0]
    mission.commanderMission = { ...mission.commanderMission!, deploymentComplete: true,
      playerPosition: { x: 12, z: -34, yaw: 1.25 } }
    mission.deadTargetActorIds = [targetId]
    mission.actorHealth = { [targetId]: { hp: 0 }, [friendlyId]: { hp: 73, mountHp: 42 } }
    mission.actorPositions = { [friendlyId]: { x: 4, z: 5, yaw: .75 } }
    mission.officialSquad!.members = { [friendlyId]: { status: 'deployed', hp: 73 } }
    profile.careerMissionCompletionsByTier = { 1: 2, 5: 3 }

    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!
    expect(restored.activeMission).toMatchObject({ id: mission.id, deadTargetActorIds: [targetId] })
    expect(restored.activeMission?.commanderMission).toEqual(mission.commanderMission)
    expect(restored.activeMission?.actorHealth?.[friendlyId]).toEqual({ hp: 73, mountHp: 42 })
    expect(restored.activeMission?.actorPositions?.[friendlyId]).toEqual({ x: 4, z: 5, yaw: .75 })
    expect(restored.activeMission?.officialSquad?.members?.[friendlyId]).toMatchObject({ status: 'deployed', hp: 73 })
    expect(restored.careerMissionCompletionsByTier?.[5]).toBe(3)

    const legacy = createCareerProfile('roman')
    expect(parseCareerProfile(JSON.parse(JSON.stringify(legacy)))).toMatchObject({ rank: 'recruit', faction: 'roman' })
  })
})


describe('Last Stand stable objective recovery', () => {

  it('counts missing and queued IDs until all 100 unique riders die, ignoring mount deaths and unrelated actors', () => {
    const mission = accepted(COMMANDER_LAST_STAND_ID).activeMission!
    expect(remainingCommanderAttackers(mission, [])).toBe(100)
    const actors = mission.targetActorIds.map(id => ({ combatantId: id, dead: true }))
    expect(remainingCommanderAttackers(mission, actors.slice(0, 99))).toBe(1)
    expect(remainingCommanderAttackers(mission, [...actors.slice(0, 99), { combatantId: 'mount', dead: true }])).toBe(1)
    expect(remainingCommanderAttackers(mission, actors)).toBe(0)
  })
})
