import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { vi } from 'vitest'
import { preloadMakiRangerBow } from '../../src/world/MakiRangerEquipment'

/** No character GLBs/NPCs: replace only bow asset I/O with a tiny rendered body.
 * Selection, instance cloning, metadata loading and attachment remain production.
 * Call once per suite; the production loader retains its template promise.
 */
export async function preloadTinyRangerBow() {
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }), '')
  const geometry = new THREE.BoxGeometry(.02, .62, .08)
  const material = new THREE.MeshBasicMaterial()
  gltf.scene.add(new THREE.Mesh(geometry, material))
  const metadata = JSON.parse(readFileSync('public/models/weapons/maki-ranger-bow/attachment.json', 'utf8'))
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => metadata } as Response)
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(gltf)
  try { await preloadMakiRangerBow() }
  catch (error) { geometry.dispose(); material.dispose(); throw error }
  finally { fetchMock.mockRestore(); loader.mockRestore() }
  return {
    containsBody(root: THREE.Object3D) {
      let found = false
      root.traverse(o => { if (o instanceof THREE.Mesh && o.geometry === geometry) found = true })
      return found
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}
