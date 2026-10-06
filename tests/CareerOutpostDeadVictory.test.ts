import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../src/Game'
import { DefenseCampaignRuntime } from '../src/campaign/DefenseCampaignRuntime'
import { defenseCampaignCapabilities } from '../src/campaign/DefenseCampaignLaunch'
import type { BattleStatsSnapshot } from '../src/combat/BattleStatsTracker'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { acceptCareerOutpost, claimCareerOutpost } from '../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  } as Storage
}

afterEach(() => vi.unstubAllGlobals())

describe('Outpost defense victory after player death', () => {
  it.each(['roman', 'viking'] as const)('settles a %s victory once through Game and preserves the reward after reload', faction => {
    const current = { ...createCareerProfile(faction), rank: 'soldier' as const, totalMerit: 300, availableMerit: 300 }
    const profile = acceptCareerOutpost(current, 1, 'outpost-dead-victory')!
    const persistence = storage(), store = new CareerProfileStore(persistence)
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
      defenseCampaignConfig: config,
      defenseCampaignRuntime: new DefenseCampaignRuntime({ ...capabilities, deploymentSeconds: config.deploymentSeconds }),
      defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn() },
      careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
      battleStats: { snapshot: () => stats, freeze: vi.fn() }, npcs: [], player: { dead: true }, controlMode: 'spectator',
      campaignOriginalDefenders: [{ dead: false }], campaignSpawnWave: null,
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
