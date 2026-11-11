import type { Vector3 } from 'three'
import { findBlockingObstacleAlongPath, type ObstacleData } from '../world/Terrain'
import type { TownGateApproach } from './TownLayeredNavigation'
import type { TownGateId } from '../town/TownLayout'
import { isRampartLayer, isStairLayer, type OutpostLayeredNavigation, type OutpostNavLayer } from './OutpostLayeredNavigation'
import { NavigationPathFollower, type NavigationRouteKind } from './NavigationPathFollower'
import type { NavigationWorld } from './NavigationWorld'

export interface LayeredNavigationRequest {
  position: Vector3
  goal: Vector3
  world: NavigationWorld | null
  outpost: OutpostLayeredNavigation | null
  currentLayer: OutpostNavLayer
  targetLayer: OutpostNavLayer
  differentLayer: boolean
  mounted: boolean
  outpostMounted: boolean
  flying: boolean
  radius: number
  height: number
  entranceId: string | null
  sectorId: TownGateId | null
  actorId: string
  skipGroundNavigation: boolean
  attackableGate?: (obstacle: ObstacleData) => boolean
}

export interface LayeredNavigationStep {
  route: NavigationRouteKind
  confirmedLayeredStep: boolean
  tower: boolean
  breach?: ObstacleData
  approachReached?: boolean
}

/** Joins existing Town/Outpost routes to an actor's existing ground follower.
 * It never advances the world frame, owns another path queue, or decides how
 * chase/follow/formation reacts to a pending or unreachable route.
 */
export class LayeredNavigationRoute {
  private readonly step: LayeredNavigationStep = { route: 'direct', confirmedLayeredStep: false, tower: false }

  private gateApproach: TownGateApproach | null = null
  private readonly breachStep: LayeredNavigationStep = { route: 'direct', confirmedLayeredStep: false, tower: false }
  get closedGateObstacle(): ObstacleData | null {
    return this.gateApproach?.gate.state === 'closed' ? this.gateApproach.gate.siegeObstacle : null
  }

  constructor(private readonly follower: NavigationPathFollower) {}

  /** The returned step is scratch storage, valid until this actor's next call.
   * null leaves ordinary ground travel (including Follow's cadence) to its owner.
   */
  resolve(request: LayeredNavigationRequest, obstacles: ObstacleData[], out: Vector3): LayeredNavigationStep | null {
    const { position, goal, world, outpost } = request
    if (this.gateApproach && request.attackableGate) {
      const gate = world?.townNav?.selectClosedGateApproach(position, goal, request.attackableGate, request.sectorId, this.gateApproach.id)
      if (gate === this.gateApproach) return this.writeGateApproach(request, obstacles, out)
    }
    this.gateApproach = null
    const step = this.step
    step.route = 'direct'; step.confirmedLayeredStep = false; step.tower = false
    const town = !request.flying ? world?.townNav?.resolveMoveTarget(position, goal, out,
      request.entranceId, request.mounted, request.sectorId, request.actorId) : null
    if (town) {
      step.tower = Boolean(town.tower)
      if (town.blocked) step.route = 'unreachable'
      // Town ground approaches retain topology checks even on a skipped boids frame.
      else if (town.ground) step.route = this.groundRoute(request, obstacles, out)
      else step.confirmedLayeredStep = true
      return step
    }
    if (!outpost || !(request.differentLayer
      || isRampartLayer(request.currentLayer) && isRampartLayer(request.targetLayer)
      || isStairLayer(request.currentLayer) || outpost.needsSiegeRoute(position, goal))) return null

    const layered = outpost.resolveMoveTarget(position, goal, request.outpostMounted, out, request.entranceId)
    if (layered.blocked) { step.route = 'unreachable'; return step }
    if (layered.step !== 'ground_approach' && layered.step !== 'ground_cross') {
      step.confirmedLayeredStep = true
      return step
    }
    if (!request.skipGroundNavigation || layered.step === 'ground_cross') {
      step.route = this.groundRoute(request, obstacles, out)
      // A coarse ground cell can reject a physically clear approach. Only this
      // Outpost handoff may recover direct travel; Town blocked routes stay closed.
      if (step.route === 'unreachable' && !this.blocked(request, obstacles, out)) step.route = 'direct'
    }
    return step
  }

  resolveBlockedPursuit(request: LayeredNavigationRequest, obstacles: ObstacleData[], out: Vector3): LayeredNavigationStep | null {
    if (!request.attackableGate || request.flying) return null
    this.gateApproach = request.world?.townNav?.selectClosedGateApproach(request.position, request.goal,
      request.attackableGate, request.sectorId, this.gateApproach?.id) ?? null
    return this.gateApproach ? this.writeGateApproach(request, obstacles, out) : null
  }

  private writeGateApproach(request: LayeredNavigationRequest, obstacles: ObstacleData[], out: Vector3): LayeredNavigationStep {
    const gate = this.gateApproach!, step = this.breachStep
    out.copy(gate.approach)
    step.route = this.groundRoute(request, obstacles, out)
    step.breach = gate.gate.siegeObstacle
    step.approachReached = request.position.distanceToSquared(gate.approach) <= 1.5 ** 2
    return step
  }

  private blocked(request: LayeredNavigationRequest, obstacles: ObstacleData[], goal: Vector3): boolean {
    return findBlockingObstacleAlongPath(request.position, goal, request.radius, request.height, 0, obstacles) !== null
  }

  private groundRoute(request: LayeredNavigationRequest, obstacles: ObstacleData[], out: Vector3): NavigationRouteKind {
    if (!request.world) return 'direct'
    return this.follower.resolveMoveTarget(request.position, out, request.world, this.blocked(request, obstacles, out), out)
  }
}
