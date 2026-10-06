import { publicAssetUrl } from '../assets/publicAssetUrl'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HumanoidAssetRegistry, type HumanoidAssetDescriptor, type HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { HumanoidStudioPlayback } from './HumanoidStudioPlayback'
import { CorgiVisual } from '../world/CorgiVisual'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { MAKI_HERO, MAKI_FALLBACK, loadMakiRangerBow, resolveMakiEquipmentMode } from '../world/MakiRangerEquipment'
import type { HumanoidAnimationState } from '../world/CharacterVisuals'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'

/** T4 is an asset label. This descriptor never enters UnitTier or battle setup. */
export const VIKING_HERO: HumanoidAssetDescriptor = HERO_ASSETS['viking-hero-t4'].descriptor

export const ROMAN_HERO: HumanoidAssetDescriptor = HERO_ASSETS['roman-hero-t4'].descriptor

export async function launchVikingHeroPreview(container: HTMLElement, descriptor = VIKING_HERO): Promise<void> {
  const maki = descriptor.assetId === MAKI_HERO.assetId
  const roman = descriptor.faction === 'roman'
  const faction = descriptor.faction
  const label = maki ? 'Maki · T4 遊俠英雄' : roman ? '羅馬禁衛軍 T4' : '維京英雄 · T4'
  const factionLabel = roman ? '羅馬人' : '維京'
  const weapon = roman ? 'sword' : 'axe'
  const actions = maki ? ['idle', 'walk', 'run', 'bowLoad', 'bowHold', 'bowRelease', 'axeAttack2H', 'death'] : roman ? ['idle', 'walk', 'run', 'swordSlash', 'mounted', 'death'] : ['idle', 'walk', 'run', 'axeAttack1H', 'axeAttack2H', 'mounted', 'death']
  for (const id of ['hud', 'crosshair']) { const element = document.getElementById(id); if (element) element.style.display = 'none' }
  const panel = document.createElement('aside')
  panel.id = 'hero-preview-controls'
  panel.style.cssText = 'position:fixed;left:16px;top:16px;z-index:10000;width:280px;padding:18px;background:#19212bed;color:#eef1f5;border-radius:10px;font:13px/1.7 system-ui;box-shadow:0 4px 24px #0003'
  panel.textContent = `正在載入${label}資產…`
  document.body.append(panel)
  try {
    await Promise.all([HumanoidAssetRegistry.preload(), HumanoidAssetRegistry.preloadAsset(descriptor), roman ? CorgiVisual.preload() : BlackCatVisual.preload()])
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
    const hero = HumanoidAssetRegistry.createCharacterInstance({ faction, tier: 2, isPlayer: false }, descriptor.assetId)
    const normal = HumanoidAssetRegistry.createCharacterInstance({ faction, tier: 2, isPlayer: false }, maki ? descriptor.assetId : undefined)
    scene.add(hero.root, normal.root)
    if (!maki) {
      normal.rig.animation!.play('idle', { fadeSeconds: 0, loop: true })
      normal.rig.animation!.update(.2)
    }
    const manifest = await fetch(publicAssetUrl(`models/characters/v2/${descriptor.assetId}/manifest.json`)).then(response => response.json())
    const playback = new HumanoidStudioPlayback(hero, 'idle', faction, roman ? 'CORGI' : 'BLACK_CAT', maki ? { bow: await loadMakiRangerBow(), meleeAnimation: MAKI_FALLBACK.animation } : undefined)
    playback.setEquipmentLoadout(maki ? 'bow' : 'none', false)
    const cat = roman ? new CorgiVisual() : new BlackCatVisual()
    cat.root.visible = false
    scene.add(cat.root)
    // DEV-only inspection of the actual rendered instance, selected mixers and equipment.
    Object.assign(window, { __heroPreview: { hero, normal, playback, scene, camera, controls, renderer, manifest } })
    let paused = false, time = 0, selectedLOD = 0, compare = !maki, riding = false
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
        const offset = new THREE.Vector3(...(roman ? manifest.attachmentOffsets.corgiPelvis : manifest.attachmentOffsets.blackCatPelvis) as [number, number, number])
        hero.root.position.add(seat.add(offset).sub(pelvis))
      }
      hero.root.updateMatrixWorld(true)
      if (riding && cat instanceof CorgiVisual) cat.fitRider(hero.root)
    }
    const sample = () => {
      if (state === 'death') {
        playback.reset()
        hero.rig.animation!.play('death', { fadeSeconds: 0, loop: false })
        // Settle Three's zero-duration fade before the exact paused sample.
        hero.rig.animation!.update(.001)
        hero.rig.animation!.seek('death', time)
        hero.rig.animation!.update(0)
      } else if (maki && state.startsWith('bow')) {
        playback.sampleBowComparison(time, 'gameplay')
      } else {
        const attack = state === 'axeAttack1H' || state === 'axeAttack2H' || state === 'swordSlash'
        playback.sampleEquipment(time, riding, state === 'walk' || state === 'run' ? state : 'idle', attack, duration())
      }
      if (!maki) { normal.rig.animation!.seek('idle', time); normal.rig.animation!.update(0) }
      place()
    }
    panel.innerHTML = `<strong style="font-size:18px">${label}</strong><div>DEV 資產預覽 · 世界單位：公尺</div>
      <label>視角 <select id="hero-camera"><option value="front">正面 · 正交</option><option value="side">嚴格側面 · 正交</option>${roman ? '<option value="back">背面 · 正交</option>' : ''}<option value="free">自由旋轉</option></select></label><br>
      <label>構圖 <select id="hero-framing"><option value="body">全身</option><option value="upper">上半身</option><option value="head">頭部近看</option><option value="legs">腿部與靴筒</option>${maki ? '<option value="hands">手／弓近看</option>' : ''}</select></label><br>
      <label><input id="hero-compare" type="checkbox" ${compare ? 'checked' : ''}> ${maki ? '原始持弓姿勢／比例比較（空手）' : `一般${factionLabel}並排比較`}</label><br>
      <label>動畫 <select id="hero-animation">${actions.map(name => `<option value="${name}">${maki && name === 'axeAttack2H' ? '弓近戰（雙手斧動作）' : name}</option>`).join('')}</select></label><br>
      <label>裝備 <select id="hero-equipment">${maki ? '<option value="bow">T4 Ranger Bow</option>' : `<option value="none">空手</option><option value="${weapon}">${roman ? '羅馬劍' : '長斧'}</option><option value="shield">${roman ? '羅馬劍＋方盾' : '長斧＋圓盾'}</option>`}</select></label><br>
      <label>LOD <select id="hero-lod"><option value="0">LOD0</option><option value="1">LOD1</option><option value="2">LOD2</option></select></label><br>
      <label ${maki ? 'hidden' : ''}><input id="hero-mounted" type="checkbox"> 騎${roman ? '柯基' : '黑貓'}</label><br>
      ${maki ? '<button id="hero-ammo-fallback">Ammo fallback preview</button> <button id="hero-ammo-refill">補箭 → Bow</button><div id="hero-ammo-status">有箭：遠程優先</div>' : ''}
      <button id="hero-pause">暫停</button> <button id="hero-replay">重新播放</button><br>
      <label>固定時間 <input id="hero-time" type="range" min="0" max="1" step="0.001" value="0" style="width:160px"></label>
      <div id="hero-status"></div><hr><div>${maki ? '來源 GLB 原始比例' : roman ? `一般羅馬解剖 ${manifest.metrics.sourceMeasurements.anatomicalHeightM.toFixed(3)} m` : '一般角色 1.86 m'}<br>${maki ? '鞋底至兜帽' : '英雄本體'} ${manifest.metrics.heightM.toFixed(3)} m${maki ? '' : `<br>含盔鞋 ${manifest.metrics.overallHeightM.toFixed(3)} m`}</div>
      <small>滑鼠拖曳旋轉，滾輪縮放。動畫只驗證姿勢，不產生戰鬥事件。</small>`
    const input = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!
    const status = input('hero-status')
    const slider = input<HTMLInputElement>('hero-time')
    const setCamera = () => {
      const view = input<HTMLSelectElement>('hero-camera').value
      const framing = input<HTMLSelectElement>('hero-framing').value
      const height = framing === 'hands' ? .9 : framing === 'head' ? .65 : framing === 'upper' ? (maki ? 1.1 : 1.45) : framing === 'legs' ? 1.3 : riding ? 4.4 : maki ? 1.95 : 2.8, aspect = innerWidth / innerHeight
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2
      camera.top = height / 2; camera.bottom = -height / 2
      camera.updateProjectionMatrix()
      const target = new THREE.Vector3(compare && !riding ? -.30 : -.38, riding ? 1.65 : 1.1, 0)
      if (view === 'side') target.x = 0
      if (framing !== 'body') { target.x = hero.root.position.x; target.y = hero.root.position.y + (framing === 'head' ? (roman ? 1.81 : 1.87) : framing === 'legs' ? .54 : 1.45) }
      if (maki && framing === 'head') target.y = 1.34
      if (maki && framing === 'upper') target.y = 1.08
      if (maki && framing === 'body') target.y = .86
      if (framing === 'hands') {
        hero.rig.left.wrist.getWorldPosition(target)
        target.lerp(hero.rig.right.wrist.getWorldPosition(new THREE.Vector3()), .5)
      }
      controls.target.copy(target)
      camera.position.copy(target).add(view === 'side' ? new THREE.Vector3(7, 0, 0) : view === 'back' ? new THREE.Vector3(0, 0, -7) : view === 'free' ? new THREE.Vector3(4, 1.2, 6) : new THREE.Vector3(0, 0, 7))
      camera.lookAt(target)
      controls.enableRotate = view === 'free'
      controls.update()
    }
    const equip = () => {
      const value = input<HTMLSelectElement>('hero-equipment').value
      playback.setEquipmentLoadout(value === 'bow' ? 'bow' : value === 'none' ? 'none' : weapon, value === 'shield')
    }
    const change = () => {
      state = input<HTMLSelectElement>('hero-animation').value as HumanoidAnimationState
      riding = state !== 'death' && (input<HTMLInputElement>('hero-mounted').checked || state === 'mounted')
      input<HTMLInputElement>('hero-mounted').checked = riding
      if (maki && state.startsWith('bow')) input<HTMLSelectElement>('hero-equipment').value = 'bow'
      if (state === 'swordSlash') input<HTMLSelectElement>('hero-equipment').value = 'shield'
      if (state === 'axeAttack1H') input<HTMLSelectElement>('hero-equipment').value = 'shield'
      if (state === 'axeAttack2H') input<HTMLSelectElement>('hero-equipment').value = maki ? 'bow' : weapon
      playback.state = riding && !state.startsWith('axe') && state !== 'swordSlash' ? 'mounted' : state
      equip(); time = 0; sample(); setCamera()
    }
    input('hero-camera').onchange = setCamera
    input('hero-framing').onchange = setCamera
    input('hero-animation').onchange = change
    input('hero-mounted').onchange = () => {
      if (!input<HTMLInputElement>('hero-mounted').checked && state === 'mounted') input<HTMLSelectElement>('hero-animation').value = 'idle'
      change()
    }
    input('hero-equipment').onchange = () => {
      if (maki) { input<HTMLSelectElement>('hero-animation').value = 'idle'; change() }
      else { equip(); sample() }
    }
    if (maki) {
      let sequence = 0
      const ammo = (arrows: number) => {
        const ranged = resolveMakiEquipmentMode(arrows) === 'ranged'
        input<HTMLSelectElement>('hero-equipment').value = 'bow'
        input<HTMLSelectElement>('hero-animation').value = ranged ? 'bowHold' : 'axeAttack2H'
        input('hero-ammo-status').textContent = ranged ? '有箭：遠程優先 · T4 Bow' : '箭矢耗盡 → T4 弓近戰 · 雙手斧揮擊'
        paused = false; input('hero-pause').textContent = '暫停'; change()
      }
      input('hero-ammo-fallback').onclick = () => { const current = ++sequence; ammo(1); setTimeout(() => { if (sequence === current) ammo(0) }, 1100) }
      input('hero-ammo-refill').onclick = () => { ++sequence; ammo(1) }
    }
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
    console.error(`${descriptor.assetId} preview failed`, error)
  }
}
