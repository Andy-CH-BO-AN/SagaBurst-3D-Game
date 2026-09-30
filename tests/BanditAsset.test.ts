import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createHumanoidRigAdapter, MixerController, validateHumanoidManifest } from '../src/world/HumanoidAssetRegistry'
import { BANDIT_ASSET } from '../src/world/BanditAsset'
import { CharacterCombatAnimator } from '../src/world/CharacterCombatAnimator'
// @ts-expect-error shared offline loader removes images only, retaining actual skin/clip buffers.
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'

const directory = 'public/models/characters/v2/bandit'
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))
const names = ['idle', 'walk', 'run', 'swordSlash', 'hit', 'death'] as const
async function instance(lod = 0) {
  const gltf = await loadRig(readGlb(`${directory}/lod${lod}.glb`))
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const animation = new MixerController([mixer], [gltf.animations])
  return { ...gltf, mixer, animation, rig: createHumanoidRigAdapter(gltf.scene, animation) }
}
function bounds(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3()
  scene.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    object.skeleton.update(); object.computeBoundingBox()
    box.union(object.boundingBox!.clone().applyMatrix4(object.matrixWorld))
  })
  return box
}

describe('Fantasy Bandit production asset', () => {
  it('validates the scoped animation contract without requiring bows or hero equipment', () => {
    expect(() => validateHumanoidManifest('viking', manifest, BANDIT_ASSET)).not.toThrow()
    const incomplete = structuredClone(manifest)
    incomplete.animations.embedded = incomplete.animations.embedded.filter((a: { clip: string }) => a.clip !== 'death')
    expect(() => validateHumanoidManifest('viking', incomplete, BANDIT_ASSET)).toThrow()
  })

  it.each([0, 1, 2])('LOD%d retains the real skeleton, 1.75 m height, PBR roles and rigid hammer throughout all clips', async lod => {
    const asset = readGlb(`${directory}/lod${lod}.glb`)
    for (const material of asset.document.materials) {
      expect(material.pbrMetallicRoughness.baseColorTexture).toBeDefined()
      expect(material.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined()
      expect(material.normalTexture).toBeDefined()
      expect(material.occlusionTexture).toBeDefined()
    }
    const { scene, animation } = await instance(lod)
    animation.play('idle', { fadeSeconds: 0 }); animation.update(.001)
    const standing = bounds(scene)
    expect(standing.max.y - standing.min.y).toBeCloseTo(1.75, 2)
    expect(Math.abs(standing.min.y)).toBeLessThan(.002)
    const hammer = scene.getObjectByName('Bandit_Hammer')!
    expect(hammer.parent?.name).toBe('hand_r')
    const bind = hammer.matrix.clone()
    for (const name of names) {
      animation.stop(); animation.play(name, { fadeSeconds: 0, loop: false }); animation.update(.001)
      for (const phase of [0, .25, .5, .75, 1]) {
        animation.seek(name, phase); animation.update(0)
        const box = bounds(scene)
        expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true)
        expect(box.min.y).toBeGreaterThan(-.009)
        expect(hammer.matrix.equals(bind)).toBe(true)
      }
    }
  })

  it('keeps skeletons and mixers independent while sharing immutable render data', async () => {
    const { scene, animations } = await instance()
    const a = clone(scene), b = clone(scene)
    const ma = a.getObjectByName('Body_Low') as THREE.SkinnedMesh
    const mb = b.getObjectByName('Body_Low') as THREE.SkinnedMesh
    expect(ma.geometry).toBe(mb.geometry); expect(ma.material).toBe(mb.material)
    expect(ma.skeleton).not.toBe(mb.skeleton)
    const before = b.getObjectByName('hand_r')!.quaternion.clone()
    const mixer = new THREE.AnimationMixer(a)
    mixer.clipAction(animations.find((c: THREE.AnimationClip) => c.name === 'swordSlash')).play(); mixer.update(.22)
    expect(b.getObjectByName('hand_r')!.quaternion.equals(before)).toBe(true)
  })

  it.each([1 / 120, .26])('uses the existing single hit clock, downward forward contact and locomotion recovery (dt=%s)', async dt => {
    const { scene, animation, rig } = await instance()
    const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    animator.setLocomotion(2)
    expect(animator.start('swordSlash')).toBe(true)
    let hits = 0
    for (let time = 0; time < .8; time += dt) if (animator.update(dt, 80).hitActiveStarted) hits++
    expect(hits).toBe(1); expect(animator.busy).toBe(false)
    animation.stop(); animation.play('swordSlash', { fadeSeconds: 0, loop: false }); animation.update(.001)
    const tip = scene.getObjectByName('hammer_tip')!
    animation.seek('swordSlash', .242 / .48); bounds(scene)
    const before = tip.getWorldPosition(new THREE.Vector3())
    animation.seek('swordSlash', .262 / .48); bounds(scene)
    const after = tip.getWorldPosition(new THREE.Vector3())
    expect(after.y).toBeLessThan(before.y); expect(after.z).toBeGreaterThan(.65)
    animator.cancel(); animator.start('swordSlash'); animator.cancel()
    expect(animator.update(.5).hitActiveStarted).toBe(false)
  })

  it('layers hit recoil without cancelling attack timing and stops recoil on death', async () => {
    const { rig, animation } = await instance()
    const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
    animator.start('swordSlash'); animator.update(.12)
    animation.playHitReaction()
    expect(animator.currentAction).toBe('swordSlash')
    expect(animator.update(.14).hitActiveStarted).toBe(true)
    animator.cancel(); animation.play('death', { loop: false }); animation.playHitReaction()
    animation.update(2)
    expect(animator.update(0).hitActiveStarted).toBe(false)
  })
})
