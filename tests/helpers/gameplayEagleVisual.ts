import * as THREE from 'three'
import type { XongkoroVisual } from '../../src/world/XongkoroVisual'

/** Render-only fixture: 0 GLBs; callers retain real Mount, flight, damage and actor behavior. */
export class GameplayEagleVisualDouble implements Pick<XongkoroVisual,
  'root' | 'lod' | 'standingSocket' | 'headAttackSocket' | 'leftClawAttackSocket' | 'rightClawAttackSocket' | 'update' | 'dispose' | 'setCameraDistance'> {
  static readonly ready = true
  static async preload(): Promise<void> {}
  readonly root = new THREE.Group()
  readonly lod = new THREE.LOD()
  readonly standingSocket = new THREE.Object3D()
  readonly headAttackSocket = new THREE.Object3D()
  readonly leftClawAttackSocket = new THREE.Object3D()
  readonly rightClawAttackSocket = new THREE.Object3D()
  constructor() {
    this.standingSocket.position.set(0, 2.8, 1.7)
    this.headAttackSocket.position.set(0, 1.8, 4.5)
    this.leftClawAttackSocket.position.set(-.7, .5, 2)
    this.rightClawAttackSocket.position.set(.7, .5, 2)
    this.root.add(this.standingSocket, this.headAttackSocket, this.leftClawAttackSocket, this.rightClawAttackSocket)
  }
  setCameraDistance(_distance: number): void {}
  update(_dt: number, _state: Parameters<XongkoroVisual['update']>[1]): void {}
  dispose(): void { this.root.removeFromParent(); this.root.clear() }
}
