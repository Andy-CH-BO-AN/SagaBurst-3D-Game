import { withMissionCheckpoint } from '../helpers/missionCheckpoint'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundManager } from '../../src/audio/SoundManager'
import * as THREE from 'three'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { townRoster } from '../../src/town/TownRules'

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

const careerRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('sagaburst_voice_pack_v1'))

describe('Lazy Career audio runtime', () => {
  it('finishes Follow only on the actual audio end event', async () => {
    const faction = 'roman'
    const manager = new SoundManager()
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
    const manager = new SoundManager()
    await manager.preload()
    const finished = vi.fn()
    manager.playCareerMissionVoice('roman', 'follow', finished)
    await flush()
    manager.cancelCareerAudio()
    await flush()
    expect(finished).not.toHaveBeenCalled()
  })

  it('releases the Follow completion callback if optional audio cannot play', async () => {
    const manager = new SoundManager()
    await manager.preload()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const finished = vi.fn()
    manager.playCareerMissionVoice('roman', 'follow', finished)
    await flush()
    expect(sources).toHaveLength(0)
    expect(finished).toHaveBeenCalledExactlyOnceWith()
  })

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
    await flush()
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
    for (const cue of ['missionAccepted', 'follow', 'return', 'townDefense'] as const) {
      manager.playCareerMissionVoice(faction, cue)
      await flush()
      sources.at(-1)!.dispatchEvent(new Event('ended'))
      await flush()
    }
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
    expect(sources).toHaveLength(6)
    expect(sources[0].start).toHaveBeenCalledOnce()
    expect(sources[0].start).toHaveBeenCalledWith()
    expect(sources.slice(1).map(source => source.start.mock.calls[0][0])).toEqual([1, 2, 3, 4, 5])
    expect(careerRequests()).toHaveLength(1)
    expect(String(careerRequests()[0][0])).toContain('/sfx/town_alarm.wav')
  })

  it('keeps the six-strike alarm deduplicated until the final bell ends and cancels scheduled strikes', async () => {
    const manager = new SoundManager()
    await manager.preload()
    expect(await manager.playTownAlarm()).toBe(true)
    sources[0].dispatchEvent(new Event('ended'))
    vi.mocked(Date.now).mockReturnValue(20000)
    expect(await manager.playTownAlarm()).toBe(false)
    expect(sources).toHaveLength(6)
    manager.cancelCareerAudio()
    expect(sources.every(source => source.stop.mock.calls.length === 1)).toBe(true)
    expect(sources.every(source => source.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('resolves the commander wait only after all six bells finish', async () => {
    const manager = new SoundManager()
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

  it('releases the alarm completion wait without warning when the scene is cancelled', async () => {
    const manager = new SoundManager()
    await manager.preload()
    const alarm = manager.playTownAlarm(true)
    await flush()
    manager.cancelCareerAudio()
    expect(await alarm).toBe(false)
    expect(sources.every(source => source.stop.mock.calls.length === 1)).toBe(true)
  })

  it('serializes acceptance and immediate next-frame Follow at the real Sergeant/Captain positions', async () => {
    const manager = new SoundManager()
    await manager.preload()
    const roster = townRoster()
    const captain = roster.find(actor => actor.role === 'captain')!
    const sergeant = roster.find(actor => actor.role === 'deployment')!
    const leader = { dead: false, combatPosition: new THREE.Vector3(captain.x, 0, captain.z) }
    const position = new THREE.Vector3(sergeant.x, 0, sergeant.z)
    expect(position.distanceTo(leader.combatPosition)).toBeCloseTo(9)
    let profile = createCareerProfile('roman')
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    const mission = withMissionCheckpoint(Object.create(BanditMissionController.prototype)) as any
    Object.assign(mission, {
      readProfile: () => profile, commit: (next: typeof profile) => { profile = next; return true },
      player: () => ({ combatPosition: position }), leader, friendlies: [leader],
      camps: [{ center: new THREE.Vector3(150, 0, 150), ambient: [], mission: [] }],
      route: [], routeIndex: 0, perceptionElapsed: 0, tracker: null,
      guide: { update: vi.fn() }, detectCampProximity: vi.fn(), persistRuntimeProgress: vi.fn(),
      advanceRoute: vi.fn(), assignLeader: vi.fn(), assignFollowers: vi.fn(),
      marchTarget: () => new THREE.Vector3(150, 0, 150),
      onMarchStarted: () => manager.playCareerMissionVoice('roman', 'follow'),
    })
    let acceptLoaded!: (response: any) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { acceptLoaded = resolve }))
    manager.playCareerMissionVoice('roman', 'missionAccepted')
    mission.updateFlow(.016, 0)
    expect(profile.activeMission.phase).toBe('MARCHING') // Gameplay never waits for audio.
    await flush()
    expect(careerRequests()).toHaveLength(1)
    expect(String(careerRequests()[0][0])).toContain('/mission_accepted.wav')
    expect(sources).toHaveLength(0)
    acceptLoaded({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    await flush()
    expect(sources).toHaveLength(1)
    expect(careerRequests()).toHaveLength(1)
    manager.playCareerMissionVoice('roman', 'follow') // Queued copy is also deduplicated.
    sources[0].dispatchEvent(new Event('ended'))
    await flush()
    expect(sources).toHaveLength(2)
    expect(careerRequests()).toHaveLength(2)
    expect(String(careerRequests()[1][0])).toContain('/follow.wav')
  })

  it('drops pending cold loads and queued speech when the mission scope changes', async () => {
    const manager = new SoundManager()
    await manager.preload()
    let loaded!: (response: any) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { loaded = resolve }))
    manager.playCareerMissionVoice('roman', 'missionAccepted')
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    manager.cancelCareerAudio()
    manager.playCareerMissionVoice('viking', 'return')
    await flush()
    expect(sources).toHaveLength(1)
    loaded({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    await flush()
    expect(sources).toHaveLength(1)
    expect(careerRequests().some(([url]) => String(url).includes('/follow.wav'))).toBe(false)
  })

  it('stops active speech and discards its queued successor on cancellation', async () => {
    const manager = new SoundManager()
    await manager.preload()
    manager.playCareerMissionVoice('roman', 'missionAccepted')
    manager.playCareerMissionVoice('roman', 'follow')
    await flush()
    manager.cancelCareerAudio()
    await flush()
    expect(sources[0].stop).toHaveBeenCalledOnce()
    expect(sources).toHaveLength(1)
    expect(careerRequests()).toHaveLength(1)
  })

  it('recovers a cached clip on the next successful resume without another fetch', async () => {
    const manager = new SoundManager()
    await manager.preload()
    expect(await manager.playTownAlarm()).toBe(true)
    sources.at(-1)!.dispatchEvent(new Event('ended'))
    vi.mocked(Date.now).mockReturnValue(12000)
    ctx.state = 'suspended'
    ctx.resume.mockRejectedValueOnce(new Error('gesture required'))
    expect(await manager.playTownAlarm()).toBe(false)
    expect(ctx.resume).toHaveBeenCalledOnce()
    expect(sources).toHaveLength(6)
    ctx.resume.mockImplementationOnce(async () => { ctx.state = 'running' })
    expect(await manager.playTownAlarm()).toBe(true)
    expect(ctx.resume).toHaveBeenCalledTimes(2)
    expect(sources).toHaveLength(12)
    expect(careerRequests()).toHaveLength(1)
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
