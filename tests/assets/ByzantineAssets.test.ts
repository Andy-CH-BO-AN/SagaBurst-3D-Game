import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { AssetLoadTimeout, OnDemandAssets } from '../../src/assets/OnDemandAssets'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { parsePunchTiming, resolveHumanoidAssetId, type HumanoidAssetManifest } from '../../src/world/HumanoidAssetRegistry'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import { FACTION_SHIELD_BANDS } from '../../src/combat/FactionShieldGeometry'
import { BYZANTINE_EQUIPMENT_ASSETS, HIGH_TIER_WEAPON_ASSETS, prepareByzantineEquipment } from '../../src/world/HighTierEquipment'
import { persistsDuelTravel } from '../../src/career/CareerDuelController'
import { duelFightBannerVisible, duelCombatSeconds } from '../../src/career/CareerDuelState'
import * as THREE from 'three'
import { curlHandPoint, MITTEN_GRIP, MITTEN_HOLLOW } from '../../src/world/MittenHandShape'
import { bannerRollAngle } from '../../src/world/WeaponMeshFactory'
import { barrelHalfWidth, MOUNT_BARREL, MOUNT_SADDLE_FLAP, solveSeatedLeg } from '../../src/world/MountedLegFit'

const dir = 'public/models/characters/v2/byzantine-cataphract-t5'
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as HumanoidAssetManifest & { fileSha256: Record<string, string> }

describe('Byzantine GLB integration (manifest and files only; no GLB parsing)', () => {
  it('has a real asset per LOD and no longer aliases the Roman T5 visual', () => {
    for (const file of Object.values(manifest.files!)) {
      const bytes = readFileSync(`${dir}/${file}`)
      expect(bytes.subarray(0, 4).toString()).toBe('glTF')
      expect(bytes.length).toBeGreaterThan(1_000_000)
    }
    expect(HERO_ASSETS['byzantine-cataphract-t5'].descriptor.assetId).toBe('byzantine-cataphract-t5')
    expect(HERO_ASSETS['byzantine-cataphract-t5'].nameZh).not.toContain('暫用')
    expect(resolveHumanoidAssetId({ faction: 'roman', tier: 3, isPlayer: true }, 'byzantine-cataphract-t5')).toBe('byzantine-cataphract-t5')
  })
  it('descriptor equals the measured manifest, so manifest validation passes', () => {
    const d = HERO_ASSETS['byzantine-cataphract-t5'].descriptor
    expect(Math.abs(manifest.metrics!.heightM - d.heightM)).toBeLessThan(.02)
    expect(manifest.metrics!.shoulderWidthM).toBeLessThanOrEqual(d.maxShoulderWidthM + .01)
    expect(Math.abs(manifest.metrics!.neckLengthM - d.neckLengthM)).toBeLessThan(.015)
    expect(manifest.id).toBe(d.assetId)
  })
  it('ships every clip the registry requires plus both punch clips', () => {
    const names = manifest.animations!.embedded.map(b => b.clip)
    for (const clip of ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'swordSlash', 'pilumThrow', 'axeAttack1H', 'axeAttack2H', 'punchCombo', 'punchRight']) expect(names).toContain(clip)
  })
  it('Punch_Combo_1 keeps its 2.2 s take and four ascending contacts alternating L/R/L/R', () => {
    const combo = manifest.animations!.embedded.find(b => b.clip === 'punchCombo')!
    expect(combo.duration).toBeCloseTo(2.2, 2)
    const timing = parsePunchTiming(combo)!
    expect(timing.contacts.map(c => c.hand)).toEqual(['left', 'right', 'left', 'right'])
    expect(timing.contacts.map(c => +c.time.toFixed(2))).toEqual([.6, .88, 1.1, 1.37])
    expect(combo.sourceClip).toBe('Punch_Combo_1')
  })
  it('shield stance punches are right fist only', () => {
    const timing = parsePunchTiming(manifest.animations!.embedded.find(b => b.clip === 'punchRight')!)!
    expect(timing.contacts).toHaveLength(4)
    expect(new Set(timing.contacts.map(c => c.hand))).toEqual(new Set(['right']))
  })
  it('rejects malformed punch timelines', () => {
    const base = { clip: 'punchCombo' as const, source: 'Meshy' as const, sourceClip: 'x', loop: false, duration: 1, punchHands: ['left', 'right'] as ('left' | 'right')[] }
    expect(() => parsePunchTiming({ ...base, events: { punch0: .5, punch1: .4 } })).toThrow()
    expect(() => parsePunchTiming({ ...base, events: { punch0: .2, punch1: 1.2 } })).toThrow()
    expect(parsePunchTiming({ ...base, punchHands: undefined })).toBeUndefined()
  })
})

