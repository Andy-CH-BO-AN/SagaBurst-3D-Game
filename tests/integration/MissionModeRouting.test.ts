import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import { getDefenseCampaignUnlockedStage } from '../../src/campaign/CampaignProgress'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { MemoryStorage } from '../helpers/memoryStorage'

interface CampaignSettlementEntry {
  _updateDefenseCampaign(dt: number): void
  _showDefenseCampaignResult(outcome: 'victory'): void
}

function harness(career = true) {
  const storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const store = new CareerProfileStore(storage)
  const profile = acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300, starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }, 1, 'battle')!
  store.save(profile)
  const config = createCareerOutpostLaunch(profile)
  if (!career) { delete config.capabilities; delete config.careerMissionId }
  const snapshot = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }, squads: [] }
  const game = Object.assign(Object.create(Game.prototype) as CampaignSettlementEntry, {
    spawnBatches: [], initializing: false, spawningStopped: false,
    defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime(config.capabilities),
    defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn(), destroy: vi.fn() },
    careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
    battleStats: { snapshot: () => snapshot, checkpoint: () => snapshot.player, freeze: vi.fn() }, npcs: [], mounts: [], player: careerCheckpointPlayer(), controlMode: 'player',
    campaignOriginalDefenders: Array.from({ length: 80 }, () => ({ dead: false })),
    campaignSpawnQueueIndex: 0, personalCheckpointElapsed: 0, campaignSpawnWave: null, campaignSpawnQueue: [], campaignReinforcementSpawned: false,
    careerVeteranActorMounts: new Map(),
    campaignAttackersStarted: true,
    _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(), _showNotify: vi.fn(),
    _campaignFactionAlive: (faction: string) => faction === 'roman' ? 80 : 0,
  })
  game.defenseCampaignRuntime.update(60, { playerDead: false, originalDefendersAlive: 80, defendersAlive: 80, attackersAlive: 100, reinforcementSpawned: false })
  return { game, storage, store, snapshot }
}

afterEach(() => vi.unstubAllGlobals())

describe('Game routes Campaign and Career separately', () => {
  it('settles a Career win without Campaign mutation or Next Stage flow', () => {
    const { game, store, storage } = harness()
    game._updateDefenseCampaign(1)
    expect(game.battleStats.freeze).toHaveBeenCalledOnce()
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(1)
    expect(store.load()!.completedOutpostStages).toEqual([1])
    expect(game.defenseCampaignHud.showResult.mock.calls[0][4]).toBeUndefined()
    expect(game.defenseCampaignHud.updateGate.mock.calls[0][2]).toBe(false)
    const merit = store.load()!.totalMerit
    game._showDefenseCampaignResult('victory')
    expect(store.load()!.totalMerit).toBe(merit)
    expect(store.load()!.outpostBattleRecords).toHaveLength(1)
  })
  it('keeps formal Campaign progress and Next Stage behavior and leaves Career untouched', () => {
    const { game, store, storage } = harness(false)
    const careerBefore = store.load()
    game._updateDefenseCampaign(1)
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(2)
    expect(store.load()).toEqual(careerBefore)
    expect(game.defenseCampaignHud.showResult.mock.calls[0][4]).toBeTypeOf('function')
    expect(game.defenseCampaignHud.updateGate.mock.calls[0][2]).toBe(true)
  })
  it('returns to the same faction town, clears only the active duty and keeps claimed merit', () => {
    const { game, store } = harness()
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) })
    Reflect.set(window, 'location', { pathname: '/game/', href: '' })
    game._updateDefenseCampaign(1)
    const merit = store.load()!.totalMerit
    game.defenseCampaignHud.showResult.mock.calls[0][2]()
    expect(session.get('sagaburst_career_town')).toBe('1')
    expect(window.location.href).toBe('/game/')
    expect(store.load()).toMatchObject({ faction: 'roman', totalMerit: merit, completedOutpostStages: [1] })
    expect(store.load()!.activeOutpostMission).toBeUndefined()
    expect(store.load()!.claimedBattleIds).toEqual(['battle'])
  })
})
