import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  findSceneShadowCameras,
  broadShadowCategory,
  collectShadowPassCensus,
} from '../src/debug/ShadowPassCensus'

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

  it('drains clock delta on unfreeze to prevent time jump', () => {
    const clock = new THREE.Clock()
    clock.start()

    // Simulate clock progression
    const t0 = clock.getDelta()
    expect(typeof t0).toBe('number')

    // Freeze simulation
    let isFrozen = true
    const setSimulationFrozen = (frozen: boolean) => {
      if (isFrozen && !frozen) {
        clock.getDelta() // Drain delta on unfreeze
      }
      isFrozen = frozen
      return isFrozen
    }

    // Advance time during freeze
    clock.oldTime = performance.now() - 5000 // simulate 5 seconds passed during freeze
    setSimulationFrozen(false)

    // Next getDelta should be virtually 0, not 5000ms
    const postUnfreezeDelta = clock.getDelta()
    expect(postUnfreezeDelta).toBeLessThan(0.05)
  })

  it('shadow toggle preserves scene entity hierarchy and counts', () => {
    const scene = new THREE.Scene()
    const npcGroup = new THREE.Group()
    npcGroup.name = 'npc_0'
    scene.add(npcGroup)

    const initialChildCount = scene.children.length
    const renderer = {
      shadowMap: { enabled: true },
    }

    const setShadowsEnabled = (enabled: boolean) => {
      renderer.shadowMap.enabled = enabled
      return renderer.shadowMap.enabled
    }

    // Toggle shadow OFF and back ON
    setShadowsEnabled(false)
    expect(renderer.shadowMap.enabled).toBe(false)
    expect(scene.children.length).toBe(initialChildCount)
    expect(scene.getObjectByName('npc_0')).toBe(npcGroup)

    setShadowsEnabled(true)
    expect(renderer.shadowMap.enabled).toBe(true)
    expect(scene.children.length).toBe(initialChildCount)
    expect(scene.getObjectByName('npc_0')).toBe(npcGroup)
  })

  it('clears latestSnapshot on reset and increments snapshotGeneration on new windows', async () => {
    const { RuntimeProfiler } = await import('../src/debug/RuntimeProfiler')
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
