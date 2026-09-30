import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundManager } from '../src/audio/SoundManager'

class Source extends EventTarget {
  buffer: unknown
  connect = vi.fn()
  start = vi.fn()
}
let sources: Source[]
let ctx: {
  state: string
  resume: ReturnType<typeof vi.fn>
  destination: object
  decodeAudioData: ReturnType<typeof vi.fn>
  createBufferSource: ReturnType<typeof vi.fn>
  createGain: ReturnType<typeof vi.fn>
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => {
  sources = []
  ctx = {
    state: 'running', resume: vi.fn(async () => {}), destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
    createBufferSource: vi.fn(() => { const source = new Source(); sources.push(source); return source }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  }
  vi.stubGlobal('window', { AudioContext: class { constructor() { return ctx } } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  vi.spyOn(Date, 'now').mockReturnValue(10000)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const careerRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('sagaburst_voice_pack_v1'))

describe('Lazy Career audio runtime', () => {
  it('constructor preloads battle assets and fetches/decodes no Career assets', async () => {
    const manager = new SoundManager()
    await manager.preload()
    expect(fetch).toHaveBeenCalledTimes(16)
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(16)
    expect(careerRequests()).toHaveLength(0)
  })

  it('deduplicates a pending cold load, active source and immediate retries, then reuses the decoded buffer', async () => {
    const manager = new SoundManager()
    await manager.preload()
    let loaded!: (r: any) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { loaded = resolve }))
    manager.playCareerMissionVoice('roman', 'follow')
    manager.playCareerMissionVoice('roman', 'follow')
    expect(careerRequests()).toHaveLength(1)
    loaded({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    await flush()
    expect(sources).toHaveLength(1)
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    expect(sources).toHaveLength(1)
    sources[0].dispatchEvent(new Event('ended'))
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    expect(sources).toHaveLength(1)
    vi.mocked(Date.now).mockReturnValue(12000)
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    expect(sources).toHaveLength(2)
    expect(careerRequests()).toHaveLength(1)
  })

  it.each(['roman', 'viking'] as const)('lazily resolves all four %s cues to their own files', async faction => {
    const manager = new SoundManager()
    await manager.preload()
    for (const cue of ['missionAccepted', 'follow', 'return', 'townDefense'] as const) manager.playCareerMissionVoice(faction, cue)
    await flush()
    expect(careerRequests().map(([url]) => String(url).split('/mission/')[1])).toEqual([
      `${faction}/mission_accepted.wav`, `${faction}/follow.wav`, `${faction}/return.wav`, `${faction}/town_defense.wav`,
    ])
    expect(sources).toHaveLength(4)
  })

  it('starts and deduplicates the lazy alarm, resolving at actual onset', async () => {
    const manager = new SoundManager()
    await manager.preload()
    const alarm = manager.playTownAlarm()
    expect(sources).toHaveLength(0)
    expect(await manager.playTownAlarm()).toBe(false)
    expect(await alarm).toBe(true)
    expect(sources).toHaveLength(1)
    expect(sources[0].start).toHaveBeenCalledOnce()
    expect(careerRequests()).toHaveLength(1)
    expect(String(careerRequests()[0][0])).toContain('/sfx/town_alarm.wav')
  })

  it.each(['fetch', 'decode', 'source', 'suspended', 'unavailable'])('fails safely and permits a later retry after %s failure', async failure => {
    const manager = new SoundManager()
    await manager.preload()
    if (failure === 'fetch') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    if (failure === 'decode') ctx.decodeAudioData.mockRejectedValueOnce(new Error('invalid WAV'))
    if (failure === 'source') ctx.createBufferSource.mockImplementationOnce(() => { throw new Error('denied') })
    if (failure === 'suspended') { ctx.state = 'suspended'; ctx.resume.mockRejectedValue(new Error('autoplay')) }
    if (failure === 'unavailable') { (manager as any).ctx = null; vi.stubGlobal('window', {}) }
    await expect(manager.playTownAlarm()).resolves.toBe(false)
    expect(() => manager.playCareerMissionVoice('roman', 'follow')).not.toThrow()
    await flush()
    ctx.state = 'running'
    vi.stubGlobal('window', { AudioContext: class { constructor() { return ctx } } })
    await expect(manager.playTownAlarm()).resolves.toBe(true)
  })
})
