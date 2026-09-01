import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type HorseAnimationState =
  | 'idle'
  | 'walk'
  | 'trot'
  | 'canter'
  | 'gallop'
  | 'jump'
  | 'land'
  | 'hit'
  | 'death'

export type HorseAppearanceVariant = 0 | 1 | 2

export interface HorseVariantManifest {
  id: string
  label: string
  baseColor: string
}

export interface HorseAssetManifest {
  schemaVersion: 2
  id: string
  status: 'ready' | 'blocked'
  reason?: string
  attribution: string
  sources: Array<{
    author: string
    url: string
    license: string
    sha256: string
  }>
  file: string | null
  basisPath: string
  lodNodes: {
    lod0: string
    lod1: string
    lod2: string
  }
  bodyMeshNames: string[]
  sharedBodyMaps: {
    normal: string
    roughness: string
    ao?: string
  }
  variants: [HorseVariantManifest, HorseVariantManifest, HorseVariantManifest]
  compression: {
    geometry: 'EXT_meshopt_compression'
    textures: 'KHR_texture_basisu'
  }
  metrics: {
    shoulderHeightM: number
    overallHeightM: number
    saddleHeightM: number
    widthM: number
    lengthM: number
    packageBytes: number
    triangles: {
      lod0: number
      lod1: number
      lod2: number
    }
    textureMaxSize: number
  } | null
  forward: '+Z'
  clips: HorseAnimationState[]
  sockets: string[]
}

export interface HorseTemplate {
  manifest: HorseAssetManifest
  gltf: GLTF
  bodyMaterials: THREE.MeshStandardMaterial[]
}

export interface HorseDebugState {
  clip: HorseAnimationState
  time: number
  playbackRate: number
  paused: boolean
  lod: number
  variant: HorseAppearanceVariant
  mixerCount: 1
  skeletonCount: 1
}

export interface HorseInstance {
  root: THREE.Group
  lod: THREE.LOD
  skeleton: THREE.Skeleton
  mixer: THREE.AnimationMixer
  saddleSeat: THREE.Object3D
  stirrupLeft: THREE.Object3D
  stirrupRight: THREE.Object3D
  cameraSocket: THREE.Object3D
  bounds: THREE.Box3
  attribution: string
  appearanceVariant: HorseAppearanceVariant
  setAppearanceVariant(variant: HorseAppearanceVariant): void
  setLocomotion(speed: number): void
  playOnce(state: Extract<HorseAnimationState, 'jump' | 'land' | 'hit'>): void
  playDeath(): void
  playStudioClip(state: HorseAnimationState): void
  togglePaused(): boolean
  update(dt: number, cameraDistance?: number): void
  debugState(): HorseDebugState
  dispose(): void
}

const REQUIRED_CLIPS: HorseAnimationState[] = [
  'idle',
  'walk',
  'trot',
  'canter',
  'gallop',
  'jump',
  'land',
  'hit',
  'death',
]

const REQUIRED_SOCKETS = [
  'socket_saddle_seat',
  'socket_stirrup_l',
  'socket_stirrup_r',
  'socket_camera',
]

const LOD_DISTANCES = [0, 18, 38] as const
const MAX_PACKAGE_BYTES = 30 * 1024 * 1024
const HORSE_GAIT_REFERENCE_SPEEDS: Partial<Record<HorseAnimationState, number>> = {
  walk: 2.4,
  trot: 5.25,
  canter: 8.75,
  gallop: 12,
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let result: THREE.SkinnedMesh | undefined
  root.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object
  })
  if (!result) throw new Error('Horse GLB contains no SkinnedMesh')
  return result
}

function bindSingleSkeleton(root: THREE.Object3D): THREE.Skeleton {
  const canonical = firstSkinnedMesh(root).skeleton
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || object.skeleton === canonical) return
    object.bind(canonical, object.bindMatrix)
  })
  return canonical
}

function requireObject(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name)
  if (!object) throw new Error(`Horse GLB is missing ${name}`)
  return object
}

function requireMesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = requireObject(root, name)
  if (!(object instanceof THREE.Mesh)) throw new Error(`Horse object ${name} is not a mesh`)
  if (Array.isArray(object.material)) throw new Error(`Horse body mesh ${name} must use one material`)
  return object
}

function normalizedClips(gltf: GLTF): Map<HorseAnimationState, THREE.AnimationClip> {
  const byName = new Map(gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]))
  const result = new Map<HorseAnimationState, THREE.AnimationClip>()
  for (const name of REQUIRED_CLIPS) {
    const clip = byName.get(name)
    if (!clip) throw new Error(`Horse GLB is missing ${name} animation`)
    result.set(name, clip)
  }
  return result
}

function requireKtx2(path: string, label: string): void {
  if (!path.toLowerCase().endsWith('.ktx2')) throw new Error(`${label} must be a KTX2 texture`)
}

export function horseLocomotionClipForSpeed(speed: number): HorseAnimationState {
  if (!Number.isFinite(speed) || speed < 0.25) return 'idle'
  if (speed < 3.5) return 'walk'
  if (speed < 7) return 'trot'
  if (speed < 10.5) return 'canter'
  return 'gallop'
}

export function horseVariantFromSave(value: unknown): HorseAppearanceVariant {
  return value === 1 || value === 2 ? value : 0
}

export function horseVariantForStableKey(key: string): HorseAppearanceVariant {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 3 as HorseAppearanceVariant
}

export function validateHorseManifest(manifest: HorseAssetManifest): void {
  if (manifest.schemaVersion !== 2) throw new Error('Horse manifest schema is unsupported')
  if (manifest.status !== 'ready') throw new Error(`Horse asset is blocked: ${manifest.reason ?? 'manifest is not ready'}`)
  if (!manifest.file?.toLowerCase().endsWith('.glb')) throw new Error('Horse manifest has no runtime GLB')
  if (!manifest.basisPath) throw new Error('Horse manifest has no Basis transcoder path')
  if (!manifest.metrics) throw new Error('Horse manifest has no measured metrics')
  if (!manifest.attribution) throw new Error('Horse attribution must be a non-empty string')
  if (!manifest.sources.length) throw new Error('Horse manifest has no licensed sources')
  for (const source of manifest.sources) {
    if (!source.author || !source.url || !source.license || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      throw new Error('Horse source attribution is incomplete')
    }
  }
  if (manifest.forward !== '+Z') throw new Error('Horse asset must face local +Z')
  if (manifest.compression.geometry !== 'EXT_meshopt_compression') throw new Error('Horse geometry must use Meshopt')
  if (manifest.compression.textures !== 'KHR_texture_basisu') throw new Error('Horse textures must use KTX2')
  if (Math.abs(manifest.metrics.shoulderHeightM - 1.65) > 0.09) throw new Error('Horse shoulder height is outside tolerance')
  if (manifest.metrics.overallHeightM < 1.8 || manifest.metrics.overallHeightM > 2.5) throw new Error('Horse overall height is outside tolerance')
  if (manifest.metrics.saddleHeightM < 1.55 || manifest.metrics.saddleHeightM > 2.0) throw new Error('Horse saddle height is outside tolerance')
  if (manifest.metrics.triangles.lod0 > 65000) throw new Error('Horse LOD0 exceeds triangle budget')
  if (manifest.metrics.triangles.lod1 > 22000) throw new Error('Horse LOD1 exceeds triangle budget')
  if (manifest.metrics.triangles.lod2 > 7000) throw new Error('Horse LOD2 exceeds triangle budget')
  if (manifest.metrics.textureMaxSize !== 2048) throw new Error('Horse texture maximum must be 2048')
  if (manifest.metrics.packageBytes > MAX_PACKAGE_BYTES) throw new Error('Horse runtime package exceeds 30 MB')
  const lodNames = Object.values(manifest.lodNodes)
  if (lodNames.some((name) => !name) || new Set(lodNames).size !== 3) throw new Error('Horse LOD node names are incomplete')
  if (manifest.bodyMeshNames.length !== 3 || new Set(manifest.bodyMeshNames).size !== 3) {
    throw new Error('Horse manifest must name one body mesh per LOD')
  }
  requireKtx2(manifest.sharedBodyMaps.normal, 'Horse body normal map')
  requireKtx2(manifest.sharedBodyMaps.roughness, 'Horse body roughness map')
  if (manifest.sharedBodyMaps.ao) requireKtx2(manifest.sharedBodyMaps.ao, 'Horse body AO map')
  if (manifest.variants.length !== 3) throw new Error('Horse manifest must contain three coat variants')
  if (new Set(manifest.variants.map((variant) => variant.id)).size !== 3) throw new Error('Horse variant IDs must be unique')
  for (const variant of manifest.variants) {
    if (!variant.id || !variant.label) throw new Error('Horse variant metadata is incomplete')
    requireKtx2(variant.baseColor, `Horse variant ${variant.id}`)
  }
  for (const clip of REQUIRED_CLIPS) {
    if (!manifest.clips.includes(clip)) throw new Error(`Horse manifest is missing ${clip} clip`)
  }
  for (const socket of REQUIRED_SOCKETS) {
    if (!manifest.sockets.includes(socket)) throw new Error(`Horse manifest is missing ${socket}`)
  }
}

