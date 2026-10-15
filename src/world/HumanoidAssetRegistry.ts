import { prepareAuthoredBowContacts } from './BowDrawHand'
import { configureMultiInfluenceSkinning, multiInfluenceSkinningPlugin } from './MultiInfluenceSkinning'
import { prepareSelectedHumanoidSource, type SelectedHumanoidSource } from './SelectedHumanoidSource'
import { shareSelectedLodPose, shareIdenticalSkinSkeletons, validateSelectedLodAnimations, optimizeSelectedAnimationClips } from './SelectedLodPose'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { applyCivilianAppearance } from './CivilianAppearance'
import { BANDIT_ASSET } from './BanditAsset'
import { createBanditFootAttack } from './BanditFootAttack'
import { CharacterEquipmentPose, createEquipmentPoseState, type EquipmentPoseState } from './CharacterEquipmentPose'
import { calibrateEquipmentFrames, calibrateLanceIdleAttachment, type EquipmentGripFrames } from './EquipmentAttachmentContract'
import { prepareEquipmentHandShape } from './EquipmentHandShape'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createEquipmentSocketProxies } from './HumanoidEquipmentSockets'
import { normalizeBowHandClips, prepareBowGripShape } from './CanonicalBowGripPose'
import type { HandGripFrame } from './BowAttachmentContract'
import { prepareBladeGrip } from './HumanoidBladeGrip'
import { prepareSwordHandShape } from './SwordHandShape'
import {
  AUDITED_ROMAN_LOD2_SHA256,
  cullRomanLod2TinyDetails,
  consolidateRomanLod2,
  isRomanLod2ConsolidationAssetAudited,
  tryCreateRomanLod2ConsolidationTemplate,
  type RomanLod2ConsolidationTemplate,
} from './HumanoidLod2Consolidation'
import { shouldRomanHumanoidCastShadow } from './RomanHumanoidShadowPolicy'
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
  HumanoidMeleeTiming,
  LegRig,
} from './CharacterVisuals'

export interface HumanoidAnimationBinding {
  clip: HumanoidAnimationState
  source: 'Kevin Iglesias' | 'Quaternius' | 'tokeshi' | 'Meshy' | 'SagaBurst'
  sourceClip: string
  loop: boolean
  duration: number
  nominalSpeed?: number
  /** Runtime cycle only; the embedded clip and its source event times stay intact. */
  meleeCycleSeconds?: number
  events?: Record<string, number>
}

export const HUMANOID_LOD_DISTANCES = [0, 28, 60] as const
export const HUMANOID_ANIMATION_THROTTLE_DISTANCE = 28

