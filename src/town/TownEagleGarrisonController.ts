import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { isEagleLandingClearOfMounts } from '../world/EagleLandingOccupants'
import { isEaglePadArrived } from '../world/EaglePadArrival'
import { EagleLandingQueue } from '../world/EagleLandingQueue'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import type { TownActorSpec } from './TownRules'
import type { TownEagleDuty, TownEagleGarrisonState, TownEaglePairState } from './TownEagleGarrisonState'
import { townEaglePatrolRoute, TOWN_EAGLE_PATROL_SECONDS, TOWN_EAGLE_REST_SECONDS, TOWN_EAGLE_REPLACEMENT_SECONDS, TOWN_EAGLE_WAYPOINT_RADIUS } from './TownEagleGarrison'
import { TOWN_LAYOUT_VERSION } from './TownLayout'
import { migrateTownEagleGarrisonLayout } from './TownLayoutMigration'

interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
interface Pair {
  resident: Resident; duty: TownEagleDuty; refitAllowed: boolean; serviceRefit: boolean
  route: readonly { x: number; z: number }[]; waypoint: number; patrolElapsed: number; patrolActive: boolean
  replacementRemaining: number; ambientRecovery: boolean; restRemaining: number
  playerOwned: boolean; commandReturn: boolean
}
const WALK_COMMAND = -7
const MOUNT_DISTANCE = 2.4
const TAKEOFF_SPACING_SECONDS = 1.5
const canonicalTownId = (id: string) => id.replace(/^enemy-town:/, '')

/** Stage the native half of a command transaction; the caller must save before applying it.
 * This never grants player authority. Only the validated command owner may call claim after reload.
 */
export function stageTownEaglePlayerCommand(state: TownEagleGarrisonState, actorIds: readonly string[], claimed: boolean, ambientRecoveryAllowed = false): TownEagleGarrisonState {
  const selected = new Set(actorIds.filter(id => /^town-eagle-rider:[1-5]$/.test(id)))
  return { ...state, pairs: state.pairs.map(pair => !selected.has(pair.riderId) ? pair
    : claimed ? { ...pair, commandReturn: false, refitAllowed: false }
    : { ...pair, ...releasedCommandState(pair, ambientRecoveryAllowed) }) }
}

function releasedCommandState(pair: Pick<TownEaglePairState, 'hp' | 'duty' | 'mounted' | 'replacementRemaining' | 'refitAllowed' | 'patrol' | 'ambientRecovery'> & { mount: Pick<TownEaglePairState['mount'], 'hp'> }, ambientRecoveryAllowed: boolean) {
  const casualty = pair.hp <= 0 || pair.mount.hp <= 0
  return {
    commandReturn: true,
    duty: casualty ? 'casualty' as const : pair.mounted ? 'return-queue' as const : 'walking-to-standby' as const,
    refitAllowed: casualty ? pair.refitAllowed : true,
    replacementRemaining: casualty ? pair.duty === 'casualty' ? pair.replacementRemaining ?? TOWN_EAGLE_REPLACEMENT_SECONDS : TOWN_EAGLE_REPLACEMENT_SECONDS : 0,
    ambientRecovery: casualty && (pair.ambientRecovery === true || ambientRecoveryAllowed),
    patrol: { active: true, waypoint: pair.patrol?.waypoint ?? 0, elapsed: pair.patrol?.elapsed ?? 0 },
  }
}

