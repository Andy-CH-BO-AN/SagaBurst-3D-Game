import { Object3D, type Material } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  EquipmentVisualLODController,
  equipmentDetail,
  equipmentLod2Proxy,
} from '../../src/world/EquipmentVisualLODController'
import { LOD2_BATCHED_SOURCE_LAYER } from '../../src/world/Lod2EquipmentBatcher'
import { canMergeRepairLod2Patch } from '../../src/world/HumanoidLod2Consolidation'
import { materialRenderContract, sameMaterialRenderContract } from '../../src/world/MaterialRenderContract'
import { copyMultiMergedSeatSupport } from '../../src/world/SkinnedSeatContact'

interface FakeNode {
  userData: Record<string, unknown>
  visible: boolean
  castShadow: boolean
  isMesh?: boolean
  isSkinnedMesh?: boolean
  material?: unknown
  children: FakeNode[]
  layers: { mask: number; set: (ch: number) => void }
  traverse: (fn: (node: FakeNode) => void) => void
}

function makeFakeMesh(name: string, parentChildren: FakeNode[]): FakeNode {
  const node: FakeNode = {
    userData: { name },
    visible: true,
    castShadow: true,
    isMesh: true,
    isSkinnedMesh: false,
    material: { id: 1 },
    children: [],
    layers: {
      mask: 1,
      set(ch: number) {
        this.mask = 1 << ch
      },
    },
    traverse(fn) {
      fn(this)
    },
  }
  parentChildren.push(node)
  return node
}

