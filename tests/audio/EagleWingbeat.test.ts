import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WingbeatPhaseTracker } from '../../src/audio/WingbeatPhase'
import { SoundManager, type EagleWingbeatCandidate } from '../../src/audio/SoundManager'

describe('Animated eagle downstroke phase', () => {
  it('emits once per downstroke crossing including loop wrap, independently for each instance', () => {
    const first = new WingbeatPhaseTracker(), second = new WingbeatPhaseTracker()
    for (const phase of [0, .02, .04, .06, .06, .3, .7, .98, .02, .06]) first.sample(phase, true)
    for (const phase of [.3, .7, .98, .02]) second.sample(phase, true)
    expect(first.sequence).toBe(2)
    expect(second.sequence).toBe(0)
    second.sample(.08, true)
    expect(second.sequence).toBe(1)
  })

  it('does not count standing, dead, or newly resumed mid-cycle poses as wingbeats', () => {
    const phase = new WingbeatPhaseTracker()
    for (const value of [0, .1, .7, .02, .08]) phase.sample(value, false)
    phase.sample(.3, true); phase.sample(.4, true)
    expect(phase.sequence).toBe(0)
    phase.sample(.98, true); phase.sample(.1, true)
    expect(phase.sequence).toBe(1)
    phase.sample(Number.NaN, true); phase.sample(.2, true)
    expect(phase.sequence).toBe(1)
  })
})

class Source extends EventTarget {
  buffer: unknown
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn(() => this.dispatchEvent(new Event('ended')))
  disconnect = vi.fn()
}
interface Gain { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
let sources: Source[], gains: Gain[]
let manager: SoundManager | undefined
const candidate = (id = {}, extra: Partial<EagleWingbeatCandidate> = {}): EagleWingbeatCandidate => ({
  id, active: true, lod: 0, distance: 12, isPlayer: false, sequence: 0, ...extra,
})

beforeEach(() => {
  sources = []; gains = []
  const context = {
    state: 'running', currentTime: 0, destination: {}, resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: .66 })),
    createBufferSource: () => { const source = new Source(); sources.push(source); return source },
    createGain: () => { const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(gain); return gain },
  }
  vi.stubGlobal('window', { AudioContext: class { constructor() { return context } } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
})
afterEach(() => { manager?.updateEagleWingbeats([]); manager = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Eagle wingbeat Web Audio ownership', () => {
  it('plays one bounded source per actual instance beat, never once per frame', async () => {
    manager = new SoundManager(); await manager.preload()
    const a = candidate(), b = candidate()
    manager.updateEagleWingbeats([a, b])
    a.sequence++; b.sequence++
    manager.updateEagleWingbeats([a, b])
    expect(sources).toHaveLength(2)
    for (let frame = 0; frame < 30; frame++) manager.updateEagleWingbeats([a, b])
    expect(sources).toHaveLength(2)
    a.sequence++
    manager.updateEagleWingbeats([a, b])
    expect(sources).toHaveLength(3)
    expect(sources[0].stop).toHaveBeenCalledOnce()
    expect(sources[1].stop).not.toHaveBeenCalled()
    sources[2].dispatchEvent(new Event('ended'))
    expect(sources[2].disconnect).toHaveBeenCalled()
    expect(gains[2].disconnect).toHaveBeenCalled()
  })

  it('attenuates by world distance and discards inaudible LOD/range beats without catch-up', async () => {
    manager = new SoundManager(); await manager.preload()
    const near = candidate(), middle = candidate({}, { distance: 76 }), far = candidate({}, { distance: 140 }), lod2 = candidate({}, { lod: 2 })
    const candidates = [near, middle, far, lod2]
    manager.updateEagleWingbeats(candidates)
    candidates.forEach(item => item.sequence++)
    manager.updateEagleWingbeats(candidates)
    expect(sources).toHaveLength(2)
    expect(gains[0].gain.value).toBeCloseTo(.03)
    expect(gains[1].gain.value).toBeCloseTo(.0075)
    far.distance = 12; lod2.lod = 0
    manager.updateEagleWingbeats(candidates)
    expect(sources).toHaveLength(2)
    far.sequence++; lod2.sequence++
    manager.updateEagleWingbeats(candidates)
    expect(sources).toHaveLength(4)
    near.distance = 140
    manager.updateEagleWingbeats(candidates)
    expect(sources[0].stop).toHaveBeenCalledOnce()
  })

  it('stops a standing/dead eagle immediately and clears old-scene sounds', async () => {
    manager = new SoundManager(); await manager.preload()
    const a = candidate(), b = candidate()
    manager.updateEagleWingbeats([a, b]); a.sequence++; b.sequence++
    manager.updateEagleWingbeats([a, b])
    a.active = false
    manager.updateEagleWingbeats([a, b])
    expect(sources[0].stop).toHaveBeenCalledOnce()
    expect(sources[1].stop).not.toHaveBeenCalled()
    manager.updateEagleWingbeats([])
    expect(sources[1].stop).toHaveBeenCalledOnce()
    a.active = true
    manager.updateEagleWingbeats([a])
    expect(sources).toHaveLength(2)
  })

  it('keeps the nearest eight NPC voices plus the player without changing animation state', async () => {
    manager = new SoundManager(); await manager.preload()
    // Data-only candidates: no actors, mounts, GLBs or world.
    const npcs = Array.from({ length: 9 }, (_, index) => candidate({}, { distance: 10 + index }))
    const player = candidate({}, { isPlayer: true, distance: 70 })
    const candidates = [...npcs, player]
    manager.updateEagleWingbeats(candidates); candidates.forEach(item => item.sequence++)
    manager.updateEagleWingbeats(candidates)
    expect(sources).toHaveLength(9)
    expect(gains.at(-1)?.gain.value).toBeGreaterThan(0)
    npcs[8].sequence++ // The excluded farthest NPC must not evict a selected voice.
    manager.updateEagleWingbeats(candidates)
    expect(sources).toHaveLength(9)
    expect(npcs[8].sequence).toBe(2)
  })

  it('never replays a pending sound after landing or delayed file loading', async () => {
    let resolveAudio!: (value: Response) => void
    const delayed = new Promise<Response>(resolve => { resolveAudio = resolve })
    vi.mocked(fetch).mockImplementation(url => String(url).includes('xongkoro_wingbeat') ? delayed
      : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response))
    manager = new SoundManager()
    const preload = manager.preload(), eagle = candidate()
    manager.updateEagleWingbeats([eagle]); eagle.sequence++
    manager.updateEagleWingbeats([eagle]); manager.updateEagleWingbeats([])
    resolveAudio({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response)
    await preload
    expect(sources).toHaveLength(0)
    manager.updateEagleWingbeats([eagle]); eagle.sequence++
    manager.updateEagleWingbeats([eagle])
    expect(sources).toHaveLength(1)
  })
})
