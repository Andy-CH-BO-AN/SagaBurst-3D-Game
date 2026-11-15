/** Runtime GLB budget pass (see tools/data/runtime-glb-budget.json).
 *   node tools/apply-runtime-glb-budget.mjs [--dry-run] [--only=REGEX]
 * Per published GLB under public/models: UV-exact LOD reductions, texture caps and KTX2 encoding
 * (KHR_texture_basisu; ETC1S colour, UASTC linear/normal, full mip chains). Geometry, skin and
 * animation bytes of untouched primitives are preserved; meshopt inputs are re-packed byte-exactly.
 * Requires macOS `sips` (lossless PNG intermediate) and `basisu` (Basis Universal 2.x CLI).
 * Updates manifest/audit/sources hashes and writes tools/data/runtime-glb-budget-audit.json.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { openGlb } from './lib/glb-edit.mjs'
import { simplifyTriangles } from './lib/lod-simplify.mjs'

const ROOT = 'public', plan = JSON.parse(fs.readFileSync('tools/data/runtime-glb-budget.json', 'utf8'))
const AUDIT = 'tools/data/runtime-glb-budget-audit.json'
const args = process.argv.slice(2), dryRun = args.includes('--dry-run')
const only = new RegExp(args.find(a => a.startsWith('--only='))?.slice(7) ?? '.')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const KTX2_MIME = 'image/ktx2'

function publishedGlbs(dir = path.join(ROOT, 'models')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? publishedGlbs(full) : entry.name.endsWith('.glb') ? [full] : []
  })
}

function maxSizeFor(rel) {
  return plan.textures.rules.find(rule => new RegExp(rule.match).test(rel))?.maxSize ?? plan.textures.defaultMaxSize
}

/** normal > linear > color, by the strongest material slot that samples the image. */
function imageRoles(document) {
  const roles = new Map(), rank = { color: 0, linear: 1, normal: 2 }
  const mark = (info, role) => {
    if (info?.index === undefined) return
    const texture = document.textures[info.index]
    const image = texture.source ?? texture.extensions?.KHR_texture_basisu?.source
    if (image === undefined) return
    if (!roles.has(image) || rank[role] > rank[roles.get(image)]) roles.set(image, role)
  }
  for (const material of document.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {}
    mark(pbr.baseColorTexture, 'color'); mark(material.emissiveTexture, 'color')
    mark(pbr.metallicRoughnessTexture, 'linear'); mark(material.occlusionTexture, 'linear')
    mark(material.normalTexture, 'normal')
  }
  return roles
}

function dimensions(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
  return [Number(/pixelWidth: (\d+)/.exec(out)[1]), Number(/pixelHeight: (\d+)/.exec(out)[1])]
}

function encodeKtx2(bytes, mimeType, role, maxSize, work) {
  const source = path.join(work, `source.${mimeType === 'image/png' ? 'png' : 'jpg'}`), png = path.join(work, 'input.png'), out = path.join(work, 'out.ktx2')
  fs.writeFileSync(source, bytes)
  const [width, height] = dimensions(source)
  const resize = Math.max(width, height) > maxSize ? ['-Z', String(maxSize)] : []
  execFileSync('sips', ['-s', 'format', 'png', ...resize, source, '--out', png], { stdio: 'ignore' })
  const [w, h] = dimensions(png)
  if (w % 4 || h % 4) throw new Error(`Texture ${w}x${h} is not a multiple of 4`)
  execFileSync('basisu', [...plan.textures.encoding[role], '-ktx2', '-file', png, '-output_file', out], { stdio: 'ignore' })
  return { bytes: fs.readFileSync(out), from: [width, height], to: [w, h] }
}

function triangleCounts(edit) {
  return Object.fromEntries(edit.document.meshes.map(mesh => [mesh.name,
    mesh.primitives.reduce((sum, p) => sum + edit.document.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0)]))
}

