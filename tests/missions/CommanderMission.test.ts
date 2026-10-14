import { describe, expect, it } from 'vitest'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { validateDefenseCampaignLaunchConfig } from '../../src/campaign/DefenseCampaignLaunch'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream, type CombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/combat/CombatFaction'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../../src/battle/HeroCombatProfile'
import { officialActorSquadId, officialCommandAcceptsActor } from '../../src/career/CareerCommandAuthority'
import {
  availableCareerMissionsForPage,
  careerMissionTemplatesForPage,
  isCareerMissionPageUnlocked,
} from '../../src/career/CareerMissionCatalog'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy, resolveCareerMissionOutcome } from '../../src/career/CareerMissionState'
import { calculateMerit } from '../../src/career/MeritCalculator'
import {
  acceptCommanderMission,
  availableCommanderMissions,
  COMMANDER_DECAPITATION_ID,
  COMMANDER_FORMER_COMMANDER_SLOT,
  COMMANDER_LAST_STAND_ID,
  COMMANDER_MISSION_CATALOG,
  COMMANDER_SKY_RAID_ID,
  createDecapitationRoster,
  createLastStandRoster,
  createSkyRaidRoster,
  getCommanderMissionAvailability,
  recordCommanderObjectiveDeath,
  skyRaidNativeActorIds,
} from '../../src/career/CommanderMissionCatalog'
import { createCareerCommanderOutpostLaunch, createCareerCommanderOutpostSpawnPlan } from '../../src/career/CommanderOutpost'
import { careerTownSceneRoster } from '../../src/career/CareerFieldSceneContext'
import { claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import type { Player } from '../../src/player/Player'
import { shouldSpawnTownCommander, townCommanderHeroAsset, townCommanderSpec } from '../../src/town/TownCommander'
import { townRoster } from '../../src/town/TownRules'
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

function damage(by: CombatActorRef, targetId: string, appliedDamage: number): CombatEvent {
  return {
    type: 'damage_applied', source: by,
    target: { targetId, targetType: 'npc', name: targetId, allegiance: Faction.ENEMY, characterFaction: 'viking' },
    method: 'melee', requestedDamage: appliedDamage, appliedDamage,
  }
}

describe('Commander mission board policy', () => {
  it('shows all three Tier 5 entries but unlocks them only after formal Commander appointment', () => {
    const highMeritCaptain = commander()
    highMeritCaptain.rank = 'captain'

    expect(COMMANDER_MISSION_CATALOG).toHaveLength(3)
    expect(COMMANDER_MISSION_CATALOG.map(mission => mission.name)).toEqual([
      'Commander I · Sky Raid · 空襲敵城',
      'Commander II · Operation Decapitation · 斬首行動',
      'Commander III · Outpost Last Stand · 前哨決戰',
    ])
    expect(careerMissionTemplatesForPage(highMeritCaptain, 'commander')).toHaveLength(3)
    expect(isCareerMissionPageUnlocked(highMeritCaptain, 'commander')).toBe(false)
    expect(availableCareerMissionsForPage(highMeritCaptain, 'commander')).toEqual([])
    expect(getCommanderMissionAvailability(highMeritCaptain, COMMANDER_SKY_RAID_ID)).toMatchObject({ unlocked: false })

    const appointed = commander()
    expect(isCareerMissionPageUnlocked(appointed, 'commander')).toBe(true)
    expect(availableCommanderMissions(appointed).map(mission => mission.id)).toEqual([
      COMMANDER_SKY_RAID_ID, COMMANDER_DECAPITATION_ID, COMMANDER_LAST_STAND_ID,
    ])
    const busy = accepted(COMMANDER_SKY_RAID_ID)
    expect(availableCommanderMissions(busy)).toEqual([])
  })

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
  it('builds Sky Raid as two 25-rider T4 Ranger/xongkoro squads', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID, 'roman', true)
    const mission = profile.activeMission!
    const roster = createSkyRaidRoster(mission, 'roman')

    expect(roster).toHaveLength(50)
    expect(roster.every(spec => spec.tier === 4 && spec.presetId === 'roman_archer'
      && spec.loadout?.mountId === 'xongkoro' && spec.cavalry)).toBe(true)
    expect(roster.filter(spec => spec.squadId === 1)).toHaveLength(25)
    expect(roster.filter(spec => spec.squadId === 2)).toHaveLength(25)
    expect(roster.map(spec => spec.actorId)).toEqual(mission.friendlyActorIds)
    expect(mission.friendlyActorIds).not.toContain('player')
    expect(mission.personalSquad?.memberIds).toEqual(['personal:hr-1'])
    expect(mission.friendlyActorIds).not.toContain('personal:hr-1')
  })

  it.each([
    ['roman', 'corgi', 'roman-commander'],
    ['viking', 'black-cat', 'viking-commander'],
  ] as const)('builds %s Decapitation with one T5 Commander profile and the exact 29 T4 cavalry mix',
    (faction, mountId, commanderProfile) => {
      const mission = accepted(COMMANDER_DECAPITATION_ID, faction).activeMission!
      const roster = createDecapitationRoster(mission, faction)
      const escorts = roster.slice(1)

      expect(roster).toHaveLength(30)
      expect(roster[0]).toMatchObject({ combatProfileId: commanderProfile, tier: 4, squadId: 1 })
      expect(roster.every(spec => spec.tier === 4 && spec.cavalry && spec.loadout?.mountId === mountId)).toBe(true)
      expect(escorts.filter(spec => spec.presetId === `${faction}_lancer`)).toHaveLength(10)
      expect(escorts.filter(spec => spec.presetId === `${faction}_sword_cavalry`)).toHaveLength(10)
      expect(escorts.filter(spec => spec.presetId === `${faction}_horse_archer`)).toHaveLength(9)
      expect(new Set(roster.map(spec => spec.actorId)).size).toBe(30)
    })

  it.each(['roman', 'viking'] as const)('builds %s Last Stand with exact foot defenders and mounted attacker tiers', faction => {
    const mission = accepted(COMMANDER_LAST_STAND_ID, faction).activeMission!
    const { friendly, enemy } = createLastStandRoster(mission, faction)
    const enemyFaction = faction === 'roman' ? 'viking' : 'roman'

    expect(friendly).toHaveLength(120)
    expect(friendly.every(spec => !spec.cavalry && spec.loadout?.mountId == null)).toBe(true)
    for (const [index, presetId] of [
      faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker',
      `${faction}_spearman`, `${faction}_archer`, `${faction}_archer`,
    ].entries()) {
      const squad = friendly.filter(spec => spec.squadId === index + 1)
      expect(squad).toHaveLength(30)
      expect(squad.filter(spec => spec.tier === 4)).toHaveLength(1)
      expect(squad.filter(spec => spec.tier === 3)).toHaveLength(29)
      expect(squad.every(spec => spec.presetId === presetId)).toBe(true)
    }

    expect(enemy).toHaveLength(100)
    expect(enemy.every(spec => spec.cavalry && spec.faction === Faction.ENEMY)).toBe(true)
    const groups = [
      { squadId: 5, presetId: `${enemyFaction}_lancer`, t3: 48, t4: 2 },
      { squadId: 6, presetId: `${enemyFaction}_sword_cavalry`, t3: 24, t4: 1 },
      { squadId: 7, presetId: `${enemyFaction}_horse_archer`, t3: 24, t4: 1 },
    ]
    for (const group of groups) {
      const units = enemy.filter(spec => spec.squadId === group.squadId)
      expect(units.every(spec => spec.presetId === group.presetId)).toBe(true)
      expect(units.filter(spec => spec.tier === 3 && spec.loadout?.mountId === 'horse')).toHaveLength(group.t3)
      expect(units.filter(spec => spec.tier === 4 && spec.loadout?.mountId === (enemyFaction === 'roman' ? 'corgi' : 'black-cat'))).toHaveLength(group.t4)
    }
  })

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
  it('admits every native Enemy Town role and reaches Sky Raid victory only on the 100th distinct death', () => {
    const mission = accepted(COMMANDER_SKY_RAID_ID).activeMission!
    const native = skyRaidNativeActorIds()
    expect(native).toEqual(expect.arrayContaining([
      'melee_infantry-0', 'civilian-0', 'merchant', 'commander', 'town-patrol:a:0',
    ]))
    mission.targetActorIds = native

    for (const targetId of native.slice(0, 99)) {
      expect(recordCommanderObjectiveDeath(mission, killed(source(), targetId))).toBe(true)
    }
    expect(mission.deadTargetActorIds).toHaveLength(99)
    expect(resolveCareerMissionOutcome(false, true, 1, mission.friendlyActorIds.length, false)).toBeNull()

    expect(recordCommanderObjectiveDeath(mission, killed(source(), native[99]))).toBe(true)
    expect(mission.deadTargetActorIds).toHaveLength(100)
    expect(resolveCareerMissionOutcome(true, true, 0, 0, true)).toBe('victory')
  })

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

  it.each([
    ['roman', 'viking'],
    ['viking', 'roman'],
  ] as const)('wires a unique real %s Enemy Town Commander profile and restores one %s home identity',
    (playerFaction, enemyFaction) => {
      const profile = accepted(COMMANDER_DECAPITATION_ID, playerFaction)
      const mission = profile.activeMission!
      const population = [...townRoster(), townCommanderSpec({ x: 20, z: 10, yaw: 0 })]
      const enemyCommander = careerTownSceneRoster(profile, population)
        .find(entry => entry.spec.id === 'commander')!
      const asset = townCommanderHeroAsset(enemyCommander.characterFaction)

      expect(enemyCommander).toMatchObject({ allegiance: Faction.ENEMY, characterFaction: enemyFaction })
      expect(asset).toBe(`${enemyFaction}-hero-t5`)
      expect(HERO_COMBAT_PROFILE_BY_ASSET[asset]).toBe(`${enemyFaction}-commander`)
      expect(mission.friendlyActorIds[0]).not.toBe(enemyCommander.spec.id)

      const returned = clearCareerMission(profile, mission.id)
      expect(returned.activeMission).toBeUndefined()
      expect(returned.townCommanderRecovery).toBeUndefined()
      expect(shouldSpawnTownCommander(returned)).toBe(true)
      expect([...townRoster(), townCommanderSpec({ x: 20, z: 10, yaw: 0 })]
        .filter(spec => spec.id === 'commander')).toHaveLength(1)
    })

  it('merges Player, official and HR merit once while keeping Player stats personal', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID, 'roman', true)
    const mission = profile.activeMission!
    mission.phase = 'ATTACKING'
    const targetId = mission.targetActorIds[0]
    const officialId = mission.friendlyActorIds[0]
    const actors = [
      source(),
      source({ actorId: officialId, actorType: 'npc', allegiance: Faction.TOWN,
        ownership: 'mission-official', squadId: officialActorSquadId(mission.officialSquad!, officialId) }),
      source({ actorId: 'personal:hr-1', actorType: 'npc', ownership: 'player-personal', squadId: 'personal' }),
    ]
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event), {},
      careerMissionCommandMeritPolicy(mission))
    for (const [index, actor] of actors.entries()) {
      events.emit(damage(actor, targetId, (index + 1) * 20))
      events.emit(killed(actor, targetId))
    }
    events.emit(damage(source({ actorId: 'unowned', actorType: 'npc' }), targetId, 1_000))

    const snapshot = tracker.snapshot([], { dead: false } as Player)
    tracker.dispose()
    expect(snapshot.player).toMatchObject({ damageDealt: 20, kills: 1 })
    expect(snapshot.meritPlayer).toMatchObject({ damageDealt: 120, kills: 3 })

    const claimed = claimCareerMission(profile, mission.id, 'victory', snapshot.player, snapshot.meritPlayer)
    const expected = calculateMerit({ player: snapshot.meritPlayer!, squads: [] }, 'victory', 'offense', 'mission')
    expect(claimed.meritAwarded).toBe(expected.total)
    expect(claimed.profile.lifetimeStats).toMatchObject({ damage: 20, kills: 1 })
    expect(claimed.profile.activeMission?.result?.meritStats).toMatchObject({ damageDealt: 120, kills: 3 })
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

  it('prioritizes objective victory and otherwise waits for both official and HR survivors to be gone', () => {
    expect(resolveCareerMissionOutcome(true, true, 0, 0, true)).toBe('victory')
    expect(resolveCareerMissionOutcome(true, true, 1, 1, false)).toBeNull()
    expect(resolveCareerMissionOutcome(true, true, 1, 0, false)).toBe('failure')
    expect(resolveCareerMissionOutcome(false, true, 1, 0, false)).toBeNull()
    expect(resolveCareerMissionOutcome(true, false, 0, 0, true)).toBeNull()
  })
})

