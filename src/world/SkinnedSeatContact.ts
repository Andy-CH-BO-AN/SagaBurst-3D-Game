import * as THREE from 'three'

interface SupportPoint { ids: number[]; weights: number[] }
const SUPPORT = 'seatedBearingPoints'

/** Project inspected anatomical landmarks onto each LOD's original topology.
 * Store barycentrics once on the template; never alter vertices or skin weights. */
export function prepareSeatSupport(mesh: THREE.SkinnedMesh, landmarks: readonly (readonly number[])[]): void {
  const position = mesh.geometry.attributes.position, index = mesh.geometry.index
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), weights = new THREE.Vector3()
  mesh.userData[SUPPORT] = landmarks.map(landmark => {
    const point = new THREE.Vector3().fromArray(landmark)
    let distance = Infinity, best: SupportPoint | undefined
    for (let face = 0; face < (index?.count ?? position.count); face += 3) {
      const ids = [0, 1, 2].map(c => index ? index.getX(face + c) : face + c)
      triangle.a.fromBufferAttribute(position, ids[0]); triangle.b.fromBufferAttribute(position, ids[1]); triangle.c.fromBufferAttribute(position, ids[2])
      triangle.closestPointToPoint(point, closest)
      const d = closest.distanceToSquared(point)
      if (d >= distance) continue
      if (!triangle.getBarycoord(closest, weights)) continue
      distance = d
      best = { ids, weights: weights.toArray() }
    }
    if (!best) throw new Error(`Missing bearing surface: ${mesh.name}`)
    return best
  })
}

function readPoint(mesh: THREE.SkinnedMesh, point: SupportPoint, target: THREE.Vector3, vertex: THREE.Vector3): THREE.Vector3 {
  target.set(0, 0, 0)
  for (let i = 0; i < 3; i++) target.addScaledVector(mesh.getVertexPosition(point.ids[i], vertex), point.weights[i])
  return target.applyMatrix4(mesh.matrixWorld)
}

/** Selected riders' actual bearing surfaces, evaluated after both animations.
 * Only six posed vertices per surface per frame; no per-frame mesh raycast. */
export class SkinnedSeatContact {
  private readonly surfaces: Array<{ mesh: THREE.SkinnedMesh; points: SupportPoint[] }> = []
  private readonly seatPoints: SupportPoint[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly vertex = new THREE.Vector3()

  constructor(private readonly rider: THREE.Object3D, private readonly mount: THREE.Object3D,
    private readonly saddle: THREE.SkinnedMesh, seat: THREE.Object3D) {
    rider.traverse(node => {
      if (node instanceof THREE.SkinnedMesh && node.userData[SUPPORT]) this.surfaces.push({ mesh: node, points: node.userData[SUPPORT] })
    })
    if (!this.surfaces.length) return
    mount.updateWorldMatrix(true, false); mount.updateMatrixWorld(true)
    saddle.skeleton.update(); saddle.computeBoundingBox(); saddle.computeBoundingSphere()
    const center = mount.worldToLocal(seat.getWorldPosition(new THREE.Vector3()))
    const down = new THREE.Vector3(0, -1, 0).transformDirection(mount.matrixWorld)
    for (const x of [-.1, .1]) {
      const origin = mount.localToWorld(new THREE.Vector3(x, center.y + .3, center.z - .03))
      const hit = new THREE.Raycaster(origin, down, 0, .6).intersectObject(saddle, false)[0]
      if (!hit?.face) throw new Error('Missing saddle bearing surface')
      const ids = [hit.face.a, hit.face.b, hit.face.c]
      const vertices = ids.map(id => saddle.getVertexPosition(id, new THREE.Vector3()))
      const bary = THREE.Triangle.getBarycoord(saddle.worldToLocal(hit.point.clone()), vertices[0], vertices[1], vertices[2], new THREE.Vector3())
      if (!bary) throw new Error('Degenerate saddle bearing surface')
      this.seatPoints.push({ ids, weights: bary.toArray() })
    }
  }

  get hasBearingSurface(): boolean { return this.surfaces.length > 0 }

  align(): void {
    const surface = this.surfaces.find(({ mesh }) => {
      for (let node: THREE.Object3D | null = mesh; node && node !== this.rider; node = node.parent) if (!node.visible) return false
      return true
    })
    if (!surface) return
    this.rider.updateWorldMatrix(true, false); this.rider.updateMatrixWorld(true)
    this.mount.updateWorldMatrix(true, false); this.mount.updateMatrixWorld(true)
    surface.mesh.skeleton.update(); this.saddle.skeleton.update()
    let correction = -Infinity
    for (let i = 0; i < this.seatPoints.length; i++) {
      this.mount.worldToLocal(readPoint(surface.mesh, surface.points[i], this.a, this.vertex))
      this.mount.worldToLocal(readPoint(this.saddle, this.seatPoints[i], this.b, this.vertex))
      correction = Math.max(correction, this.b.y - this.a.y + .002)
    }
    this.mount.localToWorld(this.a.set(0, 0, 0))
    this.mount.localToWorld(this.b.set(0, correction, 0))
    this.rider.parent!.worldToLocal(this.a); this.rider.parent!.worldToLocal(this.b)
    this.rider.position.add(this.b.sub(this.a))
    this.rider.updateMatrixWorld(true)
  }
}
