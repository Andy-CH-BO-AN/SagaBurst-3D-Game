import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, type CareerCombatLaunch } from '../../src/career/CaptainBattleLaunch'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpostRelief, CAREER_OUTPOST_SESSION_KEY } from '../../src/career/CareerOutpostMission'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../../src/town/CareerTownEntry'
import { TownScene } from '../../src/town/TownScene'
import { starterThumbnails } from '../../src/town/TownUI'
import { CAREER_STORAGE_KEY } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { claimCareerMission } from '../../src/career/CareerProfile'

vi.mock('../../src/town/TownScene', () => ({ TownScene: { create: vi.fn() } }))
vi.mock('../../src/town/TownUI', () => ({ installTownStyles: vi.fn(), starterThumbnails: vi.fn() }))

interface EntryElement {
  textContent: string; style: Record<string, string>; children: EntryElement[]; tag: string; removed: boolean
  onclick: null | (() => void); append(...children: EntryElement[]): void; remove: ReturnType<typeof vi.fn>
  replaceChildren(...children: EntryElement[]): void; querySelectorAll(selector: string): EntryElement[]
}
function element(tag = 'div'): EntryElement {
  const value: EntryElement = {
    textContent: '', style: {}, children: [], onclick: null, tag, removed: false,
    append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children; this.removed = false },
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]) },
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

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Town load failure recovery', () => {
  it('replaces a completed Career only after confirmed starter selection and a successful save, then starts after loading', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: (tag: string) => element(tag) })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    vi.mocked(starterThumbnails).mockReturnValue(new Map())
    const profile = createCareerProfile('roman')
    profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    profile.rank = 'commander'; profile.totalMerit = profile.availableMerit = 20000
    profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123, combatElapsedSeconds: 42, outcome: 'fallen' }
    const store = new CareerProfileStore(local)
    expect(store.save(profile)).toBe(true)
    const original = local.getItem(CAREER_STORAGE_KEY)
    const home = vi.fn()
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), home)
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(findText(body, '退休結局：光榮退役')).toBeDefined()
    findText(body, '開始新的 Career')!.onclick!()
    findText(body, '取消')!.onclick!()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    findText(body, '開始新的 Career')!.onclick!()
    findText(body, '開始新生涯')!.onclick!()
    // Cancelling the existing faction/starter creator is still non-destructive.
    findText(body, '取消')!.onclick!()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    findText(body, '開始新的 Career')!.onclick!()
    findText(body, '開始新生涯')!.onclick!()
    const form = body.children[body.children.length - 1]
    const grid = form.children[form.children.length - 1]
    local.failWrites = true
    grid.children[0].onclick!()
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(original)
    expect(TownScene.create).not.toHaveBeenCalled()
    local.failWrites = false
    let loading: EntryElement | undefined
    const start = vi.fn(() => expect(loading?.remove).toHaveBeenCalledOnce())
    vi.mocked(TownScene.create).mockImplementation(async () => {
      loading = body.children[body.children.length - 1]
      expect(start).not.toHaveBeenCalled()
      expect(loading.remove).not.toHaveBeenCalled()
      return { start } as unknown as TownScene
    })
    grid.children[0].onclick!()
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(home).not.toHaveBeenCalled()
    const fresh = store.loadChecked().profile!
    expect(fresh).toMatchObject({ rank: 'recruit', totalMerit: 0, availableMerit: 0, starterWeaponId: 'gladius_rusty', claimedBattleIds: [] })
    expect(fresh.careerRetirement).toBeUndefined()
    expect(fresh.personalSquad?.members ?? []).toEqual([])
    expect(fresh.activeMission).toBeUndefined()
    expect(fresh.careerMissionCompletions).toBeUndefined()
    expect(fresh.townEvent).toBeUndefined()
    expect(fresh.inventory?.quantities).toEqual({ gladius_rusty: 1 })
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

  it('preserves death checkpoints on an ordinary town reload and restart until explicit death return', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const store = new CareerProfileStore(local)
    expect(store.save(settledTownDefeatProfile())).toBe(true)
    const original = store.load()!, serialized = local.getItem(CAREER_STORAGE_KEY)
    const start = vi.fn()
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await Promise.resolve()
    expect(vi.mocked(TownScene.create).mock.calls[0][1]).toEqual(original)
    vi.mocked(TownScene.create).mock.calls[0][3](original)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(2)
    expect(vi.mocked(TownScene.create).mock.calls[1][1]).toEqual(original)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(serialized)
    expect(store.load()?.racePlayerState).toMatchObject({ hp: 0, dead: true })
    expect(store.load()?.playerAerialState).toMatchObject({ hp: 0, dead: true })
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
