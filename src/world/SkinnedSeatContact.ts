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

/** Carries bearing points onto `mergeGeometries([first, second])`: the second mesh's vertices
 * follow the first's, so its ids shift by the first's vertex count. First wins when both carry them. */
export function copyMergedSeatSupport(first: THREE.SkinnedMesh, second: THREE.SkinnedMesh, merged: THREE.SkinnedMesh): void {
  if (first.userData[SUPPORT]) { merged.userData[SUPPORT] = first.userData[SUPPORT]; return }
  const points = second.userData[SUPPORT] as SupportPoint[] | undefined
  if (!points) return
  const offset = first.geometry.attributes.position.count
  merged.userData[SUPPORT] = points.map(({ ids, weights }) => ({ ids: ids.map(id => id + offset), weights: [...weights] }))
}

function readPoint(mesh: THREE.SkinnedMesh, point: SupportPoint, target: THREE.Vector3, vertex: THREE.Vector3, toWorld: THREE.Matrix4 = mesh.matrixWorld): THREE.Vector3 {
  target.set(0, 0, 0)
  for (let i = 0; i < 3; i++) target.addScaledVector(mesh.getVertexPosition(point.ids[i], vertex), point.weights[i])
  return target.applyMatrix4(toWorld)
}

/** Every bone that weights one of these vertices, across all four-influence sets. */
function influencingBones(mesh: THREE.SkinnedMesh, points: readonly SupportPoint[]): THREE.Bone[] {
  const bones = new Set<THREE.Bone>()
  for (let set = 0; set < 4; set++) {
    const joints = mesh.geometry.getAttribute(set === 0 ? 'skinIndex' : `joints_${set}`)
    const weights = mesh.geometry.getAttribute(set === 0 ? 'skinWeight' : `weights_${set}`)
    if (!joints || !weights) continue
    for (const point of points) for (const id of point.ids) for (let c = 0; c < 4; c++) {
      if (weights.getComponent(id, c) !== 0) bones.add(mesh.skeleton.bones[joints.getComponent(id, c)])
    }
  }
  return [...bones]
}

/** Topological parent-before-child chain from `stopAncestor` (exclusive) down to each bone. */
function buildBoneUpdateChain(bones: readonly THREE.Bone[], stopAncestor: THREE.Object3D | null): THREE.Object3D[] {
  const seen = new Set<THREE.Object3D>()
  const chain: THREE.Object3D[] = []
  const path: THREE.Object3D[] = []
  for (let i = 0; i < bones.length; i++) {
    path.length = 0
    for (let node: THREE.Object3D | null = bones[i]; node && node !== stopAncestor; node = node.parent) {
      if (seen.has(node)) break
      path.push(node)
    }
    for (let j = path.length - 1; j >= 0; j--) {
      const node = path[j]
      seen.add(node)
      chain.push(node)
    }
  }
  return chain
}

function refreshBoneChain(chain: readonly THREE.Object3D[]): void {
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    if (node.matrixAutoUpdate) node.updateMatrix()
    const parent = node.parent
    if (parent) node.matrixWorld.multiplyMatrices(parent.matrixWorld, node.matrix)
    else node.matrixWorld.copy(node.matrix)
  }
}

/** Selected riders' actual bearing surfaces, evaluated after both animations.
 * Only six posed vertices per surface per frame; no per-frame mesh raycast.
 * Vertex skinning reads bone matrixWorld directly (never Skeleton.boneMatrices). */
