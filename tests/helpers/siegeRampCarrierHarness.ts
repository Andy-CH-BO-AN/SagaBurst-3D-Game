import { Vector3, type Object3D } from 'three'
import { DAMAGEABLE_OBSTACLE_HP, DamageableObstacle } from '../../src/world/DamageableObstacle'
import { getTerrainHeight, type EntityCollisionBody, type ObstacleData } from '../../src/world/Terrain'
import { MobileSiegeRampCarrier, type SiegeRampCrewActor } from '../../src/campaign/MobileSiegeRampCarrier'
import type { MobileSiegeRampState } from '../../src/campaign/MobileSiegeRampController'
import { SIEGE_RAMP, type MobileSiegeRampId, type SiegeRampAssignment, type SiegeRampPlacement } from '../../src/campaign/MobileSiegeRampPolicy'

/** Plain numeric crew member: only the fields the carrier and the evacuation policy read or write. */
export interface CrewDouble extends SiegeRampCrewActor {
  dead: boolean
  hp: number
  tacticalOrder: string
  siegeEvacuation: Vector3 | null
  siegeBypassTarget: Vector3 | null
  /** Recorded outputs, so assertions name what happened instead of indexing mock.calls. */
  readonly falls: Vector3[]
  readonly obstacleAssignments: (ObstacleData | null)[]
}

export function createCrewDouble(combatantId: string, x: number, y: number, z: number): CrewDouble {
  const falls: Vector3[] = [], obstacleAssignments: (ObstacleData | null)[] = []
  const position = new Vector3(x, y, z)
  return {
    combatantId, dead: false, position, hp: 73, tacticalOrder: 'defend',
    group: { rotation: { y: 0 } }, get combatPosition() { return position }, isMounted: false,
    pendingFall: { begin(feet: Vector3) { falls.push(feet.clone()) } }, falls, obstacleAssignments,
    siegeTransport: null, siegeTransportSpeed: 0, siegeEvacuation: null, siegeBypassTarget: null,
    assignSiegeObstacle(obstacle) { obstacleAssignments.push(obstacle) },
  }
}

export function crewAssignment<Id extends MobileSiegeRampId>(id: Id, side: -1 | 1 = -1): SiegeRampAssignment<Id> {
  return { id, side, pusherIds: ['p0', 'p1', 'p2', 'p3'], assaultIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] }
}

export interface RampPlacementSpec<Id extends MobileSiegeRampId> {
  id: Id
  /** Carrier pose when it starts moving; its dock is `travel` metres ahead along the heading. */
  start: Vector3
  dirX?: number
  dirZ: number
  travel: number
  length: number
}

/** Flat-deck placement with the rear anchor on the ground: surface and deck connection authored relative to the dock. */
export function rampPlacement<Id extends MobileSiegeRampId>(spec: RampPlacementSpec<Id>): SiegeRampPlacement<Id> {
  const dx = spec.dirX ?? 0, dz = spec.dirZ, platform = SIEGE_RAMP.platformLength
  const dock = new Vector3(spec.start.x + dx * spec.travel, spec.start.y, spec.start.z + dz * spec.travel)
  const rearX = dock.x - dx * (spec.length + platform), rearZ = dock.z - dz * (spec.length + platform)
  return { id: spec.id, side: -1, start: spec.start.clone(), dock, deckConnection: dock.clone(), dirZ: dz,
    ...(spec.dirX === undefined ? {} : { dirX: spec.dirX }),
    surface: { startX: rearX, startZ: rearZ, startY: getTerrainHeight(rearX, rearZ) + .04, topY: dock.y,
      dirX: dx, dirZ: dz, halfWidth: SIEGE_RAMP.halfWidth, length: spec.length, landing: platform } }
}

/** A grounded body standing `ahead` metres in front of the carrier's front edge, `lateral` metres off its axis. */
export function bodyAhead(position: Vector3, dirX: number, dirZ: number, ahead: number, lateral = 0): EntityCollisionBody {
  const x = position.x + dirX * ahead + dirZ * lateral, z = position.z + dirZ * ahead - dirX * lateral
  return { position: new Vector3(x, getTerrainHeight(x, z), z), radius: .5, height: 2.3, bottomOffset: 0 }
}

export interface SiegeCarrierOptions<Id extends MobileSiegeRampId> {
  placement: SiegeRampPlacement<Id>
  assignment: SiegeRampAssignment<Id>
  /** Obstacles already in the shared world list; the carrier appends its own on commission. */
  neighbors?: ObstacleData[]
  onChanged?: (state: MobileSiegeRampState, carrier: MobileSiegeRampCarrier<Id, CrewDouble>) => void
}

/** Real carrier behind recorded render-port counters and an HP owner whose root is a plain visibility record. */
export function createSiegeCarrier<Id extends MobileSiegeRampId>(options: SiegeCarrierOptions<Id>) {
  const states: MobileSiegeRampState[] = []
  const render = { syncs: 0, hides: 0 }
  const root = { visible: true, parent: null, removals: 0, removeFromParent() { this.removals++ } }
  const damageable = new DamageableObstacle({ kind: 'siege_ramp', maxHp: DAMAGEABLE_OBSTACLE_HP.siege_ramp, root: root as unknown as Object3D })
  const shared = [...(options.neighbors ?? [])]
  const carrier = new MobileSiegeRampCarrier<Id, CrewDouble>(options.assignment, options.placement, shared,
    { syncGeometry() { render.syncs++ }, hide() { render.hides++ } },
    state => { states.push(state); options.onChanged?.(state, carrier) })
  carrier.commission(damageable)
  return { carrier, shared, states, render, root, damageable }
}
