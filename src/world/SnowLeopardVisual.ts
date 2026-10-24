import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { createQuadrupedAssetPreload } from './QuadrupedAssetPreload'
import { QUADRUPED_STUDIO_CLIPS } from './QuadrupedMountAnimation'
import { QuadrupedVisual } from './QuadrupedVisual'

/** Native GLB rest bounds excluding tail-joint weights; ground clearance stays shared. */
export const SNOW_LEOPARD_HURTBOX = {
  center: [0, .85, .516], size: [1.216, 1.7, 2.87],
} as const

/** Source-preserving armored skin with offline-baked BlackCat donor animation. */
export class SnowLeopardVisual extends QuadrupedVisual {
  private static template: GLTF | null = null
  private static readonly preloadAsset = createQuadrupedAssetPreload({
    baseUrl: publicAssetUrl('models/mounts/v2/snow-leopard'), name: 'Snow leopard', bodyPrefix: 'snow_leopard',
    requiredClips: QUADRUPED_STUDIO_CLIPS,
  }, template => { SnowLeopardVisual.template = template })

  static preload(): Promise<void> { return this.preloadAsset() }

  constructor() {
    super(SnowLeopardVisual.template, {
      name: 'snow-leopard', bodyPrefix: 'snow_leopard', saddleMesh: 'snow_leopard_body_lod0',
      gaitSpeeds: { walk: 2, run: 12.8 }, boundingSphere: { center: [0, 1, -.2], radius: 3 },
    })
  }
}
