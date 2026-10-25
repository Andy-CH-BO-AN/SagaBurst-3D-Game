import { CareerBridgeBattleRuntime, createCareerBridgeSpawnPlan, createCareerBridgeOrphanMountPlan, commitCareerBridgeBattleResult, recoverClaimedCareerBridgeBattle } from '../../src/career/CareerBridgeBattle'
import { COMMANDER_BRIDGEHEAD_ID, createBridgeheadRoster } from '../../src/career/CommanderMissionCatalog'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { officialActorSquadId, officialCommandAcceptsActor } from '../../src/career/CareerCommandAuthority'
import { claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptCommanderMission, availableCommanderMissions, COMMANDER_DECAPITATION_ID, COMMANDER_FORMER_COMMANDER_SLOT, COMMANDER_LAST_STAND_ID, COMMANDER_SKY_RAID_ID, recordCommanderObjectiveDeath } from '../../src/career/CommanderMissionCatalog'
import { remainingCommanderAttackers } from '../../src/career/CommanderOutpost'
import { CombatEventStream, type CombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from '../../src/career/CareerMissionState'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import type { Scene } from 'three'
import { Faction } from '../../src/combat/CombatFaction'
import { MemoryStorage } from '../helpers/memoryStorage'
import { Box3, Vector3 } from 'three'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { needsDecapitationDeployment, planDecapitationDeployment } from '../../src/career/CommanderDecapitationDeployment'
import { eagleLandingFootprint, isEagleLandingClear } from '../../src/world/EagleLanding'
import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds, advanceCommanderFourGateDefenseCombat, advanceCommanderFourGateDefensePreparation, createCommanderFourGateDefenseState } from '../../src/career/CommanderFourGateDefenseState'
import { ActiveMissionClock } from '../../src/career/ActiveMissionClock'

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
    expect(availableCommanderMissions(returned)).toHaveLength(5)
  })

  it('holds the full preparation time until native deployment is ready and records spawn intent once before creating enemies', () => {
    const deploying = createCommanderFourGateDefenseState()
    expect(advanceCommanderFourGateDefensePreparation(deploying, 400, true)).toBe(deploying)
    const ready = { ...deploying, phase: 'PREPARING' as const }
    expect(advanceCommanderFourGateDefensePreparation(ready, 400, false)).toBe(ready)
    expect(ready.preparationRemainingSeconds).toBe(180)
    const preparing = advanceCommanderFourGateDefensePreparation(ready, 179.75, true)
    expect(preparing).toMatchObject({ phase: 'PREPARING', attackStarted: false, preparationRemainingSeconds: .25 })
    const resumed = JSON.parse(JSON.stringify(preparing)) as typeof preparing
    const spawning = advanceCommanderFourGateDefensePreparation(resumed, .25, true)
    expect(spawning).toMatchObject({ phase: 'SPAWNING', attackStarted: false, deploymentComplete: false,
      preparationRemainingSeconds: 0, registeredTargetActorIds: [], actors: {} })
    expect(spawning.siege).toBeUndefined()
    expect(advanceCommanderFourGateDefensePreparation(spawning, 100, true)).toBe(spawning)
    expect(ready.preparationRemainingSeconds).toBe(180)
  })

  it('counts only ready formal combat through the survival deadline and freezes the result clock', () => {
    const initial = createCommanderFourGateDefenseState()
    expect(advanceCommanderFourGateDefenseCombat(initial, survivalSeconds, true)).toBe(initial)
    const preparing = { ...initial, phase: 'PREPARING' as const }
    expect(advanceCommanderFourGateDefenseCombat(preparing, survivalSeconds, true)).toBe(preparing)
    const spawning = { ...preparing, phase: 'SPAWNING' as const, preparationRemainingSeconds: 0 }
    expect(advanceCommanderFourGateDefenseCombat(spawning, survivalSeconds, true)).toBe(spawning)
    const attacking = { ...spawning, phase: 'ATTACKING' as const, attackStarted: true, deploymentComplete: true }
    expect(advanceCommanderFourGateDefenseCombat(attacking, survivalSeconds, false)).toBe(attacking)
    expect(advanceCommanderFourGateDefenseCombat(attacking, Infinity, true)).toBe(attacking)
    expect(advanceCommanderFourGateDefenseCombat(attacking, -1, true)).toBe(attacking)
    const nearDeadline = advanceCommanderFourGateDefenseCombat(attacking, survivalSeconds - .1, true)
    expect(nearDeadline.combatElapsedSeconds).toBe(survivalSeconds - .1)
    const resumed = JSON.parse(JSON.stringify(nearDeadline)) as typeof nearDeadline
    const deadline = advanceCommanderFourGateDefenseCombat(resumed, .1, true)
    expect(deadline.combatElapsedSeconds).toBe(survivalSeconds)
    expect(advanceCommanderFourGateDefenseCombat(deadline, 10, true)).toBe(deadline)
    const result = { ...nearDeadline, phase: 'RESULT' as const }
    expect(advanceCommanderFourGateDefenseCombat(result, 10, true)).toBe(result)
    expect(attacking.combatElapsedSeconds).toBe(0)
  })

  it('uses 180 active seconds at low frame rate while excluding paused, hidden and reload gaps', () => {
    let clock = new ActiveMissionClock(), now = 0, state = createCommanderFourGateDefenseState()
    state.phase = 'PREPARING'
    expect(clock.advance(now, true)).toBe(0)
    const frame = () => { now += 100; state = advanceCommanderFourGateDefensePreparation(state, clock.advance(now, true), true) }
    for (let i = 0; i < 600; i++) frame()
    expect(state.preparationRemainingSeconds).toBeCloseTo(120)
    now += 100; expect(clock.advance(now, false)).toBe(0)
    now = 900_000; expect(clock.advance(now, false)).toBe(0)
    now += 100; expect(clock.advance(now, true)).toBe(0)
    for (let i = 0; i < 600; i++) frame()
    expect(state.preparationRemainingSeconds).toBeCloseTo(60)
    clock.reset() // The real visibility/focus hook resets even when RAF has stopped.
    now = 2_000_000; expect(clock.advance(now, true)).toBe(0)
    frame()
    state = JSON.parse(JSON.stringify(state)) as typeof state
    clock = new ActiveMissionClock()
    now = 3_000_000; expect(clock.advance(now, true)).toBe(0)
    expect(state.preparationRemainingSeconds).toBeCloseTo(59.9)
    for (let i = 0; i < 599; i++) frame()
    expect(state).toMatchObject({ phase: 'SPAWNING', preparationRemainingSeconds: 0, attackStarted: false })
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
  it('starts an enemy-town mission without charging native residents or borrowing their autonomous update ownership', () => {
    let profile = accepted(COMMANDER_DECAPITATION_ID)
    profile.activeMission!.commanderMission!.deploymentComplete = true
    const npc = { combatantId: 'commander', dead: false, faction: Faction.ENEMY,
      beginExternalThreat: vi.fn(), setMissionCombatTarget: vi.fn(), setTacticalOrder: vi.fn() }
    const spec: TownActorSpec = { ...townRoster()[0], id: 'commander', role: 'commander' }
    // No jobs are materialized and no scene, Player or NPC constructor is used.
    const controller = new CommanderTownMissionController(null as unknown as Scene,
      [{ spec, npc: npc as unknown as NPC }], () => ({}) as Player,
      () => profile, next => { profile = next; return true }, {} as NavigationWorld, new NpcSpawnScheduler())
    onTestFinished(() => controller.dispose())
    expect(controller.startActiveMission()).toBe(true)
    expect(npc.beginExternalThreat).not.toHaveBeenCalled()
    expect(npc.setTacticalOrder).not.toHaveBeenCalled()
    expect(controller.fieldNpcs).not.toContain(npc)
  })

  it('records 100 distinct native losses without crediting background kills or accepting unrelated actors', () => {
    const profile = accepted(COMMANDER_SKY_RAID_ID), mission = profile.activeMission!
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event),
      undefined, careerMissionCommandMeritPolicy(mission))
    onTestFinished(() => tracker.dispose())
    const unsubscribe = events.subscribe(event => recordCommanderObjectiveDeath(mission, event))
    onTestFinished(unsubscribe)
    const background = source({ actorId: 'outskirts:cavalry:a:g0:0', actorType: 'npc', allegiance: Faction.TOWN })
    events.emit(killed(background, 'bandit:not-native'))
    events.emit(killed(background, mission.targetActorIds[100], 'mount'))
    for (const id of mission.targetActorIds.slice(0, 100)) events.emit(killed(background, id))
    events.emit(killed(background, mission.targetActorIds[0]))
    expect(mission.deadTargetActorIds).toHaveLength(100)
    expect(tracker.checkpoint().kills).toBe(0)
    expect(tracker.officialCommandCheckpoint()?.kills ?? 0).toBe(0)
    expect(tracker.commandCheckpoint()?.kills ?? 0).toBe(0)
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(restored.activeMission?.deadTargetActorIds).toEqual(mission.targetActorIds.slice(0, 100))
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
    const profile = accepted(COMMANDER_DECAPITATION_ID, 'viking', true)
    const mission = profile.activeMission!
    const targetId = mission.targetActorIds[0]
    const friendlyId = mission.friendlyActorIds[0]
    mission.commanderMission = { ...mission.commanderMission!, deploymentComplete: true,
      playerPosition: { x: 12, z: -34, yaw: 1.25 } }
    mission.deadTargetActorIds = [targetId]
    mission.actorHealth = { [targetId]: { hp: 0 }, [friendlyId]: { hp: 73, mountHp: 42 } }
    mission.actorPositions = { [friendlyId]: { x: 4, z: 5, yaw: .75 } }
    mission.officialSquad!.members = { [friendlyId]: { status: 'deployed', hp: 73 } }
    const deadFriendlyId = mission.friendlyActorIds[1]
    mission.deadFriendlyActorIds = [deadFriendlyId]
    mission.officialSquad!.members[deadFriendlyId] = { status: 'dead', hp: 0 }
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
    expect(restored.activeMission?.officialSquad?.members?.[deadFriendlyId]).toEqual({ status: 'dead', hp: 0 })
    expect(restored.activeMission?.deadFriendlyActorIds).toEqual([deadFriendlyId])
    expect(restored.careerMissionCompletionsByTier?.[5]).toBe(3)
    expect(needsDecapitationDeployment(restored.activeMission!)).toBe(false)
    restored.activeMission!.commanderMission!.deploymentComplete = false
    expect(needsDecapitationDeployment(restored.activeMission!)).toBe(false)

    const legacy = createCareerProfile('roman')
    expect(parseCareerProfile(JSON.parse(JSON.stringify(legacy)))).toMatchObject({ rank: 'recruit', faction: 'roman' })
  })
})

