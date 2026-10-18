#!/usr/bin/env node
/** Rebuild: node tools/build-xongkoro-bounds.mjs [--check]
 * Offline analytical envelope, not a unit test. Uses the production ground pose.
 * Every rotation is allowed: the proof does not depend on sampling density.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import * as THREE from 'three'
import { loadRig, readGlb } from './lib/humanoid-glb.mjs'

const directory = 'public/models/mounts/v2/xongkoro'
const sources = ['src/world/XongkoroVisual.ts', 'src/world/XongkoroGroundPose.ts', 'src/movement/XongkoroConfig.ts']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const poseSha256 = hash(sources.map(file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).join('\n'))
const compiled = await build({ stdin: { contents: `export * from './src/world/XongkoroGroundPose.ts'; export { XONGKORO_VISUAL } from './src/movement/XongkoroConfig.ts'`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'shared-three', setup(builder) { builder.onResolve({ filter: /^three(?:\/|$)/ }, args => ({ path: import.meta.resolve(args.path), external: true })) } }],
})
const { buildEagleGroundPose, eagleFootVertices, XONGKORO_VISUAL: config } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
if (THREE.REVISION !== '167') throw Error('Review the envelope for the new Three.js revision')
const asset = readGlb(`${directory}/xongkoro.glb`)
for (const mesh of asset.document.meshes) for (const primitive of mesh.primitives) {
  if (primitive.targets?.length || (primitive.mode ?? 4) !== 4) throw Error('Unsupported morph/primitive contract')
}
const gltf = await loadRig(asset), root = gltf.scene
const clip = gltf.animations.find(clip => clip.name === 'fly')
if (!clip || gltf.animations.length !== 1) throw Error('Review every production animation')
const mixer = new THREE.AnimationMixer(root)
mixer.clipAction(clip).play(); mixer.update(0); root.updateMatrixWorld(true)
const body = root.getObjectByName('eagle_body_lod0')
const feet = eagleFootVertices(body)
const ground = buildEagleGroundPose(root, body, feet)
const groundByName = new Map(ground.map(pose => [pose.node.name, pose]))
const anchorBone = root.getObjectByName('FLY')
const anchor = anchorBone.getWorldPosition(new THREE.Vector3())
const tracks = new Map(clip.tracks.map(track => [track.name, track]))
// FLY's position, unlike its rotations, must stay fixed. The parents are fixed
// authored transforms, while all FLY/descendant rotations may vary arbitrarily.
for (let node = anchorBone.parent; node && node !== root; node = node.parent) {
  if (clip.tracks.some(track => track.name.startsWith(`${node.name}.`))) throw Error('Animated anchor ancestor requires a new proof')
}
const flyPosition = tracks.get('FLY.position')
if (!flyPosition || [...flyPosition.values].some((value, index) => value !== flyPosition.values[index % 3])) throw Error('Moving FLY anchor requires a new proof')
for (const track of clip.tracks) {
  if (![THREE.InterpolateLinear, THREE.InterpolateDiscrete].includes(track.getInterpolation())) throw Error(`Unsupported interpolation: ${track.name}`)
  if (!['position', 'quaternion', 'scale'].includes(track.name.split('.').at(-1))) throw Error(`Unsupported track: ${track.name}`)
}
const normUpper = matrix => {
  const e = matrix.elements, columns = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]), new THREE.Vector3(e[8], e[9], e[10])]
  // Gershgorin bound for A^T A: conservative even with authored scale/shear.
  return Math.sqrt(Math.max(...columns.map(column => columns.reduce((sum, other) => sum + Math.abs(column.dot(other)), 0))))
}
const info = new Map()
function limits(node) {
  if (info.has(node)) return info.get(node)
  const position = tracks.get(`${node.name}.position`), scale = tracks.get(`${node.name}.scale`)
  const translations = [node.position.clone(), ...(groundByName.has(node.name) ? [groundByName.get(node.name).position] : [])]
  if (position) for (let index = 0; index < position.values.length; index += 3) translations.push(new THREE.Vector3().fromArray(position.values, index))
  const localTranslation = Math.max(...translations.map(value => value.length()))
  const localScale = Math.max(...node.scale.toArray().map(Math.abs), ...(scale ? [...scale.values].map(Math.abs) : []))
  const parent = node === anchorBone ? { distance: 0, scale: normUpper(anchorBone.parent.matrixWorld), attack: 0 } : limits(node.parent)
  const result = { distance: node === anchorBone ? 0 : parent.distance + parent.scale * localTranslation, scale: parent.scale * localScale,
    attack: parent.attack + (node.name === 'Bip01_Neck' ? Math.abs(config.attackNeckExtension) : node.name === 'Bip01_Head' ? Math.abs(config.attackHeadExtension) : 0) }
  info.set(node, result); return result
}
const meshes = []
root.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh) })
if (meshes.length !== 3 || meshes.some((mesh, index) => mesh.name !== `eagle_body_lod${index}` || !mesh.isSkinnedMesh || mesh.bindMode !== THREE.AttachedBindMode)) throw Error('Review all render meshes and their hierarchy')
const vector = new THREE.Vector3()
function vertexRadius(mesh, index, attack) {
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
  vector.fromBufferAttribute(mesh.geometry.getAttribute('position'), index).applyMatrix4(mesh.bindMatrix)
  let radius = 0, totalWeight = 0
  for (let component = 0; component < 4; component++) {
    const weight = weights.getComponent(index, component)
    if (!Number.isFinite(weight) || weight < 0) throw Error('Unsupported skin weight')
    if (!weight) continue
    const boneIndex = indices.getComponent(index, component), bone = mesh.skeleton.bones[boneIndex]
    if (!bone) throw Error('Invalid skin joint')
    const bound = limits(bone)
    const inverseVertex = vector.clone().applyMatrix4(mesh.skeleton.boneInverses[boneIndex])
    radius += weight * (bound.distance + bound.scale * inverseVertex.length() + (attack ? bound.attack : 0))
    totalWeight += weight
  }
  // Do not assume floating point skin weights sum to exactly one.
  return { radius: radius + Math.abs(totalWeight - 1) * anchor.length(), totalWeight }
}
// supportTransitionFeet runs before attack. Its lowest cached foot vertex is
// >= sum(w)*anchor.y - sum(w*influenceRadius); lifting is in root-space +Y.
const supportLift = Math.max(0, ...feet.flat().map(index => {
  const bound = vertexRadius(body, index, false)
  return bound.radius - bound.totalWeight * anchor.y
}))
let maximumSkinWeightSum = 1
for (const mesh of meshes) for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) maximumSkinWeightSum = Math.max(maximumSkinWeightSum, vertexRadius(mesh, index, false).totalWeight)
const supportDisplacement = supportLift * maximumSkinWeightSum
const margin = .1
const center = anchor.clone().add(new THREE.Vector3(0, supportDisplacement / 2, 0))
const rows = meshes.map(mesh => {
  let baseRadius = 0
  const positions = mesh.geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) baseRadius = Math.max(baseRadius, vertexRadius(mesh, index, true).radius)
  return { name: mesh.name, vertices: positions.count, triangles: mesh.geometry.index.count / 3,
    material: asset.document.materials[0].name, groups: mesh.geometry.groups.length || 1,
    center: center.toArray(), radius: baseRadius + supportDisplacement / 2 + margin }
})
const metadata = { schemaVersion: 1, threeRevision: THREE.REVISION,
  assetSha256: hash(fs.readFileSync(`${directory}/xongkoro.glb`)), poseSha256,
  space: 'XongkoroVisual.root', method: 'rotation-independent weighted bone-chain envelope',
  supportLiftUpperBound: supportLift, supportDisplacementUpperBound: supportDisplacement, maximumSkinWeightSum, numericMarginMeters: margin,
  proof: 'For every vertex: sum of nonnegative skin weights times (ancestor translation-length bounds + scale-product bound times inverse-bind vertex length + ancestor attack extensions). Linear/step translation and scale interpolation are bounded by their endpoint norms; rotations are unrestricted, including every slerp and procedural rotation. Ground translations come from production buildEagleGroundPose. Cached feet give a pre-attack support-lift upper bound; multiplying by the maximum skin-weight sum gives per-vertex displacement upper bound L. Moving the sphere center by +Y L/2 and adding L/2 encloses all support lifts in [0,L], including partial pelvis skin influence. Death and update(0) retain covered poses. The 0.1m margin covers floating-point transform/skinning error, not unproved intermediate poses.',
  meshes: rows }
const output = `${JSON.stringify(metadata, null, 2)}\n`, destination = `${directory}/render-bounds.json`
const manifestFile = `${directory}/manifest.json`, manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const metadataSha256 = hash(output)
if (process.argv.includes('--check')) {
  if (fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== output || manifest.renderBounds !== 'render-bounds.json' || manifest.renderBoundsSha256 !== metadataSha256) throw Error('Eagle bounds/checksum are stale; rebuild required')
} else {
  fs.writeFileSync(destination, output)
  manifest.renderBounds = 'render-bounds.json'; manifest.renderBoundsSha256 = metadataSha256
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
}
console.log(JSON.stringify({ status: process.argv.includes('--check') ? 'checked' : 'built', destination, supportLiftUpperBound: supportLift, meshes: rows }, null, 2))
