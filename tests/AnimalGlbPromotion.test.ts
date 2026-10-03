import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error shared Node asset tooling has no TypeScript declaration.
import { encodeGlb, preserveReport, readGlb, sha, validatePlaybackEvidence } from '../tools/blender/animal_glb.mjs'

function baselineFixture(animal = 'corgi') {
  const prefix = animal === 'black-cat' ? 'cat' : 'corgi'
  const bin = Buffer.alloc(188)
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: `${prefix}_fixture_body`, mesh: 0, skin: 0 }, { name: `${prefix}_torso`, translation: [0, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1, material: 0 }] }],
    skins: [{ joints: [1], inverseBindMatrices: 4 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 5, mimeType: 'image/png' }],
    samplers: [{}],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
      { buffer: 0, byteOffset: 68, byteLength: 48 },
      { buffer: 0, byteOffset: 116, byteLength: 64 },
      { buffer: 0, byteOffset: 180, byteLength: 8 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: 1, type: 'MAT4' },
    ],
    animations: [],
  }
  return readGlb(encodeGlb(document, bin))
}

function editedAsset(before: ReturnType<typeof baselineFixture>, edit: (doc: any, bin: Buffer) => void, extraBytes = 0) {
  const doc = structuredClone(before.doc)
  const bin = Buffer.concat([before.bin, Buffer.alloc(extraBytes, 1)])
  doc.buffers[0].byteLength = bin.length
  edit(doc, bin)
  return readGlb(encodeGlb(doc, bin))
}

/** A four-vertex skin exercises the canonical data gate without a production asset or pose QA. */
function catSkinFixture() {
  const doc: any = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'cat_body_lod0', mesh: 0, skin: 0 },
      { name: 'cat_torso', children: [2, 3, 4, 5] },
      ...['front_paw_l', 'front_paw_r', 'rear_paw_l', 'rear_paw_r'].map(name => ({ name: `cat_${name}` })),
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1 }] }],
    skins: [{ joints: [1, 2, 3, 4, 5], inverseBindMatrices: 4 }],
    buffers: [], bufferViews: [], accessors: [],
    animations: [{ name: 'idle', channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
      samplers: [{ input: 5, output: 6 }] }],
  }
  const chunks: Buffer[] = []
  let offset = 0
  const append = (values: number[], componentType: number, type: string, count: number) => {
    const size = componentType === 5123 ? 2 : 4
    const bytes = Buffer.alloc(values.length * size)
    values.forEach((value, index) => componentType === 5123
      ? bytes.writeUInt16LE(value, index * size) : bytes.writeFloatLE(value, index * size))
    doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType, type, count })
    chunks.push(bytes)
    offset += bytes.length
  }
  append([.2, .1, .8, -.2, .1, .8, .2, .1, -.8, -.2, .1, -.8], 5126, 'VEC3', 4)
  append([0, 1, 2, 1, 3, 2], 5123, 'SCALAR', 6)
  append([1, 2, 3, 4].flatMap(joint => [joint, 0, 0, 0]), 5123, 'VEC4', 4)
  append(Array.from({ length: 4 }, () => [1, 0, 0, 0]).flat(), 5126, 'VEC4', 4)
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  append(Array.from({ length: 5 }, () => identity).flat(), 5126, 'MAT4', 5)
  append([0], 5126, 'SCALAR', 1)
  append([0, 0, 0, 1], 5126, 'VEC4', 1)
  doc.buffers = [{ byteLength: offset }]
  const before = readGlb(encodeGlb(doc, Buffer.concat(chunks)))
  const packedSkin = Buffer.concat([chunks[2], chunks[3]])
  const after = editedAsset(before, (data, bin) => {
    packedSkin.copy(bin, before.bin.length)
    data.bufferViews.push({ ...data.bufferViews[2], byteOffset: before.bin.length })
    data.bufferViews.push({ ...data.bufferViews[3], byteOffset: before.bin.length + chunks[2].length })
    data.accessors.push({ ...data.accessors[2], bufferView: 7 })
    data.accessors.push({ ...data.accessors[3], bufferView: 8 })
    data.meshes[0].primitives[0].attributes.JOINTS_0 = 7
    data.meshes[0].primitives[0].attributes.WEIGHTS_0 = 8
  }, packedSkin.length)
  return { before, after }
}

