import * as THREE from 'three'
import { DamageableObstacle, DAMAGEABLE_OBSTACLE_HP } from '../world/DamageableObstacle'
import { getTerrainHeight, getWalkRampHeight, removeObstacleData, type EntityCollisionBody, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { intersectsSweptPart } from '../movement/SweptBodyCollision'
import { MovingPlatformSupport } from '../movement/MovingPlatformSupport'
import type { NPC } from '../world/NPC'
import { MobileSiegeRampController, type MobileSiegeRampState } from './MobileSiegeRampController'
import { SIEGE_RAMP, type SiegeRampAssignment, type SiegeRampPlacement } from './MobileSiegeRampPolicy'
import type { CharacterFaction } from '../world/CharacterVisuals'

interface Part { mesh: THREE.Mesh; obstacle: ObstacleData; localBox: THREE.Box3 }

export class MobileSiegeRamp {
  readonly root = new THREE.Group()
  readonly position: THREE.Vector3
  readonly surface: WalkRampSurface
  readonly bridgeSurface: WalkRampSurface
  readonly damageable: DamageableObstacle
  readonly controller: MobileSiegeRampController
  readonly platform: MovingPlatformSupport<NPC>
  readonly crew = new Map<string, NPC>()
  readonly obstacles: ObstacleData[] = []
  private readonly parts: Part[] = []
  private readonly wheels: THREE.Mesh[] = []
  private readonly wheelBodies: { box: THREE.Box3; worldToLocal: THREE.Matrix4 }[] = []
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x795334, roughness: .9 })
  private readonly iron = new THREE.MeshStandardMaterial({ color: 0x343238, roughness: .7 })
  private readonly run: Part
  private readonly deck: Part
  private readonly bridgeRails: Part[] = []
  private readonly bridge: Part
  private readonly railParts: Part[] = []
  private disposed = false
  private readonly unsubscribe: () => void
  private readonly scratch = new THREE.Vector3()

  constructor(scene: THREE.Scene, readonly assignment: SiegeRampAssignment,
    readonly placement: SiegeRampPlacement, readonly faction: CharacterFaction,
    private readonly shared: ObstacleData[],
    private readonly changed: (ramp: MobileSiegeRamp, state: MobileSiegeRampState) => void) {
    this.position = placement.start.clone()
    this.surface = { ...placement.surface, startZ: placement.surface.startZ + placement.start.z - placement.dock.z }
    this.surface.startY = getTerrainHeight(this.surface.startX, this.surface.startZ) + .04
    this.bridgeSurface = {
      startX: this.position.x, startZ: this.position.z, startY: this.position.y,
      dirX: 0, dirZ: placement.dirZ, halfWidth: SIEGE_RAMP.halfWidth,
      length: SIEGE_RAMP.bridgeLength, landing: 0, topY: placement.deckConnection.y,
    }
    this.root.name = assignment.id
    scene.add(this.root)
    this.root.position.copy(this.position)
    this.root.rotation.y = placement.dirZ > 0 ? 0 : Math.PI
    this.run = this.part(SIEGE_RAMP.halfWidth * 2, .25, this.surface.length)
    this.deck = this.part(SIEGE_RAMP.halfWidth * 2, .25, SIEGE_RAMP.platformLength)
    this.bridge = this.part(SIEGE_RAMP.halfWidth * 2, .25, SIEGE_RAMP.bridgeLength)
    for (const side of [-1, 1]) {
      const rail = this.part(.2, .9, SIEGE_RAMP.bridgeLength - 1.6)
      rail.mesh.userData.side = side
      this.bridgeRails.push(rail)
    }
    // Short rail sections follow the authored slope without a giant blocking AABB.
    for (const side of [-1, 1]) {
      for (let along = 0; along < this.surface.length + SIEGE_RAMP.platformLength; along += 2) {
        const rail = this.part(.2, .9, Math.min(2, this.surface.length + SIEGE_RAMP.platformLength - along))
        rail.mesh.userData = { side, along }
        this.railParts.push(rail)
      }
    }
    for (const z of [-1.3, -SIEGE_RAMP.platformLength + 1.3, -this.surface.length - SIEGE_RAMP.platformLength + 2]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.65, .65, .3, 12), this.iron)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(side * (SIEGE_RAMP.halfWidth + .15), -2, z)
        wheel.geometry.computeBoundingBox()
        this.wheelBodies.push({ box: wheel.geometry.boundingBox!, worldToLocal: new THREE.Matrix4() })
        this.root.add(wheel); this.wheels.push(wheel)
      }
    }
    // Vertical braces make the elevated platform visibly supported by the wheeled chassis.
    for (const side of [-1, 1]) for (const z of [-1.3, -SIEGE_RAMP.platformLength + 1.3]) {
      const support = this.part(.3, 1, .3)
      support.mesh.userData = { support: true, side, z }
    }
    // Narrow timber panels and braces form a tower around the continuous lane.
    // Each board owns its actual collision/projectile box; the lane stays open.
    for (const side of [-1, 1]) {
      for (let band = 0; band < 7; band++) {
        const panel = this.part(.18, 1, SIEGE_RAMP.platformLength)
        panel.mesh.userData = { towerPanel: true, side, band }
      }
      for (const direction of [-1, 1]) {
        const brace = this.part(.24, .24, 1)
        brace.mesh.userData = { towerBrace: true, side, direction }
      }
      const chassis = this.part(.35, .35, SIEGE_RAMP.platformLength + 1)
      chassis.mesh.userData = { chassis: true, side }
    }
    this.damageable = new DamageableObstacle({ kind: 'siege_ramp', maxHp: DAMAGEABLE_OBSTACLE_HP.siege_ramp,
      root: this.root, hitMeshes: [...this.parts.map(p => p.mesh), ...this.wheels], ownerFaction: faction })
    for (const part of this.parts) part.obstacle.damageable = this.damageable
    this.platform = new MovingPlatformSupport(this.position)
    this.controller = new MobileSiegeRampController(assignment, Math.abs(placement.start.z - placement.dock.z), state => this.transition(state))
    this.unsubscribe = this.damageable.onDestroyed(() => this.controller.destroy())
    this.updateGeometry()
    shared.push(...this.obstacles)
  }

  private part(width: number, height: number, length: number): Part {
    const geometry = new THREE.BoxGeometry(width, height, length)
    geometry.computeBoundingBox()
    const mesh = new THREE.Mesh(geometry, this.wood)
    mesh.castShadow = true; mesh.receiveShadow = true
    this.root.add(mesh)
    const localBox = geometry.boundingBox!.clone()
    const obstacle: ObstacleData = { box: new THREE.Box3(), dynamic: true, isBarricade: true,
      navigationPassable: true, projectileBoxes: [localBox], projectileWorldToLocal: new THREE.Matrix4() }
    this.obstacles.push(obstacle)
    const part = { mesh, obstacle, localBox }
    this.parts.push(part)
    return part
  }

  register(npc: NPC): void {
    this.controller.register(npc)
    this.crew.set(npc.combatantId, npc)
    npc.siegeTransport = this.assignment.id
    npc.assignSiegeObstacle(null)
    npc.group.rotation.y = this.placement.dirZ > 0 ? 0 : Math.PI
    if (this.assignment.assaultIds.includes(npc.combatantId)) this.platform.attach(npc)
  }

  update(dt: number, actors: readonly NPC[], blockers: readonly EntityCollisionBody[] = []): void {
    if (this.disposed) return
    const movement = this.controller.advance(Math.min(dt, .1), () => this.canMove(dt, actors, blockers))
    for (const id of this.assignment.pusherIds) {
      const pusher = this.crew.get(id)
      if (pusher) pusher.siegeTransportSpeed = this.controller.currentSpeed
    }
    if (movement > 0) {
      const dz = movement * this.placement.dirZ
      this.position.z += dz
      this.surface.startZ += dz
      // The vehicle follows terrain vertically as a rigid carrier. Its continuous
      // ramp keeps the dock-approved slope without needing an extra-long run.
      this.position.y = getTerrainHeight(this.surface.startX, this.surface.startZ) + .04
        + this.placement.surface.topY - this.placement.surface.startY
      this.platform.moveTo(this.position)
      for (const id of this.assignment.pusherIds) {
        const actor = this.crew.get(id)
        if (!actor || actor.dead) continue
        actor.position.z += dz
        actor.position.y = getTerrainHeight(actor.position.x, actor.position.z)
      }
      this.updateGeometry()
    } else if (this.controller.state === 'DOCKING') this.updateGeometry()
  }

  private canMove(dt: number, actors: readonly NPC[], blockers: readonly EntityCollisionBody[]): boolean {
    const maxTravel = SIEGE_RAMP.speed * Math.min(dt, .1)
    // Swept vehicle envelope; actors/structures ahead stop this convoy rather than being traversed.
    const swept = this.deck.obstacle.box.clone().union(this.run.obstacle.box)
    swept.min.y = Math.min(swept.min.y, getTerrainHeight(this.position.x, this.position.z))
    swept.expandByVector(this.scratch.set(.12, 0, maxTravel))
    const staticBlocked = this.shared.some(obstacle => !this.obstacles.includes(obstacle)
      && !obstacle.walkSurface && obstacle.box.intersectsBox(swept))
    const intersectsBody = (body: EntityCollisionBody): boolean => this.parts.some(part =>
      intersectsSweptPart(body, part.localBox, part.obstacle.projectileWorldToLocal!, maxTravel * this.placement.dirZ))
      || this.wheelBodies.some(wheel => intersectsSweptPart(body, wheel.box, wheel.worldToLocal,
        maxTravel * this.placement.dirZ))
    const actorBlocked = actors.some(npc => !npc.dead && !this.crew.has(npc.combatantId)
      && intersectsBody({ position: npc.combatPosition, radius: npc.isMounted ? 1 : .5,
        height: npc.isMounted ? 2.6 : 2.3, bottomOffset: 0 })) || blockers.some(intersectsBody)
    return !staticBlocked && !actorBlocked
  }

  private updateGeometry(): void {
    const length = this.surface.length
    const platformLength = SIEGE_RAMP.platformLength
    this.root.position.copy(this.position)
    this.surface.startY = getTerrainHeight(this.surface.startX, this.surface.startZ) + .04
    this.surface.topY = this.position.y
    const rise = this.surface.topY - this.surface.startY
    this.run.mesh.scale.z = Math.hypot(length, rise) / length
    this.run.mesh.rotation.x = -Math.atan2(rise, length)
    this.run.mesh.position.set(0, -rise / 2 - .125, -platformLength - length / 2)
    this.run.obstacle.walkSurface = this.surface
    this.deck.mesh.position.set(0, -.125, -platformLength / 2)
    this.deck.obstacle.walkSurface = this.surface
    const docked = this.controller?.state === 'DOCKED'
    this.surface.mounted = docked
    this.deck.obstacle.walkSurface.mounted = docked
    this.bridgeSurface.startZ = this.position.z
    this.bridgeSurface.startY = this.position.y
    const progress = docked ? 1 : this.controller?.state === 'DOCKING' ? this.controller.dockingProgress : 0
    const angle = (1 - progress) * Math.PI / 2
    this.bridge.mesh.rotation.x = -angle
    this.bridge.mesh.position.set(0, Math.sin(angle) * SIEGE_RAMP.bridgeLength / 2 - .125,
      Math.cos(angle) * SIEGE_RAMP.bridgeLength / 2)
    this.bridge.obstacle.walkSurface = docked ? this.bridgeSurface : undefined
    this.bridgeSurface.mounted = docked
    // Stop guards at the deck edge, leaving body clearance for the 90-degree turn.
    for (const rail of this.bridgeRails) {
      rail.mesh.rotation.x = -angle
      rail.mesh.position.set(rail.mesh.userData.side * (SIEGE_RAMP.halfWidth + .1),
        Math.sin(angle) * (SIEGE_RAMP.bridgeLength - 1.6) / 2 + Math.cos(angle) * .45,
        Math.cos(angle) * (SIEGE_RAMP.bridgeLength - 1.6) / 2 - Math.sin(angle) * .45)
    }
    for (const part of this.railParts) {
      const { side, along } = part.mesh.userData
      const localZ = -length - platformLength + along + 1
      const worldZ = this.position.z + this.placement.dirZ * localZ
      const y = getWalkRampHeight(this.surface, this.position.x, worldZ) ?? this.position.y
      part.mesh.position.set(side * (SIEGE_RAMP.halfWidth + .1), y - this.position.y + .45, localZ)
      part.mesh.rotation.x = along < length - 1 ? -Math.atan2(rise, length) : 0
    }
    for (const wheel of this.wheels) {
      wheel.position.y = getTerrainHeight(this.position.x + wheel.position.x,
        this.position.z + wheel.position.z * this.placement.dirZ) - this.position.y + .65
    }
    for (const part of this.parts) {
      const data = part.mesh.userData
      if (data.towerPanel || data.towerBrace || data.chassis) {
        const x = data.side * (SIEGE_RAMP.halfWidth + .1)
        const ground = getTerrainHeight(this.position.x + x, this.position.z - this.placement.dirZ * platformLength / 2)
        const height = Math.max(1, this.position.y - ground + .8)
        if (data.towerPanel) {
          part.mesh.scale.y = height / 7 - .04
          part.mesh.position.set(x, ground - this.position.y + (data.band + .5) * height / 7, -platformLength / 2)
        } else if (data.towerBrace) {
          part.mesh.scale.z = Math.hypot(platformLength, height)
          part.mesh.rotation.x = data.direction * Math.atan2(height, platformLength)
          part.mesh.position.set(x + data.side * .15, ground - this.position.y + height / 2, -platformLength / 2)
        } else part.mesh.position.set(x, ground - this.position.y + .45, -platformLength / 2)
      }
      if (part.mesh.userData.support) {
        const { side, z } = part.mesh.userData
        const ground = getTerrainHeight(this.position.x + side * 2, this.position.z + z * this.placement.dirZ)
        const height = Math.max(.25, this.position.y - ground - .5)
        part.mesh.scale.y = height
        part.mesh.position.set(side * 2, -height / 2, z)
      }
    }
    this.root.updateWorldMatrix(true, true)
    for (let i = 0; i < this.wheels.length; i++) this.wheelBodies[i].worldToLocal.copy(this.wheels[i].matrixWorld).invert()
    for (const part of this.parts) {
      part.obstacle.box.copy(part.localBox).applyMatrix4(part.mesh.matrixWorld)
      part.obstacle.projectileWorldToLocal!.copy(part.mesh.matrixWorld).invert()
    }
  }

  private transition(state: MobileSiegeRampState): void {
    if (state === 'DOCKED') this.updateGeometry()
    if (state === 'DESTROYED') for (const obstacle of this.obstacles) removeObstacleData(this.shared, obstacle)
    if (state === 'DOCKED' || state === 'ABANDONED' || state === 'DESTROYED') {
      for (const npc of this.crew.values()) npc.siegeTransport = null
      this.platform.release(npc => {
        if (state === 'DESTROYED') npc.pendingFall.begin(npc.position, new THREE.Vector3())
      })
    }
    this.changed(this, state)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe(); this.controller.dispose()
    this.platform.release(npc => { npc.siegeTransport = null })
    for (const npc of this.crew.values()) npc.siegeTransport = null
    this.crew.clear()
    for (const obstacle of this.obstacles) removeObstacleData(this.shared, obstacle)
    this.root.removeFromParent()
    for (const part of this.parts) part.mesh.geometry.dispose()
    for (const wheel of this.wheels) wheel.geometry.dispose()
    this.wood.dispose(); this.iron.dispose()
  }
}