class HorseAnimationController {
  private readonly actions = new Map<HorseAnimationState, THREE.AnimationAction>()
  private current: HorseAnimationState = 'idle'
  private requestedLocomotion: HorseAnimationState = 'idle'
  private oneShot: HorseAnimationState | null = null
  private oneShotRemaining = 0
  private paused = false
  private farAccumulator = 0
  private playbackRate = 1
  private requestedPlaybackRate = 1

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    clips: Map<HorseAnimationState, THREE.AnimationClip>,
    private readonly lod: THREE.LOD,
    private readonly getVariant: () => HorseAppearanceVariant,
  ) {
    for (const name of REQUIRED_CLIPS) this.actions.set(name, mixer.clipAction(clips.get(name)!))
    this.play('idle', 0, true)
    mixer.update(0)
  }

  private play(state: HorseAnimationState, fadeSeconds = 0.18, restart = false): void {
    if (state === this.current && !restart) return
    const previous = this.actions.get(this.current)
    const next = this.actions.get(state)!
    const clamp = state === 'death' || this.oneShot === state
    next.enabled = true
    next.clampWhenFinished = clamp
    next.setLoop(clamp ? THREE.LoopOnce : THREE.LoopRepeat, clamp ? 1 : Infinity)
    if (restart || state !== this.current) next.reset()
    next.play()
    if (previous && previous !== next) {
      if (fadeSeconds > 0) previous.crossFadeTo(next, fadeSeconds, true)
      else previous.stop()
    }
    this.current = state
  }

  setLocomotion(speed: number): void {
    this.requestedLocomotion = horseLocomotionClipForSpeed(speed)
    const referenceSpeed = HORSE_GAIT_REFERENCE_SPEEDS[this.requestedLocomotion]
    this.requestedPlaybackRate = referenceSpeed
      ? THREE.MathUtils.clamp(Math.abs(speed) / referenceSpeed, 0.5, 1.5)
      : 1
    if (this.oneShot || this.current === 'death') return
    this.play(this.requestedLocomotion)
    this.playbackRate = this.requestedPlaybackRate
    this.actions.get(this.requestedLocomotion)!.setEffectiveTimeScale(this.playbackRate)
  }

  playOnce(state: Extract<HorseAnimationState, 'jump' | 'land' | 'hit'>): void {
    if (this.current === 'death') return
    this.oneShot = state
    this.oneShotRemaining = Math.max(0.05, this.actions.get(state)!.getClip().duration)
    this.playbackRate = 1
    this.actions.get(state)!.setEffectiveTimeScale(1)
    this.play(state, 0.12, true)
  }

  playDeath(): void {
    this.oneShot = null
    this.oneShotRemaining = 0
    this.playbackRate = 1
    this.actions.get('death')!.setEffectiveTimeScale(1)
    this.play('death', 0.12, true)
  }

  playStudioClip(state: HorseAnimationState): void {
    this.oneShot = null
    this.oneShotRemaining = 0
    this.requestedLocomotion = state
    this.playbackRate = 1
    this.actions.get(state)!.setEffectiveTimeScale(1)
    this.play(state, 0.12, true)
  }

  togglePaused(): boolean {
    this.paused = !this.paused
    this.mixer.timeScale = this.paused ? 0 : 1
    return this.paused
  }

  update(dt: number, cameraDistance = 0): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.paused) return
    let step = dt
    if (cameraDistance > 35) {
      this.farAccumulator += dt
      if (this.farAccumulator < 1 / 15) return
      step = this.farAccumulator
      this.farAccumulator = 0
    }
    this.mixer.update(step)
    if (this.oneShot) {
      this.oneShotRemaining -= step
      if (this.oneShotRemaining <= 0) {
        this.oneShot = null
        this.play(this.requestedLocomotion, 0.15, true)
        this.playbackRate = this.requestedPlaybackRate
        this.actions.get(this.requestedLocomotion)!.setEffectiveTimeScale(this.playbackRate)
      }
    }
  }

  debugState(): HorseDebugState {
    return {
      clip: this.current,
      time: this.mixer.time,
      playbackRate: this.playbackRate,
      paused: this.paused,
      lod: this.lod.getCurrentLevel(),
      variant: this.getVariant(),
      mixerCount: 1,
      skeletonCount: 1,
    }
  }

  stop(): void {
    this.mixer.stopAllAction()
  }
}

