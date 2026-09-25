import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type AnimalMountKind = 'BLACK_CAT' | 'CORGI'

export interface AnimalMountManifest {
  schemaVersion: 1
  id: 'black_cat' | 'corgi'
  status: 'ready'
  file: 'mount.glb'
  forward: '+Z'
  shoulderHeightM: number
  saddleHeightM: number
  saddleWidthM: number
  triangles: { lod0: number; lod1: number; lod2: number }
  bones: string[]
  sockets: string[]
  authorship: string
}

export interface AnimalMountModel {
  root: THREE.Group
  lod: THREE.LOD
  skeleton: THREE.Skeleton
  saddleSeat: THREE.Object3D
  cameraSocket: THREE.Object3D
}

const BONES = [
  'root', 'body', 'chest_spine', 'neck', 'head',
  'front_l_upper_leg', 'front_l_lower_leg', 'front_l_paw',
  'front_r_upper_leg', 'front_r_lower_leg', 'front_r_paw',
  'rear_l_upper_leg', 'rear_l_lower_leg', 'rear_l_paw',
  'rear_r_upper_leg', 'rear_r_lower_leg', 'rear_r_paw',
]
const LOD_DISTANCES = [0, 20, 42] as const
const idFor = (kind: AnimalMountKind): AnimalMountManifest['id'] => kind === 'BLACK_CAT' ? 'black_cat' : 'corgi'

export function validateAnimalMountManifest(manifest: AnimalMountManifest, kind: AnimalMountKind): void {
  if (manifest.schemaVersion !== 1 || manifest.id !== idFor(kind) || manifest.status !== 'ready' || manifest.file !== 'mount.glb') {
    throw new Error(`${kind} mount manifest is not ready`)
  }
  if (manifest.forward !== '+Z' || manifest.shoulderHeightM < 1.55 || manifest.shoulderHeightM > 1.65) {
    throw new Error(`${kind} mount orientation or shoulder height is invalid`)
  }
  if (manifest.saddleHeightM < 1.7 || manifest.saddleHeightM > 1.9 || manifest.saddleWidthM < .6 || manifest.saddleWidthM > .8) {
    throw new Error(`${kind} mount rider fit is outside the horse range`)
  }
  if (manifest.triangles.lod0 > 16000 || manifest.triangles.lod1 > 6500 || manifest.triangles.lod2 > 2500) {
    throw new Error(`${kind} mount exceeds the low-poly budget`)
  }
  for (const name of [...BONES, kind === 'BLACK_CAT' ? 'tail_base' : 'tail', 'socket_saddle_seat', 'socket_camera']) {
    if (name.startsWith('socket_') ? !manifest.sockets.includes(name) : !manifest.bones.includes(name)) {
      throw new Error(`${kind} mount is missing ${name}`)
    }
  }
}

function requireNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name)
  if (!node) throw new Error(`Animal mount GLB is missing ${name}`)
  return node
}

function createFromTemplate(kind: AnimalMountKind, template: THREE.Group): AnimalMountModel {
  const root = cloneSkeleton(template) as THREE.Group
  root.name = `${idFor(kind)}_mount`
  const skinned: THREE.SkinnedMesh[] = []
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skinned.push(node)
  })
  if (!skinned.length) throw new Error(`${kind} mount has no skinned meshes`)
  const skeleton = skinned[0].skeleton
  for (const mesh of skinned) {
    if (mesh.skeleton !== skeleton) mesh.bind(skeleton, mesh.bindMatrix)
    mesh.castShadow = mesh.name.includes('_body_lod0') || mesh.name.includes('saddle')
    mesh.receiveShadow = true
  }
  const lod = new THREE.LOD()
  lod.name = `${idFor(kind)}_lod`
  root.updateWorldMatrix(true, true)
  for (let index = 0; index < 3; index++) {
    const body = requireNode(root, `${idFor(kind)}_body_lod${index}`)
    lod.attach(body)
    lod.addLevel(body, LOD_DISTANCES[index], .1)
  }
  root.add(lod)
  const saddleSeat = requireNode(root, 'socket_saddle_seat')
  const cameraSocket = requireNode(root, 'socket_camera')
  return { root, lod, skeleton, saddleSeat, cameraSocket }
}

/** Node test fixture keeps gameplay tests synchronous without shipping fallback art. */
function createTestFixture(kind: AnimalMountKind): AnimalMountModel {
  const root = new THREE.Group()
  const rootBone = new THREE.Bone()
  rootBone.name = 'root'
  root.add(rootBone)
  const body = new THREE.Bone()
  body.name = 'body'
  body.position.y = 1.2
  rootBone.add(body)
  const bones = [rootBone, body]
  for (const name of BONES.slice(2)) {
    const bone = new THREE.Bone()
    bone.name = name
    body.add(bone)
    bones.push(bone)
  }
  const tail = new THREE.Bone()
  tail.name = kind === 'BLACK_CAT' ? 'tail_base' : 'tail'
  body.add(tail)
  bones.push(tail)
  const saddleSeat = new THREE.Object3D()
  saddleSeat.name = 'socket_saddle_seat'
  saddleSeat.position.set(0, .62, -.08)
  body.add(saddleSeat)
  const cameraSocket = new THREE.Object3D()
  cameraSocket.name = 'socket_camera'
  cameraSocket.position.set(0, 1.1, .35)
  body.add(cameraSocket)
  const lod = new THREE.LOD()
  root.add(lod)
  return { root, lod, skeleton: new THREE.Skeleton(bones), saddleSeat, cameraSocket }
}

export class AnimalMountRegistry {
  private static templates = new Map<AnimalMountKind, THREE.Group>()
  private static preloadPromise: Promise<void> | null = null

  static preload(): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = this.load().catch((error) => {
        this.preloadPromise = null
        throw error
      })
    }
    return this.preloadPromise
  }

  private static async load(): Promise<void> {
    const loader = new GLTFLoader()
    await Promise.all((['BLACK_CAT', 'CORGI'] as AnimalMountKind[]).map(async (kind) => {
      const base = `/models/mounts/v1/${idFor(kind)}`
      const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`Cannot load ${kind} mount manifest (${response.status})`)
      const manifest = await response.json() as AnimalMountManifest
      validateAnimalMountManifest(manifest, kind)
      const gltf = await loader.loadAsync(`${base}/${manifest.file}`)
      createFromTemplate(kind, gltf.scene)
      this.templates.set(kind, gltf.scene)
    }))
  }

  static createInstance(kind: AnimalMountKind): AnimalMountModel {
    const template = this.templates.get(kind)
    if (template) return createFromTemplate(kind, template)
    if (import.meta.env.MODE === 'test') return createTestFixture(kind)
    throw new Error(`${kind} mount model was not preloaded`)
  }
}
