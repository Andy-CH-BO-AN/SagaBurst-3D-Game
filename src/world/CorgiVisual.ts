import { publicAssetUrl } from '../assets/publicAssetUrl'
import * as THREE from 'three'
import { CorgiSeatContact } from './CorgiSeatContact'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createQuadrupedAssetPreload } from './QuadrupedAssetPreload'
import {
  isQuadrupedAnimationState,
  quadrupedLocomotionClipForSpeed,
  type QuadrupedAnimationState,
  type QuadrupedLocomotionState,
  type QuadrupedOneShotState,
} from './QuadrupedMountAnimation'

export const CORGI_DIMENSIONS = { shoulder: 1.30, bodyLength: 3.245, saddleHeight: 1.313627550125122 } as const
export const CORGI_RIDER_PELVIS_CLEARANCE = .17

const BASE = publicAssetUrl('models/mounts/v2/corgi')
const GAIT_SPEEDS = { walk: 2, run: 12 } as const

/** Original GLB geometry and PBR maps, with a fitted canine skin and independent playback. */
export class CorgiVisual {
  private static template: GLTF | null = null
  private static readonly preloadAsset = createQuadrupedAssetPreload({
    baseUrl: BASE, name: 'Corgi', bodyPrefix: 'corgi',
  }, template => { CorgiVisual.template = template })

  static preload(): Promise<void> { return this.preloadAsset() }

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
  private readonly actions = new Map<QuadrupedAnimationState, THREE.AnimationAction>()
  private current: QuadrupedAnimationState = 'idle'
  private currentAction: THREE.AnimationAction
  private locomotion: QuadrupedLocomotionState = 'idle'
  private oneShot: QuadrupedOneShotState | null = null
  private oneShotAction: THREE.AnimationAction | null = null
  private oneShotDuration = 0
  private paused = false
  private studio = false
  private elapsed = 0
  private playbackRate = 1
  private requestedPlaybackRate = 1

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
    for (const clip of template.animations) {
      if (isQuadrupedAnimationState(clip.name)) this.actions.set(clip.name, this.mixer.clipAction(clip))
    }
    this.currentAction = this.actions.get('idle')!
    this.play('idle', true)
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
  }

  private play(clip: QuadrupedAnimationState, immediate = false): void {
    const previous = this.currentAction
    const next = this.actions.get(clip)!
    const once = clip === 'jump' || clip === 'land' || clip === 'hit' || clip === 'death'
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(this.playbackRate)
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.play()
    if (previous !== next) {
      if (immediate) previous.stop()
      else previous.crossFadeTo(next, .12, false)
    }
    this.current = clip
    this.currentAction = next
  }

  setLocomotion(speed: number): void {
    this.studio = false
    this.locomotion = quadrupedLocomotionClipForSpeed(speed, this.locomotion)
    this.requestedPlaybackRate = this.locomotion === 'idle'
      ? 1 : Math.min(speed / GAIT_SPEEDS[this.locomotion], 3)
    if (this.oneShot || this.current === 'death') return
    this.playbackRate = this.requestedPlaybackRate
    if (this.current !== this.locomotion) this.play(this.locomotion)
    this.currentAction.setEffectiveTimeScale(this.playbackRate)
  }

  playOnce(clip: QuadrupedOneShotState): void {
    if (this.current === 'death') return
    const action = this.actions.get(clip)
    if (!action) return
    this.oneShot = clip
    this.oneShotAction = action
    this.oneShotDuration = action.getClip().duration
    this.playbackRate = 1
    this.play(clip)
  }

  playStudioClip(clip: QuadrupedAnimationState): void {
    if (!this.actions.has(clip)) return
    this.studio = true
    this.oneShot = null
    this.oneShotAction = null
    this.oneShotDuration = 0
    this.paused = false
    this.elapsed = 0
    this.playbackRate = 1
    this.requestedPlaybackRate = 1
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
    if (!this.studio && this.oneShotAction && this.oneShot !== 'jump' && this.oneShot !== 'death') {
      if (this.oneShotAction.time >= this.oneShotDuration) {
        this.oneShot = null
        this.oneShotAction = null
        this.playbackRate = this.requestedPlaybackRate
        this.play(this.locomotion)
      }
    }
    this.root.updateMatrixWorld(true)
  }

  debugState() {
    return { clip: this.current, time: this.elapsed, actionTime: this.currentAction.time, playbackRate: this.playbackRate, paused: this.paused, lod: this.lod.getCurrentLevel(), mixerCount: 1, skeletonCount: 1 }
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.root.removeFromParent()
    // Shared geometry, maps and materials belong to the asset template.
  }
}
