/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createSky } from './world/Sky'
import { createTerrain, getTerrainHeight, EntityCollisionBody, ObstacleData, resolveEntityCollision, resolveObstacleCollision } from './world/Terrain'
import { Player } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { SpectatorCameraController } from './camera/SpectatorCameraController'

export type PlayerControlMode = 'player' | 'spectator'

/**
 * State helper determining whether death banner should show now or wait until next spectator lock acquisition.
 */
export function onSpectatorModeEntered(isOverlayCovering: boolean): {
  showBannerNow: boolean
  pendingOnNextLock: boolean
} {
  if (isOverlayCovering) {
    return { showBannerNow: false, pendingOnNextLock: true }
  }
  return { showBannerNow: true, pendingOnNextLock: false }
}

/**
 * Consumes the one-shot pending death banner flag when pointer lock is acquired in spectator mode.
 */
export function consumeSpectatorDeathBannerPending(state: {
  controlMode: PlayerControlMode
  pendingOnNextLock: boolean
}): boolean {
  if (state.controlMode === 'spectator' && state.pendingOnNextLock) {
    state.pendingOnNextLock = false
    return true
  }
  return false
}

/**
 * Handles side effects (enemy HUD, Archery XP, Mount HUD) when a projectile hits a target.
 * Gated so player-only side effects never trigger when the player is dead or in spectator mode.
 */
export function handleProjectileHitEffects(
  isPlayerTarget: boolean,
  isPlayerFired: boolean,
  targetName: string,
  hpRatio: number,
  isMountHit: boolean,
  playerStatus: { dead: boolean; controlMode: PlayerControlMode; isMounted: boolean; hasMount: boolean; spectatorOnly?: boolean },
  actions: {
    showEnemyHud: (targetName: string, hpRatio: number) => void
    addArcheryXp: (amount: number) => void
    updateMountHp: (hpRatio: number) => void
    hideMountHud: () => void
  },
): { enemyHudShown: boolean; xpGranted: boolean } {
  const isPlayerActive = !playerStatus.dead && !playerStatus.spectatorOnly && playerStatus.controlMode === 'player'

  let enemyHudShown = false
  let xpGranted = false

  if (!isPlayerTarget && isPlayerFired) {
    if (isPlayerActive) {
      actions.showEnemyHud(targetName, hpRatio)
      actions.addArcheryXp(35)
      enemyHudShown = true
      xpGranted = true
    }
  }

  if (isPlayerTarget && isMountHit) {
    if (isPlayerActive && playerStatus.isMounted && playerStatus.hasMount) {
      actions.updateMountHp(hpRatio)
    } else {
      actions.hideMountHud()
    }
  }

  return { enemyHudShown, xpGranted }
}
import { SaveManager, type PlayerSaveData } from './save/SaveManager'
import { StaminaBar } from './ui/StaminaBar'
import { HpBar } from './ui/HpBar'
import { NPC, Faction } from './world/NPC'
import {
  BattleConfig,
  PRESET_DEVCOMBAT,
  PRESET_SCENARIO_A,
  PRESET_SCENARIO_B,
  PRESET_SCENARIO_C,
  PRESET_SCENARIO_D,
} from './battle/BattleConfig'
import { BattleSpawner, VIKING_PLAYER_SPAWN, BattleSpawnPlan, NpcSpawnSpec } from './battle/BattleSpawner'
import { BattleController } from './battle/BattleController'
import { SpatialGrid } from './world/SpatialGrid'
import { ArrowProjectile } from './world/ArrowProjectile'
import { DEFAULT_MOUNT_TYPE, Mount, MountState, MountType, mountTypeFromSave } from './world/Mount'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from './world/AimTargetRegistry'
import { CombatRenderWarmup } from './world/CombatRenderWarmup'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { CompassUI } from './ui/CompassUI'
import { EquipmentUI } from './ui/EquipmentUI'
import { SoundManager } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import { calculateLanceChargeDamage } from './rpg/WeaponDatabase'
import { WeaponPickup } from './world/WeaponPickup'
import { RuntimeProfiler } from './debug/RuntimeProfiler'

function distToSegmentSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abX = b.x - a.x, abY = b.y - a.y, abZ = b.z - a.z
  const apX = p.x - a.x, apY = p.y - a.y, apZ = p.z - a.z
  const abLenSq = abX * abX + abY * abY + abZ * abZ
  if (abLenSq < 1e-6) {
    return apX * apX + apY * apY + apZ * apZ
  }
  const t = Math.max(0, Math.min(1, (apX * abX + apY * abY + apZ * abZ) / abLenSq))
  const qX = a.x + t * abX, qY = a.y + t * abY, qZ = a.z + t * abZ
  const dx = p.x - qX, dy = p.y - qY, dz = p.z - qZ
  return dx * dx + dy * dy + dz * dz
}

export function reconcileLoadedMounts(
  mounts: Mount[],
  startingHorse: Mount | null,
  loadedSaveMount: Mount | null,
  newMountToLoad: Mount | null
): {
  mounts: Mount[]
  startingHorse: null
  loadedSaveMount: Mount | null
} {
  if (startingHorse) {
    const idx = mounts.indexOf(startingHorse)
    if (idx !== -1) mounts.splice(idx, 1)
    startingHorse.dispose()
  }
  if (loadedSaveMount) {
    const idx = mounts.indexOf(loadedSaveMount)
    if (idx !== -1) mounts.splice(idx, 1)
    loadedSaveMount.dispose()
  }
  if (newMountToLoad) {
    mounts.push(newMountToLoad)
  }
  return {
    mounts,
    startingHorse: null,
    loadedSaveMount: newMountToLoad,
  }
}

/**
 * Resolves the ground spawn position for a mount being restored from save data.
 * Prefers mountData.position (ground position of mount).
 * Falls back to data.position (rider saddle position) for legacy saves lacking mountData.position.
 */
export function resolveMountSpawnPosition(
  saveData: {
    position: { x: number; y: number; z: number }
    mountData?: PlayerSaveData['mountData']
  }
): { x: number; y: number; z: number } {
  if (saveData.mountData && saveData.mountData.position) {
    return { ...saveData.mountData.position }
  }
  return { ...saveData.position }
}

