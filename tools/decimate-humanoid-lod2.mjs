/** Decimate the 8 >=6,000-tri humanoid lod2.glb assets in Blender while keeping
 * existing skeletons, sockets, animations, KTX2 textures, and EXT_meshopt_compression.
 *   node tools/decimate-humanoid-lod2.mjs [--dry-run] [--only=ID]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { openGlb } from './lib/glb-edit.mjs'
import { simplifyWelded, weightedVertices } from './lib/lod-simplify.mjs'

const BLENDER = process.env.BLENDER_PATH || '/opt/homebrew/bin/blender'
const PY_SCRIPT = 'tools/blender/decimate_lod2_primitive.py'
const WORK_DIR = 'output/local-diagnostics/lod2-work'
const BUDGET_PATH = 'tools/data/runtime-glb-budget.json'
const AUDIT_PATH = 'tools/data/runtime-glb-budget-audit.json'
const TARGETS = [
  { id: 'roman-t1', targetTriangles: 2400 },
  { id: 'roman-t2', targetTriangles: 2400 },
  { id: 'viking-t1', targetTriangles: 2500 },
  { id: 'viking-t2', targetTriangles: 2400 },
  { id: 'roman-hero-t5', targetTriangles: 2500 },
  { id: 'byzantine-cataphract-t5', targetTriangles: 2500 },
  { id: 'viking-heavy-hero-t4', targetTriangles: 2400 },
  { id: 'viking-heavy-hero-t5', targetTriangles: 2400 },
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyFilter = args.find(a => a.startsWith('--only='))?.slice(7)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

function appendFloatAccessor(edit, values, type, trackBounds = false) {
  const f32 = Float32Array.from(values)
  const view = edit.appendView(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength), 34962)
  const accessor = { bufferView: view, componentType: 5126, count: values.length / (type === 'VEC2' ? 2 : type === 'VEC4' ? 4 : 3), type }
  if (trackBounds && type === 'VEC3') {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < values.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = values[i + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
    accessor.min = min
    accessor.max = max
  }
  edit.document.accessors.push(accessor)
  return edit.document.accessors.length - 1
}

function appendJointAccessor(edit, values) {
  const maxJoint = values.reduce((m, v) => Math.max(m, v), 0)
  const useByte = maxJoint <= 255
  const typed = useByte ? Uint8Array.from(values) : Uint16Array.from(values)
  const view = edit.appendView(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), 34962)
  edit.document.accessors.push({ bufferView: view, componentType: useByte ? 5121 : 5123, count: values.length / 4, type: 'VEC4' })
  return edit.document.accessors.length - 1
}

function appendIndexAccessor(edit, values, vertexCount) {
  const wide = vertexCount > 65535
  const typed = wide ? Uint32Array.from(values) : Uint16Array.from(values)
  const view = edit.appendView(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), 34963)
  edit.document.accessors.push({ bufferView: view, componentType: wide ? 5125 : 5123, count: values.length, type: 'SCALAR' })
  return edit.document.accessors.length - 1
}

function updateRecords({ id, rel, glbPath, beforeSha, afterSha, beforeBytes, afterBytes, meshName, beforeTris, afterTris }) {
  const dir = path.dirname(glbPath)
  const manifestPath = path.join(dir, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (m.fileSha256?.lod2 !== undefined) m.fileSha256.lod2 = afterSha
  writeJson(manifestPath, m)

  if (m.audit) {
    const auditPath = path.join(dir, m.audit)
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'))
    const row = audit.lods?.find(l => l.level === 2)
    if (row) {
      row.sha256 = afterSha
      row.bytes = afterBytes
      row.runtimeBudget = {
        ...row.runtimeBudget,
        triangles: afterTris,
        audit: 'tools/data/runtime-glb-budget-audit.json',
      }
      writeJson(auditPath, audit)
    }
  }

  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json') && n !== 'manifest.json' && n !== 'sources.json')) {
    const jsonPath = path.join(dir, name)
    const text = fs.readFileSync(jsonPath, 'utf8')
    if (!text.includes(beforeSha) && !text.includes('lod2.glb')) continue
    const value = JSON.parse(text)
    let changed = false
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      let namesLod2 = Object.values(node).some(v => typeof v === 'string' && (v === 'lod2.glb' || v.endsWith('/lod2.glb')))
      for (const key of ['sha256', 'finalSha256', 'publishedSha256']) {
        if (node[key] === beforeSha) { node[key] = afterSha; changed = namesLod2 = true }
      }
      if (namesLod2 && node.bytes === beforeBytes) { node.bytes = afterBytes; changed = true }
      Object.values(node).forEach(visit)
    }
    visit(value)
    if (changed) writeJson(jsonPath, value)
  }

  const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'))
  const rule = budget.lod.find(r => r.file === rel)
  if (rule) rule.targetTriangles = Math.min(rule.targetTriangles, Math.max(2400, afterTris))
  else budget.lod.push({ file: rel, mesh: '.', targetTriangles: Math.max(2400, afterTris), maxError: 0.03 })
  writeJson(BUDGET_PATH, budget)

  const auditFile = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'))
  const existing = auditFile.files.find(r => r.file === rel)
  const lodEntry = { mesh: meshName, from: beforeTris, to: afterTris, blenderDecimate: true }
  if (existing) {
    existing.afterSha256 = afterSha
    existing.afterBytes = afterBytes
    existing.trianglesAfter = { [meshName]: afterTris }
    existing.lod = [...(existing.lod ?? []), lodEntry]
  } else {
    auditFile.files.push({
      file: rel,
      beforeSha256: beforeSha,
      beforeBytes,
      trianglesBefore: { [meshName]: beforeTris },
      lod: [lodEntry],
      textures: [],
      afterSha256: afterSha,
      afterBytes,
      trianglesAfter: { [meshName]: afterTris },
    })
    auditFile.files.sort((a, b) => a.file.localeCompare(b.file))
  }
  writeJson(AUDIT_PATH, auditFile)
}

fs.mkdirSync(WORK_DIR, { recursive: true })

for (const target of TARGETS) {
  if (onlyFilter && target.id !== onlyFilter) continue
  const rel = `models/characters/v2/${target.id}/lod2.glb`
  const glbPath = path.join('public', rel)
  const beforeBytesBuf = fs.readFileSync(glbPath)
  const beforeSha = sha(beforeBytesBuf)
  const edit = await openGlb(glbPath)
  if (edit.document.meshes.length !== 1 || edit.document.meshes[0].primitives.length !== 1) {
    throw new Error(`${target.id}: expected 1 mesh / 1 primitive`)
  }
  const mesh = edit.document.meshes[0]
  const prim = mesh.primitives[0]
  const skin = edit.document.skins[0]
  const positions = Array.from(edit.readFloats(prim.attributes.POSITION))
  const normals = Array.from(edit.readFloats(prim.attributes.NORMAL))
  const uvs = Array.from(edit.readFloats(prim.attributes.TEXCOORD_0))
  const indices = Array.from(edit.readIndices(prim.indices))
  const jointSets = Object.keys(prim.attributes).filter(k => k.startsWith('JOINTS_')).length
  const vertCount = positions.length / 3
  const flatJoints = new Array(vertCount * jointSets * 4).fill(0)
  const flatWeights = new Array(vertCount * jointSets * 4).fill(0)
  for (let s = 0; s < jointSets; s++) {
    const j = edit.readNumbers(prim.attributes[`JOINTS_${s}`])
    const w = edit.readNumbers(prim.attributes[`WEIGHTS_${s}`])
    for (let v = 0; v < vertCount; v++) {
      for (let k = 0; k < 4; k++) {
        flatJoints[v * jointSets * 4 + s * 4 + k] = Math.round(j[v * 4 + k])
        flatWeights[v * jointSets * 4 + s * 4 + k] = w[v * 4 + k]
      }
    }
  }
  // Protect authored distal left/right hand grip contacts on assets with few hand verts,
  // preserving bow contact calibration without pinning thousands of coarse body tris.
  const handPattern = /thumb|index|middle|ring|pinky|hand_l/i
  const protectFlags = Array.from(weightedVertices(edit, prim, skin, handPattern, 0.35))

  const inJson = path.join(WORK_DIR, `${target.id}-in.json`)
  const outJson = path.join(WORK_DIR, `${target.id}-out.json`)
  fs.writeFileSync(inJson, JSON.stringify({
    positions,
    normals,
    uvs,
    indices,
    joints: flatJoints,
    weights: flatWeights,
    jointSets,
    protectMask: protectFlags,
    targetTriangles: target.targetTriangles,
    computeTangents: prim.attributes.TANGENT !== undefined,
  }))

  const stdout = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', PY_SCRIPT, '--', inJson, outJson], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  const line = stdout.split('\n').find(l => l.startsWith('DECIMATED')) ?? stdout.trim()
  const out = JSON.parse(fs.readFileSync(outJson, 'utf8'))
  let finalTris = out.afterTris
  let modeNote = line

  if (out.afterTris > target.targetTriangles * 1.35) {
    const rawIndices = edit.readIndices(prim.indices)
    const rawPositions = edit.readFloats(prim.attributes.POSITION)
    const welded = await simplifyWelded({
      indices: rawIndices,
      positions: rawPositions,
      protectedVertex: v => protectFlags[v] === 1,
      targetTriangles: target.targetTriangles,
      maxError: 0.08,
      lockBorder: false,
    })
    const stats = edit.replaceTriangles(0, 0, welded.indices)
    finalTris = stats.triangles
    modeNote = `WELDED_FALLBACK ${out.beforeTris} -> ${finalTris} tris (err=${welded.error.toFixed(4)})`
  } else {
    const attrs = {
      POSITION: appendFloatAccessor(edit, out.positions, 'VEC3', true),
      NORMAL: appendFloatAccessor(edit, out.normals, 'VEC3', false),
      TEXCOORD_0: appendFloatAccessor(edit, out.uvs, 'VEC2', false),
    }
    if (out.tangents) attrs.TANGENT = appendFloatAccessor(edit, out.tangents, 'VEC4', false)

    const outV = out.vertexCount
    const maxInf = jointSets * 4
    for (let s = 0; s < jointSets; s++) {
      const jSlice = []
      const wSlice = []
      for (let v = 0; v < outV; v++) {
        for (let k = 0; k < 4; k++) {
          jSlice.push(out.joints[v * maxInf + s * 4 + k])
          wSlice.push(out.weights[v * maxInf + s * 4 + k])
        }
      }
      attrs[`JOINTS_${s}`] = appendJointAccessor(edit, jSlice)
      attrs[`WEIGHTS_${s}`] = appendFloatAccessor(edit, wSlice, 'VEC4', false)
    }

    prim.attributes = attrs
    prim.indices = appendIndexAccessor(edit, out.indices, outV)
  }

  const afterBytesBuf = dryRun ? await edit.encode() : await edit.write(glbPath)
  const afterSha = sha(afterBytesBuf)
  console.log(target.id, modeNote, `bytes: ${beforeBytesBuf.length} -> ${afterBytesBuf.length}`, dryRun ? '(dry-run)' : 'SAVED')

  if (!dryRun) {
    updateRecords({
      id: target.id,
      rel,
      glbPath,
      beforeSha,
      afterSha,
      beforeBytes: beforeBytesBuf.length,
      afterBytes: afterBytesBuf.length,
      meshName: mesh.name ?? 'Mesh_0',
      beforeTris: out.beforeTris,
      afterTris: finalTris,
    })
  }
}
