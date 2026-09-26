import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HumanoidAssetRegistry, type HumanoidAssetDescriptor, type HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { HumanoidStudioPlayback } from './HumanoidStudioPlayback'
import { BlackCatVisual } from '../world/BlackCatVisual'
import type { HumanoidAnimationState } from '../world/CharacterVisuals'

/** T4 is an asset label. This descriptor never enters UnitTier or battle setup. */
export const VIKING_HERO: HumanoidAssetDescriptor = {
  assetId: 'viking-hero-t4', faction: 'viking', heightM: 2, maxShoulderWidthM: .78, neckLengthM: .11,
}

export async function launchVikingHeroPreview(container: HTMLElement): Promise<void> {
  for (const id of ['hud', 'crosshair']) { const element = document.getElementById(id); if (element) element.style.display = 'none' }
  const panel = document.createElement('aside')
  panel.id = 'hero-preview-controls'
  panel.style.cssText = 'position:fixed;left:16px;top:16px;z-index:10000;width:280px;padding:18px;background:#19212bed;color:#eef1f5;border-radius:10px;font:13px/1.7 system-ui;box-shadow:0 4px 24px #0003'
  panel.textContent = '正在載入維京英雄資產…'
  document.body.append(panel)
  try {
    await Promise.all([HumanoidAssetRegistry.preload(), HumanoidAssetRegistry.preloadAsset(VIKING_HERO)])
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#b4bac1')
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    container.append(renderer.domElement)
    const environment = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(environment, .04).texture
    environment.dispose(); pmrem.dispose()
    const camera = new THREE.OrthographicCamera(-3, 3, 2.5, -2.5, .01, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.2, 0)
    controls.enableDamping = false
    scene.add(new THREE.HemisphereLight(0xffffff, 0x747580, 2.2))
    for (const [x, z, intensity] of [[-3, 4, 2], [3, -2, 1.5]]) {
      const light = new THREE.DirectionalLight(0xffffff, intensity)
      light.position.set(x, 5, z)
      scene.add(light)
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xa7adb4, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -.006
    scene.add(ground, new THREE.GridHelper(10, 20, 0x888f99, 0x9ca3ac))
    const hero = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false }, VIKING_HERO.assetId)
    const normal = HumanoidAssetRegistry.createCharacterInstance({ faction: 'viking', tier: 2, isPlayer: false })
    scene.add(hero.root, normal.root)
    normal.rig.animation!.play('idle', { fadeSeconds: 0, loop: true })
    normal.rig.animation!.update(.2)
    const playback = new HumanoidStudioPlayback(hero, 'idle', 'viking', 'BLACK_CAT')
    playback.setEquipmentLoadout('none', false)
    const cat = new BlackCatVisual()
    cat.root.visible = false
    scene.add(cat.root)
    const manifest = await fetch('/models/characters/v2/viking-hero-t4/manifest.json').then(response => response.json())
    let paused = false, time = 0, selectedLOD = 0, compare = true, riding = false
    let state: HumanoidAnimationState = 'idle'
    const duration = () => hero.rig.animation!.getDuration(state) ?? 1
    const setLOD = (instance: HumanoidCharacterInstance, index: number) => {
      const lod = instance.root.children.find(object => object instanceof THREE.LOD) as THREE.LOD
      lod.autoUpdate = false
      lod.levels.forEach((level, i) => { level.object.visible = i === index })
      // Explicit studio selection must also evaluate the selected mixer.
      const animation = instance.rig.animation as typeof instance.rig.animation & { setVisibleLOD(index: number): void }
      animation!.setVisibleLOD(index)
    }
    const place = () => {
      normal.root.visible = compare && !riding
      normal.root.position.set(-.85, 0, 0)
      hero.root.position.set(compare && !riding ? .65 : 0, 0, 0)
      cat.root.visible = riding
      if (riding) {
        hero.root.updateMatrixWorld(true)
        const pelvis = hero.rig.pelvis!.getWorldPosition(new THREE.Vector3())
        const seat = cat.saddleSeat.getWorldPosition(new THREE.Vector3())
        const offset = new THREE.Vector3(...manifest.attachmentOffsets.blackCatPelvis as [number, number, number])
        hero.root.position.add(seat.add(offset).sub(pelvis))
      }
      hero.root.updateMatrixWorld(true)
    }
    const sample = () => {
      if (state === 'death') {
        playback.reset()
        hero.rig.animation!.play('death', { fadeSeconds: 0, loop: false })
        // Settle Three's zero-duration fade before the exact paused sample.
        hero.rig.animation!.update(.001)
        hero.rig.animation!.seek('death', time)
        hero.rig.animation!.update(0)
      } else {
        playback.sampleEquipment(time, riding, state === 'walk' || state === 'run' ? state : 'idle', state === 'axeAttack1H' || state === 'axeAttack2H', duration())
      }
      normal.rig.animation!.seek('idle', time)
      normal.rig.animation!.update(0)
      place()
    }
    panel.innerHTML = `<strong style="font-size:18px">維京英雄 · T4</strong><div>DEV 資產預覽 · 世界單位：公尺</div>
      <label>視角 <select id="hero-camera"><option value="front">正面 · 正交</option><option value="side">嚴格側面 · 正交</option><option value="free">自由旋轉</option></select></label><br>
      <label>構圖 <select id="hero-framing"><option value="body">全身</option><option value="upper">上半身</option><option value="head">頭部近看</option><option value="legs">腿部與靴筒</option></select></label><br>
      <label><input id="hero-compare" type="checkbox" checked> 一般維京並排比較</label><br>
      <label>動畫 <select id="hero-animation">${['idle', 'walk', 'run', 'axeAttack1H', 'axeAttack2H', 'mounted', 'death'].map(name => `<option>${name}</option>`).join('')}</select></label><br>
      <label>裝備 <select id="hero-equipment"><option value="none">空手</option><option value="axe">長斧</option><option value="shield">長斧＋圓盾</option></select></label><br>
      <label>LOD <select id="hero-lod"><option value="0">LOD0</option><option value="1">LOD1</option><option value="2">LOD2</option></select></label><br>
      <label><input id="hero-mounted" type="checkbox"> 騎黑貓</label><br>
      <button id="hero-pause">暫停</button> <button id="hero-replay">重新播放</button><br>
      <label>固定時間 <input id="hero-time" type="range" min="0" max="1" step="0.001" value="0" style="width:160px"></label>
      <div id="hero-status"></div><hr><div>一般角色 1.86 m<br>英雄本體 ${manifest.metrics.heightM.toFixed(3)} m<br>含盔鞋 ${manifest.metrics.overallHeightM.toFixed(3)} m</div>
      <small>滑鼠拖曳旋轉，滾輪縮放。動畫只驗證姿勢，不產生戰鬥事件。</small>`
    const input = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!
    const status = input('hero-status')
    const slider = input<HTMLInputElement>('hero-time')
    const setCamera = () => {
      const view = input<HTMLSelectElement>('hero-camera').value
      const framing = input<HTMLSelectElement>('hero-framing').value
      const height = framing === 'head' ? .65 : framing === 'upper' ? 1.45 : framing === 'legs' ? 1.3 : riding ? 4.4 : 2.8, aspect = innerWidth / innerHeight
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2
      camera.top = height / 2; camera.bottom = -height / 2
      camera.updateProjectionMatrix()
      const target = new THREE.Vector3(compare && !riding ? -.30 : -.38, riding ? 1.65 : 1.1, 0)
      if (view === 'side') target.x = 0
      if (framing !== 'body') { target.x = hero.root.position.x; target.y = hero.root.position.y + (framing === 'head' ? 1.87 : framing === 'legs' ? .54 : 1.45) }
      controls.target.copy(target)
      camera.position.copy(target).add(view === 'side' ? new THREE.Vector3(7, 0, 0) : view === 'free' ? new THREE.Vector3(4, 1.2, 6) : new THREE.Vector3(0, 0, 7))
      camera.lookAt(target)
      controls.enableRotate = view === 'free'
      controls.update()
    }
    const equip = () => {
      const value = input<HTMLSelectElement>('hero-equipment').value
      playback.setEquipmentLoadout(value === 'none' ? 'none' : 'axe', value === 'shield')
    }
    const change = () => {
      state = input<HTMLSelectElement>('hero-animation').value as HumanoidAnimationState
      riding = state !== 'death' && (input<HTMLInputElement>('hero-mounted').checked || state === 'mounted')
      input<HTMLInputElement>('hero-mounted').checked = riding
      if (state === 'axeAttack1H') input<HTMLSelectElement>('hero-equipment').value = 'shield'
      if (state === 'axeAttack2H') input<HTMLSelectElement>('hero-equipment').value = 'axe'
      playback.state = riding && !state.startsWith('axe') ? 'mounted' : state
      equip(); time = 0; sample(); setCamera()
    }
    input('hero-camera').onchange = setCamera
    input('hero-framing').onchange = setCamera
    input('hero-animation').onchange = change
    input('hero-mounted').onchange = () => {
      if (!input<HTMLInputElement>('hero-mounted').checked && state === 'mounted') input<HTMLSelectElement>('hero-animation').value = 'idle'
      change()
    }
    input('hero-equipment').onchange = () => { equip(); sample() }
    input('hero-compare').onchange = () => { compare = input<HTMLInputElement>('hero-compare').checked; place(); setCamera() }
    input('hero-lod').onchange = () => {
      selectedLOD = Number(input<HTMLSelectElement>('hero-lod').value)
      setLOD(hero, selectedLOD); setLOD(normal, selectedLOD); sample()
    }
    input('hero-pause').onclick = () => { paused = !paused; input('hero-pause').textContent = paused ? '播放' : '暫停' }
    input('hero-replay').onclick = () => { time = 0; playback.reset(); sample() }
    slider.oninput = () => { paused = true; input('hero-pause').textContent = '播放'; time = Number(slider.value); sample() }
    setLOD(hero, 0); setLOD(normal, 0); sample(); setCamera()
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); setCamera() })
    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), .05)
      if (!paused) {
        time += dt / duration()
        if (time > 1) { time = state === 'death' ? 1 : time % 1; if (state !== 'death') playback.reset() }
        // Same fixed-time path for playback and screenshots; no hidden state drift.
        sample()
      }
      slider.value = String(time)
      status.textContent = `LOD${selectedLOD} · ${(time * duration()).toFixed(3)} s / ${duration().toFixed(3)} s · ${paused ? '已暫停' : '播放中'}`
      controls.update(); renderer.render(scene, camera)
    })
  } catch (error) {
    panel.style.color = '#ffb4b4'
    panel.textContent = `英雄資產載入失敗：${error instanceof Error ? error.message : String(error)}`
    console.error('Viking hero preview failed', error)
  }
}
