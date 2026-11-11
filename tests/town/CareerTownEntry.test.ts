import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, type CareerCombatLaunch } from '../../src/career/CaptainBattleLaunch'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpostRelief, CAREER_OUTPOST_SESSION_KEY } from '../../src/career/CareerOutpostMission'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../../src/town/CareerTownEntry'
import { showCommanderRetirementEnding } from '../../src/town/TownRetirementUI'
import { TownScene } from '../../src/town/TownScene'
import { HorseAssetLoadError } from '../../src/world/HorseAssetRegistry'
import { CAREER_STORAGE_KEY } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { claimCareerMission } from '../../src/career/CareerProfile'

vi.mock('../../src/town/TownScene', () => ({ TownScene: { create: vi.fn() } }))
vi.mock('../../src/town/TownUI', () => ({ installTownStyles: vi.fn() }))

interface FactionViewDouble {
  options: { initialFaction?: 'roman' | 'viking'; backLabel?: string; onStart(faction: 'roman' | 'viking'): Promise<void>; onBack(): void }
  mount: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; setBusy: ReturnType<typeof vi.fn>
  showError: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn>; setCommittedFaction: ReturnType<typeof vi.fn>
}
const factionViews = vi.hoisted(() => [] as FactionViewDouble[])
vi.mock('../../src/town/FactionSelectionUI', () => ({ FactionSelectionUI: class {
  mount = vi.fn(); dispose = vi.fn(); setBusy = vi.fn(); showError = vi.fn(); setVisible = vi.fn(); setCommittedFaction = vi.fn()
  constructor(readonly options: FactionViewDouble['options']) { factionViews.push(this) }
} }))


interface EntryElement {
  textContent: string; style: Record<string, string>; children: EntryElement[]; tag: string; removed: boolean
  tabIndex?: number; hidden?: boolean; disabled?: boolean
  onanimationend: null | ((event: { target: EntryElement; animationName: string }) => void)
  onclick: null | (() => void); append(...children: EntryElement[]): void; remove: ReturnType<typeof vi.fn>
  replaceChildren(...children: EntryElement[]): void; querySelectorAll(selector: string): EntryElement[]
  focus: ReturnType<typeof vi.fn>; setAttribute(name: string, value: string): void
}
function element(tag = 'div'): EntryElement {
  const value: EntryElement = {
    textContent: '', style: {}, children: [], onclick: null, onanimationend: null, tag, removed: false,
    append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children; this.removed = false },
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]) },
    focus: vi.fn(), setAttribute: vi.fn(),
    remove: vi.fn(() => { value.removed = true }),
  }
  return value
}
function findText(root: EntryElement, text: string): EntryElement | undefined {
  if (root.removed) return undefined
  if (root.textContent === text) return root
  return root.children.map(child => findText(child, text)).find(Boolean)
}

function settledTownDefeatProfile(): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
  profile.rank = 'veteran'; profile.totalMerit = 13426; profile.availableMerit = 2659
  profile.claimedBattleIds = ['completed-battle']
  profile.townEvent = { id: 'patrol-hostility', state: 'settled', result: 'player_defeated', penalty: 100 }
  profile.raceRecords = [{ sessionId: 'earlier-race', raceId: 'race-1', result: 'win', legalFinish: true, playerSeconds: 75, merit: 100 }]
  profile.racePlayerState = {
    actorId: 'player', mountId: 'horse', position: { x: -120, y: .9, z: -50, yaw: 0 },
    mountPosition: { x: -120, y: 0, z: -50, yaw: 0 }, hp: 0, mountHp: 80,
    stamina: 34, mounted: false, dead: true, checkpoint: 5, finishSeconds: 75,
  }
  profile.playerAerialState = {
    sceneKey: 'town-home', position: { x: -120, y: 14, z: -50, yaw: 0 }, hp: 0, dead: true,
  }
  return profile
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); factionViews.length = 0 })

