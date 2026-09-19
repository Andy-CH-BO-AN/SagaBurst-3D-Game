import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import {
  HUMANOID_LOD_DISTANCES,
  HUMANOID_ANIMATION_THROTTLE_DISTANCE,
  HumanoidAssetRegistry,
} from '../src/world/HumanoidAssetRegistry'
import { CombatRenderWarmup } from '../src/world/CombatRenderWarmup'
import { tryCreateRomanLod2ConsolidationTemplate } from '../src/world/HumanoidLod2Consolidation'

let registrySnapshot: any = null

beforeEach(() => {
  registrySnapshot = HumanoidAssetRegistry._snapshotTemplatesForTesting()
  CombatRenderWarmup._resetForTesting()
})

afterEach(() => {
  if (registrySnapshot) {
    HumanoidAssetRegistry._restoreTemplatesForTesting(registrySnapshot)
  }
  CombatRenderWarmup._resetForTesting()
})

function createMockLODScene(lodIndex: number): THREE.Group {
  const root = new THREE.Group()
  root.name = `mock-humanoid-lod${lodIndex}`

  // Required bones
  const bones = [
    'hips', 'spine', 'chest', 'neck', 'head',
    'upper_leg_l', 'lower_leg_l', 'foot_l', 'toe_l',
    'upper_leg_r', 'lower_leg_r', 'foot_r', 'toe_r',
    'upper_arm_l', 'lower_arm_l', 'hand_l',
    'upper_arm_r', 'lower_arm_r', 'hand_r',
  ].map((name) => {
    const bone = new THREE.Bone()
    bone.name = name
    return bone
  })

  // Required sockets
  const sockets = [
    'socket_head', 'socket_pelvis', 'socket_back',
    'socket_foot_l', 'socket_foot_r',
    'socket_hand_l', 'socket_hand_r',
  ].map((name) => {
    const sock = new THREE.Group()
    sock.name = name
    return sock
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))

  const mat = new THREE.MeshStandardMaterial({ name: `mat-lod${lodIndex}` })
  const mesh = new THREE.SkinnedMesh(geo, mat)
  mesh.name = `mesh-lod${lodIndex}`
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.bind(new THREE.Skeleton(bones))

  bones.forEach((b) => root.add(b))
  sockets.forEach((s) => root.add(s))
  root.add(mesh)
  return root
}

function addRomanLod2ConsolidationPairs(root: THREE.Group): void {
  const source = root.children.find((child): child is THREE.SkinnedMesh => child instanceof THREE.SkinnedMesh)!
  const pairs = [
    ['Armour_top_1', 'Armour_top0'], ['Armour_top_2', 'Armour_top1'],
    ['Helmet3_1', 'Helmet30'], ['Helmet3_2', 'Helmet31'],
    ['New_eye', 'New_eye0'], ['New_eye_2', 'New_eye_20'],
    ['RomanUndertunic_l', 'RomanUndertunic'], ['RomanUndertunic_r', 'RomanUndertunic'],
  ]
  for (const [name, materialName] of pairs) {
    const mesh = new THREE.SkinnedMesh(source.geometry, new THREE.MeshStandardMaterial({ name: materialName }))
    mesh.name = name
    mesh.bind(source.skeleton)
    root.add(mesh)
  }
}

