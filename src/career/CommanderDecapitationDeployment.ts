import { Box3, Vector3 } from 'three'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS, TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { TOWN_CITY } from '../town/TownLayout'
import { eagleLandingFootprint, isEagleLandingClear } from '../world/EagleLanding'
import type { ObstacleData } from '../world/Terrain'
import type { PersonalActorPosition } from './CareerPersonalSquadMission'
import type { ActiveCareerMission } from './CareerMissionState'
import type { EaglePad } from './EaglePadReservations'
import { legalDeploymentSlot, personalTownDeployment, type DeploymentBounds } from './PersonalSquadDeployment'

export interface DeploymentThreat { x: number; z: number; range: number }
export interface DecapitationDeployment {
  player: PersonalActorPosition
  official: PersonalActorPosition[]
  personal: PersonalActorPosition[]
  eaglePads: EaglePad[]
}

/** A saved position is authoritative even if Loading was interrupted before completion. */
export function needsDecapitationDeployment(mission: ActiveCareerMission): boolean {
  return mission.kind === 'commander-decapitation' && !mission.commanderMission?.deploymentComplete
    && !mission.commanderMission?.playerPosition && !mission.playerDead
}

interface DeploymentInput {
  navigation: NavigationWorld
  obstacles: readonly ObstacleData[]
  threats: readonly DeploymentThreat[]
  officialCount: number
  personalCount: number
  eagleCount: number
  playerEagle: boolean
  bounds?: DeploymentBounds
  worldBound?: number
  city?: { minZ: number }
}

const exclusion = (x: number, z: number): ObstacleData => ({
  box: new Box3(new Vector3(x - 2, -100, z - 2), new Vector3(x + 2, 100, z + 2)), isBarricade: false,
})

/** Data-only placement on the existing Town topology; no actors, paths or spawn jobs are created.
 * Reserve full eagle envelopes first, then the mounted formation and HR slots as one plan.
 * Never relax threat/obstacle checks to make a partial roster fit.
 */