describe('Byzantine equipment models', () => {
  it('lance: 3.3 m visible, grips unchanged, gameplay stats and reach untouched', () => {
    const [record] = JSON.parse(readFileSync('public/models/weapons/byzantine/sources.json', 'utf8'))
    expect(record.boundsMax[1] - record.boundsMin[1]).toBeCloseTo(3.3, 2)
    expect(record.gripCenterLocal).toEqual([0, .15, 0])
    expect(existsSync(`public/${BYZANTINE_EQUIPMENT_ASSETS.byzantine_standard_lance_t5}`)).toBe(true)
    const w = WEAPONS.byzantine_standard_lance_t5
    expect([w.damageMin, w.meleeCycleSeconds, w.range, w.tier]).toEqual([105, .42, 3.9, 5])
    expect(WEAPONS.spear_t5.range).not.toBe(record.boundsMax[1] - record.boundsMin[1])
  })
  it('eagle shield: own GLB, own measured collider bands, Impact 128, other T5 shields unchanged', () => {
    expect(existsSync(`public/${BYZANTINE_EQUIPMENT_ASSETS.byzantine_eagle_shield_t5}`)).toBe(true)
    const bands = FACTION_SHIELD_BANDS.byzantine_eagle_shield_t5
    expect(bands.length).toBeGreaterThan(20)
    for (const [bottom, top, half, back, front] of bands) { expect(top).toBeGreaterThan(bottom); expect(half).toBeGreaterThan(0); expect(front).toBeGreaterThan(back) }
    expect(ARMORS.byzantine_eagle_shield_t5.shieldImpactMax).toBe(128)
    expect(ARMORS.viking_berserker_shield_t5.shieldImpactMax).toBe(96)
  })
})

describe('Duel review fixes', () => {
  it('unarmed duels persist their travel checkpoint like T5 and tutorial duels; armed T1-T4 do not', () => {
    expect(persistsDuelTravel({ duelMode: 'unarmed', duelTier: 2 })).toBe(true)
    expect(persistsDuelTravel({ duelMode: 'unarmed', duelTier: 5 })).toBe(true)
    expect(persistsDuelTravel({ duelTier: 5 })).toBe(true)
    expect(persistsDuelTravel({ duelTutorialCareerId: 'x' })).toBe(true)
    expect(persistsDuelTravel({ duelTier: 3 })).toBe(false)
    expect(persistsDuelTravel({ duelMode: 'armed', duelTier: 4 })).toBe(false)
  })
  it('FIGHT banner covers one second of live combat for both 30 s and 90 s duels', () => {
    expect(duelFightBannerVisible(0)).toBe(true)
    expect(duelFightBannerVisible(.99)).toBe(true)
    expect(duelFightBannerVisible(1)).toBe(false)
    expect(duelFightBannerVisible(60)).toBe(false)
    expect(duelCombatSeconds('unarmed')).toBe(90)
    expect(duelCombatSeconds(undefined)).toBe(30)
  })
})

describe('Byzantine hands, banner and seat', () => {
  it('grip wraps the fingers around the shaft centre; the empty hand stays open; the palm does not move', () => {
    const knuckle = .1, centre = .036
    expect(curlHandPoint(.05, 0, 0, knuckle, centre, MITTEN_GRIP)).toMatchObject({ along: .05, height: 0, bend: 0 })
    const tip = curlHandPoint(.2, 0, 0, knuckle, centre, MITTEN_GRIP)
    expect(Math.hypot(tip.along - knuckle, tip.height - centre)).toBeCloseTo(centre) // stays on the wrap radius
    expect(tip.bend).toBeGreaterThan(2.5)
    const hollow = curlHandPoint(.2, 0, 0, knuckle, centre, MITTEN_HOLLOW)
    expect(hollow.bend).toBeGreaterThan(.5)
    expect(hollow.bend).toBeLessThan(tip.bend)
    expect(curlHandPoint(.1, .06, 0, knuckle, centre, MITTEN_GRIP).height).toBeGreaterThan(0) // thumb closes toward the palm
  })
  it('grip frames share roman-hero-t4 hand axes on the same Mixamo basis (palm/thumb not rolled)', () => {
    const t4 = JSON.parse(readFileSync('public/models/characters/v2/roman-hero-t4/manifest.json', 'utf8')).swordGripFrames.lod0
    const own = manifest.swordGripFrames!.lod0
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(own.gripAxisLocal, t4.gripAxisLocal)).toBeGreaterThan(.9)
    expect(dot(own.palmNormalLocal, t4.palmNormalLocal)).toBeGreaterThan(.9)
  })
  it('banner roll points the cloth at the ground, and keeps its last roll when the shaft is vertical', () => {
    const horizontal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    const angle = bannerRollAngle(horizontal)!
    const cloth = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).applyQuaternion(horizontal)
    expect(cloth.y).toBeCloseTo(-1)
    expect(bannerRollAngle(new THREE.Quaternion())).toBeUndefined()
  })
  it('seated Byzantine legs hug every mount: knee widest and clear, calf against the flank, knee bending one way', () => {
    const thighLength = .37, calfLength = .47 // measured bind lengths
    for (const [kind, barrel] of Object.entries(MOUNT_BARREL)) for (const side of [1, -1] as const) {
      const hip = new THREE.Vector3(side * .094, -.086, 0)
      const flap = MOUNT_SADDLE_FLAP[kind as keyof typeof MOUNT_SADDLE_FLAP]
      const leg = solveSeatedLeg(hip, thighLength, calfLength, side, barrel, flap)
      // The thigh lies over the saddle's leather flap; the white cat's widest flap stays 1.3 cm out of the knee's reach.
      if (flap) expect(side * leg.knee.x, kind).toBeGreaterThan(flap - .02)
      expect(hip.distanceTo(leg.knee), kind).toBeCloseTo(thighLength)
      expect(leg.knee.distanceTo(leg.ankle), kind).toBeCloseTo(calfLength)
      expect(leg.knee.z, kind).toBeGreaterThan(leg.ankle.z) // bends forward, never backward
      expect(side * leg.ankle.x, kind).toBeCloseTo(barrelHalfWidth(barrel, -leg.ankle.y) + .09, 1) // against the flank, not splayed
      expect(side * leg.knee.x, kind).toBeGreaterThanOrEqual(barrelHalfWidth(barrel, -leg.knee.y) + .05)
    }
    expect(manifest.animations!.embedded.some(b => b.clip === 'mounted')).toBe(true)
  })
})

