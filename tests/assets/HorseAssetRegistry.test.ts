import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  horsePlaybackRateForSpeed,
  horseVariantFromSave,
  validateHorseManifest,
  type HorseAssetManifest,
} from '../../src/world/HorseAssetRegistry'

// Manifest is ordinary compatibility data; no model, texture or mixer is loaded.
const manifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest

describe('horse asset compatibility', () => {
  it('accepts the smaller texture package while retaining saved coat identities', () => {
    const candidate = structuredClone(manifest)
    candidate.metrics!.textureMaxSize = 1024
    expect(() => validateHorseManifest(candidate)).not.toThrow()
    expect(candidate.id).toBe('realistic-warhorse-v10')
    expect(candidate.variants.map(variant => variant.id)).toEqual(['paint_01', 'paint_02', 'paint_03'])
    expect([0, 1, 2].map(horseVariantFromSave)).toEqual([0, 1, 2])
  })

  it('rejects a package missing the death state before loading its model', () => {
    const incomplete = structuredClone(manifest)
    incomplete.clips = incomplete.clips.filter(clip => clip !== 'death')
    expect(() => validateHorseManifest(incomplete)).toThrow('Horse manifest is missing death clip')
  })

  it('adapts visual cadence to measured strides without the legacy speed cap', () => {
    const calibrated = { gaitReferenceSpeeds: { walk: 2, trot: 2.5, canter: 4, gallop: 12 } }
    expect(horsePlaybackRateForSpeed(6, calibrated)).toBeCloseTo(2.4)
    expect(horsePlaybackRateForSpeed(6)).toBeCloseTo(6 / 5.25)
    expect(horsePlaybackRateForSpeed(0, calibrated)).toBe(1)
  })
})
