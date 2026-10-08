import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { validateHumanoidManifest, type HumanoidAssetManifest, createHumanoidRigAdapter, MixerController, resolveHumanoidAnimationClips } from '../../src/world/HumanoidAssetRegistry'
import { CharacterCombatAnimator, PILUM_THROW_RELEASE_TIME } from '../../src/world/CharacterCombatAnimator'
import { normalizeBowHandClips, prepareBowGripShape } from '../../src/world/CanonicalBowGripPose'
import { loadTestGlbAsset } from '../helpers/testGlbAsset'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { CharacterEquipmentPose } from '../../src/world/CharacterEquipmentPose'
import { calibrateEquipmentFrames } from '../../src/world/EquipmentAttachmentContract'
// @ts-expect-error diagnostic loader has no declaration; it parses the same embedded GLB via Three's GLTFLoader.
import { loadCharacter } from '../../tools/humanoid-diagnostics/measure-hands.mjs'

const ROOT = new URL('../../public/models/characters/v2/', import.meta.url)
const CLIPS = ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'swordSlash', 'pilumThrow']
interface AnimationManifest {
  animations: { embedded: Array<{
    clip: string
    duration: number
    events?: { projectileRelease?: number; actionComplete?: number }
  }> }
}

function readAnimationManifest(faction: 'viking' | 'roman'): AnimationManifest {
  return JSON.parse(readFileSync(new URL(`${faction}/manifest.json`, ROOT), 'utf8'))
}

it.each(['viking', 'roman'] as const)('%s pilum manifest matches the gameplay release frame and its declared clip completion', faction => {
  const manifest = readAnimationManifest(faction)
  const pilum = manifest.animations.embedded.find(clip => clip.clip === 'pilumThrow')!
  expect(pilum).toBeDefined()
  expect(Number.isFinite(pilum.duration)).toBe(true)
  expect(pilum.duration).toBeGreaterThan(PILUM_THROW_RELEASE_TIME)
  expect(pilum.events?.projectileRelease).toBeCloseTo(PILUM_THROW_RELEASE_TIME, 5)
  expect(pilum.events?.actionComplete).toBe(pilum.duration)
})

interface GlbDocument {
  accessors: Array<{
    bufferView?: number
    byteOffset?: number
    componentType: number
    count: number
    max?: number[]
    normalized?: boolean
    type: string
  }>
  animations: Array<{
    name: string
    samplers: Array<{ input: number, output: number, interpolation?: string }>
    channels: Array<{ sampler: number, target: { node: number, path: string } }>
  }>
  buffers: Array<{ byteLength: number }>
  bufferViews: Array<{ byteOffset?: number, byteStride?: number }>
  meshes: Array<{
    name?: string
    primitives: Array<{ attributes: Record<string, number> }>
  }>
  nodes: Array<{ name?: string, scale?: number[], translation?: number[], rotation?: number[], children?: number[] }>
  skins: Array<{ joints: number[] }>
}

interface GlbAsset {
  document: GlbDocument
  binary: Buffer
}

function readGlbAsset(faction: 'viking' | 'roman', lod: number): GlbAsset {
  const bytes = readFileSync(new URL(`${faction}/lod${lod}.glb`, ROOT))
  expect(bytes.toString('utf8', 0, 4)).toBe('glTF')
  const jsonLength = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as GlbDocument
  const binaryHeader = 20 + jsonLength
  const binaryLength = bytes.readUInt32LE(binaryHeader)
  return {
    document,
    binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  }
}

function readGlb(faction: 'viking' | 'roman', lod: number): GlbDocument {
  return readGlbAsset(faction, lod).document
}

const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readAccessor(asset: GlbAsset, accessorIndex: number): number[][] {
  const accessor = asset.document.accessors[accessorIndex]
  const view = asset.document.bufferViews[accessor.bufferView!]
  const componentBytes = COMPONENT_BYTES[accessor.componentType]
  const componentCount = TYPE_COMPONENTS[accessor.type]
  const stride = view.byteStride ?? componentBytes * componentCount
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const readComponent = (offset: number): number => {
    if (accessor.componentType === 5121) return asset.binary.readUInt8(offset)
    if (accessor.componentType === 5123) return asset.binary.readUInt16LE(offset)
    if (accessor.componentType === 5125) return asset.binary.readUInt32LE(offset)
    if (accessor.componentType === 5126) return asset.binary.readFloatLE(offset)
    throw new Error(`Unsupported accessor component ${accessor.componentType}`)
  }
  return Array.from({ length: accessor.count }, (_, row) =>
    Array.from({ length: componentCount }, (_, column) =>
      readComponent(start + row * stride + column * componentBytes)),
  )
}

