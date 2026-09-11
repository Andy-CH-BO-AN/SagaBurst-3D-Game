import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from '../src/world/AimTargetRegistry'
import { NPC, Faction, AIType, AIState } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { createTerrain, getTerrainHeight } from '../src/world/Terrain'

describe('AimTargetRegistry', () => {
  it('registers and unregisters NPC aim proxy cleanly without duplicates', () => {
    const registry = new AimTargetRegistry()
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 10, Faction.ENEMY, AIType.MELEE, 'TestNPC', 1, false)

    expect(registry.targets.length).toBe(0)

    registry.registerNpc(npc)
    expect(registry.targets.length).toBe(1)
    expect(registry.targets[0]).toBe(npc.aimCollider)

    // Duplicate registration should be no-op
    registry.registerNpc(npc)
    expect(registry.targets.length).toBe(1)

    registry.unregisterNpc(npc)
    expect(registry.targets.length).toBe(0)
  })

  it('removes NPC proxy on death and re-adds upon respawn', () => {
    const registry = new AimTargetRegistry()
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 10, Faction.ENEMY, AIType.MELEE, 'TestNPC', 1, false)

    registry.registerNpc(npc)
    expect(registry.targets.includes(npc.aimCollider)).toBe(true)

    // Kill NPC
    npc.takeDamage(9999)
    expect(npc.state).toBe(AIState.DEAD)
    expect(registry.targets.includes(npc.aimCollider)).toBe(false)

    // Respawn NPC
    npc.respawn()
    expect(npc.state).toBe(AIState.IDLE)
    expect(registry.targets.includes(npc.aimCollider)).toBe(true)
  })

  it('registers and unregisters Mount proxy', () => {
    const registry = new AimTargetRegistry()
    const scene = new THREE.Scene()
    const mount = new Mount(scene, MountType.BLACK_CAT, 0, 0)

    registry.registerMount(mount)
    expect(registry.targets.includes(mount.aimCollider)).toBe(true)

    // Kill Mount
    mount.takeDamage(9999)
    expect(mount.dead).toBe(true)
    expect(registry.targets.includes(mount.aimCollider)).toBe(false)

    registry.unregisterMount(mount)
    expect(registry.targets.length).toBe(0)
  })

  it('handles static target registration and clearing', () => {
    const registry = new AimTargetRegistry()
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(100, 100))
    const rock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))

    registry.addStaticTarget(terrain)
    registry.addStaticTarget(rock)
    expect(registry.targets.length).toBe(2)

    // No duplicate static targets
    registry.addStaticTarget(terrain)
    expect(registry.targets.length).toBe(2)

    registry.removeStaticTarget(rock)
    expect(registry.targets.length).toBe(1)
    expect(registry.targets[0]).toBe(terrain)

    registry.clear()
    expect(registry.targets.length).toBe(0)
  })

  it('enforces aim proxy layer semantics: visible=true, hit by raycaster (recursive=false), ignored by camera', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 10, Faction.ENEMY, AIType.MELEE, 'LayerNPC', 1, false)
    npc.group.position.set(0, 0, 5)
    npc.group.updateMatrixWorld(true)

    const proxy = npc.aimCollider
    expect(proxy.visible).toBe(true)
    expect(proxy.layers.isEnabled(AIM_RAYCAST_LAYER)).toBe(true)

    // Default perspective camera only has layer 0 enabled
    const gameplayCamera = new THREE.PerspectiveCamera()
    expect(gameplayCamera.layers.isEnabled(0)).toBe(true)
    expect(gameplayCamera.layers.isEnabled(AIM_RAYCAST_LAYER)).toBe(false)
    expect(proxy.layers.test(gameplayCamera.layers)).toBe(false)

    // Aim Raycaster with AIM_RAYCAST_LAYER enabled
    const aimRaycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0.925, 0),
      new THREE.Vector3(0, 0, 1),
    )
    aimRaycaster.layers.enable(AIM_RAYCAST_LAYER)

    // Non-recursive raycast directly tests the proxy mesh
    const hits = aimRaycaster.intersectObjects([proxy], false)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].object).toBe(proxy)
  })

  it('regression: Group -> Mesh children allows non-recursive (recursive=false) raycast to block aim', () => {
    // 1. Recreate the failure mode: if only the Group is registered, recursive=false will miss
    const barricadeGroup = new THREE.Group()
    barricadeGroup.position.set(0, 0, 10)

    const baseGeo = new THREE.BoxGeometry(4, 0.4, 0.4)
    const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial())
    baseMesh.position.set(0, 0.2, 0)
    barricadeGroup.add(baseMesh)

    barricadeGroup.updateMatrixWorld(true)

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(0, 0, 1),
    )

    // With targets = [barricadeGroup], non-recursive raycast FAILS (length === 0)
    const groupOnlyHits = raycaster.intersectObjects([barricadeGroup], false)
    expect(groupOnlyHits.length).toBe(0)

    // 2. Fixed mode: registering actual Mesh children allows non-recursive raycast to hit
    const meshTargets: THREE.Mesh[] = []
    barricadeGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshTargets.push(child as THREE.Mesh)
      }
    })

    expect(meshTargets.length).toBe(1)
    expect(meshTargets[0]).toBe(baseMesh)

    const meshHits = raycaster.intersectObjects(meshTargets, false)
    expect(meshHits.length).toBeGreaterThan(0)
    expect(meshHits[0].object).toBe(baseMesh)
    expect(meshHits[0].point.z).toBeCloseTo(9.8, 1) // 10 - half thickness (0.2)
  })

  it('regression: createTerrain registers barricade child meshes so aim raycast hits obstacles with recursive=false', () => {
    // Import createTerrain dynamically or test directly
    const scene = new THREE.Scene()
    const { obstacleMeshes } = createTerrain(scene)

    const registry = new AimTargetRegistry()
    for (const obstacleMesh of obstacleMeshes) {
      registry.addStaticTarget(obstacleMesh)
    }

    // Verify all registered obstacle targets are strictly Meshes (no Groups)
    for (const target of registry.targets) {
      expect((target as THREE.Mesh).isMesh).toBe(true)
      expect(target.type).not.toBe('Group')
    }

    scene.updateMatrixWorld(true)

    // Barricade is at [15, -5, Math.PI/4]
    const ty = getTerrainHeight(15, -5)
    // Aim directly through the base log (height 0.2 above terrain)
    const rayOrigin = new THREE.Vector3(15, ty + 0.2, -20)
    const rayDir = new THREE.Vector3(0, 0, 1).normalize()

    const raycaster = new THREE.Raycaster(rayOrigin, rayDir)
    const hits = raycaster.intersectObjects(registry.targets, false)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].object.type).toBe('Mesh')
  })
})
