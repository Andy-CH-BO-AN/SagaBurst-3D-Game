import * as THREE from 'three'
import { followLocalOffset, followSlotWorldPosition } from '../battle/FollowOrder'
import { FollowTrail } from '../battle/FollowTrail'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CareerProfile } from '../career/CareerProfile'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { Mount, MountType } from '../world/Mount'
import { AIType, Faction, NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import type { ObstacleData } from '../world/Terrain'
import { townWartimeHostile } from './TownWartime'
import {
  OUTSKIRTS_ALERT_RANGE, OUTSKIRTS_CAVALRY_SPEED, OUTSKIRTS_ENCOUNTER_LEASH,
  OUTSKIRTS_FOOT_SPEED, OUTSKIRTS_SENSOR_INTERVAL, outskirtsActorId, outskirtsCavalryFaction,
  outskirtsEnabled, outskirtsSquadSpecs, type OutskirtsSquadSpec,
} from './TownOutskirtsRules'

export type OutskirtsSquadState = 'PATROLLING' | 'ENGAGING' | 'REGROUPING' | 'ENTERING'
export interface OutskirtsSquad {
  readonly id: string
  readonly spec: OutskirtsSquadSpec
  readonly route: THREE.Vector3[]
  members: NPC[]
  leader: NPC | null
  state: OutskirtsSquadState
  waypoint: number
  generation: number
  engagementOrigin: THREE.Vector3 | null
  readonly trail: FollowTrail
  sensorRemaining: number
  commandedWaypoint: THREE.Vector3 | null
}
export interface OutskirtsFactories {
  createNpc(spec: NpcSpawnSpec): NPC
  createMount(x: number, z: number): Mount
}

const TRAVEL_COMMAND = -5
const BANDIT_LOADOUT = { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null } as const

/** Runtime-only warfare. Mission identity, persistence, rewards and Town Patrol ownership stay elsewhere. */
export class TownOutskirtsWarfareController {
  readonly squads: OutskirtsSquad[] = []
  private readonly allActors: NPC[] = []
  private readonly allMounts: Mount[] = []
  private readonly squadForActor = new Map<NPC, OutskirtsSquad>()
  private readonly grid = new SpatialGrid<NPC>(16)
  private readonly nearby: NPC[] = []
  private readonly anchor = { position: new THREE.Vector3(), yaw: 0 }
  private enabled = false

  constructor(
    private readonly scene: THREE.Scene,
    private readonly townFaction: CharacterFaction,
    private readonly readProfile: () => Pick<CareerProfile, 'rank' | 'faction'>,
    private readonly obstacles: ObstacleData[],
    private readonly navigation: NavigationWorld,
    private readonly factories?: OutskirtsFactories,
  ) {
    this.synchronizeRank()
  }

  /** Old-wave corpses stay through their normal death presentation; every horse retains normal Mount behavior. */
  get actors(): readonly NPC[] { return this.allActors }
  get mounts(): readonly Mount[] { return this.allMounts }
  owns(npc: NPC): boolean { return this.squadForActor.has(npc) }
  combatEnabled(npc: NPC): boolean {
    const squad = this.squadForActor.get(npc)
    return Boolean(squad && (npc.dead || squad.state === 'ENGAGING'))
  }

  synchronizeRank(): void {
    const enabled = outskirtsEnabled(this.readProfile())
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) { this.clearEntities(); return }
    for (const [index, spec] of outskirtsSquadSpecs().entries()) {
      const route = spec.route.map(point => this.safePoint(point, spec.kind === 'cavalry' ? 1.3 : .65))
      const squad: OutskirtsSquad = { id: spec.id, spec, route, members: [], leader: null,
        state: 'PATROLLING', waypoint: spec.phase % route.length, generation: 0, engagementOrigin: null,
        trail: new FollowTrail(), sensorRemaining: index * OUTSKIRTS_SENSOR_INTERVAL / 9, commandedWaypoint: null }
      this.squads.push(squad)
      this.spawnSquad(squad, false)
    }
  }

  /** One frame owns sensors and squad orders only. The scene owns actor/mount updates and navigation budget. */
  prepareFrame(dt: number, participants: readonly NPC[], player: Player): void {
    if (!this.enabled) return
    for (const squad of this.squads) {
      if (squad.members.every(member => member.dead)) {
        squad.generation++
        this.spawnSquad(squad, true)
      }
      if (!squad.leader || squad.leader.dead) {
        squad.leader = squad.members.find(member => !member.dead) ?? null
        squad.commandedWaypoint = null
        if (squad.leader) squad.trail.rebase(squad.leader.combatPosition, squad.leader.group.rotation.y)
      }
    }
    this.pruneRetiredActors()
    this.grid.clear()
    for (const actor of participants) if (!actor.dead && !this.owns(actor)) this.grid.insert(actor)
    // Include newly reinforced members even if the caller built its participant list before this frame.
    for (const actor of this.allActors) if (!actor.dead) this.grid.insert(actor)
    for (const squad of this.squads) {
      squad.sensorRemaining -= Math.max(0, dt)
      const sense = squad.sensorRemaining <= 0
      if (sense) squad.sensorRemaining = OUTSKIRTS_SENSOR_INTERVAL
      if (squad.state === 'ENGAGING') this.updateEngagement(squad, player, sense)
      else {
        if (sense && this.hasNearbyHostile(squad, player, OUTSKIRTS_ALERT_RANGE)) this.alertSquad(squad, false)
        if (squad.leader && !this.combatEnabled(squad.leader)) this.updateTravelState(squad)
      }
    }
  }

  /** Effective hit callbacks wake the whole squad; allied cavalry keeps mission-friendly Player protection. */
  noteHit(target: NPC, playerSource: boolean): void {
    const squad = this.squadForActor.get(target)
    if (!squad || !squad.members.includes(target)) return
    if (playerSource && target.faction === Faction.TOWN) return
    this.alertSquad(squad, playerSource)
  }

  updateTravel(npc: NPC, dt: number, cameraPosition: THREE.Vector3): void {
    const squad = this.squadForActor.get(npc), leader = squad?.leader
    if (!squad || !leader || npc.dead || squad.state === 'ENGAGING') return
    const speed = leader.isMounted ? OUTSKIRTS_CAVALRY_SPEED : OUTSKIRTS_FOOT_SPEED
    const isLeader = npc === leader
    if (isLeader) {
      const goal = squad.route[squad.waypoint]
      if (squad.commandedWaypoint !== goal || npc.formationCommandId !== TRAVEL_COMMAND) {
        npc.assignFormationTarget(TRAVEL_COMMAND, goal, goal.clone().sub(npc.combatPosition).setY(0).normalize(), speed)
        squad.commandedWaypoint = goal
      }
    } else {
      const slot = squad.members.filter(member => !member.dead && member !== leader).indexOf(npc)
      const offset = followLocalOffset(slot, npc.isMounted)
      squad.trail.sample(-offset.z, this.anchor)
      if (npc.activeFollowTarget !== leader || npc.activeFollowSlotIndex !== slot || npc.formationCommandId !== -1) {
        npc.assignFollowTarget(leader, slot, new THREE.Vector3(offset.x, 0, 0), speed, this.anchor)
      }
    }
    npc.updateTownTravel(dt, npc.combatPosition.distanceTo(cameraPosition),
      this.grid.getNearbyInto(npc.combatPosition, 4, this.nearby), this.obstacles, this.navigation, isLeader ? undefined : this.anchor)
    if (isLeader) squad.trail.record(npc.combatPosition)
  }

  dispose(): void { this.enabled = false; this.clearEntities() }

  private updateTravelState(squad: OutskirtsSquad): void {
    const leader = squad.leader
    if (!leader || this.distance(leader.combatPosition, squad.route[squad.waypoint]) >= 1.8) return
    if (squad.state === 'ENTERING') { squad.state = 'REGROUPING'; squad.commandedWaypoint = null }
    if (squad.state === 'REGROUPING') {
      const radius = squad.spec.kind === 'cavalry' ? 27 : 13
      if (squad.members.some(member => !member.dead && this.distance(member.combatPosition, leader.combatPosition) > radius)) return
      squad.state = 'PATROLLING'
      squad.engagementOrigin = null
    }
    squad.waypoint = (squad.waypoint + 1) % squad.route.length
    squad.commandedWaypoint = null
  }

  private updateEngagement(squad: OutskirtsSquad, player: Player, sense: boolean): void {
    const living = squad.members.filter(member => !member.dead)
    const provoked = living.some(member => member.encounterAggroState === 'provoked')
    const returning = living.some(member => member.encounterAggroState === 'returning')
    // A provoke cancels returning just as it does for existing camp Bandits. Never replace that with a retreat lock.
    if (provoked) return
    if (returning || sense && !this.hasNearbyHostile(squad, player, OUTSKIRTS_ENCOUNTER_LEASH, squad.engagementOrigin)) {
      for (const member of living) if (member.encounterAggroState !== 'returning') member.returnFromEncounter()
    }
    const allIdle = living.every(member => member.encounterAggroState === 'idle')
    // Wide cavalry columns need room around their shared encounter origin, rather than all occupying one point.
    const gathered = squad.engagementOrigin && living.every(member =>
      this.distance(member.combatPosition, squad.engagementOrigin!) <= (squad.spec.kind === 'cavalry' ? 12 : 7))
    if (!allIdle && !(gathered && living.every(member => member.encounterAggroState === 'returning'))) return
    for (const member of living) member.configureBanditEncounter(member.combatPosition, [member.combatPosition], OUTSKIRTS_ENCOUNTER_LEASH)
    squad.state = 'REGROUPING'
    squad.waypoint = this.nearestWaypoint(squad, squad.leader!.combatPosition)
    squad.commandedWaypoint = null
    squad.trail.rebase(squad.leader!.combatPosition, squad.leader!.group.rotation.y)
  }

  private hasNearbyHostile(squad: OutskirtsSquad, player: Player, range: number, origin?: THREE.Vector3 | null): boolean {
    for (const observer of squad.members) {
      if (observer.dead) continue
      const position = origin ?? observer.combatPosition
      if ((observer.faction === Faction.ENEMY || observer.faction === Faction.BANDIT)
        && player.targetable && !player.dead && this.distance(position, player.combatPosition) <= range) return true
      for (const target of this.grid.getNearbyInto(position, range, this.nearby)) {
        if (target !== observer && !target.dead && townWartimeHostile(observer, target)) return true
      }
      if (origin) break
    }
    return false
  }

  private alertSquad(squad: OutskirtsSquad, provoked: boolean): void {
    const living = squad.members.filter(member => !member.dead)
    if (!living.length) return
    const returning = living.some(member => member.encounterAggroState === 'returning')
    if (!provoked && returning) return
    if (squad.state !== 'ENGAGING') {
      squad.engagementOrigin = (squad.leader?.dead ? living[0] : squad.leader ?? living[0]).combatPosition.clone()
      for (const member of living) member.configureBanditEncounter(squad.engagementOrigin, [member.combatPosition], OUTSKIRTS_ENCOUNTER_LEASH)
      squad.state = 'ENGAGING'
      squad.commandedWaypoint = null
    }
    for (const member of living) {
      if (provoked) member.provokeEncounter()
      else member.triggerEncounterAlert()
    }
  }

  private spawnSquad(squad: OutskirtsSquad, edge: boolean): void {
    const army = outskirtsCavalryFaction(this.townFaction, this.readProfile().faction)
    const cavalry = squad.spec.kind === 'cavalry'
    const goal = squad.route[squad.waypoint]
    const origin = edge ? squad.spec.edge : goal
    const next = edge ? goal : squad.route[(squad.waypoint + 1) % squad.route.length]
    const yaw = Math.atan2(next.x - origin.x, next.z - origin.z)
    const occupied: THREE.Vector3[] = []
    squad.members = []
    for (let index = 0; index < squad.spec.size; index++) {
      const nominal = edge ? this.edgeSlot(squad.spec.edge, index, cavalry)
        : index ? followSlotWorldPosition(origin, yaw, followLocalOffset(index - 1, cavalry)) : origin.clone()
      const point = edge ? this.safeEdgePoint(nominal, cavalry ? 1.3 : .65, occupied)
        : this.safePoint(nominal, cavalry ? 1.3 : .65, occupied)
      occupied.push(point)
      const actorId = outskirtsActorId(squad.id, index, squad.generation)
      const spec: NpcSpawnSpec = { actorId, x: point.x, z: point.z,
        faction: cavalry ? army.faction : Faction.BANDIT, characterFaction: cavalry ? army.characterFaction : 'viking',
        aiType: AIType.MELEE, name: cavalry ? army.characterFaction === 'roman' ? 'Sword Cavalry' : 'Axe Cavalry' : 'Bandit',
        tier: cavalry ? 2 : 1, cavalry, respawnEnabled: false,
        loadout: cavalry ? army.loadout : BANDIT_LOADOUT, presetId: cavalry ? army.presetId : undefined }
      const npc = this.factories?.createNpc(spec) ?? new NPC(this.scene, point.x, point.z, spec.faction,
        spec.characterFaction, spec.aiType, spec.name, spec.tier, cavalry, spec.loadout, spec.presetId,
        undefined, actorId)
      npc.respawnEnabled = false
      npc.group.rotation.y = yaw
      if (cavalry) {
        const mount = this.factories?.createMount(point.x, point.z) ?? new Mount(this.scene, MountType.HORSE, point.x, point.z)
        mount.group.rotation.y = yaw
        npc.mountVehicle(mount)
        this.allMounts.push(mount)
      }
      npc.configureBanditEncounter(npc.combatPosition, [npc.combatPosition], OUTSKIRTS_ENCOUNTER_LEASH)
      this.allActors.push(npc)
      this.squadForActor.set(npc, squad)
      squad.members.push(npc)
    }
    squad.leader = squad.members[0]
    squad.state = edge ? 'ENTERING' : 'PATROLLING'
    squad.engagementOrigin = null
    squad.commandedWaypoint = null
    squad.trail.reset(squad.leader.combatPosition, yaw)
  }

  private nearestWaypoint(squad: OutskirtsSquad, position: THREE.Vector3): number {
    let nearest = 0, distance = Infinity
    for (const [index, point] of squad.route.entries()) {
      const d = this.distance(position, point)
      if (d < distance) { distance = d; nearest = index }
    }
    return nearest
  }

  private edgeSlot(edge: THREE.Vector3, index: number, cavalry: boolean): THREE.Vector3 {
    const point = edge.clone(), spacing = cavalry ? 4.4 : 2.8
    const lateral = (Math.floor(index / 3) - (cavalry ? 1.5 : .5)) * spacing
    if (Math.abs(edge.x) > 330) { point.x -= Math.sign(edge.x) * (index % 3) * 2; point.z += lateral }
    else { point.z -= Math.sign(edge.z) * (index % 3) * 2; point.x += lateral }
    return point
  }

  private safeEdgePoint(point: THREE.Vector3, radius: number, occupied: readonly THREE.Vector3[]): THREE.Vector3 {
    const xEdge = Math.abs(point.x) > 330
    for (let index = 0; index < 81; index++) {
      const offset = index ? Math.ceil(index / 2) * 2 * (index % 2 ? 1 : -1) : 0
      const candidate = point.clone()
      if (xEdge) candidate.z += offset
      else candidate.x += offset
      if (this.clearPoint(candidate, radius, occupied)) return candidate
    }
    return this.safePoint(point, radius, occupied)
  }

  private safePoint(point: THREE.Vector3, radius: number, occupied: readonly THREE.Vector3[] = []): THREE.Vector3 {
    if (this.clearPoint(point, radius, occupied)) return point.clone()
    for (let ring = 1; ring <= 16; ring++) for (let side = 0; side < 16; side++) {
      const angle = side * Math.PI / 8, candidate = point.clone().add(new THREE.Vector3(Math.sin(angle) * ring * 2, 0, Math.cos(angle) * ring * 2))
      if (this.clearPoint(candidate, radius, occupied)) return candidate
    }
    const cell = this.navigation.grid.findNearestWalkableCell(point, 20)
    return cell ? this.navigation.grid.cellToWorld(cell) : point.clone()
  }

  private clearPoint(point: THREE.Vector3, radius: number, occupied: readonly THREE.Vector3[]): boolean {
    if (Math.abs(point.x) > 345 || Math.abs(point.z) > 345) return false
    const cell = this.navigation.grid.worldToCell(point)
    if (!cell || this.navigation.grid.isBlocked(cell)) return false
    if (occupied.some(other => this.distance(point, other) < radius * 2 + .15)) return false
    for (const obstacle of this.obstacles) {
      const box = obstacle.navigationBox ?? obstacle.box
      const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x)
      const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z)
      if (dx * dx + dz * dz < radius * radius) return false
    }
    return true
  }

  private clearEntities(): void {
    for (const npc of this.allActors) npc.dispose()
    for (const mount of this.allMounts) mount.dispose()
    this.allActors.length = 0; this.allMounts.length = 0; this.squads.length = 0
    this.squadForActor.clear(); this.grid.clear()
  }

  private pruneRetiredActors(): void {
    for (let index = this.allActors.length - 1; index >= 0; index--) {
      const npc = this.allActors[index], squad = this.squadForActor.get(npc)
      // Current rosters retain casualties until the whole squad is wiped and replaced.
      if (!npc.dead || !npc.deathPresentationComplete || squad?.members.includes(npc)) continue
      this.allActors.splice(index, 1)
      this.squadForActor.delete(npc)
      npc.dispose()
    }
  }

  private distance(a: THREE.Vector3, b: THREE.Vector3): number { return Math.hypot(a.x - b.x, a.z - b.z) }
}
