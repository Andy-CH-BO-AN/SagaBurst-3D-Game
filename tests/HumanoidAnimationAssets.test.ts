import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createHumanoidRigAdapter, MixerController } from '../src/world/HumanoidAssetRegistry'
import { CharacterCombatAnimator } from '../src/world/CharacterCombatAnimator'
import { normalizeBowHandClips, prepareBowGripShape } from '../src/world/CanonicalBowGripPose'
// @ts-expect-error diagnostic loader has no declaration; it parses the same embedded GLB via Three's GLTFLoader.
import { loadCharacter } from '../tools/humanoid-diagnostics/measure-hands.mjs'

const ROOT = new URL('../public/models/characters/v2/', import.meta.url)
const CLIPS = ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'swordSlash', 'pilumThrow']
const EXPECTED_DURATIONS: Record<string, number> = {
  idle: 2.7,
  walk: 0.8,
  run: 0.6,
  bowLoad: 5 / 6,
  bowHold: 4 / 3,
  bowRelease: 0.22,
  swordSlash: 0.48,
  pilumThrow: 1.5,
}

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
  asset: { extras: { humanoidAnimationBuild: {
    baseBufferByteLength: number
    baseBufferViewCount: number
    baseAccessorCount: number
    fps: number
    clips: string[]
  } } }
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
  const gltf = await loadCharacter(faction, lod)
  const manifest = JSON.parse(readFileSync(new URL(`${faction}/manifest.json`, ROOT), 'utf8'))
  const data = manifest.handGripFrames.left
  const frame = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    Array.isArray(value) ? new THREE.Vector3(...value as [number, number, number]) : value,
  ])) as any
  const reference = bow && lod > 0 ? await loadCharacter(faction, 0) : undefined
  if (bow) {
    if (reference) prepareBowGripShape(reference.scene, frame)
    prepareBowGripShape(gltf.scene, frame, reference?.scene)
  }
  const clips = bow ? normalizeBowHandClips(gltf.scene, gltf.animations) : gltf.animations
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const controller = new MixerController([mixer], [clips], [gltf.animations])
  const rig = createHumanoidRigAdapter(gltf.scene, controller)
  const animator = new CharacterCombatAnimator(rig, new THREE.Group(), new THREE.Group())
  return { root: gltf.scene, rig, controller, animator }
}

