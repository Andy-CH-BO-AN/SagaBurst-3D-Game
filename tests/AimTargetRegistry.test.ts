import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from '../src/world/AimTargetRegistry'
import { NPC, Faction, AIType, AIState } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'

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
})
