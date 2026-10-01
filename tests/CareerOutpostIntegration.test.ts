import { describe, expect, it, vi } from 'vitest'
import { Game } from '../src/Game'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { createCareerProfile } from '../src/career/CareerProfile'
import { acceptCareerOutpost } from '../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'
import { DefenseCampaignRuntime } from '../src/campaign/DefenseCampaignRuntime'
import { getDefenseCampaignUnlockedStage } from '../src/campaign/CampaignProgress'

function harness(career = true) {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } as Storage
  vi.stubGlobal('window', { localStorage: storage })
  const store = new CareerProfileStore(storage)
  const profile = acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300, starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }, 1, 'battle')!
  store.save(profile)
  const config = createCareerOutpostLaunch(profile)
  if (!career) { delete config.capabilities; delete config.careerMissionId }
  const snapshot = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }, squads: [] }
  const game = Object.assign(Object.create(Game.prototype), {
    defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime(config.capabilities),
    defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn() },
    careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
    battleStats: { snapshot: () => snapshot }, npcs: [], player: { dead: false }, controlMode: 'player',
    campaignOriginalDefenders: Array.from({ length: 80 }, () => ({ dead: false })),
    campaignSpawnWave: null, campaignSpawnQueue: [], campaignReinforcementSpawned: false,
    campaignAttackersStarted: true,
    _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(), _showNotify: vi.fn(),
    _campaignFactionAlive: (faction: string) => faction === 'roman' ? 80 : 0,
  }) as any
  game.defenseCampaignRuntime.update(60, { playerDead: false, originalDefendersAlive: 80, defendersAlive: 80, attackersAlive: 100, reinforcementSpawned: false })
  return { game, storage, store, snapshot }
}

describe('Game routes Campaign and Career separately', () => {
  it('settles a Career win without Campaign mutation or Next Stage flow', () => {
    const { game, store, storage } = harness()
    game._updateDefenseCampaign(1)
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(1)
    expect(store.load()!.completedOutpostStages).toEqual([1])
    expect(game.defenseCampaignHud.showResult.mock.calls[0][4]).toBeUndefined()
    expect(game.defenseCampaignHud.updateGate.mock.calls[0][2]).toBe(false)
    const merit = store.load()!.totalMerit
    game._showDefenseCampaignResult('victory')
    expect(store.load()!.totalMerit).toBe(merit)
    expect(store.load()!.outpostBattleRecords).toHaveLength(1)
    vi.unstubAllGlobals()
  })
  it('keeps formal Campaign progress and Next Stage behavior and leaves Career untouched', () => {
    const { game, store, storage } = harness(false)
    const careerBefore = store.load()
    game._updateDefenseCampaign(1)
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(2)
    expect(store.load()).toEqual(careerBefore)
    expect(game.defenseCampaignHud.showResult.mock.calls[0][4]).toBeTypeOf('function')
    expect(game.defenseCampaignHud.updateGate.mock.calls[0][2]).toBe(true)
    vi.unstubAllGlobals()
  })
  it('returns to the same faction town, clears only the active duty and keeps claimed merit', () => {
    const { game, store } = harness()
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) })
    window.location = { pathname: '/game/', href: '' } as Location
    game._updateDefenseCampaign(1)
    const merit = store.load()!.totalMerit
    game.defenseCampaignHud.showResult.mock.calls[0][2]()
    expect(session.get('sagaburst_career_town')).toBe('1')
    expect(window.location.href).toBe('/game/')
    expect(store.load()).toMatchObject({ faction: 'roman', totalMerit: merit, completedOutpostStages: [1] })
    expect(store.load()!.activeOutpostMission).toBeUndefined()
    expect(store.load()!.claimedBattleIds).toEqual(['battle'])
    vi.unstubAllGlobals()
  })
  it('blocks Career reinforcement queue and commander gate mutation at the runtime boundary', () => {
    const { game } = harness()
    delete game._queueDefenseCampaignWave
    expect(game._queueDefenseCampaignWave('reinforcement')).toBe(0)
    const gate = { toggle: vi.fn() }; game.previewCampaignGate = gate
    game._toggleCampaignGate()
    expect(gate.toggle).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
