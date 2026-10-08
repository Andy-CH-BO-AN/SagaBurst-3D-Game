import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief, claimCareerOutpost, clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { Game } from '../../src/Game'
import { calculateMerit } from '../../src/career/MeritCalculator'
import { MemoryStorage } from '../helpers/memoryStorage'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

afterEach(() => vi.unstubAllGlobals())

describe('Relief result settlement wiring', () => {
  it.each(['victory', 'defeat'] as const)('settles %s only once, persists dead-player stats, and clears active relief on return', outcome => {
    const persistence = new MemoryStorage(), store = new CareerProfileStore(persistence), profile = acceptCareerOutpostRelief(ready(), 'relief')!
    store.save(profile)
    vi.stubGlobal('window', { localStorage: persistence, location: { pathname: '/game/', href: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const session = new MemoryStorage(); vi.stubGlobal('sessionStorage', session)
    const stats = { player: { damageDealt: 500, damageTaken: 100, kills: 5, survived: false, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, squads: [] }
    const config = createCareerOutpostLaunch(profile)
    let enemies = 60, allies = 49
    const game = Object.assign(Object.create(Game.prototype), {
    spawnBatches: [], initializing: false, spawningStopped: false,
      defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime({ eliminationObjective: true, reinforcementsEnabled: false }),
      defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn(), destroy: vi.fn() },
      reliefMarch: { update: vi.fn() }, careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
      battleStats: { snapshot: () => stats, checkpoint: () => stats.player, freeze: vi.fn() }, npcs: [], mounts: [], player: careerCheckpointPlayer(true), controlMode: 'spectator',
      careerVeteranActorMounts: new Map(),
      campaignOriginalDefenders: [], campaignSpawnQueueIndex: 0, personalCheckpointElapsed: 0, campaignSpawnWave: null, campaignReinforcementSpawned: false, campaignAttackersStarted: true,
      _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(),
      _campaignFactionAlive: (faction: string) => faction === 'roman' ? allies : enemies,
    }) as any
    game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).not.toHaveBeenCalled()
    expect(game.reliefMarch.update).toHaveBeenCalled(); expect(game.defenseCampaignHud.update).toHaveBeenCalled()
    expect(game._queueDefenseCampaignWave).not.toHaveBeenCalled()
    if (outcome === 'victory') enemies = 0; else allies = 0
    game._updateDefenseCampaign(1); game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).toHaveBeenCalledTimes(1)
    expect(game.defenseCampaignHud.showResult.mock.calls[0][0]).toBe(outcome)
    const saved = store.load()!
    expect(saved.outpostBattleRecords?.[0]).toMatchObject({ kind: 'outpost-relief', outcome, stats: { survived: false }, merit: { survival: 0 } })
    expect(saved.totalMerit).toBe(profile.totalMerit + calculateMerit(stats, outcome, 'defense', 'mission').total)
    expect(saved.completedOutpostStages).toEqual([1, 2, 3])
    expect(claimCareerOutpost(saved, 'relief', outcome, stats).alreadyClaimed).toBe(true)
    expect(parseCareerProfile(saved)?.outpostBattleRecords).toEqual(saved.outpostBattleRecords)
    game.defenseCampaignHud.showResult.mock.calls[0][2]()
    expect(store.load()?.activeOutpostMission).toBeUndefined()
    expect(store.load()?.totalMerit).toBe(saved.totalMerit)
    expect(session.getItem('sagaburst_career_town')).toBe('1')
    expect(clearCareerOutpost(saved).claimedBattleIds).toContain('relief')
  })
})
