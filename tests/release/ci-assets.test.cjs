'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseGlb, validateAssets, hash } = require('../tooling/ci-assets.cjs')
const { assetInput, classifyInputs, htmlStyleOnly } = require('../tooling/ci-inputs.cjs')
function glb(document = {}, binary = Buffer.alloc(4)) {
  const text = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }], ...document }))
  const json = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8)
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16)
  binHeader.writeUInt32LE(binary.length); binHeader.write('BIN\0', 4)
  return Buffer.concat([header, json, binHeader, binary])
}
test('GLB 解析器接受小型內嵌資料並阻擋損壞 Header 與 Chunk', () => {
  const bytes = glb()
  assert.equal(parseGlb(bytes).binary.length, 4)
  const bad = Buffer.from(bytes); bad.writeUInt32LE(bytes.length + 4, 8)
  assert.throws(() => parseGlb(bad), /declared length/)
  const chunk = Buffer.from(bytes); chunk.writeUInt32LE(bytes.length, 12)
  assert.throws(() => parseGlb(chunk), /chunk bounds/)
  assert.throws(() => parseGlb(Buffer.from('invalid')), /header magic/)
  const json = Buffer.from(bytes); json[20] = 0
  assert.throws(() => parseGlb(json), /Invalid GLB JSON/)
})
test('GLB 外部資源、BufferView 越界與未知必要 Extension 必須失敗', () => {
  assert.throws(() => parseGlb(glb({ buffers: [{ byteLength: 4, uri: 'https://example.invalid/a.bin' }] })), /External buffer/)
  assert.throws(() => parseGlb(glb({ bufferViews: [{ buffer: 0, byteLength: 8 }] })), /BufferView bounds/)
  assert.throws(() => parseGlb(glb({ images: [{ uri: 'texture.png' }] })), /image resource/)
  assert.throws(() => parseGlb(glb({ extensionsUsed: ['unknown'], extensionsRequired: ['unknown'] })), /Unsupported required/)
})
test('Meshopt 壓縮區塊步幅不會被誤當成 Accessor 步幅', () => {
  const document = { buffers: [{ byteLength: 4 }, { byteLength: 8, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'],
    bufferViews: [{ buffer: 1, byteLength: 8, extensions: { EXT_meshopt_compression: {
      buffer: 0, byteLength: 4, byteStride: 4, count: 2, mode: 'ATTRIBUTES' } } }],
    accessors: [{ bufferView: 0, componentType: 5123, type: 'VEC4', count: 1 }] }
  assert.equal(parseGlb(glb(document)).document.accessors[0].count, 1)
  document.accessors[0].count = 2
  assert.throws(() => parseGlb(glb(document)), /Accessor bounds/)
})
function family() {
  const root = 'public/models/characters/v2/fixture', files = new Map()
  const bytes = glb({ nodes: [{ name: 'hips' }, { name: 'socket_pelvis' }], animations: [{ name: 'idle' }] })
  const put = (name, data) => files.set(root + '/' + name, Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)))
  const manifest = { schemaVersion: 1, id: 'fixture', status: 'ready', skeleton: 'project-humanoid-v1',
    attribution: 'fixture source', source: { license: 'fixture', licenseEvidence: 'attribution-evidence.json', sourceSha256: 'a'.repeat(64) },
    boneMap: 'bone-map.json', audit: 'audit.json', files: {}, fileSha256: {}, animations: { embedded: [{ clip: 'idle', loop: true, duration: 1 }] } }
  const lods = []
  for (let level = 0; level < 3; level++) {
    manifest.files['lod' + level] = 'lod' + level + '.glb'; manifest.fileSha256['lod' + level] = hash(bytes)
    put('lod' + level + '.glb', bytes); lods.push({ level, sha256: hash(bytes), bytes: bytes.length })
  }
  put('manifest.json', manifest); put('audit.json', { lods }); put('ATTRIBUTION.md', Buffer.from('fixture attribution'))
  put('attribution-evidence.json', { rightsEvidence: 'fixture' })
  put('bone-map.json', { skeleton: manifest.skeleton, sourceToProject: { root: 'hips' }, sockets: { socket_pelvis: 'hips' } })
  return { files, put, manifest, root, input: { kind: 'asset', file: root + '/manifest.json', asset: assetInput(root + '/manifest.json') },
    host: { read: file => { if (!files.has(file)) throw Error('Missing file: ' + file); return files.get(file) } },
    contracts: { descriptors: { fixture: { assetId: 'fixture' } }, validateHumanoid(m, d) { assert.equal(m.id, d.assetId) } } }
}
test('純資產驗證核對完整關聯並明確回報通過', () => {
  const f = family(), report = validateAssets([f.input], f.host, f.contracts)
  assert.equal(report.result, 'passed'); assert.equal(report.files.length, 8)
  assert.ok(report.files.includes(f.root + '/lod2.glb'))
})
test('Manifest 缺少關聯檔案不能成為合法純資產結果', () => {
  const f = family(); f.files.delete(f.root + '/lod1.glb')
  assert.throws(() => validateAssets([f.input], f.host, f.contracts), /Missing file/)
})
test('資產雜湊不一致與 Bone Map 不存在節點必須阻擋', () => {
  const f = family(); f.manifest.fileSha256.lod0 = 'b'.repeat(64); f.put('manifest.json', f.manifest)
  assert.throws(() => validateAssets([f.input], f.host, f.contracts), /SHA256 mismatch/)
  const map = family(); map.put('bone-map.json', { skeleton: 'project-humanoid-v1', sourceToProject: { root: 'missing' }, sockets: {} })
  assert.throws(() => validateAssets([map.input], map.host, map.contracts), /Bone map references/)
})
test('HTML 僅有既存 Style 文字變更可與 Runtime 正常分流', () => {
  const before = '<html><head><title>Game</title><style>a{color:red;overscroll-behavior:contain}</style></head><body><script src="/src/main.ts"></script></body></html>'
  const after = before.replace('red', 'blue')
  assert.equal(htmlStyleOnly(before, after), true)
  const classified = classifyInputs([{ status: 'M', file: 'index.html' }, { status: 'M', file: 'src/main.ts' }], {
    regular: () => true, read: side => side === 'base' ? before : after, docsOnly: () => false })
  assert.deepEqual(classified.map(i => i.kind), ['html-style', 'runtime'])
})
test('HTML DOM、Script、事件、資源與偽裝 Style 不得被判成純樣式', () => {
  const before = '<head><style>a{color:red}</style></head><body></body>'
  for (const after of [before.replace('<body>', '<body onclick="run()">'), before.replace('</body>', '<script>run()</script></body>'),
    before.replace('red', 'url(new.png)'), before.replace('<style>', '<style media="print">'),
    '<!--' + before + '-->', before.replace('<body>', '<body id="new">')]) assert.equal(htmlStyleOnly(before, after), false)
  const fake = '<head><script>"<style>red</style>"</script></head>'
  assert.equal(htmlStyleOnly(fake, fake.replace('red', 'blue')), false)
})
test('未知資產、Builder、Symlink 與刪除在混合輸入中仍須封閉失敗', () => {
  const changes = [{ status: 'A', file: 'public/random.glb' }, { status: 'M', file: 'tools/unknown.mjs' },
    { status: 'D', file: 'public/models/characters/v2/fixture/lod0.glb' }, { status: 'M', file: 'src/link.ts' }]
  const result = classifyInputs(changes, { regular: () => false, read: () => '', docsOnly: () => false })
  assert.ok(result.every(i => i.kind === 'unknown'))
})
