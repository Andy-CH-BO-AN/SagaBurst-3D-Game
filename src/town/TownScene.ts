import { obstacleTopologyRevision } from '../world/ObstacleTopology'
import { TemporaryBattlefieldMounts } from '../career/TemporaryBattlefieldMounts'
import { WeaponWheel } from '../player/WeaponWheel'
import { WeaponWheelUI } from '../ui/WeaponWheelUI'
import * as THREE from 'three'
import { acceptCavalrySweep, sweepPlayerSpawn, SWEEP_YAW } from '../career/CavalrySweep'
import { Player, PLAYER_ARROW_CAPACITY, DEFAULT_PLAYER_MAX_HP } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { SpectatorCameraController } from '../camera/SpectatorCameraController'
import { NPC, AIType, Faction } from '../world/NPC'
import { Mount, MountType, mountTypeFromId } from '../world/Mount'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { CorgiVisual } from '../world/CorgiVisual'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { ArrowProjectile, createProjectileWarmupGroup } from '../world/ArrowProjectile'
import { warmTownRenderResources } from './TownRenderWarmup'
import { getTerrainHeight, resolveEntityCollision, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { damageMount, damageNpc, damagePlayer } from '../combat/DamageRouter'
import { createNpcCombatActorRef, createPlayerCombatActorRef, emitStructureDamage, type CombatDamageMethod } from '../combat/CombatAttribution'
import { SpatialGrid } from '../world/SpatialGrid'
import { checkMountImpact, applyMountImpactDamage } from '../combat/MountImpact'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { DamageNumbers } from '../ui/DamageNumbers'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { getDefenseCampaignStage } from '../campaign/CampaignConfig'
import { acceptCareerOutpostRelief, isCareerOutpostReliefUnlocked, resolveCareerReliefMount, acceptCareerOutpost, isCareerOutpostUnlocked, CAREER_OUTPOST_STAGES, type CareerOutpostStageId } from '../career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../career/CareerOutpostLaunch'
import { selectTownDialogue, formatTownDialogue, promotionDetails, TownAmbientDialogue, type DialogueContext, type DialogueRole } from '../career/CareerTownDialogue'
import { installTownStyles } from './TownUI'
import { isTownProductOwned, purchaseTownHorse, purchaseTownEquipment, sellTownProduct, townResalePrice, townSaleStatus, TOWN_RESALE_PERCENT } from './TownRules'
import { getCareerPurchaseTier } from '../career/CareerProfile'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { QuiverUI } from '../ui/QuiverUI'
import { EquipmentUI } from '../ui/EquipmentUI'
import { SkillManager } from '../rpg/SkillManager'
import { SHIELD_CONFIG, traceCombatSegment, type CombatContact } from '../combat/ShieldBlocking'
import { canAwardPlayerSkillProgression, resolveCombatSkill, skillStatesEqual } from '../rpg/CombatSkillProgression'
import { SoundManager, type AudioCommand, type CareerMissionVoiceCue, type HorseGallopCandidate } from '../audio/SoundManager'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, careerMissionCompletionsForTier, clearCareerMission, cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from '../career/CareerProfile'
import { availableRecruitMissions, availableCareerMissionsForPage, careerMissionTemplatesForPage, defaultCareerMissionPage, isCareerMissionPageUnlocked, getCareerMissionTemplate, patrolPreferredCamp, type CareerMissionPage } from '../career/CareerMissionCatalog'
import { VETERAN_MISSION_CATALOG, getVeteranMissionDefinition, getVeteranMissionAvailability, acceptVeteranMission, createVeteranRoster, veteranTownCavalryReserveSlots } from '../career/VeteranMission'
import { selectTownCavalryReserve } from './TownCavalryReserve'
import { createCareerVeteranOutpostLaunch } from '../career/CareerVeteranOutpost'
import { BanditMissionController, selectMissionCavalryActorIds, veteranPlayerSpawn, veteranPlayerYaw } from '../career/BanditMissionController'
import { CareerDuelController } from '../career/CareerDuelController'
import { MissionGuide } from '../career/MissionGuide'
import { CareerDuelHUD } from '../ui/CareerDuelHUD'
import { isCareerDuelUnlocked } from '../career/CareerDuelState'
import { getUnitPresetsForFaction, UNIT_PRESETS, type UnitPresetId, type UnitTier } from '../battle/UnitPresetCatalog'
import { fieldMissionHud } from '../career/CareerMissionPresentation'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import { acceptEnemyTownAssault } from '../career/EnemyTownAssault'
import { careerTownSceneRoster, isCareerEnemyTerritoryFieldMission, resolveCareerTownSceneContext } from '../career/CareerFieldSceneContext'
import { townWartimeHostile } from './TownWartime'
import { TownDefenseController } from '../career/TownDefenseController'
import { CareerMountController } from '../career/CareerMountController'
import { preserveHpRatio, resolveCareerHeroAsset, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import { createTownDefenseMission, type CareerMissionOutcome, type CareerMissionResult } from '../career/CareerMissionState'
import { VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../career/TownDefenseState'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { townMeleeBuildingContact } from './TownCombat'
import { TownWorld } from './TownWorld'
import { TOWN_NAVIGATION_BOUNDS, TOWN_PLAYABLE_WORLD_BOUND } from './TownBounds'
import { TownEquipment } from './TownEquipment'
import { TownMissionSettlement } from './TownMissionSettlement'
import { TownMissionCombat, type TownCombatResident as Resident } from './TownMissionCombat'
import { TownCavalryPatrolController } from './TownCavalryPatrolController'
import { TownOutskirtsWarfareController } from './TownOutskirtsWarfareController'
import { TOWN_RULES, townActorCaptainProfile, TownEvent, townCaptainProfile, townMilitaryEquipment, stableHorsePositions, townSitePoint, TOWN_SITES, isCivilian, productStatus, TOWN_PRODUCTS, settleTown, updateRangerMount, type TownResult } from './TownRules'

let sound: SoundManager
interface Shot { arrow: ArrowProjectile; readonly training: boolean; readonly player: boolean; readonly source?: NPC; age: number }
const NAMES: Record<string, string> = { captain: '騎兵隊長', deployment: '士官長', merchant: '武器店主', ranger: '遊俠 Maki', cat: '黑貓店主', civilian: '平民 Civilian' }
export class TownScene {
  private readonly weaponWheel = new WeaponWheel()
  private readonly weaponWheelUI = new WeaponWheelUI()
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 400)
  readonly renderer: THREE.WebGLRenderer
  readonly event = new TownEvent()
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
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly equipment = new EquipmentUI()
  private readonly skills = new SkillManager()
  private readonly listeners = new AbortController()
  private readonly hud = document.createElement('div')
  private readonly duelHud = new CareerDuelHUD()
  private readonly duelGuide = new MissionGuide('career-duel-guide')
  private readonly hint = document.createElement('div')
  private readonly pointerPrompt = document.createElement('div')
  private panel: HTMLDivElement | null = null
  private target: string | null = null
  private shots: Shot[] = []
  private raf = 0
  private last = performance.now()
  private elapsed = 0
  private disposed = false
  private result: TownResult | null = null
  chargeSpeakerId: string | null = null
  private readonly damageNumbers = new DamageNumbers()
  private readonly ambient = new TownAmbientDialogue()
  private readonly ambientLabel = document.createElement('div')
  private ambientUntil = 0
  private ambientActor: NPC | null = null
  private readonly previousTip = new THREE.Vector3()
  private hasPreviousTip = false
  private notice = ''
  private readonly store = new CareerProfileStore()
  private careerSkillsDirty = false
  private careerSkillSaveTimer: number | null = null
  private mission!: BanditMissionController
  private duel!: CareerDuelController
  private defense!: TownDefenseController
  private careerMounts!: CareerMountController
  private missionSettlement!: TownMissionSettlement
  private patrol!: TownCavalryPatrolController
  private missionCombat!: TownMissionCombat
  private outskirts?: TownOutskirtsWarfareController
  private missionResultOpen = false
  private deploymentPage?: CareerMissionPage | 'duel'
  private duelPresetId?: UnitPresetId
  private careerCommandCue: AudioCommand | null = null
  private ambientDefeatShown = false
  private get sceneContext() { return resolveCareerTownSceneContext(this.profile) }
  static async create(container: HTMLElement, profile: CareerProfile, onCampaign: (config?: DefenseCampaignLaunchConfig) => void, onRestart: (p: CareerProfile) => void, progress: (text: string) => void = () => {}): Promise<TownScene> {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    try {
      progress('載入人物、坐騎與動畫…')
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), BlackCatVisual.preload(), CorgiVisual.preload(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[townCaptainProfile(resolveCareerTownSceneContext(profile).residentFaction).visualAssetId].descriptor), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['maki-archer-t4'].descriptor), preloadMakiRangerBow(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['viking-hero-t4'].descriptor), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['roman-hero-t4'].descriptor)])
      progress('建立村莊與營地…')
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const town = new TownScene(container, renderer, profile, onCampaign, onRestart)
      try { await town.initialize(progress); return town } catch (error) { town.dispose(); throw error }
    } catch (error) { renderer.dispose(); throw error }
  }
  private constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, public profile: CareerProfile, private readonly onCampaign: (config?: DefenseCampaignLaunchConfig) => void, private readonly onRestart: (p: CareerProfile) => void) {
    installTownStyles()
    sound ??= new SoundManager()
    sound.cancelCareerAudio()
    this.renderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement)
    const context = this.sceneContext
    this.world = new TownWorld(context.worldFaction, this.scene, context.worldOwnerAllegiance)
    this.inventory = new TownEquipment(() => this.profile, p => this.commit(p))
    this.skills.setSkillState(profile.skills ?? {})
  }
  private async initialize(progress: (text: string) => void): Promise<void> {
    const { profile, renderer } = this
    const context = this.sceneContext
    const roster = careerTownSceneRoster(profile)
    const yieldFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const catSpot = townSitePoint('stable', -3, 8)
    this.cat = new Mount(this.scene, MountType.BLACK_CAT, catSpot.x, catSpot.z); this.cat.group.rotation.y = catSpot.yaw; this.cat.reservedForTown = true; this.cat.catVisual?.setEquipmentVisible(false); this.mounts.push(this.cat)
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
    let spawned = 0
    for (const { spec, characterFaction, allegiance, borrowed } of roster) {
      if (spawned++ % 4 === 0) { progress((context.missionOnlyResidents ? '建立敵城與斥候隊 ' : '建立駐軍與居民 ') + Math.min(spawned, roster.length) + ' / ' + roster.length + '…'); await yieldFrame() }
      const civilian = isCivilian(spec.role), ranger = spec.role === 'ranger', cavalry = spec.mounted, ranged = spec.unitKind === 'ranged' || spec.unitKind === 'archer' || spec.unitKind === 'horse_archer' || ranger
      const residentArmyFaction = context.missionOnlyResidents && !borrowed ? context.worldFaction : context.residentFaction
      const military = !civilian && !ranger ? townMilitaryEquipment(residentArmyFaction, spec) : null
      const preset = military?.presetId
      const captain = townActorCaptainProfile(residentArmyFaction, spec)
      const loadout = civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null } : military!.loadout
      const npc = new NPC(this.scene, spec.x, spec.z, allegiance, characterFaction, ranged ? AIType.RANGED : AIType.MELEE, NAMES[spec.role] ?? spec.id, civilian ? TOWN_RULES.garrisonTier : ranger ? 4 : military!.level, cavalry, loadout, preset, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : captain?.visualAssetId, ranger ? 'ranger' : captain?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, residentArmyFaction)
      npc.setTownPeaceful(); npc.group.rotation.y = spec.yaw ?? Math.PI
      let homeMount: Mount | undefined
      if (ranger) homeMount = this.cat
      if (cavalry) { const mount = new Mount(this.scene, captain ? mountTypeFromId(captain.mountOverride) : MountType.HORSE, spec.x, spec.z); mount.reservedForTown = true; mount.group.rotation.y = spec.yaw ?? Math.PI; npc.mountVehicle(mount); this.mounts.push(mount); homeMount = mount }
      if (!context.missionOnlyResidents && NAMES[spec.role] && spec.role !== 'civilian') { npc.group.rotation.y = spec.yaw ?? 0; this.serviceMarkers.set(spec.id, this.world.addServiceMarker(npc.group, ranger ? 1.9 : captain ? 2 : 2.2)) }
      const training = !context.missionOnlyResidents && spec.training, target = training ? this.world.addTarget(spec.x, spec.z - (spec.mounted ? ranged ? 4 : 3 : ranged ? 3 : 1.5), ranged) : undefined
      this.residents.push({ spec, npc, homeMount, target, cycle: -1, walkTime: 0 }); this.event.register(spec.id, npc)
    }
    this.patrol = new TownCavalryPatrolController(this.residents)
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
    this.player = new Player(this.scene, profile.faction, resolveCareerHeroAsset(profile))
    this.bindBlockingProgression()
    this.player.setMaxHp(resolveCareerPlayerMaxHp(profile, DEFAULT_PLAYER_MAX_HP), true)
    this.player.group.position.set(0, getTerrainHeight(0, 9) + .9, 9); this.player.group.rotation.y = Math.PI
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.navigation.sync(this.world.obstacles)
    this.outskirts = new TownOutskirtsWarfareController(this.scene, context.worldFaction,
      () => this.profile, this.world.obstacles, this.navigation)
    this.outskirts.synchronizeRank()
    // Enemy-territory field missions may reserve a Patrol officer instead of the
    // service Captain, or use only temporary officers. Recruit-party captain access
    // is unused there, but constructing the field controller must still succeed.
    const missionCaptain = (this.residents.find(resident => resident.spec.id === 'captain')
      ?? this.residents.find(resident => resident.npc.faction === Faction.TOWN)
      ?? this.residents[0]).npc
    this.mission = new BanditMissionController(this.scene, this.world, this.navigation, missionCaptain, this.residents, () => this.player, () => this.profile, p => this.commit(p))
    this.mission.onBorrowMountedActor = actorId => { this.patrol.relinquish(actorId) }
    this.mission.onMarchStarted = () => this.playMissionVoice('follow')
    this.mission.onSweepCharge = () => sound.playCommanderCommand(this.profile.faction, 'charge')
    this.duel = new CareerDuelController(this.scene, this.world, this.navigation, this.residents, this.cat, () => this.player, () => this.profile, p => this.commit(p))
    this.duel.onMarchStarted = () => this.playMissionVoice('follow')
    this.duel.onReturnStarted = () => this.playMissionVoice('return')
    this.defense = new TownDefenseController(this.scene, this.residents, () => this.player, () => this.profile, p => this.commit(p), this.cat, this.navigation)
    this.careerMounts = new CareerMountController(
      this.scene,
      () => this.player,
      () => this.profile,
      p => this.commit(p),
      () => this.world.obstacles,
      () => [
        ...this.residents.filter(r => !r.npc.dead).map(r => r.npc.combatPosition),
        ...this.mounts.filter(mount => !mount.dead && (!this.sceneContext.missionOnlyResidents || mount !== this.cat)).map(mount => mount.group.position),
        ...this.mission.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
        ...this.defense.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
      ],
    )
    this.missionCombat = new TownMissionCombat(
      { field: this.mission, duel: this.duel, defense: this.defense },
      {
        player: () => this.player,
        residents: this.residents, cameraPosition: this.camera.position, obstacles: this.world.obstacles,
        navigation: this.navigation, hp: this.hp, careerMounts: this.careerMounts,
        outskirts: () => this.outskirts,
        preparePeaceResidents: excluded => this.patrol.beginFrame(excluded),
        ownsPeacefulTravel: npc => this.patrol.returnStateFor(npc.combatantId) !== null,
        peaceResident: (resident, dt) => this.updatePeace(resident, dt),
        updateCommandCue: () => this.updateCareerCommandCue(),
        clearCombatShots: () => this.clearMissionCombatShots(),
        hitNpc: (target, damage, method, source) => this.hitFieldNpc(target, damage, method, source),
        damagePlayer: (source, damage, method) => this.damagePlayerFromNpc(source, damage, method),
        fireNpc: (origin, direction, kind, source) => this.fire(origin, direction, source.rangedProjectileSpeed, source.rangedDamage, false, false, kind, source),
      },
    )
    const town = this
    this.missionSettlement = new TownMissionSettlement(
      { read: () => this.profile, commit: p => this.commit(p) },
      { field: this.mission, duel: this.duel, defense: this.defense },
      {
        residents: this.residents, cat: this.cat,
        releaseExternalThreat: npc => this.missionCombat.releaseExternalThreat(npc),
        beginPatrolMissionReturn: actorId => { this.patrol.beginMissionReturn(actorId) },
        world: this.world, navigation: this.navigation, inventory: this.inventory,
        get player() { return town.player },
        clearCombatShots: () => this.clearMissionCombatShots(),
        restPlayer: () => this.restPlayerInTown(),
        restart: p => { this.missionResultOpen = false; this.dispose(); this.onRestart(p) },
      },
    )
    this.player.onPlayerDeath = () => this.enterMissionObserver()
    this.restoreActiveCareerMission()
    progress('預熱城外 Bandit…')
    const banditWarmupStarted = performance.now()
    for (const distance of [100, 35, 0]) {
      for (const bandit of this.mission.ambientBandits) bandit.updateTownPeace(.2, distance, false, false)
      this.scene.updateMatrixWorld(true)
      await renderer.compileAsync(this.scene, this.camera)
      await yieldFrame()
    }
    if (import.meta.env.DEV) console.info(`[CareerTownWarmup] ambient Bandit ${Math.round(performance.now() - banditWarmupStarted)}ms`)
    this.player.update(.2, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
    if (!this.spectator) this.orbit.update(this.input)
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
    if (profile.townEvent?.state === 'hostile') {
      for (const id of profile.townEvent.deadActorIds ?? []) {
        const actor = id === 'cat' ? this.cat : this.residents.find(r => r.spec.id === id)?.npc
        actor?.takeDamage(999999)
      }
      for (const id of profile.townEvent.destroyedBuildingIds ?? []) this.world.buildings.find(b => b.id === id)?.hp.destroy()
    }
    this.hud.id = 'town-hud'; this.hud.style.cssText = 'position:fixed;top:20px;left:20px;z-index:90;background:#201d19de;color:#efe1c3;padding:16px 22px;border:1px solid #aa9270;line-height:1.7;font:15px system-ui;max-width:520px;pointer-events:none'
    this.hint.id = 'town-hint'; this.hint.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:90;color:#fff;background:#211e19dd;padding:10px 20px;font:18px system-ui;pointer-events:none'
    this.pointerPrompt.id = 'town-pointer-prompt'; this.pointerPrompt.textContent = '點擊畫面進入遊戲'; this.pointerPrompt.style.cssText = 'position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);z-index:89;color:#fff4d0;background:#201d19e8;border:1px solid #aa9270;padding:14px 22px;font:600 18px system-ui;pointer-events:none'
    this.ambientLabel.className = 'town-ambient'; this.ambientLabel.hidden = true
    document.body.append(this.hud, this.hint, this.pointerPrompt, this.ambientLabel)
    if (!this.spectator) document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · 滾輪 換裝 · 右鍵 舉盾／瞄準 · Tab 裝備 · E 交談 · Q / Esc 關閉面板'
    const opts = { capture: true, signal: this.listeners.signal }
    window.addEventListener('keydown', e => this.key(e), opts)
    window.addEventListener('pagehide', () => {
      this.flushCareerSkillProgression()
      if (this.profile.activeMission?.kind === 'veteran-field'
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
    if (!this.spectator) this.orbit.update(this.input)
    if (this.profile.activeMission?.result && this.profile.activeMission.phase !== 'RETURNING') this.openMissionResult(this.profile.activeMission.result, true)
  }
  /** Called after the entry removes its loading overlay. */
  start(): void {
    this.last = performance.now()
    this.raf = requestAnimationFrame(t => {
      if (this.disposed) return
      this.frame(t)
      if (this.defense.assault && !this.profile.activeMission?.result) {
        // Give the ready battlefield one paint before sounding its alarm.
        requestAnimationFrame(() => { if (!this.disposed) void this.playAssaultAlert() })
      }
    })
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
    if (!this.careerSkillsDirty) return true
    const next = cloneCareerProfile(this.profile)
    next.skills = this.skills.skillState
    if (!this.store.save(next)) {
      this.notice = '技能進度保存失敗，請稍後重試。'
      return false
    }
    this.profile = next
    this.outskirts?.synchronizeRank()
    this.careerSkillsDirty = false
    return true
  }

  private commit(profile: CareerProfile): boolean {
    this.clearCareerSkillSaveTimer()
    const next = cloneCareerProfile(profile)
    next.skills = this.skills.skillState
    if (!this.store.save(next)) { this.notice = '保存失敗，資料尚未變更。請確認瀏覽器儲存空間後重試。'; return false }
    if (next.activeMission && next.activeMission.id !== this.profile.activeMission?.id) {
      this.player?.shield?.reset()
      for (const resident of this.residents ?? []) resident.npc?.shield?.reset()
    }
    if (next.activeMission?.id !== this.profile.activeMission?.id || next.faction !== this.profile.faction) sound?.cancelCareerAudio()
    if (next.rank !== this.profile.rank) this.deploymentPage = undefined
    this.profile = next
    this.careerSkillsDirty = false
    return true
  }

  private bindBlockingProgression(): void {
    this.player.blockingLevel = this.skills.skillState.blocking.level
    this.player.onShieldBlock = impact => this.awardCareerSkillXp('melee', impact * SHIELD_CONFIG.xpPerBlockedImpact, 'blocking')
  }

  private awardCareerSkillXp(method: CombatDamageMethod, appliedDamage: number, skillOverride?: 'blocking'): void {
    if (!canAwardPlayerSkillProgression({
      dead: this.player.dead,
      spectatorOnly: this.player.spectatorOnly,
      observer: Boolean(this.spectator),
    })) return
    if (appliedDamage <= 0) return
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
    if (!this.profile.activeMission || this.event.hostile || this.spectator) return
    if (this.profile.activeMission.kind === 'duel') {
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
    // Save death immediately, without resolving or claiming the mission.
    if (!this.profile.activeMission.playerDead) {
      const next = cloneCareerProfile(this.profile)
      next.activeMission!.playerDead = true
      this.commit(next)
    }
  }
  private key(e: KeyboardEvent): void {
    if (this.panel || this.equipment.visible) {
      e.stopImmediatePropagation()
      if (['KeyQ', 'Escape', 'Tab'].includes(e.code)) { e.preventDefault(); if (!this.result && !this.missionResultOpen) this.closePanel() }
      return
    }
    if (this.player.dead) {
      if (['Tab', 'KeyE', 'KeyQ', 'KeyG'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation() }
      return
    }
    if (e.repeat) return
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.(); this.equipment.open(this.skills, this.inventory, () => this.input.clear(), this.careerMounts); return }
    if (e.code === 'KeyE') {
      e.preventDefault(); e.stopImmediatePropagation()
      if (this.player.isMounted) this.player.dismountFromMount()
      else if (this.nearbyTemporaryMount?.availableForPlayer) this.player.mountVehicle(this.nearbyTemporaryMount)
      else if (this.target) this.talk(this.target)
    }
  }
  private closePanel(): void {
    this.panel?.remove(); this.panel = null; this.equipment.close(); this.input.clear(); this.player.clearTownAction(); if (!location.search.includes('nolock')) this.input.requestPointerLock(this.renderer.domElement)
  }
  private openPanel(title: string, text: string): HTMLDivElement {
    this.panel?.remove(); this.equipment.close(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
    const panel = document.createElement('div'); panel.id = 'town-dialog'; panel.className = 'town-panel'
    const eyebrow = document.createElement('small'); eyebrow.className = 'town-eyebrow'; eyebrow.textContent = this.profile.faction === 'roman' ? 'VINUM · LEGION RECORD' : 'ØKSE · HALL OF WARRIORS'; panel.append(eyebrow)
    const heading = document.createElement('h2'); heading.textContent = title; panel.append(heading)
    const body = document.createElement('p'); body.textContent = text; body.style.whiteSpace = 'pre-line'; panel.append(body)
    if (!this.result && !this.missionResultOpen) this.button(panel, '關閉 · Q / Esc', () => this.closePanel())
    document.body.append(panel); this.panel = panel; return panel
  }
  private button(parent: HTMLElement, label: string, action: () => void): void { const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; parent.append(b) }
  private talk(id: string, response?: string, shopPage: 'buy' | 'sell' = 'buy'): void {
    if (this.player.dead || this.event.hostile || !this.serviceAvailable(id)) return
    const role = id as DialogueRole, key = this.profile.faction + ':' + id
    const firstMeet = !this.profile.townDialogueSeen?.includes(key)
    const outpostKey = this.profile.faction + ':soldier-outpost'
    const firstOutpost = id === 'deployment' && this.profile.rank === 'soldier' && !this.profile.townDialogueSeen?.includes(outpostKey)
    if (firstMeet || firstOutpost) {
      const next = cloneCareerProfile(this.profile)
      next.townDialogueSeen = [...(next.townDialogueSeen ?? []), ...(firstMeet ? [key] : []), ...(firstOutpost ? [outpostKey] : [])]
      if (!this.commit(next)) { this.openPanel('無法保存交談紀錄', this.notice); return }
    }
    const p = this.profile, context: DialogueContext = { townFaction: p.faction, npcRole: role, playerRank: p.rank, firstMeet }
    const greeting = response ?? selectTownDialogue(context)
    if (id === 'captain') {
      const next = CAREER_RANKS[CAREER_RANKS.indexOf(p.rank) + 1], merit = enlistmentMerit(p), eligible = Boolean(next && merit >= CAREER_RANK_THRESHOLDS[next])
      const text = formatTownDialogue(selectTownDialogue({ ...context, nextRank: next, promotionEligible: eligible }, 'promotion'), { nextRank: next ?? '', required: next ? CAREER_RANK_THRESHOLDS[next] : 0 })
      const panel = this.openPanel('騎兵隊長 · 任命', greeting + '\n\n' + (response ? '' : text))
      const detail = document.createElement('p'); detail.className = 'town-summary'; detail.textContent = promotionDetails(p); panel.append(detail)
      if (eligible) this.button(panel, next === 'captain' ? '接受隊長任命' : '接受任命', () => {
        const fresh = promoteCareer(this.profile)
        if (fresh && this.commit(fresh)) {
          this.applyCareerPlayerIdentity()
          this.talk('captain', selectTownDialogue({ ...context, playerRank: fresh.rank }, 'promotionSuccess'))
        }
      })
    } else if (id === 'deployment') {
      this.openDeploymentPanel(greeting, context, firstOutpost)
    } else {
      const mount = id !== 'merchant', panel = this.openPanel(NAMES[id], greeting)
      const summary = document.createElement('p'); summary.className = 'town-summary'; summary.textContent = '可用軍功 ' + p.availableMerit + ' · ' + p.rank + (mount ? ' · 軍用戰馬只需購買一次，隨軍階解鎖至 T4；按 Tab 騎乘／收起' : ' · 購買後按 Tab 選擇裝備'); panel.append(summary)
      const tabs = document.createElement('div'); tabs.className = 'town-shop-tabs'; panel.append(tabs)
      this.button(tabs, '購買', () => showProducts('buy'))
      this.button(tabs, '賣出', () => showProducts('sell'))
      const showProducts = (page: 'buy' | 'sell' = shopPage) => {
        for (const tab of Array.from(tabs.children) as HTMLButtonElement[]) tab.disabled = tab.textContent === (page === 'buy' ? '購買' : '賣出')
        summary.textContent = '可用軍功 ' + this.profile.availableMerit + ' · ' + this.profile.rank + (page === 'sell' ? ` · 回收價為原價的 ${TOWN_RESALE_PERCENT[this.profile.rank]}%` : mount ? ' · 軍用戰馬隨軍階解鎖至 T4；按 Tab 騎乘／收起' : ' · 購買後按 Tab 選擇裝備')
        panel.querySelector('.town-products')?.remove()
        const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
        let section = ''
        const products = TOWN_PRODUCTS.filter(i => (i.category === 'mount') === mount && (page === 'buy' || isTownProductOwned(this.profile, i)))
        if (!products.length) { const empty = document.createElement('p'); empty.textContent = '沒有可賣出的物品。'; list.append(empty) }
        for (const item of products.sort((a, b) => {
          const group = (item: typeof a) => item.category === 'armor' ? 2 : WEAPONS[item.id]?.type === 'ranged' ? 1 : 0
          return mount ? 0 : group(a) - group(b)
        })) {
          if (!mount) {
            const heading = item.category === 'armor' ? '盾牌' : WEAPONS[item.id]?.type === 'ranged' ? '遠程武器' : '近戰武器'
            if (heading !== section) { const h = document.createElement('h3'); h.textContent = heading; list.append(h); section = heading }
          }
          const row = document.createElement('article'); row.className = 'town-product'
          const title = document.createElement('strong'); title.textContent = item.name
          const meta = document.createElement('small'); meta.textContent = (item.id === 'horse' ? '隨軍階 T1–T4' : 'T' + item.tier) + ' · ' + item.price + ' 軍功 · ' + productStatus(this.profile, item)
          row.append(title, meta)
          if (page === 'sell') {
            const price = townResalePrice(this.profile, item.id)
            meta.textContent = (item.id === 'horse' ? '隨軍階 T1–T4' : 'T' + item.tier) + ` · 回收 ${price} 軍功`
            const button = document.createElement('button'); button.className = 'town-button'
            button.disabled = townSaleStatus(this.profile, item.id) !== 'sellable'
            button.textContent = button.disabled ? '至少保留一件武器' : `賣出 · 收回 ${price} 軍功`
            button.onclick = () => {
              const result = sellTownProduct(this.profile, item.id)
              if (!result.sold) { this.talk(id, result.reason === 'last-weapon' ? '至少保留一件武器。' : '物品已不存在或無法賣出。', 'sell'); return }
              if (!this.commit(result.profile)) { this.talk(id, this.notice, 'sell'); return }
              this.inventory.syncOwnership()
              this.careerMounts.syncOwnership()
              this.player.clearTownAction()
              this.talk(id, `賣出成功：${item.name}\n收回 ${result.earnedMerit} 可用軍功。`, 'sell')
            }
            row.append(button); list.append(row); continue
          }
          if (!mount) {
            const status = productStatus(this.profile, item)
            const button = document.createElement('button'); button.className = 'town-button'
            button.textContent = status === '已擁有' || status === '軍階未解鎖' ? status : this.profile.availableMerit < item.price ? '餘額不足' : '購買'
            button.disabled = status !== '已解鎖・餘額足夠'
            button.onclick = () => {
              const result = purchaseTownEquipment(this.profile, item.id)
              if (!result.purchased) {
                const message = result.reason === 'tier-locked' ? '軍階未解鎖' : result.reason === 'insufficient-merit' ? '可用軍功不足' : result.reason === 'already-owned' ? '已擁有' : '商品不存在或無法購買'
                this.talk(id, message); return
              }
              if (!this.commit(result.profile)) { this.talk(id, this.notice); return }
              this.talk(id, '購買成功：' + item.name + '\n按 Tab 選擇裝備。')
            }
            row.append(button); list.append(row); continue
          }
          this.button(row, item.id === 'horse' && !isTownProductOwned(this.profile, item) ? '購買' : '查看', () => {
            const current = this.profile, owned = isTownProductOwned(current, item), tierUnlocked = getCareerPurchaseTier(current.rank) >= item.tier
            let message = selectTownDialogue({ ...context, isOwned: owned, tierUnlocked, hasEnoughMerit: current.availableMerit >= item.price }, 'product')
            if (item.id === 'horse' && !owned) {
              const fresh = purchaseTownHorse(current, item.id)
              if (fresh) {
                if (!this.commit(fresh)) { this.talk(id, this.notice); return }
                message = selectTownDialogue(context, 'horsePurchaseSuccess') + '\n按 Tab → 坐騎 → 騎乘。'
              }
            }
            this.talk(id, message)
          })
          list.append(row)
        }
      }
      if (id === 'cat' && !response) this.button(panel, '查看坐騎', () => showProducts())
      else showProducts()
    }
  }
  private openDeploymentPanel(greeting: string, context: DialogueContext, firstOutpost: boolean): void {
    const active = this.profile.activeMission
    if (active?.result) { this.openMissionResult(active.result, true); return }
    const panel = this.openPanel('士官長', greeting)
    const arrows = document.createElement('p'); arrows.className = 'town-summary'; arrows.textContent = `箭袋 ${this.player.arrowCount}/${PLAYER_ARROW_CAPACITY}`; panel.append(arrows)
    if (this.player.arrowCount < PLAYER_ARROW_CAPACITY) this.button(panel, '申請補滿箭矢', () => {
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
      badge.textContent = `任務進行中：${active.kind === 'duel' ? '1v1 Duel · 單挑' : template?.name ?? active.templateId}\n狀態 ${active.phase}${active.kind === 'duel' ? ` · T${active.duelTier} ${UNIT_PRESETS[active.duelPresetId!].nameEn}` : active.kind === 'town-defense' ? ' · 守住所屬城鎮' : active.kind === 'patrol' ? ' · 沿指定路線巡邏' : active.kind === 'veteran-field' ? ' · 野戰任務' : ` · 目標 Camp ${active.targetCampId + 1}`}`
      panel.append(badge)
      return
    }
    const defaultPage = defaultCareerMissionPage(this.profile)
    const requestedPage = this.deploymentPage ?? defaultPage
    const selectedPage = requestedPage !== 'duel' && !isCareerMissionPageUnlocked(this.profile, requestedPage) ? defaultPage : requestedPage
    this.deploymentPage = selectedPage
    const tabs = document.createElement('nav'); tabs.className = 'town-mission-tabs'; tabs.setAttribute('aria-label', '任務分類')
    for (const [page, label] of [['recruit', '菜兵任務'], ['soldier', '士兵任務'], ['veteran', '老兵任務'], ['duel', '1v1 Duel · 單挑']] as const) {
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
      reliefDetails.textContent = !reliefUnlocked ? '完成 Outpost I–III 後解鎖' : !resolveCareerReliefMount(this.profile) ? '需要一匹目前軍階可使用的自有坐騎' : '50 人騎兵救援隊（含玩家） · 殲滅 60 名敵軍 · 玩家戰死後可繼續觀戰'
      relief.append(reliefTitle, reliefDetails)
      if (reliefUnlocked && resolveCareerReliefMount(this.profile)) this.button(relief, '接受騎兵救援', () => this.acceptOutpostRelief())
      panel.append(relief)
    }
    const missions = availableCareerMissionsForPage(this.profile, selectedPage)
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
        ? `${template.briefing}\n敵方 Career Town · 軍事守軍 63 · 平民 20 · 玩家無指揮權`
        : template.kind === 'town-defense'
        ? `${template.briefing}\n所屬 Career Town\n玩家 1 · AI 守軍 63（駐軍 ${template.friendlySoldiers}、隊長、Maki、士官長）\n敵方 T2 騎兵 ${template.enemyCount} · 平民傷亡上限 ${template.maxCivilianDeaths} · 風險 ${template.risk}`
        : template.kind === 'patrol'
          ? `${template.briefing}\n路線 ${template.routeId === 'south-road' ? '南路' : '森林線'}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlyCombatants - 2} · 友軍總數 ${template.friendlyCombatants}\n任務內容 沿線巡查 · 風險 ${template.risk}`
          : `${template.briefing}\n城外 Bandit Camp ${template.preferredCampIndex + 1}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlySoldiers} · 友軍總數 ${template.friendlyCombatants}\nBandits ${template.banditCount} · 風險 ${template.risk}`
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
    const veteranWins = careerMissionCompletionsForTier(this.profile, 3)
    const unlocked = availableCareerMissionsForPage(this.profile, 'veteran').some(template => template.id === homeDefense.id)
    const row = document.createElement('article'); row.className = 'town-product'
    const title = document.createElement('strong'); title.textContent = homeDefense.name
    const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
    details.textContent = `${homeDefense.briefing}\n老兵任務勝利 ${Math.min(veteranWins, homeDefense.requiresCompletions)}/${homeDefense.requiresCompletions} · 友軍 64 人（含玩家） · 敵方 T2 騎兵 ${homeDefense.enemyCount} · 平民傷亡上限 ${homeDefense.maxCivilianDeaths}`
    const accept = document.createElement('button'); accept.className = 'town-button'
    accept.textContent = unlocked ? '接受守城任務' : `需 ${homeDefense.requiresCompletions} 次老兵任務勝利 · ${Math.min(veteranWins, homeDefense.requiresCompletions)}/${homeDefense.requiresCompletions}`
    accept.disabled = !unlocked
    accept.onclick = () => this.acceptMission(homeDefense.id)
    row.append(title, details, accept); panel.append(row)
  }
  private acceptVeteranCareerMission(templateId: string): void {
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
      const launch = createCareerVeteranOutpostLaunch(next)
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
      progress.textContent = ([1, 2, 3, 4] as const).map(tier => `T${tier} ${isCareerDuelUnlocked(this.profile, preset.id, tier) ? '已解鎖' : 'Locked'}`).join(' · ')
      button.onclick = () => { this.duelPresetId = preset.id; this.talk('deployment') }
      row.append(button, progress); units.append(row)
    }
    const tiers = document.createElement('h3'); tiers.textContent = `Tier · ${selected.nameEn}`; panel.append(tiers)
    for (const tier of [1, 2, 3, 4] as const) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = `T${tier} ${selected.nameEn}`
      const details = document.createElement('small')
      const unlocked = isCareerDuelUnlocked(this.profile, selected.id, tier)
      details.textContent = unlocked ? `5 秒準備 · 30 秒內擊敗對手${tier === 4 ? selected.traits.includes('bow_fire') ? ' · Maki 出戰' : ' · Captain 出戰，Maki 裁判' : ''}` : `先擊敗 T${tier - 1} ${selected.nameEn}`
      const accept = document.createElement('button'); accept.className = 'town-button'; accept.textContent = unlocked ? '接受單挑' : 'Locked'; accept.disabled = !unlocked
      accept.onclick = () => this.acceptDuel(selected.id, tier)
      row.append(title, details, accept); panel.append(row)
    }
  }
  private acceptDuel(presetId: UnitPresetId, tier: UnitTier): void {
    const fresh = this.store.load()
    if (!fresh || this.player.dead || this.event.hostile || !isCareerDuelUnlocked(fresh, presetId, tier) || fresh.activeMission || fresh.activeOutpostMission || fresh.townEvent?.state === 'hostile') {
      this.openPanel('無法接受單挑', '生涯存檔已變更、該兵種 Tier 尚未解鎖，或目前正在交戰。'); return
    }
    const mission = this.duel.createMission(presetId, tier)
    if (!mission) { this.openPanel('無法接受單挑', '目前沒有可出戰的城鎮士兵。'); return }
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('單挑保存失敗', '單挑尚未開始。請確認瀏覽器儲存空間後重試。'); return }
    this.playMissionVoice('missionAccepted')
    if (!this.duel.startActiveMission()) { this.openPanel('單挑部署失敗', '任務已保存，重新載入可恢復同一場單挑。'); return }
    this.clearMissionCombatShots()
    this.inventory.prepareForCombat()
    this.notice = '已接受單挑。前往兵營與 Captain 集合。'
    this.closePanel()
  }
  private acceptOutpostRelief(): void {
    const fresh = this.store.loadChecked().profile
    const next = fresh && acceptCareerOutpostRelief(fresh)
    if (!next) { this.openPanel('無法接受任務', '需完成 Outpost I–III、擁有合法坐騎且沒有進行中的任務。'); return }
    const launch = createCareerOutpostLaunch(next)
    if (!this.commit(next)) return
    this.dispose(true)
    this.onCampaign(launch)
  }

  private acceptOutpost(stageId: CareerOutpostStageId): void {
    const fresh = this.store.loadChecked().profile
    if (!fresh) { this.openPanel('無法接受任務', '無法讀取 Career profile。'); return }
    const next = acceptCareerOutpost(fresh, stageId)
    if (!next) { this.openPanel('無法接受任務', '任務尚未解鎖或已有任務進行中。'); return }
    const launch = createCareerOutpostLaunch(next)
    if (!this.commit(next)) return
    this.dispose(true)
    this.onCampaign(launch)
  }

  private restoreActiveCareerMission(): void {
    let { profile } = this
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
      if (profile.activeMission.kind === 'duel') {
        this.duel.startActiveMission()
      } else if (profile.activeMission.kind === 'town-defense' || profile.activeMission.kind === 'enemy-town-assault') {
        if (!profile.activeMission.result || profile.activeMission.phase === 'RETURNING') this.defense.startActiveMission()
      } else {
        this.mission.startActiveMission()
      }
      profile = this.profile
      const active = profile.activeMission!
      if (!active.result || active.phase === 'RETURNING') this.inventory.prepareForCombat()
      const assaultAnchor = active.kind === 'enemy-town-assault' ? this.player.combatPosition.clone() : null
      this.careerMounts.restoreActiveMount()
      if ((active.kind === 'cavalry-sweep' || active.kind === 'veteran-field') && this.player.currentMount) {
        this.player.currentMount.group.rotation.y = active.kind === 'veteran-field' ? veteranPlayerYaw(active.templateId) : SWEEP_YAW
      }
      if (active.kind === 'enemy-town-assault') {
        if (!active.result && !active.playerDead && !active.mountState && profile.selectedMountId) this.careerMounts.activate(profile.selectedMountId)
        if (this.player.currentMount) {
          this.player.currentMount.group.position.copy(assaultAnchor!)
          this.player.currentMount.group.rotation.y = Math.PI
        }
      }
      if (active.kind === 'veteran-field' && !active.playerDead) {
        if (active.playerHp !== undefined) this.player.setHp(active.playerHp)
        if (active.playerStamina !== undefined) this.player.setStamina(active.playerStamina)
      }
      if (active.playerDead || active.result?.stats.survived === false) {
        this.player.dismountFromMount()
        this.player.takeDamage(this.player.maxHp * 100, this.hp)
      }
    }
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
      this.dispose(); this.onRestart(next)
      return
    }
    if (template.kind === 'town-defense') {
      const defenders = this.residents.filter(resident => resident.spec.defenseGroup).map(resident => resident.spec.id)
      const captain = this.residents.find(resident => resident.spec.role === 'captain')?.spec.id
      const ranger = this.residents.find(resident => resident.spec.role === 'ranger')?.spec.id
      const deployment = this.residents.find(resident => resident.spec.role === 'deployment')?.spec.id
      const civilians = this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.spec.id)
      if (defenders.length !== 60 || !captain || !ranger || !deployment || civilians.length !== 20) { this.openPanel('任務建立失敗', '城鎮駐軍或平民名單不完整。'); return }
      const mission = createTownDefenseMission([...defenders, captain, ranger, deployment], civilians, undefined, template.id, fresh.rank)
      const next = cloneCareerProfile(fresh); next.activeMission = mission
      if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
      if (!this.defense.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，但城防部署無法建立。重新載入後可恢復同一 missionId。'); return }
      this.inventory.prepareForCombat()
      this.notice = '警報！敌軍正在接近。前往主防線集合。'
      void this.playTownDefenseAlert()
      this.closePanel()
      return
    }
    const preferredCamp = template.kind === 'patrol' ? patrolPreferredCamp(template.routeId) : template.preferredCampIndex
    const campId = this.mission.chooseCamp(preferredCamp)
    if (campId === null) { this.openPanel('地區暫時無法接取', '附近營地仍在交戰，請先脫離戰鬥或稍後選擇其他任務。'); return }
    const mission = this.mission.createMission(template, campId)
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
    if (!this.mission.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，但隊伍無法建立。重新載入後可用同一個 missionId 恢復。'); return }
    this.inventory.prepareForCombat()
    this.notice = `已接受 ${template.name}。前往兵營外集合。`
    this.playMissionVoice('missionAccepted')
    this.closePanel()
  }
  private unavailableTownCavalryActorIds(): ReadonlySet<string> {
    return new Set(this.residents.filter(({ spec }) => this.patrol && !this.patrol.isReserveAvailable(spec.id))
      .map(({ npc }) => npc.combatantId))
  }
  private applyCareerPlayerIdentity(): void {
    const hero = resolveCareerHeroAsset(this.profile)
    if (this.player.heroAssetId === hero) return
    const old = this.player
    const position = old.group.position.clone()
    const facing = old.facingYaw
    const oldHp = old.hp
    const oldMaxHp = old.maxHp
    const stamina = old.staminaValue
    const arrows = old.arrowCount
    const mount = old.currentMount
    const mountHeading = mount?.group.rotation.y
    const cameraYaw = this.orbit.cameraYaw
    const cameraPitch = this.orbit.cameraPitch
    if (mount) old.dismountFromMount()
    old.dispose()
    this.player = new Player(this.scene, this.profile.faction, hero)
    this.bindBlockingProgression()
    const newMaxHp = resolveCareerPlayerMaxHp(this.profile, DEFAULT_PLAYER_MAX_HP)
    this.player.setMaxHp(newMaxHp, true)
    this.player.group.position.copy(position)
    this.player.faceDirection(Math.sin(facing), Math.cos(facing))
    this.player.setHp(preserveHpRatio(oldHp, oldMaxHp, newMaxHp))
    this.player.setStamina(stamina)
    this.player.setArrowCount(arrows)
    this.player.onPlayerDeath = () => this.enterMissionObserver()
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, true, false, event.visualKind)
    if (mount && !mount.dead) this.player.mountVehicle(mount, mountHeading)
    this.orbit = new ThirdPersonCamera(this.camera, this.player); this.orbit.setYaw(cameraYaw); this.orbit.setPitch(cameraPitch)
    this.player.update(0, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
    this.hp.setFill(this.player.hpRatio)
  }
  private finishMission(outcome: CareerMissionOutcome): void {
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
    const zeroMeritReason = merit.total !== 0 ? '' : result.stats.damageDealt > 0
      ? `\n\n有效傷害未達 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點軍功門檻；本次軍功為 0。`
      : '\n\n本次未對任務目標造成有效貢獻。個人軍功：0'
    const panel = this.openPanel(result.defense ? `Town Defense · ${complete ? 'SUCCESS' : 'FAILURE'}` : complete ? 'MISSION COMPLETE' : 'MISSION FAILED', `玩家統計 PLAYER\nDamage ${Math.round(result.stats.damageDealt)}\nKills ${result.stats.kills}\nSurvived ${result.stats.survived ? 'Yes' : 'No'}${defenseText}\n\nMilitary Merit\n每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功\nDamage merit ${merit.damage}\nKill merit ${merit.kills}\nMission contribution merit ${merit.contribution}\nTotal ${merit.total}${zeroMeritReason}`)
    this.button(panel, '返回 Career Town', () => this.returnToTown('direct'))
    if (this.profile?.activeMission?.kind === 'duel') {
      if (complete && result.stats.survived) this.button(panel, '跟隊長走回去', () => {
        if (!this.duel.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
        this.clearMissionCombatShots()
        this.missionResultOpen = false
        this.closePanel()
      })
      return
    }
    if (!result.defense && this.profile?.activeMission?.kind !== 'enemy-town-assault' && !isCareerEnemyTerritoryFieldMission(this.profile?.activeMission) && complete && result.stats.survived) this.button(panel, this.mission.friendlies.some(npc => !npc.dead) ? '跟隊伍走回去' : '自行走回小鎮', () => {
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
    if (this.spectator) {
      this.spectator = null
      document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · 滾輪 換裝 · 右鍵 舉盾／瞄準 · Tab 裝備 · E 交談 · Q / Esc 關閉面板'
      this.orbit.update(this.input)
    }
    this.hp.setFill(1)
    this.stamina.setFill(1)
    this.quiver.setArrowCount(this.player.arrowCount)
  }
  private returnToTown(intent: 'direct' | 'arrived'): void {
    const returned = this.missionSettlement.returnToTown(intent)
    if (returned.status === 'ignored' || returned.status === 'restarted') return
    if (returned.status === 'save-failed') {
      const message = returned.destination === 'defense' ? '守城結算仍安全保留。請重試，軍功不會重複發放。'
        : returned.destination === 'party' ? '隊伍已返抵小鎮，但任務結算尚未寫入。請重試，軍功不會重複發放。'
        : '任務結算仍安全保留。請重試保存後返回小鎮。'
      const panel = this.openPanel('返回狀態尚未保存', message)
      this.button(panel, returned.destination === 'restart' ? '重試返回小鎮' : '重試原地結算', () => this.returnToTown(returned.destination === 'party' ? 'arrived' : 'direct'))
      return
    }
    this.missionResultOpen = false
    this.target = null
    this.hasPreviousTip = false
    this.notice = returned.kind === 'defense' ? '守城結束。駐軍與居民已歸位，城鎮服務恢復。'
      : returned.kind === 'sweep' ? '清剿結束。駐軍已返營，臨時騎兵正在離開。'
      : '隊伍已整隊返營。駐軍歸位，馬廄與城鎮服務已恢復。'
    if (this.panel) this.closePanel()
  }
  private serviceAvailable(id: string): boolean {
    if (this.sceneContext.missionOnlyResidents) return false
    if (this.duel?.active && (id === 'captain' || id === 'ranger' || id === 'cat')) return false
    if (this.defense?.servicesLocked) return false
    if (id === 'captain' && this.mission?.missionLeader) return false
    if (this.event.actors.get(id)?.dead) return false
    const building = id === 'merchant' ? 'weapons' : id === 'ranger' || id === 'cat' ? 'stable' : null
    return !building || !this.world.buildings.find(b => b.id === building)?.hp.destroyed
  }
  /** Persist before applying the first effective hit; failure leaves the target unchanged. */
  private prepareDamage(): boolean {
    if (this.event.hostile) return true
    const active = this.profile.activeMission
    if (this.defense?.active) return false
    const p = active ? clearCareerMission(this.profile, active.id) : cloneCareerProfile(this.profile)
    p.townEvent = { id: crypto.randomUUID(), state: 'hostile' }
    if (!this.commit(p)) return false
    if (active) {
      this.temporaryMounts.cleanup()
      this.mission.cleanupMission(active.targetCampId)
      this.clearMissionCombatShots()
      this.missionResultOpen = false
    }
    return true
  }
  private activateHostility(shout = true): void {
    if (this.event.hostile) return
    this.event.hostile = true
    // A real hit must not cancel the current swing or clear held movement / Shift keys.
    if (this.panel || this.equipment.visible) this.closePanel()
    this.notice = '全鎮反擊！所有服務停止。'
    this.patrol?.stopForHostility()
    for (const r of this.residents) r.npc.beginTownHostility()
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
    const combatActive = !this.result && (this.event?.hostile || Boolean(active && !active.result && active.phase !== 'RETURNING'))
    const combatId = active?.id ?? this.profile.townEvent?.id ?? 'field'
    if (combatActive) for (const resident of this.residents ?? []) {
      const mount = resident.homeMount
      if (resident.npc.dead && mount && !mount.dead && mount !== owned
        && mount !== this.cat && !(this.stableHorses ?? []).includes(mount)) this.temporaryMounts.track(mount, combatId)
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
    // Outskirts mounts keep their controller's lifetime, independently of mission settlement.
    for (const mount of this.outskirts?.mounts ?? []) add(mount)
    for (const mount of this.temporaryMounts.all) add(mount)
    add(owned)
    for (const npc of [...(this.residents ?? []).map(r => r.npc), ...(this.mission?.fieldNpcs ?? []), ...(this.defense?.fieldNpcs ?? []), ...(this.duel?.fieldNpcs ?? []), ...(this.outskirts?.actors ?? [])]) {
      npc.combatMountGrid = this.combatMountGrid
    }
  }
  private hitBattlefieldMount(mount: Mount, amount: number, method: CombatDamageMethod, source?: NPC, contact?: CombatContact): void {
    if (mount.dead || mount.disposed || amount <= 0) return
    if (!this.profile.activeMission && !this.event?.hostile && this.mounts.includes(mount) && !source) {
      this.hitResident(mount, amount, method, contact)
      return
    }
    const rider = mount.riderNpc
    const result = damageMount(mount, amount, {
      contact, source: source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player), method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined
        : (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: this.duel?.active ? this.duel.events.emit : this.defense.active ? this.defense.events.emit : this.mission.events.emit,
    })
    if (result.appliedDamage > 0 && rider && this.outskirts?.owns(rider)) {
      this.outskirts.noteHit(rider, !source)
    }
    if (!source && result.appliedDamage > 0) {
      this.awardCareerSkillXp(method, result.appliedDamage)
      this.damageNumbers.spawn(result.appliedDamage, mount.group.position.clone().add(new THREE.Vector3(0, 1, 0)))
      this.showCombatTarget(result.targetName, result.hpRatio)
    }
    if (result.hitSuccess) {
      if (method === 'projectile') sound?.playProjectileImpact(mount.currentLod, !source)
      else sound?.playSwordHit(mount.currentLod, !source)
    }
  }
  private showCombatTarget(name: string, ratio: number): void {
    if (typeof document === 'undefined') return
    const hud = document.getElementById('enemy-hud'), label = document.getElementById('enemy-name'), fill = document.getElementById('enemy-hp-fill')
    if (label) label.textContent = name
    if (fill) fill.style.width = `${Math.max(0, ratio * 100)}%`
    hud?.classList?.add('visible')
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
  private isProtectedTownAlly(target: NPC | Mount): boolean {
    if (target instanceof NPC && this.outskirts?.owns(target)) return !target.hostileToPlayer
    if (isCareerEnemyTerritoryFieldMission(this.profile?.activeMission) && (target === this.cat || (this.stableHorses ?? []).includes(target as Mount))) return true
    const active = this.profile?.activeMission
    if (active?.kind === 'town-defense' || active?.kind === 'enemy-town-assault') {
      if (target instanceof NPC) return target.faction !== Faction.ENEMY && target.faction !== Faction.BANDIT
      return target === this.cat || (this.stableHorses ?? []).includes(target)
        || (this.residents ?? []).some(resident => resident.homeMount === target)
    }
    const ally = target instanceof NPC
      ? target
      : target.riderNpc ?? (this.residents ?? []).find(resident => resident.homeMount === target)?.npc
    return Boolean(ally && (this.mission?.friendlies?.includes(ally) || this.missionCombat?.isExternalThreatDefender(ally)))
  }
  private hitResident(npc: NPC | Mount, amount: number, method: CombatDamageMethod = 'melee', contact?: CombatContact): void {
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
      if (applied > 0) this.awardCareerSkillXp(method, applied)
    } else {
      const result = damageMount(npc, amount, { source: createPlayerCombatActorRef(this.player), method, contact })
      applied = result.appliedDamage
      if (applied > 0) this.awardCareerSkillXp(method, applied)
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
  private damageBuilding(index: number, amount: number, hitPosition?: THREE.Vector3): void {
    if (this.duel?.active) return
    const b = this.world.buildings[index]; if (!b || b.hp.destroyed || !Number.isFinite(amount) || amount <= 0) return
    const townOwned = b.ownerFaction === Faction.TOWN
    if (townOwned && this.profile?.activeMission?.kind === 'town-defense') return
    if (this.defense?.assault && this.defense.phase === 'PREPARING') return
    if (townOwned && !this.defense?.assault && !this.prepareDamage()) return
    const position = hitPosition ?? b.hp.root.getWorldPosition(new THREE.Vector3())
    const { appliedDamage } = b.hp.takeDamage(amount)
    if (appliedDamage <= 0) return
    if (this.defense?.assault && townOwned) emitStructureDamage({ source: createPlayerCombatActorRef(this.player), method: 'melee', weaponId: this.inventory.equippedMelee?.id, emit: this.defense.events.emit }, { targetId: b.id, targetType: 'structure', name: b.id, allegiance: Faction.ENEMY, structureKind: b.hp.kind }, amount, appliedDamage, b.hp.hpRatio, b.hp.destroyed)
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
    const deadActorIds = [...this.event.allActors].filter(([, actor]) => actor.dead).map(([id]) => id)
    const destroyedBuildingIds = this.world.buildings.filter(b => b.ownerFaction !== Faction.BANDIT && b.hp.destroyed).map(b => b.id)
    if (deadActorIds.length === (current.deadActorIds?.length ?? 0) && destroyedBuildingIds.length === (current.destroyedBuildingIds?.length ?? 0)) return
    const next = cloneCareerProfile(this.profile)
    next.townEvent = { ...current, deadActorIds, destroyedBuildingIds }
    if (!this.commit(next)) {
      const panel = this.openPanel('事件保存失敗', '本次死亡／破壞尚未保存。重試成功後繼續；重新載入可能丟失這次變化，但追擊不會解除。')
      this.button(panel, '重試保存事件', () => { if (this.commit(next)) this.closePanel() })
    }
  }
  private hitFieldNpc(target: NPC, amount: number, method: CombatDamageMethod, source?: NPC, contact?: CombatContact): void {
    contact ??= method === 'melee' ? (source ?? this.player).weaponSweep?.contact : undefined
    if (contact?.kind === 'mount' && contact.mount) {
      this.hitBattlefieldMount(contact.mount, amount, method, source, contact)
      return
    }
    if (this.duel?.active && (source || !this.duel.canDamageOpponent(target))) return
    if (target.dead || amount <= 0 || this.defense?.phase === 'PREPARING') return
    if (!source && this.outskirts?.owns(target) && this.isProtectedTownAlly(target)) return
    if (source && !townWartimeHostile(source, target)) return
    if (this.defense?.active && !source && target.faction !== Faction.ENEMY && target.faction !== Faction.BANDIT) return
    const playerAmount = !source && method === 'mount-impact'
      ? Math.round(amount * this.skills.getMountedImpactMultiplier())
      : amount
    const result = damageNpc(target, playerAmount, {
      contact: contact ?? (method === 'melee' ? (source ?? this.player).weaponSweep?.contact : undefined),
      source: source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player),
      method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined : (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: this.duel?.active ? this.duel.events.emit : this.defense.active ? this.defense.events.emit : this.mission.events.emit,
    })
    if (!result.hitSuccess) return
    if (result.appliedDamage > 0) {
      this.outskirts?.noteHit(target, !source)
      if (this.outskirts?.owns(target) || source && this.outskirts?.owns(source)) {
        this.missionCombat?.noteExternalHit(target, source)
      }
    }
    if (!source) this.awardCareerSkillXp(method, result.appliedDamage)
    if (this.defense.active && (this.defense.assault || source?.faction === Faction.ENEMY)) this.defense.noteEffectiveFriendlyDamage(target)
    if (method === 'projectile') sound?.playProjectileImpact(target.currentLod, !source)
    else if (method === 'mount-impact') sound?.playHorseImpact(target.currentLod, !source)
    else if ((source?.meleeCombatKind ?? this.inventory.equippedMelee?.combatKind) === 'lance') sound?.playLanceImpact(target.currentLod, !source)
    else sound?.playSwordHit(target.currentLod, !source)
    if (target.faction === Faction.BANDIT) {
      if (source) this.mission.alertGroupFor(target)
      else this.mission.provokeGroupFor(target)
    }
    if (!source && !(this.defense.active && target.townCategory === 'civilian') && !target.dead && (target.faction === Faction.BANDIT || target.faction === Faction.ENEMY)) target.retaliateAgainstPlayer()
    if (!source) {
      if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
      this.showCombatTarget(result.targetName, result.hpRatio)
    }
  }
  private damagePlayerFromNpc(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.duel?.active && !this.duel.canDamagePlayer(source)) return
    if (this.defense?.phase === 'PREPARING' || this.defense?.active && !source.hostileToPlayer) return
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined),
      hostileToTarget: source.hostileToPlayer || Boolean(this.duel?.canDamagePlayer(source)),
      source: createNpcCombatActorRef(source), method, weaponId: (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined, emit: this.duel?.active ? this.duel.events.emit : this.defense.active ? this.defense.events.emit : this.mission.events.emit,
    })
    if (result.appliedDamage <= 0) return
    if (method === 'projectile') sound?.playProjectileImpact(0, true)
    else if (method === 'mount-impact') sound?.playHorseImpact(0, true)
    else if (source.meleeCombatKind === 'lance') sound?.playLanceImpact(0, true)
    else sound?.playSwordHit(0, true)
  }
  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, player: boolean, training: boolean, kind: 'arrow' | 'pilum', source?: NPC): void {
    if (!training && this.duel?.active && (!this.duel.combatEnabled || !player && (!source || !this.duel.canDamagePlayer(source)))) return
    if (player && this.player.dead || !training && this.defense?.phase === 'PREPARING') return
    if (this.shots.length >= 100 || training && this.shots.filter(s => s.training).length >= 60) return
    const shooterFaction = player ? Faction.PLAYER : source?.faction ?? Faction.ENEMY
    this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, shooterFaction, player, kind), training, player, source, age: 0 })
    if (!training && kind === 'arrow') sound?.playBowRelease(player ? 0 : source?.currentLod ?? 0, player, player ? 0 : origin.distanceTo(this.player.combatPosition))
  }
  /** Physical participants never become mission objective, checkpoint or contribution rosters. */
  private runtimeCombatActors(): NPC[] {
    return [...new Set([
      ...(this.residents ?? []).map(resident => resident.npc),
      ...(this.mission?.fieldNpcs ?? []), ...(this.defense?.fieldNpcs ?? []),
      ...(this.missionCombat?.enemyTownHostiles ?? []), ...(this.outskirts?.actors ?? []),
    ])]
  }
  private updateShots(dt: number): void {
    const runtimeActors = this.outskirts?.actors.length ? this.runtimeCombatActors() : null
    for (const s of this.shots) {
      if (!s.arrow.isAlive) continue
      const from = s.arrow.mesh.position.clone(); s.age += dt
      s.arrow.update(dt, this.player, [], [], () => {}, damage => damagePlayer(this.player, damage, this.hp, null), undefined, true)
      const to = s.arrow.mesh.position, delta = to.clone().sub(from), length = delta.length(), ray = new THREE.Ray(from, delta.normalize())
      if (s.training) { if (s.age > .3) s.arrow.destroy(); continue }
      let nearest = length + .01, hit: (() => void) | null = null
      for (const obstacle of this.world.obstacles) {
        for (const box of obstacle.projectileBoxes?.length ? obstacle.projectileBoxes : [obstacle.box]) {
          const p = ray.intersectBox(box, new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
          if (distance < nearest) {
            nearest = distance
            const buildingIndex = this.world.buildings.findIndex(building => building.obstacles.includes(obstacle))
            hit = () => { if (s.player && buildingIndex >= 0) this.damageBuilding(buildingIndex, s.arrow.damage, p!) }
          }
        }
      }
      for (const target of this.world.targets) {
        const p = ray.intersectSphere(new THREE.Sphere(target, .6), new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => {} }
      }
      const targets: Array<Player | NPC | Mount> = this.duel?.active
        ? s.player ? this.duel.opponent ? [this.duel.opponent] : [] : s.source === this.duel.opponent ? [this.player] : []
        : runtimeActors
          ? s.player
            ? runtimeActors.filter(target => !this.isProtectedTownAlly(target))
            : s.source
              ? [...(s.source.hostileToPlayer ? [this.player] : []), ...runtimeActors.filter(target => townWartimeHostile(s.source!, target))]
              : [this.player]
        : s.player
        ? [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.playerEnemies,
          ...[...this.residents.map(r => r.npc), ...this.townServiceMounts].filter(target => !this.isProtectedTownAlly(target))]
        : s.source && (this.mission.missionBandits.includes(s.source) || this.mission.ambientBandits.includes(s.source) || this.mission.friendlies.includes(s.source) || this.missionCombat?.enemyTownHostiles?.includes(s.source))
          ? [...(s.source.hostileToPlayer || this.mission.missionBandits.includes(s.source) || this.mission.ambientBandits.includes(s.source) ? [this.player] : []),
            ...[...this.mission.combatPeersFor(s.source), ...(this.missionCombat?.enemyTownHostiles ?? [])].filter(npc => npc.faction !== s.source!.faction)]
          : this.defense.active && s.source
            ? [...(s.source.hostileToPlayer ? [this.player] : []), ...this.defense.peersFor(s.source), ...(!this.defense.assault && s.source.faction === Faction.ENEMY && this.cat && !this.cat.dead ? [this.cat] : [])]
          : s.source?.faction === Faction.TOWN
            ? s.source.hostileToPlayer
              ? [this.player]
              : this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
          : s.source?.faction === Faction.PLAYER
            ? this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
            : [this.player]
      targets.push(...this.combatMounts.filter(mount => mount !== this.player.currentMount || !s.player))
      for (const target of targets) {
        if (target instanceof Mount && (target.disposed || target.riderNpc === s.source || target.riderPlayer === this.player && s.player)) continue
        if (target.dead) continue
        const broadPosition = target.group.position
        if (broadPosition.distanceToSquared(from) > (length + 4) ** 2) continue
        const contact: CombatContact = { kind: 'body', time: Infinity }
        const distance = traceCombatSegment(target, from, to, contact) ? contact.time * length : Infinity
        if (distance < nearest) { nearest = distance; hit = () => {
          if (contact.kind === 'mount' && contact.mount) this.hitBattlefieldMount(contact.mount, s.arrow.damage, 'projectile', s.source, contact)
          else if (target instanceof Player && s.source) this.damagePlayerFromNpc(s.source, s.arrow.damage, 'projectile', contact)
          else if (target instanceof NPC && (this.duel?.isMissionTarget(target) || target.faction === Faction.BANDIT || target.faction === Faction.ENEMY || Boolean(s.source && target.faction !== s.source.faction))) this.hitFieldNpc(target, s.arrow.damage, 'projectile', s.source, contact)
          else if (target === this.cat && this.defense.active && s.source?.faction === Faction.ENEMY) {
            this.cat.takeDamage(s.arrow.damage)
            if (this.cat.dead && this.ranger.mount === this.cat) this.ranger.dismountFromMount()
          }
          else if (target instanceof NPC || target instanceof Mount) this.hitResident(target, s.arrow.damage, 'projectile', contact)
        } }
      }
      if (hit) { hit(); s.arrow.destroy() }
      if (s.age > 5 || to.y < getTerrainHeight(to.x, to.z)) s.arrow.destroy()
    }
    this.shots = this.shots.filter(s => s.arrow.isAlive)
  }
  private melee(): void {
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
    if (buildingHit >= 0) { this.player.markHitProcessed(); this.damageBuilding(buildingHit, damageResult.damage, buildingHitPosition); return }
    if (this.world.targets.some(p => p.distanceTo(tip) < .8)) { this.player.markHitProcessed(); return }
    const combatTargets = this.duel?.active ? this.duel.opponent ? [this.duel.opponent] : []
      : this.outskirts?.actors.length ? this.runtimeCombatActors().filter(target => !this.isProtectedTownAlly(target))
      : [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.playerEnemies,
        ...(this.missionCombat?.enemyTownHostiles ?? []),
        ...this.residents.map(r => r.npc).filter(target => !this.isProtectedTownAlly(target))]
    const targets = combatTargets.filter(target => !target.dead
      && target.combatPosition.distanceToSquared(this.player.combatPosition) <= ((weapon.range ?? 1.8) + 4) ** 2)
    const mounts = this.combatMountGrid.getNearbyInto(this.player.combatPosition, (weapon.range ?? 1.8) + 4, this.meleeMountCandidates)
    const contact = this.player.weaponSweep.traceFirst(targets, mounts, this.player.currentMount)
    if (!contact) return
    this.player.markHitProcessed()
    const target = contact.target as NPC | Mount
    const amount = Math.round(damageResult.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, contact.kind === 'mount' || target.isMounted))
    if (contact.kind === 'mount' && contact.mount) this.hitBattlefieldMount(contact.mount, amount, 'melee', undefined, contact)
    else if (target instanceof NPC) {
      if (this.duel?.isMissionTarget(target) || this.outskirts?.owns(target) || target.faction === Faction.BANDIT || target.faction === Faction.ENEMY) this.hitFieldNpc(target, amount, 'melee', undefined, contact)
      else this.hitResident(target, amount, 'melee', contact)
    }
    if (damageResult.isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
  }

  private resolveBodies(): void {
    if (this.player.dead) return
    const playerBody = { position: this.player.group.position, radius: .42, height: 1.8, bottomOffset: .9 }
    for (const r of this.residents) {
      if (this.mission.friendlies.includes(r.npc) || this.duel?.isMissionActor(r.npc)) continue
      if (r.npc.dead) continue
      const position = r.npc.mount?.group.position ?? r.npc.group.position
      if (Math.hypot(position.x - playerBody.position.x, position.z - playerBody.position.z) > 3) continue
      resolveEntityCollision(playerBody, { position, radius: r.npc.mount ? .95 : .42, height: r.npc.mount ? 2.8 : 1.8, bottomOffset: 0, anchored: true }, this.world.obstacles)
    }
    for (const mount of this.townServiceMounts) if (!mount.dead) resolveEntityCollision(playerBody, { position: mount.group.position, radius: .85, height: 2, bottomOffset: 0, anchored: true }, this.world.obstacles)
    for (const npc of [...this.mission.fieldNpcs, ...this.defense.fieldNpcs, ...(this.duel?.fieldNpcs ?? []), ...(this.outskirts?.actors ?? [])]) if (!npc.dead && npc.combatPosition.distanceTo(this.player.combatPosition) < 3) resolveEntityCollision(playerBody, { position: npc.combatPosition, radius: .42, height: 1.8, bottomOffset: 0, anchored: false }, this.world.obstacles)
    this.player.group.position.y = Math.max(this.player.group.position.y, getTerrainHeight(this.player.group.position.x, this.player.group.position.z) + .9)
  }
  private updateAmbient(): void {
    if (this.sceneContext.missionOnlyResidents || this.event.hostile || this.defense.active || this.panel || this.equipment.visible || this.result) { this.ambientLabel.hidden = true; return }
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
  private updatePeace(r: Resident, dt: number): void {
    if (this.patrol?.updateResident(r, dt, this.camera.position, this.world.obstacles, this.navigation)) return
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
      const walking = Math.sin(phase * .3) > .5
      if (walking) r.walkTime += dt
      const angle = r.walkTime * .35 + spec.index, x = spec.x + Math.sin(angle) * .65, z = spec.z + Math.cos(angle) * .65
      speed = walking ? .23 : 0;
      const previous = npc.group.position.clone()
      npc.group.rotation.y = Math.atan2(Math.cos(angle), -Math.sin(angle)); npc.group.position.set(x, getTerrainHeight(x, z), z)
      resolveObstacleCollision(npc.group.position, previous, 0, true, .42, 1.8, 0, this.world.obstacles)
      npc.group.position.y = getTerrainHeight(npc.group.position.x, npc.group.position.z)
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
    const actors = [...(this.duel?.active ? this.duel.fieldNpcs : this.defense.active ? this.defense.fieldNpcs : this.mission.fieldNpcs), ...(this.outskirts?.actors ?? [])]
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
  }
  private updateHostile(dt: number): void {
    this.navigation.sync(this.world.obstacles); this.navigation.beginFrame()
    this.missionCombat.updateOutskirtsHostile(dt, this.elapsed)
    if (this.npcObstacles.length !== this.world.obstacles.length || this.npcObstacleRevision !== obstacleTopologyRevision(this.world.obstacles)) {
      this.npcObstacles = this.world.obstacles.map(o => ({ box: o.box, isBarricade: o.isBarricade }))
      this.npcObstacleRevision = obstacleTopologyRevision(this.world.obstacles)
    }
    this.grid.clear(); for (const r of this.residents) if (!r.npc.dead) this.grid.insert(r.npc)
    const ranger = this.ranger, status = updateRangerMount(ranger, this.cat, ranger.combatPosition.distanceTo(this.cat.group.position))
    this.cat.catVisual?.setEquipmentVisible(status === 'mounted')
    for (const r of this.residents) {
      if (r.npc === ranger && status === 'approach') {
        const dir = this.cat.group.position.clone().sub(ranger.group.position); dir.y = 0; ranger.group.position.addScaledVector(dir.normalize(), dt * 3.5); ranger.group.position.y = getTerrainHeight(ranger.group.position.x, ranger.group.position.z); ranger.group.rotation.y = Math.atan2(dir.x, dir.z); ranger.updateTownPeace(dt, ranger.group.position.distanceTo(this.camera.position), false, false, 3.5); continue
      }
      const warfare = Boolean(this.outskirts?.actors.length)
      r.npc.update(dt, this.player, warfare ? this.missionCombat.runtimeParticipants : [],
        this.grid.getNearbyInto(r.npc.combatPosition, 2, this.neighbors), this.npcObstacles, this.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.damagePlayerFromNpc(r.npc, damage, 'melee')
          else if (targetNpc) this.hitFieldNpc(targetNpc, damage, 'melee', r.npc)
        }, (origin, direction, kind) => this.fire(origin, direction, r.npc.rangedProjectileSpeed, r.npc.rangedDamage, false, false, kind, r.npc), false,
        r.npc.group.position.distanceTo(this.camera.position), null, warfare ? this.missionCombat.runtimeGrid : null, this.navigation)
    }
    for (const mount of this.mounts) if (!mount.dead && mount.riderNpc && checkMountImpact(mount, this.player.combatPosition, .6)) {
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
    if (!this.player.isMounted) {
      let mountDistance = 3
      for (const mount of [...this.temporaryMounts.all, ...(this.outskirts?.mounts ?? [])]) {
        if (!mount.availableForPlayer) continue
        const distance = Math.hypot(mount.group.position.x - this.player.combatPosition.x, mount.group.position.z - this.player.combatPosition.z)
        if (distance < mountDistance) { mountDistance = distance; this.nearbyTemporaryMount = mount }
      }
    }
    this.target = null; let nearest = 2.6
    if (!this.event.hostile && !this.defense.active) for (const id of ['captain', 'deployment', 'merchant', 'ranger', 'cat']) {
      if (!this.serviceAvailable(id)) continue
      const pos = id === 'cat' ? this.cat.group.position : this.residents.find(r => r.spec.id === id)!.npc.combatPosition
      const delta = pos.clone().sub(this.player.combatPosition); delta.y = 0; const distance = delta.length()
      if (distance > nearest || delta.normalize().dot(new THREE.Vector3(Math.sin(this.player.facingYaw), 0, Math.cos(this.player.facingYaw))) < .35) continue
      const start = this.player.position.clone(), end = pos.clone().add(new THREE.Vector3(0, 1, 0)), ray = new THREE.Ray(start, end.clone().sub(start).normalize())
      if (this.world.obstacles.some(o => { const hit = ray.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(start) < end.distanceTo(start) })) continue
      this.target = id; nearest = distance
    }
    this.hint.textContent = this.player.isMounted ? 'E 下馬' : this.nearbyTemporaryMount ? `E 騎乘 ${this.nearbyTemporaryMount.displayName}` : this.target ? 'E 與 ' + NAMES[this.target] + ' 交談' : this.event.hostile ? '全鎮追擊中' : this.defense.active ? '城鎮正在遭受攻擊' : ''
    this.hint.style.display = this.hint.textContent ? '' : 'none'
  }
  private finish(result: TownResult): void {
    this.result = result
    const next = settleTown(this.profile, this.profile.townEvent!.id, result)
    if (!this.commit(next)) { const p = this.openPanel('結算尚未保存', '保存失敗；尚未扣款或轉場。'); this.button(p, '重試保存', () => this.finish(result)); return }
    this.temporaryMounts.cleanup()
    const panel = this.openPanel(result === 'player_defeated' ? '弱者必須服從法律' : '小鎮已擊敗', result === 'player_defeated' ? '實際扣除 ' + next.townEvent!.penalty + ' 可用軍功，餘額 ' + next.availableMerit : '轉投 ' + next.faction + '，軍階 Recruit。本次入伍軍功歸零；歷史軍功與收藏保留。')
    this.button(panel, (result === 'player_defeated' ? '返回 ' : '前往 ') + (next.faction === 'viking' ? 'økse 村' : 'vinum 村'), () => { this.dispose(); this.onRestart(next) })
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
      this.onRestart(next)
    })
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
  private frame(time: number): void {
    if (this.disposed) return
    this.updatePointerPrompt()
    const dt = Math.min(.05, (time - this.last) / 1000); this.last = time
    // Keep the collapse playing even when death immediately opens a result panel.
    if (this.player.dead) this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
    if (!this.panel && !this.equipment.visible && !this.result) {
      this.elapsed += dt
      this.outskirts?.synchronizeRank()
      this.refreshCombatMounts()
      if (!this.player.dead && !this.spectator) {
        let step: -1 | 0 | 1
        while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
      }
      if (!this.player.dead) this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory, this.skills.getRangedMultiplier())
      this.player.group.updateWorldMatrix(true, true)
      if (!this.player.dead) this.melee()
      if (this.event.hostile) this.updateHostile(dt)
      else this.missionCombat.update(dt, this.orbit.cameraYaw, this.elapsed)
      this.missionCombat.updateDepartingCavalry(dt)
      this.updateCareerHorseAudio()
      for (const horse of this.stableHorses) if (!horse.dead) horse.horseVisual?.update(dt, horse.group.position.distanceTo(this.camera.position))
      for (const m of this.mounts) {
        m.setCameraDistance(m.group.position.distanceTo(this.camera.position))
        if (m.dead || !m.riderNpc && !m.riderPlayer && m !== this.cat && !this.stableHorses.includes(m)) m.update(dt, this.world.obstacles)
      }
      for (const mount of this.outskirts?.mounts ?? []) {
        if (mount.disposed) continue
        mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
        if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, this.world.obstacles)
      }
      if (!this.sceneContext.missionOnlyResidents && !this.event.hostile && !this.cat.dead && !this.cat.riderNpc) { this.cat.beginControlledFrame(); this.cat.finishControlledFrame(dt, this.world.obstacles) }
      this.resolveBodies(); this.updateShots(dt)
      if (this.duel?.active) this.duel.persistRuntimeProgress()
      if (this.player.dead) this.enterMissionObserver()
      if ((this.player.dead || this.profile.activeMission?.kind === 'cavalry-sweep' || this.profile.activeMission?.kind === 'veteran-field') && this.profile.activeMission && !this.profile.activeMission.result) {
        if (this.duel?.active) this.duel.persistRuntimeProgress(true)
        else if (this.defense.active) this.defense.persistRuntimeProgress(true)
        else this.mission.persistRuntimeProgress(this.player.dead)
      }
      if (this.spectator) this.spectator.update(this.input, dt)
      else this.orbit.update(this.input, dt)
      this.interaction()
      const townOutcome = this.event.evaluate(this.player.dead)
      if (townOutcome && !this.panel) this.finish(townOutcome)
      else if (!this.event.hostile) {
        const missionOutcome = this.duel?.active ? this.duel.evaluate(this.player.dead) : this.defense.active ? this.defense.evaluate(this.player.dead) : this.mission.evaluate(this.player.dead)
        if (missionOutcome && !this.panel) this.finishMission(missionOutcome)
        else if (!this.profile.activeMission && this.player.dead && !this.panel) this.showAmbientDefeat()
        else if ((this.duel?.active ? this.duel.returnComplete : !this.defense.active && this.mission.returnComplete) && !this.panel) this.returnToTown('arrived')
      }
    }
    else {
      sound?.updateHorseGallopLoops([])
      this.missionCombat.updateDuelDefeatedActors(dt)
    }
    // Lance hits suppress mount impact only for that simulation frame, as in Game.
    // Clear after all Career impact checks so subsequent guarded riding can hit again.
    for (const mount of this.combatMounts) mount.skipImpactThisFrame = false
    for (const mount of this.mounts) mount.skipImpactThisFrame = false
    const duelPhase = this.duel.active && !this.panel && !this.equipment.visible ? this.duel.phase : null
    this.weaponWheelUI.update(this.inventory, !this.panel && !this.equipment.visible && !this.result && !this.player.dead && !this.spectator)
    this.duelHud.update(duelPhase, this.duel.countdownRemaining, this.duel.combatRemaining)
    this.duelGuide.updateDuel(duelPhase, this.player.combatPosition, this.orbit.cameraYaw, this.duel.guideTarget)
    for (const [id, marker] of this.serviceMarkers) marker.visible = !this.event.hostile && !this.defense.active && this.serviceAvailable(id)
    const missionHud = this.profile.activeMission
      ? this.profile.activeMission.kind === 'duel'
        ? `\nDUEL · T${this.profile.activeMission.duelTier} ${UNIT_PRESETS[this.profile.activeMission.duelPresetId!].nameEn}\n${this.duel.phase === 'PREPARING' ? 'DUEL STARTS IN ' + Math.ceil(this.duel.countdownRemaining) : this.duel.phase === 'ENGAGING' ? (this.duel.combatRemaining > 29 ? 'FIGHT\n' : '') + 'Time ' + this.duel.combatRemaining.toFixed(1) + '\nOpponent HP ' + Math.round(this.duel.opponent?.hp ?? 0) : this.duel.phase === 'RETURNING' ? '跟隨裁判返回兵營' : this.duel.phase === 'ASSEMBLING' ? '前往兵營與 Captain 集合' : this.duel.phase === 'MARCHING' ? '跟隨 Captain 前往城外單挑場地' : this.duel.phase}`
        : this.profile.activeMission.kind === 'veteran-field'
        ? this.veteranMissionHud()
        : this.profile.activeMission.kind === 'cavalry-sweep'
        ? `\nCAVALRY SWEEP · 剩餘 Bandits ${this.mission.remainingEnemies}/40\n${this.profile.activeMission.phase === 'RETURNING' ? '跟隨部隊返回軍營' : this.profile.activeMission.phase === 'ASSEMBLING' ? '前往軍營集合 · 與騎兵一起出城' : this.profile.activeMission.phase === 'MARCHING' ? '跟隨 Captain 出城 · 接近敵軍後一起衝鋒' : '衝鋒 · 穿過敵陣後拉開距離，再次衝鋒'}`
        : this.profile.activeMission.kind === 'enemy-town-assault'
        ? `\nENEMY TOWN ASSAULT · ${this.defense.phase === 'PREPARING' ? '進攻準備 ' + Math.ceil(this.defense.preparationRemaining) : '敵方軍事守軍 ' + this.defense.military.filter(npc => !npc.dead).length + '/63'}`
        : this.profile.activeMission.kind === 'town-defense'
        ? `\nTOWN DEFENSE ${this.profile.activeMission.phase} · 敵軍剩餘 ${this.defense.remainingEnemies} · 平民死亡 ${this.defense.civilianDeaths}/10`
        : fieldMissionHud(
          this.profile.activeMission.kind === 'patrol' ? 'patrol' : 'bandit',
          this.profile.activeMission.phase,
          this.mission.remainingEnemies,
        )
      : ''
    this.hud.textContent = `${this.sceneContext.missionOnlyResidents ? '敵境 · 斥候遭遇戰' : this.sceneContext.worldFaction === 'viking' ? 'økse 村' : 'vinum 村'}\n已任命軍階 ${this.profile.rank}\n累積軍功 ${this.profile.totalMerit} · 可用軍功 ${this.profile.availableMerit}${missionHud}${this.spectator ? '\n你已戰死 · 戰鬥仍在繼續' : ''}`
    this.updateMountHud()
    this.damageNumbers.update(dt, this.camera)
    this.updateAmbient()
    this.quiver.setArrowCount(this.player.arrowCount)
    document.getElementById('quiver-hud')!.style.display = this.inventory.rangedEnabled ? '' : 'none'
    this.hud.style.whiteSpace = 'pre-line'; this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(t => this.frame(t))
  }
  dispose(preservePointerLock = false): void {
    this.flushCareerSkillProgression()
    sound?.updateHorseGallopLoops([])
    if (this.disposed) return
    this.outskirts?.dispose()
    this.weaponWheelUI.dispose()
    this.duelHud.dispose()
    this.duelGuide.dispose()
    sound?.cancelCareerAudio()
    document.getElementById('controls-hint')!.textContent = this.previousControls
    document.getElementById('quiver-hud')!.style.display = ''
    this.temporaryMounts.cleanup()
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.abort(); this.input.dispose(); this.panel?.remove(); this.equipment.close(); this.hud.remove(); this.hint.remove(); this.pointerPrompt.remove(); this.careerMounts?.dispose(); this.mission?.dispose(); this.defense?.dispose(); this.duel?.dispose(); this.player?.dispose(); document.getElementById('mount-hud')?.classList.remove('visible'); document.getElementById('enemy-hud')?.classList.remove('visible'); this.ambientLabel.remove(); this.damageNumbers.update(100, this.camera); this.residents.forEach(r => r.npc.dispose()); this.mounts.forEach(m => m.dispose()); this.shots.forEach(s => s.arrow.destroy()); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove()
    if (!preservePointerLock) document.exitPointerLock?.()
  }

  private updatePointerPrompt(): void {
    const unlocked = !this.input.isLocked && !location.search.includes('nolock')
    this.pointerPrompt.style.display = unlocked && !this.panel && !this.equipment.visible ? '' : 'none'
  }
}