describe('animal GLB immutable promotion data', () => {
  it('allows appended animation data while preserving original geometry, rest, skin, and images', async () => {
    const before = baselineFixture()
    const after = editedAsset(before, (doc, bin) => {
      bin.writeFloatLE(0, before.bin.length)
      bin.writeFloatLE(1, before.bin.length + 4)
      doc.bufferViews.push({ buffer: 0, byteOffset: before.bin.length, byteLength: 8 })
      doc.bufferViews.push({ buffer: 0, byteOffset: before.bin.length + 8, byteLength: 24 })
      doc.accessors.push({ bufferView: 6, componentType: 5126, count: 2, type: 'SCALAR' })
      doc.accessors.push({ bufferView: 7, componentType: 5126, count: 2, type: 'VEC3' })
      doc.animations.push({ name: 'walk', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
        samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }] })
    }, 32)
    await expect(preserveReport(before, after, 'corgi')).resolves.toMatchObject({
      geometryExact: true, nodesExact: true, skinsExact: true, materialsExact: true,
      imagesExact: true, originalBinaryPrefixExact: true, sha256: sha(after.raw),
    })
  })

  it('rejects redirecting the original POSITION accessor to appended geometry', async () => {
    const before = baselineFixture()
    const after = editedAsset(before, doc => {
      doc.bufferViews.push({ buffer: 0, byteOffset: before.bin.length, byteLength: 36 })
      doc.accessors[0].bufferView = 6
    }, 36)
    await expect(preserveReport(before, after, 'corgi')).rejects.toThrow('Changed original accessors metadata')
  })

  it('rejects redirecting the original image bufferView to appended image bytes', async () => {
    const before = baselineFixture()
    const after = editedAsset(before, doc => { doc.bufferViews[5].byteOffset = before.bin.length }, 8)
    await expect(preserveReport(before, after, 'corgi')).rejects.toThrow('Changed original bufferViews metadata')
  })

  it('rejects replacing the embedded source buffer with an external URI', async () => {
    const before = baselineFixture()
    const after = editedAsset(before, doc => { doc.buffers[0].uri = 'different-geometry.bin' })
    await expect(preserveReport(before, after, 'corgi')).rejects.toThrow('Changed immutable buffer binding')
  })

  it.each(['truncated', 'oversized'])('rejects a %s embedded buffer length', async mode => {
    const before = baselineFixture()
    const after = editedAsset(before, (doc, bin) => {
      doc.buffers[0].byteLength = mode === 'truncated' ? before.bin.length - 4 : bin.length + 4
    })
    await expect(preserveReport(before, after, 'corgi')).rejects.toThrow('Invalid merged buffer length')
  })

  it.each([
    { key: 'nodes', edit: (doc: any) => { doc.nodes[1].translation[1] += .1 } },
    { key: 'skins', edit: (doc: any) => { doc.skins[0].joints = [0] } },
    { key: 'materials', edit: (doc: any) => { doc.materials[0].pbrMetallicRoughness.baseColorFactor = [0, 0, 0, 1] } },
    { key: 'images', edit: (doc: any) => { doc.images[0].mimeType = 'image/jpeg' } },
  ])('rejects changed immutable $key metadata', async ({ key, edit }) => {
    const before = baselineFixture()
    await expect(preserveReport(before, editedAsset(before, edit), 'corgi')).rejects.toThrow(`Changed immutable ${key}`)
  })

  it.each([{ part: 'geometry', offset: 0 }, { part: 'image', offset: 180 }])(
    'rejects changed original $part bytes despite unchanged metadata', async ({ offset }) => {
      const before = baselineFixture()
      const after = editedAsset(before, (_doc, bin) => { bin[offset] = 1 })
      await expect(preserveReport(before, after, 'corgi')).rejects.toThrow('Original mesh/skin/image/animation byte prefix changed')
    },
  )

  it('does not let the cat skin exception hide a POSITION accessor redirect', async () => {
    const before = baselineFixture('black-cat')
    const after = editedAsset(before, doc => {
      doc.bufferViews.push({ buffer: 0, byteOffset: before.bin.length, byteLength: 36 })
      doc.accessors.push({ ...doc.accessors[2], bufferView: 6 })
      doc.meshes[0].primitives[0].attributes.JOINTS_0 = 5
      doc.accessors[0].bufferView = 6
    }, 36)
    await expect(preserveReport(before, after, 'black-cat')).rejects.toThrow('Changed original accessors metadata')
  })
})

describe('canonical cat skin attribute data', () => {
  it('accepts canonical values in new skin accessors while preserving the source data', async () => {
    const { before, after } = catSkinFixture()
    await expect(preserveReport(before, after, 'black-cat')).resolves.toMatchObject({
      geometryExact: true, originalBinaryPrefixExact: true,
      skinCorrection: { algorithm: 'cat-paw-lumbar-v6' },
    })
  })

  it('rejects a changed VEC2/count layout even when every flattened weight value is identical', async () => {
    const { before, after } = catSkinFixture()
    const malformed = editedAsset(after, doc => {
      doc.accessors[8].type = 'VEC2'
      doc.accessors[8].count *= 2
    })
    await expect(preserveReport(before, malformed, 'black-cat')).rejects.toThrow('Invalid skin layout cat_body_lod0/WEIGHTS_0')
  })

  it('rejects changed, still normalized skin weights outside the canonical correction', async () => {
    const { before, after } = catSkinFixture()
    const changed = editedAsset(after, (doc, bin) => {
      const offset = doc.bufferViews[doc.accessors[8].bufferView].byteOffset
      bin.writeFloatLE(.75, offset)
      bin.writeFloatLE(.25, offset + 4)
    })
    await expect(preserveReport(before, changed, 'black-cat')).rejects.toThrow('Unreviewed skin change cat_body_lod0/WEIGHTS_0')
  })

  it('rejects fractional float joint indices that fall within the weight tolerance', async () => {
    const { before, after } = catSkinFixture()
    const changed = editedAsset(after, (doc, bin) => {
      const jointView = doc.bufferViews[doc.accessors[7].bufferView]
      for (let index = 0; index < 16; index++) {
        const value = after.bin.readUInt16LE(jointView.byteOffset + index * 2)
        bin.writeFloatLE(index === 1 ? 5e-7 : value, after.bin.length + index * 4)
      }
      doc.bufferViews.push({ buffer: 0, byteOffset: after.bin.length, byteLength: 64 })
      doc.accessors.push({ bufferView: 9, componentType: 5126, type: 'VEC4', count: 4 })
      doc.meshes[0].primitives[0].attributes.JOINTS_0 = 9
    }, 64)
    await expect(preserveReport(before, changed, 'black-cat')).rejects.toThrow('Invalid joint component type cat_body_lod0')
  })
})

