import { describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { shareIdenticalSkinSkeletons, optimizeSelectedAnimationClips, shareSelectedLodPose, validateSelectedLodAnimations } from '../../src/world/SelectedLodPose'

describe('selected LOD pose sharing', () => {
  it('coalesces only identical actor joints and inverse binds, preserving foreign actor skeletons', () => {
    const root = new THREE.Group(), bone = new THREE.Bone(), peerBone = new THREE.Bone()
    bone.name = peerBone.name = 'hips'; root.add(bone, peerBone)
    const geometry = new THREE.BufferGeometry(), material = new THREE.MeshBasicMaterial()
    const make = (joint: THREE.Bone, inverse: THREE.Matrix4) => {
      const mesh = new THREE.SkinnedMesh(geometry, material)
      mesh.bind(new THREE.Skeleton([joint], [inverse]), new THREE.Matrix4()); root.add(mesh)
      return mesh
    }
    const first = make(bone, new THREE.Matrix4()), same = make(bone, new THREE.Matrix4())
    const differentBind = make(bone, new THREE.Matrix4().makeTranslation(0, -.25, 0))
    const peer = make(peerBone, new THREE.Matrix4())
    const originals = [first, same, differentBind, peer].map(mesh => mesh.skeleton)
    onTestFinished(() => { for (const skeleton of new Set([first, same, differentBind, peer].map(mesh => mesh.skeleton))) skeleton.dispose(); geometry.dispose(); material.dispose() })
    shareIdenticalSkinSkeletons(root)
    expect(same.skeleton).toBe(first.skeleton)
    expect(differentBind.skeleton).toBe(originals[2])
    expect(peer.skeleton).toBe(originals[3])
    expect(differentBind.skeleton).not.toBe(first.skeleton)
    expect(peer.skeleton).not.toBe(first.skeleton)
    expect(differentBind.skeleton.boneInverses[0].elements[13]).toBe(-.25)
    bone.position.x = 2
    expect(peer.skeleton.bones[0].position.x).toBe(0)
  })

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