function clipDuration(document: GlbDocument, name: string): number {
  const clip = document.animations.find((candidate) => candidate.name === name)
  if (!clip) throw new Error(`Missing ${name}`)
  return Math.max(...clip.samplers.map((sampler) => document.accessors[sampler.input].max?.[0] ?? 0))
}

async function runtimeFixture(faction: 'viking' | 'roman', lod: number, bow = false) {
  const levels = await Promise.all([0, 1, 2].map(index => loadCharacter(faction, index)))
  const gltf = levels[lod]
  const manifest = JSON.parse(readFileSync(new URL(`${faction}/manifest.json`, ROOT), 'utf8'))
  const animationClips = resolveHumanoidAnimationClips(levels.map(level => level.animations))
  const data = manifest.handGripFrames.left
  const frame = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    Array.isArray(value) ? new THREE.Vector3(...value as [number, number, number]) : value,
  ])) as any
  const reference = bow && lod > 0 ? levels[0] : undefined
  if (bow) {
    if (reference) prepareBowGripShape(reference.scene, frame)
    prepareBowGripShape(gltf.scene, frame, reference?.scene)
  }
  const clips = bow ? normalizeBowHandClips(gltf.scene, animationClips[lod]) : animationClips[lod]
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const controller = new MixerController([mixer], [clips], [gltf.animations])
  const rig = createHumanoidRigAdapter(gltf.scene, controller)
  const hand = gltf.scene.getObjectByName('hand_l')!
  const gripFrames = calibrateEquipmentFrames(manifest.swordGripFrames[`lod${lod}`], frame, hand, hand)
  controller.equipmentLayers = [new CharacterEquipmentPose(gltf.scene, rig, gripFrames)]
  const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
  return { root: gltf.scene, rig, controller, animator }
}

