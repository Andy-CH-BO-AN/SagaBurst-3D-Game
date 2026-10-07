import { advanceNpcFrame, gameplayNpcSpawnDriver } from '../../tests/helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { applyCampaignBreachOrders } from '../campaign/CampaignGate'
import { DefenseCampaignRuntime } from '../campaign/DefenseCampaignRuntime'
import { Faction, AIType } from '../world/NPC'
import { NPC } from '../world/NPC'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { Game } from '../Game'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { claimCareerMission, createCareerProfile } from './CareerProfile'
import { CareerProfileStore } from './CareerProfileStore'
import { acceptVeteranMission } from './VeteranMission'
import { createCareerVeteranOutpostLaunch, createCareerVeteranOutpostSpawnPlan, shouldResumeCareerVeteranOutpost } from './CareerVeteranOutpost'
import { snapshotPersonalMission } from './CareerPersonalSquadMission'
import { PersonalSquadRuntime } from './PersonalSquadRuntime'

function veteranProfile(templateId: 'veteran-dread-outpost' | 'veteran-outpost-assault', missionId = `game-${templateId}`, faction: 'roman' | 'viking' = 'roman') {
  const prior = templateId === 'veteran-outpost-assault'
    ? ['veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept']
    : []
  const base = {
    ...createCareerProfile(faction),
    rank: 'veteran' as const,
    totalMerit: 900,
    availableMerit: 900,
    ownedMounts: templateId === 'veteran-outpost-assault' ? ['horse' as const] : [],
    selectedMountId: templateId === 'veteran-outpost-assault' ? 'horse' as const : undefined,
    completedCareerMissionTemplateIds: prior,
  }
  const profile = acceptVeteranMission(base, templateId, { missionId, acceptedAt: 1 })
  if (!profile?.activeMission) throw new Error(`Unable to create ${templateId} fixture`)
  return profile
}

const fixtureCleanups: (() => void)[] = []
afterEach(() => fixtureCleanups.splice(0).forEach(cleanup => cleanup()))

function createGameFixture(launch: ReturnType<typeof createCareerVeteranOutpostLaunch>, profile?: ReturnType<typeof veteranProfile>) {
  const game = Object.create(Game.prototype) as Record<string, any>
  game.spawnBatches = []
  fixtureCleanups.push(() => game.spawnBatches.forEach((batch: any) => batch.cancel()))
  game.initializing = false; game.spawningStopped = false
  game.defenseCampaignConfig = launch
  game.careerProfile = profile
  game.campaignSpawnQueue = []
  game.campaignSpawnQueueIndex = 0
  game.campaignSpawnWave = null
  game.campaignReinforcementSpawned = false
  game.campaignReinforcementArrived = false
  game.campaignAttackersStarted = false
  game.campaignOriginalDefenders = []
  game.npcs = []
  game.mounts = []
  game.careerVeteranActorMounts = new Map()
  game._showNotify = vi.fn()
  game._startCareerVeteranReinforcementMarch = vi.fn()
  game._spawnNpc = vi.fn((spec) => {
    const npc = {
      combatantId: spec.actorId,
      characterFaction: spec.characterFaction,
      faction: spec.faction,
      tier: spec.tier,
      squadId: spec.squadId,
      hp: 100,
      dead: false,
      mount: { currentHp: 100, maxHp: 100, baseSpeed: 10, dead: false, takeDamage: vi.fn(function (this: any, damage: number) { this.currentHp = Math.max(0, this.currentHp - damage); this.dead = this.currentHp <= 0 }) },
      restoreCombatHealth(hp: number) { this.hp = Math.max(0, Math.min(100, hp)); this.dead = this.hp === 0 },
      setTacticalOrder: vi.fn(),
      assignFormationTarget: vi.fn(),
      assignFollowTarget: vi.fn(),
      combatPosition: { x: 0, z: 0 },
    }
    game.npcs.push(npc)
    return npc
  })
  return game
}

