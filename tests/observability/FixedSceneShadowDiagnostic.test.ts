import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { Game } from '../../src/Game'
import {
  findSceneShadowCameras,
  broadShadowCategory,
  collectShadowPassCensus,
} from '../../src/debug/ShadowPassCensus'

describe('Fixed-Scene Shadow Diagnostic Contracts', () => {
  it('identifies only genuine shadow cameras belonging to shadow-casting lights', () => {
    const scene = new THREE.Scene()

    // Non-shadow light
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambient)

    // Sun directional light casting shadow
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.castShadow = true
    scene.add(sun)

    // Light with castShadow false
    const lamp = new THREE.PointLight(0xffffff, 1.0)
    lamp.castShadow = false
    scene.add(lamp)

    // Perspective main camera in scene
    const mainCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000)
    scene.add(mainCamera)

    const shadowCameras = findSceneShadowCameras(scene)

    expect(shadowCameras.has(sun.shadow.camera)).toBe(true)
    expect(shadowCameras.size).toBe(1)
    expect(shadowCameras.has(mainCamera)).toBe(false)
  })

  it('correctly maps detailed categories to broad categories', () => {
    expect(broadShadowCategory('Horse LOD0')).toBe('Horse')
    expect(broadShadowCategory('Horse LOD2')).toBe('Horse')
    expect(broadShadowCategory('Horse other')).toBe('Horse')
    expect(broadShadowCategory('Viking Humanoid LOD0')).toBe('Viking Humanoid')
    expect(broadShadowCategory('Roman Humanoid LOD2')).toBe('Roman Humanoid')
    expect(broadShadowCategory('Equipment/sword')).toBe('Equipment')
    expect(broadShadowCategory('Equipment/shield')).toBe('Equipment')
    expect(broadShadowCategory('Equipment/lance')).toBe('Equipment')
    expect(broadShadowCategory('Terrain')).toBe('Other / Static')
    expect(broadShadowCategory('Trees/static')).toBe('Other / Static')
    expect(broadShadowCategory('Player')).toBe('Other / Static')
    expect(broadShadowCategory('Other/unknown')).toBe('Other / Static')
  })

  it('restores renderer.renderBufferDirect even if render throws an error', () => {
    const originalRenderBufferDirect = vi.fn()
    const renderer = {
      renderBufferDirect: originalRenderBufferDirect,
      info: {
        autoReset: true,
        render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      },
      render: vi.fn(() => {
        throw new Error('Forced test render failure')
      }),
    } as unknown as THREE.WebGLRenderer

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const mockGame = {
      renderer,
      scene,
      camera,
      npcs: [],
      mounts: [],
      player: { group: new THREE.Group() },
      arrows: [],
      pickups: [],
      _aimTargetRegistry: { targets: [] },
    }

    expect(() => collectShadowPassCensus(mockGame as any)).toThrow('Forced test render failure')
    expect(renderer.renderBufferDirect).toBe(originalRenderBufferDirect)
  })

  it('returns 0 shadow submissions and 0 triangles when no shadow calls are made (shadow OFF)', () => {
    const originalRenderBufferDirect = vi.fn()
    const renderer = {
      renderBufferDirect: originalRenderBufferDirect,
      info: {
        autoReset: true,
        render: { calls: 10, triangles: 100, points: 0, lines: 0 },
      },
      render: vi.fn(function (this: any) {
        // Simulates main camera render without any shadow camera calls
        const mockGeo = new THREE.BufferGeometry()
        const mockMat = new THREE.MeshBasicMaterial()
        const mockObj = new THREE.Mesh(mockGeo, mockMat)
        // Calling renderBufferDirect with the main camera (not shadow camera)
        this.renderBufferDirect(camera, scene, mockGeo, mockMat, mockObj, null)
      }),
    } as unknown as THREE.WebGLRenderer

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const mockGame = {
      renderer,
      scene,
      camera,
      npcs: [],
      mounts: [],
      player: { group: new THREE.Group() },
      arrows: [],
      pickups: [],
      _aimTargetRegistry: { targets: [] },
    }

    const census = collectShadowPassCensus(mockGame as any)

    expect(census.totalSubmissions).toBe(0)
    expect(census.totalTriangles).toBe(0)
    expect(census.categories.every((c) => c.shadowSubmissions === 0)).toBe(true)
    expect(renderer.renderBufferDirect).toBe(originalRenderBufferDirect)
  })

  it('drains the production clock only when Game unfreezes', () => {
    const getDelta = vi.fn(() => 5)
    // Clock is an external time boundary; all transition logic belongs to Game.
    const game = Object.assign(Object.create(Game.prototype) as Pick<Game, 'setSimulationFrozen' | 'isSimulationFrozen'>, {
      _isSimulationFrozen: false, clock: { getDelta },
    })
    expect(game.setSimulationFrozen(true)).toBe(true)
    expect(game.isSimulationFrozen).toBe(true)
    expect(getDelta).not.toHaveBeenCalled()
    expect(game.setSimulationFrozen(false)).toBe(false)
    expect(game.isSimulationFrozen).toBe(false)
    expect(getDelta).toHaveBeenCalledTimes(1)
    game.setSimulationFrozen(false)
    expect(getDelta).toHaveBeenCalledTimes(1)
  })

  it('Game shadow toggle preserves scene entity hierarchy and counts', () => {
    const scene = new THREE.Scene(), npcGroup = new THREE.Group()
    npcGroup.name = 'npc_0'; scene.add(npcGroup)
    const renderer = { shadowMap: { enabled: true } }
    // Prototype adapter supplies only fields consumed by this DEV entry point.
    const game = Object.assign(Object.create(Game.prototype) as Pick<Game, 'setShadowsEnabled'>, { scene, renderer })
    expect(game.setShadowsEnabled(false)).toBe(false)
    expect(renderer.shadowMap.enabled).toBe(false)
    expect(scene.children).toEqual([npcGroup])
    expect(scene.getObjectByName('npc_0')).toBe(npcGroup)
    expect(game.setShadowsEnabled(true)).toBe(true)
    expect(renderer.shadowMap.enabled).toBe(true)
    expect(scene.children).toEqual([npcGroup])
  })

  it('clears latestSnapshot on reset and increments snapshotGeneration on new windows', async () => {
    const { RuntimeProfiler } = await import('../../src/debug/RuntimeProfiler')
    const profiler = new RuntimeProfiler(100)
    profiler.reset(0)
    expect(profiler.getLatestSnapshot()).toBeNull()
    const g0 = profiler.getSnapshotGeneration()

    const mockFrame = {
      cpuFrameMs: 16,
      npcGridMs: 0,
      npcUpdateMs: 0,
      mountInteractionMs: 0,
      collisionMs: 0,
      arrowMs: 0,
      impactMs: 0,
      renderSubmitMs: 16,
      otherMs: 0,
    }

    profiler.recordFrame(mockFrame, 50)
    profiler.recordFrame(mockFrame, 150)
    expect(profiler.getLatestSnapshot()).not.toBeNull()
    expect(profiler.getSnapshotGeneration()).toBe(g0 + 1)
    expect(profiler.getLatestSnapshot()?.generation).toBe(g0 + 1)

    // Reset clears snapshot to prevent stale consumption
    profiler.reset(200)
    expect(profiler.getLatestSnapshot()).toBeNull()
  })
})
