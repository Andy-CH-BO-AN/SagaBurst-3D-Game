/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createSky } from './world/Sky'
import { createTerrain, EntityCollisionBody, ObstacleData, resolveEntityCollision, resolveObstacleCollision } from './world/Terrain'
import { Player } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { SaveManager } from './save/SaveManager'
import { StaminaBar } from './ui/StaminaBar'
import { HpBar } from './ui/HpBar'
import { DummyEnemy } from './world/DummyEnemy'
import { NPC, Faction, AIType } from './world/NPC'
import { SpatialGrid } from './world/SpatialGrid'
import { ArrowProjectile } from './world/ArrowProjectile'
import { DEFAULT_MOUNT_TYPE, Mount, MountState, MountType, mountTypeFromSave } from './world/Mount'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { CompassUI } from './ui/CompassUI'
import { EquipmentUI } from './ui/EquipmentUI'
import { SoundManager } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import { WeaponPickup } from './world/WeaponPickup'
import { damageNpc, damagePlayer } from './combat/DamageRouter'
import { CombatTrajectoryDebugger } from './debug/CombatTrajectoryDebugger'
import { HumanoidAssetRegistry } from './world/HumanoidAssetRegistry'
import type { HumanoidCharacterInstance } from './world/HumanoidAssetRegistry'
import {
  HorseAssetRegistry,
  horseVariantForStableKey,
  horseVariantFromSave,
  type HorseAnimationState,
  type HorseAppearanceVariant,
} from './world/HorseAssetRegistry'
import { applyCharacterMountedPose } from './world/CharacterVisuals'

const HUMANOID_STUDIO_FLOOR_Y = 8
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