describe('Town load failure recovery', () => {
  it('shows a retryable horse-load error without recovering the mission or altering its saved state, and retries only once', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const profile = acceptCareerOutpostRelief({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 20000,
      completedOutpostStages: [1, 2, 3], starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], ownedHorseTiers: [1] }, 'horse-retry')!
    const store = new CareerProfileStore(local); expect(store.save(profile)).toBe(true)
    const saved = local.getItem(CAREER_STORAGE_KEY), start = vi.fn(), recover = vi.fn()
    vi.mocked(TownScene.create).mockRejectedValueOnce(new HorseAssetLoadError('重甲戰馬載入逾時（30 秒），請重試。'))
      .mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn(), recover)
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(saved)
    expect(body.children.some(child => child.textContent.includes('重甲戰馬載入逾時'))).toBe(true)
    const retry = findText(body, '重試載入城鎮')!
    expect(retry).toBeDefined()
    retry.onclick!(); retry.onclick!()
    await Promise.resolve()
    expect(TownScene.create).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledTimes(1)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  })

  it('replaces a completed Career after faction confirmation and saved tutorial routing without issuing weapons', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = createCareerProfile('roman')
    profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    profile.rank = 'commander'; profile.totalMerit = profile.availableMerit = 20000
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42, outcome: 'fallen' }
    const store = new CareerProfileStore(local)
    expect(store.save(profile)).toBe(true)
    const original = local.getItem(CAREER_STORAGE_KEY)
    const home = vi.fn()
    const training = vi.fn(async (context: { careerId: string; sessionId: string; stage: string }) => {
      expect(store.loadChecked().profile?.tutorial?.session).toMatchObject({ careerId: context.careerId, id: context.sessionId, stage: 'recruit' })
    })
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), home, undefined, training)
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(findText(body, '光榮退役')).toBeDefined()
    findText(body, '開啟新生涯')!.onclick!()
    findText(body, '取消')!.onclick!()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    findText(body, '開啟新生涯')!.onclick!()
    findText(body, '確認，選擇陣營')!.onclick!()
    // Cancelling faction selection is still non-destructive.
    const cancelledView = factionViews.at(-1)!
    cancelledView.options.onBack()
    await cancelledView.options.onStart('viking')
    expect(training).not.toHaveBeenCalled()
    expect(cancelledView.dispose).toHaveBeenCalledOnce()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    findText(body, '開啟新生涯')!.onclick!()
    findText(body, '確認，選擇陣營')!.onclick!()
    const view = factionViews.at(-1)!
    local.failWrites = true
    await view.options.onStart('viking')
    expect(view.showError).toHaveBeenCalled()
    expect(view.dispose).not.toHaveBeenCalled()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(training).not.toHaveBeenCalled()
    local.failWrites = false
    await view.options.onStart('viking')
    expect(training).toHaveBeenCalledOnce()
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(home).not.toHaveBeenCalled()
    const fresh = store.loadChecked().profile!
    expect(fresh).toMatchObject({ faction: 'viking', rank: 'recruit', totalMerit: 0, availableMerit: 0, ownedWeapons: [], claimedBattleIds: [] })
    expect(fresh.starterWeaponId).toBeUndefined()
    expect(fresh.equipment).toEqual({})
    expect(fresh.careerRetirement).toBeUndefined()
    expect(fresh.personalSquad?.members ?? []).toEqual([])
    expect(fresh.activeMission).toBeUndefined()
    expect(fresh.careerMissionCompletions).toBeUndefined()
    expect(fresh.townEvent).toBeUndefined()
    expect(fresh.inventory?.quantities).toEqual({})
    expect(fresh.tutorial?.careerId).not.toBe(profile.tutorial?.careerId)
    expect(view.setCommittedFaction).toHaveBeenCalledWith('viking')
    expect(view.dispose).toHaveBeenCalledOnce()
  })

  it('resumes a saved unarmed Career in Town without asking for a starter or issuing one', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = createCareerProfile('viking')
    profile.inventory = { version: 1, quantities: {} }; profile.equipment = {}
    profile.tutorial!.recruit.status = 'deferred'
    const store = new CareerProfileStore(local); expect(store.save(profile)).toBe(true)
    const start = vi.fn(), training = vi.fn()
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn(), undefined, training)
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(training).not.toHaveBeenCalled()
    expect(factionViews).toHaveLength(0)
    expect(vi.mocked(TownScene.create).mock.calls[0][1]).toMatchObject({ faction: 'viking', ownedWeapons: [], equipment: {} })
    const saved = store.loadChecked().profile!
    expect(saved.starterWeaponId).toBeUndefined()
    expect(saved.inventory?.quantities).toEqual({})
    expect(saved.tutorial?.careerId).toBe(profile.tutorial!.careerId)
  })

  it('retries a failed tutorial launch with the same chosen Career and session while rejecting duplicate starts', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    let finishLaunch = () => {}
    const training = vi.fn<(context: { careerId: string; sessionId: string; stage: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('asset unavailable'))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishLaunch = resolve }))
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn(), undefined, training)
    const view = factionViews[0], store = new CareerProfileStore(local)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBeNull()
    expect(training).not.toHaveBeenCalled()
    await view.options.onStart('viking')
    const first = store.loadChecked().profile!
    expect(first).toMatchObject({ faction: 'viking', rank: 'recruit', ownedWeapons: [], equipment: {}, inventory: { quantities: {} } })
    expect(first.starterWeaponId).toBeUndefined()
    expect(view.showError).toHaveBeenCalledWith(expect.stringContaining('角色與教學已保存'))
    expect(view.showError).not.toHaveBeenCalledWith(expect.stringContaining('asset unavailable'))
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.dispose).not.toHaveBeenCalled()
    const retry = view.options.onStart('roman')
    try {
      await view.options.onStart('roman')
      expect(training).toHaveBeenCalledTimes(2)
      expect(training.mock.calls[1][0]).toEqual(training.mock.calls[0][0])
      expect(store.loadChecked().profile!.tutorial?.careerId).toBe(first.tutorial!.careerId)
      expect(store.loadChecked().profile!.faction).toBe('viking')
    } finally { finishLaunch(); await retry }
    expect(view.dispose).toHaveBeenCalledOnce()
    const saved = local.getItem(CAREER_STORAGE_KEY)
    await view.options.onStart('roman')
    expect(training).toHaveBeenCalledTimes(2)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  })

  it('returns home after a failed replacement launch without reviving the old ending or accepting stale callbacks', async () => {
    const local = new MemoryStorage(), body = element(), home = vi.fn()
    const training = vi.fn(async () => { throw new Error('load failed') })
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const previous = createCareerProfile('roman')
    previous.rank = 'commander'; previous.totalMerit = previous.availableMerit = 20000
    previous.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42, outcome: 'fallen' }
    const store = new CareerProfileStore(local)
    expect(store.save(previous)).toBe(true)
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), home, undefined, training)
    findText(body, '開啟新生涯')!.onclick!()
    findText(body, '確認，選擇陣營')!.onclick!()
    const view = factionViews[0]
    await view.options.onStart('viking')
    const saved = local.getItem(CAREER_STORAGE_KEY)
    expect(store.loadChecked().profile!.tutorial?.careerId).not.toBe(previous.tutorial!.careerId)
    view.options.onBack()
    await view.options.onStart('roman')
    view.options.onBack()
    expect(home).toHaveBeenCalledOnce()
    expect(view.dispose).toHaveBeenCalledOnce()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(saved)
    expect(training).toHaveBeenCalledOnce()
    expect(findText(body, '光榮退役')).toBeUndefined()
    expect(TownScene.create).not.toHaveBeenCalled()
  })

  it('saves the castle refit before map launch and offers a retry if that save fails', async () => {
    // Zero scene/actor constructors: the entry callback owns durable transition ordering.
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 20000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], completedOutpostStages: [1, 2, 3] as (1 | 2 | 3)[], ownedHorseTiers: [1] as (1 | 2 | 3)[] }
    profile.townCommandSquad = { type: 'town-command', squadId: 1, actorIds: ['guard'], townFaction: 'roman', sceneKey: 'town-home',
      state: 'FOLLOWING', authorized: true, contribution: emptyPersonalContribution(), members: { guard: { status: 'dead', hp: 0 } } }
    const store = new CareerProfileStore(local); store.save(profile)
    const start = vi.fn(), launch = vi.fn(async () => {
      expect(store.load()?.townCommandSquad?.members?.guard).toEqual({ status: 'reserve' })
    })
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, launch, vi.fn())
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(store.load()?.townCommandSquad?.members?.guard.hp).toBe(0)
    local.failWrites = true
    vi.mocked(TownScene.create).mock.calls[0][2](createCareerOutpostLaunch(acceptCareerOutpostRelief(profile)!))
    expect(launch).not.toHaveBeenCalled()
    expect(store.load()?.townCommandSquad?.members?.guard.hp).toBe(0)
    local.failWrites = false
    body.children[1].children.find((child: ReturnType<typeof element>) => child.textContent === '重試轉場')!.onclick!()
    expect(launch).toHaveBeenCalledOnce()
  })

  it('saves death-return checkpoint cleanup before rebuilding town and retries without altering the settled battle', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const store = new CareerProfileStore(local)
    expect(store.save(settledTownDefeatProfile())).toBe(true)
    const original = store.load()!, serialized = local.getItem(CAREER_STORAGE_KEY)
    // The battle mission was interrupted by town hostility; no race is currently active.
    expect(original.activeMission).toBeUndefined()
    expect(original.activeRace).toBeUndefined()
    const savedAtCreation: (CareerProfile | null)[] = [], start = vi.fn()
    vi.mocked(TownScene.create).mockImplementation(async () => {
      savedAtCreation.push(store.load())
      return { start } as unknown as TownScene
    })
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await Promise.resolve()
    const restart = vi.mocked(TownScene.create).mock.calls[0][3]
    local.failWrites = true
    restart(original, 'death-return')
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(savedAtCreation).toHaveLength(1)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(serialized)
    const retry = body.children.flatMap(child => child.children).find(child => child.textContent === '重試轉場')
    expect(retry).toBeDefined()
    local.failWrites = false
    retry!.onclick!()
    await Promise.resolve()
    const expected = { ...original, playerAerialState: undefined, racePlayerState: undefined }
    expect(start).toHaveBeenCalledTimes(2)
    expect(savedAtCreation[1]).toEqual(expected)
    expect(vi.mocked(TownScene.create).mock.calls[1][1]).toEqual(expected)
    expect(store.load()).toEqual(expected)
    expect(original.racePlayerState).toMatchObject({ hp: 0, dead: true })
    expect(original.playerAerialState).toMatchObject({ hp: 0, dead: true })
  })
})


