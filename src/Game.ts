import { assertNpcSpawnJob, gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch } from './world/NpcSpawnScheduler'
/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CorgiVisual } from './world/CorgiVisual'
import { BlackCatVisual } from './world/BlackCatVisual'
import { MountStudioSeatContact } from './debug/MountStudioSeatContact'
import {
  createSky,
  getDirectionalShadowMapSize,
  resolveShadowMapSize,
  setDirectionalShadowMapSize,
} from './world/Sky'
import { createTerrain, getTerrainHeight, TERRAIN_TREE_POSITIONS, EntityCollisionBody, ObstacleData, resolveObstacleCollision } from './world/Terrain'
import { Player, DEFAULT_PLAYER_MAX_HP } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { SpectatorCameraController } from './camera/SpectatorCameraController'
import { NavigationWorld } from './navigation/NavigationWorld'
import { ChaseTargetCoordinator } from './navigation/ChaseTargetCoordinator'

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
  PRESET_SCENARIO_J,
} from './battle/BattleConfig'
import {
  getActiveRenderProbe,
  applyDevSimpleMaterials,
} from './debug/RendererCostIsolation'
import { BattleSpawner, VIKING_PLAYER_SPAWN, ROMAN_PLAYER_SPAWN, BattleSpawnPlan, NpcSpawnSpec } from './battle/BattleSpawner'
import { HERO_ASSETS, type HeroAssetId } from './world/HeroAssetCatalog'
import { T4_UNIT_PROFILES, HERO_COMBAT_PROFILE_BY_ASSET, getT4HeroCombatModifiers } from './battle/T4HeroCatalog'
import { preloadMakiRangerBow } from './world/MakiRangerEquipment'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from './rpg/WeaponDatabase'
import { normalizeArmyConfig } from './battle/BattleConfig'
import { BattleController } from './battle/BattleController'
import { SpatialGrid } from './world/SpatialGrid'
import { EntityCollisionBroadPhase } from './world/EntityCollisionBroadPhase'
import { ArrowProjectile } from './world/ArrowProjectile'
import { DEFAULT_MOUNT_TYPE, Mount, MountState, MountType, mountTypeFromId, mountTypeFromSave } from './world/Mount'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from './world/AimTargetRegistry'
import { CombatRenderWarmup } from './world/CombatRenderWarmup'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { SHIELD_CONFIG } from './combat/ShieldBlocking'
import { resolveActivePlayerSkillProgressionAward, resolveCombatSkill, resolveSkillAdjustedMaxHp, skillStatesEqual } from './rpg/CombatSkillProgression'
import { ArmyCommandUI } from './ui/ArmyCommandUI'
import { WeaponWheelUI } from './ui/WeaponWheelUI'
import { ArmyCommandController } from './battle/ArmyCommandController'
import { FormationController } from './battle/FormationController'
import {
  createCampaignOutpost,
  getCampaignDefenderFacingYaw,
  getCampaignOutpostPlacement,
} from './campaign/CampaignOutpost'
import {
  applyCampaignBreachOrders,
  isCampaignGateOccupied,
  type CampaignGateController,
} from './campaign/CampaignGate'
import {
  createDefenseCampaignWaveConfig,
  positionDefenseCampaignAttackers,
  positionDefenseCampaignDefenders,
  positionDefenseCampaignReinforcements,
  type DefenseCampaignLaunchConfig,
} from './campaign/DefenseCampaignLaunch'
import { CareerProfileStore } from './career/CareerProfileStore'
import { CareerReliefMarchController, createCareerReliefSpawnPlan, initializeCareerReliefBattlefield } from './career/CareerOutpostRelief'
import { claimCareerOutpost, clearCareerOutpost, CAREER_OUTPOST_SESSION_KEY } from './career/CareerOutpostMission'
import { PersonalSquadRuntime, personalMemberLoadout } from './career/PersonalSquadRuntime'
import { personalRearDeployment } from './career/PersonalSquadDeployment'
import { personalMissionSourcePolicy } from './career/CareerPersonalSquadMission'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, type CareerProfile } from './career/CareerProfile'
import { CareerMissionCheckpoint, type CareerMissionCheckpointReason } from './career/CareerMissionCheckpoint'
import type { ActiveCareerMission } from './career/CareerMissionState'
import {
  careerVeteranOutpostOwner,
  createCareerVeteranOutpostReinforcementPlan,
  createCareerVeteranOutpostSpawnPlan,
} from './career/CareerVeteranOutpost'
import { MountedMissionMarchController, type MountedMissionSquad } from './career/MountedMissionMarch'
import { MissionGuide } from './career/MissionGuide'
import type { CampaignFaction } from './campaign/CampaignConfig'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from './career/CareerMissionState'
import { TownEquipment } from './town/TownEquipment'
import { resolveCareerPlayerMaxHp } from './career/CareerPlayerProfile'
import { TOWN_ENTRY_KEY } from './town/CareerTownEntry'
import { defenseCampaignCapabilities } from './campaign/DefenseCampaignLaunch'
import { DefenseCampaignRuntime } from './campaign/DefenseCampaignRuntime'
import {
  completeDefenseCampaignStage,
  DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY,
} from './campaign/CampaignProgress'
import {
  DEFENSE_CAMPAIGN_RULES,
  opposingCampaignFaction,
} from './campaign/CampaignConfig'
import { DefenseCampaignHUD } from './ui/DefenseCampaignHUD'
import { EquipmentUI } from './ui/EquipmentUI'
import { HeroMountTrialUI } from './ui/HeroMountTrialUI'
import { SoundManager, type HorseGallopCandidate } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import {
  COMBAT_BALANCE,
  getAntiCavalryMultiplier,
} from './combat/CombatBalance'
import { calculatePlayerMeleeDamage } from './combat/PlayerMeleeDamage'
import { WeaponPickup } from './world/WeaponPickup'
import { resolveMountImpacts } from './combat/MountImpact'
import { RuntimeProfiler } from './debug/RuntimeProfiler'
import { NpcSubphaseCollector, NpcSubphaseAggregator, SUBPHASE_COHORT } from './debug/NpcSubphaseProfiler'

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
import { damageMount, damageNpc, damageObstacle, damagePlayer } from './combat/DamageRouter'
import {
  CombatEventStream,
  createNpcCombatActorRef,
  createPlayerCombatActorRef,
  type CombatEvent,
} from './combat/CombatAttribution'
import { BattleStatsTracker, type BattleStatsSnapshot } from './combat/BattleStatsTracker'
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
import { QUADRUPED_STUDIO_CLIPS } from './world/QuadrupedMountAnimation'

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
  readonly combatEvents = new CombatEventStream()
  readonly battleStats: BattleStatsTracker
  readonly initialization: Promise<void>
  private initializing = true
  private spawningStopped = false
  private readonly spawnBatches: NpcSpawnBatch[] = []
  private campaignSpawnBatch?: NpcSpawnBatch
  static async create(
    container: HTMLElement,
    battleConfig?: BattleConfig,
    campaignConfig?: DefenseCampaignLaunchConfig,
    progress: (text: string) => void = () => {},
  ): Promise<Game | GameplayBowQAPanel> {
    const query = new URLSearchParams(window.location.search)
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
    const personalProfile = campaignConfig?.careerMissionId ? new CareerProfileStore().loadChecked().profile : undefined
    const personalIds = new Set((personalProfile?.activeMission ?? personalProfile?.activeOutpostMission)?.personalSquad?.memberIds ?? [])
    const personalMembers = personalProfile?.personalSquad?.members.filter(member => personalIds.has(member.id)) ?? []
    try {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('devbowqa')) {
        await HumanoidAssetRegistry.preload()
        const { GameplayBowQAPanel } = await import('./debug/GameplayBowQAPanel')
        return new GameplayBowQAPanel(renderer)
      }
      const usesPlayerT4Bow = (
        campaignConfig?.playerLoadout?.rangedWeaponId ?? battleConfig?.playerLoadout?.rangedWeaponId
      ) === T4_RANGER_BOW_RANGED_ID
      const savedPlayerT4Bow = new SaveManager().load().inventory.equippedRangedId === T4_RANGER_BOW_RANGED_ID
      if (legacyQa) {
        await Promise.all([
          HorseAssetRegistry.preload(renderer),
          BlackCatVisual.preload(),
          CorgiVisual.preload(),
          ...(usesPlayerT4Bow || savedPlayerT4Bow || personalMembers.some(member => member.type === 'ranger') ? [preloadMakiRangerBow()] : []),
        ])
        const game = new Game(renderer, battleConfig, campaignConfig, progress)
        await game.initialization
        CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
        game.clock.start(); requestAnimationFrame(game._loop)
        return game
      }
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), BlackCatVisual.preload(), CorgiVisual.preload()])
      const heroAssets = new Set<HeroAssetId>()
      for (const member of personalMembers) {
        const hero = personalMemberLoadout(member, personalProfile!.faction).hero
        if (hero) heroAssets.add(hero.visualAssetId)
      }
      if (campaignConfig?.careerMissionKind === 'outpost-relief') {
        for (const spec of createCareerReliefSpawnPlan(campaignConfig).npcSpecs) {
          if (spec.visualAssetId) heroAssets.add(spec.visualAssetId)
        }
      }
      if (campaignConfig?.careerVeteranOutpost) {
        for (const wave of ['initial', 'reinforcement'] as const) {
          for (const spec of createCareerVeteranOutpostSpawnPlan(campaignConfig, wave).npcSpecs) {
            if (spec.visualAssetId) heroAssets.add(spec.visualAssetId)
          }
        }
      }
      const playerHeroId = campaignConfig?.playerHeroId ?? battleConfig?.playerHeroId
      if (playerHeroId) heroAssets.add(playerHeroId)
      const heroBattleConfigs = campaignConfig && !campaignConfig.careerVeteranOutpost
        ? [createDefenseCampaignWaveConfig(campaignConfig, 'defenders'), createDefenseCampaignWaveConfig(campaignConfig, 'attackers')]
        : !campaignConfig && battleConfig ? [battleConfig] : []
      for (const config of heroBattleConfigs) {
        for (const faction of ['viking', 'roman'] as const) {
          for (const [presetId, counts] of Object.entries(normalizeArmyConfig(config[faction], faction))) {
            if ((counts[4] ?? 0) > 0) heroAssets.add(T4_UNIT_PROFILES[presetId as keyof typeof T4_UNIT_PROFILES].visualAssetId)
          }
        }
      }
      await Promise.all([
        ...[...heroAssets].map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor)),
        ...(heroAssets.has('maki-archer-t4') || usesPlayerT4Bow || savedPlayerT4Bow ? [preloadMakiRangerBow()] : []),
      ])
      const game = new Game(renderer, battleConfig, campaignConfig, progress)
      await game.initialization
      CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
      game.clock.start(); requestAnimationFrame(game._loop)
      return game
    } catch (error) {
      renderer.dispose()
      renderer.domElement.remove()
      throw error
    }
  }

  private scene!: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private camera!: THREE.PerspectiveCamera
  private clock!: THREE.Clock

  private input!: PlayerInput
  private player!: Player
  private basePlayerMaxHp: number = DEFAULT_PLAYER_MAX_HP
  private thirdPersonCamera!: ThirdPersonCamera
  private spectatorController!: SpectatorCameraController
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
  private readonly defenseCampaignConfig: DefenseCampaignLaunchConfig | null
  private defenseCampaignRuntime: DefenseCampaignRuntime | null = null
  private defenseCampaignHud: DefenseCampaignHUD | null = null
  private careerProfile: CareerProfile | null = null
  private careerMeritAwarded = 0
  private readonly careerStore = new CareerProfileStore()
  private careerSkillsDirty = false
  private careerSkillSaveTimer: number | null = null
  private readonly flushCareerSkillsOnPageHide = (): void => {
    this._flushCareerSkillProgression()
  }
  private campaignOriginalDefenders: NPC[] = []
  private campaignReinforcementSpawned = false
  private campaignReinforcementArrived = false
  private campaignAttackersStarted = false
  private campaignSpawnQueue: NpcSpawnSpec[] = []
  private campaignSpawnQueueIndex = 0
  private campaignSpawnWave: 'attackers' | 'reinforcement' | null = null
  private npcs: NPC[] = []
  private personalSquad?: PersonalSquadRuntime
  private personalCheckpointElapsed = 0
  private personalCriticalState = ''
  private careerResultStats?: BattleStatsSnapshot
  private readonly flushPersonalOutpostOnPageHide = (): void => { this._persistPersonalOutpost(true) }
  private readonly careerVeteranActorMounts = new Map<string, Mount | null>()
  private damageNumbers!: DamageNumbers
  private arrows: ArrowProjectile[] = []
  private pickups: WeaponPickup[] = []
  private mounts: Mount[] = []

  private obstacles: ObstacleData[] = []
  private reliefMarch: CareerReliefMarchController | null = null
  private veteranOutpostMarch: MountedMissionMarchController | null = null
  private veteranReinforcementMarch: MountedMissionMarchController | null = null
  private veteranOutpostCheckpoint: CareerMissionCheckpoint | null = null
  private careerOutpostDefenseGuide: MissionGuide | null = null
  private restoringCareerOutpostGate = false
  private readonly flushVeteranOutpostOnPageHide = (): void => {
    this._persistCareerVeteranOutpostCheckpoint({ immediate: true, periodic: true, force: true })
  }
  private previewCampaignGate: CampaignGateController | null = null
  private readonly navigationWorld = new NavigationWorld()
  private readonly chaseTargetCoordinator = new ChaseTargetCoordinator()
  private saveManager!: SaveManager
  private staminaBar!: StaminaBar
  private hpBar!: HpBar
  private quiverUI!: QuiverUI
  private skillManager!: SkillManager
  private armyCommandUI!: ArmyCommandUI
  private weaponWheelUI = new WeaponWheelUI()
  private armyCommandController!: ArmyCommandController
  private equipmentUI!: EquipmentUI
  private heroMountTrialUI: HeroMountTrialUI | null = null
  private soundManager!: SoundManager
  private inventoryManager!: InventoryManager
  private combatTrajectoryDebugger: CombatTrajectoryDebugger | null = null
  private humanoidShowcase: HumanoidCharacterInstance[] = []
  private humanoidStudioPlayback = new Map<HumanoidCharacterInstance, HumanoidStudioPlayback>()
  private humanoidStudioEquipped = true
  private humanoidStudioPaused = false
  private humanoidSkeletonHelpers: THREE.SkeletonHelper[] = []
  private mountStudioHorse: Mount | null = null
  private mountStudioRider: HumanoidCharacterInstance | null = null
  private mountStudioRiderPelvisHeight = 0
  private mountStudioSeatContacts = new WeakMap<HumanoidCharacterInstance, MountStudioSeatContact>()
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
  private enemyHud!: HTMLElement
  private enemyNameEl!: HTMLElement
  private enemyHpFill!: HTMLElement
  private enemyHudTimer: number | null = null

  private mountHud!: HTMLElement
  private mountNameEl!: HTMLElement
  private mountHpFill!: HTMLElement

  private pickupPromptEl!: HTMLElement
  // @ts-ignore
  private activeNearbyPickup: WeaponPickup | null = null

  private lockOverlay!: HTMLElement
  private controlsHint!: HTMLElement
  private saveNotify!: HTMLElement
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
  private readonly _tmpMeleeObstacleRay = new THREE.Ray()
  private readonly _tmpMeleeObstacleBox = new THREE.Box3()
  private readonly _tmpMeleeObstacleDirection = new THREE.Vector3()
  private readonly _tmpMeleeObstacleHitPoint = new THREE.Vector3()

  private _getCameraAimPoint(target: THREE.Vector3): THREE.Vector3 {
    this.thirdPersonCamera.getAimDirection(this._tmpCameraDir)
    target.copy(this.camera.position).addScaledVector(this._tmpCameraDir, 100)
    if (!this.player.isRangedAimViewActive) return target

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
  private readonly _entityCollisionBroadPhase = new EntityCollisionBroadPhase()
  private readonly combatMountGrid = new SpatialGrid<Mount>(8)
  private readonly meleeMountCandidates: Mount[] = []
  private npcGrid = new SpatialGrid<NPC>(20)
  private readonly npcFactionGrids: Record<Faction, SpatialGrid<NPC>> = {
    [Faction.PLAYER]: new SpatialGrid<NPC>(20),
    [Faction.ENEMY]: new SpatialGrid<NPC>(20),
    [Faction.TOWN]: new SpatialGrid<NPC>(20),
    [Faction.BANDIT]: new SpatialGrid<NPC>(20),
  }
  public readonly devGridStats = {
    queriesPerFrame: 0,
    returnedNeighborsAvg: 0,
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    battleConfig?: BattleConfig,
    campaignConfig?: DefenseCampaignLaunchConfig,
    progress: (text: string) => void = () => {},
  ) {
    this.renderer = renderer
    this.defenseCampaignConfig = campaignConfig ?? null
    if (campaignConfig?.careerMissionId) {
      this.careerProfile = this.careerStore.loadChecked().profile
      if (campaignConfig.careerVeteranOutpost) {
        const mission = this.careerProfile?.activeMission
        if (mission?.id !== campaignConfig.careerMissionId
          || mission.templateId !== campaignConfig.careerVeteranOutpost.templateId
          || mission.kind !== campaignConfig.careerVeteranOutpost.missionKind) {
          throw new Error('Veteran Career Outpost launch does not match saved mission')
        }
        this.campaignReinforcementArrived = campaignConfig.careerVeteranOutpost.runtimeState.reinforcementArrived
        this.veteranOutpostCheckpoint = new CareerMissionCheckpoint(
          () => this.careerStore.loadChecked().profile ?? this.careerProfile!,
          profile => {
            const saved = this.careerStore.save(profile)
            if (saved) this.careerProfile = profile
            return saved
          },
        )
      } else if (this.careerProfile?.activeOutpostMission?.id !== campaignConfig.careerMissionId
        || this.careerProfile.activeOutpostMission.kind !== (campaignConfig.careerMissionKind ?? 'outpost-defense')) {
        throw new Error('Career Outpost launch does not match saved mission')
      }
    }
    // Defense Campaign player-side units are defenders, so structure damage / breach
    // is not a valid performance statistic for them. Custom Battle remains generic.
    const veteranMission = campaignConfig?.careerVeteranOutpost ? this.careerProfile?.activeMission : undefined
    const outpostMission = this.careerProfile?.activeOutpostMission
    const trackStructureStats = !campaignConfig || campaignConfig.careerVeteranOutpost?.templateId === 'veteran-outpost-assault'
    this.battleStats = new BattleStatsTracker(
      this.combatEvents,
      trackStructureStats,
      veteranMission ? event => acceptsCareerMissionStat(this.careerProfile?.activeMission ?? veteranMission, event) : undefined,
      veteranMission?.playerStats ?? outpostMission?.battle?.playerStats,
      veteranMission ? careerMissionCommandMeritPolicy(veteranMission, () => this.careerProfile?.activeMission ?? veteranMission)
        : outpostMission?.personalSquad ? {
          acceptsSource: personalMissionSourcePolicy(outpostMission),
          initialContribution: outpostMission.personalSquad.contribution,
          initialMemberIds: outpostMission.personalSquad.memberIds.filter(id => outpostMission.personalSquad!.members[id]?.status !== 'reserve'),
          departedSurvivors: () => this.careerProfile?.activeOutpostMission?.personalSquad?.memberIds.filter(id => this.careerProfile!.activeOutpostMission!.personalSquad!.members[id]?.status === 'exited') ?? [],
          acceptsEvent: event => !this.careerProfile?.claimedBattleIds.includes(outpostMission.id)
            && this.defenseCampaignRuntime?.getSnapshot().activePhase === 'assault'
            && (event.type === 'damage_applied' || event.type === 'actor_killed')
            && event.target.allegiance === Faction.ENEMY
            && (event.target.targetType === 'npc' ? event.target.targetId : event.target.ownerActorId)?.startsWith(`${outpostMission.id}:`) === true,
        } : undefined,
    )

    this.initialization = this.initialize(battleConfig, campaignConfig, progress).catch(error => {
      this._disposeCareerOutpostBattleActors()
      throw error
    })
  }

  private async initialize(battleConfig: BattleConfig | undefined, campaignConfig: DefenseCampaignLaunchConfig | undefined,
    progress: (text: string) => void): Promise<void> {
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
    const startupDevCombat = startupQuery.get('devcombat')?.toLowerCase() ?? null
    const isRomanDefenseDevScenario = import.meta.env.DEV
      && (startupDevCombat === 'j' || startupDevCombat === 'scenarioj')
    const previewOutpostQuery = import.meta.env.DEV ? startupQuery.get('campaignoutpost') : null
    const previewOutpostFaction = campaignConfig
      ? careerVeteranOutpostOwner(campaignConfig)
      ?? (isRomanDefenseDevScenario
        ? 'roman'
        : previewOutpostQuery === 'roman' || previewOutpostQuery === 'viking'
          ? previewOutpostQuery
          : null)
      : (isRomanDefenseDevScenario
        ? 'roman'
        : previewOutpostQuery === 'roman' || previewOutpostQuery === 'viking'
          ? previewOutpostQuery
          : null)

    createSky(this.scene, resolveShadowMapSize(startupQuery), previewOutpostFaction === 'viking')
    const {
      terrainMesh,
      obstacles,
      obstacleMeshes,
      damageableObstacles,
    } = createTerrain(this.scene, {
      fortifiedCampFaction: previewOutpostFaction,
    })

    // Defense Campaign owns the same faction-neutral outpost used by DEV preview.
    if (previewOutpostFaction) {
      const outpost = createCampaignOutpost(
        this.scene,
        previewOutpostFaction,
        { obstacles, obstacleMeshes },
      )
      damageableObstacles.push(...outpost.damageableObstacles)
      this.previewCampaignGate = outpost.gateController
      outpost.breachController.onBreach(() => {
        if (campaignConfig?.careerMissionKind === 'outpost-relief') return
        const attackerFaction = outpost.gateController.attackerFaction
        this._applyCampaignBreachOrders(attackerFaction)
      })
    }

    this.obstacles = obstacles
    this.navigationWorld.sync(this.obstacles)
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
    const playerFaction = campaignConfig?.careerVeteranOutpost?.playerFaction
      ?? campaignConfig?.defenderFaction
      ?? battleConfig?.playerFaction
      ?? (isRomanDefenseDevScenario
        ? 'roman'
        : previewOutpostFaction === 'roman'
          ? 'viking'
          : previewOutpostFaction === 'viking'
            ? 'roman'
            : 'viking')
    const isRoman = playerFaction === 'roman'
    this.input = new PlayerInput()
    const playerHeroId = campaignConfig?.playerHeroId ?? battleConfig?.playerHeroId
    this.player = new Player(this.scene, playerFaction, playerHeroId)
    // Release and diagnostic armies are ahead at -Z for Viking, +Z for Roman. Establish the actor's
    // heading first; the camera derives its rear orbit from that heading.
    this.player.faceDirection(0, isRoman ? 1 : -1)

    const query = startupQuery
    this.isDevCombat = query.has('devcombat')
    this.activeRenderProbe = getActiveRenderProbe(query)
    const devModelsMode = query.get('devmodels')
    this.isHumanoidStudio = devModelsMode === 'humans'
    this.isMountStudio = devModelsMode === 'mounts' || devModelsMode === 'black-cat' || devModelsMode === 'corgi'
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
    if (campaignConfig) {
      activeBattleConfig = createDefenseCampaignWaveConfig(campaignConfig, 'defenders')
      if (campaignConfig.careerVeteranOutpost) {
        battlePlan = createCareerVeteranOutpostSpawnPlan(campaignConfig, 'initial')
      } else {
        battlePlan = BattleSpawner.createSpawnPlan(activeBattleConfig)
        if (campaignConfig.careerMissionKind === 'outpost-relief') battlePlan = createCareerReliefSpawnPlan(campaignConfig)
        else positionDefenseCampaignDefenders(battlePlan.npcSpecs, campaignConfig.defenderFaction)
        this._identifyPersonalOutpostWave(battlePlan, 'initial')
      }
    } else if (this.isDevCombat) {
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
      } else if (devVal === 'j' || devVal === 'scenarioj') {
        scenarioConfig = PRESET_SCENARIO_J
      }
      activeBattleConfig = scenarioConfig
      battlePlan = BattleSpawner.createSpawnPlan(scenarioConfig)
    } else if (battleConfig) {
      battlePlan = BattleSpawner.createSpawnPlan(battleConfig)
    }

    const initialPlayerHp = playerHeroId
      ? getT4HeroCombatModifiers(HERO_COMBAT_PROFILE_BY_ASSET[playerHeroId])!.maxHp
      : activeBattleConfig?.playerHp ?? COMBAT_BALANCE.hp.playerDefault
    this.basePlayerMaxHp = initialPlayerHp
    this.player.setMaxHp(initialPlayerHp, true)

    const isInitialSpectator = Boolean(activeBattleConfig?.spectator)
    if (isInitialSpectator) {
      this.player.spectatorOnly = true
      this.player.group.visible = false
    }

    const damageableTreePreview = import.meta.env.DEV && startupQuery.get('damageabletest') === 'tree'
    const previewPlayerSpawn = previewOutpostFaction
      ? (() => {
        const placement = getCampaignOutpostPlacement(previewOutpostFaction)
        return {
          x: placement.centerX,
          // Scenario J is a Roman defense test, so place the player behind the
          // front gate. Other outpost previews keep the historical attacker-side spawn.
          z: isRomanDefenseDevScenario
            ? placement.frontZ + Math.sign(placement.frontZ) * 11
            : placement.frontZ - Math.sign(placement.frontZ) * 11,
        }
      })()
      : damageableTreePreview
        ? {
          x: TERRAIN_TREE_POSITIONS[0][0],
          z: TERRAIN_TREE_POSITIONS[0][1] + 4,
        }
        : null

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
      const playerSpawn = battlePlan?.playerSpawn ?? previewPlayerSpawn ?? (isRoman ? ROMAN_PLAYER_SPAWN : VIKING_PLAYER_SPAWN)
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
    if (campaignConfig && battlePlan) {
      const spawned = await this._executeBattleSpawnPlan(battlePlan, progress)
      this.campaignOriginalDefenders = spawned.filter(
        npc => npc.characterFaction === careerVeteranOutpostOwner(campaignConfig)
          && (campaignConfig.careerMissionKind !== 'outpost-relief' || !npc.squadId),
      )
      const defenderFacingYaw = getCampaignDefenderFacingYaw(campaignConfig.defenderFaction)
      for (const npc of spawned) {
        // NPC models default to +Z. Campaign forts mirror across Z, so Viking
        // defenders must be rotated toward their -Z front gate at spawn.
        const isOutpostOwner = npc.characterFaction === careerVeteranOutpostOwner(campaignConfig)
        const heading = campaignConfig.careerMissionKind === 'outpost-relief' && npc.squadId
          ? defenderFacingYaw + Math.PI
          : campaignConfig.careerVeteranOutpost && !isOutpostOwner
            ? defenderFacingYaw + Math.PI
            : defenderFacingYaw
        npc.group.rotation.y = heading
        if (npc.mount) npc.mount.group.rotation.y = heading
        npc.setTacticalOrder(isOutpostOwner
          ? DEFENSE_CAMPAIGN_RULES.initialDefenderOrder
          : campaignConfig.careerVeteranOutpost ? 'attack' : DEFENSE_CAMPAIGN_RULES.initialDefenderOrder)
        if (campaignConfig.careerVeteranOutpost) this._restoreCareerVeteranNpcState(npc)
        else this._restorePersonalOutpostNpc(npc)
      }
      const capabilities = defenseCampaignCapabilities(campaignConfig)
      const relief = campaignConfig.careerMissionKind === 'outpost-relief'
      const veteranOutpost = campaignConfig.careerVeteranOutpost
      const isVeteranAssault = veteranOutpost?.templateId === 'veteran-outpost-assault'
      this.defenseCampaignRuntime = new DefenseCampaignRuntime({
        ...capabilities,
        eliminationObjective: relief || isVeteranAssault,
        deploymentSeconds: campaignConfig.deploymentSeconds,
        ...(veteranOutpost ? {
          reinforcementDelaySeconds: veteranOutpost.reinforcementDelaySeconds,
          initialSnapshot: veteranOutpost.runtimeState,
        } : {}),
        ...(!veteranOutpost && this.careerProfile?.activeOutpostMission?.battle ? { initialSnapshot: this.careerProfile.activeOutpostMission.battle.runtime } : {}),
      })
      if (relief) {
        initializeCareerReliefBattlefield(this.previewCampaignGate!, this.npcs)
        this.navigationWorld.sync(this.obstacles)
        this.campaignAttackersStarted = true
        const placement = getCampaignOutpostPlacement(campaignConfig.defenderFaction)
        this.reliefMarch = new CareerReliefMarchController(this.npcs, new THREE.Vector3(placement.centerX, 0, placement.frontZ),
          onFinished => this.soundManager.playCareerMissionVoice(campaignConfig.defenderFaction, 'follow', onFinished),
          () => this._persistCareerReliefCharge(),
          () => this.soundManager.playCommanderCommand(campaignConfig.defenderFaction, 'charge'),
          campaignConfig.careerReliefPhase === 'charge', { chargeAfterFollow: true })
        this.reliefMarch.start()
      }
      if (veteranOutpost) {
        this._restoreCareerVeteranOutpostGate(veteranOutpost.runtimeState)
        if (veteranOutpost.templateId === 'veteran-dread-outpost') {
          this._resumeCareerVeteranReinforcementIfNeeded()
        } else {
          this._startCareerVeteranOutpostAssaultMarch(veteranOutpost.runtimeState.assaultChargeTriggered)
        }
        this.careerOutpostDefenseGuide = veteranOutpost.templateId === 'veteran-dread-outpost'
          ? new MissionGuide()
          : null
      } else if (campaignConfig.careerMissionKind === 'outpost-defense') {
        this.careerOutpostDefenseGuide = new MissionGuide()
      }
      this.defenseCampaignHud = new DefenseCampaignHUD(
        campaignConfig.stageId,
        veteranOutpost?.playerFaction ?? campaignConfig.defenderFaction,
        {
          relief,
          playerIsAttacker: veteranOutpost?.templateId === 'veteran-outpost-assault',
          reinforcementsEnabled: capabilities.reinforcementsEnabled,
          returnToTown: Boolean(campaignConfig.careerMissionId),
          meritAwarded: () => this.careerMeritAwarded,
          ...(veteranOutpost ? {
            veteranMission: true,
            missionTitle: veteranOutpost.templateId === 'veteran-dread-outpost'
              ? 'Dread Outpost · 恐怖前哨防禦'
              : 'Outpost Assault · 強攻前哨',
          } : {}),
        },
      )
    } else if (this.isDevCombat && battlePlan) {
      await this._executeBattleSpawnPlan(battlePlan, progress)
      if (isRomanDefenseDevScenario) {
        // Siege scenario J starts immediately: Roman defenders hold the fort,
        // while Viking attackers advance and let Breach Proxy choose the gate.
        for (const npc of this.npcs) {
          npc.setTacticalOrder(
            npc.characterFaction === 'roman' ? 'defend' : 'attack',
          )
        }
      } else {
        // Other DEV combat scenarios remain controllable test battlefields.
        for (const npc of this.npcs) npc.setTacticalOrder('defend')
      }
      if (this.activeRenderProbe === 'simple-material') {
        applyDevSimpleMaterials(this.npcs, this.mounts)
      }
    } else if (devModelsMode === 'humans') {
      this._spawnHumanoidStudio()
    } else if (this.isMountStudio) {
      this._spawnMountStudio()
    } else if (battleConfig && battlePlan) {
      await this._executeBattleSpawnPlan(battlePlan, progress)
      this.battleController = new BattleController(
        battleConfig,
        () => this.battleStats.snapshot(this.npcs, this.player),
        battleConfig.commandGrouping === 'squad',
      )
      this.battleController.initCounts(this.npcs)
    }

    if (
      !this.isModelStudio
      && (!previewPlayerSpawn || Boolean(campaignConfig))
      && shouldCreateStartingHorse(activeBattleConfig)
    ) {
      const playerSpawn = battlePlan?.playerSpawn ?? previewPlayerSpawn ?? (isRoman ? ROMAN_PLAYER_SPAWN : VIKING_PLAYER_SPAWN)
      const startingHorse = new Mount(
        this.scene,
        mountTypeFromId(this.careerProfile ? activeBattleConfig?.playerLoadout?.mountId : query.get('mount') ?? activeBattleConfig?.playerLoadout?.mountId),
        playerSpawn.x,
        playerSpawn.z,
        undefined,
        campaignConfig?.playerMountAppearanceVariant ?? 0,
      )
      this.startingHorse = startingHorse
      this.mounts.push(startingHorse)
      this.player.faceDirection(0, isRoman ? 1 : -1)
      const reliefHeading = campaignConfig?.careerMissionKind === 'outpost-relief' ? (isRoman ? Math.PI : 0) : undefined
      this._mountPlayer(startingHorse, reliefHeading)
      if (reliefHeading !== undefined) this.thirdPersonCamera.setYaw(isRoman ? 0 : Math.PI)
    }
    
    this.damageNumbers = new DamageNumbers()

    // ── RPG Systems & Inventory ──
    this.staminaBar       = new StaminaBar()
    this.hpBar            = new HpBar()
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI         = new QuiverUI()
    this.skillManager     = new SkillManager()
    if (this.careerProfile) this.skillManager.setSkillState(this.careerProfile.skills ?? {})
    this.player.blockingLevel = this.skillManager.skillState.blocking.level
    this.player.onShieldBlock = impact => this._applyPlayerSkillAward({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    if (!this.careerProfile) this.player.setMaxHp(resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, this.skillManager.skillState))
    this.armyCommandUI   = new ArmyCommandUI(playerFaction)
    this.equipmentUI      = new EquipmentUI()
    this.inventoryManager = new InventoryManager(activeBattleConfig?.playerLoadout, playerHeroId)
    if (this.careerProfile) {
      const inventory = new TownEquipment(() => this.careerProfile!, profile => {
        if (!this.careerStore.save(profile)) return false
        this.careerProfile = profile
        return true
      })
      inventory.prepareForCombat()
      this.inventoryManager = inventory
      this.player.setMaxHp(resolveCareerPlayerMaxHp(this.careerProfile, this.basePlayerMaxHp))
      this.player.setHp(this.player.maxHp)
      this.controlsHint.textContent = 'WASD 移動 ｜ Shift 衝刺 ｜ 左鍵攻擊 ｜ 右鍵舉盾／瞄準 ｜ Tab 裝備 ｜ 滾輪切換武器'
    }
    this.combatEvents.subscribe(event => this._awardPlayerSkillXpFromEvent(event))
    await this._restorePersonalOutpostBattle(progress)
    this._deployPersonalOutpost()
    await this.personalSquad?.waitForSpawns()
    const outpostPlacement = previewOutpostFaction ? getCampaignOutpostPlacement(previewOutpostFaction) : null
    const formationRegion = outpostPlacement ? {
      minX: outpostPlacement.centerX - outpostPlacement.halfWidth,
      maxX: outpostPlacement.centerX + outpostPlacement.halfWidth,
      minZ: Math.min(outpostPlacement.frontZ, outpostPlacement.backZ),
      maxZ: Math.max(outpostPlacement.frontZ, outpostPlacement.backZ),
    } : null
    const formationController = new FormationController(
      this.scene, this.camera, this.personalSquad?.actors ?? this.npcs, terrainMesh, obstacles, this.navigationWorld, this.personalSquad ? null : formationRegion,
    )
    this.armyCommandController = new ArmyCommandController(
      this.personalSquad?.actors ?? this.npcs,
      playerFaction,
      this.input,
      this.armyCommandUI,
      formationController,
      (order) => { this.personalSquad?.resumeCommand(order); if (order !== 'follow') this.soundManager.playCommanderCommand(playerFaction, order) },
      campaignConfig ? 'defend' : this.isDevCombat ? 'defend' : 'attack',
      (order) => {
        if (this.personalSquad) return !this.player.dead && this.controlMode !== 'spectator'
        if (!campaignConfig || (order !== 'attack' && order !== 'charge')) return true
        const attackerFaction = opposingCampaignFaction(campaignConfig.defenderFaction)
        return this._campaignFactionAlive(attackerFaction) > 0
      },
      this.inventoryManager,
      this.personalSquad ? 'squad' : activeBattleConfig?.commandGrouping ?? 'preset',
      Boolean(this.personalSquad) || defenseCampaignCapabilities(campaignConfig).playerCommandsEnabled,
      this.personalSquad ? {
        enabled: () => !this.player.dead && this.controlMode !== 'spectator',
        issue: order => order === 'follow' ? this.personalSquad!.follow() : this.personalSquad!.dismiss(),
      } : undefined,
    )


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
        {
          source: createPlayerCombatActorRef(this.player),
          weaponId: this.inventoryManager.equippedRanged.id,
          emit: this.combatEvents.emit,
        },
      )
      this.arrows.push(arrow)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

    // Player Death notify & Spectator transition
    this.player.onPlayerDeath = () => {
      this._enterSpectatorMode('death')
      if (campaignConfig?.careerVeteranOutpost) {
        const mission = this.careerProfile?.activeMission
        if (mission) mission.playerDead = true
        this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
      }
    }

    if (campaignConfig?.careerVeteranOutpost) this._restoreCareerVeteranPlayerStateAndShowTerminalResult()
    else this._restorePersonalOutpostPlayer()
    this.initializing = false
    this._persistPersonalOutpost(true)

    if (isInitialSpectator) {
      this._enterSpectatorMode('initial')
    }

    this._setupPointerLock()
    this._setupResize()
    this._setupShortcuts()
    if (query.get('freeride') === '1' && ['black-cat', 'corgi'].includes(query.get('mount') ?? '')) {
      this.controlsHint.textContent += ' ｜ Esc 暫停／退出試騎'
      this.heroMountTrialUI = new HeroMountTrialUI({
        onPause: () => this.input.clear(),
        onResume: () => {
          this.input.clear()
          if (!query.has('nolock')) this.input.requestPointerLock(this.renderer.domElement)
        },
        onExit: () => this._returnToHome(),
        equipmentVisible: () => this.equipmentUI.visible,
      })
    }
    if (this.veteranOutpostCheckpoint) window.addEventListener('pagehide', this.flushVeteranOutpostOnPageHide)
    if (this.careerProfile) window.addEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    if (this.personalSquad) window.addEventListener('pagehide', this.flushPersonalOutpostOnPageHide)

    // Initialise bars
    if (!isInitialSpectator) {
      this.hpBar.setFill(this.player.hpRatio)
      this.staminaBar.setFill(1)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

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

    const model = new URLSearchParams(window.location.search).get('devmodels')
    const isCat = model === 'black-cat'
    const isCorgi = model === 'corgi'
    const isProcedural = isCat || isCorgi
    const mount = new Mount(this.scene, isCat ? MountType.BLACK_CAT : isCorgi ? MountType.CORGI : DEFAULT_MOUNT_TYPE, 0, 0, HUMANOID_STUDIO_FLOOR_Y)
    const studioClips = isProcedural ? QUADRUPED_STUDIO_CLIPS : HORSE_STUDIO_CLIPS
    if (isProcedural) {
      this.camera.position.set(isCorgi ? 6.4 : 4.4, HUMANOID_STUDIO_FLOOR_Y + (isCorgi ? 2.8 : 2.6), isCorgi ? 6.8 : 4.0)
      this.studioControls?.target.set(0, HUMANOID_STUDIO_FLOOR_Y + 1.1, -0.2)
      this.studioControls?.update()
      this.scene.background = new THREE.Color(0x302e2c)
      this.scene.fog = new THREE.Fog(0x302e2c, 12, 32)
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x45413c, roughness: 0.95 }))
      floor.rotation.x = -Math.PI / 2
      floor.position.y = HUMANOID_STUDIO_FLOOR_Y + 0.002
      floor.receiveShadow = true
      this.scene.add(floor)
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
        light.position.set(x, HUMANOID_STUDIO_FLOOR_Y + y, z)
        light.target.position.set(0, HUMANOID_STUDIO_FLOOR_Y + 1, 0)
        this.scene.add(light, light.target)
      }
      const style = document.createElement('style')
      style.textContent = '#hud,#army-command-hud,#crosshair,#controls-hint,#pickup-prompt{display:none!important}'
      document.head.appendChild(style)
    }
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
    if (!isProcedural) this._createStudioLabel('寫實戰馬｜動畫與騎乘驗收', 0)
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
      this.scene.add(skeleton)
      this.mountStudioSkeleton = skeleton
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
      if (isProcedural && !isCorgi) rider.root.visible = false
      this.mountStudioRider = rider
      this.mountStudioRiderPelvisHeight = pelvisHeight
      if (isCat) this.mountStudioSeatContacts.set(rider, new MountStudioSeatContact(
        rider.root, mount.group, mount.catVisual!.root.getObjectByName('cat_saddle_leather') as THREE.SkinnedMesh,
      ))
    }

    let riderWeaponButton: HTMLButtonElement | null = null
    const cycleRiderWeapon = () => {
      if (!this.mountStudioRider) return
      const playback = this.humanoidStudioPlayback.get(this.mountStudioRider)!
      if (playback.weapon === 'bow') return
      const choices = isCorgi ? ['lance', 'axe', 'sword'] as const : ['lance', 'sword'] as const
      const next = choices[(choices.findIndex(weapon => weapon === playback.weapon) + 1) % choices.length]
      playback.setEquipmentLoadout(next, playback.shield.visible)
      this.mountStudioRider.root.visible = true
      if (riderWeaponButton) riderWeaponButton.textContent = `武器：${{ lance: '長槍', axe: '斧頭', sword: '劍' }[next]}`
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
    this.mountStudioStatus = status
    if (isProcedural) {
      const toolbar = document.createElement('div')
      toolbar.style.cssText = 'position:fixed;top:24px;left:32px;right:32px;z-index:40;color:#e6d7bb;font:14px system-ui;display:flex;align-items:center;gap:12px'
      toolbar.innerHTML = '<div style="margin-right:auto"><div style="letter-spacing:4px;font-size:11px;color:#b99a66">SAGABURST / MOUNTS</div><h1 style="font:28px Georgia,serif;margin:8px 0">月影旅者 · 黑貓坐騎</h1></div>'
      if (isCorgi) toolbar.querySelector('h1')!.textContent = '赤金衛士 · 柯基坐騎'
      const poses: [string, number, number, number][] = isCorgi
        ? [['正面', 0, 1.4, 8], ['側面', -7.8, 1.4, 0], ['背面', 0, 1.4, -8], ['三分之四', -6.4, 2.8, 6.8]]
        : [['正面', 0, 2.1, 6], ['側面', 6, 2.0, 0], ['背面', 0, 2.2, -6], ['三分之四', 4.4, 2.6, 4]]
      for (const [label, x, y, z] of poses) {
        const button = document.createElement('button')
        button.textContent = label
        button.style.cssText = 'background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;padding:9px 14px;cursor:pointer'
        button.onclick = () => { this.camera.position.set(x, HUMANOID_STUDIO_FLOOR_Y + y, z); this.studioControls?.target.set(0, HUMANOID_STUDIO_FLOOR_Y + 1.1, -0.2); this.studioControls?.update() }
        toolbar.appendChild(button)
      }
      const ride = document.createElement('a'); ride.textContent = '進入試騎 →'; ride.href = `?freeride=1&mount=${isCorgi ? 'corgi' : 'black-cat'}&nolock`
      ride.style.cssText = 'padding:10px 16px;background:#b99a66;color:#201b14;border-radius:5px;text-decoration:none'
      toolbar.appendChild(ride)
      if (isCorgi) {
        riderWeaponButton = document.createElement('button')
        riderWeaponButton.textContent = '武器：劍'
        riderWeaponButton.style.cssText = 'padding:9px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;cursor:pointer'
        riderWeaponButton.onclick = cycleRiderWeapon
        toolbar.appendChild(riderWeaponButton)
      }
      {
        let equipped = true
        const armor = document.createElement('button'); armor.textContent = '護甲：開'
        armor.style.cssText = 'padding:9px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;cursor:pointer'
        armor.onclick = () => { equipped = !equipped; (mount.catVisual ?? mount.corgiVisual)!.setEquipmentVisible(equipped); armor.textContent = `護甲：${equipped ? '開' : '關'}` }
        toolbar.appendChild(armor)
      }
      document.body.appendChild(toolbar)
      if (isProcedural && this.mountStudioRider) {
        const riders = new Map<string, { rider: HumanoidCharacterInstance; pelvisHeight: number }>([
          [isCorgi ? 'roman-t2' : 'viking-t2', { rider: this.mountStudioRider, pelvisHeight: this.mountStudioRiderPelvisHeight }],
        ])
        const picker = document.createElement('label')
        picker.style.cssText = 'position:fixed;top:110px;right:32px;z-index:40;padding:10px 14px;background:#282522;color:#e6d7bb;border:1px solid #766347;border-radius:5px;font:14px system-ui'
        picker.textContent = '騎士：'
        const select = document.createElement('select')
        select.setAttribute('aria-label', isCorgi ? '柯基騎士' : '黑貓騎士')
        select.style.cssText = 'background:#282522;color:#e6d7bb;border:0;font:inherit;padding:4px'
        for (const [value, label] of (isCorgi ? [['roman-t2', '一般羅馬人'], ['roman-t4', 'T4 羅馬禁衛軍'], ['maki-t4', 'T4 遊俠 Maki']] : [['viking-t2', '一般維京人'], ['viking-t4', 'T4 維京英雄'], ['maki-t4', 'T4 遊俠 Maki']])) {
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
              const { MAKI_FALLBACK, loadMakiRangerBow } = await import('./world/MakiRangerEquipment')
              const maki = key === 'maki-t4'
              const descriptor = HERO_ASSETS[maki ? 'maki-archer-t4' : isCorgi ? 'roman-hero-t4' : 'viking-hero-t4'].descriptor
              await HumanoidAssetRegistry.preloadAsset(descriptor)
              const bowAssets = maki ? { bow: await loadMakiRangerBow(), meleeAnimation: MAKI_FALLBACK.animation } : undefined
              const rider = HumanoidAssetRegistry.createCharacterInstance({ faction: descriptor.faction, tier: 2, isPlayer: false }, descriptor.assetId)
              const playback = new HumanoidStudioPlayback(rider, 'mounted', descriptor.faction, mount.type, bowAssets)
              playback.setEquipmentLoadout(maki ? 'bow' : isCorgi ? 'sword' : 'axe', !maki)
              playback.sampleEquipment(0, true)
              rider.root.updateWorldMatrix(true, true)
              const pelvisHeight = rider.root.worldToLocal(rider.rig.pelvis!.getWorldPosition(new THREE.Vector3())).y
              rider.root.rotation.x = mount.ridePitch
              mount.group.add(rider.root)
              this.humanoidStudioPlayback.set(rider, playback)
              riders.set(key, { rider, pelvisHeight })
            }
            const previous = this.mountStudioRider!
            previous.root.visible = false
            this.humanoidShowcase = this.humanoidShowcase.filter(rider => rider !== previous)
            const selected = riders.get(key)!
            this.mountStudioRider = selected.rider
            this.mountStudioRiderPelvisHeight = selected.pelvisHeight
            selected.rider.root.visible = true
            if (riderWeaponButton) {
              const weapon = this.humanoidStudioPlayback.get(selected.rider)!.weapon
              riderWeaponButton.textContent = `武器：${{ none: '無', bow: '遊俠弓', lance: '長槍', axe: '斧頭', sword: '劍' }[weapon]}`
            }
            this.humanoidShowcase.push(selected.rider)
            this._updateMountStudioStatus()
            if (isCat && !this.mountStudioSeatContacts.has(selected.rider)) {
              this.mountStudioSeatContacts.set(selected.rider, new MountStudioSeatContact(
                selected.rider.root, mount.group, mount.catVisual!.root.getObjectByName('cat_saddle_leather') as THREE.SkinnedMesh,
              ))
              this._updateMountStudioStatus()
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
        select.value = requested && [...select.options].some(option => option.value === requested) ? requested : isCorgi ? 'roman-t2' : 'viking-t4'
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
      } else if (event.code === 'KeyH' && this.mountStudioSkeleton) {
        this.mountStudioSkeleton.visible = !this.mountStudioSkeleton.visible
      } else if (event.code === 'KeyV' && this.mountStudioRider) {
        this.mountStudioRider.root.visible = !this.mountStudioRider.root.visible
      } else if (this.mountStudioRider && ['KeyL', 'KeyQ', 'KeyF'].includes(event.code)) {
        const playback = this.humanoidStudioPlayback.get(this.mountStudioRider)!
        if (event.code === 'KeyF') playback.attackEquipment()
        else if (event.code === 'KeyL') cycleRiderWeapon()
        else if (playback.weapon !== 'bow') playback.setEquipmentLoadout(playback.weapon, !playback.shield.visible)
      }
    })
  }

  private _updateMountStudioStatus(): void {
    if (!this.mountStudioStatus || !this.mountStudioHorse) return
    if (this.mountStudioRider) {
      const seat = this.mountStudioHorse.getRiderPelvisSeatLocal()
      this.mountStudioRider.root.position.set(
        seat.x,
        seat.y - this.mountStudioRiderPelvisHeight,
        seat.z,
      )
      this.mountStudioSeatContacts.get(this.mountStudioRider)?.align()
      this.mountStudioHorse.corgiVisual?.fitRider(this.mountStudioRider.root)
    }
    const state = this.mountStudioHorse.getHorseDebugState()
    if (!state) {
      const procedural = this.mountStudioHorse.proceduralVisual?.debugState()
      if (procedural) this.mountStudioStatus.textContent = `${this.mountStudioHorse.displayName} · ${procedural.clip} · ${procedural.paused ? '暫停' : '播放中'} · ${procedural.actionTime.toFixed(2)} s · ${procedural.playbackRate.toFixed(2)}×｜來源 GLB · LOD ${procedural.lod} · 1 mixer`
      return
    }
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
    const alive = this.npcs.reduce((count, npc) => count + (npc.dead ? 0 : 1), 0)
    const activeAttack = this.npcs.reduce((count, npc) => count + (npc.currentState === AIState.ATTACK ? 1 : 0), 0)
    this.devCombatStatus.textContent = this.runtimeProfiler.formatHUD({
      renderProbe: this.activeRenderProbe !== 'normal' ? this.activeRenderProbe : undefined,
      npcCount: this.npcs.length,
      aliveCount: alive,
      deadCount: this.npcs.length - alive,
      activeAttackCount: activeAttack,
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
    assertNpcSpawnJob()
    const npc = trackNpcSpawn(new NPC(
      this.scene,
      spec.x,
      spec.z,
      spec.faction,
      spec.characterFaction,
      spec.aiType,
      spec.name,
      spec.tier,
      spec.cavalry,
      spec.loadout,
      spec.presetId,
      spec.squadId,
      spec.actorId,
      this.combatEvents.emit,
      spec.visualAssetId,
      spec.combatProfileId,
      spec.specialCombatProfile,
    ))
    npc.respawnEnabled = spec.respawnEnabled
    if (spec.cavalry || Boolean(spec.loadout?.mountId)) {
      const stableKey = `${spec.characterFaction}:${spec.name}:${spec.tier}`
      const variant = horseVariantForStableKey(stableKey)
      const mount = trackNpcSpawn(new Mount(this.scene, mountTypeFromId(spec.loadout?.mountId), spec.x, spec.z, undefined, variant))
      npc.mountVehicle(mount)
      this.mounts.push(mount)
      this._aimTargetRegistry.registerMount(mount)
    }
    if (this.defenseCampaignConfig?.careerMissionId) {
      this.careerVeteranActorMounts.set(npc.combatantId, npc.mount)
    }
    this.npcs.push(npc)
    this.battleStats.registerNpc(npc)
    this._aimTargetRegistry.registerNpc(npc)
    return npc
  }

  private _newSpawnBatch(): NpcSpawnBatch {
    const batch = gameplayNpcSpawns.batch(() => {
      this.spawningStopped = true
      try { this._showNotify?.('部隊建立失敗，請重新載入以恢復完整名冊', 10000) }
      finally { this._disposeCareerOutpostBattleActors() }
    })
    this.spawnBatches.push(batch)
    return batch
  }

  private async _executeBattleSpawnPlan(plan: BattleSpawnPlan, progress: (text: string) => void = () => {}): Promise<NPC[]> {
    const spawned: NPC[] = []
    const batch = this._newSpawnBatch()
    for (const [index, spec] of plan.npcSpecs.entries()) {
      batch.enqueue(spec.actorId ?? `initial:${index}`, () => spawned.push(this._spawnNpc(spec)))
    }
    batch.seal()
    await gameplayNpcSpawns.wait(batch, (done, total) => progress(`建立部隊 ${done} / ${total}…`))
    for (const p of plan.pickupSpecs) {
      this.pickups.push(new WeaponPickup(this.scene, p.weaponId, p.x, p.z, p.isArrowPack, p.arrowQuantity))
    }
    for (const h of plan.horseSpecs) {
      const variant = horseVariantForStableKey(h.stableKey)
      const mount = new Mount(this.scene, DEFAULT_MOUNT_TYPE, h.x, h.z, undefined, variant)
      this.mounts.push(mount)
      this._aimTargetRegistry.registerMount(mount)
    }
    return spawned
  }

  private _persistCareerReliefCharge(): void {
    const fresh = this.careerStore.loadChecked().profile
    const mission = fresh?.activeOutpostMission
    if (!fresh || !mission || mission.kind !== 'outpost-relief'
      || mission.id !== this.defenseCampaignConfig?.careerMissionId || mission.reliefPhase === 'charge') return
    const next = { ...fresh, activeOutpostMission: { ...mission, reliefPhase: 'charge' as const } }
    if (this.careerStore.save(next)) this.careerProfile = next
    else this._showNotify('無法保存衝鋒進度；重新載入可能重播命令。')
  }

  private _identifyPersonalOutpostWave(plan: BattleSpawnPlan, wave: 'initial' | 'attackers' | 'reinforcement'): void {
    const mission = this.careerProfile?.activeOutpostMission
    if (!mission?.personalSquad) return
    plan.npcSpecs.forEach((spec, index) => { spec.actorId = `${mission.id}:${wave}:${index}` })
  }

  private _personalOutpostWavePlan(wave: 'attackers' | 'reinforcement'): BattleSpawnPlan {
    const campaign = this.defenseCampaignConfig!
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(campaign, wave))
    if (wave === 'reinforcement') positionDefenseCampaignReinforcements(plan.npcSpecs, campaign.defenderFaction)
    else positionDefenseCampaignAttackers(plan.npcSpecs, campaign.defenderFaction)
    this._identifyPersonalOutpostWave(plan, wave)
    return plan
  }

  private _restorePersonalOutpostNpc(npc: NPC): void {
    const saved = this.careerProfile?.activeOutpostMission?.battle?.actors[npc.combatantId]
    if (!saved) return
    const mount = this.careerVeteranActorMounts.get(npc.combatantId)
    if (mount) {
      mount.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z), saved.z)
      mount.group.rotation.y = saved.yaw
      if (saved.mountHp === 0) { mount.takeDamage(mount.maxHp + 1); if (npc.mount) npc.dismountFromMount() }
      else if (saved.mountHp !== undefined) mount.currentHp = Math.min(mount.maxHp, saved.mountHp)
    }
    npc.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z), saved.z)
    npc.group.rotation.y = saved.yaw
    npc.restoreCombatHealth(saved.hp)
  }

  private outpostRestoration?: Promise<void>
  private _restorePersonalOutpostBattle(progress: (text: string) => void = () => {}): Promise<void> {
    return this.outpostRestoration ??= this._restorePersonalOutpostActors(progress)
  }

  private async _restorePersonalOutpostActors(progress: (text: string) => void): Promise<void> {
    const mission = this.careerProfile?.activeOutpostMission, saved = mission?.battle
    if (!mission?.personalSquad || !saved) return
    this.campaignAttackersStarted = saved.attackersStarted
    this.campaignReinforcementSpawned = saved.reinforcementsSpawned
    const gate = this.previewCampaignGate
    if (gate && saved.gate) {
      this.restoringCareerOutpostGate = true
      try {
        if (saved.gate.state === 'destroyed' || saved.gate.hp === 0) gate.damageable.destroy()
        else {
          if (saved.gate.state === 'open') gate.open()
          if (saved.gate.hp < gate.damageable.currentHp) gate.damageable.takeDamage(gate.damageable.currentHp - saved.gate.hp)
        }
      } finally { this.restoringCareerOutpostGate = false }
    }
    const waves: Array<'attackers' | 'reinforcement'> = []
    if (mission.kind !== 'outpost-relief' && (saved.attackersStarted || saved.wave === 'attackers')) waves.push('attackers')
    if (saved.reinforcementsSpawned || saved.wave === 'reinforcement') waves.push('reinforcement')
    for (const wave of waves) {
      const plan = this._personalOutpostWavePlan(wave)
      const spawned = saved.wave === wave ? Math.min(saved.waveIndex, plan.npcSpecs.length) : plan.npcSpecs.length
      const batch = this._newSpawnBatch()
      for (const spec of plan.npcSpecs.slice(0, spawned)) batch.enqueue(spec.actorId!, () => {
        const npc = this._spawnNpc(spec); npc.setTacticalOrder('attack'); this._restorePersonalOutpostNpc(npc)
      })
      batch.seal()
      await gameplayNpcSpawns.wait(batch, (done, total) => progress(`還原戰場 ${done} / ${total}…`))
      if (saved.wave === wave && spawned < plan.npcSpecs.length) {
        this.campaignSpawnQueue = plan.npcSpecs; this.campaignSpawnQueueIndex = spawned; this.campaignSpawnWave = wave
        this._enqueueDefenseCampaignRemainder()
      }
    }
  }

  private _deployPersonalOutpost(): void {
    const campaign = this.defenseCampaignConfig
    const mission = campaign?.careerVeteranOutpost ? this.careerProfile?.activeMission : this.careerProfile?.activeOutpostMission
    const saved = mission?.personalSquad
    if (!campaign?.careerMissionId || !this.careerProfile || !saved?.memberIds.length) return
    const sceneKey = `outpost:${campaign.careerMissionId}`
    const changedScene = saved.sceneKey !== sceneKey
    const placement = getCampaignOutpostPlacement(careerVeteranOutpostOwner(campaign))
    const outside = campaign.careerMissionKind === 'outpost-relief' || campaign.careerMissionKind === 'veteran-outpost-assault'
    const yaw = getCampaignDefenderFacingYaw(campaign.defenderFaction) + (outside ? Math.PI : 0)
    const anchor = { x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw }
    const bounds = outside ? this.navigationWorld.grid : {
      minX: placement.centerX - placement.halfWidth, maxX: placement.centerX + placement.halfWidth,
      minZ: Math.min(placement.frontZ, placement.backZ), maxZ: Math.max(placement.frontZ, placement.backZ),
    }
    const slots = changedScene ? personalRearDeployment(anchor,
      this.npcs.filter(npc => !npc.dead && npc.faction === Faction.PLAYER).map(npc => npc.combatPosition),
      saved.memberIds.length + 1, bounds, this.obstacles, this.navigationWorld, true)
      : [anchor, ...saved.memberIds.map(id => saved.members[id]?.position ?? anchor)]
    if (changedScene) {
      const point = slots[0]
      if (this.player.currentMount) {
        this.player.currentMount.group.position.set(point.x, getTerrainHeight(point.x, point.z), point.z)
        this.player.currentMount.group.rotation.y = yaw
      }
      this.player.group.position.set(point.x, getTerrainHeight(point.x, point.z) + .95, point.z)
      this.player.faceDirection(Math.sin(yaw), Math.cos(yaw))
      this.player.spawnX = point.x; this.player.spawnZ = point.z
      this.thirdPersonCamera.setYaw(yaw + Math.PI)
    }
    this.personalSquad = new PersonalSquadRuntime(this.scene, slots.slice(1), () => this.careerProfile!, () => this.player, undefined, {
      sceneKey, hasHR: false,
      formationSlots: (anchor, occupied, count) => personalRearDeployment(anchor, occupied, count,
        this.navigationWorld.grid, this.obstacles, this.navigationWorld),
      emit: this.combatEvents.emit,
      onSpawn: (npc, mount) => {
        this.npcs.push(npc); this.battleStats.registerNpc(npc); this._aimTargetRegistry.registerNpc(npc)
        if (mount) { this.mounts.push(mount); this._aimTargetRegistry.registerMount(mount) }
      },
      onDispose: (npc, mount) => {
        this._aimTargetRegistry.unregisterNpc(npc)
        const index = this.npcs.indexOf(npc); if (index >= 0) this.npcs.splice(index, 1)
        if (mount) { this._aimTargetRegistry.unregisterMount(mount); const index = this.mounts.indexOf(mount); if (index >= 0) this.mounts.splice(index, 1) }
      },
    })
    this.personalSquad.restoreMission(saved)
  }

  private _restorePersonalOutpostPlayer(): void {
    const saved = this.careerProfile?.activeOutpostMission?.battle?.player
    if (!saved) return
    this.player.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z) + .95, saved.z)
    this.player.faceDirection(Math.sin(saved.yaw), Math.cos(saved.yaw))
    const mount = this.startingHorse
    if (mount) {
      mount.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z), saved.z); mount.group.rotation.y = saved.yaw
      if (saved.mountHp === 0) { mount.takeDamage(mount.maxHp + 1); this.player.dismountFromMount() }
      else if (saved.mountHp !== undefined) mount.currentHp = Math.min(mount.maxHp, saved.mountHp)
    }
    this.player.setHp(saved.hp); this.player.setStamina(saved.stamina)
    if (saved.ammo !== undefined) this.player.setArrowCount(saved.ammo)
    if (saved.shieldImpact !== undefined) this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.shieldImpact)
    if (saved.dead) { this.player.detachFromMountOnDeath(); this.player.takeDamage(this.player.maxHp * 100, this.hpBar) }
  }

  private _persistPersonalOutpost(force = false, dt = 0): boolean {
    if (this.initializing || this.spawningStopped) return true
    if (!this.personalSquad || !this.careerProfile) return true
    const personal = this.personalSquad.checkpoint()
    if (!personal) return true
    this.personalCheckpointElapsed += dt
    const critical = JSON.stringify([personal.state, this.player.dead, this.campaignSpawnWave,
      this.defenseCampaignRuntime?.getSnapshot().phase, personal.memberIds.map(id => {
        const actor = personal.members[id]
        return [actor.status, actor.order, actor.mount?.hp === 0, actor.formation?.commandId]
      })])
    if (!force && this.personalCheckpointElapsed < 5 && critical === this.personalCriticalState) return true
    if (this.defenseCampaignConfig?.careerVeteranOutpost) {
      const saved = this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
      if (saved) { this.personalCheckpointElapsed = 0; this.personalCriticalState = critical }
      return saved
    }
    const next = this.careerStore.loadChecked().profile
    const mission = next?.activeOutpostMission, runtime = this.defenseCampaignRuntime?.getSnapshot()
    if (!next || !mission || mission.id !== this.defenseCampaignConfig?.careerMissionId || !runtime) return false
    personal.contribution = this.battleStats.commandCheckpoint()
    mission.personalSquad = personal
    mission.battle = {
      runtime, actors: { ...mission.battle?.actors, ...Object.fromEntries(this.npcs.filter(npc => npc.combatOwnership !== 'player-personal').map(npc => {
        const mount = this.careerVeteranActorMounts.get(npc.combatantId)
        return [npc.combatantId, { hp: npc.hp, x: npc.combatPosition.x, z: npc.combatPosition.z,
          yaw: npc.mount?.group.rotation.y ?? npc.group.rotation.y, ...(mount ? { mountHp: mount.dead ? 0 : mount.currentHp } : {}) }]
      })) },
      player: { hp: this.player.hp, stamina: this.player.staminaValue, dead: this.player.dead,
        x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw: this.player.currentMount?.group.rotation.y ?? this.player.group.rotation.y,
        ammo: this.player.arrowCount, shieldImpact: this.player.shield.shieldImpactRemaining,
        ...(this.startingHorse ? { mountHp: this.startingHorse.dead ? 0 : this.startingHorse.currentHp } : {}) },
      playerStats: this.battleStats.checkpoint(), wave: this.campaignSpawnWave, waveIndex: this.campaignSpawnQueueIndex,
      attackersStarted: this.campaignAttackersStarted, reinforcementsSpawned: this.campaignReinforcementSpawned,
      ...(this.previewCampaignGate ? { gate: { hp: this.previewCampaignGate.damageable.currentHp, state: this.previewCampaignGate.state } } : {}),
    }
    if (!this.careerStore.save(next)) return false
    this.careerProfile = next; this.personalCheckpointElapsed = 0; this.personalCriticalState = critical
    return true
  }

  private _campaignFactionAlive(faction: 'roman' | 'viking'): number {
    let alive = 0
    for (const npc of this.npcs) {
      if (!npc.dead && npc.combatOwnership !== 'player-personal' && npc.characterFaction === faction) alive++
    }
    return alive
  }

  private _applyCampaignBreachOrders(attackerFaction: CampaignFaction): void {
    const result = applyCampaignBreachOrders(this.npcs, attackerFaction)
    if (this.restoringCareerOutpostGate) return
    this.soundManager.playCommanderCommand(attackerFaction, 'charge')
    this._showNotify(
      `⚔️ Breach! ${attackerFaction === 'viking' ? '維京' : '羅馬'}近戰衝鋒｜`
      + `${result.attackerChargeCount} charge / ${result.attackerAttackCount} ranged｜`
      + `守軍 ${result.defenderAttackCount} → attack`,
      3500,
    )
    if (this.defenseCampaignConfig?.careerVeteranOutpost?.templateId === 'veteran-outpost-assault') {
      this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
    }
  }

  private _restoreCareerVeteranNpcState(npc: NPC): void {
    const mission = this.careerProfile?.activeMission
    const actorId = npc.combatantId
    if (!mission || !actorId) return
    const saved = mission.actorHealth?.[actorId]
    const dead = mission.deadTargetActorIds?.includes(actorId) || mission.deadFriendlyActorIds?.includes(actorId)
    if (!this.careerVeteranActorMounts.has(actorId)) this.careerVeteranActorMounts.set(actorId, npc.mount)
    const mount = this.careerVeteranActorMounts.get(actorId) ?? null
    if (saved?.mountHp !== undefined && mount) {
      if (saved.mountHp <= 0) {
        if (!mount.dead) mount.takeDamage(mount.maxHp * 100)
      } else if (!mount.dead) {
        mount.currentHp = Math.min(mount.maxHp, saved.mountHp)
      }
    }
    if (dead) npc.restoreCombatHealth(0)
    else if (saved) npc.restoreCombatHealth(saved.hp)
  }

  private _restoreCareerVeteranOutpostGate(saved: NonNullable<DefenseCampaignLaunchConfig['careerVeteranOutpost']>['runtimeState']): void {
    const gate = this.previewCampaignGate
    if (!gate) return
    this.restoringCareerOutpostGate = true
    try {
      if (saved.gateState === 'destroyed' || saved.gateHealth === 0) {
        gate.damageable.destroy()
      } else {
        if (saved.gateState === 'open') gate.open()
        if (saved.gateHealth !== undefined && saved.gateHealth < gate.damageable.currentHp) {
          gate.damageable.takeDamage(gate.damageable.currentHp - saved.gateHealth)
        }
      }
    } finally {
      this.restoringCareerOutpostGate = false
    }
  }

  private _resumeCareerVeteranReinforcementIfNeeded(): void {
    const state = this.defenseCampaignConfig?.careerVeteranOutpost?.runtimeState
    if (!state?.reinforcementTriggered || this.campaignSpawnWave !== null) return
    this._queueDefenseCampaignWave('reinforcement')
  }

  private _makeMountedMissionSquads(npcs: readonly NPC[], squadIds: readonly number[]): MountedMissionSquad[] {
    return squadIds.map(squadId => {
      const members = npcs.filter(npc => npc.squadId === squadId && !npc.dead)
      const leader = members.find(npc => npc.tier === 4)
      const lane = squadId % 2 === 0 ? 1 : -1
      return { leader, members, leaderOffset: new THREE.Vector3(lane * (squadId <= 2 ? 12 : 24), 0, -Math.floor((squadId - 1) / 2) * 7) }
    }).filter(squad => squad.members.length > 0)
  }

  private _startCareerVeteranReinforcementMarch(resumeCharged: boolean): void {
    if (this.veteranReinforcementMarch) return
    const campaign = this.defenseCampaignConfig
    const data = campaign?.careerVeteranOutpost
    if (!campaign || data?.templateId !== 'veteran-dread-outpost') return
    const ids = new Set(this.careerProfile?.activeMission?.reinforcementActorIds ?? [])
    const reinforcements = this.npcs.filter(npc => ids.has(npc.combatantId))
    const placement = getCampaignOutpostPlacement(data.outpostFaction)
    const inward = Math.sign(placement.backZ - placement.frontZ)
    const target = new THREE.Vector3(placement.centerX, 0, placement.frontZ - inward * 24)
    this.veteranReinforcementMarch = new MountedMissionMarchController(
      reinforcements,
      target,
      () => undefined,
      () => {
        const arrived = this.campaignReinforcementArrived
        this.campaignReinforcementArrived = true
        if (!this._persistCareerVeteranOutpostCheckpoint({ immediate: true })) {
          this.campaignReinforcementArrived = arrived
          return false
        }
        return true
      },
      () => this.soundManager.playCommanderCommand(data.playerFaction, 'charge'),
      resumeCharged,
      {
        squads: this._makeMountedMissionSquads(reinforcements, [1, 2]),
        leaderMode: 'independent',
        playerSquadIndex: null,
        playFollow: false,
        chargeDistance: 60,
        followerCount: 24,
      },
    )
    this.veteranReinforcementMarch.start()
  }

  private _startCareerVeteranOutpostAssaultMarch(resumeCharged: boolean): void {
    if (this.veteranOutpostMarch) return
    const campaign = this.defenseCampaignConfig
    const data = campaign?.careerVeteranOutpost
    if (!campaign || data?.templateId !== 'veteran-outpost-assault') return
    const attackers = this.npcs.filter(npc => npc.combatOwnership !== 'player-personal' && npc.characterFaction === data.playerFaction)
    const placement = getCampaignOutpostPlacement(data.outpostFaction)
    const target = new THREE.Vector3(placement.centerX, 0, placement.frontZ)
    this.veteranOutpostMarch = new MountedMissionMarchController(
      attackers,
      target,
      () => undefined,
      () => {
        const mission = this.careerProfile?.activeMission
        if (mission?.outpostBattleState?.assaultChargeTriggered) return true
        if (!mission) return false
        const fresh = this.careerStore.loadChecked().profile
        if (!fresh?.activeMission || fresh.activeMission.id !== data.missionId) return false
        fresh.activeMission.outpostBattleState = {
          ...(fresh.activeMission.outpostBattleState ?? data.runtimeState),
          assaultChargeTriggered: true,
        }
        if (!this.careerStore.save(fresh)) return false
        this.careerProfile = fresh
        return true
      },
      () => this.soundManager.playCommanderCommand(data.playerFaction, 'charge'),
      resumeCharged,
      {
        squads: this._makeMountedMissionSquads(attackers, [1, 2, 3, 4]),
        leaderMode: 'independent',
        playerSquadIndex: 0,
        playFollow: false,
        chargeDistance: data.assaultChargeDistanceMeters,
        followerCount: 24,
      },
    )
    this.veteranOutpostMarch.start()
  }

  private _buildCareerVeteranOutpostCheckpoint(): ActiveCareerMission | null {
    const campaign = this.defenseCampaignConfig
    const data = campaign?.careerVeteranOutpost
    const savedMission = this.careerProfile?.activeMission
    const runtime = this.defenseCampaignRuntime?.getSnapshot()
    if (!campaign || !data || !savedMission || savedMission.id !== data.missionId || !runtime) return null
    const active = { ...savedMission }
    const targetIds = new Set(active.targetActorIds)
    const friendlyIds = new Set([...(active.friendlyActorIds ?? []), ...(active.reinforcementActorIds ?? [])])
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    const actorHealth = { ...(active.actorHealth ?? {}) }
    for (const npc of this.npcs) {
      const id = npc.combatantId
      if (targetIds.has(id)) {
        if (npc.dead) deadTargets.add(id)
        if (npc.hp > 0) actorHealth[id] = { ...actorHealth[id], hp: npc.hp }
        else actorHealth[id] = { ...actorHealth[id], hp: 0 }
      } else if (friendlyIds.has(id)) {
        if (npc.dead) deadFriendlies.add(id)
        if (npc.hp > 0) actorHealth[id] = { ...actorHealth[id], hp: npc.hp }
        else actorHealth[id] = { ...actorHealth[id], hp: 0 }
      } else continue
      const mount = this.careerVeteranActorMounts.has(id)
        ? this.careerVeteranActorMounts.get(id) ?? null
        : npc.mount
      if (mount) actorHealth[id] = { ...actorHealth[id], mountHp: mount.dead ? 0 : mount.currentHp }
    }
    const previousState = active.outpostBattleState ?? data.runtimeState
    const gateHealth = this.previewCampaignGate?.damageable.currentHp ?? previousState.gateHealth
    const gateState = this.previewCampaignGate?.state ?? previousState.gateState
    active.deadTargetActorIds = [...deadTargets]
    active.deadFriendlyActorIds = [...deadFriendlies]
    active.actorHealth = actorHealth
    active.playerDead = this.player.dead || active.playerDead === true
    active.playerHp = this.player.hp
    active.playerStamina = this.player.staminaValue
    active.playerStats = this.battleStats.checkpoint()
    if (active.personalSquad && this.personalSquad) {
      active.personalSquad = this.personalSquad.checkpoint()
      if (active.personalSquad) active.personalSquad.contribution = this.battleStats.commandCheckpoint()
    }
    const mountId = campaign.playerLoadout.mountId
    const mountState = active.mountState
      ? { ...active.mountState, hp: { ...active.mountState.hp }, unavailable: [...active.mountState.unavailable] }
      : { hp: {}, unavailable: [] as NonNullable<ActiveCareerMission['mountState']>['unavailable'] }
    if (mountId && this.startingHorse) {
      ;(mountState.hp as Record<string, number>)[mountId] = this.startingHorse.dead ? 0 : this.startingHorse.currentHp
      if (this.startingHorse.dead && !mountState.unavailable.includes(mountId as never)) mountState.unavailable.push(mountId as never)
    }
    active.mountState = mountState as ActiveCareerMission['mountState']
    active.outpostBattleState = {
      phase: runtime.phase,
      activePhase: runtime.activePhase,
      assaultElapsedSeconds: runtime.assaultElapsedSeconds,
      deploymentRemainingSeconds: runtime.deploymentRemainingSeconds,
      reinforcementTriggered: runtime.reinforcementTriggered,
      reinforcementSpawned: this.campaignReinforcementSpawned || previousState.reinforcementSpawned,
      reinforcementArrived: this.campaignReinforcementArrived,
      reinforcementRemainingSeconds: runtime.reinforcementRemainingSeconds,
      reinforcementQueueIndex: Math.max(previousState.reinforcementQueueIndex, this.campaignSpawnQueueIndex),
      assaultChargeTriggered: previousState.assaultChargeTriggered,
      battleFinished: runtime.battleFinished,
      ...(gateHealth !== undefined ? { gateHealth } : {}),
      ...(gateState ? { gateState } : {}),
    }
    return active
  }

  private _restoreCareerVeteranPlayerState(): void {
    const mission = this.careerProfile?.activeMission
    const campaign = this.defenseCampaignConfig
    if (!mission || !campaign?.careerVeteranOutpost || mission.id !== campaign.careerVeteranOutpost.missionId) return
    const savedMountHp = mission.mountState?.hp[campaign.playerLoadout.mountId as keyof NonNullable<ActiveCareerMission['mountState']>['hp']]
    if (this.player.currentMount && savedMountHp !== undefined) {
      if (savedMountHp <= 0) {
        this.player.currentMount.takeDamage(this.player.currentMount.maxHp * 100)
        this.player.dismountFromMount()
      } else if (!this.player.currentMount.dead) {
        this.player.currentMount.currentHp = Math.min(this.player.currentMount.maxHp, savedMountHp)
      }
    }
    this.player.setStamina(mission.playerStamina ?? this.player.staminaValue)
    this.player.setHp(mission.playerHp ?? this.player.maxHp)
    if (mission.playerDead) {
      this.player.detachFromMountOnDeath()
      this.player.takeDamage(this.player.maxHp * 100, this.hpBar)
    }
    this.hpBar.setFill(this.player.hpRatio)
    this.staminaBar.setFill(this.player.staminaRatio)
  }

  private _restoreCareerVeteranPlayerStateAndShowTerminalResult(): void {
    this._restoreCareerVeteranPlayerState()
    const state = this.defenseCampaignConfig?.careerVeteranOutpost?.runtimeState
    if (!state?.battleFinished) return
    this._showDefenseCampaignResult(state.phase === 'victory' ? 'victory' : 'defeat')
  }

  private _persistCareerVeteranOutpostCheckpoint(reason: CareerMissionCheckpointReason = { immediate: true }): boolean {
    if (this.initializing || this.spawningStopped || !this.veteranOutpostCheckpoint || !this.careerProfile) return false
    return this.veteranOutpostCheckpoint.persist(
      () => this._buildCareerVeteranOutpostCheckpoint() ?? this.careerProfile!.activeMission!,
      reason,
    )
  }

  private _queueDefenseCampaignWave(wave: 'attackers' | 'reinforcement'): number {
    const campaign = this.defenseCampaignConfig
    if (!campaign) return 0
    if (wave === 'reinforcement' && !defenseCampaignCapabilities(campaign).reinforcementsEnabled) return 0
    if (this.campaignSpawnWave !== null) return 0

    let plan: BattleSpawnPlan
    if (campaign.careerVeteranOutpost) {
      if (wave !== 'reinforcement' || campaign.careerVeteranOutpost.templateId !== 'veteran-dread-outpost') return 0
      plan = createCareerVeteranOutpostReinforcementPlan(campaign)
    } else {
      const config = createDefenseCampaignWaveConfig(campaign, wave)
      plan = BattleSpawner.createSpawnPlan(config)
      if (wave === 'reinforcement') positionDefenseCampaignReinforcements(plan.npcSpecs, campaign.defenderFaction)
      else if (wave === 'attackers') positionDefenseCampaignAttackers(plan.npcSpecs, campaign.defenderFaction)
      this._identifyPersonalOutpostWave(plan, wave)
    }

    this.campaignSpawnQueue = plan.npcSpecs
    this.campaignSpawnQueueIndex = 0
    this.campaignSpawnWave = wave
    this._enqueueDefenseCampaignRemainder()
    return plan.npcSpecs.length
  }

  private _enqueueDefenseCampaignRemainder(): void {
    const wave = this.campaignSpawnWave
    if (!wave) return
    this.campaignSpawnBatch?.cancel()
    const batch = this._newSpawnBatch()
    this.campaignSpawnBatch = batch
    for (const [index, spec] of this.campaignSpawnQueue.entries()) {
      if (index < this.campaignSpawnQueueIndex) continue
      batch.enqueue(spec.actorId ?? `${wave}:${index}`, () => {
        const npc = this._spawnNpc(spec)
        if (wave === 'attackers') this.campaignAttackersStarted = true
        if (this.defenseCampaignConfig?.careerVeteranOutpost) {
          this._restoreCareerVeteranNpcState(npc)
          npc.setTacticalOrder(wave === 'reinforcement' ? 'defend' : 'attack')
        } else { npc.setTacticalOrder('attack'); this._restorePersonalOutpostNpc(npc) }
        this.campaignSpawnQueueIndex++

        if (this.campaignSpawnQueueIndex >= this.campaignSpawnQueue.length) {
          if (wave === 'reinforcement') {
            // Terminal elimination becomes authoritative only after the entire
            // relief wave exists in the battlefield, not after its first rider.
            this.campaignReinforcementSpawned = true
            if (this.defenseCampaignConfig?.careerVeteranOutpost) {
              this._startCareerVeteranReinforcementMarch(this.campaignReinforcementArrived)
              this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
            } else this._showNotify(`🐎 援軍全數抵達：${this.campaignSpawnQueue.length} 名刀騎兵`, 3500)
          }

          this.campaignSpawnQueue = []
          this.campaignSpawnQueueIndex = 0
          this.campaignSpawnWave = null
        }
      })
    }
    batch.seal()
  }

  private _showDefenseCampaignResult(
    result: 'victory' | 'defeat',
    allowObserve = false,
  ): void {
    if (!this.defenseCampaignHud) return
    const campaign = this.defenseCampaignConfig
    const onNext = result === 'victory' && campaign && !campaign.careerMissionId && campaign.stageId < 9
      ? () => this._returnToNextDefenseCampaignSetup()
      : undefined

    if (campaign?.careerMissionId) this.battleStats.freeze()
    const stats = this.careerResultStats ?? this.battleStats.snapshot(this.npcs, this.player)
    if (campaign?.careerMissionId) this.careerResultStats = stats
    if (campaign?.careerMissionId) {
      if (!this._flushCareerSkillProgression()) {
        this._showCareerOutpostSaveRetry(result)
        return
      }
      if (campaign.careerVeteranOutpost && !this._persistCareerVeteranOutpostCheckpoint({ immediate: true })) {
        this._showCareerOutpostSaveRetry(result)
        return
      }
      if (!campaign.careerVeteranOutpost && this.personalSquad && !this._persistPersonalOutpost(true)) { this._showCareerOutpostSaveRetry(result); return }
      const fresh = this.careerStore.loadChecked().profile
      if (!fresh) { this._showCareerOutpostSaveRetry(result); return }
      const claim = campaign.careerVeteranOutpost
        ? claimCareerMission(fresh, campaign.careerMissionId, result === 'victory' ? 'victory' : 'failure', stats.player, stats.meritPlayer)
        : claimCareerOutpost(fresh, campaign.careerMissionId, result, stats)
      if (!this.careerStore.save(claim.profile)) { this._showCareerOutpostSaveRetry(result); return }
      this.careerProfile = claim.profile
      this.careerMeritAwarded = campaign.careerVeteranOutpost
        ? claim.profile.activeMission?.result?.merit.total ?? 0
        : claim.profile.outpostBattleRecords?.find(record => record.id === campaign.careerMissionId)?.merit.total ?? 0
    }
    if (this.defenseCampaignRuntime?.getSnapshot().battleFinished) this.careerOutpostDefenseGuide?.hide()
    this.defenseCampaignHud.showResult(
      result,
      () => {
        window.location.reload()
      },
      () => campaign?.careerMissionId ? this._returnToCareerTown() : this._returnToHome(),
      allowObserve,
      onNext,
      stats,
      campaign?.commandGrouping === 'squad',
    )
  }

  private _showCareerOutpostSaveRetry(result: 'victory' | 'defeat'): void {
    if (document.pointerLockElement) document.exitPointerLock()
    const modal = document.createElement('div'); modal.id = 'campaign-result-modal'
    const card = document.createElement('div'); card.className = 'campaign-result-card'
    const message = document.createElement('p'); message.textContent = 'Career 結算尚未保存，請重試。'
    const retry = document.createElement('button'); retry.textContent = '重試保存軍功'
    retry.onclick = () => { modal.remove(); this._showDefenseCampaignResult(result) }
    card.append(message, retry); modal.append(card); document.body.append(modal)
  }

  private _returnToCareerTown(): void {
    if (!this._flushCareerSkillProgression()) { this._showNotify('無法保存技能進度，請重試'); return }
    const profile = this.careerStore.loadChecked().profile
    const next = this.defenseCampaignConfig?.careerVeteranOutpost
      ? profile?.activeMission ? clearCareerMission(profile, this.defenseCampaignConfig.careerVeteranOutpost.missionId) : profile
      : profile ? clearCareerOutpost(profile) : null
    if (!next || !this.careerStore.save(next)) { this._showNotify('無法保存返回狀態，請重試'); return }
    this.personalSquad?.endMission(true)
    this._disposeCareerOutpostBattleActors()
    window.removeEventListener('pagehide', this.flushVeteranOutpostOnPageHide)
    window.removeEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    window.removeEventListener('pagehide', this.flushPersonalOutpostOnPageHide)
    sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
    sessionStorage.removeItem('sagaburst_campaign_config')
    sessionStorage.removeItem('sagaburst_battle_config')
    sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    window.location.href = window.location.pathname
  }

  private _disposeCareerOutpostBattleActors(): void {
    this.spawningStopped = true
    for (const batch of this.spawnBatches) batch.cancel()
    this.personalSquad?.cleanup()
    for (const npc of this.npcs) { this._aimTargetRegistry?.unregisterNpc?.(npc); npc.dispose() }
    for (const mount of this.mounts) { this._aimTargetRegistry?.unregisterMount?.(mount); mount.dispose() }
    this.battleStats?.dispose?.()
    this.npcs.length = 0
    this.mounts.length = 0
    this.campaignSpawnQueue = []
    this.campaignSpawnWave = null
    this.veteranOutpostMarch = null
    this.veteranReinforcementMarch = null
    this.careerOutpostDefenseGuide?.dispose()
    this.careerOutpostDefenseGuide = null
    this.careerVeteranActorMounts.clear()
    this.defenseCampaignHud?.destroy()
  }

  private _returnToNextDefenseCampaignSetup(): void {
    const campaign = this.defenseCampaignConfig
    if (!campaign || campaign.stageId >= 9) return

    if (document.pointerLockElement) {
      document.exitPointerLock()
    }

    try {
      sessionStorage.removeItem('sagaburst_campaign_config')
      sessionStorage.removeItem('sagaburst_battle_config')
      sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
      sessionStorage.setItem(
        DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY,
        JSON.stringify({
          defenderFaction: campaign.defenderFaction,
          stageId: campaign.stageId + 1,
        }),
      )
    } catch (error) {
      console.warn('Failed to store next campaign setup target:', error)
    }

    window.location.href = window.location.pathname
  }

  private _returnToHome(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    try {
      sessionStorage.removeItem('sagaburst_campaign_config')
      sessionStorage.removeItem('sagaburst_battle_config')
    } catch (error) {
      console.warn('Failed to clear launch session state:', error)
    }
    window.location.href = window.location.pathname
  }

  private _updateDefenseCampaign(dt: number): void {
    const campaign = this.defenseCampaignConfig
    const runtime = this.defenseCampaignRuntime
    const hud = this.defenseCampaignHud
    if (!campaign || !runtime || !hud) return

    this.reliefMarch?.update()
    this.veteranOutpostMarch?.update()
    this.veteranReinforcementMarch?.update()

    const veteranOutpost = campaign.careerVeteranOutpost
    const isVeteranAssault = veteranOutpost?.templateId === 'veteran-outpost-assault'
    // The result runtime is Player-relative; Veteran IV reverses the fort's physical roles.
    const enemySideFaction = isVeteranAssault
      ? veteranOutpost.outpostFaction
      : opposingCampaignFaction(campaign.defenderFaction)
    const playerSideFaction = isVeteranAssault ? veteranOutpost.playerFaction : campaign.defenderFaction
    const originalDefendersAlive = this.campaignOriginalDefenders.filter(
      npc => !npc.dead,
    ).length
    let pendingReinforcements = 0
    if (this.campaignSpawnWave === 'reinforcement') {
      const mission = this.careerProfile?.activeMission
      const deadFriendlyActorIds = new Set(mission?.deadFriendlyActorIds ?? [])
      for (let index = this.campaignSpawnQueueIndex; index < this.campaignSpawnQueue.length; index++) {
        const actorId = this.campaignSpawnQueue[index].actorId
        if (!actorId || (!deadFriendlyActorIds.has(actorId) && (mission?.actorHealth?.[actorId]?.hp ?? 1) > 0)) pendingReinforcements++
      }
    }
    const playerSideAliveBefore = this._campaignFactionAlive(playerSideFaction) + pendingReinforcements
    const enemySideAliveBefore = this._campaignFactionAlive(enemySideFaction)
    const pendingAttackers = this.campaignSpawnWave === 'attackers'
      ? Math.max(0, this.campaignSpawnQueue.length - this.campaignSpawnQueueIndex)
      : 0

    const events = runtime.update(dt, {
      playerDead: this.player.dead,
      originalDefendersAlive,
      defendersAlive: playerSideAliveBefore,
      personalPlayerSideAlive: this.personalSquad?.aliveCombatants ?? 0,
      // The assault wave is frame-spawned. Pending attackers still count as
      // remaining enemies so a temporary zero on the field cannot end the battle.
      attackersAlive: enemySideAliveBefore + pendingAttackers,
      reinforcementSpawned: veteranOutpost?.templateId === 'veteran-dread-outpost'
        ? this.campaignReinforcementArrived
        : this.campaignReinforcementSpawned,
      reinforcementActive: this.campaignSpawnWave === 'reinforcement' || this.campaignReinforcementSpawned,
    })

    for (const event of events) {
      if (event === 'assault_started') {
        const queued = this._queueDefenseCampaignWave('attackers')
        this._showNotify(`⚔️ 敵軍開始進攻：${queued} 人進場中`, 3000)
      } else if (event === 'reinforcement_due') {
        const queued = this._queueDefenseCampaignWave('reinforcement')
        if (veteranOutpost?.templateId === 'veteran-dread-outpost') {
          this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
          this._showNotify(`🐎 第 90 秒援軍開始進場：${queued} 名騎兵`, 3500)
        } else {
          this.soundManager.playCommanderCommand(campaign.defenderFaction, 'attack')
          this._showNotify(`🐎 援軍開始抵達：${queued} 名刀騎兵`, 3500)
        }
      } else if (event === 'defeat') {
        this._showDefenseCampaignResult('defeat', true)
      } else if (event === 'battle_victory') {
        if (!campaign.careerMissionId) completeDefenseCampaignStage(campaign.defenderFaction, campaign.stageId)
        if (this.campaignSpawnWave === 'reinforcement') {
          this.campaignSpawnBatch?.cancel()
          this.campaignSpawnQueue = []
          this.campaignSpawnQueueIndex = 0
          this.campaignSpawnWave = null
        }
        if (veteranOutpost) this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
        this._showDefenseCampaignResult('victory')
      } else if (event === 'battle_defeat') {
        if (veteranOutpost) this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
        this._showDefenseCampaignResult('defeat')
      }
    }

    const playerSideAlive = this._campaignFactionAlive(playerSideFaction)
    const enemySideAlive = this._campaignFactionAlive(enemySideFaction)
    hud.updateGate(
      this.previewCampaignGate?.state ?? 'destroyed',
      this.campaignAttackersStarted,
      defenseCampaignCapabilities(campaign).gateControlEnabled && !this.player.dead && this.controlMode !== 'spectator',
    )
    hud.update(
      runtime.getSnapshot(),
      playerSideAlive,
      enemySideAlive,
      playerSideFaction,
      veteranOutpost?.templateId === 'veteran-dread-outpost'
        ? this.campaignReinforcementArrived
        : this.campaignReinforcementSpawned,
    )

    if (this.careerOutpostDefenseGuide && (veteranOutpost?.templateId === 'veteran-dread-outpost' || campaign.careerMissionKind === 'outpost-defense')) {
      if (this.controlMode === 'spectator' || runtime.getSnapshot().battleFinished) {
        this.careerOutpostDefenseGuide.hide()
      } else {
        const placement = getCampaignOutpostPlacement(veteranOutpost?.outpostFaction ?? campaign.defenderFaction)
        const inward = Math.sign(placement.backZ - placement.frontZ)
        const rallyPoint = new THREE.Vector3(placement.centerX, 0, placement.frontZ + inward * 10)
        const yaw = this.thirdPersonCamera.cameraYaw
        const phase = this.careerProfile?.activeMission?.phase
          ?? (runtime.getSnapshot().activePhase === 'deployment' ? 'PREPARING' : 'ENGAGING')
        this.careerOutpostDefenseGuide.updateOutpostDefense(phase, this.player.position, yaw, rallyPoint, enemySideAlive)
      }
    }
    this.veteranOutpostCheckpoint?.advance(dt)
    this._persistCareerVeteranOutpostCheckpoint({ immediate: false, periodic: true })
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

  private _toggleCampaignGate(): void {
    if (!defenseCampaignCapabilities(this.defenseCampaignConfig ?? undefined).gateControlEnabled) return
    const gate = this.previewCampaignGate
    if (!gate || this.player.dead || this.controlMode === 'spectator'
      || this.equipmentUI.visible) return
    if (this.defenseCampaignConfig && !this.campaignAttackersStarted) {
      this._showNotify('🚪 部署中：敵軍開始進場後可按 G 開門')
      return
    }
    if (gate.state === 'destroyed') {
      this._showNotify('🚪 營門已損毀')
      return
    }
    const actorPositions: THREE.Vector3[] = [this.player.combatPosition]
    for (const npc of this.npcs) {
      if (!npc.dead) actorPositions.push(npc.combatPosition)
    }
    for (const mount of this.mounts) {
      if (!mount.dead) actorPositions.push(mount.group.position)
    }
    const occupied = gate.state === 'open'
      && isCampaignGateOccupied(gate.collisionBox, actorPositions)
    const changed = gate.toggle(occupied)
    this._showNotify(!changed && occupied
      ? '🚪 門口有人或馬，無法關門'
      : gate.state === 'open' ? '🚪 營門已開啟 · G 關門' : '🚪 營門已關閉 · G 開門')
  }

  // ── Keyboard Shortcuts ──
  private _setupShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (this.previewCampaignGate && e.code === 'KeyG'
        && (this.defenseCampaignConfig || import.meta.env.DEV)) {
        e.preventDefault()
        if (!e.repeat) this._toggleCampaignGate()
        return
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
        if (this.equipmentUI.visible) {
          e.preventDefault()
          this.equipmentUI.close()
          this.input.requestPointerLock()
        }
      }
    })
  }

  private _scheduleCareerSkillProgressionFlush(): void {
    if (!this.careerProfile || !this.careerSkillsDirty || this.careerSkillSaveTimer !== null) return
    this.careerSkillSaveTimer = window.setTimeout(() => {
      this.careerSkillSaveTimer = null
      this._flushCareerSkillProgression()
    }, 600)
  }

  private _flushCareerSkillProgression(): boolean {
    if (this.careerSkillSaveTimer !== null) {
      clearTimeout(this.careerSkillSaveTimer)
      this.careerSkillSaveTimer = null
    }
    if (!this.careerProfile || !this.careerSkillsDirty) return true

    const fresh = this.careerStore.loadChecked().profile ?? this.careerProfile
    const next = cloneCareerProfile(fresh)
    next.skills = this.skillManager.skillState
    if (!this.careerStore.save(next)) return false

    this.careerProfile = next
    this.careerSkillsDirty = false
    return true
  }

  private _awardPlayerSkillXpFromEvent(event: CombatEvent): void {
    const meleeWeapon = event.type === 'damage_applied' && event.weaponId
      ? WEAPONS[event.weaponId] ?? this.inventoryManager.equippedMelee
      : this.inventoryManager.equippedMelee
    const award = resolveActivePlayerSkillProgressionAward(
      event,
      {
        dead: this.player.dead,
        spectatorOnly: this.player.spectatorOnly,
        observer: this.controlMode !== 'player',
      },
      meleeWeapon,
      this.player.hasShield,
    )
    if (!award) return

    this._applyPlayerSkillAward(award)
  }

  private _applyPlayerSkillAward(award: import('./rpg/CombatSkillProgression').SkillProgressionAward): void {
    if (this.player.dead || this.player.spectatorOnly || this.controlMode !== 'player') return

    const before = this.skillManager.skillState
    const levelsGained = this.skillManager.addXp(award.skill, award.xp, this.soundManager)
    const after = this.skillManager.skillState
    this.player.blockingLevel = after.blocking.level
    if (skillStatesEqual(before, after)) return

    if (this.careerProfile) {
      const next = cloneCareerProfile(this.careerProfile)
      next.skills = after
      this.careerProfile = next
      this.careerSkillsDirty = true
      if (levelsGained > 0) this._flushCareerSkillProgression()
      else this._scheduleCareerSkillProgressionFlush()
    }

    if (levelsGained > 0) {
      const oldHp = this.player.hp
      const newMaxHp = this.careerProfile
        ? resolveCareerPlayerMaxHp(this.careerProfile, this.basePlayerMaxHp)
        : resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, after)
      this.player.setMaxHp(newMaxHp, false)
      this.player.setHp(Math.min(newMaxHp, oldHp + levelsGained))
      this.hpBar.setFill(this.player.hpRatio)
    }
  }

  _saveGame(): void {
    if (this.defenseCampaignConfig?.careerMissionId) return
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
        twoHanded: skills.twoHanded,
        ranged: skills.ranged,
        mountedImpact: skills.mountedImpact,
        blocking: skills.blocking,
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

  _loadGame(): void {
    if (this.defenseCampaignConfig?.careerMissionId) return
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
    this.player.setArrowCount(data.arrows ?? 30)

    if (data.skills) {
      this.skillManager.setSkillState(data.skills)
    }
    this.player.blockingLevel = this.skillManager.skillState.blocking.level
    this.player.setMaxHp(resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, this.skillManager.skillState), false)
    this.player.setHp(data.hp ?? this.player.maxHp)
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

  private _updateMountHud(): void {
    const mount = this.player.isMounted ? this.player.currentMount : null
    const visible = Boolean(mount && !mount.dead && !this.player.dead && this.controlMode === 'player')
    this.mountHud.classList.toggle('visible', visible)
    if (visible && mount) {
      this.mountNameEl.textContent = `坐騎：${mount.displayName}`
      this.mountHpFill.style.width = `${Math.max(0, mount.currentHp / mount.maxHp * 100)}%`
    }
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
    this.careerOutpostDefenseGuide?.hide()
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

  private _tryDamageObstacleWithMelee(
    gripPosition: THREE.Vector3,
    tipPosition: THREE.Vector3,
    damage: number,
  ): boolean {
    const direction = this._tmpMeleeObstacleDirection.subVectors(tipPosition, gripPosition)
    const segmentLength = direction.length()
    if (segmentLength < 1e-6) return false
    direction.multiplyScalar(1 / segmentLength)
    this._tmpMeleeObstacleRay.set(gripPosition, direction)

    for (const obstacle of this.obstacles) {
      const damageable = obstacle.damageable
      if (
        !damageable
        || damageable.destroyed
        || !damageable.isDamageableBy(this.player.characterFaction)
      ) {
        continue
      }

      this._tmpMeleeObstacleBox.copy(obstacle.box).expandByScalar(0.45)
      const hitPoint = this._tmpMeleeObstacleRay.intersectBox(
        this._tmpMeleeObstacleBox,
        this._tmpMeleeObstacleHitPoint,
      )
      if (!hitPoint || hitPoint.distanceTo(gripPosition) > segmentLength) continue

      const result = damageObstacle(damageable, damage, {
        source: createPlayerCombatActorRef(this.player),
        method: 'melee',
        weaponId: this.inventoryManager.equippedMelee.id,
        emit: this.combatEvents.emit,
      })
      if (result.appliedDamage <= 0) continue

      this.player.markHitProcessed()
      this.damageNumbers.spawn(Math.round(result.appliedDamage), hitPoint.clone())
      this._showEnemyHud(damageable.displayName, result.hpRatio)
      return true
    }

    return false
  }

  // ── Melee Combat Hit Detection (Player Sword -> Enemies / Damageable Obstacles) ──
  private _checkPlayerMeleeHits(): void {
    if (this.player.dead || this.controlMode === 'spectator' || this.player.spectatorOnly) return
    const equippedMelee = this.inventoryManager.equippedMelee
    if (!this.player.isHitFrame(equippedMelee)) {
      if (this.player.isLanceThrustActive) {
        this.player.updatePrevLanceTip()
      }
      return
    }

    const combatKind = equippedMelee.combatKind ?? (equippedMelee.isLance ? 'lance' : 'sword')
    const { damage, isCharge } = calculatePlayerMeleeDamage({
      baseDamage: equippedMelee.damageMax,
      combatKind,
      isLance: equippedMelee.isLance === true,
      isMounted: this.player.isMounted,
      mountSpeed: this.player.currentMount?.movementSpeed ?? 0,
      oneHandedMultiplier: this.skillManager.getMultiplier(
        resolveCombatSkill('melee', equippedMelee, this.player.hasShield)!,
      ),
      faction: this.player.characterFaction,
      hasShield: this.player.hasShield,
      heroAssetId: this.player.heroAssetId ?? undefined,
    })

    const targets = this.npcGrid.getNearbyInto(this.player.combatPosition, 8, this._nearbyNpcBuffer)
      .filter(npc => !npc.dead && npc.faction === Faction.ENEMY)
    const mounts = this.combatMountGrid.getNearbyInto(this.player.combatPosition, 8, this.meleeMountCandidates)
    const contact = this.player.weaponSweep.traceFirst(targets, mounts, this.player.currentMount)
    if (contact) {
      this.player.markHitProcessed()
      const target = contact.target as NPC | Mount
      const cavalryTarget = contact.kind === 'mount' || target.isMounted
      const finalDamage = Math.round(damage * getAntiCavalryMultiplier(combatKind, this.player.isMounted, cavalryTarget))
      const context = { contact, source: createPlayerCombatActorRef(this.player), method: 'melee' as const,
        weaponId: equippedMelee.id, emit: this.combatEvents.emit }
      const result = contact.kind === 'mount' && contact.mount
        ? damageMount(contact.mount, finalDamage, context) : damageNpc(target as NPC, finalDamage, context)
      if (result.hitSuccess) {
        if (isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
        if (combatKind === 'lance') this.soundManager.playLanceImpact(0, true)
        else this.soundManager.playSwordHit(0, true)
        if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
        this._showEnemyHud(result.targetName, result.hpRatio)
      }
    } else {
      this._tryDamageObstacleWithMelee(this.player.getWeaponGripPosition(this._tmpGripPos), this.player.getSwordTipPosition(), damage)
    }
    if (combatKind === 'lance') this.player.updatePrevLanceTip()
  }

  // ── World Pickup & Mount Interaction ──
  private _updateInteractions(dt: number): void {
    // Update Mounts and select a bounded set of audible gallop loops.
    const gallopCandidates: HorseGallopCandidate[] = []
    for (const mount of this.mounts) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      mount.update(dt, this.obstacles)
      gallopCandidates.push({
        id: mount,
        active: mount.type === MountType.HORSE
          && mount.state === MountState.CONTROLLED
          && mount.movementSpeed >= 10.5
          && !mount.dead,
        lod: mount.currentLod,
        distance: mount.group.position.distanceTo(this.camera.position),
        isPlayer: mount === this.player.currentMount,
      })
    }
    this.soundManager.updateHorseGallopLoops(gallopCandidates)

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
        closestPickup.destroy()
        
        const idx = this.pickups.indexOf(closestPickup)
        if (idx !== -1) this.pickups.splice(idx, 1)

      } else if (closestMount) {
        this._mountPlayer(closestMount)
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

    this._entityCollisionBroadPhase.resolve(bodies, this.obstacles)

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
    resolveMountImpacts(
      this.mounts,
      this.player,
      this.npcs,
      now,
      {
        npcGrid: this.npcGrid,
        candidateBuffer: this._impactCandidates,
        onDamagePlayer: (damage, context) => damagePlayer(
          this.player,
          damage,
          this.hpBar,
          this.inventoryManager.equippedShield?.id ?? null,
          context,
        ),
        combatEvents: this.combatEvents.emit,
        playerDamageMultiplier: this.skillManager.getMountedImpactMultiplier(),
        onPlayerMountHitNpcAudio: (_damage, attackerMount, npc, result) => {
          this.soundManager.playHorseImpact(attackerMount.currentLod, true)
          this._tmpHitPos.copy(npc.combatPosition)
          this._tmpHitPos.y += 1.0
          this.damageNumbers.spawn(result.appliedDamage, this._tmpHitPos)
          this._showEnemyHud(result.targetName, result.hpRatio)
        },
        onEnemyMountHitPlayerAudio: (_damage, attackerMount, _result) => {
          this.soundManager.playHorseImpact(attackerMount.currentLod, true)
          this._updateMountHud()
        },
        onNpcMountHitNpc: (_damage, attackerMount) => {
          this.soundManager.playHorseImpact(attackerMount.currentLod, false)
        },
      }
    )
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
  private _loop = (frame: number): void => {
    if (this.spawningStopped) return
    requestAnimationFrame(this._loop)
    gameplayNpcSpawns.tick(frame)
    if (this.spawningStopped) return
    const profile = import.meta.env.DEV && this.isDevCombat
    const frameStart = profile ? performance.now() : 0
    let t0 = 0
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (this.heroMountTrialUI?.visible) {
      this.input.clear()
      this.renderer.render(this.scene, this.camera)
      return
    }

    if (import.meta.env.DEV && this._isSimulationFrozen) {
      if (profile) t0 = performance.now()
      this.renderer.render(this.scene, this.camera)
      const renderSubmitMs = profile ? performance.now() - t0 : 0

      if (profile) {
        const frameEnd = performance.now()
        const cpuFrameMs = frameEnd - frameStart
        const newSnapshot = this.runtimeProfiler.recordFrame({
          cpuFrameMs,
          npcGridMs: 0,
          npcUpdateMs: 0,
          mountInteractionMs: 0,
          collisionMs: 0,
          arrowMs: 0,
          impactMs: 0,
          renderSubmitMs,
          otherMs: Math.max(0, cpuFrameMs - renderSubmitMs),
        }, frameEnd)

        if (newSnapshot || !this.hasDevCombatRenderedInitialHud) {
          this._updateDevCombatStatus()
          this.hasDevCombatRenderedInitialHud = true
        }
      }
      return
    }

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
      this.thirdPersonCamera.update(this.input, dt, this.obstacles)
    }

    const currentYaw = this.controlMode === 'spectator'
      ? this.spectatorController.cameraYaw
      : this.thirdPersonCamera.cameraYaw

    const cameraAimPoint = this.isModelStudio
      ? this.camera.getWorldDirection(this._tmpCameraDir).multiplyScalar(100).add(this.camera.position)
      : this._getCameraAimPoint(this._tmpHitPos)
    this._debugAimPoint.copy(cameraAimPoint)

    if (!this.isModelStudio && !this.player.dead && this.controlMode === 'player' && !this.equipmentUI.visible) {
      this.armyCommandController.update()
    }
    this.weaponWheelUI.update(this.inventoryManager, !this.isModelStudio && !this.player.dead && this.controlMode === 'player' && !this.equipmentUI.visible, this.armyCommandController.wheelMode)

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
      this.skillManager.getRangedMultiplier()
    )

    this.personalSquad?.updateLifecycle()
    this._updateDefenseCampaign(dt)
    this.battleController?.update(this.npcs)

    // Keep A* topology in sync with destroyed/opened/closed world obstacles.
    // This is O(1) on stable frames and rebuilds only when the shared obstacle
    // collection changes.
    this.navigationWorld.sync(this.obstacles)
    this.navigationWorld.beginFrame()
    this.chaseTargetCoordinator.beginFrame()

    // 1. NPC Grid Build
    if (profile) t0 = performance.now()
    this.combatMountGrid.clear()
    for (const mount of this.mounts) if (!mount.dead && !mount.disposed) this.combatMountGrid.insert(mount)
    this.npcGrid.clear()
    for (const grid of Object.values(this.npcFactionGrids)) grid.clear()
    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue
      npc.combatMountGrid = this.combatMountGrid
      this.npcGrid.insert(npc)
      this.npcFactionGrids[npc.faction].insert(npc)
    }
    const npcGridMs = profile ? performance.now() - t0 : 0

    // 2. NPC Update
    if (profile) t0 = performance.now()
    let devQueriesCount = 0
    let devReturnedNeighborsCount = 0
    let npcLoopIndex = 0
    for (const npc of this.npcs) {
      // These root positions are world-space here, matching the mount LOD distance.
      const cameraDistance = npc.group.position.distanceTo(this.camera.position)

      // Cohort: does this NPC fall in the sampled slice this frame?
      const inCohort = import.meta.env.DEV && this._npcSubphaseEnabled
        && (npcLoopIndex % SUBPHASE_COHORT === this._subphaseFrameIndex % SUBPHASE_COHORT)
      const collector = inCohort ? this._npcSubphaseCollector : null
      if (inCohort && this._npcSubphaseCollector) this._npcSubphaseCollector.countSample()

      if (npc.hp <= 0) {
        // Dead NPCs still need animation update, but no AI/Boids
        npc.update(dt, this.player, this.npcs, Game._EMPTY_NPC_LIST, this.obstacles, this.hpBar, 
          () => {}, // dead npc can't hit
          () => {}, // dead npc can't shoot
          true, // skipBoidsAndObstacles
          cameraDistance,
          collector
        )
        npcLoopIndex++
        continue
      }
      if (npc.combatOwnership === 'player-personal' && this.defenseCampaignRuntime?.getSnapshot().activePhase === 'deployment') {
        npc.updateTownTravel(dt, cameraDistance, this.npcGrid.getNearbyInto(npc.combatPosition, 8, this._nearbyNpcBuffer), this.obstacles, this.navigationWorld)
        npcLoopIndex++
        continue
      }

      // No LOD tiers. Full update for everyone.
      const skipBoidsAndObstacles = false
      let nearbyNPCs = Game._EMPTY_NPC_LIST
      if (npc.currentState === AIState.CHASE) {
        // gridQuery subphase: measure the #45 CHASE-only nearby query.
        if (import.meta.env.DEV && inCohort && collector) {
          const _tGQ = performance.now()
          this.npcGrid.getNearbyInto(
            npc.combatPosition,
            NPC_NEIGHBOR_QUERY_RADIUS,
            this._nearbyNpcBuffer,
          )
          collector.endPhase('gridQuery', _tGQ)
        } else {
          this.npcGrid.getNearbyInto(
            npc.combatPosition,
            NPC_NEIGHBOR_QUERY_RADIUS,
            this._nearbyNpcBuffer,
          )
        }

        nearbyNPCs = this._nearbyNpcBuffer

        if (profile) {
          devQueriesCount++
          devReturnedNeighborsCount += this._nearbyNpcBuffer.length
        }
      }

      const hostileNpcGrid = npc.faction === Faction.PLAYER
        ? this.npcFactionGrids[Faction.ENEMY]
        : this.npcFactionGrids[Faction.PLAYER]

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
            const result = damagePlayer(
              this.player,
              damage,
              this.hpBar,
              this.inventoryManager.equippedShield?.id ?? null,
              {
                source: createNpcCombatActorRef(npc),
                method: 'melee',
                contact: npc.weaponSweep.contact,
                weaponId: npc.meleeWeaponId ?? undefined,
                emit: this.combatEvents.emit,
              },
            )
            if (result.hitSuccess) {
              if (npc.meleeCombatKind === 'lance') this.soundManager.playLanceImpact(npc.currentLod, true)
              else this.soundManager.playSwordHit(npc.currentLod, true)
              this._updateMountHud()
            }
          } else if (targetNpc) {
            const result = damageNpc(targetNpc, damage, {
              contact: npc.weaponSweep.contact,
              source: createNpcCombatActorRef(npc),
              method: 'melee',
              weaponId: npc.meleeWeaponId ?? undefined,
              emit: this.combatEvents.emit,
            })
            if (result.hitSuccess) {
              if (npc.meleeCombatKind === 'lance') this.soundManager.playLanceImpact(npc.currentLod, false)
              else this.soundManager.playSwordHit(npc.currentLod, false)
            }
          }
        },
        (origin, direction, visualKind) => {
          // Ranged Fire Callback
          const arrow = new ArrowProjectile(
            this.scene,
            origin,
            direction,
            npc.rangedProjectileSpeed, // Player and NPC share WeaponDatabase projectile speed
            npc.rangedDamage, // Arrow damage
            npc.faction,
            false,
            visualKind,
            {
              source: createNpcCombatActorRef(npc),
              weaponId: npc.rangedWeaponId,
              emit: this.combatEvents.emit,
            },
          )
          this.arrows.push(arrow)
          if (visualKind === 'arrow') this.soundManager.playBowRelease(npc.currentLod, false, cameraDistance)
        },
        skipBoidsAndObstacles,
        cameraDistance,
        collector,
        hostileNpcGrid,
        this.navigationWorld,
        this.chaseTargetCoordinator,
      )
      npcLoopIndex++
    }
    this.armyCommandController.postUpdate()
    const npcUpdateMs = profile ? performance.now() - t0 : 0
    if (profile) {
      this.devGridStats.queriesPerFrame = devQueriesCount
      this.devGridStats.returnedNeighborsAvg = devQueriesCount > 0 ? devReturnedNeighborsCount / devQueriesCount : 0
    }

    // Advance the 8-frame cohort window. Completed cohorts are accumulated
    // until RuntimeProfiler emits its matching reporting-window snapshot.
    if (import.meta.env.DEV && this._npcSubphaseEnabled && this._npcSubphaseCollector && this._npcSubphaseAggregator) {
      this._subphaseFrameIndex++
      const windowResult = this._npcSubphaseCollector.advanceFrame()
      if (windowResult !== null) {
        this._npcSubphaseAggregator.record(windowResult)
      }
    }

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

    // 5. Arrow / Projectile
    if (profile) t0 = performance.now()
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.update(dt, this.player, this.npcs, this.obstacles, (damage, hitPos, targetName, hpRatio, isPlayer, _npc, isMountHit) => {
        const impactLod = isPlayer
          ? (isMountHit && this.player.currentMount ? this.player.currentMount.currentLod : 0)
          : (_npc && isMountHit && _npc.mount ? _npc.mount.currentLod : _npc?.currentLod ?? 0)
        this.soundManager.playProjectileImpact(impactLod, arrow.isPlayerFired || isPlayer)
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
            addArcheryXp: () => {},
            updateMountHp: (ratio) => {
              this.mountHpFill.style.width = `${Math.max(0, ratio * 100)}%`
            },
            hideMountHud: () => {
              this.mountHud.classList.remove('visible')
            },
          },
        )
      },
      (damage, context) => damagePlayer(
        this.player,
        damage,
        this.hpBar,
        this.inventoryManager.equippedShield?.id ?? null,
        context,
      ),
      (damage, hitPos, obstacle, hpRatio) => {
        if (!arrow.isPlayerFired) return
        this.damageNumbers.spawn(Math.round(damage), hitPos)
        this._showEnemyHud(obstacle.displayName, hpRatio)
      },
      false, this.mounts,
    )

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }
    const arrowMs = profile ? performance.now() - t0 : 0

    // 6. Impact / Damage
    if (profile) t0 = performance.now()
    this._updateImpactDamage(this.clock.elapsedTime)
    this._persistPersonalOutpost(false, dt)
    const impactMs = profile ? performance.now() - t0 : 0

    // Reset impact flag after impact checks complete for this frame
    for (const mount of this.mounts) {
      mount.skipImpactThisFrame = false
    }

    // Update Floating Damage numbers
    this._updateMountHud()
    this.damageNumbers.update(dt, this.camera)

    this.combatTrajectoryDebugger?.update(this.player, this.npcs, this.arrows, this._debugAimPoint)

    // Seat the preview rider on this frame's animated saddle before drawing.
    if (this.isMountStudio) this._updateMountStudioStatus()
    else {
      this.player.fitCorgiSeat()
      for (const npc of this.npcs) npc.fitCorgiSeat()
    }

    // 7. Renderer Submit (measures synchronous CPU-side render submission, not GPU time)
    if (profile) t0 = performance.now()
    this.renderer.render(this.scene, this.camera)
    const renderSubmitMs = profile ? performance.now() - t0 : 0

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

      // Keep subphase and raw NPC Update snapshots on the same ~1-second
      // reporting window. A full 8-frame cohort is never split.
      if (newSnapshot && this._npcSubphaseEnabled && this._npcSubphaseAggregator) {
        const subphaseSnapshot = this._npcSubphaseAggregator.flush()
        if (subphaseSnapshot) this.runtimeProfiler.setNpcSubphaseSnapshot(subphaseSnapshot)
      }

      if (newSnapshot || !this.hasDevCombatRenderedInitialHud) {
        this._updateDevCombatStatus()
        this.hasDevCombatRenderedInitialHud = true
      }
    }
  }

  /** DEV benchmark hook: reset subphase state with RuntimeProfiler's window. */
  resetNpcSubphaseProfiling(): void {
    this._npcSubphaseCollector?.reset()
    this._npcSubphaseAggregator?.reset()
    this._subphaseFrameIndex = 0
  }
}
