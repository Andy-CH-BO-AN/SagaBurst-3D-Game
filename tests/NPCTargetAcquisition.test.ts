import * as THREE from 'three'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  NPC,
  Faction,
  AIType,
  TARGET_REACQUIRE_NEAR_FRAMES,
  TARGET_REACQUIRE_MID_FRAMES,
  TARGET_REACQUIRE_FAR_FRAMES,
  getTargetReacquireFrameInterval,
  computeDeterministicPhase,
} from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'
import { SpatialGrid } from '../src/world/SpatialGrid'

describe('NPC Target Acquisition Caching & Frame-based AI LOD', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildHostileGrid(npc: NPC, npcs: NPC[]): SpatialGrid<NPC> {
    const grid = new SpatialGrid<NPC>(20)
    for (const candidate of npcs) {
      if (!candidate.dead && candidate.faction !== npc.faction) grid.insert(candidate)
    }
    return grid
  }

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
      0,
      null,
      buildHostileGrid(npc, npcs),
    )
  }

  it('uses the hostile-only spatial grid and matches brute-force nearest-target selection', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingGrid', 1, false)
    const friendlyNear = new NPC(scene, 0, 1, Faction.PLAYER, 'viking', AIType.MELEE, 'FriendlyNear', 1, false)
    const enemyFar = new NPC(scene, 0, 45, Faction.ENEMY, 'roman', AIType.MELEE, 'EnemyFar', 1, false)
    const enemyNear = new NPC(scene, 21, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'EnemyNear', 1, false)
    const allNPCs = [npc, friendlyNear, enemyFar, enemyNear]
    const hostileGrid = buildHostileGrid(npc, allNPCs)
    const nearestSpy = vi.spyOn(hostileGrid, 'findNearest')

    const spatialTarget = (npc as any)._findTarget(player, allNPCs, hostileGrid)
    const bruteForceTarget = (npc as any)._findTarget(player, allNPCs, null)

    expect(nearestSpy).toHaveBeenCalledTimes(1)
    expect(spatialTarget?.npc).toBe(enemyNear)
    expect(spatialTarget?.npc).toBe(bruteForceTarget?.npc)
    expect(spatialTarget?.npc).not.toBe(friendlyNear)
  })

  it('maps target distance to 2 / 8 / 16 frame reacquisition bands', () => {
    expect(getTargetReacquireFrameInterval(0)).toBe(TARGET_REACQUIRE_NEAR_FRAMES)
    expect(getTargetReacquireFrameInterval(50)).toBe(TARGET_REACQUIRE_NEAR_FRAMES)
    expect(getTargetReacquireFrameInterval(50.01)).toBe(TARGET_REACQUIRE_MID_FRAMES)
    expect(getTargetReacquireFrameInterval(100)).toBe(TARGET_REACQUIRE_MID_FRAMES)
    expect(getTargetReacquireFrameInterval(100.01)).toBe(TARGET_REACQUIRE_FAR_FRAMES)
    expect(getTargetReacquireFrameInterval(null)).toBe(TARGET_REACQUIRE_FAR_FRAMES)
  })

  it('performs immediate first acquisition and initializes deterministic frame staggering', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 10)

    const enemy = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanEnemy', 1, false)
    const findTargetSpy = vi.spyOn(enemy as any, '_findTarget')

    expect((enemy as any)._targetAcquisitionInitialized).toBe(false)
    updateNpc(enemy, player, [enemy])

    expect((enemy as any)._targetAcquisitionInitialized).toBe(true)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)
    expect((enemy as any)._targetReacquireIntervalFrames).toBe(TARGET_REACQUIRE_NEAR_FRAMES)

    const phase = computeDeterministicPhase(0, 0, 'RomanEnemy')
    const expectedDelay = 1 + Math.floor(phase * TARGET_REACQUIRE_NEAR_FRAMES)
    expect((enemy as any)._targetReacquireFramesRemaining).toBe(expectedDelay)
  })

  it('reacquires every 2 frames when the cached target is within 50m', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingNear', 1, false)
    const enemyFar = new NPC(scene, 0, 20, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman20', 1, false)
    const enemyNear = new NPC(scene, 0, 4, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman4', 1, false)
    const allNPCs = [npc, enemyFar]

    updateNpc(npc, player, allNPCs)
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    allNPCs.push(enemyNear)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_NEAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_NEAR_FRAMES
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).not.toHaveBeenCalled()
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemyNear)
  })

  it('reacquires every 8 frames when the cached target is 51-100m away', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -150)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingMid', 1, false)
    const enemyFar = new NPC(scene, 0, 75, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman75', 1, false)
    const enemyNear = new NPC(scene, 0, 60, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman60', 1, false)
    const allNPCs = [npc, enemyFar]

    updateNpc(npc, player, allNPCs)
    allNPCs.push(enemyNear)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_MID_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_MID_FRAMES
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    for (let frame = 0; frame < TARGET_REACQUIRE_MID_FRAMES - 1; frame++) {
      updateNpc(npc, player, allNPCs)
    }
    expect(findTargetSpy).not.toHaveBeenCalled()
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemyNear)
  })

  it('reacquires every 16 frames when the cached target is over 100m away', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingFar', 1, false)
    const enemyFar = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman150', 1, false)
    const enemyNear = new NPC(scene, 0, 120, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman120', 1, false)
    const allNPCs = [npc, enemyFar]

    updateNpc(npc, player, allNPCs)
    allNPCs.push(enemyNear)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_FAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    for (let frame = 0; frame < TARGET_REACQUIRE_FAR_FRAMES - 1; frame++) {
      updateNpc(npc, player, allNPCs)
    }
    expect(findTargetSpy).not.toHaveBeenCalled()
    expect((npc as any)._cachedTargetNpc).toBe(enemyFar)

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemyNear)
  })

  it('uses frame cadence rather than elapsed dt', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingFrameClock', 1, false)
    const enemy = new NPC(scene, 0, 20, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanFrameClock', 1, false)
    const allNPCs = [npc, enemy]

    updateNpc(npc, player, allNPCs)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_NEAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_NEAR_FRAMES
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    updateNpc(npc, player, allNPCs, 2.0)
    expect(findTargetSpy).not.toHaveBeenCalled()

    updateNpc(npc, player, allNPCs, 0.001)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
  })

  it('reads the cached target live position every frame without waiting for reacquisition', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingTrack', 1, false)
    const enemy = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanTrack', 1, false)
    const allNPCs = [npc, enemy]

    updateNpc(npc, player, allNPCs)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_FAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES

    let target = (npc as any)._getTarget(0.016, player, allNPCs, buildHostileGrid(npc, allNPCs))
    expect(target.position.z).toBeCloseTo(150)

    enemy.group.position.set(10, 0, 160)
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')
    target = (npc as any)._getTarget(0.016, player, allNPCs, buildHostileGrid(npc, allNPCs))

    expect(findTargetSpy).not.toHaveBeenCalled()
    expect(target.position.x).toBeCloseTo(10)
    expect(target.position.z).toBeCloseTo(160)
  })

  it('raises decision frequency promptly when a cached target moves into a closer band', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingClosing', 1, false)
    const enemy = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanClosing', 1, false)
    const allNPCs = [npc, enemy]

    updateNpc(npc, player, allNPCs)
    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_FAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES

    enemy.group.position.set(0, 0, 40)
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).not.toHaveBeenCalled()
    expect((npc as any)._targetReacquireFramesRemaining).toBe(1)

    updateNpc(npc, player, allNPCs)
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._targetReacquireIntervalFrames).toBe(TARGET_REACQUIRE_NEAR_FRAMES)
  })

  it('immediately reacquires when the cached target dies regardless of frame countdown', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingInvalidation', 1, false)
    const enemy1 = new NPC(scene, 0, 20, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanDead', 1, false)
    const enemy2 = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanBackup', 1, false)
    const allNPCs = [npc, enemy1, enemy2]

    updateNpc(npc, player, allNPCs)
    expect((npc as any)._cachedTargetNpc).toBe(enemy1)
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES

    enemy1.takeDamage(9999)
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')
    updateNpc(npc, player, allNPCs)

    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((npc as any)._cachedTargetNpc).toBe(enemy2)
  })

  it('immediately reacquires when the targeted Player becomes untargetable', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 5)

    const enemy = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanVsPlayer', 1, false)
    const bystander = new NPC(scene, 0, 150, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingBackup', 1, false)
    const allNPCs = [enemy, bystander]

    updateNpc(enemy, player, allNPCs)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)
    ;(enemy as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES

    player.takeDamage(9999, { setFill: vi.fn() } as any)
    expect(player.targetable).toBe(false)

    const findTargetSpy = vi.spyOn(enemy as any, '_findTarget')
    updateNpc(enemy, player, allNPCs)

    expect(findTargetSpy).toHaveBeenCalledTimes(1)
    expect((enemy as any)._cachedTargetIsPlayer).toBe(false)
    expect((enemy as any)._cachedTargetNpc).toBe(bystander)
  })

  it('reads Player position without calling player.combatPosition', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(3, 0, 7)

    const enemy = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanNoClone', 1, false)
    const combatPosSpy = vi.spyOn(player, 'combatPosition', 'get')

    updateNpc(enemy, player, [enemy])

    expect((enemy as any)._cachedTargetIsPlayer).toBe(true)
    const target = (enemy as any)._getTarget(0.016, player, [enemy], buildHostileGrid(enemy, [enemy]))

    expect(target.position.x).toBeCloseTo(3)
    expect(target.position.z).toBeCloseTo(7)
    expect(combatPosSpy).not.toHaveBeenCalled()
  })

  it('tracks mounted target position every frame and switches to foot position on dismount', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const mount = new Mount(scene, MountType.CORGI, 0, 150)
    const enemyRider = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'RiderEnemy', 1, false)
    enemyRider.mount = mount
    mount.setNpcRider(enemyRider, Faction.ENEMY)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingTracker', 1, false)
    const allNPCs = [npc, enemyRider]
    updateNpc(npc, player, allNPCs)

    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_FAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES

    let target = (npc as any)._getTarget(0.016, player, allNPCs, buildHostileGrid(npc, allNPCs))
    expect(target.position.z).toBeCloseTo(150)

    mount.group.position.set(0, 0, 160)
    target = (npc as any)._getTarget(0.016, player, allNPCs, buildHostileGrid(npc, allNPCs))
    expect(target.position.z).toBeCloseTo(160)

    enemyRider.dismountFromMount()
    enemyRider.group.position.set(5, 0, 170)
    target = (npc as any)._getTarget(0.016, player, allNPCs, buildHostileGrid(npc, allNPCs))
    expect(target.position.x).toBeCloseTo(5)
    expect(target.position.z).toBeCloseTo(170)
  })

  it('retries every 16 frames when no target exists instead of scanning every frame', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -100)

    const npc = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingAlone', 1, false)
    updateNpc(npc, player, [npc])

    expect((npc as any)._cachedTargetNpc).toBeNull()
    expect((npc as any)._cachedTargetIsPlayer).toBe(false)

    ;(npc as any)._targetReacquireIntervalFrames = TARGET_REACQUIRE_FAR_FRAMES
    ;(npc as any)._targetReacquireFramesRemaining = TARGET_REACQUIRE_FAR_FRAMES
    const findTargetSpy = vi.spyOn(npc as any, '_findTarget')

    for (let frame = 0; frame < TARGET_REACQUIRE_FAR_FRAMES - 1; frame++) {
      updateNpc(npc, player, [npc])
    }
    expect(findTargetSpy).not.toHaveBeenCalled()

    updateNpc(npc, player, [npc])
    expect(findTargetSpy).toHaveBeenCalledTimes(1)
  })

  it('produces deterministic, well-distributed stagger phases and far-band frame slots', () => {
    const phase1 = computeDeterministicPhase(10.5, 20.3, 'Viking1')
    const phase2 = computeDeterministicPhase(10.5, 20.3, 'Viking1')
    const phase3 = computeDeterministicPhase(10.5, 20.3, 'Viking2')
    const phase4 = computeDeterministicPhase(12.0, 20.3, 'Viking1')

    expect(phase1).toBe(phase2)
    expect(phase1).not.toBe(phase3)
    expect(phase1).not.toBe(phase4)
    expect(phase1).toBeGreaterThanOrEqual(0)
    expect(phase1).toBeLessThan(1)

    const phases: number[] = []
    const slots = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const phase = computeDeterministicPhase(i * 1.5 - 50, (i % 20) * 3 - 30, `Unit ${i}`)
      phases.push(phase)
      slots.add(1 + Math.floor(phase * TARGET_REACQUIRE_FAR_FRAMES))
    }

    expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.8)
    expect(slots.size).toBeGreaterThanOrEqual(12)
  })

  it('re-staggers the next scan after same-frame target death invalidation', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, -200)

    const npcA = new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingA', 1, false)
    const npcB = new NPC(scene, 1, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'VikingB', 1, false)
    const sharedTarget = new NPC(scene, 0, 5, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanShared', 1, false)
    const backupTarget = new NPC(scene, 0, 150, Faction.ENEMY, 'roman', AIType.MELEE, 'RomanBackup', 1, false)
    const allNPCs = [npcA, npcB, sharedTarget, backupTarget]

    updateNpc(npcA, player, allNPCs)
    updateNpc(npcB, player, allNPCs)
    sharedTarget.takeDamage(9999)

    updateNpc(npcA, player, allNPCs)
    updateNpc(npcB, player, allNPCs)

    expect((npcA as any)._cachedTargetNpc).toBe(backupTarget)
    expect((npcB as any)._cachedTargetNpc).toBe(backupTarget)

    const expectedA = 1 + Math.floor((npcA as any)._initialStaggerPhase * TARGET_REACQUIRE_FAR_FRAMES)
    const expectedB = 1 + Math.floor((npcB as any)._initialStaggerPhase * TARGET_REACQUIRE_FAR_FRAMES)
    expect((npcA as any)._targetReacquireFramesRemaining).toBe(expectedA)
    expect((npcB as any)._targetReacquireFramesRemaining).toBe(expectedB)
  })
})
