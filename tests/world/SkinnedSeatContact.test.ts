import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { prepareSeatSupport, SkinnedSeatContact } from '../../src/world/SkinnedSeatContact'

interface TestNodeData {
  name: string
  visible: boolean
  parent: TestNodeData | null
  children: TestNodeData[]
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
  matrix: THREE.Matrix4
  matrixWorld: THREE.Matrix4
  matrixAutoUpdate: boolean
  layers: THREE.Layers
  userData: Record<string, unknown>
  isSkinnedMesh?: boolean
  bindMode?: THREE.BindMode
  bindMatrix?: THREE.Matrix4
  bindMatrixInverse?: THREE.Matrix4
  geometry?: unknown
  skeleton?: unknown
  addChild<T extends TestNodeData>(child: T): T
  traverse(visit: (object: THREE.Object3D) => void): void
  updateMatrix(): void
  updateWorldMatrix(updateParents?: boolean, updateChildren?: boolean): void
  updateMatrixWorld(force?: boolean): void
  getWorldPosition(target: THREE.Vector3): THREE.Vector3
  localToWorld(vector: THREE.Vector3): THREE.Vector3
  worldToLocal(vector: THREE.Vector3): THREE.Vector3
  computeBoundingBox?: () => void
  computeBoundingSphere?: () => void
  getVertexPosition?: (index: number, target: THREE.Vector3) => THREE.Vector3
  raycast?: (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void
}

type TestNode = TestNodeData & THREE.Object3D
type AttachedSkinnedTestMesh = TestNodeData & THREE.SkinnedMesh

const _inv = new THREE.Matrix4()
const _triA = new THREE.Vector3()
const _triB = new THREE.Vector3()
const _triC = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _baseVertex = new THREE.Vector3()
const _boneMatrix = new THREE.Matrix4()

function createNodeData(name: string): TestNodeData {
  const node: TestNodeData = {
    name,
    visible: true,
    parent: null,
    children: [],
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    matrix: new THREE.Matrix4(),
    matrixWorld: new THREE.Matrix4(),
    matrixAutoUpdate: true,
    layers: { test: () => true } as unknown as THREE.Layers,
    userData: {},
    addChild<T extends TestNodeData>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    },
    traverse(visit: (object: THREE.Object3D) => void): void {
      visit(this as unknown as THREE.Object3D)
      for (const child of this.children) child.traverse(visit)
    },
    updateMatrix(): void {
      this.matrix.compose(this.position, this.quaternion, this.scale)
    },
    updateWorldMatrix(updateParents = false, updateChildren = false): void {
      if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false)
      if (this.matrixAutoUpdate) this.updateMatrix()
      if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
      else this.matrixWorld.copy(this.matrix)
      if (updateChildren) {
        for (const child of this.children) child.updateWorldMatrix(false, true)
      }
    },
    updateMatrixWorld(force = false): void {
      if (this.matrixAutoUpdate) this.updateMatrix()
      if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
      else this.matrixWorld.copy(this.matrix)
      for (const child of this.children) child.updateMatrixWorld(force)
    },
    getWorldPosition(target: THREE.Vector3): THREE.Vector3 {
      this.updateWorldMatrix(true, false)
      return target.setFromMatrixPosition(this.matrixWorld)
    },
    localToWorld(vector: THREE.Vector3): THREE.Vector3 {
      this.updateWorldMatrix(true, false)
      return vector.applyMatrix4(this.matrixWorld)
    },
    worldToLocal(vector: THREE.Vector3): THREE.Vector3 {
      this.updateWorldMatrix(true, false)
      return vector.applyMatrix4(_inv.copy(this.matrixWorld).invert())
    },
  }
  return node
}

function createNode(name: string): TestNode {
  return createNodeData(name) as unknown as TestNode
}

function createBearingGeometry(localY: number) {
  const position = new THREE.BufferAttribute(new Float32Array([
    -0.5, localY, -0.5,
    -0.5, localY, 0.5,
    0.5, localY, 0.5,
    0.5, localY, -0.5,
  ]), 3)
  const skinIndex = new THREE.BufferAttribute(new Uint16Array(4 * 4), 4)
  const skinWeight = new THREE.BufferAttribute(new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]), 4)
  const index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1)
  const attributes = { position, skinIndex, skinWeight }
  return {
    attributes,
    index,
    getAttribute(name: string) {
      return attributes[name as keyof typeof attributes]
    },
  }
}

