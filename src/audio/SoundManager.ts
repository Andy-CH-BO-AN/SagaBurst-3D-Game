/**
 * SoundManager.ts
 * Runtime playback for the V3 battle pack and lazy Career mission voice pack.
 */

import { publicAssetUrl } from '../assets/publicAssetUrl'

export type AudioFaction = 'roman' | 'viking'
export type CareerMissionVoiceCue = 'missionAccepted' | 'follow' | 'return' | 'dismiss' | 'townDefense'
export type AudioCommand = 'attack' | 'defend' | 'formation' | 'charge'

export interface HorseGallopCandidate {
  id: object
  active: boolean
  lod: number
  distance: number
  isPlayer: boolean
}

export interface EagleWingbeatCandidate extends HorseGallopCandidate {
  /** Monotonic count supplied by the actual animated downstroke, never frame count. */
  sequence: number
}

const REDUCED_BATTLE_SFX_VOLUME = 0.03
const BOW_RELEASE_VOLUME = 0.2
const MAX_BOW_RELEASE_VOICES = 6
const MAX_NPC_GALLOP_VOICES = 8
const EAGLE_WINGBEAT = { volume: 0.5, nearDistance: 12, farDistance: 140, maxNpcVoices: 8 } as const
const MAX_BATTLE_IMPACT_VOICES = 16
const TOWN_ALARM_STRIKES = 6
const TOWN_ALARM_INTERVAL_SECONDS = 1

type AudioAsset =
  | 'swordHit'
  | 'projectileImpact'
  | 'bowRelease'
  | 'lanceImpact'
  | 'horseImpact'
  | 'horseGallop'
  | 'eagleWingbeat'
  | 'romanAttack'
  | 'romanDefend'
  | 'romanFormation'
  | 'romanCharge'
  | 'vikingAttack'
  | 'vikingDefend'
  | 'vikingFormation'
  | 'vikingCharge'
  | 'romanHorn'
  | 'vikingHorn'

const ASSETS: Record<AudioAsset, string> = {
  swordHit: new URL('../../sagaburst_audio_pack_v3/sfx/sword_armor_hit.wav', import.meta.url).href,
  projectileImpact: new URL('../../sagaburst_audio_pack_v3/sfx/arrow_body_impact.wav', import.meta.url).href,
  bowRelease: new URL('../../sagaburst_audio_pack_v3/sfx/bow_release_hit.wav', import.meta.url).href,
  lanceImpact: new URL('../../sagaburst_audio_pack_v3/sfx/lance_impact.wav', import.meta.url).href,
  horseImpact: new URL('../../sagaburst_audio_pack_v3/sfx/horse_impact.wav', import.meta.url).href,
  horseGallop: new URL('../../sagaburst_audio_pack_v3/sfx/horse_gallop.wav', import.meta.url).href,
  eagleWingbeat: new URL('./assets/xongkoro_wingbeat_trimmed.wav', import.meta.url).href,
  romanAttack: new URL('../../sagaburst_audio_pack_v3/commands/roman/attack.wav', import.meta.url).href,
  romanDefend: new URL('../../sagaburst_audio_pack_v3/commands/roman/defend.wav', import.meta.url).href,
  romanFormation: new URL('../../sagaburst_audio_pack_v3/commands/roman/formation.wav', import.meta.url).href,
  romanCharge: new URL('../../sagaburst_audio_pack_v3/commands/roman/charge.wav', import.meta.url).href,
  vikingAttack: new URL('../../sagaburst_audio_pack_v3/commands/viking/attack.wav', import.meta.url).href,
  vikingDefend: new URL('../../sagaburst_audio_pack_v3/commands/viking/defend.wav', import.meta.url).href,
  vikingFormation: new URL('../../sagaburst_audio_pack_v3/commands/viking/formation.wav', import.meta.url).href,
  vikingCharge: new URL('../../sagaburst_audio_pack_v3/commands/viking/charge.wav', import.meta.url).href,
  romanHorn: new URL('../../sagaburst_audio_pack_v3/horns/roman_charge.wav', import.meta.url).href,
  vikingHorn: new URL('../../sagaburst_audio_pack_v3/horns/viking_charge.wav', import.meta.url).href,
}

