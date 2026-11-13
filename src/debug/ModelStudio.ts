import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Player } from '../player/Player'
import type { HumanoidAnimationState } from '../world/CharacterVisuals'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import {
  horseVariantForStableKey,
  type HorseAnimationState,
  type HorseAppearanceVariant,
} from '../world/HorseAssetRegistry'
import { HumanoidAssetRegistry, type HumanoidCharacterInstance } from '../world/HumanoidAssetRegistry'
import { DEFAULT_MOUNT_TYPE, Mount, MountType, mountTypeFromId } from '../world/Mount'
import { QUADRUPED_STUDIO_CLIPS } from '../world/QuadrupedMountAnimation'
import { createBowComparisonPanel } from './BowComparisonPanel'
import { HumanoidStudioPlayback } from './HumanoidStudioPlayback'
import { MountStudioSeatContact } from './MountStudioSeatContact'

/** Studio floor sits above the battlefield terrain so preview models never clip into it. */
export const MODEL_STUDIO_FLOOR_Y = 8

const HORSE_STUDIO_CLIPS: HorseAnimationState[] = [
  'idle',
  'walk',
  'trot',
  'canter',
  'gallop',
  'jump',
  'land',
  'hit',
  'death',
]

const MOUNT_STUDIO_MODELS = new Set([
  'armored-horse', 'mounts', 'black-cat', 'white-cat', 'orange-cat', 'serval', 'caracal', 'corgi', 'snow-leopard',
])

export type ModelStudioMode = 'humans' | 'mounts'

/** Maps the DEV `?devmodels=` query value to a studio mode; unknown values keep the normal battle. */
export function resolveModelStudioMode(devModels: string | null): ModelStudioMode | null {
  if (devModels === 'humans') return 'humans'
  return devModels !== null && MOUNT_STUDIO_MODELS.has(devModels) ? 'mounts' : null
}

/** What the studio borrows from the hosting battle scene. */
export interface ModelStudioHost {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly player: Player
  /** The host's mount list; studio mounts are pushed here so the battle loop animates them. */
  readonly mounts: Mount[]
  showRiddenMountHud(mount: Mount): void
}

/**
 * DEV-only humanoid / mount animation studio (`?devmodels=`).
 * The hosting Game keeps its scene, loop and renderer; this module owns the
 * preview models, orbit camera, help panels and studio keyboard shortcuts.
 */
export class ModelStudio {
  private controls: OrbitControls | null = null
  private showcase: HumanoidCharacterInstance[] = []
  private playback = new Map<HumanoidCharacterInstance, HumanoidStudioPlayback>()
  private equipped = true
  private paused = false
  private skeletonHelpers: THREE.SkeletonHelper[] = []
  private previewMount: Mount | null = null
  private rider: HumanoidCharacterInstance | null = null
  private riderPelvisHeight = 0
  private seatContacts = new WeakMap<HumanoidCharacterInstance, MountStudioSeatContact>()
  private mountSkeleton: THREE.SkeletonHelper | null = null
  private statusEl: HTMLElement | null = null

  constructor(
    readonly mode: ModelStudioMode,
    private readonly host: ModelStudioHost,
  ) {}

  spawn(): void {
    if (this.mode === 'humans') this.spawnHumanoids()
    else this.spawnMounts()
  }

  /** Advances orbit damping; returns false before `setupCamera`. */
  updateControls(): boolean {
    if (!this.controls) return false
    this.controls.update()
    return true
  }

  updateAnimations(dt: number): void {
    for (const instance of this.showcase) {
      const playback = this.playback.get(instance)
      if (playback) {
        if (!this.paused) playback.update(dt)
      } else instance.update(dt, instance.root.position.distanceTo(this.host.camera.position))
    }
  }

