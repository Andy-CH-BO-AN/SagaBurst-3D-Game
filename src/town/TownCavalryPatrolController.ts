import * as THREE from 'three'
import { followLocalOffset } from '../battle/FollowOrder'
import { FollowTrail } from '../battle/FollowTrail'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import type { ObstacleData } from '../world/Terrain'
import { townPatrolRefitPoint, type TownActorSpec, type TownPatrolId } from './TownRules'
import { townPatrolDeparture, townPatrolRoute, TOWN_PATROL_SPEED } from './TownPatrolRoute'
import { OUTSKIRTS_ALERT_RANGE, OUTSKIRTS_ENCOUNTER_LEASH, OUTSKIRTS_SENSOR_INTERVAL } from './TownOutskirtsRules'
import { townWartimeHostile } from './TownWartime'

interface PatrolResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
export type TownPatrolState = 'BARRACKS' | 'MOVING_TO_ROUTE' | 'PATROLLING' | 'PAUSED' | 'ENGAGING' | 'RETURN_TO_BARRACKS'
export type TownPatrolReturnState = 'RETURN_TO_BARRACKS' | 'REFIT' | 'REJOIN_PATROL'
interface PatrolReturn {
  state: TownPatrolReturnState
  destination: THREE.Vector3
  yaw: number
  commandedMounted: boolean | null
}
const RETURN_COMMAND_ID = -4
const FOOT_RETURN_SPEED = 2.2
interface PatrolSquad {
  id: TownPatrolId
  members: PatrolResident[]
  followers: PatrolResident[]
  canonicalLeaderActorId: string
  activeLeaderActorId: string | null
  state: TownPatrolState
  waypoint: number
  departureIndex: number
  departure: ReturnType<typeof townPatrolDeparture>
  trail: FollowTrail
  commandedWaypoint: THREE.Vector3 | null
  engagementOrigin: THREE.Vector3 | null
  participants: Set<string>
  threats: Set<NPC>
  sensorRemaining: number
}

interface PatrolThreatRuntime {
  owns(npc: NPC): boolean
  squadMembersFor?(npc: NPC): readonly NPC[]
}

/** Owns Patrol travel, squad encounters and the shared physical mission/combat refit lifecycle. */
export class TownCavalryPatrolController {
  readonly route = townPatrolRoute()
  readonly squads: PatrolSquad[]
  private readonly residents = new Map<string, PatrolResident>()
  private readonly relinquished = new Set<string>()
  private readonly returning = new Map<string, PatrolReturn>()
  private readonly available = new Set<string>()
  private excluded: ReadonlySet<NPC> = new Set()
  private readonly grid = new SpatialGrid<NPC>(8)
  private readonly nearby: NPC[] = []
  private readonly threatsNearby: NPC[] = []
  private readonly sensorCenter = new THREE.Vector3()
  private readonly anchor = { position: new THREE.Vector3(), yaw: 0 }
  private hostile = false
  private siegeOwned = false

  /** Siege owns recall travel and casualties, even for actors currently fighting or refitting. */
  recallForSiege(): void {
    this.siegeOwned = true
    this.returning.clear(); this.available.clear()
    for (const squad of this.squads) {
      squad.participants.clear(); squad.threats.clear(); squad.engagementOrigin = null
    }
    for (const resident of this.residents.values()) {
      this.relinquished.add(resident.spec.id)
      resident.npc.clearEncounter()
    }
  }

  releaseSiegeOwnership(): void {
    this.siegeOwned = false
    this.relinquished.clear()
    for (const squad of this.squads) { squad.state = 'BARRACKS'; squad.activeLeaderActorId = null; squad.commandedWaypoint = null }
  }

