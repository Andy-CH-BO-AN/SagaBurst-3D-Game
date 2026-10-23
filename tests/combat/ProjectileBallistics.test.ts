import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BallisticIntercept, collectBallisticPathObstacles, projectileTerrainContactTime } from '../../src/combat/ProjectileBallistics'
import { ProjectileAdmission, projectileAmmoAfterLaunch } from '../../src/combat/ProjectileAdmission'
import { findBlockingProjectileObstacleAlongPath, getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
import { TownProjectileObstacles } from '../../src/town/TownProjectileObstacles'
import { ProjectileContactQuery } from '../../src/combat/ProjectileContactQuery'
import type { PhysicalCombatTarget } from '../../src/combat/ShieldBlocking'
import type { DamageableObstacle } from '../../src/world/DamageableObstacle'

describe('projectile launch admission', () => {
  it('retains ammo on capacity rejection and accepts the next shot when a slot is free', () => {
    const admission = new ProjectileAdmission(2, 1), shots: { training: boolean }[] = []
    const fire = (training: boolean) => admission.launch(shots.length,
      shots.filter(shot => shot.training).length, training, () => { shots.push({ training }) })
    let ammo = 3
    ammo = projectileAmmoAfterLaunch(ammo, fire(true))
    expect(ammo).toBe(2)
    ammo = projectileAmmoAfterLaunch(ammo, fire(true))
    expect(ammo).toBe(2)
    expect(shots).toHaveLength(1)
    ammo = projectileAmmoAfterLaunch(ammo, fire(false))
    expect(ammo).toBe(1)
    ammo = projectileAmmoAfterLaunch(ammo, fire(false))
    expect(ammo).toBe(1)
    expect(shots).toHaveLength(2)
    shots.shift()
    ammo = projectileAmmoAfterLaunch(ammo, fire(false))
    expect(ammo).toBe(0)
    expect(shots).toHaveLength(2)
    expect(admission.snapshot()).toEqual({ acceptedShots: 3, rejectedShots: 2,
      capacityRejectedShots: 2, peakActiveShots: 2 })
  })

  it('keeps legacy void launches successful while explicit scene rejection preserves ammo', () => {
    const admission = new ProjectileAdmission(2, 1)
    const legacyLaunch = (): void => {}
    expect(projectileAmmoAfterLaunch(2, legacyLaunch())).toBe(1)
    expect(projectileAmmoAfterLaunch(2, admission.reject())).toBe(2)
    expect(admission.snapshot()).toEqual({ acceptedShots: 0, rejectedShots: 1,
      capacityRejectedShots: 0, peakActiveShots: 0 })
  })
})

/** Pure kinematics and swept-path policy: no actors, mounts, assets or scene fixture. */
describe('bounded projectile interception and arc clearance', () => {

  it('refuses an unreachable elevated target even inside the 200m engagement sphere', () => {
    const origin = new THREE.Vector3(), target = new THREE.Vector3(0, 90, 170)
    expect(origin.distanceTo(target)).toBeLessThan(200)
    const arc = new BallisticIntercept()
    expect(arc.solve(origin, target, new THREE.Vector3(), 45)).toBe(false)
    expect(arc.flightTime).toBe(0)
  })

  it('leads a moving aerial target with unchanged launch speed and gravity', () => {
    const origin = new THREE.Vector3(0, 30, 0), target = new THREE.Vector3(0, 40, 280)
    const velocity = new THREE.Vector3(20, 3, 0), arc = new BallisticIntercept()
    expect(arc.solve(origin, target, velocity, 65)).toBe(true)
    expect(arc.direction.x).toBeGreaterThan(0)
    const hit = origin.clone().addScaledVector(arc.direction, 65 * arc.flightTime)
    hit.y -= 4.9 * arc.flightTime ** 2
    expect(hit.distanceTo(target.clone().addScaledVector(velocity, arc.flightTime))).toBeLessThan(1e-6)
  })

  it('sweeps a thin wall between trajectory samples', () => {
    const origin = new THREE.Vector3(0, 31.4, -200), arc = new BallisticIntercept()
    const target = new THREE.Vector3(0, 1.4, 200)
    expect(arc.solve(origin, target, new THREE.Vector3(), 65)).toBe(true)
    const t = arc.direction.y * 65 / 9.8
    const wallPoint = origin.clone().addScaledVector(arc.direction, 65 * t)
    wallPoint.y -= 4.9 * t * t
    const wall: ObstacleData = { isBarricade: true, box: new THREE.Box3(
      new THREE.Vector3(-5, wallPoint.y - .08, wallPoint.z - .005),
      new THREE.Vector3(5, wallPoint.y + .08, wallPoint.z + .005),
    ) }
    expect(wall.box.min.y).toBeGreaterThan(Math.max(origin.y, target.y))
    expect(arc.isPathClear(origin, 65, [wall], () => 0)).toBe(false)
    expect(arc.isPathClear(origin, 65, [], () => 0)).toBe(true)
  })
  it('blocks a terrain ridge between trajectory samples', () => {
    const origin = new THREE.Vector3(0, 31.4, -200), arc = new BallisticIntercept()
    expect(arc.solve(origin, new THREE.Vector3(0, 1.4, 200), new THREE.Vector3(), 65)).toBe(true)
    expect(arc.isPathClear(origin, 65, [], (_x, z) => Math.abs(z) < 10 ? 150 : 0)).toBe(false)
  })

})


describe('shared terrain first contact', () => {
  it('blocks a ridge between two above-ground frame endpoints', () => {
    const from = new THREE.Vector3(-100, 1.5, 0), to = new THREE.Vector3(100, 1.5, 0)
    expect(from.y).toBeGreaterThan(getTerrainHeight(from.x, from.z))
    expect(to.y).toBeGreaterThan(getTerrainHeight(to.x, to.z))
    const time = projectileTerrainContactTime(from, to)
    expect(time).toBeGreaterThan(0)
    expect(time).toBeLessThan(1)
    const contact = from.clone().lerp(to, time)
    expect(contact.y).toBeCloseTo(getTerrainHeight(contact.x, contact.z) + .05, 2)
  })
})


describe('finite projectile obstacle trace', () => {
  it('preserves open slab gaps, nearest strict ordering and the winning point while rejecting remote segments', () => {
    const solid = (x: number): ObstacleData => ({ isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(x, -1, -1), new THREE.Vector3(x + .2, 1, 1)) })
    const gap = solid(1)
    gap.projectileBoxes = [new THREE.Box3(new THREE.Vector3(1, .5, -1), new THREE.Vector3(1.2, 1, 1))]
    const first = solid(2), tie = solid(2), farther = solid(3), beyond = solid(8)
    const from = new THREE.Vector3(), to = new THREE.Vector3(4, 0, 0)
    const contact = { fraction: Infinity, point: new THREE.Vector3() }
    expect(findBlockingProjectileObstacleAlongPath(from, to, [gap, farther, first, tie, beyond], contact)).toBe(first)
    expect(contact.fraction).toBe(.5)
    expect(contact.point.toArray()).toEqual([2, 0, 0])
    expect(findBlockingProjectileObstacleAlongPath(from, to, [gap, beyond], contact)).toBeNull()
    expect(contact.fraction).toBe(Infinity)
  })

  it('culls complete rotated and scaled projectile bounds without losing edge or inside contacts', () => {
    const localBox = new THREE.Box3(new THREE.Vector3(-2, -.2, -.2), new THREE.Vector3(2, .2, .2))
    // Exact quarter turn and non-uniform scale, without trigonometric rounding
    // at the outer edge: world x = local z + 10, world z = -2 * local x.
    const localToWorld = new THREE.Matrix4().set(
      0, 0, 1, 10,
      0, .5, 0, 0,
      -2, 0, 0, 0,
      0, 0, 0, 1,
    )
    let exactReads = 0
    const obstacle: ObstacleData = {
      isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(9.9, -1, -.1), new THREE.Vector3(10.1, 1, .1)),
      projectileBounds: localBox.clone().applyMatrix4(localToWorld),
      projectileWorldToLocal: localToWorld.clone().invert(),
      get projectileBoxes() { exactReads++; return [localBox] },
    }
    const from = new THREE.Vector3(8, 0, 4), to = new THREE.Vector3(12, 0, 4)
    const contact = { fraction: Infinity, point: new THREE.Vector3() }
    expect(findBlockingProjectileObstacleAlongPath(from, to, [obstacle], contact)).toBe(obstacle)
    expect(contact.fraction).toBeCloseTo(.45)
    expect(contact.point.x).toBeCloseTo(9.8)
    expect(contact.point.z).toBe(4)
    expect(findBlockingProjectileObstacleAlongPath(new THREE.Vector3(10, 0, 4), to, [obstacle], contact)).toBe(obstacle)
    expect(contact.fraction).toBe(0)

    const arc = new BallisticIntercept()
    expect(arc.solve(from, to, new THREE.Vector3(), 15)).toBe(true)
    expect(arc.isPathClear(from, 15, [obstacle], () => -10)).toBe(false)
    exactReads = 0
    const remoteFrom = new THREE.Vector3(28, 0, 4), remoteTo = new THREE.Vector3(32, 0, 4)
    expect(findBlockingProjectileObstacleAlongPath(remoteFrom, remoteTo, [obstacle])).toBeNull()
    expect(arc.solve(remoteFrom, remoteTo, new THREE.Vector3(), 15)).toBe(true)
    expect(arc.isPathClear(remoteFrom, 15, [obstacle], () => -10)).toBe(true)
    expect(exactReads).toBe(0)
  })

  it('keeps rotated slab protrusions hittable outside their narrower walk envelope', () => {
    const obstacle: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(9.9, -1, -.1), new THREE.Vector3(10.1, 1, .1)),
      projectileBoxes: [new THREE.Box3(new THREE.Vector3(-2, -.2, -.2), new THREE.Vector3(2, .2, .2))],
      projectileWorldToLocal: new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0).invert(),
    }
    const from = new THREE.Vector3(8, 0, 1), to = new THREE.Vector3(12, 0, 1)
    const contact = { fraction: Infinity, point: new THREE.Vector3() }
    expect(findBlockingProjectileObstacleAlongPath(from, to, [obstacle], contact)).toBe(obstacle)
    expect(contact.point.x).toBeCloseTo(9.8)
    expect(contact.point.z).toBe(1)
    const arc = new BallisticIntercept()
    expect(arc.solve(from, to, new THREE.Vector3(), 15)).toBe(true)
    expect(arc.isPathClear(from, 15, [obstacle], () => -10)).toBe(false)
    obstacle.projectileWorldToLocal!.makeRotationY(Math.PI / 2).setPosition(20, 0, 0).invert()
    expect(arc.isPathClear(from, 15, [obstacle], () => -10)).toBe(true)
  })
})

