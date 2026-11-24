import type { CampaignSiegeCheckpoint } from './CampaignSiegeCheckpoint'
import * as THREE from 'three'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import { getTerrainHeight, getWalkRampHeight, removeObstacleData, TERRAIN_MIN_HEIGHT, type EntityCollisionBody, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { intersectsSweptPart } from '../movement/SweptBodyCollision'
import { MovingPlatformSupport, type PlatformOccupant } from '../movement/MovingPlatformSupport'
import { markObstacleTopologyChanged } from '../world/ObstacleTopology'
import type { FallingRider } from '../movement/FallingRider'
import { MobileSiegeRampController, type MobileSiegeRampState } from './MobileSiegeRampController'
import { SIEGE_RAMP, siegeRampDeckHeightAt, siegeRampRearHeightAt, siegeRampSideSkirtBox, siegeRampFrontSkirtBox, intersectsSiegeRampUnderfill, siegeRampUnderfillBounds, updateSiegeRampGroundObstacle, type MobileSiegeRampId, type SiegeRampId, type SiegeRampAssignment, type SiegeRampPlacement } from './MobileSiegeRampPolicy'

export type MobileSiegeRampSnapshot<Id extends MobileSiegeRampId = SiegeRampId> = Omit<CampaignSiegeCheckpoint['ramps'][number], 'assignment'> & { assignment: SiegeRampAssignment<Id> }

/** The crew surface the carrier reads and writes; NPC satisfies it. */
export interface SiegeRampCrewActor extends PlatformOccupant {
  readonly group: { rotation: { y: number } }
  readonly combatPosition: THREE.Vector3
  readonly isMounted: boolean
  readonly pendingFall: Pick<FallingRider, 'begin'>
  siegeTransport: string | null
  siegeTransportSpeed: number
  assignSiegeObstacle(obstacle: ObstacleData | null): void
}

/** Render side of the carrier: meshes mirror the numeric transforms the carrier already published. */
export interface MobileSiegeRampRenderPort {
  /** Part and wheel transforms, root pose and surfaces are current. */
  syncGeometry(): void
  /** The carrier was destroyed and must leave the visible scene. */
  hide(): void
}

export type SiegeRampPartRole = 'run' | 'deck' | 'frontSkirt' | 'bridge' | 'bridgeRail' | 'rail'
  | 'support' | 'panel' | 'brace' | 'chassis'

/** One collision/hit board. `position`, `scale` and `rotationX` are its authored local transform under the carrier root. */
export interface SiegeRampPart {
  readonly role: SiegeRampPartRole
  readonly side: number
  readonly along: number
  readonly z: number
  readonly band: number
  readonly direction: number
  readonly obstacle: ObstacleData
  readonly localBox: THREE.Box3
  readonly size: THREE.Vector3
  readonly position: THREE.Vector3
  readonly scale: THREE.Vector3
  rotationX: number
  readonly local: THREE.Matrix4
  readonly world: THREE.Matrix4
}

export interface SiegeRampWheel {
  readonly position: THREE.Vector3
  readonly box: THREE.Box3
  readonly local: THREE.Matrix4
  readonly world: THREE.Matrix4
  readonly worldToLocal: THREE.Matrix4
}

/** Wheel cylinder authored for the render side; the carrier derives the same collision box numerically. */
export const SIEGE_RAMP_WHEEL = { radius: .65, height: .3, radialSegments: 12, rotationZ: Math.PI / 2 } as const

/** Float32 extents of a closed cylinder, matching the vertex buffer the renderer uploads. */
function cylinderBox(radius: number, height: number, radialSegments: number): THREE.Box3 {
  const halfHeight = Math.fround(height / 2)
  const box = new THREE.Box3(new THREE.Vector3(0, -halfHeight, 0), new THREE.Vector3(0, halfHeight, 0))
  for (let i = 0; i <= radialSegments; i++) {
    const theta = i / radialSegments * Math.PI * 2
    const x = Math.fround(radius * Math.sin(theta)), z = Math.fround(radius * Math.cos(theta))
    box.min.x = Math.min(box.min.x, x); box.max.x = Math.max(box.max.x, x)
    box.min.z = Math.min(box.min.z, z); box.max.z = Math.max(box.max.z, z)
  }
  return box
}

/**
 * Numeric owner of a mobile siege ramp: pose, walk surfaces, collision parts,
 * crew/platform binding, checkpoint state and the swept movement gate. It
 * holds no scene objects; `MobileSiegeRamp` mirrors its transforms to meshes.
 */
export class MobileSiegeRampCarrier<Id extends MobileSiegeRampId = SiegeRampId, Actor extends SiegeRampCrewActor = SiegeRampCrewActor> {
  readonly position: THREE.Vector3
  readonly heading: number
  readonly surface: WalkRampSurface
  readonly bridgeSurface: WalkRampSurface
  readonly controller: MobileSiegeRampController<Id>
  readonly platform: MovingPlatformSupport<Actor>
  readonly crew = new Map<string, Actor>()
  private readonly groundObstacle: ObstacleData = { box: new THREE.Box3(), isBarricade: true }
  private readonly groundParts: ObstacleData[] = []
  readonly obstacles: ObstacleData[] = [this.groundObstacle]
  private readonly collisionGroup = { bounds: new THREE.Box3() }
  readonly parts: SiegeRampPart[] = []
  readonly wheels: SiegeRampWheel[] = []
  private readonly run: SiegeRampPart
  private readonly deck: SiegeRampPart
  private readonly frontSkirt: SiegeRampPart
  private readonly hullBounds = new THREE.Box3()
  private readonly bridgeRails: SiegeRampPart[] = []
  private readonly bridge: SiegeRampPart
  private readonly railParts: SiegeRampPart[] = []
  private disposed = false
  private unsubscribe: () => void = () => {}
  private damageable!: DamageableObstacle
  private readonly scratch = new THREE.Vector3()
  private readonly rootMatrix = new THREE.Matrix4()
  private readonly euler = new THREE.Euler()
  private readonly quaternion = new THREE.Quaternion()
  private readonly unitScale = new THREE.Vector3(1, 1, 1)

  constructor(readonly assignment: SiegeRampAssignment<Id>, readonly placement: SiegeRampPlacement<Id>,
    private readonly shared: ObstacleData[], private readonly port: MobileSiegeRampRenderPort,
    private readonly changed: (state: MobileSiegeRampState) => void) {
    this.position = placement.start.clone()
    this.heading = Math.atan2(placement.dirX ?? 0, placement.dirZ)
    this.surface = { ...placement.surface, startX: placement.surface.startX + placement.start.x - placement.dock.x, startZ: placement.surface.startZ + placement.start.z - placement.dock.z }
    this.surface.startY = siegeRampRearHeightAt(placement, this.surface.startX, this.surface.startZ)
    this.bridgeSurface = {
      startX: this.position.x, startZ: this.position.z, startY: this.position.y,
      dirX: placement.dirX ?? 0, dirZ: placement.dirZ, halfWidth: SIEGE_RAMP.halfWidth,
      length: SIEGE_RAMP.bridgeLength, landing: 0, topY: placement.deckConnection.y,
    }
    this.run = this.part('run', SIEGE_RAMP.halfWidth * 2, .25, this.surface.length)
    this.deck = this.part('deck', SIEGE_RAMP.halfWidth * 2, .25, SIEGE_RAMP.platformLength)
    // The hull is a solid undercroft, not an empty enclosure. The exact walk
    // plane keeps passengers above it; ordinary collision also recovers old
    // checkpoints or spawned actors already underneath that plane.
    this.run.obstacle.solidBelow = TERRAIN_MIN_HEIGHT - .15
    this.frontSkirt = this.part('frontSkirt', SIEGE_RAMP.halfWidth * 2, 1, .25)
    this.bridge = this.part('bridge', SIEGE_RAMP.halfWidth * 2, .25, SIEGE_RAMP.bridgeLength, false)
    for (const side of [-1, 1]) {
      this.bridgeRails.push(this.part('bridgeRail', .2, .9, SIEGE_RAMP.bridgeLength - 1.6, false, { side }))
    }
    // Short rail sections follow the authored slope without a giant blocking AABB.
    for (const side of [-1, 1]) {
      for (let along = 0; along < this.surface.length + SIEGE_RAMP.platformLength; along += 2) {
        this.railParts.push(this.part('rail', .2, .9, Math.min(2, this.surface.length + SIEGE_RAMP.platformLength - along), true, { side, along }))
      }
    }
    for (const z of [-1.3, -SIEGE_RAMP.platformLength + 1.3, -this.surface.length - SIEGE_RAMP.platformLength + 2]) {
      for (const side of [-1, 1]) {
        this.wheels.push({ position: new THREE.Vector3(side * (SIEGE_RAMP.halfWidth + .15), -2, z),
          box: cylinderBox(SIEGE_RAMP_WHEEL.radius, SIEGE_RAMP_WHEEL.height, SIEGE_RAMP_WHEEL.radialSegments),
          local: new THREE.Matrix4(), world: new THREE.Matrix4(), worldToLocal: new THREE.Matrix4() })
      }
    }
    // Vertical braces make the elevated platform visibly supported by the wheeled chassis.
    for (const side of [-1, 1]) for (const z of [-1.3, -SIEGE_RAMP.platformLength + 1.3]) {
      this.part('support', .3, 1, .3, true, { side, z })
    }
    // Narrow timber panels and braces form a tower around the continuous lane.
    // Each board owns its actual collision/projectile box; the lane stays open.
    for (const side of [-1, 1]) {
      for (let band = 0; band < 7; band++) this.part('panel', .18, 1, SIEGE_RAMP.platformLength, true, { side, band })
      for (const direction of [-1, 1]) this.part('brace', .24, .24, 1, true, { side, direction })
      this.part('chassis', .35, .35, SIEGE_RAMP.platformLength + SIEGE_RAMP.chassisOverhang * 2, true, { side })
    }
    this.platform = new MovingPlatformSupport(this.position)
    this.controller = new MobileSiegeRampController(assignment, Math.hypot(placement.start.x - placement.dock.x, placement.start.z - placement.dock.z), state => this.transition(state))
  }

  private part(role: SiegeRampPartRole, width: number, height: number, length: number, groundFootprint = true,
    tag: { side?: number; along?: number; z?: number; band?: number; direction?: number } = {}): SiegeRampPart {
    // The renderer stores box vertices as float32; use the same extents so collision matches the hit mesh.
    const hw = Math.fround(width / 2), hh = Math.fround(height / 2), hl = Math.fround(length / 2)
    const localBox = new THREE.Box3(new THREE.Vector3(-hw, -hh, -hl), new THREE.Vector3(hw, hh, hl))
    const box = new THREE.Box3()
    const obstacle: ObstacleData = { box, dynamic: true, collisionGroup: this.collisionGroup, isBarricade: true,
      navigationPassable: true, projectileBoxes: [localBox], projectileWorldToLocal: new THREE.Matrix4(),
      // This box is transformed from the same local geometry as the exact trace.
      projectileBounds: box }
    this.obstacles.push(obstacle)
    if (groundFootprint) this.groundParts.push(obstacle)
    const part: SiegeRampPart = { role, side: tag.side ?? 0, along: tag.along ?? 0, z: tag.z ?? 0, band: tag.band ?? 0,
      direction: tag.direction ?? 0, obstacle, localBox, size: new THREE.Vector3(width, height, length),
      position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), rotationX: 0,
      local: new THREE.Matrix4(), world: new THREE.Matrix4() }
    this.parts.push(part)
    return part
  }

  /** Binds the hit/HP owner, publishes the first geometry and registers the collision volumes. */
  commission(damageable: DamageableObstacle): void {
    this.damageable = damageable
    for (const part of this.parts) part.obstacle.damageable = damageable
    this.groundObstacle.damageable = damageable
    this.unsubscribe = damageable.onDestroyed(() => this.controller.destroy())
    this.updateGeometry()
    this.shared.push(...this.obstacles)
  }

  register(npc: Actor): void {
    this.controller.register(npc)
    this.crew.set(npc.combatantId, npc)
    if (!this.controller.assigned || npc.dead) return
    npc.siegeTransport = this.assignment.id
    npc.assignSiegeObstacle(null)
    npc.group.rotation.y = this.heading
    const assaultSlot = this.assignment.assaultIds.indexOf(npc.combatantId)
    if (assaultSlot >= 0) {
      // Assigned passengers do not run foot physics while transported. Repair
      // only a saved interior overlap before binding it, otherwise a legacy
      // hollow-hull checkpoint would keep carrying the trapped actor forever.
      const s = this.surface, supportY = getWalkRampHeight(s, npc.position.x, npc.position.z)
      if (npc.position.y >= TERRAIN_MIN_HEIGHT - .15 && (supportY === null || npc.position.y < supportY - .8)
        && intersectsSiegeRampUnderfill({ position: npc.position, radius: .5, height: 2.3, bottomOffset: 0 }, s, 0)) {
        // Use the original flat deck slot: a repaired point on the articulated
        // slope could sink again when its terrain angle changes under rigid carry.
        const lateral = assaultSlot % 2 === 0 ? -1 : 1
        const along = s.length + s.landing - 1 - Math.floor(assaultSlot / 2) * 1.5
        npc.position.set(s.startX + s.dirX * along + s.dirZ * lateral, s.topY,
          s.startZ + s.dirZ * along - s.dirX * lateral)
      }
      this.platform.attach(npc)
    }
  }

  releaseCrew(npc: Actor): void {
    this.controller.withdraw(npc.combatantId); this.platform.detach(npc.combatantId)
    this.crew.delete(npc.combatantId)
    npc.siegeTransport = null; npc.siegeTransportSpeed = 0
  }

  snapshot(): MobileSiegeRampSnapshot<Id> {
    return { assignment: structuredClone(this.assignment), stagingZ: this.placement.start.z,
      position: { x: this.position.x, y: this.position.y, z: this.position.z }, hp: this.damageable.currentHp,
      state: this.controller.state, distance: this.controller.distance, dockingProgress: this.controller.dockingProgress }
  }

  /** Restore carrier geometry before actor construction, without moving surviving/departed actors. */
  restore(saved: MobileSiegeRampSnapshot<Id>): void {
    this.controller.restore(saved)
    this.position.set(saved.position.x, saved.position.y, saved.position.z)
    this.surface.startX = this.placement.surface.startX + this.position.x - this.placement.dock.x
    this.surface.startZ = this.placement.surface.startZ + this.position.z - this.placement.dock.z
    this.platform.moveTo(this.position)
    this.updateGeometry()
    if (saved.state === 'ABANDONED') this.blockGroundFootprint()
    if (saved.hp === 0) {
      this.damageable.destroy()
      for (const obstacle of this.obstacles) removeObstacleData(this.shared, obstacle)
    } else if (saved.hp < this.damageable.currentHp) this.damageable.takeDamage(this.damageable.currentHp - saved.hp)
  }

  /**
   * Co-op guest: shows the host's carrier at `distance` along its own placement. No crew, movement
   * gate or checkpoint rule runs here; HP loss and destruction go through the same damage owner.
   */
  mirror(view: { state: MobileSiegeRampState; distance: number; dockingProgress: number; hp: number }): void {
    if (this.disposed || this.controller.state === 'DESTROYED') return
    if (view.hp <= 0 || view.state === 'DESTROYED') { this.damageable.destroy(); return }
    if (view.hp < this.damageable.currentHp) this.damageable.takeDamage(this.damageable.currentHp - view.hp)
    this.controller.restore(view)
    const distance = this.controller.distance, dx = this.placement.dirX ?? 0, dz = this.placement.dirZ
    this.position.x = this.placement.start.x + dx * distance
    this.position.z = this.placement.start.z + dz * distance
    this.position.y = siegeRampDeckHeightAt(this.placement, this.position.x, this.position.z)
    this.surface.startX = this.placement.surface.startX + this.position.x - this.placement.dock.x
    this.surface.startZ = this.placement.surface.startZ + this.position.z - this.placement.dock.z
    this.platform.moveTo(this.position)
    this.updateGeometry()
  }

  update(dt: number, actors: readonly Actor[], blockers: readonly EntityCollisionBody[] = []): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return
    const simulationDt = Math.min(dt, .1)
    const startX = this.position.x, startZ = this.position.z
    const movement = this.controller.advance(simulationDt, () => this.canMove(simulationDt, actors, blockers))
    for (const id of this.assignment.pusherIds) {
      const pusher = this.crew.get(id)
      if (pusher) pusher.siegeTransportSpeed = this.controller.currentSpeed
    }
    if (movement > 0) {
      const dz = movement * this.placement.dirZ
      const dx = movement * (this.placement.dirX ?? 0)
      this.position.x += dx
      this.surface.startX += dx
      this.position.z += dz
      this.surface.startZ += dz
      // Long approaches anchor the tower over its own chassis. The finite tail
      // articulates over terrain; the same owner validated its complete sweep.
      this.position.y = siegeRampDeckHeightAt(this.placement, this.position.x, this.position.z)
      this.platform.moveTo(this.position)
      for (const id of this.assignment.pusherIds) {
        const actor = this.crew.get(id)
        if (!actor || actor.dead) continue
        actor.position.x += dx
        actor.position.z += dz
        actor.position.y = getTerrainHeight(actor.position.x, actor.position.z)
      }
      this.updateGeometry()
    } else if (this.controller.state === 'DOCKING') this.updateGeometry()
    this.controller.observeMovement(simulationDt, startX, startZ, this.position.x, this.position.z)
  }

  /** Swept vehicle test against the part transforms published by the last `updateGeometry`. */
  canMove(dt: number, actors: readonly Actor[], blockers: readonly EntityCollisionBody[]): boolean {
    const maxTravel = SIEGE_RAMP.speed * Math.min(dt, .1)
    // Swept vehicle envelope; actors/structures ahead stop this convoy rather than being traversed.
    const swept = this.deck.obstacle.box.clone().union(this.run.obstacle.box)
    swept.min.y = Math.min(swept.min.y, getTerrainHeight(this.position.x, this.position.z))
    swept.expandByVector(this.scratch.set(.12 + maxTravel * Math.abs(this.placement.dirX ?? 0), 0, (this.placement.dirX === undefined ? 0 : .12) + maxTravel * Math.abs(this.placement.dirZ)))
    const staticBlocked = this.shared.some(obstacle => !this.obstacles.includes(obstacle)
      && !obstacle.walkSurface && obstacle.box.intersectsBox(swept))
    const intersectsBody = (body: EntityCollisionBody): boolean => intersectsSiegeRampUnderfill(body, this.surface, maxTravel)
      || this.parts.some(part =>
      intersectsSweptPart(body, part.localBox, part.obstacle.projectileWorldToLocal!, maxTravel * this.placement.dirZ, maxTravel * (this.placement.dirX ?? 0)))
      || this.wheels.some(wheel => intersectsSweptPart(body, wheel.box, wheel.worldToLocal,
        maxTravel * this.placement.dirZ, maxTravel * (this.placement.dirX ?? 0)))
    const actorBlocked = actors.some(npc => !npc.dead && !this.crew.has(npc.combatantId)
      && intersectsBody({ position: npc.combatPosition, radius: npc.isMounted ? 1 : .5,
        height: npc.isMounted ? 2.6 : 2.3, bottomOffset: 0 })) || blockers.some(intersectsBody)
    return !staticBlocked && !actorBlocked
  }

  /** Lays out every part, derives collision from those transforms, then lets the render side mirror them. */
  updateGeometry(): void {
    const length = this.surface.length
    const platformLength = SIEGE_RAMP.platformLength
    this.surface.startY = siegeRampRearHeightAt(this.placement, this.surface.startX, this.surface.startZ)
    this.surface.topY = this.position.y
    const rise = this.surface.topY - this.surface.startY
    this.run.scale.z = Math.hypot(length, rise) / length
    this.run.rotationX = -Math.atan2(rise, length)
    this.run.position.set(0, -rise / 2 - .125, -platformLength - length / 2)
    if (this.placement.terrainAnchor === 'deck') {
      // Place the top plane, rather than the board centre, exactly on the walk surface.
      const angle = Math.atan2(rise, length)
      this.run.position.set(0, -rise / 2 - Math.cos(angle) * .125,
        -platformLength - length / 2 + Math.sin(angle) * .125)
    }
    this.run.obstacle.walkSurface = this.surface
    this.deck.position.set(0, -.125, -platformLength / 2)
    this.deck.obstacle.walkSurface = this.surface
    const docked = this.controller.state === 'DOCKED'
    this.surface.mounted = docked
    this.deck.obstacle.walkSurface.mounted = docked
    this.bridgeSurface.startX = this.position.x
    this.bridgeSurface.startZ = this.position.z
    this.bridgeSurface.startY = this.position.y
    const progress = docked ? 1 : this.controller.state === 'DOCKING' ? this.controller.dockingProgress : 0
    const angle = (1 - progress) * Math.PI / 2
    this.bridge.rotationX = -angle
    this.bridge.position.set(0, Math.sin(angle) * SIEGE_RAMP.bridgeLength / 2 - .125,
      Math.cos(angle) * SIEGE_RAMP.bridgeLength / 2)
    if (this.placement.terrainAnchor === 'deck') this.bridge.position.set(0,
      Math.sin(angle) * SIEGE_RAMP.bridgeLength / 2 - Math.cos(angle) * .125,
      Math.cos(angle) * SIEGE_RAMP.bridgeLength / 2 + Math.sin(angle) * .125)
    this.bridge.obstacle.walkSurface = docked ? this.bridgeSurface : undefined
    this.bridgeSurface.mounted = docked
    // Stop guards at the deck edge, leaving body clearance for the 90-degree turn.
    for (const rail of this.bridgeRails) {
      rail.rotationX = -angle
      rail.position.set(rail.side * (SIEGE_RAMP.halfWidth + .1),
        Math.sin(angle) * (SIEGE_RAMP.bridgeLength - 1.6) / 2 + Math.cos(angle) * .45,
        Math.cos(angle) * (SIEGE_RAMP.bridgeLength - 1.6) / 2 - Math.sin(angle) * .45)
    }
    for (const part of this.railParts) {
      const { side, along } = part
      const localZ = -length - platformLength + along + part.size.z / 2
      if (along < length) {
        // Reuse the short side rails as closed skirts. No box crosses the lane,
        // and their terrain bottoms move with the same collision group as the ramp.
        siegeRampSideSkirtBox(this.hullBounds, this.surface, along, part.size.z, side)
        this.fitHullPanel(part)
      } else {
        const point = this.localPoint(0, localZ)
        const y = getWalkRampHeight(this.surface, point.x, point.z) ?? this.position.y
        part.position.set(side * (SIEGE_RAMP.halfWidth + .1), y - this.position.y + .45, localZ)
      }
    }
    siegeRampFrontSkirtBox(this.hullBounds, this.surface)
    this.fitHullPanel(this.frontSkirt)
    for (const wheel of this.wheels) {
      const point = this.localPoint(wheel.position.x, wheel.position.z)
      wheel.position.y = getTerrainHeight(point.x, point.z) - this.position.y + .65
    }
    for (const part of this.parts) {
      if (part.role === 'panel' || part.role === 'brace' || part.role === 'chassis') {
        const x = part.side * (SIEGE_RAMP.halfWidth + .1)
        const point = this.localPoint(x, -platformLength / 2)
        const ground = getTerrainHeight(point.x, point.z)
        const height = Math.max(1, this.position.y - ground + .8)
        if (part.role === 'panel') {
          part.scale.y = height / 7 - .04
          part.position.set(x, ground - this.position.y + (part.band + .5) * height / 7, -platformLength / 2)
        } else if (part.role === 'brace') {
          part.scale.z = Math.hypot(platformLength, height)
          part.rotationX = part.direction * Math.atan2(height, platformLength)
          part.position.set(x + part.side * .15, ground - this.position.y + height / 2, -platformLength / 2)
        } else part.position.set(x, ground - this.position.y + .45, -platformLength / 2)
      }
      if (part.role === 'support') {
        const point = this.localPoint(part.side * 2, part.z)
        const ground = getTerrainHeight(point.x, point.z)
        const height = Math.max(.25, this.position.y - ground - .5)
        part.scale.y = height
        part.position.set(part.side * 2, -height / 2, part.z)
      }
    }
    this.composeWorldTransforms()
    this.collisionGroup.bounds.makeEmpty()
    for (const part of this.parts) {
      part.obstacle.box.copy(part.localBox).applyMatrix4(part.world)
      part.obstacle.projectileWorldToLocal!.copy(part.world).invert()
      this.collisionGroup.bounds.union(part.obstacle.box)
    }
    // One continuous recovery footprint covers slope and landing. Separate
    // solids would push embedded actors back and forth across their join.
    siegeRampUnderfillBounds(this.run.obstacle.box, this.deck.obstacle.box, this.surface)
    this.collisionGroup.bounds.union(this.run.obstacle.box)
    updateSiegeRampGroundObstacle(this.groundObstacle, this.groundParts)
    this.port.syncGeometry()
  }

  /** Same composition order as the renderer: root pose, then each board's translate * rotateX * scale. */
  private composeWorldTransforms(): void {
    this.rootMatrix.compose(this.position, this.quaternion.setFromEuler(this.euler.set(0, this.heading, 0)), this.unitScale)
    for (const wheel of this.wheels) {
      wheel.local.compose(wheel.position, this.quaternion.setFromEuler(this.euler.set(0, 0, SIEGE_RAMP_WHEEL.rotationZ)), this.unitScale)
      wheel.world.multiplyMatrices(this.rootMatrix, wheel.local)
      wheel.worldToLocal.copy(wheel.world).invert()
    }
    for (const part of this.parts) {
      part.local.compose(part.position, this.quaternion.setFromEuler(this.euler.set(part.rotationX, 0, 0)), part.scale)
      part.world.multiplyMatrices(this.rootMatrix, part.local)
    }
  }

  private fitHullPanel(part: SiegeRampPart): void {
    this.hullBounds.getCenter(part.position)
    this.hullBounds.getSize(part.scale).divide(part.size)
    part.rotationX = 0
  }

  private localPoint(x: number, z: number): THREE.Vector3 {
    const dx = this.placement.dirX ?? 0, dz = this.placement.dirZ
    return this.scratch.set(this.position.x + dz * x + dx * z, this.position.y, this.position.z - dx * x + dz * z)
  }

  private blockGroundFootprint(): void {
    let changed = false
    for (const obstacle of this.obstacles) if (obstacle.navigationPassable !== false) {
      obstacle.navigationPassable = false; changed = true
    }
    if (changed) markObstacleTopologyChanged(this.shared)
  }

  private transition(state: MobileSiegeRampState): void {
    if (state === 'DOCKED') this.updateGeometry()
    if (state === 'ABANDONED') this.blockGroundFootprint()
    if (state === 'DESTROYED') {
      this.port.hide()
      for (const obstacle of this.obstacles) removeObstacleData(this.shared, obstacle)
    }
    if (state === 'DOCKED' || state === 'ABANDONED' || state === 'DESTROYED') {
      for (const npc of this.crew.values()) { npc.siegeTransport = null; npc.siegeTransportSpeed = 0 }
      this.platform.release(npc => {
        if (state === 'DESTROYED') npc.pendingFall.begin(npc.position, new THREE.Vector3())
      })
    }
    this.changed(state)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe(); this.controller.dispose()
    this.platform.release(npc => { npc.siegeTransport = null })
    for (const npc of this.crew.values()) npc.siegeTransport = null
    this.crew.clear()
    for (const obstacle of this.obstacles) removeObstacleData(this.shared, obstacle)
  }
}