describe('humanoid embedded animation asset contract', () => {
  it.each(['viking', 'roman'] as const)('%s LOD0 source bowLoad has no effective draw-arm motion', faction => {
    const asset = readGlbAsset(faction, 0)
    const clip = asset.document.animations.find(animation => animation.name === 'bowLoad')!
    for (const name of ['upper_arm_r', 'lower_arm_r', 'hand_r']) {
      const channel = clip.channels.find(candidate => asset.document.nodes[candidate.target.node]?.name === name && candidate.target.path === 'rotation')!
      const sampler = clip.samplers[channel.sampler]
      const times = readAccessor(asset, sampler.input)
      const values = readAccessor(asset, sampler.output)
      expect(times).toHaveLength(2)
      const start = new THREE.Quaternion().fromArray(values[0])
      const end = new THREE.Quaternion().fromArray(values[1])
      expect(start.angleTo(end)).toBeLessThan(0.01)
    }
  })
  it('keeps LOD0 bowHold/release source poses and only completes the static bowLoad trajectory', async () => {
    const levels = await Promise.all([0, 1, 2].map(index => loadCharacter('roman', index)))
    const resolved = resolveHumanoidAnimationClips(levels.map(level => level.animations))
    const rawLod0 = new Map(levels[0].animations.map(clip => [clip.name, clip]))
    const lod1 = new Map(levels[1].animations.map(clip => [clip.name, clip]))
    const productionLod0 = new Map(resolved[0].map(clip => [clip.name, clip]))

    expect(productionLod0.get('bowLoad')).not.toBe(rawLod0.get('bowLoad'))
    for (const name of ['bowHold', 'bowRelease']) {
      expect(productionLod0.get(name)).toBe(rawLod0.get(name))
    }
    expect(productionLod0.get('pilumThrow')).toBe(lod1.get('pilumThrow'))
  })

  it.each(
    (['viking', 'roman'] as const).flatMap(faction => [0, 1, 2].map(lod => [faction, lod] as const)),
  )('%s LOD%s equipped bowLoad moves at 0%, 50%, and 100% while preserving authored endpoints', async (faction, lod) => {
    const { root, rig, controller, animator } = await runtimeFixture(faction, lod, true)
    const sample = (ratio: number, equipped: boolean) => {
      controller.setPoseLayersEnabled(equipped)
      animator.cancel()
      for (let i = 0; i < 30; i++) {
        animator.poseBow(ratio)
        animator.update(1 / 60)
      }
      root.updateMatrixWorld(true)
      return {
        arm: rig.right.elbow.quaternion.clone(),
        drawHand: rig.right.handSocket.getWorldPosition(new THREE.Vector3()),
        bowHand: rig.left.handSocket.getWorldPosition(new THREE.Vector3()),
      }
    }
    const samples = [0, 0.5, 1].map(ratio => sample(ratio, true))
    const rawSamples = [0, 0.5, 1].map(ratio => sample(ratio, false))
    const firstHalfMotion = samples[1].arm.angleTo(samples[0].arm)
      + samples[1].drawHand.distanceTo(samples[0].drawHand)
    const secondHalfMotion = samples[2].arm.angleTo(samples[1].arm)
      + samples[2].drawHand.distanceTo(samples[1].drawHand)
    expect(firstHalfMotion, `${faction} LOD${lod} bowLoad 0%→50% motion`).toBeGreaterThan(0.03)
    expect(secondHalfMotion, `${faction} LOD${lod} bowLoad 50%→100% motion`).toBeGreaterThan(0.02)
    const bowLoadMotion = samples.slice(1).reduce((sum, pose, index) => sum
      + pose.arm.angleTo(samples[index].arm)
      + pose.drawHand.distanceTo(samples[index].drawHand), 0)
    expect(bowLoadMotion).toBeGreaterThan(0.1)
    const rawBowLoadMotion = rawSamples.slice(1).reduce((sum, pose, index) => sum
      + pose.arm.angleTo(rawSamples[index].arm)
      + pose.drawHand.distanceTo(rawSamples[index].drawHand), 0)
    expect(rawBowLoadMotion).toBeGreaterThan(0.1)
    for (let i = 0; i < samples.length; i++) {
      // Viking LOD1/2 now share the authority trajectory in their own bind basis.
      if ((lod === 0 || faction === 'viking') && i === 1) {
        expect(samples[i].arm.angleTo(rawSamples[i].arm)
          + samples[i].drawHand.distanceTo(rawSamples[i].drawHand)).toBeGreaterThan(0.1)
        continue
      }
      expect(samples[i].arm.angleTo(rawSamples[i].arm)).toBeLessThan(0.001)
      expect(samples[i].drawHand.distanceTo(rawSamples[i].drawHand)).toBeLessThan(0.001)
      expect(samples[i].bowHand.distanceTo(rawSamples[i].bowHand)).toBeLessThan(0.001)
    }
    if (lod === 0 || faction === 'viking') {
      const almostFull = sample(0.99, true)
      const full = sample(1, true)
      expect(almostFull.arm.angleTo(full.arm)).toBeLessThan(0.1)
      expect(almostFull.drawHand.distanceTo(full.drawHand)).toBeLessThan(0.1)
      expect(almostFull.bowHand.distanceTo(full.bowHand)).toBeLessThan(0.1)
    }
    controller.stop()
  })

  it.each(
    (['viking', 'roman'] as const).flatMap(faction => [0, 1, 2].map(lod => [faction, lod] as const)),
  )('%s LOD%s exposes the manifest pilum duration through the runtime mixer', async (faction, lod) => {
    const manifest = readAnimationManifest(faction)
    const pilum = manifest.animations.embedded.find(clip => clip.clip === 'pilumThrow')!
    const { controller } = await runtimeFixture(faction, lod)
    try {
      expect(controller.has('pilumThrow')).toBe(true)
      const duration = controller.getDuration('pilumThrow')
      expect(Number.isFinite(duration)).toBe(true)
      expect(duration).toBeGreaterThan(PILUM_THROW_RELEASE_TIME)
      expect(duration).toBeCloseTo(pilum.duration, 5)
    } finally { controller.stop() }
  })

  it.each(['viking', 'roman'] as const)('%s production pilumThrow raises the grip above the shoulder at release frame 17', async faction => {
    const { root, rig, controller } = await runtimeFixture(faction, 0)
    controller.setPoseLayersEnabled(true)
    controller.setEquipmentState({ shield: false, lance: false, action: 'pilumThrow', elapsed: 0 })
    expect(controller.play('pilumThrow', { fadeSeconds: 0, loop: false })).toBe(true)
    let previousTime = 0
    const sample = (time: number) => {
      controller.setEquipmentState({ elapsed: time })
      controller.update(time - previousTime)
      previousTime = time
      root.updateMatrixWorld(true)
      return {
        shoulder: rig.right.shoulder.getWorldPosition(new THREE.Vector3()),
        hand: rig.right.handSocket.getWorldPosition(new THREE.Vector3()),
      }
    }
    const windup = sample(16 / 30)
    const release = sample(PILUM_THROW_RELEASE_TIME)
    const followThrough = sample(21 / 30)
    expect(release.hand.y - release.shoulder.y).toBeGreaterThan(0.05)
    expect(release.hand.z - windup.hand.z).toBeGreaterThan(0.3)
    expect(followThrough.hand.y).toBeLessThan(followThrough.shoulder.y)
    controller.stop()
  })

  it.each([0, 1, 2])('Roman LOD%s keeps source clips raw and pilumThrow motion in production', async lod => {
    const { root, rig, controller } = await runtimeFixture('roman', lod)
    expect(controller.getDuration('pilumThrow')).toBeCloseTo(1.5, 5)
    const sample = () => {
      root.updateMatrixWorld(true)
      return {
        shoulder: rig.right.shoulder.quaternion.clone(),
        elbow: rig.right.elbow.quaternion.clone(),
        wrist: rig.right.wrist.quaternion.clone(),
        hand: rig.right.handSocket.getWorldPosition(new THREE.Vector3()),
      }
    }
    const sampleSequence = (equipmentEnabled: boolean) => {
      controller.setPoseLayersEnabled(equipmentEnabled)
      controller.setEquipmentState({ shield: equipmentEnabled, lance: false, action: 'pilumThrow', elapsed: 0 })
      expect(controller.play('pilumThrow', { fadeSeconds: 0, loop: false })).toBe(true)
      controller.update(0.001)
      const poses = [sample()]
      let previous = 0
      for (const time of [0.25, 0.5, 0.75, 1]) {
        controller.setEquipmentState({ elapsed: time * 1.5 })
        controller.update((time - previous) * 1.5)
        poses.push(sample())
        previous = time
      }
      return poses
    }
    const times = [0, 0.25, 0.5, 0.75, 1]
    const raw = sampleSequence(false)
    const equipped = sampleSequence(true)
    const motion = (poses: typeof raw) => poses.slice(1).reduce((sum, pose, index) => {
      const previous = poses[index]
      return sum
        + pose.shoulder.angleTo(previous.shoulder)
        + pose.elbow.angleTo(previous.elbow)
        + pose.wrist.angleTo(previous.wrist)
        + pose.hand.distanceTo(previous.hand)
    }, 0)

    expect(motion(equipped)).toBeGreaterThan(0.5)
    if (lod === 0) {
      expect(motion(raw)).toBeLessThan(0.001)
      const middleFrameDifference = equipped[2].shoulder.angleTo(raw[2].shoulder)
        + equipped[2].elbow.angleTo(raw[2].elbow)
        + equipped[2].wrist.angleTo(raw[2].wrist)
        + equipped[2].hand.distanceTo(raw[2].hand)
      expect(middleFrameDifference).toBeGreaterThan(0.5)
    } else {
      expect(motion(raw)).toBeGreaterThan(0.5)
      for (let index = 0; index < times.length; index++) {
        expect(equipped[index].shoulder.angleTo(raw[index].shoulder)).toBeLessThan(0.001)
        expect(equipped[index].elbow.angleTo(raw[index].elbow)).toBeLessThan(0.001)
        expect(equipped[index].wrist.angleTo(raw[index].wrist)).toBeLessThan(0.001)
        expect(equipped[index].hand.distanceTo(raw[index].hand)).toBeLessThan(0.001)
      }
    }
    controller.stop()
  })


  it('ships the runtime-required clips with names and durations matching each faction manifest', () => {
    for (const faction of ['viking', 'roman'] as const) {
      const manifest = readAnimationManifest(faction)
      const required = [...CLIPS, 'axeAttack1H', 'axeAttack2H']
      expect(manifest.animations.embedded.map(binding => binding.clip)).toEqual(expect.arrayContaining(required))
      for (let lod = 0; lod < 3; lod++) {
        const document = readGlb(faction, lod)
        expect(document.animations.map(clip => clip.name).sort()).toEqual(manifest.animations.embedded.map(binding => binding.clip).sort())
        for (const binding of manifest.animations.embedded) {
          expect(Number.isFinite(binding.duration)).toBe(true)
          expect(binding.duration).toBeGreaterThan(0)
          const duration = clipDuration(document, binding.clip)
          expect(Number.isFinite(duration)).toBe(true)
          expect(duration).toBeGreaterThan(0)
          expect(duration).toBeCloseTo(binding.duration, 4)
        }
      }
    }
  })


  it('matches every runtime GLB to the SHA-256 recorded in its manifest', () => {
    for (const faction of ['viking', 'roman'] as const) {
      const manifest = JSON.parse(readFileSync(new URL(`${faction}/manifest.json`, ROOT), 'utf8')) as {
        fileSha256: Record<'lod0' | 'lod1' | 'lod2', string>
      }
      for (let lod = 0; lod < 3; lod++) {
        const key = `lod${lod}` as 'lod0' | 'lod1' | 'lod2'
        const digest = createHash('sha256')
          .update(readFileSync(new URL(`${faction}/lod${lod}.glb`, ROOT)))
          .digest('hex')
        expect(digest).toBe(manifest.fileSha256[key])
      }
    }
  })

})

