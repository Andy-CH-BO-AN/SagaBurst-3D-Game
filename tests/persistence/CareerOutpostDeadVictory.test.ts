import { acceptCaptainFrontline, createCaptainFrontlineLaunch } from '../../src/career/CaptainBattleLaunch'
import type { CareerOutpostCheckpoint } from '../../src/career/CareerOutpostMission'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { defenseCampaignCapabilities } from '../../src/campaign/DefenseCampaignLaunch'
import type { BattleStatsSnapshot } from '../../src/combat/BattleStatsTracker'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptCareerOutpost, claimCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { MemoryStorage } from '../helpers/memoryStorage'

afterEach(() => vi.unstubAllGlobals())

describe('Outpost defense victory after player death', () => {
  it.each(['roman', 'viking'] as const)('settles a %s victory once through Game and preserves the reward after reload', faction => {
    const current = { ...createCareerProfile(faction), rank: 'soldier' as const, totalMerit: 300, availableMerit: 300 }
    const profile = acceptCareerOutpost(current, 1, 'outpost-dead-victory')!
    const persistence = new MemoryStorage(), store = new CareerProfileStore(persistence)
    expect(store.save(profile)).toBe(true)
    vi.stubGlobal('window', { localStorage: persistence, location: { pathname: '/game/', reload: vi.fn() } })

    const config = createCareerOutpostLaunch(profile)
    const capabilities = defenseCampaignCapabilities(config)
    const stats: BattleStatsSnapshot = {
      player: { damageDealt: 40, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false },
      squads: [],
    }
    let enemies = 40
    const game = Object.assign(Object.create(Game.prototype), {
    spawnBatches: [], initializing: false, spawningStopped: false,
      defenseCampaignConfig: config,
      defenseCampaignRuntime: new DefenseCampaignRuntime({ ...capabilities, deploymentSeconds: config.deploymentSeconds }),
      defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn() },
      careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
      battleStats: { snapshot: () => stats, checkpoint: () => stats.player, freeze: vi.fn() }, npcs: [], player: careerCheckpointPlayer(true), controlMode: 'spectator',
      campaignOriginalDefenders: [{ dead: false }], campaignSpawnQueueIndex: 0, personalCheckpointElapsed: 0, campaignSpawnWave: null,
      campaignReinforcementSpawned: false, campaignAttackersStarted: true,
      _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(() => 40), _showNotify: vi.fn(),
      _campaignFactionAlive: (side: string) => side === faction ? 12 : enemies,
    }) as any

    expect(capabilities.reinforcementsEnabled).toBe(true)
    game._updateDefenseCampaign(config.deploymentSeconds)
    game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).not.toHaveBeenCalled()
    expect(store.load()!.claimedBattleIds).not.toContain('outpost-dead-victory')

    enemies = 0
    game._updateDefenseCampaign(1)
    game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).toHaveBeenCalledTimes(1)
    expect(game.defenseCampaignHud.showResult.mock.calls[0][0]).toBe('victory')

    const saved = store.load()!
    expect(saved.outpostBattleRecords).toHaveLength(1)
    expect(saved.outpostBattleRecords![0]).toMatchObject({
      id: 'outpost-dead-victory', kind: 'outpost-defense', completed: true, outcome: 'victory',
      stats: { survived: false }, merit: { victory: 80, characterDamage: 2, survival: 0, total: 82 },
    })
    expect(saved.totalMerit).toBe(382)
    expect(saved.availableMerit).toBe(382)
    expect(saved.lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 1, damage: 40 })
    expect(saved.completedOutpostStages).toEqual([1])
    expect(saved.claimedBattleIds).toEqual(['outpost-dead-victory'])
    expect(game.careerMeritAwarded).toBe(82)

    const reloaded = parseCareerProfile(JSON.parse(JSON.stringify(saved)))!
    expect(reloaded.outpostBattleRecords).toEqual(saved.outpostBattleRecords)
    const duplicate = claimCareerOutpost(reloaded, 'outpost-dead-victory', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile).toEqual(reloaded)
  })
})


describe('Captain Stage IX checkpoint storage contract', () => {
  it('round-trips the battle timeline, partial wave, casualties and official commands without using free Campaign progress', () => {
    const profile = acceptCaptainFrontline({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000 }, 'stage-nine-save')!
    const launch = createCaptainFrontlineLaunch(profile), mission = profile.activeMission!
    const checkpoint: CareerOutpostCheckpoint = {
      runtime: { phase: 'assault', activePhase: 'assault', deploymentRemainingSeconds: 0, assaultElapsedSeconds: 121,
        reinforcementRemainingSeconds: 0, reinforcementTriggered: true, battleFinished: false },
      actors: { [mission.friendlyActorIds[0]]: { hp: 31, x: 2, z: -11, yaw: 1, checkpoint: { status: 'deployed', hp: 31, ammo: 2, shieldImpact: 6, order: 'defend', position: { x: 2, y: 4, z: -11, yaw: 1 }, mount: { hp: 18, mounted: false, position: { x: 3, z: -12, yaw: 1 } } } },
        [mission.targetActorIds[0]]: { hp: 0, x: 41, z: 21, yaw: 2, mountHp: 0 } },
      player: { hp: 42, stamina: 13, dead: false, x: 4, z: -10, yaw: 1, ammo: 3, shieldImpact: 7, mountHp: 12,
        mounted: false, mountPosition: { x: 18, y: 3.5, z: -24, yaw: 2.2 } },
      playerStats: { damageDealt: 81, damageTaken: 16, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      wave: 'reinforcement', waveIndex: 8, attackersStarted: true, reinforcementsSpawned: true, gate: { hp: 319, state: 'destroyed' },
    }
    mission.battle = checkpoint
    mission.deadTargetActorIds = [mission.targetActorIds[0]]
    mission.officialSquad!.contribution.damageDealt = 156
    mission.officialSquad!.members = Object.fromEntries(mission.officialSquad!.actorIds.map((id, index) => [id, { status: 'deployed' as const,
      hp: 22 + index, ammo: 5, shieldImpact: 9, order: 'formation' as const,
      formation: { commandId: 91, reached: false, position: { x: 10, z: -12, yaw: 1 } } }]))
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission!.battle).toEqual(checkpoint)
    expect(loaded.activeMission!.battle!.player.mounted).toBe(false)
    expect(loaded.activeMission!.battle!.player.mountPosition).toEqual({ x: 18, y: 3.5, z: -24, yaw: 2.2 })
    expect(loaded.activeMission!.officialSquad).toEqual(mission.officialSquad)
    expect(loaded.activeMission!.deadTargetActorIds).toEqual([mission.targetActorIds[0]])
    expect(createCaptainFrontlineLaunch(loaded)).toMatchObject({ stageId: 9, careerMissionKind: 'captain-outpost-defense', careerMissionId: launch.careerMissionId })
    expect(loaded.completedOutpostStages).toBeUndefined()
    expect(loaded.claimedBattleIds).toEqual([])
    expect(loaded.totalMerit).toBe(5000)
  })
})
