import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import type { HumanoidStudioPlayback } from './HumanoidStudioPlayback'

/** Studio-only fixed-time visual comparisons, operated through visible controls. */
export function createBowComparisonPanel(
  playbacks: Map<HumanoidCharacterInstance, HumanoidStudioPlayback>,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
  freeze: () => OrbitControls,
  restore: () => void,
): void {
  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;top:65px;left:16px;z-index:50;background:#18212eee;color:white;padding:10px;font:13px system-ui;max-width:300px'
  panel.innerHTML = `<b>持弓診斷（固定時間）</b><br>
    <label>角色 <select id="bow-qa-faction"><option>viking</option><option>roman</option></select></label>
    <label>動作 <select id="bow-qa-state"><option>bowLoad</option><option>bowHold</option><option>bowRelease</option></select></label><br>
    <label>比較 <select id="bow-qa-mode"><option value="current">Current Bow</option><option value="legacy">Legacy Bow reference（僅手臂）</option><option value="raw">Raw GLB</option><option value="gameplay">Full gameplay/equipment</option></select></label><br>
    <label>移動 <select id="bow-qa-motion"><option>idle</option><option>walk</option><option>run</option></select></label><br>
    <label>時間 0–1 <input id="bow-qa-time" type="number" min="0" max="1" step="0.05" value="0.65" style="width:60px"></label>
    <label>視角 <select id="bow-qa-view"><option value="palm">掌側</option><option value="opposite">對側</option><option value="top">持弓手俯視</option><option value="topHands">俯視雙手</option><option value="drawTop">拉弓手俯視</option><option value="drawPalm">拉弓手掌側</option><option value="drawOpposite">拉弓手對側</option><option value="drawOblique">拉弓手 45°</option><option value="axis">弓軸正面</option><option value="oblique">45°</option><option value="body">全身</option><option value="bind">Bind 掌面</option><option value="bindOpposite">Bind 對側</option><option value="bindX">Bind X</option><option value="bindNegX">Bind -X</option></select></label><br>
    <button id="bow-qa-apply">顯示固定畫格</button><button id="bow-qa-restore">返回全部展示</button><div id="bow-qa-status"></div>`
  panel.addEventListener('keydown', event => event.stopPropagation())
  document.body.append(panel)
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
  panel.querySelector<HTMLButtonElement>('#bow-qa-restore')!.onclick = () => {
    for (const [instance, playback] of playbacks) { instance.root.visible = true; playback.reset() }
    scene.traverse(object => { if (object instanceof THREE.Sprite) object.visible = true })
    restore()
  }
  panel.querySelector<HTMLButtonElement>('#bow-qa-apply')!.onclick = () => {
    const controls = freeze()
    const faction = value('bow-qa-faction'), state = value('bow-qa-state')
    const mode = value('bow-qa-mode') as 'current' | 'legacy' | 'raw' | 'gameplay'
    const time = THREE.MathUtils.clamp(Number(value('bow-qa-time')), 0, 1)
    const selected = [...playbacks].find(([instance, playback]) => playback.faction === faction && instance.root.userData.studioState === state)!
    for (const [instance] of playbacks) instance.root.visible = instance === selected[0]
    scene.traverse(object => { if (object instanceof THREE.Sprite) object.visible = false })
    const [instance, playback] = selected
    const motion = value('bow-qa-motion') as 'idle' | 'walk' | 'run'
    playback.sampleBowComparison(time, mode, motion)
    const hand = instance.rig.left.wrist
    const view = value('bow-qa-view')
    if (view.startsWith('bind')) {
      instance.rig.animation!.stop()
      instance.root.traverse(object => {
        const rest = object.userData.humanoidRestQuaternion
        if (rest) object.quaternion.fromArray(rest)
      })
      playback.bow.visible = false
    }
    instance.root.updateMatrixWorld(true)
    const frame = instance.rig.handGripFrames!.left
    const center = hand.localToWorld(frame.palmContactCenter.clone())
    const drawHand = instance.rig.right.wrist
    const drawCenter = drawHand.getWorldPosition(new THREE.Vector3()).lerp(drawHand.getObjectByName('bow_string_contact')!.getWorldPosition(new THREE.Vector3()), .5)
    const drawNormal = new THREE.Vector3().fromArray(drawHand.userData.bowHandFrame.palmNormal).transformDirection(drawHand.matrixWorld)
    const bothCenter = center.clone().lerp(drawCenter, 0.5)
    const normal = frame.palmNormal.clone().transformDirection(hand.matrixWorld)
    const thumb = (frame.thumbDirection?.clone() ?? new THREE.Vector3(frame.thumbDir, 0, 0)).transformDirection(hand.matrixWorld)
    const tangent = new THREE.Vector3().crossVectors(normal, thumb).normalize()
    const direction = view === 'drawPalm' ? drawNormal : view === 'drawOpposite' ? drawNormal.clone().negate() : view === 'drawOblique' ? drawNormal.clone().add(new THREE.Vector3(0, .5, 1)).normalize() : view === 'bindX' ? new THREE.Vector3(1,0,0).transformDirection(hand.matrixWorld) : view === 'bindNegX' ? new THREE.Vector3(-1,0,0).transformDirection(hand.matrixWorld) : view === 'bindOpposite' ? normal.clone().negate() : view === 'palm' || view === 'bind' ? normal : view === 'opposite' ? normal.clone().negate()
      : ['top', 'topHands', 'drawTop'].includes(view) ? new THREE.Vector3(0.03, 1, 0.08).normalize() : view === 'axis' ? new THREE.Vector3(0, 0, 1)
        : normal.clone().sub(tangent).normalize()
    controls.minDistance = 0.12
    controls.enableDamping = false
    camera.fov = view === 'body' ? 40 : view === 'topHands' ? 40 : 16
    camera.near = 0.005
    camera.updateProjectionMatrix()
    controls.target.copy(view === 'body' ? instance.root.position.clone().add(new THREE.Vector3(0, 1, 0)) : view === 'topHands' ? bothCenter : view.startsWith('draw') ? drawCenter : center)
    camera.position.copy(controls.target).addScaledVector(view === 'body' ? new THREE.Vector3(0.6, 0.2, 1).normalize() : direction, view === 'body' ? 3.8 : view === 'topHands' ? 2.2 : 1.3)
    controls.update()
    document.getElementById('bow-qa-status')!.textContent = `${faction} / ${state} / ${mode} / ${motion} / t=${time} / ${view}（未判定）`
  }
}
