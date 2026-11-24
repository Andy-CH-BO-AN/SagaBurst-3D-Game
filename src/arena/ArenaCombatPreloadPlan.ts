import { arenaTrialPreloadPlan, type ArenaTrialState } from '../career/CareerArenaTrials'
import { resolveCareerHeroAsset } from '../career/CareerPlayerProfile'
import { prisonRoster, prisonUnitSpec, type PrisonBreakState } from '../career/CareerPrisonBreak'
import type { CareerProfile } from '../career/CareerProfile'
import type { coopGuestCharacterAssets } from '../coop/CoopLaunch'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { HIGH_TIER_WEAPON_ASSETS } from '../world/HighTierEquipment'
import type { HeroAssetId } from '../world/HeroAssetCatalog'

/** What an arena combat scene must load before it builds any actor. */
export interface ArenaCombatPreloadPlan {
  /** The player's own Career hero body, when the profile resolves one. */
  playerHero: HeroAssetId | null
  /** Other hero bodies in the fight: trial roster or surviving prison roster, plus a co-op guest. */
  heroAssets: HeroAssetId[]
  /** Equipment admitted through `prepareByzantineEquipment`; its failure blocks the scene. */
  equipmentIds: unknown[]
  horses: boolean
  paladin: boolean
  highTier: boolean
  makiBow: boolean
}

/**
 * A prison break waits only for equipment actually present in the cell block (never the
 * confiscated loadout); an ordinary trial keeps the player's loadout and shared preloads.
 */
export function arenaCombatPreloadPlan(profile: CareerProfile, trial: ArenaTrialState, prison: PrisonBreakState | undefined,
  coop: ReturnType<typeof coopGuestCharacterAssets>): ArenaCombatPreloadPlan {
  const plan = arenaTrialPreloadPlan(trial.tier, profile.faction, trial.rosterVersion ?? 1)
  if (prison) {
    const specs = prisonRoster(prison).filter(entry => !prison.result && prison.combat.actors[entry.actorId]?.status !== 'knocked')
      .map(entry => prisonUnitSpec(prison, entry, profile.faction))
    plan.heroAssets = [...new Set(specs.flatMap(spec => spec.visualAssetId ? [spec.visualAssetId] : []))]
    plan.equipmentIds = specs.flatMap(spec => [spec.loadout?.meleeWeaponId, spec.loadout?.rangedWeaponId, spec.loadout?.shieldId].filter((id): id is string => Boolean(id)))
  }
  if (coop?.hero) plan.heroAssets = [...new Set([...plan.heroAssets, coop.hero])]
  const equipmentIds = prison ? plan.equipmentIds : [...plan.equipmentIds, profile.equipment?.melee, profile.equipment?.shield, ...(coop?.equipmentIds ?? [])]
  const requires = (predicate: (id: string) => boolean) => !prison || equipmentIds.some(id => typeof id === 'string' && predicate(id))
  return {
    playerHero: resolveCareerHeroAsset(profile), heroAssets: plan.heroAssets, equipmentIds, horses: !prison,
    paladin: requires(id => id.startsWith('paladin_')),
    highTier: requires(id => id in HIGH_TIER_WEAPON_ASSETS),
    makiBow: requires(id => id === T4_RANGER_BOW_RANGED_ID),
  }
}

/** The asset loaders an arena combat scene owns; each one resolves once its asset is usable. */
export interface ArenaCombatAssetLoaders {
  humanoids(): Promise<void>
  heroAsset(id: HeroAssetId): Promise<void>
  horses(): Promise<void>
  paladin(): Promise<void>
  highTier(): Promise<void>
  makiBow(): Promise<void>
  equipment(ids: Iterable<unknown>): Promise<'ready' | 'failed' | 'timed-out'>
}

/** Load every planned asset concurrently; equipment that is not ready blocks the scene. */
export async function loadArenaCombatAssets(plan: ArenaCombatPreloadPlan, loaders: ArenaCombatAssetLoaders): Promise<void> {
  const [, equipment] = await Promise.all([
    Promise.all([loaders.humanoids(),
      ...(plan.horses ? [loaders.horses()] : []),
      ...(plan.paladin ? [loaders.paladin()] : []),
      ...(plan.highTier ? [loaders.highTier()] : []),
      ...(plan.makiBow ? [loaders.makiBow()] : []),
      plan.playerHero ? loaders.heroAsset(plan.playerHero) : Promise.resolve(),
      ...plan.heroAssets.map(id => loaders.heroAsset(id))]),
    loaders.equipment(plan.equipmentIds),
  ])
  if (equipment !== 'ready') throw new Error('試煉裝備資源載入失敗')
}
