import * as THREE from 'three'

/** Follow a measured point on a deformed triangle, rather than a bone origin. */
class SkinSurfacePoint {
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Vector3()
  private readonly weights = new THREE.Vector3()
  private readonly indices: [number, number, number]

  constructor(private readonly mesh: THREE.SkinnedMesh, hit: THREE.Intersection) {
    const face = hit.face!
    this.indices = [face.a, face.b, face.c]
    this.vertices()
    const local = mesh.worldToLocal(hit.point.clone())
    THREE.Triangle.getBarycoord(local, this.a, this.b, this.c, this.weights)
  }

  private vertices(): void {
    this.mesh.getVertexPosition(this.indices[0], this.a)
    this.mesh.getVertexPosition(this.indices[1], this.b)
    this.mesh.getVertexPosition(this.indices[2], this.c)
  }

  world(target: THREE.Vector3): THREE.Vector3 {
    this.vertices()
    return target.copy(this.a).multiplyScalar(this.weights.x)
      .addScaledVector(this.b, this.weights.y).addScaledVector(this.c, this.weights.z)
      .applyMatrix4(this.mesh.matrixWorld)
  }
}

/** DEV fitting for the three inspected black-cat riders, in the mount's frame. */
export class MountStudioSeatContact {
  private readonly butt: SkinSurfacePoint
  private readonly seat: SkinSurfacePoint
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()

  constructor(private readonly rider: THREE.Object3D, private readonly mount: THREE.Object3D, saddle: THREE.SkinnedMesh) {
    const maki = rider.name.startsWith('maki-archer-t4')
    const hero = rider.name.startsWith('viking-hero-t4')
    // Inspected bearing patches: trousers, seated mail, and rear tunic over
    // the buttocks. The regular Viking's hanging front hem is not a seat.
    const mesh = rider.getObjectByName(maki ? 'Pants_Pants_0' : hero ? 'Tunic002' : 'Tunic') as THREE.SkinnedMesh
    const x = maki ? .05 : .07
    const z = maki ? -.10 : hero ? -.15 : -.25
    mount.updateWorldMatrix(true, false)
    mount.updateMatrixWorld(true)
    mesh.computeBoundingBox(); mesh.computeBoundingSphere()
    saddle.computeBoundingBox(); saddle.computeBoundingSphere()
    const up = new THREE.Vector3(0, 1, 0).transformDirection(mount.matrixWorld)
    const underneath = new THREE.Vector3(x, 1.1, z).applyMatrix4(mount.matrixWorld)
    const overhead = new THREE.Vector3(x, 2.3, z).applyMatrix4(mount.matrixWorld)
    const buttHit = new THREE.Raycaster(underneath, up, 0, 1.2).intersectObject(mesh, false)[0]
    const seatHit = new THREE.Raycaster(overhead, up.clone().negate(), 0, 1.2).intersectObject(saddle, false)[0]
    if (!buttHit?.face || !seatHit?.face) throw new Error(`Cannot locate seated contact on ${rider.name}`)
    this.butt = new SkinSurfacePoint(mesh, buttHit)
    this.seat = new SkinSurfacePoint(saddle, seatHit)
  }

  align(): void {
    this.mount.updateWorldMatrix(true, false)
    this.mount.updateMatrixWorld(true)
    this.mount.worldToLocal(this.butt.world(this.a))
    this.mount.worldToLocal(this.seat.world(this.b))
    this.rider.position.y += this.b.y - this.a.y + .002
    this.rider.updateWorldMatrix(false, true)
  }
}
