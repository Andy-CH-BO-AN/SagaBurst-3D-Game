import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  createHorseInstance,
  type HorseAnimationState,
  type HorseAssetManifest,
  type HorseTemplate,
} from '../src/world/HorseAssetRegistry'

const CLIPS: HorseAnimationState[] = [
  'idle',
  'walk',
  'trot',
  'canter',
  'gallop',
  'jump',
  'land',
  'hit',
  'death',
]

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
      packageBytes: 1,
      triangles: { lod0: 1, lod1: 1, lod2: 1 },
      textureMaxSize: 2048,
    },
    forward: '+Z',
    clips: CLIPS,
    sockets: [
      'socket_saddle_seat',
      'socket_stirrup_l',
      'socket_stirrup_r',
      'socket_camera',
    ],
  }
  const animations = CLIPS.map((name) => new THREE.AnimationClip(name, 1, []))
  const gltf = { scene, scenes: [scene], animations } as unknown as GLTF
  return {
    manifest,
    gltf,
    bodyMaterials: [
      new THREE.MeshStandardMaterial({ color: 0x442211 }),
      new THREE.MeshStandardMaterial({ color: 0x221100 }),
      new THREE.MeshStandardMaterial({ color: 0x110000 }),
    ],
  }
}

describe('HorseAssetRegistry instance isolation', () => {
  it('shares immutable render resources but owns one independent skeleton and mixer', () => {
    const template = testTemplate()
    const first = createHorseInstance(template, 0)
    const second = createHorseInstance(template, 0)

    expect(first.root).not.toBe(second.root)
    expect(first.skeleton).not.toBe(second.skeleton)
    expect(first.skeleton.bones[0]).not.toBe(second.skeleton.bones[0])
    expect(first.mixer).not.toBe(second.mixer)
    expect(first.debugState()).toMatchObject({ mixerCount: 1, skeletonCount: 1 })
    expect(second.debugState()).toMatchObject({ mixerCount: 1, skeletonCount: 1 })

    const firstBodies = template.manifest.bodyMeshNames.map((name) => (
      first.root.getObjectByName(name) as THREE.SkinnedMesh
    ))
    const secondBodies = template.manifest.bodyMeshNames.map((name) => (
      second.root.getObjectByName(name) as THREE.SkinnedMesh
    ))
    firstBodies.forEach((mesh, index) => {
      expect(mesh.geometry).toBe(secondBodies[index].geometry)
      expect(mesh.material).toBe(secondBodies[index].material)
      expect(mesh.skeleton).toBe(first.skeleton)
      expect(secondBodies[index].skeleton).toBe(second.skeleton)
    })

    const sharedIdle = template.gltf.animations.find((clip) => clip.name === 'idle')!
    expect(first.mixer.existingAction(sharedIdle)?.getClip()).toBe(sharedIdle)
    expect(second.mixer.existingAction(sharedIdle)?.getClip()).toBe(sharedIdle)
    expect(first.mixer.existingAction(sharedIdle)).not.toBe(second.mixer.existingAction(sharedIdle))

    first.setAppearanceVariant(1)
    expect(firstBodies[0].material).toBe(template.bodyMaterials[1])
    expect(secondBodies[0].material).toBe(template.bodyMaterials[0])

    first.dispose()
    second.dispose()
  })

  it('scales locomotion playback against each gait reference speed', () => {
    const horse = createHorseInstance(testTemplate(), 0)

    horse.setLocomotion(2.4)
    expect(horse.debugState()).toMatchObject({ clip: 'walk', playbackRate: 1 })

    horse.setLocomotion(1.2)
    expect(horse.debugState()).toMatchObject({ clip: 'walk', playbackRate: 0.5 })

    horse.setLocomotion(5.25)
    expect(horse.debugState()).toMatchObject({ clip: 'trot', playbackRate: 1 })

    horse.setLocomotion(12)
    expect(horse.debugState()).toMatchObject({ clip: 'gallop', playbackRate: 1 })

    horse.playOnce('jump')
    horse.setLocomotion(6)
    horse.update(1.01)
    expect(horse.debugState()).toMatchObject({ clip: 'trot', playbackRate: 6 / 5.25 })

    horse.dispose()
  })
})
