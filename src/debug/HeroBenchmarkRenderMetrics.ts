import type * as THREE from 'three'

/** Character resources only. Texture bytes estimate RGBA8 GPU storage including
 * mipmaps, not compressed download bytes or the browser's total GPU allocation. */
export function characterResourceMetrics(roots: readonly THREE.Object3D[]) {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>()
  const residentBones = new Set<THREE.Bone>(), visibleBones = new Set<THREE.Bone>()
  let residentSkinnedMeshes = 0, visibleSkinnedMeshes = 0
  for (const root of roots) {
    root.traverse(node => {
      const mesh = node as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      residentSkinnedMeshes++
      for (const bone of mesh.skeleton.bones) residentBones.add(bone)
      let visible = true
      for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) visible &&= parent.visible
      if (visible) { visibleSkinnedMeshes++; for (const bone of mesh.skeleton.bones) visibleBones.add(bone) }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material)
        for (const value of Object.values(material)) if (value && typeof value === 'object' && value.isTexture) textures.add(value)
      }
    })
  }
  let textureEstimatedBytes = 0
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | undefined
    textureEstimatedBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * (texture.generateMipmaps ? 4 / 3 : 1)
  }
  return { residentSkinnedMeshes, residentBones: residentBones.size, visibleSkinnedMeshes, visibleBones: visibleBones.size,
    uniqueMaterials: materials.size, uniqueTextures: textures.size, textureEstimatedBytes: Math.round(textureEstimatedBytes) }
}

/** Time the actual renderer (including its shadow passes), not renderer.submit CPU.
 * Unsupported/disjoint samples are explicit, never substituted with frame time. */
export function measureGpuRender(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const samplesMs: number[] = [], pending: WebGLQuery[] = []
  const original = renderer.render
  let disjointSamples = 0, droppedSamples = 0
  let finished = false, unresolved = 0
  function drain() {
    const disjoint = extension && gl.getParameter(extension.GPU_DISJOINT_EXT)
    if (disjoint) {
      // A clock discontinuity invalidates outstanding queries too, even when
      // their results become available after the disjoint flag clears.
      disjointSamples += pending.length
      for (const query of pending) gl.deleteQuery(query)
      pending.length = 0
      return
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const query = pending[i]
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
      samplesMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(query); pending.splice(i, 1)
    }
  }
  if (extension) renderer.render = function (scene, camera) {
    drain()
    const query = pending.length < 120 ? gl.createQuery() : null
    if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
    else droppedSamples++
    try { original.call(this, scene, camera) }
    finally { if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push(query) } }
  }
  return {
    finish() {
      if (!finished) {
        renderer.render = original; drain()
        unresolved = pending.length
        for (const query of pending) gl.deleteQuery(query)
        pending.length = 0; finished = true
      }
      return { supported: !!extension, samplesMs, disjointSamples, droppedSamples, unresolved,
        averageMs: samplesMs.length ? samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length : null }
    },
  }
}
