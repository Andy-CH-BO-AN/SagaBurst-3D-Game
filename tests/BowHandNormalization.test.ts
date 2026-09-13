import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { describe, it, expect } from 'vitest'
import { normalizeBowHandClips, prepareBowGripShape } from '../src/world/CanonicalBowGripPose'
import { applyBowAttachment, DEFAULT_BOW_GRIP_PROFILE } from '../src/world/BowAttachmentContract'
import { deriveDrawHandFrame } from '../src/world/BowDrawHand'
// @ts-expect-error diagnostic GLB loader strips textures for CPU-only checks
import { loadCharacter } from '../tools/humanoid-diagnostics/measure-hands.mjs'

describe('actual asset bow hand normalization', () => {
  for (const faction of ['viking', 'roman']) for (const lod of [0, 1, 2]) it(`${faction} LOD${lod}: preserves imported arm joint trajectories and keeps the wrist in its neutral bind frame`, async () => {
    const gltf = await loadCharacter(faction, lod)
    const sourceRoot = clone(gltf.scene)
    const sourceMixer = new THREE.AnimationMixer(sourceRoot)
    const data = JSON.parse(readFileSync(`public/models/characters/v2/${faction}/manifest.json`, 'utf8')).handGripFrames.left
    const frame = {
      ...data,
      palmContactCenter: new THREE.Vector3(...data.palmContactCenter),
      palmNormal: new THREE.Vector3(...data.palmNormal),
      thumbDirection: new THREE.Vector3(...data.thumbDirection),
      fingerDirection: new THREE.Vector3(...data.fingerDirection),
      thumbBaseCenter: new THREE.Vector3(...data.thumbBaseCenter),
      wristCenter: new THREE.Vector3(...data.wristCenter),
    }
    const reference = lod > 0 ? await loadCharacter(faction, 0) : undefined
    const rightFrame = deriveDrawHandFrame(sourceRoot, frame)
    const shaftOffsets = new Map([frame, rightFrame].map((f, i) => {
      const sourceHand = sourceRoot.getObjectByName(i === 0 ? 'hand_l' : 'hand_r')!
      return [sourceHand.parent!.name, f.wristCenter!.clone().applyQuaternion(sourceHand.quaternion)] as const
    }))
    if (reference) prepareBowGripShape(reference.scene, frame)
    prepareBowGripShape(gltf.scene, frame, reference?.scene)
    const clips = normalizeBowHandClips(gltf.scene, gltf.animations, frame)
    const withoutFingerShapes = normalizeBowHandClips(sourceRoot, gltf.animations, frame)
    for (const clip of clips.filter(c => c.name.startsWith('bow'))) {
      const unshaped = withoutFingerShapes.find(c => c.name === clip.name)!
      for (const track of clip.tracks.filter(t => /^(upper_arm|lower_arm|hand_)/.test(t.name))) {
        expect(Array.from(track.values), `${clip.name} ${track.name}: finger shaping must not change arm pose`)
          .toEqual(Array.from(unshaped.tracks.find(t => t.name === track.name)!.values))
      }
    }
    for (const source of gltf.animations as THREE.AnimationClip[]) {
      const normalized = clips.find(c => c.name === source.name)!
      if (!source.name.startsWith('bow')) expect(normalized).toBe(source)
      else for (const track of source.tracks.filter(t => /^(upper_arm|lower_arm)/.test(t.name))) {
        if (track.name.startsWith('upper_arm')) expect(normalized.tracks).toContain(track)
        expect(normalized.tracks.filter(t => t.name === track.name)).toHaveLength(1)
      }
    }
    const hand = gltf.scene.getObjectByName('hand_l') as THREE.Bone
    const socket = gltf.scene.getObjectByName('socket_hand_l') as THREE.Bone
    const pivotInForearm = frame.wristCenter.clone().applyQuaternion(hand.quaternion).add(hand.position)
    const neutral = hand.quaternion.clone()
    socket.userData.handGripFrame = frame
    const bow = new THREE.Group()
    socket.add(bow)
    applyBowAttachment(socket, bow)
    const attach = bow.matrix.clone()
    const mixer = new THREE.AnimationMixer(gltf.scene)
    for (const clip of clips.filter(c => c.name.startsWith('bow'))) {
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1)
      const sourceAction = sourceMixer.clipAction(gltf.animations.find((c: THREE.AnimationClip) => c.name === clip.name)!).setLoop(THREE.LoopOnce, 1)
      sourceAction.clampWhenFinished = true
      sourceAction.play()
      action.clampWhenFinished = true
      action.play()
      for (const t of [0, 0.05, 0.5, 0.95, 1]) {
        mixer.setTime(t * clip.duration)
        sourceMixer.setTime(t * clip.duration)
        sourceRoot.updateMatrixWorld(true)
        gltf.scene.updateMatrixWorld(true)
        const actual = hand.localToWorld(frame.wristCenter.clone())
        const expected = hand.parent!.localToWorld(pivotInForearm.clone())
        expect(actual.distanceTo(expected)).toBeLessThan(5e-5)
        expect(hand.quaternion.clone().normalize().angleTo(neutral.clone().normalize())).toBeLessThan(1e-4)
        const sourceLower = sourceRoot.getObjectByName('lower_arm_l')!
        expect(actual.distanceTo(sourceLower.localToWorld(pivotInForearm.clone())), `${clip.name} ${t} source wrist`).toBeLessThan(5e-5)
        for (const name of ['upper_arm_l', 'lower_arm_l', 'upper_arm_r', 'lower_arm_r']) {
          const offset = shaftOffsets.get(name) ?? new THREE.Vector3()
          const position = gltf.scene.getObjectByName(name)!.localToWorld(offset.clone())
          expect(position.distanceTo(sourceRoot.getObjectByName(name)!.localToWorld(offset.clone()))).toBeLessThan(5e-5)
        }
        expect(bow.matrix.equals(attach)).toBe(true)
      }
      action.stop()
      sourceAction.stop()
    }
    gltf.scene.updateMatrixWorld(true)
    let closest = Infinity
    let detail: unknown
    const inv = hand.matrixWorld.clone().invert()
    const center = frame.palmContactCenter.clone().addScaledVector(frame.palmNormal, DEFAULT_BOW_GRIP_PROFILE.gripRadius)
    gltf.scene.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.SkinnedMesh) || !['Legs_Hands', 'New_arms'].includes(object.name)) return
      object.morphTargetInfluences![object.morphTargetDictionary!.bowGrip] = 1
      const indices = object.geometry.index!
      const triangle = new THREE.Triangle(), nearest = new THREE.Vector3()
      const toHand = inv.clone().multiply(object.matrixWorld)
      for (let i = 0; i < indices.count; i += 3) {
        for (const [p, offset] of [[triangle.a, 0], [triangle.b, 1], [triangle.c, 2]] as const) object.getVertexPosition(indices.getX(i + offset), p).applyMatrix4(toHand)
        if (triangle.a.distanceTo(center) > 0.22) continue
        for (let axis = -0.07; axis <= 0.07; axis += 0.002) {
          const sample = center.clone().addScaledVector(frame.thumbDirection, axis)
          triangle.closestPointToPoint(sample, nearest)
          const distance = nearest.distanceTo(sample)
          if (distance < closest) {
            closest = distance
            detail = {point:nearest.toArray(),axis:sample.toArray(),triangle:[triangle.a.toArray(),triangle.b.toArray(),triangle.c.toArray()]}
          }
        }
      }
    })
    if (closest < DEFAULT_BOW_GRIP_PROFILE.gripRadius) console.log(faction, lod, detail)
    // A regression gate for the full handle capsule; visual QA remains separate.
    expect(closest).toBeGreaterThanOrEqual(DEFAULT_BOW_GRIP_PROFILE.gripRadius)
    console.log(`${faction}: closest hand surface to grip axis = ${closest.toFixed(6)} m; radius = ${DEFAULT_BOW_GRIP_PROFILE.gripRadius} m (numeric diagnostic, not Visual PASS)`)
  })
})
