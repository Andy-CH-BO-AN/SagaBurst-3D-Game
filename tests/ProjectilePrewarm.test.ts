import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import {
  prewarmProjectileVisuals,
  createProjectileWarmupGroup,
  ArrowProjectile,
} from '../src/world/ArrowProjectile'
import { Faction } from '../src/world/NPC'

describe('Projectile Prewarm & Resource Sharing', () => {
  it('prewarms shared projectile assets idempotently', () => {
    prewarmProjectileVisuals()
    const firstVisuals = ArrowProjectile.getSharedVisuals()

    expect(firstVisuals).toBeDefined()
    expect(firstVisuals.woodMaterial).toBeDefined()
    expect(firstVisuals.ironMaterial).toBeDefined()
    expect(firstVisuals.bronzeMaterial).toBeDefined()
    expect(firstVisuals.featherMaterial).toBeDefined()
    expect(firstVisuals.arrowShaft).toBeDefined()
    expect(firstVisuals.pilumShaft).toBeDefined()

    // Second prewarm call must not recreate resources
    ArrowProjectile.prewarm()
    const secondVisuals = ArrowProjectile.getSharedVisuals()

    expect(secondVisuals).toBe(firstVisuals)
    expect(secondVisuals.woodMaterial).toBe(firstVisuals.woodMaterial)
    expect(secondVisuals.arrowShaft).toBe(firstVisuals.arrowShaft)
    expect(secondVisuals.pilumTip).toBe(firstVisuals.pilumTip)
  })

  it('reuses the exact shared geometries and materials when constructing ArrowProjectile instances', () => {
    prewarmProjectileVisuals()
    const shared = ArrowProjectile.getSharedVisuals()

    const scene = new THREE.Scene()
    const arrow = new ArrowProjectile(
      scene,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      35,
      25,
      Faction.PLAYER,
      true,
      'arrow',
    )

    const shaftMesh = arrow.mesh.children.find((c) => c instanceof THREE.Mesh && c.geometry === shared.arrowShaft) as THREE.Mesh | undefined
    expect(shaftMesh).toBeDefined()
    expect(shaftMesh?.material).toBe(shared.woodMaterial)

    const pilum = new ArrowProjectile(
      scene,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      25,
      40,
      Faction.ENEMY,
      false,
      'pilum',
    )

    const pilumShaft = pilum.mesh.children.find((c) => c instanceof THREE.Mesh && c.geometry === shared.pilumShaft) as THREE.Mesh | undefined
    expect(pilumShaft).toBeDefined()
    expect(pilumShaft?.material).toBe(shared.woodMaterial)
  })

  it('creates warmup group containing all arrow and pilum parts for GPU compilation', () => {
    const group = createProjectileWarmupGroup()
    expect(group).toBeInstanceOf(THREE.Group)
    expect(group.children.length).toBe(8)

    const shared = ArrowProjectile.getSharedVisuals()
    const geometries = group.children.map((c) => (c as THREE.Mesh).geometry)
    expect(geometries).toContain(shared.arrowShaft)
    expect(geometries).toContain(shared.arrowTip)
    expect(geometries).toContain(shared.arrowFin)
    expect(geometries).toContain(shared.pilumShaft)
    expect(geometries).toContain(shared.pilumSocket)
    expect(geometries).toContain(shared.pilumNeck)
    expect(geometries).toContain(shared.pilumTip)
    expect(geometries).toContain(shared.pilumWrap)
  })
})