// Kept separate from ASSETS: non-Career scenes never preload this pack.
const CAREER_ASSETS = {
  // Optional future recordings: public URLs permit adding files without command changes.
  'roman:dismiss': publicAssetUrl('audio/career/roman/dismiss.wav'),
  'viking:dismiss': publicAssetUrl('audio/career/viking/dismiss.wav'),
  'roman:missionAccepted': new URL('../../sagaburst_voice_pack_v1/mission/roman/mission_accepted.wav', import.meta.url).href,
  'roman:follow': new URL('../../sagaburst_voice_pack_v1/mission/roman/follow.wav', import.meta.url).href,
  'roman:return': new URL('../../sagaburst_voice_pack_v1/mission/roman/return.wav', import.meta.url).href,
  'roman:townDefense': new URL('../../sagaburst_voice_pack_v1/mission/roman/town_defense.wav', import.meta.url).href,
  'viking:missionAccepted': new URL('../../sagaburst_voice_pack_v1/mission/viking/mission_accepted.wav', import.meta.url).href,
  'viking:follow': new URL('../../sagaburst_voice_pack_v1/mission/viking/follow.wav', import.meta.url).href,
  'viking:return': new URL('../../sagaburst_voice_pack_v1/mission/viking/return.wav', import.meta.url).href,
  'viking:townDefense': new URL('../../sagaburst_voice_pack_v1/mission/viking/town_defense.wav', import.meta.url).href,
  townAlarm: new URL('../../sagaburst_voice_pack_v1/sfx/town_alarm.wav', import.meta.url).href,
} as const
type CareerAudioAsset = keyof typeof CAREER_ASSETS
type PlaybackAsset = AudioAsset | CareerAudioAsset

interface GallopLoop {
  source: AudioBufferSourceNode
  gain: GainNode
}

interface BowReleaseVoice {
  source: AudioBufferSourceNode
  isPlayer: boolean
  distance: number
  sequence: number
}

interface BattleImpactVoice {
  source: AudioBufferSourceNode
  priority: boolean
  sequence: number
}

export class SoundManager {
  private ctx: AudioContext | null = null
  private readonly buffers = new Map<PlaybackAsset, AudioBuffer>()
  private readonly loading = new Map<PlaybackAsset, Promise<AudioBuffer | null>>()
  private readonly gallopWanted = new Map<object, boolean>()
  private readonly gallopLoops = new Map<object, GallopLoop>()
  private gallopLoadPending = false
  private readonly wingbeatSequences = new Map<object, number>()
  private readonly wingbeatVoices = new Map<object, GallopLoop>()
  private readonly bowReleaseVoices: BowReleaseVoice[] = []
  private bowReleaseSequence = 0
  private readonly battleImpactVoices: BattleImpactVoice[] = []
  private battleImpactSequence = 0

  private readonly careerVoices = new Set<CareerAudioAsset>()
  private readonly careerLastPlayed = new Map<CareerAudioAsset, number>()
  private readonly careerSpeechPending = new Set<CareerAudioAsset>()
  private readonly careerSources = new Map<CareerAudioAsset, AudioBufferSourceNode[]>()
  private careerGeneration = 0
  private careerSpeechTail: Promise<void> = Promise.resolve()
  private finishCareerSpeech: (() => void) | null = null
  private finishTownAlarm: (() => void) | null = null

  constructor() {
    void this.preload()
  }

  /** Unlock and initialize AudioContext on a user interaction gesture. */
  unlockAudio(): void {
    try {
      if (!this.ctx && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) this.ctx = new AudioCtx()
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
    } catch {
      // Audio is optional when the browser denies autoplay or Web Audio.
    }
  }

  /** Start loading the V3 pack without changing gameplay timing. */
  async preload(): Promise<void> {
    try {
      this._init()
      await Promise.all(Object.keys(ASSETS).map((key) => this._load(key as AudioAsset)))
    } catch {
      // Individual playback remains fail-safe if Web Audio is unavailable.
    }
  }

  /** LOD0 and LOD1 are audible; LOD2 is completely silent. */
  static isAudibleAtLod(lod: number): boolean {
    return lod < 2
  }

  playBowRelease(lod = 0, isPlayer = false, distance = Number.POSITIVE_INFINITY): void {
    if (!SoundManager.isAudibleAtLod(lod)) return
    const buffer = this.buffers.get('bowRelease')
    if (buffer) {
      this._startBowRelease(buffer, isPlayer, distance)
      return
    }
    void this._load('bowRelease').then((loaded) => {
      if (loaded) this._startBowRelease(loaded, isPlayer, distance)
    })
  }

