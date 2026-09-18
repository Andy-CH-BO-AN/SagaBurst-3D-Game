import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { collectMainPassCensus } from '../src/debug/MainPassCensus'

function fixture(fail = false) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), shadow = new THREE.Camera()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  mesh.name = 'terrain'; scene.add(mesh)
  const info = { autoReset: false, render: { calls: 17, triangles: 20, points: 0, lines: 0, frame: 3 } }
  const renderer = {
    info, getRenderTarget: () => null,
    renderBufferDirect: (_camera: unknown, _scene: unknown, _geometry: unknown, _material: unknown, _object: unknown, group: unknown) => {
      // A zero-size group does not submit; another group emits two real calls.
      if (group === 'empty') return
      info.render.calls += group === 'double' ? 2 : 1
      info.render.triangles += 12
    },
    render: () => {
      info.render.frame++
      renderer.renderBufferDirect(shadow, null, mesh.geometry, mesh.material, mesh, null)
      if (info.autoReset) { info.render.calls = 0; info.render.triangles = 0 }
      renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh, null)
      renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh, 'empty')
      renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh, 'double')
      if (fail) throw new Error('render failed')
    },
  }
  const game = { scene, camera, renderer, player: { group: new THREE.Group() }, npcs: [], mounts: [], arrows: [], pickups: [], _aimTargetRegistry: { targets: [mesh] } }
  return { game, renderer }
}

describe('on-demand main-pass attribution', () => {
  it('counts actual increments, excludes shadows and restores renderer instrumentation', () => {
    const { game, renderer } = fixture(), original = renderer.renderBufferDirect
    const result = collectMainPassCensus(game as any)
    expect(result.mainCalls).toBe(3); expect(result.unattributedCalls).toBe(0)
    expect(result.categories[0].submittedMeshes).toBe(1)
    expect(result.categories[0].mainSubmissions).toBe(3)
    expect(renderer.renderBufferDirect).toBe(original)
    expect(renderer.info).toEqual({ autoReset: false, render: { calls: 17, triangles: 20, points: 0, lines: 0, frame: 4 } })
  })
  it('restores state when a diagnostic render throws', () => {
    const { game, renderer } = fixture(true), original = renderer.renderBufferDirect
    expect(() => collectMainPassCensus(game as any)).toThrow('render failed')
    expect(renderer.renderBufferDirect).toBe(original)
    expect(renderer.info.autoReset).toBe(false); expect(renderer.info.render.calls).toBe(17)
  })
})