describe('Decapitation safe edge deployment', () => {
  // Only the northern deployment strip and exterior gate (-127) participate.
  // Keep the full X span/cell size, without flooding unused southern terrain.
  const bounds = { minX: -350, maxX: 350, minZ: -350, maxZ: -115, cellSize: 5 }
  const threats = [{ x: -29, z: -75, range: 400 }, { x: -85, z: -18, range: 400 }]

  it('fits all 30 mounted officials and 30 nearby HR around obstacles outside the actual opening fire ranges', () => {
    const navigation = new NavigationWorld(bounds)
    const box = new Box3(new Vector3(290, -10, -340), new Vector3(305, 100, -325))
    const obstacles = [{ box, isBarricade: false }]
    navigation.rebuild(obstacles)
    const plan = planDecapitationDeployment({ navigation, obstacles, threats,
      officialCount: 30, personalCount: 30, eagleCount: 0, playerEagle: false })
    expect(needsDecapitationDeployment(accepted(COMMANDER_DECAPITATION_ID).activeMission!)).toBe(true)
    expect(needsDecapitationDeployment(accepted(COMMANDER_SKY_RAID_ID).activeMission!)).toBe(false)
    expect(plan.player.z).toBeLessThanOrEqual(-320)
    expect(plan.official).toHaveLength(30); expect(plan.personal).toHaveLength(30)
    const points = [plan.player, ...plan.official, ...plan.personal]
    for (const [i, point] of points.entries()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(347)
      expect(point.z).toBeGreaterThanOrEqual(-347)
      expect(navigation.grid.isBlocked(navigation.grid.worldToCell(point)!)).toBe(false)
      expect(navigation.areConnected(point, { x: 0, z: -127 })).toBe(true)
      expect(point.x < 288 || point.x > 307 || point.z < -342 || point.z > -323).toBe(true)
      for (const other of points.slice(i + 1)) expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeGreaterThanOrEqual(4.8)
      for (const threat of threats) expect(Math.hypot(point.x - threat.x, point.z - threat.z)).toBeGreaterThan(threat.range + 8)
    }
    expect(Math.min(...plan.official.map(p => p.z))).toBeGreaterThan(plan.player.z + 7)
    expect(Math.max(...plan.personal.map(p => Math.hypot(p.x - plan.player.x, p.z - plan.player.z)))).toBeLessThanOrEqual(90)
    expect(plan.player.yaw).toBeCloseTo(Math.atan2(-plan.player.x, -127 - plan.player.z))
  })

  it('reserves three complete eagle envelopes alongside 30 officials and 28 ground HR/Player slots', () => {
    const navigation = new NavigationWorld(bounds)
    navigation.rebuild([])
    const plan = planDecapitationDeployment({ navigation, obstacles: [], threats,
      officialCount: 30, personalCount: 27, eagleCount: 3, playerEagle: false })
    expect(plan.eaglePads).toHaveLength(3)
    expect(plan.personal).toHaveLength(27)
    for (const pad of plan.eaglePads) {
      expect(isEagleLandingClear(pad, [], plan.eaglePads.filter(other => other !== pad), 350)).toBe(true)
      const footprint = eagleLandingFootprint(pad).expandByScalar(2)
      for (const ground of [plan.player, ...plan.official, ...plan.personal])
        expect(footprint.containsPoint(new Vector3(ground.x, 0, ground.z))).toBe(false)
      expect(Math.hypot(pad.x + 29, pad.z + 75)).toBeGreaterThan(408)
    }
  })

  it('refuses an edge disconnected from the north gate instead of falling back into enemy fire', () => {
    const navigation = new NavigationWorld(bounds)
    navigation.rebuild([{ box: new Box3(new Vector3(-350, -10, -200), new Vector3(350, 100, -190)), isBarricade: false }])
    expect(() => planDecapitationDeployment({ navigation, obstacles: [], threats: [],
      officialCount: 30, personalCount: 0, eagleCount: 0, playerEagle: false })).toThrow('deployment failed')
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


describe('Bridgehead official field battle', () => {
  it('grants exactly eight stable infantry squads against twelve squads of 300 mounted riders with faction-specific shared loadouts', () => {
    const presets = {
      roman: ['roman_spearman', 'roman_spearman', 'roman_heavy_infantry', 'roman_heavy_infantry',
        'roman_javelin_infantry', 'roman_javelin_infantry', 'roman_archer', 'roman_archer'],
      viking: ['viking_spearman', 'viking_spearman', 'viking_berserker', 'viking_berserker',
        'viking_archer', 'viking_archer', 'viking_archer', 'viking_archer'],
    }
    for (const faction of ['roman', 'viking'] as const) {
      const profile = accepted(COMMANDER_BRIDGEHEAD_ID, faction, true), mission = profile.activeMission!
      const roster = createBridgeheadRoster(mission, faction), authority = mission.officialSquad!
      expect(roster.friendly).toHaveLength(200); expect(roster.enemy).toHaveLength(300)
      expect(new Set([...roster.friendly, ...roster.enemy].map(spec => spec.actorId)).size).toBe(500)
      expect(authority.commandRank).toBe('commander'); expect(authority.squads).toHaveLength(8)
      expect(mission.personalSquad?.memberIds).toEqual(['personal:hr-1'])
      expect(authority.actorIds).not.toContain('personal:hr-1')
      for (const squad of authority.squads!) {
        const friendly = roster.friendly.filter(spec => spec.squadId === squad.squadId)
        expect(friendly.map(spec => spec.actorId)).toEqual(squad.actorIds)
        expect(friendly).toHaveLength(25)
        expect(friendly.filter(spec => spec.tier === 4)).toHaveLength(1)
        expect(friendly.filter(spec => spec.tier === 3)).toHaveLength(24)
        expect(friendly.every(spec => !spec.cavalry && !spec.loadout?.mountId && spec.presetId === presets[faction][squad.squadId - 1])).toBe(true)
        expect(friendly.every(spec => spec.z < -22)).toBe(true)
      }
      for (let squad = 0; squad < 12; squad++) {
        const enemy = roster.enemy.slice(squad * 25, (squad + 1) * 25)
        const enemyFaction = faction === 'roman' ? 'viking' : 'roman'
        expect(enemy).toHaveLength(25)
        expect(enemy.filter(spec => spec.tier === 4)).toHaveLength(1)
        expect(enemy.filter(spec => spec.tier === 3)).toHaveLength(24)
        expect(enemy.every(spec => spec.faction === Faction.ENEMY && spec.characterFaction === enemyFaction
          && spec.cavalry && spec.presetId === `${enemyFaction}_${squad < 6 ? 'sword_cavalry' : 'lancer'}`
          && spec.loadout?.mountId === (spec.tier === 4 ? enemyFaction === 'roman' ? 'corgi' : 'black-cat' : 'horse'))).toBe(true)
        expect(enemy.every(spec => spec.z >= 230 && spec.z < 290 && Math.abs(spec.x) < 100)).toBe(true)
      }
      const captain = commander(faction); captain.rank = 'captain'
      expect(acceptCommanderMission(captain, COMMANDER_BRIDGEHEAD_ID)).toBeNull()
    }
  })

  it('resumes the original eight-squad save without adding riders and rejects partial enemy rosters', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID), mission = profile.activeMission!
    mission.targetActorIds = mission.targetActorIds.slice(0, 200)
    mission.bridgeDeployment = { phase: 'assault', preparationRemainingSeconds: 0 }
    const roster = createBridgeheadRoster(mission, 'roman')
    mission.bridgeBattle = { ready: true, player: { hp: 30, stamina: 30, dead: false,
      position: { x: 0, z: -90, yaw: 0 }, ammo: 0, shieldImpact: 0 },
      playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      actors: Object.fromEntries([...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'deployed', hp: 30 }])) }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!
    expect(createCareerBridgeSpawnPlan(restored).npcSpecs).toHaveLength(400)
    expect(roster.enemy.filter(spec => spec.presetId === 'viking_sword_cavalry')).toHaveLength(100)
    expect(roster.enemy.filter(spec => spec.presetId === 'viking_lancer')).toHaveLength(100)
    expect(new CareerBridgeBattleRuntime(restored.activeMission!).enemyAlive).toBe(200)
    mission.targetActorIds.pop()
    expect(parseCareerProfile(profile)?.activeMission).toBeUndefined()
  })

  it('waits for deployment and every unique target death, allows dead-player victories and gives victory precedence on mutual destruction', () => {
    const mission = accepted(COMMANDER_BRIDGEHEAD_ID).activeMission!
    mission.bridgeDeployment = { phase: 'assault', preparationRemainingSeconds: 0 }
    const runtime = new CareerBridgeBattleRuntime(mission)
    runtime.observe(mission, mission.targetActorIds.slice(0, 299).map(combatantId => ({ combatantId, dead: true })))
    runtime.recordDeath('mount:200'); runtime.recordDeath(mission.targetActorIds[0])
    expect(runtime.enemyAlive).toBe(1)
    expect(runtime.outcome(true, false)).toBeNull(); expect(runtime.outcome(true, true)).toBeNull()
    runtime.observe(mission, mission.friendlyActorIds.map(combatantId => ({ combatantId, dead: true })))
    expect(runtime.outcome(true, true, 1)).toBeNull() // The last deployed HR member can still win.
    expect(runtime.outcome(true, true)).toBe('failure')
    runtime.recordDeath(mission.targetActorIds[299]) // drowning and allied kills use the same confirmed NPC death
    runtime.observe(mission, [])
    expect(runtime.deadTargets.size).toBe(300)
    expect(runtime.outcome(true, false)).toBeNull()
    expect(runtime.outcome(true, true)).toBe('victory')
  })

  it('restores casualties and commands and commits defense merit plus Tier 5 victory once after a failed save', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID, 'roman', true), mission = profile.activeMission!
    delete mission.bridgeDeployment // Legacy in-progress saves resume the assault without another countdown.
    mission.personalSquad!.sceneKey = `bridge:${mission.id}`
    mission.personalSquad!.state = 'ACTIVE'
    mission.personalSquad!.members['personal:hr-1'] = { status: 'deployed', hp: 17, order: 'formation',
      position: { x: -5, z: -100, yaw: 0 },
      formation: { commandId: 8, position: { x: 4, z: -45, yaw: 0 }, reached: false, arrivalOrder: 'defend' },
      mount: { hp: 0, mounted: false, position: { x: -6, z: -99, yaw: 0 } } }
    const stats = { player: { damageDealt: 0, damageTaken: 10, kills: 0, structureDamage: 0,
      structuresDestroyed: 0, gateBreaches: 0, survived: false }, squads: [],
      meritPlayer: { damageDealt: 80, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false } }
    mission.commanderMission!.deploymentComplete = true
    mission.playerDead = true
    mission.deadTargetActorIds = mission.targetActorIds.slice(0, 100)
    const actor = mission.friendlyActorIds[1], dismounted = mission.targetActorIds[100]
    mission.bridgeBattle = { ready: true, player: { hp: 0, stamina: 0, dead: true,
      position: { x: 0, y: 1, z: -90, yaw: 0 }, ammo: 5, shieldImpact: 2 },
      playerStats: { ...stats.player }, actors: Object.fromEntries([...mission.friendlyActorIds, ...mission.targetActorIds]
        .map(id => [id, { status: mission.deadTargetActorIds!.includes(id) ? 'dead' : 'deployed', hp: mission.deadTargetActorIds!.includes(id) ? 0 : 30 }])) }
    mission.bridgeBattle.player.homeMount = { hp: 12, mounted: false, position: { x: 15, y: 0, z: -40, yaw: 1 } }
    mission.bridgeBattle.player.mountActorId = mission.targetActorIds[0]
    mission.bridgeBattle.actors[mission.targetActorIds[0]].mount = { hp: 42, mounted: false, position: { x: 2, z: 24, yaw: 0 } }
    mission.bridgeBattle.actors[dismounted].mount = { hp: 0, mounted: false, position: { x: 0, z: 20, yaw: 0 } }
    mission.officialSquad!.members = { [actor]: { status: 'deployed', hp: 20, order: 'formation',
      formation: { commandId: 7, position: { x: 0, y: .45, z: 0, yaw: 0 }, reached: true, arrivalOrder: 'defend' } } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!, plan = createCareerBridgeSpawnPlan(restored)
    expect(plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)).toHaveLength(200)
    expect(createCareerBridgeOrphanMountPlan(restored)).toMatchObject([{ actorId: mission.targetActorIds[0], stableKey: mission.targetActorIds[0], saved: { hp: 42 } }])
    expect(restored.activeMission!.officialSquad!.members![actor].formation).toEqual(mission.officialSquad!.members![actor].formation)
    expect(restored.activeMission!.bridgeBattle!.actors[dismounted].mount!.hp).toBe(0)
    expect(restored.activeMission!.personalSquad).toEqual(mission.personalSquad)
    expect(restored.activeMission!.bridgeBattle!.player).toMatchObject({ dead: true, mountActorId: mission.targetActorIds[0],
      homeMount: { hp: 12, position: { x: 15, z: -40, yaw: 1 } } })
    restored.activeMission!.deadTargetActorIds = [...mission.targetActorIds]
    expect(store.save(restored)).toBe(true)
    storage.writable = false
    expect(commitCareerBridgeBattleResult(store, mission.id, stats)).toBeNull()
    const failedSave = store.load()!
    expect(failedSave.activeMission!.result).toBeUndefined()
    expect(failedSave.claimedBattleIds).not.toContain(mission.id)
    storage.writable = true
    const claimed = commitCareerBridgeBattleResult(store, mission.id, stats)!
    expect(claimed.profile.activeMission!.result!.merit.total).toBe(100)
    expect(claimed.profile.careerMissionCompletionsByTier?.[5]).toBe(1)
    expect(commitCareerBridgeBattleResult(store, mission.id, stats)!.alreadyClaimed).toBe(true)
    const reloadedClaim = store.load()!
    expect(reloadedClaim.totalMerit).toBe(claimed.profile.totalMerit)
    expect(reloadedClaim.activeMission!.personalSquad).toEqual(mission.personalSquad)
  })

  it('keeps the last HR survivor fighting after reload and restores its surviving mount without reviving a dead rider', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID, 'roman', true), mission = profile.activeMission!
    const id = mission.personalSquad!.memberIds[0]
    profile.personalSquad!.members[0].type = 'captain'
    mission.playerDead = true
    mission.bridgeDeployment = { phase: 'assault', preparationRemainingSeconds: 0 }
    mission.commanderMission!.deploymentComplete = true
    mission.deadFriendlyActorIds = [...mission.friendlyActorIds]
    mission.deadTargetActorIds = mission.targetActorIds.slice(0, 299)
    mission.personalSquad!.sceneKey = `bridge:${mission.id}`
    mission.personalSquad!.state = 'ACTIVE'
    mission.personalSquad!.members[id] = { status: 'deployed', hp: 11, order: 'defend',
      position: { x: 0, z: -90, yaw: 0 },
      mount: { hp: 21, mounted: false, position: { x: 5, z: -95, yaw: 1 } } }
    const playerStats = { damageDealt: 0, damageTaken: 20, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
    mission.bridgeBattle = { ready: true, player: { hp: 0, stamina: 0, dead: true,
      position: { x: 5, z: -95, yaw: 1 }, ammo: 0, shieldImpact: 0, mountActorId: id }, playerStats,
      actors: Object.fromEntries([...mission.friendlyActorIds, ...mission.targetActorIds].map(actorId =>
        [actorId, { status: actorId === mission.targetActorIds[299] ? 'deployed' : 'dead' }])) }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const stats = { player: { ...playerStats, survived: false }, squads: [] }
    expect(store.load()!.activeMission!.bridgeBattle!.player.mountActorId).toBe(id)
    expect(commitCareerBridgeBattleResult(store, mission.id, stats)).toBeNull()
    expect(store.load()!.activeMission!.result).toBeUndefined()
    const casualty = store.load()!
    casualty.activeMission!.personalSquad!.members[id].status = 'dead'
    casualty.activeMission!.personalSquad!.members[id].hp = 0
    expect(store.save(casualty)).toBe(true)
    const resumed = store.load()!
    expect(createCareerBridgeSpawnPlan(resumed).npcSpecs).toHaveLength(1)
    expect(createCareerBridgeOrphanMountPlan(resumed)).toMatchObject([{ actorId: id, mountId: 'horse', stableKey: `personal:${id}`, saved: { hp: 21 } }])
    expect(commitCareerBridgeBattleResult(store, mission.id, stats)?.profile.activeMission!.result?.outcome).toBe('failure')
    const corrupted = structuredClone(resumed)
    corrupted.activeMission!.bridgeBattle!.player.mountActorId = 'personal:unaccepted'
    expect(parseCareerProfile(corrupted)?.activeMission).toBeUndefined()
  })

  it('spawns only friendlies during three-minute preparation and resumes the saved remaining time', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID), mission = profile.activeMission!
    const runtime = new CareerBridgeBattleRuntime(mission)
    expect(runtime.deployment).toEqual({ phase: 'preparing', preparationRemainingSeconds: 180 })
    expect(createCareerBridgeSpawnPlan(profile).npcSpecs.map(spec => spec.actorId)).toEqual(mission.friendlyActorIds)
    expect(createCareerBridgeSpawnPlan(profile, 'attackers').npcSpecs).toHaveLength(0)
    let commits = 0
    runtime.advancePreparation(36.75)
    expect(runtime.beginEnemyDeployment(() => { commits++; return true })).toBe(false)
    expect(commits).toBe(0)
    mission.bridgeDeployment = { ...runtime.deployment }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, resumed = new CareerBridgeBattleRuntime(loaded.activeMission!)
    expect(resumed.deployment.preparationRemainingSeconds).toBe(143.25)
    expect(resumed.outcome(true, true)).toBeNull()
    resumed.advancePreparation(143)
    expect(resumed.beginEnemyDeployment(() => true)).toBe(false)
    resumed.advancePreparation(.25)
    expect(resumed.beginEnemyDeployment(() => false)).toBe(false)
    expect(resumed.deployment).toEqual({ phase: 'preparing', preparationRemainingSeconds: 0 })
    expect(resumed.beginEnemyDeployment(state => {
      loaded.activeMission!.bridgeDeployment = state
      return store.save(loaded)
    })).toBe(true)
    expect(createCareerBridgeSpawnPlan(store.load()!, 'attackers').npcSpecs.map(spec => spec.actorId)).toEqual(mission.targetActorIds)
    expect(resumed.beginEnemyDeployment(() => { commits++; return true })).toBe(false)
    expect(commits).toBe(0)
  })

  it('recovers a partial distant enemy deployment without reviving casualties or starting combat before the saved barrier', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID), mission = profile.activeMission!
    mission.bridgeDeployment = { phase: 'spawning', preparationRemainingSeconds: 0 }
    const [survivor, casualty] = mission.targetActorIds
    mission.deadTargetActorIds = [casualty]
    mission.bridgeBattle = { ready: false, player: { hp: 80, stamina: 60, dead: false,
      position: { x: 15, z: -45, yaw: 1 }, ammo: 20, shieldImpact: 0 },
      playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      actors: Object.fromEntries([...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'reserve' }])) }
    mission.bridgeBattle.actors[survivor] = { status: 'deployed', hp: 30, position: { x: 40, z: 245, yaw: Math.PI } }
    mission.bridgeBattle.actors[casualty] = { status: 'dead', hp: 0 }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, runtime = new CareerBridgeBattleRuntime(loaded.activeMission!)
    expect(runtime.deployment).toEqual({ phase: 'spawning', preparationRemainingSeconds: 0 })
    const plan = createCareerBridgeSpawnPlan(loaded)
    expect(plan.npcSpecs).toHaveLength(499)
    expect(plan.npcSpecs.some(spec => spec.actorId === casualty)).toBe(false)
    expect(plan.npcSpecs.filter(spec => spec.actorId === survivor)).toHaveLength(1)
    expect(loaded.activeMission!.bridgeBattle!.actors[survivor].position).toEqual({ x: 40, z: 245, yaw: Math.PI })
    runtime.advancePreparation(60)
    expect(runtime.completeEnemyDeployment(false, () => true)).toBe(false)
    expect(runtime.completeEnemyDeployment(true, () => false)).toBe(false)
    expect(runtime.outcome(true, true)).toBeNull()
    expect(runtime.completeEnemyDeployment(true, state => {
      loaded.activeMission!.bridgeDeployment = state
      loaded.activeMission!.bridgeBattle!.ready = true
      loaded.activeMission!.commanderMission!.deploymentComplete = true
      return store.save(loaded)
    })).toBe(true)
    expect(store.load()!.activeMission!.bridgeDeployment).toEqual({ phase: 'assault', preparationRemainingSeconds: 0 })
  })
})