// Asset owner: the existing Viking AxeAttack suite owns the complete gameplay
// matrix. These independent Roman payloads need real GLB decoding per LOD to
// catch absent/static clips or tracks that cannot bind to their target skeleton.
it.each(['roman', 'roman-hero-t4'] as const)('%s ships two playable axe clips on every runtime LOD', async assetId => {
  const base = `public/models/characters/v2/${assetId}`
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8')) as HumanoidAssetManifest
  const descriptor = assetId === 'roman' ? undefined : HERO_ASSETS[assetId].descriptor
  for (const action of ['axeAttack1H', 'axeAttack2H'] as const) {
    const broken = { ...manifest, animations: { ...manifest.animations!, embedded: manifest.animations!.embedded.filter(c => c.clip !== action) } }
    expect(() => validateHumanoidManifest('roman', broken, descriptor)).toThrow('binding')
    expect(manifest.animations!.embedded.find(c => c.clip === action)).toMatchObject({
      sourceClip: action === 'axeAttack1H' ? 'HumanM@Attack1H01_R' : 'HumanM@Attack2H01',
      events: { hit: action === 'axeAttack1H' ? .48 * 9 / 33 : .17, actionComplete: .48 },
    })
  }
  for (const lod of [0, 1, 2]) {
    const gltf = await loadTestGlbAsset(`${base}/lod${lod}.glb`)
    const controller = new MixerController([new THREE.AnimationMixer(gltf.scene)], [gltf.animations])
    try {
      for (const action of ['axeAttack1H', 'axeAttack2H'] as const) {
        const rig = createHumanoidRigAdapter(gltf.scene, controller)
        expect(controller.play(action, { fadeSeconds: 0, loop: false }), `${assetId} LOD${lod} ${action}`).toBe(true)
        controller.seek(action, .05); controller.update(0)
        const start = rig.right.shoulder.quaternion.clone()
        controller.seek(action, .65); controller.update(0)
        expect(start.angleTo(rig.right.shoulder.quaternion), `${assetId} LOD${lod} ${action} motion`).toBeGreaterThan(.1)
        const clip = gltf.animations.find(c => c.name === action)!
        expect(clip.tracks.length).toBeGreaterThan(6)
        for (const track of clip.tracks) expect([...track.values].every(Number.isFinite)).toBe(true)
      }
    } finally { controller.stop() }
  }
})
