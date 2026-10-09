import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from '../../src/career/CareerMissionState'
import type { Player } from '../../src/player/Player'
import { describe, expect, it } from 'vitest'
import { CAPTAIN_MISSION_CATALOG, CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_PATROL_COMMAND_ID, captainGateDefenseActorIds, createCaptainPatrolCommandMission, getCaptainMissionAvailability } from '../../src/career/CaptainMissionCatalog'
import { availableCareerMissionsForPage, careerMissionPage, defaultCareerMissionPage } from '../../src/career/CareerMissionCatalog'
import { acceptCaptainCavalryCommand } from '../../src/career/CavalrySweep'
import { acceptCaptainSiegeCommand, acceptEnemyTownAssault } from '../../src/career/EnemyTownAssault'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { claimCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { townRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

const captain = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000, ownedMounts: ['horse', 'xongkoro'] })
const stats = { damageDealt: 200, damageTaken: 5, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }

describe('Captain mission eligibility and official roster policy without actor materialization', () => {
  it.each(['recruit', 'soldier', 'veteran'] as const)('%s cannot accept any Captain template even with ownership and merit', rank => {
    const profile = { ...captain(), rank }
    expect(availableCareerMissionsForPage(profile, 'captain')).toEqual([])
    for (const template of CAPTAIN_MISSION_CATALOG) expect(getCaptainMissionAvailability(profile, template.id).unlocked).toBe(false)
    expect(acceptCaptainCavalryCommand(profile)).toBeNull()
    expect(acceptCaptainSiegeCommand(profile)).toBeNull()
    expect(acceptCaptainFrontline(profile)).toBeNull()
    expect(acceptCaptainEagle(profile)).toBeNull()
  })
  it.each(['captain', 'commander'] as const)('%s opens all six independent Captain missions without relief or prior mission wins', rank => {
    const profile = { ...captain(), rank, totalMerit: 20000 }
    expect(availableCareerMissionsForPage(profile, 'captain')).toHaveLength(6)
    expect(defaultCareerMissionPage(profile)).toBe('captain')
    expect(CAPTAIN_MISSION_CATALOG.map(careerMissionPage)).toEqual(Array(6).fill('captain'))
    expect(acceptCaptainSiegeCommand(profile, 'captain-siege')!.activeMission!.officialSquad?.actorIds).toHaveLength(29)
    expect(acceptEnemyTownAssault(profile)).toBeNull()
  })
  it('requires actual Eagle ownership, independent of the selected mount', () => {
    const unowned = { ...captain(), ownedMounts: ['horse' as const], selectedMountId: 'xongkoro' as const }
    expect(getCaptainMissionAvailability(unowned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(false)
    expect(acceptCaptainEagle(unowned)).toBeNull()
    const owned = { ...captain(), selectedMountId: 'horse' as const }
    expect(getCaptainMissionAvailability(owned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(true)
    expect(acceptCaptainEagle(owned)!.selectedMountId).toBe('xongkoro')
  })
  it('uses existing North gate infantry and excludes unavailable residents without filling missing slots', () => {
    const residents = townRoster()
    const ids = captainGateDefenseActorIds(residents)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.length).toBeLessThanOrEqual(30)
    expect(ids.filter(id => id.startsWith('gate:'))).toEqual(Array.from({ length: 10 }, (_, index) => `gate:north:${index}`))
    expect(captainGateDefenseActorIds(residents, new Set(ids))).toEqual([])
    expect(captainGateDefenseActorIds(residents.filter(actor => actor.id === 'gate:north:0'))).toEqual(['gate:north:0'])
  })
  it.each([0, 1, 7, 30])('%i personal members remain extra troops outside every official roster', count => {
    const profile = captain()
    profile.personalSquad = { members: Array.from({ length: count }, (_, index) => ({ id: `personal:${index}`, type: 'soldier' as const })) }
    const sweep = acceptCaptainCavalryCommand(profile, 'sweep')!.activeMission!
    const siege = acceptCaptainSiegeCommand(profile, 'siege')!.activeMission!
    const frontline = acceptCaptainFrontline(profile, 'frontline')!
    const eagle = acceptCaptainEagle(profile, 'eagle')!
    expect(sweep.friendlyActorIds).toHaveLength(59)
    expect(sweep.targetActorIds).toHaveLength(40)
    expect(sweep.officialSquad?.actorIds).toEqual(sweep.friendlyActorIds.slice(0, 29))
    expect(siege.friendlyActorIds).toHaveLength(119)
    expect(frontline.activeMission!.friendlyActorIds).toHaveLength(90)
    expect(frontline.activeMission!.targetActorIds).toHaveLength(202)
    expect(frontline.activeMission!.reinforcementActorIds).toHaveLength(50)
    expect(frontline.activeMission!.officialSquad!.actorIds).toHaveLength(20)
    const plan = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(frontline))
    expect(plan.npcSpecs.filter(spec => spec.squadId === 1)).toHaveLength(20)
    expect(plan.npcSpecs.filter(spec => spec.squadId === 1).every(spec => spec.presetId === 'roman_heavy_infantry')).toBe(true)
    const air = createCaptainEagleSpawnPlan(eagle)
    expect(air.npcSpecs).toHaveLength(59)
    expect(air.npcSpecs.filter(spec => spec.characterFaction === 'roman')).toHaveLength(29)
    expect(air.npcSpecs.filter(spec => spec.characterFaction === 'viking')).toHaveLength(30)
    expect(air.npcSpecs.every(spec => spec.loadout?.mountId === 'xongkoro')).toBe(true)
    for (const mission of [sweep, siege, frontline.activeMission!, eagle.activeMission!]) {
      expect(mission.personalSquad?.memberIds.length ?? 0).toBe(count)
      expect(mission.friendlyActorIds.some(id => id.startsWith('personal:'))).toBe(false)
    }
    expect(profile.personalSquad.members.every(member => !member.equipment?.mount)).toBe(true)
  })
})

describe('Captain completion and authoritative save compatibility', () => {
  it.each(['patrol', 'frontline', 'eagle'] as const)('%s awards its inherited formula once and saves progress only to Tier 4', kind => {
    const profile = kind === 'frontline' ? acceptCaptainFrontline(captain(), 'claim')! : kind === 'eagle' ? acceptCaptainEagle(captain(), 'claim')! : captain()
    if (kind === 'patrol') profile.activeMission = createCaptainPatrolCommandMission(profile, ['patrol-captain'], 'claim')
    profile.careerMissionCompletionsByTier = { 1: 7, 2: 3, 3: 5 }
    const claimed = claimCareerMission(profile, 'claim', 'victory', stats)
    expect(claimed.meritAwarded).toBe(kind === 'patrol' ? 34 : 126)
    expect(claimed.profile.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 3, 3: 5, 4: 1 })
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(claimed.profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission?.templateId).toBe(kind === 'patrol' ? CAPTAIN_PATROL_COMMAND_ID : profile.activeMission!.templateId)
    const duplicate = claimCareerMission(loaded, 'claim', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(claimed.profile.totalMerit)
  })
  it('round-trips command membership, return checkpoints and hostility exclusion without sharing mutable state', () => {
    const profile = captain()
    profile.activeMission = createCaptainPatrolCommandMission(profile, ['patrol-captain', 'patrol-1'], 'patrol-save')
    profile.activeMission.patrolKilledActorIds = ['bandit-1', 'bandit-2']
    profile.activeMission.officialSquad!.contribution.damageDealt = 173
    profile.activeMission.officialSquad!.members = { 'patrol-1': { status: 'dead', hp: 0 }, 'patrol-captain': { status: 'deployed', hp: 37, ammo: 2, shieldImpact: 4, order: 'formation', position: { x: 5, y: 3, z: 7, yaw: 1 }, formation: { commandId: 14, reached: false, position: { x: 11, z: 12, yaw: 2 } }, mount: { hp: 23, mounted: false, position: { x: 6, z: 8, yaw: 1 } } } }
    profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: ['town-command-1'], contribution: { damageDealt: 10, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, state: 'RETURNING', authorized: false, sceneKey: 'town-home', members: { 'town-command-1': { status: 'deployed', hp: 21, order: 'formation', mount: { hp: 17, mounted: false, position: { x: 10, z: 11, yaw: 0 } } } } }
    profile.townEvent = { id: 'hostility', state: 'hostile', authorizedTownCommandActorIds: ['town-command-1'] }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission!.officialSquad).toEqual(profile.activeMission.officialSquad)
    expect(loaded.activeMission!.patrolKilledActorIds).toEqual(['bandit-1', 'bandit-2'])
    expect(loaded.townCommandSquad).toEqual(profile.townCommandSquad)
    expect(loaded.townEvent!.authorizedTownCommandActorIds).toEqual(['town-command-1'])
    const clone = cloneCareerProfile(loaded)
    clone.activeMission!.officialSquad!.members!['patrol-captain'].mount!.hp = 1
    clone.townCommandSquad!.members!['town-command-1'].hp = 1
    expect(loaded.activeMission!.officialSquad!.members!['patrol-captain'].mount!.hp).toBe(23)
    expect(loaded.townCommandSquad!.members!['town-command-1'].hp).toBe(21)
  })
  it('drops mismatched official mission authorization and does not grant it to old missions', () => {
    const profile = acceptCaptainCavalryCommand(captain(), 'current')!
    profile.activeMission!.officialSquad!.missionId = 'previous'
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.officialSquad).toBeUndefined()
    delete profile.activeMission!.officialSquad
    profile.activeMission!.templateId = 'career-cavalry-sweep'
    profile.careerMissionCompletionsByTier = { 1: 2, 2: 3, 3: 4 }
    expect(store.save(profile)).toBe(true)
    const old = store.load()!
    expect(old.activeMission!.templateId).toBe('career-cavalry-sweep')
    expect(old.activeMission!.officialSquad).toBeUndefined()
    expect(old.careerMissionCompletionsByTier).toEqual({ 1: 2, 2: 3, 3: 4 })
    expect(old.totalMerit).toBe(5000)
  })
})


describe('Career command incoming damage policy', () => {
  it('retains enemy damage taken by official squad without adding enemy attacks to Player merit', () => {
    const mission = acceptCaptainCavalryCommand(captain(), 'incoming')!.activeMission!
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event), {}, careerMissionCommandMeritPolicy(mission))
    try {
      events.emit({ type: 'damage_applied', method: 'melee', requestedDamage: 17, appliedDamage: 17,
        source: { actorId: mission.targetActorIds[0], actorType: 'npc', allegiance: 'BANDIT' as import('../../src/world/NPC').Faction, characterFaction: 'viking' },
        target: { targetId: mission.officialSquad!.actorIds[0], targetType: 'npc', name: 'Commanded rider', squadId: 1 } })
      // Snapshot reads only Player.dead; no actor construction is involved.
      const result = tracker.snapshot([], { dead: false } as Player)
      expect(result.squads.find(squad => squad.squadId === 1)!.damageTaken).toBe(17)
      expect(result.player.damageDealt).toBe(0)
      expect(result.meritPlayer!.damageDealt).toBe(0)
      expect(tracker.officialCommandCheckpoint().damageDealt).toBe(0)
    } finally { tracker.dispose() }
  })
})
