import * as THREE from 'three'

export const DEATH_FADE_TOTAL_SECONDS = 3.0
export const DEATH_FADE_DURATION_SECONDS = 0.75
export const DEATH_FADE_BUCKET_COUNT = 12
const DEATH_FADE_START_SECONDS = DEATH_FADE_TOTAL_SECONDS - DEATH_FADE_DURATION_SECONDS

interface PreparedMesh {
  mesh: THREE.Mesh
  originalMaterial: THREE.Material | THREE.Material[]
  originalCastShadow: boolean
  arrayVariants?: THREE.Material[][]
}

const fadeVariantsBySource = new WeakMap<THREE.Material, readonly THREE.Material[]>()

function buildFadeVariants(source: THREE.Material): readonly THREE.Material[] {
  const cached = fadeVariantsBySource.get(source)
  if (cached) return cached

  const variants = Array.from({ length: DEATH_FADE_BUCKET_COUNT }, (_, index) => {
    const ratio = 1 - index / DEATH_FADE_BUCKET_COUNT
    const material = source.clone()

    // Opaque materials stay in the opaque/depth-writing path and use hashed
    // coverage for the dissolve. Existing transparent materials keep their
    // authored blending behavior.
    if (!source.transparent) {
      material.transparent = false
      material.alphaHash = true
    }

    material.opacity = source.opacity * ratio
    return material
  })

  fadeVariantsBySource.set(source, variants)
  return variants
}

function materialForBucket(source: THREE.Material, bucket: number): THREE.Material {
  return buildFadeVariants(source)[bucket]
}

function prepareArrayVariants(materials: THREE.Material[]): THREE.Material[][] {
  return Array.from({ length: DEATH_FADE_BUCKET_COUNT }, (_, bucket) =>
    materials.map((material) => materialForBucket(material, bucket)),
  )
}

/**
 * Prepares shared fade-material variants for the supplied hierarchy and swaps
 * meshes to one representative fade bucket. Used by the offscreen render
 * warmup so the alpha-hash shader path is compiled before combat starts.
 */
export function applyDeathFadeWarmupVariant(root: THREE.Object3D): () => void {
  const restore: Array<{
    mesh: THREE.Mesh
    material: THREE.Material | THREE.Material[]
  }> = []

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return

    const original = mesh.material
    restore.push({ mesh, material: original })

    if (Array.isArray(original)) {
      mesh.material = original.map((material) => materialForBucket(material, 0))
    } else {
      mesh.material = materialForBucket(original, 0)
    }
  })

  return () => {
    for (const entry of restore) {
      entry.mesh.material = entry.material
    }
  }
}

/**
 * Keeps a corpse visible briefly, applies a bucketed alpha-hash dissolve, then
 * hides the actor root so Three.js no longer submits it for rendering.
 *
 * Key performance properties:
 * - Material variants are cached per shared source material, not cloned per NPC.
 * - prepare() runs before combat/death for NPCs.
 * - start() is O(1): no traversal, allocations, material cloning or recompiles.
 * - update() only swaps prebuilt material references when the fade bucket changes.
 * - No per-frame material.needsUpdate calls.
 */
export class DeathFadeController {
  private elapsed = 0
  private active = false
  private finished = false
  private lastBucket = -1
  private preparedMeshes: PreparedMesh[] = []

  get fading(): boolean {
    return this.active && !this.finished && this.elapsed >= DEATH_FADE_START_SECONDS
  }

  prepare(root: THREE.Object3D): void {
    const prepared: PreparedMesh[] = []

    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return

      const originalMaterial = mesh.material
      const entry: PreparedMesh = {
        mesh,
        originalMaterial,
        originalCastShadow: mesh.castShadow,
      }

      if (Array.isArray(originalMaterial)) {
        entry.arrayVariants = prepareArrayVariants(originalMaterial)
      } else {
        // Populate the shared cache now, before the actor can die.
        buildFadeVariants(originalMaterial)
      }

      prepared.push(entry)
    })

    this.preparedMeshes = prepared
  }

  start(root: THREE.Object3D): void {
    this.elapsed = 0
    this.active = true
    this.finished = false
    this.lastBucket = -1
    root.visible = true
  }

  update(root: THREE.Object3D, dt: number): boolean {
    if (!this.active || this.finished) return this.finished

    this.elapsed += Math.max(0, dt)
    if (this.elapsed < DEATH_FADE_START_SECONDS) return false

    const progress = THREE.MathUtils.clamp(
      (this.elapsed - DEATH_FADE_START_SECONDS) / DEATH_FADE_DURATION_SECONDS,
      0,
      1,
    )

    if (progress >= 1) {
      root.visible = false
      this.finished = true
      return true
    }

    const bucket = Math.min(
      DEATH_FADE_BUCKET_COUNT - 1,
      Math.floor(progress * DEATH_FADE_BUCKET_COUNT),
    )

    if (bucket !== this.lastBucket) {
      const firstFadeBucket = this.lastBucket < 0
      for (const entry of this.preparedMeshes) {
        if (firstFadeBucket) entry.mesh.castShadow = false

        if (Array.isArray(entry.originalMaterial)) {
          entry.mesh.material = entry.arrayVariants![bucket]
        } else {
          entry.mesh.material = materialForBucket(entry.originalMaterial, bucket)
        }
      }
      this.lastBucket = bucket
    }

    return false
  }

  reset(root: THREE.Object3D): void {
    for (const entry of this.preparedMeshes) {
      entry.mesh.material = entry.originalMaterial
      entry.mesh.castShadow = entry.originalCastShadow
    }

    this.elapsed = 0
    this.active = false
    this.finished = false
    this.lastBucket = -1
    root.visible = true
  }
}
