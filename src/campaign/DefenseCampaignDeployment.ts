import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { PLAYABLE_WORLD_BOUND, type ObstacleData } from '../world/Terrain'
import { getCampaignOutpostPlacement } from './CampaignOutpost'
import { positionDefenseCampaignAttackers } from './DefenseCampaignLaunch'
import type { CampaignFaction } from './CampaignConfig'

/** Resolve mounted staging slots in the existing map, with a clear route to
 * the outside of the gate. Never clamp a blocked slot into an obstacle. */
export function resolveDefenseCampaignAttackerDeployment(specs: NpcSpawnSpec[], faction: CampaignFaction,
  obstacles: readonly ObstacleData[], navigation: NavigationWorld, minimumDistance = 100): void {
  positionDefenseCampaignAttackers(specs, faction, minimumDistance)
  const outpost = getCampaignOutpostPlacement(faction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  const approach = { x: outpost.centerX, z: outpost.frontZ - inward * 12 }
  const occupied: { x: number; z: number }[] = []
  const boxes = obstacles.map(obstacle => (obstacle.navigationBox ?? obstacle.box).clone().expandByScalar(2))
  const legal = (point: { x: number; z: number }) => {
    const cell = navigation.grid.worldToCell(point)
    if (Math.abs(point.x) > PLAYABLE_WORLD_BOUND - 3 || Math.abs(point.z) > PLAYABLE_WORLD_BOUND - 3
      || (outpost.frontZ - point.z) * inward < minimumDistance
      || !cell || navigation.grid.isBlocked(cell)) return false
    if (occupied.some(slot => Math.hypot(slot.x - point.x, slot.z - point.z) < 3.6)) return false
    if (boxes.some(box => box.containsPoint(new THREE.Vector3(point.x, box.getCenter(new THREE.Vector3()).y, point.z)))) return false
    return navigation.areConnected(point, approach)
  }
  for (const spec of specs) {
    let slot: { x: number; z: number } | undefined
    for (let ring = 0; ring <= 20 && !slot; ring++) {
      for (let dx = -ring; dx <= ring && !slot; dx++) for (let dz = -ring; dz <= ring && !slot; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
        const point = { x: spec.x + dx * 4, z: spec.z + dz * 4 }
        if (legal(point)) slot = point
      }
    }
    if (!slot) throw new Error(`No legal mounted attacker staging slot: ${spec.actorId}`)
    spec.x = slot.x; spec.z = slot.z; occupied.push(slot)
  }
}
