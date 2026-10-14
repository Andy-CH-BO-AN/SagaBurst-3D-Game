import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import { BattleSpawner, type BattleSpawnPlan } from '../../src/battle/BattleSpawner'
import { acceptCareerOutpost, careerOutpostCommandMeritPolicy } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { createDefenseCampaignWaveConfig } from '../../src/campaign/DefenseCampaignLaunch'
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
import { createArmyCommandHarness } from '../helpers/armyCommandHarness'
import { advanceNpcFrame, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { RecordingNpc, RecordingMount, recording, resetSpawnRecording } from '../helpers/npcSpawnRecording'
import { countArmyHudRoster } from '../../src/battle/ArmyCommandHudRoster'
import { acceptCommanderMission, COMMANDER_LAST_STAND_ID } from '../../src/career/CommanderMissionCatalog'
import { createCareerCommanderOutpostLaunch, createCareerCommanderOutpostSpawnPlan } from '../../src/career/CommanderOutpost'
import { squadCommandTarget } from '../../src/battle/CommandTarget'

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
  defenseCampaignConfig: ReturnType<typeof createCareerCommanderOutpostLaunch> | null
  npcs: NPC[]
  mounts: Mount[]
  scene: THREE.Scene
  spawnBatches: NpcSpawnBatch[]
  captainEagleSpawnBatch?: NpcSpawnBatch
  commanderOutpostDeploymentBatch?: NpcSpawnBatch
  spawningStopped: boolean
  player: { hp: number; dead: boolean; position: THREE.Vector3; combatPosition: THREE.Vector3; group: THREE.Group }
  personalSquad?: { aliveCombatants: number; ready: boolean }
  _identifyPersonalOutpostWave(plan: BattleSpawnPlan, wave: 'initial'): void
  _persistPersonalOutpost(force: boolean): boolean
  _newSpawnBatch(): NpcSpawnBatch
  _spawnNpc(spec: BattleSpawnPlan['npcSpecs'][number]): NPC
  _careerCommandHudRoster(): import('../../src/battle/ArmyCommandHudRoster').ArmyHudRoster
  _commanderOutpostSquadCounts(): { label: string; alive: number; total: number }[]
  _declareCaptainEagleRoster(plan: BattleSpawnPlan): void
  _queueCaptainEagleRoster(plan: BattleSpawnPlan): void
  _persistCaptainMission(force?: boolean): boolean
  _commitCaptainMissionCheckpoint(profile: CareerProfile): boolean
  _restorePersonalOutpostPlayer(): void
  _buildCaptainMissionCheckpoint(): ActiveCareerMission
  _restorePersonalOutpostNpc(npc: NPC): void
  _restoreCareerVeteranNpcState(npc: NPC): void
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
    defenseCampaignConfig: current.activeOutpostMission ? createCareerOutpostLaunch(current) : current.activeMission!.kind === 'captain-outpost-defense' ? createCaptainFrontlineLaunch(current) : null,
    captainEagleMissionId: current.activeMission?.kind === 'captain-eagle-battle' ? current.activeMission!.id : null,
    careerProfile: current, careerStore: store, combatEvents: events, player, startingHorse: null,
    controlMode: 'player', careerVeteranActorMounts: new Map(), campaignSpawnQueue: [], campaignSpawnQueueIndex: 0,
    personalCheckpointElapsed: 0, personalCriticalState: '',
    campaignSpawnWave: null, campaignAttackersStarted: false, campaignReinforcementSpawned: false,
    defenseCampaignRuntime: new DefenseCampaignRuntime(), previewCampaignGate: null,
    soundManager: { updateEagleWingbeats: vi.fn(), playCommanderCommand: vi.fn(), playCareerMissionVoice: vi.fn() }, captainEagleHud: hud,
    _aimTargetRegistry: { registerNpc: vi.fn(), registerMount: vi.fn(), unregisterNpc: vi.fn(), unregisterMount: vi.fn() },
    _showNotify: vi.fn(), _flushCareerSkillProgression: () => true,
  }) as CaptainGameHarness
  const tracker = new BattleStatsTracker(events, false, undefined, current.activeMission?.playerStats,
    current.activeMission ? careerMissionCommandMeritPolicy(current.activeMission, () => game.careerProfile.activeMission!)
      : careerOutpostCommandMeritPolicy(current.activeOutpostMission!, () => game.careerProfile.activeOutpostMission!))
  Object.assign(game, { battleStats: tracker,
    captainCheckpoint: current.activeMission ? new CareerMissionCheckpoint(() => store.load()!, next => game._commitCaptainMissionCheckpoint(next)) : undefined })
  cleanups.push(() => { game.spawnBatches.forEach(batch => batch.cancel()); tracker.dispose() })
  return { game, store, storage, events, hud, tracker }
}