describe('Captain battlefield Career entry routing', () => {
  it('saves completed battlefield resident recovery before rebuilding town and retries a refused write', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const fresh = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }
    const accepted = acceptCaptainFrontline(fresh, 'completed-return')!
    const profile = claimCareerMission(accepted, accepted.activeMission!.id, 'victory', {
      damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true,
    }).profile
    profile.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: ['merchant'], owners: { merchant: 'player' }, members: { merchant: { status: 'dead', hp: 0 } } }
    const store = new CareerProfileStore(local); expect(store.save(profile)).toBe(true)
    const merit = profile.totalMerit
    vi.mocked(TownScene.create).mockImplementation(async (_container, restored) => {
      expect(store.load()?.activeMission).toBeUndefined()
      expect(restored.civilianCommandSquad?.actorIds).toHaveLength(21)
      expect(restored.civilianCommandSquad?.members.merchant).toMatchObject({ status: 'deployed', order: 'attack' })
      expect(restored.civilianCommandSquad?.members.merchant.hp).toBeUndefined() // New actor owns full default resources.
      return { start: vi.fn() } as unknown as TownScene
    })
    local.failWrites = true
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await Promise.resolve()
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(store.load()?.civilianCommandSquad?.members.merchant).toMatchObject({ status: 'dead', hp: 0 })
    local.failWrites = false
    body.children[0].children.find(child => child.textContent === '重試返回小鎮')!.onclick!()
    await Promise.resolve()
    expect(TownScene.create).toHaveBeenCalledOnce()
    const returned = store.load()!
    expect(returned.totalMerit).toBe(merit)
    expect(returned.civilianCommandSquad?.owners.merchant).toBe('daily')
  })
  it.each(['frontline', 'eagle'] as const)('%s reload resumes the actual Captain battle before constructing a Town scene', async kind => {
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const fresh = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 5000, availableMerit: 5000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], ownedMounts: ['xongkoro' as const] }
    const accepted = kind === 'eagle' ? acceptCaptainEagle(fresh, 'resume-eagle')! : acceptCaptainFrontline(fresh, 'resume-frontline')!
    expect(new CareerProfileStore(local).save(accepted)).toBe(true)
    const launch = vi.fn(async (_config: CareerCombatLaunch) => {})
    enterCareerTown(element() as unknown as HTMLElement, launch, vi.fn())
    await Promise.resolve()
    expect(launch).toHaveBeenCalledOnce()
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(launch.mock.calls[0][0]).toMatchObject(kind === 'eagle'
      ? { type: 'captain-eagle', careerMissionId: 'resume-eagle', battle: { careerEagleMissionId: 'resume-eagle' } }
      : { type: 'defense', careerMissionId: 'resume-frontline', careerMissionKind: 'captain-outpost-defense', stageId: 9 })
    expect(session.getItem(CAREER_OUTPOST_SESSION_KEY)).toBe(accepted.activeMission!.id)
    expect(session.getItem(TOWN_ENTRY_KEY)).toBeNull()
  })
})


