import { Faction } from '../combat/CombatFaction'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { ActiveCareerMission } from './CareerMissionState'
import type { CareerProfile } from './CareerProfile'
import { townRoster, type TownActorSpec } from '../town/TownRules'
import { VETERAN_MISSION_IDS } from './VeteranMission'

export interface CareerTownSceneContext {
  worldFaction: CharacterFaction
  residentFaction: CharacterFaction
  missionOnlyResidents: boolean
  worldOwnerAllegiance: Faction
}

export function isCareerEnemyTerritoryFieldMission(activeMission?: ActiveCareerMission): boolean {
  return activeMission?.kind === 'veteran-field' && activeMission.templateId === VETERAN_MISSION_IDS[5]
}

function opposingFaction(faction: CharacterFaction): CharacterFaction {
  return faction === 'roman' ? 'viking' : 'roman'
}

export function resolveCareerTownSceneContext(
  profile: Pick<CareerProfile, 'faction' | 'activeMission'>,
): CareerTownSceneContext {
  const enemyTownAssault = profile.activeMission?.kind === 'enemy-town-assault'
  const enemyTerritoryField = isCareerEnemyTerritoryFieldMission(profile.activeMission)
  const foreignTownFaction = enemyTownAssault || enemyTerritoryField
    ? opposingFaction(profile.faction)
    : profile.faction
  return {
    worldFaction: foreignTownFaction,
    residentFaction: enemyTownAssault ? foreignTownFaction : profile.faction,
    missionOnlyResidents: enemyTerritoryField,
    worldOwnerAllegiance: enemyTerritoryField ? Faction.ENEMY : Faction.TOWN,
  }
}


export interface CareerTownSceneRosterEntry {
  /** The spec ID is also the stable NPC combatant ID. */
  spec: TownActorSpec
  characterFaction: CharacterFaction
  allegiance: Faction
  /** True only for a home Town actor temporarily borrowed by this mission. */
  borrowed: boolean
}

/** Stable IDs for the non-cat residents spawned as the opposing native garrison in Veteran VI. */
export function careerEnemyTownGarrisonActorIds(): string[] {
  return townRoster()
    .filter(spec => spec.role !== 'cat')
    .map(spec => `enemy-town:${spec.id}`)
}

function townResidentCharacterFaction(spec: TownActorSpec, faction: CharacterFaction): CharacterFaction {
  // Preserve the established Town appearance for residents; Veteran VI's native garrison uses
  // its Town faction uniformly, including civilians and service-role actors.
  return spec.role === 'civilian' ? 'roman' : spec.role === 'ranger' ? 'viking' : faction
}

/**
 * Describe every resident that the current scene should create. Veteran VI places the player's
 * borrowed home actors first, then adds a separate, hostile native Town population with stable
 * prefixed IDs. Other scenes retain the existing Town and Enemy Town Assault roster semantics.
 */
export function careerTownSceneRoster(
  profile: Pick<CareerProfile, 'faction' | 'activeMission'>,
  residents: readonly TownActorSpec[] = townRoster(),
): CareerTownSceneRosterEntry[] {
  // Foreign mission populations keep their own roster; free Town scenes receive
  // the complete conquest roster assembled from the built TownWorld.
  const nativeSpecs = (isCareerEnemyTerritoryFieldMission(profile.activeMission) ? townRoster() : residents)
    .filter(spec => spec.role !== 'cat')
  const activeMission = profile.activeMission
  if (isCareerEnemyTerritoryFieldMission(activeMission)) {
    const nativeById = new Map(nativeSpecs.map(spec => [spec.id, spec]))
    const borrowedActorIds = activeMission?.borrowedActorIds?.length
      ? activeMission.borrowedActorIds
      : activeMission?.friendlyActorIds ?? []
    const borrowed = borrowedActorIds
      .map(id => nativeById.get(id))
      .filter((spec): spec is TownActorSpec => Boolean(spec))
      .map(spec => ({
        spec: { ...spec },
        characterFaction: townResidentCharacterFaction(spec, profile.faction),
        allegiance: Faction.TOWN,
        borrowed: true,
      }))
    const opposing = opposingFaction(profile.faction)
    const enemyGarrison = nativeSpecs.map(spec => ({
      spec: { ...spec, id: `enemy-town:${spec.id}` },
      characterFaction: opposing,
      allegiance: Faction.ENEMY,
      borrowed: false,
    }))
    return [...borrowed, ...enemyGarrison]
  }

  const context = resolveCareerTownSceneContext(profile)
  const allegiance = activeMission?.kind === 'enemy-town-assault' ? Faction.ENEMY : Faction.TOWN
  return nativeSpecs.map(spec => ({
    spec: { ...spec },
    characterFaction: townResidentCharacterFaction(spec, context.residentFaction),
    allegiance: spec.role === 'hr-officer' ? context.worldOwnerAllegiance : allegiance,
    borrowed: false,
  }))
}