describe('Optional Byzantine equipment loading', () => {
  it('stays out of the shared high-tier preload, whose failure or pending would block ordinary scenes', () => {
    const shared = new Set<string>(Object.values(HIGH_TIER_WEAPON_ASSETS))
    for (const path of Object.values(BYZANTINE_EQUIPMENT_ASSETS)) expect(shared.has(path)).toBe(false)
    expect(Object.keys(HIGH_TIER_WEAPON_ASSETS)).toContain('spear_t5')
  })
  it('requests nothing for scenes that do not use it', async () => {
    const loaded = vi.fn(async () => ({}))
    vi.stubGlobal('fetch', loaded)
    try {
      await expect(prepareByzantineEquipment(['spear_t5', 'commander_shield_t5', null, undefined])).resolves.toBe('ready')
      expect(loaded).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  const TIMEOUT = 1000, RETRY = 500
  const bounded = (loader: (id: 'a', signal: AbortSignal) => Promise<string>) => new OnDemandAssets<'a', string>(loader, { timeoutMs: TIMEOUT, retryDelayMs: RETRY })
  it('deduplicates concurrent requests, retries after a failure and loads a success only once', async () => {
    const loader = vi.fn<(id: 'a') => Promise<string>>().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('model')
    const assets = bounded(loader)
    const [first, second] = [assets.load('a'), assets.load('a')]
    expect(first).toBe(second)
    await expect(first).rejects.toThrow('404')
    expect(assets.get('a')).toBeUndefined() // a failed request exposes no model
    await expect(assets.load('a')).resolves.toBe('model')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(assets.get('a')).toBe('model')
    await assets.load('a')
    expect(loader).toHaveBeenCalledTimes(2)
  })
  it('turns a forever-pending load into a timeout, after which loading again issues a new request', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn<(id: 'a', signal: AbortSignal) => Promise<string>>().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce('model')
      const assets = bounded(loader)
      const pending = assets.load('a')
      const rejected = expect(pending).rejects.toBeInstanceOf(AssetLoadTimeout)
      await vi.advanceTimersByTimeAsync(TIMEOUT - 1)
      expect(assets.status('a')).toBe('loading')
      expect(assets.load('a')).toBe(pending)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(assets.status('a')).toBe('failed')
      expect(loader.mock.calls[0][1].aborted).toBe(true) // the hung transfer is cancelled, not left holding the URL
      await expect(assets.load('a')).resolves.toBe('model')
      expect(loader).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('discards a late result from a timed-out request so it cannot replace the newer one', async () => {
    vi.useFakeTimers()
    try {
      let finishOld = (_: string) => {}, finishNew = (_: string) => {}
      const loader = vi.fn<(id: 'a') => Promise<string>>()
        .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
        .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve }))
      const assets = bounded(loader)
      const old = expect(assets.load('a')).rejects.toBeInstanceOf(AssetLoadTimeout)
      await vi.advanceTimersByTimeAsync(TIMEOUT)
      await old
      const newer = assets.load('a')
      finishOld('stale')
      await vi.advanceTimersByTimeAsync(0)
      expect(assets.get('a')).toBeUndefined()
      expect(assets.status('a')).toBe('loading')
      finishNew('fresh')
      await expect(newer).resolves.toBe('fresh')
      expect(assets.get('a')).toBe('fresh')
    } finally { vi.useRealTimers() }
  })
  it('paces automatic retries from polling at the retry delay', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn<(id: 'a') => Promise<string>>().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('model')
      const assets = bounded(loader)
      expect(assets.poll('a')).toBeUndefined()
      expect(assets.poll('a')).toBeUndefined()
      await vi.advanceTimersByTimeAsync(RETRY - 1)
      assets.poll('a')
      expect(loader).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      assets.poll('a')
      expect(loader).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(0)
      expect(assets.poll('a')).toBe('model')
    } finally { vi.useRealTimers() }
  })
})
