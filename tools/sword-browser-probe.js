// Run this function through DevTools on ?devmodels=humans&nolock.
// It samples the production studio equipment; no attachment corrections.
async () => {
  const g = window.game
  if (!g?.humanoidStudioPlayback) throw new Error('請先開啟人物工作室')
  const T = await import('/node_modules/.vite/deps/three.js')
  g.humanoidStudioPaused = true
  window.swordProbe = (faction, state = 'idle', time = 0, lod = 0, view = 'palm') => {
    const [instance, playback] = [...g.humanoidStudioPlayback].find(([, p]) => p.faction === faction && p.state === state)
    for (const child of g.scene.children) if (!child.isLight) child.visible = child === instance.root
    instance.root.visible = true
    playback.reset()
    const animation = instance.rig.animation
    animation.stop()
    if (state !== 'bind') {
      animation.play(state, { fadeSeconds: 0, loop: false })
      animation.update(0.000001)
      animation.seek(state, time)
    }
    animation.setSwordHandShape(true)
    animation.update(0)
    instance.root.updateMatrixWorld(true)
    const levels = instance.root.children.find(o => o.isLOD)
    levels.autoUpdate = false
    levels.levels.forEach(({ object }, i) => { object.visible = i === lod })
    const level = levels.levels[lod].object
    const hand = level.getObjectByName('hand_r')
    const frame = window.swordManifests[faction].swordGripFrames[`lod${lod}`]
    const center = hand.localToWorld(new T.Vector3(...frame.gripCenterLocal))
    const n = new T.Vector3(...frame.palmNormalLocal).transformDirection(hand.matrixWorld)
    const a = new T.Vector3(...frame.gripAxisLocal).transformDirection(hand.matrixWorld)
    const f = new T.Vector3(...frame.fingerDirection).transformDirection(hand.matrixWorld)
    g.camera.near = .001; g.camera.fov = 30; g.camera.updateProjectionMatrix()
    g.studioControls.minDistance = .01; g.studioControls.enableDamping = false
    const target = center.clone(), eye = center.clone()
    if (view === 'palm') eye.addScaledVector(n, .65).addScaledVector(a, .12)
    else if (view === 'back') eye.addScaledVector(n, -.65).addScaledVector(a, .12)
    else if (view === 'side') eye.addScaledVector(a, .65).addScaledVector(n, .15)
    else if (view === 'fingers') eye.addScaledVector(f, .5).addScaledVector(n, -.4).addScaledVector(a, .12)
    else {
      target.copy(instance.root.position).y += 1
      eye.copy(target).add(view === 'top' ? new T.Vector3(0, 5.5, 3.8) : new T.Vector3(2.8, 1.3, 5))
      g.camera.fov = view === 'top' ? 58 : 30; g.camera.updateProjectionMatrix()
    }
    g.studioControls.target.copy(target); g.camera.position.copy(eye); g.studioControls.update()
    for (const el of document.body.children) if (el.id !== 'canvas-container' && el.tagName !== 'SCRIPT') el.style.display = 'none'
    g.renderer.render(g.scene, g.camera)
    const model = playback.sword.children[0]
    const grip = model.localToWorld(new T.Vector3(...model.userData.gripCenterLocal))
    return { faction, state, time, lod, view, gripErrorM: grip.distanceTo(center), grip: grip.toArray(), palm: center.toArray() }
  }
  window.swordManifests = Object.fromEntries(await Promise.all(['roman', 'viking'].map(async f => [f, await (await fetch(`/models/characters/v2/${f}/manifest.json`)).json()])))
  return '握劍固定時間診斷已就緒'
}
