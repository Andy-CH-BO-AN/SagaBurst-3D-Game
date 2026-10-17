import { armyHudUnitType, type ArmyHudUnitSource, type ArmyHudUnitType } from '../battle/ArmyCommandHudRoster'
import { BattleSpawner } from '../battle/BattleSpawner'
import { createDefaultDefensePlayerLoadout, createDefenseCampaignWaveConfig, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { createSkyRaidRoster, createDecapitationRoster, createLastStandRoster, createBridgeheadRoster } from './CommanderMissionCatalog'
import { createCaptainEagleSpawnPlan, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from './CaptainBattleLaunch'
import { createSweepRoster } from './CavalrySweep'
import { createVeteranRoster, createVeteranSpawnSpec, getVeteranMissionDefinition } from './VeteranMission'
import { siegeRoster, siegeRosterVersion } from './TownSiege'
import { careerOutpostActorId, createCareerOutpostDefenderArmy } from './CareerOutpostRoster'
import { createCareerReliefSpawnPlan } from './CareerOutpostRelief'
import type { CareerProfile } from './CareerProfile'

/** Data-only production rosters, evaluated once per accepted identity set. No NPCs or scene queries.
 * Unlike surviving actors, these plans retain casualties and soldiers not yet deployed, including old saves.
 */
export class CareerCommandHudTypes {
  private key?: string
  private types: Record<string, ArmyHudUnitType> = {}
  read(profile: CareerProfile): Readonly<Record<string, ArmyHudUnitType>> {
    const mission = profile.activeMission, outpost = profile.activeOutpostMission, active = mission ?? outpost
    const key = JSON.stringify([profile.faction, active?.id, active?.officialSquad?.actorIds])
    if (this.key === key) return this.types
    this.key = key; this.types = {}
    const add = (ids: readonly string[], specs: readonly ArmyHudUnitSource[]) => {
      ids.forEach((id, index) => { const type = specs[index] && armyHudUnitType(specs[index]); if (type) this.types[id] = type })
    }
    const addSpecs = (specs: readonly (ArmyHudUnitSource & { actorId?: string })[]) => {
      for (const spec of specs) if (spec.actorId) add([spec.actorId], [spec])
    }
    if (mission) {
      if (mission.kind === 'commander-sky-raid') addSpecs(createSkyRaidRoster(mission, profile.faction))
      else if (mission.kind === 'commander-decapitation') addSpecs(createDecapitationRoster(mission, profile.faction))
      else if (mission.kind === 'commander-outpost-last-stand') addSpecs(createLastStandRoster(mission, profile.faction).friendly)
      else if (mission.kind === 'commander-bridgehead-battle') addSpecs(createBridgeheadRoster(mission, profile.faction).friendly)
      else if (mission.kind === 'captain-eagle-battle') addSpecs(createCaptainEagleSpawnPlan(profile).npcSpecs)
      else if (mission.kind === 'captain-outpost-defense') {
        const launch = createCaptainFrontlineLaunch(profile)
        addSpecs(createCaptainFrontlineSpawnPlan(launch).npcSpecs)
        add(mission.reinforcementActorIds ?? [], BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'reinforcement')).npcSpecs)
      } else if (mission.kind === 'cavalry-sweep') add(mission.friendlyActorIds, createSweepRoster(profile.faction))
      else if (mission.kind === 'enemy-town-assault') add(mission.siege?.attackerIds ?? mission.friendlyActorIds,
        siegeRoster(profile.faction, true, mission.siege ? siegeRosterVersion(mission.siege) : 2).map(slot => slot.spec))
      else {
        const definition = getVeteranMissionDefinition(mission.templateId)
        if (definition) {
          const roster = createVeteranRoster(definition.id, profile.faction, mission.id, mission.veteranRosterVersion ?? 2)
          add(mission.friendlyActorIds, roster.friendly.map(unit => createVeteranSpawnSpec(unit, profile.faction)))
          add(mission.reinforcementActorIds ?? [], roster.reinforcements.map(unit => createVeteranSpawnSpec(unit, profile.faction)))
        }
      }
    } else if (outpost) {
      const relief = outpost.kind === 'outpost-relief'
      const launch: DefenseCampaignLaunchConfig = { type: 'defense', defenderFaction: profile.faction, stageId: outpost.stageId,
        careerMissionId: outpost.id, careerMissionKind: outpost.kind,
        defenderArmy: createCareerOutpostDefenderArmy(profile.faction, outpost), playerLoadout: createDefaultDefensePlayerLoadout(profile.faction),
        capabilities: { reinforcementsEnabled: !relief, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false } }
      for (const wave of relief ? ['initial'] as const : ['initial', 'reinforcement'] as const) {
        const plan = wave === 'initial' && relief ? createCareerReliefSpawnPlan(launch)
          : BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, wave === 'initial' ? 'defenders' : wave))
        add(plan.npcSpecs.map((_, index) => careerOutpostActorId(outpost.id, wave, index)), plan.npcSpecs)
      }
    }
    return this.types
  }
}
