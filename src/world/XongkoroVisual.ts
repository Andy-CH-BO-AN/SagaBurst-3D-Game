import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { XONGKORO_VISUAL } from '../movement/XongkoroConfig'

const BASE = publicAssetUrl('models/mounts/v2/xongkoro')
const SOCKETS = ['socket_rider_standing', 'socket_attack_head', 'socket_attack_claw_left', 'socket_attack_claw_right'] as const
const LOD_DISTANCES = XONGKORO_VISUAL.lodDistances

export interface XongkoroVisualState {
  flying: boolean
  sprinting: boolean
  attackWeight: number
  dead: boolean
}

/** Source-derived eagle. Shared render resources; private skeleton, mixer and pose state. */
export class XongkoroVisual {
  private static template: GLTF | null = null
  private static loading: Promise<void> | null = null
  static get ready(): boolean { return this.template !== null }

  static preload(): Promise<void> {
    this.loading ??= this.load().catch(error => { this.loading = null; throw error })
    return this.loading
  }

  private static async load(): Promise<void> {
    const response = await fetch(`${BASE}/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cannot load xongkoro manifest (${response.status})`)
    const manifest = await response.json()
    if (manifest.id !== 'xongkoro' || manifest.status !== 'ready' || manifest.forward !== '+Z'
      || manifest.bodyLengthMeters !== 10 || !manifest.source?.license || manifest.file !== 'xongkoro.glb') {
      throw new Error('xongkoro source, scale or asset contract is invalid')
    }
    const template = await new GLTFLoader().loadAsync(`${BASE}/${manifest.file}`)
    for (const name of [...SOCKETS, ...[0, 1, 2].map(index => `eagle_body_lod${index}`), 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Thigh', 'Bip01_R_Thigh']) {
      if (!template.scene.getObjectByName(name)) throw new Error(`xongkoro is missing ${name}`)
    }
    if (!(template.scene.getObjectByName('eagle_body_lod0') instanceof THREE.SkinnedMesh)
      || template.scene.getObjectByName('socket_rider_standing')?.parent?.name !== 'Bip01_Spine1'
      || !template.animations.some(clip => clip.name === 'fly')) throw new Error('xongkoro rig or flight animation is invalid')
    template.scene.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    this.template = template
  }

  readonly root: THREE.Group
  readonly lod = new THREE.LOD()
  readonly standingSocket: THREE.Object3D
  readonly headAttackSocket: THREE.Object3D
  readonly leftClawAttackSocket: THREE.Object3D
  readonly rightClawAttackSocket: THREE.Object3D
  readonly skeleton: THREE.Skeleton
  readonly mixer: THREE.AnimationMixer
  private readonly flight: THREE.AnimationAction
  private readonly neck: THREE.Object3D
  private readonly head: THREE.Object3D
  private readonly thighs: THREE.Object3D[]
  private readonly saved: Array<{ node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }>
  private posed = false
  private readonly worldPosition = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly rootRotation = new THREE.Quaternion()
  private readonly worldRotation = new THREE.Quaternion()
  private readonly inverseParent = new THREE.Quaternion()
  private readonly rotation = new THREE.Quaternion()
  private readonly axis = new THREE.Vector3()

  constructor() {
    const template = XongkoroVisual.template
    if (!template) throw new Error('xongkoro assets were not preloaded')
    this.root = cloneSkeleton(template.scene) as THREE.Group
    this.root.name = 'xongkoro-mount-v2'
    const body = this.root.getObjectByName('eagle_body_lod0') as THREE.SkinnedMesh
    this.skeleton = body.skeleton
    this.root.updateMatrixWorld(true)
    for (const [index, distance] of LOD_DISTANCES.entries()) {
      const mesh = this.root.getObjectByName(`eagle_body_lod${index}`) as THREE.SkinnedMesh
      if (mesh.skeleton !== this.skeleton) mesh.bind(this.skeleton, mesh.bindMatrix)
      // The authored flapping envelope extends beyond the reference-pose bounds.
      mesh.frustumCulled = false
      this.lod.attach(mesh)
      this.lod.addLevel(mesh, distance, .1)
      mesh.visible = index === 0
    }
    this.lod.name = 'xongkoro-lod'
    this.root.add(this.lod)
    this.standingSocket = this.root.getObjectByName(SOCKETS[0])!
    this.headAttackSocket = this.root.getObjectByName(SOCKETS[1])!
    this.leftClawAttackSocket = this.root.getObjectByName(SOCKETS[2])!
    this.rightClawAttackSocket = this.root.getObjectByName(SOCKETS[3])!
    this.neck = this.root.getObjectByName('Bip01_Neck')!
    this.head = this.root.getObjectByName('Bip01_Head')!
    this.thighs = ['Bip01_L_Thigh', 'Bip01_R_Thigh'].map(name => this.root.getObjectByName(name)!)
    this.saved = [this.neck, this.head, ...this.thighs].map(node => ({ node, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }))
    this.mixer = new THREE.AnimationMixer(this.root)
    this.flight = this.mixer.clipAction(template.animations.find(clip => clip.name === 'fly')!)
    this.flight.play()
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
  }

  setCameraDistance(distance: number): void {
    const level = distance >= LOD_DISTANCES[2] ? 2 : distance >= LOD_DISTANCES[1] ? 1 : 0
    for (const [index, entry] of this.lod.levels.entries()) entry.object.visible = index === level
  }

  private restorePose(): void {
    if (!this.posed) return
    for (const saved of this.saved) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.quaternion) }
    this.posed = false
  }

  private extend(node: THREE.Object3D, forward: number): void {
    node.getWorldPosition(this.worldPosition)
    this.offset.set(0, 0, forward).applyQuaternion(this.rootRotation)
    this.worldPosition.add(this.offset)
    node.parent!.worldToLocal(this.worldPosition)
    node.position.copy(this.worldPosition)
    node.updateWorldMatrix(false, true)
  }

  private rotate(node: THREE.Object3D, angle: number): void {
    node.getWorldQuaternion(this.worldRotation)
    node.parent!.getWorldQuaternion(this.inverseParent).invert()
    this.rotation.setFromAxisAngle(this.axis, angle)
    node.quaternion.copy(this.inverseParent).multiply(this.rotation).multiply(this.worldRotation)
    node.updateWorldMatrix(false, true)
  }

  /** Physics supplies the attack envelope; LOD never owns its time or contacts. */
  update(dt: number, state: XongkoroVisualState): void {
    if (!Number.isFinite(dt) || dt < 0) return
    this.restorePose()
    // With no authored landing clip, use the raised-wing reference when alive
    // on support; holding an arbitrary downstroke would intersect the ground.
    if (!state.flying && !state.dead) this.flight.time = 0
    this.flight.paused = !state.flying || state.dead
    this.flight.setEffectiveTimeScale(state.sprinting ? XONGKORO_VISUAL.sprintFlapRate : 1)
    this.mixer.update(dt)
    this.root.updateWorldMatrix(true, true)
    const weight = state.dead ? 0 : THREE.MathUtils.clamp(state.attackWeight, 0, 1)
    if (weight > 0) {
      for (const saved of this.saved) { saved.position.copy(saved.node.position); saved.quaternion.copy(saved.node.quaternion) }
      this.posed = true
      this.root.getWorldQuaternion(this.rootRotation)
      this.axis.set(1, 0, 0).applyQuaternion(this.rootRotation)
      this.extend(this.neck, XONGKORO_VISUAL.attackNeckExtension * weight)
      this.extend(this.head, XONGKORO_VISUAL.attackHeadExtension * weight)
      this.rotate(this.neck, XONGKORO_VISUAL.attackNeckPitch * weight)
      for (const thigh of this.thighs) this.rotate(thigh, XONGKORO_VISUAL.attackClawPitch * weight)
    }
    this.root.updateWorldMatrix(true, true)
  }

  dispose(): void {
    this.restorePose()
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.root.removeFromParent()
    // Geometry, material and textures remain owned by the shared template.
  }
}