  playProjectileImpact(lod = 0, priority = false): void {
    this._playBattleImpact('projectileImpact', lod, priority)
  }

  playSwordHit(lod = 0, priority = false): void {
    this._playBattleImpact('swordHit', lod, priority)
  }

  playLanceImpact(lod = 0, priority = false): void {
    this._playBattleImpact('lanceImpact', lod, priority)
  }

  playHorseImpact(lod = 0, priority = false): void {
    this._playBattleImpact('horseImpact', lod, priority)
  }

  playLevelUp(): void {
    try {
      const ctx = this._init()
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((frequency, index) => {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        const start = ctx.currentTime + index * 0.08
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, start)
        gain.gain.setValueAtTime(0.25, start)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.3)
      })
    } catch {
      // Ignore unavailable audio contexts.
    }
  }

  /** Keep the player horse plus the nearest LOD0/LOD1 NPC gallops active. */
  updateHorseGallopLoops(candidates: HorseGallopCandidate[]): void {
    const candidateIds = new Set(candidates.map((candidate) => candidate.id))
    const eligible = candidates.filter((candidate) => {
      return candidate.active && SoundManager.isAudibleAtLod(candidate.lod)
    })
    const selected = new Set<object>()
    const playerCandidate = eligible.find((candidate) => candidate.isPlayer)
    if (playerCandidate) selected.add(playerCandidate.id)

    eligible
      .filter((candidate) => !candidate.isPlayer)
      .sort((a, b) => a.lod - b.lod || a.distance - b.distance)
      .slice(0, MAX_NPC_GALLOP_VOICES)
      .forEach((candidate) => selected.add(candidate.id))

    for (const id of this.gallopWanted.keys()) {
      if (!candidateIds.has(id)) this.gallopWanted.delete(id)
    }
    for (const candidate of candidates) {
      this.gallopWanted.set(candidate.id, selected.has(candidate.id))
    }
    for (const id of this.gallopLoops.keys()) {
      if (!selected.has(id)) this._stopGallop(id)
    }

    const buffer = this.buffers.get('horseGallop')
    if (buffer) {
      for (const id of selected) this._startGallop(id, buffer)
      return
    }
    if (selected.size === 0 || this.gallopLoadPending) return
    this.gallopLoadPending = true
    void this._load('horseGallop').then((loaded) => {
      this.gallopLoadPending = false
      if (!loaded) return
      for (const [id, wanted] of this.gallopWanted) {
        if (wanted) this._startGallop(id, loaded)
      }
    })
  }

  /** Phase-driven one-shots; inaudible crossings are discarded instead of replayed later. */
  updateEagleWingbeats(candidates: EagleWingbeatCandidate[]): void {
    const ids = new Set(candidates.map(candidate => candidate.id))
    for (const id of this.wingbeatSequences.keys()) if (!ids.has(id)) this.wingbeatSequences.delete(id)
    const eligible = candidates.filter(candidate => candidate.active && SoundManager.isAudibleAtLod(candidate.lod)
      && Number.isFinite(candidate.distance) && candidate.distance < EAGLE_WINGBEAT.farDistance)
    const selected = new Set<object>()
    const player = eligible.find(candidate => candidate.isPlayer)
    if (player) selected.add(player.id)
    eligible.filter(candidate => !candidate.isPlayer).sort((a, b) => a.distance - b.distance)
      .slice(0, EAGLE_WINGBEAT.maxNpcVoices).forEach(candidate => selected.add(candidate.id))
    for (const id of this.wingbeatVoices.keys()) if (!selected.has(id)) this._stopWingbeat(id)
    const buffer = this.buffers.get('eagleWingbeat')
    for (const candidate of candidates) {
      const previous = this.wingbeatSequences.get(candidate.id)
      this.wingbeatSequences.set(candidate.id, candidate.sequence)
      if (!selected.has(candidate.id)) continue
      const range = EAGLE_WINGBEAT.farDistance - EAGLE_WINGBEAT.nearDistance
      const attenuation = Math.max(0, 1 - Math.max(0, candidate.distance - EAGLE_WINGBEAT.nearDistance) / range)
      const volume = EAGLE_WINGBEAT.volume * attenuation * attenuation
      const playing = this.wingbeatVoices.get(candidate.id)
      if (playing) playing.gain.gain.value = volume
      if (previous === undefined || candidate.sequence <= previous) continue
      if (buffer) this._startWingbeat(candidate.id, buffer, volume)
      else void this._load('eagleWingbeat') // Wait for the next real beat after loading.
    }
  }

  private _startWingbeat(id: object, buffer: AudioBuffer, volume: number): void {
    this._stopWingbeat(id)
    try {
      const ctx = this._init(), source = ctx.createBufferSource(), gain = ctx.createGain()
      source.buffer = buffer
      gain.gain.value = volume
      source.connect(gain); gain.connect(ctx.destination)
      const voice = { source, gain }
      this.wingbeatVoices.set(id, voice)
      source.addEventListener('ended', () => {
        if (this.wingbeatVoices.get(id) === voice) this.wingbeatVoices.delete(id)
        source.disconnect(); gain.disconnect()
      }, { once: true })
      source.start()
    } catch {
      this._stopWingbeat(id)
    }
  }

  private _stopWingbeat(id: object): void {
    const voice = this.wingbeatVoices.get(id)
    if (!voice) return
    this.wingbeatVoices.delete(id)
    try { voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect() } catch {
      // An already-ended optional sound has no remaining gameplay ownership.
    }
  }

  /** Play a faction command; charge waits for the voice before starting its horn. */
  playCommanderCommand(faction: AudioFaction, command: AudioCommand): void {
    const voice = `${faction}${command[0].toUpperCase()}${command.slice(1)}` as AudioAsset
    if (command !== 'charge') {
      this._play(voice)
      return
    }

    void this._playAndWait(voice).then((played) => {
      if (played) this._play(faction === 'roman' ? 'romanHorn' : 'vikingHorn')
    })
  }

  /** One small speech channel: preserve event order without delaying mission movement. */
  playCareerMissionVoice(faction: AudioFaction, cue: CareerMissionVoiceCue, onFinished?: () => void): void {
    const asset: CareerAudioAsset = `${faction}:${cue}`
    if (this.careerSpeechPending.has(asset)) return
    const generation = this.careerGeneration
    this.careerSpeechPending.add(asset)
    const play = async () => {
      try {
        if (generation !== this.careerGeneration) return
        const source = await this._playCareerAsset(asset, generation)
        if (!source || generation !== this.careerGeneration) return
        await new Promise<void>(resolve => {
          const finish = () => {
            source.removeEventListener('ended', finish)
            if (this.finishCareerSpeech === finish) this.finishCareerSpeech = null
            resolve()
          }
          this.finishCareerSpeech = finish
          source.addEventListener('ended', finish, { once: true })
        })
      } catch {
        // Failed optional audio must not block subsequent mission speech.
      } finally {
        if (generation === this.careerGeneration) {
          this.careerSpeechPending.delete(asset)
          onFinished?.()
        }
      }
    }
    this.careerSpeechTail = this.careerSpeechTail.then(play, play)
  }

  /** Optionally wait until the sixth bell's tail ends before the commander speaks. */
  async playTownAlarm(waitForEnd = false): Promise<boolean> {
    const generation = this.careerGeneration
    const source = await this._playCareerAsset('townAlarm', generation)
    if (!source || generation !== this.careerGeneration) return false
    if (!waitForEnd) return true
    const sources = this.careerSources.get('townAlarm')!
    const last = sources[sources.length - 1]
    return new Promise<boolean>(resolve => {
      const finish = () => {
        last.removeEventListener('ended', finish)
        if (this.finishTownAlarm === finish) this.finishTownAlarm = null
        resolve(generation === this.careerGeneration)
      }
      this.finishTownAlarm = finish
      last.addEventListener('ended', finish, { once: true })
    })
  }

  /** Retain decoded buffers, but discard active/pending speech from the old mission or scene. */
  cancelCareerAudio(): void {
    this.careerGeneration++
    this.finishCareerSpeech?.()
    this.finishTownAlarm?.()
    this.careerSpeechTail = Promise.resolve()
    this.careerSpeechPending.clear()
    for (const sources of this.careerSources.values()) {
      for (const source of sources) {
        try { source.stop(); source.disconnect() } catch { /* Already ended or unavailable. */ }
      }
    }
    this.careerSources.clear()
    this.careerVoices.clear()
    this.careerLastPlayed.clear()
  }

  private async ensureCareerAudioRunning(): Promise<boolean> {
    try {
      if (!this.ctx) this.unlockAudio()
      const ctx = this.ctx
      if (!ctx) return false
      if (ctx.state === 'suspended') await ctx.resume()
      return ctx.state === 'running'
    } catch {
      return false
    }
  }

  private async _playCareerAsset(asset: CareerAudioAsset, generation = this.careerGeneration): Promise<AudioBufferSourceNode | null> {
    const now = Date.now()
    if (this.careerVoices.has(asset) || now - (this.careerLastPlayed.get(asset) ?? -Infinity) < 1000) return null
    this.careerVoices.add(asset)
    let started = false
    try {
      const buffer = await this._load(asset)
      // Cached buffers need resume too. Denied audio is dropped, not saved for later autoplay.
      if (!buffer || generation !== this.careerGeneration || !await this.ensureCareerAudioRunning()) return null
      if (generation !== this.careerGeneration) return null
      const sources = this.startCareerSources(asset, buffer)
      if (!sources) return null
      started = true
      this.careerLastPlayed.set(asset, Date.now())
      this.careerSources.set(asset, sources)
      sources[sources.length - 1].addEventListener('ended', () => {
        if (this.careerSources.get(asset) === sources) {
          this.careerSources.delete(asset)
          this.careerVoices.delete(asset)
        }
      }, { once: true })
      return sources[0]
    } catch {
      return null
    } finally {
      if (!started && generation === this.careerGeneration) this.careerVoices.delete(asset)
    }
  }

  private startCareerSources(asset: CareerAudioAsset, buffer: AudioBuffer): AudioBufferSourceNode[] | null {
    const sources: AudioBufferSourceNode[] = []
    const count = asset === 'townAlarm' ? TOWN_ALARM_STRIKES : 1
    for (let strike = 0; strike < count; strike++) {
      // Preserve each bell's decay while scheduling six urgent, evenly spaced strikes.
      const source = this._startOneShot(buffer, 1, strike * TOWN_ALARM_INTERVAL_SECONDS)
      if (!source) {
        for (const started of sources) {
          try { started.stop(); started.disconnect() } catch { /* Optional audio. */ }
        }
        return null
      }
      sources.push(source)
    }
    return sources
  }

  private _init(): AudioContext {
    this.unlockAudio()
    if (!this.ctx) throw new Error('AudioContext unavailable')
    return this.ctx
  }

  private async _load(asset: PlaybackAsset): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(asset)
    if (existing) return existing
    const pending = this.loading.get(asset)
    if (pending) return pending

    const request = (async (): Promise<AudioBuffer | null> => {
      try {
        const ctx = this._init()
        const url = asset in CAREER_ASSETS ? CAREER_ASSETS[asset as CareerAudioAsset] : ASSETS[asset as AudioAsset]
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Cannot load audio asset ${url}`)
        const data = await response.arrayBuffer()
        const buffer = await ctx.decodeAudioData(data)
        this.buffers.set(asset, buffer)
        return buffer
      } catch {
        return null
      }
    })().finally(() => this.loading.delete(asset))
    this.loading.set(asset, request)
    return request
  }

  private _play(asset: AudioAsset, lod = 0, volume = 1): void {
    if (!SoundManager.isAudibleAtLod(lod)) return
    const buffer = this.buffers.get(asset)
    if (buffer) {
      this._startOneShot(buffer, volume)
      return
    }
    void this._load(asset).then((loaded) => {
      if (loaded) this._startOneShot(loaded, volume)
    })
  }

  private _playBattleImpact(
    asset: 'projectileImpact' | 'swordHit' | 'lanceImpact' | 'horseImpact',
    lod: number,
    priority: boolean,
  ): void {
    if (!SoundManager.isAudibleAtLod(lod)) return
    const buffer = this.buffers.get(asset)
    if (buffer) {
      this._startBattleImpact(buffer, priority)
      return
    }
    void this._load(asset).then((loaded) => {
      if (loaded) this._startBattleImpact(loaded, priority)
    })
  }

  private _startBowRelease(buffer: AudioBuffer, isPlayer: boolean, distance: number): void {
    if (this.bowReleaseVoices.length >= MAX_BOW_RELEASE_VOICES) {
      const victim = this._selectBowReleaseVictim(isPlayer, distance)
      if (!victim) return
      this._stopBowReleaseVoice(victim)
    }

    const source = this._startOneShot(buffer, BOW_RELEASE_VOLUME)
    if (!source) return
    const voice: BowReleaseVoice = {
      source,
      isPlayer,
      distance,
      sequence: this.bowReleaseSequence++,
    }
    this.bowReleaseVoices.push(voice)
    source.addEventListener('ended', () => {
      const index = this.bowReleaseVoices.indexOf(voice)
      if (index >= 0) this.bowReleaseVoices.splice(index, 1)
    }, { once: true })
  }

  private _selectBowReleaseVictim(isPlayer: boolean, distance: number): BowReleaseVoice | null {
    const npcVoices = this.bowReleaseVoices
      .filter((voice) => !voice.isPlayer)
      .sort((a, b) => b.distance - a.distance || a.sequence - b.sequence)
    if (isPlayer) return npcVoices[0] ?? [...this.bowReleaseVoices].sort((a, b) => a.sequence - b.sequence)[0] ?? null
    const farthestNpc = npcVoices[0]
    if (!farthestNpc || farthestNpc.distance < distance) return null
    return farthestNpc
  }

  private _stopBowReleaseVoice(voice: BowReleaseVoice): void {
    const index = this.bowReleaseVoices.indexOf(voice)
    if (index >= 0) this.bowReleaseVoices.splice(index, 1)
    try {
      voice.source.stop()
      voice.source.disconnect()
    } catch {
      // A finished source is already safe to discard.
    }
  }

  private _startBattleImpact(buffer: AudioBuffer, priority: boolean): void {
    if (this.battleImpactVoices.length >= MAX_BATTLE_IMPACT_VOICES) {
      if (!priority) return
      const victim = this.battleImpactVoices.find((voice) => !voice.priority)
      if (!victim) return
      this._stopBattleImpactVoice(victim)
    }

    const source = this._startOneShot(buffer, REDUCED_BATTLE_SFX_VOLUME)
    if (!source) return
    const voice: BattleImpactVoice = {
      source,
      priority,
      sequence: this.battleImpactSequence++,
    }
    this.battleImpactVoices.push(voice)
    source.addEventListener('ended', () => {
      const index = this.battleImpactVoices.indexOf(voice)
      if (index >= 0) this.battleImpactVoices.splice(index, 1)
    }, { once: true })
  }

  private _stopBattleImpactVoice(voice: BattleImpactVoice): void {
    const index = this.battleImpactVoices.indexOf(voice)
    if (index >= 0) this.battleImpactVoices.splice(index, 1)
    try {
      voice.source.stop()
      voice.source.disconnect()
    } catch {
      // A finished source is already safe to discard.
    }
  }

  private async _playAndWait(asset: AudioAsset): Promise<boolean> {
    const buffer = this.buffers.get(asset) ?? await this._load(asset)
    if (!buffer) return false
    const source = this._startOneShot(buffer)
    if (!source) return false
    await new Promise<void>((resolve) => {
      source.addEventListener('ended', () => resolve(), { once: true })
    })
    return true
  }

  private _startOneShot(buffer: AudioBuffer, volume = 1, delaySeconds = 0): AudioBufferSourceNode | null {
    try {
      const ctx = this._init()
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      gain.gain.value = volume
      source.connect(gain)
      gain.connect(ctx.destination)
      if (delaySeconds > 0) source.start(ctx.currentTime + delaySeconds)
      else source.start()
      return source
    } catch {
      return null
    }
  }

  private _startGallop(id: object, buffer: AudioBuffer): void {
    if (this.gallopLoops.has(id) || !this.gallopWanted.get(id)) return
    try {
      const ctx = this._init()
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      source.loop = true
      gain.gain.value = REDUCED_BATTLE_SFX_VOLUME
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start()
      this.gallopLoops.set(id, { source, gain })
    } catch {
      // Ignore unavailable audio contexts.
    }
  }

  private _stopGallop(id: object): void {
    const loop = this.gallopLoops.get(id)
    if (!loop) return
    try {
      loop.source.stop()
      loop.source.disconnect()
      loop.gain.disconnect()
    } catch {
      // A stopped source is already safe to discard.
    }
    this.gallopLoops.delete(id)
  }
}
