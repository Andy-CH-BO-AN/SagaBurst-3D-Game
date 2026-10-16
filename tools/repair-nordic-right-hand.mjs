/** Apply the reviewed Nordic right-hand repair after animation baking.
 * node tools/repair-nordic-right-hand.mjs INPUT_ROOT OUTPUT_ROOT
 * Writes an isolated, uncompressed corrected checkpoint. Then run the existing
 * lossless texture and buffer packers, and publication equality verification.
 * The input is never modified; geometry, left hand and animation bytes stay exact.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { readGlb, loadRig, encodeGlb } from './lib/humanoid-glb.mjs'
import { decodeMeshoptGlb } from './lib/meshopt-glb.mjs'

const calibration = JSON.parse(fs.readFileSync(new URL('./data/faction-nordic-right-hand.json', import.meta.url)))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const viewBytes = (asset, index) => {
  const view = asset.document.bufferViews[index]
  return asset.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
}
function geometryDigest(asset) {
  const primitive = asset.document.meshes[0].primitives[0], hash = createHash('sha256')
  for (const index of ['POSITION', 'NORMAL', 'TEXCOORD_0'].map(name => primitive.attributes[name]).concat(primitive.indices)) {
    hash.update(viewBytes(asset, asset.document.accessors[index].bufferView))
  }
  return hash.digest('hex')
}
function accessorLayout(asset, index) {
  const accessor = asset.document.accessors[index], view = asset.document.bufferViews[accessor.bufferView]
  const size = { 5121: 1, 5123: 2, 5126: 4 }[accessor.componentType]
  const components = { VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type]
  if (!size || !components) throw Error('Unsupported calibrated accessor')
  return { ...accessor, base: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride: view.byteStride ?? size * components, size, components }
}

export async function repairNordicRightHand(input, level) {
  const original = await decodeMeshoptGlb(input), spec = calibration.lods.find(row => row.level === level)
  if (!spec || geometryDigest(original) !== spec.geometrySha256) throw Error(`LOD${level}: source geometry differs from reviewed hand mask`)
  const candidate = { document: structuredClone(original.document), binary: Buffer.from(original.binary) }
  const document = candidate.document, affected = new Set(Object.keys(calibration.jointTargetsHandLocal))
  for (const name of affected) {
    const node = document.nodes.find(node => node.name === name)
    if (JSON.stringify(node) !== JSON.stringify(calibration.originalNodes[name])) throw Error(`${name}: expected original bind; refusing double repair or an unreviewed rig`)
  }
  for (const animation of document.animations ?? []) for (const channel of animation.channels) {
    if (affected.has(document.nodes[channel.target.node]?.name) && channel.target.path !== 'rotation') throw Error('Digit animation overrides the repaired bind translation')
  }
  const rig = await loadRig(original)
  rig.scene.updateMatrixWorld(true)
  const hand = rig.scene.getObjectByName('hand_r'), inverseHand = hand.matrixWorld.clone().invert()
  const meshes = []; rig.scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object) })
  if (meshes.length !== 1) throw Error('Expected one source surface')
  const mesh = meshes[0]
  if (mesh.geometry.attributes.position.count !== spec.vertexCount) throw Error('Reviewed vertex inventory differs')
  const rest = Array.from({ length: spec.vertexCount }, (_, index) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))
  const allowed = new Uint8Array(candidate.binary.length), mark = (start, bytes) => allowed.fill(1, start, start + bytes)
  const originalJoints = Object.fromEntries([...affected].map(name => [name, rig.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseHand).toArray()]))
  const joints = []
  for (const [name, target] of Object.entries(calibration.jointTargetsHandLocal)) {
    const bone = rig.scene.getObjectByName(name)
    bone.position.copy(bone.parent.worldToLocal(new THREE.Vector3(...target).applyMatrix4(hand.matrixWorld)))
    bone.updateMatrixWorld(true)
    const nodeIndex = document.nodes.findIndex(node => node.name === name)
    document.nodes[nodeIndex].translation = bone.position.toArray()
    const skin = document.skins.find(skin => skin.joints.includes(nodeIndex)), index = skin.joints.indexOf(nodeIndex)
    const layout = accessorLayout(candidate, skin.inverseBindMatrices), offset = layout.base + index * layout.stride
    const inverse = bone.matrixWorld.clone().invert()
    for (let component = 0; component < 16; component++) candidate.binary.writeFloatLE(inverse.elements[component], offset + component * 4)
    mark(offset, 64)
    joints.push({ name, beforeHandLocal: originalJoints[name], afterHandLocal: target })
  }
  const attributes = document.meshes[0].primitives[0].attributes
  const indices = accessorLayout(candidate, attributes.JOINTS_0), weights = accessorLayout(candidate, attributes.WEIGHTS_0)
  const boneNames = mesh.skeleton.bones.map(bone => bone.name)
  for (const row of spec.mask) {
    if (rest[row.i].clone().applyMatrix4(inverseHand).distanceTo(new THREE.Vector3(...row.p)) > 1e-6) throw Error(`LOD${level} vertex ${row.i}: source point differs`)
    const ranked = Object.entries(row.weights).filter(([, weight]) => weight > 1e-9).sort((a, b) => b[1] - a[1])
    if (ranked.length > 4 || ranked.some(([name]) => !boneNames.includes(name))) throw Error('Invalid reviewed influence set')
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0)
    if (Math.abs(total - 1) > 1e-5) throw Error('Unnormalized reviewed weights')
    while (ranked.length < 4) ranked.push(['hand_r', 0])
    for (let component = 0; component < 4; component++) {
      candidate.binary[indices.size === 1 ? 'writeUInt8' : 'writeUInt16LE'](boneNames.indexOf(ranked[component][0]), indices.base + row.i * indices.stride + component * indices.size)
      candidate.binary.writeFloatLE(ranked[component][1] / total, weights.base + row.i * weights.stride + component * 4)
    }
    mark(indices.base + row.i * indices.stride, indices.size * 4)
    mark(weights.base + row.i * weights.stride, 16)
  }
  for (let offset = 0; offset < original.binary.length; offset++) {
    if (original.binary[offset] !== candidate.binary[offset] && !allowed[offset]) throw Error(`Unexpected byte change at ${offset}`)
  }
  for (const animation of document.animations ?? []) for (const sampler of animation.samplers) {
    for (const index of [sampler.input, sampler.output]) {
      const view = document.accessors[index].bufferView
      if (!viewBytes(original, view).equals(viewBytes(candidate, view))) throw Error('Animation stream changed')
    }
  }
  const comparison = structuredClone(document)
  for (const node of comparison.nodes) if (affected.has(node.name)) node.translation = calibration.originalNodes[node.name].translation
  if (JSON.stringify(comparison) !== JSON.stringify(original.document)) throw Error('Unexpected document change')
  const restored = await loadRig(candidate); restored.scene.updateMatrixWorld(true)
  let restoredMesh; restored.scene.traverse(object => { if (object.isSkinnedMesh) restoredMesh = object })
  restoredMesh.skeleton.update()
  let maximumRestErrorM = 0
  for (let index = 0; index < rest.length; index++) maximumRestErrorM = Math.max(maximumRestErrorM, rest[index].distanceTo(restoredMesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(restoredMesh.matrixWorld)))
  if (maximumRestErrorM > 1e-6) throw Error(`LOD${level}: rest skin moved ${maximumRestErrorM} m`)
  const changedViews = original.document.bufferViews.map((_, index) => index).filter(index => !viewBytes(original, index).equals(viewBytes(candidate, index)))
  const report = { level, verticesCompared: rest.length, changedWeightVertices: spec.mask.length, thumbVertices: spec.mask.filter(row => row.kind === 'thumb').length,
    affectedBones: joints, changedViews, maximumRestErrorM, allOtherBinaryBytesExact: true, allOtherNodeFieldsExact: true,
    geometryNormalsUvIndicesExact: geometryDigest(candidate) === spec.geometrySha256, animationStreamsByteExact: true,
    maskVertexIds: spec.mask.map(row => row.i), decodedBeforeSha256: sha256(original.binary), decodedAfterSha256: sha256(candidate.binary) }
  return { ...candidate, report }
}

async function main() {
  const [inputRoot, outputRoot] = process.argv.slice(2)
  if (!inputRoot || !outputRoot || path.resolve(inputRoot) === path.resolve(outputRoot)) throw Error('Usage: node tools/repair-nordic-right-hand.mjs INPUT_ROOT DISTINCT_OUTPUT_ROOT')
  const id = calibration.id, inputDirectory = path.join(inputRoot, id), outputDirectory = path.join(outputRoot, id)
  const manifest = JSON.parse(fs.readFileSync(path.join(inputDirectory, 'manifest.json')))
  if (manifest.source?.sourceSha256 !== calibration.sourceSha256) throw Error('Original source provenance mismatch')
  const outputs = []
  for (let level = 0; level < 3; level++) {
    const file = path.join(inputDirectory, `lod${level}.glb`), result = await repairNordicRightHand(readGlb(file), level), bytes = encodeGlb(result.document, result.binary)
    outputs.push({ level, bytes, report: { ...result.report, inputSha256: sha256(fs.readFileSync(file)), correctedSha256: sha256(bytes) } })
  }
  fs.mkdirSync(outputRoot, { recursive: true }); fs.cpSync(inputDirectory, outputDirectory, { recursive: true })
  for (const output of outputs) {
    fs.writeFileSync(path.join(outputDirectory, `lod${output.level}.glb`), output.bytes)
    manifest.fileSha256[`lod${output.level}`] = sha256(output.bytes)
  }
  manifest.swordCarryGrips = calibration.swordCarryGrips
  manifest.knownLimitations = [...new Set([...(manifest.knownLimitations ?? []),
    'The widest steel sword grip retains a broad low-poly C silhouette around its raised rings in extreme closeups; the corrected grasp preserves blade orientation with a bounded local attachment translation.',
    'Corrected right-hand skin changes authored non-sword fingertips. Coarse one-handed axe haft overlap remains and can be deeper than the original; this repair does not claim zero weapon/hand penetration.',
  ])]
  manifest.rightHandRepair = { sourceSha256: calibration.sourceSha256, calibration: 'tools/data/faction-nordic-right-hand.json', audit: 'right-hand-repair-audit.json' }
  for (const key of ['bufferCompression', 'bufferCompressionAudit', 'losslessPublicationPacking', 'losslessTexturePacking']) delete manifest[key]
  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const report = { schemaVersion: 1, id, sourceSha256: calibration.sourceSha256, calibrationSha256: sha256(fs.readFileSync(fileURLToPath(new URL('./data/faction-nordic-right-hand.json', import.meta.url)))),
    scope: 'Only reviewed right-hand vertex skin rows and 15 right-digit translations/inverse-bind rows. Rest surface retained; all animation streams and all other bytes/fields exact.', lods: outputs.map(output => output.report) }
  fs.writeFileSync(path.join(outputDirectory, 'right-hand-repair-audit.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.lods.map(({ level, verticesCompared, changedWeightVertices, thumbVertices, maximumRestErrorM }) => ({ level, verticesCompared, changedWeightVertices, thumbVertices, maximumRestErrorM }))))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
