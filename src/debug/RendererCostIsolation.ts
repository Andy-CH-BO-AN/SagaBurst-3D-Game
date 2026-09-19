import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'

export type RenderProbeKind = 'normal' | 'no-shadow' | 'half-resolution' | 'simple-material'

export function isPerfNoShadow(query: URLSearchParams): boolean {
  return import.meta.env.DEV && query.has('perfNoShadow')
}

export function isPerfHalfResolution(query: URLSearchParams): boolean {
  return import.meta.env.DEV && query.has('perfHalfResolution')
}

export function isPerfSimpleMaterial(query: URLSearchParams): boolean {
  return import.meta.env.DEV && query.has('perfSimpleMaterial')
}

export function getActiveRenderProbe(query: URLSearchParams): RenderProbeKind {
  if (isPerfNoShadow(query)) return 'no-shadow'
  if (isPerfHalfResolution(query)) return 'half-resolution'
  if (isPerfSimpleMaterial(query)) return 'simple-material'
  return 'normal'
}

const simpleMaterialCache = new Map<string, THREE.MeshBasicMaterial>()

/**
 * Creates or retrieves a simple diagnostic MeshBasicMaterial.
 * Strictly preserves the source material's `side` (culling) property
 * so back-face culling is not disabled.
 */
export function getDevSimpleMaterial(sourceMat: THREE.Material, isSkinned: boolean): THREE.MeshBasicMaterial {
  const side = sourceMat?.side ?? THREE.FrontSide
  const key = `${isSkinned ? 'skinned' : 'static'}_side_${side}`
  let mat = simpleMaterialCache.get(key)
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color: 0x888888,
      side,
    })
    simpleMaterialCache.set(key, mat)
  }
  return mat
}

/**
 * DEV-only helper: replaces rendering materials for all NPCs and mounts
 * with simple diagnostic materials while preserving:
 * - Exact geometry and object counts
 * - Material-group counts and draw-call structures
 * - SkinnedMesh bindings
 * - Hit-flash damage restoration (does not revert to production PBR)
 */
export function applyDevSimpleMaterials(npcs: NPC[], mounts: Mount[]): void {
  if (!import.meta.env.DEV) return

  for (const npc of npcs) {
    npc.devApplySimpleMaterials(getDevSimpleMaterial)
  }

  for (const mount of mounts) {
    mount.devApplySimpleMaterials(getDevSimpleMaterial)
  }
}
