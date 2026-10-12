import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { snapshotCommandActor, restoreCommandActor } from '../career/CareerCommandActorCheckpoint'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { NPC, Faction } from '../world/NPC'
import { Mount, MountType } from '../world/Mount'
import {
  gameplayNpcSpawns,
  trackNpcSpawn,
  type NpcSpawnBatch,
  type NpcSpawnScheduler,
} from '../world/NpcSpawnScheduler'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { EagleLandingQueue } from '../world/EagleLandingQueue'
import { isEagleLandingClearOfMounts } from '../world/EagleLandingOccupants'
import { isEaglePadArrived } from '../world/EaglePadArrival'
import { isEagleApproachClear } from '../world/EagleApproach'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import type { OutskirtsFactories } from './TownOutskirtsWarfareController'
import { townWartimeHostile } from './TownWartime'
import {
  ENEMY_EAGLE_SLOTS,
  ENEMY_EAGLE_RESPAWN_SECONDS,
  ENEMY_EAGLE_SENSOR_SECONDS,
  enemyEaglePatrolEnabled,
  enemyEagleActorId,
  enemyEagleSpawnSpec,
  enemyEagleRoute,
  resolveEnemyEagleHomes,
} from './EnemyEaglePatrolRules'
import type { EnemyEaglePairCheckpoint, EnemyEaglePatrolCheckpoint, EnemyEagleState } from './EnemyEaglePatrolState'
interface Pair extends EnemyEaglePairCheckpoint {
  npc?: NPC
  mount?: Mount
  batch?: NpcSpawnBatch
  readonly route: THREE.Vector3[]
  commanded?: string
  sensor: number
  target?: NPC | Player
}
interface Retired {
  npc: NPC
  mount: Mount
}
/** Independent ambient ownership. Commands/sensors here, actor simulation in TownMissionCombat,
 * riderless/dead mounts in TownScene. Never joins a formal mission or ground cavalry roster. */
