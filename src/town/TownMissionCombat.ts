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

export interface TownCombatResident {
  spec: TownActorSpec
  npc: NPC
  homeMount?: Mount
  target?: THREE.Vector3
  cycle: number
  walkTime: number
}

interface MissionControllers {
  field: Pick<BanditMissionController, 'active' | 'fieldNpcs' | 'friendlies' | 'ambientBandits' | 'missionBandits' | 'combatPeersFor' | 'updateFlow' | 'updateDepartingCavalry' | 'departingNpcs' | 'cavalryMounts' | 'veteranEnemySquads' | 'markVeteranEnemySquadEngaged'>
  duel: Pick<CareerDuelController, 'active' | 'phase' | 'update' | 'isMissionActor' | 'fieldNpcs' | 'allMounts' | 'opponent' | 'combatEnabled' | 'persistRuntimeProgress'>
  defense: Pick<TownDefenseController, 'active' | 'phase' | 'assault' | 'updateFlow' | 'fieldNpcs' | 'peersFor' | 'updateCivilianOrder' | 'waitingEnemies' | 'enemyMounts'>
}

/** Live simulation inputs and the effects retained by TownScene. Built once, not once per frame. */
interface TownCombatScene {
  player(): Player
  residents: readonly TownCombatResident[]
  cameraPosition: THREE.Vector3
  obstacles: ObstacleData[]
  navigation: NavigationWorld
  hp: HpBar
  careerMounts: Pick<CareerMountController, 'activeMount' | 'update'>
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

  constructor(private readonly missions: MissionControllers, private readonly town: TownCombatScene) {}

  get enemyTownHostiles(): readonly NPC[] {
    const active = this.missions.field.active
    return active?.kind === 'veteran-field' && active.templateId === 'veteran-tragedy-of-the-scouts'
      ? this.enemyTownHostileActors
      : []
  }