describe('exact animal GLB playback evidence', () => {
  let root: string
  const finalSha = sha(Buffer.from('reviewed final GLB'))
  const content = Buffer.from('reviewed playback report')
  const evidencePath = 'output/mount-retarget/playback.json'
  const evidence = (file = evidencePath) => ({ validation: {
    roundtripMcpPlayback: true, sha256: finalSha, evidence: [{ path: file, sha256: sha(content) }],
  } })

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sagaburst-animal-evidence-'))
    mkdirSync(path.join(root, 'output/mount-retarget'), { recursive: true })
    writeFileSync(path.join(root, evidencePath), content)
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('accepts reviewed evidence only for the matching final file and exact artifact contents', () => {
    expect(() => validatePlaybackEvidence(evidence(), finalSha, root)).not.toThrow()
  })

  it('rejects stale final SHA even when the evidence file has not changed', () => {
    expect(() => validatePlaybackEvidence(evidence(), sha(Buffer.from('rebuilt final GLB')), root))
      .toThrow('Playback evidence belongs to another GLB')
  })

  it('rejects an edited evidence artifact with a stale recorded hash', () => {
    writeFileSync(path.join(root, evidencePath), 'replaced playback report')
    expect(() => validatePlaybackEvidence(evidence(), finalSha, root)).toThrow('Playback evidence has changed')
  })

  it('requires completed playback and at least one evidence artifact', () => {
    const pending = evidence()
    pending.validation.roundtripMcpPlayback = false
    expect(() => validatePlaybackEvidence(pending, finalSha, root)).toThrow('Validate final GLB playback')
    const empty = evidence()
    empty.validation.evidence = []
    expect(() => validatePlaybackEvidence(empty, finalSha, root)).toThrow('Missing playback evidence')
  })

  it.each(['output/../outside.json', 'output-lookalike/playback.json'])('rejects outside-output artifact %s', file => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
    expect(() => validatePlaybackEvidence(evidence(file), finalSha, root)).toThrow('Playback evidence must be a local output artifact')
  })

  it('rejects an output symlink to an artifact outside the allowed output tree', () => {
    const outside = path.join(root, 'outside.json')
    writeFileSync(outside, content)
    symlinkSync(outside, path.join(root, 'output/mount-retarget/linked.json'))
    expect(() => validatePlaybackEvidence(evidence('output/mount-retarget/linked.json'), finalSha, root))
      .toThrow('Playback evidence must be a local output artifact')
  })

  it('rejects a substituted staging baseline before writing any runtime package files', () => {
    const stage = path.join(root, 'output/mount-retarget')
    const packageDirectory = path.join(root, 'public/models/mounts/v2/corgi')
    mkdirSync(packageDirectory, { recursive: true })
    const unreviewed = baselineFixture().raw
    writeFileSync(path.join(stage, 'corgi-baseline.glb'), unreviewed)
    writeFileSync(path.join(stage, 'corgi-final.glb'), unreviewed)
    const metadata = evidence()
    metadata.validation.sha256 = sha(unreviewed)
    writeFileSync(path.join(stage, 'corgi-animation-source.json'), JSON.stringify(metadata))
    const currentFile = path.join(packageDirectory, 'corgi.glb')
    const original = Buffer.from('existing runtime asset')
    writeFileSync(currentFile, original)
    const tool = path.resolve('tools/blender/animal_glb.mjs')
    let failure: any
    try {
      execFileSync('rtk', ['proxy', process.execPath, tool, 'promote', 'corgi'], {
        cwd: root, env: { ...process.env, SAGABURST_ANIMATION_STAGE: stage }, stdio: 'pipe',
      })
    } catch (error) { failure = error }
    expect(failure, 'unreviewed baseline must fail promotion').toBeDefined()
    expect(String(failure.stderr)).toContain('Promotion baseline differs from the pinned source')
    expect(readFileSync(currentFile)).toEqual(original)
  })
})
