import * as THREE from 'three'
import type { BanditMissionController } from '../career/BanditMissionController'
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
import type { TownActorSpec } from './TownRules'
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
  field: Pick<BanditMissionController, 'active' | 'fieldNpcs' | 'friendlies' | 'ambientBandits' | 'missionBandits' | 'combatPeersFor' | 'updateFlow' | 'updateDepartingCavalry' | 'departingNpcs' | 'cavalryMounts'>
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

  constructor(private readonly missions: MissionControllers, private readonly town: TownCombatScene) {}

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

  /** Also checks current positions because Player attacks precede threat assignment in a frame. */
  isExternalThreatDefender(ally: NPC): boolean {
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
    field.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    if (field.active?.kind !== 'cavalry-sweep') this.updateExternalThreatAssignments()
    const missionActors = new Set(field.fieldNpcs)
    for (const resident of this.town.residents) {
      if (!missionActors.has(resident.npc) && !this.externalThreatActors.has(resident.npc)) this.town.peaceResident(resident, dt)
    }
    const actors = [...new Set([...field.fieldNpcs, ...this.externalThreatActors])]
    this.grid.clear(); for (const actor of actors) if (!actor.dead) this.grid.insert(actor)
    for (const actor of actors) {
      const peers = actor.faction === Faction.BANDIT
        ? [...new Set([...field.combatPeersFor(actor), ...this.externalThreatActors])]
        : this.externalThreatActors.has(actor)
          ? [...field.ambientBandits, ...field.missionBandits, ...this.externalThreatActors]
          : field.combatPeersFor(actor)
      actor.update(dt, this.town.player(), peers, this.grid.getNearbyInto(actor.combatPosition, 2, this.neighbors),
        this.town.obstacles, this.town.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.town.damagePlayer(actor, damage, 'melee')
          else if (targetNpc) this.town.hitNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.town.fireNpc(origin, direction, kind, actor),
        false, actor.group.position.distanceTo(this.town.cameraPosition), null, null, this.town.navigation)
    }
    const player = this.town.player(), mount = this.town.careerMounts.activeMount
    if (mount && mount === player.currentMount && !mount.dead) {
      for (const target of [...field.ambientBandits, ...field.missionBandits]) {
        if (target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact'))
      }
    }
    // Mounted field missions share normal impact damage, including during Observer.
    if (field.active?.kind === 'cavalry-sweep') for (const rider of field.friendlies) {
      const npcMount = rider.mount
      if (!npcMount || npcMount.dead || rider.dead) continue
      for (const target of this.grid.getNearby(npcMount.group.position, 2.5)) {
        if (target.faction !== Faction.BANDIT || target.dead || !checkMountImpact(npcMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(npcMount, target, target.combatPosition, elapsed, damage => this.town.hitNpc(target, damage, 'mount-impact', rider))
      }
    }
    this.town.careerMounts.update(dt)
  }

  private updateDuel(dt: number, elapsed: number): void {
    const { duel } = this.missions
    const before = duel.phase
    duel.update(dt)
    if (before !== duel.phase && duel.phase === 'ENGAGING') this.town.clearCombatShots()
    for (const resident of this.town.residents) {
      if (!duel.isMissionActor(resident.npc)) this.town.peaceResident(resident, dt)
    }
    const actors = duel.fieldNpcs
    this.grid.clear(); for (const actor of actors) if (!actor.dead) this.grid.insert(actor)
    for (const actor of actors) {
      const distance = actor.group.position.distanceTo(this.town.cameraPosition)
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

  private updateExternalThreatAssignments(): void {
    const { field } = this.missions
    const bandits = [...field.ambientBandits, ...field.missionBandits].filter(npc => !npc.dead)
    this.banditThreatGrid.clear()
    for (const bandit of bandits) this.banditThreatGrid.insert(bandit)
    const missionFriendlies = new Set(field.friendlies)
    for (const resident of this.town.residents) {
      const { npc, spec } = resident
      const threatened = this.isMilitary(spec) && !npc.dead && !missionFriendlies.has(npc)
        && this.banditThreatGrid.getNearby(npc.combatPosition, 20).length > 0
      if (threatened) {
        if (!this.externalThreatActors.has(npc)) npc.beginExternalThreat()
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
  }

  private isMilitary(spec: TownActorSpec): boolean { return spec.role.includes('_') || spec.role === 'captain' || spec.role === 'deployment' }

  private updateDefense(dt: number, cameraYaw: number, elapsed: number): void {
    const { defense } = this.missions
    defense.updateFlow(dt, cameraYaw)
    this.town.updateCommandCue()
    const actors = defense.fieldNpcs
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
    const player = this.town.player(), mount = this.town.careerMounts.activeMount
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
