import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
// Offline asset tools are JavaScript modules; they do not enter the game bundle.
// @ts-expect-error Tool module has no declaration file.
import { encodeGlb, readGlb, sha } from '../../tools/blender/animal_glb.mjs'
// @ts-expect-error Tool module has no declaration file.
import { applyCorgiRig } from '../../tools/blender/corgi_rig.mjs'
// @ts-expect-error Tool module has no declaration file.
import { loadGLB } from '../../tools/blender/glb_pose.mjs'

const names = [
  'corgi_front_lower_l', 'corgi_front_paw_l', 'corgi_front_lower_r', 'corgi_front_paw_r',
  'corgi_rear_lower_l', 'corgi_rear_ankle_l', 'corgi_rear_paw_l',
  'corgi_rear_lower_r', 'corgi_rear_ankle_r', 'corgi_rear_paw_r',
]

/** Four weighted points suffice to prove that changed pivots preserve bind shape. */
function fixture() {
  const chunks: Buffer[] = []
  const views: object[] = []
  const accessors: object[] = []
  let length = 0
  function append(values: number[], componentType: number, count: number, type: string) {
    const pad = (4 - length % 4) % 4
    chunks.push(Buffer.alloc(pad)); length += pad
    const width = componentType === 5123 ? 2 : 4
    const bytes = Buffer.alloc(values.length * width)
    values.forEach((value, i) => componentType === 5123
      ? bytes.writeUInt16LE(value, i * width) : bytes.writeFloatLE(value, i * width))
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    accessors.push({ bufferView: views.length - 1, componentType, count, type })
    chunks.push(bytes); length += bytes.length
    return accessors.length - 1
  }
  const positions = append([.3, 0, .2, -.3, 0, .2, .3, 0, -.2, -.3, 0, -.2], 5126, 4, 'VEC3')
  const joints = append([1, 0, 0, 0, 3, 0, 0, 0, 6, 0, 0, 0, 9, 0, 0, 0], 5123, 4, 'VEC4')
  const weights = append([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 5126, 4, 'VEC4')
  const bones = names.map((name, i) => ({ name, translation: [i / 10, .2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }))
  const inverse = append(bones.flatMap(b => new Matrix4().makeTranslation(-b.translation[0], -.2, 0).elements), 5126, 10, 'MAT4')
  const indices = append([0, 1, 2, 0, 2, 3], 5123, 6, 'SCALAR')
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [1] }],
    nodes: [{ name: 'corgi_body_lod0', mesh: 0, skin: 0 },
      { name: 'corgi_rig', children: [0, ...names.map((_, i) => i + 2)] }, ...bones],
    meshes: [{ primitives: [{ attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights }, indices }] }],
    skins: [{ joints: names.map((_, i) => i + 2), inverseBindMatrices: inverse }],
    buffers: [{ byteLength: length }], bufferViews: views, accessors, animations: [],
  }
  const baseline = readGlb(encodeGlb(doc, Buffer.concat(chunks)))
  const spec = { algorithm: 'fixture', baselineSha256: sha(baseline.raw), landmarks: {},
    joints: bones.map((b, i) => ({ ...b, translation: [b.translation[0] + .15, .31, -.08],
      rotation: [0, Math.sin((i + 1) * .02), 0, Math.cos((i + 1) * .02)] })) }
  return { baseline, spec }
}

describe('corgi wrist/hock correction', () => {
  it('compensates changed pivots without moving the weighted bind mesh or changing geometry bytes', async () => {
    const { baseline, spec } = fixture()
    const patch = await applyCorgiRig(baseline, spec)
    expect(patch.bin.subarray(0, baseline.bin.length).equals(baseline.bin)).toBe(true)
    expect(patch.doc.meshes).toEqual(baseline.doc.meshes)
    expect(patch.doc.nodes.slice(0, 2)).toEqual(baseline.doc.nodes.slice(0, 2))
    const before = await loadGLB(baseline.raw)
    const after = await loadGLB(encodeGlb(patch.doc, patch.bin))
    const rest = { channels: [], samplers: [] }
    const a = before.vertices(before.pose(rest, 0)), b = after.vertices(after.pose(rest, 0))
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6)
    expect(patch.report.maximumBindMatrixError).toBeLessThan(1e-6)
  })

  it('rejects a correction for another source package', async () => {
    const { baseline, spec } = fixture(); spec.baselineSha256 = 'stale'
    await expect(applyCorgiRig(baseline, spec)).rejects.toThrow('pinned source')
  })

  it('rejects torso or other unreviewed joint changes', async () => {
    const { baseline, spec } = fixture(); spec.joints[0].name = 'corgi_torso'
    await expect(applyCorgiRig(baseline, spec)).rejects.toThrow('ten reviewed')
  })

  it('rejects resizing a bone during pivot correction', async () => {
    const { baseline, spec } = fixture(); spec.joints[0].scale = [1, 2, 1]
    await expect(applyCorgiRig(baseline, spec)).rejects.toThrow('resize')
  })
})
