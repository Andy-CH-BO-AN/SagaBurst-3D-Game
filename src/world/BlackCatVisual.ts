import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { createQuadrupedAssetPreload } from './QuadrupedAssetPreload'
import { QuadrupedVisual } from './QuadrupedVisual'

/** Original GLB geometry and PBR maps, with a fitted feline skin and independent playback. */
export class BlackCatVisual extends QuadrupedVisual {
  private static template: GLTF | null = null
  private static readonly preloadAsset = createQuadrupedAssetPreload({
    baseUrl: publicAssetUrl('models/mounts/v2/black-cat'), name: 'Black cat', bodyPrefix: 'cat',
  }, template => { BlackCatVisual.template = template })

  static preload(): Promise<void> { return this.preloadAsset() }

  constructor() {
    super(BlackCatVisual.template, {
      name: 'black-cat', bodyPrefix: 'cat', saddleMesh: 'cat_saddle_leather',
      equipmentMeshes: ['cat_saddle_leather', 'cat_equipment_lod1', 'cat_equipment_lod2', 'cat_saddle_binding', 'cat_saddle_brass'],
      gaitSpeeds: { walk: 2, run: 13.2 }, boundingSphere: { center: [0, 1, -.2], radius: 3 },
    })
  }
}
