import * as THREE from 'three'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { NPC } from '../world/NPC'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { TOWN_CITY_ROADS, TOWN_LOCAL_ROADS } from './TownLayout'
import { townSitePoint, type TownActorSpec } from './TownRules'
import type { TownCombatResident } from './TownMissionCombat'

export interface MerchantParking { x: number; y: number; z: number; yaw: number }
/** The complete mounted body, including head clearance, must fit outside the porch. */
export function merchantMountPointLegal(point: { x: number; z: number }, obstacles: readonly ObstacleData[]): boolean {
  const y = getTerrainHeight(point.x, point.z)
  return !obstacles.some(({ box }) => box.max.y > y + .1 && box.min.y < y + 4.5
    && point.x > box.min.x - 2 && point.x < box.max.x + 2
    && point.z > box.min.z - 2 && point.z < box.max.z + 2)
}
export function findTownMerchantParking(obstacles: readonly ObstacleData[] = [],
  navigation?: Pick<NavigationWorld, 'areConnected'>, occupied: readonly { x: number; z: number }[] = []): MerchantParking | undefined {
  const service = townSitePoint('weapons', 0, 7.5)
  for (const side of [10, -11, 13, -14]) for (const forward of [8, 10, 6]) {
    const point = townSitePoint('weapons', side, forward)
    if (!merchantMountPointLegal(point, obstacles) || occupied.some(p => Math.hypot(p.x - point.x, p.z - point.z) < 3)) continue
    if ([...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS].some(road => {
      const dx = road.bx - road.ax, dz = road.bz - road.az
      const t = Math.max(0, Math.min(1, ((point.x - road.ax) * dx + (point.z - road.az) * dz) / (dx * dx + dz * dz)))
      return Math.hypot(point.x - road.ax - t * dx, point.z - road.az - t * dz) < road.width / 2 + 2
    })) continue
    if (!navigation || navigation.areConnected(service, point)) return { ...point, y: getTerrainHeight(point.x, point.z) }
  }
  return undefined
}
/** Normalize a peaceful service checkpoint before applying it, retaining every resource and identity. */
export function merchantServiceCheckpoint(member: PersonalActorCheckpoint, spec: TownActorSpec,
  parking: MerchantParking | undefined): PersonalActorCheckpoint {
  if (spec.role !== 'merchant' || member.status === 'dead' || member.hp === 0 || member.fall || !member.mount?.mounted || !parking) return member
  return { ...member, position: { x: spec.x, y: spec.y ?? getTerrainHeight(spec.x, spec.z), z: spec.z, yaw: spec.yaw ?? 0 },
    mount: { ...member.mount, mounted: false, position: { ...parking } } }
}

/** Coordinates the existing physical approach, riding and native command systems for one service resident. */
export class TownMerchantMountController {
  private attempt?: { npc: NPC; order: string; follow: NPC['activeFollowTarget']; command: number | null; remaining: number }
  constructor(readonly parking: MerchantParking | undefined) {}
  update(resident: TownCombatResident, active: boolean, dt: number, camera: THREE.Vector3,
    obstacles: ObstacleData[], clearance: readonly ObstacleData[], navigation: NavigationWorld, nearby: NPC[]): boolean {
    const { npc, homeMount: mount, spec } = resident
    if (spec.role !== 'merchant' || npc.dead || npc.isFalling || !this.parking) return false
    if (!active && !npc.inCombat && !npc.hasLiveCombatTarget) {
      this.attempt = undefined
      if (mount && !mount.dead && !mount.riderNpc && !mount.riderPlayer) mount.visualHold = true
      if (npc.mount && npc.mount !== mount) return false
      if (npc.mount === mount && mount) {
        const p = this.parking
        if (!merchantMountPointLegal(p, clearance) || !navigation.areConnected(npc.combatPosition, p)) return false
        if (Math.hypot(npc.combatPosition.x - p.x, npc.combatPosition.z - p.z) > 1.25) {
          npc.updateTownMountApproach(dt, npc.combatPosition.distanceTo(camera), new THREE.Vector3(p.x, p.y, p.z), nearby, obstacles, navigation)
          return true
        }
        npc.dismountFromMount()
        if (npc.isMounted) return false
        mount.visualHold = true
      }
      if (Math.hypot(npc.group.position.x - spec.x, npc.group.position.z - spec.z) > .5) {
        npc.updateTownMountApproach(dt, npc.combatPosition.distanceTo(camera), new THREE.Vector3(spec.x, spec.y ?? getTerrainHeight(spec.x, spec.z), spec.z), nearby, obstacles, navigation)
        return true
      }
      return false
    }
    if (!active || npc.isMounted || npc.hasLiveCombatTarget || !mount || mount.dead || mount.disposed
      || mount.isAirborne || mount.riderPlayer || mount.riderNpc && mount.riderNpc !== npc
      || !merchantMountPointLegal(mount.group.position, clearance)
      || !navigation.areConnected(npc.combatPosition, mount.group.position)) return false
    const attempt = this.attempt
    if (!attempt || attempt.npc !== npc || attempt.order !== npc.tacticalOrder || attempt.follow !== npc.activeFollowTarget || attempt.command !== npc.formationCommandId) {
      this.attempt = { npc, order: npc.tacticalOrder, follow: npc.activeFollowTarget, command: npc.formationCommandId, remaining: 10 }
    }
    if ((this.attempt!.remaining -= dt) <= 0) return false // Unreachable or blocked boarding never holds the command indefinitely.
    mount.visualHold = true
    if (npc.combatPosition.distanceTo(mount.group.position) <= 1.2) {
      mount.visualHold = false; npc.mountVehicle(mount)
      return false
    }
    npc.updateTownMountApproach(dt, npc.combatPosition.distanceTo(camera), mount.group.position, nearby, obstacles, navigation)
    return true
  }
}
