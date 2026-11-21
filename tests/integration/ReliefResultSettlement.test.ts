import { careerRankFixture } from '../helpers/careerRankFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpostRelief, claimCareerOutpost, clearCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { Game } from '../../src/Game'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { MemoryStorage } from '../helpers/memoryStorage'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), ...careerRankFixture(faction, 'soldier'), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], inventory: { version: 1 as const, quantities: Object.fromEntries(['horse'].map(id => [id, 1])) }, ownedMounts: ['horse'], selectedMountId: 'horse' }
}

afterEach(() => vi.unstubAllGlobals())

interface ReliefSettlementEntry { _updateDefenseCampaign(dt: number): void }

describe('Relief result settlement wiring', () => {
  it.each(['victory', 'defeat'] as const)('settles %s only once, persists dead-player stats, and clears active relief on return', outcome => {
    const persistence = new MemoryStorage(), store = new CareerProfileStore(persistence), profile = acceptCareerOutpostRelief(ready(), 'relief')!
    store.save(profile)
    vi.stubGlobal('window', { localStorage: persistence, location: { pathname: '/game/', href: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const session = new MemoryStorage(); vi.stubGlobal('sessionStorage', session)
    const stats = { player: { damageDealt: 500, damageTaken: 100, kills: 5, survived: false, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, squads: [] }
    const config = createCareerOutpostLaunch(profile)
    let enemies = 60, allies = 49
    const shown: { outcome: string; onExit(): void; durable: CareerProfile | null }[] = []
    const game = Object.assign(Object.create(Game.prototype) as ReliefSettlementEntry, {
    spawnBatches: [], initializing: false, spawningStopped: false,
      defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime({ eliminationObjective: true, reinforcementsEnabled: false }),
      defenseCampaignHud: {
        showResult: (shownOutcome: string, _reload: () => void, onExit: () => void) => { shown.push({ outcome: shownOutcome, onExit, durable: store.load() }) },
        update: vi.fn(), updateGate: vi.fn(), destroy: vi.fn(),
      },
      reliefMarch: { update: vi.fn() }, careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
      battleStats: { snapshot: () => stats, checkpoint: () => stats.player, freeze: vi.fn() }, npcs: [], mounts: [], player: careerCheckpointPlayer(true), controlMode: 'spectator',
      careerVeteranActorMounts: new Map(),
      campaignOriginalDefenders: [], campaignSpawnQueueIndex: 0, personalCheckpointElapsed: 0, campaignSpawnWave: null, campaignReinforcementSpawned: false, campaignAttackersStarted: true,
      _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(),
      _campaignFactionAlive: (faction: string) => faction === 'roman' ? allies : enemies,
    })
    game._updateDefenseCampaign(1)
    expect(shown).toEqual([])
    expect(game.reliefMarch.update).toHaveBeenCalled(); expect(game.defenseCampaignHud.update).toHaveBeenCalled()
    expect(game._queueDefenseCampaignWave).not.toHaveBeenCalled()
    if (outcome === 'victory') enemies = 0; else allies = 0
    game._updateDefenseCampaign(1); game._updateDefenseCampaign(1)
    expect(shown.map(entry => entry.outcome)).toEqual([outcome])
    const saved = store.load()!
    expect(shown[0].durable).toEqual(saved)
    expect(saved.outpostBattleRecords?.[0]).toMatchObject({ kind: 'outpost-relief', outcome, stats: { survived: false }, merit: { survival: 0 } })
    expect(saved.totalMerit).toBe(profile.totalMerit + saved.outpostBattleRecords![0].merit.total)
    expect(saved.completedOutpostStages).toEqual([1, 2, 3])
    expect(claimCareerOutpost(saved, 'relief', outcome, stats).alreadyClaimed).toBe(true)
    expect(parseCareerProfile(saved)?.outpostBattleRecords).toEqual(saved.outpostBattleRecords)
    shown[0].onExit()
    expect(store.load()?.activeOutpostMission).toBeUndefined()
    expect(store.load()?.totalMerit).toBe(saved.totalMerit)
    expect(session.getItem('sagaburst_career_town')).toBe('1')
    expect(clearCareerOutpost(saved).claimedBattleIds).toContain('relief')
  })
})
