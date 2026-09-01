import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {
  ArmRig,
  CharacterFaction,
  CharacterRig,
  CharacterVisualConfig,
  CharacterVisualParts,
  HumanoidAnimationController,
  LegRig,
} from './CharacterVisuals'

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
}

interface HumanoidTemplate {
  manifest: HumanoidAssetManifest
  levels: GLTF[]
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
    additiveClip('Idle', 2, [
      { bone: 'chest', times: [0, 1, 2], eulers: [zero(), pose(0.015, 0, 0), zero()] },
      { bone: 'head', times: [0, 1, 2], eulers: [zero(), pose(0, 0.018, 0), zero()] },
    ]),
    additiveClip('Walking', 1, [
      { bone: 'upper_leg_l', times: cycle, eulers: [pose(0.5), zero(), pose(-0.5), zero(), pose(0.5)] },
      { bone: 'upper_leg_r', times: cycle, eulers: [pose(-0.5), zero(), pose(0.5), zero(), pose(-0.5)] },
      { bone: 'lower_leg_l', times: cycle, eulers: [pose(0.05), pose(0.5), pose(0.05), pose(0.12), pose(0.05)] },
      { bone: 'lower_leg_r', times: cycle, eulers: [pose(0.05), pose(0.12), pose(0.05), pose(0.5), pose(0.05)] },
      { bone: 'upper_arm_l', times: cycle, eulers: [pose(-0.3), zero(), pose(0.3), zero(), pose(-0.3)] },
      { bone: 'upper_arm_r', times: cycle, eulers: [pose(0.3), zero(), pose(-0.3), zero(), pose(0.3)] },
    ]),
    additiveClip('Running', 0.7, [
      { bone: 'upper_leg_l', times: [0, 0.35, 0.7], eulers: [pose(0.72), pose(-0.72), pose(0.72)] },
      { bone: 'upper_leg_r', times: [0, 0.35, 0.7], eulers: [pose(-0.72), pose(0.72), pose(-0.72)] },
      { bone: 'upper_arm_l', times: [0, 0.35, 0.7], eulers: [pose(-0.55), pose(0.55), pose(-0.55)] },
      { bone: 'upper_arm_r', times: [0, 0.35, 0.7], eulers: [pose(0.55), pose(-0.55), pose(0.55)] },
    ]),
    additiveClip('1H_Melee_Attack_Stab', 0.7, [
      { bone: 'upper_arm_r', times: [0, 0.18, 0.38, 0.7], eulers: [zero(), pose(0.85, 0, -0.28), pose(1.25, 0, -0.12), zero()] },
      { bone: 'lower_arm_r', times: [0, 0.18, 0.38, 0.7], eulers: [zero(), pose(0.65), pose(0.12), zero()] },
      { bone: 'chest', times: [0, 0.18, 0.38, 0.7], eulers: [zero(), pose(0, -0.12, 0), pose(0, 0.1, 0), zero()] },
    ]),
    additiveClip('2H_Ranged_Aiming', 1.2, [
      { bone: 'upper_arm_l', times: [0, 0.3, 1.2], eulers: [zero(), pose(1.2, -0.1, -0.1), pose(1.2, -0.1, -0.1)] },
      { bone: 'lower_arm_l', times: [0, 0.3, 1.2], eulers: [zero(), pose(0.28, 0, 0.05), pose(0.28, 0, 0.05)] },
      { bone: 'upper_arm_r', times: [0, 0.3, 1.2], eulers: [zero(), pose(1.35, 0, -1.1), pose(1.35, 0, -1.1)] },
      { bone: 'lower_arm_r', times: [0, 0.3, 1.2], eulers: [zero(), pose(0.75, 0, 0.12), pose(0.75, 0, 0.12)] },
    ]),
    // CharacterVisuals owns the mounted leg pose. Keep a named mixer action for
    // state/cross-fade compatibility without applying the same leg rotations a
    // second time on top of that pose.
    additiveClip('Mounted', 1.5, []),
    additiveClip('Death', 1, [
      { bone: 'hips', times: [0, 0.25, 1], eulers: [zero(), pose(0, 0, 0.15), pose(0, 0, 1.35)] },
      { bone: 'spine', times: [0, 0.25, 1], eulers: [zero(), pose(0.1, 0, 0.1), pose(0.2, 0, 0.25)] },
    ]),
  ]
}

const PROJECT_ANIMATION_CLIPS = createProjectAnimationClips()

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

class MixerController implements HumanoidAnimationController {
  private readonly actions = new Map<string, THREE.AnimationAction[]>()
  private current = ''
  private farAccumulator = 0

