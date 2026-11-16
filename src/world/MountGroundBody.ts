import type * as THREE from 'three'
import { getTerrainHeight, resolveObstacleCollision, type ObstacleCollisionResult, type ObstacleData } from './Terrain'

export const MOUNT_GRAVITY = -22
/** Ground mounts collide as a 2.6m-tall body with their movement radius; their root is at the hooves. */
export const MOUNT_BODY_HEIGHT = 2.6
export const MOUNT_MOVEMENT_RADIUS = 1

/** Gravity, then the terrain heightmap: the first half of a ground mount's frame in `Mount.finishControlledFrame`. */
export function settleMountOnTerrain(position: THREE.Vector3, velocityY: number, dt: number,
  groundHeight: (x: number, z: number) => number = getTerrainHeight): ObstacleCollisionResult {
  const terrainY = groundHeight(position.x, position.z)
  velocityY += MOUNT_GRAVITY * dt
  position.y += velocityY * dt
  if (position.y <= terrainY) return (position.y = terrainY, { velocityY: 0, onGround: true })
  return { velocityY, onGround: false }
}

/** Obstacle sides and mounted walk surfaces: the second half of a ground mount's frame. */
export function collideMountBody(position: THREE.Vector3, previous: THREE.Vector3, state: ObstacleCollisionResult,
  obstacles: ObstacleData[]): ObstacleCollisionResult {
  return resolveObstacleCollision(position, previous, state.velocityY, state.onGround, MOUNT_MOVEMENT_RADIUS,
    MOUNT_BODY_HEIGHT, 0, obstacles, { mountedSurfaces: true })
}
