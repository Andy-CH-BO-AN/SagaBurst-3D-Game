const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyInputs, BUILDERS } = require('./ci-inputs.cjs')
const { validateAssets, hash, runtimeManifestFields } = require('./ci-assets.cjs')

const classify = changes => classifyInputs(changes, { regular: () => true, read: () => '', docsOnly: () => false })

test('routes removed models, horse KTX2 maps and multi-output builders to the asset validator', () => {
  const [removed, removedSource, map, builder] = classify([
    { file: 'public/models/weapons/paladin/mace.glb', status: 'D' },
    { file: 'src/world/Removed.ts', status: 'D' },
    { file: 'public/models/mounts/v1/armored-horse/textures/lod1-normal.ktx2', status: 'A' },
    { file: 'tools/build-paladin.py', status: 'M' },
  ])
  assert.equal(removed.kind, 'retired')
  assert.equal(removedSource.kind, 'unknown')
  assert.deepEqual(map.asset, { family: 'mount', id: 'armored-horse', root: 'public/models/mounts/v1/armored-horse' })
  assert.equal(builder.kind, 'builder')
  assert.deepEqual(BUILDERS['tools/build-paladin.py'].outputs.map(o => o.family), ['humanoid', 'provenance-weapon'])
})

function glb(document) {
  let json = Buffer.from(JSON.stringify(document))
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.alloc(20)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8)
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, json])
}
const KTX2 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function horsePackage(imageUri) {
  const root = 'public/models/mounts/v1/test-horse'
  const model = glb({ asset: { version: '2.0' }, nodes: [{ name: 'lod0' }],
    extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'],
    images: [{ uri: imageUri, mimeType: 'image/ktx2' }], textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }] })
  const manifest = { schemaVersion: 2, status: 'ready', forward: '+Z', id: 'test-horse', file: 'horse.glb', sha256: hash(model),
    sources: [{ author: 'a', url: 'https://example.invalid', license: 'CC0', sha256: 'a'.repeat(64) }],
    sharedBodyMaps: { normal: 'textures/normal.ktx2' }, variants: [{ id: 'v', baseColor: 'textures/normal.ktx2' }],
    clips: [], lodNodes: { lod0: 'lod0' } }
  const files = { [root + '/manifest.json']: Buffer.from(JSON.stringify(manifest)), [root + '/horse.glb']: model,
    [root + '/CREDITS.md']: Buffer.from('credits'), [root + '/textures/normal.ktx2']: KTX2, [root + '/textures/lod1.ktx2']: KTX2 }
  const host = { read(file) { if (!files[file]) throw Error('ENOENT ' + file); return files[file] } }
  const inputs = [{ kind: 'asset', status: 'A', file: root + '/manifest.json', asset: { family: 'mount', id: 'test-horse', root } }]
  return () => validateAssets(inputs, host, {})
}

test('admits schema-2 horse GLB images only as KTX2 files inside its own package', () => {
  assert.equal(horsePackage('textures/lod1.ktx2')().result, 'passed')
  assert.throws(horsePackage('../other-horse/textures/lod1.ktx2'), /External or invalid image resource/)
  assert.throws(horsePackage('textures/missing.ktx2'), /ENOENT/)
})

test('reports runtime-sensitive manifest edits instead of treating them as static metadata', () => {
  const before = { animations: { embedded: [{ clip: 'walk', duration: 1 }] }, fileSha256: { lod0: 'a' }, metrics: { m: 1 } }
  const after = { animations: { embedded: [{ clip: 'walk', duration: 1.2 }] }, fileSha256: { lod0: 'b' }, metrics: { m: 2 } }
  assert.deepEqual(runtimeManifestFields(before, after, 'humanoid'), ['animations', 'metrics'])
  assert.deepEqual(runtimeManifestFields(before, after, 'mount'), ['animations'])
})
