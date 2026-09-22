import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createRomanOutpost,
  ROMAN_OUTPOST_LAYOUT,
} from './RomanOutpost'

describe('RomanOutpost', () => {
  it('builds a Roman-owned damageable perimeter around the existing camp area', () => {
    const scene = new THREE.Scene()
    const outpost = createRomanOutpost(scene)

    expect(outpost.root.parent).toBe(scene)
    expect(outpost.gate.kind).toBe('gate')
    expect(outpost.gate.ownerFaction).toBe('roman')
    expect(outpost.obstacles.length).toBe(outpost.damageableObstacles.length)
    expect(outpost.damageableObstacles.length).toBeGreaterThan(20)
    expect(outpost.obstacles.every(obstacle => obstacle.isBarricade)).toBe(true)

    const gateObstacle = outpost.obstacles.find(obstacle => obstacle.damageable === outpost.gate)
    expect(gateObstacle).toBeDefined()
    expect(gateObstacle!.box.min.x).toBeCloseTo(-ROMAN_OUTPOST_LAYOUT.gateWidth / 2)
    expect(gateObstacle!.box.max.x).toBeCloseTo(ROMAN_OUTPOST_LAYOUT.gateWidth / 2)
    expect(gateObstacle!.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(ROMAN_OUTPOST_LAYOUT.frontZ)
  })

  it('removes destroyed structures from the shared live collision collections', () => {
    const scene = new THREE.Scene()
    const sharedObstacles: ReturnType<typeof createRomanOutpost>['obstacles'] = []
    const sharedObstacleMeshes: ReturnType<typeof createRomanOutpost>['obstacleMeshes'] = []
    const outpost = createRomanOutpost(scene, {
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
    const outpost = createRomanOutpost(scene)
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
