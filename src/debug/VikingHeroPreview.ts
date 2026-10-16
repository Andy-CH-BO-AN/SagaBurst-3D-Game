import { preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HumanoidAssetRegistry, type HumanoidAssetDescriptor, type HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { HumanoidStudioPlayback } from './HumanoidStudioPlayback'
import { CorgiVisual } from '../world/CorgiVisual'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { XongkoroVisual } from '../world/XongkoroVisual'
import { HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET } from '../world/Mount'
import { fitStandingRider } from '../world/StandingRider'
import { MAKI_HERO, loadMakiRangerBow } from '../world/MakiRangerEquipment'
import type { HumanoidAnimationState, MountedPoseKind } from '../world/CharacterVisuals'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'

/** T4 is an asset label. This descriptor never enters UnitTier or battle setup. */
export const VIKING_HERO: HumanoidAssetDescriptor = HERO_ASSETS['viking-hero-t4'].descriptor

export const ROMAN_HERO: HumanoidAssetDescriptor = HERO_ASSETS['roman-hero-t4'].descriptor

export async function launchVikingHeroPreview(container: HTMLElement, descriptor = VIKING_HERO): Promise<void> {
  const maki = descriptor.assetId === MAKI_HERO.assetId
  const civilian = descriptor.assetId.endsWith('-civilian')
  const commander = descriptor.assetId.endsWith('-t5')
  const roman = descriptor.faction === 'roman'
  const faction = descriptor.faction
  const label = civilian ? (roman ? 'Roman Civilian · Roman Statesman' : 'Viking Civilian · Nordic Warrior') : commander ? (roman ? '禁衛軍指揮官 · Roman T5' : '鐵衛指揮官 · Viking T5') : maki ? 'Shadow Warden · T4 遊俠英雄' : roman ? '聖騎士 Paladin T4' : '維京英雄 · T4'
  const reference = commander ? (roman ? ROMAN_HERO : VIKING_HERO) : undefined
  const factionLabel = roman ? '羅馬人' : '維京'
  const actions: HumanoidAnimationState[] = ['idle', 'walk', 'run', 'swordSlash', 'axeAttack1H', 'axeAttack1HFoot', 'axeAttack2H', 'daggerSlash', 'greatswordSlash', 'lanceThrust', 'mountedLance', 'bowLoad', 'bowHold', 'bowRelease', 'pilumThrow', 'hit', 'mounted', 'axeMountedIdle', 'death']
  const sourceOnlyStates = new Set<HumanoidAnimationState>(['daggerSlash', 'greatswordSlash', 'axeAttack1HFoot'])
  for (const id of ['hud', 'crosshair']) { const element = document.getElementById(id); if (element) element.style.display = 'none' }
  const panel = document.createElement('aside')
  panel.id = 'hero-preview-controls'
  panel.style.cssText = 'position:fixed;left:16px;top:16px;z-index:10000;width:280px;padding:18px;background:#19212bed;color:#eef1f5;border-radius:10px;font:13px/1.7 system-ui;box-shadow:0 4px 24px #0003'
  panel.textContent = `正在載入${label}資產…`
  document.body.append(panel)
  try {
    await Promise.all([preloadPaladinEquipment(), preloadHighTierEquipment(), HumanoidAssetRegistry.preload(), HumanoidAssetRegistry.preloadAsset(descriptor), ...(reference ? [HumanoidAssetRegistry.preloadAsset(reference)] : []), CorgiVisual.preload(), BlackCatVisual.preload(), XongkoroVisual.preload()])
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#b4bac1')
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    container.append(renderer.domElement)
    await HorseAssetRegistry.preload(renderer)
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
    const availableActions = actions.filter(action => hero.rig.animation!.has(action))
    const normal = HumanoidAssetRegistry.createCharacterInstance({ faction, tier: 2, isPlayer: false }, reference?.assetId)
    scene.add(hero.root, normal.root)
    normal.rig.animation!.play('idle', { fadeSeconds: 0, loop: true })
    normal.rig.animation!.update(.2)
    const manifest = await fetch(publicAssetUrl(`models/characters/v2/${descriptor.assetId}/manifest.json`)).then(response => response.json())
    const playback = new HumanoidStudioPlayback(hero, 'idle', faction, roman ? 'CORGI' : 'BLACK_CAT', maki ? { bow: await loadMakiRangerBow() } : undefined, { swordId: 'paladin_sword_t4', axeId: 'paladin_mace_t4', shieldId: 'paladin_shield_t4' })
    playback.setEquipmentLoadout('none', false)
    const mounts = { CORGI: new CorgiVisual(), BLACK_CAT: new BlackCatVisual(), HORSE: HorseAssetRegistry.createInstance(), xongkoro: new XongkoroVisual() }
    for (const mount of Object.values(mounts)) { mount.root.visible = false; scene.add(mount.root) }
    let mountKind: MountedPoseKind = roman ? 'CORGI' : 'BLACK_CAT'
    // DEV-only inspection of the actual rendered instance, selected mixers and equipment.
    Object.assign(window, { __heroPreview: { hero, normal, playback, scene, camera, controls, renderer, manifest, mounts } })
    let paused = false, time = 0, selectedLOD = 0, compare = true, riding = false, sourcePlayback = ''
    let state: HumanoidAnimationState = 'idle'
    const duration = () => !sourcePlayback && ['axeAttack1H', 'axeAttack2H', 'swordSlash', 'lanceThrust', 'mountedLance'].includes(state)
      ? playback.getAttackDuration(riding) : hero.rig.animation!.getDuration(state) ?? 1
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
      for (const [kind, mount] of Object.entries(mounts)) mount.root.visible = riding && kind === mountKind
      const mount = mounts[mountKind]
      if (riding && mount instanceof XongkoroVisual) {
        mount.update(0, { flying: true, sprinting: false, attackWeight: 0, dead: false })
        fitStandingRider(hero.root, hero.rig, mount.standingSocket)
      } else if (riding && 'saddleSeat' in mount) {
        hero.root.updateMatrixWorld(true)
        const pelvis = hero.rig.pelvis!.getWorldPosition(new THREE.Vector3())
        // Match Mount.getRiderPelvisSeatWorld, including the fitted horse seat
        // and Corgi contact clearance used by real Player and NPC riders.
        const seat = (mount instanceof CorgiVisual ? mount.riderPelvisSeat : mount.saddleSeat).getWorldPosition(new THREE.Vector3())
        if (mountKind === 'HORSE') seat.add(new THREE.Vector3(0, 0, HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET).applyQuaternion(mount.root.getWorldQuaternion(new THREE.Quaternion())))
        hero.root.position.add(seat.sub(pelvis))
      }
      hero.root.updateMatrixWorld(true)
      if (riding && mount instanceof CorgiVisual) mount.fitRider(hero.root)
      if (riding && mount instanceof BlackCatVisual) mount.fitRider(hero.root)
    }
    const sample = () => {
      if (sourcePlayback) {
        playback.setEquipped(sourcePlayback === 'source-equipped')
        playback.sampleSourceClip(time, riding, false)
      } else if (sourceOnlyStates.has(state)) {
        playback.sampleSourceClip(time, riding, false)
      } else if (state === 'death' || state === 'hit' || state === 'axeMountedIdle') {
        playback.sampleSourceClip(time, riding)
      } else if (state.startsWith('bow')) {
        playback.sampleBowComparison(time, 'gameplay', 'idle', riding)
      } else if (state === 'pilumThrow') {
        playback.samplePilum(time, riding)
      } else {
        const attack = state === 'axeAttack1H' || state === 'axeAttack2H' || state === 'swordSlash' || state === 'lanceThrust' || state === 'mountedLance'
        playback.sampleEquipment(time, riding, state === 'walk' || state === 'run' ? state : 'idle', attack, duration())
      }
      normal.rig.animation!.seek('idle', time); normal.rig.animation!.update(0)
      place()
    }
    panel.innerHTML = `<strong style="font-size:18px">${label}</strong><div>DEV 資產預覽 · 世界單位：公尺</div>
      <label>視角 <select id="hero-camera"><option value="front">正面 · 正交</option><option value="side">嚴格側面 · 正交</option><option value="back">背面 · 正交</option><option value="free">自由旋轉</option></select></label><br>
      <label>構圖 <select id="hero-framing"><option value="body">全身</option><option value="upper">上半身</option><option value="head">頭部近看</option><option value="legs">腿部與靴筒</option><option value="hands">手／武器近看</option></select></label><br>
      <label><input id="hero-compare" type="checkbox" ${compare ? 'checked' : ''}> ${commander ? '同陣營 T4 並排比較' : `一般${factionLabel}並排比較`}</label><br>
      <label>播放方式 <select id="hero-playback"><option value="equipment">遊戲裝備</option><option value="source">原始片段 · 無裝備</option><option value="source-equipped">原始片段 · 武器接點</option></select></label><br>
      <label>動畫 <select id="hero-animation">${availableActions.map(name => `<option value="${name}">${name === 'hit' ? 'hit · 來源動作（不代表戰鬥受擊）' : sourceOnlyStates.has(name) ? `${name} · 來源片段` : name}</option>`).join('')}</select></label><br>
      <label>裝備 <select id="hero-equipment"><option value="none">空手</option><option value="sword">Paladin Sword</option><option value="axe">Paladin Mace</option><option value="shield">Sword + Shield</option><option value="axe-shield">Mace + Shield</option><option value="selected-axe">Viking Axe</option><option value="selected-axe-shield">Axe + Shield</option><option value="lance">Lance</option><option value="bow">${maki ? 'T4 Ranger Bow' : 'Bow'}</option></select></label><br>
      <label><input id="hero-shield-raised" type="checkbox"> 舉盾</label><br>
      <label>LOD <select id="hero-lod"><option value="0">LOD0</option><option value="1">LOD1</option><option value="2">LOD2</option></select></label><br>
      <label><input id="hero-mounted" type="checkbox"> 騎乘 <select id="hero-mount"><option value="HORSE">Horse</option><option value="BLACK_CAT" ${!roman ? 'selected' : ''}>Black Cat</option><option value="CORGI" ${roman ? 'selected' : ''}>Corgi</option><option value="xongkoro">xongkoro 飛行姿勢</option></select></label><br>
      <button id="hero-pause">暫停</button> <button id="hero-replay">重新播放</button><br>
      <label>固定時間 <input id="hero-time" type="range" min="0" max="1" step="0.001" value="0" style="width:160px"></label>
      <div id="hero-status"></div><hr><div>${commander ? '來源 T5 模型 · 同陣營 T4 身體尺度校準' : maki || civilian ? '新模型 · 一般 Humanoid 裝備' : roman ? 'Paladin 原始模型適配' : '一般角色 1.86 m'}<br>${civilian ? '含鞋全高' : commander ? '含盔鞋全高' : maki ? '鞋底至兜帽' : roman ? '含頭盔角飾全高' : '英雄本體'} ${manifest.metrics.heightM.toFixed(3)} m${commander || maki || civilian || roman ? '' : `<br>含盔鞋 ${manifest.metrics.overallHeightM.toFixed(3)} m`}</div>
      <small>滑鼠拖曳旋轉，滾輪縮放。動畫只驗證姿勢，不產生戰鬥事件。</small>`
    const input = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!
    const status = input('hero-status')
    const slider = input<HTMLInputElement>('hero-time')
    const setCamera = () => {
      const view = input<HTMLSelectElement>('hero-camera').value
      const framing = input<HTMLSelectElement>('hero-framing').value
      const height = framing === 'hands' ? .9 : framing === 'head' ? .65 : framing === 'upper' ? 1.45 : framing === 'legs' ? 1.3 : riding ? 4.4 : 2.8, aspect = innerWidth / innerHeight
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2
      camera.top = height / 2; camera.bottom = -height / 2
      camera.updateProjectionMatrix()
      const target = new THREE.Vector3(compare && !riding ? -.30 : -.38, riding ? 1.65 : 1.1, 0)
      if (riding && mountKind === 'xongkoro') {
        hero.rig.pelvis!.getWorldPosition(target)
        target.y += .3
      }
      if (view === 'side') target.x = 0
      if (framing !== 'body') { target.x = hero.root.position.x; target.y = hero.root.position.y + (framing === 'head' ? (roman ? 1.81 : 1.87) : framing === 'legs' ? .54 : 1.45) }
      if (framing === 'hands') {
        hero.rig.left.wrist.getWorldPosition(target)
        target.lerp(hero.rig.right.wrist.getWorldPosition(new THREE.Vector3()), .5)
      }
      controls.target.copy(target)
      const distance = riding && mountKind === 'xongkoro' ? 20 : 7
      camera.position.copy(target).add(view === 'side' ? new THREE.Vector3(distance, 0, 0) : view === 'back' ? new THREE.Vector3(0, 0, -distance) : view === 'free' ? new THREE.Vector3(distance * .57, 1.2, distance * .86) : new THREE.Vector3(0, 0, distance))
      camera.lookAt(target)
      controls.enableRotate = view === 'free'
      controls.update()
    }
    const equip = () => {
      const selected = input<HTMLSelectElement>('hero-equipment').value
      playback.setAxeVariant(selected.startsWith('selected-axe'))
      const value = selected.replace('selected-', '')
      playback.shieldRaised = input<HTMLInputElement>('hero-shield-raised').checked
      playback.setEquipmentLoadout(value === 'axe-shield' ? 'axe' : value === 'shield' ? 'sword' : value as 'none' | 'sword' | 'axe' | 'lance' | 'bow', value === 'shield' || value === 'axe-shield')
    }
    const change = () => {
      state = input<HTMLSelectElement>('hero-animation').value as HumanoidAnimationState
      riding = state !== 'death' && (input<HTMLInputElement>('hero-mounted').checked || state === 'mounted' || state === 'mountedLance')
      input<HTMLInputElement>('hero-mounted').checked = riding
      if (state.startsWith('bow')) input<HTMLSelectElement>('hero-equipment').value = 'bow'
      if (state === 'lanceThrust' || state === 'mountedLance') input<HTMLSelectElement>('hero-equipment').value = 'lance'
      if (state === 'swordSlash') input<HTMLSelectElement>('hero-equipment').value = 'shield'
      if (state === 'axeAttack1H') input<HTMLSelectElement>('hero-equipment').value = 'selected-axe-shield'
      if (state === 'axeAttack2H' || state === 'axeMountedIdle') input<HTMLSelectElement>('hero-equipment').value = 'selected-axe'
      playback.state = riding && (state === 'idle' || state === 'walk' || state === 'run') ? 'mounted' : state
      equip(); time = 0; sample(); setCamera()
    }
    input('hero-shield-raised').onchange = () => { equip(); sample() }
    input('hero-camera').onchange = setCamera
    input('hero-framing').onchange = setCamera
    input('hero-animation').onchange = change
    input('hero-mount').onchange = () => {
      mountKind = input<HTMLSelectElement>('hero-mount').value as MountedPoseKind
      playback.mountKind = mountKind
      change()
    }
    input('hero-mounted').onchange = () => {
      if (!input<HTMLInputElement>('hero-mounted').checked && state === 'mounted') input<HTMLSelectElement>('hero-animation').value = 'idle'
      change()
    }
    input('hero-equipment').onchange = () => { equip(); sample() }
    input('hero-playback').onchange = () => {
      sourcePlayback = input<HTMLSelectElement>('hero-playback').value === 'equipment' ? '' : input<HTMLSelectElement>('hero-playback').value
      playback.setEquipped(!sourcePlayback)
      time = 0; sample()
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
