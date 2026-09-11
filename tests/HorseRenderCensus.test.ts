import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createHorseInstance,
  type HorseAnimationState,
  type HorseAssetManifest,
  type HorseTemplate,
} from '../src/world/HorseAssetRegistry'
import {
  collectHorseRenderCensus,
  setHorseVisualsHidden,
  isHorseVisualHidden,
} from '../src/debug/HorseRenderCensus'
import type { Mount } from '../src/world/Mount'

function testTemplate(): HorseTemplate {
  const scene = new THREE.Group()
  const rootBone = new THREE.Bone()
  rootBone.name = 'horse.rig'
  const childBone = new THREE.Bone()
  childBone.name = 'DEF-spine.003'
  childBone.position.y = 1
  rootBone.add(childBone)
  scene.add(rootBone)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.25, 0, 0,
    0.25, 0, 0,
    0, 1, 0,
  ], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 0, 0,
    0, 0, 0, 0,
    1, 0, 0, 0,
  ], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ], 4))
  geometry.setIndex([0, 1, 2])

  const sourceMaterial = new THREE.MeshStandardMaterial()
  const skeleton = new THREE.Skeleton([rootBone, childBone])
  const lodNodes = ['horse_lod0', 'horse_lod1', 'horse_lod2']
  const bodyMeshNames = ['horse_body_lod0', 'horse_body_lod1', 'horse_body_lod2']
  for (let index = 0; index < lodNodes.length; index++) {
    const level = new THREE.Group()
    level.name = lodNodes[index]
    const mesh = new THREE.SkinnedMesh(geometry, sourceMaterial)
    mesh.name = bodyMeshNames[index]
    mesh.bind(skeleton)
    level.add(mesh)
    scene.add(level)
  }
  for (const name of [
    'socket_saddle_seat',
    'socket_stirrup_l',
    'socket_stirrup_r',
    'socket_camera',
  ]) {
    const socket = new THREE.Object3D()
    socket.name = name
    scene.add(socket)
  }

  const manifest: HorseAssetManifest = {
    schemaVersion: 2,
    id: 'test-horse',
    status: 'ready',
    attribution: 'test',
    sources: [],
    file: 'horse.glb',
    basisPath: '/basis/',
    lodNodes: { lod0: lodNodes[0], lod1: lodNodes[1], lod2: lodNodes[2] },
    bodyMeshNames,
    sharedBodyMaps: { normal: 'normal.ktx2', roughness: 'roughness.ktx2' },
    variants: [
      { id: 'a', label: 'A', baseColor: 'a.ktx2' },
      { id: 'b', label: 'B', baseColor: 'b.ktx2' },
      { id: 'c', label: 'C', baseColor: 'c.ktx2' },
    ],
    compression: {
      geometry: 'EXT_meshopt_compression',
      textures: 'KHR_texture_basisu',
    },
    metrics: {
      shoulderHeightM: 1.65,
      overallHeightM: 2,
      saddleHeightM: 1.75,
      widthM: 0.7,
      lengthM: 2.5,
      packageBytes: 1024,
      triangles: { lod0: 1, lod1: 1, lod2: 1 },
      textureMaxSize: 2048,
    },
    forward: '+Z',
    clips: [
      'idle', 'walk', 'trot', 'canter', 'gallop', 'jump', 'land', 'hit', 'death',
    ],
    sockets: [
      'socket_saddle_seat',
      'socket_stirrup_l',
      'socket_stirrup_r',
      'socket_camera',
    ],
  }

  const animations: THREE.AnimationClip[] = manifest.clips.map((clip) => {
    return new THREE.AnimationClip(clip, 1, [
      new THREE.VectorKeyframeTrack('DEF-spine.003.position', [0, 1], [0, 1, 0, 0, 1.1, 0]),
    ])
  })

  return {
    manifest,
    gltf: { scene, animations } as any,
    bodyMaterials: [
      new THREE.MeshStandardMaterial({ name: 'var-a' }),
      new THREE.MeshStandardMaterial({ name: 'var-b' }),
      new THREE.MeshStandardMaterial({ name: 'var-c' }),
    ],
  }
}

describe('HorseRenderCensus', () => {
  it('returns zeroes for empty mounts list', () => {
    const census = collectHorseRenderCensus([])
    expect(census.horseCount).toBe(0)
    expect(census.totalObject3DCount).toBe(0)
    expect(census.meshCount).toBe(0)
    expect(census.visibleMeshCount).toBe(0)
  })

  it('correctly audits horse instances and supports visibility toggling', () => {
    const template = testTemplate()
    const horse1 = createHorseInstance(template, 0)
    const horse2 = createHorseInstance(template, 1)

    const mockMount1 = {
      horseVisual: horse1,
      setVisualHidden: (hidden: boolean) => { horse1.root.visible = !hidden },
      isVisualHidden: () => !horse1.root.visible,
    } as unknown as Mount

    const mockMount2 = {
      horseVisual: horse2,
      setVisualHidden: (hidden: boolean) => { horse2.root.visible = !hidden },
      isVisualHidden: () => !horse2.root.visible,
    } as unknown as Mount

    const mounts = [mockMount1, mockMount2]

    // Initial census (Normal state)
    const censusNormal = collectHorseRenderCensus(mounts)
    expect(censusNormal.horseCount).toBe(2)
    expect(censusNormal.meshCount).toBe(6) // 3 meshes per horse (1 per LOD level)
    expect(censusNormal.skinnedMeshCount).toBe(6)
    expect(censusNormal.shadowCasterCount).toBe(2) // Total LOD0 casters in hierarchy
    expect(censusNormal.visibleShadowCasterCount).toBe(2) // Active in LOD0
    expect(censusNormal.receiveShadowCount).toBe(6)
    expect(censusNormal.uniqueGeometryCount).toBeGreaterThanOrEqual(1)
    expect(censusNormal.uniqueMaterialCount).toBe(2) // variant 0 and 1
    expect(censusNormal.meshCountPerLod.lod0).toBe(1)
    expect(censusNormal.meshCountPerLod.lod1).toBe(1)
    expect(censusNormal.meshCountPerLod.lod2).toBe(1)

    // Hide horse visuals
    setHorseVisualsHidden(mounts, true)
    expect(isHorseVisualHidden(mockMount1)).toBe(true)
    expect(isHorseVisualHidden(mockMount2)).toBe(true)
    expect(horse1.root.visible).toBe(false)
    expect(horse2.root.visible).toBe(false)

    // Hidden census
    const censusHidden = collectHorseRenderCensus(mounts)
    expect(censusHidden.horseCount).toBe(2)
    expect(censusHidden.visibleMeshCount).toBe(0)
    expect(censusHidden.visibleSkinnedMeshCount).toBe(0)

    // Restore horse visuals
    setHorseVisualsHidden(mounts, false)
    expect(isHorseVisualHidden(mockMount1)).toBe(false)
    expect(isHorseVisualHidden(mockMount2)).toBe(false)
    expect(horse1.root.visible).toBe(true)
    expect(horse2.root.visible).toBe(true)
  })
})
