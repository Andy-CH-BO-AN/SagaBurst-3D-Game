import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicAssetUrl } from '../../src/assets/publicAssetUrl'

afterEach(() => vi.unstubAllEnvs())
describe('runtime public asset base', () => {
  it.each(['/', '/SagaBurst-3D-Game/', '/another-repo/'])('resolves manifests, models and decoder paths under %s', base => {
    vi.stubEnv('BASE_URL', base)
    for (const asset of ['models/characters/v2/roman/manifest.json', 'models/mounts/v1/horse/horse_runtime.glb', 'models/mounts/v1/horse/basis/']) {
      expect(publicAssetUrl(asset)).toBe(base + asset)
      expect(publicAssetUrl('/' + asset)).toBe(base + asset)
    }
  })
})
