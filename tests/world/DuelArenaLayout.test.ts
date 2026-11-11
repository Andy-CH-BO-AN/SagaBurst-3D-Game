import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  COLOSSEUM, COLOSSEUM_STAIRS, colosseumNormal, colosseumPoint, colosseumStairPlan, createColosseumObstacles,
} from '../../src/arena/ColosseumLayout'
import { createValhallaObstacles, VALHALLA } from '../../src/arena/ValhallaLayout'
import { DUEL_ARENA_IDS, parseDuelArenaId } from '../../src/arena/DuelArena'
import { resolveDuelArenaPreviewSetup } from '../../src/debug/DuelArenaPreview'
import { ArenaChaseRoute, ArenaSupportTracker, arenaStairLinks, arenaStandingFeet } from '../../src/arena/DuelArenaChase'
import { ARENA_DUEL_REFEREE_SLOTS } from '../../src/arena/DuelArenaVenue'
import { arenaDuelPartyPlan } from '../../src/arena/CareerDuelArenaScene'
import { FallingRider } from '../../src/movement/FallingRider'
import { ARENA_GROUND_FALL_POLICY, groundFallDamage, GroundFallTracker } from '../../src/movement/GroundFall'
import { Player } from '../../src/player/Player'
import {
  claimFlatTerrainOverride, findBlockingObstacleAlongPath, getFlatTerrainOverride, getTerrainHeight, getWalkRampHeight,
  releaseFlatTerrainOverride, resetTerrainScenePolicy, resolveObstacleCollision,
} from '../../src/world/Terrain'

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

  it('hands an airborne ground-mount fall to the dismounted rider and keeps grounded dismounts harmless', () => {
    // Narrow ports drive the real Player mount/dismount methods; no Player, Mount or scene is constructed.
    const methods = Player.prototype as unknown as {
      mountVehicle(this: object, mount: object, heading?: number): void
      dismountFromMount(this: object, options?: { preserveWorldPosition?: boolean }): void
      setMountedHeading(this: object, heading: number): void
    }
    const horse = {
      group: { position: new THREE.Vector3(0, 21.2, 0), rotation: new THREE.Euler() },
      isFlyingMount: false, isAirborne: false, dead: false, disposed: false, riderNpc: null, riderPlayer: null as object | null,
      onGround: false, velY: -9,
      setPlayerRider(player: object) { this.riderPlayer = player },
      releaseRider() { this.riderPlayer = null },
    }
    const rider = {
      unarmedDuelOnly: false, isDead: false, isFalling: false, spectatorOnly: false, isMounted: false, onGround: true,
      currentMount: null as typeof horse | null, facingYaw: 0, velY: 0,
      group: { position: new THREE.Vector3(), rotation: new THREE.Euler() }, fallFeet: new THREE.Vector3(),
      rig: { equipmentGripFrames: {} }, animator: { setLocomotion() {} },
      footGroundFall: new GroundFallTracker(), mountGroundFall: new GroundFallTracker(),
      setMountedHeading: methods.setMountedHeading,
      _characterYaw: (heading: number) => heading, _alignExternalVisualToMount() {},
    }
    const ride = () => {
      methods.mountVehicle.call(rider, horse)
      rider.mountGroundFall.observe(19.2, true) // Grounded on the gallery: nothing in progress.
      rider.mountGroundFall.observe(horse.group.position.y, false) // Ridden off the parapet, still high.
    }
    ride()
    // A repeated mountVehicle() for the mount already ridden keeps the fall in progress.
    methods.mountVehicle.call(rider, horse)
    expect(rider.mountGroundFall.observe(0, true)).toBeCloseTo(21.2)
    ride()
    // E pressed mid-fall: the rider keeps falling at the mount's speed from the gallery apex.
    methods.dismountFromMount.call(rider)
    expect([rider.currentMount, rider.onGround, rider.velY]).toEqual([null, false, -9])
    expect(rider.group.position.y).toBeCloseTo(21.2 + 0.95, 5) // At the mount's feet plus half height, never teleported.
    const landing = rider.footGroundFall.observe(0, true)!
    expect(landing).toBeCloseTo(21.2)
    expect(groundFallDamage(150, landing, ARENA_GROUND_FALL_POLICY)).toBe(150)
    // Catching the mount again mid-air does not erase the fall either.
    rider.footGroundFall.observe(18, false)
    rider.onGround = false
    horse.onGround = false
    methods.mountVehicle.call(rider, horse)
    expect(rider.mountGroundFall.observe(0, true)).toBeCloseTo(21.2)
    // A dismount on solid ground clears both trackers and the vertical speed.
    methods.dismountFromMount.call(rider)
    horse.onGround = true
    ride()
    horse.velY = 0
    methods.dismountFromMount.call(rider)
    expect([rider.velY, rider.footGroundFall.observe(0, true), rider.mountGroundFall.observe(0, true)]).toEqual([0, null, null])
  })

  it('lets only the arena that owns the flat-ground policy release it, so a late dispose keeps the newer arena', () => {
    resetTerrainScenePolicy()
    const procedural = getTerrainHeight(140, 90)
    expect(Math.abs(procedural)).toBeGreaterThan(0.01)
    const colosseum = {}, valhalla = {}
    claimFlatTerrainOverride(colosseum, 0)
    claimFlatTerrainOverride(valhalla, 0) // A → B: the second arena replaces the first.
    releaseFlatTerrainOverride(colosseum) // The replaced arena disposes late.
    expect([getFlatTerrainOverride(), getTerrainHeight(140, 90)]).toEqual([0, 0])
    releaseFlatTerrainOverride(valhalla) // Leaving the last arena restores the battlefield.
    expect([getFlatTerrainOverride(), getTerrainHeight(140, 90)]).toEqual([null, procedural])
    releaseFlatTerrainOverride(valhalla)
    expect(getFlatTerrainOverride()).toBeNull()
  })

  it('keeps a pursuer on its chosen stair until the far end instead of ending the route mid-flight', () => {
    const route = new ArenaChaseRoute('roman-colosseum')
    expect(route.next({ x: 0, y: 0, z: 9 }, { x: 3, y: 0, z: -4 })).toBeNull()
    const player = { x: 9.5, y: 17.9, z: 36 } // Top gallery above the +Z stair.
    const link = arenaStairLinks('roman-colosseum').find(candidate => candidate.low.x === 9.5 && candidate.low.z > 0)!
    const approach = route.next({ x: 0, y: 0, z: 9 }, player)!
    expect(approach.x).toBeCloseTo(9.5)
    expect(approach.z).toBeLessThan(link.low.z) // In front of the flight, never beside its solid sides.
    const mouth = route.next({ x: approach.x, y: 0, z: approach.z }, player)!
    expect(mouth.z).toBeGreaterThan(link.low.z)
    // Drifting back past the approach radius does not flip the target back and forth.
    expect(route.next({ x: 9.5, y: 0, z: approach.z - 1.5 }, player)).toEqual(mouth)
    // Halfway up (1.3 m, already "raised") the route still climbs to the landing.
    for (const y of [0.6, 1.3, 2.2]) expect(route.next({ x: 9.5, y, z: (link.low.z + link.high.z) / 2 }, player), `y ${y}`).toEqual(link.high)
    expect(route.active).toBe(true)
    // At the landing, ordinary pursuit takes over for the continuous stands.
    expect(route.next({ x: 9.5, y: 2.6, z: link.high.z + 0.3 }, player)).toBeNull()
    expect(route.active).toBe(false)
    // Coming down, the landing end is the entry and the sand end the exit, even below 1.2 m.
    expect(route.next({ x: 9.5, y: 2.6, z: link.high.z - 0.5 }, { x: 0, y: 0, z: 0 })).toEqual(link.low)
    expect(route.next({ x: 9.5, y: 0.8, z: (link.low.z + link.high.z) / 2 }, { x: 0, y: 0, z: 0 })).toEqual(link.low)
    // The target climbing back up re-plans from the flight: the chaser turns to the landing.
    expect(route.next({ x: 9.5, y: 1.3, z: (link.low.z + link.high.z) / 2 }, player)).toEqual(link.high)
    route.reset()
    const hall = new ArenaChaseRoute('viking-valhalla')
    const dais = { x: 0, y: 3, z: 31 }
    const [throne] = arenaStairLinks('viking-valhalla')
    hall.next({ x: 0, y: 0, z: 0 }, dais)
    expect(hall.next({ x: 0, y: 0, z: throne.low.z - 1 }, dais)!.z).toBeGreaterThan(throne.low.z)
    expect(hall.next({ x: 0, y: 1.5, z: (throne.low.z + throne.high.z) / 2 }, dais)).toEqual(throne.high)
    expect(hall.next({ x: 0, y: 3, z: throne.high.z + 0.2 }, dais)).toBeNull()
    // Standing on the landing beside its far end never re-opens the route frame to frame.
    for (const x of [1.1, 1.2, 1.3]) expect([hall.next({ x, y: 3, z: throne.high.z + 0.1 }, dais), hall.active]).toEqual([null, false])
  })

  it('judges a rider by its ground mount, not by pelvis height, so a floor-level rider is never sent up the stairs', () => {
    const riderPelvis = { x: 0, y: 2.6, z: 5 } // Seat height: far above the 1.2 m raised threshold
    const floorMount = { x: 0, y: 0, z: 5 }
    for (const id of ['roman-colosseum', 'viking-valhalla'] as const) {
      const raised = arenaStairLinks(id)[0].topY
      expect(new ArenaChaseRoute(id).next({ x: 0, y: 0, z: -4 }, arenaStandingFeet(riderPelvis, floorMount, 0.95)), id).toBeNull()
      expect(new ArenaChaseRoute(id).next({ x: 0, y: 0, z: -4 }, arenaStandingFeet({ ...riderPelvis, y: raised + 1.6 }, { ...floorMount, y: raised }, 0.95)), id).not.toBeNull()
    }
    expect(arenaStandingFeet({ x: 1, y: 0.95, z: 2 }, null, 0.95)).toEqual({ x: 1, y: 0, z: 2 })
  })

  it('keeps the support level while airborne: a floor jump never reads as raised, a dais jump stays raised', () => {
    const floor = new ArenaSupportTracker()
    floor.observe({ x: 0, y: 0, z: 5 }, true)
    const jump = floor.observe({ x: 0, y: 4.7, z: 5 }, false) // Mounted jump apex, above both raised levels
    expect([jump.y, new ArenaChaseRoute('viking-valhalla').next({ x: 0, y: 0, z: -4 }, jump)]).toEqual([0, null])
    const dais = new ArenaSupportTracker()
    dais.observe({ x: 0, y: 3, z: 33 }, true)
    const leap = dais.observe({ x: 0, y: 4.5, z: 33 }, false)
    expect(new ArenaChaseRoute('viking-valhalla').next({ x: 0, y: 0, z: -4 }, leap)).not.toBeNull()
    expect(dais.observe({ x: 0, y: 0, z: 20 }, true).y).toBe(0) // Landing on the floor updates the level.
  })

  it('builds the bodies each saved duel borrowed and keeps the referee off the obstacles beside the duel lane', () => {
    const base = { duelCaptainActorId: 'captain', duelMode: 'armed' as const }
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'roman_sword_cavalry', duelTier: 2, duelOpponentActorId: 'cavalry-training:melee_cavalry:0', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'ordinary', opponentBorrowsMount: true, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'roman_horse_archer', duelTier: 4, duelOpponentActorId: 'ranger', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'ranger', opponentBorrowsMount: false, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'viking_berserker', duelTier: 4, duelOpponentActorId: 'captain', duelRefereeActorId: 'ranger' }))
      .toEqual({ opponent: 'captain', opponentBorrowsMount: true, referee: 'ranger', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelPresetId: 'viking_heavy_cavalry', duelTier: 5, duelOpponentActorId: 'commander', duelRefereeActorId: 'captain' }))
      .toEqual({ opponent: 'commander', opponentBorrowsMount: false, referee: 'captain', captain: false })
    expect(arenaDuelPartyPlan({ ...base, duelMode: 'unarmed', duelPresetId: 'roman_sword_cavalry', duelTier: 1, duelOpponentActorId: 'soldier', duelRefereeActorId: 'captain' }).opponentBorrowsMount).toBe(false)
    const shell = { colosseum: createColosseumObstacles(), valhalla: createValhallaObstacles() }
    for (const [id, obstacles] of [['roman-colosseum', shell.colosseum], ['viking-valhalla', shell.valhalla]] as const) {
      const slot = ARENA_DUEL_REFEREE_SLOTS[id]
      const point = new THREE.Vector3(slot.x, slot.y + 0.9, slot.z)
      expect(obstacles.some(obstacle => !obstacle.walkSurface && obstacle.box.clone().expandByScalar(0.5).containsPoint(point)), id).toBe(false)
      expect(Math.abs(slot.x)).toBeGreaterThan(5) // Beside, never inside, the player/opponent lane.
    }
  })
})
