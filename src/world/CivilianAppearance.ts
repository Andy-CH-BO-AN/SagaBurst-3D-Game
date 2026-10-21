import type { CharacterFaction } from './CharacterVisuals'

/** Faction-authored clothing stays in the shared source geometry and materials.
 * Do not strip or recolor either model as a soldier-derived wardrobe. */
export function civilianHumanoidAssetId(faction: CharacterFaction): 'roman-civilian' | 'viking-civilian' {
  return faction === 'roman' ? 'roman-civilian' : 'viking-civilian'
}
