import * as THREE from 'three'
import type { HorseInstance } from '../../src/world/HorseAssetRegistry'

type GameplayHorseVisual = Pick<HorseInstance,
  'root' | 'lod' | 'saddleSeat' | 'setAppearanceVariant' | 'setLocomotion' |
  'playOnce' | 'playDeath' | 'playStudioClip' | 'update' | 'dispose'>

/** Rendering boundary for mounted gameplay; assets, skeletons and clips are tested separately. */
export function createGameplayHorseVisual(): GameplayHorseVisual {
  const root = new THREE.Group()
  const saddleSeat = new THREE.Object3D()
  // Fixture input, not a claim about authored horse dimensions.
  saddleSeat.position.y = 1.7
  root.add(saddleSeat)
  return {
    root,
    saddleSeat,
    lod: new THREE.LOD(),
    setAppearanceVariant() {},
    setLocomotion() {},
    playOnce() {},
    playDeath() {},
    playStudioClip() {},
    update() {},
    dispose() {
      root.removeFromParent()
      root.clear()
    },
  }
}
