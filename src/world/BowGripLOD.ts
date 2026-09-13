import * as THREE from 'three'

/** Connected skin islands containing the actual hands, welding UV seams. */
function handIsland(mesh: THREE.SkinnedMesh): Set<number> {
  const a = mesh.geometry.attributes, ix = mesh.geometry.index!
  const parents = Array.from({ length: a.position.count }, (_, i) => i), weld = new Map<string, number>()
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]))
  for (let i = 0; i < parents.length; i++) {
    const key = [a.position.getX(i), a.position.getY(i), a.position.getZ(i)].map(v => v.toFixed(5)).join(',')
    if (weld.has(key)) parents[root(i)] = root(weld.get(key)!)
    else weld.set(key, i)
  }
  for (let i = 0; i < ix.count; i += 3) for (let j = 1; j < 3; j++) parents[root(ix.getX(i + j))] = root(ix.getX(i))
  const hands = mesh.skeleton.bones.map((bone, i) => /^hand_[lr]$/.test(bone.name) ? i : -1), seeds = new Set<number>()
  for (let i = 0; i < parents.length; i++) for (let j = 0; j < 4; j++) {
    if (hands.includes(a.skinIndex.getComponent(i, j)) && a.skinWeight.getComponent(i, j) > 0.8) seeds.add(root(i))
  }
  return new Set(parents.map((_, i) => i).filter(i => seeds.has(root(i))))
}

/**
 * Keep the contact-critical hand skin islands at source resolution. Decimated
 * triangles bridge the finger gaps, so interpolating a wrap into those triangles
 * cuts straight through the grip. All other mesh islands retain their own LOD.
 */
export function preserveBowHandTopology(source: THREE.SkinnedMesh, target: THREE.SkinnedMesh): void {
  const sourceIsland = handIsland(source), targetIsland = handIsland(target)
  const entries: Array<{ mesh: THREE.SkinnedMesh; vertex: number }> = [], indices: number[] = [], remap = new Map<string, number>()
  for (const mesh of [target, source]) {
    const ix = mesh.geometry.index!, island = mesh === source ? sourceIsland : targetIsland
    for (let i = 0; i < ix.count; i += 3) {
      if (island.has(ix.getX(i)) !== (mesh === source)) continue
      for (let j = 0; j < 3; j++) {
        const vertex = ix.getX(i + j), key = `${mesh === source ? 's' : 't'}:${vertex}`
        if (!remap.has(key)) { remap.set(key, entries.length); entries.push({ mesh, vertex }) }
        indices.push(remap.get(key)!)
      }
    }
  }
  const sourceBone = source.skeleton.bones.findIndex(b => b.name === 'hand_l')
  const targetBone = target.skeleton.bones.findIndex(b => b.name === 'hand_l')
  const transform = new THREE.Matrix4().multiplyMatrices(target.skeleton.boneInverses[targetBone], target.bindMatrix).invert()
    .multiply(source.skeleton.boneInverses[sourceBone]).multiply(source.bindMatrix)
  const linear = new THREE.Matrix3().setFromMatrix4(transform), normal = new THREE.Matrix3().getNormalMatrix(transform)
  const geometry = new THREE.BufferGeometry(), vector = new THREE.Vector3()
  for (const [name, attribute] of Object.entries(target.geometry.attributes)) {
    const values = new Float32Array(entries.length * attribute.itemSize)
    entries.forEach(({ mesh, vertex }, i) => {
      const from = mesh.geometry.attributes[name]
      for (let k = 0; k < attribute.itemSize; k++) {
        let value = from?.getComponent(vertex, k) ?? 0
        if (name === 'skinIndex' && mesh === source) value = target.skeleton.bones.findIndex(b => b.name === source.skeleton.bones[value].name)
        values[i * attribute.itemSize + k] = value
      }
      if (mesh === source && (name === 'position' || name === 'normal')) {
        vector.fromArray(values, i * 3)
        if (name === 'position') vector.applyMatrix4(transform)
        else vector.applyMatrix3(normal).normalize()
        vector.toArray(values, i * 3)
      }
    })
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize))
  }
  geometry.setIndex(indices)
  geometry.morphTargetsRelative = true
  const names = source.geometry.morphAttributes.position.map(a => a.name)
  for (const kind of ['position', 'normal']) {
    geometry.morphAttributes[kind] = names.map(name => {
      const values = new Float32Array(entries.length * 3)
      entries.forEach(({ mesh, vertex }, i) => {
        const index = mesh.morphTargetDictionary?.[name], from = index === undefined ? undefined : mesh.geometry.morphAttributes[kind]?.[index]
        if (!from) return
        vector.fromBufferAttribute(from, vertex)
        if (mesh === source) vector.applyMatrix3(kind === 'position' ? linear : normal)
        vector.toArray(values, i * 3)
      })
      const attribute = new THREE.Float32BufferAttribute(values, 3); attribute.name = name; return attribute
    })
  }
  target.geometry = geometry
  target.updateMorphTargets()
}
