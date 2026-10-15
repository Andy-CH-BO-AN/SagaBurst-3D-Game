import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HumanoidAssetRegistry, validateHumanoidManifest } from '../../src/world/HumanoidAssetRegistry'
import { CharacterCombatAnimator } from '../../src/world/CharacterCombatAnimator'
import { loadTestGlbAsset } from '../helpers/testGlbAsset'
import { REPLACEMENT_DESCRIPTORS, replacementManifest, selectedHumanoidInstance, type ReplacementAssetId } from '../helpers/selectedHumanoidAsset'

const SOURCE_CLIPS = ['idle', 'walk', 'run', 'swordSlash', 'bowLoad', 'bowHold', 'bowRelease', 'pilumThrow', 'axeMountedIdle', 'axeAttack1H', 'axeAttack2H']
const SOCKET_PARENTS = { socket_hand_l: 'hand_l', socket_hand_r: 'hand_r', socket_back: 'chest', socket_head: 'head', socket_pelvis: 'hips', socket_foot_l: 'foot_l', socket_foot_r: 'foot_r', sole_l: 'foot_l', sole_r: 'foot_r' }
// Source mock-pilum hand-local calibration, pinned independently of the manifest.
// Viking MOCK_pilum; Roman Calibrated_Sockets_Final pilum; T4 skinned MOCK_Pilum_Demonstration.
const SOURCE_PILUM = {
  "viking": {
    "center": [
      0.003864126279950142,
      0.09566481411457062,
      -0.07424764335155487
    ],
    "axis": [
      0.8051074106995609,
      0.1513071572379684,
      -0.5735051886471589
    ]
  },
  "roman": {
    "center": [
      0.023709537310290026,
      0.09791561195289147,
      -0.002372929491662017
    ],
    "axis": [
      -0.18693844239188298,
      -0.04967365044848739,
      0.9811149510670083
    ]
  },
  "viking-hero-t4": {
    "center": [
      0.021228070397717014,
      0.1087705783462864,
      -0.02985461739706824
    ],
    "axis": [
      -0.9301585724981332,
      0.35897916498544546,
      0.07706483708272907
    ]
  }
}
const PACKAGES = [
  { assetId: 'viking' as const, joints: 22, sourceRig: 'ordinary22' },
  { assetId: 'roman' as const, joints: 54, sourceRig: 'roman54' },
  { assetId: 'viking-hero-t4' as const, joints: 63, sourceRig: 'varangian63' },
]

