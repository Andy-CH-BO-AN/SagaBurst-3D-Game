/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  createSky,
  getDirectionalShadowMapSize,
  resolveShadowMapSize,
  setDirectionalShadowMapSize,
} from './world/Sky'
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
import { NPC, Faction, AIState, NPC_NEIGHBOR_QUERY_RADIUS } from './world/NPC'
import {
  BattleConfig,
  PRESET_DEVCOMBAT,
  PRESET_SCENARIO_A,
  PRESET_SCENARIO_B,
  PRESET_SCENARIO_C,
  PRESET_SCENARIO_D,
  PRESET_SCENARIO_E,
  PRESET_SCENARIO_F,
  PRESET_SCENARIO_G,
  PRESET_SCENARIO_H,
  PRESET_SCENARIO_I,
} from './battle/BattleConfig'
import {
  getActiveRenderProbe,
  applyDevSimpleMaterials,
} from './debug/RendererCostIsolation'
import { BattleSpawner, VIKING_PLAYER_SPAWN, ROMAN_PLAYER_SPAWN, BattleSpawnPlan, NpcSpawnSpec } from './battle/BattleSpawner'
import { BattleController } from './battle/BattleController'
import { SpatialGrid } from './world/SpatialGrid'
import { ArrowProjectile } from './world/ArrowProjectile'
import { DEFAULT_MOUNT_TYPE, Mount, MountState, MountType, mountTypeFromSave } from './world/Mount'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from './world/AimTargetRegistry'
import { CombatRenderWarmup } from './world/CombatRenderWarmup'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { ArmyCommandUI } from './ui/ArmyCommandUI'
import { ArmyCommandController } from './battle/ArmyCommandController'
import { FormationController } from './battle/FormationController'
import { createRomanOutpost } from './campaign/RomanOutpost'
import { EquipmentUI } from './ui/EquipmentUI'
import { SoundManager, type HorseGallopCandidate } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import {
  COMBAT_BALANCE,
  calculateLanceChargeDamage,
  getAntiCavalryMultiplier,
  getBerserkerModifiers,
} from './combat/CombatBalance'
import { WeaponPickup } from './world/WeaponPickup'
import { resolveMountImpacts } from './combat/MountImpact'
import { RuntimeProfiler } from './debug/RuntimeProfiler'
import { NpcSubphaseCollector, NpcSubphaseAggregator, SUBPHASE_COHORT } from './debug/NpcSubphaseProfiler'

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

