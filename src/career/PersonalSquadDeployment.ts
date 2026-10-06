import * as THREE from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { ObstacleData } from '../world/Terrain'
import type { PersonalActorPosition } from './CareerPersonalSquadMission'

interface DeploymentBounds { minX: number; maxX: number; minZ: number; maxZ: number }

function legalSlot(point: PersonalActorPosition, occupied: readonly { x: number; z: number }[], bounds: DeploymentBounds,
  obstacles: readonly ObstacleData[], navigation: NavigationWorld, anchor: PersonalActorPosition): boolean {
  if (point.x < bounds.minX + 3 || point.x > bounds.maxX - 3 || point.z < bounds.minZ + 3 || point.z > bounds.maxZ - 3) return false
  if (occupied.some(p => Math.hypot(p.x - point.x, p.z - point.z) < 4.8)) return false
  if (obstacles.some(o => (o.navigationBox ?? o.box).clone().expandByScalar(2).containsPoint(new THREE.Vector3(point.x,
    (o.navigationBox ?? o.box).getCenter(new THREE.Vector3()).y, point.z)))) return false
  return navigation.areConnected(anchor, point)
}

/** Uses the existing navigation topology and leaves official formation lanes empty. */
export function personalRearDeployment(anchor: PersonalActorPosition, official: readonly { x: number; z: number }[],
  count: number, bounds: DeploymentBounds, obstacles: readonly ObstacleData[], navigation: NavigationWorld, playerLeads = false): PersonalActorPosition[] {
  const forward = { x: Math.sin(anchor.yaw), z: Math.cos(anchor.yaw) }
  const right = { x: Math.cos(anchor.yaw), z: -Math.sin(anchor.yaw) }
  const rear = Math.min(0, ...official.map(p => (p.x - anchor.x) * forward.x + (p.z - anchor.z) * forward.z)) - 8
  const result: PersonalActorPosition[] = []
  const occupied = [...official]
  for (let row = 0; row < 80 && result.length < count; row++) {
    for (let column = 0; column < 21 && result.length < count; column++) {
      const lateral = (column % 2 ? 1 : -1) * Math.ceil(column / 2) * 5
      const depth = rear - row * 5
      const point = { x: anchor.x + forward.x * depth + right.x * lateral,
        z: anchor.z + forward.z * depth + right.z * lateral, yaw: anchor.yaw }
      if (!legalSlot(point, occupied, bounds, obstacles, navigation, anchor)) continue
      result.push(point); occupied.push(point)
      if (playerLeads && result.length === 1) break
    }
  }
  if (result.length !== count) throw new Error('No legal rear deployment for the personal squad')
  return result
}

/** Town edge entries have limited rear depth; keep the private slots near Player on the same side. */
export function personalTownDeployment(anchor: PersonalActorPosition, official: readonly { x: number; z: number }[],
  count: number, bounds: DeploymentBounds, obstacles: readonly ObstacleData[], navigation: NavigationWorld): PersonalActorPosition[] {
  const occupied = [...official, anchor], result: PersonalActorPosition[] = []
  for (let ring = 1; ring <= 16 && result.length < count; ring++) {
    for (let step = 0; step < ring * 8 && result.length < count; step++) {
      const angle = anchor.yaw + Math.PI + step * Math.PI * 2 / (ring * 8)
      const point = { x: anchor.x + Math.sin(angle) * ring * 6, z: anchor.z + Math.cos(angle) * ring * 6, yaw: anchor.yaw }
      if (!legalSlot(point, occupied, bounds, obstacles, navigation, anchor)) continue
      result.push(point); occupied.push(point)
    }
  }
  if (result.length !== count) throw new Error('No legal Town entry for the personal squad')
  return result
}
