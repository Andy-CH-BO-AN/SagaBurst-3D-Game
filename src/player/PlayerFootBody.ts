import type * as THREE from 'three'
import { PLAYER_RADIUS } from '../movement/MovementBalance'
import { getTerrainHeight, resolveObstacleCollision, type ObstacleData, type ObstacleCollisionResult } from '../world/Terrain'

/**
 * Height of the on-foot Player collision centre above its feet. Every standing
 * placement (Town returns, retries, saved walking poses) and the per-frame
 * foot step use this one value, so a placed body starts exactly on its floor.
 */
export const PLAYER_FOOT_OFFSET = 0.95
export const PLAYER_GRAVITY = -22

/** Player root Y for feet resting on `floorY` (a verified walk surface or terrain). */
export function standingPlayerY(floorY: number): number {
  return floorY + PLAYER_FOOT_OFFSET
}

/**
 * One on-foot vertical step of `Player.update`: gravity, the terrain heightmap,
 * then obstacle sides and walk surfaces. `position` already holds this frame's
 * horizontal travel; `previous` is the pose before it.
 */
export function stepPlayerFootBody(
  position: THREE.Vector3,
  previous: THREE.Vector3,
  state: ObstacleCollisionResult,
  dt: number,
  obstacles: ObstacleData[],
  groundHeight: (x: number, z: number) => number = getTerrainHeight,
): ObstacleCollisionResult {
  let velocityY = state.velocityY + PLAYER_GRAVITY * dt
  let onGround = state.onGround
  position.y += velocityY * dt
  const terrainStanding = standingPlayerY(groundHeight(position.x, position.z))
  if (position.y <= terrainStanding) {
    position.y = terrainStanding
    velocityY = 0
    onGround = true
  }
  return resolveObstacleCollision(position, previous, velocityY, onGround, PLAYER_RADIUS,
    PLAYER_FOOT_OFFSET * 2, PLAYER_FOOT_OFFSET, obstacles, { walkSurfaces: true })
}
