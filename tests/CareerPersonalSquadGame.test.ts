import { advanceNpcFrame, installNpcLoadingFrames, gameplayNpcSpawnDriver } from './helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../src/Game'
import { DefenseCampaignRuntime } from '../src/campaign/DefenseCampaignRuntime'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { personalMissionSourcePolicy, clonePersonalMission } from '../src/career/CareerPersonalSquadMission'
import { personalRearDeployment, personalTownDeployment } from '../src/career/PersonalSquadDeployment'
import { acceptCareerOutpost, acceptCareerOutpostRelief, parseCareerOutpostCheckpoint } from '../src/career/CareerOutpostMission'
import { createCareerReliefSpawnPlan } from '../src/career/CareerOutpostRelief'
import { getCampaignDefenderFacingYaw } from '../src/campaign/CampaignOutpost'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'
import { createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { Faction } from '../src/world/NPC'
import { MemoryStorage } from './helpers/memoryStorage'

afterEach(() => vi.unstubAllGlobals())

function profile(): CareerProfile {
  return acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 6000, availableMerit: 6000,
    personalSquad: { members: [{ id: 'personal:game', type: 'captain' }] } }, 1, 'regular-checkpoint')!
}

function fixture(current = profile()) {
  const store = new CareerProfileStore(new MemoryStorage())
  expect(store.save(current)).toBe(true)
  const personal = clonePersonalMission(current.activeOutpostMission!.personalSquad!)
  personal.sceneKey = `outpost:${current.activeOutpostMission!.id}`; personal.state = 'ACTIVE'
  personal.members['personal:game'] = { status: 'deployed', hp: 17, ammo: 3, order: 'attack', position: { x: 30, z: -160, yaw: 0 },
    mount: { hp: 0, mounted: false, position: { x: 28, z: -160, yaw: 0 } } }
  const events = new CombatEventStream()
  const tracker = new BattleStatsTracker(events, false, undefined, current.activeOutpostMission!.battle?.playerStats,
    { acceptsSource: personalMissionSourcePolicy(current.activeOutpostMission!), initialContribution: personal.contribution })
  const game = Object.assign(Object.create(Game.prototype), {
    spawnBatches: [], initializing: false, spawningStopped: false,
    careerProfile: current, careerStore: store, defenseCampaignConfig: createCareerOutpostLaunch(current),
    defenseCampaignRuntime: new DefenseCampaignRuntime({ reinforcementsEnabled: true,
      initialSnapshot: current.activeOutpostMission!.battle?.runtime ?? { phase: 'assault', activePhase: 'assault' } }),
    personalSquad: { checkpoint: () => clonePersonalMission(personal), aliveCombatants: 1 }, personalCheckpointElapsed: 0,
    personalCriticalState: '', battleStats: tracker, npcs: [], mounts: [], careerVeteranActorMounts: new Map(),
    campaignSpawnQueue: [], campaignSpawnQueueIndex: 0, campaignSpawnWave: null, campaignAttackersStarted: false,
    campaignReinforcementSpawned: false, player: { hp: 61, staminaValue: 42, dead: false, arrowCount: 5,
      combatPosition: new THREE.Vector3(11, 0, -165), group: new THREE.Group(), currentMount: null,
      shield: { shieldImpactRemaining: 8 } }, startingHorse: null, previewCampaignGate: null, _showNotify: vi.fn(),
  }) as any
  game._spawnNpc = vi.fn((spec: any) => {
    const group = new THREE.Group(); group.position.set(spec.x, 0, spec.z)
    const mount = spec.cavalry ? { group: group.clone(), currentHp: 100, maxHp: 100, dead: false,
      takeDamage() { this.currentHp = 0; this.dead = true } } : null
    const npc = { combatantId: spec.actorId, faction: spec.faction, characterFaction: spec.characterFaction,
      hp: 100, dead: false, group, mount, get combatPosition() { return this.mount?.group.position ?? this.group.position },
      restoreCombatHealth(hp: number) { this.hp = hp; this.dead = hp === 0 }, setTacticalOrder: vi.fn(),
      dismountFromMount() { this.mount = null } }
    game.npcs.push(npc); game.careerVeteranActorMounts.set(npc.combatantId, mount)
    return npc
  })
  return { game, store, events, tracker }
}

