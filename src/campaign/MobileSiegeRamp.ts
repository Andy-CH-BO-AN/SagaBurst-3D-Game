import type * as THREE from 'three'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import type { EntityCollisionBody, ObstacleData, WalkRampSurface } from '../world/Terrain'
import type { MovingPlatformSupport } from '../movement/MovingPlatformSupport'
import type { NPC } from '../world/NPC'
import type { MobileSiegeRampController, MobileSiegeRampState } from './MobileSiegeRampController'
import { MobileSiegeRampCarrier, type MobileSiegeRampSnapshot } from './MobileSiegeRampCarrier'
import { MobileSiegeRampRenderer, type MobileSiegeRampRender } from './MobileSiegeRampRenderer'
import type { MobileSiegeRampId, SiegeRampId, SiegeRampAssignment, SiegeRampPlacement } from './MobileSiegeRampPolicy'
import type { CharacterFaction } from '../world/CharacterVisuals'

export type { MobileSiegeRampSnapshot }

/** Builds the render side once the carrier's parts exist; production uses the mesh renderer. */
export type MobileSiegeRampRenderFactory<Id extends MobileSiegeRampId> =
  (carrier: MobileSiegeRampCarrier<Id, NPC>, scene: THREE.Scene, faction: CharacterFaction) => MobileSiegeRampRender

/** Render facade over the numeric carrier: every rule lives in the carrier, every mesh in the renderer. */
export class MobileSiegeRamp<Id extends MobileSiegeRampId = SiegeRampId> {
  readonly position: THREE.Vector3
  readonly surface: WalkRampSurface
  readonly bridgeSurface: WalkRampSurface
  readonly damageable: DamageableObstacle
  readonly controller: MobileSiegeRampController<Id>
  readonly platform: MovingPlatformSupport<NPC>
  readonly crew: Map<string, NPC>
  readonly obstacles: ObstacleData[]
  private readonly carrier: MobileSiegeRampCarrier<Id, NPC>
  private readonly render: MobileSiegeRampRender
  private disposed = false

  constructor(scene: THREE.Scene, readonly assignment: SiegeRampAssignment<Id>,
    readonly placement: SiegeRampPlacement<Id>, readonly faction: CharacterFaction,
    shared: ObstacleData[],
    changed: (ramp: MobileSiegeRamp<Id>, state: MobileSiegeRampState) => void,
    createRender: MobileSiegeRampRenderFactory<Id> = (carrier, parent, owner) => new MobileSiegeRampRenderer(carrier, parent, owner)) {
    this.carrier = new MobileSiegeRampCarrier<Id, NPC>(assignment, placement, shared,
      { syncGeometry: () => this.render.syncGeometry(), hide: () => this.render.hide() },
      state => changed(this, state))
    this.render = createRender(this.carrier, scene, faction)
    this.position = this.carrier.position
    this.surface = this.carrier.surface
    this.bridgeSurface = this.carrier.bridgeSurface
    this.controller = this.carrier.controller
    this.platform = this.carrier.platform
    this.crew = this.carrier.crew
    this.obstacles = this.carrier.obstacles
    this.damageable = this.render.damageable
    this.carrier.commission(this.damageable)
  }

  get root(): THREE.Object3D { return this.render.root }
  register(npc: NPC): void { this.carrier.register(npc) }
  releaseCrew(npc: NPC): void { this.carrier.releaseCrew(npc) }
  snapshot(): MobileSiegeRampSnapshot<Id> { return this.carrier.snapshot() }
  /** Restore carrier geometry before actor construction, without moving surviving/departed actors. */
  restore(saved: MobileSiegeRampSnapshot<Id>): void { this.carrier.restore(saved) }
  /** Co-op guest: present the host's pose and lifecycle; see `MobileSiegeRampCarrier.mirror`. */
  mirror(view: Parameters<MobileSiegeRampCarrier<Id, NPC>['mirror']>[0]): void { this.carrier.mirror(view) }
  update(dt: number, actors: readonly NPC[], blockers: readonly EntityCollisionBody[] = []): void {
    this.carrier.update(dt, actors, blockers)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.carrier.dispose()
    this.render.dispose()
  }
}
