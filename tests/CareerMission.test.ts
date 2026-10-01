import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { RECRUIT_MISSION_CATALOG, availableRecruitMissions } from '../src/career/CareerMissionCatalog'
import { calculateRecruitMissionMerit } from '../src/career/CareerMissionMeritPolicy'
import { acceptsCareerMissionStat, createActiveCareerMission, resolveCareerMissionOutcome } from '../src/career/CareerMissionState'
import { claimCareerMission, cloneCareerProfile, createCareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { canUseCareerMount, findSafeCareerMountPosition, ownedCareerMountIds } from '../src/career/CareerMountController'
import { preserveHpRatio, resolveCareerCombatProfile, resolveCareerHeroAsset } from '../src/career/CareerPlayerProfile'
import { missionGuideArrowAngle } from '../src/career/MissionGuide'
import { fieldMissionEngagementLabel, fieldMissionHud } from '../src/career/CareerMissionPresentation'
import { Faction } from '../src/combat/CombatFaction'
import { calculatePlayerMeleeDamage } from '../src/combat/PlayerMeleeDamage'
import { BanditMissionController, selectMissionInfantryActorIds, shouldPersistMissionRoute } from '../src/career/BanditMissionController'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'

const playerStats = (damageDealt: number, kills: number, survived = true) => ({
  damageDealt, kills, survived, damageTaken: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0,
})

describe('Recruit mission catalog and merit', () => {
  it('defines a compact repeatable board plus a late one-time Town Defense milestone', () => {
    expect(RECRUIT_MISSION_CATALOG).toHaveLength(10)
    const bandits = RECRUIT_MISSION_CATALOG.filter(mission => mission.kind === 'bandit')
    const patrols = RECRUIT_MISSION_CATALOG.filter(mission => mission.kind === 'patrol')
    const defense = RECRUIT_MISSION_CATALOG.find(mission => mission.kind === 'town-defense')!
    expect(bandits.map(m => [m.friendlyCombatants, m.banditCount])).toEqual([[5, 3], [20, 12], [6, 10], [10, 20]])
    expect(patrols.map(m => [m.routeId, m.friendlyCombatants, m.encounterBanditCount])).toEqual([
      ['south-road', 6, 4],
      ['forest-line', 8, 7],
    ])
    for (const mission of bandits) expect(mission.friendlyCombatants).toBe(mission.friendlySoldiers + 2)
    expect(defense.storyOnce).toBe(true)
    expect(defense.requiresCompletions).toBe(5)
    expect([defense.friendlySoldiers, defense.enemyCount, defense.civilianCount, defense.maxCivilianDeaths]).toEqual([60, 50, 20, 10])
    expect(defense.friendlyCombatants).toBe(64)
    let profile = createCareerProfile('roman')
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(2)
    profile.careerMissionCompletions = 1
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(3)
    profile.totalMerit = 60
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(4)
    profile.totalMerit = 90
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(5)
    profile.totalMerit = 120; profile.careerMissionCompletions = 5
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(7)
    profile.completedCareerMissionTemplateIds = [defense.id]
    expect(availableRecruitMissions(profile).filter(mission => mission.kind !== 'enemy-town-assault')).toHaveLength(6)
    for (const rank of ['soldier', 'veteran', 'captain', 'commander'] as const) {
      profile.rank = rank
      expect(availableRecruitMissions(profile).filter(mission => mission.id !== 'soldier-town-defense-01').map(mission => mission.id)).toEqual(availableRecruitMissions({ ...profile, rank: 'recruit' }).map(mission => mission.id))
      expect(availableRecruitMissions(profile).some(mission => mission.id === 'soldier-town-defense-01')).toBe(true)
    }
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    expect(availableRecruitMissions(profile)).toEqual([])
  })

  it('gives spectators zero and scales low, normal and high personal contribution', () => {
    expect(calculateRecruitMissionMerit(playerStats(0, 0), 'victory').total).toBe(0)
    expect(calculateRecruitMissionMerit(playerStats(12, 0, false), 'failure').total).toBe(0)
    expect(calculateRecruitMissionMerit(playerStats(20, 0), 'victory').total).toBe(3)
    expect(calculateRecruitMissionMerit(playerStats(180, 0), 'victory').total).toBe(21)
    expect(calculateRecruitMissionMerit(playerStats(250, 1), 'victory').total).toBe(30)
    expect(calculateRecruitMissionMerit(playerStats(500, 3), 'victory').total).toBe(55)
  })

  it('paces roughly nine ordinary contributions plus one normal Town Defense contribution to Soldier eligibility', () => {
    const ordinaryRewards = Array.from({ length: 9 }, (_, index) => calculateRecruitMissionMerit(playerStats(150 + index * 20, 1), 'victory').total)
    const defenseReward = calculateRecruitMissionMerit(playerStats(300, 2), 'victory').total
    expect(ordinaryRewards.slice(0, 5).reduce((sum, value) => sum + value, 0)).toBeLessThan(300)
    expect(ordinaryRewards.reduce((sum, value) => sum + value, 0) + defenseReward).toBe(300)
  })
})

describe('Mission identity, attribution and claim', () => {
  it('points the guide toward screen-space forward, right and left targets', () => {
    expect(missionGuideArrowAngle(0, -10, 0)).toBeCloseTo(-Math.PI / 2)
    expect(missionGuideArrowAngle(10, 0, 0)).toBeCloseTo(0)
    expect(Math.abs(missionGuideArrowAngle(-10, 0, 0))).toBeCloseTo(Math.PI)
    expect(missionGuideArrowAngle(-10, 0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
  })

  it('never reveals the ambush size during a patrol while Bandit clearance shows the remaining count', () => {
    expect(fieldMissionEngagementLabel('patrol', 7)).toBe('巡邏遭遇伏擊 · 解除威脅')
    expect(fieldMissionHud('patrol', 'MARCHING', 7)).not.toContain('7')
    expect(fieldMissionHud('patrol', 'ENGAGING', 7)).not.toContain('7')
    expect(fieldMissionEngagementLabel('bandit', 7)).toContain('7')
    expect(fieldMissionHud('bandit', 'ENGAGING', 7)).toContain('7')
    for (const mission of RECRUIT_MISSION_CATALOG.filter(mission => mission.kind === 'patrol')) {
      expect(mission.briefing).not.toMatch(/遭遇|敵人|敵軍|Bandit/i)
    }
  })

  it('creates stable roster identities and never counts Ambient or other-camp targets', () => {
    const mission = createActiveCareerMission('recruit-bandits-01', 2, 3, 3, 'mission-stable')
    expect(mission.targetActorIds).toEqual(['mission-stable:bandit:0', 'mission-stable:bandit:1', 'mission-stable:bandit:2'])
    const source = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'roman' as const }
    const event = (targetId: string) => ({ type: 'damage_applied' as const, source, target: { targetId, targetType: 'npc' as const, name: 'Bandit' }, method: 'projectile' as const, requestedDamage: 20, appliedDamage: 20 })
    expect(acceptsCareerMissionStat(mission, event(mission.targetActorIds[0]))).toBe(true)
    expect(acceptsCareerMissionStat(mission, event('ambient:2:0'))).toBe(false)
    expect(acceptsCareerMissionStat(mission, {
      ...event('mount:horse'),
      target: { targetId: 'mount:horse', targetType: 'mount', name: 'War horse', ownerActorId: mission.targetActorIds[0] },
    })).toBe(true)
    expect(acceptsCareerMissionStat(mission, {
      type: 'actor_killed', source,
      target: { targetId: 'mount:horse', targetType: 'mount', name: 'War horse', ownerActorId: mission.targetActorIds[0] },
      method: 'melee',
    })).toBe(false)
  })

  it('shares T4, skill, berserker and mounted-lance damage rules with normal battles', () => {
    const ordinary = calculatePlayerMeleeDamage({
      baseDamage: 20, combatKind: 'sword', isLance: false, isMounted: false, mountSpeed: 0,
      oneHandedMultiplier: 1, faction: 'roman', hasShield: false,
    })
    const chargedHero = calculatePlayerMeleeDamage({
      baseDamage: 20, combatKind: 'lance', isLance: true, isMounted: true, mountSpeed: 12,
      oneHandedMultiplier: 1.3, faction: 'viking', hasShield: false, heroAssetId: 'viking-hero-t4',
    })
    expect(ordinary).toEqual({ damage: 20, isCharge: false })
    expect(chargedHero.isCharge).toBe(true)
    expect(chargedHero.damage).toBeGreaterThan(ordinary.damage * 3)
  })

  it('can bind the exact existing Town captain as Mission Leader instead of cloning one', () => {
    const mission = createActiveCareerMission('recruit-patrol-01', 1, 4, 4, 'patrol-captain', 'patrol', 'captain')
    expect(mission.kind).toBe('patrol')
    expect(mission.friendlyActorIds[0]).toBe('captain')
    expect(mission.friendlyActorIds.slice(1)).toHaveLength(4)
  })

  it('draws mission soldiers from living existing sword and spear infantry', () => {
    const residents = [
      { spec: { role: 'melee_cavalry' }, npc: { dead: false, combatantId: 'cavalry' } },
      { spec: { role: 'melee_infantry' }, npc: { dead: false, combatantId: 'infantry-a' } },
      { spec: { role: 'melee_infantry' }, npc: { dead: true, combatantId: 'infantry-dead' } },
      { spec: { role: 'ranged_cavalry' }, npc: { dead: false, combatantId: 'mounted-archer' } },
      { spec: { role: 'melee_infantry' }, npc: { dead: false, combatantId: 'infantry-b' } },
      { spec: { role: 'spearman_infantry' }, npc: { dead: false, combatantId: 'spear' } },
    ]
    expect(selectMissionInfantryActorIds(residents, 3)).toEqual(['infantry-a', 'infantry-b', 'spear'])
  })

  it('checkpoints route progress coarsely instead of writing every route node', () => {
    expect(shouldPersistMissionRoute(0, 1, 8)).toBe(false)
    expect(shouldPersistMissionRoute(0, 2, 8)).toBe(false)
    expect(shouldPersistMissionRoute(0, 3, 8)).toBe(true)
    expect(shouldPersistMissionRoute(6, 8, 8)).toBe(true)
  })

  it('completes physical return when the captain and player arrive, without waiting for every soldier', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'return-both', 'bandit', 'captain')
    profile.activeMission.phase = 'RETURNING'
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    const player = { combatPosition: new THREE.Vector3(300, 0, 300) }
    controller.readProfile = () => profile
    controller.player = () => player
    const assembly = controller.assemblyPoint()
    const leader = { dead: false, combatPosition: assembly.clone() }
    const follower = { dead: false, combatPosition: new THREE.Vector3(300, 0, 300) }
    controller.leader = leader
    controller.friendlies = [leader, follower]
    expect(controller.partyReturned).toBe(true)
    expect(controller.playerReturned).toBe(false)
    expect(controller.returnComplete).toBe(false)
    player.combatPosition.copy(assembly)
    expect(controller.returnComplete).toBe(true)
    follower.combatPosition.copy(assembly)
    leader.combatPosition.set(300, 0, 300)
    expect(controller.playerReturned).toBe(true)
    expect(controller.returnComplete).toBe(false)
    leader.dead = true; follower.dead = true
    expect(controller.partyReturned).toBe(true)
    expect(controller.returnComplete).toBe(true)
  })

  it('holds the captain outside a bandit camp until the soldiers regroup, without waiting for the player', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 0, 12, 0, 'assault-regroup', 'bandit', 'captain')
    profile.activeMission.phase = 'MARCHING'
    const stage = new THREE.Vector3(130, 0, -130)
    const leader = { dead: false, combatPosition: stage.clone(), setTacticalOrder: vi.fn() }
    const followers = Array.from({ length: 18 }, () => ({ dead: false, combatPosition: new THREE.Vector3(0, 0, 0), setTacticalOrder: vi.fn() }))
    const bandit = { dead: false, encounterIsAlerted: false, triggerEncounterAlert: vi.fn() }
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.player = () => ({ combatPosition: new THREE.Vector3(500, 0, 500) })
    controller.camps = [{ id: 0, center: new THREE.Vector3(170, 0, -165), ambient: [], mission: [bandit] }]
    controller.friendlies = [leader, ...followers]
    controller.leader = leader
    controller.route = []; controller.routeIndex = 0; controller.perceptionElapsed = 0; controller.statsCheckpointElapsed = 0
    controller.guide = { update: vi.fn() }
    controller.detectCampProximity = vi.fn(); controller.persistRuntimeProgress = vi.fn(); controller.advanceRoute = vi.fn()
    controller.marchObjective = () => stage

    controller.updateFlow(.016, 0)
    expect(profile.activeMission.phase).toBe('MARCHING')
    expect(leader.setTacticalOrder).not.toHaveBeenCalled()
    for (const follower of followers.slice(0, 13)) follower.combatPosition.copy(stage)
    controller.updateFlow(.016, 0)
    expect(profile.activeMission.phase).toBe('MARCHING')
    followers[13].combatPosition.copy(stage)
    controller.updateFlow(.016, 0)
    expect(profile.activeMission.phase).toBe('ENGAGING')
    expect(bandit.triggerEncounterAlert).toHaveBeenCalledOnce()
    expect([leader, ...followers].every(soldier => soldier.setTacticalOrder.mock.calls[0]?.[0] === 'charge')).toBe(true)
  })

  it('guides the player to the real camp while snapping the AI staging point to walkable ground', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 0, 12, 0, 'separate-guide-stage', 'bandit', 'captain')
    profile.activeMission.phase = 'MARCHING'
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.assemblyPoint = () => new THREE.Vector3(0, 0, 0)
    controller.world = { obstacles: [] }
    const snapped = new THREE.Vector3(121, 0, -119)
    controller.navigation = { sync: vi.fn(), grid: { findNearestWalkableCell: vi.fn(() => ({ x: 1, z: 2 })), cellToWorld: vi.fn(() => snapped.clone()) } }
    const camp = new THREE.Vector3(170, 0, -165)
    const template = RECRUIT_MISSION_CATALOG.find(mission => mission.id === 'recruit-bandits-02')!

    const marchTarget = controller.marchTarget(template, profile.activeMission, camp)
    const guideTarget = controller.guideTarget(profile.activeMission, camp)
    expect(controller.navigation.grid.findNearestWalkableCell).toHaveBeenCalledOnce()
    expect(controller.navigation.sync).toHaveBeenCalledWith([])
    expect(marchTarget.x).toBe(snapped.x)
    expect(marchTarget.z).toBe(snapped.z)
    expect(guideTarget).toBe(camp)
  })

  it('rebuilds a reloaded patrol from the previous semantic objective instead of Town', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-patrol-01', 0, 4, 0, 'patrol-reload-segment', 'patrol', 'captain')
    profile.activeMission.phase = 'MARCHING'
    profile.activeMission.patrolStage = 1
    profile.activeMission.routeStage = 3
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.camps = [{ id: 0, center: new THREE.Vector3(120, 0, 120), ambient: [], mission: [] }]
    controller.events = new CombatEventStream()
    controller.friendlies = []; controller.leader = null
    controller.disposeMissionEntities = vi.fn()
    controller.disposeCamp = vi.fn()
    controller.spawnBandit = vi.fn((_: unknown, combatantId: string) => ({ combatantId, dead: false }))
    controller.spawnFriendlyParty = vi.fn(() => { controller.friendlies = []; controller.leader = { dead: false } })
    const buildRoute = vi.fn((from: THREE.Vector3, to: THREE.Vector3) => [from.clone(), to.clone()])
    controller.buildRoute = buildRoute
    controller.setRoute = vi.fn()
    controller.positionPartyForReload = vi.fn()
    controller.assignLeader = vi.fn()
    controller.assignFollowers = vi.fn()
    const template = RECRUIT_MISSION_CATALOG.find(mission => mission.id === 'recruit-patrol-01') as any
    const objectives = controller.patrolWaypoints(template, controller.camps[0].center)

    expect(controller.startActiveMission()).toBe(true)
    expect(buildRoute).toHaveBeenCalledOnce()
    expect(buildRoute.mock.calls[0][0]).toEqual(objectives[0])
    expect(buildRoute.mock.calls[0][1]).toEqual(objectives[1])
    expect(controller.setRoute).toHaveBeenCalledWith(expect.any(Array), objectives[0], 3)
  })

  it('lets the player finish patrol and return alone after every mission friendly dies', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-patrol-01', 0, 4, 0, 'patrol-player-only', 'patrol', 'captain')
    profile.activeMission.phase = 'ENGAGING'
    const player = { combatPosition: new THREE.Vector3(400, 0, 400), dead: false }
    const deadFriendlies = profile.activeMission.friendlyActorIds.map(combatantId => ({ dead: true, combatantId, combatPosition: new THREE.Vector3(), tacticalOrder: 'charge', setTacticalOrder: vi.fn() }))
    const deadBandits = profile.activeMission.targetActorIds.map(combatantId => ({ dead: true, combatantId, combatPosition: new THREE.Vector3(), encounterIsAlerted: false }))
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.player = () => player
    controller.camps = [{ id: 0, center: new THREE.Vector3(120, 0, 120), ambient: [], mission: deadBandits }]
    controller.friendlies = deadFriendlies; controller.leader = null; controller.world = { obstacles: [] }
    controller.guide = { hide: vi.fn(), update: vi.fn() }; controller.route = []; controller.routeIndex = 0
    controller.tracker = null; controller.statsCheckpointElapsed = 0; controller.perceptionElapsed = 0
    const template = RECRUIT_MISSION_CATALOG.find(mission => mission.id === 'recruit-patrol-01') as any
    const objectives = controller.patrolWaypoints(template, controller.camps[0].center)
    profile.activeMission.patrolStage = controller.patrolEncounterStage(template, profile.activeMission.id, controller.camps[0].center)

    controller.updateFlow(.2, 0)
    expect(profile.activeMission.phase).toBe('MARCHING')
    while ((profile.activeMission?.patrolStage ?? 0) < objectives.length) {
      player.combatPosition.copy(objectives[profile.activeMission!.patrolStage ?? 0])
      controller.updateFlow(.2, 0)
    }
    expect(controller.evaluate(false)).toBe('victory')

    expect(controller.startReturning()).toBe(true)
    expect(profile.activeMission.phase).toBe('RETURNING')
    expect(controller.missionLeader).toBeNull()
    expect(controller.route).toHaveLength(0)
    controller.updateFlow(.2, 0)
    expect(controller.guide.update).toHaveBeenLastCalledWith('RETURNING', player.combatPosition, 0, controller.assemblyPoint(), 0, false, true)
    player.combatPosition.copy(controller.assemblyPoint())
    expect(controller.partyReturned).toBe(true)
    expect(controller.returnComplete).toBe(true)
  })

  it('persists Bandit mission player totals and resumes accumulation without crediting friendly kills', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'stats-bandit', 'bandit', 'captain')
    profile.activeMission.phase = 'ENGAGING'
    const active = profile.activeMission
    const events = new CombatEventStream()
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.camps = [{ id: 0, center: new THREE.Vector3(), ambient: [], mission: [{ combatantId: active.targetActorIds[0], dead: false }] }]
    controller.friendlies = []; controller.route = []; controller.routeIndex = 0; controller.statsCheckpointElapsed = 5
    controller.tracker = new BattleStatsTracker(events, false, event => acceptsCareerMissionStat(active, event))
    const playerSource = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'roman' as const }
    const friendlySource = { actorId: 'captain', actorType: 'npc' as const, allegiance: Faction.TOWN, characterFaction: 'roman' as const }
    const target = { targetId: active.targetActorIds[0], targetType: 'npc' as const, name: 'Bandit' }
    events.emit({ type: 'damage_applied', source: playerSource, target, method: 'melee', requestedDamage: 120, appliedDamage: 120 })
    events.emit({ type: 'actor_killed', source: playerSource, target, method: 'melee' })
    events.emit({ type: 'actor_killed', source: friendlySource, target: { ...target, targetId: active.targetActorIds[1] }, method: 'melee' })
    controller.persistRuntimeProgress()
    expect(profile.activeMission?.playerStats).toMatchObject({ damageDealt: 120, kills: 1 })

    const resumedEvents = new CombatEventStream()
    const resumed = new BattleStatsTracker(resumedEvents, false, event => acceptsCareerMissionStat(profile.activeMission!, event), profile.activeMission?.playerStats)
    resumedEvents.emit({ type: 'damage_applied', source: playerSource, target, method: 'projectile', requestedDamage: 45, appliedDamage: 45 })
    expect(resumed.checkpoint()).toMatchObject({ damageDealt: 165, kills: 1 })
  })

  it('updates ambient Bandit perception without an active mission and after every friendly is dead', () => {
    let profile = createCareerProfile('roman')
    const alert = vi.fn()
    const bandit = { dead: false, combatantId: 'ambient:0:0', combatPosition: new THREE.Vector3(), encounterAggroState: 'idle', triggerEncounterAlert: alert }
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.player = () => ({ combatPosition: new THREE.Vector3(2, 0, 0), dead: false })
    controller.camps = [{ id: 0, center: new THREE.Vector3(), ambient: [bandit], mission: [] }]
    controller.friendlies = []; controller.world = { obstacles: [] }; controller.guide = { hide: vi.fn(), update: vi.fn() }
    controller.perceptionElapsed = .2
    controller.updateFlow(.2, 0)
    expect(alert).toHaveBeenCalledOnce()

    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'all-friendlies-dead', 'bandit', 'captain')
    profile.activeMission.phase = 'ENGAGING'
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.friendlies = [{ dead: true, combatantId: 'captain' }]
    controller.leader = null; controller.route = []; controller.routeIndex = 0; controller.tracker = null; controller.statsCheckpointElapsed = 0
    bandit.encounterAggroState = 'returning'; alert.mockClear(); controller.perceptionElapsed = .2
    controller.updateFlow(.2, 0)
    expect(alert).toHaveBeenCalledOnce()
    bandit.encounterAggroState = 'provoked'; alert.mockClear(); controller.perceptionElapsed = .2
    controller.updateFlow(.2, 0)
    expect(alert).not.toHaveBeenCalled()
  })

  it('resumes a patrol after its encounter and requires every meaningful patrol objective before victory', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-patrol-01', 0, 4, 0, 'patrol-route', 'patrol', 'captain')
    profile.activeMission.phase = 'ENGAGING'
    const leader = {
      dead: false, combatantId: 'captain', combatPosition: new THREE.Vector3(), tacticalOrder: 'charge',
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn(),
    }
    const missionBandits = profile.activeMission.targetActorIds.map(combatantId => ({ dead: true, combatantId, combatPosition: new THREE.Vector3(500, 0, 500) }))
    const controller = Object.create(BanditMissionController.prototype) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.player = () => ({ combatPosition: new THREE.Vector3(400, 0, 400), dead: false })
    controller.camps = [{ id: 0, center: new THREE.Vector3(120, 0, 120), ambient: [], mission: missionBandits }]
    controller.friendlies = [leader]; controller.leader = leader; controller.world = { obstacles: [] }
    controller.navigation = { beginFrame: vi.fn(), queryPath: vi.fn(() => ({ status: 'blocked' })) }
    controller.guide = { hide: vi.fn(), update: vi.fn() }; controller.route = []; controller.routeIndex = 0
    controller.tracker = null; controller.statsCheckpointElapsed = 0; controller.perceptionElapsed = 0
    const template = RECRUIT_MISSION_CATALOG.find(mission => mission.id === 'recruit-patrol-01') as any
    const objectives = controller.patrolWaypoints(template, controller.camps[0].center)
    profile.activeMission.patrolStage = controller.patrolEncounterStage(template, profile.activeMission.id, controller.camps[0].center)

    controller.updateFlow(.2, 0)
    expect(profile.activeMission.phase).toBe('MARCHING')
    expect(controller.evaluate(false)).toBeNull()

    let reloaded = false
    while ((profile.activeMission?.patrolStage ?? 0) < objectives.length) {
      const stage = profile.activeMission!.patrolStage ?? 0
      leader.combatPosition.copy(objectives[stage])
      controller.updateFlow(.2, 0)
      if (!reloaded && (profile.activeMission?.patrolStage ?? 0) < objectives.length) {
        profile = parseCareerProfile(profile)!
        reloaded = true
      }
      if ((profile.activeMission?.patrolStage ?? 0) < objectives.length) expect(controller.evaluate(false)).toBeNull()
    }
    expect(reloaded).toBe(true)
    expect(controller.evaluate(false)).toBe('victory')
  })

  it('prioritizes the objective in the final-target frame and waits for roster registration', () => {
    expect(resolveCareerMissionOutcome(true, true, 0)).toBe('victory')
    expect(resolveCareerMissionOutcome(false, false, 0)).toBeNull()
    expect(resolveCareerMissionOutcome(false, true, 0)).toBe('victory')
  })

  it('claims the mission once while spectator victory remains zero', () => {
    const profile = createCareerProfile('viking')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 3, 'mission-once')
    const first = claimCareerMission(profile, 'mission-once', 'victory', playerStats(0, 0))
    expect(first.meritAwarded).toBe(0)
    expect(first.profile.activeMission?.result?.claimed).toBe(true)
    const duplicate = claimCareerMission(first.profile, 'mission-once', 'victory', playerStats(999, 9))
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.profile.totalMerit).toBe(0)
  })
})