function personalAssaultFixture(faction: 'roman' | 'viking', state: 'ACTIVE' | 'RETURNING') {
  const profile = veteranProfile('veteran-outpost-assault', `personal-assault-${faction}`, faction)
  profile.personalSquad = { members: [{ id: 'personal:assault', type: 'captain' }] }
  profile.activeMission!.personalSquad = snapshotPersonalMission(profile)
  const launch = createCareerVeteranOutpostLaunch(profile)
  const game = createGameFixture(launch, profile)
  const enemies = Array.from({ length: 10 }, (_, i) => ({
    combatantId: `enemy-${i}`, characterFaction: launch.careerVeteranOutpost!.outpostFaction, dead: false,
  }))
  const personal = { combatantId: 'personal:assault', characterFaction: faction,
    combatOwnership: 'player-personal', squadId: 'personal', dead: false }
  game.npcs = [...enemies, personal]
  game.campaignOriginalDefenders = enemies
  game.personalSquad = Object.assign(Object.create(PersonalSquadRuntime.prototype), { actors: [personal], pending: new Map(), state })
  game.player = { dead: true, hp: 0, staminaValue: 0 }
  game.defenseCampaignRuntime = new DefenseCampaignRuntime({ eliminationObjective: true, reinforcementsEnabled: false })
  const update = vi.spyOn(game.defenseCampaignRuntime, 'update')
  game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
  game._showDefenseCampaignResult = vi.fn()
  return { game, enemies, personal, update }
}

