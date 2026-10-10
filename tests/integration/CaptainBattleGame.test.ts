import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { BattleSpawnPlan } from '../../src/battle/BattleSpawner'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { careerMissionCommandMeritPolicy } from '../../src/career/CareerMissionState'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import type { NpcSpawnBatch } from '../../src/world/NpcSpawnScheduler'
import type { ArmyCommandAuthority } from '../../src/battle/ArmyCommandController'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { MemoryStorage } from '../helpers/memoryStorage'
import { advanceNpcFrame, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { RecordingNpc, RecordingMount, recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'

// Constructor-boundary doubles: Game owns all queue, registration, save and readiness decisions.
vi.mock('../../src/world/NPC', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/world/NPC')>()
  const doubles = await import('../helpers/npcSpawnRecording')
  return { ...actual, NPC: doubles.RecordingNpc }
})
vi.mock('../../src/world/Mount', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/world/Mount')>()
  const doubles = await import('../helpers/npcSpawnRecording')
  return { ...actual, Mount: class extends doubles.RecordingMount {
    takeDamage(): void { this.currentHp = 0; this.dead = true }
  } }
})

interface CaptainGameHarness {
  careerProfile: CareerProfile
  npcs: NPC[]
  mounts: Mount[]
  scene: THREE.Scene
  spawnBatches: NpcSpawnBatch[]
  captainEagleSpawnBatch?: NpcSpawnBatch
  spawningStopped: boolean
  player: { hp: number; dead: boolean; position: THREE.Vector3; combatPosition: THREE.Vector3; group: THREE.Group }
  personalSquad?: { aliveCombatants: number; ready: boolean }
  _declareCaptainEagleRoster(plan: BattleSpawnPlan): void
  _queueCaptainEagleRoster(plan: BattleSpawnPlan): void
  _persistCaptainMission(force?: boolean): boolean
  _commitCaptainMissionCheckpoint(profile: CareerProfile): boolean
  _restorePersonalOutpostPlayer(): void
  _buildCaptainMissionCheckpoint(): ActiveCareerMission
  _restorePersonalOutpostNpc(npc: NPC): void
  _updateCaptainBattle(dt: number): void
  _captainCommandAuthority(): ArmyCommandAuthority
  _applyCampaignBreachOrders(faction: 'roman' | 'viking'): void
}

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); resetSpawnRecording(); vi.restoreAllMocks() })

function profile(eagle = true): CareerProfile {
  const base = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 6000, availableMerit: 6000,
    ownedMounts: ['xongkoro' as const] }
  return (eagle ? acceptCaptainEagle(base, 'captain-game') : acceptCaptainFrontline(base, 'captain-front'))!
}

function fixture(current = profile()) {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(current)).toBe(true)
  const events = new CombatEventStream()
  const group = new THREE.Group(); group.position.set(0, 1, -225)
  const player = { group, position: group.position, combatPosition: group.position, hp: 61, staminaValue: 42, dead: false,
    arrowCount: 5, currentMount: null, shield: { shieldImpactRemaining: 8 } }
  const hud = { update: vi.fn(), showResult: vi.fn(), showSaveRetry: vi.fn(), destroy: vi.fn() }
  const game = Object.assign(Object.create(Game.prototype), {
    scene: new THREE.Scene(), npcs: [], mounts: [], spawnBatches: [], initializing: false, spawningStopped: false,
    defenseCampaignConfig: current.activeMission!.kind === 'captain-outpost-defense' ? createCaptainFrontlineLaunch(current) : null,
    captainEagleMissionId: current.activeMission!.kind === 'captain-eagle-battle' ? current.activeMission!.id : null,
    careerProfile: current, careerStore: store, combatEvents: events, player, startingHorse: null,
    controlMode: 'player', careerVeteranActorMounts: new Map(), campaignSpawnQueue: [], campaignSpawnQueueIndex: 0,
    campaignSpawnWave: null, campaignAttackersStarted: false, campaignReinforcementSpawned: false,
    defenseCampaignRuntime: new DefenseCampaignRuntime(), previewCampaignGate: null,
    soundManager: { updateEagleWingbeats: vi.fn(), playCommanderCommand: vi.fn() }, captainEagleHud: hud,
    _aimTargetRegistry: { registerNpc: vi.fn(), registerMount: vi.fn(), unregisterNpc: vi.fn(), unregisterMount: vi.fn() },
    _showNotify: vi.fn(), _flushCareerSkillProgression: () => true,
  }) as CaptainGameHarness
  const tracker = new BattleStatsTracker(events, false, undefined, current.activeMission!.playerStats,
    careerMissionCommandMeritPolicy(current.activeMission!, () => game.careerProfile.activeMission!))
  Object.assign(game, { battleStats: tracker,
    captainCheckpoint: new CareerMissionCheckpoint(() => store.load()!, next => game._commitCaptainMissionCheckpoint(next)) })
  cleanups.push(() => { game.spawnBatches.forEach(batch => batch.cancel()); tracker.dispose() })
  return { game, store, storage, events, hud, tracker }
}

