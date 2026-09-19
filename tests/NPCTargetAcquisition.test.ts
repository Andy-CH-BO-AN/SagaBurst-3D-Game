import * as THREE from 'three'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NPC, Faction, AIType, AIState, TARGET_REACQUIRE_INTERVAL, computeDeterministicPhase } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'

describe('NPC Target Acquisition Caching & Staggered Reacquisition', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function updateNpc(npc: NPC, player: Player, npcs: NPC[], dt = 0.016) {
    npc.update(
      dt,
      player,
      npcs,
      [],
      [],
      null as any,
      () => {},
      () => {},
      true,
    )
  }

  it('performs immediate target acquisition on first update and initializes staggered phase timer', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 0)

    const enemy = new NPC(scene, 0, 10, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanEnemy', 1, false)
    const findTargetSpy = vi.spyOn(enemy as any, '_findTarget')

    expect((enemy as any)._targetAcquisitionInitialized).toBe(false)

    // First update: should immediately find target
    updateNpc(enemy, player, [enemy])

    expect((enemy as any)._targetAcquisitionInitialized).toBe(true)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)

    // Stagger phase timer must be initialized to phase * TARGET_REACQUIRE_INTERVAL
    const phase = computeDeterministicPhase(0, 10, 'RomanEnemy')
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThan(1)
  })

  it('reuses sticky cached target within the 0.1s interval without repeated scans', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100) // far away

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'Viking1', 1, false)
    const enemy1 = new NPC(scene, 0, 5, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman1', 1, false)
    const allNPCs = [npc, enemy1]

    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    // 1st update: initial search
    updateNpc(npc, player, allNPCs, 0.01)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemy1)

    // Manually set timer to 0.08s to test consecutive frames inside interval
    ;(npc as any)._targetReacquireTimer = 0.08

    // 4 consecutive frames (each 0.016s = 0.064s total < 0.08s)
    for (let i = 0; i < 4; i++) {
      updateNpc(npc, player, allNPCs, 0.016)
    }

    // Must NOT have called _findTarget again
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemy1)
  })

  it('dynamically reads live combat position of cached target NPC each frame', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingTrack', 1, false)
    const enemy = new NPC(scene, 0, 5, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTrack', 1, false)
    const allNPCs = [npc, enemy]

    // Initial acquisition
    updateNpc(npc, player, allNPCs, 0.01)
    ;(npc as any)._targetReacquireTimer = 1.0 // keep cached for this test

    // Frame 1: enemy at (0, 0, 5)
    let target = (npc as any)._getTarget(0.016, player, allNPCs)
    expect(target.position.z).toBeCloseTo(5)

    // Enemy moves to (10, 0, 20)
    enemy.group.position.set(10, 0, 20)

    // Frame 2: npc reads live position without running full search
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')
    target = (npc as any)._getTarget(0.016, player, allNPCs)

    expect(findTargetSpy).not.toHaveBeenCalled()
    expect(target.position.x).toBeCloseTo(10)
    expect(target.position.z).toBeCloseTo(20)
  })

  it('runs periodic reacquisition at 10 Hz and switches to a closer hostile', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'Viking1', 1, false)
    const enemyFar = new NPC(scene, 0, 20, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanFar', 1, false)
    const enemyNear = new NPC(scene, 0, 4, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanNear', 1, false)

    // Start with only enemyFar in the scene
    const allNPCs = [npc, enemyFar]
    updateNpc(npc, player, allNPCs, 0.01)
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    // Now enemyNear enters the battlefield
    allNPCs.push(enemyNear)

    // While timer > 0, enemyFar is still cached
    ;(npc as any)._targetReacquireTimer = 0.05
    updateNpc(npc, player, allNPCs, 0.02)
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    // Advance time past remaining timer (0.03s)
    updateNpc(npc, player, allNPCs, 0.04)

    // Must have reacquired and switched to the closer enemy
    expect((npc as any)._cachedTargetNpc).toBe(enemyNear)
  })

  it('preserves fractional phase overrun upon periodic timer expiry', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingTimer', 1, false)
    const enemy = new NPC(scene, 0, 10, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTimer', 1, false)

    updateNpc(npc, player, [npc, enemy], 0.01)

    // Set timer to 0.03s
    ;(npc as any)._targetReacquireTimer = 0.03

    // Update with dt = 0.05s (overrun by 0.02s)
    updateNpc(npc, player, [npc, enemy], 0.05)

    // New timer should be (0.03 - 0.05) + 0.1 = 0.08s
    expect((npc as any)._targetReacquireTimer).toBeCloseTo(0.08, 4)
  })

  it('scans only once even if a single frame dt spans multiple 0.1s cycles', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingLag', 1, false)
    const enemy = new NPC(scene, 0, 10, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanLag', 1, false)

    updateNpc(npc, player, [npc, enemy], 0.01)
    ;(npc as any)._targetReacquireTimer = 0.05

    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    // A large dt of 0.25s (spans 2.5 cycles)
    updateNpc(npc, player, [npc, enemy], 0.25)

    // Must only have scanned ONCE in this frame
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    // Timer must be advanced to a positive value
    expect((npc as any)._targetReacquireTimer).toBeGreaterThan(0)
    expect((npc as any)._targetReacquireTimer).toBeLessThanOrEqual(TARGET_REACQUIRE_INTERVAL)
  })

  it('triggers immediate invalidation and reacquires without delay when target dies', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'Viking1', 1, false)
    const enemy1 = new NPC(scene, 0, 5, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman1', 1, false)
    const enemy2 = new NPC(scene, 0, 12, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman2', 1, false)
    const allNPCs = [npc, enemy1, enemy2]

    // Initial acquisition locks enemy1
    updateNpc(npc, player, allNPCs, 0.01)
    expect((npc as any)._cachedTargetNpc).toBe(enemy1)

    // Set large remaining timer to prove we don't wait for timer
    ;(npc as any)._targetReacquireTimer = 0.09

    // Kill enemy1
    enemy1.takeDamage(9999)
    expect(enemy1.dead).toBe(true)

    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    // Next update (dt=0.016): immediate reacquisition should run
    updateNpc(npc, player, allNPCs, 0.016)

    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemy2)
  })

  it('triggers immediate invalidation when targeted Player becomes untargetable', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 5)

    const enemy = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanVsPlayer', 1, false)
    const bystander = new NPC(scene, 0, 50, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingFar', 1, false)
    const allNPCs = [enemy, bystander]

    // Initial acquisition locks player
    updateNpc(enemy, player, allNPCs, 0.01)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)

    ;(enemy as any)._targetReacquireTimer = 0.09

    // Player dies or enters spectator
    player.takeDamage(9999, { setFill: vi.fn() } as any)
    expect(player.targetable).toBe(false)

    const findTargetSpy = vi.spyOn(enemy as any, '_findTarget')
    updateNpc(enemy, player, allNPCs, 0.016)

    // Must immediately reacquire bystander
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(false)
    expect((enemy as any)._cachedTargetNpc).toBe(bystander)
  })

  it('reads Player position without calling player.combatPosition (avoids Vector3 clone)', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(3, 0, 7)

    const enemy = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanNoClone', 1, false)
    const combatPosSpy = vi.spyOn(player, 'combatPosition', 'get')

    updateNpc(enemy, player, [enemy], 0.016)

    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)
    const target = (enemy as any)._getTarget(0.016, player, [enemy])

    expect(target.position.x).toBeCloseTo(3)
    expect(target.position.z).toBeCloseTo(7)
    // combatPosition getter must NOT have been called
    expect(combatPosSpy).not.toHaveBeenCalled()
  })

  it('correctly tracks mounted enemy and smoothly switches to foot position upon dismount', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const mount = new Mount(scene, MountType.CORGI, 0, 15)
    const enemyRider = new NPC(scene, 0, 15, Faction.ENEMY, 'roman', AIType.MELEE, 'RiderEnemy', 1, false)
    enemyRider.mount = mount
    mount.setNpcRider(enemyRider, Faction.ENEMY)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingTracker', 1, false)
    updateNpc(npc, player, [npc, enemyRider], 0.01)

    // While mounted: combatPosition is mount position
    let target = (npc as any)._getTarget(0.016, player, [npc, enemyRider])
    expect(target.position.z).toBeCloseTo(15)

    // Mount moves
    mount.group.position.set(0, 0, 25)
    target = (npc as any)._getTarget(0.016, player, [npc, enemyRider])
    expect(target.position.z).toBeCloseTo(25)

    // Rider dismounts at (5, 0, 30)
    enemyRider.dismountFromMount()
    enemyRider.group.position.set(5, 0, 30)

    target = (npc as any)._getTarget(0.016, player, [npc, enemyRider])
    expect(target.position.x).toBeCloseTo(5)
    expect(target.position.z).toBeCloseTo(30)
  })

  it('retries at 10 Hz when no target is found in the battlefield instead of scanning every frame', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    // Friendly only, no enemies
    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingAlone', 1, false)
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    // 1st update: initial search (finds nothing)
    updateNpc(npc, player, [npc], 0.01)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBeNull()
    expect((npc as any)._cachedTargetIsPlayer).toBe(false)

    // 4 consecutive frames (total 0.064s < 0.1s)
    ;(npc as any)._targetReacquireTimer = 0.08
    for (let i = 0; i < 4; i++) {
      updateNpc(npc, player, [npc], 0.016)
    }

    // Must NOT have scanned every frame
    expect(findTargetSpy).toHaveBeenCalledTimes(1)

    // Advance past 0.08s
    updateNpc(npc, player, [npc], 0.02)
    // 10 Hz retry triggers
    expect(findTargetSpy).toHaveBeenCalledTimes(2)
  })

  it('produces deterministic, well-distributed phase offsets from construction data without Math.random', () => {
    const phase1 = computeDeterministicPhase(10.5, 20.3, 'Viking1')
    const phase2 = computeDeterministicPhase(10.5, 20.3, 'Viking1')
    const phase3 = computeDeterministicPhase(10.5, 20.3, 'Viking2')
    const phase4 = computeDeterministicPhase(12.0, 20.3, 'Viking1')

    // 1. Determinism
    expect(phase1).toBe(phase2)

    // 2. Different inputs produce different phases
    expect(phase1).not.toBe(phase3)
    expect(phase1).not.toBe(phase4)

    // 3. Range [0, 1)
    expect(phase1).toBeGreaterThanOrEqual(0)
    expect(phase1).toBeLessThan(1)

    // 4. Distribution across 200 units
    const phases: number[] = []
    for (let i = 0; i < 200; i++) {
      phases.push(computeDeterministicPhase(i * 1.5 - 50, (i % 20) * 3 - 30, `Unit ${i}`))
    }
    const min = Math.min(...phases)
    const max = Math.max(...phases)
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThan(1)
    // Spread should span across the interval
    expect(max - min).toBeGreaterThan(0.8)
  })
})
