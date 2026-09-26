/** Audit the actual runtime GLBs, independent of authoring measurements. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'
const directory = 'public/models/characters/v2/viking-hero-t4'
const manifest = JSON.parse(fs.readFileSync(`${directory}/manifest.json`))
const source = JSON.parse(fs.readFileSync('public/models/characters/v2/viking/manifest.json'))
const required = ['cape_upper', 'cape_mid', 'cape_lower', 'hips', 'spine', 'chest', 'neck', 'head', 'socket_back', 'socket_head', 'socket_pelvis']
for (const side of ['l', 'r']) for (const name of ['upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toe', 'socket_hand', 'socket_foot', 'sole']) required.push(`${name}_${side}`)
const rows = [], failures = []
for (let lod = 0; lod < 3; lod++) {
  const file = `${directory}/lod${lod}.glb`, asset = readGlb(file), gltf = await loadRig(asset)
  const meshes = []; gltf.scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object) })
  gltf.scene.updateMatrixWorld(true)
  const missing = required.filter(name => !gltf.scene.getObjectByName(name))
  let triangles = 0, badWeights = 0, maxInfluences = 0
  for (const mesh of meshes) {
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
    const weights = mesh.geometry.attributes.skinWeight
    for (let i = 0; i < weights.count; i++) {
      let sum = 0, count = 0
      for (let j = 0; j < 4; j++) { const w = weights.getComponent(i, j); sum += w; if (w > 0) count++ }
      if (!Number.isFinite(sum) || Math.abs(sum - 1) > .001) badWeights++
      maxInfluences = Math.max(count, maxInfluences)
    }
  }
  const restBounds = new THREE.Box3().setFromObject(gltf.scene, true)
  const scalp = gltf.scene.getObjectByName('Hero_anatomical_scalp')
  const scalpBounds = new THREE.Box3().setFromObject(scalp, true)
  const bodyHeightM = scalpBounds.max.y - manifest.metrics.barefootPlaneY
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const clipReports = []
  const rest = new Map(); gltf.scene.traverse(object => rest.set(object, { p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() }))
  for (const clip of gltf.animations) {
    for (const [object, value] of rest) { object.position.copy(value.p); object.quaternion.copy(value.q); object.scale.copy(value.s) }
    const mixer = new THREE.AnimationMixer(gltf.scene), action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
    const samples = []
    for (const fraction of [0, .125, .25, .5, .75, .875, 1]) {
      action.paused = false; mixer.setTime(fraction * clip.duration); gltf.scene.updateMatrixWorld(true)
      for (const mesh of meshes) mesh.skeleton.update()
      const box = new THREE.Box3(), p = new THREE.Vector3()
      for (const mesh of meshes) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, p); p.applyMatrix4(mesh.matrixWorld); box.expandByPoint(p)
      }
      const size = box.getSize(new THREE.Vector3()), finite = [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
      if (!finite || size.length() > 4.5) failures.push(`LOD${lod} ${clip.name}: nonfinite or exploded skin`)
      samples.push({ time: fraction * clip.duration, min: box.min.toArray(), max: box.max.toArray() })
    }
    mixer.stopAllAction()
    const binding = manifest.animations.embedded.find(binding => binding.clip === clip.name)
    if (!binding || Math.abs(clip.duration - binding.duration) > .001) failures.push(`LOD${lod} ${clip.name}: binding duration`)
    clipReports.push({ clip: clip.name, duration: clip.duration, samples })
  }
  for (const binding of source.animations.embedded) {
    const heroBinding = manifest.animations.embedded.find(item => item.clip === binding.clip)
    if (!heroBinding || JSON.stringify(heroBinding.events) !== JSON.stringify(binding.events)) failures.push(`LOD${lod}: modified ${binding.clip} event times`)
  }
  if (missing.length || badWeights || Math.abs(bodyHeightM - 2) > .02 || triangles > [60000, 20000, 6000][lod] || sha256 !== manifest.fileSha256[`lod${lod}`]) failures.push(`LOD${lod}: structural/stature/budget/hash check failed`)
  rows.push({ lod, triangles, skinnedMeshes: meshes.length, missing, badWeights, maxInfluences, bodyHeightM, overallHeightM: restBounds.max.y - restBounds.min.y, restBounds: { min: restBounds.min.toArray(), max: restBounds.max.toArray() }, sha256, clips: clipReports })
}
const result = { schemaVersion: 1, assetId: manifest.id, method: 'GLTFLoader + per-vertex CPU skinning of exported GLBs; seven samples per clip. Does not prove absence of intersections.', failures, rows }
fs.writeFileSync(`${directory}/audit.json`, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ failures, rows: rows.map(({ lod, triangles, bodyHeightM, overallHeightM, badWeights }) => ({ lod, triangles, bodyHeightM, overallHeightM, badWeights })) }, null, 2))
if (failures.length) process.exitCode = 1