export function planDecapitationDeployment(input: DeploymentInput): DecapitationDeployment {
  const { navigation, obstacles, threats } = input
  const source = input.bounds ?? TOWN_NAVIGATION_BOUNDS, bound = input.worldBound ?? TOWN_PLAYABLE_WORLD_BOUND
  const north = Math.max(source.minZ, -bound)
  const city = input.city ?? TOWN_CITY
  const bounds = { minX: Math.max(source.minX, -bound), maxX: Math.min(source.maxX, bound), minZ: north,
    maxZ: Math.min(source.maxZ, north + (city.minZ - north) / 2) }
  // The closed gate is a destination, not a traversable cell; prove connectivity to its exterior.
  const gate = { x: 0, z: city.minZ - 12, yaw: 0 }
  const safe = (p: PersonalActorPosition) => {
    const cell = navigation.grid.worldToCell(p)
    return p.x >= bounds.minX + 3 && p.x <= bounds.maxX - 3 && p.z >= bounds.minZ + 3 && p.z <= bounds.maxZ - 3
      && Boolean(cell && !navigation.grid.isBlocked(cell))
      && threats.every(threat => Math.hypot(p.x - threat.x, p.z - threat.z) > threat.range + 8)
  }
  let reason = 'no connected, clear player position outside opening threat ranges'
  // Keep the player near the northern edge. Shift along that edge before moving inward.
  for (const inset of [15, 20, 25, 30, 35, 40, 45]) {
    for (let column = 0; column <= Math.ceil((bounds.maxX - bounds.minX) / 5); column++) {
      const x = (column % 2 ? 1 : -1) * Math.ceil(column / 2) * 10
      const player = { x, z: north + inset, yaw: Math.atan2(-x, gate.z - north - inset) }
      // Formation faces north gate; the edge-aligned rows leave its forward route open.
      if (!safe(player) || !legalDeploymentSlot(player, [], bounds, obstacles, navigation, gate)) continue
      const pads: EaglePad[] = []
      if (input.playerEagle) {
        if (!isEagleLandingClear(player, obstacles, [], bound)) continue
        pads.push({ ...player, id: 'private-eagle-pad:1' })
      }
      // Ground occupants use their real body clearance, not another eagle's wing span.
      const padObstacles = input.playerEagle ? obstacles : [...obstacles, exclusion(player.x, player.z)]
      for (let row = 0; row < 16 && pads.length < input.eagleCount; row++) {
        for (let col = 0; col < 39 && pads.length < input.eagleCount; col++) {
          const point = { x: player.x + (col % 2 ? 1 : -1) * Math.ceil(col / 2) * 6,
            z: north + 10 + row * 6, yaw: 0 }
          const footprint = eagleLandingFootprint(point)
          if (point.z > player.z + 20 || !safe(point)
            || footprint.min.x < bounds.minX || footprint.max.x > bounds.maxX
            || footprint.min.z < bounds.minZ || footprint.max.z > bounds.maxZ
            || !isEagleLandingClear(point, padObstacles, pads, bound)
            || !navigation.areConnected(gate, point)) continue
          pads.push({ ...point, id: `private-eagle-pad:${pads.length + 1}` })
        }
      }
      if (pads.length !== input.eagleCount) { reason = 'insufficient safe eagle landing envelopes'; continue }
      const groundObstacles = [...obstacles, ...pads.map(pad => ({ box: eagleLandingFootprint(pad), isBarricade: false }))]
      const official: PersonalActorPosition[] = []
      const formationSlots: PersonalActorPosition[] = []
      for (let z = player.z + 8; z <= bounds.maxZ - 3; z += 6) {
        for (let col = -18; col <= 18; col++) {
          const point = { x: x - 12.5 + col * 5, z, yaw: player.yaw }
          if (safe(point) && legalDeploymentSlot(point, [player], bounds, groundObstacles, navigation, gate)) formationSlots.push(point)
        }
      }
      for (let index = 0; index < input.officialCount; index++) {
        const desired = { x: x + (index % 6 - 2.5) * 5, z: player.z + 35 - Math.floor(index / 6) * 6, yaw: player.yaw }
        formationSlots.sort((a, b) => (a.x - desired.x) ** 2 + (a.z - desired.z) ** 2 - (b.x - desired.x) ** 2 - (b.z - desired.z) ** 2)
        const found = formationSlots.shift()
        if (!found) break
        official.push(found)
      }
      if (official.length !== input.officialCount) { reason = 'insufficient safe mounted formation slots'; continue }
      for (const rearOnly of [true, false]) {
        try {
          const personal = personalTownDeployment(player, official, input.personalCount, bounds, groundObstacles,
            navigation, point => (!rearOnly || point.z <= player.z + 4)
              && Math.hypot(point.x - player.x, point.z - player.z) <= 90 && safe(point))
          return { player, official, personal, eaglePads: pads }
        } catch { reason = 'insufficient safe HR slots near the player' }
      }
      // Rings can waste the small gaps between eagle envelopes. Pack remaining
      // HR on the formation's lattice using the same mounted clearance owner.
      const personal: PersonalActorPosition[] = []
      for (let row = -8; row < 16 && personal.length < input.personalCount; row++) {
        for (let col = -18; col <= 18 && personal.length < input.personalCount; col++) {
          const point = { x: x - 12.5 + col * 5, z: player.z + 8 + row * 6, yaw: player.yaw }
          if (Math.hypot(point.x - player.x, point.z - player.z) > 90 || !safe(point)
            || !legalDeploymentSlot(point, [player, ...official, ...personal], bounds, groundObstacles, navigation, gate)) continue
          personal.push(point)
        }
      }
      if (personal.length === input.personalCount) return { player, official, personal, eaglePads: pads }
    }
  }
  throw new Error(`Commander Decapitation deployment failed: ${reason}; northern bounds, obstacles, connectivity and threat clearance were not relaxed`)
}
