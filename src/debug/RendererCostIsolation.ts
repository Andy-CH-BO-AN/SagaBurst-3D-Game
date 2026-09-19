import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'

export type RenderProbeKind = 'normal' | 'no-shadow' | 'half-resolution' | 'simple-material'

const PROBE_PARAM_MAP: Array<{ param: string; probe: RenderProbeKind }> = [
  { param: 'perfNoShadow', probe: 'no-shadow' },
  { param: 'perfHalfResolution', probe: 'half-resolution' },
  { param: 'perfSimpleMaterial', probe: 'simple-material' },
]

/**
 * Resolves exactly one active RenderProbeKind from URL query parameters.
 * Throws an Error if conflicting probes are specified together, preventing invalid composite runs.
 */
export function getActiveRenderProbe(query: URLSearchParams): RenderProbeKind {
  if (!import.meta.env.DEV) return 'normal'
  const active = PROBE_PARAM_MAP.filter(({ param }) => query.has(param))
  if (active.length > 1) {
    const flags = active.map(({ param }) => param).join(', ')
    throw new Error(
      `[RendererCostIsolation] Conflicting render probes detected: ${flags}. Probes are mutually exclusive; specify at most one probe.`
    )
  }
  return active.length === 1 ? active[0].probe : 'normal'
}

export function isPerfNoShadow(query: URLSearchParams): boolean {
  return getActiveRenderProbe(query) === 'no-shadow'
}

export function isPerfHalfResolution(query: URLSearchParams): boolean {
  return getActiveRenderProbe(query) === 'half-resolution'
}

export function isPerfSimpleMaterial(query: URLSearchParams): boolean {
  return getActiveRenderProbe(query) === 'simple-material'
}

const simpleMaterialCache = new Map<string, THREE.MeshBasicMaterial>()

export function clearSimpleMaterialCacheForTesting(): void {
  simpleMaterialCache.clear()
}

/**
 * Creates or retrieves a simple diagnostic MeshBasicMaterial.
 *
 * Strips expensive PBR lighting and maps (normal, roughness, metalness, ao, etc.)
 * while strictly preserving coverage-affecting render state:
 * - `side` (culling)
 * - `alphaTest` and alpha-bearing texture (`map` or `alphaMap`) for cutout meshes (e.g. horse groom/hair)
 * - `transparent`, `opacity`, `depthWrite`, `depthTest`
 *
 * Prevents cutout meshes from turning into solid opaque cards that change fragment coverage / overdraw.
 */
export function getDevSimpleMaterial(sourceMat: THREE.Material, isSkinned: boolean): THREE.MeshBasicMaterial {
  const raw = (sourceMat ?? {}) as {
    side?: THREE.Side
    transparent?: boolean
    opacity?: number
    alphaTest?: number
    depthWrite?: boolean
    depthTest?: boolean
    wireframe?: boolean
    map?: THREE.Texture | null
    alphaMap?: THREE.Texture | null
  }

  const side = raw.side ?? THREE.FrontSide
  const transparent = Boolean(raw.transparent)
  const opacity = typeof raw.opacity === 'number' ? raw.opacity : 1
  const alphaTest = typeof raw.alphaTest === 'number' ? raw.alphaTest : 0
  const depthWrite = raw.depthWrite !== undefined ? Boolean(raw.depthWrite) : true
  const depthTest = raw.depthTest !== undefined ? Boolean(raw.depthTest) : true
  const wireframe = Boolean(raw.wireframe)

  // Cutout and transparency need alpha coverage from map or alphaMap
  const needsAlphaCoverage = alphaTest > 0 || transparent
  const map = needsAlphaCoverage && raw.map ? raw.map : null
  const alphaMap = needsAlphaCoverage && raw.alphaMap ? raw.alphaMap : null

  // If a diffuse map is kept for cutout alpha, use white so texture colors/alpha are untinted.
  // Otherwise use neutral diagnostic gray (0x888888).
  const color = map ? 0xffffff : 0x888888

  const mapKey = map ? map.uuid : '0'
  const alphaMapKey = alphaMap ? alphaMap.uuid : '0'
  const key = `${isSkinned ? 1 : 0}_${side}_${transparent ? 1 : 0}_${opacity}_${alphaTest}_${depthWrite ? 1 : 0}_${depthTest ? 1 : 0}_${wireframe ? 1 : 0}_${mapKey}_${alphaMapKey}`

  let mat = simpleMaterialCache.get(key)
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      side,
      transparent,
      opacity,
      alphaTest,
      depthWrite,
      depthTest,
      wireframe,
      map,
      alphaMap,
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
 * - Cutout alpha coverage and render-state properties
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