describe('Town live projectile candidates', () => {
  it('retains complete rotated bounds, unknown protrusions, tolerance edges and duplicate source order', () => {
    const local = new THREE.Box3(new THREE.Vector3(-2, -.2, -.2), new THREE.Vector3(2, .2, .2))
    const transform = new THREE.Matrix4().set(0, 0, 1, 10, 0, .5, 0, 40, -2, 0, 0, 0, 0, 0, 0, 1)
    const complete: ObstacleData = { isBarricade: false, navigationPassable: true, physicalPassable: true,
      box: new THREE.Box3(new THREE.Vector3(9.9, 39, -.1), new THREE.Vector3(10.1, 41, .1)),
      projectileBoxes: [local], projectileWorldToLocal: transform.clone().invert(),
      projectileBounds: local.clone().applyMatrix4(transform) }
    const unknown = { ...complete, projectileBounds: undefined, collisionGroup: { bounds: complete.box } }
    const remote: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(8, 0, 3), new THREE.Vector3(12, 1, 5)) }
    const edge: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(12 + 5e-7, 39, 3), new THREE.Vector3(13, 41, 5)) }
    const source = [remote, complete, unknown, complete, edge, { ...complete, projectilePassable: true }]
    const from = new THREE.Vector3(8, 40, 4), to = new THREE.Vector3(12, 40, 4)
    const candidates = new TownProjectileObstacles().query(from, to, source)
    expect(candidates).toEqual([complete, unknown, complete, edge])
    const contact = { fraction: Infinity, point: new THREE.Vector3() }
    expect(findBlockingProjectileObstacleAlongPath(from, to, candidates, contact)).toBe(complete)
    expect(contact.fraction).toBeCloseTo(.45)
    expect(contact.point.toArray()).toEqual([9.8, 40, 4])
  })

  it('reads the next arrow\'s live bounds and source after a same-length destroy/restore swap without a cache revision', () => {
    const box = (x: number) => new THREE.Box3(new THREE.Vector3(x, 39, -1), new THREE.Vector3(x + .2, 41, 1))
    const building: ObstacleData = { isBarricade: false, box: box(1) }
    const moving: ObstacleData = { isBarricade: true, dynamic: true, box: box(100),
      projectileBounds: box(1), projectileBoxes: [box(1)], projectileWorldToLocal: new THREE.Matrix4() }
    const restored: ObstacleData = { isBarricade: false, box: box(2) }
    const source = [building, moving, { isBarricade: false, box: box(80) },
      { isBarricade: false, box: box(90) }, { isBarricade: false, box: box(110) }]
    const query = new TownProjectileObstacles(), from = new THREE.Vector3(0, 40, 0), to = new THREE.Vector3(3, 40, 0)
    const buffer = query.query(from, to, source)
    expect(buffer).toEqual([building, moving])
    // One hit removes a structure and restores a passage; moving parts also
    // update without topology changes. The next arrow must see all live inputs.
    source.splice(0, 1)
    source.push(restored)
    moving.projectileBounds!.translate(new THREE.Vector3(100, 0, 0))
    moving.projectileWorldToLocal!.makeTranslation(-100, 0, 0)
    expect(query.query(from, to, source)).toBe(buffer)
    expect(buffer).toEqual([restored])
    const contact = { fraction: Infinity, point: new THREE.Vector3() }
    expect(findBlockingProjectileObstacleAlongPath(from, to, buffer, contact)).toBe(restored)
    expect(contact.fraction).toBeCloseTo(2 / 3)
    query.clear()
    expect(buffer).toHaveLength(0)
  })
})