  private spawnHumanoids(): void {
    this.host.player.group.visible = false
    const grid = new THREE.GridHelper(22, 22, 0x837765, 0x413b33)
    grid.position.y = MODEL_STUDIO_FLOOR_Y + 0.025
    this.host.scene.add(grid)
    const displays: Array<{
      faction: 'viking' | 'roman'
      x: number
      z: number
      rotation: number
      state: HumanoidAnimationState | 'bowAim'
    }> = (['viking', 'roman'] as const).flatMap((faction) =>
      (['idle', 'walk', 'run', 'swordSlash', 'bowLoad', 'bowHold', 'bowRelease', 'pilumThrow', 'mounted', 'death', 'lanceThrust', 'mountedLance'] as HumanoidAnimationState[])
        .map((state, index) => ({ faction, x: -10.35 + index * 2.3, z: faction === 'viking' ? -3.1 : 3.1, rotation: 0, state })))
    for (const display of displays) {
      const instance = HumanoidAssetRegistry.createCharacterInstance({
        faction: display.faction,
        tier: 2,
        isPlayer: false,
      })
      instance.root.position.set(display.x, MODEL_STUDIO_FLOOR_Y, display.z)
      instance.root.rotation.y = display.rotation
      if (display.state === 'mounted' || display.state === 'mountedLance') {
        const variant = horseVariantForStableKey(`humanoid-studio:${display.faction}:${display.x}:${display.z}`)
        const mount = new Mount(this.host.scene, DEFAULT_MOUNT_TYPE, display.x, display.z, MODEL_STUDIO_FLOOR_Y, variant)
        mount.visualHold = true
        mount.group.rotation.y = display.rotation
        this.host.mounts.push(mount)

        if (instance.rig.pelvis) {
          const pelvisWorld = new THREE.Vector3()
          instance.root.updateWorldMatrix(true, true)
          instance.rig.pelvis.getWorldPosition(pelvisWorld)
          const pelvisHeight = instance.root.worldToLocal(pelvisWorld).y
          instance.root.position.y = MODEL_STUDIO_FLOOR_Y + mount.rideHeightOffset - pelvisHeight
        }
        instance.root.rotation.x = mount.ridePitch
      }
      const studioState = display.state === 'bowAim' ? 'bowHold' : display.state
      instance.rig.animation?.play(studioState, {
        fadeSeconds: 0,
        loop: studioState === 'idle' || studioState === 'walk' || studioState === 'run' || studioState === 'bowHold',
      })
      this.host.scene.add(instance.root)
      this.showcase.push(instance)
      this.playback.set(instance, new HumanoidStudioPlayback(instance, studioState, display.faction))
      if (studioState === 'lanceThrust' || studioState === 'mountedLance') this.playback.get(instance)!.setEquipmentLoadout('lance', true)
      instance.root.userData.studioState = studioState
      const label = this.createLabel(`${display.faction}｜${studioState}`, display.x)
      label.position.z = display.z
      const skeleton = new THREE.SkeletonHelper(instance.skeleton.bones[0])
      skeleton.name = `${display.faction}-${display.state}-skeleton`
      const material = skeleton.material as THREE.LineBasicMaterial
      material.color.set(display.faction === 'viking' ? 0x55bbff : 0xff725e)
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
      skeleton.renderOrder = 100
      this.host.scene.add(skeleton)
      this.skeletonHelpers.push(skeleton)
    }
    this.createHumanoidHelp()
    createBowComparisonPanel(this.playback, this.host.camera, this.host.scene, () => {
      this.paused = true
      for (const helper of this.skeletonHelpers) helper.visible = false
      for (const mount of this.host.mounts) mount.group.visible = false
      return this.controls!
    }, () => {
      this.paused = false
      for (const mount of this.host.mounts) mount.group.visible = true
      this.host.camera.fov = 48
      this.host.camera.updateProjectionMatrix()
      this.controls!.target.set(-1.2, MODEL_STUDIO_FLOOR_Y + 1.15, 0)
      this.host.camera.position.set(10.5, MODEL_STUDIO_FLOOR_Y + 5.2, 11.5)
      this.controls!.update()
    })
  }

