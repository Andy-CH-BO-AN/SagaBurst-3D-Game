import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FORTIFIED_CAMP_HILL, getFortifiedCampHeightOffset } from '../world/Terrain'
import {
  createCampaignOutpost,
  getCampaignOutpostPlacement,
} from './CampaignOutpost'

describe('CampaignOutpost', () => {
  it.each(['roman', 'viking'] as const)(
    'builds a %s-owned damageable perimeter around the shared camp area',
    defenderFaction => {
      const scene = new THREE.Scene()
      const outpost = createCampaignOutpost(scene, defenderFaction)

      expect(outpost.root.parent).toBe(scene)
      expect(outpost.root.name).toBe(`campaign-outpost-${defenderFaction}`)
      expect(outpost.gate.kind).toBe('gate')
      expect(outpost.gate.ownerFaction).toBe(defenderFaction)
      expect(outpost.damageableObstacles.every(obstacle => obstacle.ownerFaction === defenderFaction)).toBe(true)
      expect(outpost.obstacles.length).toBe(outpost.damageableObstacles.length)
      expect(outpost.damageableObstacles.length).toBeGreaterThan(20)
      expect(outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')).toHaveLength(10)
      expect(outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'campfire')).toHaveLength(2)
      expect(outpost.obstacles.filter(obstacle => !obstacle.isBarricade)).toHaveLength(12)

      const placement = getCampaignOutpostPlacement(defenderFaction)
      expect(placement.halfWidth).toBe(44)
      expect(placement.halfWidth * 2).toBe(88)
      expect(Math.abs(placement.backZ - placement.frontZ)).toBe(72)
      expect(Math.abs(placement.backZ)).toBeLessThanOrEqual(180)
      const gateObstacle = outpost.obstacles.find(obstacle => obstacle.damageable === outpost.gate)
      expect(gateObstacle).toBeDefined()
      expect(gateObstacle!.box.min.x).toBeCloseTo(-placement.gateWidth / 2)
      expect(gateObstacle!.box.max.x).toBeCloseTo(placement.gateWidth / 2)
      expect(gateObstacle!.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(placement.frontZ)
      expect(Math.sign(placement.frontZ)).toBe(defenderFaction === 'roman' ? -1 : 1)
      expect(Math.abs(placement.backZ)).toBeGreaterThan(Math.abs(placement.frontZ))
    },
  )

  it('removes destroyed structures from the shared live collision collections', () => {
    const scene = new THREE.Scene()
    const sharedObstacles: ReturnType<typeof createCampaignOutpost>['obstacles'] = []
    const sharedObstacleMeshes: ReturnType<typeof createCampaignOutpost>['obstacleMeshes'] = []
    const outpost = createCampaignOutpost(scene, 'roman', {
      obstacles: sharedObstacles,
      obstacleMeshes: sharedObstacleMeshes,
    })
    const obstacleCount = sharedObstacles.length
    const meshCount = sharedObstacleMeshes.length
    const gateHitMeshCount = outpost.gate.hitMeshes.length

    outpost.gate.takeDamage(outpost.gate.maxHp)

    expect(outpost.gate.destroyed).toBe(true)
    expect(sharedObstacles).toHaveLength(obstacleCount - 1)
    expect(sharedObstacleMeshes).toHaveLength(meshCount - gateHitMeshCount)
    expect(sharedObstacles.some(obstacle => obstacle.damageable === outpost.gate)).toBe(false)
  })

  it('uses ten large damageable tents and keeps the gate-to-lookout corridor clear', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'viking')
    const tents = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')

    expect(tents).toHaveLength(10)
    expect(tents.every(tent => tent.ownerFaction === 'viking')).toBe(true)

    for (const tent of tents) {
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === tent)
      expect(obstacle).toBeDefined()
      const size = obstacle!.box.getSize(new THREE.Vector3())
      const center = obstacle!.box.getCenter(new THREE.Vector3())
      expect(size.x).toBeGreaterThanOrEqual(7)
      expect(size.y).toBeGreaterThanOrEqual(3.5)
      expect(Math.abs(center.x)).toBeGreaterThanOrEqual(24)
    }
  })

  it('makes campfires damageable small obstacles', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman')
    const campfires = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'campfire')

    expect(campfires).toHaveLength(2)
    expect(campfires.every(campfire => campfire.ownerFaction === 'roman')).toBe(true)
    for (const campfire of campfires) {
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === campfire)
      expect(obstacle).toBeDefined()
      const size = obstacle!.box.getSize(new THREE.Vector3())
      expect(size.x).toBeLessThanOrEqual(2)
      expect(size.z).toBeLessThanOrEqual(2)
    }
  })

  it('renders palisades as spaced stakes while keeping continuous actor collision', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman')
    const palisades = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'palisade')

    expect(palisades.length).toBeGreaterThan(0)
    expect(
      palisades.every(palisade =>
        palisade.root.children.some(child => child instanceof THREE.InstancedMesh),
      ),
    ).toBe(true)

    for (const palisade of palisades) {
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === palisade)
      expect(obstacle).toBeDefined()
      expect(obstacle!.box.getSize(new THREE.Vector3()).length()).toBeGreaterThan(1)
      expect(obstacle!.projectileBoxes?.length).toBeGreaterThan(2)
    }
  })

  it('adds a smooth raised lookout hill at both campaign camp centers', () => {
    expect(getFortifiedCampHeightOffset(0, -FORTIFIED_CAMP_HILL.centerAbsZ, 'roman'))
      .toBeCloseTo(FORTIFIED_CAMP_HILL.height)
    expect(getFortifiedCampHeightOffset(0, FORTIFIED_CAMP_HILL.centerAbsZ, 'viking'))
      .toBeCloseTo(FORTIFIED_CAMP_HILL.height)
    expect(getFortifiedCampHeightOffset(0, FORTIFIED_CAMP_HILL.centerAbsZ, 'roman'))
      .toBe(0)
    expect(
      getFortifiedCampHeightOffset(
        FORTIFIED_CAMP_HILL.radiusX + 1,
        -FORTIFIED_CAMP_HILL.centerAbsZ,
        'roman',
      ),
    ).toBe(0)
  })
})
