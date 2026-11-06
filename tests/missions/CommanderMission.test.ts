import { CareerBridgeBattleRuntime, createCareerBridgeSpawnPlan, createCareerBridgeOrphanMountPlan, commitCareerBridgeBattleResult, createCareerFelineBattleLaunch, isCareerFelineBattle, recoverClaimedCareerBridgeBattle, careerFelineHeroAssetIds, createCareerFelineSpawnPlan, createCareerFelineOrphanMountPlan, dispatchFelineVanguardCharge, felineInitialTacticalOrder, felineFriendlyMountId, markFelineVanguardCharge, shouldTriggerFelineVanguardCharge, validateFelineDeploymentReadiness } from '../../src/career/CareerBridgeBattle'
import { COMMANDER_BRIDGEHEAD_ID, createBridgeheadRoster } from '../../src/career/CommanderMissionCatalog'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { officialActorSquadId, officialCommandAcceptsActor } from '../../src/career/CareerCommandAuthority'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptCommanderMission, availableCommanderMissions, COMMANDER_DECAPITATION_ID, COMMANDER_FELINE_CAVALRY_ID, COMMANDER_FORMER_COMMANDER_SLOT, COMMANDER_LAST_STAND_ID, COMMANDER_SKY_RAID_ID, FELINE_ENEMY_TOTAL, FELINE_FRIENDLY_TOTAL, FELINE_FRIENDLY_SQUAD_SIZES, FELINE_T4_MOUNTS, FELINE_T5_MOUNTS, FELINE_VANGUARD_ADVANCE_METERS, recordCommanderObjectiveDeath } from '../../src/career/CommanderMissionCatalog'
import { remainingCommanderAttackers } from '../../src/career/CommanderOutpost'
import { CombatEventStream, type CombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from '../../src/career/CareerMissionState'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { AIType, type NPC } from '../../src/world/NPC'
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
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import type { CaptainEagleCheckpoint } from '../../src/career/CaptainEagleCheckpoint'

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
    expect(availableCommanderMissions(returned)).toHaveLength(6)
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

describe('Commander VI Six Feline Cavalry', () => {
  const effectiveDamage = (targetId: string, appliedDamage = 25): CombatEvent => ({
    type: 'damage_applied',
    source: source(),
    target: { targetId, targetType: 'npc', name: targetId, allegiance: Faction.ENEMY, characterFaction: 'viking' },
    method: 'projectile',
    requestedDamage: appliedDamage,
    appliedDamage,
  })

  it('derives the exact 200-vs-300 roster from production formation slots and keeps all six feline mounts commandable', () => {
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID), mission = profile.activeMission!
    profile.ownedMounts.push('serval')
    profile.selectedMountId = 'serval'
    const launch = createCareerFelineBattleLaunch(profile)
    expect(isCareerFelineBattle(mission)).toBe(true)
    expect(launch).toMatchObject({ type: 'career-feline-battle', careerMissionId: mission.id,
      battle: { careerFelineMissionId: mission.id, playerFaction: profile.faction,
        playerLoadout: { mountId: profile.selectedMountId } } })
    const plan = createCareerFelineSpawnPlan(profile)
    const friendly = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    const enemy = plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)
    const preloadedHeroes = new Set(careerFelineHeroAssetIds(profile))
    expect(plan.npcSpecs.every(spec => !spec.visualAssetId || preloadedHeroes.has(spec.visualAssetId))).toBe(true)

    expect(friendly).toHaveLength(FELINE_FRIENDLY_TOTAL)
    expect(enemy).toHaveLength(FELINE_ENEMY_TOTAL)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.actorId?.includes(':melee:'))).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.actorId?.includes(':lancer:'))).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.actorId?.includes(':horse_archer:'))).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 5 && spec.actorId?.includes(':lancer:'))).toHaveLength(20)
    expect(enemy.filter(spec => spec.characterTier === 4)).toHaveLength(210)
    expect(enemy.filter(spec => spec.characterTier === 5)).toHaveLength(90)
    for (const role of ['melee', 'lancer', 'horse_archer']) {
      expect(enemy.filter(spec => spec.characterTier === 4 && spec.actorId?.includes(`:${role}:`))).toHaveLength(70)
      expect(enemy.filter(spec => spec.characterTier === 5 && spec.actorId?.includes(`:${role}:`))).toHaveLength(30)
    }

    const friendlyMounts = friendly.map(spec => spec.loadout?.mountId)
    for (const mount of [...FELINE_T4_MOUNTS, ...FELINE_T5_MOUNTS]) expect(friendlyMounts).toContain(mount)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_sword_cavalry') && spec.loadout?.mountId === 'caracal')).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_lancer') && spec.loadout?.mountId === 'serval')).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.loadout?.mountId === 'black-cat')).toHaveLength(20)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.loadout?.mountId === 'white-cat')).toHaveLength(20)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.loadout?.mountId === 'orange-cat')).toHaveLength(20)
    expect(friendly.filter(spec => spec.characterTier === 5 && spec.loadout?.mountId === 'snow-leopard')).toHaveLength(20)
    expect(enemy.every(spec => spec.loadout?.mountId === 'horse')).toBe(true)

    // All friendly cavalry are equipped with bows matching their tier:
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.loadout?.rangedWeaponId === 'maki-ranger-bow-ranged')).toHaveLength(180)
    expect(friendly.filter(spec => spec.characterTier === 5 && spec.loadout?.rangedWeaponId === 'bow_t5')).toHaveLength(20)
    // Original horse archers gain spear_t4 and paladin_shield_t4:
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_horse_archer')
      && spec.loadout?.meleeWeaponId === 'spear_t4'
      && spec.loadout?.shieldId === 'paladin_shield_t4'
      && spec.loadout?.rangedWeaponId === 'maki-ranger-bow-ranged')).toHaveLength(60)
    // Other 140 cavalry retain their original melee weapons and shields:
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_sword_cavalry')
      && spec.loadout?.meleeWeaponId === (profile.faction === 'roman' ? 'paladin_sword_t4' : 'paladin_mace_t4')
      && spec.loadout?.shieldId === (profile.faction === 'roman' ? 'roman_officer_shield_t4' : 'paladin_shield_t4')
      && spec.loadout?.rangedWeaponId === 'maki-ranger-bow-ranged')).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_lancer')
      && spec.loadout?.meleeWeaponId === 'spear_t4'
      && spec.loadout?.rangedWeaponId === 'maki-ranger-bow-ranged')).toHaveLength(60)
    expect(friendly.filter(spec => spec.characterTier === 5 && spec.presetId?.endsWith('_lancer')
      && spec.loadout?.meleeWeaponId === 'spear_t5'
      && spec.loadout?.shieldId === (profile.faction === 'roman' ? 'commander_shield_t5' : 'viking_berserker_shield_t5')
      && spec.loadout?.rangedWeaponId === 'bow_t5')).toHaveLength(20)
    expect(friendly.every(spec => spec.aiType === AIType.RANGED)).toBe(true)

    // Enemy equipment remains untouched:
    expect(enemy.filter(spec => spec.characterTier === 5 && !spec.presetId?.endsWith('_horse_archer')
      && spec.loadout?.rangedWeaponId === null)).toHaveLength(60)
    expect(enemy.filter(spec => spec.characterTier === 5 && spec.presetId?.endsWith('_horse_archer')
      && spec.loadout?.rangedWeaponId === 'bow_t5')).toHaveLength(30)
    expect(enemy.filter(spec => spec.characterTier === 4 && !spec.presetId?.endsWith('_horse_archer')
      && (spec.loadout?.rangedWeaponId === null || spec.loadout?.rangedWeaponId === undefined))).toHaveLength(140)
    expect(enemy.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_horse_archer')
      && spec.loadout?.rangedWeaponId === 'elven_runebow')).toHaveLength(70)

    // Formation is made of physically separate units rather than two cavalry wings.
    const center = (specs: typeof friendly) => ({
      x: specs.reduce((sum, spec) => sum + spec.x, 0) / specs.length,
      z: specs.reduce((sum, spec) => sum + spec.z, 0) / specs.length,
    })
    const verifySeparatedBlocks = (blocks: (typeof friendly)[]) => {
      const centers = blocks.map(center)
      for (let i = 0; i < blocks.length; i++) {
        const xs = blocks[i].map(spec => spec.x), zs = blocks[i].map(spec => spec.z)
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(20)
        expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(21)
        for (let j = i + 1; j < blocks.length; j++) {
          expect(Math.hypot(centers[i].x - centers[j].x, centers[i].z - centers[j].z)).toBeGreaterThan(20)
        }
      }
    }
    const friendlyBlocks = mission.officialSquad!.squads!.map(squad =>
      friendly.filter(spec => squad.actorIds.includes(spec.actorId!)))
    expect(friendlyBlocks.map(block => block.length)).toEqual([...FELINE_FRIENDLY_SQUAD_SIZES])
    verifySeparatedBlocks(friendlyBlocks)

    const [s1, s2, s3, s4, s5, s6, s7] = friendlyBlocks
    expect(s1).toHaveLength(30); expect(center(s1).x).toBeCloseTo(-24, 1); expect(s1.every(s => s.characterTier === 4 && s.presetId?.endsWith('_sword_cavalry'))).toBe(true)
    expect(s2).toHaveLength(30); expect(center(s2).x).toBeCloseTo(24, 1); expect(s2.every(s => s.characterTier === 4 && s.presetId?.endsWith('_sword_cavalry'))).toBe(true)
    expect(s3).toHaveLength(30); expect(center(s3).x).toBeCloseTo(-36, 1); expect(s3.every(s => s.characterTier === 4 && s.presetId?.endsWith('_lancer'))).toBe(true)
    expect(s4).toHaveLength(30); expect(center(s4).x).toBeCloseTo(36, 1); expect(s4.every(s => s.characterTier === 4 && s.presetId?.endsWith('_lancer'))).toBe(true)
    expect(s5).toHaveLength(30); expect(center(s5).x).toBeCloseTo(-12, 1); expect(s5.every(s => s.characterTier === 4 && s.presetId?.endsWith('_horse_archer'))).toBe(true)
    expect(s6).toHaveLength(30); expect(center(s6).x).toBeCloseTo(12, 1); expect(s6.every(s => s.characterTier === 4 && s.presetId?.endsWith('_horse_archer'))).toBe(true)
    expect(s7).toHaveLength(20); expect(center(s7).x).toBeCloseTo(0, 1); expect(s7.every(s => s.characterTier === 5 && s.presetId?.endsWith('_lancer'))).toBe(true)
    expect(Math.abs(center(s7).z)).toBeLessThan(Math.abs(center(s5).z))
    expect(Math.abs(center(s1).z)).toBeLessThan(Math.abs(center(s3).z))
    expect(Math.max(...friendly.map(spec => Math.abs(spec.z)))).toBeLessThanOrEqual(140)

    const baseViking = createCareerProfile('viking')
    baseViking.rank = 'commander'
    const vikingProfile = acceptCommanderMission(baseViking, COMMANDER_FELINE_CAVALRY_ID, 'viking-feline')!
    const vikingFriendly = createCareerFelineSpawnPlan(vikingProfile).npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    const vikingS7 = vikingFriendly.filter(spec => spec.squadId === 7)
    const vikingS1 = vikingFriendly.filter(spec => spec.squadId === 1)
    const vikingS2 = vikingFriendly.filter(spec => spec.squadId === 2)
    expect(center(vikingS7).x).toBeCloseTo(0, 1)
    expect(center(vikingS1).x).toBeCloseTo(24, 1)
    expect(center(vikingS2).x).toBeCloseTo(-24, 1)
    expect(vikingFriendly.filter(spec => spec.characterTier === 4 && spec.loadout?.rangedWeaponId === 'maki-ranger-bow-ranged')).toHaveLength(180)
    expect(vikingFriendly.filter(spec => spec.characterTier === 5 && spec.loadout?.rangedWeaponId === 'bow_t5')).toHaveLength(20)
    expect(vikingFriendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_horse_archer')
      && spec.loadout?.meleeWeaponId === 'spear_t4'
      && spec.loadout?.shieldId === 'paladin_shield_t4')).toHaveLength(60)
    expect(vikingFriendly.filter(spec => spec.characterTier === 4 && spec.presetId?.endsWith('_sword_cavalry')
      && spec.loadout?.meleeWeaponId === 'paladin_mace_t4'
      && spec.loadout?.shieldId === 'paladin_shield_t4')).toHaveLength(60)
    expect(vikingFriendly.filter(spec => spec.characterTier === 5 && spec.presetId?.endsWith('_lancer')
      && spec.loadout?.meleeWeaponId === 'spear_t5'
      && spec.loadout?.shieldId === 'viking_berserker_shield_t5')).toHaveLength(20)
    expect(vikingFriendly.every(spec => spec.aiType === AIType.RANGED)).toBe(true)
    const enemyBlocks = Array.from({ length: FELINE_ENEMY_TOTAL / 30 }, (_, i) =>
      enemy.slice(i * 30, (i + 1) * 30).filter(spec => spec.actorId !== mission.commanderMission!.felineVanguardActorId))
    expect(enemyBlocks).toHaveLength(10)
    verifySeparatedBlocks(enemyBlocks)
    const playerPoint = plan.playerSpawn
    expect(Math.min(...friendly.map(spec => Math.hypot(spec.x - playerPoint.x, spec.z - playerPoint.z)))).toBeGreaterThan(2)
    expect(createCareerFelineSpawnPlan(profile).npcSpecs.map(spec => [spec.actorId, spec.x, spec.z]))
      .toEqual(plan.npcSpecs.map(spec => [spec.actorId, spec.x, spec.z]))

    const vanguardId = mission.commanderMission!.felineVanguardActorId!
    const vanguard = enemy.filter(spec => spec.actorId === vanguardId)
    expect(vanguard).toHaveLength(1)
    expect(vanguard[0]).toMatchObject({ characterTier: 5, presetId: 'viking_lancer' })
    expect(mission.targetActorIds).toContain(vanguardId)
    const enemyMain = enemy.filter(spec => spec.actorId !== vanguardId)
    const mainFrontAbsZ = Math.min(...enemyMain.map(spec => Math.abs(spec.z)))
    expect(mainFrontAbsZ - Math.abs(vanguard[0].z)).toBeCloseTo(FELINE_VANGUARD_ADVANCE_METERS, 5)
    expect(vanguard[0].x).toBeCloseTo(enemyMain.reduce((sum, spec) => sum + spec.x, 0) / enemyMain.length, 2)
    expect(new Set(plan.npcSpecs.map(spec => spec.actorId)).size).toBe(FELINE_FRIENDLY_TOTAL + FELINE_ENEMY_TOTAL)
    expect(mission.officialSquad?.commandedSquadIds).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(mission.officialSquad?.actorIds).toEqual(mission.friendlyActorIds)
    for (const squad of mission.officialSquad!.squads!) {
      const combatantId = squad.actorIds[0]
      expect(officialCommandAcceptsActor(mission.officialSquad!, {
        combatantId, squadId: officialActorSquadId(mission.officialSquad!, combatantId),
        faction: Faction.PLAYER, combatOwnership: 'mission-official', dead: false,
      })).toBe(true)
    }
    expect(felineInitialTacticalOrder(Faction.PLAYER, false)).toBe('defend')
    expect(felineInitialTacticalOrder(Faction.ENEMY, false)).toBe('attack')
    expect(felineInitialTacticalOrder(Faction.ENEMY, true)).toBe('charge')

    const withPrivateRoster = accepted(COMMANDER_FELINE_CAVALRY_ID, 'roman', true)
    expect(withPrivateRoster.personalSquad?.members).toHaveLength(1)
    expect(withPrivateRoster.activeMission?.personalSquad?.memberIds).toEqual(['personal:hr-1'])
    expect(withPrivateRoster.activeMission?.officialSquad?.actorIds).toHaveLength(FELINE_FRIENDLY_TOTAL)
    const privateStore = new CareerProfileStore(new MemoryStorage())
    expect(privateStore.save(withPrivateRoster)).toBe(true)
    expect(privateStore.load()!.activeMission?.personalSquad?.memberIds).toEqual(['personal:hr-1'])
    expect(createCareerFelineSpawnPlan(withPrivateRoster).npcSpecs).toHaveLength(FELINE_FRIENDLY_TOTAL + FELINE_ENEMY_TOTAL)
  })

  it('dispatches the lethal-hit charge despite rejected storage, then saves the pending mark without replaying audio', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID)
    expect(store.save(profile)).toBe(true)
    const live = cloneCareerProfile(profile), id = live.activeMission!.commanderMission!.felineVanguardActorId!
    const issue = vi.fn()
    storage.failWrites = true
    expect(dispatchFelineVanguardCharge(live.activeMission!, effectiveDamage(id, 9999), issue)).toBe(true)
    expect(issue).toHaveBeenCalledOnce()
    expect(store.save(live)).toBe(false)
    expect(store.load()!.activeMission?.commanderMission?.felineChargeTriggered).toBe(false)
    expect(dispatchFelineVanguardCharge(live.activeMission!, effectiveDamage(id, 20), issue)).toBe(false)
    const checkpoint = new CareerMissionCheckpoint(() => store.load()!, next => store.save(next))
    expect(checkpoint.persist(() => live.activeMission!, { immediate: true })).toBe(false)
    storage.failWrites = false
    expect(checkpoint.persist(() => live.activeMission!, { immediate: true })).toBe(true)
    const restored = store.load()!.activeMission!
    expect(restored.commanderMission?.felineChargeTriggered).toBe(true)
    expect(dispatchFelineVanguardCharge(restored, effectiveDamage(id, 20), issue)).toBe(false)
    expect(issue).toHaveBeenCalledOnce()
  })

  it('persists orphaned official White Cat and enemy vanguard Horse mounts and a borrowed player mount', () => {
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID), mission = profile.activeMission!
    const specs = createCareerFelineSpawnPlan(profile).npcSpecs
    const white = specs.find(spec => spec.faction === Faction.PLAYER && spec.loadout?.mountId === 'white-cat')!
    const vanguardId = mission.commanderMission!.felineVanguardActorId!
    const vanguard = specs.find(spec => spec.actorId === vanguardId)!
    const cat = { hp: 74, mounted: false, position: { x: white.x + 2, y: 3, z: white.z + 1, yaw: .4 } }
    const horse = { hp: 65, mounted: false, position: { x: vanguard.x - 4, y: 2, z: vanguard.z, yaw: 1.4 } }
    const stats = { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
    const actors: CaptainEagleCheckpoint['actors'] = Object.fromEntries(
      [...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'reserve' as const }]))
    actors[white.actorId!] = { status: 'dead', hp: 0, mount: cat }
    actors[vanguardId] = { status: 'dead', hp: 0, mount: horse }
    mission.felineBattle = { ready: true, actors, playerStats: stats, player: {
      hp: 99, stamina: 81, dead: false,
      position: { x: white.x + 2, y: 4, z: white.z + 1, yaw: 1.2 }, ammo: 16, shieldImpact: 12,
      mountActorId: white.actorId!, mountHp: cat.hp, mount: { ...cat, mounted: true },
      homeMount: { hp: 220, mounted: false, position: { x: 0, y: 1, z: -145, yaw: 0 } },
    } }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const restored = store.load()!, field = restored.activeMission!.felineBattle!
    expect(field.player).toMatchObject({ mountActorId: white.actorId, mountHp: 74,
      mount: { hp: 74, mounted: true, position: cat.position }, homeMount: { hp: 220 } })
    expect(field.actors[white.actorId!]).toMatchObject({ status: 'dead', mount: cat })
    expect(field.actors[vanguardId]).toMatchObject({ status: 'dead', mount: horse })
    const orphans = createCareerFelineOrphanMountPlan(restored)
    expect(orphans).toHaveLength(2)
    expect(orphans.find(item => item.actorId === white.actorId)).toMatchObject({
      mountId: 'white-cat', stableKey: white.actorId, saved: cat })
    expect(orphans.find(item => item.actorId === vanguardId)).toMatchObject({
      mountId: 'horse', stableKey: vanguardId, saved: horse })
    field.player.mountActorId = undefined
    field.player.mount = { ...cat, mounted: false }
    expect(store.save(restored)).toBe(true)
    expect(store.load()!.activeMission!.felineBattle!.player.mount?.mounted).toBe(false)
    expect(createCareerFelineOrphanMountPlan(store.load()!)).toHaveLength(2)
  })

  it('charges once only on effective vanguard damage and preserves vanguard/charge state through save-load without audio-side replay state', () => {
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID), mission = profile.activeMission!
    const vanguardId = mission.commanderMission!.felineVanguardActorId!
    const otherEnemy = mission.targetActorIds.find(id => id !== vanguardId)!

    expect(shouldTriggerFelineVanguardCharge(mission, effectiveDamage(otherEnemy))).toBe(false)
    expect(shouldTriggerFelineVanguardCharge(mission, effectiveDamage(vanguardId, 0))).toBe(false)
    const lethal = effectiveDamage(vanguardId, 9_999)
    expect(shouldTriggerFelineVanguardCharge(mission, lethal)).toBe(true)
    expect(markFelineVanguardCharge(mission, lethal)).toBe(true)
    expect(mission.commanderMission!.felineChargeTriggered).toBe(true)
    expect(markFelineVanguardCharge(mission, effectiveDamage(vanguardId, 1))).toBe(false)

    const zeroStats = { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }
    mission.felineBattle = {
      ready: true,
      player: { hp: 100, stamina: 100, dead: false, position: { x: 0, z: -150, yaw: 0 }, ammo: 20, shieldImpact: 0 },
      playerStats: zeroStats,
      actors: Object.fromEntries([...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'reserve' }])),
    }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, restored = loaded.activeMission!
    expect(restored.commanderMission?.felineVanguardActorId).toBe(vanguardId)
    expect(restored.commanderMission?.felineChargeTriggered).toBe(true)
    expect(restored.felineBattle?.ready).toBe(true)
    expect(Object.keys(restored.felineBattle!.actors)).toHaveLength(FELINE_FRIENDLY_TOTAL + FELINE_ENEMY_TOTAL)
    expect(createCareerFelineSpawnPlan(loaded).npcSpecs).toHaveLength(FELINE_FRIENDLY_TOTAL + FELINE_ENEMY_TOTAL)
    expect(felineInitialTacticalOrder(Faction.ENEMY, restored.commanderMission?.felineChargeTriggered === true)).toBe('charge')
    expect(shouldTriggerFelineVanguardCharge(restored, effectiveDamage(vanguardId, 50))).toBe(false)

    const victoryStats = { ...zeroStats, survived: true }
    const victory = claimCareerMission(loaded, restored.id, 'victory', victoryStats)
    expect(victory.profile.activeMission?.result?.outcome).toBe('victory')
    expect(clearCareerMission(victory.profile, restored.id).activeMission).toBeUndefined()
    const failure = claimCareerMission(loaded, restored.id, 'failure', { ...zeroStats, survived: false })
    expect(failure.profile.activeMission?.result?.outcome).toBe('failure')
  })

  it('maps friendly cavalry roles and tiers deterministically to six feline mounts and enemy to horse', () => {
    expect(felineFriendlyMountId('melee', 4, 0)).toBe('caracal')
    expect(felineFriendlyMountId('melee', 4, 59)).toBe('caracal')
    expect(felineFriendlyMountId('lancer', 4, 0)).toBe('serval')
    expect(felineFriendlyMountId('lancer', 4, 59)).toBe('serval')
    expect(felineFriendlyMountId('horse_archer', 4, 0)).toBe('black-cat')
    expect(felineFriendlyMountId('horse_archer', 4, 19)).toBe('black-cat')
    expect(felineFriendlyMountId('horse_archer', 4, 20)).toBe('white-cat')
    expect(felineFriendlyMountId('horse_archer', 4, 39)).toBe('white-cat')
    expect(felineFriendlyMountId('horse_archer', 4, 40)).toBe('orange-cat')
    expect(felineFriendlyMountId('horse_archer', 4, 59)).toBe('orange-cat')
    expect(felineFriendlyMountId('lancer', 5, 0)).toBe('snow-leopard')
    expect(felineFriendlyMountId('lancer', 5, 19)).toBe('snow-leopard')
  })

  it('arranges friendly feline cavalry into a seven-squad tactical formation with corridors and bounds', () => {
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID)
    const plan = createCareerFelineSpawnPlan(profile)
    const friendly = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    const squads = [1, 2, 3, 4, 5, 6, 7].map(id => friendly.filter(spec => spec.squadId === id))

    // Squad sizes: S1-S6: 30, S7: 20
    expect(squads.map(s => s.length)).toEqual([30, 30, 30, 30, 30, 30, 20])

    // S5 and S6 corridor: min distance between S5 and S6 X coordinates
    const s5Xs = squads[4].map(spec => spec.x), s6Xs = squads[5].map(spec => spec.x)
    const s5MaxX = Math.max(...s5Xs), s6MinX = Math.min(...s6Xs)
    expect(s6MinX - s5MaxX).toBeCloseTo(9.6, 1)

    // S7 front center corridor to S1 and S2
    const s7Xs = squads[6].map(spec => spec.x)
    const s1Xs = squads[0].map(spec => spec.x), s2Xs = squads[1].map(spec => spec.x)
    expect(Math.min(...s7Xs) - Math.max(...s1Xs)).toBeCloseTo(9.6, 1)
    expect(Math.min(...s2Xs) - Math.max(...s7Xs)).toBeCloseTo(9.6, 1)

    // S3 rear left to S5 and S6 to S4 rear right
    const s3Xs = squads[2].map(spec => spec.x), s4Xs = squads[3].map(spec => spec.x)
    expect(Math.min(...s5Xs) - Math.max(...s3Xs)).toBeCloseTo(9.6, 1)
    expect(Math.min(...s4Xs) - Math.max(...s6Xs)).toBeCloseTo(9.6, 1)

    // Verify player clearance: all friendly units are safely in front of player spawn (|Z| = 145)
    for (const spec of friendly) {
      expect(Math.abs(spec.z)).toBeLessThanOrEqual(140)
    }
  })

  it('validates feline deployment readiness contracts before dismissing loading', () => {
    // Calling production validateFelineDeploymentReadiness directly
    expect(() => validateFelineDeploymentReadiness({ spawnBatchReady: false, battleReady: true, personalSquadReady: true })).toThrow('Six Feline Cavalry deployment did not complete')
    expect(() => validateFelineDeploymentReadiness({ spawnBatchReady: true, battleReady: false, personalSquadReady: true })).toThrow('Six Feline Cavalry deployment did not complete')
    expect(() => validateFelineDeploymentReadiness({ spawnBatchReady: true, battleReady: true, personalSquadReady: false })).toThrow('Six Feline Cavalry deployment did not complete')
    expect(() => validateFelineDeploymentReadiness({ spawnBatchReady: true, battleReady: true })).not.toThrow()
    expect(() => validateFelineDeploymentReadiness({ spawnBatchReady: true, battleReady: true, personalSquadReady: true })).not.toThrow()
  })

  it('migrates orphan mount species deterministically while preserving saved physical status', () => {
    const profile = accepted(COMMANDER_FELINE_CAVALRY_ID)
    const mission = profile.activeMission!
    const plan = createCareerFelineSpawnPlan(profile)
    const firstMeleeSpec = plan.npcSpecs.find(spec => spec.faction === Faction.PLAYER && spec.loadout?.mountId === 'caracal')!
    const actorId = firstMeleeSpec.actorId!
    const cat = { hp: 215, mounted: false, position: { x: 12.5, y: 0.5, z: -110, yaw: 1.2 } }
    const actors: CaptainEagleCheckpoint['actors'] = Object.fromEntries(
      [...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'reserve' as const }]))
    actors[actorId] = { status: 'dead', hp: 0, mount: cat }
    mission.felineBattle = { ready: true, actors, playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, player: {
      hp: 100, stamina: 100, dead: false, position: { x: 0, y: 0, z: -145, yaw: 0 }, ammo: 20, shieldImpact: 0,
    } }

    const orphanPlan = createCareerFelineOrphanMountPlan(profile)
    const restored = orphanPlan.find(m => m.actorId === actorId)
    expect(restored).toBeDefined()
    expect(restored!.mountId).toBe('caracal')
    expect(restored!.saved.hp).toBe(215)
    expect(restored!.saved.position.x).toBe(12.5)
    expect(restored!.saved.position.z).toBe(-110)
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