  setupCamera(): void {
    this.host.camera.fov = (this.mode === 'mounts') ? 42 : 48
    this.host.camera.position.set(
      (this.mode === 'mounts') ? 0 : 10.5,
      MODEL_STUDIO_FLOOR_Y + ((this.mode === 'mounts') ? 2.45 : 5.2),
      (this.mode === 'mounts') ? 7.5 : 11.5,
    )
    this.host.camera.updateProjectionMatrix()
    this.controls = new OrbitControls(this.host.camera, this.host.renderer.domElement)
    this.controls.target.set((this.mode === 'mounts') ? 0 : -1.2, MODEL_STUDIO_FLOOR_Y + ((this.mode === 'mounts') ? 1.05 : 1.15), 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 1.5
    this.controls.maxDistance = (this.mode === 'mounts') ? 55 : 35
    this.controls.maxPolarAngle = Math.PI * 0.98
    this.controls.listenToKeyEvents(window)
    this.controls.update()
  }

  private createLabel(text: string, x: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(18, 20, 21, .84)'
    context.roundRect(4, 4, 504, 88, 16)
    context.fill()
    context.strokeStyle = '#c4a46a'
    context.lineWidth = 4
    context.stroke()
    context.fillStyle = '#f2e5c9'
    context.font = '600 38px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 256, 49)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
    sprite.position.set(x, MODEL_STUDIO_FLOOR_Y + ((this.mode === 'mounts') ? 3.4 : 2.55), 0)
    sprite.scale.set(2.15, 0.40, 1)
    sprite.renderOrder = 50
    this.host.scene.add(sprite)
    return sprite
  }

  private spawnMounts(): void {
    this.host.player.group.visible = false
    const grid = new THREE.GridHelper(12, 24, 0x9e8e73, 0x4b453d)
    grid.position.y = MODEL_STUDIO_FLOOR_Y + 0.012
    this.host.scene.add(grid)

    const model = new URLSearchParams(window.location.search).get('devmodels')
    const isCat = model === 'black-cat' || model === 'white-cat' || model === 'orange-cat' || model === 'serval' || model === 'caracal'
    const isCorgi = model === 'corgi'
    const isSnowLeopard = model === 'snow-leopard'
    const isProcedural = isCat || isCorgi || isSnowLeopard
    const mount = new Mount(this.host.scene, model === 'armored-horse' ? MountType.ARMORED_HORSE : isSnowLeopard ? MountType.SNOW_LEOPARD : isCat ? mountTypeFromId(model) : isCorgi ? MountType.CORGI : DEFAULT_MOUNT_TYPE, 0, 0, MODEL_STUDIO_FLOOR_Y)
    const studioClips = isProcedural ? QUADRUPED_STUDIO_CLIPS : HORSE_STUDIO_CLIPS
    if (isProcedural) {
      this.host.camera.position.set(isCorgi ? 6.4 : 4.4, MODEL_STUDIO_FLOOR_Y + (isCorgi ? 2.8 : 2.6), isCorgi ? 6.8 : 4.0)
      this.controls?.target.set(0, MODEL_STUDIO_FLOOR_Y + 1.1, -0.2)
      this.controls?.update()
      this.host.scene.background = new THREE.Color(0x302e2c)
      this.host.scene.fog = new THREE.Fog(0x302e2c, 12, 32)
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x45413c, roughness: 0.95 }))
      floor.rotation.x = -Math.PI / 2
      floor.position.y = MODEL_STUDIO_FLOOR_Y + 0.002
      floor.receiveShadow = true
      this.host.scene.add(floor)
      grid.visible = false
      for (const [x, y, z, color, intensity] of [[3, 5, 4, 0xffe2b9, 3.5], [-4, 3, 2, 0xcbdfff, 2.5], [1, 4, -4, 0xe4d4c1, 4]]) {
        const light = new THREE.DirectionalLight(color, isCorgi ? intensity * 0.55 : intensity)
        if (x === 3) {
          light.castShadow = true
          light.shadow.mapSize.set(2048, 2048)
          Object.assign(light.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 20 })
          light.shadow.bias = -0.0002
          light.shadow.normalBias = 0.015
        }
        light.position.set(x, MODEL_STUDIO_FLOOR_Y + y, z)
        light.target.position.set(0, MODEL_STUDIO_FLOOR_Y + 1, 0)
        this.host.scene.add(light, light.target)
      }
      const style = document.createElement('style')
      style.textContent = '#hud,#army-command-hud,#crosshair,#controls-hint,#pickup-prompt{display:none!important}'
      document.head.appendChild(style)
    }
    mount.visualHold = true
    mount.playStudioClip('idle')
    this.host.mounts.push(mount)
    this.previewMount = mount

    // Stable browser-QA setup: start as a horse knight so saddle fit,
    // rider legs, gait, jump and dismount can be inspected
    // without depending on repeated single-frame keypresses.
    this.host.player.mountVehicle(mount, mount.group.rotation.y)
    this.host.showRiddenMountHud(mount)

    const comparisonHorse = new Mount(this.host.scene, DEFAULT_MOUNT_TYPE, 4.4, 8, undefined, 1)
    comparisonHorse.visualHold = true
    this.host.mounts.push(comparisonHorse)
    if (!isProcedural) this.createLabel('寫實戰馬｜動畫與騎乘驗收', 0)
    if (isProcedural) comparisonHorse.group.visible = false

    if (mount.horseSkeleton) {
      const skeleton = new THREE.SkeletonHelper(mount.horseSkeleton.bones[0])
      const material = skeleton.material as THREE.LineBasicMaterial
      material.color.set(0x6fe3ff)
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
      skeleton.renderOrder = 100
      skeleton.visible = false
      this.host.scene.add(skeleton)
      this.mountSkeleton = skeleton
    }

    if (HumanoidAssetRegistry.ready) {
      const rider = HumanoidAssetRegistry.createCharacterInstance({
        faction: isCorgi ? 'roman' : 'viking',
        tier: 2,
        isPlayer: false,
      })
      const playback = new HumanoidStudioPlayback(rider, 'mounted', isCorgi ? 'roman' : 'viking', mount.type)
      playback.setEquipmentLoadout(isCorgi ? 'sword' : 'lance', true)
      playback.sampleEquipment(0, true)
      this.playback.set(rider, playback)
      const seat = mount.getRiderPelvisSeatLocal()
      let pelvisHeight = 0
      if (rider.rig.pelvis) {
        rider.root.updateWorldMatrix(true, true)
        const pelvisWorld = rider.rig.pelvis.getWorldPosition(new THREE.Vector3())
        pelvisHeight = rider.root.worldToLocal(pelvisWorld).y
      }
      rider.root.position.set(seat.x, seat.y - pelvisHeight, seat.z)
      rider.root.rotation.x = mount.ridePitch
      mount.group.add(rider.root)
      this.showcase.push(rider)
      if (isProcedural && !isCorgi) rider.root.visible = false
      this.rider = rider
      this.riderPelvisHeight = pelvisHeight
      if (isCat && MountStudioSeatContact.supports(rider.root)) this.seatContacts.set(rider, new MountStudioSeatContact(
        rider.root, mount.group, mount.catVisual!.root.getObjectByName('cat_saddle_leather') as THREE.SkinnedMesh,
      ))
    }

    let riderWeaponButton: HTMLButtonElement | null = null
    const cycleRiderWeapon = () => {
      if (!this.rider) return
      const playback = this.playback.get(this.rider)!
      const choices = ['lance', 'axe', 'sword', 'bow'] as const
      const next = choices[(choices.findIndex(weapon => weapon === playback.weapon) + 1) % choices.length]
      playback.setEquipmentLoadout(next, next !== 'bow' && playback.shield.visible)
      this.rider.root.visible = true
      if (riderWeaponButton) riderWeaponButton.textContent = `武器：${{ lance: '長槍', axe: '斧頭', sword: '劍', bow: '弓' }[next]}`
    }

    const help = document.createElement('div')
    help.id = 'mount-studio-help'
    help.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.88);color:#eadfce;font:13px/1.45 system-ui;pointer-events:none'
    help.textContent = (isCat ? '黑貓工作室｜' : '戰馬工作室｜') + '1–9 動畫・0 花色・Space 暫停・R 重播・H 骨架・V 騎士・L 劍／槍・Q 盾牌・F 攻擊｜左鍵旋轉・右鍵平移・滾輪縮放'
    if (isProcedural) help.textContent = '拖曳旋轉 · 滾輪縮放 · 1 idle · 2 walk · 3 run · 4 death · 5 跳躍 · 6 落地 · 7 受擊 · Space 暫停 · R 重播 · V 騎士 · L 換武器 · Q 盾牌 · F 攻擊'
    document.body.appendChild(help)

    const status = document.createElement('div')
    status.id = 'mount-studio-status'
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:30;min-width:220px;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.88);color:#eadfce;font:13px/1.45 ui-monospace,monospace;pointer-events:none'
    document.body.appendChild(status)
    this.statusEl = status
    if (isProcedural) {
      const toolbar = document.createElement('div')
      toolbar.style.cssText = 'position:fixed;top:24px;left:32px;right:32px;z-index:40;color:#e6d7bb;font:14px system-ui;display:flex;align-items:center;gap:12px'
      toolbar.innerHTML = '<div style="margin-right:auto"><div style="letter-spacing:4px;font-size:11px;color:#b99a66">SAGABURST / MOUNTS</div><h1 style="font:28px Georgia,serif;margin:8px 0">月影旅者 · 黑貓坐騎</h1></div>'
      if (isCorgi) toolbar.querySelector('h1')!.textContent = '赤金衛士 · 柯基坐騎'
      if (isSnowLeopard) toolbar.querySelector('h1')!.textContent = '重甲雪豹 · T5 指揮官坐騎'
      if (model === 'white-cat') toolbar.querySelector('h1')!.textContent = '白貓英雄坐騎 · T4 坐騎'
      if (model === 'orange-cat') toolbar.querySelector('h1')!.textContent = '橘貓英雄坐騎 · T4 坐騎'
      if (model === 'serval') toolbar.querySelector('h1')!.textContent = '藪貓英雄坐騎 · T5 大型坐騎'
      if (model === 'caracal') toolbar.querySelector('h1')!.textContent = '獰貓英雄坐騎 · T5 大型坐騎'
      const poses: [string, number, number, number][] = isCorgi
        ? [['正面', 0, 1.4, 8], ['側面', -7.8, 1.4, 0], ['背面', 0, 1.4, -8], ['三分之四', -6.4, 2.8, 6.8]]
        : [['正面', 0, 2.1, 6], ['側面', 6, 2.0, 0], ['背面', 0, 2.2, -6], ['三分之四', 4.4, 2.6, 4]]
      for (const [label, x, y, z] of poses) {
        const button = document.createElement('button')
        button.textContent = label
        button.style.cssText = 'background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;padding:9px 14px;cursor:pointer'
        button.onclick = () => { this.host.camera.position.set(x, MODEL_STUDIO_FLOOR_Y + y, z); this.controls?.target.set(0, MODEL_STUDIO_FLOOR_Y + 1.1, -0.2); this.controls?.update() }
        toolbar.appendChild(button)
      }
      const ride = document.createElement('a'); ride.textContent = '進入試騎 →'; ride.href = isSnowLeopard ? '?training=1&nolock&mount=snow-leopard&devcommander=viking' : '?training=1&nolock'
      ride.style.cssText = 'padding:10px 16px;background:#b99a66;color:#201b14;border-radius:5px;text-decoration:none'
      toolbar.appendChild(ride)
      if (isCorgi) {
        riderWeaponButton = document.createElement('button')
        riderWeaponButton.textContent = '武器：劍'
        riderWeaponButton.style.cssText = 'padding:9px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;cursor:pointer'
        riderWeaponButton.onclick = cycleRiderWeapon
        toolbar.appendChild(riderWeaponButton)
      }
      if (isCorgi) {
        let equipped = true
        const armor = document.createElement('button'); armor.textContent = '護甲：開'
        armor.style.cssText = 'padding:9px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;cursor:pointer'
        armor.onclick = () => { equipped = !equipped; mount.corgiVisual!.setEquipmentVisible(equipped); armor.textContent = `護甲：${equipped ? '開' : '關'}` }
        toolbar.appendChild(armor)
      }
      document.body.appendChild(toolbar)
      if (isProcedural && this.rider) {
        const riders = new Map<string, { rider: HumanoidCharacterInstance; pelvisHeight: number }>([
          [isCorgi ? 'roman-t2' : 'viking-t2', { rider: this.rider, pelvisHeight: this.riderPelvisHeight }],
        ])
        const picker = document.createElement('label')
        picker.style.cssText = 'position:fixed;top:110px;right:32px;z-index:40;padding:10px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;font:14px system-ui'
        picker.textContent = '騎士：'
        const select = document.createElement('select')
        select.setAttribute('aria-label', isSnowLeopard ? '雪豹騎士' : isCorgi ? '柯基騎士' : '黑貓騎士')
        select.style.cssText = 'background:#282522;color:#e6d7bb;border:0;font:inherit;padding:4px'
        for (const [value, label] of (isSnowLeopard ? [['viking-t2', '一般維京人'], ['viking-t5', 'T5 維京指揮官'], ['roman-t5', 'T5 羅馬指揮官']] : isCorgi ? [['roman-t2', '一般羅馬人'], ['roman-t4', 'T4 羅馬禁衛軍'], ['maki-t4', 'T4 遊俠 Shadow Warden']] : [['viking-t2', '一般維京人'], ['viking-t4', 'T4 維京英雄'], ['maki-t4', 'T4 遊俠 Shadow Warden'], ['viking-t5', 'T5 維京指揮官'], ['roman-t5', 'T5 羅馬指揮官']])) {
          select.add(new Option(label, value))
        }
        const feedback = document.createElement('span')
        feedback.setAttribute('role', 'status')
        picker.append(select, feedback)
        document.body.appendChild(picker)
        const changeRider = async () => {
          const key = select.value
          select.disabled = true
          feedback.textContent = ' 載入中…'
          try {
            if (!riders.has(key)) {
              const { loadMakiRangerBow } = await import('../world/MakiRangerEquipment')
              const maki = key === 'maki-t4'
              const descriptor = HERO_ASSETS[key === 'roman-t5' ? 'roman-hero-t5' : key === 'viking-t5' ? 'viking-hero-t5' : maki ? 'maki-archer-t4' : isCorgi ? 'roman-hero-t4' : 'viking-hero-t4'].descriptor
              await HumanoidAssetRegistry.preloadAsset(descriptor)
              const bowAssets = maki ? { bow: await loadMakiRangerBow() } : undefined
              const rider = HumanoidAssetRegistry.createCharacterInstance({ faction: descriptor.faction, tier: 2, isPlayer: false }, descriptor.assetId)
              const playback = new HumanoidStudioPlayback(rider, 'mounted', descriptor.faction, mount.type, bowAssets)
              playback.setEquipmentLoadout(maki ? 'bow' : isCorgi ? 'sword' : 'axe', !maki)
              playback.sampleEquipment(0, true)
              rider.root.updateWorldMatrix(true, true)
              const pelvisHeight = rider.root.worldToLocal(rider.rig.pelvis!.getWorldPosition(new THREE.Vector3())).y
              rider.root.rotation.x = mount.ridePitch
              mount.group.add(rider.root)
              this.playback.set(rider, playback)
              riders.set(key, { rider, pelvisHeight })
            }
            const previous = this.rider!
            previous.root.visible = false
            this.showcase = this.showcase.filter(rider => rider !== previous)
            const selected = riders.get(key)!
            this.rider = selected.rider
            this.riderPelvisHeight = selected.pelvisHeight
            selected.rider.root.visible = true
            if (riderWeaponButton) {
              const weapon = this.playback.get(selected.rider)!.weapon
              riderWeaponButton.textContent = `武器：${{ none: '無', bow: '遊俠弓', lance: '長槍', axe: '斧頭', sword: '劍' }[weapon]}`
            }
            this.showcase.push(selected.rider)
            this.fitPreviewRider()
            if (isCat && MountStudioSeatContact.supports(selected.rider.root) && !this.seatContacts.has(selected.rider)) {
              this.seatContacts.set(selected.rider, new MountStudioSeatContact(
                selected.rider.root, mount.group, mount.catVisual!.root.getObjectByName('cat_saddle_leather') as THREE.SkinnedMesh,
              ))
              this.fitPreviewRider()
            }
            const url = new URL(window.location.href)
            url.searchParams.set('rider', key)
            history.replaceState(null, '', url)
            feedback.textContent = ''
          } catch (error) {
            feedback.textContent = ' 載入失敗，請重試'
            console.error('Mount studio rider failed', error)
          } finally { select.disabled = false }
        }
        select.onchange = () => { void changeRider() }
        const requested = new URLSearchParams(window.location.search).get('rider')
        select.value = requested && [...select.options].some(option => option.value === requested) ? requested : isSnowLeopard ? 'viking-t5' : isCorgi ? 'roman-t2' : 'viking-t4'
        void changeRider()
      }
    }

    window.addEventListener('keydown', (event) => {
      const digit = Number(event.code.replace('Digit', ''))
      if (Number.isInteger(digit) && digit >= 1 && digit <= studioClips.length) {
        mount.playStudioClip(studioClips[digit - 1])
        return
      }
      if (event.code === 'Digit0' || event.code === 'Numpad0') {
        const variant = ((mount.appearanceVariant + 1) % 3) as HorseAppearanceVariant
        mount.setAppearanceVariant(variant)
      } else if (event.code === 'Space') {
        event.preventDefault()
        mount.toggleStudioPause()
      } else if (event.code === 'KeyR') {
        const state = mount.proceduralVisual?.debugState() ?? mount.getHorseDebugState()
        if (state) mount.playStudioClip(state.clip)
      } else if (event.code === 'KeyH' && this.mountSkeleton) {
        this.mountSkeleton.visible = !this.mountSkeleton.visible
      } else if (event.code === 'KeyV' && this.rider) {
        this.rider.root.visible = !this.rider.root.visible
      } else if (this.rider && ['KeyL', 'KeyQ', 'KeyF'].includes(event.code)) {
        const playback = this.playback.get(this.rider)!
        if (event.code === 'KeyF') playback.attackEquipment()
        else if (event.code === 'KeyL') cycleRiderWeapon()
        else if (playback.weapon !== 'bow') playback.setEquipmentLoadout(playback.weapon, !playback.shield.visible)
      }
    })
  }

  /** Seats the preview rider on this frame's animated saddle and refreshes the status panel. */
  fitPreviewRider(): void {
    if (!this.statusEl || !this.previewMount) return
    if (this.rider) {
      const seat = this.previewMount.getRiderPelvisSeatLocal()
      this.rider.root.position.set(
        seat.x,
        seat.y - this.riderPelvisHeight,
        seat.z,
      )
      if (this.seatContacts.has(this.rider)) {
        this.seatContacts.get(this.rider)?.align()
      } else {
        this.previewMount.catVisual?.fitRider(this.rider.root)
      }
      this.previewMount.corgiVisual?.fitRider(this.rider.root)
      this.previewMount.snowLeopardVisual?.fitRider(this.rider.root)
    }
    const state = this.previewMount.getHorseDebugState()
    if (!state) {
      const procedural = this.previewMount.proceduralVisual?.debugState()
      if (procedural) this.statusEl.textContent = `${this.previewMount.displayName} · ${procedural.clip} · ${procedural.paused ? '暫停' : '播放中'} · ${procedural.actionTime.toFixed(2)} s · ${procedural.playbackRate.toFixed(2)}×｜來源 GLB · LOD ${procedural.lod} · 1 mixer`
      return
    }
    const info = this.host.renderer.info
    this.statusEl.textContent = [
      `clip: ${state.clip}`,
      `time: ${state.time.toFixed(2)} s`,
      `playback: ${state.playbackRate.toFixed(2)}x`,
      `paused: ${state.paused ? 'yes' : 'no'}`,
      `LOD: ${state.lod}`,
      `variant: paint_0${state.variant + 1}`,
      `mixers: ${state.mixerCount}`,
      `skeletons: ${state.skeletonCount}`,
      `draw calls: ${info.render.calls}`,
      `geometry: ${info.memory.geometries}`,
      `textures: ${info.memory.textures}`,
    ].join('\n')
  }

  private createHumanoidHelp(): void {
    const help = document.createElement('div')
    help.id = 'humanoid-studio-help'
    help.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.84);color:#eadfce;font:13px/1.45 system-ui;pointer-events:none'
    let equipmentLance = false
    let equipmentShield = true
    const updateHelp = () => { help.textContent = `人物工作室｜${this.equipped ? '正式控制器＋裝備' : '純 GLB 動畫'}｜模式: 劍握持修正 OFF｜B 切換・L 劍／槍・Q 盾牌・Space 暫停・R 重播・H 骨架｜左鍵旋轉・右鍵/方向鍵平移・滾輪縮放` }
    updateHelp()
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyL' || event.code === 'KeyQ') {
        if (event.code === 'KeyL') equipmentLance = !equipmentLance
        else equipmentShield = !equipmentShield
        for (const playback of this.playback.values()) {
          if (!playback.state.startsWith('bow') && playback.state !== 'pilumThrow' && playback.state !== 'death') {
            playback.setEquipmentLoadout(equipmentLance || playback.state.includes('Lance') || playback.state === 'lanceThrust' ? 'lance' : 'sword', equipmentShield)
          }
        }
      } else if (event.code === 'KeyB') {
        this.equipped = !this.equipped
        for (const playback of this.playback.values()) playback.setEquipped(this.equipped)
        updateHelp()
      } else if (event.code === 'Space') {
        event.preventDefault()
        this.paused = !this.paused
      } else if (event.code === 'KeyR') {
        for (const playback of this.playback.values()) playback.reset()
      }
    })
    document.body.appendChild(help)
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyH') return
      const visible = !this.skeletonHelpers[0]?.visible
      for (const helper of this.skeletonHelpers) helper.visible = visible
    })
  }}
