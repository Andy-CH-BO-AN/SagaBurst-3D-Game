import { afterEach,beforeEach,describe,expect,it,onTestFinished,vi } from 'vitest'
import { SoundManager } from '../../src/audio/SoundManager'

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
  it('finishes Follow only on the actual audio end event', async () => {
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
  })

  it('drops the Follow completion callback when the scene is cancelled', async () => {
    const manager = managerFixture()
    await manager.preload()
    const finished = vi.fn()
    manager.playCareerMissionVoice('roman', 'follow', finished)
    await flush()
    manager.cancelCareerAudio()
    await flush()
    expect(finished).not.toHaveBeenCalled()
  })

  it('releases the Follow completion callback if optional audio cannot play', async () => {
    const manager = managerFixture()
    await manager.preload()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const finished = vi.fn()
    manager.playCareerMissionVoice('roman', 'follow', finished)
    await flush()
    expect(sources).toHaveLength(0)
    expect(finished).toHaveBeenCalledExactlyOnceWith()
  })

  it('resolves the commander wait only after all six bells finish', async () => {
    const manager = managerFixture()
    await manager.preload()
    let completed = false
    const alarm = manager.playTownAlarm(true).then(played => { completed = true; return played })
    await flush()
    expect(sources).toHaveLength(6)
    for (const source of sources.slice(0, 5)) source.dispatchEvent(new Event('ended'))
    await flush()
    expect(completed).toBe(false)
    sources[5].dispatchEvent(new Event('ended'))
    expect(await alarm).toBe(true)
    expect(completed).toBe(true)
  })


  it('drops pending cold loads and queued speech when the mission scope changes', async () => {
    const manager = managerFixture()
    await manager.preload()
    let loaded!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { loaded = resolve }))
    manager.playCareerMissionVoice('roman', 'missionAccepted')
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    manager.cancelCareerAudio()
    manager.playCareerMissionVoice('viking', 'return')
    await flush()
    expect(sources).toHaveLength(1)
    // Fetch is the external boundary; completion needs decoded bytes, not Node's HTTP implementation.
    const response: Pick<Response, 'ok' | 'arrayBuffer'> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    loaded(response as Response)
    await flush()
    expect(sources).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/follow.wav'))).toBe(false)
  })
})
