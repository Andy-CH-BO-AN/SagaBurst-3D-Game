import * as THREE from 'three'

export const DEATH_FADE_TOTAL_SECONDS = 3.0
export const DEATH_FADE_DURATION_SECONDS = 0.75
const DEATH_FADE_START_SECONDS = DEATH_FADE_TOTAL_SECONDS - DEATH_FADE_DURATION_SECONDS

interface FadeMaterialState {
  material: THREE.Material
  opacity: number
  transparent: boolean
  depthWrite: boolean
}

/**
 * Keeps a corpse visible briefly, fades every mesh (including attached equipment),
 * then hides the whole character root so Three.js no longer renders it.
 *
 * Materials are cloned on death so fading one character never mutates materials
 * shared by other characters.
 */
export class DeathFadeController {
  private elapsed = 0
  private active = false
  private finished = false
  private prepared = false
  private materials: FadeMaterialState[] = []

  start(root: THREE.Object3D): void {
    this.elapsed = 0
    this.active = true
    this.finished = false
    root.visible = true

    if (!this.prepared) {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return

        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const clonedMaterials = sourceMaterials.map((source) => {
          const material = source.clone()
          this.materials.push({
            material,
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          })
          return material
        })

        mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0]
      })
      this.prepared = true
    } else {
      this.restoreMaterials()
    }
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

    for (const state of this.materials) {
      state.material.transparent = true
      state.material.depthWrite = false
      state.material.opacity = state.opacity * (1 - progress)
      state.material.needsUpdate = true
    }

    if (progress >= 1) {
      root.visible = false
      this.finished = true
    }

    return this.finished
  }

  reset(root: THREE.Object3D): void {
    this.restoreMaterials()
    this.elapsed = 0
    this.active = false
    this.finished = false
    root.visible = true
  }

  private restoreMaterials(): void {
    for (const state of this.materials) {
      state.material.opacity = state.opacity
      state.material.transparent = state.transparent
      state.material.depthWrite = state.depthWrite
      state.material.needsUpdate = true
    }
  }
}
