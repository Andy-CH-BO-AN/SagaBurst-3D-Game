import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { optimizeSelectedAnimationClips, shareSelectedLodPose, validateSelectedLodAnimations } from '../../src/world/SelectedLodPose'

describe('selected LOD pose sharing', () => {
  it('keeps a visible lower mesh deforming when the primary mesh is hidden', () => {
    const root = new THREE.Group(), bone = new THREE.Bone()
    bone.name = 'hips'; root.name = 'armature'; root.add(bone)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4))
    const material = new THREE.MeshBasicMaterial(), mesh = new THREE.SkinnedMesh(geometry, material)
    mesh.name = 'body'; root.add(mesh); root.updateMatrixWorld(true)
    mesh.bind(new THREE.Skeleton([bone]))
    const lower = clone(root), otherActor = clone(root)
    shareSelectedLodPose(root, lower)
    const lowerMesh = lower.getObjectByName('body') as THREE.SkinnedMesh
    root.visible = false; bone.position.x = 2
    root.updateMatrixWorld(true); lower.updateMatrixWorld(true)
    expect(lowerMesh.getVertexPosition(0, new THREE.Vector3()).x).toBe(2)
    expect((otherActor.getObjectByName('body') as THREE.SkinnedMesh).getVertexPosition(0, new THREE.Vector3()).x).toBe(0)
    expect(lower.getObjectByName('hips')).toBeUndefined()
    expect(lowerMesh.skeleton).toBe(mesh.skeleton)
    mesh.skeleton.dispose(); (otherActor.getObjectByName('body') as THREE.SkinnedMesh).skeleton.dispose()
    geometry.dispose(); material.dispose()
  })

  it('rejects different animation samples rather than silently using LOD0 motion', () => {
    const clip = new THREE.AnimationClip('walk', 1, [new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 0, 0, 1, 0, 0])])
    const altered = clip.clone(); altered.tracks[0].values[3] = 2
    expect(() => validateSelectedLodAnimations([[clip], [altered]])).toThrow('animation differs')
  })

  it('removes only bind-invariant properties across every clip and leaves source tracks intact', () => {
    const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'hand_l'; root.add(bone)
    const constant = new THREE.VectorKeyframeTrack('hand_l.scale', [0, 1], [1, 1, 1, 1, 1, 1])
    const first = new THREE.AnimationClip('idle', 1, [constant, new THREE.VectorKeyframeTrack('hand_l.position', [0, 1], [0, 0, 0, 0, 0, 0])])
    const second = new THREE.AnimationClip('walk', 1, [constant.clone(), new THREE.VectorKeyframeTrack('hand_l.position', [0, 1], [0, 0, 0, 2, 0, 0])])
    const optimized = optimizeSelectedAnimationClips(root, [first, second])
    expect(optimized.map(clip => clip.tracks.map(track => track.name))).toEqual([['hand_l.position'], ['hand_l.position']])
    expect(first.tracks).toHaveLength(2)
    const originalRoot = root.clone(), optimizedRoot = root.clone()
    const originalMixer = new THREE.AnimationMixer(originalRoot), optimizedMixer = new THREE.AnimationMixer(optimizedRoot)
    originalMixer.clipAction(second).play(); optimizedMixer.clipAction(optimized[1]).play()
    originalMixer.update(.37); optimizedMixer.update(.37)
    originalRoot.updateMatrixWorld(true); optimizedRoot.updateMatrixWorld(true)
    expect(optimizedRoot.children[0].matrixWorld.elements).toEqual(originalRoot.children[0].matrixWorld.elements)
    originalMixer.stopAllAction(); originalMixer.uncacheRoot(originalRoot)
    optimizedMixer.stopAllAction(); optimizedMixer.uncacheRoot(optimizedRoot)
  })
})
