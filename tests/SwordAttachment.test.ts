import fs from 'node:fs'
import * as THREE from 'three'
import { describe, it, expect, vi } from 'vitest'
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'
import { applySwordAttachment, weaponGripWorld } from '../src/world/SwordAttachmentContract'
import { CharacterCombatAnimator } from '../src/world/CharacterCombatAnimator'
import { createHumanoidRigAdapter, MixerController } from '../src/world/HumanoidAssetRegistry'
import { createEquipmentSocketProxies } from '../src/world/HumanoidEquipmentSockets'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import { prepareSwordHandShape } from '../src/world/SwordHandShape'
import { preserveBowHandTopology } from '../src/world/BowGripLOD'
import { Player } from '../src/player/Player'
import { InventoryManager } from '../src/rpg/InventoryManager'

const base = 'public/models/characters/v2'
const vector = () => new THREE.Vector3()

describe('正式 GLB 的固定握劍契約', () => {
  it('Roman 雙臂與手腕保留原有動作，不能套用 Viking 手臂重定向', async () => {
    const baseline = JSON.parse(fs.readFileSync('artifacts/animation_sources/sword_baselines/roman-locomotion.json', 'utf8'))
    for (const lod of [0, 1, 2]) {
      const asset = await loadRig(readGlb(`${base}/roman/lod${lod}.glb`))
      for (const original of baseline.clips) {
        const clip = THREE.AnimationClip.parse(original)
        const current = asset.animations.find(c => c.name === clip.name)!
        for (const track of clip.tracks.filter(t => /^(upper_arm|lower_arm|hand)_/.test(t.name))) {
          const expected = track.createInterpolant()
          const actual = current.tracks.find(t => t.name === track.name)!.createInterpolant()
          for (let step = 0; step <= 60; step++) {
            const time = step / 60 * clip.duration
            const q = new THREE.Quaternion().fromArray(expected.evaluate(time)).normalize()
            const r = new THREE.Quaternion().fromArray(actual.evaluate(time)).normalize()
            expect(q.angleTo(r)).toBeLessThan(.00001)
          }
        }
      }
    }
  })
  for (const faction of ['roman', 'viking'] as const) {
    it(`${faction}：rotation-only 攻擊保留腳底高度，不保留需要骨盆平移的懸空蹲姿`, async () => {
      for (const lod of [0, 1, 2]) {
        const g = await loadRig(readGlb(`${base}/${faction}/lod${lod}.glb`))
        g.scene.updateMatrixWorld(true)
        const soles = ['sole_l', 'sole_r'].map(name => g.scene.getObjectByName(name)!)
        const heights = soles.map(sole => sole.getWorldPosition(vector()).y)
        const clip = g.animations.find(c => c.name === 'swordSlash')!
        const mixer = new THREE.AnimationMixer(g.scene), action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true; action.play()
        for (let frame = 0; frame <= 60; frame++) {
          action.paused = false; mixer.setTime(frame / 60 * clip.duration); g.scene.updateMatrixWorld(true)
          soles.forEach((sole, index) => expect(Math.abs(sole.getWorldPosition(vector()).y - heights[index])).toBeLessThan(.001))
        }
      }
    })
    it(`${faction}：建立、換模型、idle、移動與取消動作不改寫 attachment 或手腕`, async () => {
      const manifest = JSON.parse(fs.readFileSync(`${base}/${faction}/manifest.json`, 'utf8'))
      const gltf = await loadRig(readGlb(`${base}/${faction}/lod0.glb`))
      const mixer = new THREE.AnimationMixer(gltf.scene)
      const controller = new MixerController([mixer], [gltf.animations])
      const rig = createHumanoidRigAdapter(gltf.scene, controller)
      controller.onPoseEvaluated = createEquipmentSocketProxies(gltf.scene, rig)
      controller.onPoseEvaluated()
      const pivot = new THREE.Group(), model = new THREE.Group()
      pivot.add(model); rig.right.handSocket.add(pivot)
      WeaponMeshFactory.buildNpcMelee(faction, 2, false, model)
      applySwordAttachment(rig.right.handSocket, pivot, model, manifest.swordGripFrames.lod0)
      const attachment = pivot.matrix.clone()
      const animator = new CharacterCombatAnimator(rig, pivot, new THREE.Group())
      const wristBefore = rig.right.wrist.quaternion.clone()
      animator.poseIdle(); animator.cancel()
      expect(rig.right.wrist.quaternion.angleTo(wristBefore)).toBeLessThan(1e-5)
      for (const speed of [0, 2, 4, 0, 2, 0]) {
        animator.setLocomotion(speed)
        for (let frame = 0; frame < 30; frame++) {
          animator.update(1 / 60); gltf.scene.updateMatrixWorld(true)
          pivot.updateMatrix()
          expect(pivot.matrix.elements).toEqual(attachment.elements)
          const palm = rig.right.wrist.localToWorld(vector().fromArray(manifest.swordGripFrames.lod0.gripCenterLocal))
          expect(weaponGripWorld(model, vector()).distanceTo(palm)).toBeLessThan(.001)
        }
      }
      expect(model.position.length()).toBe(0)
      expect(model.quaternion.angleTo(new THREE.Quaternion())).toBe(0)
      const play = vi.spyOn(controller, 'play')
      for (const [speed, state] of [[0, 'idle'], [2, 'walk'], [4, 'run']] as const) {
        animator.start('swordSlash')
        animator.setLocomotion(speed)
        expect(animator.update(.252).hitActiveStarted).toBe(true)
        const completion = animator.update(.228)
        expect(completion.actionCompleted).toBe(true)
        expect(completion.hitActiveStarted).toBe(false)
        expect(play).toHaveBeenLastCalledWith(state, { fadeSeconds: .12, loop: true, timeScale: 1 })
      }
      pivot.updateMatrix()
      expect(pivot.matrix.elements).toEqual(attachment.elements)
    })

    it(`${faction}：六段移動跨 LOD 的實際掌心保持同步，且 clip 不是固定姿勢`, async () => {
      const manifest = JSON.parse(fs.readFileSync(`${base}/${faction}/manifest.json`, 'utf8'))
      const assets = await Promise.all([0, 1, 2].map(lod => loadRig(readGlb(`${base}/${faction}/lod${lod}.glb`))))
      for (const name of ['idle', 'walk', 'run', 'swordSlash']) {
        const mixers = assets.map(g => new THREE.AnimationMixer(g.scene))
        const actions = assets.map((g, i) => {
          const clip = g.animations.find(c => c.name === name)!
          if (name === 'swordSlash') {
            expect(clip.duration).toBeCloseTo(.48, 6)
            expect(clip.tracks.every(t => t.name.endsWith('.quaternion') && !/^(socket_|sole_)/.test(t.name))).toBe(true)
            for (const bone of ['upper_arm_l', 'upper_arm_r', 'lower_arm_l', 'lower_arm_r', 'hand_l', 'hand_r']) {
              const t = clip.tracks.find(t => t.name === bone + '.quaternion')!
              expect(t.times.length).toBeGreaterThanOrEqual(16)
              const start = new THREE.Quaternion().fromArray(t.values).normalize()
              expect(Math.max(...Array.from({ length: t.times.length }, (_, i) => start.angleTo(new THREE.Quaternion().fromArray(t.values, i * 4).normalize())))).toBeGreaterThan(.01)
            }
          }
          const track = clip.tracks.find(t => t.name === 'upper_arm_r.quaternion')!
          const first = new THREE.Quaternion().fromArray(track.values)
          const angles = Array.from({ length: track.times.length }, (_, j) => first.clone().normalize().angleTo(new THREE.Quaternion().fromArray(track.values, j * 4).normalize()))
          expect(Math.max(...angles)).toBeGreaterThan(.01)
          const action = mixers[i].clipAction(clip).setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true; action.play(); return action
        })
        for (let step = 0; step <= 60; step++) {
          const points = assets.map((g, lod) => {
            actions[lod].paused = false; mixers[lod].setTime(step / 60 * actions[lod].getClip().duration)
            g.scene.updateMatrixWorld(true)
            return g.scene.getObjectByName('hand_r')!.localToWorld(vector().fromArray(manifest.swordGripFrames[`lod${lod}`].gripCenterLocal))
          })
          expect(points[1].distanceTo(points[0])).toBeLessThan(.005)
          expect(points[2].distanceTo(points[0])).toBeLessThan(.005)
        }
        mixers.forEach(m => m.stopAllAction())
      }
    })

    it(`${faction}：靜態手形只新增 morph，不更動骨骼或既有 Bow morph`, async () => {
      const g = await loadRig(readGlb(`${base}/${faction}/lod0.glb`))
      const manifest = JSON.parse(fs.readFileSync(`${base}/${faction}/manifest.json`, 'utf8'))
      const bones: [THREE.Object3D, THREE.Matrix4][] = []
      g.scene.traverse(o => { if (o instanceof THREE.Bone) bones.push([o, o.matrix.clone()]) })
      const mesh = g.scene.getObjectByName(faction === 'roman' ? 'New_arms' : 'Legs_Hands') as THREE.SkinnedMesh
      const placeholder = new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count * 3), 3)
      placeholder.name = 'bowGrip'
      mesh.geometry.morphAttributes.position = [placeholder]; mesh.updateMorphTargets()
      prepareSwordHandShape(g.scene, manifest.swordGripFrames.lod0)
      expect(mesh.geometry.morphAttributes.position[0]).toBe(placeholder)
      expect(mesh.morphTargetDictionary?.swordHand).toBe(1)
      expect(mesh.userData.swordHandDiagnostics.digits).toBe(4)
      for (const [bone, matrix] of bones) { bone.updateMatrix(); expect(bone.matrix.elements).toEqual(matrix.elements) }
      const controller = new MixerController([new THREE.AnimationMixer(g.scene)], [g.animations])
      controller.setSwordHandShape(true)
      for (const state of ['idle', 'walk', 'run', 'swordSlash'] as const) {
        controller.play(state); controller.update(.2)
        expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.swordHand]).toBe(1)
      }
      controller.setSwordHandShape(false)
      controller.play('bowHold'); controller.update(.2)
      expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.swordHand]).toBe(0)
      expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.bowGrip]).toBe(1)
    })
  }

  it('Viking 右手 LOD 拓樸複製保持 mesh bind 位置，不套入左手轉換', async () => {
    const source = await loadRig(readGlb(`${base}/viking/lod0.glb`))
    const target = await loadRig(readGlb(`${base}/viking/lod1.glb`))
    const s = source.scene.getObjectByName('Legs_Hands') as THREE.SkinnedMesh
    const t = target.scene.getObjectByName('Legs_Hands') as THREE.SkinnedMesh
    s.geometry.morphAttributes.position = []
    const bounds = (m: THREE.SkinnedMesh) => {
      const a = m.geometry.attributes, box = new THREE.Box3()
      const hand = m.skeleton.bones.findIndex(b => b.name === 'hand_r')
      for (let i = 0; i < a.position.count; i++) for (let k = 0; k < 4; k++) {
        if (a.skinIndex.getComponent(i, k) === hand && a.skinWeight.getComponent(i, k) > .8) box.expandByPoint(vector().fromBufferAttribute(a.position, i).applyMatrix4(m.bindMatrix))
      }
      return box
    }
    const before = bounds(s)
    preserveBowHandTopology(s, t)
    expect(bounds(t).min.distanceTo(before.min)).toBeLessThan(.00001)
    expect(bounds(t).max.distanceTo(before.max)).toBeLessThan(.00001)
  })

  it('Player 大 dt 同幀命中與完成仍保留單次命中供 Game 消費', () => {
    const player = new Player(new THREE.Scene()), inventory = new InventoryManager()
    inventory.addWeapon('steel_sword'); inventory.equipWeapon('steel_sword')
    const input = { keys: {}, isRightMouseDown: false, isLeftMouseDown: false,
      consumeLeftClick: vi.fn().mockReturnValueOnce(true).mockReturnValue(false), consumeLeftClickRelease: () => false,
    } as unknown as Parameters<Player['update']>[1]
    const args = [input, 0, new THREE.Vector3(0, 1, 10), [],
      { setFill: () => {} }, { setAiming: () => {}, setChargeRatio: () => {} }, { playSwing: () => {} }, inventory,
    ] as unknown as Parameters<Player['update']> extends [number, ...infer Rest] ? Rest : never
    player.update(.5, ...args)
    expect(player.isHitFrame()).toBe(true)
    player.markHitProcessed()
    expect(player.isHitFrame()).toBe(false)
    player.update(1 / 60, ...args)
    expect(player.isHitFrame()).toBe(false)
  })
})
