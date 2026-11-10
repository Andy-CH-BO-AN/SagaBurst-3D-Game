import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  COLOSSEUM, COLOSSEUM_STAIRS, colosseumNormal, colosseumPoint, colosseumStairPlan, createColosseumObstacles,
} from '../../src/arena/ColosseumLayout'
import { createValhallaObstacles, VALHALLA } from '../../src/arena/ValhallaLayout'
import { DUEL_ARENA_IDS, parseDuelArenaId } from '../../src/arena/DuelArena'
import { resolveDuelArenaPreviewSetup } from '../../src/debug/DuelArenaPreview'
import { FallingRider } from '../../src/movement/FallingRider'
import { ARENA_GROUND_FALL_POLICY, groundFallDamage, GroundFallTracker } from '../../src/movement/GroundFall'
import { findBlockingObstacleAlongPath, getWalkRampHeight, resolveObstacleCollision } from '../../src/world/Terrain'

// Numeric layout data only: no scene, mesh, material or arena visuals are built.
const PLAYER = { radius: 0.38, height: 1.9 }

describe('duel arena layout collision', () => {
  it('connects the Colosseum sand to the 17.9 m top gallery through stairs and continuous stands, including sector seams', () => {
    const obstacles = createColosseumObstacles()
    const stair = colosseumStairPlan(COLOSSEUM_STAIRS[0])
    expect(getWalkRampHeight(stair.surface, stair.stair.x, stair.lowZ + stair.stair.side * 0.01)).toBeCloseTo(0, 1)
    expect(getWalkRampHeight(stair.surface, stair.stair.x, stair.endZ - stair.stair.side * 0.05)).toBe(2.6)

    // Walk outward from the terrace edge to the gallery at sector-seam and mid-sector angles
    // (the Imperial box at +Z is a solid balcony, so its sector is not part of this walk).
    for (const theta of [0, 20, 37.5, 44].map(sector => sector / 64 * Math.PI * 2)) {
      const previous = colosseumPoint(theta, 0.6)
      previous.y = 2.6
      let lastY = previous.y
      for (let d = 1; d <= 37; d += 0.4) {
        const position = colosseumPoint(theta, d)
        position.y = lastY - 0.02
        const result = resolveObstacleCollision(position, previous, -0.5, false, PLAYER.radius, PLAYER.height, 0, obstacles, { walkSurfaces: true })
        expect(result.onGround, `theta ${theta.toFixed(3)} d ${d.toFixed(1)}`).toBe(true)
        // Seating rise is 0.45 per 0.8 m: never a hidden step, gap or drop along the walk.
        expect(position.y - lastY).toBeGreaterThan(-0.05)
        expect(position.y - lastY).toBeLessThan(0.3)
        lastY = position.y
        previous.copy(position)
      }
      expect(lastY).toBeCloseTo(17.9, 5)
    }
  })

  it('lets a jump over the outer parapet complete a lethal fall to the outside ground without an invisible wall', () => {
    const obstacles = createColosseumObstacles()
    const theta = -Math.PI / 2 + 0.3
    const normal = colosseumNormal(theta)
    // Feet just above the parapet coping with a running jump's outward velocity.
    const feet = colosseumPoint(theta, 37.7)
    feet.y = 19.05
    const rider = new FallingRider({ radius: PLAYER.radius, height: PLAYER.height })
    rider.begin(feet, new THREE.Vector3(normal.x * 8, 4, normal.z * 8))
    const tracker = new GroundFallTracker()
    tracker.observe(19, true)
    let landed: number | null = null
    let trackedHeight: number | null = null
    for (let frame = 0; frame < 300 && landed === null; frame++) {
      landed = rider.update(feet, 1 / 60, obstacles, 500, () => COLOSSEUM.groundY)
      trackedHeight = tracker.observe(feet.y, landed !== null)
    }
    expect(feet.y).toBe(0)
    // Landed beyond the outer facade on open ground: nothing stopped the outward flight.
    const outward = (feet.x - colosseumPoint(theta, 38).x) * normal.x + (feet.z - colosseumPoint(theta, 38).z) * normal.z
    expect(outward).toBeGreaterThan(5)
    expect(landed).toBeGreaterThanOrEqual(15)
    expect(trackedHeight).toBeCloseTo(landed!, 1)
    expect(groundFallDamage(150, trackedHeight!, ARENA_GROUND_FALL_POLICY)).toBe(150)
    // The podium drop (2.6 m) and a jump from it stay harmless; mid falls scale linearly.
    expect(groundFallDamage(150, 2.6 + 1.84, ARENA_GROUND_FALL_POLICY)).toBe(0)
    expect(groundFallDamage(150, 10.5, ARENA_GROUND_FALL_POLICY)).toBeCloseTo(75)
  })

  it('keeps Valhöll bodies inside the hall walls and leaves the central fighting lane unobstructed', () => {
    const obstacles = createValhallaObstacles()
    const centre = new THREE.Vector3(0, 0, -5)
    const targets: [number, number][] = [[0, -80], [60, -5], [-60, -5], [60, -80], [-60, 70], [14, 70]]
    for (const [x, z] of targets) {
      for (const y of [0, 1.84]) {
        const previous = new THREE.Vector3(centre.x, y, centre.z)
        const position = new THREE.Vector3(x, y, z)
        // Long sweeps (well past a wall) take a few frames of sliding; each keeps the body inside.
        for (let frame = 0; frame < 6; frame++) {
          resolveObstacleCollision(position, previous, 0, y === 0, PLAYER.radius, PLAYER.height, 0, obstacles, { walkSurfaces: true })
          previous.copy(position)
          position.set(position.x + Math.sign(x) * 4, y, position.z + Math.sign(z - centre.z) * 4)
        }
        expect(Math.abs(previous.x), `${x},${z},${y}`).toBeLessThan(VALHALLA.halfWidth)
        expect(previous.z, `${x},${z},${y}`).toBeGreaterThan(VALHALLA.frontZ)
        expect(previous.z, `${x},${z},${y}`).toBeLessThan(VALHALLA.backZ)
      }
    }
    for (const x of [-9.5, 0, 9.5]) {
      const start = new THREE.Vector3(x, 0, VALHALLA.frontZ + 3)
      const end = new THREE.Vector3(x, 0, VALHALLA.stair.lowZ - 0.5)
      expect(findBlockingObstacleAlongPath(start, end, PLAYER.radius, PLAYER.height, 0, obstacles)).toBeNull()
    }
  })

  it('resolves the DEV preview route and arena IDs without accepting unknown arenas', () => {
    expect(DUEL_ARENA_IDS).toEqual(['roman-colosseum', 'viking-valhalla'])
    expect(parseDuelArenaId('viking-valhalla')).toBe('viking-valhalla')
    expect(parseDuelArenaId('valhalla')).toBeNull()
    expect(resolveDuelArenaPreviewSetup(new URLSearchParams('duelarena=roman&nolock'))).toEqual({ arena: 'roman-colosseum', faction: 'roman' })
    expect(resolveDuelArenaPreviewSetup(new URLSearchParams('duelarena=valhalla&faction=roman'))).toEqual({ arena: 'viking-valhalla', faction: 'roman' })
    // Unknown arenas fall through to the normal entry flow.
    expect(resolveDuelArenaPreviewSetup(new URLSearchParams('duelarena=forum'))).toBeNull()
  })
})