export function createHorseInstance(template: HorseTemplate, initialVariant: HorseAppearanceVariant): HorseInstance {
  const root = cloneSkeleton(template.gltf.scene) as THREE.Group
  root.name = 'horse-mount-v2'
  const skeleton = bindSingleSkeleton(root)
  const lod = new THREE.LOD()
  lod.name = 'horse-lod'
  const levels = [
    requireObject(root, template.manifest.lodNodes.lod0),
    requireObject(root, template.manifest.lodNodes.lod1),
    requireObject(root, template.manifest.lodNodes.lod2),
  ]
  root.updateWorldMatrix(true, true)
  for (let index = 0; index < levels.length; index++) {
    lod.attach(levels[index])
    lod.addLevel(levels[index], LOD_DISTANCES[index], 0.1)
  }
  root.add(lod)
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = lod.getObjectForDistance(0)?.getObjectById(object.id) !== undefined
      object.receiveShadow = true
    }
  })

  const mixer = new THREE.AnimationMixer(root)
  let appearanceVariant = initialVariant
  const bodyMeshes = template.manifest.bodyMeshNames.map((name) => requireMesh(root, name))
  const applyVariant = (variant: HorseAppearanceVariant): void => {
    appearanceVariant = variant
    for (const mesh of bodyMeshes) mesh.material = template.bodyMaterials[variant]
  }
  applyVariant(initialVariant)
  const animation = new HorseAnimationController(
    mixer,
    normalizedClips(template.gltf),
    lod,
    () => appearanceVariant,
  )
  const bounds = new THREE.Box3().setFromObject(root)

  return {
    root,
    lod,
    skeleton,
    mixer,
    saddleSeat: requireObject(root, 'socket_saddle_seat'),
    stirrupLeft: requireObject(root, 'socket_stirrup_l'),
    stirrupRight: requireObject(root, 'socket_stirrup_r'),
    cameraSocket: requireObject(root, 'socket_camera'),
    bounds,
    attribution: template.manifest.attribution,
    get appearanceVariant() { return appearanceVariant },
    setAppearanceVariant: applyVariant,
    setLocomotion: (speed) => animation.setLocomotion(speed),
    playOnce: (state) => animation.playOnce(state),
    playDeath: () => animation.playDeath(),
    playStudioClip: (state) => animation.playStudioClip(state),
    togglePaused: () => animation.togglePaused(),
    update: (dt, cameraDistance = 0) => animation.update(dt, cameraDistance),
    debugState: () => animation.debugState(),
    dispose: () => {
      animation.stop()
      root.removeFromParent()
    },
  }
}

