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
      expect(outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')).toHaveLength(3)
      expect(outpost.obstacles.filter(obstacle => !obstacle.isBarricade)).toHaveLength(3)

      const placement = getCampaignOutpostPlacement(defenderFaction)
      expect(placement.halfWidth).toBe(44)
      expect(placement.halfWidth * 2).toBe(88)
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

  it('makes tents damageable while campfires remain decorative', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'viking')
    const tents = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')
    const campfireNames = outpost.root.children
      .map(child => child.name)
      .filter(name => name.includes('campfire'))

    expect(tents).toHaveLength(3)
    expect(tents.every(tent => tent.ownerFaction === 'viking')).toBe(true)
    expect(campfireNames).toHaveLength(2)
    expect(
      outpost.damageableObstacles.some(obstacle => obstacle.root.name.includes('campfire')),
    ).toBe(false)
  })

  it('renders palisades as spaced stakes while keeping continuous collision boxes', () => {
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
