import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  validateHorseManifest,
  type HorseAssetManifest,
} from '../../src/world/HorseAssetRegistry'

// Manifest is ordinary compatibility data; no model, texture or mixer is loaded.
const manifest = JSON.parse(readFileSync(new URL('../../public/models/mounts/v1/horse/manifest.json', import.meta.url), 'utf8')) as HorseAssetManifest

describe('horse asset compatibility', () => {

  it('rejects a package missing the death state before loading its model', () => {
    const incomplete = structuredClone(manifest)
    incomplete.clips = incomplete.clips.filter(clip => clip !== 'death')
    expect(() => validateHorseManifest(incomplete)).toThrow('Horse manifest is missing death clip')
  })

})