export interface HumanoidAssetManifest {
  schemaVersion: 1
  skeleton?: string
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
  selectedSource?: SelectedHumanoidSource
  boneMap?: string
  audit?: string
  handGripFrames?: {
    left?: {
      bowCalibration?: string
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
  /** Source pilum grip can face opposite to its sword grip. */
  rangedGripFrames?: Record<'lod0' | 'lod1' | 'lod2', SwordGripFrame>
  /** Optional authored shield handle, independent from the bow hand frame. */
  shieldGripFrames?: Record<'lod0' | 'lod1' | 'lod2', SwordGripFrame>
  /** Posed source hands already authored in the asset; do not apply faction morphs. */
  handShapeMode?: 'authored'
  /** Generate grip morphs on each authored LOD without substituting LOD0 hand geometry. */
  preserveLodHandTopology?: boolean
  /** These clips already contain asset-specific equipment contact constraints. */
  bakedEquipmentActions?: string[]
  /** Authored standing bow pose turns the whole body; locomotion owns moving/mounted legs. */
  bowFullBodyStance?: boolean
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
    bowCalibration: data.bowCalibration,
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

export interface HumanoidAssetDescriptor {
  animationContract?: 'bandit'
  assetId: string
  faction: CharacterFaction
  heightM: number
  maxShoulderWidthM: number
  neckLengthM: number
}

/** Residents retain the undressed legacy body; military replacement assets have
 * fused armour which cannot safely be hidden by the civilian clothing policy. */
export const CIVILIAN_HUMANOID_ASSET: HumanoidAssetDescriptor = {
  assetId: 'roman-civilian', faction: 'roman', heightM: 1.78,
  maxShoulderWidthM: .46, neckLengthM: .09,
}

/** Source-specific anatomy, uniformly fitted to the existing gameplay heights.
 * These descriptors do not relax the canonical/legacy manifest contract. */
export const ORDINARY_HUMANOID_ASSETS: Record<CharacterFaction, HumanoidAssetDescriptor> = {
  roman: { assetId: 'roman', faction: 'roman', heightM: 1.78, maxShoulderWidthM: .46, neckLengthM: .06123885836724559 },
  viking: { assetId: 'viking', faction: 'viking', heightM: 1.86, maxShoulderWidthM: .54, neckLengthM: .11037482018019391 },
}

export function resolveHumanoidAssetId(config: CharacterVisualConfig, assetId?: string): string | undefined {
  return config.civilian ? CIVILIAN_HUMANOID_ASSET.assetId : assetId
}

interface HumanoidTemplate {
  manifest: HumanoidAssetManifest
  levels: GLTF[]
  animationClips?: THREE.AnimationClip[][]
  bowClips?: THREE.AnimationClip[][]
  romanLod2Consolidation?: RomanLod2ConsolidationTemplate
}

const LOD0_MOTION_CLIP_NAMES = new Set(['pilumThrow'])

/** Some source/retargeted bowLoad clips have two almost identical arm keys. Interpolate
 * its original raised-bow pose to its own bowHold pose so charge can drive a
 * draw without importing LOD1's differently aligned arm pose. GLBs stay raw. */
function completeStaticBowLoad(load: THREE.AnimationClip, hold: THREE.AnimationClip): THREE.AnimationClip {
  const holdTracks = new Map(hold.tracks.map(track => [track.name, track]))
  const drawArm = load.tracks.find(track => track.name === 'upper_arm_r.quaternion')
  const holdArm = holdTracks.get('upper_arm_r.quaternion')
  if (!(drawArm instanceof THREE.QuaternionKeyframeTrack) || !(holdArm instanceof THREE.QuaternionKeyframeTrack)) return load
  const quaternionAt = (track: THREE.QuaternionKeyframeTrack, offset: number) =>
    new THREE.Quaternion().set(track.values[offset], track.values[offset + 1], track.values[offset + 2], track.values[offset + 3])
  const start = quaternionAt(drawArm, 0)
  if (start.angleTo(quaternionAt(drawArm, drawArm.values.length - 4)) > 0.01
    || start.angleTo(quaternionAt(holdArm, 0)) < 0.1) return load

  const tracks = load.tracks.map(track => {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)
      || track.times.length !== 2
      || /^(hips|socket_pelvis|upper_leg_|lower_leg_|foot_|socket_foot_|sole_|toe_)/.test(track.name)) return track
    const destination = holdTracks.get(track.name)
    if (!(destination instanceof THREE.QuaternionKeyframeTrack)) return track
    return new THREE.QuaternionKeyframeTrack(track.name, [0, load.duration], [
      ...track.values.slice(0, 4), ...destination.values.slice(0, 4),
    ])
  })
  return new THREE.AnimationClip(load.name, load.duration, tracks)
}

/** Roman LOD0 pilumThrow is static; each bow LOD uses its own pose endpoints. */
export function resolveHumanoidAnimationClips(levelClips: THREE.AnimationClip[][]): THREE.AnimationClip[][] {
  const lod1ByName = new Map((levelClips[1] ?? []).map(clip => [clip.name, clip]))
  return levelClips.map((clips, index) => {
    const hold = clips.find(clip => clip.name === 'bowHold')
    return clips.map(clip => {
      if (clip.name === 'bowLoad' && hold) return completeStaticBowLoad(clip, hold)
      if (index === 0 && LOD0_MOTION_CLIP_NAMES.has(clip.name)) return lod1ByName.get(clip.name) ?? clip
      return clip
    })
  })
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

/** SkeletonUtils clones own their bone textures; geometry/material/skin textures stay shared.
 * Safe to repeat and deduplicated when several meshes use the same instance skeleton. */
export function disposeHumanoidInstanceSkeletons(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton)
  })
  for (const skeleton of skeletons) skeleton.dispose()
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
  tracks: Array<{
    bone: string
    times: number[]
    eulers?: THREE.Vector3[]
    positions?: THREE.Vector3[]
  }>,
): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(name, duration, tracks.map((track) => track.positions
    ? new THREE.VectorKeyframeTrack(`${track.bone}.position`, track.times, track.positions.flatMap(value => value.toArray()))
    : new THREE.QuaternionKeyframeTrack(
      `${track.bone}.quaternion`,
      track.times,
      quaternionValues(track.eulers!),
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
      // Pitch the body forward into a prone fall. A Z-axis roll produces a
      // side-plank pose because the humanoid's local +Z is forward.
      { bone: 'hips', times: [0, 0.25, 1], eulers: [zero(), pose(0.15), pose(1.35)] },
      { bone: 'spine', times: [0, 0.25, 1], eulers: [zero(), pose(0.1), pose(0.25)] },
      // The physics root stays at the character's feet. Lower the animated
      // skeleton as it falls so the prone body settles onto that same ground.
      { bone: 'hips', times: [0, 0.25, 1], positions: [zero(), new THREE.Vector3(0, -0.24, 0), new THREE.Vector3(0, -0.62, 0)] },
    ]),
  ]
}

