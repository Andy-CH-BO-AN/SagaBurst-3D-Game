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
import { townPlayerEntryPoint, townSitePoint, type TownActorSpec } from './TownRules'
import type { TownEquipment } from './TownEquipment'
import type { TownWorld } from './TownWorld'
import { isCareerEnemyTerritoryFieldMission } from '../career/CareerFieldSceneContext'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { CaptainPatrolCommandController } from '../career/CaptainPatrolCommandController'

interface MissionProfiles {
  read(): CareerProfile
  /** Publishes the profile only after saving it; false leaves the current profile unchanged. */
  commit(profile: CareerProfile, options?: MissionCommitOptions): boolean
}

export interface MissionCommitOptions { groundedTownReturn?: boolean }

interface MissionControllers {
  field: Pick<BanditMissionController, 'snapshot' | 'cleanupMission' | 'friendlies'>
  duel: Pick<CareerDuelController, 'snapshot' | 'cleanupMission' | 'actors'>
  defense: Pick<TownDefenseController, 'active' | 'snapshot' | 'cleanupMission' | 'civilianSurvived' | 'civilianDeaths'>
  patrol?: Pick<CaptainPatrolCommandController, 'statsSnapshot' | 'release' | 'actors'>
}

interface ReturnResident {
  spec: Pick<TownActorSpec, 'role' | 'x' | 'z' | 'yaw' | 'defenseGroup'> & Partial<Pick<TownActorSpec, 'id' | 'duty'>>
  npc: NPC
  homeMount?: Mount
  cycle: number
  walkTime: number
}

/** Live return objects, plus the three scene effects that own projectiles, observer controls and scene replacement. */
interface TownReturnScene {
  residents: readonly ReturnResident[]
  releaseExternalThreat(npc: NPC): void
  beginPatrolMissionReturn?(actorId: string): void
  beginEagleMissionReturn?(actorId: string): void
  cat: Pick<Mount, 'restoreForTown' | 'catVisual'> & Partial<Pick<Mount, 'dead'>>
  world: Pick<TownWorld, 'restoreTownDamage' | 'obstacles'>
  navigation: Pick<NavigationWorld, 'sync'>
  inventory: Pick<TownEquipment, 'sheathAll'>
  readonly player: Pick<Player, 'group' | 'resetForScene'>
  clearCombatShots(): void
  restPlayer(): void
  returnPersonalSquad?(direct: boolean): void
  preservesResident?(npc: NPC): boolean
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
  private personalResult?: { missionId: string; outcome: CareerMissionOutcome; stats: BattleStatsSnapshot; defense?: CareerMissionResult['defense'] }
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
    let stats: BattleStatsSnapshot
    if (active.personalSquad && this.personalResult?.missionId === active.id) {
      stats = this.personalResult.stats; outcome = this.personalResult.outcome
    } else {
      stats = active.kind === 'captain-patrol-command' && this.missions.patrol?.statsSnapshot
        ? this.missions.patrol.statsSnapshot : source.snapshot()
      if (active.personalSquad) this.personalResult = { missionId: active.id, outcome, stats: structuredClone(stats),
        ...(active.kind === 'town-defense' ? { defense: { civilianSurvived: this.missions.defense.civilianSurvived, civilianDeaths: this.missions.defense.civilianDeaths } } : {}) }
    }
    const claim = claimCareerMission(profile, active.id, outcome, stats.player, stats.meritPlayer)
    if (active.kind === 'town-defense' && claim.profile.activeMission?.result) {
      claim.profile.activeMission.result.defense = this.personalResult?.missionId === active.id ? this.personalResult.defense : {
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
    const captainPatrol = active.kind === 'captain-patrol-command'
    if (captainPatrol && !active.result) return { status: 'ignored' }
    const enemyTerritoryScout = isCareerEnemyTerritoryFieldMission(active)
    if (veteranField && !active.result) return { status: 'ignored' }
    const inPlace = !enemyTerritoryScout && (defense || intent === 'arrived' || active.kind === 'cavalry-sweep' || veteranField || captainPatrol)
    if (inPlace && !defense && active.phase !== 'RETURNING' && !((active.kind === 'cavalry-sweep' || veteranField || captainPatrol) && active.result)) return { status: 'ignored' }

    // Cleanup empties controller rosters. Capture borrowed identities before clearing the saved mission.
    const borrowed = (inPlace || enemyTerritoryScout) && !defense ? new Set(active.kind === 'duel' ? this.missions.duel.actors : captainPatrol ? this.missions.patrol?.actors ?? [] : this.missions.field.friendlies) : null
    const next = clearCareerMission(profile, active.id)
    const garrison = next.townEagleGarrisons?.[profile.faction]
    if (inPlace && garrison) for (const pair of garrison.pairs) {
      if (defense || pair.hp <= 0 || pair.mount.hp <= 0) pair.refitAllowed = true
    }
    next.personalSquadRuntime = intent === 'arrived' && active.personalSquad?.state !== 'RESERVE' ? active.personalSquad : undefined
    const groundedTownReturn = captainPatrol && intent === 'direct'
    if (groundedTownReturn) delete next.playerAerialState
    if (!this.profiles.commit(next, groundedTownReturn ? { groundedTownReturn: true } : undefined)) return { status: 'save-failed', destination: defense ? 'defense' : inPlace ? 'party' : 'restart' }
    this.town.returnPersonalSquad?.(intent === 'direct')
    if (captainPatrol) this.missions.patrol?.release()

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
      this.town.restart(this.profiles.read())
      return { status: 'restarted' }
    }

    if (defense) this.missions.defense.cleanupMission()
    else if (active.kind === 'duel') this.missions.duel.cleanupMission()
    else if (active.kind === 'cavalry-sweep' || veteranField) this.missions.field.cleanupMission(active.targetCampId, true)
    else if (!captainPatrol) this.missions.field.cleanupMission(active.targetCampId)
    this.town.clearCombatShots()
    for (const resident of this.town.residents) {
      if (captainPatrol) continue // Its owner already handed the exact roster to physical return/refit.
      if (this.town.preservesResident?.(resident.npc)) continue
      const restore = resident.npc.dead || (defense
        ? true
        : borrowed!.has(resident.npc))
      if (restore) {
        if (resident.spec.duty === 'eagle_garrison' && resident.spec.id && this.town.beginEagleMissionReturn) {
          this.town.releaseExternalThreat(resident.npc)
          this.town.beginEagleMissionReturn(resident.spec.id)
        } else if (resident.spec.duty === 'patrol' && resident.spec.id && this.town.beginPatrolMissionReturn) {
          this.town.releaseExternalThreat(resident.npc)
          this.town.beginPatrolMissionReturn(resident.spec.id)
        } else this.restoreResident(resident)
      }
    }
    if (defense || active.kind === 'duel' || this.town.cat.dead) this.restoreCat()
    if (defense) {
      this.town.world.restoreTownDamage()
      this.town.navigation.sync(this.town.world.obstacles)
    }
    const entry = townPlayerEntryPoint(), entryY = getTerrainHeight(entry.x, entry.z) + .9
    if (captainPatrol && intent === 'direct') {
      this.town.player.resetForScene(entry.x, entryY, entry.z)
      this.town.player.group.rotation.y = entry.yaw
    }
    this.town.restPlayer()
    if ((active.kind === 'cavalry-sweep' || veteranField) && (intent === 'direct' || active.phase !== 'RETURNING')) {
      this.town.player.group.position.set(entry.x, entryY, entry.z)
      this.town.player.group.rotation.y = entry.yaw
    }
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