  update(dt: number, cameraYaw: number, elapsed: number): void {
    this.town.navigation.sync(this.town.obstacles)
    this.town.navigation.beginFrame()
    if (this.missions.duel.active) this.updateDuel(dt, elapsed)
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

  /** Result/equipment panels pause combat, but must not freeze the defeated duelist's collapse. */
  updateDuelDefeatedActors(dt: number): void {
    const { duel } = this.missions
    if (!duel.active) return
    for (const actor of duel.fieldNpcs) if (actor.dead) this.updateDuelCorpse(actor, dt)
  }

  private updateDuelCorpse(actor: NPC, dt: number): void {
    actor.update(dt, this.town.player(), [], [], this.town.obstacles, this.town.hp, () => {}, () => {},
      false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
  }

  /** Also checks current positions because Player attacks precede threat assignment in a frame. */
  isExternalThreatDefender(ally: NPC): boolean {
    if (this.missions.field.active?.kind === 'veteran-field') return false
    if (this.externalThreatActors.has(ally)) return true
    const resident = this.town.residents.find(candidate => candidate.npc === ally)
    if (!resident || ally.dead || !this.isMilitary(resident.spec)) return false
    return [...this.missions.field.ambientBandits, ...this.missions.field.missionBandits]
      .some(bandit => !bandit.dead && bandit.combatPosition.distanceToSquared(ally.combatPosition) <= 20 * 20)
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
    field.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    const currentVeteran = veteranField ? field.active : undefined
    const veteranSurvival = currentVeteran?.templateId === 'veteran-tragedy-of-the-scouts'
    const player = this.town.player()
    if (veteranField && veteranSurvival) this.updateExternalThreatAssignments({ enemyTownScouts: field.friendlies, player })
    else if (veteranField) this.clearExternalThreatActors(veteranFriendlies!)
    else if (field.active?.kind !== 'cavalry-sweep') this.updateExternalThreatAssignments()
    const veteranMarching = veteranField && !veteranSurvival && currentVeteran?.phase === 'MARCHING'
    const veteranCombatActive = veteranField && (veteranSurvival || currentVeteran?.phase === 'ENGAGING')
    this.engagedVeteranEnemies.clear()
    const engagedVeteranSquads = new Set(currentVeteran?.engagedEnemySquadIds ?? [])
    const veteranHostileActors = veteranField ? new Set([...field.missionBandits, ...this.enemyTownHostileActors]) : null
    const veteranActors = veteranField ? [...new Set([...field.missionBandits, ...field.friendlies])] : null
    const veteranFriendlyPeers = veteranField ? [...field.friendlies, ...field.missionBandits, ...this.enemyTownHostileActors] : null
    const veteranEnemyPeers = veteranField ? [...field.missionBandits, ...field.friendlies, ...this.enemyTownHostileActors] : null
    const veteranMarchingPeers = veteranField ? [...field.friendlies] : null
    const missionActors = new Set(veteranActors ?? field.fieldNpcs)
    if (veteranField) for (const npc of this.enemyTownHostileActors) missionActors.add(npc)
    this.town.preparePeaceResidents?.(new Set([...missionActors, ...this.externalThreatActors]))
    for (const resident of this.town.residents) {
      if (!missionActors.has(resident.npc) && !this.externalThreatActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    }
    const actors = veteranField
      ? [...new Set([...field.missionBandits, ...field.friendlies, ...this.enemyTownHostileActors])]
      : [...new Set([...field.fieldNpcs, ...this.externalThreatActors])]
    this.grid.clear()
    if (veteranField) { this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear() }
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (veteranHostileActors?.has(actor)) this.defenseEnemyGrid.insert(actor)
      else if (veteranFriendlies?.has(actor)) this.defenseTownGrid.insert(actor)
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
          if (nearbyFriendly || playerNearby) {
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
    if (veteranField) for (const enemy of this.engagedVeteranEnemies) this.veteranEngagedEnemyGrid.insert(enemy)
    const veteranSquadCombatActive = veteranCombatActive || this.engagedVeteranEnemies.size > 0
    for (const actor of actors) {
      const actorIsVeteranHostile = veteranField && veteranHostileActors!.has(actor)
      const veteranFriendlyTravel = veteranField && !veteranSurvival && veteranFriendlies!.has(actor)
        && currentVeteran?.phase !== 'ENGAGING' && this.engagedVeteranEnemies.size === 0
      const veteranEnemyHeld = veteranField && !veteranSurvival && veteranHostileActors!.has(actor)
        && !this.engagedVeteranEnemies.has(actor)
      if (veteranEnemyHeld) {
        this.updateFieldActorPeacefully(actor, dt)
        continue
      }
      if (veteranFriendlyTravel) {
        this.updateFieldActorTravel(actor, dt)
        continue
      }
      const peers = veteranField
        ? veteranMarching && !veteranSurvival ? veteranMarchingPeers! : actorIsVeteranHostile ? veteranEnemyPeers! : veteranFriendlyPeers!
        : actor.faction === Faction.BANDIT
          ? [...new Set([...field.combatPeersFor(actor), ...this.externalThreatActors])]
          : this.externalThreatActors.has(actor)
            ? [...field.ambientBandits, ...field.missionBandits, ...this.externalThreatActors]
            : field.combatPeersFor(actor)
      const nearbyGrid = veteranField
        ? actorIsVeteranHostile ? this.defenseEnemyGrid : this.defenseTownGrid
        : this.grid
      const hostileGrid = veteranSquadCombatActive
        ? actorIsVeteranHostile
          ? this.defenseTownGrid
          : currentVeteran?.phase === 'ENGAGING' && !veteranSurvival
            ? this.defenseEnemyGrid
            : this.veteranEngagedEnemyGrid
        : null
      actor.update(dt, this.town.player(), peers, nearbyGrid.getNearbyInto(actor.combatPosition, 2, this.neighbors),
        this.town.obstacles, this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, hostileGrid, this.town.navigation)
    }
    const mount = player.currentMount
    const playerImpactTargets = veteranField ? [...field.missionBandits, ...this.enemyTownHostileActors] : [...field.ambientBandits, ...field.missionBandits]
    if ((!veteranField || veteranSquadCombatActive) && mount && mount === player.currentMount && !mount.dead) {
      for (const target of playerImpactTargets) {
        if (target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (veteranField && veteranSquadCombatActive) {
      for (const rider of actors) {
        const npcMount = rider.mount
        if (!npcMount || npcMount.dead || rider.dead) continue
        const riderIsEnemy = veteranHostileActors!.has(rider)
        if (!riderIsEnemy && !veteranFriendlies!.has(rider)) continue
        for (const target of this.grid.getNearbyInto(npcMount.group.position, 2.5, this.neighbors)) {
          const isHostileTarget = riderIsEnemy ? veteranFriendlies!.has(target) : veteranHostileActors!.has(target)
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

  private clearExternalThreatActors(missionFriendlies: ReadonlySet<NPC>): void {
    for (const actor of this.externalThreatActors) {
      if (!missionFriendlies.has(actor) && !actor.dead) actor.endExternalThreat()
    }
    this.externalThreatActors.clear()
    this.enemyTownHostileActors.length = 0
  }

  private updateDuel(dt: number, elapsed: number): void {
    const { duel } = this.missions
    const before = duel.phase
    duel.update(dt)
    if (before !== duel.phase && duel.phase === 'ENGAGING') this.town.clearCombatShots()
    this.town.preparePeaceResidents?.(new Set(this.town.residents.filter(r => duel.isMissionActor(r.npc)).map(r => r.npc)))
    for (const resident of this.town.residents) {
      if (!duel.isMissionActor(resident.npc)) this.town.peaceResident(resident, dt)
    }
    const actors = duel.fieldNpcs
    this.grid.clear(); for (const actor of actors) if (!actor.dead) this.grid.insert(actor)
    for (const actor of actors) {
      const distance = actor.group.position.distanceTo(this.town.cameraPosition)
      if (actor.dead) { this.updateDuelCorpse(actor, dt); continue }
      const combatant = actor === duel.opponent && duel.combatEnabled
      if (duel.phase === 'PREPARING' || duel.phase === 'RESULT' || duel.phase === 'ENGAGING' && !combatant) {
        if (actor.mount) { actor.mount.beginControlledFrame(); actor.mount.finishControlledFrame(dt, this.town.obstacles) }
        actor.updateTownPeace(dt, distance, false, false)
        continue
      }
      actor.update(dt, this.town.player(), [], this.grid.getNearbyInto(actor.combatPosition, 2, this.neighbors), this.town.obstacles, this.town.hp,
        (damage, isPlayer) => { if (isPlayer) this.town.damagePlayer(actor, damage, 'melee') },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, distance, null, null, this.town.navigation)
    }
    for (const mount of duel.allMounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.town.cameraPosition))
      if (mount.dead || !mount.riderNpc) mount.update(dt, this.town.obstacles)
    }
    const player = this.town.player(), opponent = duel.opponent, playerMount = player.currentMount
    if (opponent && duel.combatEnabled) {
      if (playerMount && !playerMount.dead && checkMountImpact(playerMount, opponent.combatPosition, .5)) {
        applyMountImpactDamage(playerMount, opponent, opponent.combatPosition, elapsed, damage => this.town.hitNpc(opponent, damage, 'mount-impact'))
      }
      const opponentMount = opponent.mount
      if (opponentMount && !opponentMount.dead && !player.dead && checkMountImpact(opponentMount, player.combatPosition, .6)) {
        applyMountImpactDamage(opponentMount, player, player.combatPosition, elapsed, damage => this.town.damagePlayer(opponent, damage, 'mount-impact'))
      }
    }
    this.town.careerMounts.update(dt)
    duel.persistRuntimeProgress()
  }

  private updateExternalThreatAssignments(options: { enemyTownScouts?: readonly NPC[]; player?: Player } = {}): void {
    const { field } = this.missions
    const enemyTownScouts = options.enemyTownScouts
    const threatActors = enemyTownScouts ?? [...field.ambientBandits, ...field.missionBandits].filter(npc => !npc.dead)
    this.banditThreatGrid.clear()
    for (const actor of threatActors) if (!actor.dead) this.banditThreatGrid.insert(actor)
    const missionFriendlies = new Set(field.friendlies)
    for (const resident of this.town.residents) {
      const { npc, spec } = resident
      const military = enemyTownScouts === undefined
        ? this.isMilitary(spec)
        : !isCivilian(spec.role) && spec.role !== 'cat'
      const eligible = military && !npc.dead && !missionFriendlies.has(npc)
        && (enemyTownScouts === undefined
          ? true
          : spec.id.startsWith('enemy-town:') && npc.faction === Faction.ENEMY)
      const nearbyMissionActor = eligible && this.banditThreatGrid.getNearbyInto(npc.combatPosition, 20, this.neighbors).length > 0
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
        if (npc.dead) continue
        npc.endExternalThreat()
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
    const actors = defense.fieldNpcs
    const missionActors = new Set(actors)
    this.town.preparePeaceResidents?.(missionActors)
    for (const resident of this.town.residents) if (!missionActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    this.grid.clear(); this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear()
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (actor.faction === Faction.ENEMY) this.defenseEnemyGrid.insert(actor)
      else this.defenseTownGrid.insert(actor)
    }
    const preparing = defense.phase === 'PREPARING'
    for (const actor of actors) {
      if (preparing && defense.assault && actor.townCategory !== 'civilian' && !actor.dead) {
        actor.updateTownPeace(dt, actor.group.position.distanceTo(this.town.cameraPosition), false, false)
        continue
      }
      defense.updateCivilianOrder(actor)
      const hostileGrid = actor.faction === Faction.ENEMY ? this.defenseTownGrid : this.defenseEnemyGrid
      actor.update(dt, this.town.player(), defense.peersFor(actor), this.grid.getNearbyInto(actor.combatPosition, 2, this.neighbors),
        this.town.obstacles, this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, hostileGrid, this.town.navigation)
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
        if (target.faction !== Faction.ENEMY || target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    if (!preparing) for (const actor of actors) {
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
