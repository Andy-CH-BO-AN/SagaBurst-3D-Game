import * as THREE from 'three'
import visualSource from './XongkoroVisual.ts?raw'
import groundSource from './XongkoroGroundPose.ts?raw'
import configSource from '../movement/XongkoroConfig.ts?raw'

export interface XongkoroMeshBounds {
  name: string
  vertices: number
  triangles: number
  center: [number, number, number]
  radius: number
}

export interface XongkoroRenderBounds {
  schemaVersion: number
  threeRevision: string
  assetSha256: string
  poseSha256: string
  space: string
  meshes: XongkoroMeshBounds[]
}

interface BoundsIdentity { assetSha256: string; poseSha256: string; threeRevision: string }
type BoundsValidation = { bounds: XongkoroRenderBounds; reason: null } | { bounds: null; reason: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const digestPattern = /^[a-f0-9]{64}$/

/** Small data-only gate. A stale/invalid envelope must retain uncullable rendering. */
export function validateXongkoroRenderBounds(value: unknown, identity: BoundsIdentity): BoundsValidation {
  if (!record(value) || value.schemaVersion !== 1 || value.space !== 'XongkoroVisual.root') return { bounds: null, reason: 'invalid metadata schema/space' }
  if (value.threeRevision !== identity.threeRevision || value.assetSha256 !== identity.assetSha256 || value.poseSha256 !== identity.poseSha256
    || !digestPattern.test(identity.assetSha256) || !digestPattern.test(identity.poseSha256)) return { bounds: null, reason: 'asset, pose source or Three.js contract changed' }
  if (!Array.isArray(value.meshes) || value.meshes.length !== 3) return { bounds: null, reason: 'invalid render mesh inventory' }
  for (const [index, mesh] of value.meshes.entries()) {
    if (!record(mesh) || mesh.name !== `eagle_body_lod${index}` || !Number.isInteger(mesh.vertices) || Number(mesh.vertices) <= 0
      || !Number.isInteger(mesh.triangles) || Number(mesh.triangles) <= 0 || !Array.isArray(mesh.center) || mesh.center.length !== 3
      || !mesh.center.every(component => typeof component === 'number' && Number.isFinite(component))
      || typeof mesh.radius !== 'number' || !Number.isFinite(mesh.radius) || mesh.radius <= 0) return { bounds: null, reason: `invalid LOD${index} envelope` }
  }
  // All fields consumed below have been checked; unknown provenance fields stay inert.
  return { bounds: value as unknown as XongkoroRenderBounds, reason: null }
}

export interface XongkoroBoundsDiagnostics {
  enabled: boolean
  reason: string | null
  loadMilliseconds: number
  verificationMilliseconds: number
}

/** One shared asset load/hash, never a per-instance or per-frame operation. */
export async function loadXongkoroRenderBounds(url: string | null, asset: ArrayBuffer, expectedMetadataSha256: unknown): Promise<{ bounds: XongkoroRenderBounds | null; diagnostics: XongkoroBoundsDiagnostics }> {
  const started = performance.now()
  let verificationMilliseconds = 0
  try {
    if (!url || typeof expectedMetadataSha256 !== 'string' || !digestPattern.test(expectedMetadataSha256)) throw new Error('manifest has no verified renderBounds metadata')
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable')
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`metadata request failed (${response.status})`)
    // Canonical LF text keeps the checksum stable across Windows checkouts.
    const metadataText = (await response.text()).replace(/\r\n/g, '\n')
    const metadataBytes = new TextEncoder().encode(metadataText)
    const verifying = performance.now()
    const sha256 = async (bytes: BufferSource): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const [assetSha256, poseSha256, metadataSha256] = await Promise.all([sha256(asset), sha256(new TextEncoder().encode([visualSource, groundSource, configSource].map(source => source.replace(/\r\n/g, '\n')).join('\n'))), sha256(metadataBytes)])
    if (metadataSha256 !== expectedMetadataSha256) throw new Error('metadata checksum changed')
    const metadata: unknown = JSON.parse(metadataText)
    const validation = validateXongkoroRenderBounds(metadata, { assetSha256, poseSha256, threeRevision: THREE.REVISION })
    verificationMilliseconds = performance.now() - verifying
    if (!validation.bounds) throw new Error(validation.reason)
    return { bounds: validation.bounds, diagnostics: { enabled: true, reason: null, loadMilliseconds: performance.now() - started, verificationMilliseconds } }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[xongkoro] conservative render culling disabled: ${reason}`)
    return { bounds: null, diagnostics: { enabled: false, reason, loadMilliseconds: performance.now() - started, verificationMilliseconds } }
  }
}

/** Converts a root-space envelope into the final attached mesh's local space.
 * max(abs-row-sum(A^T A)) bounds the largest singular value even with shear;
 * using just a matrix column length here would not establish containment.
 */
export function xongkoroMeshLocalSphere(bounds: Pick<XongkoroMeshBounds, 'center' | 'radius'>, rootToMesh: THREE.Matrix4): THREE.Sphere {
  const e = rootToMesh.elements
  const a = [e[0], e[1], e[2]], b = [e[4], e[5], e[6]], c = [e[8], e[9], e[10]]
  const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const aa = dot(a, a), ab = Math.abs(dot(a, b)), ac = Math.abs(dot(a, c)), bb = dot(b, b), bc = Math.abs(dot(b, c)), cc = dot(c, c)
  const scaleUpperBound = Math.sqrt(Math.max(aa + ab + ac, ab + bb + bc, ac + bc + cc))
  return new THREE.Sphere(new THREE.Vector3(...bounds.center).applyMatrix4(rootToMesh), bounds.radius * scaleUpperBound)
}
