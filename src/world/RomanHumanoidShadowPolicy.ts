/**
 * RomanHumanoidShadowPolicy.ts
 *
 * Authoritative shadow casting policy for Roman Humanoid character instances.
 *
 * Audited and verified for gameplay perspective fidelity:
 * Keeps only 5 essential silhouette casters:
 * - Helmet3_1: Main helmet
 * - Armour_top_1: Lorica Segmentata chest/shoulder armor
 * - Tunic_1: Red tunic body and skirt
 * - Boots: Feet and caligae (ground contact shadow)
 * - Wrist_guard1: Forearm bracers (arm silhouette continuity during combat/archery)
 *
 * All other 12 meshes do not cast shadow in LOD0 or LOD1:
 * - New_arms, New_legs, New_head, Full_figure_42_T_pose, Dangles, Ties,
 *   Helmet3_2, Armour_top_2, RomanUndertunic_l, RomanUndertunic_r, New_eye, New_eye_2
 *
 * LOD2:
 * - Unconditionally castShadow = false for all meshes.
 */

export const ROMAN_SHADOW_KEEP_MESHES: ReadonlySet<string> = new Set([
  'Helmet3_1',
  'Armour_top_1',
  'Tunic_1',
  'Boots',
  'Wrist_guard1',
])

export const ROMAN_SHADOW_DROP_ALL_LODS: ReadonlySet<string> = new Set([
  'Armour_top_2',
  'Dangles',
  'Full_figure_42_T_pose',
  'Helmet3_2',
  'New_arms',
  'New_eye',
  'New_eye_2',
  'New_head',
  'New_legs',
  'RomanUndertunic_l',
  'RomanUndertunic_r',
  'Ties',
])

export const ROMAN_SHADOW_DROP_LOD1: ReadonlySet<string> = new Set([
  ...ROMAN_SHADOW_DROP_ALL_LODS,
])

export function shouldRomanHumanoidCastShadow(meshName: string, lodIndex: number): boolean {
  if (lodIndex >= 2) return false
  if (lodIndex === 0 || lodIndex === 1) return ROMAN_SHADOW_KEEP_MESHES.has(meshName)
  return false
}
