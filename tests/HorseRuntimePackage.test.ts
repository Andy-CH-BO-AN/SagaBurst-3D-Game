import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  validateHorseManifest,
  type HorseAssetManifest,
} from '../src/world/HorseAssetRegistry'

const PACKAGE_ROOT = resolve(
  process.env.HORSE_PACKAGE_ROOT ?? 'public/models/mounts/v1/horse',
)
const MANIFEST_FILE = process.env.HORSE_MANIFEST_FILE ?? 'manifest.json'
const KTX2_IDENTIFIER = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
])
const REQUIRED_CLIPS = [
  'idle',
  'walk',
  'trot',
  'canter',
  'gallop',
  'jump',
  'land',
  'hit',
  'death',
].sort()
const REQUIRED_NODES = [
  'horse_lod0',
  'horse_lod1',
  'horse_lod2',
  'socket_saddle_seat',
  'socket_stirrup_l',
  'socket_stirrup_r',
  'socket_camera',
]

interface GlbDocument {
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  bufferViews?: Array<{ extensions?: Record<string, unknown> }>
  textures?: Array<{ extensions?: Record<string, { source?: number }> }>
  images?: Array<{ uri?: string }>
  skins?: Array<{ joints?: number[] }>
  animations?: Array<{
    name?: string
    channels?: Array<{
      target?: {
        node?: number
        path?: 'translation' | 'rotation' | 'scale' | 'weights'
      }
    }>
  }>
  nodes?: Array<{
    name?: string
    mesh?: number
    children?: number[]
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }>
  meshes?: Array<{
    primitives?: Array<{
      indices?: number
      mode?: number
      attributes?: { POSITION?: number }
    }>
  }>
  accessors?: Array<{
    count?: number
    componentType?: number
    normalized?: boolean
    min?: number[]
    max?: number[]
  }>
}

function parseGlb(path: string): GlbDocument {
  const data = readFileSync(path)
  expect(data.subarray(0, 4).toString('ascii')).toBe('glTF')
  expect(data.readUInt32LE(4)).toBe(2)
  expect(data.readUInt32LE(8)).toBe(data.byteLength)
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a)
  const jsonLength = data.readUInt32LE(12)
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as GlbDocument
}

function ktx2Size(relativePath: string): { width: number; height: number } {
  const data = readFileSync(resolve(PACKAGE_ROOT, relativePath))
  expect(data.subarray(0, KTX2_IDENTIFIER.length)).toEqual(KTX2_IDENTIFIER)
  return {
    width: data.readUInt32LE(20),
    height: data.readUInt32LE(24),
  }
}

function runtimePackageBytes(): number {
  const runtimeFiles = [
    MANIFEST_FILE,
    'horse_runtime.glb',
    ...readdirSync(resolve(PACKAGE_ROOT, 'textures')).map((name) => `textures/${name}`),
    ...readdirSync(resolve(PACKAGE_ROOT, 'basis')).map((name) => `basis/${name}`),
  ]
  return runtimeFiles.reduce((total, relativePath) => (
    total + statSync(resolve(PACKAGE_ROOT, relativePath)).size
  ), 0)
}

function normalizedComponent(value: number, componentType: number | undefined): number {
  if (componentType === 5120) return Math.max(value / 127, -1)
  if (componentType === 5121) return value / 255
  if (componentType === 5122) return Math.max(value / 32767, -1)
  if (componentType === 5123) return value / 65535
  return value
}

function accessorBounds(
  document: GlbDocument,
  accessorIndex: number,
): { min: THREE.Vector3; max: THREE.Vector3 } {
  const accessor = document.accessors?.[accessorIndex]
  if (!accessor?.min || !accessor.max) {
    throw new Error(`POSITION accessor ${accessorIndex} has no declared bounds`)
  }
  const decode = (value: number): number => (
    accessor.normalized
      ? normalizedComponent(value, accessor.componentType)
      : value
  )
  return {
    min: new THREE.Vector3(...accessor.min.map(decode)),
    max: new THREE.Vector3(...accessor.max.map(decode)),
  }
}

function nodeWorldMatrix(document: GlbDocument, nodeIndex: number): THREE.Matrix4 {
  const nodes = document.nodes ?? []
  const parents = new Map<number, number>()
  nodes.forEach((node, parentIndex) => {
    node.children?.forEach((childIndex) => parents.set(childIndex, parentIndex))
  })
  const chain: number[] = []
  for (let index: number | undefined = nodeIndex; index !== undefined; index = parents.get(index)) {
    chain.unshift(index)
  }
  return chain.reduce((world, index) => {
    const node = nodes[index]
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      )
    return world.multiply(local)
  }, new THREE.Matrix4())
}