/**
 * Resolves the ground spawn Y coordinate for a mount being restored from save data.
 * Returns mountData.position.y when saved with modern format.
 * Returns undefined for legacy saves so terrain height is used rather than rider saddle Y.
 */
export function resolveMountSpawnY(
  saveData: {
    mountData?: PlayerSaveData['mountData']
  }
): number | undefined {
  return saveData.mountData?.position ? saveData.mountData.position.y : undefined
}
import { damageNpc, damagePlayer } from './combat/DamageRouter'
import { CombatTrajectoryDebugger } from './debug/CombatTrajectoryDebugger'
import { createBowComparisonPanel } from './debug/BowComparisonPanel'
import type { GameplayBowQAPanel } from './debug/GameplayBowQAPanel'
import { HumanoidStudioPlayback } from './debug/HumanoidStudioPlayback'
import { HumanoidAssetRegistry } from './world/HumanoidAssetRegistry'
import type { HumanoidCharacterInstance } from './world/HumanoidAssetRegistry'
import {
  HorseAssetRegistry,
  horseVariantForStableKey,
  horseVariantFromSave,
  type HorseAnimationState,
  type HorseAppearanceVariant,
} from './world/HorseAssetRegistry'
import type { HumanoidAnimationState } from './world/CharacterVisuals'

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
  static async create(container: HTMLElement, battleConfig?: BattleConfig): Promise<Game | GameplayBowQAPanel> {
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
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('devbowqa')) {
        await HumanoidAssetRegistry.preload()
        const { GameplayBowQAPanel } = await import('./debug/GameplayBowQAPanel')
        return new GameplayBowQAPanel(renderer)
      }
      if (legacyQa) {
        await HorseAssetRegistry.preload(renderer)
        const game = new Game(renderer, battleConfig)
        CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
        return game
      }
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer)])
      const game = new Game(renderer, battleConfig)
      CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
      return game
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
  private spectatorController: SpectatorCameraController
  private controlMode: PlayerControlMode = 'player'
  private _spectatorReason: 'death' | 'initial' = 'death'
  private studioControls: OrbitControls | null = null

  get playerControlMode(): PlayerControlMode {
    return this.controlMode
  }
  get spectatorReason(): 'death' | 'initial' {
    return this._spectatorReason
  }
  private isHumanoidStudio = false
  private isMountStudio = false
  private isModelStudio = false
  private isDevCombat = false
  private isBenchmarkMode = false
  private frozenHumanoidLod2Diagnostic = false

  private battleController: BattleController | null = null
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
  private humanoidStudioPlayback = new Map<HumanoidCharacterInstance, HumanoidStudioPlayback>()
  private humanoidStudioEquipped = true
  private humanoidStudioPaused = false
  private humanoidSkeletonHelpers: THREE.SkeletonHelper[] = []
  private mountStudioHorse: Mount | null = null
  private mountStudioRider: HumanoidCharacterInstance | null = null
  private mountStudioRiderPelvisHeight = 0
  private mountStudioSkeleton: THREE.SkeletonHelper | null = null
  private mountStudioStatus: HTMLElement | null = null
  private devCombatStatus: HTMLElement | null = null
  private hasDevCombatRenderedInitialHud = false
  readonly runtimeProfiler = new RuntimeProfiler(1000)
  private startingHorse: Mount | null = null
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
  private deathBanner: HTMLElement | null = null
  private spectatorBadge: HTMLElement | null = null
  private hintTimer: number | null = null
  private notifyTimer: number | null = null
  private deathBannerTimer: number | null = null
  private showDeathBannerOnNextSpectatorLock = false

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpCameraDir = new THREE.Vector3()
  private readonly _aimRaycaster = new THREE.Raycaster()
  private readonly _aimScreenCenter = new THREE.Vector2(0, 0)
  private readonly _aimTargetRegistry = new AimTargetRegistry()

  private readonly _tmpHitPos = new THREE.Vector3()
  private readonly _debugAimPoint = new THREE.Vector3()
  private readonly _tmpGripPos = new THREE.Vector3()
  private readonly _tmpPlayerForward = new THREE.Vector3()
  private readonly _tmpToTarget = new THREE.Vector3()
  private readonly _tmpAiCenter = new THREE.Vector3()

  private _getCameraAimPoint(target: THREE.Vector3): THREE.Vector3 {
    this.thirdPersonCamera.getAimDirection(this._tmpCameraDir)
    target.copy(this.camera.position).addScaledVector(this._tmpCameraDir, 100)
    if (!this.player.isAiming) return target

    this._aimRaycaster.setFromCamera(this._aimScreenCenter, this.camera)
    this._tmpCameraDir.copy(this._aimRaycaster.ray.direction)
    target.copy(this._aimRaycaster.ray.origin).addScaledVector(this._tmpCameraDir, 100)
    this._aimRaycaster.far = 100
    const intersections = this._aimRaycaster.intersectObjects(this._aimTargetRegistry.targets, false)
    if (intersections.length > 0) {
      return target.copy(intersections[0].point)
    }
    return target
  }

  // LOD & Spatial Partitioning
  private npcGrid = new SpatialGrid<NPC>(20)

  constructor(renderer: THREE.WebGLRenderer, battleConfig?: BattleConfig) {
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
    this._aimRaycaster.layers.enable(AIM_RAYCAST_LAYER)

    // ── World ──
    createSky(this.scene)
    const { terrainMesh, obstacles, obstacleMeshes } = createTerrain(this.scene)
    this.obstacles = obstacles
    this._aimTargetRegistry.addStaticTarget(terrainMesh)
    for (const obstacleMesh of obstacleMeshes) {
      this._aimTargetRegistry.addStaticTarget(obstacleMesh)
    }

    // ── Player & Input ──
    this.input = new PlayerInput()
    this.player = new Player(this.scene)
    // Release and diagnostic armies are ahead at -Z. Establish the actor's
    // heading first; the camera derives its rear orbit from that heading.
    this.player.faceDirection(0, -1)

    const isInitialSpectator = Boolean(battleConfig?.spectator)
    if (isInitialSpectator) {
      this.player.spectatorOnly = true
      this.player.group.visible = false
    }

    const query = new URLSearchParams(window.location.search)
    this.isDevCombat = query.has('devcombat')
    this.isBenchmarkMode = this.isDevCombat && query.has('benchmark')
    const devModelsMode = query.get('devmodels')
    this.isHumanoidStudio = devModelsMode === 'humans'
    this.isMountStudio = devModelsMode === 'mounts'
    this.isModelStudio = this.isHumanoidStudio || this.isMountStudio

    // Resolve BattleSpawnPlan if applicable
    let battlePlan: BattleSpawnPlan | null = null
    if (this.isDevCombat) {
      if (!this.isBenchmarkMode) this.combatTrajectoryDebugger = new CombatTrajectoryDebugger(this.scene)
      const devVal = query.get('devcombat')?.toLowerCase()
      let scenarioConfig = PRESET_DEVCOMBAT
      if (devVal === 'a' || devVal === 'scenarioa') {
        scenarioConfig = PRESET_SCENARIO_A
      } else if (devVal === 'b' || devVal === 'scenariob') {
        scenarioConfig = PRESET_SCENARIO_B
      } else if (devVal === 'c' || devVal === 'scenarioc') {
        scenarioConfig = PRESET_SCENARIO_C
      } else if (devVal === 'd' || devVal === 'scenariod') {
        scenarioConfig = PRESET_SCENARIO_D
      }
      battlePlan = BattleSpawner.createSpawnPlan(scenarioConfig)
    } else if (battleConfig) {
      battlePlan = BattleSpawner.createSpawnPlan(battleConfig)
    }

    // ── Camera controller ──
    this.thirdPersonCamera = new ThirdPersonCamera(this.camera, this.player)
    this.spectatorController = new SpectatorCameraController(this.camera)
    if (this.isModelStudio) {
      this._setupModelStudioCamera()
    } else if (isInitialSpectator) {
      const initY = getTerrainHeight(0, 0) + 5
      this.camera.position.set(0, initY, 0)
      this.camera.lookAt(0, initY, -1)
      this.spectatorController.initFromCamera(this.camera)
    } else {
      const playerSpawn = battlePlan?.playerSpawn ?? VIKING_PLAYER_SPAWN
      const terrainY = getTerrainHeight(playerSpawn.x, playerSpawn.z)
      this.player.group.position.set(playerSpawn.x, terrainY + 0.95, playerSpawn.z)
      this.player.spawnX = playerSpawn.x
      this.player.spawnZ = playerSpawn.z
      this.thirdPersonCamera.setYaw(0)
    }

    this.lockOverlay    = document.getElementById('lock-overlay')!
    this.controlsHint   = document.getElementById('controls-hint')!
    this.saveNotify     = document.getElementById('save-notify')!
    this.deathBanner    = document.getElementById('death-banner')
    this.spectatorBadge = document.getElementById('spectator-badge')
    this.pickupPromptEl = document.getElementById('pickup-prompt')!

    this.enemyHud    = document.getElementById('enemy-hud')!
    this.enemyNameEl = document.getElementById('enemy-name')!
    this.enemyHpFill = document.getElementById('enemy-hp-fill')!

    this.mountHud    = document.getElementById('mount-hud')!
    this.mountNameEl = document.getElementById('mount-name')!
    this.mountHpFill = document.getElementById('mount-hp-fill')!

    // ── Combat & Enemies ──
    if (this.isDevCombat && battlePlan) {
      this._executeBattleSpawnPlan(battlePlan)
    } else if (devModelsMode === 'humans') {
      this._spawnHumanoidStudio()
    } else if (devModelsMode === 'mounts') {
      this._spawnMountStudio()
    } else if (battleConfig && battlePlan) {
      this._executeBattleSpawnPlan(battlePlan)
      this.battleController = new BattleController(battleConfig)
      this.battleController.initCounts(this.npcs)
    }

    if (!this.isModelStudio && !isInitialSpectator) {
      const playerSpawn = battlePlan?.playerSpawn ?? VIKING_PLAYER_SPAWN
      const startingHorse = new Mount(
        this.scene,
        DEFAULT_MOUNT_TYPE,
        playerSpawn.x,
        playerSpawn.z
      )
      this.startingHorse = startingHorse
      this.mounts.push(startingHorse)
      this._mountPlayer(startingHorse)
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


    // ── Save Manager ──
    this.saveManager = new SaveManager()

    // ── Spawn World Pickups & Mounts ──
    if (this.isDevCombat && !this.isBenchmarkMode) this._createDevCombatStatus()

    if (import.meta.env.DEV && query.has('humanoidLod2Control')) {
      ;(window as any).__setHumanoidLod2Representation = (optimized: boolean) => this._setHumanoidLod2Representation(Boolean(optimized))
      ;(window as any).__freezeHumanoidLod2Scene = (frozen = true) => {
        this.frozenHumanoidLod2Diagnostic = Boolean(frozen)
        return { frozen: this.frozenHumanoidLod2Diagnostic }
      }
    }

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

    // Player Death notify & Spectator transition
    this.player.onPlayerDeath = () => {
      this._enterSpectatorMode('death')
    }

    if (isInitialSpectator) {
      this._enterSpectatorMode('initial')
    }

    this._setupPointerLock()
    this._setupResize()
    this._setupShortcuts()

    // Initialise bars
    if (!isInitialSpectator) {
      this.hpBar.setFill(this.player.hpRatio)
      this.staminaBar.setFill(1)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

    this._loop()
  }

  private _spawnHumanoidStudio(): void {
    this.player.group.visible = false
    const grid = new THREE.GridHelper(22, 22, 0x837765, 0x413b33)
    grid.position.y = HUMANOID_STUDIO_FLOOR_Y + 0.025
    this.scene.add(grid)
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
      instance.root.position.set(display.x, HUMANOID_STUDIO_FLOOR_Y, display.z)
      instance.root.rotation.y = display.rotation
      if (display.state === 'mounted' || display.state === 'mountedLance') {
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
      const studioState = display.state === 'bowAim' ? 'bowHold' : display.state
      instance.rig.animation?.play(studioState, {
        fadeSeconds: 0,
        loop: studioState === 'idle' || studioState === 'walk' || studioState === 'run' || studioState === 'bowHold',
      })
      this.scene.add(instance.root)
      this.humanoidShowcase.push(instance)
      this.humanoidStudioPlayback.set(instance, new HumanoidStudioPlayback(instance, studioState, display.faction))
      if (studioState === 'lanceThrust' || studioState === 'mountedLance') this.humanoidStudioPlayback.get(instance)!.setEquipmentLoadout('lance', true)
      instance.root.userData.studioState = studioState
      const label = this._createStudioLabel(`${display.faction}｜${studioState}`, display.x)
      label.position.z = display.z
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
    createBowComparisonPanel(this.humanoidStudioPlayback, this.camera, this.scene, () => {
      this.humanoidStudioPaused = true
      for (const helper of this.humanoidSkeletonHelpers) helper.visible = false
      for (const mount of this.mounts) mount.group.visible = false
      return this.studioControls!
    }, () => {
      this.humanoidStudioPaused = false
      for (const mount of this.mounts) mount.group.visible = true
      this.camera.fov = 48
      this.camera.updateProjectionMatrix()
      this.studioControls!.target.set(-1.2, HUMANOID_STUDIO_FLOOR_Y + 1.15, 0)
      this.camera.position.set(10.5, HUMANOID_STUDIO_FLOOR_Y + 5.2, 11.5)
      this.studioControls!.update()
    })
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

  private _createStudioLabel(text: string, x: number): THREE.Sprite {
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
    return sprite
  }

  private _spawnMountStudio(): void {
    this.player.group.visible = false
    const grid = new THREE.GridHelper(12, 24, 0x9e8e73, 0x4b453d)
    grid.position.y = HUMANOID_STUDIO_FLOOR_Y + 0.012
    this.scene.add(grid)

    const mount = new Mount(this.scene, DEFAULT_MOUNT_TYPE, 0, 0, HUMANOID_STUDIO_FLOOR_Y)
    mount.visualHold = true
    mount.playStudioClip('idle')
    this.mounts.push(mount)
    this.mountStudioHorse = mount

    // Stable browser-QA setup: start as a horse knight so saddle fit,
    // rider legs, gait, jump and dismount can be inspected
    // without depending on repeated single-frame keypresses.
    this.player.mountVehicle(mount, mount.group.rotation.y)
    this.mountNameEl.textContent = `坐騎：${mount.displayName}`
    this.mountHpFill.style.width = '100%'
    this.mountHud.classList.add('visible')

    const comparisonHorse = new Mount(this.scene, DEFAULT_MOUNT_TYPE, 4.4, 8, undefined, 1)
    comparisonHorse.visualHold = true
    this.mounts.push(comparisonHorse)
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
      const playback = new HumanoidStudioPlayback(rider, 'mounted', 'viking')
      playback.setEquipmentLoadout('lance', true)
      playback.sampleEquipment(0, true)
      this.humanoidStudioPlayback.set(rider, playback)
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
    help.textContent = '戰馬工作室｜1–9 動畫・0 花色・Space 暫停・R 重播・H 骨架・V 騎士・L 劍／槍・Q 盾牌・F 攻擊｜左鍵旋轉・右鍵平移・滾輪縮放'
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
      } else if (this.mountStudioRider && ['KeyL', 'KeyQ', 'KeyF'].includes(event.code)) {
        const playback = this.humanoidStudioPlayback.get(this.mountStudioRider)!
        if (event.code === 'KeyF') playback.attackEquipment()
        else playback.setEquipmentLoadout(event.code === 'KeyL' ? playback.lance.visible ? 'sword' : 'lance' : playback.lance.visible ? 'lance' : 'sword', event.code === 'KeyQ' ? !playback.shield.visible : playback.shield.visible)
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
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:30;min-width:290px;padding:10px 14px;border:1px solid #8b7962;background:rgba(20,17,14,.92);color:#eadfce;font:12px/1.42 ui-monospace,monospace;white-space:pre;pointer-events:none'
    document.body.appendChild(status)
    this.devCombatStatus = status
  }

  /** DEV-only frozen A/B hook. Production keeps only the optimized LOD2 representation. */
  private _setHumanoidLod2Representation(optimized: boolean): { optimized: boolean, controlledRomanLod2: number } {
    let controlledRomanLod2 = 0
    for (const npc of this.npcs) {
      npc.characterVisualGroup.traverse(object => {
        if (!(object instanceof THREE.LOD)) return
        const control = object.levels[2]?.object.userData.humanoidLod2RepresentationControl as
          | { setOptimized(enabled: boolean): void }
          | undefined
        if (!control) return
        control.setOptimized(optimized)
        controlledRomanLod2++
      })
    }
    return { optimized, controlledRomanLod2 }
  }

  private _updateDevCombatStatus(): void {
    if (!this.devCombatStatus) return
    const lodCounts = [0, 0, 0]
    let horses = 0
    for (const mount of this.mounts) {
      const state = mount.getHorseDebugState()
      if (!state) continue
      horses++
      lodCounts[state.lod]++
    }
    const info = this.renderer.info
    this.devCombatStatus.textContent = this.runtimeProfiler.formatHUD({
      npcCount: this.npcs.length,
      horseCount: horses,
      arrowCount: this.arrows.length,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      mixers: horses,
      lodCounts,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    })
  }

  private _createHumanoidStudioHelp(): void {
    const help = document.createElement('div')
    help.id = 'humanoid-studio-help'
    help.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:30;padding:10px 12px;border:1px solid #8b7962;background:rgba(20,17,14,.84);color:#eadfce;font:13px/1.45 system-ui;pointer-events:none'
    let equipmentLance = false
    let equipmentShield = true
    const updateHelp = () => { help.textContent = `人物工作室｜${this.humanoidStudioEquipped ? '正式控制器＋裝備' : '純 GLB 動畫'}｜模式: 劍握持修正 OFF｜B 切換・L 劍／槍・Q 盾牌・Space 暫停・R 重播・H 骨架｜左鍵旋轉・右鍵/方向鍵平移・滾輪縮放` }
    updateHelp()
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyL' || event.code === 'KeyQ') {
        if (event.code === 'KeyL') equipmentLance = !equipmentLance
        else equipmentShield = !equipmentShield
        for (const playback of this.humanoidStudioPlayback.values()) {
          if (!playback.state.startsWith('bow') && playback.state !== 'pilumThrow' && playback.state !== 'death') {
            playback.setEquipmentLoadout(equipmentLance || playback.state.includes('Lance') || playback.state === 'lanceThrust' ? 'lance' : 'sword', equipmentShield)
          }
        }
      } else if (event.code === 'KeyB') {
        this.humanoidStudioEquipped = !this.humanoidStudioEquipped
        for (const playback of this.humanoidStudioPlayback.values()) playback.setEquipped(this.humanoidStudioEquipped)
        updateHelp()
      } else if (event.code === 'Space') {
        event.preventDefault()
        this.humanoidStudioPaused = !this.humanoidStudioPaused
      } else if (event.code === 'KeyR') {
        for (const playback of this.humanoidStudioPlayback.values()) playback.reset()
      }
    })
    document.body.appendChild(help)
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyH') return
      const visible = !this.humanoidSkeletonHelpers[0]?.visible
      for (const helper of this.humanoidSkeletonHelpers) helper.visible = visible
    })
  }

  private _spawnNpc(spec: NpcSpawnSpec): NPC {
    const npc = new NPC(
      this.scene,
      spec.x,
      spec.z,
      spec.faction,
      spec.aiType,
      spec.name,
      spec.tier,
      spec.cavalry,
    )
    npc.respawnEnabled = spec.respawnEnabled
    this.npcs.push(npc)
    this._aimTargetRegistry.registerNpc(npc)
    if (npc.mount) {
      this.mounts.push(npc.mount)
      this._aimTargetRegistry.registerMount(npc.mount)
    }
    return npc
  }

  private _executeBattleSpawnPlan(plan: BattleSpawnPlan): void {
    for (const spec of plan.npcSpecs) {
      this._spawnNpc(spec)
    }
    for (const p of plan.pickupSpecs) {
      this.pickups.push(new WeaponPickup(this.scene, p.weaponId, p.x, p.z, p.isArrowPack, p.arrowQuantity))
    }
    for (const h of plan.horseSpecs) {
      const variant = horseVariantForStableKey(h.stableKey)
      const mount = new Mount(this.scene, DEFAULT_MOUNT_TYPE, h.x, h.z, undefined, variant)
      this.mounts.push(mount)
      this._aimTargetRegistry.registerMount(mount)
    }
  }

  // ── Pointer Lock ──
  private _updateLockOverlayPrompt(isResume: boolean = true): void {
    const promptEl = document.getElementById('lock-overlay-prompt')
    const subEl = document.getElementById('lock-overlay-sub')
    if (promptEl) {
      if (this.controlMode === 'spectator') {
        if (this._spectatorReason === 'initial') {
          promptEl.textContent = isResume
            ? '點擊繼續觀戰 ｜ CLICK TO RESUME SPECTATING'
            : '點擊進入觀戰 ｜ CLICK TO START SPECTATING'
        } else {
          promptEl.textContent = '💀 你已陣亡 — 點擊繼續觀戰 ｜ CLICK TO RESUME SPECTATING'
        }
        if (subEl) {
          subEl.textContent = '(按 ESC 暫停 / 釋放游標 ｜ 自由觀戰模式)'
        }
      } else {
        promptEl.textContent = isResume ? '點擊繼續戰鬥 ｜ CLICK TO RESUME' : '點擊進入戰鬥 ｜ CLICK TO ENTER BATTLE'
        if (subEl) {
          subEl.textContent = '(按 ESC 暫停 / 釋放游標)'
        }
      }
    }
  }

  private _showDeathBanner(): void {
    if (!this.deathBanner) return
    this.deathBanner.textContent = '💀 你已陣亡 — 自由觀戰模式'
    this.deathBanner.classList.add('visible')
    if (this.deathBannerTimer !== null) clearTimeout(this.deathBannerTimer)
    this.deathBannerTimer = window.setTimeout(() => {
      this.deathBanner?.classList.remove('visible')
      this.deathBannerTimer = null
    }, 4500)
  }

  private _consumePendingDeathBanner(): boolean {
    if (consumeSpectatorDeathBannerPending({
      controlMode: this.controlMode,
      pendingOnNextLock: this.showDeathBannerOnNextSpectatorLock,
    })) {
      this.showDeathBannerOnNextSpectatorLock = false
      this._showDeathBanner()
      return true
    }
    return false
  }

  private _setupPointerLock(): void {
    const isNoLock = window.location.search.includes('nolock')

    const unlockAudio = (): void => {
      this.soundManager.unlockAudio()
    }
    this.lockOverlay.addEventListener('click', unlockAudio)
    this.renderer.domElement.addEventListener('click', unlockAudio)
    window.addEventListener('pointerdown', unlockAudio, { once: true })

    if (this.isModelStudio || isNoLock) {
      this.lockOverlay.style.display = 'none'
      this.lockOverlay.classList.add('hidden')
    } else if (document.pointerLockElement) {
      // If pointer lock was already acquired from user gesture, enter directly without overlay
      this.lockOverlay.style.display = 'none'
      this.lockOverlay.classList.add('hidden')
    } else {
      this._updateLockOverlayPrompt(false)
      this.lockOverlay.style.display = 'flex'
      this.lockOverlay.classList.remove('hidden')
    }

    this.lockOverlay.addEventListener('click', () => {
      if (!this.equipmentUI?.visible) {
        this.lockOverlay.style.display = 'none'
        this.lockOverlay.classList.add('hidden')
        this.input.requestPointerLock(this.renderer.domElement)
      }
    })
    this.renderer.domElement.addEventListener('click', () => {
      if (!document.pointerLockElement && !this.equipmentUI?.visible && !this.isModelStudio && !isNoLock) {
        this.input.requestPointerLock(this.renderer.domElement)
      }
    })
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || isNoLock || this.isModelStudio) {
        this.lockOverlay.style.display = 'none'
        this.lockOverlay.classList.add('hidden')
        this._scheduleHintHide()
        this._consumePendingDeathBanner()
      } else {
        if (!this.equipmentUI?.visible) {
          this._updateLockOverlayPrompt(true)
          this.lockOverlay.style.display = 'flex'
          this.lockOverlay.classList.remove('hidden')
        }
        this.controlsHint.classList.remove('hidden')
        if (this.hintTimer !== null) clearTimeout(this.hintTimer)
      }
    })
  }

  private _scheduleHintHide(): void {
    if (this.controlMode === 'spectator') return
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
        if (this.player.dead || this.controlMode === 'spectator') return
        this._saveGame()
      })
    }

    if (menuLoad) {
      menuLoad.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        if (this.player.dead || this.controlMode === 'spectator') return
        this._loadGame()
      })
    }

    if (menuInv) {
      menuInv.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        if (this.player.dead || this.controlMode === 'spectator') return
        this.equipmentUI.toggle(this.skillManager, this.inventoryManager)
      })
    }

    window.addEventListener('keydown', (e) => {
      if (!this.isMountStudio && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        if (this.player.dead || this.controlMode === 'spectator') return
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
        if (this.player.dead || this.controlMode === 'spectator') return
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
    if (this.player.dead || this.controlMode === 'spectator') return
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
        position: {
          x: this.player.currentMount.group.position.x,
          y: this.player.currentMount.group.position.y,
          z: this.player.currentMount.group.position.z,
        },
      } : undefined
    })
    this._showNotify(ok ? '💾 遊戲已存檔（含背包裝備）' : '❌ 存檔失敗')
  }

  private _loadGame(): void {
    if (this.player.dead || this.controlMode === 'spectator') return
    if (!this.saveManager.hasSave()) {
      this._showNotify('⚠️ 沒有存檔')
      return
    }
    const data = this.saveManager.load()
    if (this.player.isMounted) this.player.dismountFromMount()

    let newMountToLoad: Mount | null = null
    if (data.mountData && data.mountData.isMounted) {
      // Create mount for player at load position (prefers mountData.position with data.position fallback)
      const mountType = mountTypeFromSave(data.mountData.type)
      const variant = mountType === MountType.HORSE
        ? horseVariantFromSave(data.mountData.appearanceVariant)
        : 0
      const mountPos = resolveMountSpawnPosition(data)
      const mountY = resolveMountSpawnY(data)
      newMountToLoad = new Mount(this.scene, mountType, mountPos.x, mountPos.z, mountY, variant)
    }

    // 1. Restore player stats, position, skills & inventory first
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

    this.staminaBar.setFill(data.stamina / 100)
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI.setArrowCount(this.player.arrowCount)

    // 2. Reconcile mounts and perform mounted orchestration as final authoritative transform state
    const reconciled = reconcileLoadedMounts(
      this.mounts,
      this.startingHorse,
      this.loadedSaveMount,
      newMountToLoad
    )
    this.startingHorse = reconciled.startingHorse
    this.loadedSaveMount = reconciled.loadedSaveMount

    if (newMountToLoad) {
      this._mountPlayer(newMountToLoad)
    } else {
      this.mountHud.classList.remove('visible')
    }

    this._showNotify('📂 讀檔成功（還原背包與裝備）')
  }

  private _mountPlayer(mount: Mount, initialHeading?: number): void {
    this._aimTargetRegistry.unregisterMount(mount)
    this.player.mountVehicle(mount, initialHeading)

    this.mountNameEl.textContent = `坐騎：${mount.displayName}`
    this.mountHpFill.style.width = `${Math.max(0, (mount.currentHp / mount.maxHp) * 100)}%`
    this.mountHud.classList.add('visible')
  }

  private _showNotify(msg: string, durationMs = 2000): void {
    this.saveNotify.textContent = msg
    this.saveNotify.classList.add('visible')
    if (this.notifyTimer !== null) clearTimeout(this.notifyTimer)
    this.notifyTimer = window.setTimeout(() => {
      this.saveNotify.classList.remove('visible')
    }, durationMs)
  }

  private _enterSpectatorMode(reason: 'death' | 'initial' = 'death'): void {
    if (this.controlMode === 'spectator') return
    this.controlMode = 'spectator'
    this._spectatorReason = reason
    this.spectatorController.initFromCamera(this.camera)

    // Close equipment modal if open when player died so it doesn't block spectator view
    if (this.equipmentUI?.visible) {
      this.equipmentUI.close()
    }

    if (reason === 'death') {
      // If pointer lock is not active (e.g. was released for equipment modal), show lock overlay with spectator wording
      // and defer death banner until pointer lock is next acquired so it isn't hidden behind the full-screen overlay.
      const isNoLock = typeof window !== 'undefined' && window.location?.search?.includes('nolock')
      const hasPointerLock = typeof document !== 'undefined' && !!document.pointerLockElement
      const overlayCovering = !hasPointerLock && !this.isModelStudio && !isNoLock && !!this.lockOverlay

      if (overlayCovering) {
        this._updateLockOverlayPrompt(true)
        this.lockOverlay.style.display = 'flex'
        this.lockOverlay.classList.remove('hidden')
      } else {
        this._updateLockOverlayPrompt(true)
      }

      const { showBannerNow, pendingOnNextLock } = onSpectatorModeEntered(overlayCovering)
      this.showDeathBannerOnNextSpectatorLock = pendingOnNextLock
      if (showBannerNow) {
        this._showDeathBanner()
      }
    } else {
      this.showDeathBannerOnNextSpectatorLock = false
    }

    // 2. Show persistent spectator badge
    if (this.spectatorBadge) {
      this.spectatorBadge.classList.remove('hidden')
    }

    // 3. Replace bottom gameplay controls hint with spectator controls, keep visible
    if (this.controlsHint) {
      this.controlsHint.innerHTML = 'WASD 移動 ｜ Space 上升 ｜ Ctrl 下降 ｜ Shift 加速 ｜ 滑鼠控制視角'
      this.controlsHint.classList.remove('hidden')
      if (this.hintTimer !== null) {
        clearTimeout(this.hintTimer)
        this.hintTimer = null
      }
    }

    // 4. Hide player-only combat & interaction HUD
    this.pickupPromptEl?.classList.remove('visible')
    this.mountHud?.classList.remove('visible')
    if (this.enemyHud) {
      this.enemyHud.classList.remove('visible')
      if (this.enemyHudTimer !== null) {
        clearTimeout(this.enemyHudTimer)
        this.enemyHudTimer = null
      }
    }
    this.quiverUI?.setAiming(false)
    this.quiverUI?.setChargeRatio(0)
    if (typeof document !== 'undefined') {
      document.getElementById('vital-bars')?.classList.add('hidden')
      document.getElementById('quiver-hud')?.classList.add('hidden')
      document.getElementById('crosshair')?.classList.add('hidden')
      document.getElementById('aim-reticle')?.classList.add('hidden')

      // Disable menu actions in spectator mode
      document.getElementById('menu-save')?.classList.add('disabled')
      document.getElementById('menu-load')?.classList.add('disabled')
      document.getElementById('menu-inventory')?.classList.add('disabled')
      document.getElementById('game-menu')?.classList.remove('open')
    }
  }

  // ── Enemy HUD UI update ──
  private _showEnemyHud(name: string, ratio: number): void {
    if (this.player.dead || this.controlMode === 'spectator') return
    this.enemyNameEl.textContent = name
    this.enemyHpFill.style.width = `${Math.max(0, ratio * 100)}%`

    this.enemyHud.classList.add('visible')
    if (this.enemyHudTimer !== null) clearTimeout(this.enemyHudTimer)
    this.enemyHudTimer = window.setTimeout(() => {
      this.enemyHud.classList.remove('visible')
      this.enemyHudTimer = null
    }, 4000)
  }

  // ── Shared: Lance Charge Bonus (C-5) ──
  /** Returns the final damage after applying lance charge multiplier.
   *  Also sets skipImpactThisFrame on the player's mount if charging. */
  private _applyLanceChargeBonus(isLance: boolean, baseDamage: number): number {
    const mount = this.player.isMounted ? this.player.currentMount : null
    const speed = mount ? mount.movementSpeed : 0
    const result = calculateLanceChargeDamage(isLance, speed, baseDamage)
    if (mount && result.skipImpact) {
      mount.skipImpactThisFrame = true
    }
    return result.damage
  }

  // ── Melee Combat Hit Detection (Player Sword -> Enemies) ──
  private _checkPlayerMeleeHits(): void {
    if (this.player.dead || this.controlMode === 'spectator' || this.player.spectatorOnly) return
    const equippedMelee = this.inventoryManager.equippedMelee
    if (!this.player.isHitFrame(equippedMelee)) {
      if (this.player.isLanceThrustActive) {
        this.player.updatePrevLanceTip()
      }
      return
    }

    let baseDamage = equippedMelee.damageMax
    baseDamage = this._applyLanceChargeBonus(equippedMelee.isLance === true, baseDamage)
    const damage = Math.round(baseDamage * this.skillManager.getOneHandedMultiplier())

    if (equippedMelee.isLance) {
      const currTipPos = this.player.getSwordTipPosition()
      const prevTipPos = this.player.hasPrevLanceTip ? this.player.prevLanceTipPos : currTipPos
      const currGripPos = this.player.getWeaponGripPosition(this._tmpGripPos)
      const playerPos = this.player.combatPosition
      const playerForward = this._tmpPlayerForward.set(Math.sin(this.player.facingYaw), 0, Math.cos(this.player.facingYaw))

      for (const npc of this.npcs) {
        if (!npc.dead && npc.faction === Faction.ENEMY) {
          const aiCenter = this._tmpAiCenter.copy(npc.combatPosition)
          aiCenter.y += 1.0

          const toTarget = this._tmpToTarget.copy(npc.combatPosition).sub(playerPos)
          toTarget.y = 0
          const forwardDist = toTarget.dot(playerForward)
          const hitTolerance = npc.isMounted ? 0.85 : 0.60
          const lanceReach = equippedMelee.range || 3.9

          if (forwardDist <= 0 || forwardDist > lanceReach + hitTolerance) continue

          const d1Sq = distToSegmentSq(aiCenter, prevTipPos, currTipPos)
          const d2Sq = distToSegmentSq(aiCenter, currGripPos, currTipPos)
          const minDSq = Math.min(d1Sq, d2Sq)

          if (minDSq <= hitTolerance * hitTolerance) {
            this.player.markHitProcessed()
            const result = damageNpc(npc, damage)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              this.damageNumbers.spawn(damage, aiCenter.clone())
              this._showEnemyHud(result.targetName, result.hpRatio)
              this.skillManager.addXp('oneHanded', 45, this.soundManager)
            }
            break
          }
        }
      }
      this.player.updatePrevLanceTip()
    } else {
      const swordTipPos = this.player.getSwordTipPosition()
      const MELEE_HIT_THRESHOLD = equippedMelee.range || 1.85

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
  }

  // ── World Pickup & Mount Interaction ──
  private _updateInteractions(dt: number): void {
    // Update Mounts
    for (const mount of this.mounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      mount.update(dt, this.obstacles)
    }

    if (this.player.dead || this.controlMode === 'spectator' || this.player.spectatorOnly) {
      this.pickupPromptEl.classList.remove('visible')
      return
    }

    const isEPressed = this.input.consumeKeyE()

    if (this.player.isMounted && this.player.currentMount) {
      // Handle Dismount
      this.pickupPromptEl.textContent = `[E] 下騎`
      this.pickupPromptEl.classList.add('visible')

      if (isEPressed) {
        const prevMount = this.player.currentMount
        this.player.dismountFromMount()
        if (prevMount) this._aimTargetRegistry.registerMount(prevMount)
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
        this._mountPlayer(closestMount)
        this.soundManager.playHit()
      }
      this.pickupPromptEl.classList.remove('visible')
    }
  }

  /** Prevent living people, NPCs, and mounts from occupying the same space. */
  private _resolveEntityCollisions(): void {
    const bodies: EntityCollisionBody[] = []
    const controlledMount = this.player.isMounted ? this.player.currentMount : null

    if (this.player.spectatorOnly) {
      // Exclude non-participant spectator player from physical collision
    } else if (controlledMount) {
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
      } else if (mount.riderFaction === Faction.ENEMY && this.player.targetable) {
        if (checkImpact(mount, this.player.position, 0.38)) {
          applyImpactDamage(mount, this.player, this.player.position, (damage) => {
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
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
    if (this.frozenHumanoidLod2Diagnostic) {
      this.renderer.render(this.scene, this.camera)
      return
    }
    const profile = this.isDevCombat
    const frameStart = profile ? performance.now() : 0
    let t0 = 0
    const dt = Math.min(this.clock.getDelta(), 0.05)

    for (const instance of this.humanoidShowcase) {
      const playback = this.humanoidStudioPlayback.get(instance)
      if (playback) {
        if (!this.humanoidStudioPaused) playback.update(dt)
      } else instance.update(dt, instance.root.position.distanceTo(this.camera.position))
    }

    // Camera update based on controlMode / studio
    if (this.studioControls) {
      this.studioControls.update()
    } else if (this.controlMode === 'spectator') {
      this.spectatorController.update(this.input, dt)
    } else {
      this.thirdPersonCamera.update(this.input, dt)
    }

    const currentYaw = this.controlMode === 'spectator'
      ? this.spectatorController.cameraYaw
      : this.thirdPersonCamera.cameraYaw

    const cameraAimPoint = this.isModelStudio
      ? this.camera.getWorldDirection(this._tmpCameraDir).multiplyScalar(100).add(this.camera.position)
      : this._getCameraAimPoint(this._tmpHitPos)
    this._debugAimPoint.copy(cameraAimPoint)

    // Update Compass direction bar
    this.compassUI.update(currentYaw)

    // Update Player logic (Player handles dead state internally without processing inputs)
    if (!this.isModelStudio) this.player.update(
      dt,
      this.input,
      currentYaw,
      cameraAimPoint,
      this.obstacles,
      this.staminaBar,
      this.quiverUI,
      this.soundManager,
      this.inventoryManager,
      this.skillManager.getArcheryMultiplier()
    )

    this.battleController?.update(this.npcs)

    // 1. NPC Grid Build
    if (profile) t0 = performance.now()
    this.npcGrid.clear()
    for (const npc of this.npcs) {
      if (npc.hp > 0) this.npcGrid.insert(npc)
    }
    const npcGridMs = profile ? performance.now() - t0 : 0

    // 2. NPC Update
    if (profile) t0 = performance.now()
    for (const npc of this.npcs) {
      // These root positions are world-space here, matching the mount LOD distance.
      const cameraDistance = npc.group.position.distanceTo(this.camera.position)
      if (npc.hp <= 0) {
        // Dead NPCs still need animation update, but no AI/Boids
        npc.update(dt, this.player, this.npcs, [], this.obstacles, this.hpBar, 
          () => {}, // dead npc can't hit
          () => {}, // dead npc can't shoot
          true, // skipBoidsAndObstacles
          cameraDistance
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
            if (!this.player.targetable) return
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
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
        skipBoidsAndObstacles,
        cameraDistance
      )
    }
    const npcUpdateMs = profile ? performance.now() - t0 : 0

    // Check Player Melee Sword Hits (runs outside mount/interaction)
    this._checkPlayerMeleeHits()

    // 3. Mount / Interaction
    if (profile) t0 = performance.now()
    this._updateInteractions(dt)
    const mountInteractionMs = profile ? performance.now() - t0 : 0

    // 4. Entity Collision
    if (profile) t0 = performance.now()
    this._resolveEntityCollisions()
    const collisionMs = profile ? performance.now() - t0 : 0

    // Reset impact flag
    for (const mount of this.mounts) {
      mount.skipImpactThisFrame = false
    }

    // 5. Arrow / Projectile
    if (profile) t0 = performance.now()
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.update(dt, this.player, this.npcs, this.obstacles, (damage, hitPos, targetName, hpRatio, isPlayer, _npc, isMountHit) => {
        this.soundManager.playHit()
        if (arrow.isPlayerFired && !isPlayer) {
          this.damageNumbers.spawn(damage, hitPos)
        }
        handleProjectileHitEffects(
          isPlayer,
          arrow.isPlayerFired,
          targetName,
          hpRatio,
          Boolean(isMountHit),
          {
            dead: this.player.dead,
            controlMode: this.controlMode,
            isMounted: this.player.isMounted,
            hasMount: Boolean(this.player.currentMount),
            spectatorOnly: this.player.spectatorOnly,
          },
          {
            showEnemyHud: (name, ratio) => this._showEnemyHud(name, ratio),
            addArcheryXp: (amt) => this.skillManager.addXp('archery', amt, this.soundManager),
            updateMountHp: (ratio) => {
              this.mountHpFill.style.width = `${Math.max(0, ratio * 100)}%`
            },
            hideMountHud: () => {
              this.mountHud.classList.remove('visible')
            },
          },
        )
      })

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }
    const arrowMs = profile ? performance.now() - t0 : 0

    // 6. Impact / Damage
    if (profile) t0 = performance.now()
    this._updateImpactDamage(this.clock.elapsedTime)
    const impactMs = profile ? performance.now() - t0 : 0

    // Update Floating Damage numbers
    this.damageNumbers.update(dt, this.camera)

    this.combatTrajectoryDebugger?.update(this.player, this.npcs, this.arrows, this._debugAimPoint)

    // 7. Renderer Submit (measures synchronous CPU-side render submission, not GPU time)
    if (profile) t0 = performance.now()
    this.renderer.render(this.scene, this.camera)
    const renderSubmitMs = profile ? performance.now() - t0 : 0

    if (this.isMountStudio) this._updateMountStudioStatus()

    if (profile) {
      const frameEnd = performance.now()
      const cpuFrameMs = frameEnd - frameStart
      const accountedMs = npcGridMs + npcUpdateMs + mountInteractionMs + collisionMs + arrowMs + impactMs + renderSubmitMs
      const otherMs = Math.max(0, cpuFrameMs - accountedMs)

      const newSnapshot = this.runtimeProfiler.recordFrame({
        cpuFrameMs,
        npcGridMs,
        npcUpdateMs,
        mountInteractionMs,
        collisionMs,
        arrowMs,
        impactMs,
        renderSubmitMs,
        otherMs,
      }, frameEnd)

      if (newSnapshot || !this.hasDevCombatRenderedInitialHud) {
        this._updateDevCombatStatus()
        this.hasDevCombatRenderedInitialHud = true
      }
    }
  }
}