describe('whole ballistic arc candidates', () => {
  it('includes the unsampled apex and tolerance edge while retaining source order and duplicates', () => {
    const origin = new THREE.Vector3(), end = new THREE.Vector3(10, 0, 0)
    const apex: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(4, 1.2, -1), new THREE.Vector3(6, 1.3, 1)) }
    const edge: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(10 + 5e-7, -1, -1), new THREE.Vector3(11, 1, 1)) }
    const remote: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(4, 2, -1), new THREE.Vector3(6, 3, 1)) }
    const bounds = new THREE.Box3(), candidates: ObstacleData[] = []
    expect(collectBallisticPathObstacles(origin, end, 4.9, 1,
      [edge, remote, apex, edge], bounds, candidates)).toBe(candidates)
    expect(candidates).toEqual([edge, apex, edge])
    expect(bounds.max.y).toBeCloseTo(1.225 + 1e-6, 10)
    expect(bounds.containsPoint(origin)).toBe(true)
    expect(bounds.containsPoint(end)).toBe(true)
  })

  it('releases partially collected live obstacles when collection throws', () => {
    const arc = new BallisticIntercept(), origin = new THREE.Vector3(0, 2, 0)
    expect(arc.solve(origin, new THREE.Vector3(8, 2, 0), new THREE.Vector3(), 15)).toBe(true)
    const retained: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(1, -10, -1), new THREE.Vector3(2, 10, 1)) }
    const throwing: ObstacleData = { ...retained, get projectileBounds(): THREE.Box3 { throw new Error('disposed owner') } }
    expect(() => arc.isPathClear(origin, 15, [retained, throwing], () => -10)).toThrow('disposed owner')
    const scratch = arc as unknown as { pathObstacles: ObstacleData[] }
    expect(scratch.pathObstacles).toHaveLength(0)
    expect(arc.isPathClear(origin, 15, [], () => -10)).toBe(true)
  })
})


