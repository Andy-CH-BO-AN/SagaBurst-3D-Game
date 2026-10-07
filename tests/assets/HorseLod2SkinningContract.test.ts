import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HORSE_RUNTIME = resolve(
  process.env.HORSE_RUNTIME_FILE ?? 'public/models/mounts/v1/horse/horse_runtime.glb',
)

interface GlbDocument {
  nodes?: Array<{
    name?: string
    mesh?: number
  }>
  meshes?: Array<{
    primitives?: Array<{
      attributes?: Record<string, number>
    }>
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

function primitiveForNode(document: GlbDocument, nodeName: string) {
  const node = document.nodes?.find((candidate) => candidate.name === nodeName)
  expect(node, `${nodeName} must exist`).toBeDefined()
  expect(node?.mesh, `${nodeName} must reference a mesh`).toBeDefined()

  const primitives = document.meshes?.[node!.mesh!].primitives ?? []
  expect(primitives, `${nodeName} must remain single-primitive`).toHaveLength(1)
  return primitives[0]
}

describe('horse LOD2 Plan B skinning contract', () => {
  it('keeps merged tack on the supported 4-influence contract', () => {
    const document = parseGlb(HORSE_RUNTIME)
    const mergedTack = primitiveForNode(document, 'horse_tack_lod2')

    expect(mergedTack.attributes?.JOINTS_0).toBeDefined()
    expect(mergedTack.attributes?.WEIGHTS_0).toBeDefined()
    expect(mergedTack.attributes?.JOINTS_1).toBeUndefined()
    expect(mergedTack.attributes?.WEIGHTS_1).toBeUndefined()
  })

  it('preserves second influences on the three meshes excluded from consolidation', () => {
    const document = parseGlb(HORSE_RUNTIME)
    const preservedMeshes = [
      'bridle_4F_Leather_Brown_Worn_mqm_lod2',
      'bridle_body_4F_Leather_Brown_Worn_mqm_lod2',
      'saddle_pad_quilt_random_lod2',
    ]

    for (const nodeName of preservedMeshes) {
      const primitive = primitiveForNode(document, nodeName)
      expect(primitive.attributes?.JOINTS_0, `${nodeName} JOINTS_0`).toBeDefined()
      expect(primitive.attributes?.WEIGHTS_0, `${nodeName} WEIGHTS_0`).toBeDefined()
      expect(primitive.attributes?.JOINTS_1, `${nodeName} JOINTS_1`).toBeDefined()
      expect(primitive.attributes?.WEIGHTS_1, `${nodeName} WEIGHTS_1`).toBeDefined()
    }
  })
})