// Owns the three replacement packages' real loading and shared-pose contract.
// No actors/worlds are built. Legacy morph/retarget algorithms remain tested
// against roman-civilian; the unchanged T5 suite owns T5's mounted bow matrix.
describe.each(PACKAGES)('$assetId selected military asset', ({ assetId, joints, sourceRig }) => {
  const descriptor = REPLACEMENT_DESCRIPTORS[assetId]
  const directory = `public/models/characters/v2/${assetId}`

  it('declares its honest rig, source identity and complete gameplay metadata', () => {
    const manifest = replacementManifest(assetId)
    expect(() => validateHumanoidManifest(descriptor.faction, manifest, descriptor)).not.toThrow()
    expect(manifest.selectedSource?.rig).toBe(sourceRig)
    expect(manifest.animations!.embedded.map(binding => binding.clip).sort()).toEqual([...SOURCE_CLIPS].sort())
    const provenance = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8')) as { source: { sourceSha256: string }; fileSha256: Record<string, string> }
    expect(provenance.source.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    for (const lod of [0, 1, 2]) expect(createHash('sha256').update(readFileSync(`${directory}/lod${lod}.glb`)).digest('hex')).toBe(provenance.fileSha256[`lod${lod}`])
    for (const clip of ['axeAttack1H', 'axeAttack2H'] as const) {
      const binding = manifest.animations!.embedded.find(candidate => candidate.clip === clip)!
      expect(binding.duration).toBeGreaterThan(2.8)
      expect(binding.meleeCycleSeconds).toBe(.48)
      expect(binding.events?.hit).toBeGreaterThan(binding.events?.activeStart ?? 0)
      expect(binding.events?.hit).toBeLessThan(binding.events?.activeEnd ?? 0)
      expect(binding.events?.actionComplete).toBe(binding.duration)
    }
    expect(() => validateHumanoidManifest(descriptor.faction, { ...manifest, status: 'blocked' }, descriptor)).toThrow('blocked')
    const incomplete = { ...manifest, animations: { ...manifest.animations!, embedded: manifest.animations!.embedded.filter(binding => binding.clip !== 'axeAttack2H') } }
    expect(() => validateHumanoidManifest(descriptor.faction, incomplete, descriptor)).toThrow('binding')
  })

  it('loads all LODs, preserves source motion and isolates actor pose and resource ownership', async () => {
    const sourceLevels = await Promise.all([0, 1, 2].map(lod => loadTestGlbAsset(`${directory}/lod${lod}.glb`)))
    onTestFinished(() => {
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>()
      for (const source of sourceLevels) source.scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return
        geometries.add(node.geometry)
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
        if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton)
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      for (const skeleton of skeletons) skeleton.dispose()
    })
    const manifest = replacementManifest(assetId)
    for (const [lod, source] of sourceLevels.entries()) {
      expect(source.animations.map(clip => clip.name).sort()).toEqual([...SOURCE_CLIPS].sort())
      const skins: THREE.SkinnedMesh[] = []
      source.scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) skins.push(node) })
      expect(skins.length).toBeGreaterThan(0)
      expect(new Set(skins.flatMap(skin => skin.skeleton.bones)).size, `LOD${lod} skin joints`).toBe(joints)
      for (const [socket, parent] of Object.entries(SOCKET_PARENTS)) expect(source.scene.getObjectByName(socket)?.parent?.name, `LOD${lod} ${socket}`).toBe(parent)
      for (const clip of source.animations) {
        expect(clip.duration).toBeCloseTo(manifest.animations!.embedded.find(binding => binding.clip === clip.name)!.duration, 4)
        for (const track of clip.tracks) {
          const binding = THREE.PropertyBinding.parseTrackName(track.name)
          expect(source.scene.getObjectByName(binding.nodeName), `LOD${lod} ${track.name} target`).toBeDefined()
          expect(Array.from(track.values).every(Number.isFinite), `LOD${lod} ${track.name} finite values`).toBe(true)
        }
      }
      for (const skin of skins) {
        expect(skin.skeleton.boneInverses).toHaveLength(skin.skeleton.bones.length)
        expect(skin.skeleton.boneInverses.every(matrix => matrix.elements.every(Number.isFinite))).toBe(true)
        expect(skin.geometry.getAttribute('skinIndex').count).toBe(skin.geometry.getAttribute('position').count)
        expect(skin.geometry.getAttribute('skinWeight').count).toBe(skin.geometry.getAttribute('position').count)
      }
    }
    const first = await selectedHumanoidInstance(assetId, true)
    let firstDisposed = false
    onTestFinished(() => { if (!firstDisposed) first.dispose() })
    const second = await selectedHumanoidInstance(assetId)
    onTestFinished(() => second.dispose())
    expect(first.mixers).toHaveLength(1)
    expect(first.mixers[0]).not.toBe(second.mixers[0])
    expect(first.skeleton).not.toBe(second.skeleton)
    const firstBones = new Set(first.skeleton.bones)
    for (const bone of second.skeleton.bones) expect(firstBones.has(bone)).toBe(false)
    const lod = first.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
    expect(lod.levels.map(level => level.distance)).toEqual([0, 28, 60])
    // These exported surfaces have identical joints/inverse binds; production
    // coalesces their bone textures as well as sharing one actor-owned pose.
    const authorityBones = new Map(first.skeleton.bones.map(bone => [bone.name, bone]))
    for (const level of lod.levels) level.object.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) {
        expect(node.skeleton).toBe(first.skeleton)
        for (const bone of node.skeleton.bones) expect(bone).toBe(authorityBones.get(bone.name))
      }
    })

    // Compare exported poses to the actual adapter with pose layers disabled.
    // This protects source keyframes/finger/helper/dynamic-socket tracks rather
    // than pinning new artwork to obsolete legacy limb coordinates.
    const source = sourceLevels[0]
    source.scene.scale.setScalar(manifest.selectedSource!.uniformScale)
    const sourceMixer = new THREE.AnimationMixer(source.scene)
    onTestFinished(() => { sourceMixer.stopAllAction(); sourceMixer.uncacheRoot(source.scene) })
    first.rig.animation!.setPoseLayersEnabled!(false)
    const peerPose = second.skeleton.bones.map(bone => bone.quaternion.clone())
    for (const clip of source.animations) {
      sourceMixer.stopAllAction()
      const action = sourceMixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play()
      const state = clip.name as Parameters<NonNullable<typeof first.rig.animation>['play']>[0]
      first.rig.animation!.stop(); first.rig.animation!.play(state, { fadeSeconds: 0, loop: false })
      for (const phase of [.17, .61]) {
        action.time = phase * clip.duration; sourceMixer.update(0); source.scene.updateMatrixWorld(true)
        first.rig.animation!.seek(state, phase); first.rig.animation!.update(0); first.root.updateMatrixWorld(true)
        for (const bone of first.skeleton.bones) {
          const expected = source.scene.getObjectByName(bone.name)!
          expect(expected, bone.name).toBeDefined()
          const error = Math.max(...bone.matrixWorld.elements.map((value, index) => Math.abs(value - expected.matrixWorld.elements[index])))
          expect(error, `${clip.name} phase${phase} ${bone.name}`).toBeLessThan(1e-5)
        }
        const before = first.rig.right.handSocket.getWorldPosition(new THREE.Vector3())
        for (const distance of [27, 29, 59, 61]) {
          const camera = new THREE.PerspectiveCamera(); camera.position.z = distance; camera.updateMatrixWorld(true)
          lod.update(camera); first.update(0, distance); first.root.updateMatrixWorld(true)
          expect(first.rig.right.handSocket.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6)
        }
      }
    }
    second.skeleton.bones.forEach((bone, index) => expect(bone.quaternion.equals(peerPose[index])).toBe(true))
    first.rig.animation!.setPoseLayersEnabled!(true)
    const animator = new CharacterCombatAnimator(first.rig, new THREE.Group(), new THREE.Group())
    for (const action of ['daggerSlash', 'greatswordSlash', 'lanceThrust', 'mountedLance'] as const) {
      animator.cancel(); animator.setEquipment(action.includes('Lance') || action === 'lanceThrust', false)
      animator.setLocomotion(0, action === 'mountedLance')
      expect(animator.start(action), action).toBe(true)
      let hits = 0, completions = 0
      for (let frame = 0; frame < 240; frame++) {
        const events = animator.update(1 / 120)
        hits += Number(events.hitActiveStarted); completions += Number(events.actionCompleted)
      }
      expect(hits, action).toBe(1); expect(completions, action).toBe(1)
      expect(animator.currentAction).toBe('idle')
    }
    expect(first.rig.animation!.has('mounted')).toBe(true)
    expect(first.rig.animation!.has('death')).toBe(true)
    expect(first.rig.animation!.play('death', { fadeSeconds: 0, loop: false })).toBe(true)
    first.update(.2)
    const sharedDisposed = vi.fn()
    const removeSharedListeners: Array<() => void> = []
    onTestFinished(() => { for (const remove of removeSharedListeners) remove() })
    second.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.addEventListener('dispose', sharedDisposed); removeSharedListeners.push(() => node.geometry.removeEventListener('dispose', sharedDisposed))
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) { material.addEventListener('dispose', sharedDisposed); removeSharedListeners.push(() => material.removeEventListener('dispose', sharedDisposed)) }
    })
    first.dispose(); firstDisposed = true
    expect(sharedDisposed).not.toHaveBeenCalled()
    expect(second.rig.animation!.play('walk')).toBe(true)
    second.update(.2)
  })

  it('preserves mounted leg ownership, physical shield interception and single ranged release events', async () => {
    const actor = await selectedHumanoidInstance(assetId)
    onTestFinished(() => actor.dispose())
    const { WeaponMeshFactory } = await import('../../src/world/WeaponMeshFactory')
    const { applyAttachmentContract } = await import('../../src/world/HumanoidAttachmentContract')
    const pilum = new THREE.Group()
    WeaponMeshFactory.buildNpcRanged('roman', 2, pilum)
    actor.rig.right.handSocket.add(pilum)
    expect(actor.rig.rangedGripFrame).toBeDefined()
    applyAttachmentContract(actor.rig.right.handSocket, 'r', pilum, 'ranged', .55, actor.rig.rangedGripFrame)
    for (const phase of [.1, .7, 1.2]) {
      actor.rig.animation!.play('pilumThrow', { fadeSeconds: 0, loop: false })
      actor.rig.animation!.seek('pilumThrow', phase); actor.rig.animation!.update(0)
      actor.root.updateMatrixWorld(true)
      const source = SOURCE_PILUM[assetId]
      const center = actor.rig.right.wrist.localToWorld(new THREE.Vector3().fromArray(source.center))
      const axis = new THREE.Vector3().fromArray(source.axis).transformDirection(actor.rig.right.wrist.matrixWorld)
      expect(pilum.localToWorld(new THREE.Vector3(0, .55, 0)).distanceTo(center)).toBeLessThan(1e-5)
      expect(new THREE.Vector3(0, 1, 0).transformDirection(pilum.matrixWorld).angleTo(axis)).toBeLessThan(1e-5)
    }
    pilum.removeFromParent()
    const { applyEquipmentAttachment } = await import('../../src/world/EquipmentAttachmentContract')
    const { ShieldCollider, ShieldState } = await import('../../src/combat/ShieldBlocking')
    const shieldId = descriptor.faction === 'roman' ? 'scutum_t2' : 'round_shield_t2'
    const shield = new THREE.Group(); WeaponMeshFactory.buildShield(shieldId, shield)
    actor.rig.left.handSocket.add(shield)
    applyEquipmentAttachment(actor.rig.left.handSocket, shield, shield, actor.rig.equipmentGripFrames!.shieldLeft, 'shield')
    const animator = new CharacterCombatAnimator(actor.rig, new THREE.Group(), new THREE.Group())
    const state = new ShieldState(); state.equip(shieldId)
    const collider = new ShieldCollider(shield, state); collider.setModel(shieldId)
    animator.setEquipment(false, true); animator.setLocomotion(0, false); animator.update(.2)
    const legs = [actor.rig.leftLeg.hip, actor.rig.leftLeg.knee, actor.rig.rightLeg.hip, actor.rig.rightLeg.knee]
    const lower = legs.map(bone => bone.quaternion.clone())
    animator.setShieldRaised(true); animator.update(0)
    legs.forEach((bone, index) => expect(bone.quaternion.angleTo(lower[index])).toBeLessThan(1e-6))
    if (assetId === 'roman') {
      // Dedicated delivered shield calibration; the bow's thumb axis is opposite.
      // Formal 24mm handle radius is included in this source-derived center.
      const parent = new THREE.Group(); parent.rotation.set(.1, .7, -.15); parent.position.set(3, 2, -4); parent.add(actor.root)
      parent.updateMatrixWorld(true)
      const sourceCenter = actor.rig.left.wrist.localToWorld(new THREE.Vector3(-.030329620764362464, .0923977536855108, -.0020607458193645503))
      const sourceAxis = new THREE.Vector3(.1393293179178642, -.05320453400710903, .9888157658176921).transformDirection(actor.rig.left.wrist.matrixWorld)
      expect(shield.localToWorld(new THREE.Vector3(0, 0, .085)).distanceTo(sourceCenter)).toBeLessThan(1e-5)
      expect(new THREE.Vector3(0, 1, 0).transformDirection(shield.matrixWorld).angleTo(sourceAxis)).toBeLessThan(1e-5)
      actor.root.removeFromParent(); actor.root.updateMatrixWorld(true)
    }
    const center = shield.getWorldPosition(new THREE.Vector3())
    expect(collider.time(new THREE.Vector3(0, center.y, 2), new THREE.Vector3(0, center.y, -2))).toBeLessThan(1)
    expect(collider.time(new THREE.Vector3(0, .1, 2), new THREE.Vector3(0, .1, -2))).toBe(Infinity)
    animator.setShieldRaised(false); animator.setEquipment(false, false)
    for (const mount of ['HORSE', 'BLACK_CAT', 'CORGI', 'xongkoro'] as const) {
      animator.cancel(); animator.setEquipment(false, false, mount); animator.setLocomotion(0, true); animator.update(.2)
      actor.root.updateMatrixWorld(true)
      const ankles = [actor.rig.leftLeg.ankle, actor.rig.rightLeg.ankle]
      const initial = ankles.map(ankle => actor.root.worldToLocal(ankle.getWorldPosition(new THREE.Vector3())))
      expect(animator.start('swordSlash')).toBe(true)
      for (let frame = 0; frame < 60; frame++) {
        animator.update(1 / 120); actor.root.updateMatrixWorld(true)
        ankles.forEach((ankle, index) => {
          const position = actor.root.worldToLocal(ankle.getWorldPosition(new THREE.Vector3()))
          expect(position.x, mount).toBeCloseTo(initial[index].x, 4)
          expect(position.z, mount).toBeCloseTo(initial[index].z, 4)
        })
      }
    }
    for (const action of ['bowRelease', 'pilumThrow'] as const) {
      animator.cancel(); animator.setEquipment(false, false); animator.setLocomotion(0, false)
      expect(animator.start(action)).toBe(true)
      let releases = 0, completions = 0
      for (let frame = 0; frame < 240; frame++) {
        const events = animator.update(1 / 120)
        releases += Number(events.projectileRelease); completions += Number(events.actionCompleted)
      }
      expect(releases, action).toBe(1); expect(completions, action).toBe(1)
      expect(animator.currentAction).toBe('idle')
    }
    animator.cancel(); animator.setLocomotion(0, false); animator.update(.2)
    const chest = actor.root.getObjectByName('spine')!
    const beforeHit = chest.quaternion.clone()
    actor.rig.animation!.playHitReaction!(); actor.update(.08)
    expect(chest.quaternion.angleTo(beforeHit)).toBeGreaterThan(.001)
  })

})

