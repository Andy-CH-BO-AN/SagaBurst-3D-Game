import * as THREE from 'three'
import { CorgiSeatContact } from './CorgiSeatContact'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { HorseAnimationState } from './HorseAssetRegistry'

export const CORGI_DIMENSIONS = { shoulder: 1.30, bodyLength: 3.245, saddleHeight: 1.313627550125122 } as const
export const CORGI_RIDER_PELVIS_CLEARANCE = .17

const BASE = '/models/mounts/v2/corgi'
const CLIPS: HorseAnimationState[] = ['idle', 'walk', 'trot', 'canter', 'gallop', 'jump', 'land', 'hit', 'death']
const GAIT_SPEEDS = { walk: 2, trot: 4, canter: 7, gallop: 12 } as const

/** Original GLB geometry and PBR maps, with a fitted canine skin and independent playback. */
export class CorgiVisual {
  private static template: GLTF | null = null
  private static loading: Promise<void> | null = null

  static preload(): Promise<void> {
    this.loading ??= this.load().catch(error => { this.loading = null; throw error })
    return this.loading
  }

  private static async load(): Promise<void> {
    const response = await fetch(`${BASE}/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cannot load corgi manifest (${response.status})`)
    const manifest = await response.json()
    if (manifest.status !== 'ready' || manifest.forward !== '+Z' || !manifest.source?.license) {
      throw new Error('Corgi asset has not passed source and visual validation')
    }
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${BASE}/${manifest.file}`)
    for (const clip of CLIPS) {
      if (!gltf.animations.some(animation => animation.name === clip)) throw new Error(`Corgi is missing ${clip}`)
    }
    for (const name of ['corgi_body_lod0', 'corgi_body_lod1', 'corgi_body_lod2', 'socket_saddle_seat']) {
      if (!gltf.scene.getObjectByName(name)) throw new Error(`Corgi is missing ${name}`)
    }
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
    })
    this.template = gltf
  }

  private readonly contacts = new WeakMap<THREE.Object3D, CorgiSeatContact>()

  fitRider(rider: THREE.Object3D): void {
    let contact = this.contacts.get(rider)
    if (!contact) { contact = new CorgiSeatContact(rider, this.root); this.contacts.set(rider, contact) }
    contact.align()
  }

  readonly root: THREE.Group
  readonly saddleSeat: THREE.Object3D
  readonly riderPelvisSeat: THREE.Object3D
  readonly skeleton: THREE.Skeleton
  readonly mixer: THREE.AnimationMixer
  readonly lod = new THREE.LOD()
  private readonly actions = new Map<HorseAnimationState, THREE.AnimationAction>()
  private current: HorseAnimationState = 'idle'
  private locomotion: HorseAnimationState = 'idle'
  private oneShot: HorseAnimationState | null = null
  private paused = false
  private studio = false
  private elapsed = 0
  private playbackRate = 1

  constructor() {
    const template = CorgiVisual.template
    if (!template) throw new Error('Corgi assets were not preloaded')
    this.root = cloneSkeleton(template.scene) as THREE.Group
    this.root.name = 'corgi-mount-v2'
    const body = this.root.getObjectByName('corgi_body_lod0') as THREE.SkinnedMesh
    if (!body?.isSkinnedMesh) throw new Error('Corgi body has no fitted skeleton')
    this.skeleton = body.skeleton
    this.root.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) {
        if (object.skeleton !== this.skeleton) object.bind(this.skeleton, object.bindMatrix)
        object.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -.2), 3)
      }
    })
    this.root.updateMatrixWorld(true)
    this.lod.name = 'corgi-lod'
    for (const [index, distance] of [0, 18, 38].entries()) {
      const mesh = this.root.getObjectByName(`corgi_body_lod${index}`)!
      this.lod.attach(mesh)
      this.lod.addLevel(mesh, distance, .1)
      mesh.visible = index === 0
    }
    this.root.add(this.lod)
    this.saddleSeat = this.root.getObjectByName('socket_saddle_seat')!
    this.riderPelvisSeat = new THREE.Object3D()
    this.riderPelvisSeat.position.y = CORGI_RIDER_PELVIS_CLEARANCE
    this.saddleSeat.add(this.riderPelvisSeat)
    this.mixer = new THREE.AnimationMixer(this.root)
    for (const clip of template.animations) this.actions.set(clip.name as HorseAnimationState, this.mixer.clipAction(clip))
    this.play('idle', true)
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
  }

  private play(clip: HorseAnimationState, immediate = false): void {
    const previous = this.actions.get(this.current)!
    const next = this.actions.get(clip)!
    const once = ['jump', 'land', 'hit', 'death'].includes(clip)
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(this.playbackRate)
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.play()
    if (previous !== next) {
      if (immediate) previous.stop()
      else previous.crossFadeTo(next, .12, false)
    }
    this.current = clip
  }

  setLocomotion(speed: number): void {
    this.studio = false
    this.locomotion = speed > 9 ? 'gallop' : speed > 5 ? 'canter' : speed > 2.7 ? 'trot' : speed > .1 ? 'walk' : 'idle'
    if (this.oneShot || this.current === 'death') return
    const reference = GAIT_SPEEDS[this.locomotion as keyof typeof GAIT_SPEEDS]
    this.playbackRate = reference ? THREE.MathUtils.clamp(speed / reference, .5, 1.5) : 1
    if (this.current !== this.locomotion) this.play(this.locomotion)
    this.actions.get(this.current)!.setEffectiveTimeScale(this.playbackRate)
  }

  playOnce(clip: HorseAnimationState): void {
    if (this.current === 'death') return
    this.oneShot = clip
    this.playbackRate = 1
    this.play(clip)
  }

  playStudioClip(clip: HorseAnimationState): void {
    this.studio = true
    this.oneShot = null
    this.paused = false
    this.elapsed = 0
    this.playbackRate = 1
    this.mixer.stopAllAction()
    this.play(clip, true)
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
  }

  togglePaused(): boolean { this.paused = !this.paused; return this.paused }

  setEquipmentVisible(visible: boolean): void {
    for (const name of ['corgi_saddle_leather', 'corgi_saddle_binding', 'corgi_saddle_brass']) {
      this.root.getObjectByName(name)!.visible = visible
    }
  }

  update(dt: number): void {
    if (this.paused || !Number.isFinite(dt) || dt < 0) return
    this.elapsed += dt
    this.mixer.update(dt)
    // Jump stays tucked until physics sends land; death stays fallen.
    if (!this.studio && this.oneShot && this.oneShot !== 'jump' && this.oneShot !== 'death') {
      const action = this.actions.get(this.oneShot)!
      if (action.time >= action.getClip().duration) {
        this.oneShot = null
        this.playbackRate = 1
        this.play(this.locomotion)
      }
    }
    this.root.updateMatrixWorld(true)
  }

  debugState() {
    return { clip: this.current, time: this.elapsed, paused: this.paused, lod: this.lod.getCurrentLevel(), mixerCount: 1, skeletonCount: 1 }
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.root.removeFromParent()
    // Shared geometry, maps and materials belong to the asset template.
  }
}
