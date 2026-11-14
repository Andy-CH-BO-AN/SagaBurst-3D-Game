import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { Faction } from '../../src/world/NPC'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldResumeCareerTown } from '../../src/career/CareerResumeRouting'
import { Game } from '../../src/Game'
import { getDefenseCampaignUnlockedStage } from '../../src/campaign/CampaignProgress'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { createCareerVeteranOutpostLaunch } from '../../src/career/CareerVeteranOutpost'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { careerCheckpointPlayer } from '../helpers/careerCheckpointPlayer'
import { MemoryStorage } from '../helpers/memoryStorage'
import { CaptainEagleHUD } from '../../src/ui/CaptainEagleHUD'

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
    const settled = store.load()!
    expect(settled.completedOutpostStages).toEqual([1])
    expect(game.defenseCampaignHud.showResult.mock.calls[0][4]).toBeUndefined()
    expect(game.defenseCampaignHud.updateGate.mock.calls[0][2]).toBe(false)
    game._showDefenseCampaignResult('victory')
    const recorded = store.load()!
    expect(recorded.totalMerit).toBe(settled.totalMerit)
    expect(recorded.outpostBattleRecords).toHaveLength(1)
  })
  it('keeps formal Campaign progress and Next Stage behavior and leaves Career untouched', () => {
    const { game, store, storage } = harness(false)
    const completed = store.load()!
    completed.rank = 'commander'; completed.totalMerit = completed.availableMerit = 20000
    delete completed.activeOutpostMission
    completed.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42, outcome: 'escaped' }
    expect(store.save(completed)).toBe(true)
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
    const returned = store.load()!
    expect(returned).toMatchObject({ faction: 'roman', totalMerit: merit, completedOutpostStages: [1] })
    expect(returned.activeOutpostMission).toBeUndefined()
    expect(returned.claimedBattleIds).toEqual(['battle'])
  })
})

describe('Career reload routing', () => {
  it('restores the Veteran assault player at the checkpoint instead of the new frontline', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    const profile = acceptVeteranMission({
      ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, ownedMounts: ['horse'],
    }, 'veteran-outpost-assault', { missionId: 'assault' })!
    const leaderId = profile.activeMission!.friendlyActorIds![0]
    profile.activeMission!.actorPositions = { [leaderId]: { x: 8, z: 63, yaw: 0 } }
    expect(store.save(profile)).toBe(true)
    const legacy = store.load()!
    const launch = createCareerVeteranOutpostLaunch(legacy)
    const player = { ...careerCheckpointPlayer(), hp: 83, facingYaw: Math.PI / 2, faceDirection: vi.fn(), setStamina: vi.fn(), setHp: vi.fn() }
    const game = Object.assign(Object.create(Game.prototype) as {
      _persistCareerVeteranOutpostCheckpoint(): boolean
      _restoreCareerVeteranPlayerStateAndShowTerminalResult(): void
    }, {
      careerProfile: legacy, defenseCampaignConfig: launch,
      defenseCampaignRuntime: new DefenseCampaignRuntime({ deploymentSeconds: 0 }),
      veteranOutpostCheckpoint: new CareerMissionCheckpoint(() => legacy, next => store.save(next)),
      battleStats: { checkpoint: () => undefined },
      npcs: [], player, hpBar: { setFill: vi.fn() }, staminaBar: { setFill: vi.fn() }, thirdPersonCamera: { setYaw: vi.fn() },
    })
    game._restoreCareerVeteranPlayerStateAndShowTerminalResult()
    expect(player.group.position).toMatchObject({ x: 0, z: 58 })
    player.group.position.set(4, 12, -42)
    expect(game._persistCareerVeteranOutpostCheckpoint()).toBe(true)
    const saved = store.load()!
    game.careerProfile = saved
    game.defenseCampaignConfig = createCareerVeteranOutpostLaunch(saved)
    player.group.position.set(0, 0, -138)
    game._restoreCareerVeteranPlayerStateAndShowTerminalResult()
    expect(player.group.position).toMatchObject({ x: 4, y: 12, z: -42 })
    expect(player.faceDirection).toHaveBeenCalledWith(1, expect.closeTo(0))
    expect(player.setHp).toHaveBeenCalledWith(83)
    expect(saved.activeMission?.actorPositions).toEqual(legacy.activeMission?.actorPositions)
  })

  it('keeps a completed ending out of automatic recovery even with stale town intent and hostility', () => {
    const profile = createCareerProfile('roman')
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 42, outcome: 'escaped' }
    profile.townEvent = { id: 'stale', state: 'hostile', penalty: 0 }
    const saved = JSON.stringify(profile)
    // Both clean home and stale town flags leave free-mode sessions eligible.
    expect(shouldResumeCareerTown(profile, false)).toBe(false)
    expect(shouldResumeCareerTown(profile, true)).toBe(false)
    expect(JSON.stringify(profile)).toBe(saved)
  })

  it('preserves departing, mobilizing, and final-stand recovery priority without a town flag', () => {
    for (const phase of ['departing', 'mobilizing', 'final-stand'] as const) {
      const profile = createCareerProfile('viking')
      profile.rank = 'commander'; profile.totalMerit = profile.availableMerit = 20000
      profile.careerRetirement = { version: 1, phase, acceptedAt: 1, combatElapsedSeconds: phase === 'final-stand' ? 42 : 0 }
      const saved = JSON.stringify(profile)
      const store = new CareerProfileStore(new MemoryStorage())
      expect(store.save(profile)).toBe(true)
      const restored = store.loadChecked().profile!
      expect(restored.careerRetirement).toEqual(profile.careerRetirement)
      expect(shouldResumeCareerTown(restored, false)).toBe(true)
      expect(JSON.stringify(profile)).toBe(saved)
    }
  })
})


