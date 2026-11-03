import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { createQuadrupedAssetPreload } from './QuadrupedAssetPreload'
import { QuadrupedVisual } from './QuadrupedVisual'

export type FelineMountVariant = 'black-cat' | 'white-cat' | 'orange-cat' | 'serval' | 'caracal'
export const FELINE_MOUNT_VARIANTS: readonly FelineMountVariant[] = [
  'black-cat',
  'white-cat',
  'orange-cat',
  'serval',
  'caracal',
] as const

const FELINE_SPECS: Readonly<Record<FelineMountVariant, { label: string; runSpeed: number; radius: number }>> = {
  'black-cat': { label: 'Black cat', runSpeed: 13.2, radius: 3 },
  'white-cat': { label: 'White cat', runSpeed: 13.2, radius: 3 },
  'orange-cat': { label: 'Orange cat', runSpeed: 12, radius: 3 },
  serval: { label: 'Serval', runSpeed: 15, radius: 3.4 },
  caracal: { label: 'Caracal', runSpeed: 15, radius: 3.4 },
}

/** Original GLB geometry and PBR maps, with a fitted feline skin and independent playback. */
export class BlackCatVisual extends QuadrupedVisual {
  private static readonly templates = new Map<FelineMountVariant, GLTF>()
  private static readonly preloaders: Readonly<Record<FelineMountVariant, () => Promise<void>>> = {
    'black-cat': createQuadrupedAssetPreload(
      { baseUrl: publicAssetUrl('models/mounts/v2/black-cat'), name: 'Black cat', bodyPrefix: 'cat' },
      template => { BlackCatVisual.templates.set('black-cat', template) },
    ),
    'white-cat': createQuadrupedAssetPreload(
      { baseUrl: publicAssetUrl('models/mounts/v2/white-cat'), name: 'White cat', bodyPrefix: 'cat' },
      template => { BlackCatVisual.templates.set('white-cat', template) },
    ),
    'orange-cat': createQuadrupedAssetPreload(
      { baseUrl: publicAssetUrl('models/mounts/v2/orange-cat'), name: 'Orange cat', bodyPrefix: 'cat' },
      template => { BlackCatVisual.templates.set('orange-cat', template) },
    ),
    serval: createQuadrupedAssetPreload(
      { baseUrl: publicAssetUrl('models/mounts/v2/serval'), name: 'Serval', bodyPrefix: 'cat' },
      template => { BlackCatVisual.templates.set('serval', template) },
    ),
    caracal: createQuadrupedAssetPreload(
      { baseUrl: publicAssetUrl('models/mounts/v2/caracal'), name: 'Caracal', bodyPrefix: 'cat' },
      template => { BlackCatVisual.templates.set('caracal', template) },
    ),
  }

  static async preload(variant?: FelineMountVariant): Promise<void> {
    if (variant) {
      await this.preloaders[variant]()
      return
    }
    await Promise.all(FELINE_MOUNT_VARIANTS.map(v => this.preloaders[v]()))
  }

  constructor(variant: FelineMountVariant = 'black-cat') {
    const spec = FELINE_SPECS[variant]
    super(BlackCatVisual.templates.get(variant) ?? null, {
      name: variant, bodyPrefix: 'cat', saddleMesh: 'cat_saddle_leather',
      equipmentMeshes: ['cat_saddle_leather', 'cat_equipment_lod1', 'cat_equipment_lod2', 'cat_saddle_binding', 'cat_saddle_brass'],
      gaitSpeeds: { walk: 2, run: spec.runSpeed }, boundingSphere: { center: [0, 1, -.2], radius: spec.radius },
    })
  }
}
