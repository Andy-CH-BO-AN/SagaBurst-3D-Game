import { CharacterEquipmentPose, createEquipmentPoseState, type EquipmentPoseState } from './CharacterEquipmentPose'
import { calibrateEquipmentFrames, calibrateLanceIdleAttachment, type EquipmentGripFrames } from './EquipmentAttachmentContract'
import { prepareEquipmentHandShape } from './EquipmentHandShape'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createEquipmentSocketProxies } from './HumanoidEquipmentSockets'
import { normalizeBowHandClips, prepareBowGripShape } from './CanonicalBowGripPose'
import type { HandGripFrame } from './BowAttachmentContract'
import { prepareBladeGrip } from './HumanoidBladeGrip'
import { prepareSwordHandShape } from './SwordHandShape'
import {
  AUDITED_ROMAN_LOD2_SHA256,
  consolidateRomanLod2,
  isRomanLod2ConsolidationAssetAudited,
  tryCreateRomanLod2ConsolidationTemplate,
  type RomanLod2ConsolidationTemplate,
} from './HumanoidLod2Consolidation'
import type { SwordGripFrame } from './SwordAttachmentContract'
import type {
  ArmRig,
  CharacterFaction,
  CharacterRig,
  CharacterVisualConfig,
  CharacterVisualParts,
  HumanoidAnimationController,
  HumanoidAnimationPlayOptions,
  HumanoidAnimationState,
  LegRig,
} from './CharacterVisuals'
import type { NpcSubphaseCollector } from '../debug/NpcSubphaseProfiler'

export interface HumanoidAnimationBinding {
  clip: HumanoidAnimationState
  source: 'Kevin Iglesias' | 'Quaternius'
  sourceClip: string
  loop: boolean
  duration: number
  nominalSpeed?: number
  events?: Record<string, number>
}

export const HUMANOID_LOD_DISTANCES = [0, 28, 60] as const
export const HUMANOID_ANIMATION_THROTTLE_DISTANCE = 28

export interface HumanoidAssetManifest {
  schemaVersion: 1
  id: string
  status: 'ready' | 'blocked'
  reason?: string
  blocker?: { code: string, message: string, resume?: string }
  attribution: string
  files: { lod0: string, lod1: string, lod2: string } | null
  metrics: {
    heightM: number
    shoulderWidthM: number
    neckLengthM: number
    triangles: { lod0: number, lod1: number, lod2: number }
    textures: { lod0: number, lod1: number, lod2: number }
  } | null
  boneMap?: string
  audit?: string
  handGripFrames?: {
    left?: {
      palmContactCenter: [number, number, number]
      palmNormal: [number, number, number]
      thumbDir: number
      thumbDirection: [number, number, number]
      fingerDirection: [number, number, number]
      wristCenter: [number, number, number]
      fingerBase: number
      thumbBaseCenter: [number, number, number]
    }
  }
  swordGripFrames?: Record<'lod0' | 'lod1' | 'lod2', SwordGripFrame>
  animations?: {
    embedded: HumanoidAnimationBinding[]
    runtimeGenerated: HumanoidAnimationState[]
  }
}

interface LoadedGltfWithSha256 {
  gltf: GLTF
  sha256?: string
}