describe('Regular Career Outpost checkpoints with private members', () => {
  it('only restores bounded known fields and rejects non-finite health, malformed flags or oversized actor lists', () => {
    const h = fixture(); expect(h.game._persistPersonalOutpost(true)).toBe(true)
    const saved = h.store.load()!.activeOutpostMission!.battle!
    const raw = { ...saved, events: ['unbounded event log'], player: { ...saved.player, runtime: {} },
      runtime: { ...saved.runtime, arbitrary: {} }, playerStats: { ...saved.playerStats, unknown: 123 } }
    expect(parseCareerOutpostCheckpoint(raw)).toEqual(saved)
    expect(parseCareerOutpostCheckpoint({ ...saved, player: { ...saved.player, hp: -1 } })).toBeUndefined()
    expect(parseCareerOutpostCheckpoint({ ...saved, player: { ...saved.player, mountHp: Infinity } })).toBeUndefined()
    expect(parseCareerOutpostCheckpoint({ ...saved, player: { ...saved.player, ammo: NaN } })).toBeUndefined()
    expect(parseCareerOutpostCheckpoint({ ...saved, attackersStarted: 'false' })).toBeUndefined()
    expect(parseCareerOutpostCheckpoint({ ...saved, actors: Array(1025).fill({}) })).toBeUndefined()
    expect(parseCareerOutpostCheckpoint({ ...saved, actors: Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [i, { hp: 1, x: 0, z: 0, yaw: 0 }])) })).toBeUndefined()
    h.tracker.dispose()
  })

  it('resumes a partial attacker wave without duplicates, restoring actual deaths and personal merit', async () => {
    const first = fixture()
    const total = first.game._queueDefenseCampaignWave('attackers')
    for (let i = 0; i < 3; i++) advanceNpcFrame(gameplayNpcSpawnDriver)
    const [dead, wounded] = first.game.npcs
    dead.restoreCombatHealth(0); wounded.restoreCombatHealth(19)
    const source = { actorId: 'personal:game', actorType: 'npc' as const, allegiance: Faction.PLAYER,
      characterFaction: 'roman' as const, squadId: 'personal' as const, ownership: 'player-personal' as const }
    first.events.emit({ type: 'damage_applied', source, target: { targetId: wounded.combatantId, targetType: 'npc', name: 'enemy' },
      method: 'projectile', requestedDamage: 100, appliedDamage: 27 })
    expect(first.game._persistPersonalOutpost(true)).toBe(true)
    const saved = first.store.load()!
    expect(saved.activeOutpostMission!.battle).toMatchObject({ wave: 'attackers', waveIndex: 3,
      player: { hp: 61, stamina: 42, ammo: 5, shieldImpact: 8 }, actors: { [dead.combatantId]: { hp: 0 }, [wounded.combatantId]: { hp: 19 } } })
    expect(saved.activeOutpostMission!.personalSquad).toMatchObject({ contribution: { damageDealt: 27 },
      members: { 'personal:game': { hp: 17, mount: { hp: 0 } } } })
    first.game.spawnBatches.forEach((batch: any) => batch.cancel())
    const resumed = fixture(saved)
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    await resumed.game._restorePersonalOutpostBattle()
    expect(resumed.game.npcs).toHaveLength(3); expect(resumed.game.campaignSpawnQueueIndex).toBe(3)
    expect(resumed.game.npcs[0]).toMatchObject({ combatantId: dead.combatantId, hp: 0, dead: true })
    expect(resumed.game.npcs[1].hp).toBe(19)
    for (let i = 3; i < total; i++) advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(resumed.game.npcs).toHaveLength(total)
    expect(new Set(resumed.game.npcs.map((npc: any) => npc.combatantId)).size).toBe(total)
    expect(resumed.tracker.commandCheckpoint().damageDealt).toBe(27)
    first.tracker.dispose(); resumed.tracker.dispose()
  })

  it('preserves historical wave progress during partial RAF restoration and a forced pagehide checkpoint', async () => {
    const first = fixture(), total = first.game._queueDefenseCampaignWave('attackers')
    for (let i = 0; i < 3; i++) advanceNpcFrame(gameplayNpcSpawnDriver)
    first.game.npcs[1].restoreCombatHealth(23)
    expect(first.game._persistPersonalOutpost(true)).toBe(true)
    first.game.spawnBatches.forEach((batch: any) => batch.cancel())
    const saved = first.store.load()!, resumed = fixture(saved), callbacks: FrameRequestCallback[] = []
    resumed.game.initializing = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
    const loading = resumed.game._restorePersonalOutpostBattle()
    expect(resumed.game.npcs).toHaveLength(0)
    callbacks.shift()!(advanceNpcFrame(gameplayNpcSpawnDriver)); await Promise.resolve(); await Promise.resolve()
    expect(resumed.game.npcs).toHaveLength(1)
    expect(resumed.game._persistPersonalOutpost(true)).toBe(true)
    expect(resumed.store.load()!.activeOutpostMission!.battle).toEqual(saved.activeOutpostMission!.battle)
    expect(resumed.store.load()!.activeOutpostMission!.battle!.waveIndex).toBe(3)
    resumed.game.spawnBatches.forEach((batch: any) => batch.cancel())
    callbacks.shift()!(advanceNpcFrame(gameplayNpcSpawnDriver))
    await expect(loading).rejects.toThrow('cancelled')
    const restarted = fixture(resumed.store.load()!)
    installNpcLoadingFrames(gameplayNpcSpawnDriver); await restarted.game._restorePersonalOutpostBattle()
    expect(restarted.game.npcs).toHaveLength(3)
    expect(restarted.game.npcs[1].hp).toBe(23)
    expect(restarted.game.campaignSpawnQueueIndex).toBe(3)
    expect(restarted.game.campaignSpawnWave).toBe('attackers')
    for (let i = 3; i < total; i++) advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(restarted.game.npcs).toHaveLength(total)
    expect(new Set(restarted.game.npcs.map((npc: any) => npc.combatantId)).size).toBe(total)
    first.tracker.dispose(); resumed.tracker.dispose(); restarted.tracker.dispose()
  })

  it('keeps completed reinforcement casualties and does not queue a second wave on reload', async () => {
    const first = fixture()
    first.game.campaignAttackersStarted = false
    const total = first.game._queueDefenseCampaignWave('reinforcement')
    for (let i = 0; i < total; i++) advanceNpcFrame(gameplayNpcSpawnDriver)
    first.game.npcs[1].restoreCombatHealth(0)
    first.game.careerVeteranActorMounts.get(first.game.npcs[1].combatantId).takeDamage(1000)
    expect(first.game._persistPersonalOutpost(true)).toBe(true)
    const resumed = fixture(first.store.load()!)
    installNpcLoadingFrames(gameplayNpcSpawnDriver)
    await resumed.game._restorePersonalOutpostBattle()
    expect(resumed.game.campaignReinforcementSpawned).toBe(true)
    expect(resumed.game.campaignSpawnWave).toBeNull()
    expect(resumed.game.npcs).toHaveLength(total)
    expect(resumed.game.npcs[1]).toMatchObject({ hp: 0, dead: true, mount: null })
    expect(resumed.game.careerVeteranActorMounts.get(resumed.game.npcs[1].combatantId).dead).toBe(true)
    first.tracker.dispose(); resumed.tracker.dispose()
  })

  it('does not put private physical participants into official faction or checkpoint actor lists', () => {
    const h = fixture()
    h.game.npcs = [{ combatantId: 'personal:game', combatOwnership: 'player-personal', faction: Faction.PLAYER,
      characterFaction: 'roman', dead: false }]
    expect(h.game._campaignFactionAlive('roman')).toBe(0)
    expect(h.game._persistPersonalOutpost(true)).toBe(true)
    expect(h.store.load()!.activeOutpostMission!.battle!.actors).toEqual({})
    h.tracker.dispose()
  })
})

