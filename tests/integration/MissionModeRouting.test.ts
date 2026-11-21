import { careerRankFixture } from '../helpers/careerRankFixture'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { CareerSkillSaveScheduler } from '../../src/career/CareerSkillSaveScheduler'
import { Faction } from '../../src/world/NPC'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { shouldResumeCareerTown } from '../../src/career/CareerResumeRouting'
import { Game } from '../../src/Game'
import { SkillManager } from '../../src/rpg/SkillManager'
import { getDefenseCampaignUnlockedStage } from '../../src/campaign/CampaignProgress'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { createCareerVeteranOutpostLaunch } from '../../src/career/CareerVeteranOutpost'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
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
  const profile = acceptCareerOutpost({ ...createCareerProfile('roman'), ...careerRankFixture('roman', 'soldier'), rank: 'soldier', totalMerit: 300, availableMerit: 300, starterWeaponId: 'gladius_rusty', inventory: { version: 1 as const, quantities: Object.fromEntries(['gladius_rusty'].map(id => [id, 1])) }, ownedWeapons: ['gladius_rusty'] }, 1, 'battle')!
  store.save(profile)
  const config = createCareerOutpostLaunch(profile)
  if (!career) { delete config.capabilities; delete config.careerMissionId }
  const snapshot = { player: { damageDealt: 200, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }, squads: [] }
  // What the HUD was shown, with the durable profile as it stood at that moment.
  const shown: { outcome: string; onExit(): void; onNext?: () => void; durable: CareerProfile | null }[] = []
  const gates: boolean[] = []
  const game = Object.assign(Object.create(Game.prototype) as CampaignSettlementEntry, {
    spawnBatches: [], careerSkillSave: new CareerSkillSaveScheduler({ save: () => true }), initializing: false, spawningStopped: false,
    defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime(config.capabilities),
    defenseCampaignHud: {
      showResult: (outcome: string, _reload: () => void, onExit: () => void, _observe: boolean, onNext?: () => void) => { shown.push({ outcome, onExit, onNext, durable: store.load() }) },
      update: vi.fn(), updateGate: (_state: unknown, _unlocked: boolean, canOperate: boolean) => { gates.push(canOperate) }, destroy: vi.fn(),
    },
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
  return { game, storage, store, snapshot, shown, gates }
}

afterEach(() => vi.unstubAllGlobals())

describe('Game routes Campaign and Career separately', () => {
  it('settles a Career win without Campaign mutation or Next Stage flow', () => {
    const { game, store, storage, shown, gates } = harness()
    game._updateDefenseCampaign(1)
    expect(game.battleStats.freeze).toHaveBeenCalledOnce()
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(1)
    const settled = store.load()!
    expect(settled.completedOutpostStages).toEqual([1])
    expect(shown[0].durable).toEqual(settled)
    expect(shown[0].onNext).toBeUndefined()
    expect(gates[0]).toBe(false)
    game._showDefenseCampaignResult('victory')
    const recorded = store.load()!
    expect(recorded.totalMerit).toBe(settled.totalMerit)
    expect(recorded.outpostBattleRecords).toHaveLength(1)
  })
  it('keeps formal Campaign progress and Next Stage behavior and leaves Career untouched', () => {
    const { game, store, storage, shown, gates } = harness(false)
    const completed = store.load()!
    Object.assign(completed, careerRankFixture(completed.faction, 'commander')); completed.totalMerit = completed.availableMerit = 20000
    delete completed.activeOutpostMission
    completed.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42, outcome: 'escaped' }
    expect(store.save(completed)).toBe(true)
    const careerBefore = store.load()
    game._updateDefenseCampaign(1)
    expect(getDefenseCampaignUnlockedStage('roman', storage)).toBe(2)
    expect(store.load()).toEqual(careerBefore)
    expect(shown[0].onNext).toBeTypeOf('function')
    expect(gates[0]).toBe(true)
  })
  it('keeps a Career outpost result unclaimed and unpublished while the save fails, then claims it once from the retry', () => {
    const { game, store, storage, shown } = harness()
    const created: { id: string; textContent: string; onclick?: () => void; append(): void; remove(): void }[] = []
    const removed: string[] = []
    vi.stubGlobal('document', { pointerLockElement: null, body: { append() {} }, createElement: () => {
      const el = { id: '', className: '', textContent: '', onclick: undefined, append() {}, remove() { removed.push(el.id) } }
      created.push(el); return el
    } })
    const before = storage.getItem(CAREER_STORAGE_KEY)
    storage.failWrites = true
    game._showDefenseCampaignResult('victory')
    expect(shown).toEqual([])
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(before)
    expect(created.map(el => el.textContent)).toContain('Career 結算尚未保存，請重試。')
    storage.failWrites = false
    created.find(el => el.textContent === '重試保存軍功')!.onclick!()
    expect(removed).toEqual(['campaign-result-modal'])
    expect(shown).toHaveLength(1)
    const saved = store.load()!
    expect(shown[0].durable).toEqual(saved)
    expect(saved.outpostBattleRecords).toHaveLength(1)
    expect(saved.totalMerit).toBe(300 + saved.outpostBattleRecords![0].merit.total)
  })
  it('returns to the same faction town, clears only the active duty and keeps claimed merit', () => {
    const { game, store, shown } = harness()
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) })
    Reflect.set(window, 'location', { pathname: '/game/', href: '' })
    game._updateDefenseCampaign(1)
    const merit = store.load()!.totalMerit
    shown[0].onExit()
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
      ...createCareerProfile('roman'), ...careerRankFixture('roman', 'veteran'), rank: 'veteran', totalMerit: 900, inventory: { version: 1 as const, quantities: Object.fromEntries(['horse'].map(id => [id, 1])) }, ownedMounts: ['horse'],
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
      Object.assign(profile, careerRankFixture(profile.faction, 'commander')); profile.totalMerit = profile.availableMerit = 20000
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


interface FieldResultEntry {
  _showFieldBattleResult(outcome: 'victory' | 'failure'): void
  _applyPlayerSkillAward(award: { skill: 'oneHanded'; xp: number }): void
  _flushCareerSkillProgression(): boolean
  createCareerSkillSaveScheduler(): CareerSkillSaveScheduler
  careerSkillSave: CareerSkillSaveScheduler
}

const prisonerStats = { damageDealt: 20, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }

/** The real field result caller: Game's own skill flush and battle persist run, only the scene and HUD are narrow doubles. */
function fieldResultGame<T extends object>(store: CareerProfileStore, missionId: string, hud: object, extra?: T) {
  return Object.assign(Object.create(Game.prototype) as FieldResultEntry, {
    felineMissionId: missionId, bridgeLaunch: undefined, careerStore: store, careerSkillSave: new CareerSkillSaveScheduler({ save: () => true }),
    npcs: [{ faction: Faction.ENEMY, characterFaction: 'viking' }], player: { dead: true },
    fieldBattleHud: hud, battleStats: { freeze() {}, snapshot: () => ({ player: prisonerStats, squads: [] }) },
  }, extra)
}

describe('Heavy field defeat capture at the production Game caller', () => {
  it('正式結果保存失敗不離場，重試後保存一次被俘資格，玩家倒下的勝利不進戰俘流程', () => {
    for (const outcome of ['failure', 'victory'] as const) {
      const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
      const profile = acceptHeavyFieldMission({ ...createCareerProfile('roman'), ...careerRankFixture('roman', 'soldier'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 'soldier-iron-encounter', `field-${outcome}`)!
      expect(store.save(profile)).toBe(true)
      const elements: { innerHTML: string }[] = []
      vi.stubGlobal('document', { pointerLockElement: null, body: { append: vi.fn() }, createElement: () => {
        const el = { id: '', className: '', style: { cssText: '' }, innerHTML: '', remove: vi.fn(),
          querySelector: () => ({ addEventListener: vi.fn() }) }
        elements.push(el); return el
      } })
      const hud = new CaptainEagleHUD('feline')
      const shown: { merit: number; guards?: number; durableMerit?: number }[] = []
      const realShowResult = hud.showResult.bind(hud)
      hud.showResult = (shownOutcome, merit, stats, onReturn, guards) => {
        shown.push({ merit, guards, durableMerit: store.load()!.activeMission!.result?.merit.total })
        realShowResult(shownOutcome, merit, stats, onReturn, guards)
      }
      const retries: (() => void)[] = []
      const realShowSaveRetry = hud.showSaveRetry.bind(hud)
      hud.showSaveRetry = onRetry => { retries.push(onRetry); realShowSaveRetry(onRetry) }
      const entry = fieldResultGame(store, profile.activeMission!.id, hud)
      storage.failWrites = true
      entry._showFieldBattleResult(outcome)
      expect(shown).toEqual([])
      expect(retries).toHaveLength(1)
      expect(store.load()!.activeMission!.result).toBeUndefined()
      expect(store.load()!.activeMission!.prisonBreak).toBeUndefined()
      storage.failWrites = false
      retries[0]()
      const saved = store.load()!
      expect(saved.activeMission!.result!.outcome).toBe(outcome)
      expect(saved.activeMission!.prisonBreak?.captor).toBe(outcome === 'failure' ? 'viking' : undefined)
      expect(saved.claimedBattleIds).toEqual([profile.activeMission!.id])
      expect(shown).toEqual([{ merit: saved.activeMission!.result!.merit.total, guards: outcome === 'failure' ? 10 : undefined, durableMerit: saved.activeMission!.result!.merit.total }])
      const resultMarkup = elements.at(-1)!.innerHTML
      expect(resultMarkup).toContain('戰鬥統計')
      expect(resultMarkup).toContain(`Career 軍功 +${saved.activeMission!.result!.merit.total}`)
      if (outcome === 'failure') {
        expect(resultMarkup).toContain('你被俘虜了')
        expect(resultMarkup).toContain('擊倒 10 名看守')
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
    const profile = acceptHeavyFieldMission({ ...createCareerProfile('roman'), ...careerRankFixture('roman', 'soldier'), rank: 'soldier', totalMerit: 300, availableMerit: 300 }, 'soldier-iron-encounter', 'field-return')!
    expect(store.save(profile)).toBe(true)
    let shown: { onContinue(): void; guards?: number } | undefined
    const hud = { showResult: (_outcome: string, _merit: number, _stats: unknown, onContinue: () => void, guards?: number) => { shown = { onContinue, guards } }, showSaveRetry() {} }
    const dispose = vi.fn()
    const entry = fieldResultGame(store, profile.activeMission!.id, hud, { _disposeCareerOutpostBattleActors: dispose, _showNotify: vi.fn() })
    entry._showFieldBattleResult('failure')
    const claimed = store.load()!
    expect(shown?.guards).toBe(10)
    storage.failWrites = true
    shown!.onContinue()
    expect(store.load()).toEqual(claimed)
    expect(dispose).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
    storage.failWrites = false
    shown!.onContinue()
    const continued = store.load()!
    expect(continued.activeMission).toEqual({ ...claimed.activeMission, prisonBreak: { ...claimed.activeMission!.prisonBreak, stage: 'escape' } })
    expect({ ...continued, activeMission: claimed.activeMission }).toEqual(claimed)
    expect(dispose).toHaveBeenCalledOnce()
    expect(session.get('sagaburst_career_town')).toBe('1')
    expect(window.location.href).toBe('/game/')
  })
})

describe('Game career skill saves', () => {
  it('debounces an XP award through the shared owner and keeps newer stored state and unreadable bytes, with the co-op and no-profile rules', () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.clearAllTimers(); vi.useRealTimers() })
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const cached = createCareerProfile('roman')
    expect(store.save(cached)).toBe(true)
    const newer = { ...cached, totalMerit: 777 } // another battle flow wrote the store behind the cached profile
    expect(store.save(newer)).toBe(true)
    const game = fieldResultGame(store, 'unused', {}, {
      careerProfile: cached, skillManager: new SkillManager(), controlMode: 'player', coopPlayerSource: null,
      player: { dead: false, spectatorOnly: false, blockingLevel: 1, armorBreakLevel: 1 },
    })
    game.careerSkillSave = game.createCareerSkillSaveScheduler()
    game._applyPlayerSkillAward({ skill: 'oneHanded', xp: 6 })
    vi.advanceTimersByTime(599)
    expect(store.load()!.skills!.oneHanded.xp).toBe(0)
    vi.advanceTimersByTime(1)
    expect(store.load()!.skills!.oneHanded.xp).toBe(6)
    expect(store.load()!.totalMerit).toBe(777)

    // An unreadable stored save is never overwritten: the flush is refused and the XP stays dirty.
    storage.setItem(CAREER_STORAGE_KEY, '{corrupt')
    game._applyPlayerSkillAward({ skill: 'oneHanded', xp: 2 })
    vi.advanceTimersByTime(600)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe('{corrupt')
    expect(game.careerSkillSave.dirty).toBe(true)
    expect(game._flushCareerSkillProgression()).toBe(false)
    // A co-op guest saves into its own save: a refused write never blocks the mission's flows.
    Object.assign(game, { coopPlayerSource: { commitSkills: () => false, read: () => cached } })
    expect(game._flushCareerSkillProgression()).toBe(true)
    expect(game.careerSkillSave.dirty).toBe(true)
    // Without a profile there is nothing to save and the flush succeeds.
    Object.assign(game, { coopPlayerSource: null, careerProfile: null })
    expect(game._flushCareerSkillProgression()).toBe(true)
    expect(game.careerSkillSave.dirty).toBe(true)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe('{corrupt')
  })
})