  constructor(residents: readonly PatrolResident[]) {
    this.squads = (['A', 'B'] as const).flatMap(id => {
      const members = residents.filter(r => r.spec.duty === 'patrol' && r.spec.patrolId === id)
      const captain = members.find(r => r.spec.patrolLeader)
      if (!captain) return []
      for (const r of members) this.residents.set(r.spec.id, r)
      const departure = townPatrolDeparture(id, this.route), trail = new FollowTrail()
      trail.reset(captain.npc.combatPosition, captain.npc.group.rotation.y)
      return [{ id, members, followers: [], canonicalLeaderActorId: captain.spec.id, activeLeaderActorId: null,
        state: 'BARRACKS' as TownPatrolState, waypoint: departure.phase, departureIndex: 0, departure, trail, commandedWaypoint: null,
        engagementOrigin: null, participants: new Set<string>(), threats: new Set<NPC>(), sensorRemaining: id === 'A' ? 0 : OUTSKIRTS_SENSOR_INTERVAL / 2 }]
    })
  }

  /** Call before the borrower issues any movement orders. The borrower owns travel to muster too. */
  relinquish(actorId: string): boolean {
    const resident = this.residents.get(actorId)
    if (!resident || this.relinquished.has(actorId) || !this.isReserveAvailable(actorId)) return false
    this.returning.delete(actorId)
    this.relinquished.add(actorId); this.available.delete(actorId)
    const squad = this.squads.find(s => s.activeLeaderActorId === actorId)
    if (squad) squad.activeLeaderActorId = null
    if (!this.hostile) resident.npc.setTacticalOrder('attack')
    return true
  }

  /** Release never changes position, equipment or permanent membership. Dead/unmounted actors stay unavailable. */
  reclaim(actorId: string): boolean {
    if (!this.residents.has(actorId)) return false
    return this.relinquished.delete(actorId)
  }

  /** Refit actors can be borrowed again while still catching up with their squad. */
  isReserveAvailable(actorId: string): boolean {
    if (!this.residents.has(actorId)) return true
    return !this.hostile && !this.relinquished.has(actorId) && !this.combatEnabled(this.residents.get(actorId)!.npc)
      && this.returning.get(actorId)?.state !== 'RETURN_TO_BARRACKS'
      && this.returning.get(actorId)?.state !== 'REFIT'
  }

  returnStateFor(actorId: string): TownPatrolReturnState | null { return this.returning.get(actorId)?.state ?? null }

  owns(npc: NPC): boolean {
    return !this.siegeOwned && !this.hostile && this.residents.get(npc.combatantId)?.npc === npc
      && !this.relinquished.has(npc.combatantId) && !this.excluded.has(npc)
  }

  combatEnabled(npc: NPC): boolean {
    return this.owns(npc) && this.squads.some(s => s.state === 'ENGAGING' && s.participants.has(npc.combatantId))
  }

  get combatActors(): NPC[] {
    return this.squads.flatMap(s => s.state === 'ENGAGING'
      ? s.members.filter(r => s.participants.has(r.spec.id) && this.owns(r.npc)).map(r => r.npc) : [])
  }

  /** Accepted mission or roaming contacts include lethal rider/mount hits and shield blocks. */
  noteHostileHit(target: NPC, source: NPC): boolean {
    if (!this.owns(target) || !townWartimeHostile(target, source) || this.returning.get(target.combatantId)?.state === 'REFIT') return false
    const squad = this.squads.find(s => s.id === this.residents.get(target.combatantId)!.spec.patrolId)!
    this.alertSquad(squad, target.combatPosition, true)
    // A lethal hit still belongs to this encounter and must be restored only after its end.
    squad.participants.add(target.combatantId)
    squad.threats.add(source)
    return true
  }