function spawnCommandRecord(game: CaptainGameHarness, spec: BattleSpawnPlan['npcSpecs'][number]): NPC {
  let actor: NPC | undefined
  const batch = game._newSpawnBatch()
  batch.enqueue(spec.actorId!, () => { actor = game._spawnNpc(spec) }); batch.seal()
  advanceNpcFrame(gameplayNpcSpawnDriver)
  expect(batch.ready).toBe(true)
  return actor!
}

describe('Captain battlefield Game callers', () => {
  it('commands all four Last Stand squads and keeps formal, HR, casualty, spectator, and reload HUD counts aligned', () => {
    // Five constructor-boundary records per scene prove Game routing without materializing the 220-actor battle.
    const base = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20_000, availableMerit: 20_000,
      personalSquad: { members: [{ id: 'personal:last-stand-a', type: 'soldier' as const },
        { id: 'personal:last-stand-b', type: 'captain' as const }] } }
    const current = acceptCommanderMission(base, COMMANDER_LAST_STAND_ID, 'commander-four-squads')!
    const h = fixture(current)
    const launch = createCareerCommanderOutpostLaunch(current)
    const plan = createCareerCommanderOutpostSpawnPlan(launch)
    h.game.defenseCampaignConfig = launch
    const official = [0, 30, 60, 90].map(index => spawnCommandRecord(h.game, plan.npcSpecs[index]))
    const personal = spawnCommandRecord(h.game, {
      ...plan.npcSpecs[0], actorId: 'personal:last-stand-a', name: 'HR reinforcement', squadId: undefined,
    })
    personal.setCommandSquad('personal')

    expect(official.map(actor => actor.squadId)).toEqual([1, 2, 3, 4])
    expect(official.every(actor => h.game._captainCommandAuthority().accepts(actor))).toBe(true)
    expect(h.game._captainCommandAuthority().accepts(personal)).toBe(false)
    const deploying = h.game._careerCommandHudRoster()
    expect(([1, 2, 3, 4] as const).map(squadId => countArmyHudRoster(deploying, squadCommandTarget(squadId))))
      .toEqual([1, 2, 3, 4].map(() => expect.objectContaining({ total: 30, alive: 1, pending: 29 })))
    expect(countArmyHudRoster(deploying, 'squad:personal')).toMatchObject({ total: 1, alive: 1, reserve: 1 })
    expect(countArmyHudRoster(deploying, 'all')).toMatchObject({ total: 121, alive: 5, pending: 116, reserve: 1 })
    expect(h.game._commanderOutpostSquadCounts().map(count => count.alive)).toEqual([1, 1, 1, 1])

    const command = createArmyCommandHarness(h.game.npcs, null, null, null, 'roman', 'squad', true,
      undefined, h.game._captainCommandAuthority(), () => h.game._careerCommandHudRoster(), () => h.game._persistCaptainMission(true))
    for (const [squadKey, orderKey] of [['1', '1'], ['2', '2'], ['3', '1'], ['4', '2']] as const) {
      command.input.press(squadKey); command.controller.update(); command.input.press(orderKey); command.controller.update()
    }
    expect(official.map(actor => actor.tacticalOrder)).toEqual(['attack', 'charge', 'attack', 'charge'])
    command.input.pressAll(); command.controller.update(); command.input.press('5'); command.controller.update()
    expect(official.every(actor => actor.activeFollowTarget === h.game.player)).toBe(true)
    expect(personal.activeFollowTarget).toBeNull()
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([1, 2, 3, 4])
    command.input.pressAll(); command.controller.update(); command.input.press('6'); command.controller.update()
    expect(official.map(actor => actor.tacticalOrder)).toEqual(['defend', 'defend', 'defend', 'defend'])
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([])
    command.input.pressAll(); command.controller.update(); command.input.press('5'); command.controller.update()
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([1, 2, 3, 4])

    h.game.commanderOutpostDeploymentBatch = h.game.spawnBatches.at(-1)
    official[1].restoreCombatHealth(0)
    const active = h.game._careerCommandHudRoster()
    expect(countArmyHudRoster(active, 'squad:2')).toMatchObject({ total: 30, alive: 0, dead: 1, missing: 29 })
    expect(h.game._commanderOutpostSquadCounts().map(count => count.alive)).toEqual([1, 0, 1, 1])
    expect(countArmyHudRoster(active, 'all')).toMatchObject({ total: 121, alive: 4, dead: 1, missing: 116, reserve: 1 })
    h.game.player.dead = true
    expect(h.game._captainCommandAuthority().enabled()).toBe(false)
    expect(countArmyHudRoster(h.game._careerCommandHudRoster(), 'all')).toEqual(countArmyHudRoster(active, 'all'))

    const saved = h.store.load()!
    saved.activeMission!.deadFriendlyActorIds = [official[1].combatantId]
    saved.activeMission!.actorHealth = { [official[1].combatantId]: { hp: 0 } }
    saved.activeMission!.officialSquad!.members![official[1].combatantId] = {
      ...saved.activeMission!.officialSquad!.members![official[1].combatantId], status: 'dead', hp: 0,
    }
    const resumed = fixture(saved)
    resumed.game.defenseCampaignConfig = createCareerCommanderOutpostLaunch(saved)
    const restored = [0, 30, 60, 90].map(index => spawnCommandRecord(resumed.game, plan.npcSpecs[index]))
    restored.forEach(actor => resumed.game._restoreCareerVeteranNpcState(actor))
    const restoredPersonal = spawnCommandRecord(resumed.game, {
      ...plan.npcSpecs[0], actorId: 'personal:last-stand-a', name: 'HR reinforcement', squadId: undefined,
    })
    restoredPersonal.setCommandSquad('personal')
    resumed.game.commanderOutpostDeploymentBatch = resumed.game.spawnBatches.at(-1)
    expect(restored.map(actor => actor.dead)).toEqual([false, true, false, false])
    expect(restored.filter(actor => !actor.dead).every(actor => actor.activeFollowTarget === resumed.game.player)).toBe(true)
    expect(countArmyHudRoster(resumed.game._careerCommandHudRoster(), 'all'))
      .toMatchObject({ total: 121, alive: 4, dead: 1, missing: 116, reserve: 1 })
  })

  it('routes a second Commander squad through Game, saves claims before mutation, and returns it to original campaign orders', () => {
    // Two constructor-boundary records; native movement has its own small real-actor owner.
    const current = profile(false); current.activeMission = undefined; current.rank = 'commander'; current.totalMerit = 20000
    const h = fixture(acceptCaptainFrontline(current, 'commander-front')!)
    const plan = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(h.game.careerProfile), h.game.careerProfile.activeMission!.officialSquad)
    const first = spawnCommandRecord(h.game, plan.npcSpecs[0]), second = spawnCommandRecord(h.game, plan.npcSpecs[30])
    expect([first.squadId, second.squadId]).toEqual([1, 2])
    const command = createArmyCommandHarness(h.game.npcs, null, null, null, 'roman', 'squad', true,
      undefined, h.game._captainCommandAuthority(), () => h.game._careerCommandHudRoster(), () => h.game._persistCaptainMission(true))
    h.storage.failWrites = true
    command.input.press('2'); command.controller.update(); command.input.press('2'); command.controller.update()
    expect(second.tacticalOrder).toBe('defend')
    expect(h.game.careerProfile.activeMission!.officialSquad!.commandedSquadIds).toEqual([])
    h.storage.failWrites = false
    command.input.press('2'); command.controller.update(); command.input.press('2'); command.controller.update()
    expect(first.tacticalOrder).toBe('defend'); expect(second.tacticalOrder).toBe('charge')
    expect(h.store.load()!.activeMission!.officialSquad).toMatchObject({ commandedSquadIds: [2],
      members: { [second.combatantId]: { order: 'charge', status: 'deployed' } } })
    command.input.pressAll(); command.controller.update(); command.input.press('5'); command.controller.update()
    expect(first.activeFollowTarget).toBe(h.game.player); expect(second.activeFollowTarget).toBe(h.game.player)
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([1, 2])
    command.input.press('2'); command.controller.update(); command.input.press('6'); command.controller.update()
    expect(first.tacticalOrder).toBe('follow'); expect(second.tacticalOrder).toBe('defend')
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([1])
    expect(h.game.npcs).toEqual([first, second])
  })

  it('keeps undeployed Frontline reinforcements pending and never commands an actor outside its saved membership', () => {
    // Full production 140-member census is data-only; just two constructor records are observed.
    const current = profile(false); current.activeMission = undefined; current.rank = 'commander'; current.totalMerit = 20000
    const h = fixture(acceptCaptainFrontline(current, 'commander-pending')!)
    const plan = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(h.game.careerProfile), h.game.careerProfile.activeMission!.officialSquad)
    const first = spawnCommandRecord(h.game, plan.npcSpecs[0])
    const foreign = spawnCommandRecord(h.game, { ...plan.npcSpecs[1], actorId: 'other-mission:initial:1' })
    const authority = h.game._captainCommandAuthority()
    expect(authority.accepts(first)).toBe(true); expect(authority.accepts(foreign)).toBe(false)
    const hud = h.game._careerCommandHudRoster()
    expect(hud.members).toHaveLength(140)
    expect(hud.members.filter(member => member.state === 'pending')).toHaveLength(139)
    expect(hud.members.some(member => member.id === foreign.combatantId)).toBe(false)
    expect(authority.issue?.('follow', 'squad:4')).toBe(false)
    expect(h.store.load()!.activeMission!.officialSquad!.commandedSquadIds).toEqual([])
  })

  it('persists and reloads ordinary Outpost Commander commands without requiring an HR squad or Captain checkpoint', () => {
    // One constructor record per scene; full regular Outpost census stays production data.
    const base = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20000 }
    const h = fixture(acceptCareerOutpost(base, 1, 'commander-regular')!)
    const launch = createCareerOutpostLaunch(h.game.careerProfile)
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders'))
    h.game._identifyPersonalOutpostWave(plan, 'initial')
    const actor = spawnCommandRecord(h.game, plan.npcSpecs[30])
    expect(actor.squadId).toBe(2)
    const authority = h.game._captainCommandAuthority()
    expect(authority.enabled()).toBe(true); expect(authority.accepts(actor)).toBe(true)
    expect(authority.issue?.('follow', 'squad:2')).toBe(true)
    actor.restoreCombatHealth(23); actor.restoreCombatAmmo(2)
    expect(h.game._persistPersonalOutpost(true)).toBe(true)
    const saved = h.store.load()!
    expect(saved.activeOutpostMission!.officialSquad!.members?.[actor.combatantId]).toMatchObject({ hp: 23, ammo: 2, order: 'follow' })
    const reloaded = fixture(saved), restored = spawnCommandRecord(reloaded.game, plan.npcSpecs[30])
    reloaded.game._restorePersonalOutpostNpc(restored)
    expect(restored.hp).toBe(23); expect(restored.combatAmmo).toBe(2)
    expect(restored.activeFollowTarget).toBe(reloaded.game.player)
    expect(reloaded.game.npcs).toHaveLength(1)
    expect(reloaded.game._captainCommandAuthority().issue?.('dismiss', 'squad:2')).toBe(true)
    expect(restored.tacticalOrder).toBe('defend')
    expect(reloaded.store.load()!.activeOutpostMission!.officialSquad!.commandedSquadIds).toEqual([])
  })

  it('preserves an enemy battlefield checkpoint order outside the official command roster', () => {
    const h = fixture(profile(false)), launch = createCaptainFrontlineLaunch(h.game.careerProfile)
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers'))
    const spec = { ...plan.npcSpecs[0], actorId: `${h.game.careerProfile.activeMission!.id}:attackers:0` }
    const actor = spawnCommandRecord(h.game, spec)
    expect(h.game._captainCommandAuthority().accepts(actor)).toBe(false)
    actor.setTacticalOrder('charge'); actor.restoreCombatHealth(37)
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const resumed = fixture(h.store.load()!), restored = spawnCommandRecord(resumed.game, spec)
    resumed.game._restorePersonalOutpostNpc(restored)
    expect(restored.tacticalOrder).toBe('charge'); expect(restored.hp).toBe(37)
    expect(resumed.game._captainCommandAuthority().accepts(restored)).toBe(false)
  })

  it.each([false, true])('restores the accepted command after the later battlefield save fails (eagle=%s)', eagle => {
    // One recording actor per scene; deployment counts remain pure production data.
    const base = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20000,
      ownedMounts: ['xongkoro' as const] }
    const h = fixture((eagle ? acceptCaptainEagle(base, 'durable-eagle') : acceptCaptainFrontline(base, 'durable-front'))!)
    const plan = eagle ? createCaptainEagleSpawnPlan(h.game.careerProfile)
      : createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(h.game.careerProfile), h.game.careerProfile.activeMission!.officialSquad)
    const spec = plan.npcSpecs.find(candidate => candidate.cavalry && h.game.careerProfile.activeMission!.officialSquad!.actorIds.includes(candidate.actorId!))!
    if (eagle) h.game._declareCaptainEagleRoster(plan)
    const actor = spawnCommandRecord(h.game, spec), mount = actor.mount!
    mount.takeDamage(mount.maxHp + 1); actor.dismountFromMount(); actor.restoreCombatHealth(23)
    expect(h.game._persistCaptainMission(true)).toBe(true)
    const authority = h.game._captainCommandAuthority(), target = `squad:${actor.squadId!}` as const
    const destination = { x: 19, y: 2, z: -180, yaw: 0.75 }
    if (eagle) {
      // The first save grants ownership; the post-issue snapshot must not be required for durability.
      const save = h.store.save.bind(h.store)
      vi.spyOn(h.store, 'save').mockImplementationOnce(next => { const result = save(next); h.storage.failWrites = true; return result })
      expect(authority.issue?.('follow', target)).toBe(true)
    } else {
      expect(authority.beforeIssue?.('formation', target, [actor], [{ npc: actor, commandId: 17, position: destination, reached: false }])).toBe(true)
      h.storage.failWrites = true
      actor.assignFormationTarget(17, new THREE.Vector3(destination.x, destination.y, destination.z), new THREE.Vector3(0, 0, 1))
      expect(h.game._persistCaptainMission(true)).toBe(false)
    }
    const saved = h.store.load()!, member = saved.activeMission!.officialSquad!.members![actor.combatantId]
    expect(member).toMatchObject({ hp: 23, order: eagle ? 'follow' : 'formation', mount: { hp: 0, mounted: false } })
    if (!eagle) expect(member.formation).toMatchObject({ commandId: 17, position: destination })
    const resumed = fixture(saved)
    let restored: NPC
    if (eagle) {
      resumed.game._queueCaptainEagleRoster({ ...plan, npcSpecs: [spec] })
      advanceNpcFrame(gameplayNpcSpawnDriver); restored = resumed.game.npcs[0]
    } else {
      restored = spawnCommandRecord(resumed.game, spec); resumed.game._restorePersonalOutpostNpc(restored)
    }
    expect(restored.hp).toBe(23); expect(restored.mount).toBeNull()
    expect(resumed.game.mounts[0].dead).toBe(true)
    if (eagle) expect(restored.activeFollowTarget).toBe(resumed.game.player)
    else {
      expect(restored.formationCommandId).toBe(17)
      expect(restored.assignFormationTarget).toHaveBeenCalledWith(17, new THREE.Vector3(19, 2, -180), expect.any(THREE.Vector3), undefined, undefined, false)
    }
    expect(resumed.game.npcs).toHaveLength(1)
  })

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
