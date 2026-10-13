import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from '../../src/career/CareerMissionState'
import type { Player } from '../../src/player/Player'
import { describe, expect, it } from 'vitest'
import { CAPTAIN_MISSION_CATALOG, CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_PATROL_COMMAND_ID, captainGateDefenseActorIds, captainGateDefenseBriefing, commanderGateDefenseSquads, createCaptainGateDefenseMission, createCaptainPatrolCommandMission, getCaptainMissionAvailability } from '../../src/career/CaptainMissionCatalog'
import { availableCareerMissionsForPage, careerMissionPage, defaultCareerMissionPage } from '../../src/career/CareerMissionCatalog'
import { acceptCaptainCavalryCommand } from '../../src/career/CavalrySweep'
import { acceptCaptainSiegeCommand, acceptEnemyTownAssault, siegeCommandSquads } from '../../src/career/EnemyTownAssault'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { claimCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { townAssaultObjectiveRoster, townRoster, withTownCommandSquadRoster } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'
import { officialActorSquadId, officialCommandSquads } from '../../src/career/CareerCommandAuthority'
import { DEFENSE_CAMPAIGN_TIMINGS } from '../../src/campaign/CampaignConfig'
import { buildCommanderAuthorityForMission } from '../../src/career/CommanderMissionAcceptance'
import { acceptVeteranMission } from '../../src/career/VeteranMission'

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
    expect(acceptCaptainSiegeCommand(profile, 'captain-siege')!.activeMission!.officialSquad?.actorIds).toHaveLength(rank === 'commander' ? 119 : 29)
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
  it.each(['roman', 'viking'] as const)('authorizes the complete %s North infantry plan including ranged infantry and the foot officer', faction => {
    const residents = withTownCommandSquadRoster(faction, townRoster())
    const ids = captainGateDefenseActorIds(residents)
    expect(ids).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `gate:north:${index}`),
      'melee_cavalry-0', 'melee_cavalry-4', 'lancer_cavalry-3', 'ranged_cavalry-2', 'ranged_cavalry-6',
      'ranged_infantry-0', 'ranged_infantry-4', 'ranged_infantry-8', 'ranged_infantry-12', 'ranged_infantry-16',
      'melee_infantry-0', 'melee_infantry-4', 'melee_infantry-8', 'spearman_infantry-2', 'spearman_infantry-6', 'deployment',
    ])
    expect(captainGateDefenseBriefing(residents)).toContain('北門 26 名')
    expect(captainGateDefenseBriefing(residents, new Set(ids.slice(0, 2)))).toContain('北門 24 名')
    expect(ids.filter(id => id.startsWith('gate:'))).toEqual(Array.from({ length: 10 }, (_, index) => `gate:north:${index}`))
    expect(captainGateDefenseActorIds(residents, new Set(ids))).toEqual([])
    expect(captainGateDefenseActorIds(residents.filter(actor => actor.id === 'gate:north:0'))).toEqual(['gate:north:0'])
  })
  it('does not truncate a North infantry plan larger than the former 30-person ceiling', () => {
    const guard = townRoster().find(actor => actor.id === 'gate:north:0')!
    const residents = Array.from({ length: 31 }, (_, index) => ({ ...guard, id: `north-full:${index}`, index }))
    expect(captainGateDefenseActorIds(residents)).toEqual(Array.from({ length: 31 }, (_, index) => `north-full:${index}`))
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

describe('Commander accepted production rosters without actor materialization', () => {
  const commander = (): CareerProfile => ({ ...captain(), rank: 'commander', totalMerit: 20000 })

  it.each([
    ['captain', [29]], ['commander', [29, 30]],
  ] as const)('%s retains the Cavalry Sweep production squads and borrowed actor identities', (rank, sizes) => {
    const borrowed = Array.from({ length: 59 }, (_, index) => `accepted-garrison:${index}`)
    const mission = acceptCaptainCavalryCommand({ ...commander(), rank }, 'grouped-sweep', borrowed)!.activeMission!
    const authority = mission.officialSquad!
    expect(officialCommandSquads(authority).map(squad => squad.actorIds.length)).toEqual(sizes)
    expect(authority.actorIds).toEqual(borrowed.slice(0, rank === 'commander' ? 59 : 29))
    expect(mission.friendlyActorIds).toEqual(borrowed)
    expect(mission.targetActorIds).toHaveLength(40)
    expect(authority.commandRank).toBe(rank === 'commander' ? 'commander' : undefined)
  })

  it.each(['roman', 'viking'] as const)('groups all 208 accepted %s military defenders by the actual four gates, excluding nonmilitary residents', faction => {
    const residents = withTownCommandSquadRoster(faction, townRoster())
    // Supplying civilian/service IDs must not turn shared Town allegiance into authority.
    const mission = createCaptainGateDefenseMission({ ...commander(), faction }, residents.map(actor => actor.id),
      residents.filter(actor => actor.role === 'civilian').map(actor => actor.id), residents, 'grouped-gates')
    const authority = mission.officialSquad!, squads = officialCommandSquads(authority)
    expect(authority.actorIds).toHaveLength(208)
    expect(new Set(authority.actorIds).size).toBe(208)
    expect([...authority.actorIds].sort()).toEqual(townAssaultObjectiveRoster(residents).map(actor => actor.id).sort())
    expect(squads.map(squad => squad.squadId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(squads.every(squad => squad.actorIds.length <= 30)).toBe(true)
    expect(authority.actorIds.filter(id => id.startsWith('town-eagle-rider:'))).toHaveLength(5)
    expect(authority.actorIds).not.toContain('merchant')
    expect(authority.actorIds).not.toContain('cat')
    for (const [gate, squad] of [['north', 1], ['south', 3], ['east', 5], ['west', 7]] as const) {
      expect(squads.find(group => group.squadId === squad)!.actorIds.filter(id => id.startsWith('gate:')))
        .toEqual(Array.from({ length: 10 }, (_, index) => `gate:${gate}:${index}`))
    }
  })

  it('excludes unavailable or unaccepted military without moving the remaining defenders between squads', () => {
    const residents = townRoster(), accepted = townAssaultObjectiveRoster(residents).map(actor => actor.id)
    const full = commanderGateDefenseSquads(residents, accepted)
    const unavailable = new Set(['captain', 'town-patrol:a:captain', 'town-eagle-rider:2'])
    const reduced = commanderGateDefenseSquads(residents, accepted.filter(id => id !== 'gate:south:0'), unavailable)
    expect(reduced.flatMap(squad => squad.actorIds)).toHaveLength(204)
    expect(reduced).toEqual(full.map(squad => ({ ...squad,
      actorIds: squad.actorIds.filter(id => !unavailable.has(id) && id !== 'gate:south:0'),
    })))
    const highMeritCaptain = createCaptainGateDefenseMission({ ...commander(), rank: 'captain' }, accepted, [], residents)
    expect(highMeritCaptain.officialSquad!.actorIds).toEqual(captainGateDefenseActorIds(residents))
    expect(highMeritCaptain.officialSquad!.commandRank).toBeUndefined()
  })

  it('keeps 90 Frontline defenders plus 50 pending reinforcements in separate stable waves at the original arrival time', () => {
    const profile = acceptCaptainFrontline(commander(), 'grouped-frontline')!, mission = profile.activeMission!
    const authority = mission.officialSquad!
    expect(officialCommandSquads(authority).map(squad => [squad.squadId, squad.actorIds.length]))
      .toEqual([[1, 30], [2, 30], [3, 30], [4, 30], [5, 20]])
    expect(authority.actorIds).toEqual([...mission.friendlyActorIds, ...mission.reinforcementActorIds!])
    expect(authority.actorIds).toHaveLength(140)
    expect(authority.squads![3].actorIds).toEqual(Array.from({ length: 30 }, (_, index) => `grouped-frontline:reinforcement:${index}`))
    expect(authority.squads![4].actorIds).toEqual(Array.from({ length: 20 }, (_, index) => `grouped-frontline:reinforcement:${index + 30}`))
    const launch = createCaptainFrontlineLaunch(profile)
    expect(launch.stageId).toBe(9)
    expect(DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds).toBe(120)
    const plan = createCaptainFrontlineSpawnPlan(launch, authority)
    expect(plan.npcSpecs).toHaveLength(90)
    expect(plan.npcSpecs.map(spec => spec.actorId)).toEqual(mission.friendlyActorIds)
    expect(plan.npcSpecs.map(spec => spec.squadId)).toEqual([...Array(30).fill(1), ...Array(30).fill(2), ...Array(30).fill(3)])
    expect(plan.npcSpecs.some(spec => mission.reinforcementActorIds!.includes(spec.actorId!))).toBe(false)
  })

  it('replays Frontline saved membership instead of regrouping actors after reload', () => {
    const profile = acceptCaptainFrontline(commander(), 'frontline-save')!, authority = profile.activeMission!.officialSquad!
    const first = authority.squads![0].actorIds[0], last = authority.squads![2].actorIds[0]
    authority.squads![0].actorIds[0] = last
    authority.squads![2].actorIds[0] = first
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, saved = loaded.activeMission!.officialSquad!
    expect(saved.squads).toEqual(authority.squads)
    const specs = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(loaded), saved).npcSpecs
    expect(specs.find(spec => spec.actorId === first)!.squadId).toBe(3)
    expect(specs.find(spec => spec.actorId === last)!.squadId).toBe(1)
  })

  it.each([1, 2] as const)('maps Siege roster version %i to saved actual actor identities in North/South/East/West order', rosterVersion => {
    const actorIds = Array.from({ length: 119 }, (_, index) => `saved-borrowed-or-spawned:${index}`)
    const squads = siegeCommandSquads('roman', actorIds, rosterVersion)
    expect(squads).toEqual([
      { squadId: 1, actorIds: actorIds.slice(0, 29) },
      { squadId: 2, actorIds: actorIds.slice(29, 59) },
      { squadId: 3, actorIds: actorIds.slice(59, 89) },
      { squadId: 4, actorIds: actorIds.slice(89, 119) },
    ])
    const mission = acceptCaptainSiegeCommand(commander(), 'grouped-siege')!.activeMission!
    expect(officialCommandSquads(mission.officialSquad!).map(squad => squad.actorIds.length)).toEqual([29, 30, 30, 30])
    expect(new Set(mission.officialSquad!.actorIds).size).toBe(119)
  })

  it('retains only one real squad for Patrol and Eagle without adding empty groups or private soldiers', () => {
    const profile = commander()
    profile.personalSquad = { members: [{ id: 'personal:extra', type: 'soldier' }] }
    const patrol = createCaptainPatrolCommandMission(profile, Array.from({ length: 20 }, (_, index) => `accepted-patrol:${index}`))
    const eagle = acceptCaptainEagle(profile, 'grouped-eagle')!.activeMission!
    for (const [mission, count] of [[patrol, 20], [eagle, 29]] as const) {
      expect(officialCommandSquads(mission.officialSquad!)).toEqual([{ squadId: 1, actorIds: mission.friendlyActorIds }])
      expect(mission.officialSquad!.actorIds).toHaveLength(count)
      expect(mission.officialSquad!.actorIds).not.toContain('personal:extra')
      expect(mission.personalSquad!.memberIds).toEqual(['personal:extra'])
    }
  })

  it('uses Veteran authored squads with distinct pending reinforcement groups at fresh Commander acceptance', () => {
    const profile = acceptVeteranMission(commander(), 'veteran-dread-outpost', { missionId: 'grouped-veteran' })!
    const mission = profile.activeMission!, authority = buildCommanderAuthorityForMission(profile, mission)!
    expect(officialCommandSquads(authority).map(squad => [squad.squadId, squad.actorIds.length]))
      .toEqual([[1, 24], [2, 25], [3, 25], [4, 25], [5, 25], [6, 25]])
    expect(new Set(authority.actorIds)).toEqual(new Set([...mission.friendlyActorIds, ...mission.reinforcementActorIds!]))
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![0])).toBe(5)
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![1])).toBe(6)
    expect(mission.officialSquad).toBeUndefined()
    expect(buildCommanderAuthorityForMission({ ...profile, rank: 'captain' }, mission)).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, kind: 'duel' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, phase: 'RETURNING' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, officialSquad: authority })).toBeUndefined()
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
