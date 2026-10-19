import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { cloneCareerProfile } from '../career/CareerProfile'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import { refitCommandCheckpoint, restoreCommandActor, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { commitCommanderRetirementToMobilizing, hasCompleteRetirementMobilizationCheckpoint, outsideRetirementTownCore, retirementAssaultFormations, retirementMobilizationNeedsPreparation, type RetirementAssaultFormation } from '../career/CareerRetirementMobilization'
import { isTownCommandRevokedByRetirement, revokeRetirementTownCommandClaims } from '../career/CareerRetirementCommand'
import { commanderGateDefenseSlots } from '../career/CommanderTownRoster'
import { civilianCommandRoster } from '../career/CivilianCommandAuthority'
import { TOWN_WATCHTOWER_ARCHER_IDS } from './TownNativeGuardIdentity'
import { townStationSpec } from './TownGarrison'
import { activateTownResidentHome, restoreTownResidentHome } from './TownResidentHome'
import { personalTownDeployment } from '../career/PersonalSquadDeployment'
import { CIVILIAN_HOME_LAYOUT_VERSION } from './TownCivilianLife'
import { TOWN_CITY, TOWN_CITY_ROADS } from './TownLayout'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import type { TownActorSpec } from './TownRules'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { TownCavalryPatrolController } from './TownCavalryPatrolController'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'

interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
interface MobilizationDependencies {
  residents: readonly Resident[]
  read(): CareerProfile
  /** Dedicated retirement-owner publication; never an ordinary-commit bypass. */
  save(next: CareerProfile): boolean
  revoke(): void
  patrol: TownCavalryPatrolController
  eagles: TownEagleGarrisonController
  navigation: NavigationWorld
  obstacles: ObstacleData[]
  nearby(npc: NPC): NPC[]
}

/** Orchestrates native owners; actor simulation stays in TownMissionCombat/updatePeace. */
export class TownRetirementMobilizationController {
  private applied = false
  private suspended = false
  private readonly byId: Map<string, Resident>
  private readonly residents: readonly Resident[]
  readonly formations: readonly RetirementAssaultFormation[] | null
  constructor(private readonly deps: MobilizationDependencies) {
    this.formations = retirementAssaultFormations(deps.residents.map(resident => resident.spec))
    const canonical = new Set(this.formations?.flatMap(formation => formation.actorIds) ?? [])
    this.residents = deps.residents.filter(resident => canonical.has(resident.spec.id))
    this.byId = new Map(this.residents.map(resident => [resident.spec.id, resident]))
  }

  updateBoundary(position: { x: number; z: number }): boolean {
    const current = this.deps.read()
    if (current.careerRetirement?.phase === 'departing' && outsideRetirementTownCore(position)) {
      if (!this.formations) return false
      return commitCommanderRetirementToMobilizing(current, next => this.deps.save(next), () => this.reconcile())
    }
    return this.reconcile()
  }

  reconcile(): boolean {
    const current = this.deps.read()
    if (!isTownCommandRevokedByRetirement(current)) return true
    if (!this.formations) return false
    if (!this.suspended) {
      this.deps.revoke()
      this.deps.patrol.recallForSiege()
      this.deps.eagles.setAmbientPatrolAllowed(false)
      this.deps.eagles.setRecoveryAllowed(false)
      this.suspended = true
    }
    if (current.careerRetirement?.phase !== 'mobilizing' || this.applied) return true
    let next = current
    if (retirementMobilizationNeedsPreparation(current)) {
      const prepared = this.prepare(current)
      if (!prepared || !this.deps.save(prepared)) return false
      next = prepared
      this.deps.revoke()
    }
    if (!hasCompleteRetirementMobilizationCheckpoint(next)) return false
    if (!this.deps.patrol.reconcileRetirementMobilization(next.townCommandSquad!.members!)) return false
    if (!this.deps.eagles.reconcileRetirementMobilization(next.townEagleGarrisons![next.faction]!, `town:${next.faction}`)) return false
    for (const resident of this.residents) {
      if (resident.spec.eagle || resident.spec.duty === 'patrol') continue
      const saved = this.savedMember(next, resident.spec.id)
      if (!saved) return false
      // The receipt already owns this exact snapshot. Native revival is permitted only
      // for a saved survivor, never for a casualty in a later ordinary checkpoint.
      if (saved.status !== 'dead' && (resident.npc.dead || resident.homeMount?.dead && saved.mount && saved.mount.hp > 0)) restoreTownResidentHome(resident)
      restoreCommandActor(resident.npc, saved, resident.homeMount)
      resident.npc.setTownPeaceful(); resident.npc.setMissionCombatTarget(null)
    }
    this.applied = true
    return true
  }

  private prepare(current: CareerProfile): CareerProfile | null {
    const residents = this.residents
    if (residents.some(({ npc, homeMount }) => npc.mount && npc.mount !== homeMount || homeMount && (homeMount.riderPlayer || homeMount.riderNpc && homeMount.riderNpc !== npc))) return null
    const next = cloneCareerProfile(current), sceneKey = `town:${current.faction}`
    const eagle = this.deps.eagles.stageRetirementRefill(sceneKey)
    if (!eagle) return null
    const squads = commanderGateDefenseSlots(), actorIds = squads.flatMap(squad => squad.actorIds)
    const civilianIds = civilianCommandRoster(residents.map(resident => resident.spec))
    const road = TOWN_CITY_ROADS[0]
    const occupied = residents.filter(resident => !civilianIds.includes(resident.spec.id)).map(resident => townStationSpec(resident.spec, Boolean(resident.homeMount), Boolean(resident.npc.rangedWeaponId)))
    // Existing placement owner supplies deterministic, obstacle-aware distributed street slots.
    let auxiliary: ReturnType<typeof personalTownDeployment>
    try {
      auxiliary = personalTownDeployment({ x: road.ax, z: road.az, yaw: 0 }, occupied, civilianIds.length,
        TOWN_CITY, this.deps.obstacles, this.deps.navigation)
    } catch { return null }
    const members: Record<string, PersonalActorCheckpoint> = {}
    for (const formation of this.formations!) for (const id of formation.actorIds) {
      const resident = this.byId.get(id)
      if (!resident) return null
      if (resident.spec.eagle) continue
      const { npc, homeMount } = resident
      const home = townStationSpec(resident.spec, Boolean(homeMount), Boolean(npc.rangedWeaponId))
      const saved = refitCommandCheckpoint(npc, homeMount)
      // A corpse cannot march from an invalid fall/collision pose. Use the native reserved home.
      if (npc.dead || homeMount?.dead) {
        saved.position = { x: home.x, y: home.y ?? getTerrainHeight(home.x, home.z), z: home.z, yaw: home.yaw ?? 0 }
        if (saved.mount) saved.mount.position = { ...saved.position }
      }
      delete saved.fall; delete saved.formation; delete saved.outpostRampartGarrison
      saved.order = 'defend'
      if (resident.spec.duty === 'watchtower_guard') {
        saved.position = { x: home.x, y: home.y ?? getTerrainHeight(home.x, home.z), z: home.z, yaw: home.yaw ?? 0 }
        saved.townRampartGarrison = true
      } else {
        const auxiliaryIndex = civilianIds.indexOf(id)
        const destination = auxiliaryIndex >= 0 ? auxiliary[auxiliaryIndex] : home
        saved.formation = { commandId: -4800 - this.formations!.indexOf(formation),
          position: { x: destination.x, y: 'y' in destination && typeof destination.y === 'number' ? destination.y : getTerrainHeight(destination.x, destination.z), z: destination.z, yaw: home.yaw ?? 0 }, reached: false, arrivalOrder: 'defend' }
      }
      members[id] = saved
    }
    next.townCommandSquad = { type: 'town-command', squadId: 1, commandRank: 'commander', townFaction: current.faction,
      sceneKey: 'town-home', state: 'TRAINING', authorized: false, commandedActorIds: [], squads, actorIds,
      contribution: current.townCommandSquad?.contribution ?? emptyPersonalContribution(),
      members: Object.fromEntries(actorIds.map(id => [id, members[id]])) }
    next.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: current.faction,
      sceneKey, homeLayoutVersion: CIVILIAN_HOME_LAYOUT_VERSION, actorIds: civilianIds, owners: Object.fromEntries(civilianIds.map(id => [id, 'daily' as const])),
      members: Object.fromEntries(civilianIds.map(id => [id, members[id]])) }
    next.retirementTowerGuards = Object.fromEntries(TOWN_WATCHTOWER_ARCHER_IDS.map(id => [id, members[id]]))
    next.townEagleGarrisons = { ...next.townEagleGarrisons, [next.faction]: eagle }
    // Reuse resource checkpoints, rather than storing another full identity/formation list.
    next.careerRetirement!.mobilization = { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true }
    return hasCompleteRetirementMobilizationCheckpoint(next) ? next : null
  }

  private savedMember(profile: CareerProfile, id: string): PersonalActorCheckpoint | undefined {
    return profile.townCommandSquad?.members?.[id] ?? profile.civilianCommandSquad?.members[id] ?? profile.retirementTowerGuards?.[id]
  }

  /** Called last during ordinary snapshot staging, so stale native patrol/refit data cannot win. */
  capture(next: CareerProfile): void {
    if (!this.applied || !next.careerRetirement?.mobilization) return
    for (const resident of this.residents) {
      if (resident.spec.eagle) continue
      const saved = snapshotCommandActor(resident.npc, resident.homeMount), id = resident.spec.id
      if (next.townCommandSquad?.actorIds.includes(id)) next.townCommandSquad.members![id] = saved
      else if (next.civilianCommandSquad?.actorIds.includes(id)) next.civilianCommandSquad.members[id] = saved
      else if (next.retirementTowerGuards && id in next.retirementTowerGuards) next.retirementTowerGuards[id] = saved
    }
    next.townEagleGarrisons = { ...next.townEagleGarrisons, [next.faction]: this.deps.eagles.snapshot(`town:${next.faction}`) }
    revokeRetirementTownCommandClaims(next)
  }

  get active(): boolean { return this.suspended }
  owns(npc: NPC): boolean { return this.suspended && this.byId.get(npc.combatantId)?.npc === npc }
  get criticalSignature(): string | undefined {
    return this.applied ? JSON.stringify(this.residents.map(({ npc, homeMount }) => [npc.combatantId, npc.dead, homeMount?.dead])) : undefined
  }

  updateResident(resident: Resident, dt: number, camera: THREE.Vector3): boolean {
    if (!this.owns(resident.npc) || resident.spec.eagle) return false
    const npc = resident.npc, distance = npc.combatPosition.distanceTo(camera)
    if (!this.applied || npc.dead || resident.spec.duty === 'watchtower_guard') {
      if (this.applied) activateTownResidentHome(npc, resident.spec)
      npc.updateTownPeace(dt, distance, false, false)
    } else {
      npc.updateTownTravel(dt, distance, this.deps.nearby(npc), this.deps.obstacles, this.deps.navigation)
      activateTownResidentHome(npc, resident.spec)
    }
    return true
  }
}
