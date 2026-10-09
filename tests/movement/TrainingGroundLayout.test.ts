import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTrainingGroundPlan } from '../../src/training/TrainingGroundPlan'
import { getTerrainHeight, TERRAIN_TREE_POSITIONS } from '../../src/world/Terrain'
import { segmentBoxTime } from '../../src/combat/ShieldBlocking'

describe('Training layout policy (zero actors)', () => {
  it('plans all four rideable types and eleven targets, with no military roster', () => {
    const plan = createTrainingGroundPlan()
    expect(plan.mounts.map(({ type }) => type).sort()).toEqual(['BLACK_CAT', 'CORGI', 'HORSE', 'xongkoro'].sort())
    expect(plan.dummies.map(({ distance }) => distance)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(plan).not.toHaveProperty('npcSpecs')
    expect(plan).not.toHaveProperty('army')
  })

  it.each([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])('%im target has that exact horizontal distance from the shared reference', distance => {
    const plan = createTrainingGroundPlan(), dummy = plan.dummies.find(dummy => dummy.distance === distance)!
    expect(Math.hypot(dummy.x - plan.referencePoint.x, dummy.z - plan.referencePoint.z)).toBeCloseTo(distance, 8)
  })

  it('gives every ranged dummy a visible lane from the forward edge, without dummy/tree/terrain occlusion', () => {
    const plan = createTrainingGroundPlan()
    const start = new THREE.Vector3(plan.firingPoint.x, getTerrainHeight(plan.firingPoint.x, plan.firingPoint.z) + 1.7, plan.firingPoint.z)
    for (const target of plan.dummies.filter(dummy => dummy.distance > 0)) {
      const end = new THREE.Vector3(target.x, getTerrainHeight(target.x, target.z) + 1.2, target.z)
      for (const other of plan.dummies.filter(dummy => dummy !== target)) {
        const y = getTerrainHeight(other.x, other.z)
        const box = new THREE.Box3(new THREE.Vector3(other.x - .3, y + .06, other.z - .3), new THREE.Vector3(other.x + .3, y + 1.8, other.z + .3))
        expect(segmentBoxTime(start, end, box), `${target.distance}m blocked by ${other.distance}m`).toBe(Infinity)
      }
      for (const [x, z] of TERRAIN_TREE_POSITIONS) {
        const y = getTerrainHeight(x, z)
        expect(segmentBoxTime(start, end, new THREE.Box3(new THREE.Vector3(x - .4, y, z - .4), new THREE.Vector3(x + .4, y + 6, z + .4)))).toBe(Infinity)
      }
      for (let t = .05; t < 1; t += .05) {
        const point = start.clone().lerp(end, t)
        expect(point.y - getTerrainHeight(point.x, point.z), `${target.distance}m terrain at ${t}`).toBeGreaterThan(.4)
      }
    }
  })

  it('separates the 125m runway, spawn, weapons and giant eagle parking clearance', () => {
    const plan = createTrainingGroundPlan()
    expect(plan.runwayStart.z - plan.referencePoint.z).toBe(125)
    expect(Math.hypot(plan.playerSpawn.x - plan.referencePoint.x, plan.playerSpawn.z - plan.referencePoint.z)).toBeGreaterThan(5)
    for (const mount of plan.mounts) {
      expect(Math.abs(mount.x - plan.runwayStart.x)).toBeGreaterThan(15)
      expect(Math.hypot(mount.x - plan.weaponArea.x, mount.z - plan.weaponArea.z)).toBeGreaterThan(15)
      for (const other of plan.mounts.filter(other => other !== mount)) expect(Math.hypot(other.x - mount.x, other.z - mount.z)).toBeGreaterThan(22)
    }
  })
})
