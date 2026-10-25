/** Ordinary body identity is independent of weapon, armour and combat allegiance. */
export type SoldierFaction = 'roman' | 'viking'
export type OrdinarySoldierTier = 1 | 2 | 3

const SOLDIER_HP: Readonly<Record<SoldierFaction, readonly [number, number, number]>> = {
  roman: [100, 150, 200],
  viking: [90, 135, 180],
}

export function getOrdinarySoldierHp(faction: SoldierFaction, tier: OrdinarySoldierTier): number {
  return SOLDIER_HP[faction][tier - 1]!
}

export function getOrdinarySoldierAssetId(faction: SoldierFaction, tier: number): string | undefined {
  return tier === 1 || tier === 2 ? `${faction}-t${tier}` : undefined
}

export function resolveOrdinarySoldierTier(tier?: number): OrdinarySoldierTier {
  return tier === 1 || tier === 3 ? tier : 2
}

export interface OrdinaryNpcIdentity {
  faction: SoldierFaction
  tier: number
  civilian?: boolean
  special?: boolean
}

/** Special profiles deliberately retain their existing caller-supplied HP. */
export function resolveOrdinaryNpcHp(identity: OrdinaryNpcIdentity, fallback: number): number {
  return !identity.civilian && !identity.special && (identity.tier === 1 || identity.tier === 2 || identity.tier === 3)
    ? getOrdinarySoldierHp(identity.faction, identity.tier) : fallback
}

/** Optional playerHp means an explicit override; generated defaults carry a source tag. */
export function resolveOrdinaryPlayerBaseHp(faction: SoldierFaction, tier: OrdinarySoldierTier,
  config?: { playerHp?: number; playerHpSource?: 'default' | 'custom' }): number {
  return config?.playerHp !== undefined && config.playerHpSource !== 'default'
    ? config.playerHp : getOrdinarySoldierHp(faction, tier)
}

/** Older serialized setup data cannot distinguish generated HP from deliberate overrides. */
export function needsPlayerHpConfirmation(config: { playerHp?: number; playerHpSource?: 'default' | 'custom'; playerHeroId?: string | null }): boolean {
  return !config.playerHeroId && config.playerHp !== undefined && config.playerHpSource === undefined
}
