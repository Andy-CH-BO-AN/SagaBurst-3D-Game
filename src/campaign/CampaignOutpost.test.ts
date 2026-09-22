import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  CAMPAIGN_OUTPOST_LAYOUT,
  createCampaignOutpost,
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
      expect(outpost.obstacles.every(obstacle => obstacle.isBarricade)).toBe(true)

      const gateObstacle = outpost.obstacles.find(obstacle => obstacle.damageable === outpost.gate)
      expect(gateObstacle).toBeDefined()
      expect(gateObstacle!.box.min.x).toBeCloseTo(-CAMPAIGN_OUTPOST_LAYOUT.gateWidth / 2)
      expect(gateObstacle!.box.max.x).toBeCloseTo(CAMPAIGN_OUTPOST_LAYOUT.gateWidth / 2)
      expect(gateObstacle!.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(CAMPAIGN_OUTPOST_LAYOUT.frontZ)
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

  it('keeps tents and campfires decorative rather than collision obstacles', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'viking')
    const decorativeNames = outpost.root.children
      .map(child => child.name)
      .filter(name => name.includes('tent') || name.includes('campfire'))

    expect(decorativeNames).toHaveLength(5)
    expect(
      outpost.damageableObstacles.some(obstacle =>
        obstacle.root.name.includes('tent') || obstacle.root.name.includes('campfire'),
      ),
    ).toBe(false)
  })
})
