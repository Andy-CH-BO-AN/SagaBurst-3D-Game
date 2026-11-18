import { ArenaPanel, CareerArenaSession, type ArenaSettlement } from './CareerArenaSession'
import { bindWindowResize, createSceneRenderer, GAMEPLAY_SCENE_MAX_PIXEL_RATIO } from '../rendering/SceneRenderer'
import { prisonFormation, prisonExitDestination, PRISON_NAV_CELL_SIZE } from './PrisonBreakLayout'
import { townRoster } from '../town/TownRules'
import { commitPrisonBreakReturn } from '../career/CareerMissionReturnRecovery'
import * as THREE from 'three'
import { PrisonBreakProps } from './PrisonBreakProps'
import { InteractionFocus, type InteractionCandidate } from '../world/InteractionFocus'
import { PickupPrompt } from '../ui/PickupPrompt'
import { prisonGuardCount, prisonRoster, prisonUnitSpec, claimPrisonSword, crossedPrisonExit, prisonOutcome, prisonTaunt, prisonResultDescription, settlePrisonBreak, PRISON_COOP_PARTNER, PRISON_SWORD_ID } from '../career/CareerPrisonBreak'
import { InventoryManager } from '../rpg/InventoryManager'

import { createDuelArena, type DuelArenaEnvironment } from './DuelArena'
import { DUEL_ARENA_LABELS, type DuelArenaId } from './DuelArenaCatalog'
import { assignArenaTrialSlots, planArenaTrialFormation, type ArenaTrialFormation } from './ArenaTrialFormation'
import {
  ARENA_TRIAL_COUNTDOWN_SECONDS, ARENA_TRIAL_DEFINITIONS, ARENA_TRIAL_TIME_LIMIT_SECONDS, arenaTrialCounts, arenaTrialPreloadPlan,
  arenaTrialRestorablePlan, arenaTrialRoster, arenaTrialUnitSpec, careerArenaTrial, resolveArenaTrialEnd,
  type ArenaTrialActorState, type ArenaTrialEndReason, type ArenaTrialState,
} from '../career/CareerArenaTrials'
import { clearCareerMission, cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { resolveCareerHeroAsset, resolveCareerOrdinaryTier, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import { careerStorySettlement } from '../career/CareerStoryEvents'
import type { ActiveCareerMission, CareerMissionOutcome } from '../career/CareerMissionState'
import { BattleStatsTracker, type PlayerBattleStats } from '../combat/BattleStatsTracker'
import { CombatEventStream, createNpcCombatActorRef, createPlayerCombatActorRef, type CombatDamageMethod, type CombatEvent } from '../combat/CombatAttribution'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { damageMount, damageNpc, damagePlayer } from '../combat/DamageRouter'
import { applyMountImpactDamage, applyMountImpactKnockback, checkMountImpact } from '../combat/MountImpact'
import { CareerMountController } from '../career/CareerMountController'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { ProjectileAdmission } from '../combat/ProjectileAdmission'
import { ProjectileContactQuery } from '../combat/ProjectileContactQuery'
import { SHIELD_CONFIG, type CombatContact } from '../combat/ShieldBlocking'
import { traceFistStrike, unarmedDamage } from '../combat/UnarmedCombat'
import { playAppliedPunchHit, SoundManager } from '../audio/SoundManager'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { SpectatorCameraController } from '../camera/SpectatorCameraController'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { Player, DEFAULT_PLAYER_MAX_HP } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { WeaponWheel } from '../player/WeaponWheel'
import { canAwardPlayerSkillProgression, resolveActivePlayerSkillProgressionAward, resolveCombatSkill, type SkillProgressionAward } from '../rpg/CombatSkillProgression'
import { SkillManager, syncPlayerSkillCombatLevels } from '../rpg/SkillManager'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { TownEquipment } from '../town/TownEquipment'
import { ArenaEquipmentMenu } from './ArenaEquipmentMenu'
import { ArenaTrialHUD } from '../ui/ArenaTrialHUD'
import { ArenaOpeningHUD } from '../ui/ArenaOpeningHUD'
import { CombatTargetHud } from '../ui/CombatTargetHud'
import { DamageNumbers } from '../ui/DamageNumbers'
import { HpBar } from '../ui/HpBar'
import { QuiverUI } from '../ui/QuiverUI'
import { StaminaBar } from '../ui/StaminaBar'
import { WeaponWheelUI } from '../ui/WeaponWheelUI'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HIGH_TIER_WEAPON_ASSETS, prepareByzantineEquipment, preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { Mount } from '../world/Mount'
import { Faction, NPC } from '../world/NPC'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { resolveEntityCollision, type ObstacleData } from '../world/Terrain'
import { coopSession, type CoopMessage } from '../coop/CoopLink'
import { announceCoopScene, coopGuestCharacterAssets, coopGuestPlayerSource, isCoopGuestLaunch, showCoopGuestEnd, type CoopPlayerSource } from '../coop/CoopLaunch'
import { CoopGuestMission, CoopHostMission, separateLocalPlayerFromPeer, type CoopGamePort } from '../coop/CoopMission'

const PLAYER_HALF_HEIGHT = 0.95
const RESUME_GRACE_SECONDS = 3
const CHECKPOINT_SECONDS = 2
/** A fall changes quickly, so it is saved far more often than a quiet fight. */
const AIRBORNE_CHECKPOINT_SECONDS = 0.25
/** The guest's pickup reach as seen on the host: the player's 2m prompt plus snapshot latency. */
const COOP_PRISON_PICKUP_RANGE = 3

export interface CareerArenaTrialCallbacks {
  /** The trial is settled (or cancelled) and saved; Town may be rebuilt. */
  returnToTown(): void
}

interface Body {
  readonly actorId: string
  readonly team: 'friendly' | 'enemy'
  readonly npc: NPC
  marker: THREE.Sprite
  pickupSwordIndex?: number
  previousPosition: THREE.Vector3
  escaping?: boolean
}
interface Shot { arrow: ArrowProjectile; player: boolean; source?: NPC; age: number }
interface TrialSettlement extends ArenaSettlement { readonly reason?: ArenaTrialEndReason }
interface PendingSettlement { readonly outcome: CareerMissionOutcome; readonly escapedBy?: string; readonly player: PlayerBattleStats }

let markerTexture: THREE.CanvasTexture | null = null
function teamMarkerTexture(): THREE.CanvasTexture {
  if (markerTexture) return markerTexture
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5
  ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(56, 32); ctx.lineTo(32, 58); ctx.lineTo(8, 32); ctx.closePath(); ctx.stroke(); ctx.fill()
  return markerTexture = new THREE.CanvasTexture(canvas)
}

/**
 * Shared combat host for Arena Squad Trials and the isolated prison-break encounter.
 * Team identity is the NPC allegiance (PLAYER vs ENEMY), never the Roman/Viking look. HP zero is a knock-out:
 * the body leaves targeting, counts and later reloads, but nothing is lost permanently. Rules live in
 * CareerArenaTrials / CareerPrisonBreak; this host owns the arena, the bodies, damage routing and the claim/return transactions.
 */
export class CareerArenaCombatScene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900)
  private readonly store = new CareerProfileStore()
  private readonly input = new PlayerInput()
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly hud = new ArenaTrialHUD()
  private readonly openingHud = new ArenaOpeningHUD()
  private readonly targetHud = new CombatTargetHud()
  private readonly damageNumbers = new DamageNumbers()
  private readonly weaponWheel = new WeaponWheel()
  private readonly weaponWheelUI = new WeaponWheelUI()
  private readonly skills = new SkillManager()
  private readonly shotContacts = new ProjectileContactQuery()
  private readonly projectileAdmission = new ProjectileAdmission(96, 0)
  private readonly sound = new SoundManager()
  private readonly listeners = new AbortController()
  private readonly events = new CombatEventStream()
  private readonly navigation: NavigationWorld
  private readonly markerMaterials = { friendly: new THREE.SpriteMaterial({ map: teamMarkerTexture(), color: 0x4da3ff, depthTest: false }),
    enemy: new THREE.SpriteMaterial({ map: teamMarkerTexture(), color: 0xff5a4d, depthTest: false }) }
  private arena!: DuelArenaEnvironment
  private player!: Player
  private orbit!: ThirdPersonCamera
  private spectator?: SpectatorCameraController
  private inventory!: InventoryManager
  private equipment?: ArenaEquipmentMenu
  /** The player's own ground mount; squad trials are mountable like the solo duel, while the prison break stays on foot. */
  private careerMounts?: CareerMountController
  private tracker!: BattleStatsTracker
  private formation!: ArenaTrialFormation
  private bodies: Body[] = []
  /** Everyone out of the fight, including bodies knocked before a reload (those are never rebuilt). */
  private readonly knocked = new Set<string>()
  private shots: Shot[] = []
  private phase: 'waiting' | 'countdown' | 'paused' | 'fight' | 'result' = 'waiting'
  private countdownRemaining = ARENA_TRIAL_COUNTDOWN_SECONDS
  private resumeGrace = false
  private started = false
  private lastPlayerSignature = ''
  private combatElapsed = 0
  private checkpointClock = 0
  private elapsed = 0
  private raf = 0
  private last = 0
  private disposed = false
  private panel: HTMLElement | null = null
  private settled = false
  /** A decided result whose save failed: combat stays frozen and only the retry button resends it. */
  private pendingSettlement: PendingSettlement | null = null
  private pendingPrisonProfile: CareerProfile | null = null
  private skillsDirty = false
  private props?: PrisonBreakProps
  private prisonHud?: HTMLElement
  private pickupHud?: PickupPrompt
  private readonly pickupFocus = new InteractionFocus<THREE.Group>()
  private subtitle?: HTMLElement
  private dimmer?: HTMLElement
  private previousPlayerPosition = new THREE.Vector3()
  private pickupRetry: (() => void) | null = null
  private initializationComplete = false
  private readonly aimPoint = new THREE.Vector3()
  /** LAN co-op (squad trials and the prison break): the host bridge, or this page's mirror of the host's encounter. */
  private coopHost?: CoopHostMission
  private coopGuest?: CoopGuestMission
  private readonly coopArrows: ArrowProjectile[] = []
  private readonly coopVisualArrows = new Set<ArrowProjectile>()
  private readonly coopGuestNpcs: NPC[] = []
  private readonly coopGuestMounts: Mount[] = []
  /** Team markers for co-op bodies the trial roster does not own (the partner, the guest's mirrors). */
  private readonly coopMarkers = new Map<NPC, THREE.Sprite>()
  /** Co-op guest: its own character profile (in memory); the host's profile still runs the trial. */
  private coopPlayerSource: CoopPlayerSource | null = null
  /** This page mirrors the host's encounter; known before the guest bridge exists. */
  private readonly coopGuestPage = isCoopGuestLaunch()
  private readonly coopUnsubscribe: Array<() => void> = []
  /** Host: prison swords the guest asked for, claimed in the frame like the player's own. */
  private readonly coopPickupRequests: number[] = []
  private coopPrisonKey = ''
  private coopPrisonClock = 0
  /** Host: the guest proxy's position before this frame, for the exit crossing. */
  private previousPartnerPosition: THREE.Vector3 | null = null
  /** Guest: the host's standing guards and saved escape result, for this page's prison HUD. */
  private coopPrisonGuards: number | null = null
  private coopPrisonOutcome: CareerMissionOutcome | null = null
  /** Guest: whether the host's fight is live (its opening and result belong to the host). */
  private coopPrisonFighting = false
  private get playerProfile(): CareerProfile { return this.coopPlayerSource?.read() ?? this.profile }
  /** Whose prison sword this page's Player holds: the host's own, or the co-op partner's. */
  private get prisonSwordOwner(): string { return this.coopGuestPage ? PRISON_COOP_PARTNER : 'player' }
  private commitPlayerProfile(next: CareerProfile): boolean { return this.coopPlayerSource ? this.coopPlayerSource.commit(next) : this.commit(next) }

  /** Ordinary trials keep dev's shared save/session owner; prison has a different fixed-reward receipt. */
  private readonly session?: CareerArenaSession<TrialSettlement>
  private localProfile: CareerProfile
  private constructor(private readonly container: HTMLElement, private readonly renderer: THREE.WebGLRenderer,
    profile: CareerProfile, private readonly arenaId: DuelArenaId, private readonly callbacks: CareerArenaTrialCallbacks) {
    this.localProfile = profile
    this.navigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120,
      ...(profile.activeMission?.prisonBreak ? { cellSize: PRISON_NAV_CELL_SIZE } : {}) })
    if (!profile.activeMission?.prisonBreak) this.session = new CareerArenaSession<TrialSettlement>(profile, {
      noun: '試煉', panel: new ArenaPanel('arena-trial-panel'), store: this.store, skills: this.skills, sound: this.sound, input: this.input,
      player: () => this.player,
      coopCharacter: () => this.coopPlayerSource,
      onClaiming: () => { this.phase = 'result' },
      stageClaim: (staged, settlement) => {
        if (settlement.reason && staged.activeMission?.arenaTrial) staged.activeMission.arenaTrial.endReason = settlement.reason
      },
      openResult: result => this.openResult(result),
      leave: () => this.leave(),
    })
  }

  private get profile(): CareerProfile { return this.session?.profile ?? this.localProfile }
  private set profile(next: CareerProfile) { this.localProfile = next }
  private get panelOpen(): boolean { return this.session?.panel.isOpen ?? Boolean(this.panel) }
  private get settlementPending() { return this.session?.pendingSettlement ?? this.pendingSettlement }

  private get prison() { return this.profile.activeMission?.prisonBreak }
  /** A runtime roster view only. The saved parent battle and its stats are never replaced. */
  private get mission(): ActiveCareerMission {
    const original = this.profile.activeMission!
    if (!this.prison) return original
    const roster = prisonRoster(this.prison)
    return { ...original, result: undefined, playerStats: undefined,
      friendlyActorIds: roster.filter(e => e.team === 'friendly').map(e => e.actorId),
      targetActorIds: roster.filter(e => e.team === 'enemy').map(e => e.actorId) }
  }
  private get trial(): ArenaTrialState { return this.prison?.combat ?? careerArenaTrial(this.profile.activeMission)! }

  /** Loads and builds the saved trial. Throws on a technical failure; the save is untouched. */
  static async create(container: HTMLElement, callbacks: CareerArenaTrialCallbacks, progress: (text: string) => void = () => {}): Promise<CareerArenaCombatScene> {
    const profile = new CareerProfileStore().loadChecked().profile
    const trial = profile?.activeMission?.prisonBreak?.combat ?? careerArenaTrial(profile?.activeMission)
    if (!profile || !trial || profile.activeMission?.prisonBreak?.stage === 'captured') throw new Error('沒有可載入的競技場軍團試煉')
    const renderer = createSceneRenderer({ maxPixelRatio: GAMEPLAY_SCENE_MAX_PIXEL_RATIO,
      toneMappingExposure: trial.arenaId === 'roman-colosseum' ? 1.08 : 1.2 })
    const scene = new CareerArenaCombatScene(container, renderer, profile, trial.arenaId, callbacks)
    try { await scene.initialize(progress); return scene }
    catch (error) { scene.dispose(); throw error }
  }

  private commit(next: CareerProfile): boolean {
    if (this.session) return this.session.commit(next)
    if (!this.store.save(next)) return false
    this.profile = next
    return true
  }

  /** Wait only for equipment that the encounter actually uses; ordinary trials keep their original barrier. */
  private async preloadCombatAssets(): Promise<void> {
    const plan = arenaTrialPreloadPlan(this.trial.tier, this.profile.faction, this.trial.rosterVersion ?? 1)
    if (this.prison) {
      const specs = prisonRoster(this.prison).filter(entry => !this.prison!.result && this.prison!.combat.actors[entry.actorId]?.status !== 'knocked')
        .map(entry => prisonUnitSpec(this.prison!, entry, this.profile.faction))
      plan.heroAssets = [...new Set(specs.flatMap(spec => spec.visualAssetId ? [spec.visualAssetId] : []))]
      plan.equipmentIds = specs.flatMap(spec => [spec.loadout?.meleeWeaponId, spec.loadout?.rangedWeaponId, spec.loadout?.shieldId].filter((id): id is string => Boolean(id)))
    }
    const coopCharacter = this.coopPlayerSource ? coopGuestCharacterAssets() : null
    if (coopCharacter?.hero) plan.heroAssets = [...new Set([...plan.heroAssets, coopCharacter.hero])]
    const equipmentIds = this.prison ? plan.equipmentIds : [...plan.equipmentIds, this.profile.equipment?.melee, this.profile.equipment?.shield, ...(coopCharacter?.equipmentIds ?? [])]
    const requires = (predicate: (id: string) => boolean) => !this.prison || equipmentIds.some(id => typeof id === 'string' && predicate(id))
    const [, equipment] = await Promise.all([
      Promise.all([HumanoidAssetRegistry.preload(),
        ...(this.prison ? [] : [HorseAssetRegistry.preload(this.renderer)]),
        ...(requires(id => id.startsWith('paladin_')) ? [preloadPaladinEquipment()] : []),
        ...(requires(id => id in HIGH_TIER_WEAPON_ASSETS) ? [preloadHighTierEquipment()] : []),
        ...(requires(id => id === T4_RANGER_BOW_RANGED_ID) ? [preloadMakiRangerBow()] : []),
        resolveCareerHeroAsset(this.profile) ? HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[resolveCareerHeroAsset(this.profile)!].descriptor) : Promise.resolve(),
        ...plan.heroAssets.map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))]),
      prepareByzantineEquipment(equipmentIds),
    ])
    if (equipment !== 'ready') throw new Error('試煉裝備資源載入失敗')
  }

  private async initialize(progress: (text: string) => void): Promise<void> {
    const trial = this.trial, mission = this.mission
    const settled = this.prison ? Boolean(this.prison.result) : Boolean(mission.result)
    progress(`正在載入${DUEL_ARENA_LABELS[this.arenaId]}與雙方部隊…`)
    // Co-op guest: its own character (from its own save) joins the host's team.
    this.coopPlayerSource = this.coopGuestPage ? coopGuestPlayerSource(this.profile) : null
    await this.preloadCombatAssets()
    if (this.disposed) return
    this.container.appendChild(this.renderer.domElement)
    // The arena installs ground, bounds and fall rules before any actor reads them.
    this.arena = createDuelArena(this.arenaId, this.scene, Boolean(this.prison))
    this.navigation.sync(this.arena.obstacles)
    const sizes = { friendly: mission.friendlyActorIds.length, enemy: mission.targetActorIds.length }
    const formation = this.prison ? prisonFormation(this.arenaId, prisonGuardCount(this.prison)) : planArenaTrialFormation(this.arenaId, this.arena.obstacles, sizes.friendly, sizes.enemy)
    if (!formation) throw new Error(`${DUEL_ARENA_LABELS[this.arenaId]}沒有足夠空間部署雙方部隊`)
    this.formation = formation
    const body = this.playerProfile
    this.skills.setSkillState(body.skills ?? {})
    this.inventory = this.prison ? new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
      : new TownEquipment(() => this.playerProfile, next => this.commitPlayerProfile(next))
    if (this.prison) {
      this.inventory.meleeEnabled = this.inventory.rangedEnabled = this.inventory.shieldEnabled = false
      if (Object.values(this.prison.swords).includes(this.prisonSwordOwner)) { this.inventory.addWeapon(PRISON_SWORD_ID); this.inventory.equipWeapon(PRISON_SWORD_ID); this.inventory.meleeEnabled = true }
      this.props = new PrisonBreakProps(this.arena, this.prison)
      this.pickupHud = new PickupPrompt()
      this.prisonHud = document.createElement('div'); this.prisonHud.id = 'prison-break-hud'
      this.prisonHud.setAttribute('role', 'status')
      this.prisonHud.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);color:#ffe1a0;font:700 23px/1.6 system-ui;text-align:center;white-space:pre-line;text-shadow:0 2px 5px #000;z-index:9991;pointer-events:none'
      document.body.append(this.prisonHud)
    }
    this.player = new Player(this.scene, body.faction, resolveCareerHeroAsset(body), resolveCareerOrdinaryTier(body))
    const maxHp = resolveCareerPlayerMaxHp(body, DEFAULT_PLAYER_MAX_HP)
    this.player.setMaxHp(maxHp, true)
    this.player.setDamageHud(this.hp)
    syncPlayerSkillCombatLevels(this.player, this.skills.skillState)
    this.player.onShieldBlock = impact => this.awardSkillXp({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, 'arrow', undefined, event.visualKind)
    const engaged = trial.stage === 'engaged'
    // The saved player state is the host's own; a co-op guest always starts fresh.
    const saved = engaged && !this.coopGuestPage ? trial.player : undefined
    const spawn = saved ?? { x: formation.player.x, z: formation.player.z, yaw: formation.player.yaw }
    this.player.resetForScene(spawn.x, saved?.y ?? this.arena.spawns.player.y + PLAYER_HALF_HEIGHT, spawn.z)
    this.player.faceDirection(Math.sin(spawn.yaw), Math.cos(spawn.yaw))
    if (saved) {
      this.player.setHp(Math.min(maxHp, saved.hp)); this.player.setStamina(saved.stamina)
      if (saved.knocked) this.player.takeDamage(this.player.maxHp * 100, this.hp)
    }
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.orbit.setYaw(spawn.yaw + Math.PI)
    if (this.prison && this.player.dead) this.orbit.update(this.input, 0, this.arena.obstacles)
    this.tracker = new BattleStatsTracker(this.events, false, undefined, mission.playerStats)
    if (this.inventory instanceof TownEquipment) this.inventory.prepareForCombat()
    if (!this.prison && !settled) {
      this.careerMounts = new CareerMountController(this.scene, () => this.player, () => this.playerProfile, next => this.commitPlayerProfile(next),
        // Overhead roof volumes cannot block summoning a mount on the floor below them.
        () => this.mountObstacles, () => this.bodies.map(body => body.npc.combatPosition), () => `arena-trial:${this.arenaId}`)
      // A ridden ground mount comes along to the trial; eagles never fly inside an arena.
      const mountId = mission.mountState?.activeMountId
      if (mountId && mountId !== 'xongkoro' && !this.coopPlayerSource) this.careerMounts.restoreActiveMount(false)
    }
    // prepareForCombat tops up supplies; a saved fight restores what was really left (0 means spent or broken).
    if (saved) {
      if (saved.ammo !== undefined) this.player.setArrowCount(saved.ammo)
      if (saved.shieldDurability) this.player.shield.restoreDurability(saved.shieldDurability)
      if (saved.shieldImpact !== undefined) this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.shieldImpact)
      // A fall under way resumes with its own apex, so the grace period cannot erase it.
      if (saved.fall && !saved.knocked) this.player.restoreFootFall(saved.fall)
    }
    if (!settled) await this.buildBodies(trial, progress)
    this.hp.setFill(this.player.hpRatio)
    this.quiver.setArrowCount(this.player.arrowCount)
    this.combatElapsed = trial.combatElapsed
    // A reload never skips the grace: positions and counts are restored exactly, then the fight resumes.
    this.countdownRemaining = engaged ? RESUME_GRACE_SECONDS : ARENA_TRIAL_COUNTDOWN_SECONDS
    this.phase = settled ? 'result' : 'waiting'
    // Only a trial that was already fighting checkpoints during its resume grace; a first deployment countdown never turns `engaged`.
    this.resumeGrace = engaged && !settled
    this.bindInput()
    this.previousPlayerPosition.copy(this.player.position)
    this.initializationComplete = true
    // A co-op guest mirrors the host's encounter and never checkpoints it.
    if (this.prison && !settled && !this.coopGuestPage) {
      // Unlike a trial's deployment, confinement is already live: even the first countdown
      // and every resume grace preserve health, position and fall state on pagehide.
      this.resumeGrace = true
      if (!this.persistProgress()) throw new Error('無法保存關押場景的初始戰況，請重試。')
    }
    progress('準備完成')
  }

  /** Builds only the bodies still standing: knocked-out actors of a saved fight are never recreated. */
  private async buildBodies(trial: ArenaTrialState, progress: (text: string) => void): Promise<void> {
    const mission = this.mission, faction = this.profile.faction
    const roster = this.prison ? prisonRoster(this.prison).map(entry => ({ ...entry, group: { role: entry.role === 'javelin' ? 'archer' as const : entry.role, tier: entry.tier, count: 1 } }))
      : arenaTrialRoster(mission.id, trial.tier, trial.rosterVersion ?? 1)
    const slots = assignArenaTrialSlots(roster, this.formation)
    const standing = arenaTrialRestorablePlan(mission, trial)
    for (const [actorId, state] of Object.entries(trial.actors)) if (state.status === 'knocked') this.knocked.add(actorId)
    let built = 0
    for (const { actorId, saved } of standing) {
      const entry = roster.find(candidate => candidate.actorId === actorId)!
      const slot = slots.get(actorId)!
      const prisonEntry = this.prison && prisonRoster(this.prison).find(e => e.actorId === actorId)
      const spec = prisonEntry ? prisonUnitSpec(this.prison!, prisonEntry, faction, saved?.x ?? slot.x, saved?.z ?? slot.z) : arenaTrialUnitSpec(actorId, faction, entry.team === 'friendly' ? Faction.PLAYER : Faction.ENEMY, entry.group, saved?.x ?? slot.x, saved?.z ?? slot.z)
      const npc = new NPC(this.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier, false,
        spec.loadout, spec.presetId, undefined, spec.actorId, this.events.emit, spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile,
        undefined, undefined, undefined, undefined, spec.characterTier, spec.heroArchetype)
      npc.respawnEnabled = false
      npc.enableBattlefieldEngagement()
      npc.battlefieldUnarmed = Boolean(this.prison && entry.team === 'friendly' && !spec.loadout?.meleeWeaponId)
      npc.group.rotation.y = saved?.yaw ?? slot.yaw
      if (saved) {
        npc.restoreCombatHealth(saved.hp)
        if (saved.y !== undefined) npc.group.position.y = saved.y
        if (saved.ammo !== undefined) npc.restoreCombatAmmo(saved.ammo)
        if (saved.shieldImpact !== undefined) npc.shield.shieldImpactRemaining = Math.min(npc.shield.shieldImpactMax, saved.shieldImpact)
      }
      const marker = new THREE.Sprite(this.markerMaterials[entry.team])
      marker.scale.set(0.6, 0.6, 1); marker.renderOrder = 10
      this.scene.add(marker)
      this.bodies.push({ actorId, team: entry.team, npc, marker, previousPosition: npc.combatPosition.clone() })
      this.tracker.registerNpc(npc, entry.team === 'friendly')
      if (++built % 6 === 0) {
        progress(`部署部隊 ${built} / ${standing.length}…`)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (this.disposed) return
      }
    }
  }

  private get mountObstacles(): ObstacleData[] {
    return this.arena.obstacles.filter(obstacle => !(obstacle.navigationPassable && !obstacle.walkSurface && obstacle.box.min.y > 4))
  }

  private bindInput(): void {
    const signal = this.listeners.signal
    // Prison break deliberately owns a fixed, scavenged loadout.
    if (!this.prison) this.equipment = new ArenaEquipmentMenu(this.input, this.skills, this.inventory, this.renderer.domElement,
      () => this.started && !this.disposed && !this.player.dead && !this.panelOpen && !this.settlementPending && this.phase !== 'result', this.careerMounts)
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.started || this.panelOpen || this.equipment?.visible) return
      this.sound.unlockAudio()
      if (!this.coopGuest && (this.phase === 'waiting' || this.phase === 'paused')) {
        // This gesture belongs to the opening, including in the unlocked QA path.
        this.input.consumeLeftGesture()
        if (location.search.includes('nolock') || document.pointerLockElement === this.renderer.domElement) this.beginCountdown()
        else this.input.requestPointerLock(this.renderer.domElement)
      } else if (!location.search.includes('nolock')) this.input.requestPointerLock(this.renderer.domElement)
    }, { signal })
    document.addEventListener('pointerlockchange', () => {
      // A request is not proof of control. Rejected requests leave the prompt available to retry.
      this.pauseOpeningIfUnlocked()
      if (document.pointerLockElement === this.renderer.domElement) this.beginCountdown()
    }, { signal })
    bindWindowResize(this.camera, this.renderer, signal)
    window.addEventListener('pagehide', () => this.persistNow(), { signal })
  }

  private beginCountdown(): void {
    // The host alone opens the fight; the guest's phase only mirrors it.
    if (this.coopGuest) return
    if (!this.started || this.panelOpen || this.equipment?.visible || this.phase !== 'waiting' && this.phase !== 'paused') return
    this.input.clear()
    this.phase = 'countdown'
    this.last = performance.now()
    this.openingHud.update(this.phase, this.countdownRemaining)
  }

  private pauseOpeningIfUnlocked(): void {
    if (this.coopGuest || this.phase !== 'countdown' || location.search.includes('nolock') || document.pointerLockElement === this.renderer.domElement) return
    this.phase = 'paused'
    this.input.clear()
    this.openingHud.update(this.phase, this.countdownRemaining)
  }

  start(): void {
    this.started = true
    this.last = performance.now()
    if (!this.coopGuest && coopSession().isHost) {
      this.coopHost = new CoopHostMission(this.coopPort(false))
      // The guest's sword pickups are requests: the host claims and saves them like its own.
      if (this.prison) this.coopUnsubscribe.push(coopSession().on('prisonPickup', message => {
        if (this.phase === 'fight' && Number.isInteger(message.index) && this.coopPickupRequests.length < 4) this.coopPickupRequests.push(message.index as number)
      }))
      announceCoopScene(this.prison ? 'prison' : 'trial')
    }
    // A co-op guest never opens a result: the host owns it.
    if (!this.coopGuest && this.prison?.result) this.openPrisonResult()
    else if (!this.coopGuest && !this.prison && this.profile.activeMission?.result) this.openResult(this.profile.activeMission.result)
    this.openingHud.update(this.phase, this.countdownRemaining)
    const frame = (time: number): void => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0, (time - this.last) / 1000))
      this.last = time
      this.update(dt)
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(frame)
  }

  /** One gameplay step (also used by DEV QA at a fixed rate). */
  update(dt: number): void {
    if (this.disposed) return
    if (this.coopGuest) { this.updateCoopGuest(dt); return }
    if (this.equipment?.visible) { this.input.clear(); return }
    if (this.settlementPending || this.pickupRetry) {
      if (this.prison) { this.clearPickupFocus(); this.input.consumeKeyE() }
      this.arena.update(dt); this.damageNumbers.update(dt, this.camera); return
    }
    this.pauseOpeningIfUnlocked()
    // In ?nolock input is normally active even without pointer lock; the opening still owns it.
    if (this.phase === 'waiting' || this.phase === 'paused') this.input.clear()
    const pickupPressed = this.prison ? this.input.consumeKeyE() : false
    this.elapsed += dt
    // Co-op bridge: after the freezes above, so a paused trial never advances for the guest either.
    if (this.coopHost) {
      const partner = this.coopPartner
      this.previousPartnerPosition = partner ? (this.previousPartnerPosition ?? new THREE.Vector3()).copy(partner.combatPosition) : null
      this.coopHost.update(dt); this.updateCoopArrows(dt); this.syncCoopPrison(dt)
    }
    const fighting = this.phase === 'fight'
    this.updateCamera(dt)
    if (!this.player.dead && !this.panelOpen) {
      let step: ReturnType<PlayerInput['consumeWheelStep']>
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
    this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(this.aimPoint), this.arena.obstacles,
      this.stamina, this.quiver, this.sound, this.inventory, this.skills.getRangedMultiplier(), fighting && !this.panelOpen)
    // The ground boundary holds living, supported bodies only; falls always complete.
    if (!this.player.dead && this.player.isGrounded) {
      const mount = this.player.currentMount
      if (mount) { if (this.arena.constrainGroundedBody(mount.group.position)) this.player.syncMountTransform() }
      else this.arena.constrainGroundedBody(this.player.group.position)
    }
    this.updateBodies(dt)
    if (fighting) { this.melee(); this.resolveBodies(); this.mountImpacts(); if (this.prison) this.pickupSwords(pickupPressed) }
    separateLocalPlayerFromPeer(this.player, this.coopHost?.guestProxy, this.arena.obstacles)
    if (this.pickupRetry) return
    // A living teammate who has already crossed wins before any in-flight shot
    // can hit them later in this frame. A rejected receipt freezes this same crossing.
    if (this.prison?.gateOpen && this.resolvePrisonResult()) return
    this.updateShots(dt)
    if (this.careerMounts) {
      this.careerMounts.update(dt)
      this.player.fitMountedSeat()
      const mount = this.careerMounts.activeMount
      if (mount && !mount.disposed) {
        mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
        if (mount.dead || !mount.riderPlayer) mount.update(dt, this.arena.obstacles)
      }
    }
    this.arena.update(dt)
    this.props?.update(dt)
    this.advancePhase(dt)
    if (this.prison) this.updatePickupFocus()
    this.previousPlayerPosition.copy(this.player.position)
    this.updateMarkers()
    this.damageNumbers.update(dt, this.camera)
    this.weaponWheelUI.update(this.inventory, !this.panelOpen && !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    this.updatePrisonHud()
    this.openingHud.update(this.phase, this.countdownRemaining)
    this.hud.update({
      phase: this.prison ? null : this.phase, label: ARENA_TRIAL_DEFINITIONS[this.trial.tier].label,
      friendly: { active: this.counts().friendlyActive + (this.player.dead ? 0 : 1), total: this.mission.friendlyActorIds.length + 1 + (this.coopHost?.guestProxy ? 1 : 0) },
      enemy: { active: this.counts().enemyActive, total: this.mission.targetActorIds.length },
      remainingSeconds: ARENA_TRIAL_TIME_LIMIT_SECONDS - this.combatElapsed, playerKnocked: this.player.dead })
    if (this.session) this.session.tickSkillFlush(this.elapsed, dt)
    else if (this.skillsDirty && this.elapsed % 5 < dt) this.flushSkills()
  }

  private updateCamera(dt: number): void {
    if (this.panelOpen) return
    if (this.prison && this.player.dead) {
      if (!this.spectator) {
        this.spectator = new SpectatorCameraController(this.camera)
        this.spectator.initFromCamera()
      }
      this.spectator.update(this.input, dt)
    } else this.orbit.update(this.input, dt, this.arena.obstacles)
  }

  private counts() {
    const counts = arenaTrialCounts(this.mission, { actors: {}, player: { knocked: this.player.dead } as ArenaTrialState['player'] },
      new Set([...this.knocked, ...this.bodies.filter(body => body.npc.dead).map(body => body.actorId)]))
    // Co-op: the guest's living body is one more teammate, so the team falls only when both players are down.
    return this.coopPartner ? { ...counts, friendlyActive: counts.friendlyActive + 1 } : counts
  }

  /** Host: the guest's living proxy fighting on the player's team. */
  private get coopPartner(): NPC | null {
    const proxy = this.coopHost?.guestProxy
    return proxy && !proxy.dead ? proxy : null
  }

  /** The bodies this player's own attacks may strike: enemy bodies, or on a co-op guest the host's marked targets. */
  private enemyTargets(): NPC[] {
    if (this.coopGuest) return this.coopGuest.targets.filter(npc => !npc.dead && Boolean(npc.group.parent))
    return this.bodies.filter(body => body.team === 'enemy' && !body.npc.dead).map(body => body.npc)
  }

  private updatePrisonHud(): void {
    if (!this.prisonHud || !this.prison) return
    this.prisonHud.hidden = this.phase === 'result'
    const total = this.mission.targetActorIds.length
    // A co-op guest shows the host's count: its own page has only mirrors of the standing guards.
    const standing = this.coopGuest ? this.coopPrisonGuards ?? total : this.counts().enemyActive
    this.prisonHud.textContent = this.prison.gateOpen ? '鐵門已開｜穿過出口' : `越獄目標｜擊倒看守 ${total - standing}／${total}`
    if (this.coopGuest && this.coopPrisonOutcome) {
      this.prisonHud.textContent = `${this.coopPrisonOutcome === 'victory' ? '逃出牢籠' : '逃脫失敗'}｜等待主機返回小鎮`
      return
    }
    if (this.player.dead) this.prisonHud.textContent += '\n你已倒下，正在觀戰；友軍仍可逃脫（WASD 移動視角）'
  }

  private resolvePrisonResult(): boolean {
    if (this.prison && this.phase !== 'result') {
      const friend = this.bodies.find(body => body.team === 'friendly' && !body.npc.dead && crossedPrisonExit(this.arenaId,
        { x: body.previousPosition.x, y: body.previousPosition.y + PLAYER_HALF_HEIGHT, z: body.previousPosition.z },
        { x: body.npc.combatPosition.x, y: body.npc.combatPosition.y + PLAYER_HALF_HEIGHT, z: body.npc.combatPosition.z }))
      const playerCrossed = !this.player.dead && crossedPrisonExit(this.arenaId, this.previousPlayerPosition, this.player.position)
      // The co-op partner is one more living prisoner: its proxy crossing the exit frees the team.
      const partner = this.coopPartner, before = this.previousPartnerPosition
      const partnerCrossed = Boolean(partner && before && crossedPrisonExit(this.arenaId,
        { x: before.x, y: before.y + PLAYER_HALF_HEIGHT, z: before.z },
        { x: partner.combatPosition.x, y: partner.combatPosition.y + PLAYER_HALF_HEIGHT, z: partner.combatPosition.z }))
      const result = prisonOutcome({ playerDead: this.player.dead, friendlyAlive: this.counts().friendlyActive,
        gateOpen: this.prison.gateOpen, playerCrossed, friendlyCrossed: Boolean(friend) || partnerCrossed })
      if (result) { this.finishPrison(result, playerCrossed ? 'player' : friend?.actorId ?? (partnerCrossed ? PRISON_COOP_PARTNER : undefined)); return true }
    }
    return false
  }

  private advancePhase(dt: number): void {
    if (this.resolvePrisonResult()) return
    this.pauseOpeningIfUnlocked()
    if (this.phase === 'waiting' || this.phase === 'paused' || this.phase === 'countdown') {
      // The resume grace of an already-fighting trial still keeps the saved fight current: a landing, a knock-out or
      // a fall under way must survive a second reload. The first deployment countdown saves nothing.
      if (this.resumeGrace) this.checkpointFight(dt)
      if (this.pickupRetry) return
      this.pauseOpeningIfUnlocked()
      if (this.phase !== 'countdown') return
      this.countdownRemaining -= dt
      if (this.countdownRemaining > 0) return
      this.phase = 'fight'
      this.resumeGrace = false
      for (const body of this.bodies) if (!body.npc.dead) body.npc.setTacticalOrder('attack')
      if (this.prison) this.saveProgressWithRetry(); else this.persistProgress()
      return
    }
    if (this.phase !== 'fight') return
    this.combatElapsed += dt
    if (this.prison) {
      // Resolve a crossing before any periodic write: a failed result write must never save an
      // already-outside player without the receipt. Final combat state and reward share one commit.
      if (this.counts().enemyActive === 0 && !this.prison.gateOpen) {
        const next = this.captureProgress()!
        next.activeMission!.prisonBreak!.gateOpen = true
        if (!this.commit(next)) { this.pauseForPrisonSave(() => this.advancePhase(0)); return }
        this.props?.setOpen(true, true)
      }
      this.checkpointFight(dt)
      return
    }
    this.checkpointFight(dt)
    const end = resolveArenaTrialEnd(this.counts(), this.combatElapsed)
    if (end && !this.settlementPending) this.finish(end.outcome, end.reason)
  }

  /** Saves at once on any knock-out or change of the player's own state, and on a steady cadence (faster while falling). */
  private checkpointFight(dt: number): void {
    let changed = false
    for (const body of this.bodies) if (body.npc.dead && !this.knocked.has(body.actorId)) { this.knocked.add(body.actorId); changed = true }
    const signature = `${this.player.dead}|${Math.round(this.player.hp)}`
    if (signature !== this.lastPlayerSignature) { this.lastPlayerSignature = signature; changed = true }
    // A knock-out is saved at once so a reload can never stand the body back up.
    this.checkpointClock += dt
    const airborne = !this.player.dead && !this.player.isGrounded && !this.player.currentMount
    if (changed || this.checkpointClock >= (airborne ? AIRBORNE_CHECKPOINT_SECONDS : CHECKPOINT_SECONDS)) {
      if (this.prison) this.saveProgressWithRetry(); else this.persistProgress()
    }
  }

  private updateBodies(dt: number): void {
    // Same per-frame topology sync and path-search budget reset as Town; without it the budget never refills.
    this.navigation.sync(this.arena.obstacles)
    this.navigation.beginFrame()
    const partner = this.coopPartner
    const live = [...this.bodies.filter(body => !body.npc.dead).map(body => body.npc), ...(partner ? [partner] : [])]
    for (const body of this.bodies) {
      const { npc } = body
      body.previousPosition.copy(npc.combatPosition)
      const distance = npc.group.position.distanceTo(this.camera.position)
      if (npc.dead) { npc.update(dt, this.player, [], [], this.arena.obstacles, this.hp, () => {}, () => false, false, distance); continue }
      if (this.phase !== 'fight') { npc.updateTownPeace(dt, distance, false, false); continue }
      if (this.prison?.gateOpen && body.team === 'friendly') {
        if (!body.escaping) {
          body.escaping = true
          delete body.pickupSwordIndex
          npc.assignFormationTarget(701, prisonExitDestination(this.arenaId), new THREE.Vector3(0, 0, -1))
        }
        npc.updateTownTravel(dt, distance, live, this.arena.obstacles, this.navigation)
        continue
      }
      if (this.prison && npc.battlefieldUnarmed) {
        const available = this.props!.swords.filter(mesh => mesh.visible)
        const nearest = available.sort((a, b) => a.position.distanceToSquared(npc.combatPosition) - b.position.distanceToSquared(npc.combatPosition))[0]
        if (nearest) {
          const index = this.props!.swords.indexOf(nearest)
          if (body.pickupSwordIndex !== index) {
            body.pickupSwordIndex = index
            npc.assignFormationTarget(700, nearest.position, new THREE.Vector3(0, 0, -1), undefined, 'attack')
          }
          npc.updateTownTravel(dt, distance, live, this.arena.obstacles, this.navigation)
          continue
        }
        if (body.pickupSwordIndex !== undefined) { delete body.pickupSwordIndex; npc.setTacticalOrder('attack') }
      }
      npc.update(dt, this.player, live, live, this.arena.obstacles, this.hp,
        (damage, isPlayer, target, targetMount) => {
          if (isPlayer) this.damagePlayerFrom(npc, damage, 'melee')
          else if (targetMount) this.hitMount(targetMount, damage, 'melee', npc)
          else if (target) this.damageBodyFrom(npc, target, damage, 'melee')
        },
        (origin, direction, kind) => this.fire(origin, direction, npc.rangedProjectileSpeed, npc.rangedDamage, kind, npc),
        false, distance, null, null, this.navigation)
    }
  }

  private updateMarkers(): void {
    for (const body of this.bodies) {
      body.marker.visible = !body.npc.dead
      if (body.marker.visible) body.marker.position.set(body.npc.group.position.x, body.npc.group.position.y + 2.5, body.npc.group.position.z)
    }
    const partner = this.coopHost?.guestProxy
    this.syncCoopMarkers(partner ? [[partner, 'friendly']] : [])
  }

  /** Same diamond markers for co-op bodies: the partner on the host; the guest's mirrors by their marked side. */
  private syncCoopMarkers(entries: readonly (readonly [NPC, 'friendly' | 'enemy'])[]): void {
    const seen = new Set<NPC>()
    for (const [npc, team] of entries) {
      seen.add(npc)
      let marker = this.coopMarkers.get(npc)
      if (!marker) {
        marker = new THREE.Sprite(this.markerMaterials[team])
        marker.scale.set(0.6, 0.6, 1); marker.renderOrder = 10
        this.scene.add(marker)
        this.coopMarkers.set(npc, marker)
      }
      marker.material = this.markerMaterials[team]
      marker.visible = !npc.dead && Boolean(npc.group.parent)
      if (marker.visible) marker.position.set(npc.group.position.x, npc.group.position.y + 2.5, npc.group.position.z)
    }
    for (const [npc, marker] of this.coopMarkers) if (!seen.has(npc)) { marker.removeFromParent(); this.coopMarkers.delete(npc) }
  }

  private melee(): void {
    const enemies = this.enemyTargets()
    if (this.player.dead) { this.player.consumeFistStrikes(); return }
    const activeMelee = this.inventory.activeMelee
    if (!activeMelee) {
      for (const strike of this.player.consumeFistStrikes()) {
        const contact = traceFistStrike(strike, this.player.position, enemies, this.arena.obstacles)
        if (contact?.kind === 'body' && contact.target) this.hitEnemy(contact.target as NPC, unarmedDamage(this.skills.getMultiplier('unarmed'), this.player.heroAssetId), 'melee', contact)
      }
      return
    }
    if (!this.player.isHitFrame(this.inventory.equippedMelee)) return
    const weapon = activeMelee
    const damage = calculatePlayerMeleeDamage({
      baseDamage: weapon.damageMax, combatKind: weapon.combatKind, isLance: weapon.isLance === true,
      isMounted: this.player.isMounted, mountSpeed: this.player.currentMount?.movementSpeed ?? 0,
      oneHandedMultiplier: this.skills.getMultiplier(resolveCombatSkill('melee', weapon, Boolean(this.inventory.shieldEnabled && this.inventory.equippedShield))!),
      faction: this.player.characterFaction, hasShield: this.inventory.shieldEnabled, heroAssetId: this.player.heroAssetId ?? undefined,
    })
    const contact = this.player.weaponSweep.traceFirst(enemies, [], this.player.currentMount)
    if (!contact) return
    this.player.markHitProcessed()
    this.hitEnemy(contact.target as NPC, Math.round(damage.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, false)), 'melee', contact)
    if (damage.isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
  }

  /** Mounted contacts: the player's charge tramples enemy bodies through the same impact rules as the solo duel. */
  private mountImpacts(): void {
    const mount = this.player.currentMount
    if (!mount || mount.dead || this.player.dead) return
    for (const npc of this.enemyTargets()) {
      if (!checkMountImpact(mount, npc.combatPosition, 0.5)) continue
      applyMountImpactDamage(mount, npc, npc.combatPosition, this.elapsed,
        damage => this.hitEnemy(npc, Math.round(damage * this.skills.getMountedImpactMultiplier()), 'mount-impact'))
    }
  }

  private emit(event: CombatEvent, lod = 0): void {
    this.coopHost?.recordCombatEvent(event)
    playAppliedPunchHit(event, this.sound, lod, event.source.actorType === 'player')
    const weapon = event.type === 'damage_applied' && event.weaponId ? WEAPONS[event.weaponId] : this.inventory.activeMelee
    const award = resolveActivePlayerSkillProgressionAward(event, { dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false }, weapon, this.player.hasShield)
    if (award) this.awardSkillXp(award)
    this.events.emit(event)
  }

  private hitEnemy(target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    // Co-op guest: the host judges the trial; DamageRouter forwards this hit on its mirror.
    if ((this.coopGuest ? !this.coopGuest.targets.includes(target) : this.phase !== 'fight') || target.dead || amount <= 0) return
    const result = damageNpc(target, amount, {
      contact: contact ?? (method === 'melee' ? this.player.weaponSweep?.contact : undefined),
      source: createPlayerCombatActorRef(this.player), method,
      weaponId: method === 'projectile' ? this.inventory.equippedRanged?.id : (this.inventory.activeMelee?.id ?? 'unarmed'),
      emit: event => this.emit(event, target.currentLod),
    })
    if (!result.hitSuccess) return
    if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
    if (method === 'mount-impact' && this.player.currentMount && !result.isMountHit) {
      applyMountImpactKnockback(this.player.currentMount, target, { obstacles: this.arena.obstacles, worldBound: 108 })
    }
    if (method === 'projectile') this.sound.playProjectileImpact(target.currentLod, true)
    else if (method === 'mount-impact') this.sound.playHorseImpact(target.currentLod, true)
    else if (contact?.attackSource !== 'unarmed') this.sound.playSwordHit(target.currentLod, true)
    this.targetHud.show(result.targetName, result.hpRatio)
  }

  /** Enemies may only strike the player's own mount, during live combat. */
  private hitMount(mount: Mount, amount: number, method: CombatDamageMethod, source: NPC, contact?: CombatContact): void {
    if (this.phase !== 'fight' || mount.dead || mount.disposed || amount <= 0 || mount !== this.player.currentMount || source.faction !== Faction.ENEMY || source.dead) return
    damageMount(mount, amount, {
      contact, source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined,
      emit: event => this.emit(event, mount.currentLod),
    })
  }

  /** NPC → NPC: only across teams (allegiance), only in live combat. */
  private damageBodyFrom(source: NPC, target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.phase !== 'fight' || source === target || source.faction === target.faction || target.dead || source.dead || amount <= 0) return
    damageNpc(target, amount, {
      contact: contact ?? source.unarmedContact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined),
      source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined,
      emit: event => this.emit(event, target.currentLod),
    })
  }

  private damagePlayerFrom(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.phase !== 'fight' || this.player.dead || source.faction !== Faction.ENEMY || source.dead) return
    contact ??= source.unarmedContact
    if (contact?.kind === 'mount' && contact.mount) { this.hitMount(contact.mount, amount, method, source, contact); return }
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      contact: contact ?? source.unarmedContact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined), hostileToTarget: true,
      source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : (contact?.attackSource === 'unarmed' ? 'unarmed' : source.meleeWeaponId)) ?? undefined,
      emit: event => this.emit(event, source.currentLod),
    })
    if (result.appliedDamage <= 0) return
    if (method === 'projectile') this.sound.playProjectileImpact(0, true)
    else if (contact?.attackSource !== 'unarmed') this.sound.playSwordHit(0, true)
  }

  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, kind: 'arrow' | 'pilum', source?: NPC,
    visualKind?: 'arrow' | 'pilum'): boolean {
    if ((this.phase !== 'fight' && !this.coopGuest) || (!source && this.player.dead)) return this.projectileAdmission.reject()
    return this.projectileAdmission.launch(this.shots.length, 0, false, () => {
      this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, source?.faction ?? Faction.PLAYER, !source, visualKind ?? kind), player: !source, source, age: 0 })
      this.coopHost?.onProjectile(origin, direction, speed, visualKind ?? kind, source?.faction ?? Faction.PLAYER)
      if (!source) this.coopGuest?.onProjectile(origin, direction, speed, visualKind ?? kind)
      this.sound.playBowRelease(source ? source.currentLod : 0, !source, source ? origin.distanceTo(this.player.combatPosition) : 0)
    })
  }

  private updateShots(dt: number): void {
    if (!this.shots.length) return
    for (const shot of this.shots) {
      if (!shot.arrow.isAlive) continue
      const from = shot.arrow.mesh.position.clone()
      shot.age += dt
      shot.arrow.update(dt, this.player, [], [], () => {}, amount => damagePlayer(this.player, amount, this.hp, null), undefined, true)
      if (!shot.arrow.isAlive) continue
      const shooterTeam = shot.player ? 'friendly' : shot.source!.faction === Faction.ENEMY ? 'enemy' : 'friendly'
      const playerMount = this.player.currentMount
      const partner = shooterTeam === 'enemy' ? this.coopPartner : null
      const targets: (Player | NPC | Mount)[] = [
        ...this.bodies.filter(body => body.team !== shooterTeam && !body.npc.dead).map(body => body.npc),
        ...(shooterTeam === 'enemy' && !this.player.dead ? [this.player, ...(playerMount && !playerMount.dead ? [playerMount] : [])] : []),
        ...(partner ? [partner] : []),
        ...(this.coopGuest && shot.player ? this.enemyTargets() : []),
      ]
      const hit = this.shotContacts.find(from, shot.arrow.mesh.position, {
        world: { kind: 'town', practiceTargets: [], traceSiege: () => null },
        obstacles: this.arena.obstacles, targets, acceptsTarget: target => !target.dead && !(target instanceof Mount && target.disposed),
      })
      if (hit) {
        if (hit.kind === 'actor') {
          const { target, contact } = hit
          if (contact.kind === 'mount' && contact.mount && shot.source) this.hitMount(contact.mount, shot.arrow.damage, 'projectile', shot.source, contact)
          else if (target instanceof Player && shot.source) this.damagePlayerFrom(shot.source, shot.arrow.damage, 'projectile', contact)
          else if (target instanceof NPC && shot.player) this.hitEnemy(target, shot.arrow.damage, 'projectile', contact)
          else if (target instanceof NPC && shot.source) this.damageBodyFrom(shot.source, target, shot.arrow.damage, 'projectile', contact)
        }
        shot.arrow.destroy()
        continue
      }
      if (shot.age > 5) shot.arrow.destroy()
    }
    this.shots = this.shots.filter(shot => shot.arrow.isAlive)
  }

  private resolveBodies(): void {
    if (this.player.dead || this.player.isFalling) return
    const body = { position: this.player.group.position, radius: 0.42, height: 1.8, bottomOffset: 0.9, walkSurfaces: true }
    // A guest's mirrors are placed by the host every frame: only the guest's own body moves.
    const others = this.coopGuest ? this.coopGuestNpcs : this.bodies.map(entry => entry.npc)
    for (const npc of others) {
      if (npc.dead || !npc.group.parent || npc.combatPosition.distanceTo(this.player.combatPosition) > 3) continue
      resolveEntityCollision(body, { position: npc.combatPosition, radius: 0.42, height: 1.8, bottomOffset: 0, walkSurfaces: true, ...(this.coopGuest ? { anchored: true } : {}) }, this.arena.obstacles)
    }
  }

  private awardSkillXp({ skill, xp }: SkillProgressionAward): void {
    if (this.session) { this.session.awardSkillXp({ skill, xp }); return }
    if (xp <= 0 || !canAwardPlayerSkillProgression({ dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false })) return
    const levels = this.skills.addXp(skill, xp, this.sound)
    syncPlayerSkillCombatLevels(this.player, this.skills.skillState)
    this.skillsDirty = true
    if (levels > 0) {
      this.flushSkills()
      const before = this.player.hp
      const maxHp = resolveCareerPlayerMaxHp(this.playerProfile, DEFAULT_PLAYER_MAX_HP)
      this.player.setMaxHp(maxHp, false)
      this.player.setHp(Math.min(maxHp, before + levels))
    }
  }

  private flushSkills(): void {
    if (this.session) { this.session.flushSkills(); return }
    if (!this.skillsDirty) return
    // A co-op guest's skills belong to its own character (kept in this page's memory).
    const next = cloneCareerProfile(this.playerProfile)
    next.skills = this.skills.skillState
    if (this.commitPlayerProfile(next)) this.skillsDirty = false
  }

  /** The roster checkpoint: knocked-out actors stay knocked, everyone else keeps HP and place. Best effort between frames. */
  private captureProgress(): CareerProfile | null {
    const mission = this.profile.activeMission ? this.mission : undefined
    if (this.disposed || !mission || this.prison?.result || !this.prison && (mission.result || !careerArenaTrial(mission))) return null
    const next = cloneCareerProfile(this.profile)
    const active = next.activeMission!
    const actors: Record<string, ArenaTrialActorState> = {}
    for (const id of [...mission.friendlyActorIds, ...mission.targetActorIds]) {
      const body = this.bodies.find(candidate => candidate.actorId === id)
      if (!body || this.knocked.has(id) || body.npc.dead) { actors[id] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }; continue }
      actors[id] = { status: 'active', hp: body.npc.hp, x: body.npc.combatPosition.x, z: body.npc.combatPosition.z, yaw: body.npc.group.rotation.y,
        y: body.npc.group.position.y, ammo: body.npc.combatAmmo, shieldImpact: body.npc.shield.shieldImpactRemaining }
    }
    const combat: ArenaTrialState = { ...this.trial, stage: 'engaged', combatElapsed: this.combatElapsed, actors, player: {
      knocked: this.player.dead, hp: this.player.dead ? 0 : this.player.hp, stamina: this.player.staminaValue,
      x: this.player.position.x, z: this.player.position.z, yaw: this.player.facingYaw,
      y: this.player.group.position.y, ammo: this.player.arrowCount, shieldImpact: this.player.shield.shieldImpactRemaining,
      shieldDurability: { ...this.player.shield.captureDurability() },
      ...(this.player.currentMount || this.player.isFalling ? {} : (fall => fall.grounded && fall.apexY === null ? {} : { fall })(this.player.captureFootFall())) } }
    if (this.prison) active.prisonBreak!.combat = combat
    else { active.arenaTrial = combat; active.phase = 'ENGAGING'; active.playerStats = this.tracker.checkpoint(); if (this.careerMounts) active.mountState = this.careerMounts.checkpoint() }
    return next
  }

  private persistProgress(): boolean {
    const next = this.captureProgress()
    const saved = Boolean(next && this.commit(next))
    if (saved) this.checkpointClock = 0
    return saved
  }

  private persistNow(): void {
    // A co-op guest saves only its own skill progress (into its own save); the trial is the host's.
    if (this.coopGuest) { if (!this.disposed) this.flushSkills(); return }
    if (this.disposed || !this.tracker || !this.initializationComplete || this.settlementPending || this.pickupRetry) return
    this.flushSkills()
    if (this.phase === 'fight' || this.resumeGrace) this.persistProgress()
  }

  private saveProgressWithRetry(): boolean {
    if (this.persistProgress()) return true
    this.pauseForPrisonSave(() => this.saveProgressWithRetry())
    return false
  }

  private pauseForPrisonSave(retry: () => void): void {
    this.pickupRetry = retry
    this.clearPickupFocus()
    this.input.clear(); document.exitPointerLock?.()
    this.openPanel('進度尚未保存', '保存失敗；目前戰況保留，請重試。')
    this.button('重試保存進度', () => { this.pickupRetry = null; this.closePanel(); retry() })
  }

  private prisonPickupCandidates(): InteractionCandidate<THREE.Group>[] {
    const prison = this.prison
    if (!prison || prison.gateOpen || (this.coopGuest ? !this.coopPrisonFighting : this.phase !== 'fight') || this.pickupRetry || this.panelOpen
      || this.player.dead || !this.input.isLocked || Object.values(prison.swords).includes(this.prisonSwordOwner)) return []
    return this.props!.swords.filter(sword => sword.visible).map(sword => ({
      target: sword, position: sword.position, range: 2, action: 'equip',
      prompt: `[E] 拾起並裝備 · ${WEAPONS[PRISON_SWORD_ID].name}`,
    }))
  }

  private clearPickupFocus(): void {
    this.pickupFocus.clear()
    this.pickupHud?.show(null)
    this.props?.setSelectedSword(null)
  }

  private updatePickupFocus(): void {
    const yaw = this.orbit.cameraYaw
    const selected = this.pickupFocus.select(this.prisonPickupCandidates(), this.player.position,
      { x: -Math.sin(yaw), z: -Math.cos(yaw) })
    this.props!.setSelectedSword(selected ? this.props!.swords.indexOf(selected.target) : null)
    this.pickupHud?.show(selected?.prompt ?? null)
  }

  private pickupSwords(pressed: boolean): void {
    const prison = this.prison
    if (!prison || this.pickupRetry || prison.gateOpen) return
    const selected = this.pickupFocus.pressed(pressed, this.prisonPickupCandidates(), this.player.position)
    // Preserve the existing sword order and player-before-NPC priority for each sword.
    for (let i = 0; i < this.props!.swords.length; i++) {
      const mesh = this.props!.swords[i]
      if (!mesh.visible) continue
      const npc = this.bodies.find(body => body.team === 'friendly' && !body.npc.dead && body.npc.battlefieldUnarmed && mesh.position.distanceTo(body.npc.combatPosition) < 1.4)
      const owner = selected?.target === mesh ? 'player' : npc?.actorId
      if (owner && !this.equipPrisonSword(i, owner)) return
    }
    if (this.coopHost) for (const index of this.coopPickupRequests.splice(0)) {
      const partner = this.coopPartner, mesh = this.props!.swords[index]
      if (!partner || !mesh?.visible || mesh.position.distanceTo(partner.combatPosition) > COOP_PRISON_PICKUP_RANGE) continue
      if (!this.equipPrisonSword(index, PRISON_COOP_PARTNER)) return
    }
  }

  private equipPrisonSword(index: number, owner: string): boolean {
    const claimed = claimPrisonSword(this.prison!, index, owner)
    if (!claimed) return true
    const next = cloneCareerProfile(this.profile); next.activeMission!.prisonBreak = claimed
    if (!this.commit(next)) { this.pauseForPrisonSave(() => this.equipPrisonSword(index, owner)); return false }
    this.props!.syncSwords(claimed)
    if (owner === 'player') this.armPrisonSword()
    // The guest arms itself from the next prison state, sent at once.
    else if (owner === PRISON_COOP_PARTNER) this.coopPrisonKey = ''
    else {
      const npc = this.bodies.find(body => body.actorId === owner)!.npc
      npc.battlefieldUnarmed = false
      npc.applyCareerEquipment({ meleeWeaponId: PRISON_SWORD_ID, rangedWeaponId: null, shieldId: null, mountId: null })
      npc.setTacticalOrder('attack')
    }
    return true
  }

  private armPrisonSword(): void {
    this.inventory.addWeapon(PRISON_SWORD_ID); this.inventory.equipWeapon(PRISON_SWORD_ID); this.inventory.meleeEnabled = true
    this.pickupHud?.notify(`已裝備 · ${WEAPONS[PRISON_SWORD_ID].name}`)
  }

  /** Host: the guest's view of the saved encounter (swords, gate, guards, result), on change and once a second. */
  private syncCoopPrison(dt: number): void {
    const prison = this.prison
    if (!prison || !this.coopHost) return
    const state = { swords: prison.swords, gateOpen: prison.gateOpen, fight: this.phase === 'fight', guards: this.counts().enemyActive, outcome: prison.result?.outcome ?? null }
    const key = JSON.stringify(state)
    this.coopPrisonClock += dt
    if (key === this.coopPrisonKey && this.coopPrisonClock < 1) return
    this.coopPrisonKey = key; this.coopPrisonClock = 0
    coopSession().send({ t: 'prisonState', ...state })
  }

  /** Guest: apply the host's encounter to this page's in-memory copy only; the host alone saves it. */
  private applyCoopPrisonState(message: CoopMessage): void {
    const prison = this.prison
    const raw = message.swords
    if (!prison || !this.props || this.disposed || !raw || typeof raw !== 'object' || Array.isArray(raw) || typeof message.gateOpen !== 'boolean') return
    const swords: Record<string, string> = {}
    for (const [index, owner] of Object.entries(raw as Record<string, unknown>)) if (/^[0-5]$/.test(index) && typeof owner === 'string') swords[index] = owner
    this.coopPrisonGuards = typeof message.guards === 'number' && Number.isFinite(message.guards) ? Math.max(0, message.guards) : null
    this.coopPrisonOutcome = message.outcome === 'victory' || message.outcome === 'failure' ? message.outcome : null
    this.coopPrisonFighting = message.fight === true
    const opening = message.gateOpen && !prison.gateOpen
    if (!opening && JSON.stringify(swords) === JSON.stringify(prison.swords)) return
    const armed = !Object.values(prison.swords).includes(PRISON_COOP_PARTNER) && Object.values(swords).includes(PRISON_COOP_PARTNER)
    const next = cloneCareerProfile(this.profile), state = next.activeMission!.prisonBreak!
    state.swords = swords
    state.gateOpen ||= message.gateOpen
    this.profile = next
    this.props.syncSwords(state)
    if (opening) { this.props.setOpen(true, true); this.clearPickupFocus() }
    if (armed) this.armPrisonSword()
  }

  private finishPrison(outcome: CareerMissionOutcome, escapedBy?: string): void {
    const firstAttempt = !this.pendingSettlement
    if (this.pendingSettlement) { outcome = this.pendingSettlement.outcome; escapedBy = this.pendingSettlement.escapedBy }
    // Freeze the final snapshot in memory. Exactly one write owns combat, receipt and reward.
    const staged = this.pendingPrisonProfile ?? this.captureProgress()
    if (!staged) return
    const state = staged.activeMission!.prisonBreak!
    this.phase = 'result'
    this.clearPickupFocus()
    this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
    if (firstAttempt && outcome === 'failure') {
      const line = prisonTaunt(state.captor, state.gateOpen, this.counts().enemyActive)
      if (line) {
        this.subtitle = document.createElement('div'); this.subtitle.id = 'prison-guard-subtitle'
        this.subtitle.textContent = line
        this.subtitle.style.cssText = 'position:fixed;bottom:14%;left:50%;transform:translateX(-50%);color:#eee;background:#111b;padding:12px 22px;font:19px system-ui;z-index:10003;pointer-events:none'
        document.body.append(this.subtitle)
      }
    }
    const saved = settlePrisonBreak(staged, outcome, next => this.store.save(next), escapedBy)
    if (!saved) {
      this.pendingPrisonProfile = staged
      this.pendingSettlement = { outcome, escapedBy, player: this.tracker.snapshot([], this.player).player }
      this.openPanel('逃脫結果尚未保存', '保存失敗；逃脫軍功尚未入帳。')
      this.button('重試保存結算', () => this.finishPrison(outcome, escapedBy))
      return
    }
    this.profile = saved; this.pendingSettlement = null; this.pendingPrisonProfile = null; this.settled = true
    this.coopHost?.notifySettled()
    this.openPrisonResult()
  }

  private openPrisonResult(): void {
    const result = this.prison!.result!
    this.settled = true; this.phase = 'result'
    const victory = result.outcome === 'victory'
    this.openPanel(victory ? '逃出牢籠' : '逃脫失敗', prisonResultDescription(this.prison!))
    this.panel!.id = 'prison-break-panel'
    this.panel!.querySelector('h2')!.style.color = victory ? '#f6d27c' : '#f0b7a3'
    const reward = document.createElement('p'); reward.id = 'prison-break-merit'
    reward.textContent = `逃脫軍功　${victory ? '+' : ''}${result.merit}`
    reward.style.cssText = 'font-size:32px;font-weight:800;color:#f6d27c;margin:12px 0'
    const note = document.createElement('small'); note.textContent = '原戰役結果仍為敗北。'
    this.panel!.append(reward, note, document.createElement('br'))
    this.button('返回小鎮', () => this.returnToTown())
  }

  private captureSettlement(outcome: CareerMissionOutcome, reason?: ArenaTrialEndReason): TrialSettlement {
    const stats = this.tracker.snapshot(this.bodies.map(body => body.npc), this.player)
    const player = { ...stats.player }
    return { outcome, ...(reason ? { reason } : {}), player, merit: player }
  }

  /** Saves the decided result, or the one already frozen by an earlier failed save. */
  private finish(outcome: CareerMissionOutcome, reason?: ArenaTrialEndReason): void {
    if (this.session) { this.session.finish(() => this.captureSettlement(outcome, reason)); return }
    if (!this.settled && this.prison) this.finishPrison(outcome)
  }

  private openResult(result: NonNullable<ActiveCareerMission['result']>): void {
    this.session!.markSettled()
    this.phase = 'result'
    const trial = this.trial, merit = result.merit
    const complete = result.outcome === 'victory'
    const saved = this.session!.profile
    const story = careerStorySettlement(saved, 'veteran-squad-spar', saved.activeMission?.id ?? '')
    this.session!.panel.show(complete ? '試煉勝利' : '試煉失敗',
      `${DUEL_ARENA_LABELS[this.arenaId]} · ${ARENA_TRIAL_DEFINITIONS[trial.tier].label}\n\n`
      + `戰鬥表現（你）\n擊倒敵人：${result.stats.kills}\n造成傷害：${Math.round(result.stats.damageDealt)}\n結束時狀態：${result.stats.survived ? '仍站立' : '被擊倒'}\n\n`
      + (story ? `軍功獎勵（老兵邀請的小隊切磋：首場固定獎勵，取代傷害與擊倒軍功）\n本次總軍功：${merit.total}`
        : `軍功獎勵（每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功）\n傷害軍功：${merit.damage}\n擊倒軍功：${merit.kills}\n任務貢獻：${merit.contribution}\n本次總軍功：${merit.total}`)
      + `${complete ? '' : trial.endReason === 'timeout' ? '\n\n試煉逾時：時限內未分出勝負，本場計為失敗；不造成永久傷亡或裝備損失。' : '\n\n我方全員被擊倒；試煉不造成永久傷亡或裝備損失。'}`)
    this.session!.addReturnButton()
  }

  /** Clears the claimed trial exactly like a Town return; a failed save keeps the arena for retry. */
  private returnToTown(): void {
    if (this.session) { this.session.returnToTown(); return }
    const active = this.profile.activeMission
    if (!active) { this.leave(); return }
    const saved = this.prison
      ? commitPrisonBreakReturn(this.profile, active.id, townRoster().map(spec => ({ spec })), next => this.commit(next))
      : this.commit(clearCareerMission(this.profile, active.id))
    if (!saved) {
      this.openPanel('返回狀態尚未保存', '結算仍安全保留。請重試保存後返回小鎮。')
      this.button('重試返回小鎮', () => this.returnToTown())
      return
    }
    this.leave()
  }

  private leave(): void { this.dispose(); this.callbacks.returnToTown() }

  private openPanel(title: string, text: string): void {
    this.closePanel()
    const panel = document.createElement('section')
    panel.id = 'arena-trial-panel'
    panel.className = 'town-panel'
    panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10002;min-width:340px;max-width:560px;background:#1b1712f0;color:#f2eadb;border:1px solid #8a6f45;border-radius:10px;padding:20px 22px;font:15px/1.6 system-ui;white-space:pre-line'
    const heading = document.createElement('h2'); heading.textContent = title; heading.style.margin = '0 0 10px'
    const body = document.createElement('p'); body.textContent = text
    panel.append(heading, body)
    document.body.append(panel)
    this.panel = panel
    if (this.prison) {
      this.dimmer?.remove(); this.dimmer = document.createElement('div')
      this.dimmer.style.cssText = 'position:fixed;inset:0;background:#0006;z-index:10000;pointer-events:none'
      document.body.append(this.dimmer)
    }
  }

  private button(label: string, action: () => void): void {
    if (!this.panel) return
    const button = document.createElement('button')
    button.className = 'town-button'; button.textContent = label; button.style.marginRight = '8px'; button.onclick = action
    this.panel.append(button)
  }

  private closePanel(): void { this.session?.panel.close(); this.panel?.remove(); this.panel = null; this.dimmer?.remove(); this.dimmer = undefined }

  dispose(): void {
    if (this.disposed) return
    this.persistNow()
    // A return to Town announces the Town; only the end of co-op itself sends 'end'.
    for (const off of this.coopUnsubscribe.splice(0)) off()
    this.coopHost?.dispose(false); this.coopHost = undefined
    this.coopGuest?.dispose(); this.coopGuest = undefined
    for (const arrow of this.coopArrows) arrow.destroy()
    for (const marker of this.coopMarkers.values()) marker.removeFromParent()
    this.coopMarkers.clear()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.listeners.abort()
    this.equipment?.dispose()
    this.closePanel()
    this.inventory?.dispose()
    this.careerMounts?.dispose()
    this.pickupHud?.dispose(); this.props?.dispose(); this.prisonHud?.remove(); this.subtitle?.remove(); this.dimmer?.remove()
    this.input.dispose()
    this.hud.dispose(); this.openingHud.dispose(); this.targetHud.dispose(); this.weaponWheelUI.dispose(); this.damageNumbers.clear()
    for (const shot of this.shots) shot.arrow.destroy()
    this.shots = []
    for (const body of this.bodies) { body.marker.removeFromParent(); body.npc.dispose() }
    this.bodies = []
    this.markerMaterials.friendly.dispose(); this.markerMaterials.enemy.dispose()
    this.tracker?.dispose()
    this.player?.dispose()
    this.arena?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private coopPort(guest: boolean): CoopGamePort {
    const trial = this, scene = this.scene
    const inScene = (group: THREE.Object3D): boolean => {
      for (let node: THREE.Object3D | null = group; node; node = node.parent) if (node === scene) return true
      return false
    }
    const enemyBody = (npc: NPC): boolean => this.bodies.some(body => body.team === 'enemy' && body.npc === npc)
    const hostNpcs: NPC[] = [], hostMounts: Mount[] = []
    return {
      scene, camera: this.camera, hpBar: this.hp,
      get player() { return trial.player },
      get npcs() { return guest ? trial.coopGuestNpcs : NPC.live.collect(npc => inScene(npc.group), hostNpcs) },
      get mounts() { return guest ? trial.coopGuestMounts : Mount.live.collect(mount => !mount.disposed && inScene(mount.group), hostMounts) },
      arrows: this.coopArrows, selfUpdatesPuppets: true, guestSquad: false,
      // Only the enemy team (and its mounts), only while the fight is live.
      acceptsGuestHit: target => this.phase === 'fight' && !target.dead
        && (target instanceof NPC ? enemyBody(target) : this.bodies.some(body => body.team === 'enemy' && body.npc.mount === target)),
      guestTarget: npc => enemyBody(npc),
      // The guest earns its own merit (solo rules) once the host's claim or escape result is saved.
      missionSettlement: () => {
        const missionId = this.profile.activeMission?.id, prison = this.prison
        const saved = missionId ? new CareerProfileStore().loadChecked().profile : null
        if (prison) {
          // Its own receipt: the parent battle's id is already the receipt of that lost battle.
          const result = saved?.activeMission?.id === missionId ? saved?.activeMission?.prisonBreak?.result : undefined
          return result ? { missionId: `${missionId}:prison-break`, kind: 'prison-break' as const, victory: result.outcome === 'victory', prison: prison.templateId } : null
        }
        if (!missionId || !saved?.claimedBattleIds.includes(missionId)) return null
        return { missionId, kind: 'arena-squad-trial' as const, victory: saved.activeMission?.result?.outcome === 'victory' }
      },
      combatEmit: event => this.emit(event),
      get ownMount() { return trial.careerMounts?.activeMount ?? null },
      equippedWeapons: () => ({ melee: this.inventory.activeMelee?.id ?? null, ranged: this.inventory.selectedRanged?.id ?? null, shield: this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null }),
      weaponsDrawn: () => ({ melee: this.inventory.meleeEnabled, shield: this.inventory.shieldEnabled }),
      registerNpc: () => {}, unregisterNpc: () => {}, registerMount: () => {}, unregisterMount: () => {},
      markVisualArrow: arrow => { this.coopVisualArrows.add(arrow) },
    }
  }

  private updateCoopArrows(dt: number): void {
    for (let i = this.coopArrows.length - 1; i >= 0; i--) {
      const arrow = this.coopArrows[i]
      if (this.coopVisualArrows.has(arrow)) arrow.update(dt, this.player, [], this.arena.obstacles, () => {}, () => damagePlayer(this.player, 0, this.hp, null), undefined, true)
      if (!arrow.isAlive) { this.coopArrows.splice(i, 1); this.coopVisualArrows.delete(arrow) }
    }
  }

  /** LAN co-op guest: show the host's trial; this page's own bodies leave the scene. */
  startCoopGuest(): void {
    const own = new Set([this.careerMounts?.activeMount, this.player.currentMount].filter((mount): mount is Mount => Boolean(mount)))
    for (const body of this.bodies) { body.marker.removeFromParent(); body.npc.dispose() }
    this.bodies = []
    for (const npc of NPC.live.collect(() => true)) npc.group.removeFromParent()
    for (const mount of Mount.live.collect(mount => !own.has(mount))) mount.group.removeFromParent()
    for (const shot of this.shots) shot.arrow.destroy()
    this.shots = []
    // Stand beside the host instead of inside it; the host's opening and result belong to the host.
    const body = this.player.currentMount?.group.position ?? this.player.group.position
    body.x += 2.5
    this.phase = 'fight'
    this.coopGuest = new CoopGuestMission(this.coopPort(true), reason => showCoopGuestEnd(reason))
    if (this.prison) this.coopUnsubscribe.push(coopSession().on('prisonState', message => this.applyCoopPrisonState(message)))
    this.start()
  }

  /** Guest frame: own movement and attacks; the host owns the bodies, the timer and the result. */
  private updateCoopGuest(dt: number): void {
    if (this.equipment?.visible) { this.input.clear(); return }
    this.elapsed += dt
    // Read before the Player's own update, as the host does, so E is the sword's.
    const pickupPressed = this.prison ? this.input.consumeKeyE() : false
    this.updateCamera(dt)
    if (!this.player.dead) {
      let step: ReturnType<PlayerInput['consumeWheelStep']>
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
    this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(this.aimPoint), this.arena.obstacles,
      this.stamina, this.quiver, this.sound, this.inventory, this.skills.getRangedMultiplier(), true)
    if (!this.player.dead && this.player.isGrounded) {
      const mount = this.player.currentMount
      if (mount) { if (this.arena.constrainGroundedBody(mount.group.position)) this.player.syncMountTransform() }
      else this.arena.constrainGroundedBody(this.player.group.position)
    }
    const guest = this.coopGuest!
    guest.updateWorld(dt)
    this.resolveBodies()
    separateLocalPlayerFromPeer(this.player, guest.hostAvatar, this.arena.obstacles)
    this.melee()
    this.mountImpacts()
    // A sword pickup is a request; the host claims it and the next prison state arms this Player.
    if (this.prison) {
      const selected = this.pickupFocus.pressed(pickupPressed, this.prisonPickupCandidates(), this.player.position)
      if (selected) coopSession().send({ t: 'prisonPickup', index: this.props!.swords.indexOf(selected.target) })
    }
    this.updateShots(dt)
    this.updateCoopArrows(dt)
    if (this.careerMounts) {
      this.careerMounts.update(dt)
      this.player.fitMountedSeat()
    }
    this.arena.update(dt)
    this.props?.update(dt)
    if (this.prison) this.updatePickupFocus()
    this.updatePrisonHud()
    this.syncCoopMarkers(this.coopGuestNpcs.map(npc => [npc, guest.targets.includes(npc) ? 'enemy' : 'friendly'] as const))
    this.damageNumbers.update(dt, this.camera)
    this.weaponWheelUI.update(this.inventory, !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    this.session?.tickSkillFlush(this.elapsed, dt)
  }

  /** DEV QA: advance the real gameplay step at a fixed 60 Hz with held key codes. */
  advanceForQa(seconds: number, held: string[] = []): void {
    if (!import.meta.env.DEV) return
    for (const code of held) this.input.keys[code] = true
    try { for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60) }
    finally { for (const code of held) this.input.keys[code] = false }
  }
  get qa() {
    return import.meta.env.DEV ? {
      player: this.player, orbit: this.orbit, arena: this.arena, profile: () => this.profile,
      phase: () => this.phase, knocked: () => [...this.knocked],
      bodies: () => this.bodies.map(body => ({ id: body.actorId, team: body.team, hp: body.npc.hp, dead: body.npc.dead, faction: body.npc.faction,
        character: body.npc.characterFaction, name: body.npc.name, x: body.npc.combatPosition.x, z: body.npc.combatPosition.z })),
      npcs: () => this.bodies.map(body => body.npc),
    } : null
  }
}
