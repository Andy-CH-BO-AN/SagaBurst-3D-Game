import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../../src/town/CareerTownEntry'
import { TownScene } from '../../src/town/TownScene'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { MemoryStorage } from '../helpers/memoryStorage'

vi.mock('../../src/town/TownScene', () => ({ TownScene: { create: vi.fn() } }))
vi.mock('../../src/town/TownUI', () => ({ installTownStyles: vi.fn(), starterThumbnails: vi.fn() }))

function element() {
  return { textContent: '', style: {}, children: [] as ReturnType<typeof element>[], onclick: null as null | (() => void), append(...children: ReturnType<typeof element>[]) { this.children.push(...children) }, remove: vi.fn() }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Town load failure recovery', () => {
  it('starts gameplay only after scene initialization and removal of the loading overlay', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = createCareerProfile('roman'); profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    new CareerProfileStore(local).save(profile)
    const start = vi.fn(() => expect(body.children[1].remove).toHaveBeenCalledOnce())
    vi.mocked(TownScene.create).mockImplementation(async () => {
      expect(start).not.toHaveBeenCalled()
      expect(body.children[1].remove).not.toHaveBeenCalled()
      return { start } as unknown as TownScene
    })
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
  })

  it('clears the resume flag and returns home without deleting the Career save', async () => {
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element(), home = vi.fn(), start = vi.fn()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = createCareerProfile('roman'); profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    new CareerProfileStore(local).save(profile)
    const saved = local.getItem('sagaburst_career_v1')
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), home)
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(session.getItem(TOWN_ENTRY_KEY)).toBe('1')
    vi.mocked(TownScene.create).mock.calls[0][4]()
    expect(session.getItem(TOWN_ENTRY_KEY)).toBeNull()
    expect(home).toHaveBeenCalledOnce()
    expect(local.getItem('sagaburst_career_v1')).toBe(saved)
  })

  it('requests pointer lock on the persistent container before loading a Career relief battlefield', async () => {
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '' })
    vi.stubGlobal('navigator', { userActivation: { isActive: false } })
    vi.stubGlobal('window', {})
    const profile = { ...createCareerProfile('roman'), rank: 'soldier' as const, totalMerit: 300, availableMerit: 300,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], completedOutpostStages: [1, 2, 3] as (1 | 2 | 3)[],
      ownedHorseTiers: [1] as (1 | 2 | 3)[] }
    new CareerProfileStore(local).save(profile)
    const container = { ...element(), requestPointerLock: vi.fn(async () => {}) }
    const launch = vi.fn(async () => {})
    const start = vi.fn()
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(container as unknown as HTMLElement, launch, vi.fn())
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    const campaign = createCareerOutpostLaunch(acceptCareerOutpostRelief(profile)!)
    vi.mocked(TownScene.create).mock.calls[0][2](campaign)
    expect(container.requestPointerLock).toHaveBeenCalledOnce()
    expect(container.requestPointerLock.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0])
    expect(launch).toHaveBeenCalledWith(campaign)
  })

  it.each([false, true])('clears the entry flag on failure and return without changing saved hostility=%s', async hostile => {
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' })
    const profile = createCareerProfile('roman'); profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    if (hostile) profile.townEvent = { id: 'existing-hostility', state: 'hostile' }
    const store = new CareerProfileStore(local); store.save(profile)
    const saved = local.getItem('sagaburst_career_v1'), home = vi.fn()
    vi.mocked(TownScene.create).mockImplementation(async () => {
      expect(session.getItem(TOWN_ENTRY_KEY)).toBe('1')
      throw new Error('asset load failed')
    })
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), home)
    await vi.waitFor(() => expect(body.children[1].textContent).toContain('小鎮載入失敗'))
    expect(session.getItem(TOWN_ENTRY_KEY)).toBeNull()
    const back = body.children[1].children.find(child => child.textContent === '返回主選單')!
    session.setItem(TOWN_ENTRY_KEY, '1')
    back.onclick!()
    expect(session.getItem(TOWN_ENTRY_KEY)).toBeNull(); expect(home).toHaveBeenCalledTimes(1)
    expect(local.getItem('sagaburst_career_v1')).toBe(saved)
    expect(store.load()?.townEvent?.state).toBe(hostile ? 'hostile' : undefined)
  })
})