async function processGlb(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const before = fs.readFileSync(file), edit = await openGlb(file)
  const record = { file: rel, beforeSha256: sha(before), beforeBytes: before.length, trianglesBefore: triangleCounts(edit), lod: [], textures: [] }
  // A mesh is reduced once; the audit's LOD history makes reruns idempotent.
  const audited = fs.existsSync(AUDIT) ? JSON.parse(fs.readFileSync(AUDIT, 'utf8')).files.find(r => r.file === rel) : undefined
  for (const rule of plan.lod.filter(rule => rule.file === rel)) {
    for (const [meshIndex, mesh] of edit.document.meshes.entries()) {
      if (!new RegExp(rule.mesh).test(mesh.name ?? '') || audited?.lod?.some(entry => entry.mesh === mesh.name)) continue
      for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
        if (primitive.indices === undefined) throw new Error(`${rel}: LOD reduction needs indexed triangles`)
        const indices = edit.readIndices(primitive.indices), positions = edit.readFloats(primitive.attributes.POSITION)
        const reduced = await simplifyTriangles({ indices, positions, targetTriangles: rule.targetTriangles, maxError: rule.maxError })
        if (reduced.indices.length >= indices.length) continue
        edit.replaceTriangles(meshIndex, primitiveIndex, reduced.indices)
        record.lod.push({ mesh: mesh.name, from: indices.length / 3, to: reduced.indices.length / 3, relativeError: Number(reduced.error.toFixed(5)) })
      }
    }
  }
  const roles = imageRoles(edit.document), maxSize = maxSizeFor(rel)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-budget-'))
  try {
    for (const [index, image] of (edit.document.images ?? []).entries()) {
      if (image.mimeType === KTX2_MIME || !roles.has(index)) continue
      const role = roles.get(index), encoded = encodeKtx2(edit.imageBytes(index), image.mimeType, role, maxSize, work)
      record.textures.push({ image: index, role, from: `${encoded.from.join('x')} ${image.mimeType}`, to: `${encoded.to.join('x')} ${KTX2_MIME}`,
        bytesBefore: edit.imageBytes(index).length, bytesAfter: encoded.bytes.length })
      edit.replaceImage(index, encoded.bytes, KTX2_MIME)
      edit.useBasisu(index)
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
  if (!record.lod.length && !record.textures.length) return null
  const bytes = await edit.encode()
  Object.assign(record, { afterSha256: sha(bytes), afterBytes: bytes.length, trianglesAfter: triangleCounts(edit),
    textureMaxSize: Math.max(0, ...record.textures.map(t => Math.max(...t.to.split(' ')[0].split('x').map(Number)))) })
  if (!dryRun) fs.writeFileSync(file, bytes)
  return record
}

const writeJson = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n')
const BUDGET_NOTE = 'Runtime budget pass: KTX2 (KHR_texture_basisu) textures within the runtime size cap; see tools/data/runtime-glb-budget-audit.json'

/** Authoritative published-hash records only; historical build evidence stays as written. */
function updateRecords(record) {
  const file = path.join(ROOT, record.file)
  updateManifest(record, path.dirname(file), path.basename(file))
  updateFolderInventories(record, path.dirname(file), path.basename(file))
  if (file.startsWith(path.join(ROOT, 'models', 'weapons'))) updateWeaponInventories(record)
}

function updateManifest(record, dir, base) {
  const manifestPath = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const level = Object.entries(m.files ?? {}).find(([, name]) => name === base)?.[0]
  if (level) {
    // Humanoid manifests: CI admits only fileSha256/audit as non-runtime fields, so metrics stay as
    // built; current triangle/texture figures live in the audit row and the budget audit.
    if (m.fileSha256?.[level] !== undefined) m.fileSha256[level] = record.afterSha256
    if (m.audit) {
      const auditPath = path.join(dir, m.audit), audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'))
      const row = audit.lods?.find(l => l.level === Number(level.slice(3)))
      if (row) {
        row.sha256 = record.afterSha256; row.bytes = record.afterBytes
        row.runtimeBudget = { triangles: Object.values(record.trianglesAfter).reduce((a, b) => a + b, 0),
          ...(record.textureMaxSize ? { textureMaxSize: record.textureMaxSize } : {}),
          ...(record.textures.length ? { textureEncoding: 'KTX2 (KHR_texture_basisu)' } : {}), audit: 'tools/data/runtime-glb-budget-audit.json' }
      }
      writeJson(auditPath, audit)
    }
  } else if (m.file === base) {
    // Mount manifests (not CI-classified; metrics are informational): hash, size and measured counts.
    if (m.sha256 !== undefined) m.sha256 = record.afterSha256
    if (m.metrics?.packageBytes !== undefined) m.metrics.packageBytes = record.afterBytes
    if (m.metrics?.textureMaxSize !== undefined && record.textureMaxSize) m.metrics.textureMaxSize = record.textureMaxSize
    for (const [mesh, count] of Object.entries(record.trianglesAfter)) if (m.metrics?.triangles?.[mesh] !== undefined) m.metrics.triangles[mesh] = count
    const lodNodes = m.lodNodes ?? [], equipment = m.equipmentLodNodes ?? []
    for (const key of ['visibleEquippedTriangles', 'residentTrianglesByLod']) {
      if (Array.isArray(m.metrics?.[key]) && lodNodes.length) m.metrics[key] = lodNodes.map((node, i) =>
        (record.trianglesAfter[node] ?? 0) + (record.trianglesAfter[equipment[i]] ?? 0))
    }
    if (Array.isArray(m.modifications) && !m.modifications.includes(BUDGET_NOTE)) m.modifications.push(BUDGET_NOTE)
  } else return
  writeJson(manifestPath, m)
}

/** Ornament sources and bow/axe provenance: objects naming this asset or holding its current hash. */
function updateFolderInventories(record, dir, base) {
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json') && n !== 'manifest.json' && n !== 'sources.json')) {
    const jsonPath = path.join(dir, name), text = fs.readFileSync(jsonPath, 'utf8')
    if (!text.includes(record.beforeSha256) && !text.includes(base)) continue
    const value = JSON.parse(text)
    let changed = false
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      let names = Object.values(node).some(v => typeof v === 'string' && (v === base || v.endsWith('/' + base)))
      for (const key of ['sha256', 'finalSha256', 'publishedSha256']) {
        if (node[key] === record.beforeSha256) { node[key] = record.afterSha256; changed = names = true }
      }
      if (names && node.bytes === record.beforeBytes) { node.bytes = record.afterBytes; changed = true }
      if (names && typeof node.geometryPolicy === 'string' && !node.geometryPolicy.includes('KTX2')) {
        node.geometryPolicy += ' Runtime budget pass later re-encoded embedded textures as KTX2 (tools/data/runtime-glb-budget-audit.json).'
        changed = true
      }
      Object.values(node).forEach(visit)
    }
    visit(value)
    if (changed) writeJson(jsonPath, value)
  }
}

