import { afterEach,beforeEach,describe,expect,it,onTestFinished,vi } from 'vitest'
import { playAppliedPunchHit, SoundManager } from '../../src/audio/SoundManager'

class Source extends EventTarget {
  buffer: unknown
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn(() => this.dispatchEvent(new Event('ended')))
  disconnect = vi.fn()
}
let sources: Source[]
let ctx: {
  state: string
  currentTime: number
  resume: ReturnType<typeof vi.fn>
  destination: object
  decodeAudioData: ReturnType<typeof vi.fn>
  createBufferSource: ReturnType<typeof vi.fn>
  createGain: ReturnType<typeof vi.fn>
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

beforeEach(() => {
  sources = []
  ctx = {
    state: 'running', currentTime: 0, resume: vi.fn(async () => {}), destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
    createBufferSource: vi.fn(() => { const source = new Source(); sources.push(source); return source }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  }
  vi.stubGlobal('window', { AudioContext: class { constructor() { return ctx } } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  vi.spyOn(Date, 'now').mockReturnValue(10000)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function managerFixture() {
  const manager = new SoundManager()
  onTestFinished(() => manager.cancelCareerAudio())
  return manager
}

describe('Lazy Career audio runtime', () => {
  it('finishes Follow on the actual audio end event or falls back immediately when audio fails', async () => {
    const faction = 'roman'
    const manager = managerFixture()
    await manager.preload()

    const finished = vi.fn()
    manager.playCareerMissionVoice(faction, 'follow', finished)
    await flush()
    expect(sources).toHaveLength(1)
    expect(finished).not.toHaveBeenCalled()
    sources[0].dispatchEvent(new Event('ended'))
    await flush()
    expect(finished).toHaveBeenCalledExactlyOnceWith()

    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const offlineFinished = vi.fn()
    manager.playCareerMissionVoice(faction, 'follow', offlineFinished)
    await flush()
    expect(offlineFinished).toHaveBeenCalledExactlyOnceWith()
  })

  it('drops the Follow completion callback when cancelled and drops pending cold loads when mission scope changes', async () => {
    const manager = managerFixture()
    await manager.preload()
    const finished = vi.fn()
    manager.playCareerMissionVoice('roman', 'follow', finished)
    await flush()
    manager.cancelCareerAudio()
    await flush()
    expect(finished).not.toHaveBeenCalled()

    sources.length = 0
    vi.mocked(fetch).mockClear()
    let loaded!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { loaded = resolve }))
    manager.playCareerMissionVoice('roman', 'missionAccepted')
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    manager.cancelCareerAudio()
    manager.playCareerMissionVoice('viking', 'return')
    await flush()
    expect(sources).toHaveLength(1)
    const response: Pick<Response, 'ok' | 'arrayBuffer'> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    loaded(response as Response)
    await flush()
    expect(sources).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/follow.wav'))).toBe(false)
  })

  it('resolves the commander wait only after all alarm bells finish', async () => {
    const manager = managerFixture()
    await manager.preload()
    let completed = false
    const alarm = manager.playTownAlarm(true).then(played => { completed = true; return played })
    await flush()
    const count = sources.length
    expect(count).toBeGreaterThan(0)
    for (const source of sources.slice(0, count - 1)) source.dispatchEvent(new Event('ended'))
    await flush()
    expect(completed).toBe(false)
    sources[count - 1].dispatchEvent(new Event('ended'))
    expect(await alarm).toBe(true)
    expect(completed).toBe(true)
  })
})


describe('Optional punch impact audio', () => {
  it('收起長槍後只有有效拳頭接觸走拳擊音效，空揮和完全格擋不播放', () => {
    const sound = { playPunchHit: vi.fn() }
    const event = { type: 'damage_applied' as const, source: { actorId: 'player', actorType: 'player' as const,
      allegiance: 'PLAYER' as never, characterFaction: 'roman' as const }, target: { targetId: 'opponent', targetType: 'npc' as const, name: 'opponent' },
      method: 'melee' as const, weaponId: 'unarmed', attackSource: 'unarmed' as const, contactKind: 'body' as const,
      appliedDamage: 5, requestedDamage: 5 }
    expect(playAppliedPunchHit(event, sound, 1)).toBe(true)
    expect(sound.playPunchHit).toHaveBeenCalledExactlyOnceWith(1, true)
    expect(playAppliedPunchHit({ ...event, appliedDamage: 0 }, sound)).toBe(false)
    expect(playAppliedPunchHit({ ...event, contactKind: 'shield' }, sound)).toBe(false)
    expect(playAppliedPunchHit({ ...event, weaponId: 'steel_lance', attackSource: undefined }, sound)).toBe(false)
    expect(sound.playPunchHit).toHaveBeenCalledTimes(1)
  })
  it('拳擊錄音 404 只請求一次，之後拳擊安全靜音；新的 manager 可載入新增的錄音', async () => {
    const manager = managerFixture()
    await manager.preload()
    const missing = vi.fn(async (_url: string) => ({ ok: false }))
    vi.stubGlobal('fetch', missing)
    manager.playPunchHit(0, true); manager.playPunchHit(0, true)
    await flush()
    manager.playPunchHit(0, true)
    await flush()
    expect(missing).toHaveBeenCalledTimes(1)
    expect(sources).toHaveLength(0)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
    const fresh = managerFixture()
    await fresh.preload()
    fresh.playPunchHit(0, true)
    await flush()
    expect(sources).toHaveLength(1)
  })
})
