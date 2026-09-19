import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { ArrowProjectile } from '../src/world/ArrowProjectile'
import { Faction } from '../src/world/NPC'

describe('Projectile Shadow Policy Contract', () => {
  const dummyDirection = new THREE.Vector3(0, 0, -1)
  const dummyOrigin = new THREE.Vector3(10, 5, -20)

  it('1. NPC Arrow: disables castShadow on all child meshes', () => {
    const scene = new THREE.Scene()
    const npcArrow = new ArrowProjectile(
      scene,
      dummyOrigin,
      dummyDirection,
      35,
      25,
      Faction.ENEMY,
      false,
      'arrow',
    )

    const meshes = npcArrow.mesh.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(false)
    }
  })

  it('2. NPC Pilum: disables castShadow on all child meshes', () => {
    const scene = new THREE.Scene()
    const npcPilum = new ArrowProjectile(
      scene,
      dummyOrigin,
      dummyDirection,
      25,
      40,
      Faction.ENEMY,
      false,
      'pilum',
    )

    const meshes = npcPilum.mesh.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(false)
    }
  })

  it('3. Player Arrow: preserves high-quality shadow on shaft while keeping non-shaft meshes unshadowed', () => {
    const scene = new THREE.Scene()
    const playerArrow = new ArrowProjectile(
      scene,
      dummyOrigin,
      dummyDirection,
      35,
      25,
      Faction.PLAYER,
      true,
      'arrow',
    )

    const shared = ArrowProjectile.getSharedVisuals()
    const shaftMesh = playerArrow.mesh.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry === shared.arrowShaft
    )
    expect(shaftMesh).toBeDefined()
    expect(shaftMesh?.castShadow).toBe(true)

    // Verify tip and fin do not have castShadow enabled
    const nonShaftMeshes = playerArrow.mesh.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry !== shared.arrowShaft
    )
    expect(nonShaftMeshes.length).toBe(2)
    for (const nonShaft of nonShaftMeshes) {
      expect(nonShaft.castShadow).toBe(false)
    }
  })

  it('4. Player Pilum: preserves high-quality shadow on shaft while keeping non-shaft meshes unshadowed', () => {
    const scene = new THREE.Scene()
    const playerPilum = new ArrowProjectile(
      scene,
      dummyOrigin,
      dummyDirection,
      25,
      40,
      Faction.PLAYER,
      true,
      'pilum',
    )

    const shared = ArrowProjectile.getSharedVisuals()
    const shaftMesh = playerPilum.mesh.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry === shared.pilumShaft
    )
    expect(shaftMesh).toBeDefined()
    expect(shaftMesh?.castShadow).toBe(true)

    // Verify non-shaft meshes (socket, neck, tip, wrap) remain castShadow = false
    const nonShaftMeshes = playerPilum.mesh.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry !== shared.pilumShaft
    )
    expect(nonShaftMeshes.length).toBe(4)
    for (const nonShaft of nonShaftMeshes) {
      expect(nonShaft.castShadow).toBe(false)
    }
  })

  it('5. Gameplay & visual hierarchy invariants between NPC and Player projectiles', () => {
    const scene = new THREE.Scene()
    const playerArrow = new ArrowProjectile(scene, dummyOrigin, dummyDirection, 35, 25, Faction.PLAYER, true, 'arrow')
    const npcArrow = new ArrowProjectile(scene, dummyOrigin, dummyDirection, 35, 25, Faction.ENEMY, false, 'arrow')

    expect(npcArrow.mesh.children.length).toBe(playerArrow.mesh.children.length)
    for (let i = 0; i < playerArrow.mesh.children.length; i++) {
      const pChild = playerArrow.mesh.children[i] as THREE.Mesh
      const nChild = npcArrow.mesh.children[i] as THREE.Mesh
      expect(nChild.geometry).toBe(pChild.geometry)
      expect(nChild.material).toBe(pChild.material)
      expect(nChild.position.equals(pChild.position)).toBe(true)
      expect(nChild.rotation.equals(pChild.rotation)).toBe(true)
    }

    const playerPilum = new ArrowProjectile(scene, dummyOrigin, dummyDirection, 25, 40, Faction.PLAYER, true, 'pilum')
    const npcPilum = new ArrowProjectile(scene, dummyOrigin, dummyDirection, 25, 40, Faction.ENEMY, false, 'pilum')

    expect(npcPilum.mesh.children.length).toBe(playerPilum.mesh.children.length)
    for (let i = 0; i < playerPilum.mesh.children.length; i++) {
      const pChild = playerPilum.mesh.children[i] as THREE.Mesh
      const nChild = npcPilum.mesh.children[i] as THREE.Mesh
      expect(nChild.geometry).toBe(pChild.geometry)
      expect(nChild.material).toBe(pChild.material)
      expect(nChild.position.equals(pChild.position)).toBe(true)
      expect(nChild.rotation.equals(pChild.rotation)).toBe(true)
    }

    // Positions and quaternions align identically
    expect(npcArrow.mesh.position.equals(playerArrow.mesh.position)).toBe(true)
    expect(npcArrow.mesh.quaternion.equals(playerArrow.mesh.quaternion)).toBe(true)
    expect(npcPilum.mesh.position.equals(playerPilum.mesh.position)).toBe(true)
    expect(npcPilum.mesh.quaternion.equals(playerPilum.mesh.quaternion)).toBe(true)
  })
})