function createAttachedSkinnedQuad(name: string, localY: number, bone: TestNode): AttachedSkinnedTestMesh {
  const geometry = createBearingGeometry(localY)
  const base = createNodeData(name)
  const bindMatrix = new THREE.Matrix4()
  const bindMatrixInverse = new THREE.Matrix4()

  bone.updateWorldMatrix(true, false)
  const boneInverse = new THREE.Matrix4().copy(bone.matrixWorld).invert()

  base.isSkinnedMesh = true
  base.bindMode = THREE.AttachedBindMode
  base.bindMatrix = bindMatrix
  base.bindMatrixInverse = bindMatrixInverse
  base.geometry = geometry
  base.skeleton = {
    bones: [bone as unknown as THREE.Bone],
    boneInverses: [boneInverse],
    update(): void {},
  }
  base.updateWorldMatrix = function (updateParents = false, updateChildren = false): void {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false)
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
    else this.matrixWorld.copy(this.matrix)
    bindMatrixInverse.copy(this.matrixWorld).invert()
    if (updateChildren) {
      for (const child of this.children) child.updateWorldMatrix(false, true)
    }
  }
  base.updateMatrixWorld = function (force = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
    else this.matrixWorld.copy(this.matrix)
    bindMatrixInverse.copy(this.matrixWorld).invert()
    for (const child of this.children) child.updateMatrixWorld(force)
  }
  base.computeBoundingBox = () => {}
  base.computeBoundingSphere = () => {}
  base.getVertexPosition = function (index: number, target: THREE.Vector3): THREE.Vector3 {
    const pos = geometry.attributes.position
    target.fromBufferAttribute(pos, index)
    _baseVertex.copy(target).applyMatrix4(bindMatrix)
    _boneMatrix.multiplyMatrices(bone.matrixWorld, boneInverse)
    return target.copy(_baseVertex).applyMatrix4(_boneMatrix).applyMatrix4(bindMatrixInverse)
  }
  base.raycast = function (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const pos = geometry.attributes.position
    const idx = geometry.index
    for (let f = 0; f < idx.count; f += 3) {
      const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2)
      _triA.fromBufferAttribute(pos, a).applyMatrix4(this.matrixWorld)
      _triB.fromBufferAttribute(pos, b).applyMatrix4(this.matrixWorld)
      _triC.fromBufferAttribute(pos, c).applyMatrix4(this.matrixWorld)
      if (raycaster.ray.intersectTriangle(_triA, _triB, _triC, true, _hit)) {
        intersects.push({
          distance: raycaster.ray.origin.distanceTo(_hit),
          point: _hit.clone(),
          face: { a, b, c, normal: new THREE.Vector3(0, 1, 0), materialIndex: 0 },
          object: this as unknown as THREE.Object3D,
        })
      }
    }
  }

  const mesh = Object.setPrototypeOf(base, THREE.SkinnedMesh.prototype) as AttachedSkinnedTestMesh
  mesh.updateMatrixWorld(true)
  bindMatrix.copy(mesh.matrixWorld)
  bindMatrixInverse.copy(mesh.matrixWorld).invert()
  return mesh
}

function buildSeatFixture() {
  const scene = createNode('scene')
  const mountGroup = scene.addChild(createNode('mount-group'))
  const mountRoot = mountGroup.addChild(createNode('mount-root'))
  const saddleSeat = mountRoot.addChild(createNode('socket_saddle_seat'))
  saddleSeat.position.set(0, 1.0, 0)
  const saddleBone = mountRoot.addChild(createNode('saddle-bone'))
  const saddleMesh = mountRoot.addChild(createAttachedSkinnedQuad('saddle', 1.0, saddleBone))

  const pelvisHeight = 0.8
  const riderGroup = scene.addChild(createNode('rider-group'))
  const riderVisual = riderGroup.addChild(createNode('rider-visual'))
  const riderBone = riderVisual.addChild(createNode('rider-bone'))
  const riderMesh = riderVisual.addChild(createAttachedSkinnedQuad('rider-body', pelvisHeight, riderBone))
  prepareSeatSupport(riderMesh, [[-0.1, pelvisHeight, 0], [0.1, pelvisHeight, 0]])

  // Match initial mount placement before constructing SkinnedSeatContact.
  mountGroup.position.set(0, 0, 0)
  riderGroup.position.set(0, 1.0, 0)
  riderVisual.position.set(0, -pelvisHeight, 0)
  scene.updateMatrixWorld(true)

  const contact = new SkinnedSeatContact(riderVisual, mountRoot, saddleMesh, saddleSeat)
  return { scene, mountGroup, mountRoot, saddleSeat, saddleBone, riderGroup, riderVisual, riderBone, riderMesh, pelvisHeight, contact }
}

describe('SkinnedSeatContact', () => {
  it('keeps attached-bind riders seated without compounding lift across terrain slopes and yaw turns', () => {
    const f = buildSeatFixture()
    const worldVertex = new THREE.Vector3()
    const path = [
      { x: 0, y: 0, z: 0, yaw: 0, saddleAnimY: 0 },
      { x: 4, y: 3.5, z: -2, yaw: 0.6, saddleAnimY: 0.04 },
      { x: 9, y: 8.2, z: -6, yaw: 1.4, saddleAnimY: -0.02 },
      { x: 14, y: 1.4, z: -11, yaw: 2.3, saddleAnimY: 0.05 },
      { x: 19, y: -4.6, z: -15, yaw: -1.1, saddleAnimY: 0 },
      { x: 25, y: 12.0, z: -18, yaw: 0.25, saddleAnimY: 0.03 },
    ]

    for (const step of path) {
      f.mountGroup.position.set(step.x, step.y, step.z)
      f.mountGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), step.yaw)
      f.saddleBone.position.y = step.saddleAnimY

      // Match NPC._syncToMount() + _alignExternalVisualToMount(true): reset visual lift before fitMountedSeat(false).
      f.saddleSeat.getWorldPosition(f.riderGroup.position)
      f.riderGroup.quaternion.copy(f.mountGroup.quaternion)
      f.riderVisual.position.set(0, -f.pelvisHeight, 0)

      f.contact.align(false)
      // Simulate renderer.render() refreshing the full scene and rewriting AttachedBindMode bindMatrixInverse.
      f.scene.updateMatrixWorld(true)

      const expectedRiderVisualY = -f.pelvisHeight + step.saddleAnimY + 0.002
      expect(f.riderVisual.position.y).toBeCloseTo(expectedRiderVisualY, 4)

      f.riderMesh.getVertexPosition(0, worldVertex).applyMatrix4(f.riderMesh.matrixWorld)
      const expectedSeatWorldY = step.y + 1.0 + step.saddleAnimY + 0.002
      expect(worldVertex.y).toBeCloseTo(expectedSeatWorldY, 4)
    }
  })
})