describe('humanoid embedded animation asset contract', () => {
  it.each(
    (['viking', 'roman'] as const).flatMap(faction => [0, 1, 2].map(lod => [faction, lod] as const)),
  )('%s LOD%s equipped bowLoad retains the imported arm pose at 0%, 50%, and 100%', async (faction, lod) => {
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
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i].arm.angleTo(rawSamples[i].arm)).toBeLessThan(0.001)
      expect(samples[i].drawHand.distanceTo(rawSamples[i].drawHand)).toBeLessThan(0.001)
      expect(samples[i].bowHand.distanceTo(rawSamples[i].bowHand)).toBeLessThan(0.001)
    }
    controller.stop()
  })

  it.each(
    (['viking', 'roman'] as const).flatMap(faction => [0, 1, 2].map(lod => [faction, lod] as const)),
  )('%s LOD%s imported pilumThrow remains available at canonical duration in the runtime mixer', async (faction, lod) => {
    const { root, rig, controller, animator } = await runtimeFixture(faction, lod)
    expect(controller.has('pilumThrow')).toBe(true)
    expect(controller.getDuration('pilumThrow')).toBeCloseTo(1.5, 5)
    controller.stop()
  })

  it('keeps the Roman lower skirt on the same thigh frame as the covered leg', () => {
    for (let lod = 0; lod < 3; lod++) {
      const asset = readGlbAsset('roman', lod)
      const names = asset.document.skins[0].joints.map((node) => asset.document.nodes[node].name)
      let samples = 0
      for (const mesh of asset.document.meshes.filter((m) => m.name === 'Tunic_1')) {
        for (const primitive of mesh.primitives) {
          const positions = readAccessor(asset, primitive.attributes.POSITION)
          const joints = readAccessor(asset, primitive.attributes.JOINTS_0)
          const weights = readAccessor(asset, primitive.attributes.WEIGHTS_0)
          positions.forEach((p, i) => {
            if (p[1] >= 0.88) return
            expect(names[joints[i][0]]).toBe(p[0] >= 0 ? 'upper_leg_l' : 'upper_leg_r')
            expect(weights[i][0]).toBeCloseTo(1)
            samples++
          })
        }
      }
      expect(samples).toBeGreaterThan(0)
    }
  })
  it('anchors Roman inner shoulder seams and rigid armour to the torso on every LOD', () => {
    for (let lod = 0; lod < 3; lod++) {
      const asset = readGlbAsset('roman', lod)
      const names = asset.document.skins[0].joints.map((node) => asset.document.nodes[node].name)
      let seamSamples = 0
      for (const mesh of asset.document.meshes.filter((m) => m.name === 'New_arms' || m.name === 'Armour_top')) {
        for (const primitive of mesh.primitives) {
          const positions = readAccessor(asset, primitive.attributes.POSITION)
          const joints = readAccessor(asset, primitive.attributes.JOINTS_0)
          positions.forEach((p, index) => {
            if (mesh.name === 'Armour_top' || Math.abs(p[0]) < 0.20) {
              expect(names[joints[index][0]]).toBe('chest')
              seamSamples++
            }
          })
        }
      }
      expect(seamSamples).toBeGreaterThan(0)
    }
  })
  it('ships the same canonical rotation-only clips on all six GLBs', () => {
    const reference = readGlb('viking', 0)
    for (const faction of ['viking', 'roman'] as const) {
      for (let lod = 0; lod < 3; lod++) {
        const document = readGlb(faction, lod)
        expect(document.animations.map((clip) => clip.name).sort()).toEqual([...CLIPS].sort())
        expect(document.asset.extras.humanoidAnimationBuild.fps).toBe(30)
        expect(document.asset.extras.humanoidAnimationBuild.clips).toEqual(CLIPS)
        const joints = new Set(document.skins.flatMap((skin) => skin.joints))
        for (const clip of document.animations) {
          for (const channel of clip.channels) {
            expect(channel.target.path).toBe('rotation')
            expect(joints.has(channel.target.node)).toBe(true)
            expect(document.nodes[channel.target.node].name).toBeTruthy()
          }
          expect(clipDuration(document, clip.name)).toBeCloseTo(EXPECTED_DURATIONS[clip.name], 4)
          expect(clipDuration(document, clip.name)).toBeCloseTo(clipDuration(reference, clip.name), 5)
        }
      }
    }
  })

  it('keeps animated node transforms uniform and the animation payload under 3 MB', () => {
    let animationBytes = 0
    for (const faction of ['viking', 'roman'] as const) {
      for (let lod = 0; lod < 3; lod++) {
        const document = readGlb(faction, lod)
        const build = document.asset.extras.humanoidAnimationBuild
        animationBytes += document.buffers[0].byteLength - build.baseBufferByteLength
        for (const node of document.nodes) {
          if (!node.scale) continue
          expect(node.scale[0]).toBeCloseTo(node.scale[1], 4)
          expect(node.scale[1]).toBeCloseTo(node.scale[2], 4)
        }
      }
    }
    expect(animationBytes).toBeLessThanOrEqual(3 * 1024 * 1024)
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

  it('keeps Roman thigh, shin, and foot vertices on their anatomical bones', () => {
    for (let lod = 0; lod < 3; lod++) {
      const asset = readGlbAsset('roman', lod)
      const mesh = asset.document.meshes.find((candidate) => candidate.name === 'New_legs')
      expect(mesh).toBeTruthy()
      const skin = asset.document.skins[0]
      const jointNames = skin.joints.map((node) => asset.document.nodes[node].name)
      const samples = { thigh: 0, shin: 0, foot: 0 }
      for (const primitive of mesh!.primitives) {
        const positions = readAccessor(asset, primitive.attributes.POSITION)
        const joints = readAccessor(asset, primitive.attributes.JOINTS_0)
        positions.forEach((position, index) => {
          const dominant = jointNames[joints[index][0]]
          if (position[1] > 0.62) {
            expect(dominant).toMatch(/^upper_leg_[lr]$/)
            samples.thigh++
          } else if (position[1] > 0.2 && position[1] < 0.42) {
            expect(dominant).toMatch(/^lower_leg_[lr]$/)
            samples.shin++
          } else if (position[1] < 0.04) {
            expect(dominant).toMatch(/^foot_[lr]$/)
            samples.foot++
          }
        })
      }
      expect(samples.thigh).toBeGreaterThan(0)
      expect(samples.shin).toBeGreaterThan(0)
      expect(samples.foot).toBeGreaterThan(0)
    }
  })
})
