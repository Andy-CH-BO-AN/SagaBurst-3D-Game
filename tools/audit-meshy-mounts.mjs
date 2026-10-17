/** Standalone asset structural audit, not part of the logic test runner.
 * Usage: node tools/audit-meshy-mounts.mjs [black-cat|corgi|all] [asset-root]
 * Passing this audit does not establish visual quality or gameplay/GPU acceptance.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
import { decodeMeshoptGlb } from './lib/meshopt-glb.mjs'

const selection = process.argv[2] ?? 'all'
const root = process.argv[3] ?? 'public/models/mounts/v2'
const clips = ['idle', 'walk', 'run', 'jump', 'land', 'hit', 'death']
const hashes = {
  'black-cat': '9e6ce0835095dfec2de0e953f38a0dbaa987a50da0a28bf4e8c241ee2ac7f81a',
  corgi: '0d0a7925220ef045b7c70ed7071248565b742d76ea3d356d64b19f49a90175df',
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const report = []
for (const id of selection === 'all' ? Object.keys(hashes) : [selection]) {
  assert(hashes[id], `Unknown mount: ${id}`)
  const directory = path.join(root, id)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const file = path.join(directory, manifest.file)
  const bytes = fs.readFileSync(file)
  assert(manifest.id === `${id}-v2`, `${id}: changed asset identity`)
  assert(manifest.source.sourceSha256 === hashes[id], `${id}: incorrect source hash`)
  assert(manifest.sha256 === sha(bytes), `${id}: stale manifest hash`)
  assert(manifest.forward === '+Z', `${id}: wrong forward contract`)
  const packed = readGlb(file)
  const asset = await decodeMeshoptGlb(packed)
  const rig = await loadRig(asset)
  const prefix = id === 'black-cat' ? 'cat' : 'corgi'
  rig.scene.updateMatrixWorld(true)
  const skeletons = new Set(), meshes = [], lods = []
  rig.scene.traverse(object => { if (object.isMesh) meshes.push(object) })
  for (const name of ['socket_saddle_seat', 'socket_camera']) assert(rig.scene.getObjectByName(name), `${id}: missing ${name}`)
  for (let level = 0; level < 3; level++) {
    const body = rig.scene.getObjectByName(`${prefix}_body_lod${level}`)
    const equipment = rig.scene.getObjectByName(level === 0 ? `${prefix}_saddle_leather` : `${prefix}_equipment_lod${level}`)
    assert(body?.isSkinnedMesh && equipment?.isSkinnedMesh, `${id}: missing skinned body/equipment LOD${level}`)
    const triangles = [body, equipment].reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0)
    const backing = rig.scene.getObjectByName(`${prefix}_unarmored_lod${level}`)
    assert(!backing || backing.isSkinnedMesh, `${id}: unskinned backing LOD${level}`)
    const backingTriangles = backing ? (backing.geometry.index?.count ?? backing.geometry.attributes.position.count) / 3 : 0
    const bodyTriangles = (body.geometry.index?.count ?? body.geometry.attributes.position.count) / 3
    const unarmoredTriangles = backing?.userData.replacesEquippedBody === true ? backingTriangles : bodyTriangles + backingTriangles
    lods.push({ level, triangles, storedTriangles: triangles + backingTriangles, backingTriangles, unarmoredTriangles, bodyTriangles: (body.geometry.index?.count ?? body.geometry.attributes.position.count) / 3,
      equipmentTriangles: (equipment.geometry.index?.count ?? equipment.geometry.attributes.position.count) / 3 })
  }
  assert(lods[0].triangles > lods[1].triangles && lods[1].triangles > lods[2].triangles, `${id}: LODs are not reduced`)
  let maximumWeightError = 0, maximumRestError = 0
  const referenceJoints = rig.scene.getObjectByName(`${prefix}_body_lod0`).skeleton.bones.map(bone => bone.name)
  for (const mesh of meshes) {
    assert(mesh.isSkinnedMesh, `${id}: unskinned mesh ${mesh.name}`)
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes
    assert(position && skinIndex && skinWeight, `${id}: missing skin attributes on ${mesh.name}`)
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      assert(attribute.count === position.count, `${id}: inconsistent ${name} vertex count`)
      for (let vertex = 0; vertex < attribute.count; vertex++) for (let component = 0; component < attribute.itemSize; component++) {
        assert(Number.isFinite(attribute.getComponent(vertex, component)), `${id}: nonfinite ${name}`)
      }
    }
    assert(JSON.stringify(mesh.skeleton.bones.map(bone => bone.name)) === JSON.stringify(referenceJoints), `${id}: incompatible LOD joints`)
    skeletons.add(mesh.skeleton)
    mesh.skeleton.update()
    for (const inverse of mesh.skeleton.boneInverses) assert(inverse.elements.every(Number.isFinite), `${id}: nonfinite inverse bind`)
    const rest = new THREE.Vector3(), posed = new THREE.Vector3()
    for (let vertex = 0; vertex < position.count; vertex++) {
      let total = 0
      for (let channel = 0; channel < 4; channel++) {
        const weight = skinWeight.getComponent(vertex, channel)
        const joint = skinIndex.getComponent(vertex, channel)
        assert(Number.isFinite(weight) && weight >= 0, `${id}: invalid weight`)
        assert(Number.isInteger(joint) && joint >= 0 && joint < mesh.skeleton.bones.length, `${id}: invalid joint`)
        total += weight
      }
      maximumWeightError = Math.max(maximumWeightError, Math.abs(total - 1))
      mesh.getVertexPosition(vertex, posed)
      rest.fromBufferAttribute(position, vertex)
      assert(Number.isFinite(posed.x + posed.y + posed.z), `${id}: nonfinite rest vertex`)
      maximumRestError = Math.max(maximumRestError, rest.distanceTo(posed))
    }
  }
  assert(maximumWeightError < 1e-4, `${id}: skin weights are not normalized`)
  assert(maximumRestError < 1e-4, `${id}: rest/inverse-bind mismatch ${maximumRestError}m`)
  const mixer = new THREE.AnimationMixer(rig.scene)
  const animationReport = []
  const fingerprints = new Set()
  for (const name of clips) {
    const clip = rig.animations.find(item => item.name === name)
    assert(clip && clip.duration > 0 && clip.tracks.length > 0, `${id}: missing animation ${name}`)
    const fingerprint = sha(Buffer.concat(clip.tracks.flatMap(track => [Buffer.from(track.times.buffer, track.times.byteOffset, track.times.byteLength), Buffer.from(track.values.buffer, track.values.byteOffset, track.values.byteLength)])))
    assert(!fingerprints.has(fingerprint), `${id}: duplicated animation data ${name}`)
    fingerprints.add(fingerprint)
    let changingTracks = 0
    for (const track of clip.tracks) {
      assert([...track.values, ...track.times].every(Number.isFinite), `${id}: nonfinite animation ${name}`)
      for (let i = 1; i < track.times.length; i++) assert(track.times[i] > track.times[i - 1], `${id}: non-increasing animation times`)
      const width = track.getValueSize()
      if (track.name.endsWith('.quaternion')) for (let offset = 0; offset < track.values.length; offset += 4) {
        assert(Math.abs(Math.hypot(...track.values.slice(offset, offset + 4)) - 1) < 1e-3, `${id}: unnormalized animation rotation`)
      }
      if (track.values.some((value, i) => i >= width && Math.abs(value - track.values[i % width]) > 1e-6)) changingTracks++
    }
    assert(changingTracks > 0, `${id}: static clip ${name}`)
    mixer.stopAllAction()
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    for (const phase of [0, .13, .37, .63, .89, 1]) {
      mixer.setTime(phase * clip.duration)
      rig.scene.updateMatrixWorld(true)
      for (const mesh of meshes) {
        mesh.skeleton.update()
        const value = new THREE.Vector3()
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          mesh.getVertexPosition(i, value)
          assert(Number.isFinite(value.x + value.y + value.z), `${id}: nonfinite posed vertex ${name}/${phase}`)
        }
      }
    }
    animationReport.push({ name, duration: clip.duration, changingTracks, fingerprint })
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig.scene)
  for (const skeleton of skeletons) skeleton.dispose()
  const uniqueGeometry = new Set(meshes.map(mesh => mesh.geometry))
  const residentGeometryBytes = [...uniqueGeometry].reduce((sum, geometry) => sum
    + Object.values(geometry.attributes).reduce((bytes, attribute) => bytes + (attribute.isInterleavedBufferAttribute ? 0 : attribute.array.byteLength), 0)
    + (geometry.index?.array.byteLength ?? 0)
    + [...new Set(Object.values(geometry.attributes).filter(attribute => attribute.isInterleavedBufferAttribute).map(attribute => attribute.data))].reduce((bytes, data) => bytes + data.array.byteLength, 0), 0)
  report.push({ id, residentGeometryBytes, sha256: sha(bytes), packageBytes: bytes.length, sourceSha256: hashes[id], lods,
    joints: referenceJoints.length, meshes: meshes.length, materials: asset.document.materials?.length ?? 0,
    textures: asset.document.textures?.length ?? 0, maximumWeightError, maximumRestError, clips: animationReport,
    structuralStatus: 'pass', visualStatus: 'Not established by structural audit',
    limitation: 'No proof of anatomy, clipping, saddle fit, animation quality, gameplay or GPU performance.' })
}
console.log(JSON.stringify(report, null, 2))
