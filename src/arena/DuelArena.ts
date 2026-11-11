import * as THREE from 'three'
import { ArenaResources } from './ArenaKit'
import {
  COLOSSEUM, COLOSSEUM_SAFETY_BOUND, COLOSSEUM_SPAWNS, constrainToColosseumApron, createColosseumObstacles,
} from './ColosseumLayout'
import {
  VALHALLA, VALHALLA_SAFETY_BOUND, VALHALLA_SPAWNS, constrainToValhallaHall, createValhallaObstacles,
} from './ValhallaLayout'
import { buildColosseumVisuals } from './RomanColosseum'
import { buildValhallaVisuals } from './VikingValhalla'
import { ARENA_GROUND_FALL_POLICY, setSceneGroundFallPolicy } from '../movement/GroundFall'
import {
  claimFlatTerrainOverride, releaseFlatTerrainOverride, setObstaclePathQuerySource, setScenePlayableWorldBound, type ObstacleData,
} from '../world/Terrain'

export type DuelArenaId = 'roman-colosseum' | 'viking-valhalla'

export const DUEL_ARENA_IDS: readonly DuelArenaId[] = Object.freeze(['roman-colosseum', 'viking-valhalla'])

export const DUEL_ARENA_LABELS: Readonly<Record<DuelArenaId, string>> = Object.freeze({
  'roman-colosseum': '羅馬競技場',
  'viking-valhalla': '維京英靈殿',
})

export function parseDuelArenaId(value: unknown): DuelArenaId | null {
  return typeof value === 'string' && (DUEL_ARENA_IDS as readonly string[]).includes(value) ? value as DuelArenaId : null
}

/** DEV preview aliases (`?duelarena=roman|valhalla`) plus the canonical IDs. */
export function parseDuelArenaPreviewQuery(value: string | null): DuelArenaId | null {
  if (value === 'roman' || value === 'colosseum') return 'roman-colosseum'
  if (value === 'valhalla' || value === 'viking' || value === 'valholl') return 'viking-valhalla'
  return parseDuelArenaId(value)
}

export interface DuelArenaSpawn { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }

/**
 * A standalone duel environment. Lifecycle: create (build geometry and install
 * scene policies) → update(dt) each frame → dispose() exactly once.
 *
 * Interface contract:
 * - Create the arena before any Player/NPC/Mount for the same scene: actors
 *   read the scene's playable bound and ground-fall rule at construction.
 * - Only one arena may own the flat ground at a time; dispose() restores the
 *   procedural ground only if it still owns it.
 * - `obstacles` is a stable array owned by the arena (walls, stands, stairs,
 *   props); pass it to movement, camera and projectile queries unchanged.
 * - dispose() releases arena-owned geometry, materials, textures and lights,
 *   never shared character/mount/procedural resources.
 */
export interface DuelArenaEnvironment {
  readonly id: DuelArenaId
  readonly root: THREE.Group
  readonly obstacles: ObstacleData[]
  readonly spawns: { readonly player: DuelArenaSpawn; readonly opponent: DuelArenaSpawn }
  /** Keeps a living, grounded body inside the arena's ground boundary. Returns true when it moved. */
  constrainGroundedBody(position: THREE.Vector3): boolean
  update(dt: number): void
  dispose(): void
  readonly disposed: boolean
}

interface ArenaScenePolicy {
  background: THREE.Color | THREE.Texture | null
  fog: THREE.Fog | THREE.FogExp2 | null
}

export function createDuelArena(id: DuelArenaId, scene: THREE.Scene): DuelArenaEnvironment {
  const resources = new ArenaResources()
  const previous: ArenaScenePolicy = { background: scene.background as THREE.Color | THREE.Texture | null, fog: scene.fog }
  const groundY = id === 'roman-colosseum' ? COLOSSEUM.groundY : VALHALLA.groundY
  /** Identity of this arena's claim on the shared flat-ground policy. */
  const groundOwner = {}
  let disposed = false
  let root: THREE.Group | undefined
  let obstacles: ObstacleData[] = []
  const release = (): void => {
    if (disposed) return
    disposed = true
    root?.removeFromParent()
    setObstaclePathQuerySource(obstacles, false)
    resources.dispose()
    releaseFlatTerrainOverride(groundOwner)
    setSceneGroundFallPolicy(scene, null)
    scene.background = previous.background
    scene.fog = previous.fog
  }
  try {
    claimFlatTerrainOverride(groundOwner, groundY)
    let update: (dt: number) => void
    let constrain: (position: THREE.Vector3) => boolean
    let spawns: DuelArenaEnvironment['spawns']
    if (id === 'roman-colosseum') {
      const visuals = buildColosseumVisuals(resources)
      root = visuals.root
      update = visuals.update
      obstacles = createColosseumObstacles()
      constrain = constrainToColosseumApron
      spawns = COLOSSEUM_SPAWNS
      setScenePlayableWorldBound(scene, COLOSSEUM_SAFETY_BOUND)
      setSceneGroundFallPolicy(scene, ARENA_GROUND_FALL_POLICY)
      scene.background = new THREE.Color(0x9cc2e0)
      scene.fog = new THREE.Fog(0xd6d9d6, 150, 620)
    } else {
      const visuals = buildValhallaVisuals(resources)
      root = visuals.root
      update = visuals.update
      obstacles = createValhallaObstacles()
      constrain = position => constrainToValhallaHall(position)
      spawns = VALHALLA_SPAWNS
      setScenePlayableWorldBound(scene, VALHALLA_SAFETY_BOUND)
      setSceneGroundFallPolicy(scene, ARENA_GROUND_FALL_POLICY)
      scene.background = new THREE.Color(0x0b0908)
      scene.fog = new THREE.Fog(0x1d1712, 34, 120)
    }
    setObstaclePathQuerySource(obstacles, true)
    scene.add(root)
    const arenaRoot = root
    const arenaObstacles = obstacles
    return {
      id,
      root: arenaRoot,
      obstacles: arenaObstacles,
      spawns,
      constrainGroundedBody: position => !disposed && constrain(position),
      update: dt => { if (!disposed && dt > 0) update(dt) },
      dispose: release,
      get disposed() { return disposed },
    }
  } catch (error) {
    release()
    throw error
  }
}