describe('Bridgehead reload routing', () => {
  const stats = { damageDealt: 20, damageTaken: 0, kills: 1, structureDamage: 0,
    structuresDestroyed: 0, gateBreaches: 0, survived: true }


  it('keeps the unclaimed mission resumable after settlement saving fails', () => {
    const profile = accepted(COMMANDER_BRIDGEHEAD_ID), id = profile.activeMission!.id
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    storage.writable = false
    expect(store.save(claimCareerMission(profile, id, 'victory', stats).profile)).toBe(false)
    let cleanupAttempts = 0
    const loaded = store.load()!
    expect(recoverClaimedCareerBridgeBattle(loaded, {
      save: next => { cleanupAttempts++; return store.save(next) },
    })).toBe('resume')
    expect(cleanupAttempts).toBe(0)
    expect(store.load()!.activeMission).toEqual(loaded.activeMission)
    expect(loaded.claimedBattleIds).not.toContain(id)
    expect(loaded.totalMerit).toBe(profile.totalMerit)
  })

  it('retains a claimed mission on return-save failure and clears it once a retry saves', () => {
    const acceptedProfile = accepted(COMMANDER_BRIDGEHEAD_ID, 'roman', true), id = acceptedProfile.activeMission!.id
    acceptedProfile.activeMission!.personalSquad!.members['personal:hr-1'] = { status: 'dead', hp: 0 }
    acceptedProfile.personalSquad!.members.push({ id: 'personal:reserve', type: 'soldier' })
    const claimed = claimCareerMission(acceptedProfile, id, 'victory', stats).profile
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(claimed)).toBe(true)
    const originalPersonal = store.load()!.personalSquad
    const loaded = store.load()!
    storage.writable = false
    expect(recoverClaimedCareerBridgeBattle(loaded, store)).toBe('save-failed')
    expect(store.load()!.activeMission).toEqual(loaded.activeMission)
    expect(store.load()!.personalSquadRuntime).toBeUndefined()
    expect(store.load()!.claimedBattleIds).toEqual(claimed.claimedBattleIds)
    storage.writable = true
    expect(recoverClaimedCareerBridgeBattle(store.load()!, store)).toBe('return-to-town')
    const returned = store.load()!
    expect(returned.activeMission).toBeUndefined()
    expect(returned.personalSquadRuntime?.members['personal:hr-1']).toEqual({ status: 'reserve' })
    expect(returned.personalSquadRuntime?.memberIds).toEqual(['personal:hr-1', 'personal:reserve'])
    expect(returned.personalSquadRuntime?.members['personal:reserve']).toEqual({ status: 'reserve' })
    expect(returned.personalSquad).toEqual(originalPersonal)
    expect(returned.totalMerit).toBe(claimed.totalMerit)
    expect(returned.careerMissionCompletionsByTier?.[5]).toBe(1)
    expect(returned.claimedBattleIds.filter(battleId => battleId === id)).toHaveLength(1)
  })
})