describe('Humanoid LOD Distances and Animation Throttle', () => {
  it('defines HUMANOID_LOD_DISTANCES as [0, 28, 60] for 0-28m LOD0, 28-60m LOD1, >60m LOD2', () => {
    expect(HUMANOID_LOD_DISTANCES).toEqual([0, 28, 60])
    expect(HUMANOID_LOD_DISTANCES[0]).toBe(0)
    expect(HUMANOID_LOD_DISTANCES[1]).toBe(28)
    expect(HUMANOID_LOD_DISTANCES[2]).toBe(60)
  })

  it('keeps HUMANOID_ANIMATION_THROTTLE_DISTANCE semantic constant at 28m decoupled from LOD policy', () => {
    expect(HUMANOID_ANIMATION_THROTTLE_DISTANCE).toBe(28)
  })

  it('regression: a Roman LOD2 that cannot be consolidated still warms and creates with its original representation', () => {
    const lod0 = createMockLODScene(0)
    const lod1 = createMockLODScene(1)
    const lod2 = createMockLODScene(2) // Valid rig, but intentionally no named consolidation pairs.
    const dangles = lod2.getObjectByName('mesh-lod2') as THREE.SkinnedMesh
    dangles.name = 'Dangles'
    const romanLod2Consolidation = tryCreateRomanLod2ConsolidationTemplate(lod2, () => undefined)
    expect(romanLod2Consolidation).toBeUndefined()
    const mockTemplate = {
      manifest: { status: 'ready' as const, files: { lod0: '', lod1: '', lod2: '' }, metrics: { heightM: 1.78, shoulderWidthM: 0.46, neckLengthM: 0.09 } },
      levels: [{ scene: lod0, animations: [] }, { scene: lod1, animations: [] }, { scene: lod2, animations: [] }],
      bowClips: [[], [], []],
      romanLod2Consolidation,
    }
    const templatesMap = (HumanoidAssetRegistry as any).templates as Map<string, any>
    templatesMap.set('roman', mockTemplate)

    const warmup = HumanoidAssetRegistry.createWarmupGroup()
    const warmupLod2 = warmup.getObjectByName('roman-warmup-lod2')!
    expect(warmupLod2.getObjectByName('Dangles')).toMatchObject({ visible: true })

    const instance = HumanoidAssetRegistry.createCharacterInstance({ faction: 'roman' } as any)
    const lod = instance.root.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!
    const original = lod.levels[2].object.getObjectByName('Dangles')!
    expect(original).toBeInstanceOf(THREE.SkinnedMesh)
    expect(original.visible).toBe(true)
    expect(original.userData.humanoidLod2Consolidated).toBeUndefined()
  })

  it('regression: humanoidLod2Original keeps audited Roman LOD2 detail meshes untouched', () => {
    const lod0 = createMockLODScene(0)
    const lod1 = createMockLODScene(1)
    const lod2 = createMockLODScene(2)
    ;(lod2.getObjectByName('mesh-lod2') as THREE.SkinnedMesh).name = 'Dangles'
    addRomanLod2ConsolidationPairs(lod2)
    const romanLod2Consolidation = tryCreateRomanLod2ConsolidationTemplate(lod2, () => undefined)
    expect(romanLod2Consolidation).toBeDefined()
    const templatesMap = (HumanoidAssetRegistry as any).templates as Map<string, any>
    templatesMap.set('roman', {
      manifest: { status: 'ready' as const, files: { lod0: '', lod1: '', lod2: '' }, metrics: { heightM: 1.78, shoulderWidthM: 0.46, neckLengthM: 0.09 } },
      levels: [{ scene: lod0, animations: [] }, { scene: lod1, animations: [] }, { scene: lod2, animations: [] }],
      bowClips: [[], [], []],
      romanLod2Consolidation,
    })
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '?humanoidLod2Original' } } })
    try {
      const instance = HumanoidAssetRegistry.createCharacterInstance({ faction: 'roman' } as any)
      const lod = instance.root.children.find((child): child is THREE.LOD => child instanceof THREE.LOD)!
      const original = lod.levels[2].object
      expect(original.getObjectByName('Dangles')?.visible).toBe(true)
      expect(original.getObjectByName('New_eye')?.visible).toBe(true)
      expect(original.getObjectByName('roman-lod2-consolidated-New_eye-New_eye_2')).toBeUndefined()
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    }
  })

  it('regression: CombatRenderWarmup does not mutate canonical template state (parent, castShadow, receiveShadow, visible, layers, material)', () => {
    // 1. Inject synthetic templates into HumanoidAssetRegistry
    const lod0 = createMockLODScene(0)
    const lod1 = createMockLODScene(1)
    const lod2 = createMockLODScene(2)

    const mockTemplate = {
      manifest: {
        status: 'ready' as const,
        files: { lod0: '', lod1: '', lod2: '' },
        metrics: { heightM: 1.86, shoulderWidthM: 0.54, neckLengthM: 0.09 },
      },
      levels: [
        { scene: lod0, animations: [] },
        { scene: lod1, animations: [] },
        { scene: lod2, animations: [] },
      ],
      bowClips: [[], [], []],
    }

    const templatesMap = (HumanoidAssetRegistry as any).templates as Map<string, any>
    templatesMap.set('viking', mockTemplate)
    templatesMap.set('roman', mockTemplate)

    expect(HumanoidAssetRegistry.ready).toBe(true)

    // 2. Snapshot canonical template state before warmup
    interface NodeSnapshot {
      parent: THREE.Object3D | null
      castShadow: boolean
      receiveShadow: boolean
      visible: boolean
      layersMask: number
      materialRef: THREE.Material | THREE.Material[] | null
    }

    function captureState(root: THREE.Object3D): Map<THREE.Object3D, NodeSnapshot> {
      const map = new Map<THREE.Object3D, NodeSnapshot>()
      root.traverse((obj) => {
        const mesh = obj instanceof THREE.Mesh ? obj : null
        map.set(obj, {
          parent: obj.parent,
          castShadow: obj.castShadow,
          receiveShadow: obj.receiveShadow,
          visible: obj.visible,
          layersMask: obj.layers.mask,
          materialRef: mesh ? mesh.material : null,
        })
      })
      return map
    }

    const beforeLod0 = captureState(lod0)
    const beforeLod1 = captureState(lod1)
    const beforeLod2 = captureState(lod2)

    // Verify initial state: LOD2 template has castShadow === false, parent === null
    expect(lod2.parent).toBeNull()
    lod2.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        expect(obj.castShadow).toBe(false)
        expect(obj.receiveShadow).toBe(false)
      }
    })

    // 3. Run CombatRenderWarmup.warmup
    const mockRenderer = {
      compile: () => {},
      render: () => {},
      setRenderTarget: () => {},
      getRenderTarget: () => null,
    } as unknown as THREE.WebGLRenderer

    const gameCamera = new THREE.PerspectiveCamera()
    const gameScene = new THREE.Scene()

    CombatRenderWarmup.warmup(mockRenderer, gameCamera, gameScene)

    // 4. Assert canonical templates are 100% untouched
    function assertStateUnchanged(
      root: THREE.Object3D,
      snapshot: Map<THREE.Object3D, NodeSnapshot>,
      label: string,
    ) {
      expect(root.parent, `${label} parent must remain null`).toBeNull()
      root.traverse((obj) => {
        const before = snapshot.get(obj)
        expect(before, `${label} child missing from snapshot`).toBeDefined()
        expect(obj.parent).toBe(before!.parent)
        expect(obj.castShadow).toBe(before!.castShadow)
        expect(obj.receiveShadow).toBe(before!.receiveShadow)
        expect(obj.visible).toBe(before!.visible)
        expect(obj.layers.mask).toBe(before!.layersMask)
        if (obj instanceof THREE.Mesh) {
          expect(obj.material).toBe(before!.materialRef)
        }
      })
    }

    assertStateUnchanged(lod0, beforeLod0, 'LOD0')
    assertStateUnchanged(lod1, beforeLod1, 'LOD1')
    assertStateUnchanged(lod2, beforeLod2, 'LOD2')

    // 5. Explicitly verify newly spawned character instance keeps LOD2 castShadow === false
    const charInstance = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking' })
    const lodNode = charInstance.root.children.find((c) => c instanceof THREE.LOD) as THREE.LOD
    expect(lodNode).toBeDefined()

    // Inspect LOD levels: LOD0/1 cast shadows, LOD2 must NOT cast shadow
    const level0Mesh = (lodNode.levels[0].object as THREE.Group).children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
    const level1Mesh = (lodNode.levels[1].object as THREE.Group).children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
    const level2Mesh = (lodNode.levels[2].object as THREE.Group).children.find((c) => c instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh

    expect(level0Mesh.castShadow).toBe(true)
    expect(level1Mesh.castShadow).toBe(true)
    expect(level2Mesh.castShadow).toBe(false) // Strictly false, unpolluted by warmup!

    const level0Horn = lodNode.levels[0].object.getObjectByName('viking-horns')!
    const level1Horn = lodNode.levels[1].object.getObjectByName('viking-horns')!
    const level2Horn = lodNode.levels[2].object.getObjectByName('viking-horns')!
    expect(level0Horn.castShadow).toBe(true)
    expect(level1Horn.castShadow).toBe(true)
    expect(level2Horn.castShadow).toBe(false)
  })

  it('regression: CombatRenderWarmup handles renderer exceptions safely, restores render target, disposes temp target, and keeps isWarmed false', () => {
    expect(CombatRenderWarmup.isWarmed()).toBe(false)

    const prevRenderTarget = { isPrev: true } as unknown as THREE.WebGLRenderTarget
    let currentRenderTarget: any = prevRenderTarget
    let renderTargetDisposed = false

    let capturedTempTarget: any = null

    const failingRenderer = {
      compile: () => {},
      render: () => {
        throw new Error('GPU context lost / shader compilation aborted')
      },
      setRenderTarget: (target: any) => {
        currentRenderTarget = target
        if (target && target !== prevRenderTarget && typeof target.dispose === 'function') {
          capturedTempTarget = target
          const origDispose = target.dispose.bind(target)
          target.dispose = () => {
            renderTargetDisposed = true
            origDispose()
          }
        }
      },
      getRenderTarget: () => prevRenderTarget,
    } as unknown as THREE.WebGLRenderer

    CombatRenderWarmup.warmup(failingRenderer, new THREE.PerspectiveCamera(), new THREE.Scene())

    // Must not crash, must restore target, must dispose temp target, must keep isWarmed false
    expect(CombatRenderWarmup.isWarmed()).toBe(false)
    expect(currentRenderTarget).toBe(prevRenderTarget)
    expect(capturedTempTarget).not.toBeNull()
    expect(renderTargetDisposed).toBe(true)
  })

  it('regression Case A: getRenderTarget() returns null (default canvas framebuffer) + warmup succeeds -> restores setRenderTarget(null), temp disposed, isWarmed true', () => {
    CombatRenderWarmup._resetForTesting()
    expect(CombatRenderWarmup.isWarmed()).toBe(false)

    const setRenderTargetHistory: any[] = []
    let tempTargetDisposed = false
    let capturedTempTarget: any = null

    const successRenderer = {
      compile: () => {},
      render: () => {},
      setRenderTarget: (target: any) => {
        setRenderTargetHistory.push(target)
        if (target !== null && typeof target?.dispose === 'function') {
          capturedTempTarget = target
          const origDispose = target.dispose.bind(target)
          target.dispose = () => {
            tempTargetDisposed = true
            origDispose()
          }
        }
      },
      getRenderTarget: () => null, // Crucial: default framebuffer is null
    } as unknown as THREE.WebGLRenderer

    CombatRenderWarmup.warmup(successRenderer, new THREE.PerspectiveCamera(), new THREE.Scene())

    expect(CombatRenderWarmup.isWarmed()).toBe(true)
    expect(capturedTempTarget).not.toBeNull()
    // History should be: [tempTarget, null]
    expect(setRenderTargetHistory.length).toBe(2)
    expect(setRenderTargetHistory[0]).toBe(capturedTempTarget)
    expect(setRenderTargetHistory[1]).toBeNull() // Default framebuffer correctly restored!
    expect(tempTargetDisposed).toBe(true)
  })

  it('regression Case B: getRenderTarget() returns null (default canvas framebuffer) + renderer.render() throws -> restores setRenderTarget(null), temp disposed, isWarmed false', () => {
    CombatRenderWarmup._resetForTesting()
    expect(CombatRenderWarmup.isWarmed()).toBe(false)

    const setRenderTargetHistory: any[] = []
    let tempTargetDisposed = false
    let capturedTempTarget: any = null

    const failingRenderer = {
      compile: () => {},
      render: () => {
        throw new Error('GPU allocation failed during render')
      },
      setRenderTarget: (target: any) => {
        setRenderTargetHistory.push(target)
        if (target !== null && typeof target?.dispose === 'function') {
          capturedTempTarget = target
          const origDispose = target.dispose.bind(target)
          target.dispose = () => {
            tempTargetDisposed = true
            origDispose()
          }
        }
      },
      getRenderTarget: () => null, // Default framebuffer is null
    } as unknown as THREE.WebGLRenderer

    CombatRenderWarmup.warmup(failingRenderer, new THREE.PerspectiveCamera(), new THREE.Scene())

    expect(CombatRenderWarmup.isWarmed()).toBe(false)
    expect(capturedTempTarget).not.toBeNull()
    // History should be: [tempTarget, null]
    expect(setRenderTargetHistory.length).toBe(2)
    expect(setRenderTargetHistory[0]).toBe(capturedTempTarget)
    expect(setRenderTargetHistory[1]).toBeNull() // Default framebuffer correctly restored even after exception!
    expect(tempTargetDisposed).toBe(true)
  })
})