const PROJECT_ANIMATION_CLIPS = createProjectAnimationClips()

// The replacement packages deliberately contain only the eleven delivered clips.
// Supply their missing recoil through the existing additive hit-overlay path;
// it must not interrupt a weapon action or alter its gameplay clock.
const REPLACEMENT_HIT_CLIP = additiveClip('hit', .24, [
  { bone: 'spine', times: [0, .08, .24], eulers: [zero(), pose(-.13), zero()] },
  { bone: 'chest', times: [0, .08, .24], eulers: [zero(), pose(-.09, .025), zero()] },
])

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
const VIKING_HORN_GEOMETRY = mergeGeometries([...VIKING_HORN_GEOMETRIES], false)

if (!VIKING_HORN_GEOMETRY) throw new Error('Failed to merge Viking horn geometry')

export function createVikingHornAccessory(castShadow = true): THREE.Group {
  const accessory = new THREE.Group()
  accessory.name = 'viking-short-horns'
  const horns = new THREE.Mesh(VIKING_HORN_GEOMETRY, VIKING_HORN_MATERIAL)
  horns.name = 'viking-horns'
  horns.castShadow = castShadow
  accessory.add(horns)
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

const hitOverlayClips = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>()

export class MixerController implements HumanoidAnimationController {
  equipmentLayers: CharacterEquipmentPose[] = []
  private readonly equipmentState = createEquipmentPoseState()
  private readonly evaluatedEquipmentState = createEquipmentPoseState()
  private visibleLOD: number | null = null
  private transitionRemaining = 0
  private readonly pendingMixerDt: number[]
  setEquipmentState(state: Partial<EquipmentPoseState>): void { Object.assign(this.equipmentState, state) }
  private needsLevel(index: number): boolean {
    return this.visibleLOD === null || index === 0 || index === this.visibleLOD || this.transitionRemaining > 0
  }
  private restoreEquipment(all = false): void {
    this.equipmentLayers.forEach((layer, index) => { if (all || this.needsLevel(index)) layer.restore() })
  }
  private finishPose(all = false): void {
    const alive = this.equipmentState.alive
    this.equipmentState.alive = alive && this.poseLayersEnabled && this.current !== 'death'
    // Equipment action can already be idle while Three is fading out bowHold
    // or bowRelease. Keep the selected mounted torso compensation until the
    // sampled bow influence is gone, not merely until gameplay ends the action.
    this.equipmentState.sampledBowPose = false
    for (const actions of this.sampledBowActions) {
      const action = actions[0]
      if (action?.isScheduled() && action.enabled && action.getEffectiveWeight() > 1e-6) {
        this.equipmentState.sampledBowPose = true
        break
      }
    }
    Object.assign(this.evaluatedEquipmentState, this.equipmentState)
    this.equipmentLayers.forEach((layer, index) => {
      if (all || this.needsLevel(index)) {
        const palm = index === 0 ? undefined : this.equipmentLayers[0].axeSupportPalm
        if (palm) layer.apply(this.equipmentState, palm)
        else layer.apply(this.equipmentState)
      }
    })
    this.equipmentState.alive = alive
    this.onPoseEvaluated?.()
  }

  // Advance retained actions, including their loop/fade state, using Three's
  // own evaluator. Debt is settled before any action command changes semantics.
  private catchUp(index: number): void {
    const dt = this.pendingMixerDt[index]
    if (dt === 0) return
    this.equipmentLayers[index]?.restore()
    this.mixers[index].update(dt)
    this.pendingMixerDt[index] = 0
  }
  private catchUpInactive(): void {
    for (let index = 1; index < this.mixers.length; index++) this.catchUp(index)
  }

  /** Called after Three selects its actual render LOD, before traversing meshes. */
  setVisibleLOD(index: number): void {
    // Selected LOD meshes share the primary pose; their render level is not a
    // separate mixer index. Legacy assets retain one mixer per representation.
    if (this.mixers.length === 1) index = 0
    if (index === this.visibleLOD) return
    this.visibleLOD = index
    this.catchUp(index)
    const layer = this.equipmentLayers[index]
    // Use the authority's last evaluated pose, not newer gameplay state from a
    // skipped distance tick. Do not consume the shared far accumulator here.
    layer?.restore()
    const palm = index === 0 ? undefined : this.equipmentLayers[0]?.axeSupportPalm
    if (palm) layer?.apply(this.evaluatedEquipmentState, palm)
    else layer?.apply(this.evaluatedEquipmentState)
  }

  /** Asset-owned socket followers run after the single pose evaluation. */
  onPoseEvaluated?: () => void
  private poseLayersEnabled = true
  private readonly bowLegActions = new Map<string, THREE.AnimationAction[]>()
  private bowLegState: string | null = null
  private readonly actions = new Map<HumanoidAnimationState, THREE.AnimationAction[]>()
  private readonly rawActions = new Map<HumanoidAnimationState, THREE.AnimationAction[]>()
  private readonly sampledBowActions: THREE.AnimationAction[][] = []
  private readonly durations = new Map<HumanoidAnimationState, number>()
  private readonly meleeTimings = new Map<HumanoidAnimationState, HumanoidMeleeTiming>()
  private current: HumanoidAnimationState | null = null
  private farAccumulator = 0
  private readonly bowMeshes: THREE.SkinnedMesh[] = []
  private readonly swordMeshes: THREE.SkinnedMesh[] = []
  private swordHandEnabled = false
  private readonly hitReactions: THREE.AnimationAction[] = []

  /** Authored upper-body recoil is additive: never cancels an AI attack or its hit clock. */
  playHitReaction(): void {
    if (this.current === 'death') return
    this.catchUpInactive()
    for (const action of this.hitReactions) action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(.65).play()
  }

  constructor(private readonly mixers: THREE.AnimationMixer[], clipsPerLevel: THREE.AnimationClip[][], rawClipsPerLevel = clipsPerLevel, bindings: HumanoidAnimationBinding[] = []) {
    for (const binding of bindings) {
      if (binding.meleeCycleSeconds === undefined) continue
      const { activeStart, hit, activeEnd } = binding.events ?? {}
      if (!(binding.meleeCycleSeconds > 0 && activeStart >= 0 && hit > activeStart && activeEnd > hit && binding.duration > activeEnd)) throw new Error(`Invalid melee timeline: ${binding.clip}`)
      const ratio = binding.meleeCycleSeconds / binding.duration
      this.meleeTimings.set(binding.clip, { duration: binding.meleeCycleSeconds, activeStart: activeStart * ratio, hit: hit * ratio, activeEnd: activeEnd * ratio, clipTimeScale: 1 / ratio })
    }
    this.pendingMixerDt = mixers.map(() => 0)
    mixers.forEach((mixer, index) => {
      const source = clipsPerLevel[index].find(clip => clip.name === 'hit')
      if (!source) return
      let clip = hitOverlayClips.get(source)
      if (!clip) {
        clip = new THREE.AnimationClip('hit-overlay', source.duration, source.tracks.filter(track => /^(spine|chest|upper_chest|neck|head|clavicle_|upper_arm_|lower_arm_|hand_|LeftHand|RightHand)/.test(track.name)).map(track => track.clone()))
        THREE.AnimationUtils.makeClipAdditive(clip, 0, clip, 30)
        hitOverlayClips.set(source, clip)
      }
      this.hitReactions.push(mixer.clipAction(clip))
    })
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
      if (name === 'bowLoad' || name === 'bowHold' || name === 'bowRelease') this.sampledBowActions.push(actions)
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
    for (const mesh of this.swordMeshes) mesh.morphTargetInfluences![mesh.morphTargetDictionary!.swordHand] = enabled ? 1 : 0
  }

  setPoseLayersEnabled(enabled: boolean): void {
    this.stop()
    this.poseLayersEnabled = enabled
  }

  setBowLocomotion(state: 'idle' | 'walk' | 'run', timeScale: number): void {
    if (this.bowLegState !== state || (this.bowLegActions.get(state) ?? []).some(action => action.timeScale !== timeScale)) this.catchUpInactive()
    if (this.bowLegState !== state) {
      for (const action of this.bowLegActions.get(this.bowLegState ?? '') ?? []) action.stop()
      for (const action of this.bowLegActions.get(state) ?? []) action.reset().play()
      this.bowLegState = state
    }
    for (const action of this.bowLegActions.get(state) ?? []) action.timeScale = timeScale
  }

  getDuration(state: HumanoidAnimationState): number | undefined {
    return this.durations.get(state)
  }

  getMeleeTiming(state: HumanoidAnimationState): HumanoidMeleeTiming | undefined {
    return this.meleeTimings.get(state)
  }

  play(state: HumanoidAnimationState, options: HumanoidAnimationPlayOptions = {}): boolean {
    if (state === 'death') for (const action of this.hitReactions) action.stop()
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
      for (const action of next) {
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
        action.clampWhenFinished = !loop
        action.paused = false
        action.timeScale = timeScale
        if (options.startNormalizedTime !== undefined) {
          action.time = THREE.MathUtils.clamp(options.startNormalizedTime, 0, 1) * action.getClip().duration
        }
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
    for (const mixer of this.mixers) mixer.update(0)
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
        this.mixers[index].update(this.pendingMixerDt[index] + dt)
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

export function validateHumanoidManifest(faction: CharacterFaction, manifest: HumanoidAssetManifest, descriptor?: HumanoidAssetDescriptor): void {
  if (descriptor && manifest.id !== descriptor.assetId) throw new Error(`Unexpected humanoid asset id: ${manifest.id}`)
  if (descriptor && manifest.skeleton !== 'project-humanoid-v1') throw new Error(`${descriptor.assetId}: incompatible skeleton contract`)
  if (descriptor && manifest.metrics && ![manifest.metrics.heightM, manifest.metrics.shoulderWidthM, manifest.metrics.neckLengthM].every(value => Number.isFinite(value) && value > 0)) throw new Error(`${descriptor.assetId}: invalid measured metrics`)
  if (descriptor && !manifest.animations) throw new Error(`${descriptor.assetId} is missing animation bindings`)
  if (manifest.status !== 'ready') throw new Error(`${faction} humanoid asset is blocked: ${manifest.blocker?.message ?? manifest.reason ?? 'manifest is not ready'}`)
  if (!manifest.files) throw new Error(`${faction} manifest has no LOD files`)
  if (!manifest.metrics) throw new Error(`${faction} manifest has no measured metrics`)
  const targetHeight = descriptor?.heightM ?? (faction === 'viking' ? 1.86 : 1.78)
  const targetShoulder = descriptor?.maxShoulderWidthM ?? (faction === 'viking' ? 0.54 : 0.46)
  if (Math.abs(manifest.metrics.heightM - targetHeight) > 0.02) throw new Error(`${faction} height is outside tolerance`)
  if (manifest.metrics.shoulderWidthM > targetShoulder + 0.01) throw new Error(`${faction} shoulder width is outside tolerance`)
  if (Math.abs(manifest.metrics.neckLengthM - (descriptor?.neckLengthM ?? 0.09)) > 0.015) throw new Error(`${faction} neck length is outside tolerance`)
  if (manifest.animations) {
    const required: HumanoidAnimationState[] = descriptor?.animationContract === 'bandit'
      ? ['idle', 'walk', 'run', 'swordSlash', 'hit', 'death']
      : ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'swordSlash', 'pilumThrow']
    if (descriptor?.animationContract !== 'bandit') required.push('axeAttack1H', 'axeAttack2H')
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
  private static readonly assets = new Map<string, HumanoidTemplate>()
  private static readonly assetLoads = new Map<string, Promise<void>>()

  static preloadAsset(descriptor: HumanoidAssetDescriptor): Promise<void> {
    let pending = this.assetLoads.get(descriptor.assetId)
    if (!pending) {
      pending = this.loadTemplate(descriptor.faction, descriptor.assetId, descriptor).then(template => {
        this.assets.set(descriptor.assetId, template)
      }).catch(error => { this.assetLoads.delete(descriptor.assetId); throw error })
      this.assetLoads.set(descriptor.assetId, pending)
    }
    return pending
  }

  static get ready(): boolean {
    return this.templates.has('viking') && this.templates.has('roman')
  }

  static preload(): Promise<void> {
    if (!this.preloadPromise) this.preloadPromise = this.loadAll()
    return this.preloadPromise
  }

  private static async loadTemplate(faction: CharacterFaction, assetId: string, descriptor?: HumanoidAssetDescriptor): Promise<HumanoidTemplate> {
    const loader = new GLTFLoader()
    const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const expGroup = query?.get('expGroup')?.toLowerCase()
    const base = publicAssetUrl(`models/characters/v2/${assetId}`)
    const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cannot load ${faction} humanoid manifest (${response.status})`)
    const manifest = await response.json() as HumanoidAssetManifest
    validateHumanoidManifest(faction, manifest, descriptor)
    if (manifest.selectedSource?.rig === 'mixamo66') loader.register(multiInfluenceSkinningPlugin)
    const files = manifest.files!
    const lod0File = (!descriptor && expGroup && ['g0', 'g1', 'g2', 'g3'].includes(expGroup))
      ? `lod0.${expGroup}.glb`
      : files.lod0
    const lod2Url = `${base}/${files.lod2}`
    const lod2Promise: Promise<LoadedGltfWithSha256> = faction === 'roman' && !descriptor
      ? loadGltfWithSha256(loader, lod2Url, `${base}/`)
      : loader.loadAsync(lod2Url).then(gltf => ({ gltf }))
    const [lod0, lod1, lod2Loaded] = await Promise.all([
      loader.loadAsync(`${base}/${lod0File}`),
      loader.loadAsync(`${base}/${files.lod1}`),
      lod2Promise,
    ])
    const levels = [lod0, lod1, lod2Loaded.gltf]
    if (manifest.selectedSource) for (const level of levels) prepareSelectedHumanoidSource(level, manifest.selectedSource)
    if (manifest.selectedSource) validateSelectedLodAnimations(levels.map(level => level.animations))
    if (descriptor) validateEmbeddedAnimations(faction, manifest, levels)
    for (const level of levels) {
      firstSkinnedMesh(level.scene)
      if (descriptor) {
        for (const aliases of Object.values(REQUIRED_BONES)) findBone(level.scene, aliases)
        for (const name of ['socket_hand_l', 'socket_hand_r', 'socket_back', 'socket_head', 'socket_pelvis', 'socket_foot_l', 'socket_foot_r', 'sole_l', 'sole_r']) {
          if (!level.scene.getObjectByName(name)) throw new Error(`${assetId}: missing required socket ${name}`)
        }
        if (descriptor.animationContract === 'bandit') {
          const hammer = level.scene.getObjectByName('Bandit_Hammer')
          if (!hammer || hammer.parent?.name !== 'hand_r' || !level.scene.getObjectByName('hammer_tip')) throw new Error(`${assetId}: missing authored hammer attachment`)
        } else if (!manifest.swordGripFrames || !manifest.handGripFrames) throw new Error(`${assetId}: missing asset grip calibration`)
      }
      if (manifest.handShapeMode === 'authored') {
        if (manifest.selectedSource?.rig === 'ordinary22' || manifest.selectedSource?.rig === 'roman54') {
          const frame = readHandFrame(manifest)
          if (frame) prepareAuthoredBowContacts(level.scene, frame)
        }
        continue
      }
      prepareBladeGrip(level.scene, faction)
      const handFrame = readHandFrame(manifest)
      if (handFrame) prepareBowGripShape(level.scene, handFrame, level === levels[0] ? undefined : levels[0].scene,
        { preserveLodHandTopology: manifest.preserveLodHandTopology })
    }
    levels.forEach((level, index) => {
      const swordFrame = manifest.swordGripFrames?.[`lod${index}` as 'lod0' | 'lod1' | 'lod2']
      if (swordFrame && manifest.handShapeMode !== 'authored') prepareSwordHandShape(level.scene, swordFrame)
    })
    const left = readHandFrame(manifest)
    if (left && manifest.swordGripFrames) {
      levels[0].scene.updateMatrixWorld(true)
      const sourceHand = levels[0].scene.getObjectByName('hand_l')!
      levels.forEach((level, index) => {
        level.scene.updateMatrixWorld(true)
        const frames = calibrateEquipmentFrames(manifest.swordGripFrames![`lod${index}` as 'lod0'], left, sourceHand, level.scene.getObjectByName('hand_l')!)
        const shieldFrame = manifest.shieldGripFrames?.[`lod${index}` as 'lod0']
        if (shieldFrame) frames.shieldLeft = { ...shieldFrame }
        level.scene.userData.equipmentGripFrames = frames
        level.scene.userData.equipmentFaction = faction
        const idle = level.animations.find(clip => clip.name === 'idle')!
        // These sources turn the pelvis in foot Idle; mounted locomotion omits
        // that track. Calibrate the mounted lance in the same upper-body basis.
        const replacement = ['ordinary22', 'roman54', 'varangian63'].includes(manifest.selectedSource?.rig ?? '')
        calibrateLanceIdleAttachment(level.scene, replacement ? createMountedIdleClip(idle) : idle, frames.lanceRight)
        const axeIdle = level.animations.find(clip => clip.name === 'axeMountedIdle')
        if (axeIdle) {
          const axeFrame = { ...frames.lanceRight }
          calibrateLanceIdleAttachment(level.scene, axeIdle, axeFrame)
          frames.lanceRight.axeMountedRotationLocal = axeFrame.modelRotationLocal
        }
        if (manifest.handShapeMode !== 'authored') {
          prepareEquipmentHandShape(level.scene, frames.shieldLeft, 'l', 'shieldLeft')
          // Any unbaked humanoid can use a two-handed axe, including Roman.
          prepareEquipmentHandShape(level.scene, frames.lanceLeft, 'l', 'lanceLeft')
        }
      })
    }
    validateEmbeddedAnimations(faction, manifest, levels)
    const frame = readHandFrame(manifest)
    const animationClips = manifest.selectedSource
      ? levels.map(level => optimizeSelectedAnimationClips(level.scene, level.animations))
      : resolveHumanoidAnimationClips(levels.map(level => level.animations))
    // These canonical rigs can equip the same one-handed mace as the selected
    // troops/heroes, but their retained GLBs predate the Bandit foot clip.
    if (assetId === 'roman-hero-t4' || assetId === 'roman-civilian') {
      await this.preloadAsset(BANDIT_ASSET)
      const source = this.assets.get(BANDIT_ASSET.assetId)!.levels[0]
      const strike = source.animations.find(clip => clip.name === 'swordSlash')!
      const binding = manifest.animations!.embedded.find(clip => clip.clip === 'axeAttack1H')!
      levels.forEach((level, index) => {
        if (animationClips[index].some(clip => clip.name === 'axeAttack1HFoot')) return
        animationClips[index] = [...animationClips[index], createBanditFootAttack(source.scene, strike, level.scene,
          level.animations.find(clip => clip.name === 'idle')!, manifest.swordGripFrames![`lod${index}` as 'lod0'],
          binding.duration, binding.events!.hit)]
      })
    }
    const bowClips = levels.map((level, index) => frame && !manifest.selectedSource ? normalizeBowHandClips(level.scene, animationClips[index]) : animationClips[index])
    let romanLod2Consolidation: RomanLod2ConsolidationTemplate | undefined
    if (faction === 'roman' && !descriptor && !manifest.selectedSource) {
      if (isRomanLod2ConsolidationAssetAudited(lod2Loaded.sha256)) {
        romanLod2Consolidation = tryCreateRomanLod2ConsolidationTemplate(levels[2].scene)
      } else {
        console.warn(
          `Roman LOD2 consolidation disabled: asset SHA-256 ${lod2Loaded.sha256 ?? 'unavailable'} does not match audited ${AUDITED_ROMAN_LOD2_SHA256}`,
        )
      }
    }
    return { manifest, levels, animationClips, bowClips, romanLod2Consolidation }
  }

  private static async loadAll(): Promise<void> {
    await Promise.all([this.preloadAsset(BANDIT_ASSET), this.preloadAsset(CIVILIAN_HUMANOID_ASSET), ...(['viking', 'roman'] as const).map(async faction => {
      this.templates.set(faction, await this.loadTemplate(faction, faction, ORDINARY_HUMANOID_ASSETS[faction]))
    })])
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
        configureMultiInfluenceSkinning(levelClone)
        levelClone.name = `${faction}-warmup-lod${index}`
        levelClone.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true
            obj.receiveShadow = true
          }
        })
        if (faction === 'roman' && index === 2 && template.romanLod2Consolidation) {
          consolidateRomanLod2(levelClone, template.romanLod2Consolidation, { allowDevControl: false })
          cullRomanLod2TinyDetails(levelClone)
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

  static createCharacterInstance(config: CharacterVisualConfig, assetId?: string): HumanoidCharacterInstance {
    assetId = resolveHumanoidAssetId(config, assetId)
    const template = assetId ? this.assets.get(assetId) : this.templates.get(config.faction)
    if (!template) throw new Error(`HumanoidAssetRegistry is not preloaded for ${assetId ?? config.faction}`)
    const root = new THREE.Group()
    root.name = `${assetId ?? config.faction}-humanoid-v2`
    const lod = new THREE.LOD()
    const mixers: THREE.AnimationMixer[] = []
    const clipsPerLevel: THREE.AnimationClip[][] = []
    const rawClipsPerLevel: THREE.AnimationClip[][] = []
    let primaryScene: THREE.Group | null = null
    let skeleton: THREE.Skeleton | null = null
    template.levels.forEach((gltf, index) => {
      const level = cloneSkeleton(gltf.scene) as THREE.Group
      configureMultiInfluenceSkinning(level)
      level.name = `${assetId ?? config.faction}-lod${index}`
      level.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = config.faction === 'roman' && template.manifest.selectedSource?.rig !== 'roman54'
            ? shouldRomanHumanoidCastShadow(object.name, index)
            : index < 2
          object.receiveShadow = true
          object.userData.originalMat = object.material
        }
      })
      const preserveOriginalLod2 = import.meta.env.DEV && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('humanoidLod2Original')
      if (config.faction === 'roman' && !config.civilian && index === 2 && !preserveOriginalLod2 && template.romanLod2Consolidation) {
        const representationControl = consolidateRomanLod2(level, template.romanLod2Consolidation)
        if (representationControl) level.userData.humanoidLod2RepresentationControl = representationControl
        cullRomanLod2TinyDetails(level)
      }
      if (config.faction === 'viking' && !assetId && !template.manifest.selectedSource) {
        const head = findBone(level, REQUIRED_BONES.head)
        findSocket(level, ['socket_head'], head, 'socket_head').add(createVikingHornAccessory(index < 2))
      }
      if (config.civilian) applyCivilianAppearance(level, config.civilianStyle ?? 'roman')
      if (index === 0 && ['ordinary22', 'roman54', 'varangian63'].includes(template.manifest.selectedSource?.rig ?? '')) shareIdenticalSkinSkeletons(level)
      if (template.manifest.selectedSource && primaryScene) shareSelectedLodPose(primaryScene, level)
      lod.addLevel(level, HUMANOID_LOD_DISTANCES[index])
      if (template.manifest.selectedSource && index > 0) return
      mixers.push(new THREE.AnimationMixer(level))
      const animations = template.animationClips?.[index] ?? gltf.animations
      const clips = new Map(PROJECT_ANIMATION_CLIPS.map((clip) => [clip.name, clip]))
      for (const clip of animations) clips.set(clip.name, clip)
      if (!assetId || !animations.some(clip => clip.name === 'mounted')) clips.set('mounted', createMountedIdleClip(clips.get('idle')!))
      const rawClips = new Map(PROJECT_ANIMATION_CLIPS.map((clip) => [clip.name, clip]))
      for (const clip of gltf.animations) rawClips.set(clip.name, clip)
      const generatedFootAttack = animations.find(clip => clip.name === 'axeAttack1HFoot')
      if (generatedFootAttack && !rawClips.has('axeAttack1HFoot')) rawClips.set('axeAttack1HFoot', generatedFootAttack)
      if (['ordinary22', 'roman54', 'varangian63'].includes(template.manifest.selectedSource?.rig ?? '')) {
        if (!clips.has('hit')) clips.set('hit', REPLACEMENT_HIT_CLIP)
        if (!rawClips.has('hit')) rawClips.set('hit', REPLACEMENT_HIT_CLIP)
      }
      if (!assetId || !gltf.animations.some(clip => clip.name === 'mounted')) rawClips.set('mounted', createMountedIdleClip(rawClips.get('idle')!))
      rawClipsPerLevel.push([...rawClips.values()])
      for (const clip of template.bowClips?.[index] ?? []) clips.set(clip.name, clip)
      clipsPerLevel.push([...clips.values()])
      if (index === 0) {
        primaryScene = level
        skeleton = firstSkinnedMesh(level).skeleton
      }
    })
    root.add(lod)
    if (!primaryScene || !skeleton) throw new Error(`Failed to clone ${config.faction} humanoid`)
    const animation = new MixerController(mixers, clipsPerLevel, rawClipsPerLevel, template.manifest.animations?.embedded)
    const rig = createHumanoidRigAdapter(primaryScene, animation)
    rig.swordGripFrame = template.manifest.swordGripFrames?.lod0
    rig.right.handSocket.userData.banditFootAxe = animation.has('axeAttack1HFoot')
    if (template.manifest.selectedSource) {
      rig.rangedGripFrame = template.manifest.rangedGripFrames?.lod0 ?? rig.swordGripFrame
      rig.meleeTipFollowsVisual = true
      rig.right.handSocket.userData.naturalFootAxeCarry = template.manifest.selectedSource.rig === 'roman54'
      rig.right.handSocket.userData.vikingFootAxeCarry = ['ordinary22', 'varangian63'].includes(template.manifest.selectedSource.rig)
      const authoredAxeSocket = (primaryScene as THREE.Group).getObjectByName('socket_axe_2h_r')
      if (authoredAxeSocket) rig.right.handSocket.userData.authoredAxeSocket = authoredAxeSocket
      const authoredAxe1Socket = (primaryScene as THREE.Group).getObjectByName('socket_axe_1h_r')
      if (authoredAxe1Socket) rig.right.handSocket.userData.authoredAxe1Socket = authoredAxe1Socket
    }
    if (template.manifest.handGripFrames?.left) {
      const leftGrip = readHandFrame(template.manifest)!
      rig.handGripFrames = { left: leftGrip }
      if (rig.left?.handSocket) {
        rig.left.handSocket.userData.handGripFrame = leftGrip
      }
    }
    for (const [index, level] of lod.levels.entries()) {
      if (template.manifest.selectedSource && index > 0) continue
      const frames = level.object.userData.equipmentGripFrames as EquipmentGripFrames | undefined
      if (frames) animation.equipmentLayers[index] = new CharacterEquipmentPose(level.object, createHumanoidRigAdapter(level.object, animation), frames, template.manifest.bakedEquipmentActions, template.manifest.bowFullBodyStance, template.manifest.selectedSource)
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
        disposeHumanoidInstanceSkeletons(root)
        for (const mixer of mixers) mixer.uncacheRoot(mixer.getRoot())
        root.removeFromParent()
      },
    }
  }

  static createCharacterVisual(root: THREE.Group, config: CharacterVisualConfig, assetId?: string): CharacterVisualParts {
    const instance = this.createCharacterInstance(config, assetId)
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
