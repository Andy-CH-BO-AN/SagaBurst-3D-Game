import type { TownPersonalSquadController } from './TownPersonalSquadController'
import * as THREE from 'three'
import type { BanditMissionController, VeteranMissionEnemySquad } from '../career/BanditMissionController'
import type { CareerDuelController } from '../career/CareerDuelController'
import type { TownDefenseController } from '../career/TownDefenseController'
import type { CareerMountController } from '../career/CareerMountController'
import type { CombatDamageMethod } from '../combat/CombatAttribution'
import { checkMountImpact, applyMountImpactDamage } from '../combat/MountImpact'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import type { HpBar } from '../ui/HpBar'
import type { Mount } from '../world/Mount'
import { Faction, type NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { isTownMilitary, isCivilian, type TownActorSpec } from './TownRules'
import { townWartimeHostile } from './TownWartime'
import type { TownCavalryPatrolController } from './TownCavalryPatrolController'

export interface TownCombatResident {
  spec: TownActorSpec
  npc: NPC
  homeMount?: Mount
  target?: THREE.Vector3
  cycle: number
  walkTime: number
}

interface MissionControllers {
  field: Pick<BanditMissionController, 'active' | 'fieldNpcs' | 'friendlies' | 'ambientBandits' | 'missionBandits' | 'combatPeersFor' | 'updateFlow' | 'updateDepartingCavalry' | 'departingNpcs' | 'cavalryMounts' | 'veteranEnemySquads' | 'markVeteranEnemySquadEngaged' | 'travelEncounter' | 'prepareTravelEncounter' | 'noteTravelHit' | 'engageFormalMission' | 'isMissionTarget'>
  duel: Pick<CareerDuelController, 'active' | 'phase' | 'update' | 'isMissionActor' | 'fieldNpcs' | 'allMounts' | 'opponent' | 'combatEnabled' | 'persistRuntimeProgress' | 'setExternalCombat'>
  defense: Pick<TownDefenseController, 'active' | 'phase' | 'assault' | 'updateFlow' | 'fieldNpcs' | 'peersFor' | 'updateCivilianOrder' | 'waitingEnemies' | 'enemyMounts'>
}

/** Ambient warfare owns its roster and travel; mission combat only borrows its participants. */
export interface TownOutskirtsCombatRuntime {
  readonly actors: readonly NPC[]
  readonly mounts: readonly Mount[]
  synchronizeRank(): void
  prepareFrame(dt: number, participants: readonly NPC[], player: Player): void
  owns(npc: NPC): boolean
  squadMembersFor?(npc: NPC): readonly NPC[]
  combatEnabled(npc: NPC): boolean
  updateTravel(npc: NPC, dt: number, cameraPosition: THREE.Vector3): void
}

/** Live simulation inputs and the effects retained by TownScene. Built once, not once per frame. */
interface TownCombatScene {
  player(): Player
  residents: readonly TownCombatResident[]
  mounts?: readonly Mount[]
  cameraPosition: THREE.Vector3
  obstacles: ObstacleData[]
  navigation: NavigationWorld
  hp: HpBar
  careerMounts: Pick<CareerMountController, 'activeMount' | 'update'>
  outskirts?(): TownOutskirtsCombatRuntime | undefined
  personalSquad?(): TownPersonalSquadController | undefined
  patrol?(): Pick<TownCavalryPatrolController, 'prepareCombatFrame' | 'combatActors' | 'combatEnabled' | 'noteHostileHit'>
  /** An individual return/refit owner keeps its actor's assigned peaceful travel until released. */
  ownsPeacefulTravel?(npc: NPC): boolean
  preparePeaceResidents?(excluded: ReadonlySet<NPC>): void
  peaceResident(resident: TownCombatResident, dt: number): void
  updateCommandCue(): void
  clearCombatShots(): void
  hitNpc(target: NPC, damage: number, method: CombatDamageMethod, source?: NPC): void
  damagePlayer(source: NPC, damage: number, method: CombatDamageMethod): void
  fireNpc(origin: THREE.Vector3, direction: THREE.Vector3, kind: 'arrow' | 'pilum', source: NPC): void
}

/** Owns mission actor selection and simulation order; each mission retains its own phase rules.
 * NPC callbacks run synchronously and carry the actual actor to TownScene's damage/projectile routing.
 * Grids and neighbor storage live here. Controller roster/peer semantics and checkpoints are unchanged.
 */
export class TownMissionCombat {
  private readonly grid = new SpatialGrid<NPC>(4)
  private readonly defenseEnemyGrid = new SpatialGrid<NPC>(8)
  private readonly defenseTownGrid = new SpatialGrid<NPC>(8)
  private readonly banditThreatGrid = new SpatialGrid<NPC>(20)
  private readonly externalThreatActors = new Set<NPC>()
  private readonly neighbors: NPC[] = []
  private readonly engagedVeteranEnemies = new Set<NPC>()
  private readonly veteranEngagedEnemyGrid = new SpatialGrid<NPC>(8)
  private readonly enemyTownHostileActors: NPC[] = []
  private readonly warfareGrid = new SpatialGrid<NPC>(8)
  private readonly travelCombatPeers: NPC[] = []
  private readonly travelThreatGrid = new SpatialGrid<NPC>(8)
  private readonly outskirtsGrid = new SpatialGrid<NPC>(8)
  private readonly patrolThreatGrid = new SpatialGrid<NPC>(8)
  private readonly protectionCandidates: NPC[] = []
  private readonly runtimeActors: NPC[] = []
  private readonly individualThreats = new Map<NPC, number>()

  constructor(private readonly missions: MissionControllers, private readonly town: TownCombatScene) {}

  get runtimeParticipants(): NPC[] { return this.runtimeActors }
  get runtimeGrid(): SpatialGrid<NPC> { return this.warfareGrid }
  get externalDefenders(): readonly NPC[] {
    return [...new Set([...this.externalThreatActors, ...(this.town.patrol?.().combatActors ?? [])])].filter(npc => !npc.hostileToPlayer)
  }

  /** Damage wakes the actual actor/squad without changing a mission party's route phase. */
  noteExternalHit(target: NPC, source?: NPC): void {
    const outskirts = this.town.outskirts?.()
    const field = this.missions.field
    if (source && outskirts && field.noteTravelHit(target, source, outskirts)) { this.prepareTravelCombat(); return }
    if (source && field.friendlies.includes(target) && field.isMissionTarget(source)) field.engageFormalMission()
    if (source && (outskirts?.owns(source) || this.missions.field.fieldNpcs.includes(source)
      || this.missions.field.ambientBandits.includes(source) || this.missions.defense.fieldNpcs.includes(source))) {
      const patrolHit = this.town.patrol?.().noteHostileHit(target, source)
      if (!patrolHit && outskirts?.owns(source) && !outskirts.owns(target)) this.individualThreats.set(target, 10)
    }
    const squad = this.missions.field.veteranEnemySquads.find(candidate => candidate.members.includes(target))
    if (squad) this.missions.field.markVeteranEnemySquadEngaged(squad.squadId)
  }

  /** Called only after actual Player HP, shield or mounted contact has been resolved. */
  noteExternalPlayerHit(source: NPC): void {
    const outskirts = this.town.outskirts?.()
    if (outskirts && this.missions.field.noteTravelHit(this.town.player(), source, outskirts)) this.prepareTravelCombat()
    if (this.missions.field.isMissionTarget(source)) this.missions.field.engageFormalMission()
  }

  /** TownScene owns the hostile residents and the single navigation frame reset. */
  updateOutskirtsHostile(dt: number, elapsed: number): void {
    const outskirts = this.prepareOutskirtsFrame(dt)
    if (!outskirts?.actors.length && !this.town.personalSquad?.()?.actors.length) return
    const ambientActors = [...new Set(this.missions.field.ambientBandits)]
    for (const actor of ambientActors) if (!outskirts?.owns(actor)) this.updateRuntimeActor(actor, dt)
    for (const actor of outskirts?.actors ?? []) this.updateOutskirtsActor(actor, outskirts!, dt)
    for (const actor of this.town.personalSquad?.()?.actors ?? []) this.updatePersonalActor(actor, dt)
    this.updateRuntimeMountImpacts([...new Set([...ambientActors, ...(outskirts?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? [])])], elapsed)
    const playerMount = this.town.player().currentMount
    if (playerMount && !playerMount.dead) for (const target of outskirts?.actors ?? []) {
      if (target.dead || target.faction === Faction.TOWN || target.faction === Faction.PLAYER
        || !checkMountImpact(playerMount, target.combatPosition, .5)) continue
      applyMountImpactDamage(playerMount, target, target.combatPosition, elapsed,
        damage => this.town.hitNpc(target, damage, 'mount-impact'))
    }
  }

  get enemyTownHostiles(): readonly NPC[] {
    const active = this.missions.field.active
    return active?.kind === 'veteran-field' && active.templateId === 'veteran-tragedy-of-the-scouts'
      ? this.enemyTownHostileActors
      : []
  }

  update(dt: number, cameraYaw: number, elapsed: number): void {
    this.town.navigation.sync(this.town.obstacles)
    this.town.navigation.beginFrame()
    if (this.missions.duel.active) {
      this.missions.duel.update(dt)
      this.updateTownWithDuel(dt, elapsed)
      this.missions.duel.persistRuntimeProgress()
    }
    else if (this.missions.defense.active) this.updateDefense(dt, cameraYaw, elapsed)
    else this.updateField(dt, cameraYaw, elapsed)
  }

  /** Runs after either mission combat or Town hostility, preserving temporary cavalry's departure. */
  updateDepartingCavalry(dt: number): void {
    const { field } = this.missions
    field.updateDepartingCavalry()
    for (const npc of field.departingNpcs) {
      npc.update(dt, this.town.player(), [], [], this.town.obstacles, this.town.hp, () => {}, () => {}, false,
        npc.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
    }
    for (const mount of field.cavalryMounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      if (mount.dead || !mount.riderNpc) mount.update(dt, this.town.obstacles)
    }
  }

  /** Panels pause living combat, while every defeated actor completes its presentation. */
  updateDefeatedActors(dt: number): void {
    const { field, duel, defense } = this.missions
    const outskirts = this.town.outskirts?.()
    const actors = new Set([...this.town.residents.map(r => r.npc), ...field.fieldNpcs,
      ...field.departingNpcs, ...duel.fieldNpcs, ...defense.fieldNpcs, ...defense.waitingEnemies, ...(outskirts?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? [])])
    for (const actor of actors) if (actor.dead) this.updateCorpse(actor, dt)
    const mounts = new Set([...(this.town.mounts ?? []), ...this.town.residents.flatMap(r => r.homeMount ? [r.homeMount] : []),
      ...field.cavalryMounts, ...duel.allMounts, ...defense.enemyMounts, ...(outskirts?.mounts ?? []), ...(this.town.personalSquad?.()?.mounts ?? [])])
    for (const mount of mounts) if (mount.dead && !mount.disposed) mount.update(dt, this.town.obstacles)
  }

  private updateCorpse(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), [], [], this.town.obstacles, this.town.hp, () => {}, () => {},
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
  }

  /** Also checks current positions because Player attacks precede threat assignment in a frame. */
  isExternalThreatDefender(ally: NPC): boolean {
    if (ally.hostileToPlayer) return false
    if (this.town.patrol?.().combatEnabled(ally)) return true
    if (this.missions.field.active?.kind === 'veteran-field' && this.missions.field.friendlies.includes(ally)) return false
    if (this.externalThreatActors.has(ally)) return true
    const resident = this.town.residents.find(candidate => candidate.npc === ally)
    if (!resident || ally.dead || !this.isMilitary(resident.spec)) return false
    const outskirts = this.town.outskirts?.()
    return [...this.missions.field.ambientBandits, ...this.missions.field.missionBandits,
      ...this.outskirtsGrid.getNearbyInto(ally.combatPosition, 20, this.protectionCandidates)]
      .some(threat => !threat.dead && townWartimeHostile(ally, threat)
        && (resident.spec.duty !== 'patrol' || !outskirts?.owns(threat))
        && threat.combatPosition.distanceToSquared(ally.combatPosition) <= 20 * 20)
  }

  /** Resident restoration owns the physical reset; combat only releases its threat registration. */
  releaseExternalThreat(npc: NPC): void { this.externalThreatActors.delete(npc) }

  private updateField(dt: number, cameraYaw: number, elapsed: number): void {
    const { field } = this.missions
    const veteranField = field.active?.kind === 'veteran-field'
    // Veteran battles have explicit, persistent rosters. Build the two membership
    // sets and shared peer lists once per frame instead of asking the controller
    // to allocate an all-roster peer array for every actor.
    const veteranFriendlies = veteranField ? new Set(field.friendlies) : null
    const outskirts = this.prepareOutskirtsFrame(dt)
    field.prepareTravelEncounter(dt, this.outskirtsGrid, outskirts ?? { owns: () => false })
    field.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    const warfareActive = Boolean(outskirts?.actors.length || this.town.personalSquad?.()?.actors.length)
    const currentVeteran = veteranField ? field.active : undefined
    const veteranSurvival = currentVeteran?.templateId === 'veteran-tragedy-of-the-scouts'
    const player = this.town.player()
    if (veteranField && veteranSurvival) this.updateExternalThreatAssignments({ enemyTownScouts: field.friendlies, player })
    else this.updateExternalThreatAssignments()
    const veteranMarching = veteranField && !veteranSurvival && currentVeteran?.phase === 'MARCHING'
    let veteranCombatActive = veteranField && (veteranSurvival || currentVeteran?.phase === 'ENGAGING')
    this.engagedVeteranEnemies.clear()
    const engagedVeteranSquads = new Set(currentVeteran?.engagedEnemySquadIds ?? [])
    const veteranHostileActors = veteranField ? new Set([...field.missionBandits, ...this.enemyTownHostileActors]) : null
    const veteranActors = veteranField ? [...new Set([...field.missionBandits, ...field.friendlies])] : null
    const veteranFriendlyPeers = veteranField ? [...new Set([...field.friendlies, ...field.missionBandits, ...this.externalThreatActors])] : null
    const veteranEnemyPeers = veteranField ? [...new Set([...field.missionBandits, ...field.friendlies, ...this.externalThreatActors])] : null
    const veteranMarchingPeers = veteranField ? [...new Set([...field.friendlies, ...this.externalThreatActors])] : null
    const missionActors = new Set(veteranActors ?? field.fieldNpcs)
    if (veteranField) for (const npc of this.enemyTownHostileActors) missionActors.add(npc)
    this.town.preparePeaceResidents?.(new Set([...missionActors, ...this.externalThreatActors]))
    const patrol = this.town.patrol?.()
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = new Set(patrol?.combatActors ?? [])
    for (const resident of this.town.residents) {
      if (!missionActors.has(resident.npc) && !this.externalThreatActors.has(resident.npc) && !patrolActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    }
    const missionCombatActors = veteranField
      ? [...new Set([...field.missionBandits, ...field.friendlies, ...this.enemyTownHostileActors])]
      : [...new Set([...field.fieldNpcs, ...this.externalThreatActors])]
    const actors = [...new Set([...missionCombatActors,
      ...(warfareActive ? field.ambientBandits : []), ...(outskirts?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? []), ...this.externalThreatActors, ...patrolActors])]
    this.grid.clear()
    if (veteranField) { this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear() }
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (veteranHostileActors?.has(actor)) this.defenseEnemyGrid.insert(actor)
      else if (veteranFriendlies?.has(actor) || this.externalThreatActors.has(actor)) this.defenseTownGrid.insert(actor)
    }
    if (veteranField) this.veteranEngagedEnemyGrid.clear()
    if (veteranField && !veteranSurvival) {
      for (const squad of field.veteranEnemySquads) {
        let engaged = engagedVeteranSquads.has(squad.squadId)
        const sensor = !squad.leader.dead ? squad.leader : squad.members.find(member => !member.dead)
        if (!engaged && sensor) {
          const nearbyFriendly = this.defenseTownGrid.getNearbyInto(sensor.combatPosition, 50, this.neighbors)
            .some(actor => !actor.dead && veteranFriendlies!.has(actor))
          const playerNearby = !player.dead && sensor.combatPosition.distanceToSquared(player.combatPosition) <= 50 * 50
          const nearbyRoaming = warfareActive && squad.members.some(member => !member.dead
            && this.outskirtsGrid.getNearbyInto(member.combatPosition, 50, this.neighbors)
              .some(actor => !actor.dead && townWartimeHostile(member, actor)))
          if (nearbyFriendly || playerNearby || nearbyRoaming) {
            engaged = field.markVeteranEnemySquadEngaged(squad.squadId)
            if (engaged) engagedVeteranSquads.add(squad.squadId)
          }
        }
        if (engaged) {
          for (const member of squad.members) if (!member.dead) this.engagedVeteranEnemies.add(member)
        } else {
          this.faceHeldVeteranSquad(squad, player)
        }
      }
    }
    if (veteranField && veteranSurvival) {
      for (const enemy of field.missionBandits) if (!enemy.dead) this.engagedVeteranEnemies.add(enemy)
      for (const guard of this.enemyTownHostileActors) if (!guard.dead) this.engagedVeteranEnemies.add(guard)
    }
    if (field.travelEncounter.active && field.active?.phase === 'MARCHING' && this.engagedVeteranEnemies.size) {
      field.engageFormalMission()
      veteranCombatActive = !field.travelEncounter.active
    }
    this.prepareTravelCombat()
    if (veteranField) for (const enemy of this.engagedVeteranEnemies) this.veteranEngagedEnemyGrid.insert(enemy)
    const veteranSquadCombatActive = veteranCombatActive || this.engagedVeteranEnemies.size > 0
    for (const actor of actors) {
      if (this.town.personalSquad?.()?.owns(actor)) { this.updatePersonalActor(actor, dt); continue }
      if (patrolActors.has(actor)) {
        this.updateRuntimeActor(actor, dt)
        continue
      }
      if (outskirts?.owns(actor)) {
        this.updateOutskirtsActor(actor, outskirts, dt)
        continue
      }
      if (veteranField && this.externalThreatActors.has(actor) && !missionActors.has(actor)) {
        this.updateRuntimeActor(actor, dt)
        continue
      }
      if (field.travelEncounter.owns(actor)) {
        this.updateTravelEncounterActor(actor, dt)
        continue
      }
      const individualDefense = warfareActive && this.shouldDefendAgainstOutskirts(actor)
      const actorIsVeteranHostile = veteranField && veteranHostileActors!.has(actor)
      const veteranFriendlyTravel = veteranField && !veteranSurvival && veteranFriendlies!.has(actor)
        && currentVeteran?.phase !== 'ENGAGING' && this.engagedVeteranEnemies.size === 0
      const veteranEnemyHeld = veteranField && !veteranSurvival && veteranHostileActors!.has(actor)
        && !this.engagedVeteranEnemies.has(actor)
      if (veteranEnemyHeld) {
        this.updateFieldActorPeacefully(actor, dt)
        continue
      }
      if (veteranFriendlyTravel && !individualDefense) {
        this.updateFieldActorTravel(actor, dt)
        continue
      }
      const peers = warfareActive ? this.runtimeActors : veteranField
        ? veteranMarching && !veteranSurvival ? veteranMarchingPeers! : actorIsVeteranHostile ? veteranEnemyPeers! : veteranFriendlyPeers!
        : actor.faction === Faction.BANDIT
          ? [...new Set([...field.combatPeersFor(actor), ...this.externalThreatActors])]
          : this.externalThreatActors.has(actor)
            ? [...field.ambientBandits, ...field.missionBandits, ...this.externalThreatActors]
            : field.combatPeersFor(actor)
      const nearbyGrid = warfareActive ? this.warfareGrid : veteranField
        ? actorIsVeteranHostile ? this.defenseEnemyGrid : this.defenseTownGrid
        : this.grid
      const hostileGrid = warfareActive ? this.warfareGrid : veteranSquadCombatActive
        ? actorIsVeteranHostile
          ? this.defenseTownGrid
          : currentVeteran?.phase === 'ENGAGING' && !veteranSurvival
            ? this.defenseEnemyGrid
            : this.veteranEngagedEnemyGrid
        : null
      const travelOrder = individualDefense && (actor.tacticalOrder === 'formation' || actor.tacticalOrder === 'follow'
        || actor.tacticalOrder === 'defend' && actor.formationCommandId != null)
        ? actor.tacticalOrder : null
      // Temporarily release the actor's combat AI while retaining its existing route/follow intent.
      if (travelOrder) actor.tacticalOrder = 'attack'
      actor.update(dt, this.town.player(), peers, nearbyGrid.getNearbyInto(actor.combatPosition, warfareActive ? 8 : 2, this.neighbors),
        this.town.obstacles, this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, hostileGrid, this.town.navigation)
      if (travelOrder && !actor.dead) actor.tacticalOrder = travelOrder
    }
    const mount = player.currentMount
    const playerImpactTargets = [...new Set([
      ...(veteranField ? [...field.missionBandits, ...this.enemyTownHostileActors] : [...field.ambientBandits, ...field.missionBandits]),
      ...(outskirts?.actors.filter(actor => actor.faction === Faction.BANDIT || actor.faction === Faction.ENEMY) ?? []),
      ...[...patrolActors].filter(actor => actor.hostileToPlayer),
    ])]
    if ((!veteranField || veteranSquadCombatActive || warfareActive) && mount && mount === player.currentMount && !mount.dead) {
      for (const target of playerImpactTargets) {
        if (target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (warfareActive) {
      this.updateRuntimeMountImpacts(actors.filter(actor => !veteranHostileActors?.has(actor)
        || this.engagedVeteranEnemies.has(actor)), elapsed)
    } else if (veteranField && veteranSquadCombatActive) {
      for (const rider of actors) {
        const npcMount = rider.mount
        if (!npcMount || npcMount.dead || rider.dead) continue
        const riderIsEnemy = veteranHostileActors!.has(rider)
        if (!riderIsEnemy && !veteranFriendlies!.has(rider) && !this.externalThreatActors.has(rider)) continue
        for (const target of this.grid.getNearbyInto(npcMount.group.position, 2.5, this.neighbors)) {
          const isHostileTarget = townWartimeHostile(rider, target)
            && (riderIsEnemy ? veteranFriendlies!.has(target) || this.externalThreatActors.has(target) : veteranHostileActors!.has(target))
          if (!isHostileTarget || target.dead || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
          applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', rider))
        }
        if (riderIsEnemy && rider.hostileToPlayer && !player.dead && checkMountImpact(npcMount, player.combatPosition, .6)) {
          applyMountImpactDamage(npcMount, player, player.combatPosition, elapsed, damage => this.town.damagePlayer(rider, damage, 'mount-impact'))
        }
      }
    } else if (field.active?.kind === 'cavalry-sweep') for (const rider of field.friendlies) {
      const npcMount = rider.mount
      if (!npcMount || npcMount.dead || rider.dead) continue
      for (const target of this.grid.getNearby(npcMount.group.position, 2.5)) {
        if (target.faction !== Faction.BANDIT || target.dead || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', rider))
      }
    }
    this.town.careerMounts.update(dt)
  }

  private prepareTravelCombat(): void {
    this.travelThreatGrid.clear()
    this.travelCombatPeers.length = 0
    if (!this.missions.field.travelEncounter.active) return
    const threats = this.missions.field.travelEncounter.hostileActors
    this.travelCombatPeers.push(...this.missions.field.friendlies, ...threats)
    for (const threat of threats) if (!threat.dead) this.travelThreatGrid.insert(threat)
  }

  private updateTravelEncounterActor(actor: NPC, dt: number): void {
    // Outside members use the common navigation budget to support; only in-range threats are targets.
    if (actor.tacticalOrder === 'formation') { this.updateFieldActorTravel(actor, dt); return }
    actor.update(dt, this.town.player(), this.travelCombatPeers,
      this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.town.obstacles, this.town.hp,
      (damage, isPlayer, target) => {
        if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
        else if (target) this.town.hitNpc(target, damage, 'melee', actor)
      }, (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, this.travelThreatGrid, this.town.navigation)
  }

  private prepareOutskirtsFrame(dt: number): TownOutskirtsCombatRuntime | undefined {
    const outskirts = this.town.outskirts?.()
    outskirts?.synchronizeRank()
    const previousOutskirts = new Set(outskirts?.actors ?? [])
    const participants = [...new Set([
      ...this.town.residents.map(resident => resident.npc),
      ...this.missions.field.fieldNpcs, ...(outskirts?.actors.length || this.town.personalSquad?.()?.actors.length || this.missions.defense.active ? this.missions.field.ambientBandits : []),
      ...this.missions.defense.fieldNpcs, ...this.missions.duel.fieldNpcs,
      ...(outskirts?.actors ?? []), ...(this.town.personalSquad?.()?.actors ?? []),
    ])]
    outskirts?.prepareFrame(dt, participants, this.town.player())
    // A wiped squad may have been replaced during prepareFrame; never retain its old generation.
    this.runtimeActors.length = 0
    this.runtimeActors.push(...new Set([
      ...participants.filter(actor => !previousOutskirts.has(actor)),
      ...(outskirts?.actors ?? []),
    ]))
    this.warfareGrid.clear(); this.outskirtsGrid.clear()
    for (const actor of this.runtimeActors) if (!actor.dead) this.warfareGrid.insert(actor)
    for (const actor of outskirts?.actors ?? []) if (!actor.dead) this.outskirtsGrid.insert(actor)
    for (const [actor, remaining] of this.individualThreats) {
      if (actor.dead || remaining <= dt) this.individualThreats.delete(actor)
      else this.individualThreats.set(actor, remaining - dt)
    }
    return outskirts
  }

  private shouldDefendAgainstOutskirts(actor: NPC): boolean {
    return !actor.dead && (this.individualThreats.has(actor) || this.outskirtsGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors)
      .some(threat => !threat.dead && townWartimeHostile(actor, threat)))
  }

  private preparePatrolCombatFrame(dt: number, outskirts: TownOutskirtsCombatRuntime | undefined): void {
    const patrol = this.town.patrol?.()
    if (!patrol) return
    const { field, defense } = this.missions
    const threats = new Set([...field.fieldNpcs, ...field.ambientBandits,
      ...(defense.active && defense.phase !== 'PREPARING' ? defense.fieldNpcs : []), ...(outskirts?.actors ?? [])])
    this.patrolThreatGrid.clear()
    for (const actor of threats) if (!actor.dead) this.patrolThreatGrid.insert(actor)
    patrol.prepareCombatFrame(dt, this.patrolThreatGrid, {
      owns: actor => threats.has(actor),
      squadMembersFor: actor => outskirts?.owns(actor) ? outskirts.squadMembersFor?.(actor) ?? [actor]
        : field.veteranEnemySquads.find(squad => squad.members.includes(actor))?.members ?? [actor],
    })
  }

  private updateOutskirtsActor(actor: NPC, outskirts: TownOutskirtsCombatRuntime, dt: number): void {
    if (!actor.dead && !outskirts.combatEnabled(actor)) {
      outskirts.updateTravel(actor, dt, this.town.cameraPosition)
      return
    }
    this.updateRuntimeActor(actor, dt)
  }

  private updatePersonalActor(actor: NPC, dt: number): void {
    const personal = this.town.personalSquad?.()
    if (!actor.dead && personal?.state === 'RETURNING') {
      actor.updateTownTravel(dt, actor.group.position.distanceTo(this.town.cameraPosition),
        this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.town.obstacles, this.town.navigation)
    } else this.updateRuntimeActor(actor, dt)
  }

  private updateRuntimeActor(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), this.runtimeActors,
      this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.town.obstacles, this.town.hp,
      (damage, isPlayer, target) => {
        if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
        else if (target) this.town.hitNpc(target, damage, 'melee', actor)
      }, (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, this.warfareGrid, this.town.navigation)
  }

  private updateRuntimeMountImpacts(actors: readonly NPC[], elapsed: number): void {
    const outskirts = this.town.outskirts?.()
    const player = this.town.player()
    for (const actor of actors) {
      const mount = actor.mount
      if (!mount || mount.dead || actor.dead || outskirts?.owns(actor) && !outskirts.combatEnabled(actor)) continue
      for (const target of this.warfareGrid.getNearbyInto(mount.group.position, 2.5, this.neighbors)) {
        if (target.dead || !townWartimeHostile(actor, target) || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed,
          damage => this.town.hitNpc(target, damage, 'mount-impact', actor))
      }
      if (actor.hostileToPlayer && !player.dead && checkMountImpact(mount, player.combatPosition, .6)) {
        applyMountImpactDamage(mount, player, player.combatPosition, elapsed,
          damage => this.town.damagePlayer(actor, damage, 'mount-impact'))
      }
    }
  }

  private updateFieldActorPeacefully(actor: NPC, dt: number): void {
    if (actor.mount) {
      actor.mount.beginControlledFrame()
      actor.mount.finishControlledFrame(dt, this.town.obstacles)
    }
    actor.updateTownPeace(dt, actor.group.position.distanceTo(this.town.cameraPosition), false, false)
  }

  private updateFieldActorTravel(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), [], [], this.town.obstacles, this.town.hp, () => {}, () => {},
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
  }

  private faceHeldVeteranSquad(squad: VeteranMissionEnemySquad, player: Player): void {
    const nearestFriendly = this.defenseTownGrid.findNearest(squad.leader.combatPosition)
    let target: THREE.Vector3 | null = nearestFriendly?.combatPosition ?? null
    if (!player.dead && (!target
      || player.combatPosition.distanceToSquared(squad.leader.combatPosition) < target.distanceToSquared(squad.leader.combatPosition))) {
      target = player.combatPosition
    }
    if (!target) return
    for (const actor of squad.members) {
      if (actor.dead) continue
      const position = actor.combatPosition
      const yaw = Math.atan2(target.x - position.x, target.z - position.z)
      actor.group.rotation.y = yaw
      if (actor.mount && !actor.mount.dead) actor.mount.group.rotation.y = yaw
    }
  }

  private updateTownWithDuel(dt: number, elapsed: number): void {
    const { duel, field } = this.missions
    const outskirts = this.prepareOutskirtsFrame(dt)
    this.updateExternalThreatAssignments()
    const duelActors = new Set(duel.fieldNpcs)
    this.town.preparePeaceResidents?.(new Set([...duelActors, ...this.externalThreatActors]))
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = new Set(this.town.patrol?.().combatActors ?? [])
    const actors = [...new Set([...duelActors, ...field.fieldNpcs, ...field.ambientBandits,
      ...(outskirts?.actors ?? []), ...this.externalThreatActors, ...patrolActors])]
    const activeActors = new Set(actors)
    for (const resident of this.town.residents) if (!activeActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    for (const actor of actors) {
      // Mission behavior wins even if the actor also occurs in a world roster.
      if (duelActors.has(actor)) {
        if (actor.dead) { this.updateCorpse(actor, dt); continue }
        const combatant = actor === duel.opponent && duel.combatEnabled
        const externalCombat = this.warfareGrid.getNearbyInto(actor.combatPosition, 20, this.neighbors)
          .some(target => !target.dead && townWartimeHostile(actor, target))
        duel.setExternalCombat(actor, externalCombat)
        if (combatant || externalCombat) this.updateRuntimeActor(actor, dt)
        else if (duel.phase === 'PREPARING' || duel.phase === 'RESULT' || duel.phase === 'ENGAGING') {
          if (actor.formationCommandId != null && !actor.isFormationTargetReached(actor.formationCommandId)) {
            actor.updateTownTravel(dt, actor.group.position.distanceTo(this.town.cameraPosition),
              this.warfareGrid.getNearbyInto(actor.combatPosition, 8, this.neighbors), this.town.obstacles, this.town.navigation)
            continue
          }
          if (actor.mount) { actor.mount.beginControlledFrame(); actor.mount.finishControlledFrame(dt, this.town.obstacles) }
          actor.updateTownPeace(dt, actor.group.position.distanceTo(this.town.cameraPosition), false, false)
        } else this.updateRuntimeActor(actor, dt)
      } else if (outskirts?.owns(actor)) this.updateOutskirtsActor(actor, outskirts, dt)
      else this.updateRuntimeActor(actor, dt)
    }
    // TownScene owns global/Outskirts mounts; the career controller owns its active mount.
    for (const mount of new Set(duel.allMounts)) {
      if (this.town.mounts?.includes(mount) || outskirts?.mounts.includes(mount) || mount === this.town.careerMounts.activeMount) continue
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, this.town.obstacles)
    }
    this.updateRuntimeMountImpacts(actors, elapsed)
    const player = this.town.player(), playerMount = player.currentMount
    if (playerMount && !playerMount.dead) for (const target of this.runtimeActors) {
      if (target.dead || !(target.hostileToPlayer || target === duel.opponent && duel.combatEnabled)
        || !checkMountImpact(playerMount, target.combatPosition, .5)) continue
      applyMountImpactDamage(playerMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
    }
    this.town.careerMounts.update(dt)
  }

  private updateExternalThreatAssignments(options: { enemyTownScouts?: readonly NPC[]; player?: Player; roamingOnly?: boolean } = {}): void {
    const { field } = this.missions
    const enemyTownScouts = options.enemyTownScouts
    const outskirts = this.town.outskirts?.()
    const threatActors = [...(enemyTownScouts ?? (options.roamingOnly ? [] : [...field.ambientBandits, ...field.missionBandits])),
      ...(outskirts?.actors ?? [])].filter(npc => !npc.dead)
    this.banditThreatGrid.clear()
    for (const actor of threatActors) if (!actor.dead) this.banditThreatGrid.insert(actor)
    const missionFriendlies = new Set([...field.friendlies, ...this.missions.duel.fieldNpcs, ...(this.missions.defense.active ? this.missions.defense.fieldNpcs : [])])
    for (const resident of this.town.residents) {
      const { npc, spec } = resident
      if (this.missions.duel.active && this.missions.duel.isMissionActor(npc)) {
        this.externalThreatActors.delete(npc)
        continue
      }
      if (spec.duty === 'patrol' && this.town.patrol?.()) {
        this.externalThreatActors.delete(npc)
        continue
      }
      if (this.town.patrol?.().combatEnabled(npc)) {
        this.externalThreatActors.delete(npc)
        continue
      }
      if (this.town.ownsPeacefulTravel?.(npc)) {
        if (this.externalThreatActors.delete(npc) && !npc.dead) npc.endExternalThreat()
        continue
      }
      const military = enemyTownScouts === undefined
        ? this.isMilitary(spec)
        : !isCivilian(spec.role) && spec.role !== 'cat'
      const eligible = military && !npc.dead && !missionFriendlies.has(npc)
        && (enemyTownScouts === undefined
          ? true
          : spec.id.startsWith('enemy-town:') && npc.faction === Faction.ENEMY)
      const nearbyMissionActor = eligible && this.banditThreatGrid.getNearbyInto(npc.combatPosition, 20, this.neighbors)
        // Patrol-owned roaming encounters use the squad controller; other threats keep existing ownership.
        .some(threat => !threat.dead && townWartimeHostile(npc, threat)
          && (spec.duty !== 'patrol' || !outskirts?.owns(threat)))
      const nearbyPlayer = eligible && enemyTownScouts !== undefined && options.player !== undefined
        && !options.player.dead && npc.combatPosition.distanceToSquared(options.player.combatPosition) <= 20 * 20
      const threatened = Boolean(nearbyMissionActor || nearbyPlayer)
      if (threatened) {
        if (!this.externalThreatActors.has(npc)) {
          npc.beginExternalThreat()
          if (enemyTownScouts !== undefined) npc.respawnEnabled = false
        }
        this.externalThreatActors.add(npc)
      } else if (this.externalThreatActors.delete(npc)) {
        // A mission borrower already owns this actor's orders and physical position.
        if (npc.dead || missionFriendlies.has(npc)) continue
        npc.endExternalThreat()
        // Patrol resumes its own navigation from the actual position, including a
        // recently released mission actor travelling to barracks. It owns arrival.
        if (spec.duty === 'patrol') continue
        const point = new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z)
        if (npc.mount && !npc.mount.dead) {
          npc.mount.group.position.copy(point)
          npc.mount.group.rotation.y = spec.yaw ?? Math.PI
        } else {
          npc.group.position.copy(point)
          npc.group.rotation.y = spec.yaw ?? Math.PI
        }
      }
    }
    this.enemyTownHostileActors.length = 0
    if (enemyTownScouts !== undefined) for (const npc of this.externalThreatActors) {
      if (npc.combatantId.startsWith('enemy-town:') && !npc.dead) this.enemyTownHostileActors.push(npc)
    }
  }

  private isMilitary(spec: TownActorSpec): boolean { return isTownMilitary(spec) }

  private updateDefense(dt: number, cameraYaw: number, elapsed: number): void {
    const { defense } = this.missions
    defense.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    const outskirts = this.prepareOutskirtsFrame(dt)
    const warfareActive = Boolean(outskirts?.actors.length || defense.active)
    if (warfareActive) this.updateExternalThreatAssignments({ roamingOnly: true })
    this.town.preparePeaceResidents?.(new Set([...defense.fieldNpcs, ...this.externalThreatActors]))
    const patrol = this.town.patrol?.()
    this.preparePatrolCombatFrame(dt, outskirts)
    const patrolActors = new Set(patrol?.combatActors ?? [])
    const actors = warfareActive ? [...new Set([
      ...defense.fieldNpcs, ...this.missions.field.ambientBandits,
      ...(outskirts?.actors ?? []), ...this.externalThreatActors, ...patrolActors,
    ])] : [...new Set([...defense.fieldNpcs, ...patrolActors])]
    const missionActors = new Set(actors)
    for (const resident of this.town.residents) if (!missionActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    this.grid.clear(); this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear()
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (actor.faction === Faction.ENEMY) this.defenseEnemyGrid.insert(actor)
      else this.defenseTownGrid.insert(actor)
    }
    for (const actor of actors) {
      if (patrolActors.has(actor)) {
        this.updateRuntimeActor(actor, dt)
        continue
      }
      if (outskirts?.owns(actor)) {
        this.updateOutskirtsActor(actor, outskirts, dt)
        continue
      }
      defense.updateCivilianOrder(actor)
      const individualDefense = !actor.missionMovement && warfareActive && this.shouldDefendAgainstOutskirts(actor)
      const travelOrder = individualDefense && (actor.tacticalOrder === 'formation' || actor.tacticalOrder === 'follow'
        || actor.tacticalOrder === 'defend' && actor.formationCommandId != null)
        ? actor.tacticalOrder : null
      if (travelOrder) actor.tacticalOrder = 'attack'
      const hostileGrid = warfareActive ? this.warfareGrid : actor.faction === Faction.ENEMY ? this.defenseTownGrid : this.defenseEnemyGrid
      actor.update(dt, this.town.player(), warfareActive ? this.runtimeActors : defense.peersFor(actor),
        (warfareActive ? this.warfareGrid : this.grid).getNearbyInto(actor.combatPosition, warfareActive ? 8 : 2, this.neighbors),
        this.town.obstacles, this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, hostileGrid, this.town.navigation)
      if (travelOrder && !actor.dead) actor.tacticalOrder = travelOrder
    }
    for (const enemy of defense.waitingEnemies) {
      if (enemy.dead) continue
      const mount = enemy.mount
      if (mount && !mount.dead) {
        mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
        mount.beginControlledFrame()
        mount.finishControlledFrame(dt, this.town.obstacles)
      }
      enemy.updateTownPeace(dt, enemy.group.position.distanceTo(this.town.cameraPosition), false, false)
    }
    // Lethal damage immediately releases the rider; keep mission mounts' collapse advancing.
    for (const mount of defense.enemyMounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      if (mount.dead || !mount.riderNpc) mount.update(dt, this.town.obstacles)
    }
    const player = this.town.player(), mount = player.currentMount
    if (mount && mount === player.currentMount && !mount.dead) {
      for (const target of this.grid.getNearby(mount.group.position, 2.5)) {
        if ((target.faction !== Faction.ENEMY && (!warfareActive || target.faction !== Faction.BANDIT))
          || target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (warfareActive) this.updateRuntimeMountImpacts(actors, elapsed)
    else for (const actor of actors) {
      const npcMount = actor.mount
      if (!npcMount || npcMount.dead || actor.dead) continue
      for (const target of this.grid.getNearby(npcMount.group.position, 2.5)) {
        if (target.dead || !townWartimeHostile(actor, target) || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', actor))
      }
      if (actor.hostileToPlayer && !player.dead && checkMountImpact(npcMount, player.combatPosition, .6)) {
        applyMountImpactDamage(npcMount, player, player.combatPosition, elapsed, damage => this.town.damagePlayer(actor, damage, 'mount-impact'))
      }
    }
    this.town.careerMounts.update(dt)
  }
}