/** Weapon/shield sources.json rows match by publishedPath, weapon name within its folder, or final.path. */
function updateWeaponInventories(record) {
  const weaponsRoot = path.join(ROOT, 'models', 'weapons')
  for (const family of fs.readdirSync(weaponsRoot)) {
    const sources = path.join(weaponsRoot, family, 'sources.json')
    if (!fs.existsSync(sources)) continue
    const rows = JSON.parse(fs.readFileSync(sources, 'utf8'))
    if (!Array.isArray(rows)) continue
    let changed = false
    for (const row of rows) {
      const matches = row.publishedPath === record.file || row.final?.path === record.file
        || (row.weapon && `models/weapons/${family}/${row.weapon}.glb` === record.file)
      if (!matches) continue
      if (row.finalSha256 !== undefined) row.finalSha256 = record.afterSha256
      else row.final = { ...row.final, sha256: record.afterSha256, bytes: record.afterBytes, ...(row.final?.byteIdenticalToSource ? { byteIdenticalToSource: false } : {}) }
      changed = true
    }
    if (changed) writeJson(sources, rows)
  }
}

const skip = new Set(plan.skip)
const files = publishedGlbs().filter(file => {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  return only.test(rel) && !skip.has(rel)
})
function writeAudit(record) {
  const previous = fs.existsSync(AUDIT) ? JSON.parse(fs.readFileSync(AUDIT, 'utf8')).files : []
  const merged = new Map(previous.map(r => [r.file, r]))
  const prior = merged.get(record.file)
  merged.set(record.file, { ...record, beforeSha256: prior?.beforeSha256 ?? record.beforeSha256, beforeBytes: prior?.beforeBytes ?? record.beforeBytes,
    trianglesBefore: prior?.trianglesBefore ?? record.trianglesBefore, lod: [...(prior?.lod ?? []), ...record.lod], textures: [...(prior?.textures ?? []), ...record.textures] })
  fs.writeFileSync(AUDIT, JSON.stringify({ schemaVersion: 1, tool: 'tools/apply-runtime-glb-budget.mjs', basisu: BASISU_VERSION,
    files: [...merged.values()].sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n')
}

// basisu is internally multithreaded; files run one at a time. Each GLB, its records and its audit
// row are written together, so an interrupted run never leaves a published file without its hashes.
const BASISU_VERSION = execFileSync('basisu', ['-version'], { encoding: 'utf8' }).split('\n')[0].trim()
for (const file of files) {
  const record = await processGlb(file)
  if (!record) { console.log('unchanged', file); continue }
  if (!dryRun) { updateRecords(record); writeAudit(record) }
  console.log(JSON.stringify({ file: record.file, mb: [record.beforeBytes, record.afterBytes].map(b => (b / 1048576).toFixed(2)), lod: record.lod, textures: record.textures.length }))
}
