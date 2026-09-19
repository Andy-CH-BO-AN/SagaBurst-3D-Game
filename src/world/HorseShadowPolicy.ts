/**
 * Authoritative, fail-closed shadow policy for the shipped horse GLB.
 *
 * The three names below were measured from actual LOD0 renderBufferDirect
 * submissions. New or renamed meshes deliberately remain non-casters until
 * a fresh asset audit explicitly admits them.
 */
export const HORSE_LOD0_SHADOW_KEEP_MESHES: ReadonlySet<string> = new Set([
  'horse_body_lod0',
  'horse_groom_tail_lod0',
  'horse_horse_hooves',
])

export function shouldHorseCastShadow(meshName: string, lodIndex: number): boolean {
  return lodIndex === 0 && HORSE_LOD0_SHADOW_KEEP_MESHES.has(meshName)
}
