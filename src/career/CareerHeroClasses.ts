import { HERO_COMBAT_PROFILES, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import { HEAVY_T4_HERO } from '../battle/T4HeroCatalog'
import { getT5ProfileForPreset } from '../battle/T5HeroCatalog'
import { resolveCharacterIdentity, type CharacterIdentity, type HeroArchetype } from '../combat/CharacterIdentity'
import type { HeroAssetId } from '../world/HeroAssetCatalog'

type Faction = CharacterIdentity['characterFaction']

/** Player-facing class names; engineering IDs (asset/profile) never reach a screen. */
export const HERO_CLASS_NAMES: Readonly<Record<HeroCombatProfileId, { zh: string; en: string }>> = {
  praetorian: { zh: '禁衛軍隊長', en: 'Praetorian Captain' },
  centurion: { zh: '百夫長', en: 'Centurion' },
  varangian: { zh: '瓦良格隊長', en: 'Varangian Captain' },
  'dragon-oathguard': { zh: '龍誓重衛', en: 'Dragon Oathguard' },
  ranger: { zh: '遊俠', en: 'Ranger' },
  'roman-commander': { zh: '羅馬軍團統帥', en: 'Roman Legate' },
  'byzantine-cataphract': { zh: '拜占庭鐵甲重騎兵', en: 'Byzantine Cataphract' },
  'viking-commander': { zh: '北境戰酋', en: 'Norse Warchief' },
  'ironblood-warlord': { zh: '鐵血戰帥', en: 'Ironblood Warlord' },
}
export const heroClassLabel = (id: HeroCombatProfileId): string => `${HERO_CLASS_NAMES[id].zh} ${HERO_CLASS_NAMES[id].en}`

/** One selectable T4 captain / T5 commander body of a faction. `elite` marks the second (heavy) class of the tier. */
export interface CareerHeroClass {
  tier: 4 | 5
  heroArchetype: Extract<HeroArchetype, 'captain' | 'commander'>
  elite: boolean
  visualAssetId: HeroAssetId
  combatProfileId: HeroCombatProfileId
}

/**
 * The faction's two classes per hero tier, [default, elite]. Heavy bodies come from the shared T4/T5 catalogs
 * so recruitment, Duel and mission rosters can never disagree on which class a heavy hero is.
 */
export function careerHeroClasses(faction: Faction, tier: 4 | 5): readonly [CareerHeroClass, CareerHeroClass] {
  const heroArchetype = tier === 4 ? 'captain' as const : 'commander' as const
  const base = resolveCharacterIdentity({ characterFaction: faction, characterTier: tier, heroArchetype })
  const elite = tier === 4 ? HEAVY_T4_HERO[faction] : getT5ProfileForPreset(`${faction}_heavy_cavalry`, faction)
  return [
    { tier, heroArchetype, elite: false, visualAssetId: base.visualAssetId!, combatProfileId: base.combatProfileId! },
    { tier, heroArchetype, elite: true, visualAssetId: elite.visualAssetId, combatProfileId: elite.combatProfileId },
  ]
}

/** Combat numbers shown beside a class are always the real profile's. */
export const careerHeroClassMaxHp = (hero: Pick<CareerHeroClass, 'combatProfileId'>): number => HERO_COMBAT_PROFILES[hero.combatProfileId].maxHp
