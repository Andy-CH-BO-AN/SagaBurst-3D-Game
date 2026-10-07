import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BlackCatVisual } from '../../src/world/BlackCatVisual'
import { loadTestGlbAsset } from './testGlbAsset'

/** Load the real shipped skin/animation data without requiring a DOM image decoder. */
export async function installBlackCatTestAsset(): Promise<GLTF> {
  const gltf = await loadTestGlbAsset('public/models/mounts/v2/black-cat/black-cat.glb')
  ;(BlackCatVisual as unknown as { template: GLTF }).template = gltf
  return gltf
}