/** Permanent Town ownership and physical duty transitions. Does not own actor simulation twice. */
export class TownEagleGarrisonController {
  private readonly pairs = new Map<NPC, Pair>()
  private ambientPatrolAllowed = false
  private time = 0
  private nextTakeoff = 0
  private readonly landingQueue: EagleLandingQueue
  constructor(residents: readonly Resident[], private readonly sharedLandingQueue?: EagleLandingQueue) {
    this.landingQueue = sharedLandingQueue ?? new EagleLandingQueue()
    for (const resident of residents) if (resident.spec.eagle && resident.homeMount) {
      this.pairs.set(resident.npc, { resident, duty: 'standby', refitAllowed: false, serviceRefit: false, route: townEaglePatrolRoute(resident.spec.eagle.homePadId), waypoint: 0, patrolElapsed: 0, patrolActive: false, replacementRemaining: 0, ambientRecovery: false, restRemaining: 0, playerOwned: false, commandReturn: false })
      resident.npc.setEagleCruiseAltitude(resident.spec.eagle.cruiseAltitude)
      resident.homeMount.reservedForTown = true
    }
  }
  owns(npc: NPC): boolean { return this.pairs.has(npc) }
  dutyFor(npc: NPC): TownEagleDuty | undefined { return this.pairs.get(npc)?.duty }
  isPlayerCommandOwned(npc: NPC): boolean { return this.pairs.get(npc)?.playerOwned === true }
  /** Only an already-saved, rank/scene-validated owner calls this, before applying its order. */
  claimPlayerCommand(npc: NPC): boolean {
    const pair = this.pairs.get(npc)
    if (!pair || !/^town-eagle-rider:[1-5]$/.test(pair.resident.spec.id)) return false
    if (pair.playerOwned) return true
    pair.playerOwned = true; pair.commandReturn = false; pair.refitAllowed = false
    this.landingQueue.release(pair.resident.spec.id)
    npc.setEagleFlightOrder(null); npc.setMissionCombatTarget(undefined); npc.missionMovement = false
    if (!npc.dead && !pair.resident.homeMount!.dead) {
      pair.duty = npc.mount === pair.resident.homeMount ? npc.mount.isAirborne ? 'sortie' : 'mounted-waiting' : 'walking-to-mount'
    }
    return true
  }
  /** Only after a saved dismissal. The same actors return and refit under their original queue. */
  releasePlayerCommand(npc: NPC, ambientRecoveryAllowed = this.ambientPatrolAllowed): boolean {
    const pair = this.pairs.get(npc)
    if (!pair?.playerOwned) return false
    pair.playerOwned = false
    const next = releasedCommandState({ hp: npc.hp, mount: { hp: pair.resident.homeMount!.currentHp },
      duty: pair.duty, mounted: npc.mount === pair.resident.homeMount, refitAllowed: pair.refitAllowed,
      replacementRemaining: pair.replacementRemaining, ambientRecovery: pair.ambientRecovery,
      patrol: { active: pair.patrolActive, waypoint: pair.waypoint, elapsed: pair.patrolElapsed } }, ambientRecoveryAllowed)
    pair.commandReturn = next.commandReturn; pair.duty = next.duty; pair.refitAllowed = next.refitAllowed
    pair.replacementRemaining = next.replacementRemaining; pair.ambientRecovery = next.ambientRecovery; pair.patrolActive = true
    this.landingQueue.release(pair.resident.spec.id)
    this.restoreNativeOrder(pair)
    return true
  }
  /** Explicit scene authority: formal missions, hostility and protected duels must disable it. */
  setAmbientPatrolAllowed(allowed: boolean): void {
    this.ambientPatrolAllowed = allowed
  }
  beginFrame(dt: number): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0
    this.time += dt
    if (!this.sharedLandingQueue) this.landingQueue.beginFrame(dt)
    for (const pair of this.pairs.values()) {
      if (pair.playerOwned) continue
      if (pair.duty === 'casualty') pair.replacementRemaining = Math.max(0, pair.replacementRemaining - dt)
      if (pair.duty === 'resting') pair.restRemaining = Math.max(0, pair.restRemaining - dt)
      if (this.ambientPatrolAllowed && pair.patrolActive && (pair.duty === 'patrolling' || pair.duty === 'sortie')) {
        pair.patrolElapsed = Math.min(TOWN_EAGLE_PATROL_SECONDS, pair.patrolElapsed + dt)
      }
    }
  }
  /** Only called after the existing settlement has saved and authorized Town refit. */
  beginRefit(actorId: string): void {
    const pair = [...this.pairs.values()].find(p => p.resident.spec.id === actorId)
    if (!pair) return
    pair.refitAllowed = true
  }
  serviceCombatActive(npc: NPC): boolean {
    const pair = this.pairs.get(npc)
    return Boolean(npc.hasLiveCombatTarget || pair?.duty === 'sortie' && !pair.playerOwned)
  }
  canServiceRefit(npc: NPC): boolean {
    const pair = this.pairs.get(npc), mount = pair?.resident.homeMount
    return Boolean(pair && mount && !pair.refitAllowed && !pair.commandReturn
      && (!npc.combatOwnership || npc.combatOwnership === 'town-eagle-command')
      && !mount.riderPlayer && (!mount.riderNpc || mount.riderNpc === npc))
  }
  serviceRefitPending(npc: NPC): boolean { const pair = this.pairs.get(npc); return Boolean(pair?.serviceRefit && pair.refitAllowed) }
  /** The saved service transaction authorizes recovery, never a second rider or mount. */
  requestServiceRefit(npc: NPC): void {
    const pair = this.pairs.get(npc)
    if (!pair) return
    // Commit may already have released a living Commander claim into native return.
    // Upgrade that existing authorization without restarting its queue/order (also on reload).
    if (pair.refitAllowed) { pair.serviceRefit = true; return }
    // Reuse the same native release policy for autonomous patrol and player-owned flight.
    pair.playerOwned = true
    this.releasePlayerCommand(npc, true)
    pair.refitAllowed = true; pair.serviceRefit = true
  }
  /** Returns true when duty travel/peace consumed this NPC's frame; combat consumes false. */
  update(npc: NPC, dt: number, combat: boolean, camera: THREE.Vector3,
    obstacles: ObstacleData[], navigation: NavigationWorld, nearby: NPC[] = [], occupied: readonly Mount[] = []): boolean {
    const pair = this.pairs.get(npc)
    if (!pair) return false
    const { spec, homeMount: mount } = pair.resident, eagle = spec.eagle!
    const distance = npc.group.position.distanceTo(camera)
    if (pair.playerOwned) {
      if (npc.dead || mount!.dead || npc.isFalling || npc.mount && npc.mount !== mount || !npc.mount && mount!.isAirborne) return false
      if (!npc.mount) {
        if (npc.combatPosition.distanceTo(mount!.group.position) <= MOUNT_DISTANCE) {
          npc.mountVehicle(mount!)
          if (npc.mount === mount) pair.duty = 'mounted-waiting'
        } else npc.updateTownEagleBoarding(dt, distance, mount!.group.position, nearby, obstacles, navigation)
        return true
      }
      if (pair.duty === 'mounted-waiting' && !mount!.isAirborne) {
        if (this.time < this.nextTakeoff || !this.padClear(pair, obstacles, occupied)) {
          npc.updateTownPeace(dt, distance, false, false)
          return true
        }
        this.nextTakeoff = this.time + TAKEOFF_SPACING_SECONDS; pair.duty = 'sortie'
      }
      return false
    }
    // A saved dismissal finishes physical return even when a formal battle is still active.
    if (pair.commandReturn && !npc.dead && !mount!.dead) combat = false
    if (npc.dead || mount!.dead) {
      if (pair.duty !== 'casualty') {
        pair.replacementRemaining = TOWN_EAGLE_REPLACEMENT_SECONDS
        pair.ambientRecovery = this.ambientPatrolAllowed
      }
      pair.duty = 'casualty'
      this.landingQueue.release(spec.id)
      const ambientReplacement = this.ambientPatrolAllowed && pair.ambientRecovery && pair.replacementRemaining === 0
      // A living riderless survivor may be stranded by ground obstacles. After the
      // dead rider's full presentation and replacement delay, recover the fixed asset
      // at its original ground base; never heal it at the stranded airborne position.
      const retiredSurvivor = (ambientReplacement || pair.serviceRefit && pair.replacementRemaining === 0) && npc.dead && npc.deathPresentationComplete
        && !mount!.dead && !mount!.riderNpc && !mount!.riderPlayer
      if (!combat && (pair.refitAllowed || ambientReplacement) && (!pair.serviceRefit || !npc.dead || npc.deathPresentationComplete) && !npc.isFalling && (!mount!.isAirborne || retiredSurvivor)) {
        if (!npc.dead && Math.hypot(npc.combatPosition.x - spec.x, npc.combatPosition.z - spec.z) >= 1) {
          const destination = npc.combatFormationCheckpoint?.position
          if (!destination || destination.x !== spec.x || destination.z !== spec.z) this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
          npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
          return true
        }
        npc.dismountFromMount(); mount!.restoreForTown(eagle.home.x, eagle.home.z, eagle.home.yaw)
        npc.restoreForTown({ x: spec.x, z: spec.z, yaw: spec.yaw }); pair.duty = 'standby'; pair.refitAllowed = false; pair.serviceRefit = false
        pair.patrolActive = false; pair.ambientRecovery = false; pair.replacementRemaining = 0; pair.commandReturn = false
      } else if (combat && !npc.dead) return false
      npc.updateTownPeace(dt, distance, false, false)
      return true
    }
    if (!combat && pair.duty === 'standby' && pair.refitAllowed) this.refit(pair)
    if (this.ambientPatrolAllowed && !combat && pair.duty === 'standby') {
      pair.patrolActive = true; pair.waypoint = 0; pair.patrolElapsed = 0
      pair.duty = 'walking-to-mount'; this.walk(npc, mount!.group.position, eagle.home.yaw)
    }
    const patrolComplete = this.ambientPatrolAllowed && pair.patrolActive && (pair.waypoint >= pair.route.length
      || pair.patrolElapsed >= TOWN_EAGLE_PATROL_SECONDS || npc.hp <= npc.maxHp * .25
      || mount!.currentHp <= mount!.maxHp * .25 || npc.combatAmmo === 0)
    if (combat && !patrolComplete && (pair.duty === 'patrolling' || pair.duty === 'resting' || pair.duty === 'standby' || pair.duty === 'walking-to-standby' || pair.duty === 'return-queue' || pair.duty === 'returning')) {
      this.landingQueue.release(spec.id)
      pair.refitAllowed = false
      if (npc.mount === mount) {
        pair.duty = mount!.isAirborne ? 'sortie' : 'mounted-waiting'
        npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('attack'); npc.restoreCombatAmmo(npc.combatAmmo)
        npc.setEagleFlightOrder(null)
      }
      else { pair.duty = 'walking-to-mount'; this.walk(npc, mount!.group.position, eagle.home.yaw) }
    }
    if (!combat && pair.duty === 'sortie' && this.ambientPatrolAllowed && pair.patrolActive && !patrolComplete) {
      this.patrol(pair)
    }
    if ((!combat && (!this.ambientPatrolAllowed || !pair.patrolActive) && ['walking-to-mount', 'mounted-waiting', 'sortie'].includes(pair.duty))
      || pair.duty === 'patrolling' && (!this.ambientPatrolAllowed || patrolComplete)
      || pair.duty === 'sortie' && patrolComplete) {
      pair.duty = npc.mount ? 'return-queue' : 'walking-to-standby'
      if (npc.mount) npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: eagle.cruiseAltitude })
      npc.setMissionCombatTarget(null)
      if (!npc.mount) this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
    }
    if (pair.duty === 'walking-to-mount') {
      // Formation locomotion follows the ground and collision/navigation, never teleports to a seat.
      if (npc.combatPosition.distanceTo(mount!.group.position) <= MOUNT_DISTANCE && !npc.isFalling) {
        npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: eagle.cruiseAltitude })
        npc.mountVehicle(mount!)
        if (npc.mount === mount) { pair.duty = 'mounted-waiting'; npc.restoreCombatAmmo(npc.combatAmmo) }
      } else npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      return true
    }
    if (pair.duty === 'mounted-waiting') {
      const clear = this.padClear(pair, obstacles, occupied)
      if (this.time >= this.nextTakeoff && clear) {
        this.nextTakeoff = this.time + TAKEOFF_SPACING_SECONDS
        if (this.ambientPatrolAllowed && !pair.patrolActive) {
          pair.patrolActive = true; pair.waypoint = 0; pair.patrolElapsed = 0
        }
        if (!combat && pair.patrolActive) {
          this.patrol(pair)
          npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
          return true
        }
        pair.duty = 'sortie'; npc.missionMovement = false; npc.setTacticalOrder('attack')
        npc.setMissionCombatTarget(undefined); npc.setEagleFlightOrder(null)
        return false
      }
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      return true
    }
    if (pair.duty === 'patrolling') {
      const waypoint = pair.route[pair.waypoint]
      if (mount!.isAirborne && Math.hypot(mount!.group.position.x - waypoint.x, mount!.group.position.z - waypoint.z) < TOWN_EAGLE_WAYPOINT_RADIUS) {
        pair.waypoint++
        if (pair.waypoint >= pair.route.length) {
          pair.duty = 'return-queue'
          npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: eagle.cruiseAltitude })
        } else this.patrol(pair)
      }
      if (pair.duty === 'patrolling') {
        npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
        return true
      }
    }
    if (pair.duty === 'sortie') return false
    if (pair.duty === 'return-queue' || pair.duty === 'returning') {
      npc.setMissionCombatTarget(null)
      const clear = this.padClear(pair, obstacles, occupied)
      const permitted = this.landingQueue.request(spec.id, clear)
      if (!permitted && pair.duty === 'returning') {
        pair.duty = 'return-queue'
        npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: eagle.cruiseAltitude })
      }
      if (permitted && pair.duty !== 'returning') {
        pair.duty = 'returning'
        npc.setEagleFlightOrder({ kind: 'return', target: new THREE.Vector3(eagle.home.x, getTerrainHeight(eagle.home.x, eagle.home.z), eagle.home.z), cruiseAltitude: eagle.cruiseAltitude, landingYaw: eagle.home.yaw })
      }
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      if (isEaglePadArrived({ position: mount!.group.position, flight: mount!.flight!, pad: eagle.home,
        groundHeight: getTerrainHeight(mount!.group.position.x, mount!.group.position.z),
        clear: clear && this.padClear(pair, obstacles, occupied,
          { x: mount!.group.position.x, z: mount!.group.position.z, yaw: mount!.flight!.yaw }) })) {
        npc.dismountFromMount()
        if (!npc.mount) {
          this.landingQueue.complete(spec.id); npc.setEagleFlightOrder(null); pair.duty = 'walking-to-standby'
          this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
        }
      }
      return true
    }
    if (pair.duty === 'walking-to-standby') {
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      if (Math.hypot(npc.combatPosition.x - spec.x, npc.combatPosition.z - spec.z) < 1) {
        pair.duty = 'standby'; npc.setTownPeaceful(); npc.setMissionCombatTarget(undefined)
        if (pair.refitAllowed || this.ambientPatrolAllowed && pair.patrolActive) this.refit(pair)
        if (pair.patrolActive && this.ambientPatrolAllowed) { pair.duty = 'resting'; pair.restRemaining = TOWN_EAGLE_REST_SECONDS }
        pair.patrolActive = false; pair.commandReturn = false
      }
      return true
    }
    if (pair.duty === 'resting') {
      if (pair.restRemaining === 0) pair.duty = 'standby'
      npc.updateTownPeace(dt, distance, false, false)
      return true
    }
    if (pair.refitAllowed && !npc.mount && !mount!.isAirborne && !npc.isFalling) this.refit(pair)
    npc.updateTownPeace(dt, distance, false, false)
    return true
  }
  private patrol(pair: Pair): void {
    const { npc, spec } = pair.resident, waypoint = pair.route[pair.waypoint]
    pair.duty = 'patrolling'
    npc.missionMovement = false; npc.setMissionCombatTarget(null)
    npc.setEagleFlightOrder({ kind: 'patrol', target: new THREE.Vector3(waypoint.x, 0, waypoint.z), cruiseAltitude: spec.eagle!.cruiseAltitude })
  }
  private refit(pair: Pair): void {
    const { npc, spec, homeMount } = pair.resident
    if (npc.mount || npc.isFalling || homeMount!.isAirborne || !isEaglePadArrived({
      position: homeMount!.group.position, flight: homeMount!.flight!, pad: spec.eagle!.home,
      groundHeight: getTerrainHeight(homeMount!.group.position.x, homeMount!.group.position.z), clear: true,
    })) return
    npc.restoreForTown({ x: spec.x, z: spec.z, yaw: spec.yaw })
    homeMount!.currentHp = homeMount!.maxHp; pair.refitAllowed = false; pair.serviceRefit = false
  }
  private padClear(pair: Pair, obstacles: ObstacleData[], occupied: readonly Mount[],
    point = pair.resident.spec.eagle!.home): boolean {
    return isEagleLandingClearOfMounts(point, obstacles, occupied, pair.resident.homeMount, TOWN_PLAYABLE_WORLD_BOUND)
  }
  private walk(npc: NPC, point: THREE.Vector3, yaw: number): void {
    npc.missionMovement = false
    npc.assignFormationTarget(WALK_COMMAND, point.clone(), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 3.5)
  }
  snapshot(sceneKey: string): TownEagleGarrisonState {
    const position = (group: THREE.Group) => ({ x: group.position.x, y: group.position.y, z: group.position.z, yaw: group.rotation.y })
    return { version: 1, sceneKey, layoutVersion: TOWN_LAYOUT_VERSION,
      nextTakeoffRemaining: Math.min(TAKEOFF_SPACING_SECONDS, Math.max(0, this.nextTakeoff - this.time)),
      pairs: [...this.pairs.values()].map(({ resident: { npc, spec, homeMount }, duty, refitAllowed, serviceRefit, waypoint, patrolElapsed, patrolActive, replacementRemaining, ambientRecovery, restRemaining, commandReturn }) => ({
      patrol: { active: patrolActive, waypoint, elapsed: patrolElapsed }, replacementRemaining, ambientRecovery, restRemaining,
      ...(commandReturn ? { commandReturn: true } : {}),
      riderId: canonicalTownId(spec.id), mountId: canonicalTownId(spec.eagle!.mountId), homePadId: spec.eagle!.homePadId, duty, refitAllowed, ...(serviceRefit ? { serviceRefit: true } : {}),
      hp: npc.hp, ammo: npc.combatAmmo, position: position(npc.group), mounted: npc.mount === homeMount,
      ...(npc.fallSnapshot ? { fall: npc.fallSnapshot } : {}),
      mount: { hp: homeMount!.currentHp, position: position(homeMount!.group), flight: homeMount!.flight!.snapshot() },
    })) }
  }
  restore(saved: TownEagleGarrisonState | undefined, sceneKey: string): void {
    saved = migrateTownEagleGarrisonLayout(saved, sceneKey, [...this.pairs.values()].map(({ resident: { spec } }) => ({
      id: spec.eagle!.homePadId, ...spec.eagle!.home,
    })))
    if (!saved || saved.sceneKey !== sceneKey) return
    this.nextTakeoff = this.time + (saved.nextTakeoffRemaining ?? 0)
    for (const pair of this.pairs.values()) {
      const { npc, spec, homeMount: mount } = pair.resident
      const state = saved.pairs.find(p => canonicalTownId(p.riderId) === canonicalTownId(spec.id) && canonicalTownId(p.mountId) === canonicalTownId(spec.eagle!.mountId) && p.homePadId === spec.eagle!.homePadId)
      if (!state) continue
      this.landingQueue.release(spec.id)
      pair.playerOwned = false; pair.commandReturn = state.commandReturn === true
      pair.duty = state.duty === 'returning' ? 'return-queue' : state.duty; pair.refitAllowed = state.refitAllowed; pair.serviceRefit = state.serviceRefit === true
      pair.waypoint = state.patrol?.waypoint ?? 0; pair.patrolElapsed = state.patrol?.elapsed ?? 0
      pair.patrolActive = state.patrol?.active ?? false
      pair.replacementRemaining = state.replacementRemaining ?? (state.duty === 'casualty' ? TOWN_EAGLE_REPLACEMENT_SECONDS : 0)
      pair.ambientRecovery = state.ambientRecovery ?? false; pair.restRemaining = state.restRemaining ?? 0
      // Bind while grounded, then restore the actual flight phase and positions.
      if (state.mounted && state.hp > 0 && state.mount.hp > 0) npc.mountVehicle(mount!)
      mount!.group.position.set(state.mount.position.x, state.mount.position.y, state.mount.position.z)
      mount!.flight!.restore(state.mount.flight)
      mount!.group.rotation.set(-state.mount.flight.pitch, state.mount.flight.yaw, state.mount.flight.bank, 'YXZ')
      if (state.mount.hp <= 0 && !mount!.dead) mount!.takeDamage(mount!.currentHp + 1)
      else mount!.currentHp = Math.min(mount!.maxHp, state.mount.hp)
      npc.group.position.set(state.position.x, state.position.y, state.position.z); npc.group.rotation.y = state.position.yaw
      if (state.hp <= 0 && !npc.dead) npc.takeDamage(npc.maxHp + 1)
      else if (!npc.dead) npc.restoreCombatHealth(Math.min(npc.maxHp, state.hp))
      npc.restoreCombatAmmo(state.ammo)
      if (state.fall) npc.restorePendingFall(state.fall)
      this.restoreNativeOrder(pair)
    }
  }
  private restoreNativeOrder(pair: Pair): void {
    const { npc, spec, homeMount: mount } = pair.resident
    if (pair.commandReturn) { npc.setTacticalOrder('attack'); npc.setMissionCombatTarget(null); npc.missionMovement = false }
    if (pair.duty === 'patrolling' && pair.waypoint < pair.route.length) this.patrol(pair)
    if (pair.duty === 'patrolling' && pair.waypoint >= pair.route.length) pair.duty = 'return-queue'
    if (pair.duty === 'walking-to-mount') this.walk(npc, mount!.group.position, spec.eagle!.home.yaw)
    if (pair.duty === 'walking-to-standby') this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
    if (pair.duty === 'mounted-waiting' || pair.duty === 'return-queue') npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: spec.eagle!.cruiseAltitude })
  }
}