describe('Career mounts and appointed T4 identity', () => {
  it('round-trips active-outing mount HP and death state without sharing clone references', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'mount-outing')
    profile.activeMission.mountState = {
      activeMountId: 'horse-t1',
      hp: { 'horse-t1': 43, corgi: 0 },
      unavailable: ['corgi'],
    }
    const loaded = parseCareerProfile(profile)!
    const copy = cloneCareerProfile(loaded)
    expect(loaded.activeMission?.mountState).toEqual(profile.activeMission.mountState)
    copy.activeMission!.mountState!.hp['horse-t1'] = 10
    copy.activeMission!.mountState!.unavailable.push('horse-t1')
    expect(loaded.activeMission?.mountState?.hp['horse-t1']).toBe(43)
    expect(loaded.activeMission?.mountState?.unavailable).toEqual(['corgi'])
  })

  it('keeps legacy horse ownership as T1 and distinguishes every purchased tier', () => {
    const profile = createCareerProfile('roman'); profile.ownedMounts = ['horse']; profile.rank = 'recruit'
    expect(ownedCareerMountIds(profile)).toEqual(['horse-t1'])
    profile.ownedHorseTiers = [1, 2, 3]
    expect(ownedCareerMountIds(profile)).toEqual(['horse-t1', 'horse-t2', 'horse-t3'])
    expect(canUseCareerMount(profile, 'horse-t2')).toBe(false)
    profile.rank = 'soldier'
    expect(canUseCareerMount(profile, 'horse-t2')).toBe(true)
  })

  it('fails safe-position search without changing state when every candidate is blocked', () => {
    const box = new THREE.Box3(new THREE.Vector3(-20, -20, -20), new THREE.Vector3(20, 20, 20))
    expect(findSafeCareerMountPosition(new THREE.Vector3(), [{ box, isBarricade: false }], [])).toBeNull()
  })

  it('uses appointed rank, preserves HP ratio and maps faction heroes to existing combat profiles', () => {
    const profile = createCareerProfile('roman'); profile.totalMerit = 6000
    expect(resolveCareerHeroAsset(profile)).toBeNull()
    profile.rank = 'captain'
    expect(resolveCareerHeroAsset(profile)).toBe('roman-hero-t4')
    expect(resolveCareerCombatProfile(profile)).toBe('praetorian')
    profile.faction = 'viking'; profile.rank = 'commander'
    expect(resolveCareerHeroAsset(profile)).toBe('viking-hero-t4')
    expect(resolveCareerCombatProfile(profile)).toBe('varangian')
    expect(preserveHpRatio(100, 200, 500)).toBe(250)
    expect(preserveHpRatio(0, 200, 500)).toBe(0)
  })
})
