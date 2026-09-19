import * as THREE from 'three'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NPC, Faction, AIType, AIState } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'

describe('NPC Optimization & Semantics Preservation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('guarantees alive: false transition upon death in takeDamage', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, 'TestRoman', 1, false)
    const animatorSpy = vi.spyOn((npc as any).animator, 'setEquipment')

    expect(npc.dead).toBe(false)
    npc.takeDamage(9999)

    expect(npc.dead).toBe(true)
    // Verify alive: false was explicitly passed to setEquipment on death
    expect(animatorSpy).toHaveBeenCalledWith(npc.isUsingLance, Boolean(npc.shieldId), undefined, false)
  })

  it('dead NPCs bypass target acquisition and alive AI work during update', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'viking', AIType.MELEE, 'TestViking', 1, false)

    npc.respawnEnabled = false
    npc.takeDamage(9999)
    expect(npc.dead).toBe(true)

    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')
    const rebuildShieldSpy = vi.spyOn(npc, 'rebuildShield')

    npc.update(
      0.016,
      player,
      [npc],
      [npc],
      [],
      null as any,
      () => {},
      () => {},
      true
    )

    // Dead fast path must skip _findTarget and shield rebuild
    expect(findTargetSpy).not.toHaveBeenCalled()
    expect(rebuildShieldSpy).not.toHaveBeenCalled()
    expect(npc.dead).toBe(true)
  })

  it('preserves permanent death when respawnEnabled is false and respawns when true', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, 'TestRoman', 1, false)

    // 1. Permanent death
    npc.respawnEnabled = false
    npc.takeDamage(9999)
    for (let i = 0; i < 12; i++) {
      npc.update(1.0, player, [npc], [npc], [], null as any, () => {}, () => {}, true)
    }
    expect(npc.dead).toBe(true)
    expect(npc.currentState).toBe(AIState.DEAD)

    // 2. Respawn enabled
    npc.respawnEnabled = true
    // Reset respawnTimer to trigger respawn
    ;(npc as any).respawnTimer = 0.5
    npc.update(1.0, player, [npc], [npc], [], null as any, () => {}, () => {}, true)
    expect(npc.dead).toBe(false)
    expect(npc.currentState).toBe(AIState.IDLE)
    expect(npc.hp).toBe(npc.maxHp)
  })

  it('applies damage flash, excludes shield, and restores original materials when timer expires', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, 'TestRoman', 1, false)

    const flashTargets = (npc as any)._flashTargets as Array<{ mesh: THREE.Mesh; originalMat: THREE.Material }>
    expect(flashTargets.length).toBeGreaterThan(0)

    // Shield meshes must not be in flashTargets
    const shieldPivot = (npc as any).shieldPivot as THREE.Group
    for (const target of flashTargets) {
      expect(shieldPivot.getObjectById(target.mesh.id)).toBeUndefined()
    }

    // Capture original materials
    const originalMaterials = flashTargets.map(t => t.mesh.material)

    // Apply damage
    npc.takeDamage(10)
    expect((npc as any)._isFlashing).toBe(true)
    expect((npc as any).flashTimer).toBe(0.15)

    // All flash targets and headMesh should now have flashMat
    for (const target of flashTargets) {
      expect(target.mesh.material).toBe((npc as any).flashMat)
    }
    expect((npc as any).headMesh.material).toBe((npc as any).flashMat)

    // Repeated hit while flashing resets timer
    npc.update(0.05, player, [npc], [npc], [], null as any, () => {}, () => {}, true)
    expect((npc as any).flashTimer).toBeCloseTo(0.10, 3)
    npc.takeDamage(10)
    expect((npc as any).flashTimer).toBe(0.15)
    expect((npc as any)._isFlashing).toBe(true)

    // Advance time past remaining flash duration (0.2s > 0.15s)
    npc.update(0.2, player, [npc], [npc], [], null as any, () => {}, () => {}, true)
    expect((npc as any)._isFlashing).toBe(false)

    // Materials must be perfectly restored
    for (let i = 0; i < flashTargets.length; i++) {
      expect(flashTargets[i].mesh.material).toBe(originalMaterials[i])
    }
    expect((npc as any).headMesh.material).toBe((npc as any).headMat)
  })

  it('restores damage flash if NPC dies while flashing', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'viking', AIType.MELEE, 'TestViking', 1, false)

    const flashTargets = (npc as any)._flashTargets as Array<{ mesh: THREE.Mesh; originalMat: THREE.Material }>
    const originalMaterials = flashTargets.map(t => t.mesh.material)

    // Lethal hit
    npc.takeDamage(9999)
    expect(npc.dead).toBe(true)
    expect((npc as any)._isFlashing).toBe(true)

    // Update through death fast path past flash duration
    npc.update(0.2, player, [npc], [npc], [], null as any, () => {}, () => {}, true)
    expect((npc as any)._isFlashing).toBe(false)

    // Materials must be restored even in dead state
    for (let i = 0; i < flashTargets.length; i++) {
      expect(flashTargets[i].mesh.material).toBe(originalMaterials[i])
    }
  })

  it('eliminates per-frame Vector3.clone allocations in NPC.update and helpers', () => {
    const scene = new THREE.Scene()
    // NPC with allied player so _findTarget does not evaluate player.combatPosition (which belongs to Player class)
    const player = new Player(scene)
    const allyNpc = new NPC(scene, 0, 80, Faction.PLAYER, 'viking', AIType.MELEE, 'AllyViking', 1, false)

    const horseNpc = new NPC(scene, 0, 80, Faction.PLAYER, 'viking', AIType.MELEE, 'MountedViking', 1, false)
    const mount = new Mount(scene, MountType.CORGI, 0, 80)
    horseNpc.mount = mount
    mount.setNpcRider(horseNpc, horseNpc.faction)
    expect(horseNpc.mount).not.toBeNull()

    const cloneCalls: string[] = []
    const origClone = THREE.Vector3.prototype.clone
    const cloneSpy = vi.spyOn(THREE.Vector3.prototype, 'clone').mockImplementation(function (this: THREE.Vector3) {
      cloneCalls.push(new Error().stack || '')
      return origClone.call(this)
    })

    try {
      // 1. Live update
      allyNpc.update(0.016, player, [allyNpc], [allyNpc], [], null as any, () => {}, () => {}, true)
      expect(cloneCalls).toEqual([])

      // 2. Patrol helper
      ;(allyNpc as any)._updatePatrol(0.016, [], true)
      expect(cloneCalls).toEqual([])

      // 3. Face target helper
      ;(allyNpc as any)._faceTarget(new THREE.Vector3(10, 0, 10))
      expect(cloneCalls).toEqual([])

      // 4. Dismount helper
      horseNpc.dismountFromMount()
      expect(cloneCalls).toEqual([])
      expect(horseNpc.mount).toBeNull()
    } finally {
      cloneSpy.mockRestore()
    }
  })
})
