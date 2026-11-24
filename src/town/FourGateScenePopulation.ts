import { Vector3 } from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { commanderFourGateGroundResidents, commanderFourGateMissionSquads, commanderFourGateReserveRecruits,
  FOUR_GATE_RESERVE_SQUAD, prepareFourGateGroundResident } from '../career/CommanderFourGateDefenseRoster'
import { MOUNT_BODY_HEIGHT, MOUNT_MOVEMENT_RADIUS } from '../world/MountGroundBody'
import { findBlockingObstacleAlongPath, getTerrainHeight } from '../world/Terrain'
import { architectureSpec } from './architecture/ArchitectureSpecs'
import { TOWN_CENTER } from './TownLayout'
import { townSitePoint, type TownActorSpec } from './TownRules'
import type { TownWorld } from './TownWorld'

function reservePosts(world: TownWorld, navigation: NavigationWorld) {
  const { interior, entrance } = architectureSpec(world.faction, 'town-center')
  if (!interior) throw new Error('Town Center must define an indoor deployment area')
  const y = world.civicFloorY('town-center')
  const outside = townSitePoint('hall', 0, entrance.z + entrance.approach + 8)
  // Stand across the hall in staggered ranks. A horse is 2.87 m long, and its
  // 1 m circular movement body must clear both neighbours and the open centre aisle.
  const halfLength = 1.53
  const radius = MOUNT_MOVEMENT_RADIUS + .02
  const columnSpacing = 1.8, rowSpacing = 2.08
  const posts: { x: number; y: number; z: number; yaw: number }[] = []
  for (let column = 0; 2.65 + column * columnSpacing + halfLength < interior.maxX; column++) {
    const lateral = 2.65 + column * columnSpacing
    // Fill both banks of the aisle before placing riders behind an outer rank.
    for (const sign of [-1, 1]) {
      for (let depth = -19 + (column % 2) * rowSpacing / 2; depth + radius < interior.maxZ; depth += rowSpacing) {
        if (depth - radius <= interior.minZ) continue
        const point = townSitePoint('hall', sign * lateral, depth)
        const { x, z } = point
        const cell = navigation.grid.worldToCell(point)
        if (!cell || navigation.grid.isBlocked(cell) || !navigation.areConnected(point, outside)) continue
        if (world.obstacles.some(({ box, physicalPassable, walkSurface }) => !physicalPassable && !walkSurface
          && x + halfLength > box.min.x && x - halfLength < box.max.x
          && z + radius > box.min.z && z - radius < box.max.z
          && y + 3.65 > box.min.y && y + .05 < box.max.y)) continue
        // The longhouse's post rows create narrow side bays. A mounted
        // body needs room to leave its rank towards the centre aisle.
        if (world.faction === 'viking' && findBlockingObstacleAlongPath(
          new Vector3(x, y, z), new Vector3(TOWN_CENTER.x, y, z),
          MOUNT_MOVEMENT_RADIUS + .12, MOUNT_BODY_HEIGHT, 0, world.obstacles,
        )) continue
        posts.push({ x, y, z, yaw: TOWN_CENTER.yaw - sign * Math.PI / 2 })
      }
    }
  }
  return posts
}

/** Prepare the official roster before its first NPC/mount is materialized. */
export function fourGateScenePopulation(missionId: string, population: readonly TownActorSpec[], world: TownWorld,
  navigation: NavigationWorld): TownActorSpec[] {
  const squads = commanderFourGateMissionSquads(missionId)
  const officialIds = new Set(squads.flatMap(squad => squad.actorIds))
  const reserve = squads.find(squad => squad.squadId === FOUR_GATE_RESERVE_SQUAD)!
  const posts = reservePosts(world, navigation)
  if (posts.length < reserve.actorIds.length) {
    throw new Error(`${world.faction} 城鎮中心只有 ${posts.length} 個可通行的騎乘站位，需要 ${reserve.actorIds.length} 個。`)
  }
  const reserveById = new Map(reserve.actorIds.map((id, index) => [id, posts[index]]))
  const ground = commanderFourGateGroundResidents()
  const recruits = commanderFourGateReserveRecruits(missionId)
  const residents = population.filter(spec => officialIds.has(spec.id) || spec.duty === 'eagle_garrison' || spec.duty === 'watchtower_guard')
    .map(spec => {
      const post = reserveById.get(spec.id)
      if (post) return { ...spec, ...post, mounted: true, garrison: undefined }
      const company = ground.get(spec.id)
      if (company) return prepareFourGateGroundResident(spec, company)
      return spec
    })
  for (const [index, id] of recruits.entries()) {
    residents.push({ id, index, ...reserveById.get(id)!, mounted: true, garrison: undefined,
      role: 'lancer_cavalry', unitKind: 'lancer', duty: 'gate_guard', tier: 3, training: false, assaultObjective: true })
  }
  return residents
}

/** Register the Viking hall's existing aisle and door with the shared ground follower. */
export function configureFourGateReserveExit(world: TownWorld, navigation: NavigationWorld, actorIds: readonly string[]): void {
  if (world.faction !== 'viking') return
  const { interior, entrance } = architectureSpec(world.faction, 'town-center')
  if (!interior) throw new Error('Town Center must define an indoor deployment area')
  const door = townSitePoint('hall', 0, entrance.z + entrance.approach + 2)
  navigation.townNav!.setMountedMuster({
    minX: TOWN_CENTER.x + interior.minX, maxX: TOWN_CENTER.x + interior.maxX,
    minZ: TOWN_CENTER.z + interior.minZ, maxZ: TOWN_CENTER.z + interior.maxZ,
  }, new Vector3(door.x, getTerrainHeight(door.x, door.z), door.z), actorIds)
}