it.each(['head', 'socket_hand_r', 'idle', 'socket_axe_2h_r'])('rejects a selected package missing %s without substituting another model', async missing => {
  const original: ReplacementAssetId = missing === 'socket_axe_2h_r' ? 'roman' : 'viking-hero-t4'
  const assetId = `broken-${missing}`
  const manifest = replacementManifest(original)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...manifest, id: assetId }) } as Response)
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const gltf = await loadTestGlbAsset(`public/models/characters/v2/${original}/lod0.glb`)
    if (missing === 'idle') gltf.animations = gltf.animations.filter(clip => clip.name !== 'idle')
    else gltf.scene.getObjectByName(missing)!.removeFromParent()
    return gltf
  })
  try {
    await expect(HumanoidAssetRegistry.preloadAsset({ ...REPLACEMENT_DESCRIPTORS[original], assetId })).rejects.toThrow()
    expect(() => HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, assetId)).toThrow(assetId)
  } finally { fetchMock.mockRestore(); loader.mockRestore() }
})

it('Roman two-handed axe follows the animated source grip after LOD selection, then restores the fixed sword grip', async () => {
  const actor = await selectedHumanoidInstance('roman')
  onTestFinished(() => actor.dispose())
  const { applySwordAttachment, setSwordMountedAttachment, weaponGripWorld } = await import('../../src/world/SwordAttachmentContract')
  const { WeaponMeshFactory } = await import('../../src/world/WeaponMeshFactory')
  const parent = new THREE.Group(); parent.rotation.set(.1, .7, -.15); parent.position.set(3, 2, -4); parent.add(actor.root)
  const pivot = new THREE.Group(), model = new THREE.Group()
  pivot.add(model); actor.rig.right.handSocket.add(pivot); WeaponMeshFactory.buildMelee('viking_axe_t2', model)
  applySwordAttachment(actor.rig.right.handSocket, pivot, model, actor.rig.swordGripFrame!)
  const fixed = pivot.matrix.clone()
  const socket = actor.root.getObjectByName('socket_axe_2h_r')!
  expect(socket).toBeDefined()
  expect(pivot.userData.authoredAxeSocket).toBe(socket)
  const animator = new CharacterCombatAnimator(actor.rig, pivot, new THREE.Group())
  animator.setEquipment(false, false); animator.setLocomotion(0, false); animator.update(.2)
  expect(animator.start('axeAttack2H')).toBe(true)
  const positions: THREE.Vector3[] = []
  const lod = actor.root.children.find(child => child instanceof THREE.LOD) as THREE.LOD
  for (let frame = 0; frame < 50; frame++) {
    animator.update(1 / 120)
    const camera = new THREE.PerspectiveCamera(); camera.position.z = frame % 2 ? 29 : 61; camera.updateMatrixWorld(true); lod.update(camera)
    parent.updateMatrixWorld(true)
    expect(pivot.userData.authoredAxeActive).toBe(true)
    const origin = model.localToWorld(new THREE.Vector3(0, .35, 0))
    expect(origin.distanceTo(socket.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-5)
    expect(weaponGripWorld(model, new THREE.Vector3()).distanceTo(socket.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-5)
    const shaft = new THREE.Vector3(0, 1, 0).transformDirection(model.matrixWorld)
    const authoredShaft = new THREE.Vector3(0, 0, 1).transformDirection(socket.matrixWorld)
    expect(shaft.angleTo(authoredShaft)).toBeLessThan(1e-5)
    positions.push(origin)
  }
  expect(Math.max(...positions.map(position => position.distanceTo(positions[0])))).toBeGreaterThan(.1)
  animator.cancel(); parent.updateMatrixWorld(true)
  expect(pivot.userData.authoredAxeActive).toBe(false)
  expect(weaponGripWorld(model, new THREE.Vector3()).distanceTo(model.localToWorld(new THREE.Vector3(0, .15, 0)))).toBeLessThan(1e-5)
  pivot.matrix.elements.forEach((value, index) => expect(value).toBeCloseTo(fixed.elements[index], 8))
  // Merely having the same socket on a Roman actor must not redirect swords.
  const sword = new THREE.Group(), swordModel = new THREE.Group(); sword.add(swordModel)
  actor.rig.right.handSocket.add(sword); WeaponMeshFactory.buildMelee('steel_sword', swordModel)
  applySwordAttachment(actor.rig.right.handSocket, sword, swordModel, actor.rig.swordGripFrame!)
  const swordFixed = sword.matrix.clone()
  setSwordMountedAttachment(sword, false, 0, false, 'axeAttack2H')
  expect(sword.matrix.equals(swordFixed)).toBe(true)
})
