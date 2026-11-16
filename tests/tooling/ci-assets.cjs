'use strict'
// Byte/data checks only. No GLTFLoader, scene, rig, Blender or asset regeneration.
const { createHash } = require('node:crypto')
const { SHIELD_ROOT, BUILDERS } = require('./ci-inputs.cjs')
const fail = message => { throw Error('Asset validation unsafe: ' + message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = value => /^[a-f0-9]{64}$/i.test(value || '')
const integer = value => Number.isSafeInteger(value) && value >= 0
function check(condition, message) { if (!condition) fail(message) }
function localReference(root, name) {
  check(typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name) && name !== '.' && name !== '..', 'External or escaping resource reference: ' + name)
  return root + '/' + name
}
// `externalImage(uri)` admits a relative image file the package ships beside the GLB
// (schema-2 horse KTX2 maps); it must prove the file itself. Everything else is embedded.
function parseGlb(bytes, { externalImage } = {}) {
  check(Buffer.isBuffer(bytes) && bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'glTF', 'GLB header magic')
  check(bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'GLB version or declared length')
  const chunks = []
  for (let at = 12; at < bytes.length;) {
    check(at + 8 <= bytes.length, 'Truncated chunk header')
    const size = bytes.readUInt32LE(at), type = bytes.readUInt32LE(at + 4)
    check(size % 4 === 0 && at + 8 + size <= bytes.length, 'GLB chunk bounds/alignment')
    chunks.push({ type, bytes: bytes.subarray(at + 8, at + 8 + size) }); at += 8 + size
  }
  check(chunks.length >= 1 && chunks.length <= 2 && chunks[0].type === 0x4e4f534a &&
    (chunks.length === 1 || chunks[1].type === 0x004e4942), 'Expected JSON then optional BIN chunks')
  let document
  try { document = JSON.parse(chunks[0].bytes.toString('utf8')) } catch { fail('Invalid GLB JSON') }
  check(document?.asset?.version === '2.0', 'glTF asset version')
  const binary = chunks[1]?.bytes ?? Buffer.alloc(0)
  const buffers = document.buffers ?? []
  const required = document.extensionsRequired ?? []
  const used = document.extensionsUsed ?? []
  check(Array.isArray(required) && Array.isArray(used) && required.every(name => used.includes(name) &&
    ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_materials_unlit', 'KHR_texture_transform', 'KHR_texture_basisu'].includes(name)), 'Unsupported required extension')
  for (const [i, buffer] of buffers.entries()) {
    check(integer(buffer.byteLength) && !buffer.uri, 'External buffer URI or invalid length')
    if (i === 0) check(buffer.byteLength <= binary.length && binary.length - buffer.byteLength <= 3, 'Embedded buffer length')
    else check(required.includes('EXT_meshopt_compression') && buffer.extensions?.EXT_meshopt_compression?.fallback === true, 'Unsupported extra buffer')
  }
  const views = document.bufferViews ?? []
  const range = (buffer, offset, length) => integer(buffer) && buffers[buffer] && integer(offset) && integer(length) && offset + length <= buffers[buffer].byteLength
  for (const view of views) {
    check(range(view.buffer, view.byteOffset ?? 0, view.byteLength), 'BufferView bounds')
    const compressed = view.extensions?.EXT_meshopt_compression
    if (compressed) {
      check(used.includes('EXT_meshopt_compression') && compressed.buffer === 0 && range(compressed.buffer, compressed.byteOffset ?? 0, compressed.byteLength) &&
        integer(compressed.count) && compressed.count > 0 && integer(compressed.byteStride) && compressed.byteStride > 0 &&
        compressed.count * compressed.byteStride === view.byteLength &&
        ['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(compressed.mode) &&
        ['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'].includes(compressed.filter ?? 'NONE'), 'Meshopt compression contract')
    } else check(view.buffer === 0, 'Non-compressed view references unavailable fallback buffer')
  }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  for (const accessor of document.accessors ?? []) {
    check(integer(accessor.count) && accessor.count > 0 && components[accessor.type] && sizes[accessor.componentType], 'Invalid accessor')
    // Sparse is a separate glTF contract not yet admitted by these asset families.
    check(!accessor.sparse, 'Unsupported sparse accessor')
    const view = views[accessor.bufferView], unit = sizes[accessor.componentType]
    const width = accessor.type.startsWith('MAT')
      ? Number(accessor.type.at(-1)) * Math.ceil(Number(accessor.type.at(-1)) * unit / 4) * 4
      : components[accessor.type] * unit
    // Meshopt's block stride describes compression, not accessor interleaving.
    const stride = view?.byteStride ?? width
    check(view && integer(accessor.byteOffset ?? 0) && stride >= width &&
      (accessor.byteOffset ?? 0) + (accessor.count - 1) * stride + width <= view.byteLength, 'Accessor bounds')
  }
  // KTX2 images are admitted only behind a required KHR_texture_basisu and only via that extension.
  const basisuSources = new Set(), plainSources = new Set()
  for (const texture of document.textures ?? []) {
    const basisu = texture.extensions?.KHR_texture_basisu
    if (basisu) basisuSources.add(basisu.source)
    if (texture.source !== undefined) plainSources.add(texture.source)
  }
  for (const [index, image] of (document.images ?? []).entries()) {
    const ktx2 = image.mimeType === 'image/ktx2'
    const stored = image.uri ? Boolean(externalImage?.(image.uri)) && image.bufferView === undefined : Boolean(views[image.bufferView])
    check(stored && (ktx2 ? required.includes('KHR_texture_basisu') && basisuSources.has(index) && !plainSources.has(index)
      : ['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)), 'External or invalid image resource')
  }
  return { document, binary }
}
// Unknown/new manifest fields are runtime-sensitive by default. Each admitted
// metadata field is validated by the family contract below; any other change is
// reported so the run cannot present it as asset-only.
// Mount manifests: the runtime reads only status/source/forward/file (QuadrupedAssetPreload); the
// published hash, measured metrics and modification notes are package metadata.
const MOUNT_STATIC_FIELDS = ['sha256', 'metrics', 'modifications']
/** Manifest fields whose change alters runtime behavior (animation timing, rig mapping, ...). */
function runtimeManifestFields(before, after, family) {
  const safe = new Set(['source', 'attribution', 'files', 'fileSha256', 'boneMap', 'audit', 'visualAcceptance', 'knownLimitations',
    ...(family === 'mount' ? MOUNT_STATIC_FIELDS : [])])
  const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => !safe.has(key) && canonical(before[key]) !== canonical(after[key])).sort()
}
function validateWeapon(input, host, contracts, checked) {
  const path = input.file, root = path.slice(0, path.lastIndexOf('/'))
  const family = root.split('/').at(-1)
  const read = file => { checked.add(file); return host.read(file) }
  const doc = read(root + '/ATTRIBUTION.md').toString('utf8')
  check(doc.trim(), 'Missing weapon attribution')
  let paths = [path], rows
  if (family !== 'high-tier') {
    rows = JSON.parse(read(root + '/sources.json').toString('utf8'))
    check(Array.isArray(rows), 'Weapon source inventory')
    if (!path.endsWith('.glb')) paths = Object.values(contracts.shields).filter(p => ('public/' + p).startsWith(root + '/')).map(p => 'public/' + p)
  } else if (!path.endsWith('.glb')) paths = Object.values(contracts.shields).filter(p => ('public/' + p).startsWith(root + '/')).map(p => 'public/' + p)
  check(paths.length, 'No registered weapon outputs')
  for (const file of paths) {
    check(Object.values(contracts.shields).includes(file.slice(7)), 'Unknown runtime weapon registry path: ' + file)
    const bytes = read(file), asset = parseGlb(bytes), name = file.split('/').at(-1).replace('.glb', '')
    const extras = asset.document.asset.extras
    if (family === 'high-tier' && extras?.factionEquipment) {
      validateShields([file.slice(7)], host, contracts, checked)
      continue
    }
    if (family === 'high-tier') {
      check(extras?.author && extras.license && extras.source && digest(extras.sourceSha256) && doc.includes(extras.sourceSha256) && doc.includes(extras.source), 'Weapon embedded provenance differs from attribution')
    } else {
      const matches = rows.filter(r => r.weapon === name || r.publishedPath === file.slice(7))
      check(matches.length === 1, 'Missing/duplicate weapon source record')
      const row = matches[0], sourceSha = row.sourceSha256 ?? row.source?.sha256
      const finalSha = row.finalSha256 ?? row.final?.sha256 ?? (row.final?.byteIdenticalToSource === true ? sourceSha : null)
      check(digest(sourceSha) && digest(finalSha) && hash(bytes) === finalSha, 'Weapon source/final SHA256 mismatch')
      check(row.rightsEvidence || row.license || row.source?.license || (row.sourceProvider && doc.includes(sourceSha)), 'Missing weapon source rights record')
      if (extras?.sourceSha256) check(extras.sourceSha256 === sourceSha, 'Embedded weapon source mismatch')
      if (extras?.byzantineEquipment) check(extras.byzantineEquipment.sourceSha256 === sourceSha && extras.byzantineEquipment.publishedPath === file.slice(7), 'Byzantine embedded provenance mismatch')
    }
    host.glbs.push(asset)
  }
}
function validateHumanoid(root, host, contracts, checked) {
  const read = file => { checked.add(file); return host.read(file) }
  const json = file => { const value = JSON.parse(read(file).toString('utf8')); check(value && typeof value === 'object' && Object.keys(value).length, 'Empty JSON: ' + file); return value }
  const m = json(root + '/manifest.json'), id = root.split('/').at(-1)
  check(m.schemaVersion === 1 && m.id === id && m.status === 'ready' && m.skeleton === 'project-humanoid-v1', 'Humanoid manifest schema/id/status/skeleton')
  check(contracts.descriptors[id], 'No reviewed runtime descriptor for ' + id)
  contracts.validateHumanoid(m, contracts.descriptors[id])
  check(typeof m.attribution === 'string' && m.attribution.trim(), 'Missing attribution')
  read(root + '/ATTRIBUTION.md')
  check(m.source?.license && m.source?.licenseEvidence && digest(m.source.sourceSha256), 'Missing source/license evidence')
  json(localReference(root, m.source.licenseEvidence))
  const boneMap = json(localReference(root, m.boneMap)), audit = json(localReference(root, m.audit))
  check(boneMap.skeleton === m.skeleton && boneMap.sourceToProject && Object.keys(boneMap.sourceToProject).length && boneMap.sockets, 'Bone map schema')
  check(Array.isArray(audit.lods) && audit.lods.length === 3 && new Set(audit.lods.map(l => l.level)).size === 3, 'Audit LOD inventory')
  const bindings = m.animations?.embedded
  check(Array.isArray(bindings) && bindings.length && new Set(bindings.map(b => b.clip)).size === bindings.length, 'Animation bindings')
  for (const b of bindings) {
    check(typeof b.clip === 'string' && typeof b.loop === 'boolean' && Number.isFinite(b.duration) && b.duration > 0 &&
      Object.values(b.events ?? {}).every(v => Number.isFinite(v) && v >= 0 && v <= b.duration + 1e-5), 'Animation timing contract')
  }
  for (const [index, level] of ['lod0', 'lod1', 'lod2'].entries()) {
    const path = localReference(root, m.files?.[level]), bytes = read(path), sha = hash(bytes)
    check(digest(m.fileSha256?.[level]) && m.fileSha256[level] === sha, 'SHA256 mismatch: ' + path)
    const row = audit.lods.find(l => l.level === index)
    check(row && row.sha256 === sha && row.bytes === bytes.length, 'Audit SHA256/length mismatch: ' + path)
    const asset = parseGlb(bytes)
    const names = new Set((asset.document.nodes ?? []).map(n => n.name))
    const mapped = new Set(names)
    const mixamo = ['mixamo24', 'mixamo66'].includes(m.selectedSource?.rig)
    if (mixamo) for (const name of names) {
      const alias = contracts.aliases[name?.replace(/^mixamorig:?/, '')]
      if (alias) mapped.add(alias)
    }
    check(Object.entries(boneMap.sourceToProject).every(([source, target]) => target === null ? names.has(source) :
      mapped.has(target) && (names.has(target) || (names.has(source) && contracts.aliases[source.replace(/^mixamorig:?/, '')] === target))), 'Bone map references missing node')
    if (typeof boneMap.sockets === 'string') {
      check(mixamo && boneMap.sockets === 'Runtime-created by prepareSelectedHumanoidSource (src/world/SelectedHumanoidSource.ts) on the mapped bones.' &&
        Object.values(contracts.sockets).every(parent => mapped.has(parent)), 'Runtime socket contract')
    } else check(Object.entries(boneMap.sockets).every(([name, parent]) => names.has(name) && mapped.has(parent)), 'Authored socket contract')
    const actual = (asset.document.animations ?? []).map(a => a.name).sort()
    check(JSON.stringify(actual) === JSON.stringify(bindings.map(b => b.clip).sort()), 'Embedded animation inventory differs from manifest')
    check((m.bufferCompression === 'EXT_meshopt_compression') === (asset.document.extensionsUsed ?? []).includes('EXT_meshopt_compression'), 'Manifest/GLB compression differs')
    host.glbs.push(asset)
  }
  for (const extra of m.animations.supplemental ?? []) parseGlb(read(localReference(root, extra.file)))
}
function validateShields(ids, host, contracts, checked) {
  const file = SHIELD_ROOT + 'sources.json'
  checked.add(file); const records = JSON.parse(host.read(file).toString('utf8'))
  check(Array.isArray(records) && new Set(records.map(r => r.id)).size === records.length, 'Shield source inventory')
  checked.add(SHIELD_ROOT + 'ATTRIBUTION.md'); host.read(SHIELD_ROOT + 'ATTRIBUTION.md')
  const chosen = ids.some(id => !id.endsWith('.glb')) ? records : records.filter(r => ids.includes(r.publishedPath))
  check(chosen.length && ids.filter(id => id.endsWith('.glb')).every(id => chosen.some(r => r.publishedPath === id)), 'Unknown equipment asset')
  for (const row of chosen) {
    check(/^models\/weapons\/(?:faction-shields|high-tier|t5|byzantine)\/[a-z0-9-]+\.glb$/.test(row.publishedPath || ''), 'Unknown equipment path')
    const path = 'public/' + row.publishedPath
    check(contracts.shields[row.id] === row.publishedPath &&
      row.rightsEvidence && digest(row.sourceSha256) && digest(row.finalSha256), 'Shield loader/source/license contract')
    checked.add(path); const bytes = host.read(path), asset = parseGlb(bytes)
    check(hash(bytes) === row.finalSha256, 'SHA256 mismatch: ' + path)
    const embedded = asset.document.asset.extras?.factionEquipment
    check(embedded?.id === row.id, 'Embedded equipment identity')
    if (row.publishedPath.startsWith('models/weapons/faction-shields/')) check(
      JSON.stringify(embedded.collisionBands) === JSON.stringify(row.collisionBands) &&
      Array.isArray(row.collisionBands) && JSON.stringify(row.collisionBands) === JSON.stringify(contracts.colliders[row.id]), 'Shield generated runtime collision contract differs')
    host.glbs.push(asset)
  }
}
/** Mount package: ready manifest, published hash, required clips/LOD nodes, evidence JSON. */
function validateMount(root, host, checked) {
  const read = file => { checked.add(file); return host.read(file) }
  // Package KTX2 map: a textures/ file in this package with a KTX 2.0 header.
  const packageTexture = uri => {
    if (typeof uri !== 'string' || !/^textures\/[a-z0-9-]+\.ktx2$/.test(uri)) return false
    const bytes = read(root + '/' + uri)
    check(bytes.length > 12 && bytes.subarray(1, 7).toString('ascii') === 'KTX 20', 'Invalid KTX2 texture: ' + uri)
    return true
  }
  const m = JSON.parse(read(root + '/manifest.json').toString('utf8')), id = root.split('/').at(-1)
  check([1, 2].includes(m.schemaVersion) && m.status === 'ready' && m.forward === '+Z' && typeof m.id === 'string', 'Mount manifest schema/status/forward')
  if (m.schemaVersion === 1) {
    check(m.id.startsWith(id), 'Mount manifest id')
    check(m.source && digest(m.source.sourceSha256) && m.source.license, 'Missing mount source/license evidence')
  } else {
    // Schema 2 (HorseAssetRegistry): several licensed sources and external KTX2 body maps.
    check(Array.isArray(m.sources) && m.sources.length && m.sources.every(s => s.author && s.url && s.license && digest(s.sha256)), 'Missing mount source/license evidence')
    const maps = [...Object.values(m.sharedBodyMaps ?? {}), ...(m.variants ?? []).map(v => v.baseColor)]
    check(maps.length && Array.isArray(m.variants) && m.variants.length, 'Mount texture inventory')
    for (const map of new Set(maps)) check(packageTexture(map), 'External or non-KTX2 mount texture: ' + map)
  }
  const glb = localReference(root, m.file), bytes = read(glb)
  check(digest(m.sha256) && hash(bytes) === m.sha256, 'SHA256 mismatch: ' + glb)
  const asset = parseGlb(bytes, m.schemaVersion === 2 ? { externalImage: packageTexture } : {}), names = new Set((asset.document.nodes ?? []).map(n => n.name))
  const clips = new Set((asset.document.animations ?? []).map(a => a.name))
  check(Array.isArray(m.clips) && m.clips.every(c => clips.has(typeof c === 'string' ? c : c.name)), 'Mount clip inventory differs from manifest')
  const nodesOf = value => Array.isArray(value) ? value : Object.values(value ?? {})
  check(nodesOf(m.lodNodes).every(n => names.has(n)) && nodesOf(m.equipmentLodNodes).every(n => names.has(n)), 'Mount LOD node missing')
  read(root + '/CREDITS.md')
  // Package evidence (rig/animation/audit reports) must stay parseable, non-empty JSON.
  for (const name of ['audit.json', 'asset-report.json', 'animation-source.json', 'bone-map.json', 'rig-mapping.json']) {
    let text
    try { text = host.read(root + '/' + name) } catch { continue }
    checked.add(root + '/' + name)
    check(Object.keys(JSON.parse(text.toString('utf8'))).length, 'Empty mount evidence: ' + name)
  }
  host.glbs.push(asset)
}
/** Architecture ornaments: every sourced asset's published hash. */
function validateOrnaments(host, checked) {
  const root = 'public/models/architecture', read = file => { checked.add(file); return host.read(file) }
  // Banners (build-town-ornaments.py) and statues (build-architecture-statues.py) keep separate inventories.
  const inventory = file => JSON.parse(read(root + '/' + file).toString('utf8'))
  const rows = [...inventory('ornaments-sources.json'), ...inventory('statues-sources.json')]
  check(Array.isArray(rows) && rows.length && new Set(rows.map(r => r.asset)).size === rows.length, 'Ornament source inventory')
  // The human-readable rebuild notes must name every recorded source hash they describe.
  const notes = read(root + '/SOURCES.md').toString('utf8')
  for (const sha of notes.match(/\b[a-f0-9]{64}\b/g) ?? []) check(rows.some(r => r.sourceSha256 === sha), 'Ornament source note without inventory record: ' + sha)
  for (const row of rows) {
    check(digest(row.sourceSha256) && row.permission, 'Missing ornament source/permission record')
    const bytes = read(localReference(root, row.asset))
    check(digest(row.sha256) && hash(bytes) === row.sha256, 'SHA256 mismatch: ' + root + '/' + row.asset)
    host.glbs.push(parseGlb(bytes))
  }
}
/** Paladin and Maki bow: attribution plus a per-file final hash where the folder records one. */
function validateProvenanceWeapon(input, host, checked) {
  const root = input.asset.root, read = file => { checked.add(file); return host.read(file) }
  check(read(root + '/ATTRIBUTION.md').toString('utf8').trim(), 'Missing weapon attribution')
  // Runtime grip calibration (MakiRangerEquipment fetches it beside the GLB).
  let calibration = null
  try { calibration = host.read(root + '/attachment.json') } catch { /* folder has no runtime calibration */ }
  if (calibration) {
    checked.add(root + '/attachment.json')
    check(JSON.parse(calibration.toString('utf8')).id === root.split('/').at(-1), 'Weapon calibration identity: ' + root)
  }
  if (!input.file.endsWith('.glb')) return
  const bytes = read(input.file), name = input.file.split('/').at(-1).replace('.glb', '')
  const records = [root + '/' + name + '.json', root + '/source.json'].filter(file => { try { host.read(file); return true } catch { return false } })
  const finals = records.map(file => JSON.parse(read(file).toString('utf8'))).filter(r => digest(r.finalSha256))
  if (finals.length) check(finals.some(r => r.finalSha256 === hash(bytes)), 'Weapon final SHA256 mismatch: ' + input.file)
  else check(JSON.parse(read(root + '/sources.json').toString('utf8')).length, 'Missing weapon source inventory')
  host.glbs.push(parseGlb(bytes))
}
// Host injection lets contracts use tiny in-memory files, never shipped GLBs.
function validateAssets(inputs, host, contracts) {
  const checked = new Set(), roots = new Set(), shields = new Set(), weapons = new Set(), provenance = new Set()
  let ornaments = false
  host.glbs = []
  for (const input of inputs) {
    if (input.kind === 'asset') {
      if (input.asset.family === 'humanoid') roots.add(input.asset.root)
      else if (input.asset.family === 'weapon') weapons.add(input.file)
      else if (input.asset.family === 'shield') shields.add(input.asset.id)
      else if (input.asset.family === 'provenance-weapon') provenance.add(input.file)
      else if (input.asset.family === 'ornament') ornaments = true
    } else if (input.kind === 'retired') {
      contracts.validateRetired(input.file)
    } else if (input.kind === 'builder') {
      const spec = BUILDERS[input.file]
      check(spec, 'Unknown offline builder')
      contracts.validateBuilder(input.file)
      for (const output of spec.outputs) {
        // Parameterized producers have multiple historical outputs. When this
        // change ships output families, validate those and their dependencies;
        // do not reinterpret every untouched historical asset's audit schema.
        const changedOutputs = output.ids.filter(id => inputs.some(i => i.kind === 'asset' &&
          i.asset.family === output.family && (i.asset.id === id || i.file === 'public/' + id || i.asset.root.endsWith('/' + id))))
        for (const id of changedOutputs.length ? changedOutputs : output.ids) {
          if (output.family === 'humanoid') roots.add('public/models/characters/v2/' + id)
          else if (output.family === 'shield') shields.add(id)
          else if (output.family === 'weapon') weapons.add('public/' + id)
          else if (output.family === 'provenance-weapon') provenance.add('public/' + id)
          else if (output.family === 'ornament') ornaments = true
          else fail('Unknown builder output family: ' + output.family)
        }
      }
    }
  }
  for (const file of weapons) validateWeapon({ file }, host, contracts, checked)
  const mountRoots = new Set(inputs.filter(i => i.kind === 'asset' && i.asset.family === 'mount').map(i => i.asset.root))
  for (const root of mountRoots) validateMount(root, host, checked)
  if (ornaments) validateOrnaments(host, checked)
  for (const file of provenance) validateProvenanceWeapon({ file, asset: { root: file.slice(0, file.lastIndexOf('/')) } }, host, checked)
  for (const root of roots) validateHumanoid(root, host, contracts, checked)
  if (shields.size) validateShields([...shields], host, contracts, checked)
  for (const input of inputs.filter(i => i.kind === 'asset')) {
    if (!checked.has(input.file)) {
      // Additional audited metadata may be retained, but never arbitrary files.
      check(/(?:audit|animation-donor-manifest|blender-measurements|source-verification)\.json$/.test(input.file) || /-attribution\.txt$/.test(input.file), 'Unreferenced asset input: ' + input.file)
      const bytes = host.read(input.file)
      check(bytes.length > 0, 'Empty asset metadata')
      if (input.file.endsWith('.json')) check(Object.keys(JSON.parse(bytes.toString('utf8'))).length, 'Empty audit metadata')
      checked.add(input.file)
    }
  }
  return { result: 'passed', files: [...checked].sort(), families: roots.size + (shields.size ? 1 : 0) }
}
module.exports = { parseGlb, validateAssets, localReference, hash, runtimeManifestFields }