describe('Retirement ending lifecycle', () => {
  it('disposes replaced and departed overlays and rejects callbacks retained by detached buttons', () => {
    const body = element(), home = vi.fn(), newCareer = vi.fn()
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    const profile = createCareerProfile('roman')
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 1, combatElapsedSeconds: 0, outcome: 'escaped' }
    const show = () => showCommanderRetirementEnding(profile, { home, newCareer })
    const closeFirst = show()
    const title = findText(body, '帶旗離城')!
    expect(title.tabIndex).toBe(-1)
    expect(title.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    expect(findText(body, '開啟新生涯')!.focus).not.toHaveBeenCalled()
    const firstHome = findText(body, '返回主選單')!
    const staleHome = firstHome.onclick!
    const closeSecond = show()
    expect(body.children.filter(child => !child.removed)).toHaveLength(1)
    expect(firstHome.onclick).toBeNull()
    closeFirst(); staleHome()
    expect(home).not.toHaveBeenCalled()
    findText(body, '返回主選單')!.onclick!()
    expect(home).toHaveBeenCalledOnce()
    expect(body.children.filter(child => !child.removed)).toHaveLength(0)
    closeSecond()
    const closeThird = show()
    findText(body, '開啟新生涯')!.onclick!()
    findText(body, '取消')!.onclick!()
    expect(body.children.filter(child => !child.removed)).toHaveLength(1)
    expect(newCareer).not.toHaveBeenCalled()
    closeThird(); closeThird()
    expect(body.children.filter(child => !child.removed)).toHaveLength(0)
    expect(home).toHaveBeenCalledOnce()
  })
})