  constructor(private readonly mixers: THREE.AnimationMixer[], clipsPerLevel: THREE.AnimationClip[][]) {
    const names = new Set(clipsPerLevel.flatMap((clips) => clips.map((clip) => clip.name)))
    for (const name of names) {
      const actions = mixers.flatMap((mixer, index) => {
        const clip = clipsPerLevel[index].find((candidate) => candidate.name === name)
        return clip ? [mixer.clipAction(clip)] : []
      })
      this.actions.set(name, actions)
    }
  }

  private findClip(state: string): string | undefined {
    const candidates: Record<string, string[]> = {
      idle: ['idle'],
      walk: ['walk'],
      run: ['run'],
      daggerSlash: ['1h_melee_attack_stab', 'stab'],
      swordSlash: ['1h_melee_attack_stab', 'stab'],
      greatswordSlash: ['2h_melee_attack_stab', 'stab'],
      bowAim: ['2h_ranged_aiming', '1h_ranged_aiming', 'aim'],
      bowRelease: ['2h_ranged_shoot', '1h_ranged_shoot', 'shoot'],
      lanceThrust: ['2h_melee_attack_stab', 'stab'],
      mountedLance: ['2h_melee_attack_stab', 'stab'],
      mounted: ['mounted'],
      death: ['death'],
    }
    const wanted = candidates[state] ?? [state]
    return [...this.actions.keys()].find((name) => wanted.some((needle) => normalizeName(name).includes(normalizeName(needle))))
  }

  play(state: string, fadeSeconds = 0.12, loop = true): void {
    const clipName = this.findClip(state)
    if (!clipName || clipName === this.current) return
    const previous = this.actions.get(this.current) ?? []
    const next = this.actions.get(clipName) ?? []
    for (const action of previous) action.fadeOut(fadeSeconds)
    for (const action of next) {
      action.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
      action.clampWhenFinished = !loop
      action.fadeIn(fadeSeconds).play()
    }
    this.current = clipName
  }

  update(dt: number, cameraDistance = 0): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    if (cameraDistance > 28) {
      this.farAccumulator += dt
      if (this.farAccumulator < 1 / 12) return
      dt = this.farAccumulator
      this.farAccumulator = 0
    }
    for (const mixer of this.mixers) mixer.update(dt)
  }

  stop(): void {
    for (const mixer of this.mixers) mixer.stopAllAction()
    this.current = ''
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
  return { hip, knee, ankle, foot, side: side === 'L' ? -1 : 1 }
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
    await Promise.all((['viking', 'roman'] as const).map(async (faction) => {
      const base = `/models/characters/v2/${faction}`
      const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`Cannot load ${faction} humanoid manifest (${response.status})`)
      const manifest = await response.json() as HumanoidAssetManifest
      validateHumanoidManifest(faction, manifest)
      const files = manifest.files!
      const levels = await Promise.all([
        loader.loadAsync(`${base}/${files.lod0}`),
        loader.loadAsync(`${base}/${files.lod1}`),
        loader.loadAsync(`${base}/${files.lod2}`),
      ])
      for (const level of levels) firstSkinnedMesh(level.scene)
      this.templates.set(faction, { manifest, levels })
    }))
  }

  static createCharacterInstance(config: CharacterVisualConfig): HumanoidCharacterInstance {
    const template = this.templates.get(config.faction)
    if (!template) throw new Error(`HumanoidAssetRegistry is not preloaded for ${config.faction}`)
    const root = new THREE.Group()
    root.name = `${config.faction}-humanoid-v2`
    const lod = new THREE.LOD()
    const mixers: THREE.AnimationMixer[] = []
    const clipsPerLevel: THREE.AnimationClip[][] = []
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
      if (config.faction === 'viking') {
        const head = findBone(level, REQUIRED_BONES.head)
        findSocket(level, ['socket_head'], head, 'socket_head').add(createVikingHornAccessory())
      }
      lod.addLevel(level, [0, 12, 28][index])
      mixers.push(new THREE.AnimationMixer(level))
      clipsPerLevel.push(gltf.animations.length > 0 ? gltf.animations : PROJECT_ANIMATION_CLIPS)
      if (index === 0) {
        primaryScene = level
        skeleton = firstSkinnedMesh(level).skeleton
      }
    })
    root.add(lod)
    if (!primaryScene || !skeleton) throw new Error(`Failed to clone ${config.faction} humanoid`)
    const animation = new MixerController(mixers, clipsPerLevel)
    const rig = createHumanoidRigAdapter(primaryScene, animation)
    animation.play('idle')
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