async function loadGltfWithSha256(loader: GLTFLoader, url: string, resourcePath: string): Promise<LoadedGltfWithSha256> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot load humanoid asset ${url} (${response.status})`)
  const bytes = await response.arrayBuffer()
  const gltf = await loader.parseAsync(bytes, resourcePath)

  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) {
      console.warn('Roman LOD2 consolidation disabled: SHA-256 is unavailable in this runtime')
      return { gltf }
    }
    const digest = await subtle.digest('SHA-256', bytes)
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return { gltf, sha256 }
  } catch (error) {
    console.warn('Roman LOD2 consolidation disabled: failed to hash asset bytes', error)
    return { gltf }
  }
}

function readHandFrame(manifest: HumanoidAssetManifest): HandGripFrame | undefined {
  const data = manifest.handGripFrames?.left
  if (!data) return undefined
  return {
    palmContactCenter: new THREE.Vector3(...data.palmContactCenter),
    palmNormal: new THREE.Vector3(...data.palmNormal),
    thumbDir: data.thumbDir,
    thumbDirection: new THREE.Vector3(...data.thumbDirection),
    fingerDirection: new THREE.Vector3(...data.fingerDirection),
    wristCenter: new THREE.Vector3(...data.wristCenter),
    fingerBase: data.fingerBase,
    thumbBaseCenter: new THREE.Vector3(...data.thumbBaseCenter),
  }
}

interface HumanoidTemplate {
  manifest: HumanoidAssetManifest
  levels: GLTF[]
  bowClips?: THREE.AnimationClip[][]
  romanLod2Consolidation?: RomanLod2ConsolidationTemplate
}

export interface HumanoidCharacterInstance {
  root: THREE.Group
  skeleton: THREE.Skeleton
  mixers: THREE.AnimationMixer[]
  rig: CharacterRig
  bounds: THREE.Box3
  attribution: string
  update(dt: number, cameraDistance?: number): void
  dispose(): void
}

const REQUIRED_BONES = {
  hips: ['hips', 'pelvis', 'mixamorigHips'],
  spine: ['spine', 'mixamorigSpine'],
  chest: ['chest', 'spine_02', 'spine2', 'mixamorigSpine2'],
  neck: ['neck', 'mixamorigNeck'],
  head: ['head', 'mixamorigHead'],
  upperArmL: ['upper_arm_l', 'upperarm.l', 'upperarm_l', 'mixamorigLeftArm'],
  lowerArmL: ['lower_arm_l', 'lowerarm.l', 'lowerarm_l', 'mixamorigLeftForeArm'],
  handL: ['hand_l', 'hand.l', 'mixamorigLeftHand'],
  upperArmR: ['upper_arm_r', 'upperarm.r', 'upperarm_r', 'mixamorigRightArm'],
  lowerArmR: ['lower_arm_r', 'lowerarm.r', 'lowerarm_r', 'mixamorigRightForeArm'],
  handR: ['hand_r', 'hand.r', 'mixamorigRightHand'],
  upperLegL: ['upper_leg_l', 'upperleg.l', 'upperleg_l', 'mixamorigLeftUpLeg'],
  lowerLegL: ['lower_leg_l', 'lowerleg.l', 'lowerleg_l', 'mixamorigLeftLeg'],
  footL: ['foot_l', 'foot.l', 'mixamorigLeftFoot'],
  toeL: ['toe_l', 'toes.l', 'toe.l', 'mixamorigLeftToeBase'],
  upperLegR: ['upper_leg_r', 'upperleg.r', 'upperleg_r', 'mixamorigRightUpLeg'],
  lowerLegR: ['lower_leg_r', 'lowerleg.r', 'lowerleg_r', 'mixamorigRightLeg'],
  footR: ['foot_r', 'foot.r', 'mixamorigRightFoot'],
  toeR: ['toe_r', 'toes.r', 'toe.r', 'mixamorigRightToeBase'],
} as const

type RequiredBoneKey = keyof typeof REQUIRED_BONES

function quaternionValues(eulers: THREE.Vector3[]): number[] {
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()
  return eulers.flatMap((value) => {
    quaternion.setFromEuler(euler.set(value.x, value.y, value.z))
    return quaternion.toArray()
  })
}

function additiveClip(
  name: string,
  duration: number,
  tracks: Array<{ bone: string, times: number[], eulers: THREE.Vector3[] }>,
): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(name, duration, tracks.map((track) => new THREE.QuaternionKeyframeTrack(
    `${track.bone}.quaternion`,
    track.times,
    quaternionValues(track.eulers),
  )))
  clip.blendMode = THREE.AdditiveAnimationBlendMode
  return clip
}

const zero = () => new THREE.Vector3()
const pose = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

export function createProjectAnimationClips(): THREE.AnimationClip[] {
  const cycle = [0, 0.25, 0.5, 0.75, 1]
  return [
    additiveClip('idle', 2, [
      { bone: 'chest', times: [0, 1, 2], eulers: [zero(), pose(0.015, 0, 0), zero()] },
      { bone: 'head', times: [0, 1, 2], eulers: [zero(), pose(0, 0.018, 0), zero()] },
    ]),
    additiveClip('walk', 1, [
      { bone: 'upper_leg_l', times: cycle, eulers: [pose(0.5), zero(), pose(-0.5), zero(), pose(0.5)] },
      { bone: 'upper_leg_r', times: cycle, eulers: [pose(-0.5), zero(), pose(0.5), zero(), pose(-0.5)] },
      { bone: 'lower_leg_l', times: cycle, eulers: [pose(0.05), pose(0.5), pose(0.05), pose(0.12), pose(0.05)] },
      { bone: 'lower_leg_r', times: cycle, eulers: [pose(0.05), pose(0.12), pose(0.05), pose(0.5), pose(0.05)] },
      { bone: 'upper_arm_l', times: cycle, eulers: [pose(-0.3), zero(), pose(0.3), zero(), pose(-0.3)] },
      { bone: 'upper_arm_r', times: cycle, eulers: [pose(0.3), zero(), pose(-0.3), zero(), pose(0.3)] },
    ]),
    additiveClip('run', 0.7, [
      { bone: 'upper_leg_l', times: [0, 0.35, 0.7], eulers: [pose(0.72), pose(-0.72), pose(0.72)] },
      { bone: 'upper_leg_r', times: [0, 0.35, 0.7], eulers: [pose(-0.72), pose(0.72), pose(-0.72)] },
      { bone: 'upper_arm_l', times: [0, 0.35, 0.7], eulers: [pose(-0.55), pose(0.55), pose(-0.55)] },
      { bone: 'upper_arm_r', times: [0, 0.35, 0.7], eulers: [pose(0.55), pose(-0.55), pose(0.55)] },
    ]),
    // CharacterVisuals owns the mounted leg pose. Keep a named mixer action for
    // state/cross-fade compatibility without applying the same leg rotations a
    // second time on top of that pose.
    additiveClip('mounted', 1.5, []),
    additiveClip('death', 1, [
      { bone: 'hips', times: [0, 0.25, 1], eulers: [zero(), pose(0, 0, 0.15), pose(0, 0, 1.35)] },
      { bone: 'spine', times: [0, 0.25, 1], eulers: [zero(), pose(0.1, 0, 0.1), pose(0.2, 0, 0.25)] },
    ]),
  ]
}

const PROJECT_ANIMATION_CLIPS = createProjectAnimationClips()

/** Reuse authored Idle above the pelvis; mounted legs remain procedural.
 * An empty mounted clip otherwise blends the arms back to the bind T-pose. */
export function createMountedIdleClip(idle: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip('mounted', idle.duration, idle.tracks.filter(track =>
    /^(spine|chest|upper_chest|clavicle_|upper_arm_|lower_arm_|hand_|neck|head)/.test(track.name)))
}

const VIKING_HORN_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8d7656,
  roughness: 0.72,
  metalness: 0.02,
})

function createHornGeometry(side: -1 | 1): THREE.TubeGeometry {
  // Head-space measurements keep the complete fantasy accent inside the
  // approved 0.44 m span. Geometry and material are shared by every clone.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.065, 0, 0),
    new THREE.Vector3(side * 0.115, 0.035, 0.002),
    new THREE.Vector3(side * 0.165, 0.105, -0.004),
    new THREE.Vector3(side * 0.198, 0.195, -0.012),
    new THREE.Vector3(side * 0.185, 0.255, -0.02),
  ])
  return new THREE.TubeGeometry(curve, 18, 0.022, 8, false)
}

const VIKING_HORN_GEOMETRIES = [createHornGeometry(-1), createHornGeometry(1)] as const

export function createVikingHornAccessory(): THREE.Group {
  const accessory = new THREE.Group()
  accessory.name = 'viking-short-horns'
  VIKING_HORN_GEOMETRIES.forEach((geometry, index) => {
    const horn = new THREE.Mesh(geometry, VIKING_HORN_MATERIAL)
    horn.name = index === 0 ? 'viking-horn-l' : 'viking-horn-r'
    horn.castShadow = true
    accessory.add(horn)
  })
  return accessory
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findBone(root: THREE.Object3D, aliases: readonly string[]): THREE.Bone {
  const normalized = new Set(aliases.map(normalizeName))
  let match: THREE.Bone | undefined
  root.traverse((object) => {
    if (!match && object instanceof THREE.Bone && normalized.has(normalizeName(object.name))) match = object
  })
  if (!match) throw new Error(`Missing humanoid bone: ${aliases[0]}`)
  return match
}

function findSocket(root: THREE.Object3D, aliases: readonly string[], parent: THREE.Object3D, canonicalName: string): THREE.Object3D {
  const normalized = new Set(aliases.map(normalizeName))
  let socket: THREE.Object3D | undefined
  root.traverse((object) => {
    if (!socket && normalized.has(normalizeName(object.name))) socket = object
  })
  if (socket) return socket
  const generated = new THREE.Group()
  generated.name = canonicalName
  parent.add(generated)
  return generated
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let result: THREE.SkinnedMesh | undefined
  root.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object
  })
  if (!result) throw new Error('Humanoid GLB contains no SkinnedMesh')
  return result
}

export class MixerController implements HumanoidAnimationController {
  equipmentLayers: CharacterEquipmentPose[] = []
  private subphaseCollector: NpcSubphaseCollector | null = null
  private readonly equipmentState = createEquipmentPoseState()
  private readonly evaluatedEquipmentState = createEquipmentPoseState()
  private visibleLOD: number | null = null
  private transitionRemaining = 0
  private readonly pendingMixerDt: number[]
  setSubphaseCollector(collector: NpcSubphaseCollector | null): void {
    this.subphaseCollector = collector
  }

  setEquipmentState(state: Partial<EquipmentPoseState>): void {
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    Object.assign(this.equipmentState, state)
    if (phaseCollector) phaseCollector.endHumanoidPhase('equipmentState', phaseStart)
  }
  private needsLevel(index: number): boolean {
    return this.visibleLOD === null || index === 0 || index === this.visibleLOD || this.transitionRemaining > 0
  }
  private restoreEquipment(all = false): void {
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    this.equipmentLayers.forEach((layer, index) => { if (all || this.needsLevel(index)) layer.restore() })
    if (phaseCollector) phaseCollector.endHumanoidPhase('rigBoneApplication', phaseStart)
  }
  private finishPose(all = false): void {
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    const alive = this.equipmentState.alive
    this.equipmentState.alive = alive && this.poseLayersEnabled && this.current !== 'death'
    Object.assign(this.evaluatedEquipmentState, this.equipmentState)
    this.equipmentLayers.forEach((layer, index) => { if (all || this.needsLevel(index)) layer.apply(this.equipmentState) })
    this.equipmentState.alive = alive
    this.onPoseEvaluated?.()
    if (phaseCollector) phaseCollector.endHumanoidPhase('rigBoneApplication', phaseStart)
  }

  // Advance retained actions, including their loop/fade state, using Three's
  // own evaluator. Debt is settled before any action command changes semantics.
  private catchUp(index: number): void {
    const dt = this.pendingMixerDt[index]
    if (dt === 0) return
    this.equipmentLayers[index]?.restore()
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    this.mixers[index].update(dt)
    if (phaseCollector) phaseCollector.endHumanoidPhase('mixerUpdate', phaseStart)
    this.pendingMixerDt[index] = 0
  }
  private catchUpInactive(): void {
    for (let index = 1; index < this.mixers.length; index++) this.catchUp(index)
  }

  /** Called after Three selects its actual render LOD, before traversing meshes. */
  setVisibleLOD(index: number): void {
    if (index === this.visibleLOD) return
    this.visibleLOD = index
    this.catchUp(index)
    const layer = this.equipmentLayers[index]
    // Use the authority's last evaluated pose, not newer gameplay state from a
    // skipped distance tick. Do not consume the shared far accumulator here.
    layer?.restore()
    layer?.apply(this.evaluatedEquipmentState)
  }

  /** Asset-owned socket followers run after the single pose evaluation. */
  onPoseEvaluated?: () => void
  private poseLayersEnabled = true
  private readonly bowLegActions = new Map<string, THREE.AnimationAction[]>()
  private bowLegState: string | null = null
  private readonly actions = new Map<HumanoidAnimationState, THREE.AnimationAction[]>()
  private readonly rawActions = new Map<HumanoidAnimationState, THREE.AnimationAction[]>()
  private readonly durations = new Map<HumanoidAnimationState, number>()
  private current: HumanoidAnimationState | null = null
  private farAccumulator = 0
  private readonly bowMeshes: THREE.SkinnedMesh[] = []
  private readonly swordMeshes: THREE.SkinnedMesh[] = []
  private swordHandEnabled = false

  constructor(private readonly mixers: THREE.AnimationMixer[], clipsPerLevel: THREE.AnimationClip[][], rawClipsPerLevel = clipsPerLevel) {
    this.pendingMixerDt = mixers.map(() => 0)
    for (const mixer of mixers) (mixer.getRoot() as THREE.Object3D).traverse(object => {
      if (object instanceof THREE.SkinnedMesh && object.morphTargetDictionary?.bowGrip !== undefined) this.bowMeshes.push(object)
    })
    for (const mixer of mixers) (mixer.getRoot() as THREE.Object3D).traverse(object => {
      if (object instanceof THREE.SkinnedMesh && object.morphTargetDictionary?.swordHand !== undefined) this.swordMeshes.push(object)
    })
    const names = new Set(clipsPerLevel.flatMap((clips) => clips.map((clip) => clip.name as HumanoidAnimationState)))
    for (const name of names) {
      this.rawActions.set(name, mixers.flatMap((mixer, index) => {
        const clip = rawClipsPerLevel[index].find((candidate) => candidate.name === name)
        return clip ? [mixer.clipAction(clip)] : []
      }))
      const actions = mixers.flatMap((mixer, index) => {
        const clip = clipsPerLevel[index].find((candidate) => candidate.name === name)
        if (!clip) return []
        const isLeg = (track: THREE.KeyframeTrack) => /^(upper_leg_|lower_leg_|foot_|toe_)/.test(track.name)
        if (name === 'idle' || name === 'walk' || name === 'run') {
          const legs = new THREE.AnimationClip(`${name}:bowLegs`, clip.duration, clip.tracks.filter(isLeg))
          const actions = this.bowLegActions.get(name) ?? []
          actions.push(mixer.clipAction(legs))
          this.bowLegActions.set(name, actions)
        }
        const upperBow = name === 'bowLoad' || name === 'bowHold' || name === 'bowRelease'
        return [mixer.clipAction(upperBow && clip.tracks.some(isLeg)
          ? new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((track) => !isLeg(track)))
          : clip)]
      })
      this.actions.set(name, actions)
      const duration = clipsPerLevel[0].find((clip) => clip.name === name)?.duration
      if (duration !== undefined) this.durations.set(name, duration)
    }
  }

  has(state: HumanoidAnimationState): boolean {
    return (this.actions.get(state)?.length ?? 0) === this.mixers.length
  }

  setSwordHandShape(enabled: boolean): void {
    if (this.swordHandEnabled === enabled) return
    this.swordHandEnabled = enabled
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    for (const mesh of this.swordMeshes) mesh.morphTargetInfluences![mesh.morphTargetDictionary!.swordHand] = enabled ? 1 : 0
    if (phaseCollector) phaseCollector.endHumanoidPhase('equipmentState', phaseStart)
  }

  setPoseLayersEnabled(enabled: boolean): void {
    this.stop()
    this.poseLayersEnabled = enabled
  }

  setBowLocomotion(state: 'idle' | 'walk' | 'run', timeScale: number): void {
    if (this.bowLegState !== state || (this.bowLegActions.get(state) ?? []).some(action => action.timeScale !== timeScale)) this.catchUpInactive()
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    const phaseStart = phaseCollector ? performance.now() : 0
    if (this.bowLegState !== state) {
      for (const action of this.bowLegActions.get(this.bowLegState ?? '') ?? []) action.stop()
      for (const action of this.bowLegActions.get(state) ?? []) action.reset().play()
      this.bowLegState = state
    }
    for (const action of this.bowLegActions.get(state) ?? []) action.timeScale = timeScale
    if (phaseCollector) phaseCollector.endHumanoidPhase('equipmentState', phaseStart)
  }

  getDuration(state: HumanoidAnimationState): number | undefined {
    return this.durations.get(state)
  }

  play(state: HumanoidAnimationState, options: HumanoidAnimationPlayOptions = {}): boolean {
    const bindings = this.poseLayersEnabled ? this.actions : this.rawActions
    const next = bindings.get(state) ?? []
    if (next.length !== this.mixers.length) return false
    const loop = options.loop ?? true
    const timeScale = options.timeScale ?? 1
    const loopMode = loop ? THREE.LoopRepeat : THREE.LoopOnce
    if (state !== this.current || options.startNormalizedTime !== undefined
      || next.some(action => action.timeScale !== timeScale || action.loop !== loopMode || action.paused)) this.catchUpInactive()
    if (this.poseLayersEnabled && (state === 'bowLoad' || state === 'bowHold' || state === 'bowRelease')) {
      if (!this.bowLegState) this.setBowLocomotion('idle', 1)
    } else if (this.bowLegState) {
      for (const action of this.bowLegActions.get(this.bowLegState) ?? []) action.stop()
      this.bowLegState = null
    }
    const fadeSeconds = options.fadeSeconds ?? 0.12
    if (state === this.current) {
      const applyCurrentState = () => {
        for (const action of next) {
          action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
          action.clampWhenFinished = !loop
          action.paused = false
          action.timeScale = timeScale
          if (options.startNormalizedTime !== undefined) {
            action.time = THREE.MathUtils.clamp(options.startNormalizedTime, 0, 1) * action.getClip().duration
          }
        }
      }
      const phase = state === 'idle' || state === 'walk' || state === 'run' || state === 'mounted'
        ? 'locomotionState'
        : 'equipmentState'
      const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
      if (phaseCollector) {
        const phaseStart = performance.now()
        applyCurrentState()
        phaseCollector.endHumanoidPhase(phase, phaseStart)
      } else {
        applyCurrentState()
      }
      return true
    }
    // New bindings must capture the base. Re-selecting the active locomotion
    // after an NPC update must not erase its completed equipment pose.
    this.transitionRemaining = Math.max(this.transitionRemaining, fadeSeconds)
    this.restoreEquipment(true)
    const previous = this.current ? bindings.get(this.current) ?? [] : []
    for (const action of previous) action.fadeOut(fadeSeconds)
    for (const action of next) {
      action.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
      action.clampWhenFinished = !loop
      action.timeScale = timeScale
      if (options.startNormalizedTime !== undefined) {
        action.time = THREE.MathUtils.clamp(options.startNormalizedTime, 0, 1) * action.getClip().duration
      }
      action.fadeIn(fadeSeconds).play()
    }
    this.current = state
    for (const mesh of this.bowMeshes) mesh.morphTargetInfluences![mesh.morphTargetDictionary!.bowGrip] = this.poseLayersEnabled && state.startsWith('bow') ? 1 : 0
    // Binding a new clip restores the overlay base. Reapply it and its socket
    // followers now, since the next distance-throttled update may be skipped.
    this.finishPose(true)
    return true
  }

  seek(state: HumanoidAnimationState, normalizedTime: number): boolean {
    // A paused action may skip an unchanged PropertyMixer write. Never restore
    // last frame's overlay base AFTER evaluating the newly requested sample.
    if (!this.play(state, { fadeSeconds: this.current === state ? 0 : 0.12, loop: false })) return false
    // Explicit seeks keep the existing all-level sampling contract (bow draw
    // and studio scrubbing); settle locomotion time before overwriting actions.
    this.catchUpInactive()
    const time = THREE.MathUtils.clamp(normalizedTime, 0, 1)
    for (const action of (this.poseLayersEnabled ? this.actions : this.rawActions).get(state) ?? []) {
      action.time = time * action.getClip().duration
      action.paused = true
    }
    this.restoreEquipment(true)
    const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
    for (const mixer of this.mixers) {
      if (phaseCollector) {
        const phaseStart = performance.now()
        mixer.update(0)
        phaseCollector.endHumanoidPhase('mixerUpdate', phaseStart)
      } else {
        mixer.update(0)
      }
    }
    this.finishPose(true)
    return true
  }

  update(dt: number, cameraDistance = 0): void {
    if (!Number.isFinite(dt) || dt < 0) return
    if (dt === 0) { this.restoreEquipment(); this.finishPose(); return }
    this.farAccumulator += dt
    if (cameraDistance > HUMANOID_ANIMATION_THROTTLE_DISTANCE && this.farAccumulator < 1 / 12) return
    // Returning near must consume the pending far time once, too.
    dt = this.farAccumulator
    this.farAccumulator = 0
    this.restoreEquipment()
    for (let index = 0; index < this.mixers.length; index++) {
      if (this.needsLevel(index)) {
        const phaseCollector = import.meta.env.DEV ? this.subphaseCollector : null
        if (phaseCollector) {
          const phaseStart = performance.now()
          this.mixers[index].update(this.pendingMixerDt[index] + dt)
          phaseCollector.endHumanoidPhase('mixerUpdate', phaseStart)
        } else {
          this.mixers[index].update(this.pendingMixerDt[index] + dt)
        }
        this.pendingMixerDt[index] = 0
      } else this.pendingMixerDt[index] += dt
    }
    this.finishPose()
    this.transitionRemaining = Math.max(0, this.transitionRemaining - dt)
  }

  stop(): void {
    this.catchUpInactive()
    this.equipmentLayers.forEach(layer => layer.stop())
    for (const mixer of this.mixers) mixer.stopAllAction()
    for (const mesh of this.bowMeshes) mesh.morphTargetInfluences![mesh.morphTargetDictionary!.bowGrip] = 0
    this.current = null
    this.bowLegState = null
    this.transitionRemaining = 0
    this.onPoseEvaluated?.()
  }
}

function armRig(root: THREE.Object3D, side: 'L' | 'R'): ArmRig {
  const suffix = side === 'L' ? 'L' : 'R'
  const shoulder = findBone(root, REQUIRED_BONES[`upperArm${suffix}` as RequiredBoneKey])
  const elbow = findBone(root, REQUIRED_BONES[`lowerArm${suffix}` as RequiredBoneKey])
  const wrist = findBone(root, REQUIRED_BONES[`hand${suffix}` as RequiredBoneKey])
  const handSocket = findSocket(
    root,
    side === 'L' ? ['socket_hand_l', 'handslot.l', 'handslot_l'] : ['socket_hand_r', 'handslot.r', 'handslot_r'],
    wrist,
    side === 'L' ? 'socket_hand_l' : 'socket_hand_r',
  )
  return { shoulder, elbow, wrist, handSocket }
}

function legRig(root: THREE.Object3D, side: 'L' | 'R'): LegRig {
  const suffix = side === 'L' ? 'L' : 'R'
  const hip = findBone(root, REQUIRED_BONES[`upperLeg${suffix}` as RequiredBoneKey])
  const knee = findBone(root, REQUIRED_BONES[`lowerLeg${suffix}` as RequiredBoneKey])
  const ankle = findBone(root, REQUIRED_BONES[`foot${suffix}` as RequiredBoneKey])
  const foot = findBone(root, REQUIRED_BONES[`toe${suffix}` as RequiredBoneKey])
  return {
    hip,
    knee,
    ankle,
    foot,
    side: side === 'L' ? -1 : 1,
    forwardBendSign: 1,
  }
}

export function createHumanoidRigAdapter(root: THREE.Object3D, animation: HumanoidAnimationController): CharacterRig {
  root.traverse((object) => {
    if (object instanceof THREE.Bone && !object.userData.humanoidRestQuaternion) {
      object.userData.humanoidRestQuaternion = object.quaternion.toArray()
    }
  })
  const hips = findBone(root, REQUIRED_BONES.hips)
  const spine = findBone(root, REQUIRED_BONES.spine)
  const head = findBone(root, REQUIRED_BONES.head)
  const leftFoot = findBone(root, REQUIRED_BONES.footL)
  const rightFoot = findBone(root, REQUIRED_BONES.footR)
  return {
    left: armRig(root, 'L'),
    right: armRig(root, 'R'),
    leftLeg: legRig(root, 'L'),
    rightLeg: legRig(root, 'R'),
    pelvis: findSocket(root, ['socket_pelvis'], hips, 'socket_pelvis'),
    spine: findSocket(root, ['socket_back'], spine, 'socket_back'),
    head: findSocket(root, ['socket_head'], head, 'socket_head'),
    leftFootSocket: findSocket(root, ['socket_foot_l', 'sole_l'], leftFoot, 'socket_foot_l'),
    rightFootSocket: findSocket(root, ['socket_foot_r', 'sole_r'], rightFoot, 'socket_foot_r'),
    animation,
    equipmentGripFrames: root.userData.equipmentGripFrames,
    upperChest: root.getObjectByName('upper_chest'),
    clavicleLeft: root.getObjectByName('clavicle_l'),
    clavicleRight: root.getObjectByName('clavicle_r'),
  }
}

export function validateHumanoidManifest(faction: CharacterFaction, manifest: HumanoidAssetManifest): void {
  if (manifest.status !== 'ready') throw new Error(`${faction} humanoid asset is blocked: ${manifest.blocker?.message ?? manifest.reason ?? 'manifest is not ready'}`)
  if (!manifest.files) throw new Error(`${faction} manifest has no LOD files`)
  if (!manifest.metrics) throw new Error(`${faction} manifest has no measured metrics`)
  const targetHeight = faction === 'viking' ? 1.86 : 1.78
  const targetShoulder = faction === 'viking' ? 0.54 : 0.46
  if (Math.abs(manifest.metrics.heightM - targetHeight) > 0.02) throw new Error(`${faction} height is outside tolerance`)
  if (manifest.metrics.shoulderWidthM > targetShoulder + 0.01) throw new Error(`${faction} shoulder width is outside tolerance`)
  if (Math.abs(manifest.metrics.neckLengthM - 0.09) > 0.015) throw new Error(`${faction} neck length is outside tolerance`)
  if (manifest.animations) {
    const required: HumanoidAnimationState[] = ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'swordSlash', 'pilumThrow']
    const embedded = new Set(manifest.animations.embedded.map((binding) => binding.clip))
    if (required.some((clip) => !embedded.has(clip))) throw new Error(`${faction} manifest is missing a canonical animation binding`)
  }
}

function validateEmbeddedAnimations(faction: CharacterFaction, manifest: HumanoidAssetManifest, levels: GLTF[]): void {
  if (!manifest.animations) return
  const expected = new Map(manifest.animations.embedded.map((binding) => [binding.clip, binding.duration]))
  for (const [index, level] of levels.entries()) {
    const actual = new Map(level.animations.map((clip) => [clip.name, clip.duration]))
    if (actual.size !== expected.size || [...expected.keys()].some((name) => !actual.has(name))) {
      throw new Error(`${faction} LOD${index} animation names do not match its manifest`)
    }
    for (const [name, duration] of expected) {
      if (Math.abs((actual.get(name) ?? -1) - duration) > 0.001) {
        throw new Error(`${faction} LOD${index} ${name} duration does not match its manifest`)
      }
    }
  }
}

export class HumanoidAssetRegistry {
  private static readonly templates = new Map<CharacterFaction, HumanoidTemplate>()
  private static preloadPromise: Promise<void> | null = null

  static get ready(): boolean {
    return this.templates.has('viking') && this.templates.has('roman')
  }

  static preload(): Promise<void> {
    if (!this.preloadPromise) this.preloadPromise = this.loadAll()
    return this.preloadPromise
  }

  private static async loadAll(): Promise<void> {
    const loader = new GLTFLoader()
    const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const expGroup = query?.get('expGroup')?.toLowerCase()
    await Promise.all((['viking', 'roman'] as const).map(async (faction) => {
      const base = `/models/characters/v2/${faction}`
      const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`Cannot load ${faction} humanoid manifest (${response.status})`)
      const manifest = await response.json() as HumanoidAssetManifest
      validateHumanoidManifest(faction, manifest)
      const files = manifest.files!
      const lod0File = (expGroup && ['g0', 'g1', 'g2', 'g3'].includes(expGroup))
        ? `lod0.${expGroup}.glb`
        : files.lod0
      const lod2Url = `${base}/${files.lod2}`
      const lod2Promise: Promise<LoadedGltfWithSha256> = faction === 'roman'
        ? loadGltfWithSha256(loader, lod2Url, `${base}/`)
        : loader.loadAsync(lod2Url).then(gltf => ({ gltf }))
      const [lod0, lod1, lod2Loaded] = await Promise.all([
        loader.loadAsync(`${base}/${lod0File}`),
        loader.loadAsync(`${base}/${files.lod1}`),
        lod2Promise,
      ])
      const levels = [lod0, lod1, lod2Loaded.gltf]
      for (const level of levels) {
        firstSkinnedMesh(level.scene)
        prepareBladeGrip(level.scene, faction)
        const handFrame = readHandFrame(manifest)
        if (handFrame) prepareBowGripShape(level.scene, handFrame, level === levels[0] ? undefined : levels[0].scene)
      }
      levels.forEach((level, index) => {
        const swordFrame = manifest.swordGripFrames?.[`lod${index}` as 'lod0' | 'lod1' | 'lod2']
        if (swordFrame) prepareSwordHandShape(level.scene, swordFrame)
      })
      const left = readHandFrame(manifest)
      if (left && manifest.swordGripFrames) {
        levels[0].scene.updateMatrixWorld(true)
        const sourceHand = levels[0].scene.getObjectByName('hand_l')!
        levels.forEach((level, index) => {
          level.scene.updateMatrixWorld(true)
          const frames = calibrateEquipmentFrames(manifest.swordGripFrames![`lod${index}` as 'lod0'], left, sourceHand, level.scene.getObjectByName('hand_l')!)
          level.scene.userData.equipmentGripFrames = frames
          level.scene.userData.equipmentFaction = faction
          calibrateLanceIdleAttachment(level.scene, level.animations.find(clip => clip.name === 'idle')!, frames.lanceRight)
          prepareEquipmentHandShape(level.scene, frames.shieldLeft, 'l', 'shieldLeft')
        })
      }
      validateEmbeddedAnimations(faction, manifest, levels)
      const frame = readHandFrame(manifest)
      const bowClips = levels.map(level => frame ? normalizeBowHandClips(level.scene, level.animations, frame) : level.animations)
      let romanLod2Consolidation: RomanLod2ConsolidationTemplate | undefined
      if (faction === 'roman') {
        if (isRomanLod2ConsolidationAssetAudited(lod2Loaded.sha256)) {
          romanLod2Consolidation = tryCreateRomanLod2ConsolidationTemplate(levels[2].scene)
        } else {
          console.warn(
            `Roman LOD2 consolidation disabled: asset SHA-256 ${lod2Loaded.sha256 ?? 'unavailable'} does not match audited ${AUDITED_ROMAN_LOD2_SHA256}`,
          )
        }
      }
      this.templates.set(faction, { manifest, levels, bowClips, romanLod2Consolidation })
    }))
  }

  /**
   * Creates an isolated representative warmup group containing cloned skeleton scenes
   * for each LOD level. This ensures GPU shader compilation without mutating or attaching
   * the canonical registry templates.
   */
  static createWarmupGroup(): THREE.Group {
    const warmupGroup = new THREE.Group()
    warmupGroup.name = 'humanoid-warmup-templates'
    for (const [faction, template] of this.templates) {
      template.levels.forEach((gltf, index) => {
        const levelClone = cloneSkeleton(gltf.scene) as THREE.Group
        levelClone.name = `${faction}-warmup-lod${index}`
        levelClone.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true
            obj.receiveShadow = true
          }
        })
        if (faction === 'roman' && index === 2 && template.romanLod2Consolidation) {
          consolidateRomanLod2(levelClone, template.romanLod2Consolidation, { allowDevControl: false })
        }
        warmupGroup.add(levelClone)
      })
    }
    return warmupGroup
  }

  /**
   * Test seam to inspect canonical template without modifying it.
   */
  static getCanonicalLODScene(faction: CharacterFaction, lodIndex: number): THREE.Group | undefined {
    const template = this.templates.get(faction)
    return template?.levels[lodIndex]?.scene
  }

  /**
   * Test-only seam to snapshot registry templates.
   */
  static _snapshotTemplatesForTesting(): Map<CharacterFaction, HumanoidTemplate> {
    return new Map(this.templates)
  }

  /**
   * Test-only seam to restore registry templates after test execution.
   */
  static _restoreTemplatesForTesting(snapshot: Map<CharacterFaction, HumanoidTemplate>): void {
    this.templates.clear()
    for (const [k, v] of snapshot) {
      this.templates.set(k, v)
    }
  }

  static forEachLODLevel(callback: (levelScene: THREE.Group, faction: CharacterFaction, lodIndex: number) => void): void {
    for (const [faction, template] of this.templates) {
      template.levels.forEach((gltf, index) => {
        callback(gltf.scene, faction, index)
      })
    }
  }

  static createCharacterInstance(config: CharacterVisualConfig): HumanoidCharacterInstance {
    const template = this.templates.get(config.faction)
    if (!template) throw new Error(`HumanoidAssetRegistry is not preloaded for ${config.faction}`)
    const root = new THREE.Group()
    root.name = `${config.faction}-humanoid-v2`
    const lod = new THREE.LOD()
    const mixers: THREE.AnimationMixer[] = []
    const clipsPerLevel: THREE.AnimationClip[][] = []
    const rawClipsPerLevel: THREE.AnimationClip[][] = []
    let primaryScene: THREE.Group | null = null
    let skeleton: THREE.Skeleton | null = null
    template.levels.forEach((gltf, index) => {
      const level = cloneSkeleton(gltf.scene) as THREE.Group
      level.name = `${config.faction}-lod${index}`
      level.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = index < 2
          object.receiveShadow = true
          object.userData.originalMat = object.material
        }
      })
      const preserveOriginalLod2 = import.meta.env.DEV && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('humanoidLod2Original')
      if (config.faction === 'roman' && index === 2 && !preserveOriginalLod2 && template.romanLod2Consolidation) {
        const representationControl = consolidateRomanLod2(level, template.romanLod2Consolidation)
        if (representationControl) level.userData.humanoidLod2RepresentationControl = representationControl
      }
      if (config.faction === 'viking') {
        const head = findBone(level, REQUIRED_BONES.head)
        findSocket(level, ['socket_head'], head, 'socket_head').add(createVikingHornAccessory())
      }
      lod.addLevel(level, HUMANOID_LOD_DISTANCES[index])
      mixers.push(new THREE.AnimationMixer(level))
      const clips = new Map(PROJECT_ANIMATION_CLIPS.map((clip) => [clip.name, clip]))
      for (const clip of gltf.animations) clips.set(clip.name, clip)
      clips.set('mounted', createMountedIdleClip(clips.get('idle')!))
      rawClipsPerLevel.push([...clips.values()])
      for (const clip of template.bowClips?.[index] ?? []) clips.set(clip.name, clip)
      clipsPerLevel.push([...clips.values()])
      if (index === 0) {
        primaryScene = level
        skeleton = firstSkinnedMesh(level).skeleton
      }
    })
    root.add(lod)
    if (!primaryScene || !skeleton) throw new Error(`Failed to clone ${config.faction} humanoid`)
    const animation = new MixerController(mixers, clipsPerLevel, rawClipsPerLevel)
    const rig = createHumanoidRigAdapter(primaryScene, animation)
    rig.swordGripFrame = template.manifest.swordGripFrames?.lod0
    if (template.manifest.handGripFrames?.left) {
      const leftGrip = readHandFrame(template.manifest)!
      rig.handGripFrames = { left: leftGrip }
      if (rig.left?.handSocket) {
        rig.left.handSocket.userData.handGripFrame = leftGrip
      }
    }
    for (const [index, level] of lod.levels.entries()) {
      const frames = level.object.userData.equipmentGripFrames as EquipmentGripFrames | undefined
      if (frames) animation.equipmentLayers[index] = new CharacterEquipmentPose(level.object, createHumanoidRigAdapter(level.object, animation), frames)
    }
    animation.onPoseEvaluated = createEquipmentSocketProxies(root, rig)
    animation.onPoseEvaluated()
    animation.play('idle')
    animation.setVisibleLOD(0)
    // Renderer updates LOD after movement/world matrices. Sync the newly chosen
    // level here so even a switch between throttled ticks renders the right pose.
    lod.update = (camera) => {
      THREE.LOD.prototype.update.call(lod, camera)
      animation.setVisibleLOD(lod.getCurrentLevel())
    }
    const bounds = new THREE.Box3().setFromObject(root)
    return {
      root,
      skeleton,
      mixers,
      rig,
      bounds,
      attribution: template.manifest.attribution,
      update: (dt, cameraDistance = 0) => animation.update(dt, cameraDistance),
      dispose: () => {
        animation.stop()
        root.removeFromParent()
      },
    }
  }

  static createCharacterVisual(root: THREE.Group, config: CharacterVisualConfig): CharacterVisualParts {
    const instance = this.createCharacterInstance(config)
    root.add(instance.root)
    const headMesh = firstSkinnedMesh(instance.root)
    const materials = Array.isArray(headMesh.material) ? headMesh.material : [headMesh.material]
    const headMaterial = materials.find((material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial)
    if (!headMaterial) throw new Error(`${config.faction} humanoid has no standard PBR material`)
    return {
      bodyMesh: instance.root,
      headMesh,
      bodyMaterial: headMaterial,
      headMaterial,
      rightArm: instance.rig.right.shoulder,
      leftArm: instance.rig.left.shoulder,
      rig: instance.rig,
    }
  }
}
