import type { BanditMissionController } from '../career/BanditMissionController'
import type { CareerDuelController } from '../career/CareerDuelController'
import type { TownDefenseController } from '../career/TownDefenseController'
import { claimCareerMission, clearCareerMission, type CareerProfile } from '../career/CareerProfile'
import type { CareerMissionOutcome, CareerMissionResult } from '../career/CareerMissionState'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import { townSitePoint, type TownActorSpec } from './TownRules'
import type { TownEquipment } from './TownEquipment'
import type { TownWorld } from './TownWorld'
import { isCareerEnemyTerritoryFieldMission } from '../career/CareerFieldSceneContext'

interface MissionProfiles {
  read(): CareerProfile
  /** Publishes the profile only after saving it; false leaves the current profile unchanged. */
  commit(profile: CareerProfile): boolean
}

interface MissionControllers {
  field: Pick<BanditMissionController, 'snapshot' | 'cleanupMission' | 'friendlies'>
  duel: Pick<CareerDuelController, 'snapshot' | 'cleanupMission' | 'actors'>
  defense: Pick<TownDefenseController, 'active' | 'snapshot' | 'cleanupMission' | 'civilianSurvived' | 'civilianDeaths'>
}

interface ReturnResident {
  spec: Pick<TownActorSpec, 'role' | 'x' | 'z' | 'yaw'>
  npc: NPC
  homeMount?: Mount
  cycle: number
  walkTime: number
}

/** Live return objects, plus the three scene effects that own projectiles, observer controls and scene replacement. */
interface TownReturnScene {
  residents: readonly ReturnResident[]
  releaseExternalThreat(npc: NPC): void
  cat: Pick<Mount, 'restoreForTown' | 'catVisual'>
  world: Pick<TownWorld, 'restoreTownDamage' | 'obstacles'>
  navigation: Pick<NavigationWorld, 'sync'>
  inventory: Pick<TownEquipment, 'sheathAll'>
  readonly player: Pick<Player, 'group'>
  clearCombatShots(): void
  restPlayer(): void
  restart(profile: CareerProfile): void
}

export type MissionFinish =
  | { status: 'ignored' }
  | { status: 'save-failed' }
  | { status: 'saved'; result: CareerMissionResult }

export type MissionReturn =
  | { status: 'ignored' }
  | { status: 'save-failed'; destination: 'restart' | 'defense' | 'party' }
  | { status: 'restarted' }
  | { status: 'returned'; kind: 'defense' | 'party' | 'sweep' }

/** Saves mission results and returns before touching the live scene.
 * Claim/clear remain the Career rules authority; this module owns when their changes may take effect.
 */
export class TownMissionSettlement {
  constructor(
    private readonly profiles: MissionProfiles,
    private readonly missions: MissionControllers,
    private readonly town: TownReturnScene,
  ) {}

  finish(outcome: CareerMissionOutcome): MissionFinish {
    const profile = this.profiles.read()
    const active = profile.activeMission
    if (!active || active.result) return { status: 'ignored' }
    const source = active.kind === 'duel' ? this.missions.duel : this.missions.defense.active ? this.missions.defense : this.missions.field
    const claim = claimCareerMission(profile, active.id, outcome, source.snapshot().player)
    if (active.kind === 'town-defense' && claim.profile.activeMission?.result) {
      claim.profile.activeMission.result.defense = {
        civilianSurvived: this.missions.defense.civilianSurvived,
        civilianDeaths: this.missions.defense.civilianDeaths,
      }
    }
    if (!this.profiles.commit(claim.profile)) return { status: 'save-failed' }
    return { status: 'saved', result: this.profiles.read().activeMission!.result! }
  }

  returnToTown(intent: 'direct' | 'arrived'): MissionReturn {
    const profile = this.profiles.read()
    const active = profile.activeMission
    if (!active) return { status: 'ignored' }
    const defense = active.kind === 'town-defense'
    if (defense && (intent !== 'direct' || !active.result)) return { status: 'ignored' }
    const veteranField = active.kind === 'veteran-field'
    const enemyTerritoryScout = isCareerEnemyTerritoryFieldMission(active)
    if (veteranField && !active.result) return { status: 'ignored' }
    const inPlace = !enemyTerritoryScout && (defense || intent === 'arrived' || active.kind === 'cavalry-sweep' || veteranField)
    if (inPlace && !defense && active.phase !== 'RETURNING' && !((active.kind === 'cavalry-sweep' || veteranField) && active.result)) return { status: 'ignored' }

    // Cleanup empties controller rosters. Capture borrowed identities before clearing the saved mission.
    const borrowed = (inPlace || enemyTerritoryScout) && !defense ? new Set(active.kind === 'duel' ? this.missions.duel.actors : this.missions.field.friendlies) : null
    const next = clearCareerMission(profile, active.id)
    if (!this.profiles.commit(next)) return { status: 'save-failed', destination: defense ? 'defense' : inPlace ? 'party' : 'restart' }

    if (!inPlace) {
      if (active.kind === 'enemy-town-assault') this.missions.defense.cleanupMission()
      else if (active.kind === 'duel') this.missions.duel.cleanupMission()
      else this.missions.field.cleanupMission(active.targetCampId)
      if (enemyTerritoryScout) {
        const borrowedActorIds = new Set(active.borrowedActorIds ?? [])
        this.town.clearCombatShots()
        for (const resident of this.town.residents) {
          if (borrowed!.has(resident.npc) && borrowedActorIds.has(resident.npc.combatantId)) this.restoreResident(resident)
        }
      }
      this.town.inventory.sheathAll()
      this.town.restart(next)
      return { status: 'restarted' }
    }

    if (defense) this.missions.defense.cleanupMission()
    else if (active.kind === 'duel') this.missions.duel.cleanupMission()
    else if (active.kind === 'cavalry-sweep') this.missions.field.cleanupMission(active.targetCampId, true)
    else this.missions.field.cleanupMission(active.targetCampId)
    this.town.clearCombatShots()
    for (const resident of this.town.residents) {
      const restore = defense
        ? resident.spec.role.includes('_') || ['captain', 'ranger', 'deployment', 'civilian'].includes(resident.spec.role)
        : borrowed!.has(resident.npc)
      if (restore) this.restoreResident(resident)
    }
    if (defense || active.kind === 'duel') this.restoreCat()
    if (defense) {
      this.town.world.restoreTownDamage()
      this.town.navigation.sync(this.town.world.obstacles)
    }
    this.town.restPlayer()
    if ((active.kind === 'cavalry-sweep' || veteranField) && active.phase !== 'RETURNING') this.town.player.group.position.set(0, getTerrainHeight(0, 9) + .9, 9)
    return { status: 'returned', kind: defense ? 'defense' : active.kind === 'cavalry-sweep' ? 'sweep' : 'party' }
  }

  private restoreResident(resident: ReturnResident): void {
    resident.npc.dismountFromMount()
    resident.npc.restoreForTown()
    resident.npc.group.rotation.y = resident.spec.yaw ?? Math.PI
    resident.cycle = -1
    resident.walkTime = 0
    this.town.releaseExternalThreat(resident.npc)
    if (resident.homeMount) {
      resident.homeMount.restoreForTown(resident.spec.x, resident.spec.z, resident.spec.yaw ?? Math.PI)
      resident.npc.mountVehicle(resident.homeMount)
    }
  }

  private restoreCat(): void {
    const spot = townSitePoint('stable', -3, 8)
    this.town.cat.restoreForTown(spot.x, spot.z, spot.yaw)
    this.town.cat.catVisual?.setEquipmentVisible(false)
  }
}
