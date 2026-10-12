import type { HumanoidAssetDescriptor } from './HumanoidAssetRegistry'

/** Assets available to runtime and DEV previews; not a public mode selection list. */
export const HERO_ASSET_IDS = ['viking-hero-t4', 'roman-hero-t4', 'maki-archer-t4', 'roman-hero-t5', 'viking-hero-t5'] as const
export type HeroAssetId = typeof HERO_ASSET_IDS[number]
export type PlayerHeroId = HeroAssetId

/** Custom Battle and Campaign share this explicit list. Commanders unlock in Career. */
export const SETUP_PLAYER_HERO_IDS = ['viking-hero-t4', 'roman-hero-t4', 'maki-archer-t4'] as const satisfies readonly HeroAssetId[]
export type SetupPlayerHeroId = typeof SETUP_PLAYER_HERO_IDS[number]

export const HERO_ASSETS: Record<HeroAssetId, { nameZh: string; nameEn: string; descriptor: HumanoidAssetDescriptor }> = {
  'viking-hero-t4': {
    nameZh: '瓦良格隊長', nameEn: 'Varangian Captain',
    descriptor: { assetId: 'viking-hero-t4', faction: 'viking', heightM: 2, maxShoulderWidthM: .78, neckLengthM: .11 },
  },
  'roman-hero-t4': {
    nameZh: '聖騎士', nameEn: 'Paladin',
    descriptor: { assetId: 'roman-hero-t4', faction: 'roman', heightM: 1.95, maxShoulderWidthM: .50, neckLengthM: .10 },
  },
  'maki-archer-t4': {
    nameZh: '遊俠', nameEn: 'Ranger',
    // The asset's Viking rig contract does not determine gameplay allegiance.
    descriptor: { assetId: 'maki-archer-t4', faction: 'viking', heightM: 1.457503, maxShoulderWidthM: .274, neckLengthM: .078 },
  },
  'roman-hero-t5': {
    nameZh: '羅馬指揮官', nameEn: 'Roman Commander',
    descriptor: { assetId: 'roman-hero-t5', faction: 'roman', heightM: 1.8191270070256114, maxShoulderWidthM: .5211178487681826, neckLengthM: .11045054826976493 },
  },
  'viking-hero-t5': {
    nameZh: '維京指揮官', nameEn: 'Viking Commander',
    descriptor: { assetId: 'viking-hero-t5', faction: 'viking', heightM: 2.1193006331863145, maxShoulderWidthM: .6645790819402477, neckLengthM: .10067855666644003 },
  },
}

export function isHeroAssetId(value: unknown): value is HeroAssetId {
  return typeof value === 'string' && (HERO_ASSET_IDS as readonly string[]).includes(value)
}

export function isSetupPlayerHeroId(value: unknown): value is SetupPlayerHeroId {
  return typeof value === 'string' && (SETUP_PLAYER_HERO_IDS as readonly string[]).includes(value)
}

/** Ranger's bow doubles as its melee weapon; setup choices remain saved for other heroes. */
export function getHeroFixedEquipment(heroId?: PlayerHeroId | null) {
  return heroId === 'maki-archer-t4'
    ? { meleeWeaponId: 'maki-ranger-bow', shieldId: null } as const
    : null
}
