import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { HumanoidAnimationState } from '../../src/world/CharacterVisuals'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { applyAttachmentContract } from '../../src/world/HumanoidAttachmentContract'
import { HumanoidAssetRegistry, validateHumanoidManifest, type HumanoidAssetManifest } from '../../src/world/HumanoidAssetRegistry'
import { optimizeSelectedAnimationClips } from '../../src/world/SelectedLodPose'
// @ts-expect-error Offline tooling is JavaScript; its loader explicitly omits image/material payload.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

// Retained source buffers distinguish authored LOD topology from a runtime
// substitution that happens to have the same triangle count.
function meshTopology(root: THREE.Object3D): Record<string, string> {
  const result: Record<string, string> = {}
  root.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return
    const hash = createHash('sha256')
    for (const attribute of [node.geometry.index, node.geometry.attributes.position]) {
      if (!attribute) { hash.update('no-index'); continue }
      const array = attribute.array
      hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    }
    result[node.name] = hash.digest('hex')
  })
  return result
}

// Equipment attachment frames are calibrated from the bind pose. Animating a
// socket again rotates held gear away from the hand; the carried scabbard must
// follow its waist bone without also deforming with the legs/skirt.
function expectFixedAttachments(root: THREE.Object3D, animations: THREE.AnimationClip[], label: string, hasScabbard: boolean): void {
  const animatedSockets = animations.flatMap(clip => clip.tracks.filter(track => {
    const binding = THREE.PropertyBinding.parseTrackName(track.name)
    if (!/^(socket_|sole_)/.test(binding.objectIndex ?? binding.nodeName ?? '')) return false
    const stride = track.getValueSize()
    return track.values.some((value, index) => Math.abs(value - track.values[index % stride]) > 1e-6)
  }).map(track => `${clip.name}:${track.name}`))
  expect(animatedSockets, `${label} equipment and sole frames remain fixed`).toEqual([])

  let scabbardVertices = 0
  const mixedScabbardVertices: string[] = []
  root.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return
    const boneIndex = node.skeleton.bones.findIndex(bone => bone.name === 'scabbard')
    if (boneIndex < 0) return
    expect(node.skeleton.bones[boneIndex].parent?.name, `${label} scabbard follows waist`).toBe('hips')
    const { skinIndex, skinWeight } = node.geometry.attributes
    for (let vertex = 0; vertex < skinWeight.count; vertex++) {
      let scabbardWeight = 0
      let otherWeight = 0
      for (let component = 0; component < 4; component++) {
        const weight = skinWeight.getComponent(vertex, component)
        if (skinIndex.getComponent(vertex, component) === boneIndex) scabbardWeight += weight
        else otherWeight += weight
      }
      if (scabbardWeight <= 1e-6) continue
      scabbardVertices++
      if (Math.abs(scabbardWeight - 1) > 1e-5 || otherWeight > 1e-5) mixedScabbardVertices.push(`${node.name}:${vertex}`)
    }
  })
  expect(mixedScabbardVertices, `${label} scabbard does not share skirt/leg deformation`).toEqual([])
  if (hasScabbard) expect(scabbardVertices, `${label} retains its carried scabbard`).toBeGreaterThan(0)
}

