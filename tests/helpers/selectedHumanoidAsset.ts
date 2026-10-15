import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, type HumanoidAssetDescriptor, type HumanoidAssetManifest, ORDINARY_HUMANOID_ASSETS } from '../../src/world/HumanoidAssetRegistry'
import { loadTestGlbAsset } from './testGlbAsset'

export const REPLACEMENT_DESCRIPTORS = {
  viking: ORDINARY_HUMANOID_ASSETS.viking,
  roman: ORDINARY_HUMANOID_ASSETS.roman,
  'viking-hero-t4': { assetId: 'viking-hero-t4', faction: 'viking', heightM: 2, maxShoulderWidthM: .78, neckLengthM: .11 },
} as const satisfies Record<string, HumanoidAssetDescriptor>
export type ReplacementAssetId = keyof typeof REPLACEMENT_DESCRIPTORS

export type SelectedAssetId = ReplacementAssetId | 'viking-hero-t5' | 'roman-hero-t5'

export function replacementManifest(assetId: SelectedAssetId): HumanoidAssetManifest {
  return JSON.parse(readFileSync(`public/models/characters/v2/${assetId}/manifest.json`, 'utf8'))
}

/** Cost: on first preload per asset, three real GLBs (images omitted; this fixture
 * makes no texture/material claim). Each call creates one real character rig,
 * zero NPCs, mounts or worlds. Caller owns instance.dispose(). */
export async function selectedHumanoidInstance(assetId: SelectedAssetId, isPlayer = false) {
  const descriptor = assetId === 'viking-hero-t5' || assetId === 'roman-hero-t5' ? HERO_ASSETS[assetId].descriptor : REPLACEMENT_DESCRIPTORS[assetId]
  const manifest = replacementManifest(assetId)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadTestGlbAsset(`public${url}`))
  try {
    await HumanoidAssetRegistry.preloadAsset(descriptor)
    return HumanoidAssetRegistry.createCharacterInstance({ faction: descriptor.faction, tier: 2, isPlayer }, assetId)
  } finally { fetchMock.mockRestore(); loader.mockRestore() }
}
