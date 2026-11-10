import type { HumanoidAssetDescriptor } from './HumanoidAssetRegistry'

/** Assets available to runtime and DEV previews; not a public mode selection list. */
export const HERO_ASSET_IDS = ['viking-hero-t4', 'viking-heavy-hero-t4', 'roman-hero-t4', 'roman-centurion-t4', 'maki-archer-t4', 'roman-hero-t5', 'viking-hero-t5', 'viking-heavy-hero-t5', 'byzantine-cataphract-t5'] as const
export type HeroAssetId = typeof HERO_ASSET_IDS[number]
export type PlayerHeroId = HeroAssetId

/** Player-only choices for Custom Battle and Campaign; NPC tiers and Career unlocks are independent. */
export const SETUP_PLAYER_HERO_IDS = ['viking-hero-t4', 'viking-heavy-hero-t4', 'roman-hero-t4', 'roman-centurion-t4', 'maki-archer-t4', 'viking-hero-t5', 'viking-heavy-hero-t5', 'roman-hero-t5', 'byzantine-cataphract-t5'] as const satisfies readonly HeroAssetId[]
export type SetupPlayerHeroId = typeof SETUP_PLAYER_HERO_IDS[number]

export const HERO_ASSETS: Record<HeroAssetId, { nameZh: string; nameEn: string; descriptor: HumanoidAssetDescriptor }> = {
  // Owner-supplied Mixamo-rigged Meshy model (tools/build-byzantine-cataphract.mjs); metrics are the manifest's measurements.
  'byzantine-cataphract-t5': {
    nameZh: '拜占庭鐵甲重騎兵', nameEn: 'Byzantine Cataphract',
    descriptor: { assetId: 'byzantine-cataphract-t5', faction: 'roman', heightM: 1.9410765866341708, maxShoulderWidthM: 0.5659912515567136, neckLengthM: 0.07769488623523091 },
  },
  'viking-hero-t4': {
    nameZh: '瓦良格隊長', nameEn: 'Varangian Captain',
    descriptor: { assetId: 'viking-hero-t4', faction: 'viking', heightM: 2, maxShoulderWidthM: .78, neckLengthM: .11 },
  },
  // Owner-supplied Meshy Mixamo24 model (tools/build-viking-heavy-heroes.mjs); metrics are the manifest's measurements.
  'viking-heavy-hero-t4': {
    nameZh: '龍誓重衛', nameEn: 'Dragon Oathguard',
    descriptor: { assetId: 'viking-heavy-hero-t4', faction: 'viking', heightM: 1.999999935896147, maxShoulderWidthM: 0.656265570914091, neckLengthM: 0.08004531860351614 },
  },
  'roman-hero-t4': {
    nameZh: '聖騎士', nameEn: 'Paladin',
    descriptor: { assetId: 'roman-hero-t4', faction: 'roman', heightM: 1.95, maxShoulderWidthM: .50, neckLengthM: .0782356292 },
  },
  // Owner-supplied 10K Meshy Mixamo66 model (tools/build-meshy-faction-heroes.mjs, asset roman-centurion-t4); metrics are the manifest's measurements.
  'roman-centurion-t4': {
    nameZh: '百夫長', nameEn: 'Centurion',
    descriptor: { assetId: 'roman-centurion-t4', faction: 'roman', heightM: 1.95, maxShoulderWidthM: .50, neckLengthM: .08084886782419044 },
  },
  'maki-archer-t4': {
    nameZh: '遊俠', nameEn: 'Ranger',
    // The asset's Viking rig contract does not determine gameplay allegiance.
    descriptor: { assetId: 'maki-archer-t4', faction: 'viking', heightM: 1.90, maxShoulderWidthM: .418, neckLengthM: .090554 },
  },
  'roman-hero-t5': {
    nameZh: '羅馬軍團統帥', nameEn: 'Roman Legate',
    descriptor: { assetId: 'roman-hero-t5', faction: 'roman', heightM: 1.8191270070256114, maxShoulderWidthM: .5211178487681826, neckLengthM: .11045054826976493 },
  },
  'viking-hero-t5': {
    nameZh: '北境戰酋', nameEn: 'Norse Warchief',
    descriptor: { assetId: 'viking-hero-t5', faction: 'viking', heightM: 2.1193006331863145, maxShoulderWidthM: .6645790819402477, neckLengthM: .0877771550 },
  },
  // Owner-supplied Meshy Mixamo24 model (tools/build-viking-heavy-heroes.mjs); metrics are the manifest's measurements.
  'viking-heavy-hero-t5': {
    nameZh: '鐵血戰帥', nameEn: 'Ironblood Warlord',
    descriptor: { assetId: 'viking-heavy-hero-t5', faction: 'viking', heightM: 2.0000002962848056, maxShoulderWidthM: 0.7301477678582136, neckLengthM: 0.08016418457032731 },
  },
}

export function isHeroAssetId(value: unknown): value is HeroAssetId {
  return typeof value === 'string' && (HERO_ASSET_IDS as readonly string[]).includes(value)
}

export function isSetupPlayerHeroId(value: unknown): value is SetupPlayerHeroId {
  return typeof value === 'string' && (SETUP_PLAYER_HERO_IDS as readonly string[]).includes(value)
}
