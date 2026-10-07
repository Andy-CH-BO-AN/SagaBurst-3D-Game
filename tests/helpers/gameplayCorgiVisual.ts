import * as THREE from 'three'
import type { CorgiVisual } from '../../src/world/CorgiVisual'

type GameplayCorgiVisual = Pick<CorgiVisual,
  'root' | 'saddleSeat' | 'riderPelvisSeat' | 'lod' | 'fitRider' |
  'setLocomotion' | 'playOnce' | 'playStudioClip' | 'update' | 'dispose'>

/** Render boundary for gameplay cases; does not validate assets, skinning or animation. */
export class GameplayCorgiVisualDouble implements GameplayCorgiVisual {
  readonly root = new THREE.Group()
  readonly saddleSeat = new THREE.Object3D()
  readonly riderPelvisSeat = new THREE.Object3D()
  readonly lod = new THREE.LOD()

  constructor() {
    // A fixed fixture seat provides transforms without depending on authored GLB data.
    this.saddleSeat.position.y = 1
    this.saddleSeat.add(this.riderPelvisSeat)
    this.root.add(this.saddleSeat)
  }

  fitRider(_rider: THREE.Object3D): void {}
  setLocomotion(_speed: number): void {}
  playOnce(_clip: Parameters<CorgiVisual['playOnce']>[0]): void {}
  playStudioClip(_clip: Parameters<CorgiVisual['playStudioClip']>[0]): void {}
  update(_dt: number): void {}

  dispose(): void {
    this.root.removeFromParent()
    this.root.clear()
  }
}
