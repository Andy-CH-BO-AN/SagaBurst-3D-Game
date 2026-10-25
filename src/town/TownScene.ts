import { TownTutorialController } from './TownTutorialController'
import { canStartCareerTutorial } from '../career/CareerTutorial'
import { commitTownProfile, type TownProfileChange } from './TownProfileCommit'
import { TownRetirementFinaleController } from './TownRetirementFinaleController'
import { appendCommanderRetirementOption } from './TownRetirementUI'
import { TownRetirementMobilizationController } from './TownRetirementMobilizationController'
import { isTownCommandRevokedByRetirement } from '../career/CareerRetirementCommand'
import { isAutonomousTownGuard } from './TownNativeGuardIdentity'
import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import { ActiveMissionClock } from '../career/ActiveMissionClock'
import { raceReturnAction } from '../career/CareerRaceReturn'
import { CareerRaceHUD } from '../ui/CareerRaceHUD'
import { CareerRaceController } from '../career/CareerRaceController'
import { MOUNTED_RACES, raceDefinitionForSchedule, type RaceId } from '../career/CareerRaceState'
import { RACE_LINES } from '../career/CareerRaceRoute'
import { CareerCommandHudTypes } from '../career/CareerCommandHudTypes'
import { createCareerBridgeBattleLaunch } from '../career/CareerBridgeBattle'
import { COMMANDER_BRIDGEHEAD_ID } from '../career/CommanderMissionCatalog'
import { equipmentSections, EQUIPMENT_CATEGORIES, type EquipmentCategory } from '../rpg/EquipmentCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { preloadHighTierEquipment } from '../world/HighTierEquipment'
import { assignTownCivilianHomes, civilianBodyClear, civilianMountsClear, CIVILIAN_MOUNT_CLEARANCE, TownCivilianLife } from './TownCivilianLife'
import { townDefenseThreatResponse, townExternalThreatAlertRange, townStationSpec } from './TownGarrison'
import { EnemyEaglePatrolController } from './EnemyEaglePatrolController'
import { SquadRefitSafety } from '../career/SquadRefit'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { playerEagleProjectileBudget, type ProjectileFlightBudget } from '../combat/ProjectileBallistics'
import { ProjectileAdmission } from '../combat/ProjectileAdmission'
import { TOWN_AIR_COMMAND_IDS } from '../career/TownAirCommandAuthority'
import { TownAirCommandSquadController } from './TownAirCommandSquadController'
import { TownEagleGarrisonController } from './TownEagleGarrisonController'
import { EaglePadReservations, PLAYER_EAGLE_PAD_OWNER } from '../career/EaglePadReservations'
import { AerialViewPolicy, usesAerialView } from '../camera/AerialViewPolicy'
import { captureCareerAerialState, restoreCareerAerialState } from '../career/CareerAerialState'
import { gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch } from '../world/NpcSpawnScheduler'
import { availableCareerItem, careerItemTotal, MAX_PLAYER_OWNED_XONGKORO } from '../career/CareerInventory'
import { createTownCareerEquipmentUI } from './TownCareerEquipmentUI'
import { applyTownEquipmentRuntime, registerTownNativeMount, findTownNativeMount } from './TownEquipmentRuntime'
import { resolveTownActorEquipment, townEquipmentSquads, type TownEquipmentContext } from '../career/CareerTownEquipment'
import { officialCommandHudLabel } from '../career/CommanderTownSquadLabels'
import { townDefaultActorLoadout } from '../career/CareerTownEquipmentState'
import { townMerchantLoadout } from './TownMerchantEquipment'
import { careerMountType } from '../career/CareerMountController'
import { personalMemberRefund, sellPersonalSquadMembers } from '../career/CareerPersonalSquad'
import { appendTownSaleDropdown } from './TownSaleUI'
import { sellTownNativeProducts, townNativeSaleGate, townNativeSaleStock, type TownNativeSaleContext, type TownNativeSaleRequest } from '../career/CareerTownNativeResale'
import { ArmyCommandController } from '../battle/ArmyCommandController'
import { CivilianCommandSquadController } from './CivilianCommandSquadController'
import { officialCommandAcceptsActor, officialCommandIsPlayerControlled } from '../career/CareerCommandAuthority'
import { stageOfficialCommandOrder } from '../career/CareerOfficialCommandOrder'
import { careerCommandHudRoster } from '../career/CareerCommandHudRoster'
import type { PersonalSquadMission } from '../career/CareerPersonalSquadMission'
import { ArmyCommandUI } from '../ui/ArmyCommandUI'
import { FormationController, type FormationCommandAssignment } from '../battle/FormationController'
import { canRecruitPersonalSquad, personalSquadGreeting, recruitPersonalSquadMember, PERSONAL_SQUAD_PRODUCTS, PERSONAL_RECRUIT_DIALOGUE } from '../career/CareerPersonalSquad'
import { townConquestRoster } from './TownHRLayout'
import { TownPersonalSquadController, personalMemberLoadout } from './TownPersonalSquadController'
import { snapshotPersonalMission } from '../career/CareerPersonalSquadMission'
import { siegeMuster } from '../career/TownSiege'
import { personalTownDeployment, personalTownEagleDeployment } from '../career/PersonalSquadDeployment'
import { shouldSpawnTownCommander, townCommanderHeroAsset, resolveTownCommanderPosition, townCommanderSpec } from './TownCommander'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { townAssaultObjectiveRoster, townRoster, townName } from './TownRules'
import { townDefenseForceCountsForProfile } from '../career/TownDefenseRoster'
import { obstacleTopologyRevision } from '../world/ObstacleTopology'
import { TownProjectileObstacles } from './TownProjectileObstacles'
import { ProjectileContactQuery } from '../combat/ProjectileContactQuery'
import { TemporaryBattlefieldMounts } from '../career/TemporaryBattlefieldMounts'
import { WeaponWheel } from '../player/WeaponWheel'
import { WeaponWheelUI } from '../ui/WeaponWheelUI'
import * as THREE from 'three'
import { acceptCavalrySweep, acceptCaptainCavalryCommand, sweepPlayerSpawn, SWEEP_YAW } from '../career/CavalrySweep'
import { Player, PLAYER_ARROW_CAPACITY, DEFAULT_PLAYER_MAX_HP } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { CompassUI } from '../ui/CompassUI'
import { SpectatorCameraController } from '../camera/SpectatorCameraController'
import { NPC, AIType, Faction } from '../world/NPC'
import { Mount, MountType } from '../world/Mount'
import { XongkoroVisual } from '../world/XongkoroVisual'
import { eagleLandingFootprint } from '../world/EagleLanding'
import { isEagleLandingClearOfMounts } from '../world/EagleLandingOccupants'
import { EagleLandingQueue } from '../world/EagleLandingQueue'
import { TOWN_LAYOUT_VERSION } from './TownLayout'
import { migratePersonalTownLayout, placePersonalMissionAtHR } from './TownLayoutMigration'
import { XONGKORO } from '../movement/XongkoroConfig'
import { CIVILIAN_HUMANOID_ASSETS, HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { CorgiVisual } from '../world/CorgiVisual'
import { SnowLeopardVisual } from '../world/SnowLeopardVisual'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { ArrowProjectile, createProjectileWarmupGroup } from '../world/ArrowProjectile'
import { warmTownRenderResources } from './TownRenderWarmup'
import { getScenePlayableWorldBound, getTerrainHeight, setScenePlayableWorldBound, resolveEntityCollision, type ObstacleData } from '../world/Terrain'
import { damageMount, damageNpc, damagePlayer, damageObstacle } from '../combat/DamageRouter'
import { registerTownCombatDisplayName } from '../ui/CombatTargetDisplayName'
import { personalUnitDisplayName } from '../ui/UnitDisplayName'
import { CombatTargetHud } from '../ui/CombatTargetHud'
import { createNpcCombatActorRef, createPlayerCombatActorRef, emitStructureDamage, type CombatDamageMethod, type CombatActorRef, type CombatEvent } from '../combat/CombatAttribution'
import { SpatialGrid } from '../world/SpatialGrid'
import { checkMountImpact, applyMountImpactDamage } from '../combat/MountImpact'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { DamageNumbers } from '../ui/DamageNumbers'
import { acceptCaptainFrontline, acceptCaptainEagle, createCaptainFrontlineLaunch, createCaptainEagleLaunch, type CareerCombatLaunch } from '../career/CaptainBattleLaunch'
import { CAPTAIN_MISSION_CATALOG, CAPTAIN_PATROL_COMMAND_ID, CAPTAIN_CAVALRY_COMMAND_ID, CAPTAIN_GATE_DEFENSE_ID, CAPTAIN_FRONTLINE_COMMAND_ID, CAPTAIN_SIEGE_COMMAND_ID, CAPTAIN_EAGLE_BATTLE_ID, getCaptainMissionDefinition, getCaptainMissionAvailability, createCaptainPatrolCommandMission, captainGateDefenseBriefing, createCaptainGateDefenseMission } from '../career/CaptainMissionCatalog'
import { CaptainPatrolCommandController } from '../career/CaptainPatrolCommandController'
import { TownCommandSquadController, TOWN_COMMAND_RETURN_ID } from './TownCommandSquadController'
import { snapshotCommandActor, restoreCommandActor } from '../career/CareerCommandActorCheckpoint'
import { matchesArmyCommandTarget, type ArmyCommandTarget } from '../battle/CommandTarget'
import { officialFollowLocalOffset } from '../battle/FollowOrder'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { getDefenseCampaignStage } from '../campaign/CampaignConfig'
import { acceptCareerOutpostRelief, isCareerOutpostReliefUnlocked, resolveCareerReliefMount, acceptCareerOutpost, isCareerOutpostUnlocked, CAREER_OUTPOST_STAGES, type CareerOutpostStageId } from '../career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../career/CareerOutpostLaunch'
import { selectTownDialogue, formatTownDialogue, promotionDetails, TownAmbientDialogue, type DialogueContext, type DialogueRole } from '../career/CareerTownDialogue'
import { installTownStyles } from './TownUI'
import { isTownProductOwned, purchaseTownMount, purchaseTownEquipment, sellTownProduct, sellTownProducts, townResalePrice, townSaleStatus, TOWN_RESALE_PERCENT } from './TownRules'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { QuiverUI } from '../ui/QuiverUI'
import { EquipmentUI } from '../ui/EquipmentUI'
import { SkillManager } from '../rpg/SkillManager'
import { SHIELD_CONFIG, type CombatContact } from '../combat/ShieldBlocking'
import { canAwardPlayerSkillProgression, resolveCombatSkill, skillStatesEqual } from '../rpg/CombatSkillProgression'
import { SoundManager, type AudioCommand, type CareerMissionVoiceCue, type HorseGallopCandidate } from '../audio/SoundManager'
import { updateEagleWingbeatAudio } from '../audio/EagleWingbeatAudio'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { canAppointCareerRank, type CareerAppointingRole } from '../career/CareerPromotionAuthority'
import { MAX_BULK_PURCHASE_QUANTITY, CAREER_RANKS, CAREER_RANK_THRESHOLDS, careerMissionCompletionsForTier, clearCareerMission, cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile, type CareerMountId } from '../career/CareerProfile'
import { availableRecruitMissions, availableCareerMissionsForPage, careerMissionTemplatesForPage, defaultCareerMissionPage, isCareerMissionPageUnlocked, getCareerMissionTemplate, patrolPreferredCamp, type CareerMissionPage } from '../career/CareerMissionCatalog'
import { VETERAN_MISSION_CATALOG, getVeteranMissionDefinition, getVeteranMissionAvailability, acceptVeteranMission, createVeteranRoster, veteranTownCavalryReserveSlots } from '../career/VeteranMission'
import { selectTownCavalryReserve } from './TownCavalryReserve'
import { createCareerVeteranOutpostLaunch } from '../career/CareerVeteranOutpost'
import { createCareerCommanderOutpostLaunch } from '../career/CommanderOutpost'
import { acceptCommanderMission as acceptCommanderCareerMission, COMMANDER_DECAPITATION_ID, COMMANDER_LAST_STAND_ID, COMMANDER_MISSION_CATALOG, COMMANDER_SKY_RAID_ID, getCommanderMissionAvailability, getCommanderMissionDefinition, isCommanderTownMission } from '../career/CommanderMissionCatalog'
import { BanditMissionController, selectMissionCavalryActorIds, veteranPlayerSpawn, veteranPlayerYaw } from '../career/BanditMissionController'
import { CareerDuelController, restoreCareerDuelCommander } from '../career/CareerDuelController'
import { MissionGuide } from '../career/MissionGuide'
import { areOrdinaryTownServicesPeaceful, canStartOrdinaryTownHostility, startCommanderRetirement } from '../career/CareerRetirement'
import { townRetirementRallyTarget } from './TownBounds'
import { CareerDuelHUD } from '../ui/CareerDuelHUD'
import { CAREER_DUEL_TIERS, type CareerDuelTier, isCareerDuelUnlocked } from '../career/CareerDuelState'
import { getUnitPresetsForFaction, UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { fieldMissionHud } from '../career/CareerMissionPresentation'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import { acceptEnemyTownAssault, acceptCaptainSiegeCommand } from '../career/EnemyTownAssault'
import { careerTownSceneRoster, isCareerEnemyTerritoryFieldMission, resolveCareerTownSceneContext } from '../career/CareerFieldSceneContext'
import { townWartimeHostile } from './TownWartime'
import { TownDefenseController } from '../career/TownDefenseController'
import { CommanderFourGateDefenseController } from '../career/CommanderFourGateDefenseController'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import { CommanderTownMissionController } from '../career/CommanderTownMissionController'
import { CareerMountController } from '../career/CareerMountController'
import { preserveHpRatio, resolveCareerCharacterTier, resolveCareerOrdinaryTier, resolveCareerHeroAsset, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import { createTownDefenseMission, type CareerMissionOutcome, type CareerMissionResult } from '../career/CareerMissionState'
import { VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../career/TownDefenseState'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { townMeleeBuildingContact } from './TownCombat'
import { TownWorld } from './TownWorld'
import { TOWN_NAVIGATION_BOUNDS, TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { TownEquipment } from './TownEquipment'
import { TownMissionSettlement, restoreMissionReturnResident } from './TownMissionSettlement'
import { TownMissionCombat, type TownCombatResident as Resident } from './TownMissionCombat'
import { TownCavalryPatrolController } from './TownCavalryPatrolController'
import { withTownCommandSquadRoster } from './TownRules'
import { TownOutskirtsWarfareController } from './TownOutskirtsWarfareController'
import { TOWN_RULES, townActorHeroProfile, TownEvent, townCaptainProfile, townMilitaryEquipment, stableHorsePositions, townSitePoint, townPlayerEntryPoint, TOWN_SITES, isCivilian, productStatus, townShopProducts, deferTownResult, settleTown, updateRangerMount, type TownResult } from './TownRules'

let sound: SoundManager
interface Shot { arrow: ArrowProjectile; readonly training: boolean; readonly player: boolean; readonly source?: NPC; readonly sourceRef?: CombatActorRef; age: number; maxLifetimeSeconds?: number }
const NAMES: Record<string, string> = { captain: '騎兵隊長', commander: '指揮官', deployment: '士官長', merchant: '武器店主', ranger: '遊俠 Shadow Warden', cat: '黑貓店主', civilian: '平民 Civilian', 'hr-officer': '人力資源官 HR Officer', 'eagle-trainer': 'xongkoro 遊俠場主' }
export class TownScene {
  private eagleGarrison?: TownEagleGarrisonController
  private readonly eagleLandingQueue = new EagleLandingQueue()
  private garrisonRestored = false
  private readonly aerialView = new AerialViewPolicy()
  private readonly weaponWheel = new WeaponWheel()
  private readonly weaponWheelUI = new WeaponWheelUI()
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 400)
  readonly renderer: THREE.WebGLRenderer
  readonly event: TownEvent
  private readonly residentRoster: ReturnType<typeof careerTownSceneRoster>
  readonly world: TownWorld
  player!: Player
  readonly residents: Resident[] = []
  readonly mounts: Mount[] = []
  readonly stableHorses: Mount[] = []
  private readonly serviceMarkers = new Map<string, THREE.Sprite>()
  cat!: Mount
  readonly inventory: TownEquipment
  private readonly input = new PlayerInput()
  private orbit!: ThirdPersonCamera
  private compass?: CompassUI
  private spectator: SpectatorCameraController | null = null
  private readonly combatMountGrid = new SpatialGrid<Mount>(8)
  private readonly combatMounts: Mount[] = []
  private readonly meleeMountCandidates: Mount[] = []
  private readonly temporaryMounts = new TemporaryBattlefieldMounts()
  private nearbyTemporaryMount: Mount | null = null
  private readonly grid = new SpatialGrid<NPC>(4)
  private readonly neighbors: NPC[] = []
  private nextTrainingSound = 0
  private readonly previousControls = document.getElementById('controls-hint')!.textContent
  private npcObstacleRevision = -1
  private npcObstacles: ObstacleData[] = []
  private readonly navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  private readonly combatTargetHud = new CombatTargetHud()
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly equipment = new EquipmentUI()
  private readonly skills = new SkillManager()
  private readonly listeners = new AbortController()
  private readonly hud = document.createElement('div')
  private readonly duelHud = new CareerDuelHUD()
  private readonly duelGuide = new MissionGuide('career-duel-guide')
  private readonly captainPatrolGuide = new MissionGuide('career-captain-patrol-guide')
  private readonly retirementGuide = new MissionGuide('career-retirement-guide')
  private retirementDepartureApplied = false
  private retirementMobilization?: TownRetirementMobilizationController
  private retirementFinale?: TownRetirementFinaleController
  private readonly hint = document.createElement('div')
  private readonly pointerPrompt = document.createElement('div')
  private panel: HTMLDivElement | null = null
  private target: string | null = null
  private shots: Shot[] = []
  private readonly projectileAdmission = new ProjectileAdmission(100, 60)
  get projectileDiagnostics() { return { activeShots: this.shots.length, ...this.projectileAdmission.snapshot() } }
  private readonly shotContacts = new ProjectileContactQuery()
  private readonly projectileObstacles = new TownProjectileObstacles()
  private raf = 0
  private last = performance.now()
  private elapsed = 0
  private disposed = false
  private promotionAttempt: object | null = null
  private restoringAerialState = true
  private result: TownResult | null = null
  chargeSpeakerId: string | null = null
  private readonly damageNumbers = new DamageNumbers()
  private readonly ambient = new TownAmbientDialogue()
  private civilianLife = new TownCivilianLife()
  private readonly ambientLabel = document.createElement('div')
  private ambientUntil = 0
  private ambientActor: NPC | null = null
  private readonly previousTip = new THREE.Vector3()
  private hasPreviousTip = false
  private notice = ''
  private readonly store = new CareerProfileStore()
  private tutorial?: TownTutorialController
  private careerSkillsDirty = false
  private careerSkillSaveTimer: number | null = null
  private mission!: BanditMissionController
  private duel!: CareerDuelController
  private defense!: TownDefenseController | CommanderTownMissionController | CommanderFourGateDefenseController
  private careerMounts!: CareerMountController
  private missionSettlement!: TownMissionSettlement
  private patrol!: TownCavalryPatrolController
  private squadRefitSafety = new SquadRefitSafety()
  private townCommand?: TownCommandSquadController
  private civilianCommand?: CivilianCommandSquadController
  private townAirCommand?: TownAirCommandSquadController
  private race?: CareerRaceController
  private readonly raceGuide = new MissionGuide('career-race-guide')
  private readonly raceHud = new CareerRaceHUD()
  private raceClockDt = 0
  private readonly preparationClock = new ActiveMissionClock()
  private captainPatrol?: CaptainPatrolCommandController
  private readonly commandActors: NPC[] = []
  private missionCombat!: TownMissionCombat
  private privateEaglePads?: EaglePadReservations
  private personalSquad?: TownPersonalSquadController
  private personalCommands?: ArmyCommandController
  private personalSaveElapsed = 0
  private personalCriticalState = ''
  private readonly siegeHitTargets = new Set<DamageableObstacle>()
  private readonly siegeHitRadius = new WeakMap<DamageableObstacle, number>()
  private readonly siegeRaycaster = new THREE.Raycaster()
  private readonly siegeRayHits: THREE.Intersection[] = []
  private readonly defenseTargetRosters = new WeakMap<NonNullable<CareerProfile['activeMission']>, ReadonlySet<string>>()
  private personalCommandUI?: ArmyCommandUI
  private personalFormation?: FormationController
  private enemyEaglePatrol?: EnemyEaglePatrolController
  private outskirts?: TownOutskirtsWarfareController
  private missionResultOpen = false
  private deploymentPage?: CareerMissionPage | 'duel'
  private duelActivity: 'duel' | 'race' = 'duel'
  private duelPresetId?: UnitPresetId
  private careerCommandCue: AudioCommand | null = null
  private ambientDefeatShown = false
  private townRefitOnReturn = false
  private residentReturnPending = false
  private get fourGateCombatHeld(): boolean {
    return this.profile.activeMission?.kind === 'commander-four-gate-defense'
      && (!(this.defense instanceof CommanderFourGateDefenseController) || !this.defense.combatEnabled)
  }
  private get sceneContext() { return resolveCareerTownSceneContext(this.profile) }
  private pointerWasLocked = false
  private careerSaveFailures = 0
  private spawnErrorShown = false
  private residentSpawnBatch?: NpcSpawnBatch
  private commanderReturnPending = false
  private get deploymentReady(): boolean {
    return (this.mission?.ready ?? true) && (this.defense?.ready ?? true)
      && (!(isCommanderTownMission(this.profile.activeMission) || this.profile.activeMission?.kind === 'commander-four-gate-defense') || (this.personalSquad?.ready ?? true))
  }
  private get deploymentFailed(): boolean {
    return [...(this.mission?.spawnBatches ?? []), ...(this.defense?.spawnBatches ?? []), ...(this.outskirts?.batches ?? []), ...(this.enemyEaglePatrol?.batches ?? [])]
      .some(batch => batch.status === 'failed') || Boolean(this.personalSquad?.error)
  }

  static async create(container: HTMLElement, profile: CareerProfile, onCampaign: (config?: CareerCombatLaunch) => void, onRestart: (p: CareerProfile, reason?: 'death-return') => void, onHome: () => void, progress: (text: string) => void = () => {}, onTutorialLaunch?: (stage: 'recruit' | 'captain', replay?: boolean) => boolean): Promise<TownScene> {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    try {
      progress('載入人物、坐騎與動畫…')
      const playerHero = resolveCareerHeroAsset(profile)
      const sceneContext = resolveCareerTownSceneContext(profile)
      // Veteran VI includes the opposing native population and may borrow home
      // residents. Resolve their actual civilian styles before queued spawning.
      const civilianFactions = new Set(careerTownSceneRoster(profile).filter(entry => isCivilian(entry.spec.role)).map(entry =>
        sceneContext.missionOnlyResidents && !entry.borrowed ? sceneContext.worldFaction : sceneContext.residentFaction))
      const commanderHero = shouldSpawnTownCommander(profile) ? townCommanderHeroAsset(sceneContext.residentFaction) : null
      const formerCommanderHero = profile.activeMission?.kind === 'commander-decapitation' ? townCommanderHeroAsset(profile.faction) : null
      const siegeHeroes = profile.activeMission?.kind === 'commander-four-gate-defense'
        ? (['roman-hero-t5', 'viking-hero-t5'] as const).map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor)) : []
      const personalHeroes = new Set((profile.personalSquad?.members ?? []).flatMap(member => {
        const hero = personalMemberLoadout(member, profile.faction).hero
        return hero ? [hero.visualAssetId] : []
      }))
      await Promise.all([...siegeHeroes, preloadPaladinEquipment(), preloadHighTierEquipment(), HumanoidAssetRegistry.preload(), ...[...civilianFactions].map(faction => HumanoidAssetRegistry.preloadAsset(CIVILIAN_HUMANOID_ASSETS[faction])), HorseAssetRegistry.preload(renderer), BlackCatVisual.preload(), CorgiVisual.preload(), SnowLeopardVisual.preload(), XongkoroVisual.preload(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[townCaptainProfile(sceneContext.residentFaction).visualAssetId].descriptor), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['maki-archer-t4'].descriptor), preloadMakiRangerBow(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['viking-hero-t4'].descriptor), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['roman-hero-t4'].descriptor), ...(commanderHero && commanderHero !== playerHero ? [HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[commanderHero].descriptor)] : []), ...(formerCommanderHero && formerCommanderHero !== playerHero && formerCommanderHero !== commanderHero ? [HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[formerCommanderHero].descriptor)] : []), ...(playerHero ? [HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[playerHero].descriptor)] : []), ...[...personalHeroes].filter(id => id !== playerHero && id !== commanderHero && id !== formerCommanderHero).map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))])
      progress('建立村莊與營地…')
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const town = new TownScene(container, renderer, profile, onCampaign, onRestart, onHome, onTutorialLaunch)
      try { await town.initialize(progress); return town } catch (error) { town.dispose(); throw error }
    } catch (error) { renderer.dispose(); throw error }
  }
  private constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, public profile: CareerProfile, private readonly onCampaign: (config?: CareerCombatLaunch) => void, private readonly onRestart: (p: CareerProfile, reason?: 'death-return') => void, private readonly onHome: () => void, private readonly onTutorialLaunch?: (stage: 'recruit' | 'captain', replay?: boolean) => boolean) {
    installTownStyles()
    sound ??= new SoundManager()
    sound.cancelCareerAudio()
    this.renderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement)
    const context = this.sceneContext
    this.world = new TownWorld(context.worldFaction, this.scene, context.worldOwnerAllegiance,
      { fourGateSiege: profile.activeMission?.kind === 'commander-four-gate-defense' })
    this.navigation.setTownRamparts(this.world.fortifications.rampartLayout)
    this.navigation.townNav!.setWatchtower(this.world.commandWatchtower)
    const population = townConquestRoster(this.world.hr, withTownCommandSquadRoster(context.residentFaction, townRoster()), this.world.eagleTraining, this.world.eagleGarrison)
    if (shouldSpawnTownCommander(profile)) {
      this.navigation.sync(this.world.obstacles)
      population.push(townCommanderSpec(resolveTownCommanderPosition(this.world.obstacles, this.world.roads, this.navigation, population)))
    }
    this.navigation.sync(this.world.obstacles)
    assignTownCivilianHomes(population, this.world.airspaceObstacles, this.navigation)
    this.residentRoster = careerTownSceneRoster(profile, population)
    const residentIds = new Set(this.residentRoster.map(entry => entry.spec.id))
    this.event = new TownEvent(context.missionOnlyResidents ? this.residentRoster.map(entry => entry.spec)
      : population.filter(spec => spec.role === 'cat' || residentIds.has(spec.id)))
    this.inventory = new TownEquipment(() => this.profile, p => this.commit(p))
    this.skills.setSkillState(profile.skills ?? {})
  }
  private async initialize(progress: (text: string) => void): Promise<void> {
    const { profile, renderer } = this
    const context = this.sceneContext
    const roster = this.residentRoster
    const yieldFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const catSpot = townSitePoint('stable', -3, 8)
    this.cat = new Mount(this.scene, MountType.BLACK_CAT, catSpot.x, catSpot.z); this.cat.group.rotation.y = catSpot.yaw; this.cat.reservedForTown = true; this.cat.catVisual?.setEquipmentVisible(true); this.mounts.push(this.cat)
    registerTownNativeMount(this.cat, `${context.worldFaction}/ranger/mount`)
    this.cat.group.visible = !context.missionOnlyResidents
    if (!context.missionOnlyResidents) {
      this.event.register('cat', this.cat)
      this.serviceMarkers.set('cat', this.world.addServiceMarker(this.cat.group, 2.15))
    }
    for (const stall of context.missionOnlyResidents ? [] : stableHorsePositions()) {
      const horse = new Mount(this.scene, MountType.HORSE, stall.x, stall.z, getTerrainHeight(TOWN_SITES.stable.x, TOWN_SITES.stable.z) + .5, stall.variant)
      horse.reservedForTown = true; horse.group.rotation.y = stall.yaw
      this.stableHorses.push(horse); this.mounts.push(horse)
    }
    await this.initializeResidents(roster, context, progress)
    this.patrol = new TownCavalryPatrolController(this.residents)
    const patrolBorrower = this.profile.activeMission
    const patrolOwned = new Set(patrolBorrower?.kind === 'town-defense' || patrolBorrower?.kind === 'commander-four-gate-defense' || patrolBorrower?.kind === 'enemy-town-assault'
      ? this.residents.filter(r => r.spec.duty === 'patrol').map(r => r.spec.id)
      : [...(patrolBorrower?.officialSquad?.actorIds ?? []), ...(patrolBorrower?.borrowedActorIds ?? []),
        ...(this.profile.townCommandSquad?.commandedActorIds ?? []), ...(this.profile.townCommandSquad?.refittingActorIds ?? []),
        ...Object.keys(this.profile.townCommandSquad?.nativeReturnStates ?? {})])
    this.patrol.restoreCheckpoint(this.profile.townPatrols?.[context.worldFaction], patrolOwned)
    this.eagleGarrison = new TownEagleGarrisonController(this.residents, this.eagleLandingQueue)
    this.eagleGarrison.setRecoveryAllowed(this.profile.activeMission?.kind !== 'commander-four-gate-defense')
    this.world.finalizeTrainingTargets()
    progress('預熱動畫、材質與陰影…')
    this.camera.position.set(0, 24, 42); this.camera.lookAt(0, 0, 0)
    for (const distance of [100, 35, 0]) {
      for (let i = 0; i < this.residents.length; i++) {
        this.residents[i].npc.updateTownPeace(.2, distance, Boolean(this.residents[i].target), true)
        if (i % 8 === 0) await yieldFrame()
      }
      for (const mount of this.mounts) { mount.setCameraDistance(distance); mount.horseVisual?.update(.016, distance) }
      this.scene.updateMatrixWorld(true)
      await renderer.compileAsync(this.scene, this.camera)
      renderer.render(this.scene, this.camera); await yieldFrame()
    }
    for (const resident of this.residents) { resident.npc.setTownPeaceful(); resident.npc.updateTownPeace(.2, resident.npc.group.position.distanceTo(this.camera.position), false, false) }
    progress('村莊準備完成，生成玩家…')
    this.player = new Player(this.scene, profile.faction, resolveCareerHeroAsset(profile), resolveCareerOrdinaryTier(profile))
    this.bindBlockingProgression()
    this.player.setMaxHp(resolveCareerPlayerMaxHp(profile, DEFAULT_PLAYER_MAX_HP), true)
    const townEntry = townPlayerEntryPoint()
    this.player.group.position.set(townEntry.x, getTerrainHeight(townEntry.x, townEntry.z) + .9, townEntry.z)
    this.player.group.rotation.y = townEntry.yaw
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.navigation.sync(this.world.obstacles)
    this.outskirts = new TownOutskirtsWarfareController(this.scene, context.worldFaction,
      () => this.profile, this.world.obstacles, this.navigation, undefined, this.profile.activeMission?.siege?.claimedSquadIds,
      undefined, this.profile.activeMission?.siege?.attackerIds,
      this.profile.activeMission?.kind === 'town-defense' || this.profile.activeMission?.kind === 'enemy-town-assault',
      this.profile.activeMission?.kind === 'commander-four-gate-defense')
    this.outskirts.synchronizeRank()
    this.restoreOutskirtsCheckpoint()
    this.initializeEnemyEaglePatrol(context.worldFaction)
    this.townCommand = new TownCommandSquadController(this.residents, () => this.player, () => this.profile, p => this.commit(p),
      { sceneKey: context.worldFaction === this.profile.faction ? 'town-home' : `town-enemy:${context.worldFaction}`,
        canRefit: actors => !this.restoringAerialState && !this.commanderReturnPending
          && (this.residentSpawnBatch?.ready ?? true) && this.deploymentReady && !this.defense?.active
          && !this.profile.activeMission && !this.profile.activeOutpostMission && this.world.faction === this.profile.faction
          && this.canRefitSquad(actors, true),
        refitEngaged: resident => this.townRefitEngaged(resident.npc),
        canRefitNative: resident => resident.spec.eagle ? this.eagleGarrison?.canServiceRefit(resident.npc) ?? false
          : this.patrol!.canServiceRefit(resident.spec.id),
        beginNativeRefit: resident => {
          if (resident.spec.eagle) this.eagleGarrison!.requestServiceRefit(resident.npc)
          else this.patrol!.requestServiceRefit(resident.spec.id)
        },
        nativeRefitPending: resident => resident.spec.eagle ? this.eagleGarrison!.serviceRefitPending(resident.npc)
          : ['RETURN_TO_BARRACKS', 'REFIT'].includes(this.patrol!.returnStateFor(resident.spec.id) ?? ''),
        canClaimNative: resident => resident.spec.duty !== 'patrol' || this.patrol!.canClaimTownCommand(resident.spec.id),
        claimNative: resident => resident.spec.duty !== 'patrol' || this.patrol!.claimTownCommand(resident.spec.id),
        nativeReturnOnRelease: resident => resident.spec.duty === 'patrol' ? 'RETURN_TO_BARRACKS' : undefined,
        releaseNative: resident => { if (resident.spec.duty === 'patrol') this.patrol!.beginMissionReturn(resident.spec.id, true) },
        nativeReturnState: actorId => this.patrol!.returnStateFor(actorId) ?? undefined,
        restoreNativeReturn: (actorId, state) => this.patrol!.restoreMissionReturn(actorId, state, true),
      })
    this.townCommand.restore()
    this.townAirCommand = new TownAirCommandSquadController(this.residents, () => this.player,
      () => this.profile, this.eagleGarrison!, context.worldFaction)
    this.captainPatrol = new CaptainPatrolCommandController(this.residents, this.patrol, () => this.player, () => this.profile, p => this.commit(p),
      { personalActors: () => this.personalSquad?.actors ?? [],
        resumeFormation: (npc, reference) => this.personalFormation?.joinCommand(npc, reference) ?? false })
    this.initializePersonalSquad()
    this.personalCommandUI = new ArmyCommandUI(profile.faction, this.hud)
    this.personalFormation = new FormationController(this.scene, this.camera, this.commandActors, this.world.terrainMesh,
      this.world.obstacles, this.navigation, TOWN_NAVIGATION_BOUNDS)
    this.personalCommands = new ArmyCommandController(this.commandActors, profile.faction, this.input, this.personalCommandUI,
      this.personalFormation, (order, target) => this.onPlayerCommandIssued(order, target ?? 'all'),
      'attack', () => this.commandsEnabled(), this.inventory, 'squad', true, {
        enabled: () => this.personalCommandsEnabled(),
        issue: order => this.issuePartyOrder(order, 'squad:personal'),
      }, { enabled: () => this.commandsEnabled(), accepts: npc => this.isAuthorizedCommandActor(npc),
        beforeIssue: (order, target, participants, assignments) => this.preparePlayerCommand(order, target, participants, assignments),
        issue: (order, target) => this.issuePartyOrder(order, target) },
      () => this.commandHudRoster())
    this.tutorial = new TownTutorialController({
      profile: () => this.profile, commit: next => this.commit(next),
      peaceful: () => !this.disposed && !this.player.dead && !this.event.hostile
        && canStartCareerTutorial(this.profile) && this.world.faction === this.profile.faction,
      blocked: () => Boolean(this.panel || this.equipment.visible || this.result || this.spectator || this.spawnErrorShown),
      playerPosition: () => this.player.combatPosition,
      playerHorse: () => this.player.currentMount?.type === MountType.HORSE,
      cameraYaw: () => this.orbit.cameraYaw,
      npcPosition: id => { const npc = this.residents.find(resident => resident.spec.id === id)?.npc; return npc && !npc.dead ? npc.combatPosition : null },
      tower: this.world.commandWatchtower, roster: () => this.commandHudRoster(),
      launch: (stage, replay) => {
        if (!canStartCareerTutorial(this.profile) || !this.flushCareerSkillProgression()
          || !this.onTutorialLaunch?.(stage, replay)) return false
        // The route owner just saved a session against the latest profile. Disposal must retain it.
        const latest = this.store.loadChecked().profile
        if (latest && latest.tutorial?.careerId === this.profile.tutorial?.careerId) this.profile = latest
        this.dispose(); return true
      }, duel: () => this.acceptTutorialDuel(),
    })
    this.personalCommands.onAccepted = event => this.tutorial?.commandAccepted(event)
    this.personalCommandUI.setEnabled(this.commandsEnabled())
    // Enemy-territory field missions may reserve a Patrol officer instead of the
    // service Captain, or use only temporary officers. Recruit-party captain access
    // is unused there, but constructing the field controller must still succeed.
    const missionCaptain = (this.residents.find(resident => resident.spec.id === 'captain')
      ?? this.residents.find(resident => resident.npc.faction === Faction.TOWN)
      ?? this.residents[0]).npc
    this.mission = new BanditMissionController(this.scene, this.world, this.navigation, missionCaptain, this.residents, () => this.player, () => this.profile, p => this.commit(p))
    this.mission.personalActors = () => this.personalSquad?.actors ?? []
    this.mission.onBorrowMountedActor = actorId => { this.patrol.relinquish(actorId) }
    this.mission.onMarchStarted = () => this.playMissionVoice('follow')
    this.mission.onSweepCharge = () => sound.playCommanderCommand(this.profile.faction, 'charge')
    this.duel = new CareerDuelController(this.scene, this.world, this.navigation, this.residents, this.cat, () => this.player, () => this.profile, p => this.commit(p))
    this.duel.onMarchStarted = () => this.playMissionVoice('follow')
    this.duel.onReturnStarted = () => this.playMissionVoice('return')
    this.defense = this.profile.activeMission?.kind === 'commander-four-gate-defense'
      ? new CommanderFourGateDefenseController(this.scene, this.residents, () => this.player, () => this.profile,
        p => this.commit(p), this.navigation, { world: this.world, patrol: this.patrol, outskirts: this.outskirts,
          blockers: () => this.siegeMovementBlockers(),
          registerHit: ramp => {
            this.siegeHitTargets.add(ramp.damageable)
            // Conservative authored vehicle radius; cheap broad phase before precise part/wheel triangles.
            this.siegeHitRadius.set(ramp.damageable, Math.hypot(ramp.surface.length + ramp.surface.landing,
              ramp.surface.topY - ramp.surface.startY) + ramp.bridgeSurface.length + 8)
          },
          unregisterHit: ramp => { this.siegeHitTargets.delete(ramp.damageable) } })
      : isCommanderTownMission(this.profile.activeMission)
      ? new CommanderTownMissionController(this.scene, this.residents, () => this.player, () => this.profile,
        p => this.commit(p), this.navigation, undefined, { obstacles: this.world.obstacles,
          otherThreats: () => [...this.mission.ambientBandits, ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? [])]
            .filter(npc => !npc.dead && (npc.faction === Faction.ENEMY || npc.faction === Faction.BANDIT))
            .map(npc => ({ x: npc.combatPosition.x, z: npc.combatPosition.z, range: npc.maxRangedAttackDistance })) })
      : new TownDefenseController(this.scene, this.residents, () => this.player, () => this.profile, p => this.commit(p), this.cat, this.navigation, {
        gates: this.world.gates, obstacles: this.world.obstacles, patrol: this.patrol, outskirts: this.outskirts,
        closureBodies: () => this.siegeClosureBodies(),
        ambientEnemies: () => this.mission.ambientBandits,
      })
    this.defense.personalActors = () => this.personalSquad?.actors ?? []
    this.civilianCommand = new CivilianCommandSquadController(this.residents, () => this.player, () => this.profile, p => this.commit(p, 'civilian-command'), {
      sceneKey: `town:${context.worldFaction}`, townFaction: context.worldFaction,
      refitSceneKey: context.worldFaction === this.profile.faction ? 'town-home' : `town-enemy:${context.worldFaction}`,
      canRefit: (actors, orders) => this.canRefitCivilians(actors, orders),
      hasMountedCivilianClearance: point => civilianBodyClear(point, this.world.airspaceObstacles),
      canPlaceMountedCivilian: (point, actorId) => this.canPlaceMountedCivilian(point, actorId),
      onClaim: npc => this.defense.claimCivilianCommand(npc),
      onRelease: npc => this.defense.returnCivilianCommand(npc),
    })
    this.defense.civilianCommandOwns = npc => Boolean(this.civilianCommand?.ownsPlayerCommand(npc) || this.civilianCommand?.ownsPeacefulTravel(npc))
    this.initializeCareerMounts()
    this.race = new CareerRaceController(this.scene, this.navigation, this.world.obstacles, this.residents,
      () => this.player, this.hp, this.careerMounts, () => this.profile, p => this.commit(p, this.player.dead && this.profile.activeRace && !p.activeRace ? 'grounded-return' : 'ordinary'))
    this.missionCombat = new TownMissionCombat(
      { field: this.mission, duel: this.duel, defense: this.defense },
      {
        player: () => this.player,
        residents: this.residents, mounts: this.mounts, cameraPosition: this.camera.position, obstacles: this.world.obstacles,
        navigation: this.navigation, hp: this.hp, careerMounts: this.careerMounts, airspaceObstacles: this.world.airspaceObstacles,
        outskirts: () => this.outskirts,
        airPatrol: () => this.enemyEaglePatrol,
        personalSquad: () => this.personalSquad,
        patrol: () => this.patrol,
        raceActors: () => this.race?.actors ?? [],
        raceMounts: () => this.race?.allMounts ?? [],
        onActorMoved: npc => this.race?.observeActorMovement(npc),
        commandActors: () => [...(this.captainPatrol?.fieldNpcs ?? []), ...(this.townCommand?.combatActors ?? []), ...(this.civilianCommand?.combatActors ?? []), ...(this.townAirCommand?.combatActors ?? []),
          ...this.commandActors.filter(npc => {
            const authority = this.profile.activeMission?.officialSquad
            return authority && !this.profile.activeMission?.result && officialCommandIsPlayerControlled(authority, npc.combatantId) && this.isAuthorizedCommandActor(npc)
          })],
        preparePeaceResidents: (excluded, dt) => {
          this.patrol.beginFrame(excluded, dt); this.townCommand?.beginFrame()
          if (this.retirementMobilization?.active) {
            this.grid.clear()
            for (const { npc } of this.residents) if (!npc.dead) this.grid.insert(npc)
          }
        },
        ownsPeacefulTravel: npc => this.retirementMobilization?.owns(npc) || this.civilianCommand?.ownsPeacefulTravel(npc) || this.townCommand?.ownsPeacefulTravel(npc) || this.patrol.returnStateFor(npc.combatantId) !== null && !this.patrol.combatEnabled(npc) && !this.captainPatrol?.owns(npc),
        peaceResident: (resident, dt) => this.updatePeace(resident, dt),
        updateEagleDuty: (npc, dt, combat) => this.updateEagleDuty(npc, dt, combat),
        playerOwnsEagleCommand: npc => this.playerOwnsEagleCommand(npc),
        updateCommandCue: () => this.updateCareerCommandCue(),
        clearCombatShots: () => this.clearMissionCombatShots(),
        hitNpc: (target, damage, method, source) => this.hitFieldNpc(target, damage, method, source),
        damagePlayer: (source, damage, method) => this.damagePlayerFromNpc(source, damage, method),
        fireNpc: (origin, direction, kind, source, lifecycle) => this.fire(origin, direction, source.rangedProjectileSpeed, source.rangedDamage, false, false, kind, source, lifecycle),
      },
    )
    const town = this
    this.missionSettlement = new TownMissionSettlement(
      { read: () => this.profile, commit: (p, options) => this.commit(p, options) },
      { field: this.mission, duel: this.duel, defense: this.defense, patrol: this.captainPatrol },
      {
        residents: this.residents, cat: this.cat,
        releaseExternalThreat: npc => this.missionCombat.releaseExternalThreat(npc),
        beginPatrolMissionReturn: actorId => { this.patrol.beginMissionReturn(actorId) },
        beginEagleMissionReturn: actorId => { this.eagleGarrison?.beginRefit(actorId) },
        applyResidentReturn: () => {
          for (const resident of this.residents) if (resident.spec.role === 'civilian') this.civilianLife?.suspend(resident.spec.id)
          this.civilianCommand?.applySavedState(this.profile.civilianCommandSquad)
          this.residentReturnPending = false
        },
        preservesResident: npc => Boolean(this.townCommand?.owns(npc) || this.civilianCommand?.owns(npc)),
        world: this.world, navigation: this.navigation, inventory: this.inventory,
        get player() { return town.player },
        clearCombatShots: () => this.clearMissionCombatShots(),
        restPlayer: () => this.restPlayerInTown(),
        returnPersonalSquad: direct => this.personalSquad?.endMission(direct),
        restart: p => { this.missionResultOpen = false; const reason = this.player.dead ? 'death-return' : undefined; this.dispose(); this.onRestart(p, reason) },
      },
    )
    this.player.onPlayerDeath = () => this.enterMissionObserver()
    await this.restoreActiveCareerMission()
    this.race.restore()
    await this.race.waitForDeployment()
    this.race.restorePlayer()
    if (this.player.dead && this.profile.activeRace) this.enterMissionObserver()
    await this.waitForInitialMissionDeployment(progress)
    progress('預熱城外 Bandit…')
    const banditWarmupStarted = performance.now()
    for (const distance of [100, 35, 0]) {
      for (const bandit of this.mission.ambientBandits) bandit.updateTownPeace(.2, distance, false, false)
      this.scene.updateMatrixWorld(true)
      await renderer.compileAsync(this.scene, this.camera)
      await yieldFrame()
    }
    if (import.meta.env.DEV) console.info(`[CareerTownWarmup] ambient Bandit ${Math.round(performance.now() - banditWarmupStarted)}ms`)
    // Loading must not advance a restored fall or consume saved survival resources.
    if (this.profile.careerRetirement?.phase !== 'final-stand')
      this.player.update(.2, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.player.currentMount?.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier(), this.deploymentReady && !this.fourGateCombatHeld)
    if (this.profile.careerRetirement?.phase === 'final-stand') {
      this.restoreRetirementPlayer()
      restoreCareerAerialState(this.player, this.careerMounts.activeMount, this.profile.playerAerialState, this.personalSquad?.sceneKey ?? 'town-home')
    }
    if (!this.spectator) this.orbit.update(this.input, 0.016, this.world?.obstacles ?? [])
    progress('預熱近、中、遠景與訓練投射物…')
    const projectiles = createProjectileWarmupGroup()
    this.scene.add(projectiles)
    try {
      await warmTownRenderResources(renderer, this.scene, this.camera, yieldFrame)
    } finally {
      // Projectile resources are shared with training and combat; do not dispose them.
      projectiles.removeFromParent()
    }
    renderer.render(this.scene, this.camera); await yieldFrame()
    this.input.clear()
    if (!context.missionOnlyResidents) this.event.complete()
    this.restoreEagleCommandState()
    this.restoreTownCasualties()
    this.civilianCommand.restore()
    this.townCommand.resumeRefits()
    if (this.world.faction === this.profile.faction && !this.sceneContext.missionOnlyResidents) {
      this.retirementMobilization = new TownRetirementMobilizationController({
        residents: this.residents, read: () => this.profile,
        save: next => {
          next.skills = this.skills.skillState
          next.personalSquadRuntime = this.personalSquad?.checkpoint() ?? next.personalSquadRuntime
          next.playerAerialState = captureCareerAerialState(this.player, this.personalSquad?.sceneKey ?? 'town-home')
          if (!this.store.save(next)) { this.careerSaveFailures++; this.notice = '退役動員保存失敗，尚未進行整補。'; return false }
          this.profile = next
          this.careerSkillsDirty = false
          this.applyRetirementDeparture()
          return true
        },
        revoke: () => {
          this.personalCommands?.close()
          this.townCommand?.applySavedState(this.profile.townCommandSquad)
          this.townAirCommand?.applySavedState(this.profile.townAirCommandSquad)
          this.civilianCommand?.applySavedState(this.profile.civilianCommandSquad)
          this.synchronizeCommandActors()
          this.notice = '城鎮指揮權已解除。你現在只能指揮私人部隊。\n私人隊長：廣場上的部隊全副武裝。長官……那不是歡送隊形。'
        },
        patrol: this.patrol, eagles: this.eagleGarrison!, navigation: this.navigation, obstacles: this.world.obstacles,
        nearby: npc => this.grid.getNearbyInto(npc.combatPosition, 10, this.neighbors),
      })
      if (!this.retirementMobilization.reconcile()) this.notice = '退役動員尚未完成，請稍後重試。'
      this.retirementFinale = new TownRetirementFinaleController({
        read: () => this.profile, publish: next => { this.profile = next },
        capture: next => this.captureRetirementResources(next),
        privateFightersAlive: () => (this.personalSquad?.aliveCombatants ?? 0) > 0,
        privateSquad: () => this.personalSquad?.hudMission,
        save: next => {
          if (!this.store.save(next)) { this.careerSaveFailures++; return false }
          this.clearCareerSkillSaveTimer(); this.careerSkillsDirty = false
          return true
        },
        residents: this.residents, mobilization: this.retirementMobilization, eagles: this.eagleGarrison!,
        betray: restored => {
          this.inventory.prepareForCombat()
          this.clearMissionCombatShots()
          this.target = null
          if (restored) this.notice = '最後的退休命令 · 撐過最後一戰'
          else {
            sound.playCommanderCommand(this.profile.faction, 'charge')
            this.openPanel('最後的退休命令', '城鎮隊長：奉城鎮議會命令！\n退役指揮官私帶武裝離城，意圖叛亂！\n全軍進攻，不留活口！\n\n私人隊長：他們早就決定了。\n這不是退休。這是清算。')
          }
        },
        complete: next => { this.dispose(); this.onRestart(next) },
        failed: message => { this.notice = message },
      })
      if (!this.retirementFinale.reconcile()) this.notice = '退役戰鬥紀錄尚未恢復，請重新載入。'
    }
    if (this.defense instanceof CommanderFourGateDefenseController && !this.profile.activeMission?.result) {
      this.defense.preparePlayerDeployment()
      this.defense.completeInitialDeployment()
    }
    this.hud.id = 'town-hud'; this.hud.style.cssText = 'position:fixed;top:20px;left:20px;z-index:90;background:#201d19de;color:#efe1c3;padding:16px 22px;border:1px solid #aa9270;line-height:1.7;font:15px system-ui;max-width:520px;pointer-events:none'
    this.hint.id = 'town-hint'; this.hint.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:90;color:#fff;background:#211e19dd;padding:10px 20px;font:18px system-ui;pointer-events:none'
    this.pointerPrompt.id = 'town-pointer-prompt'; this.pointerPrompt.textContent = '點擊畫面進入遊戲'; this.pointerPrompt.style.cssText = 'position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);z-index:89;color:#fff4d0;background:#201d19e8;border:1px solid #aa9270;padding:14px 22px;font:600 18px system-ui;pointer-events:none'
    this.ambientLabel.className = 'town-ambient'; this.ambientLabel.hidden = true
    document.body.append(this.hud, this.hint, this.pointerPrompt, this.ambientLabel)
    this.compass = new CompassUI(this.camera, this.raceHud.element)
    if (!this.spectator) document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · 滾輪 換裝 · 右鍵 舉盾／瞄準 · Tab 裝備 · E 交談 · Q 關閉面板 · Esc 暫停／上一頁'
    const opts = { capture: true, signal: this.listeners.signal }
    document.addEventListener('visibilitychange', () => this.preparationClock.reset(), opts)
    window.addEventListener('blur', () => this.preparationClock.reset(), opts)
    window.addEventListener('focus', () => this.preparationClock.reset(), opts)
    window.addEventListener('keydown', e => this.key(e), opts)
    window.addEventListener('pagehide', () => {
      this.flushCareerSkillProgression()
      this.persistPersonalSquad(0, true)
      this.captainPatrol?.persist(true)
      this.race?.snapshot(); this.race?.persist()
      if (this.defense?.active && !this.defense.active.result) this.defense.persistRuntimeProgress(true, this.careerMounts.checkpoint())
      if (!this.defense?.active && !this.captainPatrol?.active && this.profile.activeMission
        && (this.profile.activeMission.kind === 'veteran-field' || this.profile.activeMission.officialSquad)
        && (!this.profile.activeMission.result || this.profile.activeMission.phase === 'RETURNING')) this.mission.persistRuntimeProgress(true)
    }, { signal: this.listeners.signal })
    for (const type of ['mousedown', 'mouseup', 'wheel'] as const) window.addEventListener(type, e => { if (this.panel || this.equipment.visible) { e.stopImmediatePropagation(); this.input.clear() } }, { ...opts, passive: false })
    renderer.domElement.addEventListener('click', () => { if (!this.panel && !this.equipment.visible) { if (!location.search.includes('nolock')) this.input.requestPointerLock(renderer.domElement); sound.unlockAudio() } }, { signal: this.listeners.signal })
    document.addEventListener('pointerlockchange', () => this.updatePointerPrompt(), { signal: this.listeners.signal })
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }, { signal: this.listeners.signal })
    this.player.onFireArrow = e => this.fire(e.origin, e.direction, e.speed, e.damage, true, false, e.visualKind)
    if (profile.townEvent?.state === 'hostile') { this.inventory.restoreForHostile(); this.activateHostility(false); this.notice = '未結束的小鎮事件已恢復：全鎮仍在追擊。' }
    this.hp.setFill(this.player.hpRatio)
    this.updatePointerPrompt()
    if (!this.spectator) this.orbit.update(this.input, 0.016, this.world?.obstacles ?? [])
    if (this.profile.activeMission?.result && this.profile.activeMission.phase !== 'RETURNING') this.openMissionResult(this.profile.activeMission.result, true)
  }
  private async initializeResidents(roster: ReturnType<typeof careerTownSceneRoster>,
    context: ReturnType<typeof resolveCareerTownSceneContext>, progress: (text: string) => void, additionalPopulation = false): Promise<void> {
    const created: Resident[] = []
    const equipmentActorIds = new Set(townEquipmentSquads(this.profile).filter(squad => squad.id !== 'personal').flatMap(squad => squad.actorIds))
    const residentBatch = gameplayNpcSpawns.batch(() => {
      for (const resident of created) {
        resident.npc.dispose()
        if (resident.homeMount && resident.homeMount !== this.cat) {
          resident.homeMount.dispose()
          const index = this.mounts.indexOf(resident.homeMount); if (index >= 0) this.mounts.splice(index, 1)
        }
        if (additionalPopulation) this.event.unregisterAdditionalResident(resident.spec.id)
        else { this.event.allActors.delete(resident.spec.id); this.event.actors.delete(resident.spec.id) }
        this.serviceMarkers.delete(resident.spec.id)
        const index = this.residents.indexOf(resident); if (index >= 0) this.residents.splice(index, 1)
      }
    })
    this.residentSpawnBatch = residentBatch
    for (const { spec: sourceSpec, characterFaction, allegiance, borrowed } of roster) {
      let spec = sourceSpec
      residentBatch.enqueue(spec.id, () => {
        if (additionalPopulation && (this.disposed || !shouldSpawnTownCommander(this.profile))) throw new Error('Commander return cancelled by scene transition')
        const civilian = isCivilian(spec.role), ranger = (spec.role === 'ranger' || spec.role === 'eagle-trainer'), cavalry = spec.mounted
        const residentArmyFaction = context.missionOnlyResidents && !borrowed ? context.worldFaction : context.residentFaction
        const military = !civilian && !ranger ? townMilitaryEquipment(residentArmyFaction, spec) : null
        const preset = military?.presetId
        const hero = townActorHeroProfile(residentArmyFaction, spec)
        const heroAsset = spec.role === 'commander' ? townCommanderHeroAsset(residentArmyFaction) : hero?.visualAssetId
        const combatProfile = heroAsset ? HERO_COMBAT_PROFILE_BY_ASSET[heroAsset] : undefined
        const careerEquipment = residentArmyFaction === this.profile.faction && equipmentActorIds.has(spec.id)
          && this.profile.townEquipment?.[residentArmyFaction]
          ? resolveTownActorEquipment(this.profile, residentArmyFaction, spec.id) : undefined
        const loadout = careerEquipment?.loadout ?? (spec.role === 'merchant' ? townMerchantLoadout() : civilian || spec.role === 'commander' ? townDefaultActorLoadout(residentArmyFaction, spec) : ranger ? { meleeWeaponId: defaultRangerMeleeWeaponId(residentArmyFaction), rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null, reversibleRangedSwitch: true } : military!.loadout)
        spec = townStationSpec(spec, Boolean(loadout.mountId), Boolean(loadout.rangedWeaponId))
        const npc = trackNpcSpawn(new NPC(this.scene, spec.x, spec.z, allegiance, characterFaction, loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE, spec.role === 'commander' ? `${residentArmyFaction === 'roman' ? '羅馬' : '維京'}指揮官` : NAMES[spec.role] ?? spec.id, civilian ? TOWN_RULES.garrisonTier : ranger || hero ? 4 : careerEquipment?.tier ?? military!.level, cavalry, loadout, preset, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : heroAsset, ranger ? 'ranger' : combatProfile, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, residentArmyFaction, spec.role === 'merchant' ? 'merchant' : undefined, undefined, civilian ? TOWN_RULES.garrisonTier : ranger || hero ? 4 : military!.level))
        if (!spec.eagle && spec.duty !== 'patrol') npc.combatTargetAllowed = target => {
          const active = this.defense?.active
          const siege = active?.kind === 'town-defense' || active?.kind === 'commander-four-gate-defense' || active?.kind === 'enemy-town-assault'
          if (this.retirementFinale?.active || this.event.hostile || this.duel?.isMissionActor(npc) || this.race?.owns(npc)
            || npc.combatOwnership && (!siege || npc.combatOwnership !== 'mission-official')
            || active?.officialSquad && officialCommandIsPlayerControlled(active.officialSquad, npc.combatantId)) return true
          if (siege) {
            if (target === this.player) return true
            let roster = this.defenseTargetRosters.get(active!)
            if (!roster) {
              roster = new Set([...active!.targetActorIds, ...active!.friendlyActorIds, ...(active!.civilianActorIds ?? [])])
              this.defenseTargetRosters.set(active!, roster)
            }
            if (target instanceof NPC && roster.has(target.combatantId)) return true
          }
          const response = townDefenseThreatResponse(spec, npc, target.combatPosition, townExternalThreatAlertRange(false, npc), this.navigation.townNav?.watchtower)
          return response === 'pursue' ? true : response === 'defend' ? 'defend' : false
        }
        if (spec.role === 'commander' && this.profile.townCommanderRecovery?.faction === residentArmyFaction) restoreCareerDuelCommander(npc, this.profile.townCommanderRecovery)
        npc.setTownPeaceful(); npc.group.rotation.y = spec.yaw ?? Math.PI
        if (spec.y !== undefined) npc.group.position.y = spec.y
        if (spec.garrison?.kind === 'rampart' || spec.duty === 'watchtower_guard') npc.activateTownRampartGarrison()
        if (spec.duty === 'watchtower_guard' && this.profile.activeMission?.kind !== 'commander-four-gate-defense') {
          const saved = this.profile.activeMission?.actorHealth?.[spec.id]
          if (saved) npc.restoreCombatHealth(saved.hp)
        }
        if (additionalPopulation && this.event.hostile) npc.beginTownHostility()
        let homeMount: Mount | undefined
        if (spec.role === 'ranger' && !careerEquipment) homeMount = this.cat
        if (spec.eagle) {
          const { home, mountId } = spec.eagle
          const eagle = trackNpcSpawn(new Mount(this.scene, MountType.XONGKORO, home.x, home.z))
          eagle.group.name = mountId; eagle.group.rotation.y = home.yaw; eagle.reservedForTown = true
          homeMount = eagle
        }
        const equippedMount = careerEquipment || spec.role === 'commander' ? loadout.mountId : cavalry ? hero?.mountOverride ?? 'horse' : null
        if (!spec.eagle && equippedMount) {
          const nativeRef = careerEquipment?.refs.mount ?? (equipmentActorIds.has(spec.id)
            ? resolveTownActorEquipment(this.profile, residentArmyFaction, spec.id).refs.mount : null)
          const reused = findTownNativeMount(this.mounts, nativeRef)
          const mount = reused ?? trackNpcSpawn(new Mount(this.scene, careerMountType(equippedMount as CareerMountId), spec.x, spec.z, undefined, horseVariantForStableKey(`town:${residentArmyFaction}:${spec.id}`)))
          if (nativeRef?.source === 'native') registerTownNativeMount(mount, nativeRef.nativeId!)
          mount.reservedForTown = true; mount.group.rotation.y = spec.yaw ?? Math.PI
          if (spec.role !== 'ranger' || mount !== this.cat) {
            // The shared native Cat starts at the stable; transferred holders need their own spawn baseline before binding.
            // Saved command/mission positions are restored after resident initialization.
            if (reused) mount.group.position.set(spec.x, getTerrainHeight(spec.x, spec.z), spec.z)
            npc.mountVehicle(mount)
          }
          homeMount = mount
        }
        if (!context.missionOnlyResidents && NAMES[spec.role] && spec.role !== 'civilian') { npc.group.rotation.y = spec.yaw ?? 0; this.serviceMarkers.set(spec.id, this.world.addServiceMarker(npc.group, ranger ? 1.9 : hero ? 2 : 2.2)) }
        const target = undefined
        if (additionalPopulation) this.event.registerAdditionalResident(spec.id, npc)
        else this.event.register(spec.id, npc)
        if (homeMount && homeMount !== this.cat && !this.mounts.includes(homeMount)) this.mounts.push(homeMount)
        registerTownCombatDisplayName(npc, spec, residentArmyFaction)
        const resident = { spec, npc, homeMount, target, cycle: -1, walkTime: 0 }
        this.residents.push(resident); created.push(resident)
      })
    }
    residentBatch.seal()
    await gameplayNpcSpawns.wait(residentBatch, (done, total) => progress(`建立駐軍與居民 ${done} / ${total}…`))
  }

  private siegeOpeningPending = false
  /** Called after the entry removes its loading overlay. */
  start(): void {
    this.last = performance.now()
    this.raf = requestAnimationFrame(t => {
      if (this.disposed) return
      this.frame(t)
      this.scheduleSiegeOpening()
    })
  }
  private scheduleSiegeOpening(): void {
    if (!this.deploymentReady || !this.siegeOpeningPending || this.profile.activeMission?.result) return
    this.siegeOpeningPending = false
    requestAnimationFrame(() => { if (!this.disposed) void (this.defense.assault ? this.playAssaultAlert() : this.playTownDefenseAlert()) })
  }
  private async playAssaultAlert(): Promise<void> {
    const missionId = this.profile.activeMission?.id
    const played = await sound.playTownAlarm(true)
    if (played && !this.disposed && this.profile.activeMission?.id === missionId && !this.profile.activeMission?.result) sound.playCommanderCommand(this.profile.faction, 'attack')
  }
  private clearCareerSkillSaveTimer(): void {
    if (this.careerSkillSaveTimer === null) return
    clearTimeout(this.careerSkillSaveTimer)
    this.careerSkillSaveTimer = null
  }

  private scheduleCareerSkillProgressionFlush(): void {
    if (!this.careerSkillsDirty || this.careerSkillSaveTimer !== null) return
    this.careerSkillSaveTimer = window.setTimeout(() => {
      this.careerSkillSaveTimer = null
      this.flushCareerSkillProgression()
    }, 600)
  }

  private flushCareerSkillProgression(): boolean {
    this.clearCareerSkillSaveTimer()
    if (this.retirementFinale?.frozen || !this.careerSkillsDirty) return true
    const next = cloneCareerProfile(this.profile)
    next.skills = this.skills.skillState
    if (next.careerRetirement?.phase === 'final-stand' && !this.retirementFinale?.frozen) this.captureRetirementResources(next)
    if (!this.store.save(next)) {
      this.notice = '技能進度保存失敗，請稍後重試。'
      return false
    }
    this.profile = next
    this.synchronizeEaglePatrolPolicy()
    this.outskirts?.synchronizeRank()
    this.careerSkillsDirty = false
    return true
  }

  private restoreOutskirtsCheckpoint(): void {
    this.outskirts?.restoreCheckpoint(this.profile.activeMission?.patrolOutskirts ?? this.profile.townOutskirts?.[this.world.faction])
  }

  /** Acceptance still uses the existing stage-save-live-effects transaction. */
  startCommanderRetirement(acceptedAt: number = Date.now()): boolean {
    if (this.world.faction !== this.profile.faction || this.sceneContext.missionOnlyResidents) return false
    const staged = startCommanderRetirement(this.profile, acceptedAt)
    if (!staged.started) return false
    // Capture casualties, pending identities and original mount ownership before acceptance.
    staged.profile.personalSquadRuntime = this.personalSquad?.checkpoint() ?? staged.profile.personalSquadRuntime
    return this.commit(staged.profile)
  }

  /** Persisted phase is the source of truth on both acceptance and scene restore. */
  private applyRetirementDeparture(): void {
    if (!this.profile.careerRetirement) return
    if (this.world.faction !== this.profile.faction || this.sceneContext.missionOnlyResidents) return
    this.outskirts?.applyRetirementPolicy()
    this.enemyEaglePatrol?.applyRetirementPolicy()
    this.mission?.applyRetirementPolicy()
    if (this.profile.careerRetirement?.phase !== 'departing' || this.retirementDepartureApplied || !this.personalSquad) return
    for (const shot of this.shots ?? []) if (shot.source && this.isRetirementEvacuating(shot.source)) shot.arrow.destroy()
    this.personalSquad.follow()
    this.retirementDepartureApplied = true
    this.notice = '長官，敵方巡邏隊正在撤退。\n連土匪都走了……他們不是怕我們。他們是在替某件事讓路。'
  }

  /** Resources are saved independently of the irreversible retirement phase. */
  private captureRetirementResources(next: CareerProfile): void {
    const position = (group: THREE.Group) => ({ x: group.position.x, y: group.position.y, z: group.position.z, yaw: group.rotation.y })
    const mount = this.careerMounts.activeMount
    next.skills = this.skills.skillState
    next.personalSquadRuntime = this.personalSquad?.checkpoint() ?? next.personalSquadRuntime
    next.playerAerialState = captureCareerAerialState(this.player, this.personalSquad?.sceneKey ?? 'town-home')
    next.retirementRuntime = {
      player: { position: position(this.player.group), hp: this.player.dead ? 0 : this.player.hp,
        stamina: this.player.staminaValue, arrows: this.player.arrowCount,
        shieldImpact: this.player.shield.shieldImpactRemaining, shieldDurability: this.player.shield.captureDurability(),
        mounted: Boolean(mount && this.player.currentMount === mount) },
      mountState: this.careerMounts.checkpoint(),
      ...(mount ? { mount: { position: position(mount.group), hp: mount.dead ? 0 : mount.currentHp,
        ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) } } : {}),
    }
    this.retirementMobilization?.capture(next)
    this.retirementFinale?.captureStats(next)
  }

  private restoreRetirementPlayer(): void {
    const saved = this.profile.retirementRuntime
    if (this.profile.careerRetirement?.phase !== 'final-stand' || !saved) return
    const point = saved.player.position
    this.player.group.position.set(point.x, point.y, point.z)
    this.player.faceDirection(Math.sin(point.yaw), Math.cos(point.yaw))
    this.careerMounts.restoreActiveMount()
    const mount = this.careerMounts.activeMount
    if (mount && saved.mount) {
      const p = saved.mount.position
      mount.group.position.set(p.x, p.y, p.z); mount.group.rotation.y = p.yaw
      mount.currentHp = Math.min(mount.maxHp, saved.mount.hp)
      if (!saved.player.mounted && this.player.currentMount === mount) this.player.dismountFromMount()
      if (saved.mount.flight && mount.flight) {
        mount.flight.restore(saved.mount.flight)
        mount.group.rotation.set(-saved.mount.flight.pitch, saved.mount.flight.yaw, saved.mount.flight.bank, 'YXZ')
      }
      if (saved.player.mounted) this.player.syncMountTransform()
    }
    this.player.setHp(saved.player.hp)
    this.player.setStamina(saved.player.stamina)
    this.player.setArrowCount(saved.player.arrows)
    if (saved.player.shieldDurability) this.player.shield.restoreDurability(saved.player.shieldDurability)
    else this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.player.shieldImpact)
    if (saved.player.hp <= 0 && !this.player.dead) this.player.takeDamage(this.player.maxHp * 100, this.hp)
  }

  testRetirementFallen(): boolean {
    if (!import.meta.env.DEV || new URLSearchParams(location.search).get('careerQa') !== 'retirement'
      || !this.retirementFinale?.active || this.retirementFinale.frozen || this.player.dead) return false
    this.closePanel()
    this.player.takeDamage(this.player.maxHp * 100, this.hp)
    this.retirementFinale.afterCombat(this.player.combatPosition, this.player.dead)
    return this.player.dead
  }

  testRetirementEscaped(): boolean {
    if (!import.meta.env.DEV || new URLSearchParams(location.search).get('careerQa') !== 'retirement'
      || !this.retirementFinale?.active || this.retirementFinale.frozen || this.player.dead) return false
    if (!this.retirementFinale.fastForwardForQa()) return false
    this.closePanel()
    return true
  }

  private commit(profile: CareerProfile, change: TownProfileChange = 'ordinary'): boolean {
    const latest = this.store.loadChecked()
    if (latest.error || !latest.profile || latest.profile.tutorial?.careerId !== this.profile.tutorial?.careerId
      || profile.tutorial?.careerId !== this.profile.tutorial?.careerId) {
      this.notice = '角色存檔已更新，尚未保存這次操作，請重新載入。'; return false
    }
    const ownership = (value: CareerProfile) => JSON.stringify([
      value.activeMission?.id, value.activeOutpostMission?.id, value.activeRace?.id,
      value.careerRetirement?.acceptedAt, value.careerRetirement?.phase,
      value.townEvent?.id, value.townEvent?.state,
    ])
    if (ownership(latest.profile) !== ownership(this.profile)) {
      this.notice = '生涯活動已在其他畫面更新，請重新載入後再操作。'; return false
    }
    // Reject a concurrent tutorial commit as a whole: merging only its receipt into an old
    // balance would retain the receipt while erasing the associated merit award.
    if (JSON.stringify(latest.profile.tutorial) !== JSON.stringify(this.profile.tutorial)) {
      this.notice = '教學紀錄已更新，請重新載入後再操作。'; return false
    }
    const scene = this
    return commitTownProfile({
      applyRetirementDeparture: () => scene.applyRetirementDeparture(),
      get captainPatrol() { return scene.captainPatrol },
      captureRetirementResources: (next) => scene.captureRetirementResources(next),
      get careerMounts() { return scene.careerMounts },
      get careerSaveFailures() { return scene.careerSaveFailures },
      set careerSaveFailures(value) { scene.careerSaveFailures = value },
      get careerSkillsDirty() { return scene.careerSkillsDirty },
      set careerSkillsDirty(value) { scene.careerSkillsDirty = value },
      get civilianCommand() { return scene.civilianCommand },
      clearCareerSkillSaveTimer: () => scene.clearCareerSkillSaveTimer(),
      get defense() { return scene.defense },
      get deploymentPage() { return scene.deploymentPage },
      set deploymentPage(value) { scene.deploymentPage = value },
      get eagleGarrison() { return scene.eagleGarrison },
      get enemyEaglePatrol() { return scene.enemyEaglePatrol },
      get garrisonRestored() { return scene.garrisonRestored },
      get mission() { return scene.mission },
      get notice() { return scene.notice },
      set notice(value) { scene.notice = value },
      get outskirts() { return scene.outskirts },
      get patrol() { return scene.patrol },
      get personalCommands() { return scene.personalCommands },
      get personalSquad() { return scene.personalSquad },
      get player() { return scene.player },
      get profile() { return scene.profile },
      set profile(value) { scene.profile = value },
      get race() { return scene.race },
      get residentReturnPending() { return scene.residentReturnPending },
      set residentReturnPending(value) { scene.residentReturnPending = value },
      get residents() { return scene.residents },
      get restoringAerialState() { return scene.restoringAerialState },
      get retirementMobilization() { return scene.retirementMobilization },
      get sceneContext() { return scene.sceneContext },
      get skills() { return scene.skills },
      get store() { return scene.store },
      synchronizeCommandActors: () => scene.synchronizeCommandActors(),
      synchronizeEagleCommandOwnership: () => scene.synchronizeEagleCommandOwnership(),
      synchronizeEaglePatrolPolicy: () => scene.synchronizeEaglePatrolPolicy(),
      get townAirCommand() { return scene.townAirCommand },
      get townCommand() { return scene.townCommand },
      get townRefitOnReturn() { return scene.townRefitOnReturn },
      set townRefitOnReturn(value) { scene.townRefitOnReturn = value },
      unavailableTownCavalryActorIds: (includeReturning) => scene.unavailableTownCavalryActorIds(includeReturning),
      get world() { return scene.world },
      cancelCareerAudio: () => sound?.cancelCareerAudio(),
    }, profile, change)
  }

  private persistPersonalSquad(dt: number, force = false): void {
    if (this.retirementFinale?.frozen) return
    const saved = this.personalSquad?.checkpoint()
    const aerial = captureCareerAerialState(this.player, this.personalSquad?.sceneKey ?? 'town-home')
    const garrison = this.eagleGarrison?.snapshot(`town:${this.world.faction}`)
    const garrisonActive = Boolean(garrison?.pairs.some(pair => pair.duty !== 'standby' || pair.hp === 0 || pair.mount.hp === 0))
    const townCommand = this.townCommand?.hasCheckpoint ? this.townCommand : undefined
    if (!this.civilianCommand?.hasCheckpoint && !saved && !townCommand && !this.profile.personalSquadRuntime && !aerial && !this.profile.playerAerialState && !garrisonActive && !this.outskirts?.hasCheckpoint && !this.enemyEaglePatrol?.hasCheckpoint && !this.patrol?.hasCheckpoint && !this.profile.careerRetirement?.mobilization) return
    this.personalSaveElapsed += dt
    const critical = JSON.stringify([this.profile.careerRetirement?.phase === 'final-stand' ? this.player.dead : undefined, this.retirementMobilization?.criticalSignature, this.patrol?.criticalSignature, this.civilianCommand?.criticalSignature, this.enemyEaglePatrol?.criticalSignature, this.outskirts?.criticalSignature, townCommand?.criticalSignature, garrison?.pairs.map(pair => [pair.riderId, pair.duty, pair.hp === 0, pair.mount.hp === 0]), aerial?.dead, Boolean(aerial?.fall), Boolean(aerial?.mount), saved?.state, saved?.memberIds.map(id => {
      const member = saved.members[id]
      return [member.status, member.order, member.mount?.hp === 0, member.formation?.commandId]
    })])
    if (!force && this.personalSaveElapsed < 5 && critical === this.personalCriticalState) return
    const next = cloneCareerProfile(this.profile)
    next.playerAerialState = aerial
    const active = next.activeMission ?? next.activeOutpostMission
    if (active?.personalSquad && saved) active.personalSquad = saved
    else if (!active) next.personalSquadRuntime = saved
    if (this.commit(next)) { this.personalSaveElapsed = 0; this.personalCriticalState = critical }
  }

  private bindBlockingProgression(player = this.player): void {
    player.setDamageHud(this.hp)
    player.blockingLevel = this.skills.skillState.blocking.level
    player.onShieldBlock = impact => this.awardCareerSkillXp('melee', impact * SHIELD_CONFIG.xpPerBlockedImpact, 'blocking')
  }

  private awardCareerSkillXp(method: CombatDamageMethod, appliedDamage: number, skillOverride?: 'blocking' | 'mountedImpact'): void {
    if (!canAwardPlayerSkillProgression({
      dead: this.player.dead,
      spectatorOnly: this.player.spectatorOnly,
      observer: Boolean(this.spectator),
    })) return
    if (appliedDamage <= 0 || this.profile.activeMission?.duelTutorialCareerId) return
    const skill = skillOverride ?? resolveCombatSkill(
      method,
      this.inventory.equippedMelee,
      Boolean(this.inventory.shieldEnabled && this.inventory.equippedShield),
    )
    if (!skill) return

    const before = this.skills.skillState
    const levelsGained = this.skills.addXp(skill, appliedDamage, sound)
    const after = this.skills.skillState
    this.player.blockingLevel = after.blocking.level
    if (skillStatesEqual(before, after)) return

    const next = cloneCareerProfile(this.profile)
    next.skills = after
    this.profile = next
    this.careerSkillsDirty = true
    if (levelsGained > 0) this.flushCareerSkillProgression()
    else this.scheduleCareerSkillProgressionFlush()

    if (levelsGained <= 0) return
    const oldHp = this.player.hp
    const newMaxHp = resolveCareerPlayerMaxHp(this.profile, DEFAULT_PLAYER_MAX_HP)
    this.player.setMaxHp(newMaxHp, false)
    this.player.setHp(Math.min(newMaxHp, oldHp + levelsGained))
    this.hp.setFill(this.player.hpRatio)
  }

  private enterMissionObserver(): void {
    if (this.profile.careerRetirement?.phase === 'completed' || this.spectator) return
    const retirementBattle = this.profile.careerRetirement?.phase === 'final-stand'
    if (!retirementBattle && (!this.profile.activeMission || this.event.hostile) && !this.profile.activeRace) return
    if (this.profile.activeMission?.kind === 'duel') {
      this.duel.persistRuntimeProgress(true)
      this.input.clear()
      this.player.clearTownAction()
      this.equipment.close()
      return
    }
    this.spectator = new SpectatorCameraController(this.camera)
    this.spectator.worldBound = TOWN_PLAYABLE_WORLD_BOUND
    this.spectator.initFromCamera()
    this.input.clear()
    this.player.clearTownAction()
    this.equipment.close()
    this.target = null
    this.hasPreviousTip = false
    document.getElementById('controls-hint')!.textContent = 'Observer · WASD 移動 · Mouse 視角 · Space 上升 · Ctrl 下降 · Shift 加速'
    // Commander death is saved with the complete post-combat runtime below.
    // An observer-only commit would retain stale actor HP, orders and FourGate player state.
    if (this.profile.activeMission && !this.profile.activeMission.playerDead
      && !isCommanderTownMission(this.profile.activeMission) && this.profile.activeMission.kind !== 'commander-four-gate-defense') {
      const next = cloneCareerProfile(this.profile)
      next.activeMission!.playerDead = true
      this.commit(next)
    }
  }
  private key(e: KeyboardEvent): void {
    if (this.retirementFinale?.frozen) { e.preventDefault(); e.stopImmediatePropagation(); return }
    if (this.panel || this.equipment.visible) {
      // Let focused equipment controls receive arrows, Enter and Space.
      if (this.equipment.visible && (e.target as Element | null)?.closest?.('#character-modal')
        && !['KeyQ', 'Escape', 'Tab'].includes(e.code)) return
      e.stopImmediatePropagation()
      if (['KeyQ', 'Escape', 'Tab'].includes(e.code)) { e.preventDefault(); if (!this.result && !this.missionResultOpen) this.closePanel() }
      return
    }
    if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation()
      if (!e.repeat) this.openPauseMenu()
      return
    }
    if (this.player.dead) {
      if (['Tab', 'KeyE', 'KeyQ', 'KeyG'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation() }
      return
    }
    if (e.repeat) return
    if (e.code === 'Tab') {
      e.preventDefault(); e.stopImmediatePropagation(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
      const adapters = createTownCareerEquipmentUI(() => this.profile, () => this.townEquipmentContext(),
        () => this.residents, next => this.commit(next),
        (previous, current, actorIds) => applyTownEquipmentRuntime(this.scene, this.residents, this.mounts, previous, current, actorIds, (point, actorId, reusedMount, vacatingMounts) => this.canPlaceMountedCivilian(point, actorId, reusedMount, vacatingMounts)))
      this.equipment.open(this.skills, this.inventory, () => this.input.clear(), this.careerMounts, adapters.personal, adapters.town)
      return
    }
    if (e.code === 'KeyE' && this.personalCommands?.isFormationPlacementMode) return
    if (e.code === 'KeyE') {
      e.preventDefault(); e.stopImmediatePropagation()
      // Recheck range and availability at the key event, using the same priority as the hint.
      this.interaction()
      if (this.target) this.talk(this.target)
      else if (this.player.isMounted) this.player.dismountFromMount()
      else if (this.nearbyTemporaryMount?.availableForPlayer) this.player.mountVehicle(this.nearbyTemporaryMount)
    }
  }
  private openPauseMenu(message = '返回主選單後，可再次進入 Career 繼續生涯。'): void {
    if (this.disposed || this.retirementFinale?.frozen || this.panel || this.equipment.visible || this.result || this.missionResultOpen) return
    const panel = this.openPanel('生涯模式 · 暫停', message)
    const resume = panel.querySelector('button')
    if (resume) resume.textContent = '繼續遊戲'
    if (this.profile.activeMission?.duelTutorialCareerId && !this.profile.activeMission.result) {
      this.button(panel, '取消新兵切磋 · 不結算獎勵', () => this.returnToTown('direct'))
    }
    const race = this.race
    if (race && raceReturnAction(race.session?.phase, race.canWalkBack, race.returnComplete, true)) {
      this.button(panel, '改為直接返回小鎮', () => this.leaveRace(true))
    }
    this.button(panel, '上一頁', () => this.returnHome())
  }

  private returnHome(): void {
    if (this.disposed || this.retirementFinale?.frozen || this.result || this.missionResultOpen) return
    const failures = this.careerSaveFailures
    const skillsSaved = this.flushCareerSkillProgression()
    this.persistPersonalSquad(0, true)
    if (this.captainPatrol?.active) this.captainPatrol.persist(true)
    else if (this.duel?.active) this.duel.persistRuntimeProgress(true)
    else if (this.defense?.active) this.defense.persistRuntimeProgress(true, this.careerMounts.checkpoint())
    else if (this.profile.activeMission) this.mission.persistRuntimeProgress(true)
    this.race?.snapshot()
    const raceSaved = this.race?.persist() ?? true
    const saved = this.commit(this.profile)
    if (!raceSaved || !skillsSaved || !saved || this.careerSaveFailures !== failures) {
      this.panel?.remove(); this.panel = null
      this.openPauseMenu('進度保存失敗，尚未返回主選單。請確認儲存空間後，再按「上一頁」重試。')
      return
    }
    this.dispose()
    this.onHome()
  }

  private closePanel(): void {
    this.promotionAttempt = null
    this.panel?.remove(); this.panel = null; this.equipment.close(); this.input.clear(); this.player.clearTownAction(); if (!location.search.includes('nolock')) this.input.requestPointerLock(this.renderer.domElement)
  }
  private openPanel(title: string, text: string): HTMLDivElement {
    this.promotionAttempt = null
    this.personalCommands?.close()
    this.panel?.remove(); this.equipment.close(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
    const panel = document.createElement('div'); panel.id = 'town-dialog'; panel.className = 'town-panel'
    const eyebrow = document.createElement('small'); eyebrow.className = 'town-eyebrow'; eyebrow.textContent = this.profile.faction === 'roman' ? 'VINUM · LEGION RECORD' : 'ØKSE · HALL OF WARRIORS'; panel.append(eyebrow)
    const heading = document.createElement('h2'); heading.textContent = title; panel.append(heading)
    const body = document.createElement('p'); body.textContent = text; body.style.whiteSpace = 'pre-line'; panel.append(body)
    if (!this.result && !this.missionResultOpen) this.button(panel, '關閉 · Q / Esc', () => this.closePanel())
    document.body.append(panel); this.panel = panel; return panel
  }
  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement { const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; parent.append(b); return b }
  private talk(id: string, response?: string, shopPage: 'buy' | 'sell' = 'buy', shopCategory: EquipmentCategory = 'melee'): void {
    if (this.player.dead || !this.serviceAvailable(id)) return
    if (id === 'hr-officer') { this.openRecruitmentPanel(response); return }
    const role = (id === 'eagle-trainer' ? 'ranger' : id) as DialogueRole, key = this.profile.faction + ':' + id
    const firstMeet = !this.profile.townDialogueSeen?.includes(key)
    const outpostKey = this.profile.faction + ':soldier-outpost'
    const firstOutpost = id === 'deployment' && this.profile.rank === 'soldier' && !this.profile.townDialogueSeen?.includes(outpostKey)
    if (firstMeet || firstOutpost) {
      const next = cloneCareerProfile(this.profile)
      next.townDialogueSeen = [...(next.townDialogueSeen ?? []), ...(firstMeet ? [key] : []), ...(firstOutpost ? [outpostKey] : [])]
      if (!this.commit(next)) { this.openPanel('無法保存交談紀錄', this.notice); return }
    }
    const p = this.profile, context: DialogueContext = { townFaction: p.faction, npcRole: role, playerRank: p.rank, firstMeet, promotionEligible: canAppointCareerRank(p, id) }
    const greeting = response ?? (id === 'eagle-trainer' ? 'xongkoro Eagle Training Ground · 老鷹訓練場\nCaptain / Commander 可用 10,000 軍功購買巨鷹英雄坐騎。請在開闊的起降區召喚；W 起飛，滑鼠轉向，S 減速降落。' : selectTownDialogue(context))
    if (id === 'captain' || id === 'commander') {
      const next = CAREER_RANKS[CAREER_RANKS.indexOf(p.rank) + 1], eligible = canAppointCareerRank(p, id)
      const text = formatTownDialogue(selectTownDialogue({ ...context, nextRank: next, promotionEligible: eligible }, 'promotion'), { nextRank: next ?? '', required: next ? CAREER_RANK_THRESHOLDS[next] : 0 })
      const panel = this.openPanel(id === 'commander' ? `${p.faction === 'roman' ? '羅馬' : '維京'}指揮官 · 任命` : '騎兵隊長 · 任命', greeting + (response || greeting === text ? '' : '\n\n' + text))
      const detail = document.createElement('p'); detail.className = 'town-summary'; detail.textContent = promotionDetails(p); panel.append(detail)
      if (eligible) {
        const accept = this.button(panel, next === 'captain' ? '接受隊長任命' : '接受任命', async () => {
          if (this.promotionAttempt) return
          accept.disabled = true; accept.textContent = '正在準備任命…'
          const promoted = await this.acceptCareerPromotion(id)
          if (this.disposed || this.panel !== panel) return
          if (promoted) this.talk(id, selectTownDialogue({ ...context, playerRank: this.profile.rank }, 'promotionSuccess'))
          else {
            detail.textContent = this.notice || '任命尚未完成，請重試。'
            accept.disabled = false; accept.textContent = '重試接受任命'
          }
        })
      }
      this.tutorial?.appendPanel(panel, id)
      if (id === 'commander') appendCommanderRetirementOption(panel, this.profile, {
        available: () => !this.player.dead && this.serviceAvailable('commander'),
        openPanel: (title, text) => this.openPanel(title, text),
        start: () => this.startCommanderRetirement(), leave: () => this.closePanel(),
      })
    } else if (id === 'deployment') {
      this.openDeploymentPanel(greeting, context, firstOutpost)
    } else {
      const mount = id !== 'merchant', panel = this.openPanel(NAMES[id], greeting)
      const summary = document.createElement('p'); summary.className = 'town-summary'; summary.textContent = '可用軍功 ' + p.availableMerit + ' · ' + p.rank + (mount ? ' · 可重複購買；按 Tab 管理坐騎' : ' · 購買後按 Tab 選擇裝備'); panel.append(summary)
      const tabs = document.createElement('div'); tabs.className = 'town-shop-tabs'; panel.append(tabs)
      this.button(tabs, '購買', () => showProducts('buy'))
      this.button(tabs, '賣出', () => showProducts('sell'))
      let category = shopCategory
      const quantities = new Map<string, string>()
      const categories = document.createElement('div'); categories.className = 'town-shop-tabs town-shop-categories'
      categories.setAttribute('role', 'group'); categories.setAttribute('aria-label', '商品分類')
      if (!mount) {
        for (const [value, label] of EQUIPMENT_CATEGORIES) {
          const tab = this.button(categories, label, () => { category = value; showProducts('buy') })
          tab.dataset.category = value
        }
        panel.append(categories)
      }
      const showProducts = (page: 'buy' | 'sell' = shopPage) => {
        if (this.player.dead || !this.serviceAvailable(id)) return
        categories.hidden = page !== 'buy'
        for (const tab of Array.from(categories.children) as HTMLButtonElement[]) {
          tab.setAttribute('aria-pressed', String(tab.dataset.category === category))
        }
        for (const tab of Array.from(tabs.children) as HTMLButtonElement[]) tab.disabled = tab.textContent === (page === 'buy' ? '購買' : '賣出')
        summary.textContent = '可用軍功 ' + this.profile.availableMerit + ' · ' + this.profile.rank + (page === 'sell' ? ` · 回收價為原價的 ${TOWN_RESALE_PERCENT[this.profile.rank]}%` : id === 'eagle-trainer' ? ' · Captain / Commander 解鎖；最多持有 3 隻；按 Tab 騎乘／收起' : mount ? ' · 所有軍階皆可購買與騎乘；戰馬隨軍階至 T4' : ' · 所有軍階皆可購買與裝備；按 Tab 查看背包')
        panel.querySelector('.town-products')?.remove()
        panel.querySelector('.town-sale')?.remove()
        panel.querySelector('.town-native-sale')?.remove()
        const list = document.createElement('div'); list.className = page === 'buy' ? 'town-products town-purchase-products' : 'town-products'
        let section = ''
        const catalog = townShopProducts(id)
        const sections = !mount && page === 'buy' ? equipmentSections(catalog, category) : []
        const products = !mount && page === 'buy' ? sections.flatMap(section => section.items)
          : catalog.filter(i => page === 'buy' || isTownProductOwned(this.profile, i))
        if (page === 'sell') {
          summary.textContent += ' · 背包僅出售可用份數，已分配裝備會保留'
          appendTownSaleDropdown(panel, products.filter(item => availableCareerItem(this.profile, item.id) > 0).map(item => {
            const quantity = availableCareerItem(this.profile, item.id)
            return { id: item.id, name: item.name, quantity, refund: townResalePrice(this.profile, item.id) * quantity }
          }), ids => {
            if (this.player.dead || !this.serviceAvailable(id)) return
            const result = sellTownProducts(this.profile, ids)
            if (!result.sold) { this.talk(id, '目前沒有可賣出的份數，已分配裝備會保留。', 'sell'); return }
            if (!this.commit(result.profile)) { this.talk(id, this.notice, 'sell'); return }
            this.inventory.syncOwnership()
            this.careerMounts.syncOwnership()
            this.player.clearTownAction()
            this.talk(id, `已賣回 ${result.soldCount} 件物品，收回 ${result.earnedMerit} 可用軍功。`, 'sell')
          })
        }
        panel.append(list)
        if (!products.length) { const empty = document.createElement('p'); empty.textContent = page === 'buy' ? '此分類目前沒有商品。' : '沒有可賣出的物品。'; list.append(empty) }
        for (const item of products.sort((a, b) => {
          const group = (item: typeof a) => item.category === 'armor' ? 2 : WEAPONS[item.id]?.type === 'ranged' ? 1 : 0
          return mount || page === 'buy' ? 0 : group(a) - group(b)
        })) {
          if (!mount) {
            const heading = page === 'buy' ? `TIER ${item.tier}` : item.category === 'armor' ? '盾牌' : WEAPONS[item.id]?.type === 'ranged' ? '遠程武器' : '近戰武器'
            if (heading !== section) { const h = document.createElement('h3'); h.textContent = heading; list.append(h); section = heading }
          }
          const row = document.createElement('article'); row.className = 'town-product'
          const title = document.createElement('strong'); title.textContent = item.name
          const meta = document.createElement('small'); meta.textContent = (item.id === 'horse' ? '隨軍階 T1–T4' : 'T' + item.tier) + ' · ' + item.price + ' 軍功 · ' + productStatus(this.profile, item) + ` · 總持有 ${careerItemTotal(this.profile, item.id)} · 可用 ${availableCareerItem(this.profile, item.id)}`
          if (ARMORS[item.id]) meta.textContent += ` · ${ARMORS[item.id].shieldImpactMax} 衝擊耐久`
          row.append(title, meta)
          if (page === 'sell') {
            const price = townResalePrice(this.profile, item.id)
            meta.textContent = (item.id === 'horse' ? '隨軍階 T1–T4' : 'T' + item.tier) + ` · 回收 ${price} 軍功 · 總持有 ${careerItemTotal(this.profile, item.id)} · 可用 ${availableCareerItem(this.profile, item.id)}`
            const button = document.createElement('button'); button.className = 'town-button'
            button.disabled = townSaleStatus(this.profile, item.id) !== 'sellable'
            button.textContent = button.disabled ? '已分配，請先換裝／解除分配' : `賣出 · 收回 ${price} 軍功`
            button.onclick = () => {
              if (this.player.dead || !this.serviceAvailable(id)) return
              const result = sellTownProduct(this.profile, item.id)
              if (!result.sold) { this.talk(id, result.reason === 'allocated' ? '物品正在使用，請先換裝或解除分配。' : '物品已不存在或無法賣出。', 'sell'); return }
              if (!this.commit(result.profile)) { this.talk(id, this.notice, 'sell'); return }
              this.inventory.syncOwnership()
              this.careerMounts.syncOwnership()
              this.player.clearTownAction()
              this.talk(id, `賣出成功：${item.name}\n收回 ${result.earnedMerit} 可用軍功。`, 'sell')
            }
            row.append(button); list.append(row); continue
          }
          const status = productStatus(this.profile, item)
          const button = document.createElement('button'); button.className = 'town-button town-buy-button'
          const eagleRemaining = item.id === 'xongkoro'
            ? Math.max(0, MAX_PLAYER_OWNED_XONGKORO - careerItemTotal(this.profile, item.id)) : Infinity
          const maxQuantity = Math.min(MAX_BULK_PURCHASE_QUANTITY, Math.floor(this.profile.availableMerit / item.price), eagleRemaining)
          const label = document.createElement('label'); label.className = 'town-purchase-quantity'; label.textContent = '購買數量：'
          const quantity = document.createElement('select'); quantity.className = 'town-purchase-select'
          quantity.setAttribute('aria-label', '購買數量')
          for (let count = 1; count <= maxQuantity; count++) {
            const option = document.createElement('option'); option.value = String(count); option.textContent = String(count); quantity.append(option)
          }
          quantity.value = maxQuantity > 0 ? String(Math.min(maxQuantity, Number(quantities.get(item.id) ?? 1))) : ''
          quantity.disabled = maxQuantity < 1 || status === '軍階未解鎖'
          label.append(quantity)
          const total = document.createElement('small'); total.className = 'town-purchase-total'
          const updatePurchase = () => {
            const count = Number(quantity.value)
            total.textContent = `總價：${(item.price * count).toLocaleString()} 軍功`
            button.textContent = eagleRemaining === 0 ? '已達 3 隻持有上限' : status === '軍階未解鎖' ? status
              : maxQuantity < 1 ? '餘額不足' : `購買 ${count} 件`
            button.disabled = quantity.disabled
          }
          quantity.onchange = () => { quantities.set(item.id, quantity.value); updatePurchase() }
          updatePurchase()
          row.append(label, total)
          button.onclick = () => {
            if (this.player.dead || !this.serviceAvailable(id)) return
            if (mount && (this.player.isFalling || this.player.currentMount?.isAirborne)) { this.talk(id, '請先安全降落，再購買或切換坐騎。', 'buy', category); return }
            const result = mount ? purchaseTownMount(this.profile, item.id, Number(quantity.value)) : purchaseTownEquipment(this.profile, item.id, Number(quantity.value))
            if (!result.purchased) {
              const message = result.reason === 'ownership-limit' ? '最多同時持有 3 隻 xongkoro' : result.reason === 'tier-locked' ? '軍階未解鎖' : result.reason === 'insufficient-merit' ? '可用軍功不足' : result.reason === 'already-owned' ? '已擁有' : '商品不存在或無法購買'
              this.talk(id, message, 'buy', category); return
            }
            if (!this.commit(result.profile)) { this.talk(id, this.notice, 'buy', category); return }
            this.inventory.syncOwnership()
            this.careerMounts.syncOwnership()
            const message = `購買成功！\n${item.name} × ${Number(quantity.value)}\n花費：${result.spentMerit.toLocaleString()} 軍功\n剩餘軍功：${this.profile.availableMerit.toLocaleString()}`
            this.talk(id, message + (mount ? '\n按 Tab → 坐騎 → 騎乘。' : '\n按 Tab 選擇裝備。'), 'buy', category)
          }
          row.append(button); list.append(row)
        }
        if (page === 'sell' && id === 'merchant') this.appendNativeSale(panel)
      }
      if (id === 'cat' && !response) this.button(panel, '查看坐騎', () => showProducts())
      else showProducts()
    }
  }
  private nativeSaleContext(): TownNativeSaleContext {
    return { townFaction: this.sceneContext.worldFaction, peaceful: areOrdinaryTownServicesPeaceful(this.profile, this.event.hostile),
      playerAlive: !this.player.dead, merchantAvailable: this.serviceAvailable('merchant') }
  }
  private appendNativeSale(panel: HTMLElement): void {
    const context = this.nativeSaleContext()
    if (this.profile.rank !== 'commander' || context.townFaction !== this.profile.faction) return
    const section = document.createElement('section'); section.className = 'town-native-sale'
    const heading = document.createElement('h3'); heading.textContent = '城鎮舊裝備'; section.append(heading)
    const summary = document.createElement('p'); summary.className = 'town-summary'
    summary.textContent = `已出售 ${this.profile.townEquipment?.[context.townFaction]?.soldNativeIds?.length ?? 0} 件 · 僅回收已卸下的原生武器與盾牌`
    section.append(summary); panel.append(section)
    const stock = townNativeSaleStock(this.profile, context.townFaction), enabled = !townNativeSaleGate(this.profile, context)
    const sell = (requests: TownNativeSaleRequest[]) => {
      const result = sellTownNativeProducts(() => this.profile, () => this.nativeSaleContext(), requests, next => this.commit(next))
      if (!result.sold) {
        this.talk('merchant', result.reason === 'save-failed' ? this.notice : '城鎮舊裝備或交易狀態已改變，請重新選擇。', 'sell'); return
      }
      this.player.clearTownAction()
      this.talk('merchant', `已賣回 ${result.soldCount} 件城鎮舊裝備，收回 ${result.earnedMerit} 可用軍功。`, 'sell')
    }
    appendTownSaleDropdown(section, stock.map(entry => ({ id: entry.product.id, name: entry.product.name,
      quantity: entry.nativeIds.length, refund: entry.price * entry.nativeIds.length })), ids => {
      sell(ids.map(itemId => ({ itemId, quantity: stock.find(entry => entry.product.id === itemId)!.nativeIds.length })))
    }, '件', enabled)
    if (!stock.length) { const empty = document.createElement('p'); empty.textContent = '沒有可賣出的城鎮舊裝備。'; section.append(empty) }
    for (const entry of stock) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = entry.product.name
      const meta = document.createElement('small'); meta.textContent = `T${entry.product.tier} · 數量 ${entry.nativeIds.length} · 單價 ${entry.price} 軍功`
      row.append(title, meta)
      const button = this.button(row, `賣出 1 件 · 收回 ${entry.price} 軍功`, () => sell([{ itemId: entry.product.id, quantity: 1 }]))
      button.disabled = !enabled; section.append(row)
    }
  }
  private personalCommandsEnabled(): boolean {
    const active = this.profile.activeMission ?? this.profile.activeOutpostMission
    return Boolean(!this.player?.dead && !this.profile.activeMission?.result && this.profile.activeMission?.kind !== 'duel'
      && (!active || active.personalSquad) && this.profile.personalSquad?.members.length)
  }
  private commandsEnabled(): boolean { return this.personalCommandsEnabled() || Boolean(!this.player?.dead && !isTownCommandRevokedByRetirement(this.profile) && (this.civilianCommand?.commandsEnabled || this.townAirCommand?.commandsEnabled || this.townCommand?.commandsEnabled || this.profile.activeMission?.officialSquad && !this.profile.activeMission.result)) }
  private isAuthorizedCommandActor(npc: NPC): boolean {
    if (isAutonomousTownGuard(npc.combatantId)) return false
    if (this.personalSquad?.owns(npc)) return this.personalCommandsEnabled()
    if (isTownCommandRevokedByRetirement(this.profile)) return false
    if (this.civilianCommand?.accepts(npc) || this.townAirCommand?.accepts(npc)) return true
    if (this.captainPatrol?.active?.officialSquad?.actorIds.includes(npc.combatantId)) return this.captainPatrol.accepts(npc)
    const mission = this.profile.activeMission, authority = mission?.officialSquad
    if (authority && mission && !mission.result && mission.phase !== 'RETURNING' && authority.missionId === mission.id
      && (authority.commandRank !== 'commander' || this.profile.rank === 'commander')
      && officialCommandAcceptsActor(authority, npc)) return true
    return Boolean(this.townCommand?.accepts(npc) && this.townCommand.commandsEnabled)
  }
  /** Snapshot HUD membership from this scene and the current persisted authority only. */
  private readonly commandHudTypes = new CareerCommandHudTypes()
  private commandHudRoster() {
    const mission = this.profile.activeMission
    const active = mission ?? this.profile.activeOutpostMission
    const official = mission?.officialSquad?.type === 'mission-official'
      && mission.officialSquad.missionId === mission.id ? mission.officialSquad
      : !active && this.townCommand?.commandsEnabled
        && this.profile.townCommandSquad?.sceneKey === this.townCommand.sceneKey
        ? this.profile.townCommandSquad : undefined
    const accepted = active?.personalSquad
    const live = this.personalSquad?.hudMission
    // Match the accepted mission roster before using live checkpoints; today's HR list
    // is not permission to append new recruits to a running mission.
    const sameRoster = Boolean(accepted && live
      && accepted.memberIds.length === live.memberIds.length
      && accepted.memberIds.every((id, index) => id === live.memberIds[index]))
    const personal: PersonalSquadMission | undefined = accepted
      ? sameRoster ? { ...accepted, members: live!.members } : accepted
      : !active ? live ? { ...live } : snapshotPersonalMission(this.profile) : undefined
    return careerCommandHudRoster({
      careerRetirement: this.profile.careerRetirement,
      unitTypes: { ...this.commandHudTypes.read(this.profile),
        ...Object.fromEntries(this.residents.filter(resident => resident.spec.eagle).map(resident => [resident.spec.id, 'eagle' as const])) },
      personalMembers: this.profile.personalSquad?.members,
      sceneKey: `town:${this.world?.faction ?? this.profile.faction}`,
      faction: this.profile.faction,
      ...(active ? { missionId: active.id } : {}),
      official,
      townAirActorIds: this.townAirCommand?.hudActorIds,
      civilians: this.civilianCommand?.commandsEnabled ? this.civilianCommand.hudState : undefined,
      civilianReturningIds: this.civilianCommand?.returningActorIds,
      officialReturningIds: mission?.kind === 'captain-patrol-command' ? this.captainPatrol?.returningActorIds
        : official?.type === 'town-command' ? this.townCommand?.returningActorIds : undefined,
      officialTrainingIds: official?.type === 'town-command' ? this.townCommand?.trainingActorIds : undefined,
      officialPending: Boolean(mission && official?.type === 'mission-official'
        && !this.deploymentReady && !this.deploymentFailed),
      personal,
      personalPendingIds: this.personalSquad?.hudPendingIds,
      personalReturningIds: this.personalSquad?.hudReturningIds,
      actors: this.commandActors,
    })
  }

  private synchronizeCommandActors(): void {
    const mission = isTownCommandRevokedByRetirement(this.profile) ? undefined : this.profile?.activeMission
    const authority = mission?.officialSquad?.type === 'mission-official' && mission.officialSquad.missionId === mission.id
      ? mission.officialSquad : !mission && !this.profile?.activeOutpostMission && this.townCommand?.commandsEnabled
        ? this.profile.townCommandSquad : undefined
    this.personalCommandUI?.setOfficialSquadLabel?.(officialCommandHudLabel(authority))
    if (!this.commandActors) return
    this.commandActors.length = 0
    this.commandActors.push(...new Set([...(this.residents ?? []).map(r => r.npc), ...(this.mission?.fieldNpcs ?? []), ...(this.defense?.fieldNpcs ?? []), ...(this.personalSquad?.actors ?? [])]))
  }

  /** One transaction grants every selected official/civilian owner before the shared controller mutates actors. */
  private preparePlayerCommand(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget, participants: readonly NPC[], assignments?: readonly FormationCommandAssignment[]): boolean {
    let official = stageOfficialCommandOrder(this.profile, participants, order, assignments, npc => this.snapshotOfficialActor(npc))
    const mission = this.profile.activeMission, authority = mission?.officialSquad
    // A completely fallen air squad still needs Dismiss to release its suspended native lifecycle.
    if (!isTownCommandRevokedByRetirement(this.profile) && order === 'dismiss' && (target === 'all' || target === 'squad:8') && this.profile.rank === 'commander'
      && (mission?.kind === 'town-defense' || mission?.kind === 'commander-four-gate-defense') && !mission.result && authority?.commandRank === 'commander'
      && authority.missionId === mission.id && authority.townFaction === this.profile.faction
      && authority.commandedSquadIds?.includes(8)) {
      official ??= cloneCareerProfile(this.profile)
      const staged = official.activeMission!.officialSquad!
      staged.commandedSquadIds = staged.commandedSquadIds?.filter(id => id !== 8)
      for (const npc of this.commandActors ?? []) if (TOWN_AIR_COMMAND_IDS.includes(npc.combatantId)
        && authority.squads?.find(squad => squad.squadId === 8)?.actorIds.includes(npc.combatantId)) {
        const checkpoint = this.snapshotOfficialActor(npc)
        ;(staged.members ??= {})[npc.combatantId] = checkpoint
        const fourGateDefense = official.activeMission!.fourGateDefense
        if (fourGateDefense) fourGateDefense.actors[npc.combatantId] = structuredClone(checkpoint)
        const battle = official.activeMission!.battle?.actors[npc.combatantId]
        if (battle) battle.checkpoint = checkpoint
      }
    }
    const civilian = this.civilianCommand?.stageCommand(official ?? this.profile, order, target, participants)
    const town = this.townCommand?.stageCommand(civilian ?? official ?? this.profile, order, target, participants, assignments)
    const air = this.townAirCommand?.stageCommand(town ?? civilian ?? official ?? this.profile, order, target, participants, assignments)
    const next = air ?? town ?? civilian ?? official
    if (!next) return true
    if (order === 'formation' && civilian?.civilianCommandSquad) for (const assignment of assignments ?? []) {
      const member = next.civilianCommandSquad?.members[assignment.npc.combatantId]
      if (member) member.formation = { commandId: assignment.commandId, position: { ...assignment.position }, reached: assignment.reached }
    }
    if (!this.commit(next)) return false
    if (civilian) this.civilianCommand?.applySavedState(this.profile.civilianCommandSquad)
    if (air) this.townAirCommand?.applySavedState(this.profile.townAirCommandSquad)
    return true
  }

  private onPlayerCommandIssued(order: TacticalOrder, target: ArmyCommandTarget): void {
    if (target === 'squad:personal' || target === 'all') this.personalSquad?.resumeCommand(order)
    for (const npc of this.commandActors) {
      if (this.profile.activeMission?.officialSquad?.actorIds.includes(npc.combatantId)
        && matchesArmyCommandTarget(npc, target)) {
        npc.missionMovement = false
        this.defense?.releasePlayerCommand(npc)
        this.mission?.releasePlayerCommand?.(npc)
      }
    }
    if (order !== 'follow') sound.playCommanderCommand(this.profile.faction, order)
  }

  private snapshotOfficialActor(npc: NPC) {
    return this.defense?.snapshotCommandActor(npc) ?? this.mission?.snapshotCommandActor(npc)
      ?? snapshotCommandActor(npc, this.residents?.find(resident => resident.npc === npc)?.homeMount)
  }

  private issuePartyOrder(order: TacticalOrder | 'dismiss', target: ArmyCommandTarget): boolean {
    const townCommandedBefore = this.townCommand?.hasPlayerCommand(target) ?? false
    const ownedAirBefore = order === 'dismiss' ? (this.commandActors ?? []).filter(npc => this.playerOwnsEagleCommand(npc)) : []
    const participants = (this.commandActors ?? []).filter(npc => !npc.dead && this.isAuthorizedCommandActor(npc) && matchesArmyCommandTarget(npc, target))
    if (!this.preparePlayerCommand(order, target, participants)) return false
    let accepted = ownedAirBefore.some(npc => !this.playerOwnsEagleCommand(npc))
      || participants.some(npc => this.civilianCommand?.owns(npc) || this.townAirCommand?.actors.includes(npc)
        || this.townCommand?.owns(npc))
      || order === 'dismiss' && townCommandedBefore
    if (target === 'all' || target === 'squad:personal') {
      const personalAccepted = (order === 'follow' ? this.personalSquad?.follow() : this.personalSquad?.dismiss()) ?? false
      accepted = personalAccepted || accepted
      // Follow can be accepted by the reserve roster before its asynchronous actors exist.
      if (personalAccepted && order === 'follow' && target === 'squad:personal') this.tutorial?.commandAccepted({
        order, target, participantCount: this.profile.personalSquad?.members.length ?? 0,
      })
    }
    const ids = new Set(this.profile.activeMission?.officialSquad?.actorIds ?? [])
    const actors = participants.filter(npc => ids.has(npc.combatantId))
    for (const npc of actors) {
      const index = this.profile.activeMission!.officialSquad!.actorIds.indexOf(npc.combatantId)
      if (order === 'dismiss') {
        this.defense?.returnPlayerCommand?.(npc)
        if (this.eagleGarrison?.owns(npc)) this.eagleGarrison.releasePlayerCommand(npc, false)
        else {
          this.mission?.returnPlayerCommand?.(npc)
          this.captainPatrol?.returnPlayerCommand?.(npc)
        }
      } else {
        npc.missionMovement = false
        this.defense?.releasePlayerCommand(npc)
        this.mission?.releasePlayerCommand?.(npc)
        this.captainPatrol?.releasePlayerCommand?.(npc)
        npc.assignFollowTarget(this.player, index, officialFollowLocalOffset(index, npc.isMounted, Boolean(this.profile.personalSquad?.members.length)))
      }
    }
    if (actors.length) accepted = true
    if (accepted) {
      this.playMissionVoice(order === 'follow' ? 'follow' : 'dismiss')
    }
    return accepted
  }
  /** Eligibility is derived from actual resident identities and existing return/refit owners. */
  private townEquipmentContext(): TownEquipmentContext {
    const peaceful = areOrdinaryTownServicesPeaceful(this.profile, this.event.hostile) && !this.player.dead && !this.sceneContext.missionOnlyResidents
    const safeActorIds = new Set<string>()
    if (peaceful && !this.profile.activeMission && !this.profile.activeOutpostMission) {
      for (const { spec, npc, homeMount } of this.residents) {
        const duty = this.eagleGarrison?.dutyFor(npc)
        if (npc.combatantId !== spec.id || this.event.allActors.get(spec.id) !== npc
          || npc.faction === Faction.ENEMY || npc.faction === Faction.BANDIT || npc.hostileToPlayer || npc.dead || npc.isFalling || npc.inCombat || npc.mount?.isAirborne
          || homeMount?.isAirborne || homeMount?.dead || homeMount?.riderPlayer
          || homeMount?.riderNpc && homeMount.riderNpc !== npc
          || npc.combatOwnership === 'mission-official' || npc.combatOwnership === 'player-personal'
          || npc.combatOwnership === 'town-eagle-command' || this.eagleGarrison?.isPlayerCommandOwned(npc)
          || npc.combatOwnership === 'player-civilian' && ['attack', 'charge'].includes(npc.tacticalOrder)
          || this.profile.townCommandSquad?.members?.[spec.id]?.status === 'deployed' && ['attack', 'charge'].includes(npc.tacticalOrder)
          || this.patrol?.combatEnabled(npc) || this.patrol?.isRefitting(spec.id)
          || Boolean(this.profile.townCommandSquad?.nativeReturnStates?.[spec.id])
          || this.profile.townCommandSquad?.members?.[spec.id]?.formation?.commandId === TOWN_COMMAND_RETURN_ID
            && !this.profile.townCommandSquad.members[spec.id].formation?.reached
          || this.civilianCommand?.returningActorIds.includes(spec.id)
          || duty && !['standby', 'resting', 'mounted-waiting'].includes(duty)
          || !this.canRefitSquad([npc])) continue
        safeActorIds.add(spec.id)
      }
      if (this.personalSquad?.state === 'RESERVE' && this.canRefitSquad([])) {
        for (const member of this.profile.personalSquad?.members ?? []) safeActorIds.add(member.id)
      }
    }
    return { townFaction: this.sceneContext.worldFaction, peaceful, safeActorIds, personalState: this.personalSquad?.state ?? 'RESERVE' }
  }
  private usesNativeRangerCat(): boolean {
    const faction = this.sceneContext.worldFaction
    return faction !== this.profile.faction || !this.profile.townEquipment?.[faction]
      || resolveTownActorEquipment(this.profile, faction, 'ranger').refs.mount?.nativeId === `${faction}/ranger/mount`
  }
  private townRefitEngaged(npc: NPC): boolean {
    const resident = this.residents.find(r => r.npc === npc)
    if (resident?.spec.eagle) return this.eagleGarrison?.serviceCombatActive(npc) ?? npc.inCombat
    if (resident?.spec.duty === 'patrol') return Boolean(npc.hasLiveCombatTarget || this.patrol?.combatEnabled(npc))
    return npc.inCombat
  }
  private canRefitSquad(actors: readonly NPC[], nativeTravel = false): boolean {
    return areOrdinaryTownServicesPeaceful(this.profile, this.event.hostile) && this.squadRefitSafety.allows(this.player, actors, [], undefined, nativeTravel ? npc => this.townRefitEngaged(npc) : undefined)
      && !this.shots.some(shot => !shot.training && (shot.player || actors.some(actor => actor.combatantId === shot.sourceRef?.actorId)))
  }
  private canRefitCivilians(actors: readonly NPC[], orders: readonly TacticalOrder[]): boolean {
    return !this.restoringAerialState && !this.commanderReturnPending
      && (this.residentSpawnBatch?.ready ?? true) && this.deploymentReady
      && !this.defense.active && !this.defense.servicesLocked && areOrdinaryTownServicesPeaceful(this.profile, this.event.hostile)
      && !this.profile.activeMission && !this.profile.activeOutpostMission
      && this.world.faction === this.profile.faction
      && this.squadRefitSafety.allows(this.player, actors, orders, undefined,
        npc => npc.hasLiveCombatTarget || npc.inCombat && !['follow', 'formation'].includes(npc.tacticalOrder))
      && !this.shots.some(shot => !shot.training && (shot.player || actors.some(actor => actor.combatantId === shot.sourceRef?.actorId)))
  }
  private emitCombatEvent(event: CombatEvent): void {
    (this.squadRefitSafety ??= new SquadRefitSafety()).note(event)
    if (this.retirementFinale?.active) { this.retirementFinale.recordEvent(event); return }
    if (this.captainPatrol?.active) this.captainPatrol.recordEvent(event)
    else (this.duel?.active ? this.duel.events : this.defense?.active ? this.defense.events : this.mission?.events)?.emit(event)
  }
  private openRecruitmentPanel(response?: string): void {
    if (this.player.dead || !this.serviceAvailable('hr-officer')) return
    const greeting = response ?? personalSquadGreeting(this.profile)
    const panel = this.openPanel('Human Resources Center · 人力資源中心', greeting)
    if (!canRecruitPersonalSquad(this.profile)) return
    if (!this.profile.townDialogueSeen?.includes(`${this.profile.faction}:hr-unlocked`)) {
      const next = cloneCareerProfile(this.profile)
      next.townDialogueSeen = [...(next.townDialogueSeen ?? []), `${next.faction}:hr-unlocked`]
      if (!this.commit(next)) { this.openPanel('無法保存交談紀錄', this.notice); return }
    }
    const members = this.profile.personalSquad?.members ?? []
    const summary = document.createElement('p'); summary.className = 'town-summary'; summary.style.whiteSpace = 'pre-line'
    summary.textContent = `PERSONAL SQUAD · ${members.length} / 30\nAvailable Merit: ${this.profile.availableMerit.toLocaleString()}\n`
      + PERSONAL_SQUAD_PRODUCTS.map(item => `${item.name} ×${members.filter(member => member.type === item.type).length}`).join('\n')
      + (members.length === 30 ? '\n你的隊伍已經滿了。三十人，是目前允許你的上限。' : '')
      + '\nFollow me：從 HR Center 出發 · Dismiss：返回整補'
    panel.append(summary)
    const refit = this.button(panel, '整補私兵部隊', () => {
      if (this.player.dead || !this.serviceAvailable('hr-officer')) return
      const repaired = this.personalSquad?.refit(next => this.commit(next))
      this.openRecruitmentPanel(repaired ? '私兵全隊已恢復完整戰力：士兵、坐騎、箭矢與盾牌皆已整補。' : this.notice || '目前無法整補私兵。')
    })
    refit.disabled = !this.personalSquad?.canRefit
    refit.title = refit.disabled ? '僅限和平狀態；請先停止交戰並改用 Follow、Defend 或 Formation。' : ''
    const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
    for (const item of PERSONAL_SQUAD_PRODUCTS) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = item.name
      const price = document.createElement('small'); price.textContent = `${item.price} Merit`
      const button = document.createElement('button'); button.className = 'town-button'; button.textContent = 'Recruit · 招募'
      const rankLocked = !canRecruitPersonalSquad(this.profile, item.type)
      button.disabled = members.length >= 30 || rankLocked
      if (rankLocked) button.title = '需正式任命為 Commander 才能招募。'
      button.onclick = () => {
        if (this.player.dead || !this.serviceAvailable('hr-officer')) return
        const first = !this.profile.townDialogueSeen?.includes(`${this.profile.faction}:hr-recruit-${item.type}`)
        const result = recruitPersonalSquadMember(this.profile, item.type, next => this.commit(next))
        const message = result.recruited ? first ? PERSONAL_RECRUIT_DIALOGUE[item.type] : '招募成功。'
          : result.reason === 'rank-locked' ? '需正式任命為 Commander 才能招募。' : result.reason === 'insufficient-merit' ? '軍功不足。' : result.reason === 'squad-full'
            ? '你的隊伍已經滿了。三十人，是目前允許你的上限。' : result.reason === 'save-failed' ? this.notice : '目前無法招募。'
        this.openRecruitmentPanel(message)
      }
      row.append(title, price, button); list.append(row)
    }
    const heading = document.createElement('h3'); heading.textContent = 'Sell / Release Member · 賣回／解除僱用'; list.append(heading)
    appendTownSaleDropdown(list, members.map((member, index) => ({
      id: member.id, name: personalUnitDisplayName(member, this.profile.faction, index),
      quantity: 1, refund: personalMemberRefund(this.profile, member),
    })), ids => this.confirmPersonalSales(ids), '人', this.personalSquad?.state === 'RESERVE'
      && !this.profile.activeMission && !this.profile.activeOutpostMission)
    for (const [index, member] of members.entries()) {
      const row = document.createElement('article'); row.className = 'town-product'
      const name = personalUnitDisplayName(member, this.profile.faction, index)
      const title = document.createElement('strong'); title.textContent = name
      const detail = document.createElement('small'); detail.textContent = `退款 ${personalMemberRefund(this.profile, member)} 軍功 · ${this.personalSquad?.state ?? 'RESERVE'}`
      const sell = document.createElement('button'); sell.className = 'town-button'; sell.textContent = '賣回／解除僱用'
      sell.disabled = this.personalSquad?.state !== 'RESERVE'
      sell.onclick = () => this.confirmPersonalSales([member.id])
      row.append(title, detail, sell); list.append(row)
    }
  }
  private confirmPersonalSales(memberIds: string[]): void {
    if (this.player.dead || !this.serviceAvailable('hr-officer')) return
    const ids = [...new Set(memberIds)]
    const members = ids.map(id => this.profile.personalSquad?.members.find(member => member.id === id))
    if (!ids.length || members.some(member => !member) || this.personalSquad?.state !== 'RESERVE'
      || this.profile.activeMission || this.profile.activeOutpostMission || !canRecruitPersonalSquad(this.profile)) {
      this.openRecruitmentPanel('全隊回到人資中心、進入 RESERVE 後才能賣回隊員。'); return
    }
    const refund = members.reduce((sum, member) => sum + personalMemberRefund(this.profile, member!), 0)
    const confirm = this.openPanel(`賣回 ${ids.length} 名隊員？`, `退款：${refund} 軍功\n目前裝備的武器、盾牌與坐騎會隨隊員離開，不會退回背包。\n想保留的裝備請先換下；非 Ranger 隊員至少要帶一把武器離開。\n這會永久解除僱用。`)
    this.button(confirm, '確認', () => {
      if (this.player.dead || !this.serviceAvailable('hr-officer')) return
      const result = sellPersonalSquadMembers(() => this.profile, this.personalSquad!, ids, next => this.commit(next))
      if (result.sold) { this.inventory.syncOwnership(); this.careerMounts.syncOwnership() }
      this.openRecruitmentPanel(result.sold ? `已解除僱用 ${result.soldCount} 人，退回 ${result.refund} 可用軍功。` : result.reason === 'save-failed' ? this.notice : '目前不能賣回隊員。')
    })
    this.button(confirm, '取消', () => this.openRecruitmentPanel())
  }
  private openSquadRefitPanel(message = '選擇要整補的正式小隊。全滅部隊也保留原本編制。'): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const panel = this.openPanel('城防部隊整補', message)
    for (const squad of this.townCommand?.refitSquads ?? []) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong')
      title.textContent = `Squad ${squad.squadId}：${squad.alive}/${squad.total}`
      const state = document.createElement('small')
      const allowed = this.townCommand!.canRefitSquad(squad.squadId)
      state.textContent = squad.pending ? '整補進行中 · 等待原生部隊安全返回／復原' : `${squad.alive === 0 ? '全滅 · ' : ''}${allowed ? '可整補' : '目前無法整補'}`
      const button = document.createElement('button'); button.className = 'town-button'; button.textContent = '整補此隊'
      button.disabled = !allowed
      button.onclick = () => {
        if (this.player.dead || !this.serviceAvailable('deployment')) return
        button.disabled = true
        const repaired = this.townCommand!.refit(squad.squadId)
        const pending = this.townCommand!.refitSquads.find(s => s.squadId === squad.squadId)?.pending
        this.openSquadRefitPanel(repaired ? pending ? `Squad ${squad.squadId} 整補進行中；巡邏與巨鷹正由原生管理者安全復原。`
          : `Squad ${squad.squadId} 已恢復完整戰力。` : this.notice || '目前無法整補；請停止交戰，等待冷卻與返回完成。')
      }
      row.append(title, state, button); panel.append(row)
    }
    if (this.profile.rank === 'commander' && this.civilianCommand) {
      const squad = this.civilianCommand.refitSquad
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = `Civilian Squad：${squad.alive}/${squad.total}`
      const state = document.createElement('small'); state.textContent = this.civilianCommand.canRefit() ? '可整補' : '目前無法整補'
      const button = document.createElement('button'); button.className = 'town-button'; button.textContent = '整補平民小隊'
      button.disabled = !this.civilianCommand.canRefit()
      button.onclick = () => {
        if (this.player.dead || !this.serviceAvailable('deployment')) return
        button.disabled = true
        if (!this.civilianCommand!.canRefit()) { this.openSquadRefitPanel('目前無法整補'); return }
        const repaired = this.civilianCommand!.refit()
        this.openSquadRefitPanel(repaired ? '平民小隊已恢復完整編制：21/21。' : '平民小隊整補失敗，原有狀態未變更。')
      }
      row.append(title, state, button); panel.append(row)
    }
    this.button(panel, '重新整理', () => this.openSquadRefitPanel())
  }
  private openDeploymentPanel(greeting: string, context: DialogueContext, firstOutpost: boolean): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const active = this.profile.activeMission
    if (active?.result) { this.openMissionResult(active.result, true); return }
    const panel = this.openPanel('士官長', greeting)
    this.tutorial?.appendPanel(panel, 'deployment')
    if (this.townCommand?.commandsEnabled) {
      this.button(panel, '城防部隊整補', () => this.openSquadRefitPanel())
    }
    const arrows = document.createElement('p'); arrows.className = 'town-summary'; arrows.textContent = `箭袋 ${this.player.arrowCount}/${PLAYER_ARROW_CAPACITY}`; panel.append(arrows)
    if (this.player.arrowCount < PLAYER_ARROW_CAPACITY) this.button(panel, '申請補滿箭矢', () => {
      if (this.player.dead || !this.serviceAvailable('deployment')) return
      this.player.setArrowCount(PLAYER_ARROW_CAPACITY)
      this.quiver.setArrowCount(this.player.arrowCount)
      const line = this.profile.faction === 'roman'
        ? '把箭袋張開。軍團不讓士兵空著手上前線——三十發，一發不少。讓敵人學會數數。'
        : '把箭袋拿來。三十支都給你塞滿——讓下一群蠢蛋替你數到零。'
      this.openDeploymentPanel(line, context, firstOutpost)
    })
    if (active) {
      const template = getCareerMissionTemplate(active.templateId)
      const badge = document.createElement('p'); badge.className = 'town-summary'
      badge.textContent = `任務進行中：${active.kind === 'duel' ? '1v1 Duel · 單挑' : template?.name ?? active.templateId}\n狀態 ${active.phase}${active.kind === 'duel' ? ` · T${active.duelTier} ${UNIT_PRESETS[active.duelPresetId!].nameEn}` : active.kind === 'town-defense' || active.kind === 'commander-four-gate-defense' ? ' · 守住所屬城鎮' : active.kind === 'patrol' ? ' · 沿指定路線巡邏' : active.kind === 'veteran-field' ? ' · 野戰任務' : ` · 目標 Camp ${active.targetCampId + 1}`}`
      panel.append(badge)
      return
    }
    const defaultPage = defaultCareerMissionPage(this.profile)
    const requestedPage = this.deploymentPage ?? defaultPage
    const selectedPage = requestedPage !== 'duel' && !isCareerMissionPageUnlocked(this.profile, requestedPage) ? defaultPage : requestedPage
    this.deploymentPage = selectedPage
    const tabs = document.createElement('nav'); tabs.className = 'town-mission-tabs'; tabs.setAttribute('aria-label', '任務分類')
    for (const [page, label] of [['recruit', '菜兵任務'], ['soldier', '士兵任務'], ['veteran', '老兵任務'], ['captain', '隊長任務'], ['commander', '指揮官任務'], ['duel', '1 v 1 · 對決']] as const) {
      const tab = document.createElement('button'); tab.className = 'town-button'; tab.textContent = label
      tab.setAttribute('aria-pressed', String(page === selectedPage))
      tab.disabled = page !== 'duel' && !isCareerMissionPageUnlocked(this.profile, page)
      if (tab.disabled) tab.textContent += ' · 升階解鎖'
      tab.onclick = () => { this.deploymentPage = page; this.openDeploymentPanel(greeting, context, firstOutpost) }
      tabs.append(tab)
    }
    panel.append(tabs)
    if (selectedPage === 'duel') { this.openDuelPage(panel); return }
    if (selectedPage === 'veteran') { this.openVeteranMissionPage(panel); return }
    if (selectedPage === 'captain') { this.openCaptainMissionPage(panel); return }
    if (selectedPage === 'commander') { this.openCommanderMissionPage(panel); return }
    if (selectedPage === 'soldier') {
      if (firstOutpost) {
        const outpost = document.createElement('p'); outpost.className = 'town-summary'
        outpost.textContent = selectTownDialogue(context, 'soldierFirstOutpost')
        panel.append(outpost)
      }
      if (this.profile.rank !== 'recruit') {
        const heading = document.createElement('h3'); heading.textContent = 'Outpost Duty'; panel.append(heading)
        for (const stageId of CAREER_OUTPOST_STAGES) {
          const stage = getDefenseCampaignStage(stageId)
          const unlocked = isCareerOutpostUnlocked(this.profile, stageId)
          const completed = this.profile.completedOutpostStages?.includes(stageId)
          const row = document.createElement('article'); row.className = 'town-product'
          const title = document.createElement('strong'); title.textContent = 'Outpost ' + ['I', 'II', 'III'][stageId - 1]
          const details = document.createElement('small'); details.textContent = `防守 ${stage.defenderDeployment.maxUnits} vs ${stage.attackerArmy.totalUnits} · ${completed ? 'Completed' : unlocked ? 'Available' : 'Locked until Outpost ' + ['I', 'II'][stageId - 2] + ' Victory'} · 玩家額外加入駐軍`
          row.append(title, details)
          if (unlocked) this.button(row, '接受防守任務', () => this.acceptOutpost(stageId))
          panel.append(row)
        }
      }
      const relief = document.createElement('article'); relief.className = 'town-product'
      const reliefTitle = document.createElement('strong'); reliefTitle.textContent = 'Outpost Relief · 騎兵救援'
      const reliefDetails = document.createElement('small')
      const reliefUnlocked = isCareerOutpostReliefUnlocked(this.profile)
      reliefDetails.textContent = !reliefUnlocked ? '完成 Outpost I–III 後解鎖' : !resolveCareerReliefMount(this.profile) ? '需要一匹可使用的自有坐騎' : '50 人騎兵救援隊（含玩家） · 殲滅 60 名敵軍 · 玩家戰死後可繼續觀戰'
      relief.append(reliefTitle, reliefDetails)
      if (reliefUnlocked && resolveCareerReliefMount(this.profile)) this.button(relief, '接受騎兵救援', () => this.acceptOutpostRelief())
      panel.append(relief)
    }
    const missions = availableCareerMissionsForPage(this.profile, selectedPage)
    const defenseForce = this.townDefenseBoardForce()
    if (selectedPage === 'recruit' && !resolveCareerReliefMount(this.profile)) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = 'Cavalry Sweep · 騎兵清剿'
      const details = document.createElement('small'); details.textContent = '60 騎兵 vs 40 Bandits · 適合熟悉騎乘、衝鋒與騎兵撞擊'
      row.append(title, details)
      const locked = document.createElement('button'); locked.textContent = '需要坐騎'; locked.disabled = true; row.append(locked)
      panel.append(row)
    }
    const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
    for (const template of missions) {
      if (!('risk' in template)) continue
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = template.name
      const details = document.createElement('small')
      details.textContent = template.kind === 'cavalry-sweep'
        ? `${template.briefing}\n2 支小隊 · 含玩家 60 人 · 玩家無指揮權`
        : template.kind === 'enemy-town-assault'
        ? `${template.briefing}\n敵方 ${townName(this.profile.faction === 'roman' ? 'viking' : 'roman')} · 軍事守軍 ${townAssaultObjectiveRoster(townRoster()).length} · 平民 ${TOWN_RULES.civilians} · 玩家無指揮權`
        : template.kind === 'town-defense'
        ? `${template.briefing}\n所屬 ${townName(this.profile.faction)}\n玩家 1 · AI 守軍 ${defenseForce.friendlySoldiers} · 友軍總數 ${defenseForce.friendlyCombatants}\n敵軍 ${template.enemyCount} 人（T3 騎兵、4 名 T4 隊長） · 平民傷亡上限 ${template.maxCivilianDeaths} · 風險 ${template.risk}`
        : template.kind === 'patrol'
          ? `${template.briefing}\n路線 ${template.routeId === 'south-road' ? '南路' : '森林線'}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlyCombatants - 2} · 友軍總數 ${template.friendlyCombatants}\n任務內容 沿線巡查 · 風險 ${template.risk}`
          : template.kind === 'bandit' ? `${template.briefing}\n城外 Bandit Camp ${template.preferredCampIndex + 1}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlySoldiers} · 友軍總數 ${template.friendlyCombatants}\nBandits ${template.banditCount} · 風險 ${template.risk}` : template.briefing
      details.style.whiteSpace = 'pre-line'
      row.append(title, details)
      this.button(row, '接受任務', () => this.acceptMission(template.id))
      list.append(row)
    }
    if (selectedPage === 'recruit' && enlistmentMerit(this.profile) < 60) {
      const gate = document.createElement('p'); gate.className = 'town-summary'
      gate.textContent = '累積本次入伍軍功後，會逐步開放林線巡邏、敵眾我寡與大型守城任務。'
      panel.append(gate)
    }
  }
  private townDefenseBoardForce() {
    return townDefenseForceCountsForProfile(this.profile, this.residents.map(r => r.spec),
      new Set(this.residents.filter(r => r.npc.dead).map(r => r.spec.id)))
  }
  private openVeteranMissionPage(panel: HTMLElement): void {
    for (const definition of VETERAN_MISSION_CATALOG) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      details.textContent = `${definition.briefing}\n友軍 ${definition.friendlyCombatants} 人（含玩家） · 玩家無指揮權 · 戰死後可觀戰`
      const availability = getVeteranMissionAvailability(this.profile, definition.id)
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.textContent = availability.unlocked ? '接受任務' : availability.reason ?? '尚未解鎖'
      accept.disabled = !availability.unlocked
      accept.onclick = () => this.acceptVeteranCareerMission(definition.id)
      row.append(title, details, accept); panel.append(row)
    }
    const homeDefenseTemplate = careerMissionTemplatesForPage(this.profile, 'veteran')
      .find(template => template.id === VETERAN_TOWN_DEFENSE_TEMPLATE_ID)
    if (!homeDefenseTemplate || homeDefenseTemplate.kind !== 'town-defense') return
    const homeDefense = homeDefenseTemplate
    const defenseForce = this.townDefenseBoardForce()
    const veteranWins = careerMissionCompletionsForTier(this.profile, 3)
    const unlocked = availableCareerMissionsForPage(this.profile, 'veteran').some(template => template.id === homeDefense.id)
    const row = document.createElement('article'); row.className = 'town-product'
    const title = document.createElement('strong'); title.textContent = homeDefense.name
    const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
    details.textContent = `${homeDefense.briefing}\n老兵任務勝利 ${Math.min(veteranWins, homeDefense.requiresCompletions)}/${homeDefense.requiresCompletions} · 守護 ${townName(this.profile.faction)} · 友軍 ${defenseForce.friendlyCombatants} 人（含玩家；AI 守軍 ${defenseForce.friendlySoldiers}） · 敵軍 ${homeDefense.enemyCount} 人（T3 騎兵、4 名 T4 隊長） · 平民傷亡上限 ${homeDefense.maxCivilianDeaths}`
    const accept = document.createElement('button'); accept.className = 'town-button'
    accept.textContent = unlocked ? '接受守城任務' : `需 ${homeDefense.requiresCompletions} 次老兵任務勝利 · ${Math.min(veteranWins, homeDefense.requiresCompletions)}/${homeDefense.requiresCompletions}`
    accept.disabled = !unlocked
    accept.onclick = () => this.acceptMission(homeDefense.id)
    row.append(title, details, accept); panel.append(row)
  }
  private openCaptainMissionPage(panel: HTMLElement): void {
    const defenseForce = this.townDefenseBoardForce()
    for (const definition of CAPTAIN_MISSION_CATALOG) {
      const availability = getCaptainMissionAvailability(this.profile, definition.id)
      const patrol = definition.id === CAPTAIN_PATROL_COMMAND_ID ? this.captainPatrol?.selectAvailableSquad() : null
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      const state = definition.id === CAPTAIN_PATROL_COMMAND_ID && !patrol ? this.captainPatrol?.unavailableReason ?? '巡邏隊正式編制尚未就緒，請稍後再接受任務。'
        : definition.id === CAPTAIN_EAGLE_BATTLE_ID ? `本次可參戰私兵 ${this.profile.personalSquad?.members.length ?? 0} 人 · 依原裝備参加空戰或地面作戰`
        : '正式部隊與私兵分別指揮，有效貢獻共同計算軍功。'
      const briefing = definition.id === CAPTAIN_GATE_DEFENSE_ID
        ? captainGateDefenseBriefing(this.residents.map(r => r.spec), this.unavailableTownCavalryActorIds(true))
        : definition.briefing
      const force = definition.kind === 'town-defense'
        ? `\n玩家 1 · AI 守軍 ${defenseForce.friendlySoldiers} · 友軍總數 ${defenseForce.friendlyCombatants}` : ''
      details.textContent = `${briefing}${force}\n${state}`
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.disabled = !availability.unlocked || definition.id === CAPTAIN_PATROL_COMMAND_ID && !patrol
      accept.textContent = availability.unlocked ? accept.disabled ? '巡邏隊暫時不可用' : '接受任務' : availability.reason ?? '尚未解鎖'
      accept.onclick = () => this.acceptCaptainMission(definition.id)
      row.append(title, details, accept); panel.append(row)
    }
  }
  private openCommanderMissionPage(panel: HTMLElement): void {
    for (const definition of COMMANDER_MISSION_CATALOG) {
      const availability = getCommanderMissionAvailability(this.profile, definition.id)
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      const force = definition.id === COMMANDER_SKY_RAID_ID
        ? '正式兵力：玩家 1 人 + 2 支 25 人 T4 Ranger·xongkoro 空降隊；敵方：敵城原生人員（擊殺任意 100 人取勝）。私兵最多額外 30 人。'
        : definition.id === COMMANDER_DECAPITATION_ID
          ? '正式兵力：玩家 1 人 + 前任 T5 Commander + 10 T4 Lancer + 10 T4 Sword/Axe Cavalry + 9 T4 Horse Archer（全員騎乘）；敵方：敵城全體，斬首目標為 T5 Commander 1 人。'
          : definition.id === 'commander-four-gate-defense' ? '守衛所屬城鎮：原生八隊城防部隊與最多30名 HR 私兵。敵軍230人、八台攻城車、30隻巨鷹；守方準備180秒後，敵軍才從邊境抵達，四門同時進攻。'
          : definition.id === COMMANDER_BRIDGEHEAD_ID ? '正式兵力：玩家1人 + 八隊各25名步兵；敵方八隊各25名騎兵。雙方各192 T3 + 8 T4。現有 HR 私兵最多額外30人，沿用原裝備與坐騎。'
          : '正式兵力：玩家 1 人 + 4 支 30 人步兵隊；敵軍：48 T3 + 2 T4 Lancer、24 T3 + 1 T4 Sword/Axe Cavalry、24 T3 + 1 T4 Horse Archer。60 秒部署。'
      const survival = '玩家戰死後可觀戰；官方部隊或已部署私兵存活時戰鬥繼續。'
      details.textContent = `${definition.briefing}\n${force}\n${survival}`
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.disabled = !availability.unlocked
      accept.textContent = availability.unlocked ? '接受任務' : availability.reason ?? '尚未解鎖'
      accept.onclick = () => this.acceptCommanderMission(definition.id)
      row.append(title, details, accept); panel.append(row)
    }
  }
  private acceptCommanderMission(templateId: string): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.loadChecked().profile
    if (!fresh || !getCommanderMissionDefinition(templateId) || this.player.dead || this.event.hostile) return
    const availability = getCommanderMissionAvailability(fresh, templateId)
    if (!availability.unlocked) { this.openPanel('無法接受任務', availability.reason ?? '目前無法接受。'); return }
    const next = acceptCommanderCareerMission(fresh, templateId)
    if (!next || !this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始，請重試。'); return }
    if (templateId === COMMANDER_BRIDGEHEAD_ID) {
      const launch = createCareerBridgeBattleLaunch(this.profile)
      this.dispose(true); this.onCampaign(launch); return
    }
    if (templateId === COMMANDER_LAST_STAND_ID) {
      const launch = createCareerCommanderOutpostLaunch(this.profile)
      this.dispose(true); this.onCampaign(launch); return
    }
    this.dispose(); this.onRestart(this.profile)
  }
  private acceptCaptainMission(templateId: string): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.loadChecked().profile, definition = getCaptainMissionDefinition(templateId)
    if (!fresh || !definition || this.player.dead || this.event.hostile) return
    const availability = getCaptainMissionAvailability(fresh, templateId)
    if (!availability.unlocked) { this.openPanel('無法接受任務', availability.reason ?? '目前已有任務。'); return }
    let next: CareerProfile | null = null
    if (templateId === CAPTAIN_PATROL_COMMAND_ID) {
      const selected = this.captainPatrol?.selectAvailableSquad()
      if (!selected) { this.openPanel('巡邏隊暫時不可用', this.captainPatrol?.unavailableReason ?? '巡邏隊正式編制尚未就緒，請稍後再接受任務。'); return }
      const mission = this.captainPatrol!.captureForMission(createCaptainPatrolCommandMission(fresh, selected.actorIds))
      if (!mission) return
      next = cloneCareerProfile(fresh); next.activeMission = mission
    } else if (templateId === CAPTAIN_CAVALRY_COMMAND_ID) next = acceptCaptainCavalryCommand(fresh, undefined,
      selectMissionCavalryActorIds(this.residents, 59, this.unavailableTownCavalryActorIds()))
    else if (templateId === CAPTAIN_GATE_DEFENSE_ID) {
      next = cloneCareerProfile(fresh)
      const unavailable = new Set(this.unavailableTownCavalryActorIds(true))
      if (fresh.rank === 'commander') for (const resident of this.residents) if (resident.npc.dead) unavailable.add(resident.spec.id)
      next.activeMission = createCaptainGateDefenseMission(fresh,
        townAssaultObjectiveRoster(this.residents.map(r => r.spec)).map(spec => spec.id),
        this.residents.filter(r => r.spec.role === 'civilian').map(r => r.spec.id), this.residents.map(r => r.spec), undefined, unavailable)
    } else if (templateId === CAPTAIN_FRONTLINE_COMMAND_ID) next = acceptCaptainFrontline(fresh)
    else if (templateId === CAPTAIN_SIEGE_COMMAND_ID) next = acceptCaptainSiegeCommand(fresh)
    else if (templateId === CAPTAIN_EAGLE_BATTLE_ID) {
      if (!this.careerMounts.list().find(mount => mount.id === 'xongkoro')?.available) {
        this.openPanel('巨鷹目前不可用', '需要玩家可使用且仍存活的自有 xongkoro；請檢查分配與本次出城的傷亡。'); return
      }
      next = acceptCaptainEagle(fresh)
      if (next?.activeMission) next.activeMission.mountState = this.careerMounts.checkpoint()
    }
    if (!next) { this.openPanel('無法接受任務', templateId === CAPTAIN_EAGLE_BATTLE_ID ? '需要一隻玩家可以使用的已購買 xongkoro；請檢查私兵分配與坐騎狀態。' : '部隊或坐騎目前不可用。'); return }
    if (!this.commit(next)) return
    if (templateId === CAPTAIN_FRONTLINE_COMMAND_ID || templateId === CAPTAIN_EAGLE_BATTLE_ID) {
      const launch = templateId === CAPTAIN_FRONTLINE_COMMAND_ID ? createCaptainFrontlineLaunch(this.profile) : createCaptainEagleLaunch(this.profile)
      this.dispose(true); this.onCampaign(launch); return
    }
    if (templateId === CAPTAIN_SIEGE_COMMAND_ID) { this.dispose(); this.onRestart(this.profile); return }
    if (templateId === CAPTAIN_GATE_DEFENSE_ID) { this.startHomeDefense(); return }
    const started = templateId === CAPTAIN_PATROL_COMMAND_ID ? this.captainPatrol!.resume(false)
      : this.mission.startActiveMission()
    if (!started) { this.openPanel('任務部署失敗', '任務及兵權交接已保存。重新載入可恢復同一支部隊。'); return }
    if (templateId === CAPTAIN_CAVALRY_COMMAND_ID) this.careerMounts.activate(this.profile.selectedMountId!)
    this.inventory.prepareForCombat(); this.synchronizeCommandActors(); this.closePanel()
    if (templateId === CAPTAIN_PATROL_COMMAND_ID) this.updateCaptainPatrolGuide()
  }
  private acceptVeteranCareerMission(templateId: string): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const definition = getVeteranMissionDefinition(templateId)
    const fresh = this.store.loadChecked().profile
    if (!definition || !fresh || this.player.dead || this.event.hostile) return
    const townCavalryReserveActorIds = definition.kind === 'veteran-field'
      ? selectTownCavalryReserve(this.residents,
        veteranTownCavalryReserveSlots(createVeteranRoster(definition.id, fresh.faction)),
        this.unavailableTownCavalryActorIds())
      : undefined
    const next = acceptVeteranMission(fresh, definition.id, { townCavalryReserveActorIds })
    if (!next) { this.openPanel('無法接受任務', getVeteranMissionAvailability(fresh, definition.id).reason ?? '目前已有任務或小鎮處於敵對狀態。'); return }
    if (!this.commit(next)) return
    if (definition.kind !== 'veteran-field') {
      const launch = createCareerVeteranOutpostLaunch(this.profile)
      this.dispose(true); this.onCampaign(launch)
      return
    }
    if (isCareerEnemyTerritoryFieldMission(next.activeMission)) {
      this.dispose()
      this.onRestart(this.profile)
      return
    }
    if (!this.mission.startActiveMission()) { this.openPanel('任務部署失敗', '任務已保存，重新載入後可恢復同一支部隊。'); return }
    this.careerMounts.activate(next.selectedMountId!)
    this.inventory.prepareForCombat()
    this.notice = `已接受 ${definition.name}。前往兵營集合。`
    this.playMissionVoice('missionAccepted')
    this.closePanel()
  }
  private openDuelPage(panel: HTMLElement): void {
    const activities = [['duel', '單挑 Duel'], ['race', '繞城賽馬 Racing']] as const
    const tabs = document.createElement('nav'); tabs.className = 'town-mission-tabs'; tabs.style.position = 'static'
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '1 v 1 對決種類')
    const content = document.createElement('section'); content.id = 'town-one-v-one-content'
    content.setAttribute('role', 'tabpanel')
    const buttons = activities.map(([activity, label]) => {
      const tab = document.createElement('button'); tab.className = 'town-button'; tab.textContent = label
      tab.id = `town-one-v-one-${activity}`; tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', content.id)
      tab.onclick = () => { this.duelActivity = activity; render() }
      tab.onkeydown = event => {
        const index = activities.findIndex(([id]) => id === activity)
        const next = event.key === 'ArrowRight' ? (index + 1) % activities.length
          : event.key === 'ArrowLeft' ? (index + activities.length - 1) % activities.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? activities.length - 1 : null
        if (next === null) return
        event.preventDefault(); this.duelActivity = activities[next][0]; render(); buttons[next].focus()
      }
      tabs.append(tab); return tab
    })
    const render = () => {
      buttons.forEach((tab, index) => {
        const selected = activities[index][0] === this.duelActivity
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1
        if (selected) content.setAttribute('aria-labelledby', tab.id)
      })
      content.replaceChildren()
      if (this.duelActivity === 'race') this.openRacePage(content)
      else this.openDuelSelection(content)
    }
    panel.append(tabs, content); render()
  }
  private openDuelSelection(panel: HTMLElement): void {
    const presets = getUnitPresetsForFaction(this.profile.faction)
    const selected = presets.find(preset => preset.id === this.duelPresetId) ?? presets[0]
    this.duelPresetId = selected.id
    const heading = document.createElement('h3'); heading.textContent = 'Unit Type · 兵種'; panel.append(heading)
    const units = document.createElement('div'); units.className = 'town-products'; panel.append(units)
    for (const preset of presets) {
      const row = document.createElement('article'); row.className = 'town-product'
      const button = document.createElement('button'); button.className = 'town-button'
      button.textContent = `${preset.nameEn} · ${preset.nameZh}`
      button.setAttribute('aria-pressed', String(preset.id === selected.id))
      const progress = document.createElement('small')
      progress.textContent = CAREER_DUEL_TIERS.map(tier => `T${tier} ${isCareerDuelUnlocked(this.profile, preset.id, tier) ? '已解鎖' : 'Locked'}`).join(' · ')
      button.onclick = () => { this.duelPresetId = preset.id; this.talk('deployment') }
      row.append(button, progress); units.append(row)
    }
    const tiers = document.createElement('h3'); tiers.textContent = `Tier · ${selected.nameEn}`; panel.append(tiers)
    for (const tier of CAREER_DUEL_TIERS) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = `T${tier} ${selected.nameEn}`
      const details = document.createElement('small')
      const unlocked = isCareerDuelUnlocked(this.profile, selected.id, tier)
      details.textContent = unlocked ? `5 秒準備 · 30 秒內擊敗對手${tier === 5 ? ' · Commander 出戰，Captain 裁判' : tier === 4 ? selected.traits.includes('bow_fire') ? ' · Shadow Warden 出戰' : ' · Captain 出戰，Shadow Warden 裁判' : ''}` : `先擊敗 T${tier - 1} ${selected.nameEn}`
      const accept = document.createElement('button'); accept.className = 'town-button'; accept.textContent = unlocked ? '接受單挑' : 'Locked'; accept.disabled = !unlocked
      accept.onclick = () => this.acceptDuel(selected.id, tier)
      row.append(title, details, accept); panel.append(row)
    }
  }
  private openRacePage(panel: HTMLElement): void {
    const racing = document.createElement('h3'); racing.textContent = 'Mounted Circuit Racing · 繞城賽馬'; panel.append(racing)
    for (const race of MOUNTED_RACES) {
      const row = document.createElement('article'); row.className = 'town-product'
      const name = document.createElement('strong'); name.textContent = `${race.name} · 指揮官 · ${race.mount}`
      const details = document.createElement('small')
      details.textContent = `指揮官 ${race.sprint ? 'Sprint' : 'Normal（不衝刺）'} · 玩家可衝刺 · 勝利 ${race.merit} 軍功 · ${this.profile.completedRaceIds?.includes(race.id) ? '已完成' : '未完成'}`
      const accept = this.button(row, '接受賽馬', () => this.acceptRace(race.id))
      accept.disabled = Boolean(this.profile.activeRace || this.profile.activeMission || this.profile.activeOutpostMission)
      row.prepend(name, details); panel.append(row)
    }
  }
  private acceptRace(id: RaceId): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.loadChecked().profile
    if (!fresh || !this.race?.accept(id, fresh)) {
      this.openPanel('無法接受賽馬', this.race?.error || '無法讀取生涯存檔。'); return
    }
    this.closePanel()
    this.notice = '跟隨 Captain 前往北門。玩家所有賽事皆可使用 Shift 衝刺。'
  }
  private showRaceResult(): void {
    const race = this.race, session = race?.session
    if (!race || !session?.result || session.phase === 'finishing') return
    if (!race.resultSaved && !race.persist()) {
      const panel = this.openPanel('賽事結算尚未保存', '結果已鎖定。保存失敗，請重試；尚未發表賽果。')
      this.button(panel, '重試保存結果', () => { if (race.persist()) { this.closePanel(); this.showRaceResult() } })
      return
    }
    const name = raceDefinitionForSchedule(session.raceId, session.scheduleVersion)!.name
    const merit = this.profile.raceRecords?.find(record => record.sessionId === session.id)?.merit ?? 0
    const panel = this.openPanel(`${name} · ${session.result === 'win' ? 'Victory' : session.result === 'loss' ? 'Defeat' : 'Draw'}`,
      `${session.reason ?? ''}\n玩家：${session.player.finishSeconds !== undefined ? `${session.player.finishSeconds.toFixed(2)} 秒` : 'DNF'} · ${session.opponent.actorId === 'commander' ? '指揮官' : 'NPC'}：${session.opponent.finishSeconds !== undefined ? `${session.opponent.finishSeconds.toFixed(2)} 秒` : 'DNF'}\n本場軍功：+${merit}\n結果已保存。城鎮敵對與戰損維持實際狀態。`)
    this.button(panel, '直接返回小鎮', () => this.leaveRace())
    if (race.canWalkBack) this.button(panel, '跟隊長走回去', () => {
      if (!race.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
      this.closePanel()
    })
  }
  private leaveRace(direct = true): void {
    if (!this.checkpointRaceTownResult()) return
    const pendingTownResult = this.profile.townEvent?.pendingResult
    const dead = this.player.dead
    if (!this.race?.clear(direct)) { this.notice = this.race?.error || '返回狀態保存失敗，請重試。'; return }
    if (pendingTownResult) { this.showTownResult(pendingTownResult); return }
    const saved = this.profile.racePlayerState!
    if (dead) {
      // Recover only the player, without rebuilding/refitting the Town or ending hostility.
      this.player.resetForScene(saved.position.x, saved.position.y, saved.position.z)
      this.spectator = null
      this.hp.setFill(this.player.hpRatio)
    } else if (direct) {
      const mount = this.player.currentMount
      if (mount && saved.mounted) {
        mount.group.position.set(saved.mountPosition.x, saved.mountPosition.y, saved.mountPosition.z)
        mount.group.rotation.y = saved.mountPosition.yaw
        this.player.syncMountTransform()
      } else this.player.setPosition(saved.position.x, saved.position.y, saved.position.z)
    }
    if (direct || dead) this.player.faceDirection(Math.sin(saved.position.yaw), Math.cos(saved.position.yaw))
    this.closePanel(); this.notice = '賽事已結束，已返回小鎮。'
  }
  private updateRaceHud(): void {
    const race = this.race
    const session = !this.panel && !this.equipment.visible ? race?.session ?? null : null
    const target = race?.guideTarget ?? null
    const distance = target ? Math.hypot(target.x - this.player.combatPosition.x, target.z - this.player.combatPosition.z) : null
    this.raceHud.update(session, { ready: race?.ready ?? false, resultSaved: race?.resultSaved ?? false,
      saveFailed: race?.saveFailed ?? false, error: race?.error ?? '', distance })
    if (!session) { this.raceGuide.hide(); return }
    this.raceGuide.updateRace(this.player.combatPosition, this.orbit.cameraYaw, target,
      session.phase === 'racing' || session.phase === 'finishing' ? `下一站：${RACE_LINES[session.player.checkpoint]?.label ?? '完成'}`
        : session.phase === 'returning' ? '返回小鎮' : '北門起跑區')
  }
  private acceptTutorialDuel(): void {
    if (this.player.dead || !this.serviceAvailable('captain') || !canStartCareerTutorial(this.profile)) return
    const fresh = this.store.loadChecked().profile
    if (!fresh || fresh.tutorial?.careerId !== this.profile.tutorial?.careerId || !canStartCareerTutorial(fresh)
      || fresh.tutorial?.town.step !== 'duel') {
      this.openPanel('無法開始新兵切磋', '請先完成士官長的購買武器引導，並結束其他活動。'); return
    }
    const mission = this.duel.createTutorialMission()
    if (!mission) { this.openPanel('無法開始新兵切磋', '隊長或裁判暫時無法出場，請稍後再來。'); return }
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('切磋尚未開始', '保存失敗，請重試。'); return }
    if (!this.duel.startActiveMission()) {
      // Technical deployment failure has no defeat settlement and no consolation reward.
      this.openPanel('新兵切磋部署失敗', '本場尚未結算；重新載入可重試相同切磋，或取消後稍後再來。')
      this.button(this.panel!, '取消本次切磋', () => this.returnToTown('direct'))
      return
    }
    this.inventory.prepareForCombat()
    this.notice = '跟隨實際隊長前往單挑場地；新兵切磋使用步戰，30 秒超時判負。'
    this.closePanel()
  }
  private acceptDuel(presetId: UnitPresetId, tier: CareerDuelTier): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.load()
    if (!fresh || this.player.dead || this.event.hostile || !isCareerDuelUnlocked(fresh, presetId, tier) || fresh.activeRace || fresh.activeMission || fresh.activeOutpostMission || fresh.townEvent?.state === 'hostile') {
      this.openPanel('無法接受單挑', '生涯存檔已變更、該兵種 Tier 尚未解鎖，或目前正在交戰。'); return
    }
    const mission = this.duel.createMission(presetId, tier)
    if (!mission) { this.openPanel('無法接受單挑', '目前沒有可出戰的城鎮士兵。'); return }
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('單挑保存失敗', '單挑尚未開始。請確認瀏覽器儲存空間後重試。'); return }
    this.playMissionVoice('missionAccepted')
    if (!this.duel.startActiveMission()) { this.openPanel('單挑部署失敗', '任務已保存，重新載入可恢復同一場單挑。'); return }
    this.inventory.prepareForCombat()
    this.notice = '已接受單挑。直接前往單挑場地，Captain 與對手將自行到場。'
    this.closePanel()
  }
  private acceptOutpostRelief(): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.loadChecked().profile
    const next = fresh && acceptCareerOutpostRelief(fresh)
    if (!next) { this.openPanel('無法接受任務', '需完成 Outpost I–III、擁有合法坐騎且沒有進行中的任務。'); return }
    if (!this.commit(next)) return
    const launch = createCareerOutpostLaunch(this.profile)
    this.dispose(true)
    this.onCampaign(launch)
  }

  private acceptOutpost(stageId: CareerOutpostStageId): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    const fresh = this.store.loadChecked().profile
    if (!fresh) { this.openPanel('無法接受任務', '無法讀取 Career profile。'); return }
    const next = acceptCareerOutpost(fresh, stageId)
    if (!next) { this.openPanel('無法接受任務', '任務尚未解鎖或已有任務進行中。'); return }
    if (!this.commit(next)) return
    const launch = createCareerOutpostLaunch(this.profile)
    this.dispose(true)
    this.onCampaign(launch)
  }

  /** NPC riders already belong to the shared grid; duplicating crew as anonymous
   * blockers would stop their own vehicle. Only Player and unoccupied mounts are extra. */
  private siegeMovementBlockers(): import('../world/Terrain').EntityCollisionBody[] {
    const bodies: import('../world/Terrain').EntityCollisionBody[] = []
    const playerMount = this.player.currentMount
    if (!this.player.dead && !playerMount) bodies.push({ position: this.player.position, radius: .42, height: 1.8, bottomOffset: .9 })
    if (playerMount && !playerMount.dead) bodies.push({ position: playerMount.group.position,
      radius: playerMount.combatRadius, height: playerMount.isFlyingMount ? XONGKORO.bodyHeight : 2.6, bottomOffset: 0 })
    for (const mount of this.combatMounts) if (!mount.dead && !mount.disposed && mount !== playerMount && !mount.riderNpc && !mount.riderPlayer)
      bodies.push({ position: mount.group.position, radius: mount.combatRadius,
        height: mount.isFlyingMount ? XONGKORO.bodyHeight : 2.6, bottomOffset: 0 })
    return bodies
  }

  private siegeClosureBodies() {
    const bodies: import('./TownSiegeGateClosure').GateClosureBody[] = []
    const mounts = new Set<Mount>()
    const addMount = (mount: Mount) => {
      if (mounts.has(mount) || mount.dead) return
      mounts.add(mount)
      bodies.push({ position: mount.group.position, radius: 1.5, moveTo: point => {
        const delta = point.clone().sub(mount.group.position)
        mount.group.position.copy(point)
        mount.previousPosition.copy(point)
        mount.skipImpactThisFrame = true
        mount.movementSpeed = 0
        if (mount.riderNpc) mount.riderNpc.group.position.add(delta)
        if (this.player.currentMount === mount) this.player.group.position.add(delta)
      } })
    }
    if (this.player.currentMount) addMount(this.player.currentMount)
    else if (!this.player.dead) bodies.push({ position: this.player.combatPosition, radius: .6, moveTo: point => this.player.group.position.copy(point).add(new THREE.Vector3(0, .9, 0)) })
    for (const npc of this.runtimeCombatActors()) {
      if (npc.dead) continue
      if (npc.mount) addMount(npc.mount)
      else bodies.push({ position: npc.combatPosition, radius: .5, moveTo: point => npc.group.position.copy(point) })
    }
    for (const mount of [...this.mounts, ...this.defense.enemyMounts, ...(this.outskirts?.mounts ?? []), ...(this.enemyEaglePatrol?.mounts ?? []), ...(this.personalSquad?.mounts ?? [])]) addMount(mount)
    return bodies
  }

  private initializeEnemyEaglePatrol(faction: CareerProfile['faction']): void {
    // The external enemy base serializes its own approaches independently of Town/HR pads.
    this.enemyEaglePatrol = new EnemyEaglePatrolController(this.scene, faction,
      () => this.profile, this.world.airspaceObstacles, this.navigation, undefined, undefined,
      !this.ambientEaglePatrolAllowed())
    this.enemyEaglePatrol.restoreCheckpoint(this.profile.enemyEaglePatrols?.[faction])
  }

  private initializePersonalSquad(): void {
    const context = this.sceneContext, profile = this.profile
    const home = context.worldFaction === profile.faction
    const privateEaglePads = this.privateEaglePads = new EaglePadReservations(home ? this.world.eagleTraining.pads : [])
    this.personalSquad = new TownPersonalSquadController(this.scene, this.world.hr, () => this.profile, () => this.player, undefined, {
      canRefit: () => this.canRefitSquad(this.personalSquad?.actors ?? []),
      sceneKey: context.worldFaction === profile.faction ? 'town-home' : `town-enemy:${context.worldFaction}`,
      hasHR: home, eaglePads: privateEaglePads,
      eagleLandingQueue: this.eagleLandingQueue, layoutVersion: home ? TOWN_LAYOUT_VERSION : undefined,
      eaglePadClear: (pad, ownMount) => isEagleLandingClearOfMounts(pad, this.world.obstacles,
        this.combatMounts, ownMount, TOWN_PLAYABLE_WORLD_BOUND),
      formationSlots: (anchor, occupied, count) => personalTownDeployment(anchor, occupied, count,
        TOWN_NAVIGATION_BOUNDS, this.world.obstacles, this.navigation),
      emit: event => this.emitCombatEvent(event),
      onSpawn: npc => { (this.captainPatrol?.active ? this.captainPatrol : this.defense?.active ? this.defense : this.mission)?.registerPersonalActor(npc); this.synchronizeCommandActors() },
    })
  }

  private initializeCareerMounts(): void {
    this.careerMounts = new CareerMountController(
      this.scene,
      () => this.player,
      () => this.profile,
      p => this.commit(p),
      () => this.careerMounts?.activeMount?.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles,
      () => [
        ...this.residents.filter(r => !r.npc.dead).map(r => r.npc.combatPosition),
        ...this.mounts.filter(mount => !mount.dead && (!this.sceneContext.missionOnlyResidents || mount !== this.cat)).map(mount => mount.group.position),
        ...this.mission.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
        ...this.defense.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
        ...(this.personalSquad?.actors ?? []).filter(npc => !npc.dead).map(npc => npc.combatPosition),
        ...(this.personalSquad?.mounts ?? []).filter(mount => !mount.dead).map(mount => mount.group.position),
      ],
      () => this.personalSquad?.sceneKey ?? 'town-home',
      { eaglePads: this.privateEaglePads,
        eagleDeployment: () => this.restoringAerialState && !this.personalSquad?.hasHR
          ? this.privateEaglePads?.get(PLAYER_EAGLE_PAD_OWNER) : undefined },
    )
  }

  private preparePersonalFieldDeployment(saved: CareerProfile['personalSquadRuntime']): void {
    if (!this.personalSquad || this.personalSquad.hasHR) return
    const initial = this.defense instanceof CommanderTownMissionController ? this.defense.initialDeployment : undefined
    if (initial) {
      const owned = new Map(this.profile.personalSquad?.members.map(member => [member.id, member]))
      let ground = 0
      const muster = (saved?.memberIds ?? []).map(id => owned.get(id)?.equipment?.mount === 'xongkoro'
        ? initial.player : initial.personal[ground++])
      this.personalSquad.setMuster(muster, initial.eaglePads)
      return
    }
    const active = this.profile.activeMission, aerial = this.profile.playerAerialState
    // An airborne checkpoint may be above an unwalkable roof. Plan only its reserve
    // pads at the lawful entry; the actual saved Player/squad flight stays authoritative.
    const airborne = aerial?.sceneKey === this.personalSquad.sceneKey
      && (aerial.mount && aerial.mount.flight.phase !== 'grounded' || aerial.fall?.active)
    const entry = airborne && (active?.kind === 'enemy-town-assault' || active?.kind === 'commander-sky-raid'
      || active?.kind === 'commander-decapitation') ? siegeMuster('north', 1)
      : airborne && active?.kind === 'veteran-field' ? veteranPlayerSpawn(active.templateId) : null
    const anchor = entry ? { x: entry.x, z: entry.z, yaw: active?.kind === 'veteran-field' ? veteranPlayerYaw(active.templateId) : 0 }
      : { x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw: this.player.facingYaw }
    const official = (this.defense.active ? this.defense.deploymentPositions : this.mission.deploymentPositions)
      .filter(point => Math.hypot(point.x - anchor.x, point.z - anchor.z) < 110)
    const pads = personalTownEagleDeployment(anchor, official, careerItemTotal(this.profile, 'xongkoro') > 0 ? MAX_PLAYER_OWNED_XONGKORO : 0,
      TOWN_NAVIGATION_BOUNDS, this.world.obstacles, this.navigation)
    const landingObstacles = pads.map(pad => ({ box: eagleLandingFootprint(pad), isBarricade: false }))
    const muster = personalTownDeployment(anchor, official, saved?.memberIds.length ?? this.profile.personalSquad?.members.length ?? 0,
      TOWN_NAVIGATION_BOUNDS, [...this.world.obstacles, ...landingObstacles], this.navigation)
    this.personalSquad.setMuster(muster, pads)
  }

  private async restoreActiveCareerMission(): Promise<void> {
    let { profile } = this
    // Capture scenery batches before starting the official mission. Waiting for
    // these preserves ordinary Town entry; mission jobs continue under frame().
    const backgroundBatches = [...this.mission.spawnBatches, ...(this.outskirts?.batches ?? []), ...(this.enemyEaglePatrol?.batches ?? [])]
    const waitForBackground = async () => {
      for (const batch of backgroundBatches) {
        if (batch.status === 'pending' || batch.status === 'failed')
          await gameplayNpcSpawns.wait(batch)
      }
    }
    if (profile.activeMission) {
      if ((profile.activeMission.kind === 'cavalry-sweep' || profile.activeMission.kind === 'veteran-field')
        && (profile.activeMission.phase !== 'ASSEMBLING' || profile.activeMission.templateId === 'veteran-tragedy-of-the-scouts')) {
        const saved = profile.activeMission.mountedMarchPosition
        const anchor = saved ? new THREE.Vector3(saved.x, 0, saved.z) : undefined
        const position = profile.activeMission.kind === 'veteran-field' ? veteranPlayerSpawn(profile.activeMission.templateId, anchor) : sweepPlayerSpawn(anchor)
        position.y = getTerrainHeight(position.x, position.z) + .9
        this.player.group.position.copy(position)
        const yaw = profile.activeMission.kind === 'veteran-field' ? veteranPlayerYaw(profile.activeMission.templateId) : SWEEP_YAW
        this.player.faceDirection(Math.sin(yaw), Math.cos(yaw))
      }
      if (profile.activeMission.kind === 'captain-patrol-command') {
        this.captainPatrol?.resume()
      } else if (profile.activeMission.kind === 'duel') {
        this.duel.startActiveMission()
      } else if (profile.activeMission.kind === 'town-defense' || profile.activeMission.kind === 'commander-four-gate-defense' || profile.activeMission.kind === 'enemy-town-assault'
        || profile.activeMission.kind === 'commander-sky-raid' || profile.activeMission.kind === 'commander-decapitation') {
        if (!profile.activeMission.result || profile.activeMission.phase === 'RETURNING') {
          this.siegeOpeningPending = Boolean(profile.activeMission.kind === 'enemy-town-assault'
            && profile.activeMission.siege && !profile.activeMission.siege.rosterCreated)
          this.defense.startActiveMission()
        }
      } else {
        this.mission.startActiveMission()
      }
      await waitForBackground()
      profile = this.profile
      const active = profile.activeMission!
      if (active.kind === 'captain-patrol-command') {
        for (const actor of this.mission.ambientBandits) {
          const saved = active.patrolAmbient?.members?.[actor.combatantId]
          if (saved) restoreCommandActor(actor, saved)
        }
        this.captainPatrol?.setEligibleTargets([...this.mission.ambientBandits, ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? [])])
      }
      if (!active.result || active.phase === 'RETURNING') this.inventory.prepareForCombat()
      this.preparePersonalFieldDeployment(active.personalSquad)
      const siegeAnchor = active.kind === 'enemy-town-assault' || active.kind === 'commander-sky-raid'
        || active.kind === 'commander-decapitation' || active.kind === 'town-defense' && active.siege?.playerPosition
        ? this.player.combatPosition.clone() : null
      const siegeHeading = this.player.facingYaw
      this.careerMounts.restoreActiveMount(!(this.defense instanceof CommanderTownMissionController && this.defense.initialDeployment))
      if ((active.kind === 'cavalry-sweep' || active.kind === 'veteran-field') && this.player.currentMount) {
        this.player.currentMount.group.rotation.y = active.kind === 'veteran-field' ? veteranPlayerYaw(active.templateId) : SWEEP_YAW
      }
      if (active.kind === 'enemy-town-assault' || active.kind === 'commander-sky-raid'
        || active.kind === 'commander-decapitation') {
        if (!active.result && !active.playerDead && !active.mountState && profile.selectedMountId) this.careerMounts.activate(profile.selectedMountId)
      }
      if (this.defense instanceof CommanderTownMissionController || this.defense instanceof CommanderFourGateDefenseController) this.defense.preparePlayerDeployment()
      if (siegeAnchor && this.player.currentMount && !this.player.currentMount.isFlyingMount) {
        const mount = this.player.currentMount
        mount.group.position.set(siegeAnchor.x, getTerrainHeight(siegeAnchor.x, siegeAnchor.z), siegeAnchor.z)
        this.player.faceDirection(Math.sin(siegeHeading), Math.cos(siegeHeading))
        this.player.syncMountTransform()
      }
      if ((active.kind === 'veteran-field' || active.kind === 'commander-sky-raid'
        || active.kind === 'commander-decapitation' || active.kind === 'commander-four-gate-defense') && !active.playerDead) {
        if (active.playerHp !== undefined) this.player.setHp(active.playerHp)
        if (active.playerStamina !== undefined) this.player.setStamina(active.playerStamina)
      }
      if (active.playerDead || active.result?.stats.survived === false) {
        this.player.dismountFromMount()
        this.player.takeDamage(this.player.maxHp * 100, this.hp)
      }
      this.restorePersonalSquad(active.personalSquad)
    } else {
      await waitForBackground()
      this.restoreRetirementPlayer()
      this.restorePersonalSquad(profile.personalSquadRuntime)
      if (profile.careerRetirement?.phase !== 'final-stand' && profile.playerAerialState?.sceneKey === this.personalSquad?.sceneKey) this.careerMounts.restoreActiveMount()
    }
    const aerialSceneKey = this.personalSquad?.sceneKey ?? 'town-home'
    const initialDecapitation = this.defense instanceof CommanderTownMissionController && this.defense.initialDeployment
    if (!initialDecapitation && this.profile.activeMission?.kind !== 'commander-four-gate-defense' && profile.playerAerialState?.sceneKey === aerialSceneKey && profile.playerAerialState.dead && !this.player.dead) {
      this.player.takeDamage(this.player.maxHp * 100, this.hp)
    }
    if (!initialDecapitation && this.profile.activeMission?.kind !== 'commander-four-gate-defense')
      restoreCareerAerialState(this.player, this.careerMounts.activeMount, profile.playerAerialState, aerialSceneKey)
    this.restoringAerialState = false
    this.applyRetirementDeparture()
  }

  /** Entry/reload owns Loading. In-place mission acceptance never calls this
   * barrier, so home defense keeps the existing free-movement spawn flow.
   * Only batches already declared at entry belong to the initial roster. */
  private async waitForInitialMissionDeployment(progress: (text: string) => void = () => {}): Promise<void> {
    const initial = [...this.mission.spawnBatches, ...this.defense.spawnBatches]
    for (const batch of initial) await gameplayNpcSpawns.wait(batch,
      (done, total) => progress(`部署開場部隊 ${done} / ${total}…`))
    await this.personalSquad?.waitForSpawns()
    if (this.defense instanceof CommanderTownMissionController) this.defense.completeInitialDeployment()
  }

  private restorePersonalSquad(saved: CareerProfile['personalSquadRuntime']): void {
    if (!saved || !this.personalSquad) return
    if (this.personalSquad.hasHR && !this.profile.activeMission && !this.profile.activeOutpostMission
      && !this.profile.careerRetirement) saved = placePersonalMissionAtHR(saved,
      { muster: this.world.hr.muster, eaglePads: this.world.eagleTraining.pads,
        padForMember: id => this.privateEaglePads?.get(id) })
    if (this.personalSquad.hasHR) saved = migratePersonalTownLayout(saved, this.personalSquad.sceneKey,
      { muster: this.world.hr.muster, eaglePads: this.world.eagleTraining.pads,
        padForMember: id => this.privateEaglePads?.get(id) })!
    if (saved.sceneKey !== this.personalSquad.sceneKey && this.personalSquad.hasHR) {
      const anchor = { x: this.player.combatPosition.x, z: this.player.combatPosition.z, yaw: this.player.group.rotation.y }
      const official = this.defense.active ? this.defense.deploymentPositions : this.mission.deploymentPositions
      this.personalSquad.setMuster(personalTownDeployment(anchor, official, saved.memberIds.length,
        TOWN_NAVIGATION_BOUNDS, this.world.obstacles, this.navigation))
    }
    this.personalSquad.restoreMission(saved)
  }
  private playMissionVoice(cue: CareerMissionVoiceCue): void {
    sound ??= new SoundManager()
    sound.playCareerMissionVoice(this.profile.faction, cue)
  }
  private async playTownDefenseAlert(): Promise<void> {
    const missionId = this.profile.activeMission?.id
    const played = await (sound ??= new SoundManager()).playTownAlarm(true)
    if (played && !this.disposed && this.profile.activeMission?.id === missionId) this.playMissionVoice('townDefense')
  }
  private acceptMission(templateId: string): void {
    if (this.player.dead || !this.serviceAvailable('deployment')) return
    if (getCaptainMissionDefinition(templateId)) { this.acceptCaptainMission(templateId); return }
    if (getVeteranMissionDefinition(templateId)) { this.acceptVeteranCareerMission(templateId); return }
    const fresh = this.store.load()
    const template = availableRecruitMissions(fresh ?? this.profile).find(candidate => candidate.id === templateId)
    if (!fresh || !template) { this.openPanel('無法接受任務', '生涯存檔已變更，請重新與士官長交談。'); return }
    if (fresh.activeMission || this.event.hostile || fresh.townEvent?.state === 'hostile') { this.openPanel('無法接受任務', '目前已有任務或小鎮處於敵對狀態。'); return }
    if (this.player.dead) { this.openPanel('無法接受任務', '你目前仍在另一場交戰中。'); return }
    if (template.kind === 'cavalry-sweep') {
      const next = acceptCavalrySweep(fresh, undefined, selectMissionCavalryActorIds(this.residents, 59, this.unavailableTownCavalryActorIds()))
      if (!next || !this.commit(next)) return
      if (!this.mission.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，重新載入後可恢復同一支騎兵隊伍。'); return }
      this.careerMounts.activate(next.selectedMountId!)
      this.inventory.prepareForCombat()
      this.closePanel()
      return
    }
    if (template.kind === 'enemy-town-assault') {
      const next = acceptEnemyTownAssault(fresh)
      if (!next) { this.openPanel('無法接受任務', '需先完成 Outpost Relief · 騎兵救援 Victory，且沒有其他任務或小鎮敵對事件。'); return }
      if (!this.commit(next)) return
      this.dispose(); this.onRestart(this.profile)
      return
    }
    if (template.kind === 'town-defense') {
      const defenders = townAssaultObjectiveRoster(this.residents.map(r => r.spec)).map(spec => spec.id)
      const civilians = this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.spec.id)
      const mission = createTownDefenseMission(defenders, civilians, undefined, template.id, fresh.rank)
      const next = cloneCareerProfile(fresh); next.activeMission = mission
      if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
      this.startHomeDefense()
      return
    }
    const preferredCamp = template.kind === 'patrol' ? patrolPreferredCamp(template.routeId) : template.preferredCampIndex
    const campId = this.mission.chooseCamp(preferredCamp)
    if (campId === null) { this.openPanel('地區暫時無法接取', '附近營地仍在交戰，請先脫離戰鬥或稍後選擇其他任務。'); return }
    const mission = this.mission.createMission(template, campId, this.unavailableTownCavalryActorIds())
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
    if (!this.mission.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，但隊伍無法建立。重新載入後可用同一個 missionId 恢復。'); return }
    this.inventory.prepareForCombat()
    this.notice = `已接受 ${template.name}。前往兵營外集合。`
    this.playMissionVoice('missionAccepted')
    this.closePanel()
  }
  private startHomeDefense(): void {
    // Acceptance has already durably refitted the eligible command roster.
    // Apply it in this scene before the defense controller borrows those actors.
    if (this.profile.rank !== 'commander') this.townCommand?.applyRefit(this.profile.townCommandSquad)
    this.siegeOpeningPending = !this.profile.activeMission?.siege?.rosterCreated
    if (!this.defense.startActiveMission()) {
      this.openPanel('任務部署失敗', '任務已保存，重新載入可恢復同一場守城。')
      return
    }
    this.inventory.prepareForCombat()
    this.synchronizeCommandActors()
    this.closePanel()
  }
  private unavailableTownCavalryActorIds(refitTownCommand = false): ReadonlySet<string> {
    return new Set(this.residents.filter(({ spec }) => this.patrol && !this.patrol.isReserveAvailable(spec.id)
      || !refitTownCommand && this.townCommand && !this.townCommand.isReserveAvailable(spec.id))
      .map(({ npc }) => npc.combatantId))
  }
  private async acceptCareerPromotion(npcRole: CareerAppointingRole): Promise<boolean> {
    const authorized = () => canAppointCareerRank(this.profile, npcRole)
      && this.residents.some(resident => resident.spec.id === npcRole && resident.spec.role === npcRole && !resident.npc.dead)
      && this.serviceAvailable(npcRole)
      && !this.player.dead && !this.player.isFalling && !this.player.currentMount?.isAirborne && !this.event.hostile
    if (this.promotionAttempt || this.disposed || !authorized()) return false
    const next = promoteCareer(this.profile)
    if (!next) return false
    const attempt = {}; this.promotionAttempt = attempt
    const panel = this.panel, rank = this.profile.rank, faction = this.profile.faction
    const stillCurrent = () => this.promotionAttempt === attempt && !this.disposed && this.panel === panel
      && this.profile.rank === rank && this.profile.faction === faction && authorized()
    try {
      const hero = resolveCareerHeroAsset(next)
      if (hero && hero !== this.player.heroAssetId) await HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[hero].descriptor)
      if (!stillCurrent()) return false
      // Re-read live progress after loading rather than overwriting changes with the initial snapshot.
      const fresh = promoteCareer(this.profile)
      return fresh ? this.applyCareerPlayerIdentity(fresh) : false
    } catch (error) {
      if (stillCurrent()) this.notice = `任命尚未完成，原有角色與軍階已保留。請重試。${error instanceof Error ? `（${error.message}）` : ''}`
      return false
    } finally {
      if (this.promotionAttempt === attempt) this.promotionAttempt = null
    }
  }

  private applyCareerPlayerIdentity(profile: CareerProfile): boolean {
    const hero = resolveCareerHeroAsset(profile)
    if (this.player.heroAssetId === hero && this.player.characterTier === resolveCareerCharacterTier(profile)) return this.commit(profile)
    const old = this.player
    const position = old.group.position.clone()
    const facing = old.facingYaw
    const mount = old.currentMount
    const mountHeading = mount?.group.rotation.y
    const oldOrbit = this.orbit
    // Build away from the live scene; failed creation leaves the original actor usable.
    const stagingScene = new THREE.Scene()
    setScenePlayableWorldBound(stagingScene, getScenePlayableWorldBound(this.scene))
    const candidate = new Player(stagingScene, profile.faction, hero, resolveCareerOrdinaryTier(profile))
    let committed = false
    try {
      this.bindBlockingProgression(candidate)
      const newMaxHp = resolveCareerPlayerMaxHp(profile, DEFAULT_PLAYER_MAX_HP)
      candidate.setMaxHp(newMaxHp, true)
      candidate.group.position.copy(position)
      candidate.faceDirection(Math.sin(facing), Math.cos(facing))
      candidate.setHp(preserveHpRatio(old.hp, old.maxHp, newMaxHp))
      candidate.setStamina(old.staminaValue)
      candidate.setArrowCount(old.arrowCount)
      candidate.onPlayerDeath = () => this.enterMissionObserver()
      candidate.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, true, false, event.visualKind)
      candidate.update(0, this.input, oldOrbit.cameraYaw, oldOrbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
      candidate.shield.restoreDurability(old.shield.captureDurability())
      candidate.shieldCollider.refreshVisibility()
      if (mount) {
        old.dismountFromMount({ preserveWorldPosition: true })
        candidate.mountVehicle(mount, mountHeading)
        if (candidate.currentMount !== mount) throw new Error('坐騎交接失敗')
      }
      candidate.group.position.copy(position)
      candidate.faceDirection(Math.sin(facing), Math.cos(facing))
      this.player = candidate
      oldOrbit.followPlayer(candidate)
      this.scene.add(candidate.group)
      if (!this.commit(profile)) return false
      committed = true
      old.dispose()
      this.hp.setFill(candidate.hpRatio)
      return true
    } finally {
      if (!committed) {
        if (candidate.currentMount) candidate.dismountFromMount({ preserveWorldPosition: true })
        if (mount && old.currentMount !== mount) old.mountVehicle(mount, mountHeading)
        old.group.position.copy(position)
        old.faceDirection(Math.sin(facing), Math.cos(facing))
        this.player = old
        oldOrbit.followPlayer(old)
        candidate.dispose()
      }
    }
  }
  private finishMission(outcome: CareerMissionOutcome): void {
    if (this.captainPatrol?.active) { this.captainPatrol.persist(true); this.captainPatrol.freezeStats() }
    else if (this.defense?.active) this.defense.freezeStats()
    else if (!this.duel?.active) this.mission?.freezeStats()
    const finished = this.missionSettlement.finish(outcome)
    if (finished.status === 'ignored') return
    if (finished.status === 'save-failed') {
      this.missionResultOpen = true
      const panel = this.openPanel('任務結算尚未保存', '保存失敗；軍功尚未入帳，任務結果已保留在目前場景。')
      this.button(panel, '重試保存結算', () => this.finishMission(outcome))
      return
    }
    this.temporaryMounts.cleanup()
    this.openMissionResult(finished.result, false)
  }
  private openMissionResult(result: CareerMissionResult, _reloaded: boolean): void {
    this.missionResultOpen = true
    const complete = result.outcome === 'victory'
    const merit = result.merit
    const defenseText = result.defense ? `\n\nCivilians\nSurvived ${result.defense.civilianSurvived}\nDeaths ${result.defense.civilianDeaths}` : ''
    const combined = result.meritStats ? `\n\n玩家與授權部隊軍功貢獻\nDamage ${Math.round(result.meritStats.damageDealt)}\nKills ${result.meritStats.kills}\nStructure damage ${Math.round(result.meritStats.structureDamage)}\nGate breaches ${result.meritStats.gateBreaches}` : ''
    const zeroMeritReason = merit.total !== 0 ? '' : (result.meritStats ?? result.stats).damageDealt > 0
      ? `\n\n有效傷害未達 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點軍功門檻；本次軍功為 0。`
      : '\n\n本次未對任務目標造成有效貢獻。個人軍功：0'
    if (this.profile.activeMission?.duelTutorialCareerId) {
      const panel = this.openPanel(complete ? '新兵切磋 · 勝利' : '新兵切磋 · 練習結束',
        `本次已保存獎勵 ${merit.total} 軍功。教學獎勵每個角色只領一次。\n之後可找士官長 → 1v1，選擇兵種並依序挑戰 T1–T5。\n接下來向士官長了解目前軍階的正式戰鬥任務。`)
      this.button(panel, `返回 ${townName(this.profile.faction)}`, () => this.returnToTown('direct'))
      return
    }
    const panel = this.openPanel(result.defense ? `Town Defense · ${complete ? 'SUCCESS' : 'FAILURE'}` : complete ? 'MISSION COMPLETE' : 'MISSION FAILED', `玩家統計 PLAYER\nDamage ${Math.round(result.stats.damageDealt)}\nKills ${result.stats.kills}\nSurvived ${result.stats.survived ? 'Yes' : 'No'}${defenseText}${combined}\n\nMilitary Merit\n每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功\nDamage merit ${merit.damage}\nKill merit ${merit.kills}\nMission contribution merit ${merit.contribution}\nTotal ${merit.total}${zeroMeritReason}`)
    this.button(panel, this.profile?.activeMission?.kind === 'captain-patrol-command' ? '直接返回城鎮' : `返回 ${townName(this.profile.faction)}`, () => this.returnToTown('direct'))
    if (this.profile?.activeMission?.kind === 'captain-patrol-command') {
      if (complete && result.stats.survived) this.button(panel, '跟隊伍走回去', () => {
        if (!this.captainPatrol?.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
        this.clearMissionCombatShots()
        this.missionResultOpen = false; this.closePanel(); this.updateCaptainPatrolGuide()
      })
      this.updateCaptainPatrolGuide()
      return
    }
    if (this.profile?.activeMission?.kind === 'duel') {
      if (complete && result.stats.survived) this.button(panel, '跟隊長返回市政廳', () => {
        if (!this.duel.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
        this.clearMissionCombatShots()
        this.missionResultOpen = false
        this.closePanel()
      })
      return
    }
    if (!result.defense && this.profile?.activeMission?.kind !== 'enemy-town-assault'
      && !isCommanderTownMission(this.profile?.activeMission)
      && !isCareerEnemyTerritoryFieldMission(this.profile?.activeMission) && complete && result.stats.survived) this.button(panel, this.mission.friendlies.some(npc => !npc.dead) ? '跟隊伍走回去' : '自行走回小鎮', () => {
      if (this.mission.phase === 'RETURNING') return
      if (!this.mission.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
      if (this.mission.friendlies.some(npc => !npc.dead)) this.playMissionVoice('return')
      this.missionResultOpen = false
      this.closePanel()
    })
  }
  private clearMissionCombatShots(): void {
    for (const shot of this.shots ?? []) shot.arrow.destroy()
    this.shots = []
  }
  private restPlayerInTown(): void {
    this.temporaryMounts.cleanup()
    this.careerMounts.restInTown()
    this.inventory.sheathAll()
    this.player.restoreForTown()
    if (this.townRefitOnReturn) {
      this.townCommand?.applyRefit(this.profile.townCommandSquad)
      this.townRefitOnReturn = false
      this.townCommand?.grant()
    }
    if (this.spectator) {
      this.spectator = null
      document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · 滾輪 換裝 · 右鍵 舉盾／瞄準 · Tab 裝備 · E 交談 · Q 關閉面板 · Esc 暫停／上一頁'
      this.orbit.update(this.input, 0.016, this.world?.obstacles ?? [])
    }
    this.hp.setFill(1)
    this.stamina.setFill(1)
    this.quiver.setArrowCount(this.player.arrowCount)
  }
  private cancelPendingSpawns(): void {
    this.residentSpawnBatch?.cancel()
    for (const batch of [...(this.mission?.spawnBatches ?? []), ...(this.defense?.spawnBatches ?? []), ...(this.outskirts?.batches ?? []), ...(this.enemyEaglePatrol?.batches ?? [])]) batch.cancel()
    this.personalSquad?.cancelPendingSpawns()
  }
  private returnToTown(intent: 'direct' | 'arrived'): void {
    if (intent === 'direct' && !this.captainPatrol?.active) this.cancelPendingSpawns()
    const returned = this.missionSettlement.returnToTown(intent)
    if (returned.status === 'ignored' || returned.status === 'restarted') return
    if (returned.status === 'save-failed') {
      const message = returned.destination === 'defense' ? '守城結算仍安全保留。請重試，軍功不會重複發放。'
        : returned.destination === 'party' ? '隊伍已返抵小鎮，但任務結算尚未寫入。請重試，軍功不會重複發放。'
        : '任務結算仍安全保留。請重試保存後返回小鎮。'
      const panel = this.openPanel('返回狀態尚未保存', message)
      this.button(panel, returned.destination === 'restart' ? '重試返回小鎮' : '重試原地結算', () => this.returnToTown(intent))
      return
    }
    this.missionResultOpen = false
    this.target = null
    this.hasPreviousTip = false
    this.notice = returned.kind === 'defense' ? '守城結束。駐軍與居民已歸位，城鎮服務恢復。'
      : returned.kind === 'sweep' ? '清剿結束。駐軍已返營，臨時騎兵正在離開。'
      : '隊伍已整隊返營。駐軍歸位，馬廄與城鎮服務已恢復。'
    if (this.panel) this.closePanel()
    this.updateCaptainPatrolGuide()
    if (returned.kind === 'defense') {
      this.outskirts?.resumeAfterSiege()
      void this.ensureTownCommanderAfterReturn()
    }
  }
  private async ensureTownCommanderAfterReturn(): Promise<void> {
    if (this.disposed || this.commanderReturnPending || !shouldSpawnTownCommander(this.profile)) return
    const existing = this.residents.find(resident => resident.spec.id === 'commander')
    if (existing) {
      restoreMissionReturnResident(existing, npc => this.missionCombat.releaseExternalThreat(npc))
      return
    }
    this.commanderReturnPending = true
    try {
      await HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[townCommanderHeroAsset(this.profile.faction)].descriptor)
      if (this.disposed || !shouldSpawnTownCommander(this.profile)) return
      this.navigation.sync(this.world.obstacles)
      const spec = townCommanderSpec(resolveTownCommanderPosition(this.world.obstacles, this.world.roads, this.navigation, this.residents.map(resident => resident.spec)))
      const entries = careerTownSceneRoster(this.profile, [spec])
      await this.initializeResidents(entries, this.sceneContext, () => {}, true)
      this.residentRoster.push(...entries)
      this.townCommand?.grant()
    } catch (error) {
      if (this.disposed || !shouldSpawnTownCommander(this.profile)) return
      this.notice = `指揮官尚未返回，其他城鎮服務不受影響。${error instanceof Error ? error.message : String(error)}`
      const panel = this.openPanel('指揮官返回失敗', this.notice)
      this.button(panel, '重試指揮官返回', () => { this.closePanel(); void this.ensureTownCommanderAfterReturn() })
    } finally { this.commanderReturnPending = false }
  }
  private serviceAvailable(id: string): boolean {
    if (this.sceneContext.missionOnlyResidents || !areOrdinaryTownServicesPeaceful(this.profile, this.event.hostile)) return false
    if (id === 'merchant' && this.civilianCommand?.returningActorIds.includes(id)) return false
    if (id === 'commander' && !this.residents.some(resident => resident.spec.id === id)) return false
    if (this.duel?.active && (id === 'captain' || id === 'commander' || id === 'ranger' || id === 'cat')) return false
    if (this.defense?.servicesLocked) return false
    if (id === 'captain' && this.mission?.missionLeader) return false
    if (this.event.allActors.get(id)?.dead) return false
    const building = id === 'hr-officer' ? 'hr-center' : id === 'merchant' ? 'weapons' : id === 'ranger' || id === 'cat' ? 'stable' : null
    return !building || !this.world.buildings.find(b => b.id === building)?.hp.destroyed
  }
  /** Persist before applying the first effective hit; failure leaves the target unchanged. */
  private prepareDamage(): boolean {
    if (!canStartOrdinaryTownHostility(this.profile)) return false
    if (this.event.hostile) return true
    const active = this.profile.activeMission
    if (this.defense?.active) return false
    const p = active ? clearCareerMission(this.profile, active.id) : cloneCareerProfile(this.profile)
    const command = this.townCommand?.checkpoint() ?? p.townCommandSquad
    if (command && (p.rank === 'captain' || p.rank === 'commander')) p.townCommandSquad = { ...command, authorized: true }
    p.townEvent = { id: crypto.randomUUID(), state: 'hostile',
      authorizedTownCommandActorIds: p.townCommandSquad?.authorized ? [...p.townCommandSquad.actorIds] : [] }
    if (!this.commit(p)) return false
    if (active) {
      this.temporaryMounts.cleanup()
      if (active.kind === 'captain-patrol-command') this.captainPatrol?.release()
      else if (active.kind === 'duel') this.duel.cleanupMission()
      else this.mission.cleanupMission(active.targetCampId)
      this.clearMissionCombatShots()
      this.missionResultOpen = false
    }
    return true
  }
  private activateHostility(shout = true): void {
    if (!canStartOrdinaryTownHostility(this.profile)) return
    if (this.event.hostile) return
    this.event.hostile = true
    this.event.excludeAuthorizedActors(this.profile.townEvent?.authorizedTownCommandActorIds ?? [])
    // A real hit must not cancel the current swing or clear held movement / Shift keys.
    if (this.panel || this.equipment.visible) this.closePanel()
    this.notice = '全鎮反擊！所有服務停止。'
    this.patrol?.stopForHostility()
    const loyal = new Set(this.profile.townEvent?.authorizedTownCommandActorIds ?? [])
    for (const r of this.residents) {
      if (loyal.has(r.spec.id)) { r.npc.setTownPeaceful(); r.npc.setCommandAllegiance(Faction.PLAYER) }
      else r.npc.beginTownHostility()
    }
    this.townCommand?.beginHostility()
    const speaker = this.residents.find(r => r.spec.role === 'captain' && !r.npc.dead) ?? this.residents.find(r => !r.npc.dead && !isCivilian(r.spec.role))
    this.chargeSpeakerId = speaker?.spec.id ?? null
    if (shout && speaker) sound.playCommanderCommand(this.profile.faction, 'charge')
  }
  private refreshCombatMounts(): void {
    this.combatMountGrid.clear()
    this.combatMounts.length = 0
    const seen = new Set<Mount>()
    const owned = this.careerMounts?.activeMount
    const active = this.profile.activeMission
    const combatActive = !this.result && (this.retirementFinale?.active || this.event?.hostile || Boolean(active && !active.result && active.phase !== 'RETURNING'))
    const combatId = active?.id ?? this.profile.townEvent?.id ?? 'field'
    if (combatActive) for (const resident of this.residents ?? []) {
      // T5 borrows the Commander only; its parked service mount never becomes duel loot.
      if (active?.kind === 'duel' && active.duelTier === 5 && resident.spec.id === 'commander') continue
      const mount = resident.homeMount
      if (resident.npc.dead && mount && !mount.dead && mount !== owned
        && !resident.spec?.eagle && mount !== this.cat && !(this.stableHorses ?? []).includes(mount)) this.temporaryMounts.track(mount, combatId)
    }
    const add = (mount: Mount | null | undefined, battlefield = false): void => {
      if (!mount || mount.disposed || !mount.group.visible || seen.has(mount)) return
      seen.add(mount)
      if (combatActive && battlefield && !this.mounts.includes(mount) && mount !== owned && !mount.reservedForTown) {
        this.temporaryMounts.track(mount, combatId)
      }
      this.combatMounts.push(mount)
      if (!mount.dead) this.combatMountGrid.insert(mount)
    }
    for (const mount of this.mounts ?? []) add(mount)
    for (const mount of this.mission?.battlefieldMounts ?? []) add(mount, true)
    for (const mount of this.defense?.enemyMounts ?? []) add(mount, true)
    for (const mount of this.duel?.allMounts ?? []) add(mount, true)
    for (const mount of this.race?.allMounts ?? []) add(mount)
    // Outskirts mounts keep their controller's lifetime, independently of mission settlement.
    for (const mount of this.outskirts?.mounts ?? []) add(mount)
    for (const mount of this.enemyEaglePatrol?.mounts ?? []) add(mount)
    for (const mount of this.personalSquad?.mounts ?? []) add(mount)
    for (const mount of this.temporaryMounts.all) add(mount)
    add(owned)
    this.enemyEaglePatrol?.setLandingOccupants(this.combatMounts)
    for (const npc of [...(this.residents ?? []).map(r => r.npc), ...(this.mission?.fieldNpcs ?? []), ...(this.mission?.ambientBandits ?? []), ...(this.defense?.fieldNpcs ?? []), ...(this.duel?.fieldNpcs ?? []), ...(this.race?.actors ?? []), ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? []), ...(this.personalSquad?.actors ?? [])]) {
      npc.combatMountGrid = this.combatMountGrid
    }
  }
  private isRetirementEvacuating(npc: NPC): boolean {
    return Boolean(this.outskirts?.isRetirementEvacuating(npc)
      || this.enemyEaglePatrol?.isRetirementEvacuating(npc) || this.mission?.isRetirementEvacuating(npc))
  }

  private hitBattlefieldMount(mount: Mount, amount: number, method: CombatDamageMethod, source?: NPC, contact?: CombatContact, sourceRef?: CombatActorRef): void {
    if (this.retirementFinale?.frozen || this.fourGateCombatHeld || source && this.isRetirementEvacuating(source)) return
    if (this.defense?.phase === 'PREPARING' && (source?.combatOwnership === 'player-personal' || this.personalSquad?.mounts.includes(mount))) return
    if (mount.dead || mount.disposed || amount <= 0) return
    if (!this.retirementFinale?.active && !this.profile.activeMission && !this.event?.hostile && this.mounts.includes(mount) && !source) {
      this.hitResident(mount, amount, method, contact)
      return
    }
    if (!this.canHitTownMount(mount, source)) return
    const rider = mount.riderNpc
    const playerMountHit = mount === this.player.currentMount
    const result = damageMount(mount, amount, {
      contact, source: sourceRef ?? (source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player)), method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined
        : (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: event => {
        if (rider) this.missionCombat?.notePlayerContact(rider, event)
        this.emitCombatEvent(event)
      },
    })
    if (result.appliedDamage > 0 && rider && !this.isRetirementEvacuating(rider)) {
      this.outskirts?.noteHit(rider, !source)
      this.enemyEaglePatrol?.noteHit(rider, !source)
      this.missionCombat?.noteExternalHit(rider, source)
    }
    if (source && playerMountHit && result.appliedDamage > 0) this.missionCombat?.noteExternalPlayerHit(source)
    if (!source && result.appliedDamage > 0) {
      this.awardCareerSkillXp(method, result.appliedDamage, contact?.attackSource === 'xongkoro' ? 'mountedImpact' : undefined)
      this.damageNumbers.spawn(result.appliedDamage, mount.group.position.clone().add(new THREE.Vector3(0, 1, 0)))
      this.showCombatTarget(result.targetName, result.hpRatio)
    }
    if (result.hitSuccess) {
      if (method === 'projectile') sound?.playProjectileImpact(mount.currentLod, !source)
      else sound?.playSwordHit(mount.currentLod, !source)
    }
    if (mount === this.cat && mount.dead && this.event.hostile) this.persistCasualties()
  }
  private showCombatTarget(name: string, ratio: number): void {
    this.combatTargetHud.show(name, ratio)
  }
  private updateMountHud(): void {
    if (typeof document === 'undefined') return
    const mount = this.player.isMounted ? this.player.currentMount : null
    const hud = document.getElementById('mount-hud'), label = document.getElementById('mount-name'), fill = document.getElementById('mount-hp-fill')
    hud?.classList?.toggle('visible', Boolean(mount && !mount.dead && !this.player.dead))
    if (mount) {
      if (label) label.textContent = `坐騎：${mount.displayName}`
      if (fill) fill.style.width = `${Math.max(0, mount.currentHp / mount.maxHp * 100)}%`
    }
  }
  private get townServiceMounts(): Mount[] {
    return isCareerEnemyTerritoryFieldMission(this.profile?.activeMission) ? [] : [...(this.cat ? [this.cat] : []), ...(this.stableHorses ?? [])]
  }
  /** A formal Commander cannot accidentally create a new hostile event in their own peaceful Town. */
  private get commanderProtectsOwnTown(): boolean {
    return this.profile?.rank === 'commander'
      && (this.sceneContext?.worldFaction ?? this.world?.faction) === this.profile.faction
      && !this.sceneContext?.missionOnlyResidents
      && !this.profile.activeRace && !this.profile.activeMission && !this.profile.activeOutpostMission
      && this.profile.careerRetirement?.phase !== 'final-stand'
      && this.profile.townEvent?.state !== 'hostile' && !this.event?.hostile
  }
  private isProtectedTownAlly(target: NPC | Mount): boolean {
    const owner = target instanceof NPC ? target : target.riderNpc
      ?? (this.residents ?? []).find(resident => resident.homeMount === target)?.npc
      ?? this.outskirts?.actors.find(actor => actor.combatantId === target.combatOwner?.actorId)
    if (this.duel?.active && owner === this.duel.opponent) return !this.duel.canDamageOpponent(target)
    if (this.commanderProtectsOwnTown && (target instanceof NPC
      ? (this.residents ?? []).some(resident => resident.npc === target)
      : target === this.cat || (this.stableHorses ?? []).includes(target)
        || (this.residents ?? []).some(resident => resident.homeMount === target))) return true
    if (owner && this.personalSquad?.owns(owner)) return true
    if (owner && (this.townCommand?.authorizedActorIds.includes(owner.combatantId)
      || this.profile.activeMission?.officialSquad?.actorIds.includes(owner.combatantId))) return true
    if (target instanceof Mount && this.personalSquad?.mounts.includes(target)) return true
    if (owner && this.enemyEaglePatrol?.owns(owner)) return !owner.hostileToPlayer
    if (owner && this.outskirts?.owns(owner)) return !owner.hostileToPlayer
    if (this.duel?.active && owner && this.duel.isMissionActor?.(owner)) return true
    if (this.duel?.active && owner && !owner.hostileToPlayer && (this.residents ?? []).some(resident => resident.npc === owner
      && (resident.spec.duty === 'patrol' || resident.spec.duty === 'gate_guard' || resident.spec.duty === 'training' || resident.spec.duty === 'eagle_garrison'))) return true
    if (isCareerEnemyTerritoryFieldMission(this.profile?.activeMission) && (target === this.cat || (this.stableHorses ?? []).includes(target as Mount))) return true
    const active = this.profile?.activeMission
    if (active?.kind === 'town-defense' || active?.kind === 'commander-four-gate-defense' || active?.kind === 'enemy-town-assault') {
      if (target instanceof NPC) return target.faction !== Faction.ENEMY && target.faction !== Faction.BANDIT
      return target === this.cat || (this.stableHorses ?? []).includes(target)
        || (this.residents ?? []).some(resident => resident.homeMount === target)
    }
    const ally = target instanceof NPC
      ? target
      : target.riderNpc ?? (this.residents ?? []).find(resident => resident.homeMount === target)?.npc
    return Boolean(ally && (this.mission?.friendlies?.includes(ally) || this.missionCombat?.isExternalThreatDefender(ally)))
  }
  /** Independent mount contacts retain their geometry while respecting their rider's protection. */
  private canHitTownMount(mount: Mount, source?: NPC): boolean {
    if (!source) return mount !== this.player.currentMount && !this.isProtectedTownAlly(mount)
    if (mount.riderPlayer === this.player) return source.hostileToPlayer || Boolean(this.duel?.canDamagePlayer(source))
    const owner = mount.riderNpc ?? (this.residents ?? []).find(resident => resident.homeMount === mount)?.npc
    if (owner) return source !== owner && townWartimeHostile(source, owner)
    return !mount.combatOwner || mount.combatOwner.allegiance !== source.faction
  }
  private hitResident(npc: NPC | Mount, amount: number, method: CombatDamageMethod = 'melee', contact?: CombatContact): void {
    if (this.retirementFinale?.active) {
      if (npc instanceof NPC) this.hitFieldNpc(npc, amount, method, undefined, contact)
      else this.hitBattlefieldMount(npc, amount, method, undefined, contact)
      return
    }
    if (this.duel?.active) return
    if (this.isProtectedTownAlly(npc) || npc.dead || amount <= 0 || !this.prepareDamage()) return
    let applied = 0
    const position = npc instanceof NPC ? npc.combatPosition.clone() : npc.group.position.clone()
    if (npc instanceof NPC) {
      const playerAmount = method === 'mount-impact'
        ? Math.round(amount * this.skills.getMountedImpactMultiplier())
        : amount
      const result = damageNpc(npc, playerAmount, { source: createPlayerCombatActorRef(this.player), method, weaponId: method === 'melee' ? this.inventory.equippedMelee?.id : this.inventory.equippedRanged?.id, contact: contact ?? (method === 'melee' ? this.player.weaponSweep?.contact : undefined) })
      applied = result.appliedDamage
      if (result.hitSuccess) this.showCombatTarget(result.targetName, result.hpRatio)
      if (applied > 0) this.awardCareerSkillXp(method, applied, contact?.attackSource === 'xongkoro' ? 'mountedImpact' : undefined)
    } else {
      const result = damageMount(npc, amount, { source: createPlayerCombatActorRef(this.player), method, contact })
      applied = result.appliedDamage
      if (applied > 0) this.awardCareerSkillXp(method, applied, contact?.attackSource === 'xongkoro' ? 'mountedImpact' : undefined)
      this.showCombatTarget(result.targetName, result.hpRatio)
    }
    if (applied > 0) {
      this.damageNumbers.spawn(applied, position)
      if (method === 'projectile') sound?.playProjectileImpact(0, true)
      else if (method === 'mount-impact') sound?.playHorseImpact(0, true)
      else sound?.playSwordHit(0, true)
    }
    this.activateHostility(); this.persistCasualties()
  }
  private get ranger(): NPC { return this.residents.find(r => r.spec.role === 'ranger')!.npc }
  private damageBuilding(index: number, amount: number, hitPosition?: THREE.Vector3, source?: NPC, sourceRef?: CombatActorRef, method: CombatDamageMethod = 'melee'): void {
    if (this.retirementFinale?.frozen || this.fourGateCombatHeld || source && this.isRetirementEvacuating(source)) return
    if (this.duel?.active) return
    if (source && (this.defense?.phase === 'PREPARING' || !this.defense?.assault)) return
    const b = this.world.buildings[index]; if (!b || b.hp.destroyed || !Number.isFinite(amount) || amount <= 0) return
    const townOwned = b.ownerFaction === Faction.TOWN
    if (townOwned && this.commanderProtectsOwnTown) return
    if (townOwned && (this.profile?.activeMission?.kind === 'town-defense' || this.profile?.activeMission?.kind === 'commander-four-gate-defense')) return
    if (townOwned && !this.defense?.assault && !this.prepareDamage()) return
    const position = hitPosition ?? b.hp.root.getWorldPosition(new THREE.Vector3())
    const { appliedDamage } = b.hp.takeDamage(amount)
    if (appliedDamage <= 0) return
    if (this.defense?.assault && townOwned) emitStructureDamage({ source: sourceRef ?? (source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player)), method, weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined : this.inventory.equippedMelee?.id, emit: this.defense.events.emit }, { targetId: b.id, targetType: 'structure', name: b.id, allegiance: Faction.ENEMY, structureKind: b.hp.kind }, amount, appliedDamage, b.hp.hpRatio, b.hp.destroyed)
    this.damageNumbers.spawn(appliedDamage, position)
    this.world.refreshDamage(); this.navigation.sync(this.world.obstacles)
    if (townOwned && !this.defense?.assault) this.activateHostility()
    else if (b.campId !== undefined) this.mission.provokeCamp(b.campId)
    this.persistCasualties()
  }
  /** Write only deaths/destructions, never a per-hit log or a health snapshot. */
  private persistCasualties(): void {
    const current = this.profile.townEvent
    if (!current || current.state !== 'hostile') return
    const deadActorIds = [...new Set([...(current.deadActorIds ?? []),
      ...[...this.event.allActors].filter(([, actor]) => actor.dead).map(([id]) => id)])]
    const destroyedBuildingIds = this.world.buildings.filter(b => b.ownerFaction !== Faction.BANDIT && b.hp.destroyed).map(b => b.id)
    if (deadActorIds.length === (current.deadActorIds?.length ?? 0) && destroyedBuildingIds.length === (current.destroyedBuildingIds?.length ?? 0)) return
    const next = cloneCareerProfile(this.profile)
    next.townEvent = { ...current, deadActorIds, destroyedBuildingIds }
    if (!this.commit(next)) {
      const panel = this.openPanel('事件保存失敗', '本次死亡／破壞尚未保存。重試成功後繼續；重新載入可能丟失這次變化，但追擊不會解除。')
      this.button(panel, '重試保存事件', () => { if (this.commit(next)) this.closePanel() })
    }
  }
  private restoreTownCasualties(): void {
    if (this.profile.townEvent?.state !== 'hostile') return
    for (const id of this.profile.townEvent.deadActorIds ?? []) {
      const actor = id === 'cat' ? this.cat : this.residents.find(r => r.spec.id === id)?.npc
      actor?.takeDamage(999999)
    }
    for (const id of this.profile.townEvent.destroyedBuildingIds ?? []) this.world.buildings.find(b => b.id === id)?.hp.destroy()
  }
  private hitFieldNpc(target: NPC, amount: number, method: CombatDamageMethod, source?: NPC, contact?: CombatContact, sourceRef?: CombatActorRef): void {
    if (this.retirementFinale?.frozen || this.fourGateCombatHeld || source && this.isRetirementEvacuating(source)) return
    if (this.defense?.phase === 'PREPARING' && (source?.combatOwnership === 'player-personal' || target.combatOwnership === 'player-personal')) return
    contact ??= method === 'melee' ? (source ?? this.player).weaponSweep?.contact : undefined
    if (contact?.kind === 'mount' && contact.mount) {
      this.hitBattlefieldMount(contact.mount, amount, method, source, contact, sourceRef)
      return
    }
    if (!source && this.duel?.active && target === this.duel.opponent && !this.duel.canDamageOpponent(target)) return
    if (target.dead || amount <= 0) return
    if (!source && this.race?.actors.includes(target) && !this.prepareDamage()) return
    if (!source && this.isProtectedTownAlly(target)) return
    if (source && !townWartimeHostile(source, target)) return
    if (this.defense?.active && !source && target.faction !== Faction.ENEMY && target.faction !== Faction.BANDIT) return
    const playerAmount = !source && method === 'mount-impact'
      ? Math.round(amount * this.skills.getMountedImpactMultiplier())
      : amount
    const result = damageNpc(target, playerAmount, {
      contact: contact ?? (method === 'melee' ? (source ?? this.player).weaponSweep?.contact : undefined),
      source: sourceRef ?? (source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player)),
      method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined : (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: event => {
        this.missionCombat?.notePlayerContact(target, event)
        this.emitCombatEvent(event)
      },
    })
    if (!result.hitSuccess) return
    if (!source && result.appliedDamage > 0 && this.race?.actors.includes(target)) this.activateHostility()
    if (result.appliedDamage > 0 && !this.isRetirementEvacuating(target)) {
      this.outskirts?.noteHit(target, !source)
      this.enemyEaglePatrol?.noteHit(target, !source)
      this.missionCombat?.noteExternalHit(target, source)
    }
    if (result.blockedImpact > 0 && result.appliedDamage === 0 && source && !this.isRetirementEvacuating(target)) {
      this.missionCombat?.noteExternalHit(target, source)
    }
    if (target.dead && this.event?.hostile && this.residents.some(resident => resident.npc === target)) this.persistCasualties()
    if (target.dead && this.profile.activeMission?.kind !== 'commander-four-gate-defense'
      && this.profile.activeMission && this.residents.some(resident => resident.npc === target && resident.spec.duty === 'watchtower_guard'))
      this.commit(cloneCareerProfile(this.profile))
    if (!source) this.awardCareerSkillXp(method, result.appliedDamage, contact?.attackSource === 'xongkoro' ? 'mountedImpact' : undefined)
    if (this.defense.active && (this.defense.assault || source?.faction === Faction.ENEMY)) this.defense.noteEffectiveFriendlyDamage(target)
    if (method === 'projectile') sound?.playProjectileImpact(target.currentLod, !source)
    else if (method === 'mount-impact') sound?.playHorseImpact(target.currentLod, !source)
    else if ((source?.meleeCombatKind ?? this.inventory.equippedMelee?.combatKind) === 'lance') sound?.playLanceImpact(target.currentLod, !source)
    else sound?.playSwordHit(target.currentLod, !source)
    if (target.faction === Faction.BANDIT && !this.isRetirementEvacuating(target)) {
      if (source) this.mission.alertGroupFor(target)
      else this.mission.provokeGroupFor(target)
    }
    if (!source && !this.isRetirementEvacuating(target) && !(this.defense.active && target.townCategory === 'civilian') && !target.dead && (target.faction === Faction.BANDIT || target.faction === Faction.ENEMY)) target.retaliateAgainstPlayer()
    if (!source) {
      if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
      this.showCombatTarget(result.targetName, result.hpRatio)
    }
  }
  private damagePlayerFromNpc(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact, sourceRef?: CombatActorRef): void {
    if (this.retirementFinale?.frozen || this.fourGateCombatHeld) return
    if (this.isRetirementEvacuating(source)) return
    if (!source.hostileToPlayer && !this.duel?.canDamagePlayer(source)) return
    if (this.defense?.active && !source.hostileToPlayer) return
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined),
      hostileToTarget: source.hostileToPlayer || Boolean(this.duel?.canDamagePlayer(source)),
      source: sourceRef ?? createNpcCombatActorRef(source), method, weaponId: (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined, emit: event => this.emitCombatEvent(event),
    })
    if (result.hitSuccess && (result.appliedDamage > 0 || result.blockedImpact > 0)) this.missionCombat?.noteExternalPlayerHit(source)
    if (result.appliedDamage <= 0) return
    if (method === 'projectile') sound?.playProjectileImpact(0, true)
    else if (method === 'mount-impact') sound?.playHorseImpact(0, true)
    else if (source.meleeCombatKind === 'lance') sound?.playLanceImpact(0, true)
    else sound?.playSwordHit(0, true)
  }
  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, player: boolean, training: boolean, kind: 'arrow' | 'pilum', source?: NPC, lifecycle?: ProjectileFlightBudget): boolean {
    if (!training && (this.retirementFinale?.frozen || this.fourGateCombatHeld || source && this.isRetirementEvacuating(source))) return this.projectileAdmission.reject()
    if (player && this.player.dead) return this.projectileAdmission.reject()
    if (player && !training && kind === 'arrow' && this.player.isMounted && this.player.currentMount?.isFlyingMount) lifecycle ??= playerEagleProjectileBudget(origin, direction, speed)
    const accepted = this.projectileAdmission.launch(this.shots.length, training ? this.shots.filter(s => s.training).length : 0, training, () => {
      const shooterFaction = player ? Faction.PLAYER : source?.faction ?? Faction.ENEMY
      this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, shooterFaction, player, kind, undefined, lifecycle), training, player, source, maxLifetimeSeconds: lifecycle?.maxLifetimeSeconds ?? 5, sourceRef: source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player), age: 0 })
    })
    if (!accepted) return false
    if (!training && kind === 'arrow') sound?.playBowRelease(player ? 0 : source?.currentLod ?? 0, player, player ? 0 : origin.distanceTo(this.player.combatPosition))
    return true
  }
  /** Physical participants never become mission objective, checkpoint or contribution rosters. */
  private runtimeCombatActors(): NPC[] {
    return [...new Set([
      ...(this.residents ?? []).map(resident => resident.npc),
      ...(this.mission?.fieldNpcs ?? []), ...(this.mission?.ambientBandits ?? []), ...(this.defense?.fieldNpcs ?? []), ...(this.duel?.fieldNpcs ?? []), ...(this.race?.actors ?? []),
      ...(this.missionCombat?.enemyTownHostiles ?? []), ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? []), ...(this.personalSquad?.actors ?? []),
    ])]
  }
  private updateShots(dt: number): void {
    if (!this.shots.length) return
    const runtimeActors = this.profile.activeRace || this.duel?.active || this.defense?.active || this.outskirts?.actors.length || this.enemyEaglePatrol?.actors.length || this.personalSquad?.actors.length ? this.runtimeCombatActors() : null
    const externalDefenders = runtimeActors ? [] : this.missionCombat?.externalDefenders ?? []
    for (const s of this.shots) {
      if (!s.arrow.isAlive) continue
      if (!s.training && this.fourGateCombatHeld) { s.arrow.destroy(); continue }
      const from = s.arrow.mesh.position.clone(); s.age += dt
      if (!s.training && s.age > (s.maxLifetimeSeconds ?? 5)) { s.arrow.destroy(); continue }
      s.arrow.update(dt, this.player, [], [], () => {}, damage => damagePlayer(this.player, damage, this.hp, null), undefined, true)
      if (!s.arrow.isAlive) continue
      const to = s.arrow.mesh.position
      if (s.training) { if (s.age > .3) s.arrow.destroy(); continue }
      const hit = this.shotContacts.find(from, to, {
        world: { kind: 'town', practiceTargets: this.world.targets,
          traceSiege: (start, end, maximum) => this.traceSiegeContact(start, end, maximum) },
        obstacles: this.projectileObstacles.query(from, to, this.world.obstacles),
        targets: this.shotTargets(s, runtimeActors, externalDefenders),
        acceptsTarget: target => {
          if (target instanceof Mount && (target.disposed || target.riderNpc === s.source || target.riderPlayer === this.player && s.player)) return false
          if (target.dead) return false
          // Recheck live allegiance for every shot after the preceding hit's effects.
          return !runtimeActors || !(target instanceof Mount
            ? !this.canHitTownMount(target, s.source)
            : target instanceof NPC && (s.player
              ? this.isProtectedTownAlly(target)
              : !s.source || !townWartimeHostile(s.source, target)))
        },
      })
      if (hit) {
        if (hit.kind === 'obstacle') {
          const buildingIndex = this.world.buildings.findIndex(building => building.obstacles.includes(hit.obstacle))
          const structure = hit.obstacle.damageable
          if (structure && this.profile.activeMission?.kind === 'commander-four-gate-defense')
            this.damageSiegeStructure(structure, s.arrow.damage, hit.point, s.source, s.sourceRef, 'projectile')
          else if (buildingIndex >= 0 && (s.player || s.source?.combatOwnership === 'player-personal' && this.defense?.assault))
            this.damageBuilding(buildingIndex, s.arrow.damage, hit.point, s.source, s.sourceRef, 'projectile')
        } else if (hit.kind === 'siege') {
          this.damageSiegeStructure(hit.target, s.arrow.damage, hit.point, s.source, s.sourceRef, 'projectile')
        } else if (hit.kind === 'actor') {
          const { target, contact } = hit
          if (contact.kind === 'mount' && contact.mount) this.hitBattlefieldMount(contact.mount, s.arrow.damage, 'projectile', s.source, contact, ...(s.sourceRef ? [s.sourceRef] as const : []))
          else if (target instanceof Player && s.source) this.damagePlayerFromNpc(s.source, s.arrow.damage, 'projectile', contact, ...(s.sourceRef ? [s.sourceRef] as const : []))
          else if (target instanceof NPC && (this.race?.actors.includes(target) || this.duel?.isMissionTarget(target) || target.faction === Faction.BANDIT || target.faction === Faction.ENEMY || Boolean(s.source && target.faction !== s.source.faction))) this.hitFieldNpc(target, s.arrow.damage, 'projectile', s.source, contact, ...(s.sourceRef ? [s.sourceRef] as const : []))
          else if (target === this.cat && this.defense.active && s.source?.faction === Faction.ENEMY) {
            this.cat.takeDamage(s.arrow.damage)
            if (this.cat.dead && this.ranger.mount === this.cat) this.ranger.dismountFromMount()
          }
          else if (target instanceof NPC || target instanceof Mount) this.hitResident(target, s.arrow.damage, 'projectile', contact)
        }
        s.arrow.destroy(); continue
      }
      if ((s.age > (s.maxLifetimeSeconds ?? 5)) || to.y < getTerrainHeight(to.x, to.z)) s.arrow.destroy()
    }
    this.shots = this.shots.filter(s => s.arrow.isAlive)
  }
  private *shotTargets(s: Shot, runtimeActors: readonly NPC[] | null, externalDefenders: readonly NPC[]): Iterable<Player | NPC | Mount> {
    if (runtimeActors) {
      // Preserve prefix, snapshot membership order, then independent mounts.
      if (!s.player && (!s.source || s.source.hostileToPlayer)) yield this.player
      if (s.player || s.source) yield* runtimeActors
      yield* this.combatMounts
    } else {
      const targets: Array<Player | NPC | Mount> = s.player
        ? [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.playerEnemies,
          ...[...this.residents.map(r => r.npc), ...this.townServiceMounts].filter(target => !this.isProtectedTownAlly(target))]
        : s.source && externalDefenders.includes(s.source)
          ? [...this.mission.ambientBandits, ...this.mission.missionBandits, ...(this.missionCombat?.enemyTownHostiles ?? [])]
            .filter(npc => townWartimeHostile(s.source!, npc))
        : s.source && (this.mission.missionBandits.includes(s.source) || this.mission.ambientBandits.includes(s.source) || this.mission.friendlies.includes(s.source) || this.missionCombat?.enemyTownHostiles?.includes(s.source))
          ? [...(s.source.hostileToPlayer || this.mission.missionBandits.includes(s.source) || this.mission.ambientBandits.includes(s.source) ? [this.player] : []),
            ...[...this.mission.combatPeersFor(s.source), ...(this.missionCombat?.enemyTownHostiles ?? []), ...externalDefenders].filter(npc => npc.faction !== s.source!.faction)]
          : this.defense.active && s.source
            ? [...(s.source.hostileToPlayer ? [this.player] : []), ...this.defense.peersFor(s.source),
              ...externalDefenders.filter(npc => townWartimeHostile(s.source!, npc)),
              ...(!this.defense.assault && s.source.faction === Faction.ENEMY && this.cat && !this.cat.dead ? [this.cat] : [])]
          : s.source?.faction === Faction.TOWN
            ? s.source.hostileToPlayer
              ? [this.player]
              : this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
          : s.source?.faction === Faction.PLAYER
            ? this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
            : [this.player]
      targets.push(...this.combatMounts.filter(mount => this.canHitTownMount(mount, s.source)))
      yield* targets
    }
  }

  private traceSiegeContact(from: THREE.Vector3, to: THREE.Vector3, maximum = from.distanceTo(to)):
    { target: DamageableObstacle; point: THREE.Vector3; distance: number } | null {
    if (!this.siegeHitTargets.size || maximum <= 0) return null
    const direction = to.clone().sub(from), length = direction.length()
    if (length <= 1e-6) return null
    this.siegeRaycaster.set(from, direction.multiplyScalar(1 / length))
    this.siegeRaycaster.near = 0; this.siegeRaycaster.far = Math.min(maximum, length)
    let nearest: { target: DamageableObstacle; point: THREE.Vector3; distance: number } | null = null
    for (const target of this.siegeHitTargets) {
      if (target.destroyed) continue
      const radius = this.siegeHitRadius.get(target) ?? 0
      if (target.root.position.distanceToSquared(from) > (maximum + radius) ** 2
        || this.siegeRaycaster.ray.distanceSqToPoint(target.root.position) > radius * radius) continue
      this.siegeRayHits.length = 0
      for (const mesh of target.hitMeshes) this.siegeRaycaster.intersectObject(mesh, false, this.siegeRayHits)
      this.siegeRayHits.sort((a, b) => a.distance - b.distance)
      const contact = this.siegeRayHits[0]
      if (contact && (!nearest || contact.distance < nearest.distance))
        nearest = { target, point: contact.point.clone(), distance: contact.distance }
    }
    return nearest
  }

  private damageSiegeStructure(target: DamageableObstacle, amount: number, point: THREE.Vector3,
    source?: NPC, sourceRef?: CombatActorRef, method: CombatDamageMethod = 'melee'): void {
    // Native Ranger/civilian visuals can use the opposite culture; their army
    // allegiance, rather than their appearance, owns friendly structure protection.
    const sourceFaction = source && (source.faction === Faction.ENEMY || source.faction === Faction.BANDIT)
      ? this.profile.faction === 'roman' ? 'viking' : 'roman' : this.profile.faction
    if (this.profile.activeMission?.kind !== 'commander-four-gate-defense' || this.fourGateCombatHeld
      || target.destroyed || !target.isDamageableBy(sourceFaction)) return
    const result = damageObstacle(target, amount, {
      source: sourceRef ?? (source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player)), method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined
        : (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: event => this.emitCombatEvent(event),
    })
    if (!source && result.appliedDamage > 0) {
      this.damageNumbers.spawn(result.appliedDamage, point)
      this.showCombatTarget(target.displayName, result.hpRatio)
    }
    // Destroy listeners own dock/gate topology and airspace changes synchronously.
    if (result.destroyed) this.navigation.sync(this.world.obstacles)
  }

  private melee(): void {
    if (this.fourGateCombatHeld) return
    const eagle = this.player.currentMount
    if (eagle?.isFlyingMount && !this.player.dead) {
      if (!eagle.eagleAttack?.active) return
      const targets = this.runtimeCombatActors().filter(target => !target.dead && !this.isProtectedTownAlly(target))
      for (const contact of eagle.traceEagleAttack(targets, this.combatMounts.filter(mount => this.canHitTownMount(mount)), this.world.obstacles)) {
        const amount = XONGKORO.attackDamage * this.skills.getMountedImpactMultiplier()
        const target = contact.target
        if (contact.kind === 'mount' && contact.mount) this.hitBattlefieldMount(contact.mount, amount, 'melee', undefined, contact)
        else if (target instanceof NPC) {
          if (this.race?.actors.includes(target) || this.duel?.isMissionTarget(target) || this.outskirts?.owns(target) || this.enemyEaglePatrol?.owns(target) || target.faction === Faction.BANDIT || target.faction === Faction.ENEMY) this.hitFieldNpc(target, amount, 'melee', undefined, contact)
          else this.hitResident(target, amount, 'melee', contact)
        }
      }
      return
    }
    if (this.player.dead || !this.inventory.meleeEnabled) { this.hasPreviousTip = false; return }
    const currentTip = this.player.getSwordTipPosition()
    const previousTip = this.hasPreviousTip ? this.previousTip.clone() : currentTip
    this.previousTip.copy(currentTip); this.hasPreviousTip = true
    if (!this.player.isHitFrame(this.inventory.equippedMelee)) return
    const weapon = this.inventory.equippedMelee, from = this.player.getWeaponGripPosition(new THREE.Vector3()), tip = this.player.getSwordTipPosition()
    const damageResult = calculatePlayerMeleeDamage({
      baseDamage: weapon.damageMax,
      combatKind: weapon.combatKind,
      isLance: weapon.isLance === true,
      isMounted: this.player.isMounted,
      mountSpeed: this.player.currentMount?.movementSpeed ?? 0,
      oneHandedMultiplier: this.skills.getMultiplier(resolveCombatSkill('melee', weapon, Boolean(this.inventory.shieldEnabled && this.inventory.equippedShield))!),
      faction: this.player.characterFaction,
      hasShield: this.inventory.shieldEnabled,
      heroAssetId: this.player.heroAssetId ?? undefined,
    })
    // Buildings block melee before residents behind them.
    let buildingHit = -1, nearestBuilding = Infinity, buildingHitPosition: THREE.Vector3 | undefined
    for (let i = 0; i < this.world.buildings.length; i++) {
      const b = this.world.buildings[i]
      if (b.hp.destroyed) continue
      for (const { box } of b.obstacles) {
        if (!townMeleeBuildingContact(this.player.position, this.player.facingYaw, from, tip, previousTip, box, weapon.range ?? 1.8, weapon.combatKind === 'lance')) continue
        const distance = box.distanceToPoint(this.player.position)
        if (distance < nearestBuilding) { nearestBuilding = distance; buildingHit = i; buildingHitPosition = box.clampPoint(this.player.position, new THREE.Vector3()) }
      }
    }
    const bladeContact = this.traceSiegeContact(from, tip)
    const sweepContact = this.traceSiegeContact(previousTip, tip)
    const siegeContact = bladeContact ?? sweepContact
    if (siegeContact && (buildingHit < 0 || siegeContact.point.distanceTo(this.player.position) < nearestBuilding)) {
      this.player.markHitProcessed()
      this.damageSiegeStructure(siegeContact.target, damageResult.damage, siegeContact.point)
      return
    }
    if (buildingHit >= 0) { this.player.markHitProcessed(); this.damageBuilding(buildingHit, damageResult.damage, buildingHitPosition); return }
    if (this.world.targets.some(p => p.distanceTo(tip) < .8)) { this.player.markHitProcessed(); return }
    const combatTargets = this.profile.activeRace || this.duel?.active || this.defense?.active || this.outskirts?.actors.length || this.enemyEaglePatrol?.actors.length || this.personalSquad?.actors.length ? this.runtimeCombatActors().filter(target => !this.isProtectedTownAlly(target))
      : [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.playerEnemies,
        ...(this.missionCombat?.enemyTownHostiles ?? []),
        ...this.residents.map(r => r.npc).filter(target => !this.isProtectedTownAlly(target))]
    const targets = combatTargets.filter(target => !target.dead
      && target.combatPosition.distanceToSquared(this.player.combatPosition) <= ((weapon.range ?? 1.8) + 4) ** 2)
    const mounts = this.combatMountGrid.getNearbyInto(this.player.combatPosition, (weapon.range ?? 1.8) + 4, this.meleeMountCandidates).filter(mount => this.canHitTownMount(mount))
    const contact = this.player.weaponSweep.traceFirst(targets, mounts, this.player.currentMount)
    if (!contact) return
    this.player.markHitProcessed()
    const target = contact.target as NPC | Mount
    const amount = Math.round(damageResult.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, contact.kind === 'mount' || target.isMounted))
    if (contact.kind === 'mount' && contact.mount) this.hitBattlefieldMount(contact.mount, amount, 'melee', undefined, contact)
    else if (target instanceof NPC) {
      if (this.race?.actors.includes(target) || this.duel?.isMissionTarget(target) || this.outskirts?.owns(target) || this.enemyEaglePatrol?.owns(target) || target.faction === Faction.BANDIT || target.faction === Faction.ENEMY) this.hitFieldNpc(target, amount, 'melee', undefined, contact)
      else this.hitResident(target, amount, 'melee', contact)
    }
    if (damageResult.isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
  }

  private resolveBodies(): void {
    if (this.player.dead || this.player.isFalling || this.player.currentMount?.isFlyingMount) return
    const playerBody = { position: this.player.group.position, radius: .42, height: 1.8, bottomOffset: .9 }
    for (const r of this.residents) {
      if (this.mission.friendlies.includes(r.npc) || this.duel?.isMissionActor(r.npc)) continue
      if (r.npc.dead) continue
      const position = r.npc.mount?.group.position ?? r.npc.group.position
      if (Math.hypot(position.x - playerBody.position.x, position.z - playerBody.position.z) > 3) continue
      resolveEntityCollision(playerBody, { position, radius: r.npc.mount ? .95 : .42, height: r.npc.mount ? 2.8 : 1.8, bottomOffset: 0, anchored: true }, this.world.obstacles)
    }
    for (const mount of this.townServiceMounts) if (!mount.dead) resolveEntityCollision(playerBody, { position: mount.group.position, radius: .85, height: 2, bottomOffset: 0, anchored: true }, this.world.obstacles)
    for (const npc of [...this.mission.fieldNpcs, ...this.defense.fieldNpcs, ...(this.duel?.fieldNpcs ?? []), ...(this.race?.actors ?? []), ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? []), ...(this.personalSquad?.actors ?? [])]) if (!npc.dead && npc.combatPosition.distanceTo(this.player.combatPosition) < 3) resolveEntityCollision(playerBody, { position: npc.combatPosition, radius: .42, height: 1.8, bottomOffset: 0, anchored: false }, this.world.obstacles)
    this.player.group.position.y = Math.max(this.player.group.position.y, getTerrainHeight(this.player.group.position.x, this.player.group.position.z) + .9)
  }
  private updateAmbient(): void {
    if (this.retirementFinale?.active || this.sceneContext.missionOnlyResidents || this.event.hostile || this.defense.active || this.panel || this.equipment.visible || this.result) { this.ambientLabel.hidden = true; return }
    const nearby = this.residents.find(r => r.spec.role === 'civilian' && !r.npc.dead && r.npc.combatPosition.distanceTo(this.player.combatPosition) < 5)
    if (nearby) {
      const line = this.ambient.take(this.elapsed, this.profile.faction, this.profile.rank)
      if (line) { this.ambientActor = nearby.npc; this.ambientUntil = this.elapsed + 4; this.ambientLabel.textContent = line }
    }
    const actor = this.ambientActor
    this.ambientLabel.hidden = !actor || actor.dead || this.elapsed > this.ambientUntil
    if (this.ambientLabel.hidden || !actor) return
    const point = actor.combatPosition.clone().add(new THREE.Vector3(0, 2.4, 0)).project(this.camera)
    if (point.z > 1 || point.z < -1) { this.ambientLabel.hidden = true; return }
    this.ambientLabel.style.left = (point.x * .5 + .5) * innerWidth + 'px'; this.ambientLabel.style.top = (-point.y * .5 + .5) * innerHeight + 'px'
  }
  private ambientEaglePatrolAllowed(): boolean {
    const mission = this.profile.activeMission
    return mission?.kind !== 'duel' && mission?.kind !== 'commander-four-gate-defense' && !this.profile.activeOutpostMission
      && this.profile.townEvent?.state !== 'hostile' && !this.event?.hostile
  }

  private synchronizeEaglePatrolPolicy(): void {
    if (!this.eagleGarrison && !this.enemyEaglePatrol) return
    const allowed = this.ambientEaglePatrolAllowed()
    if (!allowed && this.enemyEaglePatrol?.actors.length) {
      // A suspended ambient owner cannot leave projectiles in a protected mission.
      for (const shot of this.shots ?? []) if (shot.source && this.enemyEaglePatrol.owns(shot.source)) shot.arrow.destroy()
    }
    // Siege owns its native air roster; the independent opposing air patrol still flies.
    this.eagleGarrison?.setAmbientPatrolAllowed(allowed && !isTownCommandRevokedByRetirement(this.profile)
      && this.profile.activeMission?.kind !== 'town-defense' && this.profile.activeMission?.kind !== 'commander-four-gate-defense' && this.profile.activeMission?.kind !== 'enemy-town-assault')
    this.enemyEaglePatrol?.setAmbientPatrolAllowed(allowed)
  }

  /** Native snapshots must follow legacy ground mission restore, with validated player intent last. */
  private restoreEagleCommandState(): void {
    this.eagleGarrison?.restore(this.profile.townEagleGarrisons?.[this.world.faction], `town:${this.world.faction}`,
      this.profile.activeMission?.kind === 'commander-four-gate-defense')
    this.garrisonRestored = true
    this.townAirCommand?.restore()
    const authority = this.profile.activeMission?.officialSquad
    if (authority) for (const resident of this.residents ?? []) {
      const npc = resident.npc, member = authority.members?.[npc.combatantId]
      if (!resident.spec.eagle || !this.playerOwnsEagleCommand(npc)) continue
      this.eagleGarrison?.claimPlayerCommand(npc)
      if (member) restoreCommandActor(npc, member, resident.homeMount)
      this.defense?.releasePlayerCommand(npc)
      if (!npc.dead && member?.order === 'follow') npc.assignFollowTarget(this.player,
        authority.actorIds.indexOf(npc.combatantId), officialFollowLocalOffset(authority.actorIds.indexOf(npc.combatantId),
          npc.isMounted, Boolean(this.profile.personalSquad?.members.length)))
    }
    this.synchronizeEagleCommandOwnership()
  }

  private playerOwnsEagleCommand(npc: NPC): boolean {
    if (isTownCommandRevokedByRetirement(this.profile)) return false
    if (isAutonomousTownGuard(npc.combatantId)) return false
    const mission = this.profile.activeMission, authority = mission?.officialSquad
    return Boolean(this.profile.rank === 'commander' && this.world.faction === this.profile.faction
      && (mission?.kind === 'town-defense' || mission?.kind === 'commander-four-gate-defense') && !mission.result
      && authority?.missionId === mission.id && authority.townFaction === this.profile.faction
      && npc.combatOwnership === 'mission-official' && !npc.hostileToPlayer
      && (npc.faction === Faction.TOWN || npc.faction === Faction.PLAYER)
      && TOWN_AIR_COMMAND_IDS.includes(npc.combatantId)
      && (this.residents ?? []).some(resident => resident.npc === npc && resident.spec.id === npc.combatantId)
      && officialCommandIsPlayerControlled(authority, npc.combatantId))
  }
  private synchronizeEagleCommandOwnership(): void {
    for (const resident of this.residents ?? []) {
      const npc = resident.npc
      if (!resident.spec.eagle || !this.eagleGarrison) continue
      if (this.playerOwnsEagleCommand(npc)) this.eagleGarrison.claimPlayerCommand(npc)
      else if (this.eagleGarrison.isPlayerCommandOwned(npc)) this.eagleGarrison.releasePlayerCommand(npc, false)
    }
  }
  private updateEagleDuty(npc: NPC, dt: number, combat: boolean): boolean {
    const consumed = this.eagleGarrison?.update(npc, dt, combat, this.camera.position, this.world.airspaceObstacles, this.navigation,
      this.grid.getNearbyInto(npc.combatPosition, 60, this.neighbors), this.combatMounts) ?? false
    if (!consumed && this.retirementFinale?.active) {
      let target = this.player.dead ? undefined : this.player.combatPosition
      if (!target) {
        let distance = Infinity
        for (const ally of this.personalSquad?.actors ?? []) {
          if (ally.dead) continue
          const nextDistance = npc.combatPosition.distanceToSquared(ally.combatPosition)
          if (nextDistance < distance) { target = ally.combatPosition; distance = nextDistance }
        }
      }
      if (target) this.eagleGarrison?.approachRetirementTarget(npc, target)
    }
    return consumed
  }
  /** Service-time validation only; mounted residents keep their native movement and command owner. */
  private canPlaceMountedCivilian(point: { x: number; z: number }, actorId: string, reusedMount?: Mount | null, vacatingMounts: readonly Mount[] = []): boolean {
    if (!civilianBodyClear(point, this.world.airspaceObstacles)) return false
    // Omitted = restore/refit the allocated horse; null = spawn a new physical horse.
    const reused = reusedMount === undefined ? this.residents.find(r => r.spec.id === actorId)?.homeMount : reusedMount ?? undefined
    const coveredRiders = new Set<unknown>(this.residents.filter(r => r.spec.id !== actorId && !r.npc.dead).map(r => r.npc))
    coveredRiders.add(this.player)
    // Use fresh owners rather than the per-frame combat list, which may predate restore/equipment.
    if (!civilianMountsClear(point, [
      ...this.mounts, ...this.residents.map(r => r.homeMount), this.careerMounts?.activeMount, this.player.currentMount,
      ...(this.mission?.battlefieldMounts ?? []), ...(this.defense?.enemyMounts ?? []), ...(this.duel?.allMounts ?? []),
      ...(this.race?.allMounts ?? []), ...(this.outskirts?.mounts ?? []), ...(this.enemyEaglePatrol?.mounts ?? []),
      ...(this.personalSquad?.mounts ?? []), ...this.temporaryMounts.all,
    ], [reused, ...vacatingMounts], coveredRiders)) return false
    // Housing's 4.5m home spacing is not a physical collision radius at service time.
    const blocked = (position: { x: number; z: number }, radius: number) =>
      Math.hypot(point.x - position.x, point.z - position.z) < CIVILIAN_MOUNT_CLEARANCE.radius + radius
    return !this.residents.some(r => r.spec.id !== actorId && !r.npc.dead && blocked(r.npc.combatPosition,
      r.npc.mount && !vacatingMounts.includes(r.npc.mount) ? r.npc.mount.combatRadius : .5))
      && !blocked(this.player.combatPosition, this.player.currentMount?.combatRadius ?? .5)
  }
  private updatePeace(r: Resident, dt: number): void {
    if (this.retirementMobilization?.updateResident(r, dt, this.camera.position)) return
    if (this.race?.owns(r.npc)) return
    if (this.civilianCommand?.updateResident(r, dt, this.camera.position, this.world.obstacles, this.navigation)) {
      this.civilianLife?.suspend(r.spec.id); return
    }
    if (this.townCommand?.updateResident(r, dt, this.camera.position, this.world.obstacles, this.navigation)) return
    if (this.captainPatrol?.active && this.captainPatrol.owns(r.npc)) return
    if (this.updateEagleDuty(r.npc, dt, false)) return
    if (this.patrol?.updateResident(r, dt, this.camera.position, this.world.obstacles, this.navigation)) return
    if (r.spec.duty === 'watchtower_guard' && !r.npc.dead && !r.npc.isTownRampartGarrisonActive) r.npc.activateTownRampartGarrison()
    const { npc, spec, target } = r, distance = npc.group.position.distanceTo(this.camera.position), phase = this.elapsed + spec.index * .41
    let speed = 0
    if (npc.mount) {
      npc.mount.beginControlledFrame()
      if (target) {
        const dest = new THREE.Vector3(spec.x + Math.sin(phase * .5) * .65, 0, spec.z + Math.cos(phase * .5) * .65), dir = dest.sub(npc.mount.group.position); dir.y = 0
        speed = .65; npc.mount.addControlledMovement(dir.normalize(), speed, dt)
      }
      npc.mount.finishControlledFrame(dt, this.world.obstacles)
    } else if (spec.role === 'civilian') {
      if (!npc.dead && !npc.isFalling && !this.event.hostile) {
        const occupied = this.residents.filter(other => other.npc !== npc && !other.npc.dead).map(other => other.npc.combatPosition)
        occupied.push(this.player.combatPosition)
        const movement = (this.civilianLife ??= new TownCivilianLife()).update(spec.id, spec, npc.group.position, dt, this.navigation, this.world.obstacles, occupied)
        speed = movement.speed
        if (movement.yaw !== undefined) npc.group.rotation.y = movement.yaw
      } else this.civilianLife?.suspend(spec.id)
    }
    if (target) { const pos = npc.mount?.group.position ?? npc.group.position; const yaw = Math.atan2(target.x - pos.x, target.z - pos.z); npc.group.rotation.y = yaw; if (npc.mount) npc.mount.group.rotation.y = yaw }
    const cycle = Math.floor(phase / 3), start = cycle !== r.cycle; r.cycle = cycle
    const release = npc.updateTownPeace(dt, distance, Boolean(target), start, speed, phase % 3)
    if (release && distance < 22 && this.elapsed >= this.nextTrainingSound) { sound.playBowRelease(npc.currentLod, false, distance); this.nextTrainingSound = this.elapsed + .6 }
    if (release && target) { const origin = npc.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)); this.fire(origin, target.clone().sub(origin).normalize(), 16, 0, false, true, npc.rangedCombatKind === 'javelin' ? 'pilum' : 'arrow') }
  }
  private updateCareerCommandCue(): void {
    const active = this.profile.activeMission
    let cue: AudioCommand | null = null
    if (active?.kind === 'duel' || active?.kind === 'enemy-town-assault' || active?.kind === 'cavalry-sweep' || active?.kind === 'veteran-field') return
    if (active?.kind === 'town-defense') {
      if (active.phase === 'PREPARING' || active.phase === 'ATTACKING' && !this.defense.reserveHasCharged) cue = 'defend'
      else if (active.phase === 'ATTACKING' || active.phase === 'FAILURE_LOCKED') cue = this.defense.reserveHasCharged ? 'charge' : 'defend'
    } else if (active?.phase === 'ENGAGING') {
      cue = 'attack'
    }
    if (cue === this.careerCommandCue) return
    this.careerCommandCue = cue
    // The new warning already announces Town Defense's opening defensive order.
    // Keep the tactical/cue state, but do not stack the legacy Defend speech over it.
    if (active?.kind === 'town-defense' && cue === 'defend') return
    if (cue) sound?.playCommanderCommand(this.profile.faction, cue)
  }
  private updateCareerHorseAudio(): void {
    const candidates: HorseGallopCandidate[] = []
    const playerMount = this.player.currentMount
    if (playerMount && !playerMount.dead && playerMount.type === MountType.HORSE) candidates.push({
      id: playerMount,
      active: playerMount.movementSpeed >= 7.5,
      lod: playerMount.currentLod,
      distance: playerMount.group.position.distanceTo(this.camera.position),
      isPlayer: true,
    })
    const actors = [...(this.duel?.active ? this.duel.fieldNpcs : this.defense.active ? this.defense.fieldNpcs : this.mission.fieldNpcs), ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? []), ...(this.personalSquad?.actors ?? [])]
    for (const actor of actors) {
      const mount = actor.mount
      if (!mount || mount.dead || mount.type !== MountType.HORSE || actor.dead || mount === playerMount) continue
      candidates.push({
        id: mount,
        active: mount.movementSpeed >= 7.5,
        lod: mount.currentLod,
        distance: mount.group.position.distanceTo(this.camera.position),
        isPlayer: false,
      })
    }
    sound?.updateHorseGallopLoops(candidates)
    updateEagleWingbeatAudio(sound, [playerMount, this.careerMounts.activeMount, ...this.mounts,
      ...this.temporaryMounts.all, ...(this.outskirts?.mounts ?? []), ...(this.enemyEaglePatrol?.mounts ?? []), ...(this.personalSquad?.mounts ?? [])], this.camera.position, playerMount)
  }
  private updateHostile(dt: number): void {
    this.navigation.sync(this.world.obstacles); this.navigation.beginFrame()
    this.missionCombat.updateOutskirtsHostile(dt, this.elapsed)
    if (this.npcObstacles.length !== this.world.obstacles.length || this.npcObstacleRevision !== obstacleTopologyRevision(this.world.obstacles)) {
      this.npcObstacles = this.world.obstacles.slice()
      this.npcObstacleRevision = obstacleTopologyRevision(this.world.obstacles)
    }
    this.grid.clear(); for (const r of this.residents) if (!r.npc.dead) this.grid.insert(r.npc)
    const ranger = this.ranger, status = this.usesNativeRangerCat()
      ? updateRangerMount(ranger, this.cat, ranger.combatPosition.distanceTo(this.cat.group.position)) : 'unavailable'
    for (const r of this.residents) {
      if (this.retirementFinale?.active && !this.retirementFinale.owns(r.npc)) continue
      if (this.race?.owns(r.npc)) continue
      if (this.retirementFinale?.active && this.retirementMobilization?.updateResident(r, dt, this.camera.position)) continue
      if (r.npc === ranger && status === 'approach') {
        const dir = this.cat.group.position.clone().sub(ranger.group.position); dir.y = 0; ranger.group.position.addScaledVector(dir.normalize(), dt * 3.5); ranger.group.position.y = getTerrainHeight(ranger.group.position.x, ranger.group.position.z); ranger.group.rotation.y = Math.atan2(dir.x, dir.z); ranger.updateTownPeace(dt, ranger.group.position.distanceTo(this.camera.position), false, false, 3.5); continue
      }
      if (this.updateEagleDuty(r.npc, dt, true)) continue
      const warfare = Boolean(this.outskirts?.actors.length || this.enemyEaglePatrol?.actors.length || this.personalSquad?.actors.length || this.townCommand?.authorizedActorIds.length)
      r.npc.update(dt, this.player, warfare ? this.missionCombat.runtimeParticipants : [],
        this.grid.getNearbyInto(r.npc.combatPosition, 2, this.neighbors), r.npc.mount?.isFlyingMount ? this.world.airspaceObstacles : this.npcObstacles, this.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.damagePlayerFromNpc(r.npc, damage, 'melee')
          else if (targetNpc) this.hitFieldNpc(targetNpc, damage, 'melee', r.npc)
        }, (origin, direction, kind, lifecycle) => this.fire(origin, direction, r.npc.rangedProjectileSpeed, r.npc.rangedDamage, false, false, kind, r.npc, lifecycle), false,
        r.npc.group.position.distanceTo(this.camera.position), null, warfare ? this.missionCombat.runtimeGrid : null, this.navigation)
    }
    this.missionCombat.updateRaceActorsHostile(dt)
    for (const mount of this.mounts) if (!mount.dead && mount.riderNpc?.hostileToPlayer && checkMountImpact(mount, this.player.combatPosition, .6)) {
      applyMountImpactDamage(mount, this.player, this.player.combatPosition, this.elapsed, amount => this.damagePlayerFromNpc(mount.riderNpc!, amount, 'mount-impact'))
    }
    const playerMount = this.player.currentMount
    if (playerMount && !playerMount.dead) {
      for (const resident of this.residents) {
        const target = resident.npc
        if (target.dead || this.isProtectedTownAlly(target) || !checkMountImpact(playerMount, target.combatPosition, .5)) continue
        applyMountImpactDamage(playerMount, target, target.combatPosition, this.elapsed, amount => this.hitResident(target, amount, 'mount-impact'))
      }
    }
    if (!this.cat.dead && status === 'foot') {
      const dir = this.player.position.clone().sub(this.cat.group.position); dir.y = 0
      this.cat.beginControlledFrame(); this.cat.group.rotation.y = Math.atan2(dir.x, dir.z)
      if (dir.length() > 1.5) this.cat.addControlledMovement(dir.normalize(), 7, dt)
      else if (this.cat.canImpact(this.player, this.elapsed)) damagePlayer(this.player, 15, this.hp, null, { source: createNpcCombatActorRef(ranger), method: 'mount-impact' })
      this.cat.finishControlledFrame(dt, this.world.obstacles)
    }
  }
  private interaction(): void {
    if (this.player.dead) { this.target = null; this.hint.textContent = ''; this.hint.style.display = 'none'; return }
    this.nearbyTemporaryMount = null
    const playerPosition = this.player.currentMount?.group.position ?? this.player.combatPosition
    if (!this.player.isMounted && !this.player.isFalling) {
      let mountDistance = 3
      const mounts = new Set([this.careerMounts?.activeMount, ...this.temporaryMounts.all, ...(this.outskirts?.mounts ?? [])])
      for (const mount of mounts) {
        if (!mount?.availableForPlayer || mount.isAirborne || Math.abs(mount.group.position.y - playerPosition.y) > 3) continue
        const distance = Math.hypot(mount.group.position.x - playerPosition.x, mount.group.position.z - playerPosition.z)
        if (distance < mountDistance) { mountDistance = distance; this.nearbyTemporaryMount = mount }
      }
    }
    this.target = null; let nearest = 2.6
    if (!this.profile.activeRace && !this.defense.active && !this.player.isFalling && !this.player.currentMount?.isAirborne) for (const id of ['captain', 'commander', 'deployment', 'merchant', 'ranger', 'cat', 'hr-officer', 'eagle-trainer']) {
      if (!this.serviceAvailable(id)) continue
      const pos = id === 'cat' ? this.cat.group.position : this.residents.find(r => r.spec.id === id)!.npc.combatPosition
      // Use the grounded mount's base, so the giant eagle's standing seat can still talk.
      const delta = pos.clone().sub(playerPosition)
      if (Math.abs(delta.y) > 2.6) continue
      delta.y = 0; const distance = delta.length()
      if (distance > nearest || delta.normalize().dot(new THREE.Vector3(Math.sin(this.player.facingYaw), 0, Math.cos(this.player.facingYaw))) < .35) continue
      const start = this.player.position.clone(), end = pos.clone().add(new THREE.Vector3(0, 1, 0)), ray = new THREE.Ray(start, end.clone().sub(start).normalize())
      if (this.world.obstacles.some(o => { const hit = ray.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(start) < end.distanceTo(start) })) continue
      this.target = id; nearest = distance
    }
    this.hint.textContent = this.target ? 'E 與 ' + NAMES[this.target] + ' 交談' : this.player.isMounted ? 'E 下馬' : this.nearbyTemporaryMount ? `E 騎乘 ${this.nearbyTemporaryMount.displayName}` : this.event.hostile ? '全鎮追擊中' : this.defense.active ? '城鎮正在遭受攻擊' : ''
    this.hint.style.display = this.hint.textContent ? '' : 'none'
  }
  private finish(result: TownResult): void {
    if (this.profile.townEvent?.state !== 'hostile') return
    this.result = result
    const next = settleTown(this.profile, this.profile.townEvent!.id, result)
    if (!this.commit(next)) { const p = this.openPanel('結算尚未保存', '保存失敗；尚未扣款或轉場。'); this.button(p, '重試保存', () => this.finish(result)); return }
    this.showTownResult(result)
  }
  private showTownResult(result: TownResult): void {
    this.result = result
    const next = this.profile
    this.temporaryMounts.cleanup()
    const panel = this.openPanel(result === 'player_defeated' ? '弱者必須服從法律' : '小鎮已擊敗', result === 'player_defeated' ? '實際扣除 ' + next.townEvent!.penalty + ' 可用軍功，餘額 ' + next.availableMerit : '轉投 ' + next.faction + '，軍階 Recruit。本次入伍軍功歸零；歷史軍功與收藏保留。')
    this.button(panel, (result === 'player_defeated' ? '返回 ' : '前往 ') + (next.faction === 'viking' ? 'økse 村' : 'vinum 村'), () => { this.dispose(); this.onRestart(this.profile, result === 'player_defeated' ? 'death-return' : undefined) })
  }
  private showAmbientDefeat(): void {
    if (this.ambientDefeatShown) return
    this.ambientDefeatShown = true
    this.missionResultOpen = true
    const panel = this.openPanel('你被擊敗', '這是自由野外戰鬥：不增加軍功，也不扣除可用軍功。')
    this.button(panel, '返回小鎮', () => {
      const next = cloneCareerProfile(this.profile)
      this.missionResultOpen = false
      this.dispose()
      this.onRestart(next, 'death-return')
    })
  }
  private fourGateDefenseHud(): string {
    if (!(this.defense instanceof CommanderFourGateDefenseController)) return ''
    const defense = this.defense
    const phase = defense.phase === 'PREPARING' ? `準備 ${Math.ceil(defense.preparationRemaining)} 秒`
      : defense.phase === 'DEPLOYING' ? '守方部署中' : defense.phase === 'SPAWNING' ? '敵軍抵達中' : defense.phase === 'ATTACKING' ? `守住 ${Math.ceil(defense.survivalRemaining)} 秒即可獲勝` : '戰鬥結束'
    const ramps = defense.fourGateSiege?.ramps
    const gateNames = { north: '北', east: '東', south: '南', west: '西' } as const
    const gateStatus = { closed: '關閉', open: '開啟', destroyed: '已破' } as const
    const sectors = (['north', 'east', 'south', 'west'] as const).map(id => {
      const gate = this.world.gates.get(id)
      const state = (side: 'left' | 'right') => {
        const ramp = ramps?.get(`town-siege-ramp:${id}:${side}`)
        return !ramp ? '未抵達' : ramp.controller.state === 'DOCKED' ? '接牆'
          : ramp.controller.state === 'DESTROYED' ? '已毀' : ramp.controller.state === 'ABANDONED' ? '停駛'
            : defense.combatEnabled ? '推進' : '待命'
      }
      return `${gateNames[id]}門 ${gate ? gateStatus[gate.state] : '部署'} · 車 ${state('left')}/${state('right')}`
    })
    return `\nCOMMANDER V · FOUR-GATE DEFENSE\n${phase} · 敵軍 ${defense.remainingEnemies}/230\n${sectors.slice(0, 2).join('　')}\n${sectors.slice(2).join('　')}\n巨鷹騎手 ${defense.remainingAirborneEnemies}/30 · 平民死亡 ${defense.civilianDeaths}`
  }

  private veteranMissionHud(): string {
    const active = this.profile.activeMission!
    const definition = getVeteranMissionDefinition(active.templateId)!
    if (active.templateId === 'veteran-tragedy-of-the-scouts') {
      const remaining = Math.max(0, Math.ceil(120 - (this.mission?.survivalElapsedSeconds ?? active.survivalElapsed ?? 0)))
      return `\n${definition.name}\nSURVIVE ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
    }
    const orders = active.phase === 'ASSEMBLING' ? '前往兵營集合' : active.phase === 'MARCHING' ? '跟隨隊長行軍' : active.phase === 'ENGAGING' ? '衝鋒' : active.phase
    return `\n${definition.name} · 剩餘敵軍 ${this.mission.remainingEnemies}\n${orders}`
  }
  private updatePlayerCommands(): void {
    this.civilianCommand?.synchronize()
    if (this.player.dead || this.spectator) {
      if (this.personalCommands?.isSubmenuOpen || this.personalCommands?.isFormationPlacementMode) this.personalCommands.close()
      this.personalCommandUI?.setEnabled(false)
      return
    }
    this.synchronizeCommandActors()
    if (this.commandsEnabled()) {
      if (this.personalCommands?.update()) this.player.clearTownAction()
    } else {
      this.personalCommandUI?.setEnabled(false)
      let step: -1 | 0 | 1
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
  }

  /** One living-player update per frame, independent of official mission readiness. */
  private updateGameplay(dt: number): void {
    if (this.retirementFinale?.frozen) {
      this.retirementFinale.beforeCombat(dt, this.player.combatPosition, this.player.dead)
      this.personalCommandUI?.setEnabled(false)
      return
    }
    if (this.panel || this.equipment.visible || this.result || this.spawnErrorShown || this.deploymentFailed) {
      this.personalCommandUI?.setEnabled(false)
      sound?.updateHorseGallopLoops([])
      sound?.updateEagleWingbeats([])
      this.missionCombat.updateDefeatedActors(dt)
      return
    }
    const ready = this.deploymentReady
    if (ready) {
      this.elapsed += dt
      this.eagleLandingQueue?.beginFrame(dt)
      this.townCommand?.beginFrame()
      this.synchronizeEaglePatrolPolicy()
      this.eagleGarrison?.beginFrame(dt)
      this.outskirts?.synchronizeRank()
      this.refreshCombatMounts()
    }
    this.updatePlayerCommands()
    if (!this.spectator) this.orbit.update(this.input, dt, this.world.obstacles)
    if (!this.player.dead) this.player.update(dt, this.input, this.orbit.cameraYaw,
      this.orbit.getAimPoint(new THREE.Vector3()), this.player.currentMount?.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles, this.stamina,
      this.quiver, sound, this.inventory, this.skills.getRangedMultiplier(), ready && !this.fourGateCombatHeld)
    this.player.group.updateWorldMatrix(true, true)
    if (ready && !this.player.dead && !this.retirementMobilization?.updateBoundary(this.player.combatPosition) && this.profile.careerRetirement)
      this.notice = '退役動員尚未完成，請稍後重試。'
    if (ready && this.retirementFinale?.beforeCombat(dt, this.player.combatPosition, this.player.dead)) return
    if (this.disposed || this.panel) return
    if (ready) this.race?.beginFrame(this.raceClockDt, dt)
    if (ready) {
      this.race?.prepare()
      this.updateMissionSimulation(dt)
    } else {
      this.missionCombat.updateCommandTravel(dt, (this.commandActors ?? []).filter(npc => this.isAuthorizedCommandActor(npc)))
      this.personalCommands?.postUpdate()
      // Player.update owns ridden locomotion; this only maintains an unoccupied
      // owned mount (including eagle landing) and never runs impact/combat checks.
      this.careerMounts.update(dt)
      this.updateCareerHorseAudio()
      if (this.spectator) this.spectator.update(this.input, dt)
      this.interaction()
      this.missionCombat.updateDefeatedActors(dt)
    }
  }

  /** Remember the first native Town outcome without interrupting the trailing racer. */
  private checkpointRaceTownResult(): boolean {
    if (!this.profile.activeRace || this.profile.townEvent?.pendingResult) return true
    const outcome = this.event.evaluate(this.player.dead)
    if (!outcome) return true
    if (this.commit(deferTownResult(this.profile, outcome))) return true
    const panel = this.openPanel('城鎮結果尚未保存', '賽事仍保留。請重試保存後繼續觀戰或返回。')
    this.button(panel, '重試保存', () => { if (this.checkpointRaceTownResult()) this.closePanel() })
    return false
  }

  private updateMissionSimulation(dt: number): void {
    this.captainPatrol?.setEligibleTargets([...(this.mission.ambientBandits ?? []), ...(this.outskirts?.actors ?? []), ...(this.enemyEaglePatrol?.actors ?? [])])
    if (!this.player.dead) this.melee()
    if (this.retirementFinale?.active || this.event.hostile) this.updateHostile(dt)
    else this.missionCombat.update(dt, this.orbit.cameraYaw, this.elapsed)
    this.personalSquad?.updateLifecycle()
    this.personalCommands?.postUpdate()
    if (this.retirementFinale?.active) this.careerMounts.update(dt)
    this.missionCombat.updateDepartingCavalry(dt)
    this.updateCareerHorseAudio()
    for (const horse of this.stableHorses) if (!horse.dead) horse.horseVisual?.update(dt, horse.group.position.distanceTo(this.camera.position))
    for (const m of this.mounts) {
      m.setCameraDistance(m.group.position.distanceTo(this.camera.position))
      if (m.dead || !m.riderNpc && !m.riderPlayer && m !== this.cat && !this.stableHorses.includes(m)) m.update(dt, m.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles)
    }
    for (const mount of [...(this.outskirts?.mounts ?? []), ...(this.enemyEaglePatrol?.mounts ?? []), ...(this.personalSquad?.mounts ?? [])]) {
      if (mount.disposed) continue
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, mount.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles)
    }
    if (!this.sceneContext.missionOnlyResidents && !this.event.hostile && !this.cat.dead && !this.cat.riderNpc && this.cat !== this.careerMounts.activeMount) { this.cat.beginControlledFrame(); this.cat.finishControlledFrame(dt, this.world.obstacles) }
    for (const mount of this.race?.allMounts ?? []) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, this.world.obstacles)
    }
    this.resolveBodies(); this.updateShots(dt)
    if (this.retirementFinale?.active) {
      this.retirementFinale.afterCombat(this.player.combatPosition, this.player.dead)
      if (this.disposed) return
      if (!this.retirementFinale.frozen) this.persistPersonalSquad(dt)
      if (this.player.dead) this.enterMissionObserver()
      this.spectator?.update(this.input, dt)
      this.interaction()
      return
    }
    this.race?.advance(this.raceClockDt)
    if (!this.checkpointRaceTownResult()) return
    if (this.race?.session?.phase === 'result' && !this.panel) this.showRaceResult()
    const returning = this.race && raceReturnAction(this.race.session?.phase, this.race.canWalkBack, this.race.returnComplete)
    if (returning) this.leaveRace(returning === 'direct')
    this.persistPersonalSquad(dt)
    this.captainPatrol?.update(dt)
    if (this.duel?.active) this.duel.persistRuntimeProgress()
    if (this.player.dead) this.enterMissionObserver()
    if ((this.player.dead || this.profile.activeMission?.kind === 'cavalry-sweep' || this.profile.activeMission?.kind === 'veteran-field') && this.profile.activeMission && !this.profile.activeMission.result) {
      if (this.captainPatrol?.active) this.captainPatrol.persist(true)
      else if (this.duel?.active) this.duel.persistRuntimeProgress(true)
      else if (this.defense.active) this.defense.persistRuntimeProgress(
        !(isCommanderTownMission(this.profile.activeMission) || this.profile.activeMission.kind === 'commander-four-gate-defense'))
      else this.mission.persistRuntimeProgress(this.player.dead)
    }
    if (this.spectator) this.spectator.update(this.input, dt)
    this.interaction()
    if (this.profile.activeRace) return
    const townOutcome = this.event.evaluate(this.player.dead)
    if (townOutcome && !this.panel) this.finish(townOutcome)
    else if (!this.event.hostile) {
      const personalAlive = this.personalSquad?.aliveCombatants ?? 0
      const missionOutcome = this.captainPatrol?.active ? this.captainPatrol.evaluateOutcome() : this.duel?.active ? this.duel.evaluate(this.player.dead) : this.defense.active ? this.defense.evaluate(this.player.dead, personalAlive) : this.mission.evaluate(this.player.dead, personalAlive)
      if (missionOutcome && !this.panel) this.finishMission(missionOutcome)
      else if (!this.profile.activeMission && this.player.dead && !this.panel) this.showAmbientDefeat()
      else if ((this.captainPatrol?.active ? this.captainPatrol.returnComplete : this.duel?.active ? this.duel.returnComplete : !this.defense.active && this.mission.returnComplete) && !this.panel) this.returnToTown('arrived')
    }
  }

  private updateCaptainPatrolGuide(): void {
    const active = this.captainPatrol?.active
    this.captainPatrolGuide?.updateCaptainPatrol(active && !this.panel && !this.equipment.visible ? active.phase : null,
      this.player.combatPosition, this.orbit.cameraYaw, this.captainPatrol?.guideTarget ?? null)
  }

  private frame(time: number): void {
    if (this.disposed) return
    // A settled mission cannot resolve again, and a corpse cannot finish the walk home.
    // Use the result panel's direct return, including when restoring a saved return.
    const active = this.profile.activeMission
    if (this.player.dead && active?.result && active.phase === 'RETURNING' && !this.event.hostile && !this.panel) {
      this.cancelPendingSpawns()
      this.returnToTown('direct')
      if (this.disposed) return
    }
    gameplayNpcSpawns.tick(time)
    if (this.disposed) return
    if (this.deploymentFailed && !this.spawnErrorShown) {
      this.spawnErrorShown = true
      const panel = this.openPanel('部隊建立失敗', '本次部署已停止，存檔仍保留完整名冊。請重試空軍部署或重新載入以恢復任務。')
      if (this.defense instanceof CommanderFourGateDefenseController) this.button(panel, '重試敵軍部署', () => {
        this.dispose(); this.onRestart(this.profile)
      })
      if (this.enemyEaglePatrol?.batches.some(batch => batch.status === 'failed')) this.button(panel, '重試空軍部署', () => {
        this.enemyEaglePatrol?.retryFailedDeployment()
        if (!this.deploymentFailed) { this.spawnErrorShown = false; this.closePanel() }
      })
    }
    this.updatePointerPrompt()
    this.raceClockDt = Math.max(0, (time - this.last) / 1000)
    const dt = Math.min(.05, this.raceClockDt); this.last = time
    // Keep the collapse playing even when death immediately opens a result panel.
    if (this.player.dead) this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.player.currentMount?.isFlyingMount ? this.world.airspaceObstacles : this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
    const preparationElapsed = this.preparationClock.advance(time,
      !document.hidden && document.hasFocus() && !this.panel && !this.equipment.visible
      && !this.result && !this.spawnErrorShown && !this.deploymentFailed && this.deploymentReady)
    if (this.defense instanceof CommanderFourGateDefenseController) this.defense.setPreparationElapsed(preparationElapsed)
    this.updateGameplay(dt)
    if (this.disposed) return
    // Lance hits suppress mount impact only for that simulation frame, as in Game.
    // Clear after all Career impact checks so subsequent guarded riding can hit again.
    for (const mount of this.combatMounts) mount.skipImpactThisFrame = false
    for (const mount of this.mounts) mount.skipImpactThisFrame = false
    const duelPhase = this.duel.active && !this.panel && !this.equipment.visible ? this.duel.phase : null
    this.weaponWheelUI.update(this.inventory, !this.panel && !this.equipment.visible && !this.result && !this.player.dead && !this.spectator)
    this.duelHud.update(duelPhase, this.duel.countdownRemaining, this.duel.combatRemaining)
    this.duelGuide.updateDuel(duelPhase, this.player.combatPosition, this.orbit.cameraYaw, this.duel.guideTarget)
    this.updateCaptainPatrolGuide()
    const retirementPoint = townRetirementRallyTarget(this.player.combatPosition)
    const retirementTarget = ['departing', 'mobilizing'].includes(this.profile.careerRetirement?.phase ?? '')
      && this.world.faction === this.profile.faction && !this.sceneContext.missionOnlyResidents
      && !this.panel && !this.equipment.visible
      ? new THREE.Vector3(retirementPoint.x, getTerrainHeight(retirementPoint.x, retirementPoint.z), retirementPoint.z) : null
    this.retirementGuide.updateRetirement(this.player.combatPosition, this.orbit.cameraYaw, retirementTarget)
    this.updateRaceHud()
    this.tutorial?.update()
    for (const [id, marker] of this.serviceMarkers) marker.visible = !this.defense.active && this.serviceAvailable(id)
    const missionHud = this.profile.activeMission
      ? this.mission?.travelEncounter?.active
        ? '\n途中遭遇敵軍 · 全隊支援，解除威脅後繼續路線'
        : this.profile.activeMission.kind === 'captain-patrol-command'
        ? `\nPATROL COMMAND · 有效擊殺 ${this.captainPatrol?.killCount ?? this.profile.activeMission.patrolKilledActorIds?.length ?? 0}/30\n正式巡邏隊 ${this.captainPatrol?.aliveCombatants ?? 0}/20 · Q / 反引號 命令`
        : this.profile.activeMission.kind === 'duel'
        ? `\nDUEL · T${this.profile.activeMission.duelTier} ${UNIT_PRESETS[this.profile.activeMission.duelPresetId!].nameEn}\n${this.duel.phase === 'PREPARING' ? 'DUEL STARTS IN ' + Math.ceil(this.duel.countdownRemaining) : this.duel.phase === 'ENGAGING' ? (this.duel.combatRemaining > 29 ? 'FIGHT\n' : '') + 'Time ' + this.duel.combatRemaining.toFixed(1) + '\nOpponent HP ' + Math.round(this.duel.opponent?.hp ?? 0) : this.duel.phase === 'RETURNING' ? '跟隨隊長返回市政廳服務點' : this.duel.phase === 'ASSEMBLING' || this.duel.phase === 'MARCHING' ? '前往單挑場地 · 等待 Captain 與對手就位' : this.duel.phase}`
        : this.profile.activeMission.kind === 'veteran-field'
        ? this.veteranMissionHud()
        : this.profile.activeMission.kind === 'cavalry-sweep'
        ? `\nCAVALRY SWEEP · 剩餘 Bandits ${this.mission.remainingEnemies}/40\n${this.profile.activeMission.phase === 'RETURNING' ? '跟隨部隊返回軍營' : this.profile.activeMission.templateId === CAPTAIN_CAVALRY_COMMAND_ID ? '率領騎兵前往 Bandits 所在位置 · 接近後下令衝鋒' : this.profile.activeMission.phase === 'ASSEMBLING' ? '前往軍營集合 · 與騎兵一起出城' : this.profile.activeMission.phase === 'MARCHING' ? '跟隨 Captain 出城 · 接近敵軍後一起衝鋒' : '衝鋒 · 穿過敵陣後拉開距離，再次衝鋒'}`
        : this.profile.activeMission.kind === 'enemy-town-assault'
        ? `\nENEMY TOWN ASSAULT · ${this.defense.phase === 'PREPARING' ? '開戰倒數 ' + Math.ceil(this.defense.preparationRemaining) + ' 秒' : '敵方軍事守軍 ' + this.defense.military.filter(npc => !npc.dead).length + '/' + this.defense.military.length}`
        : this.profile.activeMission.kind === 'commander-sky-raid'
        ? `\nSKY RAID\nEnemy Town Kills: ${this.profile.activeMission.deadTargetActorIds?.length ?? 0} / 100\nFriendly Rangers: ${this.defense.defenders.filter(npc => !npc.dead).length} / 50 · Friendly Eagles: ${this.defense.enemyMounts.filter(mount => !mount.dead).length} / 50`
        : this.profile.activeMission.kind === 'commander-decapitation'
        ? `\nOPERATION DECAPITATION · ${this.defense.remainingEnemies ? '敵方 Commander 仍存活' : '敵方 Commander 已倒下'}\n行動隊 ${this.defense.defenders.filter(npc => !npc.dead).length}/30`
        : this.profile.activeMission.kind === 'commander-four-gate-defense'
        ? this.fourGateDefenseHud()
        : this.profile.activeMission.kind === 'town-defense'
        ? `\nTOWN DEFENSE ${this.defense.phase === 'PREPARING' ? '開戰倒數 ' + Math.ceil(this.defense.preparationRemaining) + ' 秒' : this.profile.activeMission.phase} · 敵軍剩餘 ${this.defense.remainingEnemies} · 平民死亡 ${this.defense.civilianDeaths}/10`
        : fieldMissionHud(
          this.profile.activeMission.kind === 'patrol' ? 'patrol' : 'bandit',
          this.profile.activeMission.phase,
          this.mission.remainingEnemies,
        )
      : ''
    const compactDefense = this.profile.activeMission?.kind === 'commander-four-gate-defense'
    this.hud.textContent = compactDefense
      ? `${missionHud.trim()}${this.spectator ? '\n你已戰死 · 戰鬥仍在繼續' : ''}`
      : `${this.sceneContext.missionOnlyResidents ? '敵境 · 斥候遭遇戰' : this.sceneContext.worldFaction === 'viking' ? 'økse 村' : 'vinum 村'}\n已任命軍階 ${this.profile.rank}\n累積軍功 ${this.profile.totalMerit} · 可用軍功 ${this.profile.availableMerit}${this.townCommand?.authorizedActorIds.length ? `\n${this.profile.townCommandSquad?.commandRank === 'commander' ? '全城正式部隊' : '城防指揮隊'} ${this.townCommand.actors.filter(npc => !npc.dead).length}/${this.townCommand.authorizedActorIds.length} · ${this.townCommand.state === 'TRAINING' ? '駐防待命' : this.townCommand.state} · Q / 反引號 命令` : ''}${this.profile.personalSquad?.members.length ? `\nPersonal Squad ${this.profile.personalSquad.members.length}/30 · ${this.personalSquad?.state ?? 'RESERVE'} · Q / 反引號 命令` : ''}${missionHud}${this.spectator ? '\n你已戰死 · 戰鬥仍在繼續' : ''}`
    if (this.retirementFinale?.active) {
      const seconds = Math.ceil(this.retirementFinale.remainingSeconds)
      const stats = this.retirementFinale.stats
      this.hud.textContent = `撐過最後一戰\n${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}\n玩家擊殺 ${stats.player.kills} · 小隊擊殺 ${stats.personal.kills}\n私人部隊 ${this.personalSquad?.aliveCombatants ?? 0}${this.spectator ? '\n你已戰死 · 戰鬥仍在繼續' : ' · Q / 反引號 命令'}${this.retirementFinale.frozen ? '\n' + this.notice : ''}`
    } else if (this.profile.careerRetirement && this.notice) this.hud.textContent += '\n' + this.notice
    this.updateMountHud()
    this.damageNumbers.update(dt, this.camera)
    this.updateAmbient()
    this.quiver.setArrowCount(this.player.arrowCount)
    document.getElementById('quiver-hud')!.style.display = this.inventory.rangedEnabled ? '' : 'none'
    this.aerialView.update(this.camera, this.scene, usesAerialView(Boolean(this.player.isMounted && this.player.currentMount?.isFlyingMount), Boolean(this.spectator), this.camera.position.y - getTerrainHeight(this.camera.position.x, this.camera.position.z)))
    this.compass?.update(this.camera)
    this.hud.style.whiteSpace = 'pre-line'; this.renderer.render(this.scene, this.camera)
    this.scheduleSiegeOpening()
    this.raf = requestAnimationFrame(t => this.frame(t))
  }
  dispose(preservePointerLock = false): void {
    this.projectileObstacles.clear()
    this.promotionAttempt = null
    this.cancelPendingSpawns()
    this.flushCareerSkillProgression()
    sound?.updateHorseGallopLoops([])
    sound?.updateEagleWingbeats([])
    if (this.disposed) return
    this.combatTargetHud.dispose()
    this.compass?.dispose()
    this.compass = undefined
    this.personalSquad?.cleanup()
    this.race?.snapshot(); this.race?.persist(); this.race?.dispose(); this.raceGuide.dispose(); this.raceHud.dispose()
    this.captainPatrol?.dispose()
    this.captainPatrolGuide.dispose()
    this.retirementGuide.dispose()
    this.retirementFinale?.dispose()
    this.personalCommands?.close()
    this.personalFormation?.cancelPlacement()
    this.personalCommandUI?.dispose()
    this.enemyEaglePatrol?.dispose()
    this.outskirts?.dispose()
    this.weaponWheelUI?.dispose()
    this.tutorial?.dispose()
    this.duelHud?.dispose()
    this.duelGuide?.dispose()
    sound?.cancelCareerAudio()
    const controlsHint = document.getElementById('controls-hint')
    if (controlsHint) controlsHint.textContent = this.previousControls
    const quiverHud = document.getElementById('quiver-hud')
    if (quiverHud) quiverHud.style.display = ''
    this.temporaryMounts.cleanup()
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.abort(); this.input?.dispose(); this.panel?.remove(); this.equipment?.close(); this.hud?.remove(); this.hint?.remove(); this.pointerPrompt?.remove(); this.careerMounts?.dispose(); this.mission?.dispose(); this.defense?.dispose(); this.duel?.dispose(); this.player?.dispose(); document.getElementById('mount-hud')?.classList.remove('visible'); document.getElementById('enemy-hud')?.classList.remove('visible'); this.ambientLabel?.remove(); this.damageNumbers.update(100, this.camera); this.residents.forEach(r => r.npc.dispose()); this.mounts.forEach(m => m.dispose()); this.shots.forEach(s => s.arrow.destroy()); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove()
    if (!preservePointerLock) document.exitPointerLock?.()
  }

  private updatePointerPrompt(): void {
    const locked = Boolean(document.pointerLockElement)
    const released = this.pointerWasLocked && !locked
    this.pointerWasLocked = locked
    // Browsers may consume Escape while releasing pointer lock, without a keydown.
    if (released) this.openPauseMenu()
    const unlocked = !locked && !location.search.includes('nolock')
    this.pointerPrompt.style.display = unlocked && !this.panel && !this.equipment.visible ? '' : 'none'
  }
}
