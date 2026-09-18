import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs'
import { createHumanoidRigAdapter, createMountedIdleClip, MixerController } from '../src/world/HumanoidAssetRegistry'
import { CharacterEquipmentPose } from '../src/world/CharacterEquipmentPose'
import { CharacterCombatAnimator, COMBAT_ANIMATION_PROFILES } from '../src/world/CharacterCombatAnimator'
import { applyEquipmentAttachment, calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../src/world/EquipmentAttachmentContract'
import { createEquipmentSocketProxies } from '../src/world/HumanoidEquipmentSockets'
import { applySwordAttachment, setSwordMountedAttachment } from '../src/world/SwordAttachmentContract'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'
import type { HandGripFrame } from '../src/world/BowAttachmentContract'

const fixtures: Record<string, Awaited<ReturnType<typeof createFixture>>> = {}
async function createFixture(faction: string, emptyMounted = false) {
  const base = `public/models/characters/v2/${faction}`
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'))
  const levels = await Promise.all([0, 1, 2].map(i => loadRig(readGlb(`${base}/lod${i}.glb`))))
  const a = manifest.handGripFrames.left
  const left: HandGripFrame = { ...a }
  for (const k of ['palmContactCenter', 'palmNormal', 'thumbDirection', 'fingerDirection', 'wristCenter', 'thumbBaseCenter'] as const) left[k] = new THREE.Vector3(...a[k])
  const root = new THREE.Group()
  levels.forEach(l => root.add(l.scene)); root.updateMatrixWorld(true)
  const frames = levels.map((l, i) => calibrateEquipmentFrames(manifest.swordGripFrames[`lod${i}`], left, levels[0].scene.getObjectByName('hand_l'), l.scene.getObjectByName('hand_l')))
  levels.forEach((l, i) => calibrateLanceIdleAttachment(l.scene, l.animations.find(c => c.name === 'idle')!, frames[i].lanceRight))
  const controller = new MixerController(levels.map(l => new THREE.AnimationMixer(l.scene)), levels.map(l => [...l.animations, emptyMounted ? new THREE.AnimationClip('mounted', 1, []) : createMountedIdleClip(l.animations.find(c => c.name === 'idle')!)]))
  const rigs = levels.map((l, i) => {
    l.scene.userData.equipmentGripFrames = frames[i]
    l.scene.userData.equipmentFaction = faction
    return createHumanoidRigAdapter(l.scene, controller)
  })
  controller.equipmentLayers = rigs.map((r, i) => new CharacterEquipmentPose(levels[i].scene, r, frames[i]))
  controller.onPoseEvaluated = createEquipmentSocketProxies(root, rigs[0])
  controller.onPoseEvaluated()
  const lance = new THREE.Group(), model = new THREE.Group(), shield = new THREE.Group()
  lance.add(model); WeaponMeshFactory.buildMelee('steel_lance', model)
  WeaponMeshFactory.buildShield(faction === 'roman' ? 'scutum_t2' : 'round_shield_t2', shield)
  rigs[0].right.handSocket.add(lance); rigs[0].left.handSocket.add(shield)
  applyEquipmentAttachment(rigs[0].right.handSocket, lance, model, frames[0].lanceRight, 'lance')
  applyEquipmentAttachment(rigs[0].left.handSocket, shield, shield, frames[0].shieldLeft, 'shield')
  const animator = new CharacterCombatAnimator(rigs[0], lance, new THREE.Group())
  const reset = (hasShield: boolean, mounted = false, speed = 0) => {
    controller.stop(); animator.cancel(); animator.setEquipment(true, hasShield)
    animator.setLocomotion(speed, mounted); animator.update(.2)
  }
  const measure = () => {
    root.updateMatrixWorld(true)
    const grip = model.localToWorld(new THREE.Vector3(0, .15, 0))
    const tip = model.localToWorld(new THREE.Vector3(0, 2.6, 0))
    const support = model.localToWorld(new THREE.Vector3(0, .33, 0))
    const shieldGrip = shield.localToWorld(new THREE.Vector3(0, 0, .085))
    return { grip, tip, support, shieldGrip, hands: rigs.map((r, i) => ({
      right: r.right.wrist.localToWorld(new THREE.Vector3(...frames[i].lanceRight.gripCenterLocal)),
      left: r.left.wrist.localToWorld(new THREE.Vector3(...frames[i].lanceLeft.gripCenterLocal)),
      shield: r.left.wrist.localToWorld(new THREE.Vector3(...frames[i].shieldLeft.gripCenterLocal)),
    })) }
  }
  return { root, rigs, levels, controller, animator, lance, shield, reset, measure }
}

beforeAll(async () => { for (const f of ['roman', 'viking']) fixtures[f] = await createFixture(f) })

for (const faction of ['roman', 'viking']) describe(`${faction} Sword Idle + Lance attachment`, () => {
  const bones = (f: Awaited<ReturnType<typeof createFixture>>) => f.levels.map(l => {
    const result: Record<string, number[]> = {}
    l.scene.traverse(o => { if (o instanceof THREE.Bone) result[o.name] = [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()] })
    return result
  })
  it('換成 Lance 不改任何骨骼；Idle／走跑／mounted 與 Sword 使用同一人體基底', async () => {
    const sword = await createFixture(faction), lance = fixtures[faction]
    for (const mounted of [false, true]) for (const shield of [false, true]) for (const speed of [0, 2, 4]) {
      for (const f of [sword, lance]) { f.controller.stop(); f.animator.cancel(); f.animator.setEquipment(f === lance, shield); f.animator.setLocomotion(speed, mounted) }
      for (let i = 0; i < 60; i++) {
        const dt = i % 3 ? 1 / 60 : 0
        sword.animator.update(dt); lance.animator.update(dt)
        expect(bones(lance)).toEqual(bones(sword))
      }
    }
  })
  it('Sword Idle 掌內握點固定，槍朝 +Z，呼吸與 heading 只由原手骨帶動', () => {
    const f = fixtures[faction]
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      f.root.rotation.y = yaw; f.reset(false)
      const matrix = f.lance.matrix.clone()
      for (let i = 0; i < 180; i++) {
        f.animator.update(1 / 60)
        const m = f.measure()
        expect(m.hands[0].right.distanceTo(m.grip)).toBeLessThan(.00001)
        expect(m.tip.clone().sub(m.grip).normalize().dot(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)))).toBeGreaterThan(.95)
        expect(f.lance.matrix.equals(matrix)).toBe(true)
      }
    }
    f.root.rotation.y = 0
  })
  it('seek／update(0)／切換裝備不留下先前 Lance 程序姿勢', () => {
    const f = fixtures[faction]
    f.controller.stop(); f.controller.setEquipmentState({ lance: false, shield: false, mounted: false })
    f.controller.play('idle', { fadeSeconds: 0 }); f.controller.seek('idle', .25)
    const baseline = bones(f)
    for (let i = 0; i < 20; i++) {
      f.controller.setEquipmentState({ lance: i % 2 === 0 }); f.controller.seek('idle', .25); f.controller.update(0)
      expect(bones(f)).toEqual(baseline)
    }
  })
  it('既有攻擊時間軸在大 dt 下仍單次命中／完成', () => {
    const f = fixtures[faction]; f.reset(true)
    expect(f.animator.start('bowRelease')).toBe(false)
    expect(f.animator.start('greatswordSlash')).toBe(false)
    f.animator.start('lanceThrust')
    expect({ ...f.animator.update(1) }).toMatchObject({ hitActiveStarted: true, actionCompleted: true })
    expect(f.animator.update(.1).hitActiveStarted).toBe(false)
  })
  it('遠距降頻與 27/29m 往返保留步戰／騎乘三 LOD 的槍盾握點與單次命中', () => {
    const f = fixtures[faction]
    for (const mounted of [false, true]) for (const crossing of [false, true]) {
      f.reset(true, mounted)
      const attachment = f.lance.matrix.clone()
      f.animator.start(mounted ? 'mountedLance' : 'lanceThrust')
      let hits = 0, completed = 0
      for (let frame = 0; frame < 60; frame++) {
        const distance = crossing ? (frame % 2 ? 27 : 29) : 60
        const events = f.animator.update(1 / 60, distance)
        hits += Number(events.hitActiveStarted); completed += Number(events.actionCompleted)
        const measured = f.measure()
        expect(f.lance.matrix.equals(attachment)).toBe(true)
        for (const hand of measured.hands) {
          expect(hand.right.distanceTo(measured.grip)).toBeLessThan(.01)
          expect(hand.shield.distanceTo(measured.shieldGrip)).toBeLessThan(.01)
        }
      }
      expect(hits).toBe(1); expect(completed).toBe(1)
    }
  })
  it('遠距切換 Sword clip 的跳幀仍保留盾牌與主骨架掛點一致', async () => {
    const f = await createFixture(faction)
    for (const mounted of [false, true]) {
      f.reset(true, mounted)
      f.animator.setEquipment(false, true)
      f.animator.start('swordSlash')
      for (let frame = 0; frame < 35; frame++) {
        f.animator.update(1 / 60, 60)
        const measured = f.measure()
        for (const hand of measured.hands) expect(hand.shield.distanceTo(measured.shieldGrip)).toBeLessThan(.01)
      }
    }
  })
  it('只求值 authority＋visible 時，跨 LOD 的攻擊／盾／槍／騎乘骨架與全更新一致', async () => {
    const a = await createFixture(faction), b = await createFixture(faction)
    for (const mounted of [false, true]) for (const lance of [false, true]) {
      for (const f of [a, b]) {
        f.reset(true, mounted)
        f.animator.setEquipment(lance, true)
      }
      a.controller.setVisibleLOD(2)
      for (let frame = 0; frame < 120; frame++) {
        a.animator.update(1 / 60, 60); b.animator.update(1 / 60, 60)
      }
      for (const f of [a, b]) f.animator.start(lance ? mounted ? 'mountedLance' : 'lanceThrust' : 'swordSlash')
      let hits = 0, completed = 0
      for (let frame = 0; frame < 90; frame++) {
        const distance = frame % 11 < 5 ? 60 : 20
        const events = { ...a.animator.update(1 / 60, distance) }
        expect(events).toEqual({ ...b.animator.update(1 / 60, distance) })
        hits += Number(events.hitActiveStarted); completed += Number(events.actionCompleted)
        const visible = [0, 1, 2, 1][Math.floor(frame / 3) % 4]
        a.controller.setVisibleLOD(visible)
        const actual = bones(a), expected = bones(b)
        for (const lod of new Set([0, visible])) for (const [name, values] of Object.entries(actual[lod])) {
          values.forEach((v, i) => expect(v, `LOD${lod} ${name}`).toBeCloseTo(expected[lod][name][i], 6))
        }
        const measured = a.measure()
        expect(measured.hands[visible].right.distanceTo(measured.grip)).toBeLessThan(.01)
        expect(measured.hands[visible].shield.distanceTo(measured.shieldGrip)).toBeLessThan(.01)
      }
      expect(hits).toBe(1); expect(completed).toBe(1)
    }
  })
  it('前刺延伸至少 18cm、固定握點；有盾／無盾與騎乘均不改腿或軀幹', async () => {
    const f = fixtures[faction], baseline = await createFixture(faction)
    for (const mounted of [false, true]) for (const shield of [false, true]) {
      f.reset(shield, mounted); baseline.reset(shield, mounted)
      const start = f.measure().grip.clone(), matrix = f.lance.matrix.clone()
      const profile = COMBAT_ANIMATION_PROFILES[mounted ? 'mountedLance' : 'lanceThrust']
      const duration = profile.windup + profile.active + profile.recovery, hitTime = profile.windup + profile.active * .9
      f.animator.start(mounted ? 'mountedLance' : 'lanceThrust')
      let elapsed = 0, hits = 0, completed = 0
      for (const target of [duration * .15, hitTime, duration * .8, duration]) {
        const dt = target - elapsed
        const events = f.animator.update(dt); baseline.animator.update(dt)
        hits += Number(events.hitActiveStarted); completed += Number(events.actionCompleted)
        const measured = f.measure(), actual = bones(f), expected = bones(baseline)
        for (let lod = 0; lod < 3; lod++) for (const [name, values] of Object.entries(actual[lod])) {
          if (!['upper_arm_r', 'lower_arm_r', 'hand_r'].includes(name)) expect(values).toEqual(expected[lod][name])
        }
        expect(f.lance.matrix.equals(matrix)).toBe(true)
        for (const hand of measured.hands) expect(hand.right.distanceTo(measured.grip)).toBeLessThan(.01)
        expect(measured.tip.clone().sub(measured.grip).normalize().z).toBeGreaterThan(.96)
        if (target === hitTime) {
          expect(measured.grip.z - start.z).toBeGreaterThan(.40)
          expect(Math.abs(measured.grip.x - start.x)).toBeLessThan(.05)
        }
        elapsed = target
      }
      expect(hits).toBe(1); expect(completed).toBe(1)
      expect(bones(f)).toEqual(bones(baseline))
      const unmountedProfile = COMBAT_ANIMATION_PROFILES['lanceThrust']
      const unmountedHit = unmountedProfile.windup + unmountedProfile.active * .9
      f.animator.start('lanceThrust'); f.animator.update(unmountedHit); baseline.animator.update(unmountedHit)
      f.animator.cancel(); f.animator.update(0)
      expect(bones(f)).toEqual(bones(baseline))
    }
  })
  it('前刺中上下馬保留原攻擊時序，切裝取消不補發命中', () => {
    const f = fixtures[faction]
    for (const mounted of [false, true]) {
      const profile = COMBAT_ANIMATION_PROFILES[mounted ? 'mountedLance' : 'lanceThrust']
      const hitTime = profile.windup + profile.active * .9, duration = profile.windup + profile.active + profile.recovery
      f.reset(true, mounted)
      f.animator.start(mounted ? 'mountedLance' : 'lanceThrust')
      expect(f.animator.update(.1).hitActiveStarted).toBe(false)
      f.animator.setLocomotion(0, !mounted)
      expect(f.animator.update(hitTime - .1 + 1e-8).hitActiveStarted).toBe(true)
      expect(f.animator.update(duration - hitTime).actionCompleted).toBe(true)
      f.reset(true, mounted); f.animator.start(mounted ? 'mountedLance' : 'lanceThrust')
      f.animator.update(.1); f.animator.cancel(); f.animator.setEquipment(false, true)
      expect(f.animator.update(1)).toMatchObject({ hitActiveStarted: false, actionCompleted: false })
    }
  })
  it('騎馬 Sword 使用 Lance 朝向與原握點，下馬恢復原 Sword 掛點', () => {
    const f = fixtures[faction], pivot = new THREE.Group(), model = new THREE.Group()
    model.userData.gripCenterLocal = [0, .1, 0]; pivot.add(model)
    f.rigs[0].right.handSocket.add(pivot)
    const frame = f.levels[0].scene.userData.equipmentGripFrames.lanceRight
    applySwordAttachment(f.rigs[0].right.handSocket, pivot, model, frame, frame.modelRotationLocal)
    const foot = pivot.matrix.clone()
    f.reset(true, true); setSwordMountedAttachment(pivot, true)
    f.root.updateMatrixWorld(true)
    const swordGrip = model.localToWorld(new THREE.Vector3(0, .1, 0))
    const swordDirection = model.localToWorld(new THREE.Vector3(0, 1, 0)).sub(swordGrip).normalize()
    const lance = f.measure()
    expect(swordGrip.distanceTo(lance.grip)).toBeLessThan(.00001)
    expect(swordDirection.dot(lance.tip.sub(lance.grip).normalize())).toBeGreaterThan(.99999)
    const mountedMatrix = pivot.matrix.clone()
    setSwordMountedAttachment(pivot, true)
    expect(pivot.matrix.equals(mountedMatrix)).toBe(true)
    setSwordMountedAttachment(pivot, false)
    pivot.matrix.elements.forEach((n, i) => expect(n).toBeCloseTo(foot.elements[i], 12))
    pivot.removeFromParent()
  })
  it('騎乘沿用 Idle 上身而非 T-pose，pelvis 與騎乘腿姿維持原樣', async () => {
    const f = fixtures[faction], previous = await createFixture(faction, true)
    const upper = () => f.rigs.map(r => [r.right.shoulder, r.right.elbow, r.right.wrist].map(b => b.quaternion.toArray()))
    const lower = (fixture: typeof f) => fixture.rigs.map(r => [r.pelvis!, r.leftLeg.hip, r.leftLeg.knee, r.leftLeg.ankle, r.rightLeg.hip, r.rightLeg.knee, r.rightLeg.ankle].map(b => [...b.position.toArray(), ...b.quaternion.toArray()]))
    f.controller.stop(); f.controller.setEquipmentState({ lance: false, shield: false, mounted: false })
    f.controller.play('idle', { fadeSeconds: 0 }); f.controller.update(.25)
    const idleArms = upper()
    for (const fixture of [f, previous]) {
      fixture.controller.stop(); fixture.controller.setEquipmentState({ lance: true, shield: false, mounted: true })
      fixture.controller.play('mounted', { fadeSeconds: 0 }); fixture.controller.update(.25)
    }
    expect(upper()).toEqual(idleArms)
    expect(lower(f)).toEqual(lower(previous))
    expect(f.rigs[0].right.shoulder.getWorldPosition(new THREE.Vector3()).y - f.measure().grip.y).toBeGreaterThan(.3)
  })
})
