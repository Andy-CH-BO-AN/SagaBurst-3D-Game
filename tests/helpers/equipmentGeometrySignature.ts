import * as THREE from 'three'
import { createHash } from 'node:crypto'

/** Order-independent rendered triangles, including UVs, normals and render policy. */
export function equipmentGeometrySignature(root: THREE.Group) {
  const buckets = new Map<string, string[]>()
  root.updateMatrixWorld(true)
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material as THREE.MeshStandardMaterial
    const key = JSON.stringify([material.name, material.map?.name, material.roughness,
      material.metalness, object.castShadow, object.receiveShadow, object.visible,
      object.layers.mask, object.renderOrder, object.frustumCulled])
    const triangles = buckets.get(key) ?? []
    buckets.set(key, triangles)
    const geometry = object.geometry
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld)
    const count = geometry.index?.count ?? p.count
    for (let start = 0; start < count; start += 3) {
      const vertices: string[] = []
      for (let corner = 0; corner < 3; corner++) {
        const i = geometry.index ? geometry.index.getX(start + corner) : start + corner
        const point = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld)
        const normal = new THREE.Vector3().fromBufferAttribute(n, i).applyNormalMatrix(normalMatrix)
        // Float32 transform baking can differ by a few ulps from shader transforms.
        vertices.push([...point.toArray(), ...normal.toArray(), uv.getX(i), uv.getY(i)]
          .map(value => Math.round(value * 10000)).join(','))
      }
      // Preserve winding while allowing a different starting corner.
      triangles.push([vertices.join(';'), [...vertices.slice(1), vertices[0]].join(';'),
        [vertices[2], ...vertices.slice(0, 2)].join(';')].sort()[0])
    }
  })
  return Object.fromEntries([...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, triangles]) =>
    [key, { triangles: triangles.length, digest: createHash('sha256').update(triangles.sort().join('\n')).digest('hex') }]))
}
