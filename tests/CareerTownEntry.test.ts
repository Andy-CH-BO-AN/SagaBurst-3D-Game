import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../src/town/CareerTownEntry'
import { TownScene } from '../src/town/TownScene'
import { acceptCareerOutpostRelief } from '../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'

vi.mock('../src/town/TownScene', () => ({ TownScene: { create: vi.fn() } }))
vi.mock('../src/town/TownUI', () => ({ installTownStyles: vi.fn(), starterThumbnails: vi.fn() }))

function storage(): Storage {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as Storage
}
function element() {
  return { textContent: '', style: {}, children: [] as ReturnType<typeof element>[], onclick: null as null | (() => void), append(...children: ReturnType<typeof element>[]) { this.children.push(...children) }, remove: vi.fn() }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Town load failure recovery', () => {
  it('requests pointer lock on the persistent container before loading a Career relief battlefield', async () => {
    const local = storage(), session = storage(), body = element()
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
    vi.mocked(TownScene.create).mockResolvedValue({} as TownScene)
    enterCareerTown(container as unknown as HTMLElement, launch, vi.fn())
    await vi.waitFor(() => expect(TownScene.create).toHaveBeenCalledOnce())
    const campaign = createCareerOutpostLaunch(acceptCareerOutpostRelief(profile)!)
    vi.mocked(TownScene.create).mock.calls[0][2](campaign)
    expect(container.requestPointerLock).toHaveBeenCalledOnce()
    expect(container.requestPointerLock.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0])
    expect(launch).toHaveBeenCalledWith(campaign)
  })

  it.each([false, true])('clears the entry flag on failure and return without changing saved hostility=%s', async hostile => {
    const local = storage(), session = storage(), body = element()
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
