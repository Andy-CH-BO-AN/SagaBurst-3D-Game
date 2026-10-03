import * as THREE from 'three'

/** Upload the town's actual resources before removing the loading overlay. */
export async function warmTownRenderResources(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  yieldFrame: () => Promise<void>,
): Promise<void> {
  const objects: Array<{ object: THREE.Object3D; visible: boolean; frustumCulled: boolean }> = []
  const lods: Array<{ lod: THREE.LOD; autoUpdate: boolean; level: number }> = []
  scene.traverse(object => {
    objects.push({ object, visible: object.visible, frustumCulled: object.frustumCulled })
    if (object instanceof THREE.LOD && object.levels.length > 0) {
      lods.push({ lod: object, autoUpdate: object.autoUpdate, level: object.getCurrentLevel() })
    }
  })

  const previousTarget = renderer.getRenderTarget()
  const target = new THREE.WebGLRenderTarget(16, 16)
  const selectionCamera = new THREE.PerspectiveCamera()
  const position = new THREE.Vector3()

  const selectLevel = (lod: THREE.LOD, index: number): void => {
    const level = Math.min(index, lod.levels.length - 1)
    const lower = lod.levels[level].distance
    const next = lod.levels[level + 1]
    // Stay inside the level even when switching toward a nearer, hysteretic LOD.
    const upper = next ? next.distance * (1 - next.hysteresis) : lower + Math.max(1, lower)
    const distance = lower + (upper - lower) / 2
    lod.getWorldPosition(position)
    selectionCamera.position.copy(position)
    selectionCamera.position.z += distance
    selectionCamera.updateMatrixWorld(true)
    // Use the instance hook too: humanoid pose/socket and equipment LOD follow it.
    lod.update(selectionCamera)
  }

  try {
    scene.updateMatrixWorld(true)
    for (const { object } of objects) object.frustumCulled = false
    for (const { lod } of lods) lod.autoUpdate = false

    const passes = lods.reduce((count, { lod }) => Math.max(count, lod.levels.length), 1)
    for (let level = 0; level < passes; level++) {
      for (const { lod } of lods) selectLevel(lod, level)
      scene.updateMatrixWorld(true)
      const drawables: Array<THREE.Mesh | THREE.Line | THREE.Points> = []
      scene.traverseVisible(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) drawables.push(object)
      })
      let skinnedBounds = 0
      for (const object of drawables) {
        if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) {
          if (object.boundingSphere !== null) continue
          // Three's first cull/sort otherwise skins every vertex on the gameplay frame.
          object.computeBoundingSphere()
          if (object instanceof THREE.SkinnedMesh && ++skinnedBounds % 8 === 0) await yieldFrame()
        } else if (object.geometry.boundingSphere === null) object.geometry.computeBoundingSphere()
      }
      // Compile the screen variant as well as the offscreen output variant.
      renderer.setRenderTarget(previousTarget)
      await renderer.compileAsync(scene, camera)
      renderer.setRenderTarget(target)
      await renderer.compileAsync(scene, camera)
      // Compilation alone does not upload geometry, maps or per-instance bone textures.
      // Disabling culling covers the barracks and distant camps outside the entry view.
      renderer.render(scene, camera)
      await yieldFrame()
    }
  } finally {
    try {
      for (const { lod, level } of lods) selectLevel(lod, level)
    } finally {
      for (const { lod, autoUpdate } of lods) lod.autoUpdate = autoUpdate
      for (const { object, visible, frustumCulled } of objects) {
        object.visible = visible
        object.frustumCulled = frustumCulled
      }
      try { renderer.setRenderTarget(previousTarget) } finally { target.dispose() }
    }
  }
}
