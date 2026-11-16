import type { HeroCombatProfileId } from '../battle/HeroCombatProfile'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { careerHeroClasses, type CareerHeroClass } from './CareerHeroClasses'

/**
 * Hero classes a Duel opponent may use for one preset and tier. T4 and T5 offer the faction's two classes; the T4 archer
 * keeps its Ranger body, and T1-T3 duels use ordinary soldiers. Progress stays per preset and tier, never per class.
 */
export function careerDuelClassOptions(faction: CharacterFaction, presetId: UnitPresetId, tier: number): readonly CareerHeroClass[] {
  const preset = UNIT_PRESETS[presetId]
  if (!preset || preset.faction !== faction || tier !== 4 && tier !== 5) return []
  if (tier === 4 && preset.traits.includes('bow_fire')) return []
  return careerHeroClasses(faction, tier)
}

/** The chosen class; an absent ID is a pre-class save or caller and means the faction's original (first) class. */
export function resolveCareerDuelClass(faction: CharacterFaction, presetId: UnitPresetId, tier: number, classId?: HeroCombatProfileId): CareerHeroClass | undefined {
  const options = careerDuelClassOptions(faction, presetId, tier)
  return classId === undefined ? options[0] : options.find(option => option.combatProfileId === classId)
}