export class EnemyEaglePatrolController {
  private readonly pairs: Pair[] = []
  private readonly allActors: NPC[] = []
  private readonly allMounts: Mount[] = []
  private readonly ownership = new Map<NPC, Pair>()
  private readonly retired: Retired[] = []
  private readonly retiredActors = new Set<NPC>()
  private landingOccupants: readonly Mount[] = []
  private readonly grid = new SpatialGrid<NPC>(32)
  private readonly nearby: NPC[] = []
  private readonly queue: EagleLandingQueue
  private suspended?: EnemyEaglePatrolCheckpoint
  private enabled = false
  private disposed = false
  private time = 0
  private nextTakeoff = 0
  private lastParticipants: readonly NPC[] = []
  private failure?: NpcSpawnBatch
  private failedCheckpoint?: EnemyEaglePatrolCheckpoint
  constructor(
    private readonly scene: THREE.Scene,
    private readonly townFaction: CharacterFaction,
    private readonly readProfile: () => Pick<CareerProfile, 'rank' | 'faction'>,
    private readonly obstacles: ObstacleData[],
    private readonly navigation: NavigationWorld,
    private readonly factories?: OutskirtsFactories,
    private readonly scheduler: NpcSpawnScheduler = gameplayNpcSpawns,
    private formalMission = false,
    private readonly sharedLandingQueue?: EagleLandingQueue,
  ) {
    this.queue = sharedLandingQueue ?? new EagleLandingQueue()
    this.synchronizeRank()
  }
  get hasCheckpoint(): boolean {
    return this.pairs.length > 0 || Boolean(this.suspended?.pairs.length)
  }
  get criticalSignature(): string {
    if (this.suspended) return this.suspended.pairs.map((p) => `${p.id}:${p.generation}:${p.state}`).join('|')
    return this.pairs.map((p) => `${p.id}:${p.generation}:${p.state}:${p.npc?.dead}:${p.mount?.dead}`).join('|')
  }
  get actors(): readonly NPC[] {
    return this.allActors
  }
  get mounts(): readonly Mount[] {
    return this.allMounts
  }
  get batches(): readonly NpcSpawnBatch[] {
    return this.pairs.flatMap((p) => (p.batch ? [p.batch] : [])).concat(this.failure ? [this.failure] : [])
  }
  owns(npc: NPC): boolean {
    return this.ownership.has(npc) || this.retiredActors.has(npc)
  }
  setLandingOccupants(occupied: readonly Mount[]): void {
    this.landingOccupants = occupied
  }
  squadMembersFor(npc: NPC): readonly NPC[] {
    return this.owns(npc) ? this.allActors : []
  }
  combatEnabled(npc: NPC): boolean {
    return !this.formalMission && this.ownership.get(npc)?.state === 'ENGAGING'
  }
  synchronizeRank(): void {
    if (this.disposed || this.failure) return
    const enabled = enemyEaglePatrolEnabled(this.readProfile())
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.clearLive()
      this.pairs.length = 0
      return
    }
    const homes = resolveEnemyEagleHomes(this.obstacles)
    for (const id of ENEMY_EAGLE_SLOTS)
      this.pairs.push({
        id,
        generation: 0,
        state: 'WAITING',
        waypoint: 0,
        elapsed: 0,
        restRemaining: 0,
        respawnRemaining: 0,
        home: homes[id - 1],
        route: enemyEagleRoute(id),
        sensor: id * 0.1,
      })
    if (this.formalMission) this.suspended = this.liveCheckpoint()
    else for (const pair of this.pairs) this.spawn(pair)
  }
  checkpoint(): EnemyEaglePatrolCheckpoint {
    return structuredClone(this.suspended ?? this.failedCheckpoint ?? this.liveCheckpoint())
  }
  private liveCheckpoint(): EnemyEaglePatrolCheckpoint {
    return {
      version: 1,
      nextTakeoffRemaining: Math.min(1.5, Math.max(0, this.nextTakeoff - this.time)),
      pairs: this.pairs.map((p) => ({
        id: p.id,
        generation: p.generation,
        state: p.state,
        ...(p.arrivalState ? { arrivalState: p.arrivalState } : {}),
        waypoint: p.waypoint,
        elapsed: p.elapsed,
        restRemaining: p.restRemaining,
        respawnRemaining: p.respawnRemaining,
        home: { ...p.home },
        ...(p.npc && p.mount
          ? { member: snapshotCommandActor(p.npc, p.mount) }
          : p.member
            ? { member: structuredClone(p.member) }
            : {}),
      })),
    }
  }
  restore(saved: EnemyEaglePatrolCheckpoint | undefined): void {
    this.restoreCheckpoint(saved)
  }
  restoreCheckpoint(saved: EnemyEaglePatrolCheckpoint | undefined): void {
    if (!saved || this.disposed || !this.enabled) return
    this.clearLive()
    this.failure = undefined
    this.failedCheckpoint = undefined
    this.nextTakeoff = this.time + (saved.nextTakeoffRemaining ?? 0)
    for (const p of this.pairs) {
      const state = saved.pairs.find((s) => s.id === p.id)
      if (state) Object.assign(p, structuredClone(state))
      p.npc = undefined
      p.mount = undefined
      p.batch = undefined
      p.commanded = undefined
      p.target = undefined
      if (p.state === 'RETURNING') p.state = 'RETURN_QUEUE'
      if (p.arrivalState === 'RETURNING') p.arrivalState = 'RETURN_QUEUE'
    }
    if (this.formalMission) this.suspended = this.liveCheckpoint()
    else {
      this.suspended = undefined
      for (const p of this.pairs) if (p.state !== 'RESPAWN_COOLDOWN' || p.member) this.spawn(p)
    }
  }
  setAmbientPatrolAllowed(allowed: boolean): void {
    if (allowed) this.resumeAfterMission()
    else this.suspendForMission()
  }
  suspendForMission(): void {
    if (this.formalMission || this.disposed) return
    this.suspended = this.checkpoint()
    this.formalMission = true
    this.clearLive()
  }
  resumeAfterMission(): void {
    if (!this.formalMission || this.disposed) return
    this.formalMission = false
    const held = this.suspended
    this.suspended = undefined
    if (held) this.restoreCheckpoint(held)
    else if (this.enabled) for (const p of this.pairs) this.spawn(p)
  }
  prepareFrame(dt: number, participants: readonly NPC[], player: Player): void {
    if (!this.enabled || this.formalMission || this.disposed || this.failure) return
    dt = Math.max(0, dt)
    this.time += dt
    if (!this.sharedLandingQueue) this.queue.beginFrame(dt)
    this.lastParticipants = participants
    this.grid.clear()
    for (const npc of participants) if (!npc.dead) this.grid.insert(npc)
    this.pruneRetired()
    for (const p of this.pairs) {
      if (p.state === 'SPAWNING') continue
      if (p.state === 'RESPAWN_COOLDOWN') {
        p.respawnRemaining = Math.max(0, p.respawnRemaining - dt)
        if (p.respawnRemaining === 0) {
          this.retire(p)
          p.generation++
          p.member = undefined
          p.elapsed = 0
          p.waypoint = 0
          p.state = 'WAITING'
          p.arrivalState = undefined
          this.spawn(p)
        }
        continue
      }
      const npc = p.npc,
        mount = p.mount
      if (!npc || !mount) continue
      if (npc.dead || mount.dead) {
        p.state = 'RESPAWN_COOLDOWN'
        p.respawnRemaining = ENEMY_EAGLE_RESPAWN_SECONDS
        p.target = undefined
        npc.setMissionCombatTarget(null)
        this.queue.release(this.key(p))
        // Release a surviving mount to its existing riderless descent; no airborne revival.
        npc.dismountFromMount()
        continue
      }
      if (p.state === 'RESTING') {
        p.restRemaining = Math.max(0, p.restRemaining - dt)
        if (p.restRemaining === 0) {
          p.state = 'WAITING'
          p.elapsed = 0
          p.waypoint = 0
          p.commanded = undefined
        }
        continue
      }
      if (p.state === 'WAITING') {
        if (this.time < this.nextTakeoff || !this.padClear(p)) continue
        if (npc.mount !== mount) npc.mountVehicle(mount)
        if (npc.mount !== mount) continue
        this.nextTakeoff = this.time + 1.5
        p.state = 'PATROLLING'
        p.commanded = undefined
      }
      p.elapsed += dt
      if (
        (p.state === 'PATROLLING' || p.state === 'ENGAGING') &&
        (p.elapsed >= 150 || npc.hp < npc.maxHp * 0.3 || mount.currentHp < mount.maxHp * 0.3 || npc.combatAmmo === 0)
      )
        this.returnHome(p)
      if (p.state === 'PATROLLING' || p.state === 'ENGAGING') {
        p.sensor -= dt
        if (p.sensor <= 0) {
          p.sensor = ENEMY_EAGLE_SENSOR_SECONDS
          const target = this.findTarget(p, player)
          if (target) {
            if (p.state !== 'ENGAGING') {
              p.state = 'ENGAGING'
              p.commanded = undefined
              npc.setEagleFlightOrder(null)
              npc.setTacticalOrder('attack')
            }
            if (p.target !== target) {
              p.target = target
              npc.setMissionCombatTarget(target)
            }
          } else if (p.state === 'ENGAGING') {
            p.state = 'PATROLLING'
            p.target = undefined
            p.commanded = undefined
            npc.setMissionCombatTarget(null)
          }
        }
      }
      if (p.state === 'PATROLLING') {
        const goal = p.route[p.waypoint]
        if (mount.isAirborne && Math.hypot(npc.combatPosition.x - goal.x, npc.combatPosition.z - goal.z) < 34) {
          p.waypoint++
          p.commanded = undefined
          if (p.waypoint >= p.route.length) {
            p.waypoint = 0
            this.returnHome(p)
          }
        }
        if (p.state === 'PATROLLING')
          this.order(p, `patrol:${p.waypoint}`, () =>
            npc.setEagleFlightOrder({ kind: 'patrol', target: p.route[p.waypoint], cruiseAltitude: this.altitude(p) }),
          )
      }
      if (p.state === 'RETURN_QUEUE' || p.state === 'RETURNING') {
        const clear = this.padClear(p),
          permitted = this.queue.request(this.key(p), clear)
        if (!permitted) {
          p.state = 'RETURN_QUEUE'
          this.order(p, 'hold', () => npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: this.altitude(p) }))
        } else {
          p.state = 'RETURNING'
          this.order(p, 'return', () =>
            npc.setEagleFlightOrder({
              kind: 'return',
              target: new THREE.Vector3(p.home.x, getTerrainHeight(p.home.x, p.home.z), p.home.z),
              landingYaw: p.home.yaw,
              cruiseAltitude: this.altitude(p),
            }),
          )
          if (
            isEaglePadArrived({
              position: mount.group.position,
              flight: mount.flight!,
              pad: p.home,
              groundHeight: getTerrainHeight(mount.group.position.x, mount.group.position.z),
              clear,
            })
          ) {
            npc.dismountFromMount()
            if (!npc.mount) {
              this.queue.complete(this.key(p))
              npc.setEagleFlightOrder(null)
              npc.setMissionCombatTarget(null)
              npc.refitCombat()
              mount.currentHp = mount.maxHp
              p.state = 'RESTING'
              p.restRemaining = 15
              p.commanded = undefined
            }
          }
        }
      }
    }
  }
  noteHit(target: NPC, _playerSource: boolean): void {
    const p = this.ownership.get(target)
    if (p) p.sensor = 0
  }
  updateTravel(npc: NPC, dt: number, camera: THREE.Vector3): void {
    const p = this.ownership.get(npc)
    if (this.formalMission || p?.state === 'SPAWNING') return
    if (!p) {
      if (this.retiredActors.has(npc)) npc.updateTownPeace(dt, npc.combatPosition.distanceTo(camera), false, false)
      return
    }
    npc.updateTownTravel(
      dt,
      npc.combatPosition.distanceTo(camera),
      this.grid.getNearbyInto(npc.combatPosition, 32, this.nearby),
      this.obstacles,
      this.navigation,
    )
  }
  private findTarget(p: Pair, player: Player): NPC | Player | undefined {
    const npc = p.npc!,
      position = npc.combatPosition
    // Whole-route hard leash, in addition to a local perception radius.
    if (!p.route.some((w) => Math.hypot(w.x - position.x, w.z - position.z) <= 115)) return undefined
    let result: NPC | Player | undefined,
      best = Infinity
    const consider = (target: NPC | Player, airborne: boolean) => {
      const pos = target.combatPosition,
        d = Math.hypot(pos.x - position.x, pos.z - position.z)
      if (d > 100 || !p.route.some((w) => Math.hypot(w.x - pos.x, w.z - pos.z) <= 115)) return
      const score = d + (airborne ? 0 : 1000)
      if (score < best) {
        best = score
        result = target
      }
    }
    for (const target of this.grid.getNearbyInto(position, 100, this.nearby))
      if (!target.dead && townWartimeHostile(npc, target)) consider(target, Boolean(target.mount?.isAirborne))
    if (npc.faction === Faction.ENEMY && !player.dead && player.targetable)
      consider(player, Boolean(player.currentMount?.isAirborne))
    return result
  }
  private returnHome(p: Pair): void {
    p.state = 'RETURN_QUEUE'
    p.target = undefined
    p.commanded = undefined
    p.npc!.setMissionCombatTarget(null)
  }
  private order(p: Pair, key: string, apply: () => void): void {
    if (p.commanded !== key) {
      apply()
      p.commanded = key
    }
  }
  private altitude(p: Pair): number {
    return 25 + (p.id - 1) * 5
  }
  private key(p: Pair): string {
    return enemyEagleActorId(p.id, p.generation, 'rider')
  }
  private padClear(p: Pair): boolean {
    return (
      isEagleLandingClearOfMounts(
        p.home,
        this.obstacles,
        [...this.landingOccupants, ...this.allMounts],
        p.mount,
        TOWN_PLAYABLE_WORLD_BOUND,
      ) && isEagleApproachClear(p.home, this.obstacles, [], TOWN_PLAYABLE_WORLD_BOUND, this.altitude(p))
    )
  }
  private spawn(p: Pair): void {
    if (this.disposed || this.formalMission || p.batch?.status === 'pending') return
    const arrival: EnemyEagleState = p.state === 'SPAWNING' ? (p.arrivalState ?? 'WAITING') : p.state
    p.arrivalState = arrival
    p.state = 'SPAWNING'
    p.commanded = undefined
    const batch = this.scheduler.batch(() => {
      this.failedCheckpoint = this.liveCheckpoint()
      this.clearLive()
      this.failure = batch
    })
    p.batch = batch
    const spec = enemyEagleSpawnSpec(p.id, p.generation, this.townFaction, this.readProfile().faction, p.home)
    batch.enqueue(this.key(p), () => {
      const npc = trackNpcSpawn(
        this.factories?.createNpc(spec) ??
          new NPC(
            this.scene,
            spec.x,
            spec.z,
            spec.faction,
            spec.characterFaction,
            spec.aiType,
            spec.name,
            spec.tier,
            false,
            spec.loadout,
            spec.presetId,
            undefined,
            spec.actorId,
          ),
      )
      const mount = trackNpcSpawn(
        this.factories?.createMount(p.home.x, p.home.z, MountType.XONGKORO) ??
          new Mount(this.scene, MountType.XONGKORO, p.home.x, p.home.z),
      )
      mount.group.name = enemyEagleActorId(p.id, p.generation, 'mount')
      mount.group.rotation.y = p.home.yaw
      mount.reservedForTown = true
      npc.respawnEnabled = false
      npc.group.rotation.y = p.home.yaw
      npc.setEagleCruiseAltitude(this.altitude(p))
      npc.setMissionCombatTarget(null)
      npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: this.altitude(p) })
      npc.mountVehicle(mount)
      if (npc.mount !== mount) throw new Error('Enemy eagle deployment failed to bind grounded rider')
      if (p.member) {
        // Initialize the saved flight before lethal restoration so corpse fall captures its real velocity.
        if (p.member.mount?.flight) mount.flight!.restore(p.member.mount.flight)
        restoreCommandActor(npc, p.member, mount)
      }
      p.npc = npc
      p.mount = mount
      this.allActors.push(npc)
      this.allMounts.push(mount)
      this.ownership.set(npc, p)
    })
    batch.seal(() => {
      p.state = arrival
      p.arrivalState = undefined
      p.member = undefined
      p.sensor = 0
      if (p.state === 'ENGAGING') p.state = 'PATROLLING' // Target identity is resolved afresh before simulation.
    })
  }
  private retire(p: Pair): void {
    if (p.npc && p.mount) {
      p.npc.setMissionCombatTarget(null)
      p.npc.dismountFromMount()
      this.retired.push({ npc: p.npc, mount: p.mount })
      this.retiredActors.add(p.npc)
      this.ownership.delete(p.npc)
    }
    this.queue.release(this.key(p))
    p.batch?.cancel()
    p.npc = undefined
    p.mount = undefined
    p.batch = undefined
    p.target = undefined
  }
  private pruneRetired(): void {
    for (let i = this.retired.length - 1; i >= 0; i--) {
      const { npc, mount } = this.retired[i]
      if (
        npc.isFalling ||
        (npc.dead && !npc.deathPresentationComplete) ||
        mount.riderNpc || mount.riderPlayer ||
        (mount.dead && (mount.isAirborne || !mount.deathPresentationComplete))
      )
        continue
      // After the 60-second retirement threshold, a living unoccupied survivor
      // is no longer a patrol asset. Riderless descent can be blocked by a wall;
      // it must not retain every obsolete generation forever. Death/fall stays gated above.
      this.removeActor(npc, mount)
      this.retired.splice(i, 1)
    }
  }
  private removeActor(npc: NPC, mount: Mount): void {
    // Peers must drop a previous generation before its resources disappear.
    for (const actor of this.lastParticipants) if (actor !== npc) actor.releaseCombatTarget(npc)
    this.ownership.delete(npc)
    this.retiredActors.delete(npc)
    this.grid.clear()
    npc.setMissionCombatTarget(null)
    npc.dispose()
    mount.dispose()
    const n = this.allActors.indexOf(npc),
      m = this.allMounts.indexOf(mount)
    if (n >= 0) this.allActors.splice(n, 1)
    if (m >= 0) this.allMounts.splice(m, 1)
  }
  private clearLive(): void {
    for (const p of this.pairs) {
      p.batch?.cancel()
      this.queue.release(this.key(p))
      p.npc = undefined
      p.mount = undefined
      p.batch = undefined
      p.target = undefined
      p.commanded = undefined
    }
    for (const npc of this.allActors) {
      for (const actor of this.lastParticipants) if (actor !== npc) actor.releaseCombatTarget(npc)
      npc.setMissionCombatTarget(null)
      npc.dispose()
    }
    for (const mount of this.allMounts) mount.dispose()
    this.allActors.length = 0
    this.allMounts.length = 0
    this.retired.length = 0
    this.retiredActors.clear()
    this.ownership.clear()
    this.grid.clear()
    this.lastParticipants = []
  }
  /** Explicit retry preserves queued checkpoints and generation; a failing asset never loops each frame. */
  retryFailedDeployment(): void {
    if (this.failedCheckpoint) this.restoreCheckpoint(this.failedCheckpoint)
  }
  dispose(): void {
    this.disposed = true
    this.clearLive()
    this.pairs.length = 0
    this.suspended = undefined
  }
}