export class SkinnedSeatContact {
  private readonly surfaces: Array<{ mesh: THREE.SkinnedMesh; points: SupportPoint[] }> = []
  private readonly seatPoints: SupportPoint[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly vertex = new THREE.Vector3()
  private readonly riderToWorld = new THREE.Matrix4()
  private readonly saddleToWorld = new THREE.Matrix4()
  /** Cached topological ancestor-to-bone chains for attached-bind meshes. */
  private readonly surfaceChains = new Map<THREE.SkinnedMesh, THREE.Object3D[]>()
  private saddleChain: THREE.Object3D[] | null = null
  /** Last measured mount-local lift, re-applied while neither pose is re-sampled. */
  private correction: number | null = null

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
      const origin = mount.localToWorld(new THREE.Vector3(center.x + x, center.y + .3, center.z - .03))
      const hit = new THREE.Raycaster(origin, down, 0, .6).intersectObject(saddle, false)[0]
        ?? new THREE.Raycaster(mount.localToWorld(new THREE.Vector3(center.x + x * .5, center.y + .3, center.z)), down, 0, .6).intersectObject(saddle, false)[0]
      if (!hit?.face) throw new Error('Missing saddle bearing surface')
      const ids = [hit.face.a, hit.face.b, hit.face.c]
      const vertices = ids.map(id => saddle.getVertexPosition(id, new THREE.Vector3()))
      const bary = THREE.Triangle.getBarycoord(saddle.worldToLocal(hit.point.clone()), vertices[0], vertices[1], vertices[2], new THREE.Vector3())
      if (!bary) throw new Error('Degenerate saddle bearing surface')
      this.seatPoints.push({ ids, weights: bary.toArray() })
    }
  }

  get hasBearingSurface(): boolean { return this.surfaces.length > 0 }

  /** `publish` refreshes the rider's subtree; skip it only when the renderer updates the scene next. */
  align(publish = true): void {
    const surface = this.surfaces.find(({ mesh }) => {
      for (let node: THREE.Object3D | null = mesh; node && node !== this.rider; node = node.parent) if (!node.visible) return false
      return true
    })
    if (!surface) return
    let riderToWorld = surface.mesh.matrixWorld, saddleToWorld = this.saddle.matrixWorld
    if (surface.mesh.bindMode === THREE.AttachedBindMode && this.saddle.bindMode === THREE.AttachedBindMode) {
      // Attached skins: matrixWorld · bindMatrixInverse = I, so a sampled point is the
      // bones' weighted skinning alone. Refresh only the unique ancestor-to-bone chain
      // once in topological order instead of per-bone updateWorldMatrix(true, false).
      // Re-invert the live bindMatrixInverse each frame because renderer.render()
      // overwrites it with the previous frame's inverse mesh matrixWorld.
      this.rider.parent?.updateWorldMatrix(true, false)
      this.mount.updateWorldMatrix(true, false)
      let riderChain = this.surfaceChains.get(surface.mesh)
      if (!riderChain) {
        riderChain = buildBoneUpdateChain(influencingBones(surface.mesh, surface.points), this.rider.parent)
        this.surfaceChains.set(surface.mesh, riderChain)
      }
      if (!this.saddleChain) {
        this.saddleChain = buildBoneUpdateChain(influencingBones(this.saddle, this.seatPoints), this.mount)
      }
      refreshBoneChain(riderChain)
      refreshBoneChain(this.saddleChain)
      riderToWorld = this.riderToWorld.copy(surface.mesh.bindMatrixInverse).invert()
      saddleToWorld = this.saddleToWorld.copy(this.saddle.bindMatrixInverse).invert()
    } else {
      this.rider.updateWorldMatrix(true, false); this.rider.updateMatrixWorld(true)
      this.mount.updateWorldMatrix(true, false); this.mount.updateMatrixWorld(true)
    }
    let correction = -Infinity
    for (let i = 0; i < this.seatPoints.length; i++) {
      this.mount.worldToLocal(readPoint(surface.mesh, surface.points[i], this.a, this.vertex, riderToWorld))
      this.mount.worldToLocal(readPoint(this.saddle, this.seatPoints[i], this.b, this.vertex, saddleToWorld))
      correction = Math.max(correction, this.b.y - this.a.y + .002)
    }
    this.correction = correction
    this.applyCorrection(correction)
    if (publish) this.rider.updateMatrixWorld(true)
  }

  /** Cheap far-distance path: reuse the last lift on the current mount/rider transforms. */
  reapply(): boolean {
    if (this.correction === null || !this.rider.parent) return false
    this.mount.updateWorldMatrix(true, false)
    this.rider.parent.updateWorldMatrix(true, false)
    this.applyCorrection(this.correction)
    return true
  }

  private applyCorrection(correction: number): void {
    this.mount.localToWorld(this.a.set(0, 0, 0))
    this.mount.localToWorld(this.b.set(0, correction, 0))
    this.rider.parent!.worldToLocal(this.a); this.rider.parent!.worldToLocal(this.b)
    this.rider.position.add(this.b.sub(this.a))
  }
}