function textureUrl(base: string, path: string): string {
  return `${base}/${path.replace(/^\/+/, '')}`
}

export class HorseAssetRegistry {
  private static template: HorseTemplate | null = null
  private static preloadPromise: Promise<void> | null = null

  static get ready(): boolean {
    return this.template !== null
  }

  static preload(renderer: THREE.WebGLRenderer): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = this.load(renderer).catch((error) => {
        this.preloadPromise = null
        throw error
      })
    }
    return this.preloadPromise
  }

  private static async load(renderer: THREE.WebGLRenderer): Promise<void> {
    const base = '/models/mounts/v1/horse'
    const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cannot load horse manifest (${response.status})`)
    const manifest = await response.json() as HorseAssetManifest
    validateHorseManifest(manifest)

    const ktx2Loader = new KTX2Loader()
      .setTranscoderPath(textureUrl(base, manifest.basisPath))
      .detectSupport(renderer)
    const loader = new GLTFLoader()
      .setKTX2Loader(ktx2Loader)
      .setMeshoptDecoder(MeshoptDecoder)

    try {
      const gltf = await loader.loadAsync(textureUrl(base, manifest.file!))
      firstSkinnedMesh(gltf.scene)
      normalizedClips(gltf)
      for (const socket of REQUIRED_SOCKETS) requireObject(gltf.scene, socket)
      for (const name of Object.values(manifest.lodNodes)) requireObject(gltf.scene, name)
      for (const name of manifest.bodyMeshNames) requireMesh(gltf.scene, name)

      const [normal, roughness, ao, ...baseColors] = await Promise.all([
        ktx2Loader.loadAsync(textureUrl(base, manifest.sharedBodyMaps.normal)),
        ktx2Loader.loadAsync(textureUrl(base, manifest.sharedBodyMaps.roughness)),
        manifest.sharedBodyMaps.ao
          ? ktx2Loader.loadAsync(textureUrl(base, manifest.sharedBodyMaps.ao))
          : Promise.resolve(null),
        ...manifest.variants.map((variant) => ktx2Loader.loadAsync(textureUrl(base, variant.baseColor))),
      ])
      const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      for (const texture of [normal, roughness, ao, ...baseColors]) {
        if (!texture) continue
        texture.anisotropy = anisotropy
      }
      normal.colorSpace = THREE.NoColorSpace
      roughness.colorSpace = THREE.NoColorSpace
      if (ao) ao.colorSpace = THREE.NoColorSpace
      for (const texture of baseColors) texture.colorSpace = THREE.SRGBColorSpace

      const sourceMaterial = requireMesh(gltf.scene, manifest.bodyMeshNames[0]).material
      if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) {
        throw new Error('Horse body material must be MeshStandardMaterial')
      }
      const bodyMaterials = baseColors.map((baseColor, index) => {
        const material = sourceMaterial.clone()
        material.name = `horse-body-${manifest.variants[index].id}`
        material.map = baseColor
        material.normalMap = normal
        material.roughnessMap = roughness
        material.aoMap = ao
        material.metalness = 0
        material.needsUpdate = true
        return material
      })
      this.template = { manifest, gltf, bodyMaterials }
    } finally {
      ktx2Loader.dispose()
    }
  }

  static createInstance(config: { variant?: HorseAppearanceVariant } = {}): HorseInstance {
    if (!this.template) throw new Error('HorseAssetRegistry is not preloaded')
    return createHorseInstance(this.template, config.variant ?? 0)
  }
}
