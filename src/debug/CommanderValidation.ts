import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'

/** Caller must gate this diagnostic behind DEV and the isolated training scene. */
export function commanderValidationHero(query: URLSearchParams): HeroAssetId | undefined {
  // DEV training only: any registered hero, e.g. ?training=1&devplayerhero=roman-centurion-t4.
  const hero = query.get('devplayerhero')
  if (isHeroAssetId(hero)) return hero
  const faction = query.get('devcommander')
  return faction === 'roman' ? 'roman-hero-t5' : faction === 'viking' ? 'viking-hero-t5' : undefined
}