describe('Personal deployment uses existing navigation and independent slots', () => {
  it.each(['roman', 'viking'] as const)('fits thirty private members behind the actual %s Relief rescue roster near the map edge', faction => {
    const current = { ...createCareerProfile(faction), rank: 'captain' as const, totalMerit: 6000, availableMerit: 6000,
      completedOutpostStages: [1, 2, 3] as const, selectedMountId: 'horse' as const, ownedMounts: ['horse'] as any,
      personalSquad: { members: Array.from({ length: 30 }, (_, i) => ({ id: `personal:relief-${i}`, type: 'soldier' as const })) } }
    const accepted = acceptCareerOutpostRelief({ ...current, completedOutpostStages: [...current.completedOutpostStages] }, 'relief-placement')!
    const config = createCareerOutpostLaunch(accepted), plan = createCareerReliefSpawnPlan(config)
    const official = plan.npcSpecs.filter(npc => npc.faction === Faction.PLAYER)
    expect(official.filter(npc => npc.squadId !== undefined)).toHaveLength(49)
    expect(plan.npcSpecs.filter(npc => npc.faction === Faction.ENEMY)).toHaveLength(60)
    const bounds = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, navigation = new NavigationWorld(bounds)
    navigation.sync([])
    const yaw = getCampaignDefenderFacingYaw(faction) + Math.PI, anchor = { ...plan.playerSpawn, yaw }
    const slots = personalRearDeployment(anchor, official, 31, bounds, [], navigation, true)
    const projection = (p: { x: number; z: number }) => p.x * Math.sin(yaw) + p.z * Math.cos(yaw)
    expect(projection(slots[0])).toBeLessThan(Math.min(...official.map(projection)))
    for (const point of slots.slice(1)) expect(projection(point)).toBeLessThan(projection(slots[0]))
    expect(slots.every(slot => Math.abs(slot.x) <= 297 && Math.abs(slot.z) <= 297)).toBe(true)
  })

  it('still puts every private row behind Player when an obstacle blocks the first rear center', () => {
    const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, navigation = new NavigationWorld(bounds)
    const obstacles = [{ box: new THREE.Box3(new THREE.Vector3(-1, -10, -9), new THREE.Vector3(1, 10, -7)), isBarricade: false }]
    navigation.sync(obstacles)
    const slots = personalRearDeployment({ x: 0, z: 0, yaw: 0 }, [], 31, bounds, obstacles, navigation, true)
    for (const point of slots.slice(1)) expect(point.z).toBeLessThan(slots[0].z)
  })

  it.each([0, Math.PI])('puts Player and thirty private actors strictly behind official lanes at heading %s', yaw => {
    const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, navigation = new NavigationWorld(bounds)
    navigation.sync([])
    const anchor = { x: 0, z: 0, yaw }, official = Array.from({ length: 80 }, (_, i) => ({ x: (i % 10 - 4.5) * 3, z: (Math.floor(i / 10) + 1) * 3 * Math.cos(yaw) }))
    const slots = personalRearDeployment(anchor, official, 31, bounds, [], navigation, true)
    const projection = (p: { x: number; z: number }) => p.x * Math.sin(yaw) + p.z * Math.cos(yaw)
    expect(projection(slots[0])).toBeLessThan(Math.min(...official.map(projection)))
    for (const point of slots.slice(1)) expect(projection(point)).toBeLessThan(projection(slots[0]))
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThanOrEqual(4.8)
    }
  })

  it('fits thirty independent Town scout entry slots near the map edge without leaving the map', () => {
    const bounds = { minX: -350, maxX: 350, minZ: -350, maxZ: 350 }, navigation = new NavigationWorld(bounds)
    navigation.sync([])
    const anchor = { x: 0, z: 310, yaw: Math.PI }, official = Array.from({ length: 99 }, (_, i) => ({ x: (i % 11 - 5) * 3, z: 315 + Math.floor(i / 11) * 3 }))
    const slots = personalTownDeployment(anchor, official, 30, bounds, [], navigation)
    expect(slots).toHaveLength(30)
    for (const slot of slots) {
      expect(slot.z).toBeLessThanOrEqual(347)
      expect(official.every(p => Math.hypot(p.x - slot.x, p.z - slot.z) >= 4.8)).toBe(true)
      expect(navigation.areConnected(anchor, slot)).toBe(true)
    }
  })
})