describe('Captain battlefield Game callers', () => {
  it('saves all 59 accepted IDs before enqueueing and lets Player move during progressive deployment', () => {
    const h = fixture(), plan = createCaptainEagleSpawnPlan(h.game.careerProfile)
    h.game._declareCaptainEagleRoster(plan)
    expect(Object.keys(h.store.load()!.activeMission!.eagleBattle!.actors)).toHaveLength(59)
    expect(recording.npcs).toHaveLength(0)
    h.game._queueCaptainEagleRoster(plan)
    expect(h.game.captainEagleSpawnBatch!.pending).toBe(59)
    expect(recording.npcs).toHaveLength(0)
    h.game.player.position.set(45, 1, -200)
    advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(recording.npcs).toHaveLength(1)
    expect(h.game.player.position.x).toBe(45)
    const saved = h.store.load()!.activeMission!.eagleBattle!
    expect(saved.ready).toBe(false)
    expect(saved.actors[recording.npcs[0].combatantId]).toMatchObject({ status: 'deployed', hp: 100 })
    expect(saved.player.position.x).toBe(45)
  })

  it('reloads a partial declaration with wounds and ammo, skipping accepted dead actors without replacements', () => {
    const h = fixture(), plan = createCaptainEagleSpawnPlan(h.game.careerProfile)
    h.game._declareCaptainEagleRoster(plan); h.game._queueCaptainEagleRoster(plan)
    advanceNpcFrame(gameplayNpcSpawnDriver); advanceNpcFrame(gameplayNpcSpawnDriver)
    const wounded = recording.npcs[0], dead = recording.npcs[1]
    wounded.restoreCombatHealth(21); wounded.restoreCombatAmmo(2); wounded.shield.shieldImpactRemaining = 3
    wounded.mount!.currentHp = 17; wounded.setTacticalOrder('charge'); dead.restoreCombatHealth(0)
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const saved = h.store.load()!
    h.game.spawnBatches.forEach(batch => batch.cancel()); resetSpawnRecording()
    const resumed = fixture(saved), restoredPlan = createCaptainEagleSpawnPlan(saved)
    resumed.game._queueCaptainEagleRoster(restoredPlan)
    expect(resumed.game.captainEagleSpawnBatch!.pending).toBe(58)
    advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(recording.npcs[0]).toMatchObject({ combatantId: wounded.combatantId, hp: 21, combatAmmo: 2,
      tacticalOrder: 'charge', shield: { shieldImpactRemaining: 3 }, mount: { currentHp: 17 } })
    for (let remaining = 1; remaining < 58; remaining++) advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(new Set(recording.npcs.map(npc => npc.combatantId)).size).toBe(58)
    expect(recording.npcs.some(npc => npc.combatantId === dead.combatantId)).toBe(false)
    expect(resumed.store.load()!.activeMission!.eagleBattle!.actors[dead.combatantId]).toMatchObject({ status: 'dead', hp: 0 })
    expect(resumed.game.captainEagleSpawnBatch!.ready).toBe(true)
  })

  it('waits for the official and private deployment, then lets a dead Player win through surviving allies', () => {
    const h = fixture(), plan = createCaptainEagleSpawnPlan(h.game.careerProfile)
    h.game._declareCaptainEagleRoster(plan)
    const mission = h.game.careerProfile.activeMission!
    const friendly = mission.friendlyActorIds[0], enemy = mission.targetActorIds[0]
    for (const [id, actor] of Object.entries(mission.eagleBattle!.actors)) if (id !== friendly && id !== enemy) actor.status = 'dead'
    expect(h.store.save(h.game.careerProfile)).toBe(true)
    h.game.player.dead = true; h.game.player.hp = 0
    h.game._queueCaptainEagleRoster(plan)
    advanceNpcFrame(gameplayNpcSpawnDriver); h.game._updateCaptainBattle(0)
    expect(h.hud.showResult).not.toHaveBeenCalled()
    advanceNpcFrame(gameplayNpcSpawnDriver)
    h.game.personalSquad = { ready: false, aliveCombatants: 1 }
    recording.npcs.find(npc => npc.combatantId === enemy)!.restoreCombatHealth(0)
    h.game._updateCaptainBattle(0)
    expect(h.hud.showResult).not.toHaveBeenCalled()
    h.game.personalSquad.ready = true
    // This test double represents pending deployment only; it owns no checkpoint mutation.
    Object.assign(h.game.personalSquad, { checkpoint: () => undefined })
    h.game._updateCaptainBattle(0)
    expect(h.store.load()!.activeMission!.result).toMatchObject({ outcome: 'victory', merit: { total: 80 }, stats: { survived: false } })
    expect(h.hud.showResult).toHaveBeenCalledOnce()
    expect(h.game._captainCommandAuthority().enabled()).toBe(false)
  })

  it('stops and cleans partial deployment on failed actor save without accepting an unsaved spawn', () => {
    const h = fixture(), plan = createCaptainEagleSpawnPlan(h.game.careerProfile)
    h.game._declareCaptainEagleRoster(plan); h.game._queueCaptainEagleRoster(plan)
    h.storage.failWrites = true
    advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(h.game.captainEagleSpawnBatch!.status).toBe('failed')
    expect(h.game.spawningStopped).toBe(true)
    expect(h.game.npcs).toEqual([]); expect(h.game.mounts).toEqual([])
    expect(h.game.scene.children).toEqual([])
    h.storage.failWrites = false
    expect(Object.values(h.store.load()!.activeMission!.eagleBattle!.actors).every(actor => actor.status === 'reserve')).toBe(true)
  })

  it('saves Stage IX falling Player state through the actual checkpoint transaction and restores it on reload', () => {
    const h = fixture(profile(false))
    const fall = { active: true, highestFeetY: 51, velocity: { x: 2, y: -9, z: 3 } }
    h.game.player.position.set(12, 34, 23)
    Object.assign(h.game.player, { isFalling: true, fallSnapshot: fall })
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const saved = h.store.load()!
    expect(saved.playerAerialState).toMatchObject({ sceneKey: 'outpost:captain-front', hp: 61,
      position: { x: 12, y: 34, z: 23 }, fall })
    const resumed = fixture(saved)
    const restorePendingFall = vi.fn()
    Object.assign(resumed.game.player, { faceDirection: vi.fn(), setHp: vi.fn(), setStamina: vi.fn(), setArrowCount: vi.fn(),
      dismountFromMount: vi.fn(), restorePendingFall, shield: { shieldImpactRemaining: 0, shieldImpactMax: 100 } })
    resumed.game._restorePersonalOutpostPlayer()
    expect(resumed.game.player.position).toEqual(new THREE.Vector3(12, 34, 23))
    expect(restorePendingFall).toHaveBeenCalledWith(fall)
  })

  it('keeps a dismounted Stage IX Player on foot and restores the wounded mount at its parked position', () => {
    const h = fixture(profile(false)), mount = new RecordingMount(h.game.scene, 'horse' as import('../../src/world/Mount').MountType, 37, 42)
    mount.group.position.y = 5; mount.group.rotation.y = 1.2; mount.currentHp = 31
    h.game.player.position.set(10, 2, 15)
    Object.assign(h.game, { startingHorse: mount })
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const saved = h.store.load()!
    expect(saved.activeMission!.battle!.player).toMatchObject({ mounted: false, mountHp: 31,
      x: 10, z: 15, mountPosition: { x: 37, y: 5, z: 42, yaw: 1.2 } })
    const resumed = fixture(saved), parkedMount = new RecordingMount(resumed.game.scene, 'horse' as import('../../src/world/Mount').MountType, 0, 0)
    Object.assign(resumed.game, { startingHorse: parkedMount })
    const dismount = vi.fn(() => Object.assign(resumed.game.player, { currentMount: null }))
    Object.assign(resumed.game.player, { currentMount: parkedMount, faceDirection: vi.fn(), setHp: vi.fn(), setStamina: vi.fn(), setArrowCount: vi.fn(),
      dismountFromMount: dismount, shield: { shieldImpactRemaining: 0, shieldImpactMax: 100 } })
    resumed.game._restorePersonalOutpostPlayer()
    expect(dismount).toHaveBeenCalledOnce()
    expect(resumed.game.player.position.x).toBe(10)
    expect(parkedMount.group.position).toEqual(new THREE.Vector3(37, 5, 42))
    expect(parkedMount.currentHp).toBe(31)
  })

  it('saves and restores full non-command Stage IX actor state while retaining native AI roles', () => {
    const h = fixture(profile(false)), plan = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(h.game.careerProfile))
    const spec = plan.npcSpecs.find(candidate => candidate.squadId === 2 && candidate.cavalry)!
    const batch = h.game.spawnBatches
    // Production queue producer is covered above; this owner isolates one actor's Stage IX checkpoint path.
    const npc = new RecordingNpc(h.game.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType,
      spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId, spec.squadId, spec.actorId)
    const mount = new RecordingMount(h.game.scene, 'horse' as import('../../src/world/Mount').MountType, spec.x, spec.z)
    npc.mountVehicle(mount); npc.restoreCombatHealth(18); npc.restoreCombatAmmo(2); npc.shield.shieldImpactRemaining = 6
    mount.currentHp = 31; npc.setTacticalOrder('charge')
    h.game.npcs.push(npc as unknown as NPC)
    Object.assign(h.game, { careerVeteranActorMounts: new Map([[npc.combatantId, mount]]) })
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const saved = h.store.load()!.activeMission!.battle!.actors[npc.combatantId]
    expect(saved.checkpoint).toMatchObject({ hp: 18, ammo: 2, shieldImpact: 6, order: 'charge', mount: { hp: 31 } })
    npc.restoreCombatHealth(100); npc.restoreCombatAmmo(30); mount.currentHp = 100
    h.game._restorePersonalOutpostNpc(npc as unknown as NPC)
    expect(npc).toMatchObject({ hp: 18, combatAmmo: 2, squadId: 2, tacticalOrder: 'charge', mount: { currentHp: 31 } })
    expect(batch).toEqual([])
  })

  it('stops command HUD refresh in spectator mode, then resumes after Player control returns', () => {
    const h = fixture()
    const setEnabled = vi.fn(), update = vi.fn(() => false)
    Object.assign(h.game, {
      armyCommandUI: { setEnabled },
      armyCommandController: { update },
      equipmentUI: { visible: false },
      isModelStudio: false,
    })
    const input = h.game as unknown as { _updatePlayerInputOwnership(): void; controlMode: 'player' | 'spectator'; player: { dead: boolean } }
    input.player.dead = true; input.controlMode = 'spectator'
    input._updatePlayerInputOwnership()
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(update).not.toHaveBeenCalled()
    input.player.dead = false; input.controlMode = 'player'
    input._updatePlayerInputOwnership()
    expect(update).toHaveBeenCalledOnce()
    // Result overlays must not reactivate command input on the next living frame.
    Object.assign(h.game, { captainResultPending: 'victory' })
    input._updatePlayerInputOwnership()
    expect(setEnabled).toHaveBeenLastCalledWith(false)
    expect(update).toHaveBeenCalledOnce()
    Object.assign(h.game, { captainResultPending: undefined, defenseCampaignConfig: { careerMissionId: 'outpost' },
      defenseCampaignRuntime: { getSnapshot: () => ({ battleFinished: true }) } })
    input._updatePlayerInputOwnership()
    expect(setEnabled).toHaveBeenLastCalledWith(false)
    expect(update).toHaveBeenCalledOnce()
  })

  it('renders the accepted Captain eagle roster as pending before any real NPC is built', () => {
    const h = fixture(), plan = createCaptainEagleSpawnPlan(h.game.careerProfile)
    h.game._declareCaptainEagleRoster(plan); h.game._queueCaptainEagleRoster(plan)
    h.game._updateCaptainBattle(0)
    const counts = h.hud.update.mock.lastCall?.[5] as {
      official: { total: number; alive: number; pending: number }
      personal: { total: number; alive: number; pending: number }
    }
    expect(counts.official).toMatchObject({ total: 29, alive: 0, pending: 29 })
    expect(counts.personal).toMatchObject({ total: 0, alive: 0, pending: 0 })
    expect(recording.npcs).toHaveLength(0)
  })
})
