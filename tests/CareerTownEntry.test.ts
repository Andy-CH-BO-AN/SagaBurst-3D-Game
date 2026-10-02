import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../src/town/CareerTownEntry'
import { TownScene } from '../src/town/TownScene'

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
  it('starts gameplay only after scene initialization and removal of the loading overlay', async () => {
    const local = storage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', storage())
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
