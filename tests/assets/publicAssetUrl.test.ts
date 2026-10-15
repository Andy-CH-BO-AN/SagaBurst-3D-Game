import { afterEach,expect,it,vi } from 'vitest'
import { publicAssetUrl } from '../../src/assets/publicAssetUrl'

afterEach(() => vi.unstubAllEnvs())
it('keeps runtime assets under the deployed repository base', () => {
  vi.stubEnv('BASE_URL', '/SagaBurst-3D-Game/')
  expect(publicAssetUrl('/models/mounts/manifest.json')).toBe('/SagaBurst-3D-Game/models/mounts/manifest.json')
  expect(publicAssetUrl('models/decoder/')).toBe('/SagaBurst-3D-Game/models/decoder/')
})
