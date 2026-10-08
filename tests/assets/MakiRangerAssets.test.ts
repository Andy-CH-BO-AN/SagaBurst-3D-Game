import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
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
  it('launches along gameplay forward and releases once on foot and all mounts at multiple headings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const actor = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: true }, MAKI_HERO.assetId)
      onTestFinished(() => actor.dispose())
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
      const checkShot = () => {
        actor.root.updateMatrixWorld(true)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root.quaternion)
        const target = new THREE.Vector3(0, 1.25, 20).applyMatrix4(actor.root.matrixWorld)
        bow.update(1, target, true)
        const origin = new THREE.Vector3(), direction = new THREE.Vector3()
        bow.writeLaunch(origin, direction, target)
        expect(direction.dot(forward)).toBeGreaterThan(.999)
        for (const level of lod.levels) {
          const point = (name: string) => level.object.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
          const shot = point('bow_arrow_rest').sub(point('bow_string_contact')).normalize()
          // These authored contacts drive the actual nock/rest launch direction.
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
        checkShot()
        if (speed > 0) {
          animator.setLocomotion(0, false)
          animator.update(.2)
          checkShot()
          animator.setLocomotion(speed, false, speed > 3)
          animator.update(.2)
        }
        expect(animator.start('bowRelease')).toBe(true)
        expect(animator.update(.04).projectileRelease).toBe(true)
        checkShot()
        expect(animator.update(.02).projectileRelease).toBe(false)
        expect(animator.update(.3).actionCompleted).toBe(true)
        expect(animator.currentAction).toBe('idle')
      }
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it('supports reversible ammo-only fallback without adding a UnitTier', () => {
    expect([12, 1, 0, 4].map(resolveMakiEquipmentMode)).toEqual(['ranged', 'ranged', 'ammo-exhausted', 'ranged'])
    expect(MAKI_FALLBACK).toEqual({ weaponId: 'maki-ranger-bow', animation: 'axeAttack2H', shield: false })
    expect(() => resolveMakiEquipmentMode(NaN)).toThrow()
    expect(() => resolveMakiEquipmentMode(-1)).toThrow()
    expect(() => validateHumanoidManifest('viking', manifest)).toThrow('height')
    expect(() => validateHumanoidManifest('viking', manifest, MAKI_HERO)).not.toThrow()
  })

  it('keeps the equipped bow and melee support contact through melee, draw and release', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const actor = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, MAKI_HERO.assetId)
      onTestFinished(() => actor.dispose())
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
      playback.state = 'axeAttack2H'
      for (const fraction of [0, .2, .354, .5, .8, 1]) {
        playback.sampleEquipment(fraction, false, 'idle', true, actor.rig.animation!.getDuration('axeAttack2H'))
        expect(playback.bow.visible).toBe(true)
        expect(playback.sword.visible).toBe(false)
        expect(playback.bow.parent).toBe(parent)
        expect(playback.bow.matrix.elements).toEqual(attachment.elements)
        if (fraction >= .354 && fraction <= .7) {
          // tools/retarget-maki-archer.mjs bakes the axeAttack2H support hand onto
          // this exported grip. Check that build-output postcondition; gameplay uses the baked clip.
          const frame = actor.rig.swordGripFrame!
          const rightContact = new THREE.Vector3(...frame.gripCenterLocal)
            .addScaledVector(new THREE.Vector3(...frame.palmNormalLocal), metadata.gripRadius - frame.gripRadius)
          actor.rig.right.wrist.localToWorld(rightContact)
          const support = playback.bow.localToWorld(new THREE.Vector3(...manifest.equipment.meleeSupportGripLocal))
          expect(rightContact.distanceTo(support)).toBeLessThan(.012)
        }
      }
      playback.state = 'bowLoad'
      playback.sampleBowComparison(.5, 'gameplay')
      expect(playback.bow.visible).toBe(true)
      expect(playback.sword.visible).toBe(false)
      playback.state = 'bowRelease'
      playback.sampleBowComparison(.5, 'gameplay')
      expect(playback.bow.visible).toBe(true)
      expect(playback.sword.visible).toBe(false)
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })

  it('loads all three GLBs with independent instances, required sockets and animation bindings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
    try {
      await HumanoidAssetRegistry.preloadAsset(MAKI_HERO)
      const config = { faction: 'viking' as const, tier: 2 as const, isPlayer: false }
      const a = HumanoidAssetRegistry.createCharacterInstance(config, MAKI_HERO.assetId)
      onTestFinished(() => a.dispose())
      const b = HumanoidAssetRegistry.createCharacterInstance(config, MAKI_HERO.assetId)
      onTestFinished(() => b.dispose())
      expect(a.root.scale.toArray()).toEqual([1, 1, 1])
      expect(a.skeleton).not.toBe(b.skeleton)
      const lod = a.root.children.find(o => o instanceof THREE.LOD) as THREE.LOD
      const frozen = b.rig.right.wrist.quaternion.clone()
      a.rig.right.wrist.rotateX(.25)
      expect(b.rig.right.wrist.quaternion.equals(frozen)).toBe(true)
      for (const level of lod.levels) {
        for (const name of ['hand_l', 'hand_r', 'socket_back', 'bow_string_contact', 'bow_arrow_rest', 'sole_l', 'sole_r']) {
          expect(level.object.getObjectByName(name)).toBeDefined()
        }
      }
      for (const state of ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'axeAttack2H', 'death'] as const) {
        expect(a.rig.animation!.has(state)).toBe(true)
        a.rig.animation!.play(state, { fadeSeconds: 0, loop: false })
        a.rig.animation!.update(.001)
        a.rig.animation!.seek(state, .5)
        a.root.updateMatrixWorld(true)
        expect(b.rig.right.wrist.quaternion.equals(frozen)).toBe(true)
      }
      expect(b.rig.right.wrist.quaternion.equals(frozen)).toBe(true)
    } finally { fetchMock.mockRestore(); loader.mockRestore() }
  })
})