  /** One throttled broad-phase query per squad across actual mission and roaming participants. */
  prepareCombatFrame(dt: number, threatGrid: SpatialGrid<NPC>, threats: PatrolThreatRuntime): void {
    if (this.hostile || this.siegeOwned) return
    for (const squad of this.squads) {
      squad.sensorRemaining -= Math.max(0, dt)
      if (squad.state === 'ENGAGING' && !squad.members.some(r => squad.participants.has(r.spec.id) && this.owns(r.npc) && !r.npc.dead)) {
        this.finishEngagement(squad)
        continue
      }
      if (squad.sensorRemaining > 0) continue
      squad.sensorRemaining = OUTSKIRTS_SENSOR_INTERVAL
      const observers = squad.members.filter(r => this.owns(r.npc) && !r.npc.dead
        && this.returning.get(r.spec.id)?.state !== 'REFIT'
        && (squad.state === 'ENGAGING' ? squad.participants.has(r.spec.id) : this.returning.get(r.spec.id)?.state !== 'RETURN_TO_BARRACKS'))
      if (!observers.length) continue
      const origin = squad.engagementOrigin
      let range = OUTSKIRTS_ENCOUNTER_LEASH
      if (origin) this.sensorCenter.copy(origin)
      else {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (const { npc } of observers) {
          const p = npc.combatPosition
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
        }
        this.sensorCenter.set((minX + maxX) / 2, observers[0].npc.combatPosition.y, (minZ + maxZ) / 2)
        range = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2) + OUTSKIRTS_ALERT_RANGE
      }
      for (const threat of threatGrid.getNearbyInto(this.sensorCenter, range, this.threatsNearby)) {
        if (threat.dead || threat.encounterAggroState === 'returning' || !threats.owns(threat)) continue
        const observer = observers.find(r => townWartimeHostile(r.npc, threat)
          && this.distance(r.npc.combatPosition, threat.combatPosition) <= OUTSKIRTS_ALERT_RANGE)
        if (!observer) continue
        if (squad.state !== 'ENGAGING') {
          this.alertSquad(squad, observer.npc.combatPosition, false)
        }
        for (const member of threats.squadMembersFor?.(threat) ?? [threat]) squad.threats.add(member)
      }
      if (squad.state !== 'ENGAGING') continue
      // Hit events can precede a sensor tick; expand their actual hostile squad here too.
      for (const threat of [...squad.threats]) {
        for (const member of threats.squadMembersFor?.(threat) ?? []) squad.threats.add(member)
      }
      for (const threat of squad.threats) {
        if (threat.dead || !threats.owns(threat) || threat.encounterAggroState === 'returning'
          || this.distance(threat.combatPosition, squad.engagementOrigin!) > OUTSKIRTS_ENCOUNTER_LEASH) squad.threats.delete(threat)
      }
      if (!squad.threats.size) this.finishEngagement(squad)
    }
  }

  /** Living casualties retain their mission position and readiness until they physically reach barracks. */
  beginMissionReturn(actorId: string): boolean {
    if (this.returning.has(actorId)) return true
    return this.beginPatrolReturn(actorId)
  }

  beginPatrolReturn(actorId: string): boolean {
    const resident = this.residents.get(actorId)
    if (!resident?.homeMount || this.hostile) return false
    this.relinquished.delete(actorId)
    this.available.delete(actorId)
    const refitPoint = townPatrolRefitPoint(resident.spec)
    const destination = new THREE.Vector3(refitPoint.x, 0, refitPoint.z)
    const returning: PatrolReturn = this.returning.get(actorId)
      ?? { state: 'RETURN_TO_BARRACKS', destination, yaw: refitPoint.yaw, commandedMounted: null }
    returning.state = 'RETURN_TO_BARRACKS'; returning.commandedMounted = null
    this.returning.set(actorId, returning)
    resident.npc.clearEncounter()
    resident.npc.setTownPeaceful()
    resident.npc.setTacticalOrder('attack')
    if (resident.npc.dead) this.refit(resident, returning)
    return true
  }

  stopForHostility(): void {
    if (this.hostile) return
    this.hostile = true
    this.returning.clear()
    for (const squad of this.squads) { squad.participants.clear(); squad.threats.clear(); squad.engagementOrigin = null }
    for (const r of this.residents.values()) { r.npc.clearEncounter(); r.npc.setTacticalOrder('attack') }
    this.available.clear()
  }

  /** Mission simulation supplies its actual actor set, never an Active Mission boolean. */
  beginFrame(excluded: ReadonlySet<NPC>): void {
    this.excluded = excluded
    this.available.clear(); this.grid.clear()
    if (this.hostile) return
    for (const [id, r] of this.residents) {
      if (!this.relinquished.has(id) && !excluded.has(r.npc) && !r.npc.dead) {
        this.grid.insert(r.npc)
        if (this.returning.get(id)?.state !== 'RETURN_TO_BARRACKS' && r.npc.mount && !r.npc.mount.dead && r.npc.mount.riderNpc === r.npc) this.available.add(id)
      }
    }
    for (const squad of this.squads) {
      const leadEligible = (r: PatrolResident) => this.owns(r.npc) && !r.npc.dead
        && (this.available.has(r.spec.id) || this.combatEnabled(r.npc)
          || r.spec.id === squad.activeLeaderActorId && this.returning.get(r.spec.id)?.state === 'RETURN_TO_BARRACKS')
      let leader = squad.members.find(r => r.spec.id === squad.activeLeaderActorId && leadEligible(r))
      const captain = squad.members.find(r => r.spec.id === squad.canonicalLeaderActorId && leadEligible(r))
      if (!leader) {
        const deputy = squad.members.find(r => r !== captain && leadEligible(r) && this.returning.get(r.spec.id)?.state !== 'REJOIN_PATROL')
          ?? squad.members.find(r => r !== captain && leadEligible(r))
        const captainCatchingUp = captain && this.returning.get(captain.spec.id)?.state === 'REJOIN_PATROL'
        leader = captainCatchingUp && deputy && this.distance(captain.npc.combatPosition, deputy.npc.combatPosition) >= 9
          ? deputy : captain ?? deputy
      }
      else if (captain && captain !== leader && this.distance(captain.npc.combatPosition, leader.npc.combatPosition) < 9) leader = captain
      if (!leader) { squad.activeLeaderActorId = null; if (squad.state !== 'ENGAGING') squad.state = 'PAUSED'; continue }
      if (squad.activeLeaderActorId !== leader.spec.id) {
        squad.activeLeaderActorId = leader.spec.id
        squad.commandedWaypoint = null
        squad.trail.rebase(leader.npc.combatPosition, leader.npc.group.rotation.y)
      }
      squad.followers = squad.members.filter(r => this.available.has(r.spec.id) && r !== leader)
      // Return the canonical Captain to the first row for a nearby leadership handover.
      squad.followers.sort((a, b) => Number(Boolean(b.spec.patrolLeader)) - Number(Boolean(a.spec.patrolLeader)))
      if (squad.state === 'PAUSED' || squad.state === 'RETURN_TO_BARRACKS' && this.returning.get(leader.spec.id)?.state !== 'RETURN_TO_BARRACKS') {
        squad.state = squad.departureIndex < squad.departure.waypoints.length ? 'MOVING_TO_ROUTE' : 'PATROLLING'
      }
    }
  }

  updateResident(resident: PatrolResident, dt: number, camera: THREE.Vector3, obstacles: ObstacleData[], navigation: NavigationWorld): boolean {
    if (!this.residents.has(resident.spec.id)) return false
    if (this.combatEnabled(resident.npc)) return true
    const returning = this.returning.get(resident.spec.id)
    if (returning?.state === 'RETURN_TO_BARRACKS') {
      const npc = resident.npc
      if (npc.dead) this.refit(resident, returning)
      else {
        if (returning.commandedMounted !== npc.isMounted || npc.formationCommandId !== RETURN_COMMAND_ID) {
          npc.assignFormationTarget(RETURN_COMMAND_ID, returning.destination,
            returning.destination.clone().sub(npc.combatPosition).setY(0).normalize(), npc.isMounted ? TOWN_PATROL_SPEED : FOOT_RETURN_SPEED)
          returning.commandedMounted = npc.isMounted
        }
        npc.updateTownTravel(dt, npc.combatPosition.distanceTo(camera), this.grid.getNearbyInto(npc.combatPosition, 4, this.nearby), obstacles, navigation)
        if (npc.isFormationTargetReached(RETURN_COMMAND_ID)) this.refit(resident, returning)
      }
      return true
    }
    if (!this.available.has(resident.spec.id)) {
      // Relinquished actors are entirely the borrower's responsibility, even if no mission is active yet.
      return true
    }
    const squad = this.squads.find(s => s.id === resident.spec.patrolId)!
    const leader = this.residents.get(squad.activeLeaderActorId!)?.npc
    if (!leader) return true
    const npc = resident.npc, isLeader = npc === leader
    if (isLeader) {
      if (squad.state === 'BARRACKS') squad.state = 'MOVING_TO_ROUTE'
      let goal = squad.state === 'MOVING_TO_ROUTE' ? squad.departure.waypoints[squad.departureIndex] : this.route[squad.waypoint]
      if (this.distance(npc.combatPosition, goal) < 1.8) {
        if (squad.state === 'MOVING_TO_ROUTE') {
          squad.departureIndex++
          if (squad.departureIndex === squad.departure.waypoints.length) {
            squad.state = 'PATROLLING'; squad.waypoint = (squad.waypoint + 1) % this.route.length
          }
        } else squad.waypoint = (squad.waypoint + 1) % this.route.length
        goal = squad.state === 'MOVING_TO_ROUTE' ? squad.departure.waypoints[squad.departureIndex] : this.route[squad.waypoint]
      }
      if (squad.commandedWaypoint !== goal || npc.formationCommandId !== -3) {
        npc.assignFormationTarget(-3, goal, goal.clone().sub(npc.combatPosition).setY(0).normalize(), TOWN_PATROL_SPEED)
        squad.commandedWaypoint = goal
      }
    } else {
      const slot = squad.followers.indexOf(resident), offset = followLocalOffset(slot, true)
      squad.trail.sample(-offset.z, this.anchor)
      if (npc.activeFollowTarget !== leader || npc.activeFollowSlotIndex !== slot) npc.assignFollowTarget(leader, slot, new THREE.Vector3(offset.x, 0, 0), TOWN_PATROL_SPEED, this.anchor)
    }
    npc.updateTownTravel(dt, npc.combatPosition.distanceTo(camera), this.grid.getNearbyInto(npc.combatPosition, 4, this.nearby), obstacles, navigation, isLeader ? undefined : this.anchor)
    if (isLeader) squad.trail.record(npc.combatPosition)
    const rejoined = isLeader || (resident.spec.patrolLeader
      ? this.distance(npc.combatPosition, leader.combatPosition) < 9
      : npc.isFormationTargetReached(-1))
    if (returning?.state === 'REJOIN_PATROL' && rejoined) this.returning.delete(resident.spec.id)
    return true
  }

  private refit(resident: PatrolResident, returning: PatrolReturn): void {
    returning.state = 'REFIT'
    const destination = { x: returning.destination.x, z: returning.destination.z, yaw: returning.yaw }
    resident.npc.dismountFromMount()
    resident.npc.restoreForTown(destination)
    resident.homeMount!.restoreForTown(destination.x, destination.z, destination.yaw)
    resident.npc.mountVehicle(resident.homeMount!)
    returning.state = 'REJOIN_PATROL'
  }

  private alertSquad(squad: PatrolSquad, origin: THREE.Vector3, includeReturning: boolean): void {
    if (squad.state !== 'ENGAGING') {
      squad.state = 'ENGAGING'; squad.engagementOrigin = origin.clone(); squad.commandedWaypoint = null
      squad.participants.clear(); squad.threats.clear()
    }
    for (const resident of squad.members) {
      const state = this.returning.get(resident.spec.id)?.state
      if (!this.owns(resident.npc) || resident.npc.dead || state === 'REFIT' || !includeReturning && state === 'RETURN_TO_BARRACKS') continue
      if (!squad.participants.has(resident.spec.id)) {
        squad.participants.add(resident.spec.id)
        resident.npc.configureBanditEncounter(squad.engagementOrigin!, [], OUTSKIRTS_ENCOUNTER_LEASH)
        resident.npc.triggerEncounterAlert()
      }
    }
  }

  private finishEngagement(squad: PatrolSquad): void {
    squad.state = 'RETURN_TO_BARRACKS'; squad.engagementOrigin = null; squad.threats.clear(); squad.commandedWaypoint = null
    for (const resident of squad.members) {
      if (squad.participants.has(resident.spec.id) && this.owns(resident.npc)) this.beginPatrolReturn(resident.spec.id)
    }
    squad.participants.clear()
  }

  private distance(a: THREE.Vector3, b: THREE.Vector3): number { return Math.hypot(a.x - b.x, a.z - b.z) }
}
