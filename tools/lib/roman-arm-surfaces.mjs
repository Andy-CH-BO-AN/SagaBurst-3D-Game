import * as T from 'three'
import { loadRig, readAccessor } from './humanoid-glb.mjs'
import { refineSleeve } from './refine-sleeve.mjs'

/** Fit the sleeve over the unchanged source arm and share shoulder weights
 * across overlapping surfaces. Unlike a skin inset, this retains anatomy.
 */
export async function repairRomanArmSurfaces(asset, assetId, lod) {
  const doc = asset.document, extras = doc.asset.extras
  const previous = extras.romanArmSurfaces?.targetAssetId === assetId ? extras.romanArmSurfaces : undefined
  if (previous?.version === 2) return
  const scale = extras.romanHeroBuild?.scale ?? 1
  const rig = await loadRig(asset), skinMeshes = []
  rig.scene.getObjectByName('New_arms').traverse(o => {
    if (o.isMesh) skinMeshes.push(new T.Mesh(o.geometry, new T.MeshBasicMaterial({ side: T.DoubleSide })))
  })
  const ray = new T.Raycaster(), point = new T.Vector3(), centre = new T.Vector3(), direction = new T.Vector3()
  const write = (index, row, values) => {
    const a = doc.accessors[index], v = doc.bufferViews[a.bufferView]
    const size = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType]
    if (!size) throw Error('Unsupported Roman arm attribute')
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + row * (v.byteStride ?? values.length * size)
    values.forEach((value, column) => {
      const offset = start + column * size
      if (a.componentType === 5126) asset.binary.writeFloatLE(value, offset)
      else if (size === 2) asset.binary.writeUInt16LE(value, offset)
      else asset.binary.writeUInt8(value, offset)
    })
  }
  const visited = new Set()
  for (const node of doc.nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue
    const mesh = doc.meshes[node.mesh]
    if (!['New_arms', 'Tunic_1', 'Armour_top', 'Wrist_guard1'].includes(mesh.name)) continue
    const joint = name => {
      const index = doc.skins[node.skin].joints.findIndex(n => doc.nodes[n].name === name)
      if (index < 0) throw Error(`Missing arm joint ${name}`)
      return index
    }
    for (const p of mesh.primitives) {
      if (mesh.name === 'Tunic_1' && lod > 0) refineSleeve(asset, p, scale)
      const a = p.attributes
      if (visited.has(a.POSITION)) continue
      visited.add(a.POSITION)
      const positions = readAccessor(asset, a.POSITION)
      for (let i = 0; i < positions.length / 3; i++) {
        point.fromArray(positions, i * 3)
        const x = point.x / scale, y = point.y / scale, distance = Math.abs(x), side = x >= 0 ? 'l' : 'r'
        if (mesh.name === 'Wrist_guard1') {
          if (!extras.romanHeroBuild && !previous) {
            // The ordinary bracer overlaps the elbow by 67 mm; use the same
            // source-specific cuff fit already used by the Praetorian builder.
            point.x = Math.sign(x) * (.548 + (distance - .453) / (.695 - .453) * (.695 - .548)) * scale
            write(a.POSITION, i, point.toArray())
          }
          write(a.JOINTS_0, i, [joint(`lower_arm_${side}`), 0, 0, 0])
          write(a.WEIGHTS_0, i, [1, 0, 0, 0])
          continue
        }
        if (distance >= .47 || y < 1.25) continue
        const arm = T.MathUtils.smoothstep(distance, .14, .34)
        write(a.JOINTS_0, i, [joint('chest'), joint(`upper_arm_${side}`), 0, 0])
        write(a.WEIGHTS_0, i, [1 - arm, arm, 0, 0])
        if (mesh.name === 'Tunic_1' && distance > .20) {
          centre.set(point.x, 1.405 * scale, -.025 * scale)
          direction.subVectors(point, centre).normalize()
          ray.set(centre, direction)
          const hit = ray.intersectObjects(skinMeshes, false).at(-1)
          if (hit && hit.distance + .003 * scale > point.distanceTo(centre)) {
            point.copy(centre).addScaledVector(direction, hit.distance + .003 * scale)
            write(a.POSITION, i, point.toArray())
          }
        }
      }
      const updated = readAccessor(asset, a.POSITION)
      doc.accessors[a.POSITION].min = [0, 1, 2].map(k => Math.min(...updated.filter((_, i) => i % 3 === k)))
      doc.accessors[a.POSITION].max = [0, 1, 2].map(k => Math.max(...updated.filter((_, i) => i % 3 === k)))
    }
  }
  skinMeshes.forEach(mesh => mesh.material.dispose())
  extras.romanArmSurfaces = { version: 2, targetAssetId: assetId,
    method: 'Unchanged anatomy; sleeve fitted outside source skin, shared shoulder weights, bracer bound below elbow',
    meshes: ['New_arms', 'Tunic_1', 'Armour_top', 'Wrist_guard1'] }
  if (extras.axeAttackBuild?.targetAssetId === assetId) extras.axeAttackBuild.preservedPayload = {
    bytes: asset.binary.length, accessors: doc.accessors.length, bufferViews: doc.bufferViews.length,
  }
}
