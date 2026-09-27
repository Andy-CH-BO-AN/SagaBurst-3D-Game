import * as THREE from 'three'

/** Cached barycentric support points on the posed trousers/tunic and saddle. */
class SurfacePoint {
  private readonly vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  private readonly weights = new THREE.Vector3()
  private readonly ids: number[]
  constructor(private readonly mesh: THREE.SkinnedMesh, hit: THREE.Intersection) {
    this.ids = [hit.face!.a, hit.face!.b, hit.face!.c]
    this.read()
    THREE.Triangle.getBarycoord(mesh.worldToLocal(hit.point.clone()), ...this.vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3], this.weights)
  }
  private read(): void {
    this.ids.forEach((id, i) => this.mesh.getVertexPosition(id, this.vertices[i]))
  }
  world(target: THREE.Vector3): THREE.Vector3 {
    this.mesh.skeleton.update()
    this.read()
    return target.copy(this.vertices[0]).multiplyScalar(this.weights.x)
      .addScaledVector(this.vertices[1], this.weights.y).addScaledVector(this.vertices[2], this.weights.z)
      .applyMatrix4(this.mesh.matrixWorld)
  }
}

/** Only the inspected bearing patches are sampled, never the hanging front hem.
 * Corrections move the visual in its parent's frame; gameplay roots stay intact.
 */
export class CorgiSeatContact {
  private readonly pairs: { butt: SurfacePoint; seat: SurfacePoint }[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly delta = new THREE.Vector3()

  constructor(private readonly rider: THREE.Object3D, private readonly mount: THREE.Object3D) {
    const meshes: THREE.SkinnedMesh[] = []
    rider.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
    const mesh = meshes.find(object => object.name === 'Pants_Pants_0')
      ?? meshes.find(object => object.name === 'Tunic_1')
      ?? meshes.find(object => object.name === 'Tunic002' || object.name === 'Tunic')
    if (!mesh) return // Procedural test fixtures have no source contact surface.
    const saddle = mount.getObjectByName('corgi_saddle_leather') as THREE.SkinnedMesh
    rider.updateWorldMatrix(true, false); rider.updateMatrixWorld(true)
    mount.updateWorldMatrix(true, false); mount.updateMatrixWorld(true)
    for (const object of [mesh, saddle]) {
      object.skeleton.update(); object.computeBoundingBox(); object.computeBoundingSphere()
    }
    const seat = mount.worldToLocal(mount.getObjectByName('socket_saddle_seat')!.getWorldPosition(new THREE.Vector3()))
    const z = seat.z + (mesh.name === 'Tunic' ? -.10 : .02)
    const up = new THREE.Vector3(0, 1, 0).transformDirection(mount.matrixWorld)
    for (const x of [-.06, .06]) {
      const below = mount.localToWorld(new THREE.Vector3(x, seat.y - .65, z))
      const above = mount.localToWorld(new THREE.Vector3(x, seat.y + .65, z))
      const buttHit = new THREE.Raycaster(below, up, 0, 1.3).intersectObject(mesh, false)[0]
      const seatHit = new THREE.Raycaster(above, up.clone().negate(), 0, 1.3).intersectObject(saddle, false)[0]
      if (!buttHit?.face || !seatHit?.face) throw new Error(`Missing corgi seat contact: ${mesh.name}`)
      this.pairs.push({ butt: new SurfacePoint(mesh, buttHit), seat: new SurfacePoint(saddle, seatHit) })
    }
  }

  align(): void {
    if (!this.pairs.length) return
    this.rider.updateWorldMatrix(true, false); this.rider.updateMatrixWorld(true)
    this.mount.updateWorldMatrix(true, false); this.mount.updateMatrixWorld(true)
    let correction = -Infinity
    for (const pair of this.pairs) {
      this.mount.worldToLocal(pair.butt.world(this.a))
      this.mount.worldToLocal(pair.seat.world(this.b))
      correction = Math.max(correction, this.b.y - this.a.y + .002)
    }
    this.a.set(0, 0, 0); this.b.set(0, correction, 0)
    this.mount.localToWorld(this.a); this.mount.localToWorld(this.b)
    this.rider.parent!.worldToLocal(this.a); this.rider.parent!.worldToLocal(this.b)
    this.rider.position.add(this.delta.subVectors(this.b, this.a))
    this.rider.updateMatrixWorld(true)
  }
}
