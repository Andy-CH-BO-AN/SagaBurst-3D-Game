// 正式工作室的裝備／骨架取樣；此工具不修改 attachment。
async () => {
  const g = window.game
  const T = await import('/node_modules/.vite/deps/three.js')
  g.humanoidStudioPaused = true
  window.equipmentProbe = ({ faction = 'viking', shield = true, mounted = false, time = 0, lod = 0, view = 'full', weapon = 'lance', motion = 'idle', attack = false, yaw = 0 } = {}) => {
    const [instance, playback] = [...g.humanoidStudioPlayback].find(([, p]) => p.faction === faction && p.state === (mounted ? 'mounted' : 'idle'))
    for (const child of g.scene.children) if (!child.isLight) child.visible = child === instance.root
    const horse = mounted ? g.mounts.find(m => Math.abs(m.group.position.x - instance.root.position.x) < .01 && Math.abs(m.group.position.z - instance.root.position.z) < .01) : null
    if (horse) horse.group.visible = true
    instance.root.visible = true
    instance.root.rotation.y = yaw
    if (horse) horse.group.rotation.y = yaw
    playback.setEquipmentLoadout(weapon, shield)
    playback.sampleEquipment(time, mounted, motion, attack)
    instance.root.updateMatrixWorld(true)
    const levels = instance.root.children.find(o => o.isLOD)
    levels.autoUpdate = false
    levels.levels.forEach(({ object }, i) => { object.visible = i === lod })
    const level = levels.levels[lod].object, frames = level.userData.equipmentGripFrames
    const rh = level.getObjectByName('hand_r'), lh = level.getObjectByName('hand_l')
    const palm = rh.localToWorld(new T.Vector3(...frames.lanceRight.gripCenterLocal))
    const leftPalm = lh.localToWorld(new T.Vector3(...(shield ? frames.shieldLeft : frames.lanceLeft).gripCenterLocal))
    const grip = playback.lanceModel.localToWorld(new T.Vector3(...playback.lanceModel.userData.gripCenterLocal))
    const tip = playback.lanceModel.localToWorld(new T.Vector3(0, 2.6, 0))
    const support = playback.lanceModel.localToWorld(new T.Vector3(0, .33, 0))
    const shieldGrip = playback.shield.localToWorld(new T.Vector3(0, 0, .085))
    const local = p => instance.root.worldToLocal(p.clone()).toArray()
    const center = instance.root.position.clone().add(new T.Vector3(0, mounted ? 1.7 : 1.0, .4))
    const eye = center.clone().add(view === 'top' ? new T.Vector3(0, 6, 3) : view === 'side' ? new T.Vector3(-5, .2, 0) : new T.Vector3(-3.5, 1.0, 5))
    if (view === 'hands') { center.copy(palm).lerp(leftPalm, .5); eye.copy(center).add(new T.Vector3(-1, .5, .9)) }
    if (view === 'rightGrip' || view === 'leftGrip') {
      const hand = view === 'rightGrip' ? rh : lh, f = view === 'rightGrip' ? frames.lanceRight : shield ? frames.shieldLeft : frames.lanceLeft
      center.copy(view === 'rightGrip' ? palm : leftPalm)
      const normal = new T.Vector3(...f.palmNormalLocal).transformDirection(hand.matrixWorld)
      const fingers = new T.Vector3(...f.fingerDirection).transformDirection(hand.matrixWorld)
      eye.copy(center).addScaledVector(normal, .36).addScaledVector(fingers, .38).add(new T.Vector3(0, 0, .18))
    }
    g.camera.near = .001; g.camera.fov = view === 'top' ? 58 : 35; g.camera.updateProjectionMatrix()
    g.studioControls.minDistance = .01; g.studioControls.enableDamping = false
    g.studioControls.target.copy(center); g.camera.position.copy(eye); g.studioControls.update()
    for (const el of document.body.children) if (el.id !== 'canvas-container' && el.tagName !== 'SCRIPT') el.style.display = 'none'
    g.renderer.render(g.scene, g.camera)
    return { faction, shield, mounted, time, lod, view, weapon, motion, attack, yaw,
      gripError: palm.distanceTo(grip), leftError: leftPalm.distanceTo(shield ? shieldGrip : support),
      grip: local(grip), tip: local(tip), left: local(leftPalm), support: local(support),
      forwardDot: tip.clone().sub(grip).normalize().dot(new T.Vector3(0, 0, 1).transformDirection(instance.root.matrixWorld)),
      hips: local(level.getObjectByName('hips').getWorldPosition(new T.Vector3())),
      attachment: playback.lance.matrix.toArray(), shieldAttachment: playback.shield.matrix.toArray(),
      bones: ['upper_arm_r','lower_arm_r','hand_r','upper_arm_l','lower_arm_l','hand_l'].map(n=>({name:n,p:local(level.getObjectByName(n).getWorldPosition(new T.Vector3()))})) }
  }
  return '裝備姿勢診斷已就緒'
}
