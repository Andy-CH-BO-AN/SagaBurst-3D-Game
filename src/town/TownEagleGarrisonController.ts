import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { isEagleLandingClear } from '../world/EagleLanding'
import { TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import type { TownActorSpec } from './TownRules'
import type { TownEagleDuty, TownEagleGarrisonState } from './TownEagleGarrisonState'

interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }
interface Pair { resident: Resident; duty: TownEagleDuty; refitAllowed: boolean }
const WALK_COMMAND = -7
const MOUNT_DISTANCE = 2.4
const TAKEOFF_SPACING_SECONDS = 1.5
const canonicalTownId = (id: string) => id.replace(/^enemy-town:/, '')

/** Permanent Town ownership and physical duty transitions. Does not own actor simulation twice. */
export class TownEagleGarrisonController {
  private readonly pairs = new Map<NPC, Pair>()
  private time = 0
  private nextTakeoff = 0
  private landingOwner: NPC | null = null
  constructor(residents: readonly Resident[]) {
    for (const resident of residents) if (resident.spec.eagle && resident.homeMount) {
      this.pairs.set(resident.npc, { resident, duty: 'standby', refitAllowed: false })
      resident.npc.setEagleCruiseAltitude(resident.spec.eagle.cruiseAltitude)
      resident.homeMount.reservedForTown = true
    }
  }
  owns(npc: NPC): boolean { return this.pairs.has(npc) }
  dutyFor(npc: NPC): TownEagleDuty | undefined { return this.pairs.get(npc)?.duty }
  beginFrame(dt: number): void { this.time += dt }
  /** Only called after the existing settlement has saved and authorized Town refit. */
  beginRefit(actorId: string): void {
    const pair = [...this.pairs.values()].find(p => p.resident.spec.id === actorId)
    if (!pair) return
    pair.refitAllowed = true
  }
  /** Returns true when duty travel/peace consumed this NPC's frame; combat consumes false. */
  update(npc: NPC, dt: number, combat: boolean, camera: THREE.Vector3,
    obstacles: ObstacleData[], navigation: NavigationWorld, nearby: NPC[] = [], occupied: readonly Mount[] = []): boolean {
    const pair = this.pairs.get(npc)
    if (!pair) return false
    const { spec, homeMount: mount } = pair.resident, eagle = spec.eagle!
    const distance = npc.group.position.distanceTo(camera)
    if (npc.dead || mount!.dead) {
      pair.duty = 'casualty'
      if (this.landingOwner === npc) this.landingOwner = null
      if (!combat && pair.refitAllowed && !npc.isFalling && !mount!.isAirborne) {
        if (!npc.dead && Math.hypot(npc.combatPosition.x - spec.x, npc.combatPosition.z - spec.z) >= 1) {
          const destination = npc.combatFormationCheckpoint?.position
          if (!destination || destination.x !== spec.x || destination.z !== spec.z) this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
          npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
          return true
        }
        npc.dismountFromMount(); mount!.restoreForTown(eagle.home.x, eagle.home.z, eagle.home.yaw)
        npc.restoreForTown({ x: spec.x, z: spec.z, yaw: spec.yaw }); pair.duty = 'standby'; pair.refitAllowed = false
      } else if (combat && !npc.dead) return false
      npc.updateTownPeace(dt, distance, false, false)
      return true
    }
    if (combat && (pair.duty === 'standby' || pair.duty === 'walking-to-standby' || pair.duty === 'return-queue' || pair.duty === 'returning')) {
      if (this.landingOwner === npc) this.landingOwner = null
      pair.refitAllowed = false
      if (npc.mount === mount) {
        pair.duty = mount!.isAirborne ? 'sortie' : 'mounted-waiting'
        npc.setMissionCombatTarget(undefined); npc.setTacticalOrder('attack'); npc.restoreCombatAmmo(npc.combatAmmo)
        npc.setEagleFlightOrder(null)
      }
      else { pair.duty = 'walking-to-mount'; this.walk(npc, mount!.group.position, eagle.home.yaw) }
    }
    if (!combat && ['walking-to-mount', 'mounted-waiting', 'sortie'].includes(pair.duty)) {
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
        pair.duty = 'sortie'; npc.missionMovement = false; npc.setTacticalOrder('attack')
        npc.setMissionCombatTarget(undefined); npc.setEagleFlightOrder(null)
        return false
      }
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      return true
    }
    if (pair.duty === 'sortie') return false
    if (pair.duty === 'return-queue' || pair.duty === 'returning') {
      npc.setMissionCombatTarget(null)
      const clear = this.padClear(pair, obstacles, occupied)
      if (!clear && pair.duty === 'returning' && mount!.isAirborne) {
        this.landingOwner = null; pair.duty = 'return-queue'
        npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: eagle.cruiseAltitude })
      }
      if (clear && (!this.landingOwner || this.landingOwner === npc) && pair.duty !== 'returning') {
        this.landingOwner = npc; pair.duty = 'returning'
        npc.setEagleFlightOrder({ kind: 'return', target: new THREE.Vector3(eagle.home.x, getTerrainHeight(eagle.home.x, eagle.home.z), eagle.home.z), cruiseAltitude: eagle.cruiseAltitude, landingYaw: eagle.home.yaw })
      }
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      if (!mount!.isAirborne && Math.hypot(mount!.group.position.x - eagle.home.x, mount!.group.position.z - eagle.home.z) < 3) {
        npc.dismountFromMount()
        if (!npc.mount) {
          this.landingOwner = null; npc.setEagleFlightOrder(null); pair.duty = 'walking-to-standby'
          this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
        }
      }
      return true
    }
    if (pair.duty === 'walking-to-standby') {
      npc.updateTownTravel(dt, distance, nearby, obstacles, navigation)
      if (Math.hypot(npc.combatPosition.x - spec.x, npc.combatPosition.z - spec.z) < 1) {
        pair.duty = 'standby'; npc.setTownPeaceful(); npc.setMissionCombatTarget(undefined)
        if (pair.refitAllowed) { npc.restoreForTown({ x: spec.x, z: spec.z, yaw: spec.yaw }); mount!.currentHp = mount!.maxHp; pair.refitAllowed = false }
      }
      return true
    }
    if (pair.refitAllowed) {
      npc.restoreForTown({ x: spec.x, z: spec.z, yaw: spec.yaw }); mount!.currentHp = mount!.maxHp; pair.refitAllowed = false
    }
    npc.updateTownPeace(dt, distance, false, false)
    return true
  }
  private padClear(pair: Pair, obstacles: ObstacleData[], occupied: readonly Mount[]): boolean {
    const { spec, homeMount } = pair.resident, home = spec.eagle!.home
    const ground = getTerrainHeight(home.x, home.z)
    return isEagleLandingClear(home, obstacles, occupied.filter(other => other !== homeMount && !other.dead
      && Math.abs(other.group.position.y - ground) < 15).map(other => ({ x: other.group.position.x, z: other.group.position.z, yaw: other.group.rotation.y })), TOWN_PLAYABLE_WORLD_BOUND)
  }
  private walk(npc: NPC, point: THREE.Vector3, yaw: number): void {
    npc.missionMovement = false
    npc.assignFormationTarget(WALK_COMMAND, point.clone(), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 3.5)
  }
  snapshot(sceneKey: string): TownEagleGarrisonState {
    const position = (group: THREE.Group) => ({ x: group.position.x, y: group.position.y, z: group.position.z, yaw: group.rotation.y })
    return { version: 1, sceneKey, pairs: [...this.pairs.values()].map(({ resident: { npc, spec, homeMount }, duty, refitAllowed }) => ({
      riderId: canonicalTownId(spec.id), mountId: canonicalTownId(spec.eagle!.mountId), homePadId: spec.eagle!.homePadId, duty, refitAllowed,
      hp: npc.hp, ammo: npc.combatAmmo, position: position(npc.group), mounted: npc.mount === homeMount,
      ...(npc.fallSnapshot ? { fall: npc.fallSnapshot } : {}),
      mount: { hp: homeMount!.currentHp, position: position(homeMount!.group), flight: homeMount!.flight!.snapshot() },
    })) }
  }
  restore(saved: TownEagleGarrisonState | undefined, sceneKey: string): void {
    if (!saved || saved.sceneKey !== sceneKey) return
    for (const pair of this.pairs.values()) {
      const { npc, spec, homeMount: mount } = pair.resident
      const state = saved.pairs.find(p => canonicalTownId(p.riderId) === canonicalTownId(spec.id) && canonicalTownId(p.mountId) === canonicalTownId(spec.eagle!.mountId) && p.homePadId === spec.eagle!.homePadId)
      if (!state) continue
      pair.duty = state.duty === 'returning' ? 'return-queue' : state.duty; pair.refitAllowed = state.refitAllowed
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
      if (pair.duty === 'walking-to-mount') this.walk(npc, mount!.group.position, spec.eagle!.home.yaw)
      if (pair.duty === 'walking-to-standby') this.walk(npc, new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z), spec.yaw ?? 0)
      if (pair.duty === 'mounted-waiting' || pair.duty === 'return-queue') npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: spec.eagle!.cruiseAltitude })
    }
  }
}