export class Game {
  static async create(container: HTMLElement): Promise<Game> {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.16
    container.appendChild(renderer.domElement)

    const legacyQa = import.meta.env.DEV && new URLSearchParams(window.location.search).has('legacyhumanoids')
    try {
      if (legacyQa) {
        await HorseAssetRegistry.preload(renderer)
        return new Game(renderer)
      }
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer)])
      return new Game(renderer)
    } catch (error) {
      renderer.dispose()
      renderer.domElement.remove()
      throw error
    }
  }

  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private camera: THREE.PerspectiveCamera
  private clock: THREE.Clock

  private input: PlayerInput
  private player: Player
  private thirdPersonCamera: ThirdPersonCamera
  private studioControls: OrbitControls | null = null
  private isHumanoidStudio = false
  private isMountStudio = false
  private isModelStudio = false
  private isDevCombat = false

  private dummyEnemy: DummyEnemy
  private npcs: NPC[] = []
  private damageNumbers: DamageNumbers
  private arrows: ArrowProjectile[] = []
  private pickups: WeaponPickup[] = []
  private mounts: Mount[] = []

  private obstacles: ObstacleData[] = []
  private saveManager: SaveManager
  private staminaBar: StaminaBar
  private hpBar: HpBar
  private quiverUI: QuiverUI
  private skillManager: SkillManager
  private compassUI: CompassUI
  private equipmentUI: EquipmentUI
  private soundManager: SoundManager
  private inventoryManager: InventoryManager
  private combatTrajectoryDebugger: CombatTrajectoryDebugger | null = null
  private humanoidShowcase: HumanoidCharacterInstance[] = []
  private humanoidSkeletonHelpers: THREE.SkeletonHelper[] = []
  private mountStudioHorse: Mount | null = null
  private mountStudioRider: HumanoidCharacterInstance | null = null
  private mountStudioRiderPelvisHeight = 0
  private mountStudioSkeleton: THREE.SkeletonHelper | null = null
  private mountStudioStatus: HTMLElement | null = null
  private devCombatStatus: HTMLElement | null = null
  private devCombatFrames = 0
  private devCombatElapsed = 0
  private loadedSaveMount: Mount | null = null

  // Enemy HUD elements
  private enemyHud: HTMLElement
  private enemyNameEl: HTMLElement
  private enemyHpFill: HTMLElement
  private enemyHudTimer: number | null = null

  private mountHud: HTMLElement
  private mountNameEl: HTMLElement
  private mountHpFill: HTMLElement

  private pickupPromptEl: HTMLElement
  // @ts-ignore
  private activeNearbyPickup: WeaponPickup | null = null

  private lockOverlay: HTMLElement
  private controlsHint: HTMLElement
  private saveNotify: HTMLElement
  private hintTimer: number | null = null
  private notifyTimer: number | null = null

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpCameraDir = new THREE.Vector3()
  private readonly _aimRaycaster = new THREE.Raycaster()
  private readonly _aimScreenCenter = new THREE.Vector2(0, 0)

  private readonly _tmpHitPos = new THREE.Vector3()
  private readonly _debugAimPoint = new THREE.Vector3()

  private _isIgnoredAimObject(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      if (current === this.player.group || current === this.player.currentMount?.group) return true
      if (current.name === 'arrow-projectile') return true
      if (current.userData.ignoreAimRaycast === true) return true
      current = current.parent
    }
    return false
  }

  private _getCameraAimPoint(target: THREE.Vector3): THREE.Vector3 {
    this.thirdPersonCamera.getAimDirection(this._tmpCameraDir)
    target.copy(this.camera.position).addScaledVector(this._tmpCameraDir, 100)
    if (!this.player.isAiming) return target

    // setFromCamera also assigns Raycaster.camera, which Sprite.raycast needs.
    // A plain set(origin, direction) reports an error as soon as recursive
    // scene aiming encounters NPC alert sprites.
    this._aimRaycaster.setFromCamera(this._aimScreenCenter, this.camera)
    this._tmpCameraDir.copy(this._aimRaycaster.ray.direction)
    target.copy(this._aimRaycaster.ray.origin).addScaledVector(this._tmpCameraDir, 100)
    this._aimRaycaster.far = 100
    const intersections = this._aimRaycaster.intersectObjects(this.scene.children, true)
    for (const intersection of intersections) {
      if (!this._isIgnoredAimObject(intersection.object)) return target.copy(intersection.point)
    }
    return target
  }

  // LOD & Spatial Partitioning
  private npcGrid = new SpatialGrid<NPC>(20)

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer

    // ── Scene ──
    this.scene = new THREE.Scene()

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(
      58, window.innerWidth / window.innerHeight, 0.1, 500
    )

    // ── Clock ──
    this.clock = new THREE.Clock()

    // ── Audio ──
    this.soundManager = new SoundManager()

    // ── World ──
    createSky(this.scene)
    const { obstacles } = createTerrain(this.scene)
    this.obstacles = obstacles

    // ── Player & Input ──
    this.input = new PlayerInput()
    this.player = new Player(this.scene)

    // ── Camera controller ──
    this.thirdPersonCamera = new ThirdPersonCamera(this.camera, this.player)

    // ── Combat & Enemies ──
    this.dummyEnemy = new DummyEnemy(this.scene, 0, -6)
    const query = new URLSearchParams(window.location.search)
    this.isDevCombat = query.has('devcombat')
    const devModelsMode = query.get('devmodels')
    const isDevModels = query.has('devmodels')
    this.isHumanoidStudio = devModelsMode === 'humans'
    this.isMountStudio = devModelsMode === 'mounts'
    this.isModelStudio = this.isHumanoidStudio || this.isMountStudio
    if (this.isModelStudio) this._setupModelStudioCamera()
    if (this.isDevCombat) {
      this.combatTrajectoryDebugger = new CombatTrajectoryDebugger(this.scene)
      this._spawnDevCombatForces()
    } else if (devModelsMode === 'humans') {
      this._spawnHumanoidStudio()
    } else if (devModelsMode === 'mounts') {
      this._spawnMountStudio()
    } else if (!isDevModels) {
      this._spawnStandardForces()
    }
    
    this.damageNumbers = new DamageNumbers()

    // ── RPG Systems & Inventory ──
    this.staminaBar       = new StaminaBar()
    this.hpBar            = new HpBar()
    this.quiverUI         = new QuiverUI()
    this.skillManager     = new SkillManager()
    this.compassUI        = new CompassUI()
    this.equipmentUI      = new EquipmentUI()
    this.inventoryManager = new InventoryManager()

    this.lockOverlay    = document.getElementById('lock-overlay')!
    this.controlsHint   = document.getElementById('controls-hint')!
    this.saveNotify     = document.getElementById('save-notify')!
    this.pickupPromptEl = document.getElementById('pickup-prompt')!

    this.enemyHud    = document.getElementById('enemy-hud')!
    this.enemyNameEl = document.getElementById('enemy-name')!
    this.enemyHpFill = document.getElementById('enemy-hp-fill')!

    this.mountHud    = document.getElementById('mount-hud')!
    this.mountNameEl = document.getElementById('mount-name')!
    this.mountHpFill = document.getElementById('mount-hp-fill')!

    // ── Save Manager ──
    this.saveManager = new SaveManager()

    // ── Spawn World Pickups & Mounts ──
    if (!isDevModels) this._spawnWorldPickups()
    if (!this.isModelStudio) this._spawnMounts(isDevModels)
    if (this.isDevCombat) this._createDevCombatStatus()

    // Listen for arrow fire from Player
    this.player.onFireArrow = (evt) => {
      const arrow = new ArrowProjectile(
        this.scene,
        evt.origin,
        evt.direction,
        evt.speed,
        evt.damage,
        Faction.PLAYER,
        true
      )
      this.arrows.push(arrow)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

    // Player Death notify
    this.player.onPlayerDeath = () => {
      this._showNotify('💀 你陣亡了！正在原點重置...')
    }

    this._setupPointerLock()
    this._setupResize()
    this._setupShortcuts()

    // Initialise bars
    this.hpBar.setFill(this.player.hpRatio)
    this.staminaBar.setFill(1)
    this.quiverUI.setArrowCount(this.player.arrowCount)

    this._loop()
  }

  private _spawnWorldPickups(): void {
    const weaponTypes = [
      'rusty_dagger',
      'steel_sword',
      'steel_lance',
      'runic_greatsword',
      'wooden_shortbow',
      'recurve_longbow',
      'elven_runebow',
      'scutum_t1',
      'scutum_t2',
      'scutum_t3',
      'round_shield_t1',
      'round_shield_t2',
      'round_shield_t3',
    ]

    // Spawn 30 weapon pickups in a golden spiral pattern around spawn
    for (let i = 0; i < 30; i++) {
      const wId = weaponTypes[i % weaponTypes.length]
      const angle = i * 0.45
      const dist  = 6 + i * 1.3
      const px = Math.cos(angle) * dist
      const pz = Math.sin(angle) * dist
      this.pickups.push(new WeaponPickup(this.scene, wId, px, pz))
    }

    // Spawn 4 Arrow Supply Packs
    this.pickups.push(new WeaponPickup(this.scene, '', 3, -3, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', -5, -4, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', 12, 10, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', -12, 10, true, 15))
  }

  private _spawnHumanoidStudio(): void {
    this.player.group.visible = false
    const grid = new THREE.GridHelper(22, 22, 0x837765, 0x413b33)
    grid.position.y = HUMANOID_STUDIO_FLOOR_Y + 0.025
    this.scene.add(grid)
    const displays = [
      { faction: 'viking' as const, x: -6.8, z: -3.1, rotation: 0, state: 'idle' },
      { faction: 'viking' as const, x: -4.5, z: -3.1, rotation: Math.PI / 2, state: 'idle' },
      { faction: 'viking' as const, x: -2.2, z: -3.1, rotation: 0, state: 'walk' },
      { faction: 'viking' as const, x: 0.1, z: -3.1, rotation: 0, state: 'swordSlash' },
      { faction: 'viking' as const, x: 2.4, z: -3.1, rotation: 0, state: 'bowAim' },
      { faction: 'viking' as const, x: 4.7, z: -3.1, rotation: 0, state: 'mounted' },
      { faction: 'roman' as const, x: -6.8, z: 3.1, rotation: 0, state: 'idle' },
      { faction: 'roman' as const, x: -4.5, z: 3.1, rotation: Math.PI / 2, state: 'idle' },
      { faction: 'roman' as const, x: -2.2, z: 3.1, rotation: 0, state: 'walk' },
      { faction: 'roman' as const, x: 0.1, z: 3.1, rotation: 0, state: 'swordSlash' },
      { faction: 'roman' as const, x: 2.4, z: 3.1, rotation: 0, state: 'mounted' },
      { faction: 'roman' as const, x: 4.7, z: 3.1, rotation: 0, state: 'death' },
    ]
    for (const display of displays) {
      const instance = HumanoidAssetRegistry.createCharacterInstance({
        faction: display.faction,
        tier: 2,
        isPlayer: false,
      })
      instance.root.position.set(display.x, HUMANOID_STUDIO_FLOOR_Y, display.z)
      instance.root.rotation.y = display.rotation
      if (display.state === 'mounted') {
        const variant = horseVariantForStableKey(`humanoid-studio:${display.faction}:${display.x}:${display.z}`)
        const mount = new Mount(this.scene, DEFAULT_MOUNT_TYPE, display.x, display.z, HUMANOID_STUDIO_FLOOR_Y, variant)
        mount.visualHold = true
        mount.group.rotation.y = display.rotation
        this.mounts.push(mount)

        if (instance.rig.pelvis) {
          const pelvisWorld = new THREE.Vector3()
          instance.root.updateWorldMatrix(true, true)
          instance.rig.pelvis.getWorldPosition(pelvisWorld)
          const pelvisHeight = instance.root.worldToLocal(pelvisWorld).y
          instance.root.position.y = HUMANOID_STUDIO_FLOOR_Y + mount.rideHeightOffset - pelvisHeight
        }
        instance.root.rotation.x = mount.ridePitch
      }
      instance.rig.animation?.play(display.state, 0, display.state === 'idle' || display.state === 'walk' || display.state === 'bowAim')
      this.scene.add(instance.root)
      this.humanoidShowcase.push(instance)
      const skeleton = new THREE.SkeletonHelper(instance.skeleton.bones[0])
      skeleton.name = `${display.faction}-${display.state}-skeleton`
      const material = skeleton.material as THREE.LineBasicMaterial
      material.color.set(display.faction === 'viking' ? 0x55bbff : 0xff725e)
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
      skeleton.renderOrder = 100
      this.scene.add(skeleton)
      this.humanoidSkeletonHelpers.push(skeleton)
    }
    this._createHumanoidStudioHelp()
  }

  private _setupModelStudioCamera(): void {
    this.camera.fov = this.isMountStudio ? 42 : 48
    this.camera.position.set(
      this.isMountStudio ? 0 : 10.5,
      HUMANOID_STUDIO_FLOOR_Y + (this.isMountStudio ? 2.45 : 5.2),
      this.isMountStudio ? 7.5 : 11.5,
    )
    this.camera.updateProjectionMatrix()
    this.studioControls = new OrbitControls(this.camera, this.renderer.domElement)
    this.studioControls.target.set(this.isMountStudio ? 0 : -1.2, HUMANOID_STUDIO_FLOOR_Y + (this.isMountStudio ? 1.05 : 1.15), 0)
    this.studioControls.enableDamping = true
    this.studioControls.dampingFactor = 0.08
    this.studioControls.screenSpacePanning = true
    this.studioControls.minDistance = 1.5
    this.studioControls.maxDistance = this.isMountStudio ? 55 : 35
    this.studioControls.maxPolarAngle = Math.PI * 0.98
    this.studioControls.listenToKeyEvents(window)
    this.studioControls.update()
  }

  private _createStudioLabel(text: string, x: number): void {
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
    sprite.position.set(x, HUMANOID_STUDIO_FLOOR_Y + (this.isMountStudio ? 3.4 : 2.55), 0)
    sprite.scale.set(2.15, 0.40, 1)
    sprite.renderOrder = 50
    this.scene.add(sprite)
  }

  private _spawnMountStudio(): void {
    this.player.group.visible = false
    this.dummyEnemy.group.visible = false
    const grid = new THREE.GridHelper(12, 24, 0x9e8e73, 0x4b453d)
    grid.position.y = HUMANOID_STUDIO_FLOOR_Y + 0.012
    this.scene.add(grid)

    const mount = new Mount(this.scene, DEFAULT_MOUNT_TYPE, 0, 0, HUMANOID_STUDIO_FLOOR_Y)
    mount.visualHold = true
    mount.playStudioClip('idle')
    this.mounts.push(mount)
    this.mountStudioHorse = mount
    this._createStudioLabel('寫實戰馬｜動畫與騎乘驗收', 0)

    if (mount.horseSkeleton) {
      const skeleton = new THREE.SkeletonHelper(mount.horseSkeleton.bones[0])
      const material = skeleton.material as THREE.LineBasicMaterial
      material.color.set(0x6fe3ff)
      material.depthTest = false
      material.transparent = true
      material.opacity = 0.9
      skeleton.renderOrder = 100
      skeleton.visible = false
      this.scene.add(skeleton)
      this.mountStudioSkeleton = skeleton
    }

    if (HumanoidAssetRegistry.ready) {
      const rider = HumanoidAssetRegistry.createCharacterInstance({
        faction: 'viking',
        tier: 2,
        isPlayer: false,
      })
      applyCharacterMountedPose(rider.rig, true, 'HORSE')
      rider.rig.animation?.play('mounted', 0, true)
      const seat = mount.getSaddleSeatLocal()
      let pelvisHeight = 0
      if (rider.rig.pelvis) {
        rider.root.updateWorldMatrix(true, true)
        const pelvisWorld = rider.rig.pelvis.getWorldPosition(new THREE.Vector3())
        pelvisHeight = rider.root.worldToLocal(pelvisWorld).y
      }
      rider.root.position.set(seat.x, seat.y - pelvisHeight, seat.z)
      rider.root.rotation.x = mount.ridePitch
      mount.group.add(rider.root)
      this.humanoidShowcase.push(rider)
      this.mountStudioRider = rider
      this.mountStudioRiderPelvisHeight = pelvisHeight
    }

    const help = document.createElement('div')
    help.id = 'mount-studio-help'
    help.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.88);color:#eadfce;font:13px/1.45 system-ui;pointer-events:none'
    help.textContent = '戰馬工作室｜1–9 動畫・0 花色・Space 暫停・R 重播・H 骨架・V 騎士｜左鍵旋轉・右鍵平移・滾輪縮放'
    document.body.appendChild(help)

    const status = document.createElement('div')
    status.id = 'mount-studio-status'
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:30;min-width:220px;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.88);color:#eadfce;font:13px/1.45 ui-monospace,monospace;pointer-events:none'
    document.body.appendChild(status)
    this.mountStudioStatus = status

    window.addEventListener('keydown', (event) => {
      const digit = Number(event.code.replace('Digit', ''))
      if (Number.isInteger(digit) && digit >= 1 && digit <= HORSE_STUDIO_CLIPS.length) {
        mount.playStudioClip(HORSE_STUDIO_CLIPS[digit - 1])
        return
      }
      if (event.code === 'Digit0' || event.code === 'Numpad0') {
        const variant = ((mount.appearanceVariant + 1) % 3) as HorseAppearanceVariant
        mount.setAppearanceVariant(variant)
      } else if (event.code === 'Space') {
        event.preventDefault()
        mount.toggleStudioPause()
      } else if (event.code === 'KeyR') {
        const state = mount.getHorseDebugState()
        if (state) mount.playStudioClip(state.clip)
      } else if (event.code === 'KeyH' && this.mountStudioSkeleton) {
        this.mountStudioSkeleton.visible = !this.mountStudioSkeleton.visible
      } else if (event.code === 'KeyV' && this.mountStudioRider) {
        this.mountStudioRider.root.visible = !this.mountStudioRider.root.visible
      }
    })
  }

  private _updateMountStudioStatus(): void {
    if (!this.mountStudioStatus || !this.mountStudioHorse) return
    if (this.mountStudioRider) {
      const seat = this.mountStudioHorse.getSaddleSeatLocal()
      this.mountStudioRider.root.position.set(
        seat.x,
        seat.y - this.mountStudioRiderPelvisHeight,
        seat.z,
      )
    }
    const state = this.mountStudioHorse.getHorseDebugState()
    if (!state) return
    const info = this.renderer.info
    this.mountStudioStatus.textContent = [
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

  private _createDevCombatStatus(): void {
    const status = document.createElement('div')
    status.id = 'dev-combat-status'
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:30;min-width:220px;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.88);color:#eadfce;font:13px/1.45 ui-monospace,monospace;pointer-events:none'
    document.body.appendChild(status)
    this.devCombatStatus = status
  }

  private _updateDevCombatStatus(dt: number): void {
    if (!this.devCombatStatus) return
    this.devCombatFrames++
    this.devCombatElapsed += dt
    if (this.devCombatElapsed < 1) return

    const fps = this.devCombatFrames / this.devCombatElapsed
    this.devCombatFrames = 0
    this.devCombatElapsed = 0
    const lodCounts = [0, 0, 0]
    let horses = 0
    for (const mount of this.mounts) {
      const state = mount.getHorseDebugState()
      if (!state) continue
      horses++
      lodCounts[state.lod]++
    }
    const info = this.renderer.info
    this.devCombatStatus.textContent = [
      `FPS: ${fps.toFixed(1)}`,
      `horses: ${horses}`,
      `mixers: ${horses}`,
      `LOD 0/1/2: ${lodCounts.join('/')}`,
      `draw calls: ${info.render.calls}`,
      `triangles: ${info.render.triangles}`,
      `geometry: ${info.memory.geometries}`,
      `textures: ${info.memory.textures}`,
    ].join('\n')
  }

  private _createHumanoidStudioHelp(): void {
    const help = document.createElement('div')
    help.id = 'humanoid-studio-help'
    help.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.84);color:#eadfce;font:13px/1.45 system-ui;pointer-events:none'
    help.textContent = '人物模型工作室｜左鍵旋轉・右鍵/方向鍵平移・滾輪縮放・H 顯示/隱藏骨架'
    document.body.appendChild(help)
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyH') return
      const visible = !this.humanoidSkeletonHelpers[0]?.visible
      for (const helper of this.humanoidSkeletonHelpers) helper.visible = visible
    })
  }

  private _spawnMounts(modelShowcase = false): void {
    if (modelShowcase) {
      const horse = new Mount(this.scene, DEFAULT_MOUNT_TYPE, 0, 0, undefined, 0)
      const comparisonHorse = new Mount(this.scene, DEFAULT_MOUNT_TYPE, 4.4, 8, undefined, 1)
      comparisonHorse.visualHold = true
      this.mounts.push(horse, comparisonHorse)

      // Stable browser-QA setup: start as a horse knight so saddle fit,
      // rider legs, gait, jump and dismount can be inspected
      // without depending on repeated single-frame keypresses.
      this.player.isMounted = true
      this.player.currentMount = horse
      horse.state = MountState.CONTROLLED
      this.mountNameEl.textContent = `坐騎：${horse.displayName}`
      this.mountHpFill.style.width = '100%'
      this.mountHud.classList.add('visible')
      return
    }
    for (const [index, [x, z]] of [[10, -5], [-15, 20], [15, 15], [-20, -10]].entries()) {
      const variant = horseVariantForStableKey(`world:${index}:${x}:${z}`)
      this.mounts.push(new Mount(this.scene, DEFAULT_MOUNT_TYPE, x, z, undefined, variant))
    }
  }

  // @ts-ignore: Intentionally unused for testing
  private _spawnNpc(
    x: number,
    z: number,
    faction: Faction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3,
    cavalry?: boolean,
  ): void {
    const npc = new NPC(this.scene, x, z, faction, aiType, name, tier, cavalry)
    this.npcs.push(npc)
    if (npc.mount) this.mounts.push(npc.mount)
  }

  /** Beginner-friendly release battle: Player + 9 allies versus 5 enemies. */
  private _spawnStandardForces(): void {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 2.8
      this._spawnNpc(x, 12, Faction.PLAYER, AIType.MELEE, `Viking Guard ${i + 1}`, 2, false)
    }
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 3.0
      this._spawnNpc(x, 18, Faction.PLAYER, AIType.RANGED, `Viking Archer ${i + 1}`, 2, false)
    }
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 3.2
      this._spawnNpc(x, -22, Faction.ENEMY, AIType.MELEE, `Roman Infantry ${i + 1}`, 2, false)
    }
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * 4.0
      this._spawnNpc(x, -28, Faction.ENEMY, AIType.RANGED, `Roman Pilum ${i + 1}`, 2, false)
    }
  }

  /** Fixed Tier-3 50v50 cavalry battle for combat and performance testing. */
  private _spawnDevCombatForces(): void {
    const formationSize = 5
    for (let row = 0; row < formationSize; row++) {
      for (let column = 0; column < formationSize; column++) {
        const index = row * formationSize + column + 1
        const x = (column - 2) * 3.0
        const depth = row * 3.0
        this._spawnNpc(x, 35 + depth, Faction.PLAYER, AIType.MELEE, `Viking T3 Lancer ${index}`, 3, true)
        this._spawnNpc(x, 55 + depth, Faction.PLAYER, AIType.RANGED, `Viking T3 Horse Archer ${index}`, 3, true)
        this._spawnNpc(x, -35 - depth, Faction.ENEMY, AIType.MELEE, `Roman T3 Lancer ${index}`, 3, true)
        this._spawnNpc(x, -55 - depth, Faction.ENEMY, AIType.RANGED, `Roman T3 Mounted Pilum ${index}`, 3, true)
      }
    }
  }

  // ── Pointer Lock ──
  private _setupPointerLock(): void {
    if (window.location.search.includes('nolock')) {
      this.lockOverlay.style.display = 'none'
    }
    this.lockOverlay.addEventListener('click', () => {
      if (!this.equipmentUI?.visible) {
        this.input.requestPointerLock()
      }
    })
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || window.location.search.includes('nolock')) {
        this.lockOverlay.style.display = 'none'
        this.lockOverlay.classList.add('hidden')
        this._scheduleHintHide()
      } else {
        if (!this.equipmentUI?.visible) {
          this.lockOverlay.style.display = 'flex'
          this.lockOverlay.classList.remove('hidden')
        }
        this.controlsHint.classList.remove('hidden')
        if (this.hintTimer !== null) clearTimeout(this.hintTimer)
      }
    })
  }

  private _scheduleHintHide(): void {
    if (this.hintTimer !== null) clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => {
      this.controlsHint.classList.add('hidden')
    }, 5000)
  }

  // ── Keyboard Shortcuts & Top-Left Menu ──
  private _setupShortcuts(): void {
    const gameMenu = document.getElementById('game-menu')
    const menuBtn  = document.getElementById('menu-btn')
    const menuSave = document.getElementById('menu-save')
    const menuLoad = document.getElementById('menu-load')
    const menuInv  = document.getElementById('menu-inventory')

    if (gameMenu) {
      gameMenu.addEventListener('mousedown', (e) => {
        e.stopPropagation() // Stop lock-overlay mousedown handler from triggering pointer lock
      })
      gameMenu.addEventListener('click', (e) => {
        e.stopPropagation() // Stop lock-overlay click handler from triggering pointer lock
      })
      gameMenu.addEventListener('mouseenter', () => {
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      })
    }

    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.toggle('open')
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      })
    }

    if (menuSave) {
      menuSave.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this._saveGame()
      })
    }

    if (menuLoad) {
      menuLoad.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this._loadGame()
      })
    }

    if (menuInv) {
      menuInv.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this.equipmentUI.toggle(this.skillManager, this.inventoryManager)
      })
    }

    window.addEventListener('keydown', (e) => {
      if (!this.isMountStudio && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault()
        if (gameMenu) {
          gameMenu.classList.toggle('open')
          if (gameMenu.classList.contains('open') && document.pointerLockElement) {
            document.exitPointerLock()
          }
        }
      }

      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault()
        this.equipmentUI.toggle(this.skillManager, this.inventoryManager, () => {
          this._showNotify(`⚔️ 已裝備：${this.inventoryManager.equippedMelee.name}`)
        })
        if (this.equipmentUI.visible) {
          if (document.pointerLockElement) {
            document.exitPointerLock()
          }
        } else {
          this.input.requestPointerLock()
        }
      }
      if (e.code === 'Escape') {
        if (gameMenu) gameMenu.classList.remove('open')
        if (this.equipmentUI.visible) {
          e.preventDefault()
          this.equipmentUI.close()
          this.input.requestPointerLock()
        }
      }
    })
  }

  private _saveGame(): void {
    const pos = this.player.position
    const skills = this.skillManager.skillState
    const inv = this.inventoryManager.saveState

    const ok = this.saveManager.save({
      position: { x: pos.x, y: pos.y, z: pos.z },
      hp: this.player.hp,
      stamina: this.player.staminaValue,
      arrows: this.player.arrowCount,
      skills: {
        oneHanded: skills.oneHanded,
        archery: skills.archery,
      },
      inventory: inv,
      mountData: this.player.isMounted && this.player.currentMount ? {
        isMounted: true,
        type: this.player.currentMount.type,
        appearanceVariant: this.player.currentMount.type === MountType.HORSE
          ? this.player.currentMount.appearanceVariant
          : undefined,
      } : undefined
    })
    this._showNotify(ok ? '💾 遊戲已存檔（含背包裝備）' : '❌ 存檔失敗')
  }

  private _loadGame(): void {
    if (!this.saveManager.hasSave()) {
      this._showNotify('⚠️ 沒有存檔')
      return
    }
    const data = this.saveManager.load()
    if (this.player.isMounted) this.player.dismountFromMount()
    if (this.loadedSaveMount) {
      const index = this.mounts.indexOf(this.loadedSaveMount)
      if (index !== -1) this.mounts.splice(index, 1)
      this.loadedSaveMount.dispose()
      this.loadedSaveMount = null
    }
    this.mountHud.classList.remove('visible')
    this.player.setPosition(data.position.x, data.position.y, data.position.z)
    this.player.setStamina(data.stamina)
    this.player.setHp(data.hp ?? 100)
    this.player.setArrowCount(data.arrows ?? 30)

    if (data.skills) {
      this.skillManager.setSkillState(data.skills)
    }
    if (data.inventory) {
      this.inventoryManager.loadSaveState(data.inventory)
    }

    if (data.mountData && data.mountData.isMounted) {
      // Create mount for player at load position
      const mountType = mountTypeFromSave(data.mountData.type)
      const variant = mountType === MountType.HORSE
        ? horseVariantFromSave(data.mountData.appearanceVariant)
        : 0
      const m = new Mount(this.scene, mountType, data.position.x, data.position.z, undefined, variant)
      this.mounts.push(m)
      this.loadedSaveMount = m
      this.player.isMounted = true
      this.player.currentMount = m
      m.state = MountState.CONTROLLED
      this.mountNameEl.textContent = `坐騎：${m.displayName}`
      this.mountHpFill.style.width = `${Math.max(0, (m.currentHp / m.maxHp) * 100)}%`
      this.mountHud.classList.add('visible')
    }

    this.staminaBar.setFill(data.stamina / 100)
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI.setArrowCount(this.player.arrowCount)

    this._showNotify('📂 讀檔成功（還原背包與裝備）')
  }

  private _showNotify(msg: string): void {
    this.saveNotify.textContent = msg
    this.saveNotify.classList.add('visible')
    if (this.notifyTimer !== null) clearTimeout(this.notifyTimer)
    this.notifyTimer = window.setTimeout(() => {
      this.saveNotify.classList.remove('visible')
    }, 2000)
  }

  // ── Enemy HUD UI update ──
  private _showEnemyHud(name: string, ratio: number): void {
    this.enemyNameEl.textContent = name
    this.enemyHpFill.style.width = `${Math.max(0, ratio * 100)}%`

    this.enemyHud.classList.add('visible')
    if (this.enemyHudTimer !== null) clearTimeout(this.enemyHudTimer)
    this.enemyHudTimer = window.setTimeout(() => {
      this.enemyHud.classList.remove('visible')
    }, 4000)
  }

  // ── Shared: Lance Charge Bonus (C-5) ──
  /** Returns the final damage after applying lance charge multiplier.
   *  Also sets skipImpactThisFrame on the player's mount if charging. */
  private _applyLanceChargeBonus(isLance: boolean, baseDamage: number): number {
    if (!isLance) return baseDamage
    const mount = this.player.isMounted ? this.player.currentMount : null
    if (mount && mount.movementSpeed > 10) {
      mount.skipImpactThisFrame = true
      return baseDamage * 3.0
    }
    return baseDamage
  }

  // ── Melee Combat Hit Detection (Player Sword -> Enemies) ──
  private _checkPlayerMeleeHits(): void {
    const equippedMelee = this.inventoryManager.equippedMelee
    if (!this.player.isHitFrame(equippedMelee)) return

    const swordTipPos = this.player.getSwordTipPosition()
    const MELEE_HIT_THRESHOLD = equippedMelee.range || 1.85
    let baseDamage = equippedMelee.damageMax
    
    // Lance Charge Bonus
    baseDamage = this._applyLanceChargeBonus(equippedMelee.isLance === true, baseDamage)

    const damage = Math.round(baseDamage * this.skillManager.getOneHandedMultiplier())

    // Check Dummy Enemy
    if (!this.dummyEnemy.dead) {
      const dummyCenter = this.dummyEnemy.position.clone()
      dummyCenter.y += 1.0
      if (swordTipPos.distanceTo(dummyCenter) <= MELEE_HIT_THRESHOLD) {
        this.player.markHitProcessed()
        if (this.dummyEnemy.takeDamage(damage)) {
          this.soundManager.playHit()
          this.damageNumbers.spawn(damage, dummyCenter)
          this._showEnemyHud('訓練假人 Dummy Target', this.dummyEnemy.hpRatio)
          this.skillManager.addXp('oneHanded', 35, this.soundManager)
        }
        return
      }
    }

    // Check NPCs (Only hit Faction.ENEMY)
    for (const npc of this.npcs) {
      if (!npc.dead && npc.faction === Faction.ENEMY) {
        const aiCenter = npc.combatPosition.clone()
        aiCenter.y += 1.0
        if (swordTipPos.distanceTo(aiCenter) <= MELEE_HIT_THRESHOLD) {
          this.player.markHitProcessed()
          const result = damageNpc(npc, damage)
          if (result.hitSuccess) {
            this.soundManager.playHit()
            this.damageNumbers.spawn(damage, aiCenter)
            this._showEnemyHud(result.targetName, result.hpRatio)
            this.skillManager.addXp('oneHanded', 45, this.soundManager)
          }
          return
        }
      }
    }
  }

  // ── World Pickup & Mount Interaction ──
  private _updateInteractions(dt: number): void {
    // Update Mounts
    for (const mount of this.mounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      mount.update(dt, this.obstacles)
    }

    const isEPressed = this.input.consumeKeyE()

    if (this.player.isMounted && this.player.currentMount) {
      // Handle Dismount
      this.pickupPromptEl.textContent = `[E] 下騎`
      this.pickupPromptEl.classList.add('visible')

      if (isEPressed) {
        this.player.dismountFromMount()
        this.soundManager.playHit() // Placeholder sound
        this.pickupPromptEl.classList.remove('visible')
        this.mountHud.classList.remove('visible')
      }
      return // Skip pickups while mounted
    }

    let closestPickup: WeaponPickup | null = null
    let closestMount: Mount | null = null
    let closestDist = 2.5

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i]
      pickup.update(dt)

      const dist = this.player.position.distanceTo(pickup.position)
      if (dist < closestDist) {
        closestPickup = pickup
        closestMount = null
        closestDist = dist
      }
    }

    for (const mount of this.mounts) {
      if (!mount.availableForPlayer) continue
      const dist = this.player.position.distanceTo(mount.group.position)
      if (dist < closestDist) {
        closestMount = mount
        closestPickup = null
        closestDist = dist
      }
    }

    if (closestPickup) {
      this.pickupPromptEl.textContent = `[E] 拾取：${closestPickup.name}`
      this.pickupPromptEl.classList.add('visible')
    } else if (closestMount) {
      this.pickupPromptEl.textContent = `[E] 騎乘：${closestMount.displayName}`
      this.pickupPromptEl.classList.add('visible')
    } else {
      this.pickupPromptEl.classList.remove('visible')
    }

    // Check if E key was pressed to pick up or mount
    if (isEPressed) {
      if (closestPickup) {
        if (closestPickup.isArrowPack) {
          this.player.setArrowCount(this.player.arrowCount + closestPickup.arrowQuantity)
          this.quiverUI.setArrowCount(this.player.arrowCount)
          this._showNotify(`🏹 拾取：箭矢 x${closestPickup.arrowQuantity}`)
        } else {
          const count = this.inventoryManager.addWeapon(closestPickup.weaponId)
          this._showNotify(`🎒 拾取：${closestPickup.name} (數量: x${count})`)
        }
        this.soundManager.playHit()
        closestPickup.destroy()
        
        const idx = this.pickups.indexOf(closestPickup)
        if (idx !== -1) this.pickups.splice(idx, 1)

      } else if (closestMount) {
        this.player.isMounted = true
        this.player.currentMount = closestMount
        closestMount.state = MountState.CONTROLLED
        
        // Show mount HUD
        this.mountNameEl.textContent = `坐騎：${closestMount.displayName}`
        this.mountHpFill.style.width = `${Math.max(0, (closestMount.currentHp / closestMount.maxHp) * 100)}%`
        this.mountHud.classList.add('visible')
        this.soundManager.playHit()
      }
      this.pickupPromptEl.classList.remove('visible')
    }
  }

  /** Prevent living people, NPCs, and mounts from occupying the same space. */
  private _resolveEntityCollisions(): void {
    const bodies: EntityCollisionBody[] = []
    const controlledMount = this.player.isMounted ? this.player.currentMount : null

    if (controlledMount) {
      bodies.push({
        position: controlledMount.group.position,
        radius: 1.0,
        height: 2.6,
        bottomOffset: 0,
        anchored: true,
      })
    } else {
      bodies.push({
        position: this.player.position,
        radius: 0.38,
        height: 1.9,
        bottomOffset: 0.95,
      })
    }

    for (const npc of this.npcs) {
      if (npc.dead) continue
      if (npc.isMounted) continue
      bodies.push({
        position: npc.position,
        radius: 0.5,
        height: 2.3,
        bottomOffset: 0,
      })
    }

    for (const mount of this.mounts) {
      if (mount === controlledMount) continue
      bodies.push({
        position: mount.group.position,
        radius: 1.0,
        height: 2.6,
        bottomOffset: 0,
      })
    }

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        resolveEntityCollision(bodies[i], bodies[j], this.obstacles)
      }
    }

    // Direction A post-validation fallback
    for (const body of bodies) {
      if (body.anchored) continue
      resolveObstacleCollision(
        body.position,
        body.position,
        0,
        true,
        body.radius,
        body.height,
        body.bottomOffset,
        this.obstacles
      )
    }
  }

  private _updateImpactDamage(now: number): void {
    const checkImpact = (mount: Mount, targetPos: THREE.Vector3, targetRadius: number): boolean => {
      if (mount.skipImpactThisFrame) return false
      const dx = mount.group.position.x - mount.previousPosition.x
      const dz = mount.group.position.z - mount.previousPosition.z
      const px = targetPos.x - mount.previousPosition.x
      const pz = targetPos.z - mount.previousPosition.z
      const lineLenSq = dx*dx + dz*dz
      if (lineLenSq < 0.0001) return false
      let t = (px * dx + pz * dz) / lineLenSq
      t = Math.max(0, Math.min(1, t))
      const closestX = mount.previousPosition.x + t * dx
      const closestZ = mount.previousPosition.z + t * dz
      const distSq = (closestX - targetPos.x) ** 2 + (closestZ - targetPos.z) ** 2
      return distSq <= (targetRadius + 1.0) ** 2
    }

    const applyImpactDamage = (mount: Mount, target: any, targetPos: THREE.Vector3, onHit: (damage: number) => void): void => {
      if (Math.abs(mount.group.position.y - targetPos.y) > 2.0) return
      if (mount.movementSpeed > 4 && mount.canImpact(target, now)) {
        const damage = Math.round(8 + mount.movementSpeed * 1.5 * (mount.isSprinting ? 1.5 : 1.0))
        onHit(damage)
      }
    }

    for (const mount of this.mounts) {
      if (mount.state !== MountState.CONTROLLED || mount.dead) continue
      
      if (mount === this.player.currentMount) {
        if (!this.dummyEnemy.dead && checkImpact(mount, this.dummyEnemy.position, 0.5)) {
          applyImpactDamage(mount, this.dummyEnemy, this.dummyEnemy.position, (damage) => {
            if (this.dummyEnemy.takeDamage(damage)) {
              this.soundManager.playHit()
              this._tmpHitPos.copy(this.dummyEnemy.position)
              this._tmpHitPos.y += 1.0
              this.damageNumbers.spawn(damage, this._tmpHitPos)
              this._showEnemyHud('訓練假人 Dummy Target', this.dummyEnemy.hpRatio)
            }
          })
        }
        for (const npc of this.npcs) {
          if (npc.dead || npc.faction !== Faction.ENEMY) continue
          if (checkImpact(mount, npc.combatPosition, 0.5)) {
            applyImpactDamage(mount, npc, npc.combatPosition, (damage) => {
              const result = damageNpc(npc, damage)
              if (result.hitSuccess) {
                this.soundManager.playHit()
                this._tmpHitPos.copy(npc.combatPosition)
                this._tmpHitPos.y += 1.0
                this.damageNumbers.spawn(damage, this._tmpHitPos)
                this._showEnemyHud(result.targetName, result.hpRatio)
              }
            })
          }
        }
      } else if (mount.riderFaction === Faction.ENEMY && !this.player.dead) {
        if (checkImpact(mount, this.player.position, 0.38)) {
          applyImpactDamage(mount, this.player, this.player.position, (damage) => {
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              this._tmpHitPos.copy(this.player.position)
              this._tmpHitPos.y += 1.0
              this.damageNumbers.spawn(damage, this._tmpHitPos)
              if (result.isMountHit) {
                this.mountHpFill.style.width = `${Math.max(0, result.hpRatio * 100)}%`
              } else {
                this.mountHud.classList.remove('visible')
              }
            }
          })
        }
      }
    }
  }

  // ── Resize ──
  private _setupResize(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  // ── Main loop ──
  private _loop = (): void => {
    requestAnimationFrame(this._loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    for (const instance of this.humanoidShowcase) {
      instance.update(dt, instance.root.position.distanceTo(this.camera.position))
    }

    // The humanoid studio owns a free orbit/pan camera and never follows Player.
    if (this.studioControls) this.studioControls.update()
    else this.thirdPersonCamera.update(this.input, dt)
    const cameraAimPoint = this.isModelStudio
      ? this.camera.getWorldDirection(this._tmpCameraDir).multiplyScalar(100).add(this.camera.position)
      : this._getCameraAimPoint(this._tmpHitPos)
    this._debugAimPoint.copy(cameraAimPoint)

    // Update Compass direction bar
    this.compassUI.update(this.thirdPersonCamera.cameraYaw)

    // Update Player logic
    if (!this.isModelStudio) this.player.update(
      dt,
      this.input,
      this.thirdPersonCamera.cameraYaw,
      cameraAimPoint,
      this.obstacles,
      this.staminaBar,
      this.quiverUI,
      this.soundManager,
      this.inventoryManager,
      this.skillManager.getArcheryMultiplier()
    )

    // Update Dummy Enemy
    this.dummyEnemy.update(dt)

    // Update NPCs
    this.npcGrid.clear()
    for (const npc of this.npcs) {
      if (npc.hp > 0) this.npcGrid.insert(npc)
    }



    for (const npc of this.npcs) {
      if (npc.hp <= 0) {
        // Dead NPCs still need animation update, but no AI/Boids
        npc.update(dt, this.player, this.npcs, [], this.obstacles, this.hpBar, 
          () => {}, // dead npc can't hit
          () => {}, // dead npc can't shoot
          true // skipBoidsAndObstacles
        )
        continue
      }

      // No LOD tiers. Full update for everyone.
      const skipBoidsAndObstacles = false
      const nearbyNPCs = this.npcGrid.getNearby(npc.combatPosition, 40)

      npc.update(
        dt, 
        this.player,
        this.npcs,
        nearbyNPCs,
        this.obstacles,
        this.hpBar, 
        (damage, isPlayer, targetNpc) => {
          // Melee Hit Callback
          if (isPlayer) {
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              const hitPos = this.player.position.clone()
              hitPos.y += 1.2
              this.damageNumbers.spawn(damage, hitPos)
              if (result.isMountHit) {
                this.mountHpFill.style.width = `${Math.max(0, result.hpRatio * 100)}%`
              } else {
                this.mountHud.classList.remove('visible')
              }
            }
          } else if (targetNpc) {
            const result = damageNpc(targetNpc, damage)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              const hitPos = targetNpc.combatPosition.clone()
              hitPos.y += 1.2
              this.damageNumbers.spawn(damage, hitPos)
            }
          }
        },
        (origin, direction, visualKind) => {
          // Ranged Fire Callback
          const arrow = new ArrowProjectile(
            this.scene,
            origin,
            direction,
            20.0, // NPC arrow / pilum speed
            npc.rangedDamage, // Arrow damage
            npc.faction,
            false,
            visualKind,
          )
          this.arrows.push(arrow)
          this.soundManager.playHit() // Should ideally be a bow string sound, using hit for now
        },
        skipBoidsAndObstacles
      )
    }

    // Check Player Melee Sword Hits
    this._checkPlayerMeleeHits()

    // Update Pickups & Mounts Interaction
    this._updateInteractions(dt)
    if (this.isMountStudio) this._updateMountStudioStatus()
    if (this.isDevCombat) this._updateDevCombatStatus(dt)

    // Resolve all entity overlaps after every entity has moved this frame.
    this._resolveEntityCollisions()

    // Reset impact flag
    for (const mount of this.mounts) {
      mount.skipImpactThisFrame = false
    }

    // Update Arrow Projectiles
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.update(dt, this.dummyEnemy, this.player, this.npcs, this.obstacles, (damage, hitPos, targetName, hpRatio, isPlayer, _npc, isMountHit) => {
        this.soundManager.playHit()
        this.damageNumbers.spawn(damage, hitPos)
        if (!isPlayer && arrow.isPlayerFired) {
          this._showEnemyHud(targetName, hpRatio)
          this.skillManager.addXp('archery', 35, this.soundManager)
        }
        if (isPlayer && isMountHit) {
          if (this.player.isMounted && this.player.currentMount) {
            this.mountHpFill.style.width = `${Math.max(0, hpRatio * 100)}%`
          } else {
            this.mountHud.classList.remove('visible')
          }
        }
      })

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }

    // Process Impact Damage
    this._updateImpactDamage(this.clock.elapsedTime)

    // Update Floating Damage numbers
    this.damageNumbers.update(dt, this.camera)

    this.combatTrajectoryDebugger?.update(this.player, this.npcs, this.arrows, this._debugAimPoint)

    this.renderer.render(this.scene, this.camera)
  }
}