// Owns the two new packages' actual preload/instance contract. No gameplay actors
// or scene/world construction; geometry appearance stays in browser validation.
describe.each(['roman', 'viking'] as const)('%s T5 commander asset package', faction => {
  const assetId = `${faction}-hero-t5` as const
  const descriptor = HERO_ASSETS[assetId].descriptor
  const directory = `${process.env.T5_ASSET_ROOT ?? 'public/models/characters/v2'}/${assetId}`
  const manifest: HumanoidAssetManifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))

  it('uses its independent descriptor and rejects a missing gameplay animation binding', () => {
    expect(manifest.preserveLodHandTopology).toBe(true)
    expect(() => validateHumanoidManifest(faction, manifest, descriptor)).not.toThrow()
    expect(() => validateHumanoidManifest(faction, { ...manifest, status: 'blocked' }, descriptor)).toThrow('blocked')
    const incomplete = { ...manifest, animations: { ...manifest.animations!, embedded: manifest.animations!.embedded.filter(binding => binding.clip !== 'axeAttack2H') } }
    expect(() => validateHumanoidManifest(faction, incomplete, descriptor)).toThrow('binding')
    for (const [clip, event] of [['swordSlash', 'hit'], ['axeAttack1H', 'hit'], ['axeAttack2H', 'hit'], ['pilumThrow', 'projectileRelease'], ['bowRelease', 'projectileRelease']] as const) {
      const binding = manifest.animations!.embedded.find(binding => binding.clip === clip)!
      expect(binding.events?.[event], `${clip}.${event}`).toBeGreaterThan(0)
      expect(binding.events?.[event], `${clip}.${event}`).toBeLessThan(binding.duration)
      expect(binding.events?.actionComplete, `${clip}.actionComplete`).toBe(binding.duration)
    }
  })

  it('preloads all real LODs with fixed attachments and creates independent animation state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const authoredTopologies = new Map<string, Record<string, string>>()
    let source: { root: THREE.Object3D; clips: THREE.AnimationClip[] } | undefined
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function (this: GLTFLoader, url) {
      const gltf = await loadRig(readGlb(url.startsWith(`/models/characters/v2/${assetId}/`) ? `${directory}/${url.split('/').at(-1)}` : `public${url}`), this)
      expectFixedAttachments(gltf.scene, gltf.animations, `${assetId}/${url.split('/').at(-1)}`, faction === 'viking')
      authoredTopologies.set(url.split('/').at(-1)!, meshTopology(gltf.scene))
      if (!source && url.endsWith('/lod0.glb')) source = { root: clone(gltf.scene), clips: gltf.animations.map((clip: THREE.AnimationClip) => clip.clone()) }
      return gltf
    })
    onTestFinished(() => { fetchMock.mockRestore(); loader.mockRestore() })
    await HumanoidAssetRegistry.preloadAsset(descriptor)
    const config = { faction, tier: 2 as const, isPlayer: false }
    const first = HumanoidAssetRegistry.createCharacterInstance(config, assetId)
    onTestFinished(() => first.dispose())
    // A selected source hand uses its measured palm basis, not the old
    // project's hand-local axes. Keep the shaft grasp fixed throughout throw.
    const pilum = new THREE.Group()
    first.rig.right.handSocket.add(pilum)
    expect(first.rig.rangedGripFrame).toBeDefined()
    applyAttachmentContract(first.rig.right.handSocket, 'r', pilum, 'ranged', .55, first.rig.rangedGripFrame)
    for (const phase of [0, .2, .37, .8]) {
      first.rig.animation!.play('pilumThrow', { fadeSeconds: 0, loop: false })
      first.rig.animation!.seek('pilumThrow', phase); first.rig.animation!.update(0)
      first.root.updateMatrixWorld(true)
      const grasp = pilum.localToWorld(new THREE.Vector3(0, .55, 0))
      const palm = first.rig.right.wrist.localToWorld(new THREE.Vector3(...first.rig.rangedGripFrame!.gripCenterLocal))
      expect(grasp.distanceTo(palm)).toBeLessThan(1e-6)
    }
    pilum.removeFromParent()
    const second = HumanoidAssetRegistry.createCharacterInstance(config, assetId)
    onTestFinished(() => second.dispose())
    expect(first.root.scale.toArray()).toEqual([1, 1, 1])
    expect(first.skeleton).not.toBe(second.skeleton)
    // Identical selected LOD rigs consume one actor-owned pose; another actor
    // must still own its own mixer and bones.
    expect(first.mixers).toHaveLength(1)
    expect(first.mixers[0]).not.toBe(second.mixers[0])
    const lod = first.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
    expect(lod.levels).toHaveLength(3)
    for (const [index, level] of lod.levels.entries()) {
      const camera = new THREE.PerspectiveCamera()
      camera.position.z = [0, 35, 100][index]
      camera.updateMatrixWorld(true)
      expect(() => lod.update(camera), `LOD${index} renderer selection uses the shared pose`).not.toThrow()
      expect(meshTopology(level.object), `LOD${index} authored indices and base positions`).toEqual(
        authoredTopologies.get(manifest.files![`lod${index}` as 'lod0' | 'lod1' | 'lod2']))
      level.object.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) expect(node.skeleton, `LOD${index} follows the actor pose`).toBe(first.skeleton)
      })
    }
    for (const socket of ['socket_hand_l', 'socket_hand_r', 'socket_back', 'socket_head', 'socket_pelvis', 'socket_foot_l', 'socket_foot_r', 'sole_l', 'sole_r']) {
      expect(lod.levels[0].object.getObjectByName(socket), socket).toBeDefined()
    }
    // The source adapter may alias names and apply a uniform body scale, but
    // must not silently retarget clips, lose finger/helper tracks or alter binds.
    expect(source!.clips.map(clip => clip.name).sort()).toEqual([
      'idle', 'walk', 'run', 'swordSlash', 'bowLoad', 'bowHold', 'bowRelease',
      'pilumThrow', 'axeMountedIdle', 'axeAttack1H', 'axeAttack2H',
    ].sort())
    source!.root.scale.setScalar(manifest.selectedSource!.uniformScale)
    const sourceMixer = new THREE.AnimationMixer(source!.root)
    onTestFinished(() => { sourceMixer.stopAllAction(); sourceMixer.uncacheRoot(source!.root) })
    const optimizedRoot = clone(source!.root)
    const optimizedClips = optimizeSelectedAnimationClips(optimizedRoot, source!.clips)
    const optimizedMixer = new THREE.AnimationMixer(optimizedRoot)
    onTestFinished(() => { optimizedMixer.stopAllAction(); optimizedMixer.uncacheRoot(optimizedRoot) })
    const bones: Array<{ actual: THREE.Bone; expected: THREE.Object3D }> = []
    lod.levels[0].object.traverse(node => {
      if (!(node instanceof THREE.Bone)) return
      const expected = source!.root.getObjectByName(node.userData.sourceBoneName ?? node.name)
      expect(expected, node.name).toBeDefined()
      bones.push({ actual: node, expected: expected! })
    })
    expect(bones).toHaveLength(faction === 'roman' ? 66 : 37)
    first.rig.animation!.setPoseLayersEnabled!(false)
    for (const clip of source!.clips) {
      const state = clip.name as HumanoidAnimationState
      expect(first.rig.animation!.has(state), state).toBe(true)
      sourceMixer.stopAllAction()
      const action = sourceMixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play()
      optimizedMixer.stopAllAction()
      const optimizedAction = optimizedMixer.clipAction(optimizedClips.find(candidate => candidate.name === clip.name)!).reset().setLoop(THREE.LoopOnce, 1).play()
      first.rig.animation!.stop()
      first.rig.animation!.play(state, { fadeSeconds: 0, loop: false })
      for (const phase of [0, .37, .79]) {
        action.time = phase * clip.duration
        sourceMixer.update(0)
        source!.root.updateMatrixWorld(true)
        optimizedAction.time = phase * clip.duration
        optimizedMixer.update(0); optimizedRoot.updateMatrixWorld(true)
        first.rig.animation!.seek(state, phase)
        first.rig.animation!.update(0)
        first.root.updateMatrixWorld(true)
        const error = Math.max(...bones.flatMap(({ actual, expected }) => actual.matrixWorld.elements.map((value, index) => Math.abs(value - expected.matrixWorld.elements[index]))))
        expect(error, `${state} at ${phase}: every source joint survives runtime adaptation`).toBeLessThan(1e-6)
        const optimizedError = Math.max(...bones.flatMap(({ expected }) => {
          const compiled = optimizedRoot.getObjectByName(expected.name)!
          return compiled.matrixWorld.elements.map((value, index) => Math.abs(value - expected.matrixWorld.elements[index]))
        }))
        expect(optimizedError, `${state} at ${phase}: invariant-track optimization preserves the source pose`).toBeLessThan(1e-6)
      }
    }
    const before = second.rig.right.shoulder.quaternion.clone()
    first.rig.animation!.play('axeAttack2H', { fadeSeconds: 0, loop: false })
    first.rig.animation!.update(.001)
    first.rig.animation!.seek('axeAttack2H', .5)
    first.rig.animation!.update(0)
    expect(second.rig.right.shoulder.quaternion.equals(before)).toBe(true)
    const ancestorBones = new Set<string>()
    first.root.traverse(node => { if (node instanceof THREE.Bone) ancestorBones.add(node.uuid) })
    second.root.traverse(node => { if (node instanceof THREE.Bone) expect(ancestorBones.has(node.uuid)).toBe(false) })

    // Selected 2H arcs use the same upper-body pose on each seated mount;
    // the legacy Corgi carry/side-sweep layer used to rotate both hands away.
    first.rig.animation!.setPoseLayersEnabled!(true)
    first.rig.animation!.play('axeAttack2H', { fadeSeconds: 0, loop: false })
    first.rig.animation!.update(.001)
    sourceMixer.stopAllAction()
    const sourceAxeClip = source!.clips.find(clip => clip.name === 'axeAttack2H')!
    const sourceAxe = sourceMixer.clipAction(sourceAxeClip).reset().setLoop(THREE.LoopOnce, 1).play()
    const sourceRightHand = bones.find(({ actual }) => actual === first.rig.right.wrist)!.expected
    for (const phase of [.2, .325, .6, .85]) {
      sourceAxe.time = phase * sourceAxeClip.duration
      sourceMixer.update(0); source!.root.updateMatrixWorld(true)
      const footDirection = sourceRightHand.getWorldQuaternion(new THREE.Quaternion()).normalize()
      const hands = (['HORSE', 'BLACK_CAT', 'CORGI', 'xongkoro'] as const).map(mountKind => {
        first.rig.animation!.setEquipmentState!({ mounted: true, mountKind, action: 'axeAttack2H', elapsed: phase * .48, shield: false, lance: false, alive: true })
        first.rig.animation!.seek('axeAttack2H', phase)
        first.rig.animation!.update(0)
        first.root.updateMatrixWorld(true)
        return [first.rig.right.wrist, first.rig.left.wrist].map(wrist => wrist.getWorldQuaternion(new THREE.Quaternion()).normalize())
      })
      for (const mount of hands.slice(1)) for (let side = 0; side < 2; side++) {
        expect(mount[side].angleTo(hands[0][side]), `2H ${phase}, hand ${side}: mount-independent arc`).toBeLessThan(1e-6)
      }
      // Masking the pelvis must not discard its contribution to the weapon's
      // diagonal direction. A generic mounted shoulder lift also breaks this.
      for (const mount of hands) expect(mount[0].angleTo(footDirection), `2H ${phase}: authored foot strike direction`).toBeLessThan(1e-6)
    }
    // The Corgi guard must follow the turning torso, not remain frozen in
    // root space while the sword attacks. Its palm/chest basis stays fixed.
    first.rig.animation!.stop()
    first.rig.animation!.play('swordSlash', { fadeSeconds: 0, loop: false })
    first.rig.animation!.update(.001)
    sourceMixer.stopAllAction()
    const swordClip = source!.clips.find(clip => clip.name === 'swordSlash')!
    const sourceSword = sourceMixer.clipAction(swordClip).reset().setLoop(THREE.LoopOnce, 1).play()
    const spineBones = bones.filter(({ actual }) => ['spine', 'chest', 'upper_chest'].includes(actual.name))
    const shieldHands: THREE.Quaternion[] = [], relativeHands: THREE.Quaternion[] = []
    for (const phase of [0, .25, .5, .75, 1]) {
      first.rig.animation!.setEquipmentState!({ mounted: true, mountKind: 'CORGI', action: 'swordSlash', elapsed: phase * .48, shield: true, lance: false, alive: true })
      first.rig.animation!.seek('swordSlash', phase); first.rig.animation!.update(0)
      first.root.updateMatrixWorld(true)
      sourceSword.time = phase * swordClip.duration
      sourceMixer.update(0)
      // The requested mounted turn is capped at 45 degrees across the torso,
      // rather than moving the source pelvis's 118-degree turn to the waist.
      let addedTurn = 0
      for (const { actual, expected } of spineBones) {
        const change = actual.quaternion.clone().normalize().angleTo(expected.quaternion.clone().normalize())
        expect(change, `mounted sword at ${phase}: ${actual.name} shares the turn`).toBeLessThanOrEqual(Math.PI / 4 / spineBones.length + 1e-6)
        addedTurn += change
      }
      if (phase === .5) expect(addedTurn).toBeCloseTo(Math.PI / 4, 5)
      if (phase === 1) expect(addedTurn).toBeLessThan(1e-6)
      const hand = first.rig.left.wrist.getWorldQuaternion(new THREE.Quaternion()).normalize()
      const chest = first.rig.upperChest!.getWorldQuaternion(new THREE.Quaternion()).normalize()
      shieldHands.push(hand); relativeHands.push(chest.invert().multiply(hand).normalize())
    }
    expect(Math.max(...shieldHands.map(q => q.angleTo(shieldHands[0])))).toBeGreaterThan(.2)
    for (const q of relativeHands) expect(q.angleTo(relativeHands[0])).toBeLessThan(1e-6)
  })
})
