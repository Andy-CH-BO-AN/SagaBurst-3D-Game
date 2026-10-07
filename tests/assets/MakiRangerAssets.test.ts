import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, validateHumanoidManifest } from '../../src/world/HumanoidAssetRegistry'
import { MAKI_HERO, MAKI_FALLBACK, resolveMakiEquipmentMode } from '../../src/world/MakiRangerEquipment'
import { HumanoidStudioPlayback } from '../../src/debug/HumanoidStudioPlayback'
import { CharacterCombatAnimator } from '../../src/world/CharacterCombatAnimator'
import { CharacterBowVisual } from '../../src/world/CharacterBowVisual'
// @ts-expect-error Repository GLB tools are JavaScript.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'
const directory = 'public/models/characters/v2/maki-archer-t4'
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))

describe('Maki hero asset integration', () => {
  it('keeps both torso side panels on the body when the arms are raised', async () => {
    for (let lod = 0; lod < 3; lod++) {
      const asset = await loadRig(readGlb(`${directory}/lod${lod}.glb`))
      const jacket = asset.scene.getObjectByName('Jacket_Jecket_0') as THREE.SkinnedMesh
      const positions = jacket.geometry.attributes.position
      const indices = jacket.geometry.attributes.skinIndex
      const weights = jacket.geometry.attributes.skinWeight
      const panel: number[] = []
      // Side body below the source armpit, behind the separate sleeve branch.
      // This region previously received almost 100% upper-arm influence.
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i)
        if (Math.abs(p.x) > .09 && Math.abs(p.x) < .135 && p.y > .94 && p.y < .97 && Math.abs(p.z) < .025) {
          panel.push(i)
          for (let k = 0; k < 4; k++) {
            if (/arm|hand|twist/.test(jacket.skeleton.bones[indices.getComponent(i, k)].name)) {
              expect(weights.getComponent(i, k)).toBeLessThan(.001)
            }
          }
        }
      }
      expect(panel.length).toBeGreaterThan(0)
      const mixer = new THREE.AnimationMixer(asset.scene)
      const relativePanel = (clipName: string) => {
        mixer.stopAllAction()
        mixer.clipAction(asset.animations.find((clip: THREE.AnimationClip) => clip.name === clipName)!).play()
        mixer.setTime(.3)
        asset.scene.updateMatrixWorld(true)
        jacket.skeleton.update()
        const hips = asset.scene.getObjectByName('hips')!
        // Compare in the pelvis frame: the whole standing stance now turns.
        return panel.map(i => hips.worldToLocal(jacket.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(jacket.matrixWorld)))
      }
      const idle = relativePanel('idle')
      const hold = relativePanel('bowHold')
      hold.forEach((p, i) => expect(p.distanceTo(idle[i])).toBeLessThan(.001))
    }
  })

  it('preserves the side-on draw along the shoulder line while aiming gameplay forward', async () => {
    const asset = await loadRig(readGlb(`${directory}/lod0.glb`))
    const point = (name: string) => asset.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
    const head = asset.scene.getObjectByName('head')!
    const restHead = head.getWorldQuaternion(new THREE.Quaternion())
    const mixer = new THREE.AnimationMixer(asset.scene)
    mixer.clipAction(asset.animations.find((c: THREE.AnimationClip) => c.name === 'bowHold')!).play()
    mixer.setTime(.5)
    asset.scene.updateMatrixWorld(true)
    const shot = point('bow_arrow_rest').sub(point('bow_string_contact')).normalize()
    const shoulders = point('upper_arm_l').sub(point('upper_arm_r')).normalize()
    const gaze = new THREE.Vector3(Math.sin(.65), 0, Math.cos(.65))
      .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).multiply(restHead.invert()))
    expect(shot.z).toBeGreaterThan(.99)
    expect(shot.dot(shoulders)).toBeGreaterThan(.97)
    expect(gaze.dot(shot)).toBeGreaterThan(.97)
    expect(point('lower_arm_r').z).toBeLessThan(point('hand_r').z)
    expect(Math.abs(point('lower_arm_r').y - point('upper_arm_r').y)).toBeLessThan(.001)
  })

  it('keeps the side-on pose aligned with release on foot and all mounts at multiple headings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const actor = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: true }, MAKI_HERO.assetId)
      const pivot = new THREE.Group(), grip = new THREE.Group()
      pivot.add(grip); actor.rig.left.handSocket.add(pivot)
      const metadata = JSON.parse(readFileSync('public/models/weapons/maki-ranger-bow/attachment.json', 'utf8'))
      const bowAsset = await loadRig(readGlb('public/models/weapons/maki-ranger-bow/bow.glb'))
      const bow = new CharacterBowVisual(pivot, grip)
      bow.rebuildFromAsset(bowAsset.scene, { ...metadata, visualScale: 1,
        gripCenterLocal: new THREE.Vector3(...metadata.gripCenterLocal), shootingAxis: new THREE.Vector3(0, 0, -1),
        longitudinalAxis: new THREE.Vector3(...metadata.longitudinalAxis), contactNormal: new THREE.Vector3(...metadata.contactNormal),
      }, new THREE.Vector3(...metadata.topTip), new THREE.Vector3(...metadata.bottomTip))
      const animator = new CharacterCombatAnimator(actor.rig, new THREE.Group(), pivot)
      const lod = actor.root.children.find(o => o instanceof THREE.LOD) as THREE.LOD
      const hips = actor.root.getObjectByName('hips')!
      const hipsRest = hips.getWorldQuaternion(new THREE.Quaternion()).invert()
      const feet = [actor.rig.leftLeg.ankle, actor.rig.rightLeg.ankle].map(bone => ({ bone, rest: bone.getWorldQuaternion(new THREE.Quaternion()) }))
      const checkShot = (locomotionOwnsLegs: boolean) => {
        actor.root.updateMatrixWorld(true)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root.quaternion)
        const pelvisDelta = actor.root.quaternion.clone().invert().multiply(hips.getWorldQuaternion(new THREE.Quaternion())).multiply(hipsRest)
        const pelvisForward = new THREE.Vector3(0, 0, 1).applyQuaternion(pelvisDelta)
        expect(pelvisForward.dot(new THREE.Vector3(locomotionOwnsLegs ? 0 : -1, 0, locomotionOwnsLegs ? 1 : 0))).toBeGreaterThan(.99)
        if (!locomotionOwnsLegs) for (const { bone, rest } of feet) {
          const local = actor.root.quaternion.clone().invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
          expect(local.angleTo(pelvisDelta.clone().multiply(rest))).toBeLessThan(.001)
        }
        const target = new THREE.Vector3(0, 1.25, 20).applyMatrix4(actor.root.matrixWorld)
        bow.update(1, target, true)
        const origin = new THREE.Vector3(), direction = new THREE.Vector3()
        bow.writeLaunch(origin, direction, target)
        expect(direction.dot(forward)).toBeGreaterThan(.999)
        expect(new THREE.Vector3(0, 0, -1).applyQuaternion(pivot.getWorldQuaternion(new THREE.Quaternion())).dot(forward)).toBeGreaterThan(.99)
        for (const level of lod.levels) {
          const point = (name: string) => level.object.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
          const shot = point('bow_arrow_rest').sub(point('bow_string_contact')).normalize()
          const shoulders = point('upper_arm_l').sub(point('upper_arm_r')).normalize()
          // Forward shots must retain the original sideways torso/arm layout.
          // Re-solving both arms in front of the chest would fail this check.
          expect(shot.dot(shoulders)).toBeGreaterThan(.97)
          expect(shot.dot(direction)).toBeGreaterThan(.99)
        }
      }
      for (const heading of [0, .8, -1.7]) for (const [mount, speed] of [[null, 0], [null, 2], [null, 4], ['HORSE', 0], ['BLACK_CAT', 0], ['CORGI', 0]] as const) {
        actor.root.rotation.y = heading
        animator.cancel()
        animator.setEquipment(false, false, mount ?? 'HORSE')
        animator.setLocomotion(speed, mount !== null, speed > 3)
        animator.poseBow(1)
        animator.update(.2)
        checkShot(mount !== null || speed > 0)
        if (speed > 0) {
          animator.setLocomotion(0, false)
          animator.update(.2)
          checkShot(false)
          animator.setLocomotion(speed, false, speed > 3)
          animator.update(.2)
        }
        expect(animator.start('bowRelease')).toBe(true)
        expect(animator.update(.04).projectileRelease).toBe(true)
        checkShot(mount !== null || speed > 0)
        expect(animator.update(.02).projectileRelease).toBe(false)
        animator.update(.3)
      }
      actor.dispose()
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it('preserves the bow forearm thickness while pronating the thumb upward', async () => {
    for (let lod = 0; lod < 3; lod++) {
      const asset = await loadRig(readGlb(`${directory}/lod${lod}.glb`))
      const glove = asset.scene.getObjectByName('Gloves_Gloves_0') as THREE.SkinnedMesh
      const point = (name: string) => asset.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
      const elbow = point('lower_arm_l'), wrist = point('hand_l')
      const axis = wrist.clone().sub(elbow), length = axis.length()
      axis.normalize()
      const section: { index: number, radius: number }[] = []
      const radius = (p: THREE.Vector3, origin: THREE.Vector3, direction: THREE.Vector3) => {
        const offset = p.clone().sub(origin)
        return offset.addScaledVector(direction, -offset.dot(direction)).length()
      }
      for (let i = 0; i < glove.geometry.attributes.position.count; i++) {
        const p = glove.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(glove.matrixWorld)
        const along = p.clone().sub(elbow).dot(axis) / length
        if (p.x > .09 && along > .45 && along < .7) section.push({ index: i, radius: radius(p, elbow, axis) })
      }
      expect(section.length).toBeGreaterThan(0)
      const mixer = new THREE.AnimationMixer(asset.scene)
      for (const [name, fraction] of [['bowLoad', .35], ['bowLoad', .7], ['bowHold', .5]] as const) {
        mixer.stopAllAction()
        const clip = asset.animations.find((c: THREE.AnimationClip) => c.name === name)!
        mixer.clipAction(clip).play(); mixer.setTime(clip.duration * fraction)
        asset.scene.updateMatrixWorld(true); glove.skeleton.update()
        const origin = point('lower_arm_l'), direction = point('hand_l').sub(origin).normalize()
        for (const sample of section) {
          const p = glove.getVertexPosition(sample.index, new THREE.Vector3()).applyMatrix4(glove.matrixWorld)
          const ratio = radius(p, origin, direction) / sample.radius
          expect(ratio).toBeGreaterThan(.9)
          expect(ratio).toBeLessThan(1.1)
        }
      }
    }
  })

  it('supports reversible ammo-only fallback without adding a UnitTier', () => {
    expect([12, 1, 0, 4].map(resolveMakiEquipmentMode)).toEqual(['ranged', 'ranged', 'ammo-exhausted', 'ranged'])
    expect(MAKI_FALLBACK).toEqual({ weaponId: 'maki-ranger-bow', animation: 'axeAttack2H', shield: false })
    expect(() => resolveMakiEquipmentMode(NaN)).toThrow()
    expect(() => resolveMakiEquipmentMode(-1)).toThrow()
    expect(() => validateHumanoidManifest('viking', manifest)).toThrow('height')
    expect(() => validateHumanoidManifest('viking', manifest, MAKI_HERO)).not.toThrow()
  })

  it('keeps the original idle and the same left-hand bow through melee, draw and release', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const actor = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, MAKI_HERO.assetId)
      const asset = await loadRig(readGlb('public/models/weapons/maki-ranger-bow/bow.glb'))
      const metadata = JSON.parse(readFileSync('public/models/weapons/maki-ranger-bow/attachment.json', 'utf8'))
      const playback = new HumanoidStudioPlayback(actor, 'idle', 'viking', 'HORSE', {
        meleeAnimation: MAKI_FALLBACK.animation,
        bow: { model: asset.scene, topTip: new THREE.Vector3(...metadata.topTip), bottomTip: new THREE.Vector3(...metadata.bottomTip),
          profile: { ...metadata, visualScale: 1, gripCenterLocal: new THREE.Vector3(...metadata.gripCenterLocal),
            shootingAxis: new THREE.Vector3(0, 0, -1), longitudinalAxis: new THREE.Vector3(...metadata.longitudinalAxis), contactNormal: new THREE.Vector3(...metadata.contactNormal) } },
      })
      playback.setEquipmentLoadout('bow', false)
      playback.sampleEquipment(.5, false, 'idle', false, 2.7)
      const attachment = playback.bow.matrix.clone(), parent = playback.bow.parent
      const wrists = [actor.rig.left.wrist, actor.rig.right.wrist]
      const neutral = wrists.map(wrist => wrist.quaternion.clone())
      const shoulders = [actor.rig.left.shoulder, actor.rig.right.shoulder]
      const idleShoulders = shoulders.map(bone => bone.quaternion.clone())
      playback.state = 'axeAttack2H'
      for (const fraction of [0, .2, .354, .5, .8, 1]) {
        playback.sampleEquipment(fraction, false, 'idle', true, actor.rig.animation!.getDuration('axeAttack2H'))
        expect(playback.bow.visible).toBe(true)
        expect(playback.sword.visible).toBe(false)
        expect(playback.bow.parent).toBe(parent)
        expect(playback.bow.matrix.elements).toEqual(attachment.elements)
        wrists.forEach((wrist, i) => expect(wrist.quaternion.angleTo(neutral[i])).toBeLessThan(.002))
        if (fraction >= .354 && fraction <= .7) {
          const frame = actor.rig.swordGripFrame!
          const rightContact = new THREE.Vector3(...frame.gripCenterLocal)
            .addScaledVector(new THREE.Vector3(...frame.palmNormalLocal), metadata.gripRadius - frame.gripRadius)
          actor.rig.right.wrist.localToWorld(rightContact)
          const support = playback.bow.localToWorld(new THREE.Vector3(...manifest.equipment.meleeSupportGripLocal))
          expect(rightContact.distanceTo(support)).toBeLessThan(.012)
        }
      }
      shoulders.forEach((bone, i) => expect(bone.quaternion.angleTo(idleShoulders[i])).toBeLessThan(.002))
      playback.state = 'bowLoad'
      playback.sampleBowComparison(.5, 'gameplay')
      expect(shoulders[0].quaternion.angleTo(idleShoulders[0])).toBeGreaterThan(.3)
      playback.state = 'bowRelease'
      playback.sampleBowComparison(.5, 'gameplay')
      expect(shoulders[0].quaternion.angleTo(idleShoulders[0])).toBeGreaterThan(.3)
      expect(playback.bow.visible).toBe(true)
      expect(playback.sword.visible).toBe(false)
      actor.dispose()
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it('loads the final three GLBs with independent instances, common sockets and identical LOD poses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const config = { faction: 'viking' as const, tier: 2 as const, isPlayer: false }
      const a = HumanoidAssetRegistry.createCharacterInstance(config, MAKI_HERO.assetId)
      const b = HumanoidAssetRegistry.createCharacterInstance(config, MAKI_HERO.assetId)
      expect(a.root.scale.toArray()).toEqual([1, 1, 1])
      expect(a.skeleton).not.toBe(b.skeleton)
      expect(a.root.getObjectByName('viking-short-horns')).toBeUndefined()
      expect(a.root.getObjectByName('Maki_original_Spirit_Bow')).toBeUndefined()
      const lod = a.root.children.find(o => o instanceof THREE.LOD) as THREE.LOD
      const frozen = b.rig.right.wrist.quaternion.clone()
      for (const state of ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'axeAttack2H', 'death'] as const) {
        a.rig.animation!.play(state, { fadeSeconds: 0, loop: false })
        a.rig.animation!.update(.001)
        a.rig.animation!.seek(state, .5)
        a.root.updateMatrixWorld(true)
        for (const name of ['hand_l', 'hand_r', 'socket_back', 'bow_string_contact', 'bow_arrow_rest', 'sole_l', 'sole_r']) {
          const reference = lod.levels[0].object.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
          for (const level of lod.levels) {
            const point = level.object.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
            expect(point.distanceTo(reference)).toBeLessThan(.00001)
          }
        }
      }
      expect(b.rig.right.wrist.quaternion.equals(frozen)).toBe(true)
      a.dispose(); b.dispose()
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })
})
