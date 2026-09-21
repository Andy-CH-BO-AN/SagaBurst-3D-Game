/**
 * SoundManager.ts
 * Runtime playback for the SagaBurst Audio Pack V3.
 */

export type AudioFaction = 'roman' | 'viking'
export type AudioCommand = 'attack' | 'defend' | 'formation' | 'charge'

export interface HorseGallopCandidate {
  id: object
  active: boolean
  lod: number
  distance: number
  isPlayer: boolean
}

const REDUCED_BATTLE_SFX_VOLUME = 0.03
const BOW_RELEASE_VOLUME = 0.2
const MAX_BOW_RELEASE_VOICES = 6
const MAX_NPC_GALLOP_VOICES = 8
const MAX_BATTLE_IMPACT_VOICES = 16

type AudioAsset =
  | 'swordHit'
  | 'projectileImpact'
  | 'bowRelease'
  | 'lanceImpact'
  | 'horseImpact'
  | 'horseGallop'
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
  private readonly buffers = new Map<AudioAsset, AudioBuffer>()
  private readonly loading = new Map<AudioAsset, Promise<AudioBuffer | null>>()
  private readonly gallopWanted = new Map<object, boolean>()
  private readonly gallopLoops = new Map<object, GallopLoop>()
  private gallopLoadPending = false
  private readonly bowReleaseVoices: BowReleaseVoice[] = []
  private bowReleaseSequence = 0
  private readonly battleImpactVoices: BattleImpactVoice[] = []
  private battleImpactSequence = 0

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

  private _init(): AudioContext {
    this.unlockAudio()
    if (!this.ctx) throw new Error('AudioContext unavailable')
    return this.ctx
  }

  private async _load(asset: AudioAsset): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(asset)
    if (existing) return existing
    const pending = this.loading.get(asset)
    if (pending) return pending

    const request = (async (): Promise<AudioBuffer | null> => {
      try {
        const ctx = this._init()
        const response = await fetch(ASSETS[asset])
        if (!response.ok) throw new Error(`Cannot load audio asset ${ASSETS[asset]}`)
        const data = await response.arrayBuffer()
        const buffer = await ctx.decodeAudioData(data)
        this.buffers.set(asset, buffer)
        return buffer
      } catch {
        return null
      } finally {
        this.loading.delete(asset)
      }
    })()
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

  private _startOneShot(buffer: AudioBuffer, volume = 1): AudioBufferSourceNode | null {
    try {
      const ctx = this._init()
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      gain.gain.value = volume
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start()
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
