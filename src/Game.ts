import { playAppliedPunchHit } from './audio/SoundManager'
import { traceFistStrike, unarmedDamage } from './combat/UnarmedCombat'
import { getOrdinarySoldierHp, resolveOrdinaryPlayerBaseHp, resolveOrdinarySoldierTier } from './combat/OrdinarySoldierProfile'
import { CareerCommandHudTypes } from './career/CareerCommandHudTypes'
import { officialCommandHudLabel } from './career/CommanderTownSquadLabels'
import { stageMissionReturnRebuild } from './career/CareerMissionReturnRecovery'
import { markCareerMissionReturnToSergeant } from './town/SergeantReturn'
import { townRoster } from './town/TownRules'
import { CareerBridgeBattleRuntime, careerFelineHeroAssetIds, careerFieldTacticalOrder, clearCareerBridgeBattle, commitCareerBridgeBattleResult, createCareerBridgeSpawnPlan, createCareerBridgeOrphanMountPlan, createCareerFelineSpawnPlan, createCareerFelineOrphanMountPlan, dispatchFelineVanguardCharge, isCareerBridgeBattle, isCareerFelineBattle, shouldTriggerFelineVanguardCharge, validateFelineDeploymentReadiness, type CareerBridgeBattleLaunch } from './career/CareerBridgeBattle'
import { prepareByzantineEquipment, preloadHighTierEquipment } from './world/HighTierEquipment'
import { outpostCheckpointHeight } from './campaign/OutpostRampartGarrison'
import { CampaignSiegeAssault } from './campaign/CampaignSiegeAssault'
import { getSiegeApproachClearances, isMobileSiegeRampEnabled, isSiegeRampCrewCandidate } from './campaign/MobileSiegeRampPolicy'
import { refitTownCommandForSceneChange } from './career/SquadRefit'
import { preloadPaladinEquipment } from './world/PaladinEquipment'
import { playerEagleProjectileBudget } from './combat/ProjectileBallistics'
import { AerialViewPolicy, usesAerialView } from './camera/AerialViewPolicy'
import { findEagleLandingPosition } from './world/EagleLanding'
import { captureCareerAerialState, restoreCareerAerialState } from './career/CareerAerialState'
import { assertNpcSpawnJob, gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch } from './world/NpcSpawnScheduler'
/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { CorgiVisual } from './world/CorgiVisual'
import { careerHeavyPreloadPlan } from './career/HeavyCavalrySpawn'
import { COMMANDER_IRON_LEGION_ID } from './career/HeavyCavalryMissions'
import { createHeavyFieldDeployment, getHeavyFieldMissionDefinition, isCareerHeavyFieldBattle, type HeavyFieldDeployment } from './career/HeavyFieldMission'
import { createCareerFieldCheckpointSeed, createCareerFieldDeployment, FIELD_BANDIT_DETECTION_RANGE, FIELD_SWEEP_CHARGE_DISTANCE, findVeteranSquadsInRange, isCareerFieldNoCommandMission, isMigratedCareerFieldMission, isMigratedFieldDeploymentReady, resolveFieldActorCheckpoint, resolveFieldDamagedTargetId, resolveMigratedPlayerMountState, shouldTriggerSweepAlert, type CareerFieldDeployment } from './career/CareerFieldBattle'
import { createCampfireVisual } from './world/EnvironmentVisuals'
import { createCaltropBarrier } from './world/CaltropBarrier'
import { HEAVY_FIELD_SPECS, VETERAN_IRON_TIDE_ID, heavyCommandPlan, isHeavyFormationComplete, heavyFrontlineDistance, planVeteranCaltropDefense, veteranCaltropWorldRects, shouldIssueHeavyFormation, shouldTriggerHeavyCounterCharge, shouldTriggerHeavyEnemyCharge, type HeavyPoint } from './career/HeavyCavalryMissions'
import { BlackCatVisual, FELINE_MOUNT_VARIANTS, type FelineMountVariant } from './world/BlackCatVisual'
import { SnowLeopardVisual } from './world/SnowLeopardVisual'
import { XongkoroVisual } from './world/XongkoroVisual'
import { XONGKORO } from './movement/XongkoroConfig'
import {
  createSky,
  getDirectionalShadowMapSize,
  resolveShadowMapSize,
  setDirectionalShadowMapSize,
} from './world/Sky'
import { createTerrain, getScenePlayableWorldBound, getTerrainHeight, resetTerrainScenePolicy, TERRAIN_TREE_POSITIONS, EntityCollisionBody, ObstacleData, resolveObstacleCollision } from './world/Terrain'
import { DamageableObstacle } from './world/DamageableObstacle'
import { TownWorld } from './town/TownWorld'
import { preloadArchitectureStatues } from './town/architecture/TownArchitecture'
import {
  createBridgePreviewSpawnPlan,
  createRiverCrossingBattlefield,
  getRiverCrossingTreeClearances,
  RIVER_CROSSING_LAYOUT,
  settleRiverCrossingDrowning,
} from './world/RiverCrossingBattlefield'
import { Player, DEFAULT_PLAYER_MAX_HP } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { CompassUI } from './ui/CompassUI'
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
import { SaveManager, restoreSavedPlayerHp, type PlayerSaveData } from './save/SaveManager'
import { StaminaBar } from './ui/StaminaBar'
import { HpBar } from './ui/HpBar'
import { NPC, Faction, AIState, AIType, NPC_NEIGHBOR_QUERY_RADIUS } from './world/NPC'
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
import { HERO_ASSETS, type HeroAssetId, type PlayerHeroId } from './world/HeroAssetCatalog'
import { T4_UNIT_PROFILES, HERO_COMBAT_PROFILE_BY_ASSET, getT4HeroCombatModifiers } from './battle/T4HeroCatalog'
import { preloadMakiRangerBow } from './world/MakiRangerEquipment'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from './rpg/WeaponDatabase'
import { normalizeArmyConfig } from './battle/BattleConfig'
import { getT5ProfileForPreset, t5EquipmentIdsForArmy } from './battle/T5HeroCatalog'
import { t4EquipmentIdsForArmy } from './battle/T4HeroCatalog'
import type { UnitPresetId } from './battle/UnitPresetCatalog'
import { BattleController } from './battle/BattleController'
import { SpatialGrid } from './world/SpatialGrid'
import { isPlayerHostileNpc, populateNpcFactionGrids, selectHostileNpcGrid } from './world/HostileNpcGrid'
import { EntityCollisionBroadPhase } from './world/EntityCollisionBroadPhase'
import { ArrowProjectile } from './world/ArrowProjectile'
import { DEFAULT_MOUNT_TYPE, Mount, MountState, MountType, mountTypeFromId, mountTypeFromSave, felineVariantFromMountId } from './world/Mount'
import { AimTargetRegistry, AIM_RAYCAST_LAYER } from './world/AimTargetRegistry'
import { CombatRenderWarmup } from './world/CombatRenderWarmup'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { SHIELD_CONFIG } from './combat/ShieldBlocking'
import { resolveActivePlayerSkillProgressionAward, resolveCombatSkill, resolveSkillAdjustedMaxHp, skillStatesEqual } from './rpg/CombatSkillProgression'
import { ArmyCommandUI } from './ui/ArmyCommandUI'
import { WeaponWheelUI } from './ui/WeaponWheelUI'
import { ArmyCommandController, type ArmyCommandAuthority } from './battle/ArmyCommandController'
import { ArmyCommandSelectionMarker } from './battle/ArmyCommandSelectionMarker'
import { matchesArmyCommandTarget } from './battle/CommandTarget'
import type { TacticalOrder } from './battle/TacticalOrder'
import { officialActorSquadId, officialCommandAcceptsActor, type OfficialCommandAuthority } from './career/CareerCommandAuthority'
import { officialPlayerOwnsActor, stageOfficialCommandOrder } from './career/CareerOfficialCommandOrder'
import { countArmyHudRoster } from './battle/ArmyCommandHudRoster'
import { careerCommandHudRoster } from './career/CareerCommandHudRoster'
import type { PersonalSquadMission } from './career/CareerPersonalSquadMission'
import { officialFollowLocalOffset } from './battle/FollowOrder'
import { FormationController, type FormationCommandAssignment } from './battle/FormationController'
import {
  createCampaignOutpost,
  getCampaignDefenderFacingYaw,
  getCampaignOutpostPlacement,
} from './campaign/CampaignOutpost'
import { getOutpostWalkwayLayout, isOutpostWalkwayEnabled } from './campaign/CampaignOutpostWalkways'
import { resolveDefenseCampaignAttackerDeployment } from './campaign/DefenseCampaignDeployment'
import {
  applyCampaignBreachOrders,
  restoreCampaignBreachCheckpoint,
  isCampaignGateOccupied,
  reconcileCampaignGateSiege,
  type CampaignBreachController,
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
import { personalOutpostDeployment, personalRearDeployment } from './career/PersonalSquadDeployment'
import { planPersonalOutpostGround } from './career/PersonalOutpostGroundPlan'
import { careerOutpostCommandMeritPolicy } from './career/CareerOutpostMission'
import { careerOutpostActorId } from './career/CareerOutpostRoster'
import { claimCareerFieldResult, beginPrisonBreak } from './career/CareerPrisonBreak'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, type CareerMountId, type CareerProfile } from './career/CareerProfile'
import { CareerMissionCheckpoint, type CareerMissionCheckpointReason } from './career/CareerMissionCheckpoint'
import type { ActiveCareerMission, BridgeBattleDeployment } from './career/CareerMissionState'
import { createBridgeheadRoster } from './career/CommanderMissionCatalog'
import { createCaptainFrontlineSpawnPlan, createCaptainEagleSpawnPlan, applyCaptainFrontlineEnemyHeroes, captainFrontlineEnemyHeroAsset } from './career/CaptainBattleLaunch'
import { CAPTAIN_FRONTLINE_COMMAND_ID, CAPTAIN_EAGLE_BATTLE_ID } from './career/CaptainMissionCatalog'
import { snapshotCommandActor, restoreCommandActor } from './career/CareerCommandActorCheckpoint'
import { snapshotCheckpointMount, snapshotCheckpointPlayer, type CaptainEagleCheckpoint } from './career/CaptainEagleCheckpoint'
import { CaptainEagleHUD } from './ui/CaptainEagleHUD'
import {
  careerVeteranOutpostOwner,
  createCareerVeteranOutpostReinforcementPlan,
  createCareerVeteranOutpostSpawnPlan,
} from './career/CareerVeteranOutpost'
import { createCareerCommanderOutpostSpawnPlan, remainingCommanderAttackers } from './career/CommanderOutpost'
import { MountedMissionMarchController, type MountedMissionSquad } from './career/MountedMissionMarch'
import { MissionGuide } from './career/MissionGuide'
import type { CampaignFaction } from './campaign/CampaignConfig'
import { acceptsCareerMissionStat, careerMissionCommandMeritPolicy } from './career/CareerMissionState'
import { TownEquipment } from './town/TownEquipment'
import { resolveCareerHeroAsset, resolveCareerOrdinaryTier, resolveCareerPlayerMaxHp } from './career/CareerPlayerProfile'
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
import { SoundManager, type HorseGallopCandidate } from './audio/SoundManager'
import { updateEagleWingbeatAudio } from './audio/EagleWingbeatAudio'
import { InventoryManager } from './rpg/InventoryManager'
import {
  COMBAT_BALANCE,
  getAntiCavalryMultiplier,
} from './combat/CombatBalance'
import { calculatePlayerMeleeDamage } from './combat/PlayerMeleeDamage'
import { WeaponPickup } from './world/WeaponPickup'
import { InteractionFocus, type InteractionCandidate } from './world/InteractionFocus'
import { PickupPrompt } from './ui/PickupPrompt'
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
import { damageMount, damageNpc, damageObstacle, damagePlayer, damageReceiver } from './combat/DamageRouter'
import { isDamageReceiver } from './combat/DamageReceiver'
import { TrainingGround } from './training/TrainingGround'
import { CareerTutorialScene } from './training/CareerTutorialScene'
import type { CareerTutorialLaunch } from './career/CareerTutorialLaunch'
import { createTrainingGroundPlan, createTrainingInventory } from './training/TrainingGroundPlan'
import { trainingDamageText } from './training/TrainingDamageDisplay'
import { TrainingGroundUI } from './ui/TrainingGroundUI'
import {
  CombatEventStream,
  createNpcCombatActorRef,
  createPlayerCombatActorRef,
  type CombatEvent,
} from './combat/CombatAttribution'
import { BattleStatsTracker, type BattleStatsSnapshot } from './combat/BattleStatsTracker'
import { CombatTrajectoryDebugger } from './debug/CombatTrajectoryDebugger'
import { ModelStudio, resolveModelStudioMode, type ModelStudioMode } from './debug/ModelStudio'
import { BATTLE_SCENE_MAX_PIXEL_RATIO, bindWindowResize, createSceneRenderer } from './rendering/SceneRenderer'
import type { GameplayBowQAPanel } from './debug/GameplayBowQAPanel'
import { commanderValidationHero } from './debug/CommanderValidation'
import { parseHeroBenchmarkQuery, createHeroBenchmarkScenario, configureHeroBenchmarkActors } from './debug/HeroBenchmark'
import { createHeroBenchmarkRecorder } from './debug/HeroBenchmarkRecorder'
import { HumanoidAssetRegistry } from './world/HumanoidAssetRegistry'
import {
  HorseAssetRegistry,
  horseVariantForStableKey,
  horseVariantFromSave,
} from './world/HorseAssetRegistry'

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
  /** Set by the Career launch entry after Game.create resolves. */
  onCareerDeploymentError?: (error: unknown) => void

  /** Prevent callbacks and pagehide saves from resurrecting a failed deployment. */
  abortCareerDeployment(): void {
    this.compass?.dispose()
    this.compass = undefined
    this.commandSelectionMarker?.dispose()
    this.commandSelectionMarker = undefined
    this.spawningStopped = true
    for (const batch of this.spawnBatches) batch.cancel()
    this.personalSquad?.cancelPendingSpawns()
    window.removeEventListener('pagehide', this.flushVeteranOutpostOnPageHide)
    window.removeEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    window.removeEventListener('pagehide', this.flushPersonalOutpostOnPageHide)
    window.removeEventListener('pagehide', this.flushCareerBattleOnPageHide)
    this.felineChargeUnsubscribe?.()
    this.felineChargeUnsubscribe = undefined
    this.sceneListeners.abort()
    this.input?.dispose()
  }

  static async create(
    container: HTMLElement,
    battleConfig?: BattleConfig,
    campaignConfig?: DefenseCampaignLaunchConfig,
    progress: (text: string) => void = () => {},
    trainingGround = false,
    bridgeLaunch?: CareerBridgeBattleLaunch,
    tutorialLaunch?: CareerTutorialLaunch,
  ): Promise<Game | GameplayBowQAPanel> {
    const query = new URLSearchParams(window.location.search)
    const activeProbe = getActiveRenderProbe(query)
    const perfNoShadow = activeProbe === 'no-shadow'
    const perfHalfResolution = activeProbe === 'half-resolution'

    const renderer = createSceneRenderer({
      maxPixelRatio: BATTLE_SCENE_MAX_PIXEL_RATIO,
      pixelRatioScale: perfHalfResolution ? 0.5 : 1,
      shadows: !perfNoShadow,
      toneMappingExposure: 1.16,
    })
    container.appendChild(renderer.domElement)

    const legacyQa = !trainingGround && import.meta.env.DEV && new URLSearchParams(window.location.search).has('legacyhumanoids')
    const personalProfile = bridgeLaunch || campaignConfig?.careerMissionId || battleConfig?.careerEagleMissionId || battleConfig?.careerFelineMissionId ? new CareerProfileStore().loadChecked().profile : undefined
    const heavyMission = personalProfile?.activeMission
    const heavyPreload = heavyMission ? careerHeavyPreloadPlan(heavyMission.templateId, personalProfile!.faction) : { heroAssets: [], equipmentIds: [] }
    const personalIds = new Set((personalProfile?.activeMission ?? personalProfile?.activeOutpostMission)?.personalSquad?.memberIds ?? [])
    const personalMembers = personalProfile?.personalSquad?.members.filter(member => personalIds.has(member.id)) ?? []
    let game: Game | undefined
    try {
      if (!trainingGround && import.meta.env.DEV && new URLSearchParams(window.location.search).has('devbowqa')) {
        await Promise.all([HumanoidAssetRegistry.preload(), preloadPaladinEquipment(), preloadHighTierEquipment()])
        const { GameplayBowQAPanel } = await import('./debug/GameplayBowQAPanel')
        return new GameplayBowQAPanel(renderer)
      }
      const usesPlayerT4Bow = (
        campaignConfig?.playerLoadout?.rangedWeaponId ?? battleConfig?.playerLoadout?.rangedWeaponId
      ) === T4_RANGER_BOW_RANGED_ID
      const savedInventory = !trainingGround ? new SaveManager().load().inventory : undefined
      const savedPlayerT4Bow = savedInventory?.equippedRangedId === T4_RANGER_BOW_RANGED_ID
        || Boolean(savedInventory?.items?.some(item => item.id === T4_RANGER_BOW_RANGED_ID && item.quantity > 0))
      const ownsCareerT4Bow = personalProfile?.ownedWeapons.includes(T4_RANGER_BOW_RANGED_ID) ?? false
      const usesPersonalT4Bow = personalMembers.some(member => member.type === 'ranger' || member.equipment?.ranged === T4_RANGER_BOW_RANGED_ID)
      const isFelineLaunch = Boolean(battleConfig?.careerFelineMissionId)
      const felineVariants = new Set<FelineMountVariant>(trainingGround ? FELINE_MOUNT_VARIANTS : ['black-cat'])
      if (battleConfig?.careerFelineMissionId) for (const variant of ['white-cat', 'orange-cat', 'serval', 'caracal'] as const) felineVariants.add(variant)
      const devModelFeline = felineVariantFromMountId(query.get('devmodels'))
      if (devModelFeline) felineVariants.add(devModelFeline)
      const queryMountFeline = felineVariantFromMountId(query.get('mount'))
      if (queryMountFeline) felineVariants.add(queryMountFeline)
      const battleMountFeline = felineVariantFromMountId(battleConfig?.playerLoadout?.mountId)
      if (battleMountFeline) felineVariants.add(battleMountFeline)
      const campaignMountFeline = felineVariantFromMountId(campaignConfig?.playerLoadout?.mountId)
      if (campaignMountFeline) felineVariants.add(campaignMountFeline)
      const personalSelectedFeline = felineVariantFromMountId(personalProfile?.selectedMountId)
      if (personalSelectedFeline) felineVariants.add(personalSelectedFeline)
      for (const member of personalMembers) {
        const memberFeline = felineVariantFromMountId(member.equipment?.mount)
        if (memberFeline) felineVariants.add(memberFeline)
      }
      if (!campaignConfig && battleConfig) {
        felineVariants.add('black-cat').add('white-cat').add('orange-cat').add('serval').add('caracal')
      }
      if (legacyQa) {
        await Promise.all([
          HorseAssetRegistry.preload(renderer),
          BlackCatVisual.preloadVariants(felineVariants),
          SnowLeopardVisual.preload(),
          CorgiVisual.preload(),
          ...(isFelineLaunch ? [preloadPaladinEquipment(), preloadHighTierEquipment()] : []),
          ...(isFelineLaunch || usesPlayerT4Bow || savedPlayerT4Bow || ownsCareerT4Bow || usesPersonalT4Bow ? [preloadMakiRangerBow()] : []),
        ])
        game = new Game(renderer, battleConfig, campaignConfig, progress, trainingGround, bridgeLaunch, tutorialLaunch)
        await game.initialization
        CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
        game.prepareInitialFrame()
        game.clock.start(); requestAnimationFrame(game._loop)
        return game
      }
      await Promise.all([prepareByzantineEquipment([...heavyPreload.equipmentIds, ...(battleConfig && !campaignConfig ? (['viking', 'roman'] as const).flatMap(faction => { const army = normalizeArmyConfig(battleConfig[faction], faction); return [...t5EquipmentIdsForArmy(army), ...t4EquipmentIdsForArmy(army)] }) : []), battleConfig?.playerLoadout?.meleeWeaponId, battleConfig?.playerLoadout?.shieldId, personalProfile?.equipment?.melee, personalProfile?.equipment?.shield, ...personalMembers.flatMap(member => { const { loadout } = personalMemberLoadout(member, personalProfile!.faction); return [loadout.meleeWeaponId, loadout.shieldId] })]), preloadPaladinEquipment(), preloadHighTierEquipment(), HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), BlackCatVisual.preloadVariants(felineVariants), SnowLeopardVisual.preload(), CorgiVisual.preload(), XongkoroVisual.preload()])
      const heroAssets = new Set<HeroAssetId>()
      if (trainingGround) heroAssets.add('maki-archer-t4')
      const validationHero = import.meta.env.DEV && trainingGround ? commanderValidationHero(query) : undefined
      if (validationHero) heroAssets.add(validationHero)
      const benchmarkSettings = import.meta.env.DEV && !trainingGround ? parseHeroBenchmarkQuery(query) : null
      if (benchmarkSettings) heroAssets.add(createHeroBenchmarkScenario(benchmarkSettings).assetId)
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
      if (campaignConfig?.careerCommanderOutpost) {
        for (const spec of [...createCareerCommanderOutpostSpawnPlan(campaignConfig).npcSpecs,
          ...createCareerCommanderOutpostSpawnPlan(campaignConfig, 'attackers').npcSpecs]) {
          if (spec.visualAssetId) heroAssets.add(spec.visualAssetId)
        }
      }
      if (bridgeLaunch && personalProfile) {
        const roster = createBridgeheadRoster(personalProfile.activeMission!, personalProfile.faction)
        for (const spec of [...roster.friendly, ...roster.enemy]) {
          if (spec.visualAssetId) heroAssets.add(spec.visualAssetId)
        }
      }
      if (battleConfig?.careerFelineMissionId && personalProfile) {
        for (const assetId of careerFelineHeroAssetIds(personalProfile)) heroAssets.add(assetId)
      }
      for (const assetId of heavyPreload.heroAssets) heroAssets.add(assetId)
      if (campaignConfig?.careerMissionKind === 'captain-outpost-defense') heroAssets.add(captainFrontlineEnemyHeroAsset(campaignConfig.defenderFaction))
      const playerHeroId = campaignConfig?.playerHeroId ?? battleConfig?.playerHeroId
      if (playerHeroId) heroAssets.add(playerHeroId)
      const heroBattleConfigs = campaignConfig && !campaignConfig.careerVeteranOutpost && !campaignConfig.careerCommanderOutpost
        ? [createDefenseCampaignWaveConfig(campaignConfig, 'defenders'), createDefenseCampaignWaveConfig(campaignConfig, 'attackers')]
        : !campaignConfig && battleConfig ? [battleConfig] : []
      for (const config of heroBattleConfigs) {
        for (const faction of ['viking', 'roman'] as const) {
          for (const [presetId, counts] of Object.entries(normalizeArmyConfig(config[faction], faction))) {
            if ((counts[4] ?? 0) > 0) heroAssets.add(T4_UNIT_PROFILES[presetId as keyof typeof T4_UNIT_PROFILES].visualAssetId)
            if ((counts[5] ?? 0) > 0) heroAssets.add(getT5ProfileForPreset(presetId as UnitPresetId, faction).visualAssetId)
          }
        }
      }
      await Promise.all([
        ...[...heroAssets].map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor)),
        ...(isFelineLaunch || heroAssets.has('maki-archer-t4') || usesPlayerT4Bow || savedPlayerT4Bow || ownsCareerT4Bow || usesPersonalT4Bow ? [preloadMakiRangerBow()] : []),
      ])
      game = new Game(renderer, battleConfig, campaignConfig, progress, trainingGround, bridgeLaunch, tutorialLaunch)
      await game.initialization
      CombatRenderWarmup.warmup(renderer, game.camera, game.scene)
      game.prepareInitialFrame()
      game.clock.start(); requestAnimationFrame(game._loop)
      return game
    } catch (error) {
      if (tutorialLaunch && game) {
        game.abortCareerDeployment()
        game.tutorialScene?.dispose()
        game.trainingDamageUnsubscribe?.()
        game.trainingUI?.dispose()
        game.equipmentUI?.close()
      }
      game?.compass?.dispose()
      if (game) game.compass = undefined
      renderer.dispose()
      renderer.domElement.remove()
      throw error
    }
  }

  private scene!: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private readonly aerialView = new AerialViewPolicy()
  private camera!: THREE.PerspectiveCamera
  private compass?: CompassUI
  private clock!: THREE.Clock

  private input!: PlayerInput
  private player!: Player
  private basePlayerMaxHp: number = DEFAULT_PLAYER_MAX_HP
  private playerMaxHpOverride?: number
  private thirdPersonCamera!: ThirdPersonCamera
  private spectatorController!: SpectatorCameraController
  private controlMode: PlayerControlMode = 'player'
  private _spectatorReason: 'death' | 'initial' = 'death'

  get playerControlMode(): PlayerControlMode {
    return this.controlMode
  }
  get spectatorReason(): 'death' | 'initial' {
    return this._spectatorReason
  }
  private modelStudio: ModelStudio | null = null
  private get isModelStudio(): boolean {
    return this.modelStudio !== null
  }
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
  private tutorialScene?: CareerTutorialScene
  private tutorialFaction?: 'roman' | 'viking'
  private tutorialEquipmentMeleeId?: string
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
  private careerOriginalCommandSquads = new Map<NPC, NPC['squadId']>()
  private campaignReinforcementSpawned = false
  private campaignReinforcementArrived = false
  private campaignAttackersStarted = false
  private campaignSpawnQueue: NpcSpawnSpec[] = []
  private campaignSpawnQueueIndex = 0
  private campaignSpawnWave: 'attackers' | 'reinforcement' | null = null
  private commanderOutpostDeploymentBatch?: NpcSpawnBatch
  private commanderOutpostDeploymentTotal = 0
  private commanderOutpostDeploymentCheckpointed = false
  private careerOutpostTerminalResultPending?: 'victory' | 'defeat'
  private npcs: NPC[] = []
  private personalSquad?: PersonalSquadRuntime
  private personalCheckpointElapsed = 0
  private personalCriticalState = ''
  private careerResultStats?: BattleStatsSnapshot
  private bridgeRuntime?: CareerBridgeBattleRuntime
  private bridgeDeploymentRetrySeconds = 0
  private get fieldMissionId(): string | null { return this.bridgeLaunch?.careerMissionId ?? this.felineMissionId ?? this.captainEagleMissionId }
  /** Which saved checkpoint a field battle (Bridgehead, migrated field/Feline/Heavy, or Captain Eagle) reads and writes. */
  private get fieldCheckpointKey(): 'bridgeBattle' | 'felineBattle' | 'eagleBattle' {
    return this.bridgeLaunch ? 'bridgeBattle' : this.felineMissionId ? 'felineBattle' : 'eagleBattle'
  }
  private get fieldCheckpoint() { return this.careerProfile?.activeMission?.[this.fieldCheckpointKey] }
  /** The Career mount ID the player's own starting mount is saved under for this battle. */
  private get fieldPlayerMountId(): CareerMountId | undefined {
    return (this.captainEagleMissionId ? 'xongkoro'
      : this.felineMissionId ? this.startingHorseMountId ?? this.careerProfile?.selectedMountId
      : this.bridgeLaunch?.battle.playerLoadout?.mountId ?? this.defenseCampaignConfig?.playerLoadout.mountId) as CareerMountId | undefined
  }
  private readonly captainEagleMissionId: string | null
  private readonly felineMissionId: string | null
  private felineChargeUnsubscribe?: () => void
  /** Heavy-cavalry field battles (Soldier / Veteran / Captain): deployment plan and throttled trigger clock. */
  private heavyDeployment?: HeavyFieldDeployment
  private careerFieldDeployment?: CareerFieldDeployment
  private careerFieldCheckClock = 0
  private heavyCheckClock = 0
  private heavyFormationElapsed = 0
  /** Soldier and Veteran field battles give the player no command authority at all. */
  private get heavyNoCommand(): boolean {
    const mission = this.careerProfile?.activeMission
    return Boolean(mission && (isCareerHeavyFieldBattle(mission) || isCareerFieldNoCommandMission(mission)) && !mission.officialSquad && !mission.personalSquad)
  }
  private heavyGuide: MissionGuide | null = null
  private fieldRosterBatch?: NpcSpawnBatch
  private fieldBattleHud?: CaptainEagleHUD
  private fieldResultPending?: 'victory' | 'failure'
  private careerBattleCheckpoint?: CareerMissionCheckpoint
  private readonly flushCareerBattleOnPageHide = (): void => { this._persistCareerBattle(true) }
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
  private campaignSiegeAssault: CampaignSiegeAssault | null = null
  private previewCampaignGate: CampaignGateController | null = null
  private previewCampaignBreachController: CampaignBreachController | null = null
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
  private commandSelectionMarker?: ArmyCommandSelectionMarker
  private equipmentUI!: EquipmentUI
  private trainingGround: TrainingGround | null = null
  private trainingUI: TrainingGroundUI | null = null
  private trainingDamageUnsubscribe?: () => void
  private readonly sceneListeners = new AbortController()
  private soundManager!: SoundManager
  private inventoryManager!: InventoryManager
  private combatTrajectoryDebugger: CombatTrajectoryDebugger | null = null
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
  private startingHorseMountId?: string
  private loadedSaveMount: Mount | null = null

  // Enemy HUD elements
  private enemyHud!: HTMLElement
  private enemyNameEl!: HTMLElement
  private enemyHpFill!: HTMLElement
  private enemyHudTimer: number | null = null

  private mountHud!: HTMLElement
  private mountNameEl!: HTMLElement
  private mountHpFill!: HTMLElement

  private pickupHud!: PickupPrompt
  private readonly pickupFocus = new InteractionFocus<WeaponPickup | Mount>()
  private readonly customPickupPolicy: boolean
  private interactionInputCaptured = false

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
    const hit = intersections.find(hit => !this.player.currentMount?.aimColliders.some(collider => collider === hit.object))
    if (hit) return target.copy(hit.point)
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
  private readonly playerHostileNpcGrid = new SpatialGrid<NPC>(20)
  public readonly devGridStats = {
    queriesPerFrame: 0,
    returnedNeighborsAvg: 0,
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    battleConfig?: BattleConfig,
    campaignConfig?: DefenseCampaignLaunchConfig,
    progress: (text: string) => void = () => {},
    readonly isTrainingGround = false,
    private readonly bridgeLaunch?: CareerBridgeBattleLaunch,
    private readonly tutorialLaunch?: CareerTutorialLaunch,
  ) {
    this.renderer = renderer
    this.customPickupPolicy = Boolean(battleConfig && !campaignConfig && !bridgeLaunch && !battleConfig.careerEagleMissionId && !battleConfig.careerFelineMissionId && !tutorialLaunch && !isTrainingGround)
    if (isTrainingGround && (battleConfig || campaignConfig)) throw new Error('Training Ground cannot use a battle or Career launch')
    if (tutorialLaunch) {
      const profile = new CareerProfileStore().loadChecked().profile
      const session = profile?.tutorial?.session
      if (!session || session.id !== tutorialLaunch.sessionId || session.careerId !== tutorialLaunch.careerId
        || session.stage !== tutorialLaunch.stage || isTrainingGround !== (session.stage === 'recruit')
        || profile?.activeMission || profile?.activeOutpostMission || profile?.activeRace || profile?.careerRetirement
        || profile?.townEvent?.state === 'hostile' || campaignConfig || bridgeLaunch || battleConfig?.careerEagleMissionId || battleConfig?.careerFelineMissionId) {
        throw new Error('教學場景與保存的生涯 session 不符。')
      }
      this.tutorialFaction = profile.faction
    }
    this.defenseCampaignConfig = campaignConfig ?? null
    this.captainEagleMissionId = battleConfig?.careerEagleMissionId ?? null
    this.felineMissionId = battleConfig?.careerFelineMissionId ?? null
    if (campaignConfig?.careerMissionId || this.fieldMissionId) {
      this.careerProfile = this.careerStore.loadChecked().profile
      if (this.fieldMissionId || campaignConfig?.careerMissionKind === 'captain-outpost-defense') {
        const mission = this.careerProfile?.activeMission
        const expectedId = this.fieldMissionId ?? campaignConfig?.careerMissionId
        const heavyField = isCareerHeavyFieldBattle(mission) || isMigratedCareerFieldMission(mission)
        if (!mission || mission.id !== expectedId
          || !heavyField && (mission.officialSquad?.type !== 'mission-official' || mission.officialSquad.missionId !== mission.id)
          || heavyField && mission.officialSquad && (mission.officialSquad.type !== 'mission-official' || mission.officialSquad.missionId !== mission.id)
          || (this.bridgeLaunch
          ? !isCareerBridgeBattle(mission) || this.careerProfile?.rank !== 'commander'
          : this.felineMissionId
          ? !isCareerFelineBattle(mission) || !heavyField && this.careerProfile?.rank !== 'commander'
          : this.captainEagleMissionId
          ? mission.templateId !== CAPTAIN_EAGLE_BATTLE_ID || mission.kind !== 'captain-eagle-battle'
          : mission.templateId !== CAPTAIN_FRONTLINE_COMMAND_ID || mission.kind !== 'captain-outpost-defense' || campaignConfig?.stageId !== 9)) {
          throw new Error('Captain battlefield launch does not match saved mission')
        }
        if (this.bridgeLaunch) this.bridgeRuntime = new CareerBridgeBattleRuntime(mission)
        this.careerBattleCheckpoint = new CareerMissionCheckpoint(() => this.careerStore.loadChecked().profile ?? this.careerProfile!,
          profile => this._commitCareerBattleCheckpoint(profile))
      } else if (campaignConfig?.careerVeteranOutpost || campaignConfig?.careerCommanderOutpost) {
        const careerOutpost = campaignConfig.careerVeteranOutpost ?? campaignConfig.careerCommanderOutpost!
        const mission = this.careerProfile?.activeMission
        if (!mission || mission.id !== campaignConfig.careerMissionId
          || mission.templateId !== careerOutpost.templateId
          || mission.kind !== careerOutpost.missionKind) {
          throw new Error('Career Outpost operation launch does not match saved mission')
        }
        this.campaignReinforcementArrived = careerOutpost.runtimeState.reinforcementArrived
        this.veteranOutpostCheckpoint = new CareerMissionCheckpoint(
          () => this.careerStore.loadChecked().profile ?? this.careerProfile!,
          profile => {
            if (this.player) profile.playerAerialState = captureCareerAerialState(this.player, `outpost:${campaignConfig.careerMissionId}`)
            this._captureOwnedMountArmor(profile)
            const saved = this.careerStore.save(profile)
            if (saved) this.careerProfile = profile
            return saved
          },
        )
      } else if (!this.careerProfile?.activeOutpostMission || !campaignConfig
        || this.careerProfile.activeOutpostMission.id !== campaignConfig.careerMissionId
        || this.careerProfile.activeOutpostMission.kind !== (campaignConfig.careerMissionKind ?? 'outpost-defense')) {
        throw new Error('Career Outpost launch does not match saved mission')
      }
    }
    // Defense Campaign player-side units are defenders, so structure damage / breach
    // is not a valid performance statistic for them. Custom Battle remains generic.
    const veteranMission = campaignConfig?.careerVeteranOutpost || campaignConfig?.careerCommanderOutpost || this.careerBattleCheckpoint
      ? this.careerProfile?.activeMission : undefined
    const outpostMission = this.careerProfile?.activeOutpostMission
    const trackStructureStats = !campaignConfig || campaignConfig.careerVeteranOutpost?.templateId === 'veteran-outpost-assault'
    this.battleStats = new BattleStatsTracker(
      this.combatEvents,
      trackStructureStats,
      veteranMission ? event => acceptsCareerMissionStat(this.careerProfile?.activeMission ?? veteranMission, event) : undefined,
      veteranMission?.playerStats ?? veteranMission?.battle?.playerStats ?? veteranMission?.eagleBattle?.playerStats ?? outpostMission?.battle?.playerStats,
      veteranMission ? careerMissionCommandMeritPolicy(veteranMission, () => this.careerProfile?.activeMission ?? veteranMission)
        : outpostMission ? careerOutpostCommandMeritPolicy(outpostMission,
          () => this.careerProfile?.activeOutpostMission ?? outpostMission,
          event => !this.careerProfile?.claimedBattleIds.includes(outpostMission.id)
            && this.defenseCampaignRuntime?.getSnapshot().activePhase === 'assault'
            && (event.type === 'damage_applied' || event.type === 'actor_killed')
            && event.target.allegiance === Faction.ENEMY
            && (event.target.targetType === 'npc' ? event.target.targetId : event.target.ownerActorId)?.startsWith(`${outpostMission.id}:`) === true,
        ) : undefined,
    )

    this.initialization = this.initialize(battleConfig, campaignConfig, progress).catch(error => {
      this.compass?.dispose()
      this.compass = undefined
      this.trainingUI?.dispose()
      this.trainingGround?.dispose()
      this.trainingDamageUnsubscribe?.()
      this.sceneListeners.abort()
      this.input?.dispose()
      this.player?.dispose()
      this._disposeCareerOutpostBattleActors()
      this.inventoryManager?.dispose()
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
    const startupDevCombat = !this.isTrainingGround ? startupQuery.get('devcombat')?.toLowerCase() ?? null : null
    const isRomanDefenseDevScenario = import.meta.env.DEV
      && (startupDevCombat === 'j' || startupDevCombat === 'scenarioj')
    const previewOutpostQuery = !this.isTrainingGround && import.meta.env.DEV ? startupQuery.get('campaignoutpost') : null
    const isBridgePreview = !this.isTrainingGround && import.meta.env.DEV && startupQuery.has('bridgepreview')
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
    const outpostWalkwaysEnabled = isOutpostWalkwayEnabled(
      campaignConfig,
      import.meta.env.DEV && startupQuery.get('outpostwalkway') === '1',
    )

    let siegeTreeClearances: THREE.Box3[] | undefined
    if (campaignConfig && previewOutpostFaction && isMobileSiegeRampEnabled(campaignConfig)) {
      const specs = this._campaignSiegeEnvironmentPlan(campaignConfig).npcSpecs
        .filter(spec => spec.characterFaction !== previewOutpostFaction)
      const layout = getOutpostWalkwayLayout(getCampaignOutpostPlacement(previewOutpostFaction))
      const stagingZ = layout.zSign > 0 ? Math.max(...specs.map(spec => spec.z)) : Math.min(...specs.map(spec => spec.z))
      if (specs.filter(spec => isSiegeRampCrewCandidate(spec)).length >= 10) {
        siegeTreeClearances = getSiegeApproachClearances(layout, stagingZ)
      }
    }
    const isCustomBattle = Boolean(battleConfig && !campaignConfig && !this.bridgeLaunch && !this.captainEagleMissionId && !this.felineMissionId)
    const isCustomAerial = isCustomBattle && battleConfig?.battleType === 'aerial'
    const customMapId = isCustomBattle ? (isCustomAerial ? 'original' : (battleConfig?.mapId ?? 'original')) : undefined
    const isBridgeBattle = isBridgePreview || Boolean(this.bridgeLaunch) || customMapId === 'bridge'
    const isSnowBattle = customMapId === 'snow' || Boolean(this.felineMissionId && battleConfig?.mapId === 'snow')
    const isRomanTownBattle = customMapId === 'roman_town'
    const isVikingTownBattle = customMapId === 'viking_town'

    let terrainMesh: THREE.Mesh
    let obstacles: ObstacleData[]
    let obstacleMeshes: THREE.Object3D[]
    let damageableObstacles: DamageableObstacle[]

    if (isRomanTownBattle || isVikingTownBattle) {
      const townFaction = isRomanTownBattle ? 'roman' : 'viking'
      await preloadArchitectureStatues()
      const townWorld = new TownWorld(townFaction, this.scene, Faction.TOWN)
      terrainMesh = townWorld.terrainMesh
      obstacles = townWorld.obstacles
      obstacleMeshes = [townWorld.terrainMesh, townWorld.fortifications.root]
      damageableObstacles = []
    } else {
      createSky(this.scene, resolveShadowMapSize(startupQuery), previewOutpostFaction === 'viking' || isSnowBattle)
      const terrain = createTerrain(this.scene, {
        fortifiedCampFaction: isSnowBattle ? 'viking' : previewOutpostFaction,
        riverCrossing: isBridgeBattle,
        treeClearances: isBridgeBattle ? getRiverCrossingTreeClearances(Boolean(this.bridgeLaunch)) : siegeTreeClearances,
      })
      terrainMesh = terrain.terrainMesh
      obstacles = terrain.obstacles
      obstacleMeshes = terrain.obstacleMeshes
      damageableObstacles = terrain.damageableObstacles

      if (isBridgeBattle) {
        createRiverCrossingBattlefield(this.scene, { obstacles, obstacleMeshes })
      }
    }

    // Defense Campaign owns the same faction-neutral outpost used by DEV preview.
    if (previewOutpostFaction) {
      const outpost = createCampaignOutpost(
        this.scene,
        previewOutpostFaction,
        { obstacles, obstacleMeshes },
        {
          walkways: outpostWalkwaysEnabled,
          siegePassages: isMobileSiegeRampEnabled(campaignConfig),
        },
      )
      damageableObstacles.push(...outpost.damageableObstacles)
      this.previewCampaignGate = outpost.gateController
      this.previewCampaignBreachController = outpost.breachController
      const savedCareerOutpost = campaignConfig?.careerVeteranOutpost ?? campaignConfig?.careerCommanderOutpost
      const savedBattle = this._personalOutpostMission()?.battle
      restoreCampaignBreachCheckpoint(outpost.breachController,
        savedCareerOutpost ? this.careerProfile?.activeMission?.outpostSiege : savedBattle?.outpostSiege,
        savedCareerOutpost ? { state: savedCareerOutpost.runtimeState.gateState, hp: savedCareerOutpost.runtimeState.gateHealth } : savedBattle?.gate)
      this.previewCampaignGate.onStateChange(state => {
        if (state === 'open' || state === 'destroyed') {
          for (const npc of this.npcs) {
            if (npc.siegeObstacle === this.previewCampaignGate?.siegeObstacle) {
              npc.assignSiegeObstacle?.(null)
            }
          }
        }
      })
      outpost.breachController.onBreach(() => {
        if (campaignConfig?.careerMissionKind === 'outpost-relief') return
        const attackerFaction = outpost.gateController.attackerFaction
        this._applyCampaignBreachOrders(attackerFaction)
      })
      if (outpost.walkways) {
        this.navigationWorld.setOutpostWalkways(outpost.walkways.layout)
        if (isMobileSiegeRampEnabled(campaignConfig)) {
          this.campaignSiegeAssault = new CampaignSiegeAssault(this.scene, obstacles, outpost.walkways,
            this.navigationWorld, outpost.gateController, outpost.breachController, () => this.npcs,
            ramp => { for (const mesh of ramp.damageable.hitMeshes) this._aimTargetRegistry.addStaticTarget(mesh) },
            ramp => { for (const mesh of ramp.damageable.hitMeshes) this._aimTargetRegistry.removeStaticTarget(mesh) },
            () => [
              ...(!this.player.spectatorOnly && !this.player.isMounted ? [{ position: this.player.position,
                radius: .38, height: 1.9, bottomOffset: .95 }] : []),
              ...this.mounts.filter(mount => !mount.dead).map(mount => ({ position: mount.group.position,
                radius: 1, height: 2.6, bottomOffset: 0 })),
            ], npc => !officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId))
        }
      }
    }

    const heavyMissionForObstacles = this.felineMissionId ? this.careerProfile?.activeMission : undefined
    if (isCareerHeavyFieldBattle(heavyMissionForObstacles) && heavyMissionForObstacles.templateId === VETERAN_IRON_TIDE_ID) {
      createCaltropBarrier(this.scene, veteranCaltropWorldRects(planVeteranCaltropDefense(), this.careerProfile!.faction), obstacles)
    }
    if (this.felineMissionId && this.careerProfile && isMigratedCareerFieldMission(this.careerProfile.activeMission)) {
      this.careerFieldDeployment = createCareerFieldDeployment(this.careerProfile)
      const fire = this.careerFieldDeployment.campfireCenter
      if (fire) {
        const y = getTerrainHeight(fire.x, fire.z)
        const visual = createCampfireVisual(Math.round(fire.x * 73 + fire.z * 31))
        visual.position.set(fire.x, y, fire.z)
        this.scene.add(visual)
        obstacles.push({
          box: new THREE.Box3(new THREE.Vector3(fire.x - .6, y, fire.z - .6), new THREE.Vector3(fire.x + .6, y + .55, fire.z + .6)),
          isBarricade: false,
        })
      }
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
    const validationHero = import.meta.env.DEV && this.isTrainingGround ? commanderValidationHero(startupQuery) : undefined
    const playerFaction = this.careerProfile?.faction ?? this.tutorialFaction ?? (validationHero ? HERO_ASSETS[validationHero].descriptor.faction : undefined)
      ?? campaignConfig?.careerVeteranOutpost?.playerFaction
      ?? campaignConfig?.careerCommanderOutpost?.playerFaction
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
    const playerHeroId = this.careerProfile ? resolveCareerHeroAsset(this.careerProfile) ?? undefined : campaignConfig?.playerHeroId ?? battleConfig?.playerHeroId ?? validationHero
    this.player = new Player(this.scene, playerFaction, playerHeroId, this.careerProfile ? resolveCareerOrdinaryTier(this.careerProfile) : resolveOrdinarySoldierTier(campaignConfig?.playerVisualTier ?? battleConfig?.playerVisualTier))
    // Release and diagnostic armies are ahead at -Z for Viking, +Z for Roman. Establish the actor's
    // heading first; the camera derives its rear orbit from that heading.
    if (this.bridgeLaunch) this.player.group.visible = false
    this.player.faceDirection(0, isBridgePreview || this.bridgeLaunch ? 1 : (isRoman ? 1 : -1))

    const query = startupQuery
    const benchmarkSettings = import.meta.env.DEV && !this.isTrainingGround ? parseHeroBenchmarkQuery(query) : null
    const heroBenchmark = benchmarkSettings ? createHeroBenchmarkScenario(benchmarkSettings) : null
    this.isDevCombat = !this.isTrainingGround && query.has('devcombat')
    this.activeRenderProbe = getActiveRenderProbe(query)
    const devModelsMode = this.isTrainingGround ? null : query.get('devmodels')
    const modelStudioMode = resolveModelStudioMode(devModelsMode)
    this.modelStudio = modelStudioMode ? this._createModelStudio(modelStudioMode) : null

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
      const hasRampartCheckpoint = campaignConfig.careerVeteranOutpost || campaignConfig.careerCommanderOutpost
        ? Boolean(this.careerProfile?.activeMission?.actorPositions)
        : Boolean(this._personalOutpostMission()?.battle)
      const deployRampartGarrison = outpostWalkwaysEnabled && !hasRampartCheckpoint
      if (campaignConfig.careerMissionKind === 'captain-outpost-defense') {
        battlePlan = createCaptainFrontlineSpawnPlan(campaignConfig, this.careerProfile?.activeMission?.officialSquad, {
          deployRampartGarrison, careerGarrison: Boolean(campaignConfig.careerMissionId),
        })
      } else if (campaignConfig.careerVeteranOutpost) {
        battlePlan = createCareerVeteranOutpostSpawnPlan(campaignConfig, 'initial', {
          deployRampartGarrison,
        })
      } else if (campaignConfig.careerCommanderOutpost) {
        battlePlan = createCareerCommanderOutpostSpawnPlan(campaignConfig, 'initial', this.careerProfile?.activeMission)
      } else {
        battlePlan = BattleSpawner.createSpawnPlan(activeBattleConfig)
        if (campaignConfig.careerMissionKind === 'outpost-relief') battlePlan = createCareerReliefSpawnPlan(campaignConfig)
        else positionDefenseCampaignDefenders(battlePlan.npcSpecs, campaignConfig.defenderFaction, {
          deployRampartGarrison, careerGarrison: Boolean(campaignConfig.careerMissionId),
        })
        this._identifyPersonalOutpostWave(battlePlan, 'initial')
      }
    } else if (this.bridgeLaunch && this.careerProfile) {
      battlePlan = createCareerBridgeSpawnPlan(this.careerProfile)
    } else if (this.felineMissionId && this.careerProfile) {
      if (this.careerFieldDeployment) battlePlan = this.careerFieldDeployment.plan
      else if (isCareerHeavyFieldBattle(this.careerProfile.activeMission)) {
        this.heavyDeployment = createHeavyFieldDeployment(this.careerProfile)
        battlePlan = this.heavyDeployment.plan
      } else battlePlan = createCareerFelineSpawnPlan(this.careerProfile)
    } else if (this.captainEagleMissionId && this.careerProfile) {
      battlePlan = createCaptainEagleSpawnPlan(this.careerProfile)
    } else if (heroBenchmark) {
      activeBattleConfig = heroBenchmark.config
      battlePlan = heroBenchmark.plan
    } else if (isBridgePreview) {
      battlePlan = createBridgePreviewSpawnPlan(playerFaction)
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
      battlePlan = BattleSpawner.createSpawnPlan(battleConfig, obstacles)
    }

    const initialPlayerHp = playerHeroId
      ? getT4HeroCombatModifiers(HERO_COMBAT_PROFILE_BY_ASSET[playerHeroId])!.maxHp
      : resolveOrdinaryPlayerBaseHp(playerFaction, this.player.ordinaryCharacterTier, activeBattleConfig)
    this.playerMaxHpOverride = !playerHeroId && activeBattleConfig?.playerHp !== undefined && activeBattleConfig.playerHpSource !== 'default'
      ? activeBattleConfig.playerHp : undefined
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
    if (this.modelStudio) {
      this.modelStudio.setupCamera()
    } else if (isInitialSpectator) {
      const initY = getTerrainHeight(0, 0) + 5
      this.camera.position.set(0, initY, 0)
      this.camera.lookAt(0, initY, -1)
      this.spectatorController.initFromCamera(this.camera)
    } else {
      const playerSpawn = this.isTrainingGround ? createTrainingGroundPlan().playerSpawn : battlePlan?.playerSpawn ?? previewPlayerSpawn ?? (isRoman ? ROMAN_PLAYER_SPAWN : VIKING_PLAYER_SPAWN)
      const terrainY = getTerrainHeight(playerSpawn.x, playerSpawn.z)
      this.player.group.position.set(playerSpawn.x, terrainY + 0.95, playerSpawn.z)
      this.player.spawnX = playerSpawn.x
      this.player.spawnZ = playerSpawn.z
      this.thirdPersonCamera.setYaw(isBridgePreview || this.bridgeLaunch ? Math.PI : (isRoman ? Math.PI : 0))
    }

    this.lockOverlay    = document.getElementById('lock-overlay')!
    this.controlsHint   = document.getElementById('controls-hint')!
    this.saveNotify     = document.getElementById('save-notify')!
    this.deathBanner    = document.getElementById('death-banner')
    this.spectatorBadge = document.getElementById('spectator-badge')
    this.pickupHud = new PickupPrompt()

    this.enemyHud    = document.getElementById('enemy-hud')!
    this.enemyNameEl = document.getElementById('enemy-name')!
    this.enemyHpFill = document.getElementById('enemy-hp-fill')!

    this.mountHud    = document.getElementById('mount-hud')!
    this.mountNameEl = document.getElementById('mount-name')!
    this.mountHpFill = document.getElementById('mount-hp-fill')!

    // ── Combat & Enemies ──
    if (campaignConfig && battlePlan && (campaignConfig.careerVeteranOutpost
      || campaignConfig.careerCommanderOutpost && battlePlan.npcSpecs.some(spec => spec.characterFaction !== campaignConfig.defenderFaction))) {
      this._prepareCampaignSiegePlan(battlePlan)
    }
    if (campaignConfig && battlePlan) {
      this.campaignOriginalDefenders = []
      if (campaignConfig.careerCommanderOutpost) {
        this._queueCommanderOutpostDeployment(battlePlan, campaignConfig)
        await gameplayNpcSpawns.wait(this.commanderOutpostDeploymentBatch!,
          (done, total) => progress(`部署開場守軍 ${done} / ${total}…`))
      } else {
        const spawned = await this._executeBattleSpawnPlan(battlePlan, progress)
        for (const npc of spawned) this._configureCampaignInitialNpc(npc, campaignConfig)
      }
      const careerOutpost = campaignConfig.careerVeteranOutpost ?? campaignConfig.careerCommanderOutpost
      const commanderAssaultActive = campaignConfig.careerCommanderOutpost?.runtimeState.activePhase === 'assault'
      if (commanderAssaultActive) this.campaignAttackersStarted = true
      const capabilities = defenseCampaignCapabilities(campaignConfig)
      const relief = campaignConfig.careerMissionKind === 'outpost-relief'
      const veteranOutpost = campaignConfig.careerVeteranOutpost
      const commanderOutpost = campaignConfig.careerCommanderOutpost
      const isVeteranAssault = veteranOutpost?.templateId === 'veteran-outpost-assault'
      this.defenseCampaignRuntime = new DefenseCampaignRuntime({
        ...capabilities,
        eliminationObjective: relief || isVeteranAssault || Boolean(commanderOutpost),
        eliminationUsesDeployment: Boolean(commanderOutpost),
        deploymentSeconds: campaignConfig.deploymentSeconds,
        ...(veteranOutpost ? {
          reinforcementDelaySeconds: veteranOutpost.reinforcementDelaySeconds,

        } : {}),
        ...(careerOutpost ? { initialSnapshot: careerOutpost.runtimeState }
          : this._personalOutpostMission()?.battle ? { initialSnapshot: this._personalOutpostMission()!.battle!.runtime } : {}),
      })
      if (relief) {
        initializeCareerReliefBattlefield(this.previewCampaignGate!, this.npcs.filter(npc => !officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId)), this.previewCampaignBreachController ?? undefined)
        this.navigationWorld.sync(this.obstacles)
        this.campaignAttackersStarted = true
        const placement = getCampaignOutpostPlacement(campaignConfig.defenderFaction)
        this.reliefMarch = new CareerReliefMarchController(this.npcs, new THREE.Vector3(placement.centerX, 0, placement.frontZ),
          onFinished => this.soundManager.playCareerMissionVoice(campaignConfig.defenderFaction, 'follow', onFinished),
          () => this._persistCareerReliefCharge(),
          () => this.soundManager.playCommanderCommand(campaignConfig.defenderFaction, 'charge'),
          campaignConfig.careerReliefPhase === 'charge', { chargeAfterFollow: true,
            squads: this._makeMountedMissionSquads(this.npcs, [1, 2]),
            acceptsActor: npc => !officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId),
          })
        this.reliefMarch.start()
      }
      if (careerOutpost) {
        this._restoreCareerVeteranOutpostGate(careerOutpost.runtimeState)
      }
      if (veteranOutpost) {

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
        careerOutpost?.playerFaction ?? campaignConfig.defenderFaction,
        {
          relief,
          playerIsAttacker: veteranOutpost?.templateId === 'veteran-outpost-assault',
          reinforcementsEnabled: capabilities.reinforcementsEnabled,
          reinforcementArrivalTracked: veteranOutpost?.templateId === 'veteran-dread-outpost',
          returnToTown: Boolean(campaignConfig.careerMissionId),
          meritAwarded: () => this.careerMeritAwarded,
          ...(veteranOutpost ? {
            veteranMission: true,
            missionTitle: veteranOutpost.templateId === 'veteran-dread-outpost'
              ? 'Dread Outpost · 恐怖前哨防禦'
              : 'Outpost Assault · 強攻前哨',
          } : {}),
          ...(commanderOutpost ? {
            veteranMission: true,
            missionTitle: 'Outpost Last Stand · 前哨決戰',
            squadBreakdown: true,
          } : {}),
          ...(campaignConfig.careerMissionKind === 'captain-outpost-defense' ? { veteranMission: true, missionTitle: 'Frontline Command · 前線指揮' } : {}),
        },
      )
    } else if (isBridgePreview && battlePlan) {
      await this._executeBattleSpawnPlan(battlePlan, progress)
      const bridgeMode = startupQuery.get('bridgepreview')?.toLowerCase()
      const laneXs = RIVER_CROSSING_LAYOUT.bridge.laneXPositions
      const southFacing = new THREE.Vector3(0, 0, 1)
      const northFacing = new THREE.Vector3(0, 0, -1)
      let friendlySlot = 0
      let enemySlot = 0
      for (const npc of this.npcs) {
        if (bridgeMode === 'hold') {
          npc.setTacticalOrder('defend')
          continue
        }
        if (npc.faction === Faction.PLAYER) {
          const gx = laneXs[friendlySlot % laneXs.length]
          const gz = 38
          npc.assignFormationTarget(
            friendlySlot + 1,
            new THREE.Vector3(gx, getTerrainHeight(gx, gz), gz),
            southFacing,
            undefined,
            'defend',
          )
          friendlySlot++
        } else {
          const gx = laneXs[enemySlot % laneXs.length]
          const gz = -38
          npc.assignFormationTarget(
            enemySlot + 1,
            new THREE.Vector3(gx, getTerrainHeight(gx, gz), gz),
            northFacing,
            undefined,
            'defend',
          )
          enemySlot++
        }
      }
      const extraCorgi = new Mount(this.scene, MountType.CORGI, -5.5, -34)
      const extraCat = new Mount(this.scene, MountType.BLACK_CAT, 5.5, -34)
      this.mounts.push(extraCorgi, extraCat)
      this._aimTargetRegistry.registerMount(extraCorgi)
      this._aimTargetRegistry.registerMount(extraCat)
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
        reconcileCampaignGateSiege({
          gate: this.previewCampaignGate,
          breachController: this.previewCampaignBreachController,
          availableEntrances: this.campaignSiegeAssault?.entrances,
          npcs: this.npcs,
          attackerFaction: 'viking',
        })
      } else {
        // Other DEV combat scenarios remain controllable test battlefields.
        for (const npc of this.npcs) npc.setTacticalOrder('defend')
      }
      if (this.activeRenderProbe === 'simple-material') {
        applyDevSimpleMaterials(this.npcs, this.mounts)
      }
    } else if (this.modelStudio) {
      this.modelStudio.spawn()
    } else if (this.bridgeLaunch && battlePlan) {
      this.fieldBattleHud = new CaptainEagleHUD('bridgehead')
    } else if (this.felineMissionId && battlePlan) {
      const fieldMission = this.careerProfile?.activeMission
      this.fieldBattleHud = new CaptainEagleHUD('feline', this.careerFieldDeployment
        ? { title: this.careerFieldDeployment.title, force: this.careerFieldDeployment.forceLabel }
        : fieldMission?.templateId === COMMANDER_IRON_LEGION_ID
        ? { title: 'COMMANDER VII · 鐵甲軍團決戰', force: '正式六貓騎兵' }
        : isCareerHeavyFieldBattle(fieldMission) ? { title: getHeavyFieldMissionDefinition(fieldMission.templateId)?.name ?? '重騎兵戰場', force: '正式友軍' } : undefined)
      this._applyCareerPlayerHealthForCheckpoint()
      this._declareFieldBattleRoster(battlePlan)
    } else if (this.captainEagleMissionId && battlePlan) {
      this.fieldBattleHud = new CaptainEagleHUD()
      this._applyCareerPlayerHealthForCheckpoint()
      this._declareFieldBattleRoster(battlePlan)
    } else if (battleConfig && battlePlan) {
      await this._executeBattleSpawnPlan(battlePlan, progress)
      if (this.tutorialLaunch?.stage === 'captain') {
        for (const npc of this.npcs) npc.setTacticalOrder('defend')
      } else this.battleController = new BattleController(
        battleConfig,
        () => this.battleStats.snapshot(this.npcs, this.player),
        battleConfig.commandGrouping === 'squad',
      )
      this.battleController?.initCounts(this.npcs, this.player)
    }

    if (
      !this.isModelStudio
      && !this.isTrainingGround
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
        this.careerProfile ? horseVariantFromSave(this.careerProfile.horseAppearanceVariant) : campaignConfig?.playerMountAppearanceVariant ?? 0,
      )
      this.startingHorse = startingHorse
      const ownedMountId = activeBattleConfig?.playerLoadout?.mountId
      this.startingHorseMountId = ownedMountId
      if (this.careerProfile && ownedMountId) startingHorse.restoreArmor(this.careerProfile.activeMission?.mountState?.armorImpact?.[ownedMountId] ?? this.careerProfile.mountArmor?.[ownedMountId])
      const missionHeading = isBridgePreview || this.bridgeLaunch ? 0
        : campaignConfig?.careerMissionKind === 'veteran-outpost-assault' || campaignConfig?.careerMissionKind === 'outpost-relief'
          ? (campaignConfig.defenderFaction === 'roman' ? Math.PI : 0) : undefined
      const mountHeading = missionHeading ?? (isRoman ? 0 : Math.PI)
      if (startingHorse.isFlyingMount) {
        if (activeBattleConfig?.battleType === 'aerial') {
          startingHorse.group.position.set(playerSpawn.x, 35, playerSpawn.z)
        } else {
          const landing = findEagleLandingPosition({ ...playerSpawn, yaw: mountHeading }, this.obstacles, [], 300, 140)
          if (!landing) { startingHorse.dispose(); throw new Error('找不到 xongkoro 可安全起降的出生位置') }
          startingHorse.group.position.copy(landing)
        }
      }
      this.mounts.push(startingHorse)
      this.player.faceDirection(0, isBridgePreview || this.bridgeLaunch ? 1 : (isRoman ? 1 : -1))
      this._mountPlayer(startingHorse, startingHorse.isFlyingMount ? mountHeading : missionHeading)
      if (missionHeading !== undefined) this.thirdPersonCamera.setYaw(missionHeading + Math.PI)
    }
    
    this.damageNumbers = new DamageNumbers()

    // ── RPG Systems & Inventory ──
    this.staminaBar       = new StaminaBar()
    this.hpBar            = new HpBar()
    this.player.setDamageHud(this.hpBar)
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI         = new QuiverUI()
    this.skillManager     = new SkillManager()
    if (this.careerProfile) this.skillManager.setSkillState(this.careerProfile.skills ?? {})
    this.player.blockingLevel = this.skillManager.skillState.blocking.level
    this.player.onShieldBlock = impact => this._applyPlayerSkillAward({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    if (!this.careerProfile) this.player.setMaxHp(resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, this.skillManager.skillState))
    this.armyCommandUI   = new ArmyCommandUI(playerFaction)
    if (this.hasCareerOfficialCommand) {
      this.armyCommandUI.setOfficialSquadLabel(officialCommandHudLabel(this._careerCommandMission()?.officialSquad))
    }
    this.equipmentUI      = new EquipmentUI()
    this._setInventoryManager(this.isTrainingGround ? createTrainingInventory(playerHeroId) : new InventoryManager(activeBattleConfig?.playerLoadout, playerHeroId, playerFaction))
    if (this.careerProfile) {
      const inventory = new TownEquipment(() => this.careerProfile!, profile => {
        if (!this.careerStore.save(profile)) return false
        this.careerProfile = profile
        return true
      })
      inventory.prepareForCombat()
      this._setInventoryManager(inventory)
      this.player.setMaxHp(resolveCareerPlayerMaxHp(this.careerProfile, this.basePlayerMaxHp))
      this.player.setHp(this.player.maxHp)
      this.controlsHint.textContent = 'WASD 移動 ｜ Shift 衝刺 ｜ 左鍵攻擊 ｜ 右鍵／F 舉盾瞄準 ｜ Tab 裝備 ｜ 滾輪切換武器'
    }
    this.combatEvents.subscribe(event => this._awardPlayerSkillXpFromEvent(event))
    if (this.felineMissionId && this.careerFieldDeployment) {
      this.felineChargeUnsubscribe = this.combatEvents.subscribe(event => this._handleMigratedFieldDamage(event))
    } else if (this.felineMissionId && isCareerHeavyFieldBattle(this.careerProfile?.activeMission)) {
      this.felineChargeUnsubscribe = this.combatEvents.subscribe(event => this._handleHeavyEnemyDamage(event))
    } else if (this.felineMissionId && this.careerProfile?.activeMission?.commanderMission?.felineChargeTriggered !== true) {
      this.felineChargeUnsubscribe = this.combatEvents.subscribe(event => this._handleFelineVanguardDamage(event))
    }
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
      this.scene, this.camera, this.hasCareerOfficialCommand ? this.npcs : this.personalSquad?.actors ?? this.npcs,
      terrainMesh, obstacles, this.navigationWorld, this.personalSquad ? null : formationRegion,
    )
    this.armyCommandController = new ArmyCommandController(
      this.hasCareerOfficialCommand ? this.npcs : this.personalSquad?.actors ?? this.npcs,
      playerFaction,
      this.input,
      this.armyCommandUI,
      formationController,
      (order, target) => {
        if (!this.hasCareerOfficialCommand || target === 'all' || target === 'squad:personal') this.personalSquad?.resumeCommand(order)
        if (order !== 'follow') this.soundManager.playCommanderCommand(playerFaction, order)
        if (this.hasCareerOfficialCommand) this._persistPersonalOutpost(true)
      },
      campaignConfig || this.bridgeLaunch || this.felineMissionId || this.tutorialLaunch ? 'defend' : (this.isDevCombat || isBridgePreview) ? 'defend' : 'attack',
      (order) => {
        if (this.heavyNoCommand) return false
        if (this.hasCareerOfficialCommand && (this.player.dead || this._careerCommandFinished())) return false
        if (this.personalSquad) return !this.player.dead && this.controlMode !== 'spectator'
        if (!campaignConfig || (order !== 'attack' && order !== 'charge')) return true
        const attackerFaction = opposingCampaignFaction(campaignConfig.defenderFaction)
        return this._campaignFactionAlive(attackerFaction) > 0
      },
      this.inventoryManager,
      this.hasCareerOfficialCommand || this.personalSquad ? 'squad' : activeBattleConfig?.commandGrouping ?? 'preset',
      !this.isTrainingGround && !this.heavyNoCommand && (Boolean(this.hasCareerOfficialCommand || this.personalSquad) || defenseCampaignCapabilities(campaignConfig).playerCommandsEnabled),
      this.personalSquad ? {
        enabled: () => !this.player.dead && this.controlMode !== 'spectator',
        issue: order => {
          const accepted = order === 'follow' ? this.personalSquad!.follow() : this.personalSquad!.dismiss()
          if (accepted) this.soundManager.playCareerMissionVoice(playerFaction, order === 'follow' ? 'follow' : 'dismiss')
          return accepted
        },
      } : undefined,
      this.hasCareerOfficialCommand ? this._officialCommandAuthority() : undefined,
      this.careerProfile && (this.hasCareerOfficialCommand || this.personalSquad) ? () => this._careerCommandHudRoster() : undefined,
      Boolean(campaignConfig || isRomanDefenseDevScenario || previewOutpostFaction || isBridgePreview) && !this.personalSquad && !this.hasCareerOfficialCommand,
      (_target, recipients) => {
        let slotIndex = 0
        for (const npc of recipients) {
          if (npc.dead) continue
          npc.assignFollowTarget?.(
            this.player,
            slotIndex,
            officialFollowLocalOffset(slotIndex, npc.isMounted, Boolean(this.careerProfile?.personalSquad?.members.length)),
          )
          slotIndex++
        }
      },
    )
    this.commandSelectionMarker = new ArmyCommandSelectionMarker(this.scene, this.armyCommandController)


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

    this._bindPlayerCombatCallbacks(campaignConfig)

    if (campaignConfig?.careerVeteranOutpost || campaignConfig?.careerCommanderOutpost) this._restoreCareerVeteranPlayerStateAndShowTerminalResult()
    else if (this.captainEagleMissionId) this._restoreFieldBattlePlayer()
    else if (this.bridgeLaunch || this.felineMissionId) { /* Restore after rider and orphan mounts materialize. */ }
    else this._restorePersonalOutpostPlayer()
    this.initializing = false
    if (!this.bridgeLaunch && !this.felineMissionId) this._persistPersonalOutpost(true)
    if (this.careerBattleCheckpoint) {
      if (!this.bridgeLaunch && !this.felineMissionId && !this._persistCareerBattle(true)) throw new Error('Captain battlefield initial checkpoint could not be saved')
      if (this.fieldMissionId && battlePlan) {
        if (this.bridgeLaunch) this._declareFieldBattleRoster(battlePlan)
        this._queueFieldBattleRoster(battlePlan)
        await gameplayNpcSpawns.wait(this.fieldRosterBatch!,
          (done, total) => progress(`${this.bridgeLaunch ? '部署橋頭部隊' : this.felineMissionId ? (this.careerFieldDeployment ? `部署${this.careerFieldDeployment.title}部隊` : isCareerHeavyFieldBattle(this.careerProfile?.activeMission) ? '部署鐵騎戰場部隊' : '部署六貓騎兵團') : '部署巨鷹部隊'} ${done} / ${total}…`))
        if (this.bridgeLaunch || this.felineMissionId) this._restoreFieldBattlePlayer()
        if (!this._persistCareerBattle(true)) throw new Error('Career field initial deployment could not be saved')
        if (this.bridgeRuntime?.deployment.phase === 'spawning'
          && !this.bridgeRuntime.completeEnemyDeployment(this.fieldRosterBatch?.ready === true, state => this._saveBridgeDeployment(state))) {
          throw new Error('Bridgehead enemy deployment could not be saved')
        }
      }
      const terminal = this.careerProfile?.activeMission?.result
      if (terminal) {
        if (!this.fieldMissionId) this._showDefenseCampaignResult(terminal.outcome === 'victory' ? 'victory' : 'defeat')
      }
    }

    if (campaignConfig?.careerCommanderOutpost) {
      if (!this._persistCareerVeteranOutpostCheckpoint({ immediate: true })) {
        throw new Error('Commander initial deployment could not be saved')
      }
      this.commanderOutpostDeploymentCheckpointed = true
      if (this.careerOutpostTerminalResultPending) {
        const result = this.careerOutpostTerminalResultPending
        this.careerOutpostTerminalResultPending = undefined
        this._showDefenseCampaignResult(result)
      }
      const state = this.defenseCampaignRuntime!.getSnapshot()
      // Restore only remaining timed jobs; Loading never waits for future arrivals.
      if (state.activePhase === 'assault' && !state.battleFinished && !this.careerProfile?.activeMission?.result) {
        this._queueDefenseCampaignWave('attackers')
      }
    }

    if (this.bridgeLaunch) {
      const mission = this.careerProfile!.activeMission!
      if (!this.fieldRosterBatch?.ready || !mission.bridgeBattle?.ready) {
        throw new Error('Bridgehead deployment did not complete')
      }
      this.player.group.visible = true
      if (!mission.result) for (const npc of this.npcs) {
        if (!npc.dead && this.bridgeRuntime!.targetIds.has(npc.combatantId) && !this.fieldCheckpoint?.actors[npc.combatantId]?.order) npc.setTacticalOrder('charge')
      }
    }
    if (this.felineMissionId) {
      const mission = this.careerProfile!.activeMission!
      validateFelineDeploymentReadiness({
        spawnBatchReady: Boolean(this.fieldRosterBatch?.ready),
        battleReady: Boolean(mission.felineBattle?.ready),
        personalSquadReady: this.personalSquad ? Boolean(this.personalSquad.ready) : undefined,
      })
      this.player.group.visible = true
    }
    if (isInitialSpectator) this._enterSpectatorMode('initial')

    this._setupPointerLock()
    this._setupResize()
    this._setupShortcuts()
    if (this.isTrainingGround) this._initializeTrainingGround()
    if (this.tutorialLaunch) this._initializeCareerTutorial()
    if (heroBenchmark && benchmarkSettings) {
      const terrainHeight = getTerrainHeight(0, 0)
      this.camera.position.fromArray(heroBenchmark.camera.position)
      this.camera.position.y += terrainHeight
      const target = new THREE.Vector3(...heroBenchmark.camera.target)
      target.y += terrainHeight
      this.camera.lookAt(target)
      this.spectatorController.initFromCamera(this.camera)
      let releaseFixture = configureHeroBenchmarkActors(this.npcs)
      const recorder = createHeroBenchmarkRecorder({ npcs: this.npcs, mounts: this.mounts,
        camera: this.camera, renderer: this.renderer, profiler: this.runtimeProfiler }, benchmarkSettings, async () => {
        // The scheduler runs before the frozen-simulation branch. Hold combat while
        // partial batches materialize, then install the fixture before the first hit.
        const wasFrozen = this.isSimulationFrozen
        this.setSimulationFrozen(true)
        try {
          releaseFixture()
          for (const npc of this.npcs) { this._aimTargetRegistry.unregisterNpc(npc); npc.dispose() }
          this.npcs.length = 0
          for (const batch of this.spawnBatches) batch.cancel()
          this.spawnBatches.length = 0
          await this._executeBattleSpawnPlan(createHeroBenchmarkScenario(benchmarkSettings).plan)
          releaseFixture = configureHeroBenchmarkActors(this.npcs)
          CombatRenderWarmup.warmup(this.renderer, this.camera, this.scene)
        } finally { this.setSimulationFrozen(wasFrozen) }
      })
      Object.assign(window, { __heroBenchmark: recorder })
    }
    if (this.veteranOutpostCheckpoint) window.addEventListener('pagehide', this.flushVeteranOutpostOnPageHide)
    if (this.careerProfile) window.addEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    if (this.personalSquad || this.hasCareerOfficialCommand) window.addEventListener('pagehide', this.flushPersonalOutpostOnPageHide)
    if (this.careerBattleCheckpoint) window.addEventListener('pagehide', this.flushCareerBattleOnPageHide)

    if (!isInitialSpectator) {
      this.hpBar.setFill(this.player.hpRatio)
      this.staminaBar.setFill(1)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }
    if (!this.isModelStudio) this.compass = new CompassUI(this.camera,
      document.getElementById('defense-campaign-hud') ?? document.getElementById('bridgehead-battle-hud') ?? document.getElementById('captain-eagle-hud'))
  }

  /**
   * Prepares the initial rendered frame after scene construction and GPU warmup,
   * ensuring all mounted actors evaluate their riding poses before the loading overlay is dismissed.
   */
  prepareInitialFrame(): void {
    if (this.player.isMounted) {
      this.player.prepareInitialMountedVisual()
    }
    for (const npc of this.npcs) {
      if (npc.isMounted) npc.fitMountedSeat()
    }
    this.scene.updateMatrixWorld(true)

    if (this.modelStudio?.updateControls()) {
      // Studio orbit controls own the camera.
    } else if (this.controlMode === 'spectator') {
      this.spectatorController.update(this.input, 0)
    } else if (!this.isModelStudio) {
      this.thirdPersonCamera.update(this.input, 0, this.obstacles)
    }

    if (this.renderer && this.scene && this.camera) {
      try {
        this.renderer.render(this.scene, this.camera)
      } catch (error) {
        if (import.meta.env?.DEV) console.warn('Initial pre-render pass skipped:', error)
      }
    }
  }

  private _bindPlayerCombatCallbacks(campaignConfig?: DefenseCampaignLaunchConfig): void {
    // Listen for arrow fire from Player
    this.player.onFireArrow = (evt) => {
      if (this.fieldMissionId && this.careerProfile?.activeMission?.phase !== 'ENGAGING') return false
      if (this._commanderOutpostCombatLocked()) return false
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
        evt.visualKind === 'arrow' && this.player.isMounted && this.player.currentMount?.isFlyingMount
          ? playerEagleProjectileBudget(evt.origin, evt.direction, evt.speed) : undefined,
      )
      this.arrows.push(arrow)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

    // Player Death notify & Spectator transition
    this.player.onPlayerDeath = () => {
      this._enterSpectatorMode('death')
      if (this.careerBattleCheckpoint) this._persistCareerBattle(true)
      if (campaignConfig?.careerVeteranOutpost || campaignConfig?.careerCommanderOutpost) {
        const mission = this.careerProfile?.activeMission
        if (mission) mission.playerDead = true
        this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
      }
    }

  }

  private _initializeTrainingGround(): void {
    this.trainingGround = new TrainingGround(this.scene)
    this.mounts.push(...this.trainingGround.mounts)
    for (const mount of this.mounts) this._aimTargetRegistry.registerMount(mount)
    for (const dummy of this.trainingGround.dummies) dummy.group.traverse(node => {
      if (node instanceof THREE.Mesh) this._aimTargetRegistry.addStaticTarget(node)
    })
    this.controlsHint.textContent = 'WASD 移動 · Shift 加速 · Space 跳躍 · E 上下坐騎 · 左鍵近戰 · 右鍵／F 瞄準舉盾 · Tab 裝備 · Esc 訓練選單'
    this.trainingUI = new TrainingGroundUI({
      onEquipment: () => this._toggleEquipment(),
      onRefill: () => this._refillTraining(), onReset: () => this._resetTraining(), onExit: () => this._exitTraining(),
      onPause: () => { this.input.clear(); this.player.clearTownAction(); this.lockOverlay.style.display = 'none' },
      onResume: () => {
        this.input.clear()
        if (!window.location.search.includes('nolock')) this.input.requestPointerLock(this.renderer.domElement)
      },
      equipmentVisible: () => this.equipmentUI.visible,
      onCharacter: hero => this._changeTrainingCharacter(hero),
    }, this.trainingGround.labels)
    this.trainingDamageUnsubscribe = this.combatEvents.subscribe(event => {
      const text = trainingDamageText(event, this.player.currentMount?.displayName)
      if (text) this.trainingUI?.setDamage(text)
      this.tutorialScene?.combat(event, this._ridingPracticeHorse())
    })
    this._resetTraining()
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('mount') === 'snow-leopard') {
      const mount = this.mounts.find(candidate => candidate.type === MountType.SNOW_LEOPARD)
      if (mount) this._mountPlayer(mount, mount.group.rotation.y)
    }
  }

  private _initializeCareerTutorial(): void {
    this.tutorialScene = new CareerTutorialScene(this.tutorialLaunch!, {
      returnToTown: () => this._exitCareerTutorial(),
      clearInput: () => { this.input.clear(); this.player.clearTownAction(); this.armyCommandController.close() },
      reset: () => {
        this.input.clear(); this.player.clearTownAction()
        if (this.isTrainingGround) this._resetTraining()
        else window.location.reload()
      },
    })
    if (this.trainingGround) {
      this.trainingGround.addTutorialMarker(this.tutorialScene.movementPoint.x, this.tutorialScene.movementPoint.z)
      for (const element of document.querySelectorAll<HTMLElement>('[data-training="exit"], [data-training="pause-exit"]')) element.textContent = '稍後繼續 · 返回城鎮'
      const title = document.querySelector('#training-ground-ui .training-title small')
      if (title) title.textContent = '本次 Career 操作訓練 · 免費借用資源 · 不累積戰鬥 XP'
      const character = document.querySelector<HTMLSelectElement>('#training-ground-ui select')
      if (character) character.disabled = true
    }
    this.armyCommandController.onAccepted = event => {
      if (this.tutorialLaunch?.stage !== 'captain' || event.target !== 'squad:1' || event.participantCount <= 0) return
      this.tutorialScene?.operation(event.order)
    }
    this.armyCommandController.onNavigation = (event, target) => {
      if (this.tutorialLaunch?.stage !== 'captain') return
      if (event === 'selected' && target === 'squad:1') this.tutorialScene?.operation('selected')
      if (event === 'back') this.tutorialScene?.operation('back')
    }
  }

  /** The tutorial's designated ordinary horse is the training ground's HORSE, never a cat or armored horse. */
  private _ridingPracticeHorse(): boolean {
    const horse = this.trainingGround?.mounts.find(mount => mount.type === MountType.HORSE)
    return Boolean(horse && !horse.dead && this.player.currentMount === horse && this.player.isMounted)
  }

  private _updateCareerTutorial(dt: number): void {
    const tutorial = this.tutorialScene
    if (!tutorial) return
    const paused = Boolean(this.trainingUI?.paused)
    const horse = this.trainingGround?.mounts.find(mount => mount.type === MountType.HORSE)
    const cat = this.trainingGround?.mounts.find(mount => mount.type === MountType.BLACK_CAT)
    if (!paused) tutorial.equipmentClosed(this.inventoryManager.meleeEnabled && this.inventoryManager.equippedMelee?.type === 'melee' && !this.equipmentUI.visible)
    tutorial.update({ position: this.player.combatPosition, cameraYaw: this.thirdPersonCamera.cameraYaw,
      cameraPitch: this.thirdPersonCamera.cameraPitch, inputLocked: this.input.isLocked,
      hidden: this.equipmentUI.visible, paused, dead: this.player.dead, onFoot: !this.player.isMounted,
      mountedOnPracticeHorse: this._ridingPracticeHorse(),
      mountedOnPracticeCat: Boolean(cat && !cat.dead && this.player.currentMount === cat && this.player.isMounted),
      catPosition: cat?.group.position,
      shieldRaised: this.player.hasShield && this.player.shield.shieldRaised,
      horsePosition: horse?.group.position, friendlyCount: this.npcs.filter(npc => !npc.dead && npc.faction === Faction.PLAYER).length,
    }, dt)
    if (paused) this.trainingUI?.placePauseBelowTutorial(tutorial.panelBottom)
    if (this.tutorialLaunch?.stage === 'captain' && tutorial.step === 'selected'
      && this.armyCommandController.isSubmenuOpen && this.armyCommandController.selected === 'squad:1') tutorial.operation('selected')
    if (this.tutorialLaunch?.stage === 'captain' && tutorial.engagementEnabled) {
      for (const npc of this.npcs) if (!npc.dead && npc.faction === Faction.ENEMY && npc.tacticalOrder === 'defend') npc.setTacticalOrder('attack')
    }
  }

  private _exitCareerTutorial(): void {
    this.tutorialScene?.dispose(); this.tutorialScene = undefined
    this.spawningStopped = true
    this.sceneListeners.abort(); this.input.dispose()
    window.removeEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    for (const batch of this.spawnBatches) batch.cancel()
    this.trainingDamageUnsubscribe?.(); this.trainingUI?.dispose()
    this.equipmentUI.close(); this._disposeCareerOutpostBattleActors()
    this.trainingGround?.dispose(); this.player.dispose()
    this.inventoryManager?.dispose()
    this.pickupHud?.dispose()
    for (const arrow of this.arrows) arrow.destroy()
    this._aimTargetRegistry.clear(); this.damageNumbers.clear(); this.weaponWheelUI.dispose()
    this.soundManager.updateHorseGallopLoops([])
    for (const timer of [this.hintTimer, this.notifyTimer, this.enemyHudTimer, this.deathBannerTimer]) if (timer !== null) clearTimeout(timer)
    this.renderer.dispose(); this.renderer.forceContextLoss()
    sessionStorage.removeItem('sagaburst_battle_config'); sessionStorage.removeItem('sagaburst_campaign_config')
    sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    if (document.pointerLockElement) document.exitPointerLock()
    window.location.assign(`${window.location.pathname}${window.location.search.includes('nolock') ? '?nolock' : ''}`)
  }

  private _refillTraining(): void {
    if (!this.trainingGround) return
    if (this.player.dead) { this._resetTraining(); return }
    this.input.clear(); this.player.clearTownAction()
    this.player.refillCombatSupplies()
    const mount = this.player.currentMount
    if (mount && !mount.dead) { mount.currentHp = mount.maxHp; mount.armor.reset() }
    this.hpBar.setFill(this.player.hpRatio)
    this.staminaBar.setFill(this.player.staminaRatio)
    this.quiverUI.setArrowCount(this.player.arrowCount)
    this._updateMountHud()
  }

  private _resetTraining(): void {
    const ground = this.trainingGround
    if (!ground) return
    this.input.clear()
    const { x, z } = ground.plan.playerSpawn
    this.player.resetForScene(x, getTerrainHeight(x, z) + .95, z)
    this.player.faceDirection(0, -1)
    ground.resetMounts()
    for (const mount of ground.mounts) {
      this._aimTargetRegistry.unregisterMount(mount)
      this._aimTargetRegistry.registerMount(mount)
    }
    for (const arrow of this.arrows) arrow.destroy()
    this.arrows.length = 0
    this.controlMode = 'player'
    this.player.spectatorOnly = false
    this.player.group.visible = true
    this.thirdPersonCamera = new ThirdPersonCamera(this.camera, this.player)
    this.thirdPersonCamera.setYaw(0)
    if (this.controlsHint) this.controlsHint.textContent = 'WASD 移動 · 滑鼠轉向 · 左鍵近戰 · 右鍵或 F 瞄準＋左鍵射擊 · E 騎乘／下馬 · Tab 裝備 · Esc 訓練選單'
    this.thirdPersonCamera.update(this.input, 0, this.obstacles)
    this.trainingUI?.setDamage(null)
    this.trainingUI?.updateLabels(this.camera)
    this.damageNumbers.clear()
    this.enemyHud.classList.remove('visible')
    this.mountHud.classList.remove('visible')
    this.deathBanner?.classList.remove('visible')
    this.spectatorBadge?.classList.remove('visible')
    this.showDeathBannerOnNextSpectatorLock = false
    if (this.deathBannerTimer !== null) { clearTimeout(this.deathBannerTimer); this.deathBannerTimer = null }
    this._refillTraining()
  }

  private _setInventoryManager(inventory: InventoryManager): void {
    this.inventoryManager?.dispose()
    this.inventoryManager = inventory
  }

  private _changeTrainingCharacter(heroId?: PlayerHeroId): void {
    if (!this.trainingGround) return
    if (this.tutorialLaunch) return
    this._resetTraining()
    this.player.dispose()
    this.player = new Player(this.scene, 'viking', heroId)
    this.basePlayerMaxHp = heroId
      ? getT4HeroCombatModifiers(HERO_COMBAT_PROFILE_BY_ASSET[heroId])!.maxHp
      : getOrdinarySoldierHp('viking', 2)
    this.playerMaxHpOverride = undefined
    this.player.setMaxHp(resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, this.skillManager.skillState))
    this.player.setDamageHud(this.hpBar)
    this._setInventoryManager(createTrainingInventory(heroId))
    this.armyCommandController.setInventory(this.inventoryManager)
    this._bindPlayerCombatCallbacks()
    this._resetTraining()
  }

  private _exitTraining(): void {
    if (!this.trainingGround) return
    if (this.tutorialScene) { this.tutorialScene.returnToTown(); return }
    this.trainingDamageUnsubscribe?.()
    this.trainingUI?.dispose()
    this.sceneListeners.abort()
    this.input.dispose()
    this.equipmentUI.close()
    this._disposeCareerOutpostBattleActors()
    this.trainingGround.dispose()
    this.player.dispose()
    this.inventoryManager?.dispose()
    this.pickupHud?.dispose()
    for (const arrow of this.arrows) arrow.destroy()
    this.arrows.length = 0
    this._aimTargetRegistry.clear()
    this.damageNumbers.clear()
    this.weaponWheelUI.dispose()
    this.soundManager.updateHorseGallopLoops([])
    for (const timer of [this.hintTimer, this.notifyTimer, this.enemyHudTimer, this.deathBannerTimer]) if (timer !== null) clearTimeout(timer)
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    // A fresh document also releases terrain, audio and shared asset caches.
    // Preserve all Career and battle session data; explicit menu bypass owns return.
    if (document.pointerLockElement) document.exitPointerLock()
    window.location.href = `${window.location.pathname}?menu=1${window.location.search.includes('nolock') ? '&nolock' : ''}`
  }

  private _createModelStudio(mode: ModelStudioMode): ModelStudio {
    const game = this
    return new ModelStudio(mode, {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      get player() { return game.player },
      mounts: this.mounts,
      showRiddenMountHud: mount => {
        this.mountNameEl.textContent = `坐騎：${mount.displayName}${mount.armorImpactMax > 0 ? ` · 護甲 ${Math.ceil(mount.armorImpactRemaining)}/${mount.armorImpactMax}` : ''}`
        this.mountHpFill.style.width = '100%'
        this.mountHud.classList.add('visible')
      },
    })
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

  /** Pure official producers reserve the same convoy corridors as the eventual spawn queue. */
  private _campaignSiegeEnvironmentPlan(campaign: DefenseCampaignLaunchConfig): BattleSpawnPlan {
    if (campaign.careerVeteranOutpost) return createCareerVeteranOutpostSpawnPlan(campaign, 'initial')
    if (campaign.careerCommanderOutpost) return createCareerCommanderOutpostSpawnPlan(campaign, 'attackers')
    const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(campaign, 'attackers'))
    positionDefenseCampaignAttackers(plan.npcSpecs, campaign.defenderFaction)
    return plan
  }

  /** All Career initial/wave callers prepare before construction; restore uses the original crew IDs. */
  private _prepareCampaignSiegePlan(plan: BattleSpawnPlan, restorePositions = true): void {
    const campaign = this.defenseCampaignConfig
    if (!campaign || !this.campaignSiegeAssault) return
    const saved = campaign.careerVeteranOutpost || campaign.careerCommanderOutpost
      ? this.careerProfile?.activeMission?.outpostSiege : this._personalOutpostMission()?.battle?.outpostSiege
    const legacyBattle = this._personalOutpostMission()?.battle
    const legacySiege = !saved && (legacyBattle?.attackersStarted || legacyBattle?.wave === 'attackers')
      ? { version: 1 as const, breached: legacyBattle.gate?.state === 'open' || legacyBattle.gate?.state === 'destroyed',
          ramps: [], actors: {}, destroyedPalisadeIds: [] } : undefined
    if (this.campaignSiegeAssault.isPrepared) this.campaignSiegeAssault.trackDeployment(plan.npcSpecs)
    else this.campaignSiegeAssault.prepare(plan.npcSpecs, saved ?? legacySiege)
    if (!restorePositions) return
    for (const spec of plan.npcSpecs) {
      const actor = this._personalOutpostMission()?.battle?.actors[spec.actorId!]
      const position = this.careerProfile?.activeMission?.actorPositions?.[spec.actorId!]
        ?? actor?.checkpoint?.position ?? actor
      if (!position) continue
      const garrison = actor?.checkpoint?.outpostRampartGarrison ?? actor?.outpostRampartGarrison
        ?? ('outpostRampartGarrison' in position ? position.outpostRampartGarrison : undefined)
      spec.x = position.x; spec.z = position.z
      spec.spawnY = outpostCheckpointHeight(position.x, position.z, position.y, garrison === true, campaign.defenderFaction)
      spec.outpostRampartGarrison = garrison === true
    }
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
      undefined,
      undefined,
      undefined,
      spec.spawnY !== undefined ? { y: spec.spawnY } : undefined,
      spec.characterTier,
      spec.heroArchetype,
    ))
    npc.enableBattlefieldEngagement()
    if (spec.outpostRampartGarrison) npc.activateOutpostRampartGarrison()
    npc.respawnEnabled = spec.respawnEnabled
    if (spec.cavalry || Boolean(spec.loadout?.mountId)) {
      const stableKey = spec.actorId ?? `${spec.characterFaction}:${spec.presetId ?? spec.name}:${spec.x}:${spec.z}`
      const variant = horseVariantForStableKey(stableKey)
      const mount = trackNpcSpawn(new Mount(this.scene, mountTypeFromId(spec.loadout?.mountId), spec.x, spec.z, spec.spawnY, variant))
      npc.mountVehicle(mount)
      this.mounts.push(mount)
      this._aimTargetRegistry.registerMount(mount)
    }
    if (this.defenseCampaignConfig?.careerMissionId || this.fieldMissionId) {
      this.careerVeteranActorMounts.set(npc.combatantId, npc.mount)
    }
    ;(this.careerOriginalCommandSquads ??= new Map()).set(npc, spec.squadId)
    const authority = this._careerCommandMission()?.officialSquad
    const officialSquadId = authority && officialActorSquadId(authority, npc.combatantId)
    if (officialSquadId && authority?.missionId === this._careerCommandMission()?.id) {
      npc.setCommandSquad(officialSquadId)
      npc.combatOwnership = 'mission-official'
    }
    this.campaignSiegeAssault?.register(npc, spec)
    this.npcs.push(npc)
    this.battleStats.registerNpc(npc)
    this._aimTargetRegistry.registerNpc(npc)
    return npc
  }

  private _newSpawnBatch(): NpcSpawnBatch {
    const batch = gameplayNpcSpawns.batch(() => {
      this.spawningStopped = true
      this.campaignSiegeAssault?.dispose()
      try { this._showNotify?.('部隊建立失敗', 10000) }
      finally {
        this._disposeCareerOutpostBattleActors()
        if (this.careerProfile) this.onCareerDeploymentError?.(
          this.spawnBatches.find(batch => batch.status === 'failed')?.error ?? new Error('Career NPC spawn failed'))
      }
    })
    this.spawnBatches.push(batch)
    return batch
  }

  /** The entry barrier waits for this initial roster using the shared RAF budget. */
  private _queueCommanderOutpostDeployment(plan: BattleSpawnPlan, campaign: DefenseCampaignLaunchConfig): void {
    if (!campaign.careerCommanderOutpost) throw new Error('Expected Commander Last Stand launch')
    const batch = this._newSpawnBatch()
    this.commanderOutpostDeploymentBatch = batch
    this.commanderOutpostDeploymentTotal = plan.npcSpecs.length
    for (const [index, spec] of plan.npcSpecs.entries()) {
      batch.enqueue(spec.actorId ?? `commander:${index}`, () => {
        const npc = this._spawnNpc(spec)
        this._configureCampaignInitialNpc(npc, campaign)
      })
    }
    batch.seal()
  }

  private _configureCampaignInitialNpc(npc: NPC, campaign: DefenseCampaignLaunchConfig, restorePosition = true): void {
    const careerOutpost = campaign.careerVeteranOutpost ?? campaign.careerCommanderOutpost
    const isOutpostOwner = npc.characterFaction === careerVeteranOutpostOwner(campaign)
    if (isOutpostOwner && (campaign.careerMissionKind !== 'outpost-relief' || !this._originalCareerSquadId(npc))) {
      this.campaignOriginalDefenders.push(npc)
    }
    const defenderFacingYaw = getCampaignDefenderFacingYaw(campaign.defenderFaction)
    const heading = campaign.careerMissionKind === 'outpost-relief' && this._originalCareerSquadId(npc)
      ? defenderFacingYaw + Math.PI
      : careerOutpost && !isOutpostOwner ? defenderFacingYaw + Math.PI : defenderFacingYaw
    npc.group.rotation.y = heading
    if (npc.mount) npc.mount.group.rotation.y = heading
    const commanderAssault = campaign.careerCommanderOutpost?.runtimeState.activePhase === 'assault'
    npc.setTacticalOrder(isOutpostOwner
      ? DEFENSE_CAMPAIGN_RULES.initialDefenderOrder
      : campaign.careerCommanderOutpost
        ? commanderAssault ? npc.squadId === 7 ? 'attack' : 'charge' : 'defend'
        : campaign.careerVeteranOutpost ? 'attack' : DEFENSE_CAMPAIGN_RULES.initialDefenderOrder)
    if (careerOutpost) this._restoreCareerVeteranNpcState(npc, restorePosition)
    else this._restorePersonalOutpostNpc(npc)
    // Rebuild automatic post-breach intent without replaying the global event.
    // Saved player-owned orders remain authoritative, including Defend/Follow.
    const authority = this._careerCommandMission()?.officialSquad
    if (this.previewCampaignBreachController?.breached && !officialPlayerOwnsActor(authority, npc.combatantId)) {
      const saved = this._personalOutpostMission()?.battle?.actors[npc.combatantId]
      const command = saved ? authority?.members?.[npc.combatantId] ?? saved.checkpoint : undefined
      const hasRestoredIntent = !authority?.actorIds.includes(npc.combatantId) && Boolean(command?.order || command?.formation)
      // Legacy Relief attackers may only have resources saved. Keep restored commands,
      // but give actors with no saved intent the same orders as a fresh breached battle.
      if (isOutpostOwner || campaign.careerMissionKind === 'outpost-relief' && !hasRestoredIntent) {
        applyCampaignBreachOrders([npc], opposingCampaignFaction(careerVeteranOutpostOwner(campaign)))
      }
    }
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

  /** One-shot alert transition. Re-issuing it would reset paths and camp-return formations every tick. */
  private _activateMigratedFieldBanditCamp(mission: ActiveCareerMission): void {
    if (mission.sweepAlerted) return
    mission.sweepAlerted = true
    const targets = new Set(mission.targetActorIds)
    const friendlies = new Set(mission.friendlyActorIds)
    for (const npc of this.npcs) {
      if (npc.dead) continue
      if (targets.has(npc.combatantId)) {
        npc.triggerEncounterAlert()
        npc.setTacticalOrder('charge')
      } else if (this.careerFieldDeployment?.kind === 'bandit' && friendlies.has(npc.combatantId)
        && !officialPlayerOwnsActor(mission.officialSquad, npc.combatantId)) {
        npc.setTacticalOrder('charge')
      }
    }
    if (this.careerFieldDeployment?.kind === 'bandit') mission.fieldFriendlyCharge = true
  }

  private _activateMigratedVeteranSquad(mission: ActiveCareerMission, squadId: number): boolean {
    const engaged = new Set(mission.engagedEnemySquadIds ?? [])
    if (engaged.has(squadId)) return false
    engaged.add(squadId)
    mission.engagedEnemySquadIds = [...engaged]
    const squadMap = this.careerFieldDeployment?.enemySquadIdsByActorId ?? {}
    for (const npc of this.npcs) {
      if (!npc.dead && squadMap[npc.combatantId] === squadId) {
        npc.setTacticalOrder(npc.isMounted ? 'charge' : 'attack')
      }
    }
    return true
  }

  private _handleMigratedFieldDamage(event: CombatEvent): void {
    const mission = this.careerProfile?.activeMission
    const deployment = this.careerFieldDeployment
    if (!mission || !deployment || mission.id !== this.felineMissionId) return
    const targetId = resolveFieldDamagedTargetId(event, deployment)
    if (!targetId || !mission.targetActorIds.includes(targetId)) return
    if (deployment.kind === 'veteran-field') {
      const squadId = deployment.enemySquadIdsByActorId[targetId]
      if (squadId !== undefined && this._activateMigratedVeteranSquad(mission, squadId)) {
        this._persistHeavyState('伏兵已驚動；狀態將隨下次戰場存檔重試。')
      }
      return
    }
    if (!mission.sweepAlerted) {
      this._activateMigratedFieldBanditCamp(mission)
      this._persistHeavyState('盜匪已被驚動；狀態將隨下次戰場存檔重試。')
    }
  }

  private _updateMigratedFieldBattle(dt: number, mission: ActiveCareerMission): void {
    const deployment = this.careerFieldDeployment
    const runtimeReady = this.fieldRosterBatch?.ready === true && (!this.personalSquad || this.personalSquad.ready)
    if (!deployment || !runtimeReady || !isMigratedFieldDeploymentReady(mission, runtimeReady)) return
    this.careerFieldCheckClock += dt
    if (this.careerFieldCheckClock < .25) return
    this.careerFieldCheckClock = 0
    const friendlyIds = new Set(mission.friendlyActorIds)
    const enemyIds = new Set(mission.targetActorIds)
    const observers = [
      ...(!this.player.dead ? [{ x: this.player.combatPosition.x, z: this.player.combatPosition.z }] : []),
      ...this.npcs
        .filter(npc => !npc.dead && (friendlyIds.has(npc.combatantId) || npc.combatOwnership === 'player-personal'))
        .map(npc => ({ x: npc.combatPosition.x, z: npc.combatPosition.z })),
    ]
    if (!observers.length) return
    if (deployment.kind === 'veteran-field') {
      const engaged = new Set(mission.engagedEnemySquadIds ?? [])
      const enemies = this.npcs
        .filter(npc => !npc.dead && enemyIds.has(npc.combatantId))
        .map(npc => ({ actorId: npc.combatantId, x: npc.combatPosition.x, z: npc.combatPosition.z }))
      const triggered = findVeteranSquadsInRange(observers, enemies, deployment.enemySquadIdsByActorId, engaged)
      if (triggered.length) {
        let changed = false
        for (const squadId of triggered) changed = this._activateMigratedVeteranSquad(mission, squadId) || changed
        if (changed) this._persistHeavyState('敵軍部隊已投入戰鬥；狀態將隨下次戰場存檔重試。')
      }
      return
    }
    if (deployment.kind === 'cavalry-sweep') {
      const alerted = shouldTriggerSweepAlert(observers, deployment.enemyCenter, Boolean(mission.sweepAlerted))
      if (alerted) {
        const wasAlerted = Boolean(mission.sweepAlerted)
        this._activateMigratedFieldBanditCamp(mission)
        if (!wasAlerted) this._persistHeavyState('盜匪營地已警戒；狀態將隨下次戰場存檔重試。')
      }
      // Alert (80m) only wakes the camp; the friendly charge keeps its own 60m threshold.
      const closeEnough = observers.some(p =>
        Math.hypot(p.x - deployment.enemyCenter.x, p.z - deployment.enemyCenter.z) <= FIELD_SWEEP_CHARGE_DISTANCE)
      if (closeEnough) this._issueMigratedFieldCharge(mission, friendlyIds)
      return
    }
    // Recruit bandits: advance once player nears Captain/campfire or bandits detect friendlies.
    const enemies = this.npcs.filter(npc => !npc.dead && enemyIds.has(npc.combatantId))
    const banditAlerted = Boolean(mission.sweepAlerted)
      || enemies.some(enemy => enemy.encounterIsAlerted || observers.some(obs =>
        Math.hypot(obs.x - enemy.combatPosition.x, obs.z - enemy.combatPosition.z) <= FIELD_BANDIT_DETECTION_RANGE))
    if (banditAlerted) {
      const wasAlerted = Boolean(mission.sweepAlerted)
      this._activateMigratedFieldBanditCamp(mission)
      if (!wasAlerted) this._persistHeavyState('營地盜匪已發現我方；狀態將隨下次戰場存檔重試。')
      return
    }
    const captain = deployment.captainActorId ? this.npcs.find(n => n.combatantId === deployment.captainActorId && !n.dead) : undefined
    const engage = this.player.dead
      || (captain && Math.hypot(this.player.combatPosition.x - captain.combatPosition.x, this.player.combatPosition.z - captain.combatPosition.z) <= 14)
      || Math.hypot(this.player.combatPosition.x - deployment.enemyCenter.x, this.player.combatPosition.z - deployment.enemyCenter.z) <= 48
    if (engage) this._issueMigratedFieldCharge(mission, friendlyIds)
  }

  /** Charge is a state transition: only actors not already charging get the (path-resetting) order. */
  private _issueMigratedFieldCharge(mission: ActiveCareerMission, friendlyIds: ReadonlySet<string>): void {
    if (mission.fieldFriendlyCharge) return
    mission.fieldFriendlyCharge = true
    for (const npc of this.npcs) {
      if (npc.dead || !friendlyIds.has(npc.combatantId) || npc.tacticalOrder === 'charge') continue
      if (officialPlayerOwnsActor(mission.officialSquad, npc.combatantId)) continue
      npc.setTacticalOrder('charge')
    }
    this._persistHeavyState('友軍已發動衝鋒；狀態將隨下次戰場存檔重試。')
  }

  /** The mission-wide order of one heavy-cavalry actor; formation holds use real formation targets. */
  private _applyHeavyFieldOrder(npc: NPC, mission: ActiveCareerMission): void {
    const state = mission.commanderMission?.heavyField
    if (!state || !isCareerHeavyFieldBattle(mission)) return
    const side = npc.faction === Faction.PLAYER ? 'friendly' : 'enemy'
    const plan = heavyCommandPlan(mission.templateId, side, state)
    const facing = new THREE.Vector3(0, 0, npc.faction === Faction.PLAYER === (this.careerProfile?.faction === 'viking') ? -1 : 1)
    if (plan.kind === 'charge' || plan.kind === 'plain') { npc.setTacticalOrder(plan.order); return }
    if (plan.kind === 'march') {
      const captainId = this.heavyDeployment?.captainActorId
      const captain = captainId ? this.npcs.find(candidate => candidate.combatantId === captainId && !candidate.dead) : undefined
      const ambush = this.heavyDeployment?.ambushPoint
      if (captain && ambush && npc === captain) npc.assignFormationTarget(-3, new THREE.Vector3(ambush.x, getTerrainHeight(ambush.x, ambush.z), ambush.z), facing, 3.2)
      else if (captain) npc.assignFollowTarget(captain, this.npcs.indexOf(npc) % 74)
      return
    }
    // Hold: friendly formation slots (Soldier after Formation, Veteran) and Captain enemies where they stand.
    if (side === 'friendly' && officialPlayerOwnsActor(mission.officialSquad, npc.combatantId)) { npc.setTacticalOrder('defend'); return }
    const slot: HeavyPoint | undefined = this.heavyDeployment?.formationSlots[npc.combatantId] ?? (side === 'enemy' ? { x: npc.combatPosition.x, z: npc.combatPosition.z } : undefined)
    if (slot) npc.assignFormationTarget(-3, new THREE.Vector3(slot.x, getTerrainHeight(slot.x, slot.z), slot.z), facing, undefined, 'defend', side === 'enemy' || !HEAVY_FIELD_SPECS[mission.templateId].startsMarching)
    else npc.setTacticalOrder(plan.order)
  }

  private _persistHeavyState(notify: string): void {
    if (!this._persistCareerBattle(true)) this._showNotify(notify, 1800)
  }

  private _handleHeavyEnemyDamage(event: CombatEvent): void {
    const mission = this.careerProfile?.activeMission
    const state = mission?.commanderMission?.heavyField
    if (!mission || !state || !isCareerHeavyFieldBattle(mission) || mission.id !== this.felineMissionId) return
    if (!shouldTriggerHeavyEnemyCharge(mission.templateId, state, event, new Set(mission.targetActorIds))) return
    state.enemyChargeTriggered = true
    this.felineChargeUnsubscribe?.(); this.felineChargeUnsubscribe = undefined
    const targets = new Set(mission.targetActorIds)
    for (const npc of this.npcs) if (!npc.dead && targets.has(npc.combatantId)) npc.setTacticalOrder('charge')
    this.soundManager.playCommanderCommand(this.careerProfile!.faction === 'roman' ? 'viking' : 'roman', 'charge')
    this._persistHeavyState('敵軍已衝鋒；狀態將隨下次戰場存檔重試。')
  }

  /** Throttled march / formation / 20m counter-charge checks (4 Hz). */
  private _updateHeavyField(dt: number, mission: ActiveCareerMission): void {
    const state = mission.commanderMission?.heavyField
    if (!state || !isCareerHeavyFieldBattle(mission) || mission.commanderMission?.deploymentComplete !== true) return
    this.heavyCheckClock += dt
    if (this.heavyCheckClock < .25) return
    this.heavyCheckClock = 0
    const spec = HEAVY_FIELD_SPECS[mission.templateId]
    const friendlyIds = new Set(mission.friendlyActorIds), enemyIds = new Set(mission.targetActorIds)
    if (spec.startsMarching && !state.formationIssued) {
      const captainId = this.heavyDeployment?.captainActorId
      const captain = captainId ? this.npcs.find(npc => npc.combatantId === captainId && !npc.dead) : undefined
      const ambush = this.heavyDeployment?.ambushPoint
      if (ambush && this.player && !this.player.dead) {
        this.heavyGuide ??= new MissionGuide('heavy-march-guide')
        const target = new THREE.Vector3(captain?.combatPosition.x ?? ambush.x, 0, captain?.combatPosition.z ?? ambush.z)
        this.heavyGuide.updateRace(this.player.position, this.thirdPersonCamera.cameraYaw, target, '跟隨隊長')
      }
      if (!captain || ambush && shouldIssueHeavyFormation(state, captain.combatPosition, ambush)) {
        state.formationIssued = true
        this.heavyGuide?.dispose(); this.heavyGuide = null
        for (const npc of this.npcs) if (!npc.dead && friendlyIds.has(npc.combatantId)) this._applyHeavyFieldOrder(npc, mission)
        this.soundManager.playCommanderCommand(this.careerProfile!.faction, 'formation')
        this._persistHeavyState('隊形已完成；狀態將隨下次戰場存檔重試。')
      }
      return
    }
    if (spec.startsMarching && !state.enemyReleased) {
      this.heavyFormationElapsed += .25
      const slots = this.heavyDeployment?.formationSlots ?? {}
      const distances = this.npcs.filter(npc => !npc.dead && friendlyIds.has(npc.combatantId) && slots[npc.combatantId])
        .map(npc => Math.hypot(npc.combatPosition.x - slots[npc.combatantId].x, npc.combatPosition.z - slots[npc.combatantId].z))
      if (isHeavyFormationComplete(distances, this.heavyFormationElapsed)) {
        state.enemyReleased = true
        for (const npc of this.npcs) if (!npc.dead && enemyIds.has(npc.combatantId)) this._applyHeavyFieldOrder(npc, mission)
        this._persistHeavyState('敵軍已進攻；狀態將隨下次戰場存檔重試。')
      }
    }
    if (state.counterChargeTriggered) return
    const friendly: HeavyPoint[] = [], enemy: HeavyPoint[] = []
    for (const npc of this.npcs) {
      if (npc.dead) continue
      const point = { x: npc.combatPosition.x, z: npc.combatPosition.z }
      if (enemyIds.has(npc.combatantId)) enemy.push(point)
      else if (friendlyIds.has(npc.combatantId) || npc.combatOwnership === 'player-personal') friendly.push(point)
    }
    if (spec.counterCharge === 'enemy' && !this.player.dead) friendly.push({ x: this.player.position.x, z: this.player.position.z })
    if (!friendly.length || !enemy.length || !shouldTriggerHeavyCounterCharge(state, heavyFrontlineDistance(friendly, enemy))) return
    state.counterChargeTriggered = true
    const chargers = spec.counterCharge === 'friendly' ? friendlyIds : enemyIds
    for (const npc of this.npcs) if (!npc.dead && chargers.has(npc.combatantId)) npc.setTacticalOrder('charge')
    const side = spec.counterCharge === 'friendly' ? this.careerProfile!.faction : this.careerProfile!.faction === 'roman' ? 'viking' : 'roman'
    this.soundManager.playCommanderCommand(side, 'charge')
    this._persistHeavyState('反衝鋒已觸發；狀態將隨下次戰場存檔重試。')
  }

  private _handleFelineVanguardDamage(event: CombatEvent): void {
    const liveMission = this.careerProfile?.activeMission
    if (!this.felineMissionId || !liveMission || liveMission.id !== this.felineMissionId
      || !shouldTriggerFelineVanguardCharge(liveMission, event)) return
    // Combat takes effect before persistence: a lethal first hit cannot lose Charge.
    // Failed writes retain the live mark for the existing periodic checkpoint retry.
    const next = cloneCareerProfile(this.careerProfile!)
    const mission = next.activeMission
    if (!mission || mission.id !== this.felineMissionId) return
    if (!dispatchFelineVanguardCharge(mission, event, () => {
      this.careerProfile = next
      this.felineChargeUnsubscribe?.()
      this.felineChargeUnsubscribe = undefined
      const targets = new Set(mission.targetActorIds)
      for (const npc of this.npcs) if (!npc.dead && targets.has(npc.combatantId)) npc.setTacticalOrder('charge')
      const enemyFaction = next.faction === 'roman' ? 'viking' : 'roman'
      this.soundManager.playCommanderCommand(enemyFaction, 'charge')
    })) return
    if (!this.careerStore.save(next)) this._showNotify('敵軍已衝鋒；狀態將隨下次戰場存檔重試。')
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

  private _personalOutpostMission() {
    return this.defenseCampaignConfig?.careerMissionKind === 'captain-outpost-defense'
      ? this.careerProfile?.activeMission : this.careerProfile?.activeOutpostMission
  }

  /** Only this battle's saved permission and actual NPCs contribute to command counts. */
  private readonly careerHudTypes = new CareerCommandHudTypes()
  private _careerCommandHudRoster() {
    const profile = this.careerProfile
    if (!profile) return undefined
    const mission = profile.activeMission ?? profile.activeOutpostMission
    const current = profile.activeMission ?? profile.activeOutpostMission
    const official = current?.officialSquad?.type === 'mission-official'
      && current.officialSquad.missionId === current.id ? current.officialSquad : undefined
    const accepted = mission?.personalSquad
    const live = this.personalSquad?.hudMission
    const sameRoster = Boolean(accepted && live
      && accepted.memberIds.length === live.memberIds.length
      && accepted.memberIds.every((id, index) => id === live.memberIds[index]))
    const personal: PersonalSquadMission | undefined = accepted
      ? sameRoster ? { ...accepted, members: live!.members } : accepted : undefined
    return careerCommandHudRoster({
      unitTypes: this.careerHudTypes.read(profile),
      personalMembers: profile.personalSquad?.members,
      sceneKey: this.bridgeLaunch ? `bridge:${this.fieldMissionId}`
        : this.felineMissionId ? `feline:${this.felineMissionId}`
        : this.captainEagleMissionId ? `eagle:${this.captainEagleMissionId}` : `outpost:${mission?.id ?? 'free'}`,
      faction: profile.faction,
      ...(mission ? { missionId: mission.id } : {}),
      official,
      officialPending: Boolean(official && !this._careerCommandFinished() && !this.spawningStopped && (
        !this.bridgeLaunch && this.fieldRosterBatch && !this.fieldRosterBatch.ready
        || this.defenseCampaignConfig?.careerCommanderOutpost && !this.commanderOutpostDeploymentBatch?.ready
        || this.defenseCampaignConfig?.careerMissionId && !this.defenseCampaignConfig.careerCommanderOutpost
          && !this.campaignReinforcementSpawned)),
      personal,
      personalPendingIds: this.personalSquad?.hudPendingIds,
      personalReturningIds: this.personalSquad?.hudReturningIds,
      actors: this.npcs,
    })
  }

  private _careerCommandMission() { return this.careerProfile?.activeMission ?? this.careerProfile?.activeOutpostMission }
  private _careerCommandFinished(): boolean {
    const mission = this._careerCommandMission()
    return Boolean(this.careerProfile?.activeMission?.result || mission && this.careerProfile?.claimedBattleIds.includes(mission.id))
  }
  private get hasCareerOfficialCommand(): boolean {
    const mission = this._careerCommandMission(), authority = mission?.officialSquad
    return Boolean(authority?.type === 'mission-official' && authority.missionId === mission?.id
      && authority.townFaction === this.careerProfile?.faction
      && (authority.commandRank !== 'commander' || this.careerProfile?.rank === 'commander'))
  }

  private _snapshotOfficialCommand(authority: OfficialCommandAuthority | undefined): void {
    if (!authority) return
    authority.contribution = this.battleStats.officialCommandCheckpoint()
    const squadStats = this.battleStats.officialSquadCheckpoints()
    for (const squad of authority.squads ?? []) squad.contribution = squadStats.find(entry => entry.squadId === squad.squadId)?.contribution ?? squad.contribution
    authority.members = { ...authority.members }
    for (const npc of this.npcs) if (authority.actorIds.includes(npc.combatantId)) {
      authority.members[npc.combatantId] = snapshotCommandActor(npc, this.careerVeteranActorMounts.get(npc.combatantId) ?? undefined)
    }
  }

  private _acceptsOfficialCommand(npc: NPC): boolean {
    const mission = this._careerCommandMission(), authority = mission?.officialSquad
    return Boolean(mission && !this._careerCommandFinished() && authority?.missionId === mission.id
      && (authority.commandRank !== 'commander' || this.careerProfile?.rank === 'commander')
      && officialCommandAcceptsActor(authority, npc))
  }

  private _prepareOfficialCommand(order: TacticalOrder | 'dismiss', participants: readonly NPC[], assignments?: readonly FormationCommandAssignment[]): boolean {
    const next = this.careerProfile && stageOfficialCommandOrder(this.careerProfile, participants, order, assignments,
      npc => snapshotCommandActor(npc, this.careerVeteranActorMounts.get(npc.combatantId) ?? undefined))
    if (!next) return true
    if (!this.careerStore.save(next)) { this._showNotify('命令尚未保存，部隊維持原指揮權。'); return false }
    this.careerProfile = next
    return true
  }

  private _officialCommandAuthority(): ArmyCommandAuthority {
    return {
      accepts: npc => this._acceptsOfficialCommand(npc) || this.personalSquad?.owns(npc) === true,
      enabled: () => !this.player.dead && this.controlMode === 'player' && !this._careerCommandFinished(),
      beforeIssue: (order, _target, participants, assignments) => this._prepareOfficialCommand(order, participants, assignments),
      issue: (order, target) => {
        const actors = this.npcs.filter(npc => this._acceptsOfficialCommand(npc) && matchesArmyCommandTarget(npc, target))
        if (!this._prepareOfficialCommand(order, actors)) return false
        let accepted = false
        if ((target === 'all' || target === 'squad:personal') && this.personalSquad) {
          accepted = order === 'follow' ? this.personalSquad.follow() : this.personalSquad.dismiss()
        }
        for (const npc of actors) {
          const slot = this._careerCommandMission()!.officialSquad!.actorIds.indexOf(npc.combatantId)
          npc.missionMovement = false
          if (order === 'follow') npc.assignFollowTarget(this.player, slot,
            officialFollowLocalOffset(slot, npc.isMounted, Boolean(this.careerProfile?.personalSquad?.members.length)))
          else {
            const reinforcement = npc.combatantId.startsWith(`${this._careerCommandMission()?.id}:reinforcement:`)
            npc.setTacticalOrder(this.captainEagleMissionId || reinforcement || this.previewCampaignGate?.state === 'destroyed'
              || this.defenseCampaignConfig?.careerMissionKind === 'veteran-outpost-assault' ? 'attack' : 'defend')
            this.reliefMarch?.resumeActor(npc)
            this.veteranReinforcementMarch?.resumeActor(npc)
            this.veteranOutpostMarch?.resumeActor(npc)
          }
          accepted = true
        }
        if (accepted) {
          this.soundManager.playCareerMissionVoice(this.careerProfile!.faction, order === 'follow' ? 'follow' : 'dismiss')
          this._persistPersonalOutpost(true)
        }
        return accepted
      },
    }
  }

  /** The first roster checkpoint must record the real Career HP pool, not the pre-skill base. */
  private _applyCareerPlayerHealthForCheckpoint(): void {
    if (!this.careerProfile || this.fieldCheckpoint) return
    this.player.setMaxHp(resolveCareerPlayerMaxHp(this.careerProfile, this.basePlayerMaxHp))
    this.player.setHp(this.player.maxHp)
  }

  /** Save the entire declaration before the first scheduled actor may materialize. */
  private _declareFieldBattleRoster(plan: BattleSpawnPlan): void {
    const next = cloneCareerProfile(this.careerProfile!)
    const mission = next.activeMission!
    if (this.fieldCheckpoint) return
    if (this.felineMissionId && this.careerFieldDeployment) {
      const playerMountId = (this.startingHorseMountId ?? next.selectedMountId) as CareerMountId | undefined
      mission.felineBattle = createCareerFieldCheckpointSeed(mission, plan, {
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        stamina: this.player.staminaValue,
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.group.rotation.y,
        ammo: this.player.arrowCount,
        shieldImpact: this.player.shield.shieldImpactRemaining,
        stats: this.battleStats.checkpoint(),
        mount: this.startingHorse ? {
          mountId: playerMountId,
          hp: this.startingHorse.currentHp,
          armorImpactRemaining: this.startingHorse.armorImpactRemaining,
          mounted: this.player.currentMount === this.startingHorse,
        } : undefined,
        profileMountArmor: next.mountArmor,
      }, (x, z) => getTerrainHeight(x, z))
      if (!this.careerStore.save(next)) throw new Error('Career field roster declaration could not be saved')
      this.careerProfile = next
      return
    }
    const actors: CaptainEagleCheckpoint['actors'] = {}
    const declaration = this.bridgeLaunch ? createBridgeheadRoster(mission, next.faction) : undefined
    for (const spec of declaration ? [...declaration.friendly, ...declaration.enemy] : plan.npcSpecs) {
      if (!spec.actorId) throw new Error('Captain Eagle actor is missing its saved identity')
      actors[spec.actorId] = { status: 'reserve', position: { x: spec.x, y: getTerrainHeight(spec.x, spec.z), z: spec.z,
        yaw: this.bridgeLaunch ? spec.faction === Faction.PLAYER ? 0 : Math.PI : spec.characterFaction === 'roman' ? 0 : Math.PI } }
    }
    mission[this.fieldCheckpointKey] = { actors, ready: false, playerStats: this.battleStats.checkpoint(), player: {
      ...snapshotCheckpointPlayer(this.player),
      ...(mission.mountState?.hp.xongkoro !== undefined ? { mountHp: mission.mountState.hp.xongkoro } : {}),
    } }
    if (!this.careerStore.save(next)) throw new Error('Captain Eagle roster declaration could not be saved')
    this.careerProfile = next
  }

  private _queueFieldBattleRoster(plan: BattleSpawnPlan, restoreOrphans = true): void {
    const mission = this.careerProfile!.activeMission!
    const saved = this.fieldCheckpoint!
    const batch = this._newSpawnBatch()
    this.fieldRosterBatch = batch
    for (const spec of plan.npcSpecs) {
      const actor = resolveFieldActorCheckpoint(mission, spec.actorId!, saved.actors[spec.actorId!])
      if (actor?.status === 'dead' || actor?.hp === 0) continue
      batch.enqueue(spec.actorId!, () => {
        const npc = this._spawnNpc(spec)
        npc.group.rotation.y = this.careerFieldDeployment
          ? (spec.faction === Faction.PLAYER ? this.careerFieldDeployment.playerYaw : this.careerFieldDeployment.playerYaw + Math.PI)
          : this.bridgeLaunch ? spec.faction === Faction.PLAYER ? 0 : Math.PI : spec.characterFaction === 'roman' ? 0 : Math.PI
        if (npc.mount) npc.mount.group.rotation.y = npc.group.rotation.y
        if (this.felineMissionId && this.careerFieldDeployment && spec.faction !== Faction.PLAYER) {
          if (this.careerFieldDeployment.kind === 'bandit' || this.careerFieldDeployment.kind === 'cavalry-sweep') {
            const center = this.careerFieldDeployment.campfireCenter ?? this.careerFieldDeployment.enemyCenter
            npc.configureBanditEncounter(new THREE.Vector3(center.x, 0, center.z), [new THREE.Vector3(spec.x, 0, spec.z)],
              this.careerFieldDeployment.kind === 'cavalry-sweep' ? Infinity : undefined)
            if (mission.sweepAlerted) npc.triggerEncounterAlert()
          }
        }
        if (this.felineMissionId && isCareerHeavyFieldBattle(mission)) this._applyHeavyFieldOrder(npc, mission)
        else npc.setTacticalOrder(this.felineMissionId
          ? careerFieldTacticalOrder(mission, npc.faction)
          : npc.faction === Faction.PLAYER ? 'defend' : this.bridgeLaunch ? 'charge' : 'attack')
        if (this.felineMissionId && this.careerFieldDeployment?.kind === 'veteran-field' && spec.faction !== Faction.PLAYER) {
          const squadId = this.careerFieldDeployment.enemySquadIdsByActorId[spec.actorId!]
          if (squadId !== undefined && (mission.engagedEnemySquadIds ?? []).includes(squadId)) {
            npc.setTacticalOrder(npc.isMounted ? 'charge' : 'attack')
          }
        }
        const controlled = officialPlayerOwnsActor(mission.officialSquad, npc.combatantId)
        const restoreOrder = !mission.officialSquad?.actorIds.includes(npc.combatantId) || controlled
        if (actor) restoreCommandActor(npc, restoreOrder ? actor : { ...actor, order: undefined, formation: undefined }, this.careerVeteranActorMounts.get(npc.combatantId) ?? undefined)
        // The persisted one-shot trigger is authoritative over an older actor checkpoint.
        // This intentionally restores Charge without replaying the voice/horn.
        if (this.felineMissionId && npc.faction === Faction.ENEMY && mission.commanderMission?.felineChargeTriggered) {
          npc.setTacticalOrder('charge')
        }
        if (this.felineMissionId && isCareerHeavyFieldBattle(mission) && !controlled) this._applyHeavyFieldOrder(npc, mission)
        if (controlled && actor?.order === 'follow' && !this.player.dead) {
          const index = mission.officialSquad?.actorIds.indexOf(npc.combatantId) ?? -1
          if (index >= 0) npc.assignFollowTarget(this.player, index, officialFollowLocalOffset(index, npc.isMounted, Boolean(this.careerProfile?.personalSquad?.members.length)))
        }
        if (!this.bridgeLaunch && !this.felineMissionId && !this._persistCareerBattle(true)) throw new Error('Captain Eagle actor checkpoint could not be saved')
      })
    }
    if ((this.bridgeLaunch || this.felineMissionId) && restoreOrphans) for (const orphan of (this.bridgeLaunch
      ? createCareerBridgeOrphanMountPlan(this.careerProfile!) : createCareerFelineOrphanMountPlan(this.careerProfile!))) {
      batch.enqueue(`${orphan.actorId}:orphan-mount`, () => {
        const p = orphan.saved.position
        const mount = trackNpcSpawn(new Mount(this.scene, mountTypeFromId(orphan.mountId), p.x, p.z, undefined,
          orphan.stableKey ? horseVariantForStableKey(orphan.stableKey) : 0))
        mount.currentHp = Math.min(mount.maxHp, orphan.saved.hp)
        mount.restoreArmor(orphan.saved.armorImpactRemaining)
        mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z)
        mount.group.rotation.y = p.yaw
        if (orphan.saved.flight && mount.flight) {
          mount.flight.restore(orphan.saved.flight)
          mount.group.rotation.set(-orphan.saved.flight.pitch, orphan.saved.flight.yaw, orphan.saved.flight.bank, 'YXZ')
        }
        this.careerVeteranActorMounts.set(orphan.actorId, mount)
        this.mounts.push(mount); this._aimTargetRegistry.registerMount(mount)
      })
    }
    batch.seal(() => {
      if (!this.bridgeLaunch && !this.felineMissionId && !this._persistCareerBattle(true)) throw new Error('Career field deployment could not be saved')
    })
  }

  private _buildCareerBattleCheckpoint(): ActiveCareerMission | null {
    const mission = cloneCareerProfile(this.careerProfile!).activeMission
    if (!mission || !this.careerBattleCheckpoint) return null
    mission.playerStats = this.battleStats.checkpoint()
    mission.playerDead = this.player.dead
    mission.playerHp = this.player.hp
    mission.playerStamina = this.player.staminaValue
    const personal = this.personalSquad?.checkpoint()
    if (personal) { personal.contribution = this.battleStats.commandCheckpoint(); mission.personalSquad = personal }
    if (mission.officialSquad) {
      mission.officialSquad.contribution = this.battleStats.officialCommandCheckpoint()
      const squadStats = this.battleStats.officialSquadCheckpoints()
      for (const squad of mission.officialSquad.squads ?? []) {
        squad.contribution = squadStats.find(entry => entry.squadId === squad.squadId)?.contribution ?? squad.contribution
      }
      mission.officialSquad.members = { ...mission.officialSquad.members }
      for (const npc of this.npcs) if (mission.officialSquad.actorIds.includes(npc.combatantId)) {
        mission.officialSquad.members[npc.combatantId] = snapshotCommandActor(npc,
          this.careerVeteranActorMounts.get(npc.combatantId) ?? undefined)
      }
    }
    const mount = this.startingHorse
    if (mount) {
      const id = this.fieldPlayerMountId
      if (id) mission.mountState = { ...mission.mountState, hp: { ...mission.mountState?.hp, [id]: mount.dead ? 0 : mount.currentHp },
        armorImpact: { ...mission.mountState?.armorImpact, [id]: mount.armorImpactRemaining },
        unavailable: [...new Set([...(mission.mountState?.unavailable ?? []), ...(mount.dead ? [id] : [])])],
        ...(this.player.currentMount === mount ? { activeMountId: id } : {}) }
    }
    if (this.fieldMissionId) {
      const previous = this.fieldCheckpoint!
      if (!previous) return mission
      const actors = { ...previous.actors }
      for (const npc of this.npcs) if (npc.combatOwnership !== 'player-personal') actors[npc.combatantId] = snapshotCommandActor(npc,
        this.careerVeteranActorMounts.get(npc.combatantId) ?? undefined)
      if (this.bridgeLaunch || this.felineMissionId) for (const [id, homeMount] of this.careerVeteranActorMounts) {
        const saved = actors[id] ?? mission.personalSquad?.members[id]
        if (homeMount && saved?.status === 'dead') saved.mount = snapshotCheckpointMount(homeMount, false)
      }
      const playerMount = this.bridgeLaunch || this.felineMissionId ? this.player.currentMount ?? mount : mount
      const mountActorId = (this.bridgeLaunch || this.felineMissionId) && playerMount && playerMount !== mount
        ? [...this.careerVeteranActorMounts].find(([, owned]) => owned === playerMount)?.[0] : undefined
      const ready = this.fieldRosterBatch?.ready === true && (!this.personalSquad || this.personalSquad.ready)
      mission[this.fieldCheckpointKey] = { actors, ready, playerStats: mission.playerStats, player: {
        ...snapshotCheckpointPlayer(this.player),
        ...(this.player.isFalling ? { fall: this.player.fallSnapshot } : {}),
        ...(mountActorId ? { mountActorId } : {}),
        ...((this.bridgeLaunch || this.felineMissionId) && mount && playerMount !== mount ? { homeMount: snapshotCheckpointMount(mount, false) } : {}),
        ...(playerMount ? { mountHp: playerMount.dead ? 0 : playerMount.currentHp,
          mount: snapshotCheckpointMount(playerMount, this.player.currentMount === playerMount) } : {}),
      } }
      if (this.felineMissionId && mission.commanderMission) mission.commanderMission.deploymentComplete = ready
      if (this.bridgeLaunch) {
        mission.bridgeDeployment = { ...this.bridgeRuntime!.deployment }
        this.bridgeRuntime!.observe(mission, this.npcs)
        mission.deadTargetActorIds = [...this.bridgeRuntime!.deadTargets]
        mission.deadFriendlyActorIds = [...this.bridgeRuntime!.deadFriendly]
        mission.commanderMission!.deploymentComplete = ready && mission.bridgeDeployment.phase === 'assault'
      }
      if (!mission.result) mission.phase = this.bridgeRuntime?.deployment.phase === 'preparing' ? 'PREPARING'
        : ready ? 'ENGAGING' : 'ASSEMBLING'
    } else {
      const runtime = this.defenseCampaignRuntime?.getSnapshot()
      if (!runtime) return null
      const actors = { ...mission.battle?.actors }
      for (const npc of this.npcs) if (npc.combatOwnership !== 'player-personal') {
        const ownedMount = this.careerVeteranActorMounts.get(npc.combatantId)
        actors[npc.combatantId] = { hp: npc.hp, x: npc.combatPosition.x, y: npc.combatPosition.y, z: npc.combatPosition.z,
          ...(npc.isOutpostRampartGarrisonActive ? { outpostRampartGarrison: true } : {}),
          yaw: npc.mount?.group.rotation.y ?? npc.group.rotation.y,
          checkpoint: snapshotCommandActor(npc, ownedMount ?? undefined),
          ...(ownedMount ? { mountHp: ownedMount.dead ? 0 : ownedMount.currentHp } : {}) }
      }
      mission.battle = { runtime, actors, outpostSiege: this.campaignSiegeAssault?.snapshot(), player: {
        hp: this.player.hp, stamina: this.player.staminaValue, dead: this.player.dead,
        x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw: this.player.currentMount?.group.rotation.y ?? this.player.group.rotation.y,
        ammo: this.player.arrowCount, shieldImpact: this.player.shield.shieldImpactRemaining,
        ...(mount ? { mountArmorImpact: mount.armorImpactRemaining, mountHp: mount.dead ? 0 : mount.currentHp, mounted: this.player.currentMount === mount,
          mountPosition: { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z, yaw: mount.group.rotation.y } } : {}),
      }, playerStats: mission.playerStats, wave: this.campaignSpawnWave, waveIndex: this.campaignSpawnQueueIndex,
      attackersStarted: this.campaignAttackersStarted, reinforcementsSpawned: this.campaignReinforcementSpawned,
      ...(this.previewCampaignGate ? { gate: { hp: this.previewCampaignGate.damageable.currentHp, state: this.previewCampaignGate.state } } : {}),
      }
      if (!mission.result) mission.phase = runtime.activePhase === 'deployment' ? 'PREPARING' : 'ENGAGING'
    }
    return mission
  }

  private _captureOwnedMountArmor(profile: CareerProfile): void {
    const id = this.defenseCampaignConfig?.playerLoadout.mountId ?? this.bridgeLaunch?.battle.playerLoadout?.mountId ?? profile.selectedMountId
    if (id && this.startingHorse?.armorImpactMax) profile.mountArmor = { ...profile.mountArmor, [id]: this.startingHorse.armorImpactRemaining }
  }

  private _commitCareerBattleCheckpoint(profile: CareerProfile): boolean {
    this._captureOwnedMountArmor(profile)
    if (!this.fieldMissionId && this.player) {
      profile.playerAerialState = captureCareerAerialState(this.player, `outpost:${this.defenseCampaignConfig?.careerMissionId}`)
    }
    const saved = this.careerStore.save(profile)
    if (saved) this.careerProfile = profile
    return saved
  }

  private _persistCareerBattle(force = false, dt = 0): boolean {
    if (this.initializing || this.spawningStopped || !this.careerBattleCheckpoint || !this.careerProfile) return !this.careerBattleCheckpoint
    this.careerBattleCheckpoint.advance(dt)
    return this.careerBattleCheckpoint.persist(() => this._buildCareerBattleCheckpoint() ?? this.careerProfile!.activeMission!,
      { immediate: force, periodic: true }) || !force
  }

  /** Publish each deployment phase before allowing its spawn/combat side effects. */
  private _saveBridgeDeployment(state: BridgeBattleDeployment): boolean {
    return this.careerBattleCheckpoint!.persist(() => {
      const mission = this._buildCareerBattleCheckpoint()!
      mission.bridgeDeployment = { ...state }
      mission.commanderMission!.deploymentComplete = state.phase === 'assault' && this.fieldRosterBatch?.ready === true
      mission.phase = state.phase === 'assault' ? 'ENGAGING' : 'ASSEMBLING'
      return mission
    }, { immediate: true })
  }

  private _restoreFieldBattlePlayer(): void {
    const saved = this.fieldCheckpoint?.player
    if (!saved) return
    const mount = saved.mountActorId ? this.careerVeteranActorMounts.get(saved.mountActorId) : this.startingHorse
    if (saved.mountActorId && !mount) throw new Error('Saved borrowed Career mount missing after field roster deployment')
    const migratedMount = resolveMigratedPlayerMountState(
      this.careerProfile?.activeMission,
      this.fieldPlayerMountId,
      this.careerProfile?.mountArmor,
    )
    if (saved.mountActorId && this.startingHorse) {
      this.startingHorse.restoreArmor(saved.homeMount?.armorImpactRemaining ?? migratedMount.armorImpact ?? this.startingHorse.armorImpactRemaining)
      const hp = saved.homeMount?.hp ?? migratedMount.hp
      if (typeof hp === 'number') {
        if (hp <= 0) { this.startingHorse.takeDamage(this.startingHorse.maxHp + 1); this.player.dismountFromMount() }
        else this.startingHorse.currentHp = Math.min(this.startingHorse.maxHp, hp)
      }
      if (saved.homeMount) {
        const p = saved.homeMount.position
        this.startingHorse.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z)
        this.startingHorse.group.rotation.y = p.yaw
        if (saved.homeMount.flight && this.startingHorse.flight && !this.startingHorse.dead) this.startingHorse.flight.restore(saved.homeMount.flight)
      }
    }
    if (saved.mountActorId && saved.mount?.mounted === false && this.player.isMounted) {
      this.player.dismountFromMount({ preserveWorldPosition: true })
    }
    if (mount) {
      mount.restoreArmor(saved.mount?.armorImpactRemaining ?? (saved.mountActorId ? undefined : migratedMount.armorImpact) ?? mount.armorImpactRemaining)
      const hp = saved.mount?.hp ?? saved.mountHp ?? (saved.mountActorId ? undefined : migratedMount.hp)
      if (hp !== undefined) {
        if (hp <= 0) { mount.takeDamage(mount.maxHp + 1); this.player.dismountFromMount() }
        else mount.currentHp = Math.min(mount.maxHp, hp)
      }
      if (saved.mount) {
        if (!saved.mount.mounted && this.player.currentMount === mount) this.player.dismountFromMount()
        if (saved.mount.mounted && !saved.dead && !mount.dead && this.player.currentMount !== mount) this._mountPlayer(mount, saved.mount.position.yaw)
        const p = saved.mount.position
        mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
        if (saved.mount.flight && mount.flight && !mount.dead) {
          mount.flight.restore(saved.mount.flight)
          mount.group.rotation.set(-saved.mount.flight.pitch, saved.mount.flight.yaw, saved.mount.flight.bank, 'YXZ')
        }
      }
    }
    const p = saved.position
    this.player.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z) + .95, p.z)
    this.player.faceDirection(Math.sin(p.yaw), Math.cos(p.yaw))
    this.player.setHp(saved.hp); this.player.setStamina(saved.stamina); this.player.setArrowCount(saved.ammo)
    this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.shieldImpact)
    if (saved.fall) { this.player.dismountFromMount(); this.player.restorePendingFall(saved.fall) }
    if (saved.dead) { this.player.detachFromMountOnDeath(); this.player.takeDamage(this.player.maxHp * 100, this.hpBar) }
  }

  private _updateCareerBattle(dt: number): void {
    if (!this.careerBattleCheckpoint) return
    const mission = this.careerProfile!.activeMission!
    if (this.player.dead) for (const npc of this.npcs) {
      if (!npc.dead && npc.tacticalOrder === 'follow' && mission.officialSquad?.actorIds.includes(npc.combatantId)) {
        const offset = npc.activeFollowLocalOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.group.rotation.y)
        const target = this.player.combatPosition.clone().add(offset)
        npc.assignFormationTarget(-900, target, new THREE.Vector3(Math.sin(this.player.group.rotation.y), 0, Math.cos(this.player.group.rotation.y)), undefined, 'defend')
      }
    }
    if (!this.fieldMissionId) return
    if (this.felineMissionId && isCareerHeavyFieldBattle(mission) && !this.fieldResultPending && !mission.result) this._updateHeavyField(dt, mission)
    if (this.felineMissionId && this.careerFieldDeployment && !this.fieldResultPending && !mission.result) this._updateMigratedFieldBattle(dt, mission)
    if (this.bridgeRuntime) {
      const runtime = this.bridgeRuntime
      runtime.observe(mission, this.npcs)
      this.fieldBattleHud?.updateBridgehead(runtime.enemyAlive, runtime.deployment)
      if (this.fieldResultPending) return
      if (mission.result) {
        if (!this.careerResultStats) this._showFieldBattleResult(mission.result.outcome)
        return
      }
      runtime.advancePreparation(dt)
      this.bridgeDeploymentRetrySeconds = Math.max(0, this.bridgeDeploymentRetrySeconds - dt)
      if (this.bridgeDeploymentRetrySeconds === 0) {
        if (runtime.deployment.phase === 'preparing' && runtime.deployment.preparationRemainingSeconds === 0) {
          if (runtime.beginEnemyDeployment(state => this._saveBridgeDeployment(state))) {
            this._queueFieldBattleRoster(createCareerBridgeSpawnPlan(this.careerProfile!, 'attackers'), false)
          } else {
            this.bridgeDeploymentRetrySeconds = 1
            this._showNotify('準備完成，等待存檔成功後敵軍才會出現', 1500)
          }
        } else if (runtime.deployment.phase === 'spawning' && this.fieldRosterBatch?.ready) {
          if (!runtime.completeEnemyDeployment(this.fieldRosterBatch.ready, state => this._saveBridgeDeployment(state))) {
            this.bridgeDeploymentRetrySeconds = 1
            this._showNotify('敵軍部署完成，正在重試儲存戰場', 1500)
          }
        }
      }
      const result = runtime.outcome(this.player.dead,
        this.fieldRosterBatch?.ready === true && mission.commanderMission?.deploymentComplete === true,
        this.personalSquad?.aliveCombatants ?? 0)
      if (result) this._showFieldBattleResult(result)
      return
    }
    // Heavy-cavalry and migrated field battles are decided by the whole friendly force, never by the player alone.
    const officialIds = new Set(isCareerHeavyFieldBattle(mission) || isMigratedCareerFieldMission(mission)
      ? mission.friendlyActorIds : mission.officialSquad?.actorIds)
    const enemyIds = new Set(mission.targetActorIds)
    const officialAlive = this.npcs.filter(npc => !npc.dead && officialIds.has(npc.combatantId)).length
    const enemyAlive = this.npcs.filter(npc => !npc.dead && enemyIds.has(npc.combatantId)).length
    const pending = this.fieldRosterBatch?.pending ?? 0
    const ready = this.fieldRosterBatch?.ready === true && (!this.personalSquad || this.personalSquad.ready)
    const roster = this._careerCommandHudRoster()
    const officialCounts = roster && countArmyHudRoster(roster, 'squad:1')
    const personalCounts = roster && countArmyHudRoster(roster, 'squad:personal')
    this.fieldBattleHud?.update(ready, this.felineMissionId ? officialAlive : officialCounts?.alive ?? officialAlive,
      personalCounts?.alive ?? this.personalSquad?.aliveCombatants ?? 0, enemyAlive,
      pending + (personalCounts?.pending ?? 0),
      !this.felineMissionId && officialCounts && personalCounts ? { official: officialCounts, personal: personalCounts } : undefined)
    if (!ready) return
    if (this.fieldResultPending) return
    if (mission.result) {
      if (!this.careerResultStats) this._showFieldBattleResult(mission.result.outcome)
      return
    }
    if (mission.phase !== 'ENGAGING') {
      if (!this._persistCareerBattle(true)) return
      for (const npc of this.npcs) if (!npc.dead && npc.combatOwnership !== 'player-personal' && !officialPlayerOwnsActor(mission.officialSquad, npc.combatantId)) {
        if (this.felineMissionId && isCareerHeavyFieldBattle(mission)) this._applyHeavyFieldOrder(npc, mission)
        else npc.setTacticalOrder(this.felineMissionId
          ? careerFieldTacticalOrder(mission, npc.faction)
          : 'attack')
      }
    }
    if (enemyAlive === 0) this._showFieldBattleResult('victory')
    else if (this.player.dead && officialAlive === 0 && (this.personalSquad?.aliveCombatants ?? 0) === 0) this._showFieldBattleResult('failure')
    void dt
  }

  private _showFieldBattleResult(outcome: 'victory' | 'failure'): void {
    this.armyCommandUI?.setEnabled(false)
    this.fieldResultPending = outcome
    this.battleStats.freeze()
    const stats = this.careerResultStats ??= this.battleStats.snapshot(this.npcs, this.player)
    const retry = () => this.fieldBattleHud?.showSaveRetry(() => this._showFieldBattleResult(outcome))
    if (!this._flushCareerSkillProgression() || !this._persistCareerBattle(true)) { retry(); return }
    const fresh = this.careerStore.loadChecked().profile
    if (!fresh) { retry(); return }
    const claim = this.bridgeLaunch ? commitCareerBridgeBattleResult(this.careerStore, this.fieldMissionId!, stats)
      : claimCareerFieldResult(fresh, this.fieldMissionId!, outcome, stats.player, stats.meritPlayer ?? stats.player, this.npcs.find(npc => npc.faction === Faction.ENEMY)?.characterFaction)
    if (!claim) { retry(); return }
    if (!this.bridgeLaunch && !this.careerStore.save(claim.profile)) { retry(); return }
    this.careerProfile = claim.profile
    this.fieldResultPending = undefined
    this.fieldBattleHud?.showResult(outcome, claim.profile.activeMission!.result!.merit.total, stats, () => this._returnToCareerTown(),
      outcome === 'failure' && claim.profile.activeMission?.id === this.fieldMissionId && claim.profile.activeMission.prisonBreak?.stage === 'captured')
  }

  private _identifyPersonalOutpostWave(plan: BattleSpawnPlan, wave: 'initial' | 'attackers' | 'reinforcement'): void {
    const mission = this._personalOutpostMission()
    if (!mission) return
    plan.npcSpecs.forEach((spec, index) => { spec.actorId = careerOutpostActorId(mission.id, wave, index) })
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
    const saved = this._personalOutpostMission()?.battle?.actors[npc.combatantId]
    if (!saved) return
    npc.releaseOutpostRampartGarrison?.()
    const mount = this.careerVeteranActorMounts.get(npc.combatantId)
    const command = this._careerCommandMission()?.officialSquad?.members?.[npc.combatantId] ?? saved.checkpoint
    if (command) {
      const controlled = officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId)
      const restoreOrder = !this._careerCommandMission()?.officialSquad?.actorIds.includes(npc.combatantId) || controlled
      restoreCommandActor(npc, restoreOrder ? command : { ...command, order: undefined, formation: undefined }, mount ?? undefined)
      if (controlled && !npc.dead && command.order === 'follow') {
        const index = this._careerCommandMission()?.officialSquad?.actorIds.indexOf(npc.combatantId) ?? -1
        if (index >= 0) npc.assignFollowTarget(this.player, index, officialFollowLocalOffset(index, npc.isMounted, Boolean(this.careerProfile?.personalSquad?.members.length)))
      }
      return
    }
    if (mount) {
      mount.group.position.set(saved.x, outpostCheckpointHeight(saved.x, saved.z, saved.y, saved.outpostRampartGarrison, this.defenseCampaignConfig!.defenderFaction), saved.z)
      mount.group.rotation.y = saved.yaw
      if (saved.mountHp === 0) { mount.takeDamage(mount.maxHp + 1); if (npc.mount) npc.dismountFromMount() }
      else if (saved.mountHp !== undefined) { mount.restoreArmor(saved.mountArmorImpact); mount.currentHp = Math.min(mount.maxHp, saved.mountHp) }
    }
    npc.group.position.set(saved.x, outpostCheckpointHeight(saved.x, saved.z, saved.y, saved.outpostRampartGarrison, this.defenseCampaignConfig!.defenderFaction), saved.z)
    npc.group.rotation.y = saved.yaw
    npc.restoreCombatHealth(saved.hp)
    if (!npc.dead && saved.outpostRampartGarrison) npc.activateOutpostRampartGarrison()
  }

  private outpostRestoration?: Promise<void>
  private _restorePersonalOutpostBattle(progress: (text: string) => void = () => {}): Promise<void> {
    return this.outpostRestoration ??= this._restorePersonalOutpostActors(progress)
  }

  private async _restorePersonalOutpostActors(progress: (text: string) => void): Promise<void> {
    const mission = this._personalOutpostMission(), saved = mission?.battle
    if (!mission || !saved) return
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
      if (wave === 'attackers') this._prepareCampaignSiegePlan(plan)
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
    const mission = campaign?.careerVeteranOutpost || campaign?.careerCommanderOutpost || this.careerBattleCheckpoint
      ? this.careerProfile?.activeMission : this.careerProfile?.activeOutpostMission
    if (campaign?.careerCommanderOutpost && (this.careerProfile?.activeMission?.result
      || campaign.careerCommanderOutpost.runtimeState.battleFinished)) return
    const saved = mission?.personalSquad
    if ((!campaign?.careerMissionId && !this.fieldMissionId) || !this.careerProfile || !saved?.memberIds.length) return
    const sceneKey = this.bridgeLaunch ? `bridge:${this.fieldMissionId}`
      : this.felineMissionId ? `feline:${this.felineMissionId}`
      : this.captainEagleMissionId ? `eagle:${this.captainEagleMissionId}` : `outpost:${campaign!.careerMissionId}`
    const changedScene = saved.sceneKey !== sceneKey
    const placement = campaign ? getCampaignOutpostPlacement(careerVeteranOutpostOwner(campaign)) : null
    const outside = !campaign || campaign.careerMissionKind === 'outpost-relief' || campaign.careerMissionKind === 'veteran-outpost-assault'
    const yaw = campaign ? getCampaignDefenderFacingYaw(campaign.defenderFaction) + (outside ? Math.PI : 0) : this.player.group.rotation.y
    const owned = new Map(this.careerProfile.personalSquad?.members.map(member => [member.id, member]))
    const flyingIds = new Set(saved.memberIds.filter(id => owned.get(id)?.equipment?.mount === 'xongkoro'))
    const playerFlying = this.player.currentMount?.isFlyingMount === true
    const officialPositions = this.bridgeLaunch
      ? createBridgeheadRoster(this.careerProfile.activeMission!, this.careerProfile.faction).friendly
      : this.felineMissionId
        ? (() => {
          const checkpointPoints = (this.careerProfile.activeMission?.friendlyActorIds ?? []).flatMap(id => {
            const point = this.fieldCheckpoint?.actors[id]?.position
            return point ? [{ x: point.x, z: point.z }] : []
          })
          if (checkpointPoints.length > 0) return checkpointPoints
          return createCareerFelineSpawnPlan(this.careerProfile!).npcSpecs
            .filter(spec => spec.faction === Faction.PLAYER)
            .map(spec => ({ x: spec.x, z: spec.z }))
        })()
        : this.npcs.filter(npc => !npc.dead && npc.faction === Faction.PLAYER).map(npc => npc.combatPosition)
    // Do not anchor ground deployment to the Player's relocated eagle touchdown.
    // Stage IX defenders have a bounded interior; that bounds is authoritative.
    const anchor = campaign && !outside
      ? { x: placement!.centerX, z: (placement!.frontZ + placement!.backZ) / 2, yaw }
      : { x: this.player.spawnX, z: this.player.spawnZ, yaw }
    const bounds = outside ? this.navigationWorld.grid : {
      minX: placement!.centerX - placement!.halfWidth, maxX: placement!.centerX + placement!.halfWidth,
      minZ: Math.min(placement!.frontZ, placement!.backZ), maxZ: Math.max(placement!.frontZ, placement!.backZ),
    }
    // Eagles get separate areas behind the fort, not ground roster positions.
    const eagleSearchAnchor = campaign && !outside
      ? { x: placement!.centerX, z: placement!.backZ + Math.sign(placement!.backZ - placement!.frontZ) * 20, yaw }
      : { x: anchor.x - Math.sin(yaw) * 20, z: anchor.z - Math.cos(yaw) * 20, yaw }
    const ground = changedScene
      ? planPersonalOutpostGround(saved.memberIds, flyingIds, playerFlying, eagleSearchAnchor,
        (count, playerLeads) => campaign && !outside
          ? personalOutpostDeployment(anchor, officialPositions, count, bounds, this.obstacles, this.navigationWorld)
          : personalRearDeployment(anchor, officialPositions, count, bounds, this.obstacles, this.navigationWorld, playerLeads))
      : null
    const regularMuster = ground?.regularMuster ?? saved.memberIds.map(id => saved.members[id]?.position ?? anchor)
    const groundPositions = ground?.groundPositions ?? regularMuster.filter((_, index) => !flyingIds.has(saved.memberIds[index]))
    const occupied = [...(this.bridgeLaunch || this.felineMissionId ? officialPositions : []),
      ...this.npcs.filter(npc => !npc.dead).map(npc => npc.combatPosition), ...groundPositions]
    // Plan all three eagle landing envelopes before mutating the Player or
    // starting any NPC spawn job. A missing pad cannot leave partial deployment.
    const playerPoint = changedScene
      ? playerFlying
        ? findEagleLandingPosition(eagleSearchAnchor, this.obstacles, occupied, 300, 150)
        : ground!.playerPosition
      : null
    if (changedScene && !playerPoint) throw new Error('No clear xongkoro player deployment area near the Outpost')
    occupied.push(playerPoint ?? this.player.combatPosition)
    const eagleMuster: Array<{ x: number; z: number; yaw: number }> = []

    for (const [index, id] of saved.memberIds.entries()) {
      if (!flyingIds.has(id)) continue
      const origin = changedScene ? eagleSearchAnchor : regularMuster[index] ?? anchor
      const position = findEagleLandingPosition(origin, this.obstacles, occupied, 300, 150)
      if (!position) throw new Error('No clear xongkoro deployment area near the Outpost')
      eagleMuster.push({ x: position.x, z: position.z, yaw })
      occupied.push(position)
    }
    if (changedScene && playerPoint) {
      if (this.player.currentMount) {
        this.player.currentMount.group.position.set(playerPoint.x, getTerrainHeight(playerPoint.x, playerPoint.z), playerPoint.z)
        this.player.currentMount.group.rotation.y = yaw
      }
      this.player.group.position.set(playerPoint.x, getTerrainHeight(playerPoint.x, playerPoint.z) + .95, playerPoint.z)
      this.player.faceDirection(Math.sin(yaw), Math.cos(yaw))
      this.player.spawnX = playerPoint.x; this.player.spawnZ = playerPoint.z
      this.thirdPersonCamera.setYaw(yaw + Math.PI)
    }
    this.personalSquad = new PersonalSquadRuntime(this.scene, regularMuster, () => this.careerProfile!, () => this.player, undefined, {
      sceneKey, hasHR: false, eagleMuster,
      formationSlots: (anchor, occupied, count) => personalRearDeployment(anchor, occupied, count,
        this.navigationWorld.grid, this.obstacles, this.navigationWorld),
      emit: this.combatEvents.emit,
      onSpawn: (npc, mount) => {
        npc.enableBattlefieldEngagement()
        this.npcs.push(npc); this.battleStats.registerNpc(npc); this._aimTargetRegistry.registerNpc(npc)
        if (this.bridgeLaunch || this.felineMissionId) this.careerVeteranActorMounts.set(npc.combatantId, mount ?? null)
        if (mount) { this.mounts.push(mount); this._aimTargetRegistry.registerMount(mount) }
      },
      onDispose: (npc, mount) => {
        if (this.bridgeLaunch || this.felineMissionId) this.careerVeteranActorMounts.delete(npc.combatantId)
        this._aimTargetRegistry.unregisterNpc(npc)
        const index = this.npcs.indexOf(npc); if (index >= 0) this.npcs.splice(index, 1)
        if (mount) { this._aimTargetRegistry.unregisterMount(mount); const index = this.mounts.indexOf(mount); if (index >= 0) this.mounts.splice(index, 1) }
      },
    })
    this.personalSquad.restoreMission(saved)
  }

  private _restorePersonalOutpostPlayer(): void {
    const saved = this._personalOutpostMission()?.battle?.player
    if (!saved) return
    this.player.group.position.set(saved.x, getTerrainHeight(saved.x, saved.z) + .95, saved.z)
    this.player.faceDirection(Math.sin(saved.yaw), Math.cos(saved.yaw))
    const mount = this.startingHorse
    if (mount) {
      const parked = saved.mountPosition
      mount.group.position.set(parked?.x ?? saved.x, parked?.y ?? getTerrainHeight(parked?.x ?? saved.x, parked?.z ?? saved.z), parked?.z ?? saved.z)
      mount.group.rotation.y = parked?.yaw ?? saved.yaw
      if (saved.mountHp === 0) { mount.takeDamage(mount.maxHp + 1); this.player.dismountFromMount() }
      else {
        if (saved.mountHp !== undefined) { mount.restoreArmor(saved.mountArmorImpact); mount.currentHp = Math.min(mount.maxHp, saved.mountHp) }
        if (saved.mounted === false && this.player.currentMount === mount) this.player.dismountFromMount()
        else if (saved.mounted === true && !saved.dead && !mount.dead && this.player.currentMount !== mount) this.player.mountVehicle(mount)
      }
    }
    this.player.setHp(saved.hp); this.player.setStamina(saved.stamina)
    if (saved.ammo !== undefined) this.player.setArrowCount(saved.ammo)
    if (saved.shieldImpact !== undefined) this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.shieldImpact)
    if (saved.dead) { this.player.detachFromMountOnDeath(); this.player.takeDamage(this.player.maxHp * 100, this.hpBar) }
    restoreCareerAerialState(this.player, this.startingHorse, this.careerProfile?.playerAerialState, `outpost:${this.defenseCampaignConfig?.careerMissionId}`)
  }

  private _persistPersonalOutpost(force = false, dt = 0): boolean {
    if (this.initializing || this.spawningStopped) return true
    if (this.careerBattleCheckpoint) return this._persistCareerBattle(force, dt)
    if (!this.careerProfile || !this.defenseCampaignConfig?.careerMissionId) return true
    const personal = this.personalSquad?.checkpoint()
    this.personalCheckpointElapsed += dt
    const critical = JSON.stringify([personal?.state, this.player.dead, this.player.isFalling, this.player.currentMount?.dead, this.campaignSpawnWave,
      this.defenseCampaignRuntime?.getSnapshot().phase, personal?.memberIds.map(id => {
        const actor = personal.members[id]
        return [actor.status, actor.order, actor.mount?.hp === 0, actor.formation?.commandId]
      })])
    if (!force && this.personalCheckpointElapsed < 5 && critical === this.personalCriticalState) return true
    if (this.defenseCampaignConfig?.careerVeteranOutpost || this.defenseCampaignConfig?.careerCommanderOutpost) {
      const saved = this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
      if (saved) { this.personalCheckpointElapsed = 0; this.personalCriticalState = critical }
      return saved
    }
    const next = this.careerStore.loadChecked().profile
    const mission = next?.activeOutpostMission, runtime = this.defenseCampaignRuntime?.getSnapshot()
    if (!next || !mission || mission.id !== this.defenseCampaignConfig?.careerMissionId || !runtime) return false
    if (personal) personal.contribution = this.battleStats.commandCheckpoint()
    mission.personalSquad = personal
    this._snapshotOfficialCommand(mission.officialSquad)
    next.playerAerialState = captureCareerAerialState(this.player, `outpost:${this.defenseCampaignConfig.careerMissionId}`)
    mission.battle = {
      runtime, outpostSiege: this.campaignSiegeAssault?.snapshot(), actors: { ...mission.battle?.actors, ...Object.fromEntries(this.npcs.filter(npc => npc.combatOwnership !== 'player-personal').map(npc => {
        const mount = this.careerVeteranActorMounts.get(npc.combatantId)
        return [npc.combatantId, { hp: npc.hp, x: npc.combatPosition.x, y: npc.combatPosition.y, z: npc.combatPosition.z,
          yaw: npc.mount?.group.rotation.y ?? npc.group.rotation.y,
          ...(npc.isOutpostRampartGarrisonActive ? { outpostRampartGarrison: true } : {}),
          checkpoint: snapshotCommandActor(npc, mount ?? undefined),
          ...(mount ? { mountArmorImpact: mount.armorImpactRemaining, mountHp: mount.dead ? 0 : mount.currentHp } : {}) }]
      })) },
      player: { hp: this.player.hp, stamina: this.player.staminaValue, dead: this.player.dead,
        x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw: this.player.currentMount?.group.rotation.y ?? this.player.group.rotation.y,
        ammo: this.player.arrowCount, shieldImpact: this.player.shield.shieldImpactRemaining,
        ...(this.startingHorse ? { mountArmorImpact: this.startingHorse.armorImpactRemaining, mountHp: this.startingHorse.dead ? 0 : this.startingHorse.currentHp } : {}) },
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

  private _commanderOutpostSquadCounts() {
    const group = (squadId: number) => this.npcs.filter(npc => !npc.dead && this._originalCareerSquadId(npc) === squadId).length
    return [
      { label: 'Squad 1', alive: group(1), total: 30 },
      { label: 'Squad 2', alive: group(2), total: 30 },
      { label: 'Squad 3', alive: group(3), total: 30 },
      { label: 'Squad 4', alive: group(4), total: 30 },
    ]
  }

  /** Last Stand's preparation clock is a ceasefire: actors may reposition, but
   * no side can attack or deal mount-impact damage before the shared assault.
   * A restored assault remains locked until its complete roster is registered. */
  private _commanderOutpostCombatLocked(): boolean {
    return Boolean(this.defenseCampaignConfig?.careerCommanderOutpost
      && (this.defenseCampaignRuntime?.getSnapshot().activePhase === 'deployment'
        || !this.commanderOutpostDeploymentBatch?.ready
        || Boolean(this.personalSquad && !this.personalSquad.ready)))
  }

  private _applyCampaignBreachOrders(attackerFaction: CampaignFaction): void {
    if (this.restoringCareerOutpostGate) return
    this.campaignSiegeAssault?.refreshPhysicalEntrances()
    if (this.previewCampaignGate) {
      for (const npc of this.npcs) {
        if (npc.siegeObstacle === this.previewCampaignGate.siegeObstacle) {
          npc.assignSiegeObstacle?.(null)
        }
      }
    }
    const authority = this._careerCommandMission()?.officialSquad
    const result = applyCampaignBreachOrders(this.npcs.filter(npc => !officialPlayerOwnsActor(authority, npc.combatantId)), attackerFaction)
    this.soundManager.playCommanderCommand(attackerFaction, 'charge')
    this._showNotify(
      `⚔️ Breach! ${attackerFaction === 'viking' ? '維京' : '羅馬'}近戰衝鋒｜`
      + `${result.attackerChargeCount} charge / ${result.attackerAttackCount} ranged｜`
      + `守軍 ${result.defenderAttackCount} → attack`,
      3500,
    )
    if (this.defenseCampaignConfig?.careerMissionId) this._persistPersonalOutpost(true)
  }

  private _restoreCareerVeteranNpcState(npc: NPC, restorePosition = true): void {
    const mission = this.careerProfile?.activeMission
    const actorId = npc.combatantId
    if (!mission || !actorId) return
    const saved = mission.actorHealth?.[actorId]
    const savedPosition = restorePosition ? mission.actorPositions?.[actorId] : undefined
    const dead = mission.deadTargetActorIds?.includes(actorId) || mission.deadFriendlyActorIds?.includes(actorId)
    if (!this.careerVeteranActorMounts.has(actorId)) this.careerVeteranActorMounts.set(actorId, npc.mount)
    const mount = this.careerVeteranActorMounts.get(actorId) ?? null
    if (savedPosition) {
      npc.releaseOutpostRampartGarrison?.()
      const y = outpostCheckpointHeight(savedPosition.x, savedPosition.z, savedPosition.y, savedPosition.outpostRampartGarrison, this.defenseCampaignConfig!.defenderFaction)
      npc.group.position.set(savedPosition.x, y, savedPosition.z)
      npc.group.rotation.y = savedPosition.yaw
      if (mount) {
        mount.group.position.set(savedPosition.x, y, savedPosition.z)
        mount.group.rotation.y = savedPosition.yaw
      }
    }
    if (saved?.mountHp !== undefined && mount) {
      mount.restoreArmor(saved.mountArmorImpact)
      if (saved.mountHp <= 0) {
        if (!mount.dead) mount.takeDamage(mount.maxHp * 100)
      } else if (!mount.dead) {
        mount.currentHp = Math.min(mount.maxHp, saved.mountHp)
      }
    }
    if (dead) npc.restoreCombatHealth(0)
    else if (saved) npc.restoreCombatHealth(saved.hp)
    const command = mission.officialSquad?.members?.[actorId]
    if (command) {
      const controlled = officialPlayerOwnsActor(mission.officialSquad, actorId)
      restoreCommandActor(npc, { ...(controlled ? command : { ...command, order: undefined, formation: undefined }),
        ...(dead || saved?.hp === 0 ? { status: 'dead', hp: 0 } : {}) }, mount ?? undefined)
      if (controlled && !npc.dead && command.order === 'follow') {
        const slot = mission.officialSquad!.actorIds.indexOf(actorId)
        npc.assignFollowTarget(this.player, slot, officialFollowLocalOffset(slot, npc.isMounted, Boolean(this.careerProfile?.personalSquad?.members.length)))
      }
    }
    if (!command && !npc.dead && savedPosition?.outpostRampartGarrison) npc.activateOutpostRampartGarrison()
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

  private _originalCareerSquadId(npc: NPC): NPC['squadId'] {
    return this.careerOriginalCommandSquads?.has(npc) ? this.careerOriginalCommandSquads.get(npc) : npc.squadId
  }

  private _makeMountedMissionSquads(npcs: readonly NPC[], squadIds: readonly number[]): MountedMissionSquad[] {
    return squadIds.map(squadId => {
      const members = npcs.filter(npc => this._originalCareerSquadId(npc) === squadId && !npc.dead)
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
        acceptsActor: npc => !officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId),
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
        acceptsActor: npc => !officialPlayerOwnsActor(this._careerCommandMission()?.officialSquad, npc.combatantId),
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
    const data = campaign?.careerVeteranOutpost ?? campaign?.careerCommanderOutpost
    const savedMission = this.careerProfile?.activeMission
    const runtime = this.defenseCampaignRuntime?.getSnapshot()
    if (!campaign || !data || !savedMission || savedMission.id !== data.missionId || !runtime) return null
    const active = { ...savedMission,
      ...(savedMission.commanderMission ? { commanderMission: { ...savedMission.commanderMission } } : {}) }
    const targetIds = new Set(active.targetActorIds)
    const friendlyIds = new Set([...(active.friendlyActorIds ?? []), ...(active.reinforcementActorIds ?? [])])
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    const actorHealth = { ...(active.actorHealth ?? {}) }
    const actorPositions = { ...(active.actorPositions ?? {}) }
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
      actorPositions[id] = {
        x: npc.combatPosition.x,
        y: npc.combatPosition.y,
        z: npc.combatPosition.z,
        yaw: npc.mount?.group?.rotation.y ?? npc.group.rotation.y,
        ...(npc.isOutpostRampartGarrisonActive ? { outpostRampartGarrison: true } : {}),
      }
      const mount = this.careerVeteranActorMounts.has(id)
        ? this.careerVeteranActorMounts.get(id) ?? null
        : npc.mount
      if (mount) actorHealth[id] = { ...actorHealth[id], mountArmorImpact: mount.armorImpactRemaining, mountHp: mount.dead ? 0 : mount.currentHp }
    }
    const previousState = active.outpostBattleState ?? data.runtimeState
    const gateHealth = this.previewCampaignGate?.damageable.currentHp ?? previousState.gateHealth
    const gateState = this.previewCampaignGate?.state ?? previousState.gateState
    active.deadTargetActorIds = [...deadTargets]
    active.deadFriendlyActorIds = [...deadFriendlies]
    active.outpostSiege = this.campaignSiegeAssault?.snapshot()
    active.actorHealth = actorHealth
    active.actorPositions = actorPositions
    active.playerDead = this.player.dead || active.playerDead === true
    active.playerHp = this.player.hp
    active.playerStamina = this.player.staminaValue
    active.playerStats = this.battleStats.checkpoint()
    this._snapshotOfficialCommand(active.officialSquad)
    if (active.personalSquad && this.personalSquad) {
      active.personalSquad = this.personalSquad.checkpoint()
      if (active.personalSquad) active.personalSquad.contribution = this.battleStats.commandCheckpoint()
    }
    const mountId = campaign.playerLoadout.mountId
    const mountState = active.mountState
      ? { ...active.mountState, hp: { ...active.mountState.hp }, unavailable: [...active.mountState.unavailable] }
      : { hp: {}, armorImpact: {}, unavailable: [] as NonNullable<ActiveCareerMission['mountState']>['unavailable'] }
    if (mountId && this.startingHorse) {
      ;mountState.armorImpact = { ...active.mountState?.armorImpact, [mountId]: this.startingHorse.armorImpactRemaining }
      ;(mountState.hp as Record<string, number>)[mountId] = this.startingHorse.dead ? 0 : this.startingHorse.currentHp
      if (this.startingHorse.dead && !mountState.unavailable.includes(mountId as never)) mountState.unavailable.push(mountId as never)
    }
    active.mountState = mountState as ActiveCareerMission['mountState']
    const playerPosition = { x: this.player.combatPosition.x, z: this.player.combatPosition.z,
      yaw: this.player.currentMount?.group.rotation.y ?? this.player.group.rotation.y }
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
      ...(campaign.careerVeteranOutpost?.templateId === 'veteran-outpost-assault' ? {
        playerPosition: { ...playerPosition,
          y: this.player.currentMount?.group.position.y ?? this.player.group.position.y - .95,
          yaw: this.player.currentMount?.group.rotation.y ?? this.player.facingYaw },
      } : {}),
      ...(gateHealth !== undefined ? { gateHealth } : {}),
      ...(gateState ? { gateState } : {}),
    }
    if (active.commanderMission) {
      active.commanderMission.deploymentComplete = Boolean(active.commanderMission.deploymentComplete
        || (this.commanderOutpostDeploymentBatch?.ready && (!this.personalSquad || this.personalSquad.ready)))
      active.commanderMission.playerPosition = playerPosition
    }
    if (!active.result) active.phase = runtime.activePhase === 'deployment' ? 'PREPARING' : 'ENGAGING'
    return active
  }

  private _restoreCareerVeteranPlayerState(): void {
    const mission = this.careerProfile?.activeMission
    const campaign = this.defenseCampaignConfig
    const data = campaign?.careerVeteranOutpost ?? campaign?.careerCommanderOutpost
    if (!mission || !campaign || !data || mission.id !== data.missionId) return
    const veteranPosition = campaign.careerVeteranOutpost?.runtimeState.playerPosition
    const position = mission.commanderMission?.playerPosition ?? veteranPosition
    if (position) {
      const y = veteranPosition?.y ?? getTerrainHeight(position.x, position.z)
      if (this.player.currentMount) {
        this.player.currentMount.group.position.set(position.x, y, position.z)
        this.player.currentMount.group.rotation.y = position.yaw
      }
      this.player.group.position.set(position.x, y + .95, position.z)
      this.player.faceDirection(Math.sin(position.yaw), Math.cos(position.yaw))
      if (this.player.currentMount) this.player.syncMountTransform()
      if (campaign.careerVeteranOutpost) this.thirdPersonCamera.setYaw(position.yaw + Math.PI)
    }
    const savedMountHp = mission.mountState?.hp[campaign.playerLoadout.mountId as keyof NonNullable<ActiveCareerMission['mountState']>['hp']]
    this.player.currentMount?.restoreArmor(mission.mountState?.armorImpact?.[campaign.playerLoadout.mountId!] ?? this.careerProfile?.mountArmor?.[campaign.playerLoadout.mountId!])
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
    restoreCareerAerialState(this.player, this.startingHorse, this.careerProfile?.playerAerialState, `outpost:${campaign.careerMissionId}`)
    this.hpBar.setFill(this.player.hpRatio)
    this.staminaBar.setFill(this.player.staminaRatio)
  }

  private _restoreCareerVeteranPlayerStateAndShowTerminalResult(): void {
    this._restoreCareerVeteranPlayerState()
    const state = this.defenseCampaignConfig?.careerVeteranOutpost?.runtimeState
      ?? this.defenseCampaignConfig?.careerCommanderOutpost?.runtimeState
    if (!state?.battleFinished) return
    const result = state.phase === 'victory' ? 'victory' : 'defeat'
    if (this.defenseCampaignConfig?.careerCommanderOutpost && (this.initializing || !this.commanderOutpostDeploymentBatch?.ready
      || this.personalSquad && !this.personalSquad.ready)) {
      this.careerOutpostTerminalResultPending = result
      return
    }
    this._showDefenseCampaignResult(result)
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
    if (campaign.careerCommanderOutpost) {
      if (wave !== 'attackers' || this.defenseCampaignRuntime?.getSnapshot().activePhase !== 'assault'
        || this.defenseCampaignRuntime.getSnapshot().battleFinished || this.careerProfile?.activeMission?.result) return 0
      plan = createCareerCommanderOutpostSpawnPlan(campaign, 'attackers', this.careerProfile?.activeMission)
      const existing = new Set(this.npcs.map(npc => npc.combatantId))
      plan.npcSpecs = plan.npcSpecs.filter(spec => !existing.has(spec.actorId!))
      resolveDefenseCampaignAttackerDeployment(plan.npcSpecs, campaign.defenderFaction,
        this.obstacles, this.navigationWorld, 150)
    } else if (campaign.careerVeteranOutpost) {
      if (wave !== 'reinforcement' || campaign.careerVeteranOutpost.templateId !== 'veteran-dread-outpost') return 0
      plan = createCareerVeteranOutpostReinforcementPlan(campaign)
    } else {
      const config = createDefenseCampaignWaveConfig(campaign, wave)
      plan = BattleSpawner.createSpawnPlan(config)
      if (wave === 'reinforcement') positionDefenseCampaignReinforcements(plan.npcSpecs, campaign.defenderFaction)
      else if (wave === 'attackers') {
        positionDefenseCampaignAttackers(plan.npcSpecs, campaign.defenderFaction)
        if (campaign.careerMissionKind === 'captain-outpost-defense') applyCaptainFrontlineEnemyHeroes(plan.npcSpecs)
      }
      this._identifyPersonalOutpostWave(plan, wave)
    }

    if (!plan.npcSpecs.length) return 0
    if (wave === 'attackers') this._prepareCampaignSiegePlan(plan, !campaign.careerCommanderOutpost)
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
        if (wave === 'attackers') {
          this.campaignAttackersStarted = true
          reconcileCampaignGateSiege({
            gate: this.previewCampaignGate,
            breachController: this.previewCampaignBreachController,
            availableEntrances: this.campaignSiegeAssault?.entrances,
            npcs: [npc],
            attackerFaction: npc.characterFaction,
          })
        }
        if (this.defenseCampaignConfig?.careerCommanderOutpost) {
          // Pending IDs enter from their legal staging slots. A legacy preparation
          // checkpoint may contain the old, premature enemy waiting positions.
          this._configureCampaignInitialNpc(npc, this.defenseCampaignConfig, false)
          npc.setTacticalOrder(npc.squadId === 7 ? 'attack' : 'charge')
        } else if (this.defenseCampaignConfig?.careerVeteranOutpost) {
          npc.setTacticalOrder(wave === 'reinforcement' ? 'defend' : 'attack')
          this._restoreCareerVeteranNpcState(npc)
          if (this.previewCampaignBreachController?.breached && wave === 'attackers') {
            npc.setTacticalOrder(npc.aiType === AIType.RANGED ? 'attack' : 'charge')
          }
        } else {
          if (this.previewCampaignBreachController?.breached && wave === 'attackers') {
            npc.setTacticalOrder(npc.aiType === AIType.RANGED ? 'attack' : 'charge')
          } else {
            npc.setTacticalOrder('attack')
          }
          this._restorePersonalOutpostNpc(npc)
        }
        this.campaignSpawnQueueIndex++
        if (this.defenseCampaignConfig?.careerCommanderOutpost
          && !this._persistCareerVeteranOutpostCheckpoint({ immediate: true })) {
          throw new Error('Commander attacker checkpoint could not be saved')
        }

        if (this.campaignSpawnQueueIndex >= this.campaignSpawnQueue.length) {
          if (wave === 'reinforcement') {
            // Terminal elimination becomes authoritative only after the entire
            // relief wave exists in the battlefield, not after its first rider.
            this.campaignReinforcementSpawned = true
            if (this.defenseCampaignConfig?.careerVeteranOutpost) {
              this._startCareerVeteranReinforcementMarch(this.campaignReinforcementArrived)
              this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
            } else this._showNotify(`🐎 援軍全數進場：${this.campaignSpawnQueue.length} 名刀騎兵`, 3500)
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
    if (this.defenseCampaignConfig?.careerMissionId) this.armyCommandUI?.setEnabled(false)
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
      const careerMissionOutpost = campaign.careerVeteranOutpost ?? campaign.careerCommanderOutpost
      if (careerMissionOutpost && !this._persistCareerVeteranOutpostCheckpoint({ immediate: true })) {
        this._showCareerOutpostSaveRetry(result)
        return
      }
      if (!careerMissionOutpost && !this._persistPersonalOutpost(true)) { this._showCareerOutpostSaveRetry(result); return }
      const fresh = this.careerStore.loadChecked().profile
      if (!fresh) { this._showCareerOutpostSaveRetry(result); return }
      const claim = careerMissionOutpost || this.careerBattleCheckpoint
        ? claimCareerMission(fresh, campaign.careerMissionId, result === 'victory' ? 'victory' : 'failure', stats.player, stats.meritPlayer)
        : claimCareerOutpost(fresh, campaign.careerMissionId, result, stats)
      if (!this.careerStore.save(claim.profile)) { this._showCareerOutpostSaveRetry(result); return }
      this.careerProfile = claim.profile
      this.careerMeritAwarded = careerMissionOutpost || this.careerBattleCheckpoint
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
    if (profile?.activeMission?.prisonBreak?.stage === 'captured') {
      const captured = beginPrisonBreak(profile, this.fieldMissionId ?? undefined)
      if (!captured || !this.careerStore.save(captured)) { this._showNotify('無法保存被俘狀態，請重試'); return }
      // Do not run ordinary mission-return cleanup over the capture capability or its troop snapshots.
      this.careerProfile = captured
      this._disposeCareerOutpostBattleActors()
      window.removeEventListener('pagehide', this.flushCareerBattleOnPageHide)
      window.removeEventListener('pagehide', this.flushCareerSkillsOnPageHide)
      window.removeEventListener('pagehide', this.flushPersonalOutpostOnPageHide)
      sessionStorage.removeItem('sagaburst_campaign_config')
      sessionStorage.removeItem('sagaburst_battle_config')
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
      window.location.href = window.location.pathname
      return
    }
    const activeMissionId = this.fieldMissionId ?? (this.careerBattleCheckpoint
      ? this.defenseCampaignConfig?.careerMissionId
      : this.defenseCampaignConfig?.careerVeteranOutpost?.missionId
        ?? this.defenseCampaignConfig?.careerCommanderOutpost?.missionId)
    const next = activeMissionId
      ? profile?.activeMission ? this.bridgeLaunch ? clearCareerBridgeBattle(profile, activeMissionId)
        : clearCareerMission(profile, activeMissionId) : profile
      : profile ? clearCareerOutpost(profile) : null
    const completed = profile && (profile.activeMission?.result || profile.claimedBattleIds.includes(
      profile.activeMission?.id ?? profile.activeOutpostMission?.id ?? ''))
    const returned = next && refitTownCommandForSceneChange(next)
    const recovered = returned && completed ? stageMissionReturnRebuild(returned, townRoster().map(spec => ({ spec })),
      profile.activeMission?.personalSquad ?? profile.activeOutpostMission?.personalSquad ?? returned.personalSquadRuntime) : returned
    if (!recovered || !this.careerStore.save(recovered)) { this._showNotify('無法保存返回狀態，請重試'); return }
    this.careerProfile = recovered
    this.personalSquad?.endMission(true)
    this._disposeCareerOutpostBattleActors()
    window.removeEventListener('pagehide', this.flushVeteranOutpostOnPageHide)
    window.removeEventListener('pagehide', this.flushCareerSkillsOnPageHide)
    window.removeEventListener('pagehide', this.flushPersonalOutpostOnPageHide)
    window.removeEventListener('pagehide', this.flushCareerBattleOnPageHide)
    sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
    sessionStorage.removeItem('sagaburst_campaign_config')
    sessionStorage.removeItem('sagaburst_battle_config')
    sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    if (completed) markCareerMissionReturnToSergeant()
    window.location.href = window.location.pathname
  }

  private _disposeCareerOutpostBattleActors(): void {
    resetTerrainScenePolicy()
    this.compass?.dispose()
    this.compass = undefined
    this.commandSelectionMarker?.dispose()
    this.commandSelectionMarker = undefined
    this.spawningStopped = true
    this.soundManager?.updateEagleWingbeats([])
    this.felineChargeUnsubscribe?.(); this.felineChargeUnsubscribe = undefined
    for (const batch of this.spawnBatches) batch.cancel()
    this.personalSquad?.cleanup()
    this.campaignSiegeAssault?.dispose()
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
    this.heavyGuide?.dispose(); this.heavyGuide = null
    this.careerOutpostDefenseGuide = null
    this.careerVeteranActorMounts.clear()
    this.defenseCampaignHud?.destroy()
    this.fieldBattleHud?.destroy()
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
    const commanderOutpost = campaign.careerCommanderOutpost
    const careerMissionOutpost = veteranOutpost ?? commanderOutpost
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

    const commanderDeploymentReady = !commanderOutpost || Boolean(this.commanderOutpostDeploymentBatch?.ready
      && (!this.personalSquad || this.personalSquad.ready))
    if (!commanderDeploymentReady) {
      const snapshot = runtime.getSnapshot()
      hud.updateGate(this.previewCampaignGate?.state ?? 'destroyed', false, false)
      hud.update(snapshot, playerSideAliveBefore, enemySideAliveBefore, playerSideFaction, false,
        this._commanderOutpostSquadCounts())
      const pending = this.commanderOutpostDeploymentBatch?.pending ?? this.commanderOutpostDeploymentTotal
      hud.updateDeploymentProgress(this.commanderOutpostDeploymentTotal - pending, this.commanderOutpostDeploymentTotal)
      this.veteranOutpostCheckpoint?.advance(dt)
      this._persistCareerVeteranOutpostCheckpoint({ immediate: false, periodic: true })
      return
    }
    if (commanderOutpost && !this.commanderOutpostDeploymentCheckpointed) {
      this.commanderOutpostDeploymentCheckpointed = this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
      // The 60-second preparation clock starts only after the fully registered
      // official/private roster has an authoritative recovery checkpoint.
      if (!this.commanderOutpostDeploymentCheckpointed) {
        const snapshot = runtime.getSnapshot()
        hud.updateGate(this.previewCampaignGate?.state ?? 'destroyed', false, false)
        hud.update(snapshot, playerSideAliveBefore, enemySideAliveBefore, playerSideFaction, false,
          this._commanderOutpostSquadCounts())
        hud.updateDeploymentProgress(this.commanderOutpostDeploymentTotal, this.commanderOutpostDeploymentTotal)
        return
      }
    }
    if (commanderOutpost && this.commanderOutpostDeploymentCheckpointed && this.careerOutpostTerminalResultPending) {
      const result = this.careerOutpostTerminalResultPending
      this.careerOutpostTerminalResultPending = undefined
      this._showDefenseCampaignResult(result)
      return
    }

    const events = runtime.update(dt, {
      playerDead: this.player.dead,
      originalDefendersAlive,
      defendersAlive: playerSideAliveBefore,
      personalPlayerSideAlive: this.personalSquad?.aliveCombatants ?? 0,
      // The assault wave is frame-spawned. Pending attackers still count as
      // remaining enemies so a temporary zero on the field cannot end the battle.
      attackersAlive: commanderOutpost && this.careerProfile?.activeMission
        ? remainingCommanderAttackers(this.careerProfile.activeMission, this.npcs)
        : enemySideAliveBefore + pendingAttackers,
      reinforcementSpawned: veteranOutpost?.templateId === 'veteran-dread-outpost'
        ? this.campaignReinforcementArrived
        : this.campaignReinforcementSpawned,
      reinforcementActive: this.campaignSpawnWave === 'reinforcement' || this.campaignReinforcementSpawned,
    })

    for (const event of events) {
      if (event === 'assault_started') {
        if (commanderOutpost) {
          this._queueDefenseCampaignWave('attackers')
          const targetIds = new Set(this.careerProfile?.activeMission?.targetActorIds ?? [])
          for (const npc of this.npcs) if (!npc.dead && targetIds.has(npc.combatantId)) {
            npc.setTacticalOrder(npc.squadId === 7 ? 'attack' : 'charge')
          }
          this.soundManager.playCommanderCommand(opposingCampaignFaction(commanderOutpost.playerFaction), 'charge')
          this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
          this._showNotify('⚔️ 三支敵方騎兵編隊同時進攻', 3000)
        } else {
          const queued = this._queueDefenseCampaignWave('attackers')
          this._showNotify(`⚔️ 敵軍開始進攻：${queued} 人進場中`, 3000)
        }
      } else if (event === 'reinforcement_due') {
        const queued = this._queueDefenseCampaignWave('reinforcement')
        if (veteranOutpost?.templateId === 'veteran-dread-outpost') {
          this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
          this._showNotify(`🐎 第 90 秒援軍開始進場：${queued} 名騎兵`, 3500)
        } else {
          this.soundManager.playCommanderCommand(campaign.defenderFaction, 'attack')
          this._showNotify(`🐎 援軍開始進場：${queued} 名刀騎兵`, 3500)
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
        if (careerMissionOutpost) this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
        this._showDefenseCampaignResult('victory')
      } else if (event === 'battle_defeat') {
        if (careerMissionOutpost) this._persistCareerVeteranOutpostCheckpoint({ immediate: true })
        this._showDefenseCampaignResult('defeat')
      }
    }

    const playerSideAlive = this._campaignFactionAlive(playerSideFaction)
    const enemySideAlive = this._campaignFactionAlive(enemySideFaction)
    if (this.previewCampaignGate) {
      const attackerFaction = opposingCampaignFaction(campaign.defenderFaction)
      reconcileCampaignGateSiege({
        gate: this.previewCampaignGate,
        breachController: this.previewCampaignBreachController,
        availableEntrances: this.campaignSiegeAssault?.entrances,
        npcs: this.npcs,
        attackerFaction,
      })
    }
    hud.updateGate(
      this.previewCampaignGate?.state ?? 'destroyed',
      this.campaignAttackersStarted,
      defenseCampaignCapabilities(campaign).gateControlEnabled && !this.player.dead && this.controlMode !== 'spectator',
    )
    const reinforcementShown = veteranOutpost?.templateId === 'veteran-dread-outpost'
      ? this.campaignReinforcementArrived
      : this.campaignReinforcementSpawned
    if (commanderOutpost) {
      hud.update(runtime.getSnapshot(), playerSideAlive, enemySideAlive, playerSideFaction,
        reinforcementShown, this._commanderOutpostSquadCounts())
    } else {
      hud.update(runtime.getSnapshot(), playerSideAlive, enemySideAlive, playerSideFaction, reinforcementShown)
    }

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
    this.lockOverlay.addEventListener('click', unlockAudio, { signal: this.sceneListeners.signal })
    this.renderer.domElement.addEventListener('click', unlockAudio, { signal: this.sceneListeners.signal })
    window.addEventListener('pointerdown', unlockAudio, { once: true, signal: this.sceneListeners.signal })

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
    }, { signal: this.sceneListeners.signal })
    this.renderer.domElement.addEventListener('click', () => {
      if (!document.pointerLockElement && !this.equipmentUI?.visible && !this.isModelStudio && !isNoLock) {
        this.input.requestPointerLock(this.renderer.domElement)
      }
    }, { signal: this.sceneListeners.signal })
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
    }, { signal: this.sceneListeners.signal })
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
  private _toggleEquipment(): void {
    if (this.player.dead || this.controlMode === 'spectator') return
    this.input.clear()
    this.player.clearTownAction()
    this.armyCommandController.close()
    if (!this.equipmentUI.visible) this.tutorialEquipmentMeleeId = this.inventoryManager.equippedMelee?.id
    this.equipmentUI.toggle(this.skillManager, this.inventoryManager, () => {
      this._showNotify(`⚔️ 已裝備：${this.inventoryManager.equippedMelee?.name ?? '徒手'}`)
      if (this.inventoryManager.meleeEnabled && this.inventoryManager.equippedMelee?.id !== this.tutorialEquipmentMeleeId) this.tutorialScene?.equipmentSelected()
      this.tutorialEquipmentMeleeId = this.inventoryManager.equippedMelee?.id
    })
    if (this.equipmentUI.visible) {
      if (document.pointerLockElement) document.exitPointerLock()
    } else if (!window.location.search.includes('nolock') && !this.trainingUI?.paused) this.input.requestPointerLock()
  }

  private _isCareerCommandFinished(): boolean {
    return Boolean(this.fieldResultPending || this.careerProfile?.activeMission?.result
      || this.defenseCampaignConfig?.careerMissionId && this.defenseCampaignRuntime?.getSnapshot().battleFinished)
  }

  /** Overhead command markers follow the same input ownership as ArmyCommandController.update(). */
  private _updateCommandSelectionMarker(dt: number): void {
    this.commandSelectionMarker?.update(
      !this.isModelStudio && !this.player.dead && this.controlMode === 'player'
        && !this._isCareerCommandFinished() && !this.equipmentUI.visible && !this.trainingUI?.paused,
      this.camera, dt)
  }

  private _updatePlayerInputOwnership(): void {
    const careerEnded = this._isCareerCommandFinished()
    this.interactionInputCaptured = false
    if (this.player.dead || this.controlMode !== 'player' || careerEnded) this.armyCommandUI?.setEnabled(false)
    if (this.equipmentUI.visible) {
      this.input.clear()
      this.player.clearTownAction()
      return
    }
    if (!this.isModelStudio && !this.player.dead && this.controlMode === 'player' && !careerEnded) {
      this.interactionInputCaptured = this.armyCommandController.update()
      if (this.interactionInputCaptured) this.player.clearTownAction()
    }
  }

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
        if (e.repeat || this.player.dead || this.controlMode === 'spectator') return
        this._toggleEquipment()
      }
      if (e.code === 'Escape') {
        if (this.equipmentUI.visible) {
          e.preventDefault()
          this.input.clear()
          this.player.clearTownAction()
          this.equipmentUI.close()
          if (!window.location.search.includes('nolock') && !this.trainingUI?.paused) this.input.requestPointerLock()
        }
      }
    }, { signal: this.sceneListeners.signal })
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
    if (this.isTrainingGround || this.tutorialLaunch) return
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
    if (this.isTrainingGround || this.tutorialLaunch) return
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
    if (this.isTrainingGround || this.tutorialLaunch) return
    if (this.defenseCampaignConfig?.careerMissionId || this.fieldMissionId) return
    if (this.player.dead || this.controlMode === 'spectator') return
    const pos = this.player.position
    const skills = this.skillManager.skillState
    const inv = this.inventoryManager.saveState

    const ok = this.saveManager.save({
      falling: this.player.isFalling ? this.player.fallSnapshot : undefined,
      position: { x: pos.x, y: pos.y, z: pos.z },
      hp: this.player.hp,
      healthRulesVersion: 1,
      maxHp: this.player.maxHp,
      ...(this.player.heroAssetId ? {} : { characterTier: this.player.ordinaryCharacterTier, characterFaction: this.player.characterFaction,
        ...(this.playerMaxHpOverride !== undefined ? { baseMaxHpOverride: this.playerMaxHpOverride } : {}) }),
      stamina: this.player.staminaValue,
      arrows: this.player.arrowCount,
      skills: {
        unarmed: skills.unarmed,
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
        hp: this.player.currentMount.currentHp,
        armorImpactRemaining: this.player.currentMount.armorImpactRemaining,
        flight: this.player.currentMount.flight?.snapshot(),
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
    if (this.isTrainingGround || this.tutorialLaunch) return
    if (this.defenseCampaignConfig?.careerMissionId || this.fieldMissionId) return
    if (this.player.dead || this.controlMode === 'spectator') return
    if (this.player.isFalling || this.player.currentMount?.isAirborne) {
      this._showNotify('請先安全降落再讀檔。')
      return
    }
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
    if (!this.player.heroAssetId) {
      const faction = data.characterFaction ?? this.player.characterFaction
      const tier = data.characterTier ?? this.player.ordinaryCharacterTier
      this.player.setCharacterIdentity(faction, tier)
      if (data.healthRulesVersion === 1) this.playerMaxHpOverride = data.baseMaxHpOverride
      this.basePlayerMaxHp = this.playerMaxHpOverride ?? getOrdinarySoldierHp(faction, tier)
    }
    this.player.setMaxHp(resolveSkillAdjustedMaxHp(this.basePlayerMaxHp, this.skillManager.skillState), false)
    this.player.setHp(restoreSavedPlayerHp(data, this.player.maxHp))
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
      newMountToLoad.restoreArmor(data.mountData?.armorImpactRemaining)
      if (data.mountData?.hp !== undefined) newMountToLoad.currentHp = Math.max(0, Math.min(newMountToLoad.maxHp, data.mountData.hp))
      if (data.mountData?.flight && newMountToLoad.flight) {
        newMountToLoad.flight.restore(data.mountData.flight)
        newMountToLoad.group.rotation.set(-newMountToLoad.flight.pitch, newMountToLoad.flight.yaw, newMountToLoad.flight.bank, 'YXZ')
        this.player.syncMountTransform()
      }
    } else {
      this.mountHud.classList.remove('visible')
    }
    if (data.falling) this.player.restorePendingFall(data.falling)

    if (this.player.hp <= 0) { this.player.detachFromMountOnDeath(); this.player.takeDamage(this.player.maxHp * 100, this.hpBar) }
    this._showNotify('📂 讀檔成功（還原背包與裝備）')
  }

  private _mountPlayer(mount: Mount, initialHeading?: number): void {
    this.player.mountVehicle(mount, initialHeading)
    if (!this.player.isMounted || this.player.currentMount !== mount) return
    if (this.isTrainingGround) mount.visualHold = false
    this._aimTargetRegistry.unregisterMount(mount)
    if (mount.isFlyingMount && this.controlsHint) this.controlsHint.textContent = 'xongkoro · 滑鼠轉向 · W 起飛 · S 減速／低空降落 · A/D 側傾轉彎 · Shift 衝刺 · 左鍵鷹擊 · 右鍵遠程瞄準 · E 卸乘'

    this.mountNameEl.textContent = `坐騎：${mount.displayName}${mount.armorImpactMax > 0 ? ` · 護甲 ${Math.ceil(mount.armorImpactRemaining)}/${mount.armorImpactMax}` : ''}`
    this.mountHpFill.style.width = `${Math.max(0, (mount.currentHp / mount.maxHp) * 100)}%`
    this.mountHud.classList.add('visible')
  }

  private _updateMountHud(): void {
    const mount = this.player.isMounted ? this.player.currentMount : null
    const visible = Boolean(mount && !mount.dead && !this.player.dead && this.controlMode === 'player')
    this.mountHud.classList.toggle('visible', visible)
    if (visible && mount) {
      this.mountNameEl.textContent = `坐騎：${mount.displayName}${mount.armorImpactMax > 0 ? ` · 護甲 ${Math.ceil(mount.armorImpactRemaining)}/${mount.armorImpactMax}` : ''}`
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
    this.input.clear()
    this.player.clearTownAction()
    this.armyCommandController.close()
    this.armyCommandUI?.setEnabled(false)
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
    this._clearPickupFocus()
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
        weaponId: this.inventoryManager.equippedMelee?.id,
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

  /** Weapon and unarmed melee share the Player's hostility rule, so Career field bandits are struck like enemies. */
  private _playerMeleeNpcTargets(radius: number): NPC[] {
    return this.npcGrid.getNearbyInto(this.player.combatPosition, radius, this._nearbyNpcBuffer)
      .filter(npc => !npc.dead && isPlayerHostileNpc(npc))
  }

  // ── Melee Combat Hit Detection (Player Sword -> Enemies / Damageable Obstacles) ──
  private _checkPlayerMeleeHits(): void {
    // Some focused contact owners borrow this method without constructing Game;
    // a real Game always supplies the shared Last Stand lock.
    if (this._commanderOutpostCombatLocked?.()) return
    if (this.fieldMissionId && this.careerProfile?.activeMission?.phase !== 'ENGAGING') return
    const eagle = this.player.currentMount
    if (eagle?.isFlyingMount && !this.player.dead) {
      if (!eagle.eagleAttack?.active) return
      const targets = [...this.npcs.filter(npc => !npc.dead && npc.faction !== this.player.faction), ...this.trainingGround?.dummies ?? []]
      for (const contact of eagle.traceEagleAttack(targets, this.mounts, this.obstacles)) {
        const target = contact.target as NPC | Mount | import('./combat/DamageReceiver').DamageReceiver
        const context = { source: createPlayerCombatActorRef(this.player), method: 'melee' as const,
          attackSource: 'xongkoro' as const, contact, emit: this.combatEvents.emit }
        const amount = XONGKORO.attackDamage * this.skillManager.getMountedImpactMultiplier()
        const result = contact.kind === 'mount' && contact.mount
          ? damageMount(contact.mount, amount, context) : isDamageReceiver(target) ? damageReceiver(target, amount, context) : damageNpc(target as NPC, amount, context)
        if (result.hitSuccess) {
          this.damageNumbers.spawn(result.appliedDamage, target.group.position)
          this._showEnemyHud(result.targetName, result.hpRatio)
        }
      }
      return
    }
    if (this.player.dead || this.controlMode === 'spectator' || this.player.spectatorOnly) return
    const equippedMelee = this.inventoryManager.activeMelee
    if (!equippedMelee) {
      const strikes = this.player.consumeFistStrikes()
      const targets = [...this._playerMeleeNpcTargets(4), ...this.trainingGround?.dummies ?? [],
        ...this.combatMountGrid.getNearbyInto(this.player.combatPosition, 4, this.meleeMountCandidates).filter(mount => !mount.dead && mount !== this.player.currentMount)]
      for (const strike of strikes) {
        const contact = traceFistStrike(strike, this.player.position, targets, this.obstacles)
        if (!contact) continue
        const target = contact.target as NPC | Mount | import('./combat/DamageReceiver').DamageReceiver
        const context = { contact, source: createPlayerCombatActorRef(this.player), method: 'melee' as const, attackSource: 'unarmed' as const, weaponId: 'unarmed', emit: (event: CombatEvent) => { this.combatEvents.emit(event); playAppliedPunchHit(event, this.soundManager) } }
        const amount = unarmedDamage(this.skillManager.getMultiplier('unarmed'), this.player.heroAssetId)
        const result = contact.kind === 'mount' && contact.mount ? damageMount(contact.mount, amount, context)
          : isDamageReceiver(target) ? damageReceiver(target, amount, context) : damageNpc(target as NPC, amount, context)
        if (result.hitSuccess) {
          if (result.appliedDamage > 0) {
            this.damageNumbers.spawn(result.appliedDamage, target.combatPosition)
          }
          this._showEnemyHud(result.targetName, result.hpRatio)
        }
      }
      return
    }
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

    const targets = [...this._playerMeleeNpcTargets(8), ...this.trainingGround?.dummies ?? []]
    const mounts = this.combatMountGrid.getNearbyInto(this.player.combatPosition, 8, this.meleeMountCandidates)
    const contact = this.player.weaponSweep.traceFirst(targets, mounts, this.player.currentMount)
    if (contact) {
      this.player.markHitProcessed()
      const target = contact.target as NPC | Mount | import('./combat/DamageReceiver').DamageReceiver
      const cavalryTarget = contact.kind === 'mount' || target.isMounted
      const finalDamage = Math.round(damage * getAntiCavalryMultiplier(combatKind, this.player.isMounted, cavalryTarget))
      const context = { contact, source: createPlayerCombatActorRef(this.player), method: 'melee' as const,
        weaponId: equippedMelee.id, emit: this.combatEvents.emit }
      const result = contact.kind === 'mount' && contact.mount
        ? damageMount(contact.mount, finalDamage, context) : isDamageReceiver(target) ? damageReceiver(target, finalDamage, context) : damageNpc(target as NPC, finalDamage, context)
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
      if (this.isTrainingGround && !mount.riderPlayer && !mount.isAirborne && !mount.dead) mount.visualHold = true
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
    updateEagleWingbeatAudio(this.soundManager, this.mounts, this.camera.position, this.player.currentMount)

    const pressed = this.input.consumeKeyE()
    for (const pickup of this.pickups) pickup.update(dt)
    if (this.player.dead || this.controlMode === 'spectator' || this.player.spectatorOnly || !this.input.isLocked
      || this.equipmentUI.visible || this.interactionInputCaptured
      || this._isCareerCommandFinished() || this.isModelStudio) {
      this._clearPickupFocus()
      return
    }

    // The press belongs to the target and action displayed in the preceding frame.
    const action = this.pickupFocus.pressed(pressed, this._pickupCandidates(), this.player.position)
    if (action?.action === 'dismount') {
      const prevMount = this.player.currentMount!
      this.player.dismountFromMount()
      if (!this.player.isMounted && prevMount.type === MountType.HORSE && this.trainingGround?.mounts.includes(prevMount)) this.tutorialScene?.operation('dismounted')
      this._aimTargetRegistry.registerMount(prevMount)
      this.mountHud.classList.remove('visible')
    } else if (action?.target instanceof WeaponPickup) {
      const pickup = action.target
      if (pickup.isArrowPack) {
        this.player.setArrowCount(this.player.arrowCount + pickup.arrowQuantity)
        this.quiverUI.setArrowCount(this.player.arrowCount)
        this.pickupHud.notify(`已補充箭矢 · +${pickup.arrowQuantity}`)
      } else {
        this.inventoryManager.addWeapon(pickup.weaponId)
        if (action.action === 'equip') this.inventoryManager.equipWeapon(pickup.weaponId)
        this.pickupHud.notify(`${action.action === 'equip' ? '已裝備' : '已收進背包'} · ${pickup.name}`)
      }
      pickup.destroy()
      const idx = this.pickups.indexOf(pickup)
      if (idx !== -1) this.pickups.splice(idx, 1)
    } else if (action?.action === 'mount') {
      this._mountPlayer(action.target as Mount)
    }

    const yaw = this.thirdPersonCamera.cameraYaw
    const selected = this.pickupFocus.select(this._pickupCandidates(), this.player.position,
      { x: -Math.sin(yaw), z: -Math.cos(yaw) })
    for (const pickup of this.pickups) pickup.setSelected(selected?.target === pickup)
    this.pickupHud.show(selected?.prompt ?? null)
  }

  private _pickupCandidates(): InteractionCandidate<WeaponPickup | Mount>[] {
    const position = this.player.position
    if (this.player.isMounted && this.player.currentMount) return [{
      target: this.player.currentMount, position, range: 2.5, action: 'dismount', prompt: '[E] 下騎',
    }]
    const items: InteractionCandidate<WeaponPickup | Mount>[] = []
    for (const pickup of this.pickups) {
      if (!pickup.isAlive) continue
      const action = pickup.isArrowPack ? 'arrows' : this.customPickupPolicy ? this.inventoryManager.pickupDisposition(pickup.weaponId) : 'backpack'
      const text = action === 'arrows' ? `補充箭矢 · +${pickup.arrowQuantity}`
        : `${action === 'equip' ? '拾起並裝備' : '收進背包'} · ${pickup.name}`
      items.push({ target: pickup, position: pickup.position, range: 2.5, action, prompt: `[E] ${text}` })
    }
    for (const mount of this.mounts) if (mount.availableForPlayer) items.push({
      target: mount, position: mount.group.position, range: 2.5, action: 'mount', prompt: `[E] 騎乘：${mount.displayName}`,
    })
    return items
  }

  private _clearPickupFocus(): void {
    this.pickupFocus.clear()
    this.pickupHud?.show(null)
    for (const pickup of this.pickups) pickup.setSelected(false)
  }

  /** Prevent living people, NPCs, and mounts from occupying the same space. */
  private _resolveEntityCollisions(): void {
    const bodies: EntityCollisionBody[] = []
    const controlledMount = this.player.isMounted ? this.player.currentMount : null

    if (this.player.spectatorOnly || this.player.isFalling || controlledMount?.isFlyingMount) {
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
        walkSurfaces: true,
      })
    }

    for (const npc of this.npcs) {
      if (npc.dead || npc.isFalling) continue
      if (npc.isMounted) continue
      bodies.push({
        position: npc.position,
        anchored: Boolean(npc.siegeTransport),
        radius: 0.5,
        height: 2.3,
        bottomOffset: 0,
        walkSurfaces: true,
        pushWeight: 1.0,
      })
    }

    for (const mount of this.mounts) {
      if (mount === controlledMount || mount.isFlyingMount) continue
      const isCharging = mount.movementSpeed > COMBAT_BALANCE.mountImpact.minSpeed
      bodies.push({
        position: mount.group.position,
        mountedSurfaces: true,
        radius: 1.0,
        height: 2.6,
        bottomOffset: 0,
        pushWeight: isCharging ? 4.0 : 2.0,
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
        this.obstacles,
        { walkSurfaces: body.walkSurfaces, mountedSurfaces: body.mountedSurfaces }
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
        obstacles: this.obstacles,
        worldBound: getScenePlayableWorldBound(this.scene),
        receivers: this.trainingGround?.dummies,
        onPlayerMountHitReceiver: (target, result) => {
          this.damageNumbers.spawn(result.appliedDamage, target.combatPosition)
          this._showEnemyHud(result.targetName, result.hpRatio)
          this.soundManager.playHorseImpact(this.player.currentMount?.currentLod ?? 0, true)
        },
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
    bindWindowResize(this.camera, this.renderer, this.sceneListeners.signal)
  }

  // ── Main loop ──
  private _loop = (frame: number): void => {
    if (this.spawningStopped) return
    requestAnimationFrame(this._loop)
    gameplayNpcSpawns.tick(frame)
    if (this.personalSquad?.error && this.onCareerDeploymentError) {
      this.spawningStopped = true
      this.onCareerDeploymentError(this.personalSquad.error)
      return
    }
    if (this.spawningStopped) return
    const profile = import.meta.env.DEV && this.isDevCombat
    const frameStart = profile ? performance.now() : 0
    let t0 = 0
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this._updateCareerTutorial(dt)

    if (this.trainingUI?.paused || this.isTrainingGround && this.equipmentUI.visible) {
      this.soundManager.updateEagleWingbeats([])
      this.input.clear()
      this._clearPickupFocus()
      this.player.clearTownAction()
      this.commandSelectionMarker?.hide()
      this.renderer.render(this.scene, this.camera)
      return
    }

    if (import.meta.env.DEV && this._isSimulationFrozen) {
      this.soundManager.updateEagleWingbeats([])
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

    this.modelStudio?.updateAnimations(dt)

    // UI owns complete gestures before camera/player consume this frame's input.
    this._updatePlayerInputOwnership()

    // Camera update based on controlMode / studio
    if (this.modelStudio?.updateControls()) {
      // Studio orbit controls own the camera.
    } else if (this.controlMode === 'spectator') {
      this.spectatorController.update(this.input, dt)
    } else {
      this.thirdPersonCamera.update(this.input, dt, this.obstacles)
    }
    this.compass?.update(this.camera)

    this.aerialView.update(this.camera, this.scene, usesAerialView(
      Boolean(this.player.isMounted && this.player.currentMount?.isFlyingMount),
      this.controlMode === 'spectator',
      this.camera.position.y - getTerrainHeight(this.camera.position.x, this.camera.position.z),
    ))

    const currentYaw = this.controlMode === 'spectator'
      ? this.spectatorController.cameraYaw
      : this.thirdPersonCamera.cameraYaw

    const cameraAimPoint = this.isModelStudio
      ? this.camera.getWorldDirection(this._tmpCameraDir).multiplyScalar(100).add(this.camera.position)
      : this._getCameraAimPoint(this._tmpHitPos)
    this._debugAimPoint.copy(cameraAimPoint)

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
      this.skillManager.getRangedMultiplier(),
      !this._commanderOutpostCombatLocked(),
    )

    this.campaignSiegeAssault?.update(dt)
    this.personalSquad?.updateLifecycle()
    this._updateDefenseCampaign(dt)
    this._updateCareerBattle(dt)
    this.battleController?.update(this.npcs, this.player)

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
    populateNpcFactionGrids(this.npcs, this.npcGrid, this.npcFactionGrids, this.playerHostileNpcGrid, npc => {
      npc.combatMountGrid = this.combatMountGrid
    })
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
          () => false, // dead npc can't shoot
          true, // skipBoidsAndObstacles
          cameraDistance,
          collector
        )
        npcLoopIndex++
        continue
      }
      if (this.fieldMissionId && (!this.bridgeLaunch && this.fieldRosterBatch?.ready !== true
        || this.bridgeRuntime && npc.faction === Faction.ENEMY && this.bridgeRuntime.deployment.phase !== 'assault'
        || this.personalSquad && !this.personalSquad.ready || this.careerProfile?.activeMission?.result || this.fieldResultPending)
        || this._commanderOutpostCombatLocked()
        || npc.combatOwnership === 'player-personal' && this.defenseCampaignRuntime?.getSnapshot().activePhase === 'deployment') {
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

      const hostileNpcGrid = selectHostileNpcGrid(npc.faction, this.playerHostileNpcGrid, this.npcFactionGrids)

      npc.update(
        dt, 
        this.player,
        this.npcs,
        nearbyNPCs,
        this.obstacles,
        this.hpBar, 
        (damage, isPlayer, targetNpc, targetMount) => {
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
          } else if (targetMount) {
            const result = damageMount(targetMount, damage, {
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
        (origin, direction, visualKind, lifecycle) => {
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
            lifecycle,
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

    // 4. Impact / Damage (evaluated immediately after mount movement before physical separation)
    if (profile) t0 = performance.now()
    if (!this._commanderOutpostCombatLocked()) this._updateImpactDamage(this.clock.elapsedTime)
    this._persistPersonalOutpost(false, dt)
    const impactMs = profile ? performance.now() - t0 : 0

    // Reset impact flag after impact checks complete for this frame
    for (const mount of this.mounts) {
      mount.skipImpactThisFrame = false
    }

    // 5. Entity Collision
    if (profile) t0 = performance.now()
    this._resolveEntityCollisions()
    settleRiverCrossingDrowning(this.player, this.npcs, this.mounts, this.hpBar)
    const collisionMs = profile ? performance.now() - t0 : 0

    // 6. Arrow / Projectile
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
      this._commanderOutpostCombatLocked(), this.mounts, this.trainingGround?.dummies,
    )

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }
    const arrowMs = profile ? performance.now() - t0 : 0

    // Update Floating Damage numbers
    this._updateMountHud()
    this.damageNumbers.update(dt, this.camera)
    this.trainingUI?.updateLabels(this.camera)

    this.combatTrajectoryDebugger?.update(this.player, this.npcs, this.arrows, this._debugAimPoint)

    // Seat the preview rider on this frame's animated saddle before drawing.
    if (this.modelStudio?.mode === 'mounts') this.modelStudio.fitPreviewRider()
    else {
      this.player.fitMountedSeat()
      for (const npc of this.npcs) npc.fitMountedSeat()
    }

    this._updateCommandSelectionMarker(dt)

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
