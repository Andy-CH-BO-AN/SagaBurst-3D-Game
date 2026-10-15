import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry } from '../../src/world/HumanoidAssetRegistry'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { loadTestGlbAsset } from './testGlbAsset'

/** Real production preload for gameplay contact integrations: 3 LODs per
 * ordinary faction plus optional T4. No actors/worlds; image decoding omitted.
 * Returns explicit template cleanup; does not register test lifecycle hooks. */
export async function preloadGameplayHumanoids(includeVikingT4 = false): Promise<() => void> {
  const saved = HumanoidAssetRegistry._snapshotTemplatesForTesting()
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => ({
    ok: true, json: async () => JSON.parse(readFileSync(`public${String(input)}`, 'utf8')),
  } as Response))
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(url => loadTestGlbAsset(`public${url}`))
  try {
    await HumanoidAssetRegistry.preload()
    if (includeVikingT4) await HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['viking-hero-t4'].descriptor)
  } finally { fetchMock.mockRestore(); loader.mockRestore() }
  return () => HumanoidAssetRegistry._restoreTemplatesForTesting(saved)
}