/** Only plain body positions and collision boxes; no actor or scene construction. */
function contactBody(x: number) {
  const position = new THREE.Vector3(x, 40, 0)
  return { group: { position } as PhysicalCombatTarget['group'], combatPosition: position,
    isMounted: false, available: true }
}

describe('shared live projectile first contact', () => {
  it('keeps nock clearance exclusive to world geometry and reads target eligibility before the next shot', () => {
    const query = new ProjectileContactQuery(), from = new THREE.Vector3(0, 41, 0), to = new THREE.Vector3(.1, 41, 0)
    const first = contactBody(.35), second = contactBody(.35), entry = first.group.position.x - .3
    const wall: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(entry, 40, -1), new THREE.Vector3(.2, 42, 1)) }
    const duplicate = { ...wall }, targets = [first, second]
    const input = { world: { kind: 'battle' as const, travelledDistance: .119 }, obstacles: [wall, duplicate], targets,
      acceptsTarget: (target: typeof first) => target.available }
    const hit = query.find(from, to, input)
    expect(hit).toMatchObject({ kind: 'actor', target: first, contact: { kind: 'body' } })
    expect(hit!.point.x).toBeCloseTo(.05)
    // Damage/ownership from one projectile changes admission for the next one.
    first.available = false
    expect(query.find(from, to, input)).toMatchObject({ kind: 'actor', target: second })
    input.world.travelledDistance = .12
    expect(query.find(from, to, input)).toMatchObject({ kind: 'obstacle', obstacle: wall })
    wall.projectilePassable = true
    expect(query.find(from, to, input)).toMatchObject({ kind: 'obstacle', obstacle: duplicate })
    // A returned contact remains owned by the hit even after subsequent queries.
    expect(hit).toMatchObject({ kind: 'actor', target: first, contact: { target: first } })
    expect(hit!.point.x).toBeCloseTo(.05)
  })

  it('keeps Town siege tolerance and catches a practice target just beyond the tip after live blockers disappear', () => {
    const query = new ProjectileContactQuery(), from = new THREE.Vector3(0, 40, 0), to = new THREE.Vector3(1, 40, 0)
    const wall: ObstacleData = { isBarricade: false,
      box: new THREE.Box3(new THREE.Vector3(.8, 39, -1), new THREE.Vector3(.9, 41, 1)) }
    // The siege callback is the scene's mesh adapter; this test owns its distance contract.
    const structure = {} as DamageableObstacle, maxima: number[] = []
    let siegePresent = true
    const practice = new THREE.Vector3(1.605, 40, 0), obstacles = [wall]
    const input = { world: { kind: 'town' as const, practiceTargets: [practice],
      traceSiege: (_from: THREE.Vector3, _to: THREE.Vector3, maximum: number) => {
        maxima.push(maximum)
        return !siegePresent ? null : { target: structure, distance: .8005, point: new THREE.Vector3(.8005, 40, 0) }
      } }, obstacles, targets: [], acceptsTarget: () => true }
    const siege = query.find(from, to, input)
    expect(siege).toMatchObject({ kind: 'siege', target: structure })
    expect(maxima[0]).toBeCloseTo(.801)
    // The scene's synchronous destruction removes both registrations before the next shot.
    siegePresent = false; obstacles.length = 0
    const next = query.find(from, to, input)
    expect(next?.kind).toBe('practice')
    expect(next!.point.x).toBeCloseTo(1.005)
    expect(maxima[1]).toBe(1)
    practice.x = 1.611
    expect(query.find(from, to, input)).toBeNull()
    expect(siege!.point.x).toBe(.8005)
  })
})