describe('Phase 23 shipped horse runtime package', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(PACKAGE_ROOT, MANIFEST_FILE), 'utf8'),
  ) as HorseAssetManifest

  it('ships a ready schema-v2 manifest with real package metrics', () => {
    expect(() => validateHorseManifest(manifest)).not.toThrow()
    expect(runtimePackageBytes()).toBe(manifest.metrics!.packageBytes)
    expect(manifest.metrics!.packageBytes).toBeLessThanOrEqual(30 * 1024 * 1024)
  })

  it('ships one Meshopt-compressed rig, all clips, LODs, and sockets', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, manifest.file!))
    expect(document.extensionsUsed).toEqual(expect.arrayContaining([
      'EXT_meshopt_compression',
      'KHR_texture_basisu',
    ]))
    expect(document.bufferViews?.some((view) => (
      view.extensions?.EXT_meshopt_compression !== undefined
    ))).toBe(true)
    expect(document.textures?.length).toBeGreaterThan(0)
    expect(document.textures?.every((texture) => (
      texture.extensions?.KHR_texture_basisu?.source !== undefined
    ))).toBe(true)
    expect(document.skins).toHaveLength(1)
    expect(document.skins?.[0].joints?.length).toBeGreaterThan(0)
    expect(document.animations?.map((animation) => animation.name).sort()).toEqual(REQUIRED_CLIPS)

    const nodeNames = new Set(document.nodes?.map((node) => node.name))
    for (const name of REQUIRED_NODES) expect(nodeNames.has(name)).toBe(true)
    for (const name of manifest.bodyMeshNames) expect(nodeNames.has(name)).toBe(true)

    const countNodeTriangles = (nodeIndex: number, visited = new Set<number>()): number => {
      if (visited.has(nodeIndex)) return 0
      visited.add(nodeIndex)
      const node = document.nodes?.[nodeIndex]
      if (!node) return 0
      const primitives = node.mesh === undefined
        ? []
        : document.meshes?.[node.mesh].primitives ?? []
      const ownTriangles = primitives.reduce((total, primitive) => {
        if ((primitive.mode ?? 4) !== 4 || primitive.indices === undefined) return total
        return total + (document.accessors?.[primitive.indices].count ?? 0) / 3
      }, 0)
      return ownTriangles + (node.children ?? []).reduce((total, child) => (
        total + countNodeTriangles(child, visited)
      ), 0)
    }
    const expectedTriangles = manifest.metrics!.triangles
    Object.entries(manifest.lodNodes).forEach(([lod, name]) => {
      const nodeIndex = document.nodes?.findIndex((candidate) => candidate.name === name)
      expect(nodeIndex).toBeGreaterThanOrEqual(0)
      expect(countNodeTriangles(nodeIndex!)).toBe(
        expectedTriangles[lod as keyof typeof expectedTriangles],
      )
    })
  })

  it('uses valid KTX2 images no larger than the declared 2K maximum', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, manifest.file!))
    const paths = new Set([
      ...(document.images?.map((image) => image.uri).filter((uri): uri is string => Boolean(uri)) ?? []),
      manifest.sharedBodyMaps.normal,
      manifest.sharedBodyMaps.roughness,
      ...(manifest.sharedBodyMaps.ao ? [manifest.sharedBodyMaps.ao] : []),
      ...manifest.variants.map((variant) => variant.baseColor),
    ])
    let maximum = 0
    for (const path of paths) {
      expect(path.endsWith('.ktx2')).toBe(true)
      const { width, height } = ktx2Size(path)
      expect(width).toBeGreaterThan(0)
      expect(height).toBeGreaterThan(0)
      maximum = Math.max(maximum, width, height)
    }
    expect(maximum).toBe(manifest.metrics!.textureMaxSize)
  })

  it('preserves metre-scale body bounds after compression', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, manifest.file!))
    const bodyNode = document.nodes?.find((node) => node.name === manifest.bodyMeshNames[0])
    expect(bodyNode?.mesh).toBeDefined()
    const positionAccessors = document.meshes?.[bodyNode!.mesh!].primitives
      ?.map((primitive) => primitive.attributes?.POSITION)
      .filter((index): index is number => index !== undefined) ?? []
    expect(positionAccessors.length).toBeGreaterThan(0)

    const bodyBounds = new THREE.Box3()
    for (const accessorIndex of positionAccessors) {
      const bounds = accessorBounds(document, accessorIndex)
      bodyBounds.expandByPoint(bounds.min)
      bodyBounds.expandByPoint(bounds.max)
    }
    const size = bodyBounds.getSize(new THREE.Vector3())
    const metrics = manifest.metrics!
    expect(size.x).toBeGreaterThan(metrics.widthM * 0.9)
    expect(size.x).toBeLessThan(metrics.widthM * 1.1)
    expect(size.y).toBeGreaterThan(metrics.overallHeightM * 0.9)
    expect(size.y).toBeLessThan(metrics.overallHeightM * 1.1)
    expect(size.z).toBeGreaterThan(metrics.lengthM * 0.9)
    expect(size.z).toBeLessThan(metrics.lengthM * 1.1)
  })

  it('ships saddle and stirrup sockets at usable world landmarks', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, manifest.file!))
    const metrics = manifest.metrics!
    const socketPosition = (name: string): THREE.Vector3 => {
      const nodeIndex = document.nodes?.findIndex((node) => node.name === name) ?? -1
      expect(nodeIndex).toBeGreaterThanOrEqual(0)
      return new THREE.Vector3().applyMatrix4(nodeWorldMatrix(document, nodeIndex))
    }
    const saddle = socketPosition('socket_saddle_seat')
    const stirrupLeft = socketPosition('socket_stirrup_l')
    const stirrupRight = socketPosition('socket_stirrup_r')
    const camera = socketPosition('socket_camera')
    expect(Math.abs(saddle.y - metrics.saddleHeightM)).toBeLessThanOrEqual(0.12)
    expect(Math.abs(saddle.x)).toBeLessThanOrEqual(0.15)
    expect(saddle.z).toBeGreaterThan(-0.2)
    expect(saddle.z).toBeLessThan(0.65)
    expect(stirrupLeft.y).toBeLessThan(saddle.y - 0.25)
    expect(stirrupRight.y).toBeLessThan(saddle.y - 0.25)
    expect(Math.abs(stirrupLeft.y - stirrupRight.y)).toBeLessThanOrEqual(0.08)
    expect(stirrupLeft.x * stirrupRight.x).toBeLessThan(0)
    expect(Math.abs(stirrupLeft.x + stirrupRight.x)).toBeLessThanOrEqual(0.08)
    expect(Math.abs(stirrupLeft.z - saddle.z)).toBeLessThanOrEqual(0.18)
    expect(Math.abs(stirrupRight.z - saddle.z)).toBeLessThanOrEqual(0.18)
    expect(Math.abs(camera.x)).toBeLessThanOrEqual(0.15)
    expect(camera.y).toBeGreaterThan(saddle.y + 0.3)
    expect(camera.z).toBeLessThan(saddle.z - 1)
  })

  it('keeps a finite uniform rig basis and confines root motion to death', () => {
    const document = parseGlb(resolve(PACKAGE_ROOT, manifest.file!))
    const rigIndex = document.nodes?.findIndex((node) => node.name === 'horse.rig') ?? -1
    expect(rigIndex).toBeGreaterThanOrEqual(0)
    const rig = document.nodes![rigIndex]
    expect(rig).toBeDefined()
    const matrix = rig!.matrix
      ? new THREE.Matrix4().fromArray(rig!.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3(...(rig!.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(rig!.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(rig!.scale ?? [1, 1, 1])),
      )
    const translation = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrix.decompose(translation, rotation, scale)
    translation.toArray().forEach((value) => expect(Number.isFinite(value)).toBe(true))
    expect(Math.abs(translation.x)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(translation.y)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(translation.z)).toBeLessThanOrEqual(0.02)
    expect(rotation.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(1e-4)
    scale.toArray().forEach((value) => {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0.8)
      expect(value).toBeLessThan(1.2)
      expect(Math.abs(value - scale.x)).toBeLessThanOrEqual(1e-4)
    })

    for (const animation of document.animations ?? []) {
      const rigTransformChannels = animation.channels?.filter((channel) => (
        channel.target?.node === rigIndex
        && channel.target.path !== 'weights'
      )) ?? []
      const paths = rigTransformChannels.map((channel) => channel.target?.path).sort()
      if (animation.name === 'death') {
        expect(paths).toEqual(['rotation', 'scale', 'translation'])
      } else {
        expect(paths, `${animation.name ?? 'unnamed'} must not move horse.rig`).toHaveLength(0)
      }
    }
  })
})