describe('Commander Last Stand launch', () => {
  it.each(['roman', 'viking'] as const)('pre-spawns all %s formations around the home Outpost with locked capabilities', faction => {
    const profile = accepted(COMMANDER_LAST_STAND_ID, faction)
    const launch = createCareerCommanderOutpostLaunch(profile)
    const plan = createCareerCommanderOutpostSpawnPlan(launch)
    const placement = getCampaignOutpostPlacement(faction)
    const inward = Math.sign(placement.backZ - placement.frontZ)
    const friendlies = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    const enemies = plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)

    expect(validateDefenseCampaignLaunchConfig(launch)).toEqual({ valid: true, errors: [] })
    expect(launch).toMatchObject({ stageId: 9, deploymentSeconds: 60, commandGrouping: 'squad',
      capabilities: { reinforcementsEnabled: false, playerCommandsEnabled: true,
        gateControlEnabled: false, attackerHeroesEnabled: false } })
    expect(friendlies).toHaveLength(120)
    expect(enemies).toHaveLength(100)
    expect(friendlies.every(spec => (spec.z - placement.frontZ) * inward > 0)).toBe(true)
    expect(enemies.every(spec => (spec.z - placement.frontZ) * inward < 0)).toBe(true)
    expect(new Set(enemies.map(spec => spec.squadId))).toEqual(new Set([5, 6, 7]))
    expect((plan.playerSpawn.z - placement.frontZ) * inward).toBeGreaterThan(0)
  })

  it('rejects altered stage, timeline, grouping, capability and mixed Career markers', () => {
    const valid = createCareerCommanderOutpostLaunch(accepted(COMMANDER_LAST_STAND_ID))
    const variants = [
      { ...valid, stageId: 8 as const },
      { ...valid, deploymentSeconds: 59 },
      { ...valid, commandGrouping: 'preset' as const },
      { ...valid, capabilities: { ...valid.capabilities, reinforcementsEnabled: true } },
      { ...valid, careerVeteranOutpost: {
        missionId: valid.careerMissionId!, templateId: 'veteran-dread-outpost' as const,
        missionKind: 'veteran-outpost-defense' as const, playerFaction: 'roman' as const,
        outpostFaction: 'roman' as const, runtimeState: valid.careerCommanderOutpost!.runtimeState,
        reinforcementDelaySeconds: 90, assaultChargeDistanceMeters: 50,
      } },
    ]
    for (const variant of variants) expect(validateDefenseCampaignLaunchConfig(variant).valid).toBe(false)
  })
})
