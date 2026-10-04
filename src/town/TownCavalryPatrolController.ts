import * as THREE from 'three'
import { followLocalOffset } from '../battle/FollowOrder'
import { FollowTrail } from '../battle/FollowTrail'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import type { ObstacleData } from '../world/Terrain'
import type { TownActorSpec, TownPatrolId } from './TownRules'
import { townPatrolDeparture, townPatrolRoute, TOWN_PATROL_SPEED } from './TownPatrolRoute'

interface PatrolResident { spec: TownActorSpec; npc: NPC }
export type TownPatrolState = 'BARRACKS' | 'MOVING_TO_ROUTE' | 'PATROLLING' | 'PAUSED'
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
}

/** Owns only available patrol actors. No mission selection, combat, save schema or physical resets. */
export class TownCavalryPatrolController {
  readonly route = townPatrolRoute()
  readonly squads: PatrolSquad[]
  private readonly residents = new Map<string, PatrolResident>()
  private readonly relinquished = new Set<string>()
  private readonly available = new Set<string>()
  private readonly grid = new SpatialGrid<NPC>(8)
  private readonly nearby: NPC[] = []
  private readonly anchor = { position: new THREE.Vector3(), yaw: 0 }
  private hostile = false

  constructor(residents: readonly PatrolResident[]) {
    this.squads = (['A', 'B'] as const).flatMap(id => {
      const members = residents.filter(r => r.spec.duty === 'patrol' && r.spec.patrolId === id)
      const captain = members.find(r => r.spec.patrolLeader)
      if (!captain) return []
      for (const r of members) this.residents.set(r.spec.id, r)
      const departure = townPatrolDeparture(id, this.route), trail = new FollowTrail()
      trail.reset(captain.npc.combatPosition, captain.npc.group.rotation.y)
      return [{ id, members, followers: [], canonicalLeaderActorId: captain.spec.id, activeLeaderActorId: null,
        state: 'BARRACKS' as TownPatrolState, waypoint: departure.phase, departureIndex: 0, departure, trail, commandedWaypoint: null }]
    })
  }

  /** Call before the borrower issues any movement orders. The borrower owns travel to muster too. */
  relinquish(actorId: string): boolean {
    const resident = this.residents.get(actorId)
    if (!resident || this.relinquished.has(actorId)) return false
    this.relinquished.add(actorId); this.available.delete(actorId)
    if (!this.hostile) resident.npc.setTacticalOrder('attack')
    return true
  }

  /** Release never changes position, equipment or permanent membership. Dead/unmounted actors stay unavailable. */
  reclaim(actorId: string): boolean {
    if (!this.residents.has(actorId)) return false
    return this.relinquished.delete(actorId)
  }

  stopForHostility(): void {
    if (this.hostile) return
    this.hostile = true
    for (const r of this.residents.values()) r.npc.setTacticalOrder('attack')
    this.available.clear()
  }

  /** Mission simulation supplies its actual actor set, never an Active Mission boolean. */
  beginFrame(excluded: ReadonlySet<NPC>): void {
    this.available.clear(); this.grid.clear()
    if (this.hostile) return
    for (const [id, r] of this.residents) {
      if (!this.relinquished.has(id) && !excluded.has(r.npc) && !r.npc.dead && r.npc.mount && !r.npc.mount.dead && r.npc.mount.riderNpc === r.npc) {
        this.available.add(id); this.grid.insert(r.npc)
      }
    }
    for (const squad of this.squads) {
      let leader = squad.members.find(r => r.spec.id === squad.activeLeaderActorId && this.available.has(r.spec.id))
      const captain = squad.members.find(r => r.spec.id === squad.canonicalLeaderActorId && this.available.has(r.spec.id))
      if (!leader) leader = captain ?? squad.members.find(r => this.available.has(r.spec.id))
      else if (captain && captain !== leader && this.distance(captain.npc.combatPosition, leader.npc.combatPosition) < 9) leader = captain
      if (!leader) { squad.activeLeaderActorId = null; squad.state = 'PAUSED'; continue }
      if (squad.activeLeaderActorId !== leader.spec.id) {
        squad.activeLeaderActorId = leader.spec.id
        squad.commandedWaypoint = null
        squad.trail.rebase(leader.npc.combatPosition, leader.npc.group.rotation.y)
      }
      squad.followers = squad.members.filter(r => this.available.has(r.spec.id) && r !== leader)
      // Return the canonical Captain to the first row for a nearby leadership handover.
      squad.followers.sort((a, b) => Number(Boolean(b.spec.patrolLeader)) - Number(Boolean(a.spec.patrolLeader)))
      if (squad.state === 'PAUSED') squad.state = squad.departureIndex < squad.departure.waypoints.length ? 'MOVING_TO_ROUTE' : 'PATROLLING'
    }
  }

  updateResident(resident: PatrolResident, dt: number, camera: THREE.Vector3, obstacles: ObstacleData[], navigation: NavigationWorld): boolean {
    if (!this.residents.has(resident.spec.id)) return false
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
      if (squad.commandedWaypoint !== goal) {
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
    return true
  }

  private distance(a: THREE.Vector3, b: THREE.Vector3): number { return Math.hypot(a.x - b.x, a.z - b.z) }
}
