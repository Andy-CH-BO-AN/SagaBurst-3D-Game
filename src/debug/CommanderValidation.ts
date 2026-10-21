import type { HeroAssetId } from '../world/HeroAssetCatalog'

/** Caller must gate this diagnostic behind DEV and the isolated training scene. */
export function commanderValidationHero(query: URLSearchParams): HeroAssetId | undefined {
  const faction = query.get('devcommander')
  return faction === 'roman' ? 'roman-hero-t5' : faction === 'viking' ? 'viking-hero-t5' : undefined
}