describe('Heavy field defeat capture at the production Game caller', () => {
  it('正式結果保存失敗不離場，重試後保存一次被俘資格，玩家倒下的勝利不進戰俘流程', () => {
    for (const outcome of ['failure', 'victory'] as const) {
      const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
      const profile = acceptHeavyFieldMission({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 'soldier-iron-encounter', `field-${outcome}`)!
      expect(store.save(profile)).toBe(true)
      const player = { damageDealt: 20, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
      const elements: { innerHTML: string }[] = []
      vi.stubGlobal('document', { pointerLockElement: null, body: { append: vi.fn() }, createElement: () => {
        const el = { id: '', className: '', style: { cssText: '' }, innerHTML: '', remove: vi.fn(),
          querySelector: () => ({ addEventListener: vi.fn() }) }
        elements.push(el); return el
      } })
      const hud = new CaptainEagleHUD('feline')
      const showResult = vi.spyOn(hud, 'showResult')
      const entry = Object.assign(Object.create(Game.prototype) as { _showFieldBattleResult(outcome: 'victory' | 'failure'): void }, {
        felineMissionId: profile.activeMission!.id, bridgeLaunch: undefined, careerStore: store,
        npcs: [{ faction: Faction.ENEMY, characterFaction: 'viking' }], player: { dead: true },
        fieldBattleHud: hud, battleStats: { freeze() {}, snapshot: () => ({ player, squads: [] }) },
        _flushCareerSkillProgression: () => true, _persistCareerBattle: () => true,
      })
      storage.failWrites = true
      entry._showFieldBattleResult(outcome)
      expect(showResult).not.toHaveBeenCalled()
      expect(store.load()!.activeMission!.result).toBeUndefined()
      expect(store.load()!.activeMission!.prisonBreak).toBeUndefined()
      storage.failWrites = false
      entry._showFieldBattleResult(outcome)
      const saved = store.load()!
      expect(saved.activeMission!.result!.outcome).toBe(outcome)
      expect(saved.activeMission!.prisonBreak?.captor).toBe(outcome === 'failure' ? 'viking' : undefined)
      expect(saved.claimedBattleIds).toEqual([profile.activeMission!.id])
      expect(showResult.mock.lastCall?.[4]).toBe(outcome === 'failure')
      expect(showResult.mock.lastCall?.[1]).toBe(saved.activeMission!.result!.merit.total)
      const resultMarkup = elements.at(-1)!.innerHTML
      expect(resultMarkup).toContain('戰鬥統計')
      expect(resultMarkup).toContain(`Career 軍功 +${saved.activeMission!.result!.merit.total}`)
      if (outcome === 'failure') {
        expect(resultMarkup).toContain('你被俘虜了')
        expect(resultMarkup).toContain('存活隊友穿過出口')
        expect(resultMarkup).toContain('開始越獄')
      } else {
        expect(resultMarkup).not.toContain('你被俘虜了')
        expect(resultMarkup).toContain('返回小鎮')
      }
      entry._showFieldBattleResult(outcome)
      expect(store.load()).toEqual(saved)
    }
  })

  it('正式敗北頁繼續先保存被俘進度才離場，寫入失敗可重試且原敗北與軍功收據不變', () => {
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage), session = new Map<string, string>()
    vi.stubGlobal('window', { removeEventListener: vi.fn(), location: { pathname: '/game/', href: '' } })
    vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) })
    const profile = acceptHeavyFieldMission({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 'soldier-iron-encounter', 'field-return')!
    expect(store.save(profile)).toBe(true)
    const player = { damageDealt: 20, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
    const hud = { showResult: vi.fn(), showSaveRetry: vi.fn() }, dispose = vi.fn()
    const entry = Object.assign(Object.create(Game.prototype) as { _showFieldBattleResult(outcome: 'failure'): void }, {
      felineMissionId: profile.activeMission!.id, bridgeLaunch: undefined, careerStore: store,
      npcs: [{ faction: Faction.ENEMY, characterFaction: 'viking' }], player: { dead: true },
      fieldBattleHud: hud, battleStats: { freeze() {}, snapshot: () => ({ player, squads: [] }) },
      _flushCareerSkillProgression: () => true, _persistCareerBattle: () => true,
      _disposeCareerOutpostBattleActors: dispose, _showNotify: vi.fn(),
    })
    entry._showFieldBattleResult('failure')
    const claimed = store.load()!
    expect(hud.showResult.mock.lastCall?.[4]).toBe(true)
    const continueFromDefeat = hud.showResult.mock.lastCall![3] as () => void
    storage.failWrites = true
    continueFromDefeat()
    expect(store.load()).toEqual(claimed)
    expect(dispose).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
    storage.failWrites = false
    continueFromDefeat()
    const continued = store.load()!
    expect(continued.activeMission).toEqual({ ...claimed.activeMission, prisonBreak: { ...claimed.activeMission!.prisonBreak, stage: 'escape' } })
    expect({ ...continued, activeMission: claimed.activeMission }).toEqual(claimed)
    expect(dispose).toHaveBeenCalledOnce()
    expect(session.get('sagaburst_career_town')).toBe('1')
    expect(window.location.href).toBe('/game/')
  })
})