export function shouldCreateStartingHorse(battleConfig?: BattleConfig): boolean {
  return !battleConfig?.spectator && (battleConfig?.playerLoadout?.startMounted ?? true)
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

export const MOUNTED_MELEE_HIT_TOLERANCE = 0.5

export function resolveMeleeHitThreshold(baseRange: number, isMounted: boolean): number {
  return isMounted ? baseRange + MOUNTED_MELEE_HIT_TOLERANCE : baseRange
}

export class Game {
  static async create(container: HTMLElement, battleConfig?: BattleConfig): Promise<Game | GameplayBowQAPanel> {
    const query = startupQuery
    const activeProbe = getActiveRenderProbe(query)
    const perfNoShadow = activeProbe === 'no-shadow'
    const perfHalfResolution = activeProbe === 'half-resolution'

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    const basePixelRatio = Math.min(window.devicePixelRatio, 2)
    const effectivePixelRatio = perfHalfResolution ? basePixelRatio * 0.5 : basePixelRatio
    renderer.setPixelRatio(effectivePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = !perfNoShadow
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
  private _isSimulationFrozen = false

  get isSimulationFrozen(): boolean {
    return this._isSimulationFrozen
  }

  setSimulationFrozen(frozen: boolean): boolean {
    if (!import.meta.env.DEV) return false
    const next = Boolean(frozen)
    if (this._isSimulationFrozen && !next) {
      this.clock.getDelta()
    }
    this._isSimulationFrozen = next
    return this._isSimulationFrozen
  }

  setShadowsEnabled(enabled: boolean): boolean {
    if (!import.meta.env.DEV) return this.renderer.shadowMap.enabled
    this.renderer.shadowMap.enabled = Boolean(enabled)
    return this.renderer.shadowMap.enabled
  }

  getShadowMapSize(): number {
    return getDirectionalShadowMapSize(this.scene)
  }

  setShadowMapSize(shadowMapSize: number): number {
    if (!import.meta.env.DEV) return this.getShadowMapSize()
    return setDirectionalShadowMapSize(this.scene, shadowMapSize)
  }

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
  private armyCommandUI: ArmyCommandUI
  private armyCommandController: ArmyCommandController
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
  private activeRenderProbe: string = 'normal'
  readonly runtimeProfiler = new RuntimeProfiler(1000)
  // DEV-only NPC subphase profiling (enabled by &npcsubphase=1 URL param)
  private _npcSubphaseEnabled = false
  private _subphaseFrameIndex = 0
  private _npcSubphaseCollector: NpcSubphaseCollector | null = null
  private _npcSubphaseAggregator: NpcSubphaseAggregator | null = null
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
  private static readonly _EMPTY_NPC_LIST: NPC[] = []
  private readonly _nearbyNpcBuffer: NPC[] = []
  private readonly _impactCandidates: NPC[] = []
  private npcGrid = new SpatialGrid<NPC>(20)
  private readonly npcFactionGrids: Record<Faction, SpatialGrid<NPC>> = {
    [Faction.PLAYER]: new SpatialGrid<NPC>(20),
    [Faction.ENEMY]: new SpatialGrid<NPC>(20),
  }
  public readonly devGridStats = {
    queriesPerFrame: 0,
    returnedNeighborsAvg: 0,
  }

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
    const startupQuery = new URLSearchParams(window.location.search)
    createSky(this.scene, resolveShadowMapSize(startupQuery))
    const {
      terrainMesh,
      obstacles,
      obstacleMeshes,
      damageableObstacles,
    } = createTerrain(this.scene)

    // DEV-only visual/collision preview until Campaign runtime owns outpost creation.
    if (import.meta.env.DEV && startupQuery.has('romanoutpost')) {
      const outpost = createRomanOutpost(this.scene)
      obstacles.push(...outpost.obstacles)
      obstacleMeshes.push(...outpost.obstacleMeshes)
      damageableObstacles.push(...outpost.damageableObstacles)
    }

    this.obstacles = obstacles
    this._aimTargetRegistry.addStaticTarget(terrainMesh)
    for (const obstacleMesh of obstacleMeshes) {
      this._aimTargetRegistry.addStaticTarget(obstacleMesh)
    }
    for (const damageable of damageableObstacles) {
      damageable.onDestroyed(() => {
        for (const hitMesh of damageable.hitMeshes) {
          this._aimTargetRegistry.removeStaticTarget(hitMesh)
        }
      })
    }

    // ── Player & Input ──
    const playerFaction = battleConfig?.playerFaction ?? 'viking'
    const isRoman = playerFaction === 'roman'
    this.input = new PlayerInput()
    this.player = new Player(this.scene, playerFaction)
    // Release and diagnostic armies are ahead at -Z for Viking, +Z for Roman. Establish the actor's
    // heading first; the camera derives its rear orbit from that heading.
    this.player.faceDirection(0, isRoman ? 1 : -1)

    const query = new URLSearchParams(window.location.search)
    this.isDevCombat = query.has('devcombat')
    this.activeRenderProbe = getActiveRenderProbe(query)
    const devModelsMode = query.get('devmodels')
    this.isHumanoidStudio = devModelsMode === 'humans'
    this.isMountStudio = devModelsMode === 'mounts'
    this.isModelStudio = this.isHumanoidStudio || this.isMountStudio

    // DEV-only: NPC subphase profiling (?npcsubphase=1 requires ?devcombat to be present)
    if (import.meta.env.DEV && this.isDevCombat && query.get('npcsubphase') === '1') {
      this._npcSubphaseEnabled = true
      this._npcSubphaseCollector = new NpcSubphaseCollector()
      this._npcSubphaseAggregator = new NpcSubphaseAggregator()
    }

    // Resolve BattleSpawnPlan if applicable
    let battlePlan: BattleSpawnPlan | null = null
    let activeBattleConfig: BattleConfig | undefined = battleConfig
    if (this.isDevCombat) {
      this.combatTrajectoryDebugger = new CombatTrajectoryDebugger(this.scene)
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
      } else if (devVal === 'e' || devVal === 'scenarioe') {
        scenarioConfig = PRESET_SCENARIO_E
      } else if (devVal === 'f' || devVal === 'scenariof') {
        scenarioConfig = PRESET_SCENARIO_F
      } else if (devVal === 'g' || devVal === 'scenariog') {
        scenarioConfig = PRESET_SCENARIO_G
      } else if (devVal === 'h' || devVal === 'scenarioh') {
        scenarioConfig = PRESET_SCENARIO_H
      } else if (devVal === 'i' || devVal === 'scenarioi') {
        scenarioConfig = PRESET_SCENARIO_I
      }
      activeBattleConfig = scenarioConfig
      battlePlan = BattleSpawner.createSpawnPlan(scenarioConfig)
    } else if (battleConfig) {
      battlePlan = BattleSpawner.createSpawnPlan(battleConfig)
    }

    const initialPlayerHp = activeBattleConfig?.playerHp ?? COMBAT_BALANCE.hp.playerDefault
    this.player.setMaxHp(initialPlayerHp, true)

    const isInitialSpectator = Boolean(activeBattleConfig?.spectator)
    if (isInitialSpectator) {
      this.player.spectatorOnly = true
      this.player.group.visible = false
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
      const playerSpawn = battlePlan?.playerSpawn ?? (isRoman ? ROMAN_PLAYER_SPAWN : VIKING_PLAYER_SPAWN)
      const terrainY = getTerrainHeight(playerSpawn.x, playerSpawn.z)
      this.player.group.position.set(playerSpawn.x, terrainY + 0.95, playerSpawn.z)
      this.player.spawnX = playerSpawn.x
      this.player.spawnZ = playerSpawn.z
      this.thirdPersonCamera.setYaw(isRoman ? Math.PI : 0)
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
      if (this.activeRenderProbe === 'simple-material') {
        applyDevSimpleMaterials(this.npcs, this.mounts)
      }
    } else if (devModelsMode === 'humans') {
      this._spawnHumanoidStudio()
    } else if (devModelsMode === 'mounts') {
      this._spawnMountStudio()
    } else if (battleConfig && battlePlan) {
      this._executeBattleSpawnPlan(battlePlan)
      this.battleController = new BattleController(battleConfig)
      this.battleController.initCounts(this.npcs)
    }

    if (!this.isModelStudio && shouldCreateStartingHorse(activeBattleConfig)) {
      const playerSpawn = battlePlan?.playerSpawn ?? (isRoman ? ROMAN_PLAYER_SPAWN : VIKING_PLAYER_SPAWN)
      const startingHorse = new Mount(
        this.scene,
        DEFAULT_MOUNT_TYPE,
        playerSpawn.x,
        playerSpawn.z
      )
      this.startingHorse = startingHorse
      this.mounts.push(startingHorse)
      this.player.faceDirection(0, isRoman ? 1 : -1)
      this._mountPlayer(startingHorse)
    }
    
    this.damageNumbers = new DamageNumbers()

    // ── RPG Systems & Inventory ──
    this.staminaBar       = new StaminaBar()
    this.hpBar            = new HpBar()
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI         = new QuiverUI()
    this.skillManager     = new SkillManager()
    this.armyCommandUI   = new ArmyCommandUI(playerFaction)
    const formationController = new FormationController(this.scene, this.camera, this.npcs, terrainMesh, obstacles)
    this.armyCommandController = new ArmyCommandController(
      this.npcs,
      playerFaction,
      this.input,
      this.armyCommandUI,
      formationController,
      (order) => this.soundManager.playCommanderCommand(playerFaction, order),
    )
    this.equipmentUI      = new EquipmentUI()
    this.inventoryManager = new InventoryManager(battleConfig?.playerLoadout)


    // ── Save Manager ──
    this.saveManager = new SaveManager()

    // ── Spawn World Pickups & Mounts ──
    if (this.isDevCombat) this._createDevCombatStatus()

    if (import.meta.env.DEV) {
      ;(window as any).__freezeSimulation = (frozen = true) => this.setSimulationFrozen(Boolean(frozen))
      ;(window as any).__setShadowsEnabled = (enabled: boolean) => this.setShadowsEnabled(Boolean(enabled))
      ;(window as any).__resetRuntimeProfiler = (now = performance.now()) => {
        this.runtimeProfiler.reset(now)
        return this.runtimeProfiler.getSnapshotGeneration()
      }

      if (query.has('humanoidLod2Control')) {
        ;(window as any).__setHumanoidLod2Representation = (optimized: boolean) => this._setHumanoidLod2Representation(Boolean(optimized))
        ;(window as any).__freezeHumanoidLod2Scene = (frozen = true) => {
          return { frozen: this.setSimulationFrozen(Boolean(frozen)) }
        }
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
        true,
        evt.visualKind,
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