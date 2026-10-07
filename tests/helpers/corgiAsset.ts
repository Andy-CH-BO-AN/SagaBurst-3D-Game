import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CorgiVisual } from '../../src/world/CorgiVisual'
import { loadTestGlbAsset } from './testGlbAsset'

/** Load the real shipped skin/animation data without requiring a DOM image decoder. */
export async function installCorgiTestAsset(): Promise<GLTF> {
  const gltf = await loadTestGlbAsset('public/models/mounts/v2/corgi/corgi.glb')
  ;(CorgiVisual as unknown as { template: GLTF }).template = gltf
  return gltf
}
