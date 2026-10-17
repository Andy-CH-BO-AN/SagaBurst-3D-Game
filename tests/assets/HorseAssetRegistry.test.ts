import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  horsePlaybackRateForSpeed,
  horseLocomotionClipForSpeed,
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

  it('keeps a gait and its cadence through boundary noise until speed leaves the margin', () => {
    expect(horseLocomotionClipForSpeed(10.49, 'gallop')).toBe('gallop')
    expect(horseLocomotionClipForSpeed(10.52, 'gallop')).toBe('gallop')
    expect(horseLocomotionClipForSpeed(10.34, 'gallop')).toBe('canter')
    expect(horseLocomotionClipForSpeed(10.52, 'canter')).toBe('canter')
    expect(horseLocomotionClipForSpeed(10.66, 'canter')).toBe('gallop')
    expect(horseLocomotionClipForSpeed(0, 'gallop')).toBe('idle')
    expect(horseLocomotionClipForSpeed(10.49)).toBe('canter')
    const calibrated = { gaitReferenceSpeeds: { walk: 2, trot: 2.5, canter: 4, gallop: 12 } }
    expect(horsePlaybackRateForSpeed(10.49, calibrated, 'gallop')).toBeCloseTo(10.49 / 12)
  })
})
