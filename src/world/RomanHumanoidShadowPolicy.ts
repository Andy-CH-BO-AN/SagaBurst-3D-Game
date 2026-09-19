/**
 * RomanHumanoidShadowPolicy.ts
 *
 * Authoritative shadow casting policy for Roman Humanoid character instances.
 *
 * Audited from PR #55 fixed-scene shadow breakdown & isolated visual QA:
 *
 * DROP_ALL_LODS (dropped in both LOD0 and LOD1):
 * - New_eye, New_eye_2: Eyeballs embedded inside skull/helmet; zero perceptible shadow difference.
 * - Helmet3_2: 2.5cm forehead brow emblem attached directly to Helmet3_1; completely enclosed in helmet shadow volume.
 * - Armour_top_2: Internal shoulder buckles completely enclosed by Armour_top_1.
 * - Ties: Thin lace cords flat against torso/tunic; 0 pixel contribution in shadow map.
 * - RomanUndertunic_l, RomanUndertunic_r: Internal thigh patches under Tunic_1; fully enveloped by skirt.
 *
 * DROP_FROM_LOD1 (dropped only in LOD1 where camera distance >= 12m):
 * - Dangles: Pteruges leather straps; visible close-up in LOD0, sub-pixel at mid-distance.
 * - Wrist_guard1: Forearm bracers; arm shadow is already fully defined by New_arms.
 *
 * KEEP_ALWAYS:
 * - Helmet3_1: Main helmet (cap, cheek guards, crest)
 * - New_head: Face, neck, chin
 * - Armour_top_1: Lorica Segmentata chest & shoulder plates
 * - Full_figure_42_T_pose: Clavicle & torso body
 * - Tunic_1: Red tunic skirt & body garment
 * - New_arms: Arms, elbows, hands
 * - New_legs: Legs & thighs
 * - Boots: Feet & caligae
 *
 * LOD2:
 * - Unconditionally castShadow = false for all meshes.
 */

export const ROMAN_SHADOW_DROP_ALL_LODS: ReadonlySet<string> = new Set([
  'New_eye',
  'New_eye_2',
  'Helmet3_2',
  'Armour_top_2',
  'Ties',
  'RomanUndertunic_l',
  'RomanUndertunic_r',
])

export const ROMAN_SHADOW_DROP_LOD1: ReadonlySet<string> = new Set([
  ...ROMAN_SHADOW_DROP_ALL_LODS,
  'Dangles',
  'Wrist_guard1',
])

export function shouldRomanHumanoidCastShadow(meshName: string, lodIndex: number): boolean {
  if (lodIndex >= 2) return false
  if (lodIndex === 0) return !ROMAN_SHADOW_DROP_ALL_LODS.has(meshName)
  if (lodIndex === 1) return !ROMAN_SHADOW_DROP_LOD1.has(meshName)
  return false
}
