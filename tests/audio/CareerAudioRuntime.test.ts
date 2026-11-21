import { afterEach,beforeEach,describe,expect,it,onTestFinished,vi } from 'vitest'
import { playAppliedPunchHit, SoundManager } from '../../src/audio/SoundManager'

/** 'pending': autoplay is denied and resume() stays unsettled until a later user gesture. */
type ResumeOutcome = 'granted' | 'stays-suspended' | 'rejects' | 'pending'

/** Follows AudioBufferSourceNode rules: one start, no stop before start, and stop ends asynchronously. */
class Source extends EventTarget {
  buffer: unknown = null
  connect = vi.fn()
  disconnect = vi.fn()
  private phase: 'idle' | 'playing' | 'ended' = 'idle'

  get started(): boolean { return this.phase !== 'idle' }

  start(_when = 0): void {
    if (this.phase !== 'idle') throw new DOMException('start() may only be called once', 'InvalidStateError')
    this.phase = 'playing'
  }

  stop(_when = 0): void {
    if (this.phase === 'idle') throw new DOMException('stop() before start()', 'InvalidStateError')
    if (this.phase === 'ended') return
    this.phase = 'ended'
    queueMicrotask(() => this.dispatchEvent(new Event('ended')))
  }

  /** The buffer reached its natural end. */
  finishPlayback(): void {
    if (this.phase !== 'playing') throw new Error('Only a playing source can finish')
    this.phase = 'ended'
    this.dispatchEvent(new Event('ended'))
  }
}

/** Starts suspended like a real context; resume() changes state only when the browser grants playback. */
class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = {}
  readonly sources: Source[] = []
  private readonly pendingResumes: (() => void)[] = []
  readonly resume = vi.fn(async (): Promise<void> => {
    await Promise.resolve()
    if (this.resumeOutcome === 'rejects') throw new DOMException('Autoplay denied', 'NotAllowedError')
    if (this.resumeOutcome === 'pending') return new Promise<void>(resolve => this.pendingResumes.push(resolve))
    if (this.resumeOutcome === 'granted') this.state = 'running'
  })

  /** A later user gesture finally grants playback to every still-pending resume(). */
  gestureGrantsPendingResumes(): void {
    if (this.pendingResumes.length > 0) this.state = 'running'
    for (const resolve of this.pendingResumes.splice(0)) resolve()
  }

  constructor(private readonly resumeOutcome: ResumeOutcome = 'granted') {}

  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => ({ duration: 2 }))
  createBufferSource(): Source { const source = new Source(); this.sources.push(source); return source }
  createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() } }
}

let sources: Source[]
let ctx: FakeAudioContext
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

beforeEach(() => {
  ctx = new FakeAudioContext()
  sources = ctx.sources
  vi.stubGlobal('window', { AudioContext: class { constructor() { return ctx } } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  vi.spyOn(Date, 'now').mockReturnValue(10000)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
    sources[0].finishPlayback()
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
    for (const source of sources.slice(0, count - 1)) source.finishPlayback()
    await flush()
    expect(completed).toBe(false)
    sources[count - 1].finishPlayback()
    expect(await alarm).toBe(true)
    expect(completed).toBe(true)
  })

  it('drops Follow and the town alarm without starting audio when the browser keeps autoplay suspended', async () => {
    // A cue more than half a second late no longer matches its event; it must be dropped by then.
    const LATE_CUE_MS = 500
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (const [resumeOutcome, resumeSettles] of [['stays-suspended', true], ['rejects', true], ['pending', false]] as const) {
      ctx = new FakeAudioContext(resumeOutcome)
      sources = ctx.sources
      const manager = managerFixture()
      await manager.preload()

      const finished = vi.fn()
      manager.playCareerMissionVoice('roman', 'follow', finished)
      const alarmPlayed = vi.fn()
      void manager.playTownAlarm(true).then(alarmPlayed)
      await flush()
      expect(vi.getTimerCount() > 0, 'only a still-pending resume() keeps its drop timer armed').toBe(!resumeSettles)
      await vi.advanceTimersByTimeAsync(LATE_CUE_MS)

      expect(ctx.resume).toHaveBeenCalled()
      expect(ctx.state).toBe('suspended')
      expect(finished).toHaveBeenCalledExactlyOnceWith()
      expect(alarmPlayed).toHaveBeenCalledExactlyOnceWith(false)

      // A gesture that finally grants the old resume() must not start the dropped cues.
      ctx.gestureGrantsPendingResumes()
      await flush()
      expect(sources.filter(source => source.started)).toEqual([])
      expect(finished).toHaveBeenCalledTimes(1)
      expect(alarmPlayed).toHaveBeenCalledTimes(1)
    }
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