describe('Veteran Campaign Outpost Game integration', () => {
  describe.each(['roman', 'viking'] as const)('%s Veteran IV player-side survival', faction => {
    it.each(['ACTIVE', 'RETURNING'] as const)('continues with no living Player or official attackers and one %s private member', state => {
      const { game, personal, update } = personalAssaultFixture(faction, state)
      expect(game.defenseCampaignConfig.defenderFaction).not.toBe(faction)
      expect(game._campaignFactionAlive(faction)).toBe(0)
      game._updateDefenseCampaign(.1)

      expect(update).toHaveBeenLastCalledWith(.1, expect.objectContaining({
        playerDead: true, defendersAlive: 0, personalPlayerSideAlive: 1, attackersAlive: 10,
      }))
      expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'assault', battleFinished: false })
      expect(game._showDefenseCampaignResult).not.toHaveBeenCalled()

      personal.dead = true
      game._updateDefenseCampaign(.1)
      expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'defeat', battleFinished: true })
      expect(game._showDefenseCampaignResult).toHaveBeenCalledExactlyOnceWith('defeat')
    })

    it.each(['ACTIVE', 'RETURNING'] as const)('wins when enemy Outpost defenders are eliminated while a %s private member remains', state => {
      const { game, enemies, personal, update } = personalAssaultFixture(faction, state)
      enemies.forEach(enemy => { enemy.dead = true })
      game._updateDefenseCampaign(.1)

      expect(personal.dead).toBe(false)
      expect(update).toHaveBeenLastCalledWith(.1, expect.objectContaining({
        playerDead: true, defendersAlive: 0, personalPlayerSideAlive: 1, attackersAlive: 0,
      }))
      expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'victory', battleFinished: true })
      expect(game._showDefenseCampaignResult).toHaveBeenCalledExactlyOnceWith('victory')
      game._updateDefenseCampaign(.1)
      expect(game._showDefenseCampaignResult).toHaveBeenCalledTimes(1)
    })
  })

  it('materializes the 50-person rescue wave one NPC per frame with stable actor IDs', () => {
    const launch = createCareerVeteranOutpostLaunch(veteranProfile('veteran-dread-outpost'))
    const game = createGameFixture(launch)

    expect(game._queueDefenseCampaignWave('reinforcement')).toBe(50)
    expect(game._queueDefenseCampaignWave('reinforcement')).toBe(0)
    for (let frame = 1; frame <= 50; frame++) {
      advanceNpcFrame(gameplayNpcSpawnDriver)
      expect(game._spawnNpc).toHaveBeenCalledTimes(frame)
    }

    const calls = game._spawnNpc.mock.calls as unknown as Array<[NpcSpawnSpec]>
    const ids = calls.map(([spec]) => spec.actorId)
    expect(ids).toHaveLength(50)
    expect(ids.every((id: unknown) => typeof id === 'string' && id.startsWith(launch.careerMissionId!))).toBe(true)
    expect(new Set(ids).size).toBe(50)
    expect(game.campaignReinforcementSpawned).toBe(true)
    expect(game._startCareerVeteranReinforcementMarch).toHaveBeenCalledTimes(1)
  })

  it('rebuilds a partially spawned wave from stable IDs and restores saved casualties instead of reviving them', () => {
    const profile = veteranProfile('veteran-dread-outpost', 'resume-dread')
    const mission = profile.activeMission!
    const plan = createCareerVeteranOutpostSpawnPlan(createCareerVeteranOutpostLaunch(profile), 'reinforcement')
    const deadActorId = plan.npcSpecs[3].actorId!
    mission.outpostBattleState = {
      phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 95,
      deploymentRemainingSeconds: 0, reinforcementTriggered: true,
      reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 4, assaultChargeTriggered: false, battleFinished: false,
    }
    mission.deadFriendlyActorIds = [deadActorId]
    mission.actorHealth = { [deadActorId]: { hp: 0, mountHp: 0 } }
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch, profile)

    expect(game._queueDefenseCampaignWave('reinforcement')).toBe(50)
    for (let frame = 0; frame < 50; frame++) advanceNpcFrame(gameplayNpcSpawnDriver)

    const calls = game._spawnNpc.mock.calls as unknown as Array<[NpcSpawnSpec]>
    expect(calls.map(([spec]) => spec.actorId)).toEqual(plan.npcSpecs.map(spec => spec.actorId))
    const restoredDead = game.npcs.find((npc: any) => npc.combatantId === deadActorId)
    expect(restoredDead).toMatchObject({ hp: 0, dead: true, mount: { currentHp: 0, dead: true } })
    expect(game.campaignReinforcementArrived).toBe(false)
  })

  it('counts saved living rescue riders still queued while the wave is still marching', () => {
    const profile = veteranProfile('veteran-dread-outpost', 'arrived-rescue')
    const plan = createCareerVeteranOutpostSpawnPlan(createCareerVeteranOutpostLaunch(profile), 'reinforcement')
    const deadActorId = plan.npcSpecs[0].actorId!
    profile.activeMission!.outpostBattleState = {
      phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 105,
      deploymentRemainingSeconds: 0, reinforcementTriggered: true,
      reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 0, assaultChargeTriggered: false, battleFinished: false,
    }
    profile.activeMission!.deadFriendlyActorIds = [deadActorId]
    profile.activeMission!.actorHealth = { [deadActorId]: { hp: 0, mountHp: 0 } }
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch, profile)
    const initialFriendlies = Array.from({ length: 99 }, () => ({ dead: true, characterFaction: 'roman' }))
    const enemies = Array.from({ length: 50 }, () => ({ dead: false, characterFaction: 'viking' }))
    game.npcs = [...initialFriendlies, ...enemies]
    game.campaignOriginalDefenders = initialFriendlies
    game.campaignReinforcementArrived = false
    game.campaignReinforcementSpawned = false
    game.player = { dead: true, hp: 0, staminaValue: 0 }
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true,
      reinforcementDelaySeconds: 90,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
    game.previewCampaignGate = { state: 'closed' }
    game._showDefenseCampaignResult = vi.fn()

    game._resumeCareerVeteranReinforcementIfNeeded()
    expect(game.campaignSpawnQueue).toHaveLength(50)
    advanceNpcFrame(gameplayNpcSpawnDriver)
    game._updateDefenseCampaign(0.1)

    expect(game.npcs.at(-1)).toMatchObject({ combatantId: deadActorId, dead: true })
    expect(game.campaignSpawnQueue).toHaveLength(50)
    expect(game.campaignSpawnQueueIndex).toBe(1)
    expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'assault', battleFinished: false })
    expect(game._showDefenseCampaignResult).not.toHaveBeenCalled()

    while (game.campaignSpawnWave === 'reinforcement') advanceNpcFrame(gameplayNpcSpawnDriver)
    const rehydrated = game.npcs.filter((npc: any) => npc.characterFaction === 'roman' && npc.combatantId?.startsWith('arrived-rescue'))
    expect(rehydrated.filter((npc: any) => !npc.dead)).toHaveLength(49)
    rehydrated.forEach((npc: any) => { npc.dead = true })
    game._updateDefenseCampaign(0.1)

    expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'defeat', battleFinished: true })
    expect(game._showDefenseCampaignResult).toHaveBeenCalledExactlyOnceWith('defeat')
  })



  it('activates the rescue wave at 90 seconds and survives an initial-defender wipe while the wave is queued', () => {
    const profile = veteranProfile('veteran-dread-outpost', 'due-rescue')
    profile.activeMission!.outpostBattleState = {
      phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 89.9,
      deploymentRemainingSeconds: 0, reinforcementTriggered: false,
      reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 0, assaultChargeTriggered: false, battleFinished: false,
    }
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch, profile)
    const defenders = Array.from({ length: 99 }, (_, index) => ({
      dead: false, characterFaction: 'roman', combatantId: `initial-${index}`,
    }))
    const enemies = Array.from({ length: 50 }, (_, index) => ({
      dead: false, characterFaction: 'viking', combatantId: `enemy-${index}`,
    }))
    game.npcs = [...defenders, ...enemies]
    game.campaignOriginalDefenders = defenders
    game.player = { dead: true, hp: 0, staminaValue: 0 }
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true, reinforcementDelaySeconds: 90,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
    game.previewCampaignGate = { state: 'closed' }
    game._showDefenseCampaignResult = vi.fn()

    game._updateDefenseCampaign(0.1)
    expect(game.campaignSpawnWave).toBe('reinforcement')
    expect(game.campaignSpawnQueue).toHaveLength(50)
    expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'assault', reinforcementTriggered: true })

    advanceNpcFrame(gameplayNpcSpawnDriver)
    game._updateDefenseCampaign(0.1)
    expect(game.campaignSpawnQueueIndex).toBe(1)
    defenders.forEach((npc: any) => { npc.dead = true })
    advanceNpcFrame(gameplayNpcSpawnDriver)
    game._updateDefenseCampaign(0.1)

    expect(game.campaignSpawnQueueIndex).toBe(2)
    expect(game.npcs.filter((npc: any) => npc.characterFaction === 'roman' && !npc.dead)).toHaveLength(2)
    expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'assault', battleFinished: false })
    expect(game._showDefenseCampaignResult).not.toHaveBeenCalled()
  })

  it('keeps a standard Campaign or Soldier defense alive for living reinforcements still queued', () => {
    const launch = {
      ...createCareerVeteranOutpostLaunch(veteranProfile('veteran-dread-outpost', 'generic-wave')),
      careerMissionId: undefined, careerMissionKind: undefined, careerVeteranOutpost: undefined,
      defenderFaction: 'roman' as const, stageId: 1 as const, deploymentSeconds: 0,
      capabilities: { reinforcementsEnabled: true },
    }
    const game = createGameFixture(launch as any)
    game.player = { dead: true, hp: 0, staminaValue: 0 }
    const original = Array.from({ length: 80 }, () => ({ dead: true, characterFaction: 'roman' }))
    game.campaignOriginalDefenders = original
    game.npcs = [...original, { dead: false, characterFaction: 'viking' }]
    game.campaignSpawnQueue = [
      { x: 0, z: 0, faction: Faction.PLAYER, characterFaction: 'roman', aiType: AIType.MELEE, name: 'queued-a', tier: 3, cavalry: false, loadout: {}, presetId: 'roman_heavy_infantry', squadId: 1 },
      { x: 1, z: 0, faction: Faction.PLAYER, characterFaction: 'roman', aiType: AIType.MELEE, name: 'queued-b', tier: 3, cavalry: false, loadout: {}, presetId: 'roman_heavy_infantry', squadId: 1 },
    ]
    game.campaignSpawnWave = 'reinforcement'
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true,
      initialSnapshot: { phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 121, reinforcementTriggered: true },
    })
    game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
    game.previewCampaignGate = { state: 'closed' }
    game._showDefenseCampaignResult = vi.fn()

    game._enqueueDefenseCampaignRemainder()
    advanceNpcFrame(gameplayNpcSpawnDriver)
    game._updateDefenseCampaign(0.1)

    expect(game.campaignSpawnQueueIndex).toBe(1)
    expect(game.defenseCampaignRuntime.getSnapshot()).toMatchObject({ phase: 'assault', battleFinished: false })
    expect(game._showDefenseCampaignResult).not.toHaveBeenCalled()
  })

  it('uses the shared attacker staging helper for normal Campaign assault waves', () => {
    const launch = {
      ...createCareerVeteranOutpostLaunch(veteranProfile('veteran-dread-outpost', 'campaign-attacker-staging')),
      careerMissionId: undefined, careerMissionKind: undefined, careerVeteranOutpost: undefined,
      defenderFaction: 'roman' as const, stageId: 1 as const, deploymentSeconds: 60,
      defenderArmy: { roman_heavy_infantry: { 1: 0, 2: 1, 3: 0 } },
      capabilities: { reinforcementsEnabled: true },
    }
    const game = createGameFixture(launch as any)
    expect(game._queueDefenseCampaignWave('attackers')).toBeGreaterThan(0)

    const placement = getCampaignOutpostPlacement('roman')
    const inward = Math.sign(placement.backZ - placement.frontZ)
    expect(Math.min(...game.campaignSpawnQueue.map((spec: NpcSpawnSpec) => (placement.frontZ - spec.z) * inward))).toBeGreaterThanOrEqual(100)
  })

  it('restores and checkpoints a dead rider mount through its stable actor association', () => {
    const profile = veteranProfile('veteran-dread-outpost', 'dead-rider-mount')
    const launch = createCareerVeteranOutpostLaunch(profile)
    const spec = createCareerVeteranOutpostSpawnPlan(launch, 'reinforcement').npcSpecs.find(candidate => candidate.tier === 3)!
    profile.activeMission!.reinforcementActorIds = [...(profile.activeMission!.reinforcementActorIds ?? []), spec.actorId!]
    profile.activeMission!.deadFriendlyActorIds = [spec.actorId!]
    profile.activeMission!.actorHealth = { [spec.actorId!]: { hp: 0, mountHp: 0 } }
    const scene = new THREE.Scene()
    const npc = new NPC(scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, 3,
      spec.cavalry, spec.loadout, spec.presetId, spec.squadId, spec.actorId, undefined,
      spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile)
    const mount = {
      group: new THREE.Group(), currentHp: 100, maxHp: 100, dead: false,
      takeDamage(damage: number) { this.currentHp = Math.max(0, this.currentHp - damage); this.dead = this.currentHp <= 0 },
      releaseRider: vi.fn(), dispose: vi.fn(),
    }
    npc.mount = mount as any
    const game = createGameFixture(createCareerVeteranOutpostLaunch(profile), profile)
    game.npcs = [npc]
    game.mounts = [mount]
    game.careerVeteranActorMounts = new Map()
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true,
      reinforcementDelaySeconds: 90,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.campaignReinforcementArrived = true
    game.player = { dead: false, hp: 100, staminaValue: 40 }
    game.battleStats = { checkpoint: () => ({ damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }) }
    game.startingHorse = null
    game.previewCampaignGate = null

    game._restoreCareerVeteranNpcState(npc)
    const checkpoint = game._buildCareerVeteranOutpostCheckpoint()

    expect(npc.dead).toBe(true)
    expect(npc.mount).toBeNull()
    expect(mount.dead).toBe(true)
    expect(game.careerVeteranActorMounts.get(spec.actorId!)).toBe(mount)
    expect(checkpoint.actorHealth[spec.actorId!]).toEqual({ hp: 0, mountHp: 0 })
    game._disposeCareerOutpostBattleActors()
    expect(game.careerVeteranActorMounts.size).toBe(0)
  })

  it('persists the full default checkpoint when Veteran IV reaches its charge trigger before the first save', () => {
    const profile = veteranProfile('veteran-outpost-assault', 'fresh-assault')
    expect(profile.activeMission!.outpostBattleState).toBeUndefined()
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    } as Storage
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const game = createGameFixture(createCareerVeteranOutpostLaunch(profile), profile)
    game.careerStore = store

    game._startCareerVeteranOutpostAssaultMarch(false)

    const reloadedMission = store.load()!.activeMission!
    expect(reloadedMission.outpostBattleState).toMatchObject({
      phase: 'assault', activePhase: 'assault', assaultChargeTriggered: true,
    })
    expect(createCareerVeteranOutpostLaunch(store.load()!).careerVeteranOutpost!.runtimeState.assaultChargeTriggered).toBe(true)
  })

  it('restores a saved-dead player before claiming an unclaimed terminal Veteran IV victory', () => {
    const profile = veteranProfile('veteran-outpost-assault', 'dead-player-victory')
    profile.activeMission!.playerDead = true
    profile.activeMission!.playerHp = 0
    profile.activeMission!.outpostBattleState = {
      phase: 'victory', activePhase: 'assault', assaultElapsedSeconds: 22,
      deploymentRemainingSeconds: 0, reinforcementTriggered: false,
      reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 0, assaultChargeTriggered: true, battleFinished: true,
    }
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    } as Storage
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch, profile)
    const player = {
      dead: false, maxHp: 100, hp: 100, staminaValue: 50,
      get hpRatio() { return this.hp / this.maxHp },
      get staminaRatio() { return this.staminaValue / 100 },
      setHp(value: number) { this.hp = value },
      setStamina(value: number) { this.staminaValue = value },
      detachFromMountOnDeath: vi.fn(),
      takeDamage(damage: number) { this.hp = Math.max(0, this.hp - damage); this.dead = this.hp <= 0 },
    }
    game.player = player
    game.hpBar = { setFill: vi.fn() }
    game.staminaBar = { setFill: vi.fn() }
    game.npcs = []
    game.mounts = []
    game.startingHorse = null
    game.previewCampaignGate = null
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      eliminationObjective: true,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.defenseCampaignHud = { showResult: vi.fn() }
    game.careerStore = store
    game.veteranOutpostCheckpoint = new CareerMissionCheckpoint(
      () => store.load()!,
      next => store.save(next),
    )
    game.battleStats = {
      freeze: vi.fn(),
      checkpoint: () => ({ damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }),
      snapshot: (_npcs: unknown, currentPlayer: typeof player) => ({
        player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !currentPlayer.dead },
        squads: [],
      }),
    }

    game._restoreCareerVeteranPlayerStateAndShowTerminalResult()
    game._restoreCareerVeteranPlayerStateAndShowTerminalResult()

    const settled = store.load()!
    expect(player.dead).toBe(true)
    expect(settled.activeMission!.result).toMatchObject({
      outcome: 'victory', claimed: true, stats: { survived: false }, merit: { total: 80 },
    })
    expect(settled.lifetimeStats.deaths).toBe(1)
    expect(settled.claimedBattleIds.filter(id => id === 'dead-player-victory')).toHaveLength(1)
  })

  it('keeps a claimed early Dread defeat locked while the resumed battle timeline advances', () => {
    let profile = veteranProfile('veteran-dread-outpost', 'locked-dread')
    profile = claimCareerMission(profile, 'locked-dread', 'failure', {
      damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0,
      structuresDestroyed: 0, gateBreaches: 0, survived: false,
    }).profile
    profile.activeMission!.outpostBattleState = {
      phase: 'defeat', activePhase: 'assault', assaultElapsedSeconds: 95,
      deploymentRemainingSeconds: 0, reinforcementTriggered: true,
      reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 12, assaultChargeTriggered: false, battleFinished: false,
    }
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch)
    let savedProfile = profile
    game.careerProfile = profile
    game.careerStore = {
      loadChecked: () => ({ profile: savedProfile }),
      save: (next: any) => { savedProfile = next; return true },
    }
    game.veteranOutpostCheckpoint = new CareerMissionCheckpoint(
      () => savedProfile,
      (next: any) => { savedProfile = next; return true },
    )
    const runtime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true,
      reinforcementDelaySeconds: 90,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.defenseCampaignRuntime = runtime
    game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
    game.previewCampaignGate = { state: 'closed' }
    game.player = { dead: true, hp: 0, staminaValue: 0 }
    game.npcs = [{ dead: false, characterFaction: 'viking', combatantId: 'enemy-still-alive' }]
    game.campaignOriginalDefenders = []
    game.campaignSpawnQueue = []
    game.campaignSpawnWave = null
    game.campaignReinforcementArrived = false
    game.campaignReinforcementSpawned = false
    game.battleStats = { checkpoint: () => ({ damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }) }
    game.previewCampaignGate = { state: 'closed', damageable: { currentHp: 520 } }

    game._persistCareerVeteranOutpostCheckpoint({ immediate: true })
    game._updateDefenseCampaign(1)
    game._persistCareerVeteranOutpostCheckpoint({ immediate: true })

    expect(runtime.getSnapshot()).toMatchObject({ phase: 'defeat', battleFinished: false, assaultElapsedSeconds: 96 })
    expect(savedProfile.activeMission).toMatchObject({ id: 'locked-dread', result: { claimed: true }, outpostBattleState: { assaultElapsedSeconds: 96, phase: 'defeat', battleFinished: false } })
    expect(savedProfile.claimedBattleIds.filter(id => id === 'locked-dread')).toHaveLength(1)
    expect(shouldResumeCareerVeteranOutpost(savedProfile.activeMission)).toBe(true)
    const terminal = {
      ...savedProfile.activeMission!,
      outpostBattleState: { ...savedProfile.activeMission!.outpostBattleState!, phase: 'defeat' as const, battleFinished: true },
    }
    expect(shouldResumeCareerVeteranOutpost(terminal)).toBe(false)
    expect(game.defenseCampaignHud.update).toHaveBeenCalledTimes(1)
  })

  it('keeps Veteran IV attackers separate from the real Outpost owner and breaches for the player faction', () => {
    const launch = createCareerVeteranOutpostLaunch(veteranProfile('veteran-outpost-assault'))
    const veteran = launch.careerVeteranOutpost!
    const plan = createCareerVeteranOutpostSpawnPlan(launch, 'initial')
    const outpost = createCampaignOutpost(new THREE.Scene(), veteran.outpostFaction)
    const friendly = plan.npcSpecs.find(spec => spec.characterFaction === veteran.playerFaction)!
    const enemy = plan.npcSpecs.find(spec => spec.characterFaction === veteran.outpostFaction)!
    const attackerMelee = { dead: false, characterFaction: veteran.playerFaction, aiType: AIType.MELEE, setTacticalOrder: vi.fn() }
    const attackerRanged = { dead: false, characterFaction: veteran.playerFaction, aiType: AIType.RANGED, setTacticalOrder: vi.fn() }
    const defender = { dead: false, characterFaction: veteran.outpostFaction, aiType: AIType.MELEE, setTacticalOrder: vi.fn() }

    expect(friendly.faction).toBe(Faction.PLAYER)
    expect(enemy.faction).toBe(Faction.ENEMY)
    expect(outpost.gateController.defenderFaction).toBe(veteran.outpostFaction)
    expect(outpost.gateController.attackerFaction).toBe(veteran.playerFaction)
    expect(applyCampaignBreachOrders([attackerMelee, attackerRanged, defender] as any, outpost.gateController.attackerFaction)).toEqual({
      attackerChargeCount: 1, attackerAttackCount: 1, defenderAttackCount: 1,
    })
    expect(attackerMelee.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(attackerRanged.setTacticalOrder).toHaveBeenCalledWith('attack')
    expect(defender.setTacticalOrder).toHaveBeenCalledWith('attack')
  })

  it('updates the existing Career Outpost direction guide, hides it in observer mode, and disposes it on return', () => {
    const profile = veteranProfile('veteran-dread-outpost', 'guide-dread')
    const launch = createCareerVeteranOutpostLaunch(profile)
    const game = createGameFixture(launch, profile)
    const friend = { dead: false, characterFaction: 'roman', combatantId: 'friend', setTacticalOrder: vi.fn() }
    const enemy = { dead: false, characterFaction: 'viking', combatantId: 'enemy', setTacticalOrder: vi.fn() }
    const guide = { updateOutpostDefense: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
    game.npcs = [friend, enemy]
    game.campaignOriginalDefenders = [friend]
    game.defenseCampaignRuntime = new DefenseCampaignRuntime({
      reinforcementsEnabled: true,
      reinforcementDelaySeconds: 90,
      initialSnapshot: launch.careerVeteranOutpost!.runtimeState,
    })
    game.defenseCampaignHud = { updateGate: vi.fn(), update: vi.fn() }
    game.previewCampaignGate = { state: 'closed' }
    game.player = { dead: false, position: new THREE.Vector3(0, 0, -120) }
    game.thirdPersonCamera = { cameraYaw: 0.6 }
    game.controlMode = 'player'
    game.careerOutpostDefenseGuide = guide

    game._updateDefenseCampaign(0.1)
    expect(guide.updateOutpostDefense).toHaveBeenCalledWith(
      'ATTACKING', game.player.position, 0.6, expect.any(THREE.Vector3), 1,
    )

    game.player.dead = true
    game.controlMode = 'spectator'
    game._updateDefenseCampaign(0.1)
    expect(guide.hide).toHaveBeenCalledTimes(1)
    const npcDispose = vi.fn()
    const mountDispose = vi.fn()
    const hudDestroy = vi.fn()
    game.npcs = [{ dispose: npcDispose }]
    game.mounts = [{ dispose: mountDispose }]
    game.defenseCampaignHud = { destroy: hudDestroy }
    game._disposeCareerOutpostBattleActors()
    expect(guide.dispose).toHaveBeenCalledTimes(1)
    expect(game.careerOutpostDefenseGuide).toBeNull()
    expect(npcDispose).toHaveBeenCalledTimes(1)
    expect(mountDispose).toHaveBeenCalledTimes(1)
    expect(hudDestroy).toHaveBeenCalledTimes(1)
  })
})
