import { isCareerEnemyTerritoryFieldMission } from '../career/CareerFieldSceneContext'
import type { CareerProfile } from '../career/CareerProfile'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { SERVICE_ANCHOR_CLEARANCE } from './architecture/ArchitectureSpecs'
import type { TownServiceStation } from './TownCommanderIdentity'
import { TOWN_COMMANDER_ID } from './TownCommanderIdentity'
import { townSitePoint, type TownActorSpec } from './TownRules'
export { TOWN_COMMANDER_ID,townCommanderSpec } from './TownCommanderIdentity'

/** Shared by roster construction, asset preload and the scene's actual actor consumer. */
export function shouldSpawnTownCommander(profile: Pick<CareerProfile, 'rank' | 'faction' | 'activeMission'>): boolean {
  const mission = profile.activeMission
  if (mission?.kind === 'commander-sky-raid' || mission?.kind === 'commander-decapitation') return true
  return !isCareerEnemyTerritoryFieldMission(mission)
}

export function townCommanderHeroAsset(faction: CharacterFaction): HeroAssetId {
  return faction === 'roman' ? 'roman-hero-t5' : 'viking-hero-t5'
}


/** The Captain and Sergeant serve inside the Town Center at their faction hall's
 * own posts (left and centre as the player walks in). Identity and duty are unchanged. */
export function placeTownCenterServiceResidents(roster: TownActorSpec[], station: (role: 'captain' | 'deployment') => TownServiceStation): void {
  for (const spec of roster) if (spec.id === 'captain' || spec.id === 'deployment') Object.assign(spec, station(spec.id))
}

/** The Commander's indoor post (right of the Sergeant). It must be free of other residents
 * and reachable on foot from the plaza; there is no fallback to a different spot. */
export function resolveTownCommanderPosition(station: TownServiceStation, navigation: Pick<NavigationWorld, 'areConnected'>,
  roster: readonly TownActorSpec[]): TownServiceStation {
  const occupied = roster.find(spec => spec.id !== TOWN_COMMANDER_ID
    && Math.hypot(spec.x - station.x, spec.z - station.z) < SERVICE_ANCHOR_CLEARANCE * 2)
  if (occupied) throw new Error(`指揮官室內站位被 ${occupied.id} 佔用`)
  if (!navigation.areConnected(townSitePoint('hall', 0, 30), station)) throw new Error('指揮官室內站位無法從廣場抵達')
  return { ...station }
}
