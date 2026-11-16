/** Bring older humanoid packages' records to the CI humanoid asset schema without new claims.
 *   node tools/normalize-humanoid-records.mjs ID [ID...]
 * Everything written is derived from the package's existing manifest/evidence and its shipped GLBs:
 * - ATTRIBUTION.md (if missing): the manifest's own attribution and source fields, plus evidence links.
 * - attribution-evidence.json (if missing): the manifest source record and SHA-256 of existing evidence files.
 *   manifest.source.licenseEvidence points at it when the previous target was not JSON.
 * - bone-map.json: adds skeleton/sourceToProject/sockets from the GLB joints and sockets; existing keys are kept.
 *   Selected Mixamo rigs map through MIXAMO_ALIASES and keep runtime-created sockets.
 * - lod-publication-audit.json: level, SHA-256, bytes and triangles of each shipped LOD; manifest.audit points at it.
 * Only CI-static manifest fields change (source, attribution, boneMap, audit).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { readGlb } from './lib/humanoid-glb.mjs'

const ROOT = 'public/models/characters/v2'
const SKELETON = 'project-humanoid-v1'
const RUNTIME_SOCKETS = 'Runtime-created by prepareSelectedHumanoidSource (src/world/SelectedHumanoidSource.ts) on the mapped bones.'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

function mixamoAliases() {
  const file = 'src/world/SelectedHumanoidSource.ts', source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let aliases
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'MIXAMO_ALIASES') {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
      aliases = Object.fromEntries(init.properties.map(p => [p.name.text ?? p.name.getText(source), p.initializer.text]))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!aliases) throw new Error('MIXAMO_ALIASES not found')
  return aliases
}

function triangles(document) {
  return (document.meshes ?? []).reduce((sum, mesh) => sum + mesh.primitives.reduce((s, p) =>
    s + document.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0)
}

const aliases = mixamoAliases()
for (const id of process.argv.slice(2)) {
  const root = path.join(ROOT, id), manifestPath = path.join(root, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const lod0 = readGlb(path.join(root, m.files.lod0)).document
  const mixamo = ['mixamo24', 'mixamo66'].includes(m.selectedSource?.rig)
  const changes = []

  // Licence evidence must be a JSON record.
  const isJson = file => { try { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); return true } catch { return false } }
  if (!m.source.licenseEvidence || !isJson(m.source.licenseEvidence)) {
    const evidencePath = path.join(root, 'attribution-evidence.json')
    if (!fs.existsSync(evidencePath)) {
      const files = fs.readdirSync(root).filter(f => /^(ATTRIBUTION\.md|.*attribution.*\.txt|source-readme\.txt|source-license\.txt|source-verification\.json)$/.test(f))
      writeJson(evidencePath, { schemaVersion: 1, purpose: 'Index of this package\'s existing source and licence evidence; no new claims.',
        source: m.source, attribution: m.attribution, evidenceFiles: files.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })) })
      changes.push('attribution-evidence.json')
    }
    m.source = { ...m.source, licenseEvidence: 'attribution-evidence.json' }
    changes.push('source.licenseEvidence')
  }

  if (!fs.existsSync(path.join(root, 'ATTRIBUTION.md'))) {
    const src = m.source, line = (k, v) => v ? `- ${k}: ${v}\n` : ''
    const extras = fs.readdirSync(root).filter(f => /attribution.*\.txt$|source-readme\.txt|source-license\.txt|attribution-evidence\.json/.test(f))
    fs.writeFileSync(path.join(root, 'ATTRIBUTION.md'), `# ${src.title ?? id} credits\n\n${m.attribution}\n\n## Source\n\n` +
      line('Archive', src.sourceArchive) + line('File', src.sourceFile ?? src.sourceEntry) + line('Author', src.author) +
      line('SHA-256', src.sourceSha256) + line('Licence / permission', src.license) + line('Licence URL', src.licenseUrl) +
      `\n## Evidence\n\n${extras.map(f => `- \`${f}\``).join('\n')}\n\nGenerated from this package's manifest and existing evidence by tools/normalize-humanoid-records.mjs.\n`)
    changes.push('ATTRIBUTION.md')
  }

  // Bone map: GLB joints and authored sockets.
  const nodes = lod0.nodes ?? [], names = new Set(nodes.map(n => n.name))
  const parentOf = new Map()
  nodes.forEach((node, i) => (node.children ?? []).forEach(child => parentOf.set(child, i)))
  const joints = [...new Set((lod0.skins ?? []).flatMap(skin => skin.joints))].map(i => nodes[i].name)
  const bonePath = path.join(root, m.boneMap ?? 'bone-map.json')
  const boneMap = fs.existsSync(bonePath) ? JSON.parse(fs.readFileSync(bonePath, 'utf8')) : {}
  const looksLikeFlatMap = Object.keys(boneMap).length && Object.values(boneMap).every(v => typeof v === 'string') && !boneMap.skeleton
  let sourceToProject = boneMap.sourceToProject
  if (!sourceToProject || !Object.keys(sourceToProject).length) {
    sourceToProject = looksLikeFlatMap ? boneMap : mixamo
      ? Object.fromEntries(joints.flatMap(name => { const alias = aliases[name.replace(/^mixamorig:?/, '')]; return alias ? [[name, alias]] : [] }))
      : Object.fromEntries(joints.map(name => [name, name]))
  }
  // Keep only entries the shipped rig can satisfy (CI checks each one against the GLB).
  sourceToProject = Object.fromEntries(Object.entries(sourceToProject).filter(([source, target]) => target === null ? names.has(source)
    : names.has(target) || (mixamo && names.has(source) && aliases[source.replace(/^mixamorig:?/, '')] === target)))
  let sockets = boneMap.sockets
  if (!sockets || (typeof sockets === 'object' && !Object.keys(sockets).length)) {
    sockets = mixamo ? RUNTIME_SOCKETS : Object.fromEntries(nodes.flatMap((node, i) =>
      /^(socket_|sole_)/.test(node.name ?? '') && parentOf.has(i) ? [[node.name, nodes[parentOf.get(i)].name]] : []))
  }
  const nextBoneMap = looksLikeFlatMap ? { skeleton: SKELETON, sourceToProject, sockets }
    : { ...boneMap, skeleton: SKELETON, sourceToProject, sockets }
  if (JSON.stringify(nextBoneMap) !== JSON.stringify(boneMap)) {
    writeJson(bonePath, nextBoneMap)
    m.boneMap = path.basename(bonePath)
    changes.push('bone-map.json')
  }

  // LOD publication audit: facts of the shipped files.
  const audit = { schemaVersion: 1, purpose: 'Shipped LOD identity for CI; build history stays in the package\'s other audits.',
    lods: ['lod0', 'lod1', 'lod2'].map((level, index) => {
      const bytes = fs.readFileSync(path.join(root, m.files[level])), document = readGlb(path.join(root, m.files[level])).document
      return { level: index, file: m.files[level], sha256: sha(bytes), bytes: bytes.length, triangles: triangles(document),
        textureEncoding: (document.images ?? []).every(img => img.mimeType === 'image/ktx2') ? 'KTX2 (KHR_texture_basisu)' : [...new Set((document.images ?? []).map(img => img.mimeType))].join(', ') }
    }) }
  const currentAudit = m.audit && isJson(m.audit) ? JSON.parse(fs.readFileSync(path.join(root, m.audit), 'utf8')) : null
  const auditOk = currentAudit?.lods?.length === 3 && audit.lods.every(row => currentAudit.lods.some(r => r.level === row.level && r.sha256 === row.sha256 && r.bytes === row.bytes))
  if (!auditOk) {
    writeJson(path.join(root, 'lod-publication-audit.json'), audit)
    m.audit = 'lod-publication-audit.json'
    changes.push('lod-publication-audit.json')
  }
  writeJson(manifestPath, m)
  console.log(id, changes.join(', ') || 'unchanged')
}