describe('Stage 4 runtime LOD2 equipment batching and contract', () => {
  it('tracks leaf LOD2 proxies and enables batch layer without mutating .visible visibility semantics', () => {
    const children: FakeNode[] = []
    const root: FakeNode = {
      userData: {},
      visible: true,
      castShadow: false,
      children,
      layers: { mask: 1, set() {} },
      traverse(fn) {
        fn(this)
        for (const child of this.children) child.traverse(fn)
      },
    }
    const detailMesh = equipmentDetail(makeFakeMesh('hi-detail', children) as unknown as Object3D, 1) as unknown as FakeNode
    const proxyMesh = equipmentLod2Proxy(makeFakeMesh('lod2-proxy', children) as unknown as Object3D) as unknown as FakeNode

    const controller = new EquipmentVisualLODController()
    controller.register('shield', root as unknown as Object3D)
    expect(controller.lod2BatchedMeshes).toHaveLength(1)
    expect(detailMesh.visible).toBe(true)
    expect(proxyMesh.visible).toBe(false)

    controller.enableBatchLayer()
    expect(proxyMesh.layers.mask).toBe(1 << LOD2_BATCHED_SOURCE_LAYER)
    expect(proxyMesh.visible).toBe(false)

    controller.setLOD(2)
    expect(detailMesh.visible).toBe(false)
    expect(proxyMesh.visible).toBe(true)
    expect(proxyMesh.layers.mask).toBe(1 << LOD2_BATCHED_SOURCE_LAYER)
  })

  it('returns LOD1 batched equipment to its own layers when batching stops or the kind is re-registered', () => {
    const children: FakeNode[] = []
    const root: FakeNode = {
      userData: {}, visible: true, castShadow: false, children,
      layers: { mask: 1, set() {} },
      traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn) },
    }
    const asRigid = (node: FakeNode) => Object.assign(node, { onBeforeRender: Object3D.prototype.onBeforeRender })
    const shield = asRigid(makeFakeMesh('shield-face', children))
    shield.layers.mask = 1 | (1 << 4)
    const skinned = asRigid(makeFakeMesh('strap', children))
    skinned.isSkinnedMesh = true
    const translucent = asRigid(makeFakeMesh('glass', children))
    translucent.material = { transparent: true }

    const controller = new EquipmentVisualLODController()
    controller.register('shield', root as unknown as Object3D)
    expect(controller.lod1BatchMeshes).toEqual([shield])

    controller.setLod1MeshBatched(0, true)
    expect(shield.layers.mask).toBe(1 << LOD2_BATCHED_SOURCE_LAYER)
    controller.restoreLod1Layers()
    expect(shield.layers.mask).toBe(1 | (1 << 4))

    controller.setLod1MeshBatched(0, true)
    controller.register('shield', root as unknown as Object3D)
    expect(shield.layers.mask).toBe(1 | (1 << 4))
  })

  it('matches equivalent PBR material render contracts across distinct instances for generic LOD2 consolidation', () => {
    const texA = {
      mapping: 300,
      image: { width: 512, height: 512 },
      mipmaps: [],
      generateMipmaps: true,
      flipY: false,
      colorSpace: 'srgb',
      wrapS: 1000,
      wrapT: 1000,
      magFilter: 1006,
      minFilter: 1008,
      anisotropy: 4,
      channel: 0,
      matrixAutoUpdate: true,
      repeat: { x: 1, y: 1 },
      offset: { x: 0, y: 0 },
      center: { x: 0, y: 0 },
      rotation: 0,
      matrix: { toArray: () => [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    }
    const texB = { ...texA }
    const matA = {
      type: 'MeshStandardMaterial',
      side: 0,
      transparent: false,
      opacity: 1,
      alphaTest: 0,
      depthWrite: true,
      depthTest: true,
      colorWrite: true,
      blending: 1,
      blendSrc: 204,
      blendDst: 205,
      blendEquation: 100,
      blendSrcAlpha: null,
      blendDstAlpha: null,
      blendEquationAlpha: null,
      premultipliedAlpha: false,
      dithering: false,
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      flatShading: false,
      vertexColors: false,
      fog: true,
      toneMapped: true,
      color: { r: 1, g: 1, b: 1 },
      emissive: { r: 0, g: 0, b: 0 },
      emissiveIntensity: 1,
      roughness: 0.7,
      metalness: 0.1,
      envMapIntensity: 1,
      aoMapIntensity: 1,
      bumpScale: 1,
      displacementScale: 1,
      displacementBias: 0,
      lightMapIntensity: 1,
      normalMapType: 0,
      normalScale: { x: 1, y: 1 },
      map: texA,
      normalMap: null,
      roughnessMap: null,
      metalnessMap: null,
      aoMap: null,
      emissiveMap: null,
      alphaMap: null,
      bumpMap: null,
      displacementMap: null,
      lightMap: null,
      envMap: null,
    }
    const matB = { ...matA, map: texB }
    const matDifferent = { ...matA, roughness: 0.25 }

    expect(sameMaterialRenderContract(
      materialRenderContract(matA as unknown as Material),
      materialRenderContract(matB as unknown as Material),
    )).toBe(true)
    expect(sameMaterialRenderContract(
      materialRenderContract(matA as unknown as Material),
      materialRenderContract(matDifferent as unknown as Material),
    )).toBe(false)
    expect(canMergeRepairLod2Patch(
      { ...matA, name: 'Material_0' } as unknown as Material,
      { ...matA, name: 'Repair_Red_Cloth_Atlas_Matte', roughness: 0.92, metalness: 0 } as unknown as Material,
    )).toBe(true)
    expect(canMergeRepairLod2Patch(
      { ...matA, name: 'Material_0' } as unknown as Material,
      { ...matA, name: 'Repair_Dark_Inner_Torso_Lining', map: null } as unknown as Material,
    )).toBe(false)

    const seatMerged: { userData: Record<string, unknown> } = { userData: {} }
    copyMultiMergedSeatSupport([
      { userData: {}, geometry: { attributes: { position: { count: 100 } } } },
      { userData: { seatedBearingPoints: [{ ids: [1, 2, 3], weights: [0.2, 0.3, 0.5] }] }, geometry: { attributes: { position: { count: 50 } } } },
    ] as unknown as Parameters<typeof copyMultiMergedSeatSupport>[0], seatMerged as unknown as Parameters<typeof copyMultiMergedSeatSupport>[1])
    expect(seatMerged.userData.seatedBearingPoints).toEqual([{ ids: [101, 102, 103], weights: [0.2, 0.3, 0.5] }])
    vi.restoreAllMocks()
  })
})
