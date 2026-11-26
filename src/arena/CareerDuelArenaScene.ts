import * as THREE from 'three'
import { ArenaPanel, CareerArenaSession, type ArenaSettlement } from './CareerArenaSession'
import { createDuelArena, type DuelArenaEnvironment } from './DuelArena'
import { DUEL_ARENA_LABELS, type DuelArenaId } from './DuelArenaCatalog'
import { ARENA_DUEL_REFEREE_SLOTS } from './DuelArenaVenue'
import { ArenaChaseRoute, ArenaSupportTracker, arenaStandingFeet } from './DuelArenaChase'
import { CareerDuelController, duelLoadout, type CareerDuelOpponentRequest, type CareerDuelResident } from '../career/CareerDuelController'
import { resolveCareerDuelClass } from '../career/CareerDuelClasses'
import { careerDuelArena, isCareerDuelPresetId, isCareerDuelTier, type CareerDuelTier } from '../career/CareerDuelState'
import type { CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CareerMountController } from '../career/CareerMountController'
import { HERO_CLASS_NAMES } from '../career/CareerHeroClasses'
import { resolveCareerHeroAsset, resolveCareerOrdinaryTier, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import { TOWN_ENTRY_KEY } from '../town/CareerTownEntry'
import type { ActiveCareerMission, CareerMissionOutcome } from '../career/CareerMissionState'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { createNpcCombatActorRef, createPlayerCombatActorRef, type CombatDamageMethod, type CombatEvent } from '../combat/CombatAttribution'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { damageMount, damageNpc, damagePlayer } from '../combat/DamageRouter'
import { applyMountImpactDamage, applyMountImpactKnockback, checkMountImpact } from '../combat/MountImpact'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { ProjectileAdmission } from '../combat/ProjectileAdmission'
import { ProjectileContactQuery } from '../combat/ProjectileContactQuery'
import { SHIELD_CONFIG, type CombatContact } from '../combat/ShieldBlocking'
import { traceFistStrike, unarmedDamage } from '../combat/UnarmedCombat'
import { playAppliedPunchHit, SoundManager } from '../audio/SoundManager'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { Player, DEFAULT_PLAYER_MAX_HP } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { WeaponWheel } from '../player/WeaponWheel'
import { resolveActivePlayerSkillProgressionAward, resolveCombatSkill } from '../rpg/CombatSkillProgression'
import { SkillManager, syncPlayerSkillCombatLevels } from '../rpg/SkillManager'
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { TownEquipment } from '../town/TownEquipment'
import { ArenaEquipmentMenu } from './ArenaEquipmentMenu'
import { townCommanderHeroAsset } from '../town/TownCommander'
import { townCaptainProfile, type TownActorSpec } from '../town/TownRules'
import { CareerDuelHUD } from '../ui/CareerDuelHUD'
import { CombatTargetHud } from '../ui/CombatTargetHud'
import { DamageNumbers } from '../ui/DamageNumbers'
import { HpBar } from '../ui/HpBar'
import { QuiverUI } from '../ui/QuiverUI'
import { StaminaBar } from '../ui/StaminaBar'
import { WeaponWheelUI } from '../ui/WeaponWheelUI'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { ProjectileInstanceBatch } from '../world/ProjectileInstanceBatch'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { CorgiVisual } from '../world/CorgiVisual'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { prepareByzantineEquipment, preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { Mount, MountType, mountTypeFromId } from '../world/Mount'
import { AIType, Faction, NPC } from '../world/NPC'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { SnowLeopardVisual } from '../world/SnowLeopardVisual'
import { resolveEntityCollision, type ObstacleData } from '../world/Terrain'
import { bindWindowResize, createSceneRenderer, GAMEPLAY_SCENE_MAX_PIXEL_RATIO } from '../rendering/SceneRenderer'
import { coopSession } from '../coop/CoopLink'
import { announceCoopScene, coopGuestCharacterAssets, coopGuestPlayerSource, isCoopGuestLaunch, showCoopGuestEnd, type CoopPlayerSource } from '../coop/CoopLaunch'
import { felineVariantFromMountId } from '../world/Mount'
import { CoopGuestMission, CoopHostMission, separateLocalPlayerFromPeer, type CoopGamePort } from '../coop/CoopMission'

const PLAYER_HALF_HEIGHT = 0.95

export interface CareerDuelArenaCallbacks {
  /** The duel is settled (or cancelled) and saved; Town may be rebuilt. */
  returnToTown(): void
}

interface Shot {
  arrow: ArrowProjectile
  player: boolean
  source?: NPC
  age: number
}

/** The opponent and referee bodies a saved arena duel needs, derived from its saved rules. */
interface ArenaDuelParty {
  residents: CareerDuelResident[]
  mounts: Mount[]
  blackCat: Mount
}

export type ArenaDuelBodyKind = 'ordinary' | 'captain' | 'ranger' | 'commander'

/**
 * Which bodies an arena duel builds from its saved rules, matching the Town residents the
 * duel borrowed: T1–T3 an ordinary soldier (riding its own mount for a mounted armed duel),
 * T4 the Captain or the Ranger for an archer preset, T5 the Commander (its mission mount is
 * created by the duel itself). The referee is a separate body unless it is the opponent.
 */
export function arenaDuelPartyPlan(active: Pick<ActiveCareerMission, 'duelPresetId' | 'duelTier' | 'duelMode' | 'duelOpponentActorId' | 'duelRefereeActorId' | 'duelCaptainActorId'>): {
  opponent: ArenaDuelBodyKind; opponentBorrowsMount: boolean; referee: ArenaDuelBodyKind | null; captain: boolean
} {
  const tier = active.duelTier ?? 1
  const archer = Boolean(active.duelPresetId && UNIT_PRESETS[active.duelPresetId].traits.includes('bow_fire'))
  const opponent: ArenaDuelBodyKind = tier === 5 ? 'commander' : tier === 4 ? (archer ? 'ranger' : 'captain') : 'ordinary'
  const refereeId = active.duelRefereeActorId ?? active.duelCaptainActorId
  return {
    opponent,
    // Only the T4 Ranger rides the cat; an ordinary T1–T3 horse archer still owns its own horse.
    opponentBorrowsMount: tier < 5 && !(archer && tier === 4) && active.duelMode !== 'unarmed',
    referee: refereeId && refereeId !== active.duelOpponentActorId ? (refereeId === 'ranger' ? 'ranger' : 'captain') : null,
    captain: Boolean(active.duelCaptainActorId && active.duelCaptainActorId !== active.duelOpponentActorId && active.duelCaptainActorId !== refereeId),
  }
}

/**
 * Independent Career scene for a formal 1v1 duel. Duel rules (phases, countdown, timer,
 * outcome, illegal unarmed attacks, checkpoint cadence) stay in CareerDuelController; this
 * host only owns the arena, the bodies and the physical damage routing between the player
 * and the one opponent. Settlement uses the ordinary Career claim/clear transactions.
 */
export class CareerDuelArenaScene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900)
  private readonly store = new CareerProfileStore()
  private readonly input = new PlayerInput()
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly duelHud = new CareerDuelHUD()
  private readonly targetHud = new CombatTargetHud()
  private readonly damageNumbers = new DamageNumbers()
  private readonly weaponWheel = new WeaponWheel()
  private readonly weaponWheelUI = new WeaponWheelUI()
  private readonly skills = new SkillManager()
  private readonly shotContacts = new ProjectileContactQuery()
  private readonly projectileAdmission = new ProjectileAdmission(64, 0)
  private readonly sound = new SoundManager()
  private readonly listeners = new AbortController()
  private arena!: DuelArenaEnvironment
  private player!: Player
  private orbit!: ThirdPersonCamera
  private inventory!: TownEquipment
  private equipment?: ArenaEquipmentMenu
  private careerMounts!: CareerMountController
  private duel!: CareerDuelController
  private party!: ArenaDuelParty
  private readonly navigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 })
  private readonly stairNavigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 })
  private shots: Shot[] = []
  private elapsed = 0
  /** LAN co-op: the host bridge (2v1), or this page's mirror of the host's arena. */
  private coopHost?: CoopHostMission
  private coopGuest?: CoopGuestMission
  private readonly coopArrows: ArrowProjectile[] = []
  /** Co-op guest: the guest's own character profile (in memory); the host's profile still runs the duel. */
  private coopPlayerSource: CoopPlayerSource | null = null
  private get playerProfile(): CareerProfile { return this.coopPlayerSource?.read() ?? this.profile }
  private commitPlayerProfile(next: CareerProfile): boolean { return this.coopPlayerSource ? this.coopPlayerSource.commit(next) : this.commit(next) }
  private readonly coopVisualArrows = new Set<ArrowProjectile>()
  private readonly coopGuestNpcs: NPC[] = []
  private readonly coopGuestMounts: Mount[] = []
  private raf = 0
  private last = 0
  private disposed = false
  private pauseMenuOpen = false
  private pointerWasLocked = false
  private readonly aimPoint = new THREE.Vector3()
  /**
   * Profile commits, skill saves, the once-only claim and the Town return. A decided result whose
   * save failed stays frozen there — no clocks, AI, shots or player actions — until the retry button.
   */
  private readonly session: CareerArenaSession<ArenaSettlement>

  private constructor(private readonly container: HTMLElement, private readonly renderer: THREE.WebGLRenderer,
    profile: CareerProfile, private readonly arenaId: DuelArenaId, private readonly callbacks: CareerDuelArenaCallbacks) {
    // Built here: field initializers run before parameter properties are assigned.
    this.chaseRoute = new ArenaChaseRoute(arenaId)
    this.session = new CareerArenaSession<ArenaSettlement>(profile, {
      noun: '單挑', panel: new ArenaPanel('duel-arena-panel'), store: this.store, skills: this.skills, sound: this.sound, input: this.input,
      player: () => this.player,
      coopCharacter: () => this.coopPlayerSource,
      prepareReturn: (next, active) => {
        // A finished duel returns the mount armour it borrowed for the fight.
        if (active.result || this.profile.claimedBattleIds.includes(active.id)) delete next.mountArmor
      },
      openResult: result => this.openResult(result),
      leave: () => this.leave(),
    })
  }

  private get profile(): CareerProfile { return this.session.profile }
  private get panel(): boolean { return this.session.panel.isOpen }
  private get pendingSettlement(): ArenaSettlement | null { return this.session.pendingSettlement }

  get activeMission(): ActiveCareerMission | undefined { return this.profile.activeMission }

  /** Loads and builds the saved arena duel. Throws on a technical failure; the save is untouched. */
  static async create(container: HTMLElement, callbacks: CareerDuelArenaCallbacks, progress: (text: string) => void = () => {}): Promise<CareerDuelArenaScene> {
    const loaded = new CareerProfileStore().loadChecked()
    const profile = loaded.profile
    const arenaId = careerDuelArena(profile?.activeMission)
    if (!profile || !arenaId) throw new Error('沒有可載入的競技場單挑任務')
    const renderer = createSceneRenderer({
      maxPixelRatio: GAMEPLAY_SCENE_MAX_PIXEL_RATIO,
      toneMappingExposure: arenaId === 'roman-colosseum' ? 1.08 : 1.2,
    })
    const scene = new CareerDuelArenaScene(container, renderer, profile, arenaId, callbacks)
    try {
      await scene.initialize(progress)
      return scene
    } catch (error) {
      scene.dispose()
      throw error
    }
  }

  private commit(next: CareerProfile): boolean { return this.session.commit(next) }

  private async initialize(progress: (text: string) => void): Promise<void> {
    const active = this.profile.activeMission!
    const faction = this.profile.faction
    if (!isCareerDuelPresetId(active.duelPresetId) || !isCareerDuelTier(active.duelTier)) throw new Error('單挑任務資料不完整')
    progress(`正在載入${DUEL_ARENA_LABELS[this.arenaId]}、對手與坐騎…`)
    const hero = active.duelClassId ? resolveCareerDuelClass(faction, active.duelPresetId, active.duelTier, active.duelClassId) : undefined
    const selected = duelLoadout(active.duelPresetId, active.duelTier, hero)
    // Co-op guest: its own character (from its own save) fights on the host's side.
    this.coopPlayerSource = isCoopGuestLaunch() ? coopGuestPlayerSource(this.profile) : null
    const coopCharacter = coopGuestCharacterAssets()
    const coopFeline = felineVariantFromMountId(coopCharacter?.mountId)
    const heroAssets = new Set([resolveCareerHeroAsset(this.profile), coopCharacter?.hero, townCaptainProfile(faction).visualAssetId, 'maki-archer-t4' as const,
      townCommanderHeroAsset(faction), hero?.visualAssetId].filter((id): id is NonNullable<typeof id> => Boolean(id)))
    const [, equipment] = await Promise.all([
      Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(this.renderer), preloadPaladinEquipment(), preloadHighTierEquipment(),
        preloadMakiRangerBow(), BlackCatVisual.preloadVariants(new Set(['black-cat', ...(coopFeline ? [coopFeline] : [])])), CorgiVisual.preload(), SnowLeopardVisual.preload(),
        ...[...heroAssets].map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))]),
      prepareByzantineEquipment([selected.meleeWeaponId, selected.shieldId, this.profile.equipment?.melee, this.profile.equipment?.shield, ...(coopCharacter?.equipmentIds ?? [])]),
    ])
    if (equipment !== 'ready') throw new Error('單挑裝備資源載入失敗')
    if (this.disposed) return
    this.container.appendChild(this.renderer.domElement)
    // The arena installs ground, bounds and fall rules before any actor reads them.
    this.arena = createDuelArena(this.arenaId, this.scene)
    this.navigation.sync(this.arena.obstacles)
    this.stairNavigation.sync([])
    const body = this.playerProfile
    this.skills.setSkillState(body.skills ?? {})
    this.inventory = new TownEquipment(() => this.playerProfile, next => this.commitPlayerProfile(next))
    this.player = new Player(this.scene, body.faction, resolveCareerHeroAsset(body), resolveCareerOrdinaryTier(body))
    this.player.setMaxHp(resolveCareerPlayerMaxHp(body, DEFAULT_PLAYER_MAX_HP), true)
    this.player.setDamageHud(this.hp)
    syncPlayerSkillCombatLevels(this.player, this.skills.skillState)
    this.player.onShieldBlock = impact => this.session.awardSkillXp({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, 'arrow', undefined, event.visualKind)
    const spawn = this.arena.spawns.player
    this.player.resetForScene(spawn.x, spawn.y + PLAYER_HALF_HEIGHT, spawn.z)
    this.playerFeet = this.playerSupport.observe(spawn, true) // The spawn is the first known support level.
    this.player.faceDirection(Math.sin(spawn.yaw), Math.cos(spawn.yaw))
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.orbit.setYaw(spawn.yaw + Math.PI)
    this.party = this.createParty(active, selected)
    this.careerMounts = new CareerMountController(this.scene, () => this.player, () => this.playerProfile, next => this.commitPlayerProfile(next),
      // Overhead roof volumes cannot block summoning a mount on the floor below them.
      () => this.mountObstacles, () => this.party.residents.map(resident => resident.npc.combatPosition), () => `duel-arena:${this.arenaId}`)
    // A ridden ground mount comes along to an armed duel; eagles never fly inside an arena.
    if (active.duelMode !== 'unarmed' && active.mountState?.activeMountId && active.mountState.activeMountId !== 'xongkoro') this.careerMounts.restoreActiveMount(false)
    const venueReferee = ARENA_DUEL_REFEREE_SLOTS[this.arenaId]
    this.duel = new CareerDuelController(this.scene, { obstacles: this.arena.obstacles }, this.navigation, this.party.residents, this.party.blackCat,
      () => this.player, () => this.profile, next => this.commit(next),
      (scene, mountId, x, z) => this.trackMount(new Mount(scene, mountTypeFromId(mountId), x, z)),
      request => this.createClassBody(request),
      { area: new THREE.Vector3(0, 0, 0), player: spawn, opponent: this.arena.spawns.opponent, referee: venueReferee }, false)
    if (!active.result && !this.duel.startActiveMission()) throw new Error('單挑對手部署失敗')
    // The Ranger's cat exists only for a mounted T4 archer duel; otherwise it never appears.
    const catInUse = this.duel.allMounts.includes(this.party.blackCat)
    this.party.blackCat.group.visible = catInUse
    if (!catInUse) { this.ownedMounts.delete(this.party.blackCat); this.party.blackCat.dispose() }
    this.inventory.prepareForCombat()
    if (active.duelMode === 'unarmed') this.player.unarmedDuelOnly = true
    this.hp.setFill(this.player.hpRatio)
    this.quiver.setArrowCount(this.player.arrowCount)
    this.bindInput()
    progress('準備完成')
  }

  /** Bodies follow the saved rules: ordinary T1–T3 soldier, T4 Captain or Ranger, T5 Commander; the referee watches from the side. */
  private createParty(active: ActiveCareerMission, selected: UnitLoadout): ArenaDuelParty {
    const faction = this.profile.faction
    const presetId = active.duelPresetId as UnitPresetId, tier = active.duelTier as CareerDuelTier
    const mounts: Mount[] = []
    const blackCat = this.trackMount(new Mount(this.scene, MountType.BLACK_CAT, 40, 40))
    blackCat.reservedForTown = true
    blackCat.catVisual?.setEquipmentVisible(true)
    const opponentId = active.duelOpponentActorId!, refereeId = active.duelRefereeActorId ?? active.duelCaptainActorId!
    const captainId = active.duelCaptainActorId!
    const spec = (id: string, role: TownActorSpec['role'], mounted: boolean): TownActorSpec =>
      ({ id, role, duty: 'training', x: 0, z: 0, yaw: Math.PI, mounted, unitKind: 'melee' }) as unknown as TownActorSpec
    const build = (id: string, kind: 'ordinary' | 'captain' | 'ranger' | 'commander', withMount: boolean): CareerDuelResident => {
      const captain = townCaptainProfile(faction)
      const loadout: UnitLoadout = kind === 'ranger'
        ? { meleeWeaponId: defaultRangerMeleeWeaponId(faction), rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null, reversibleRangedSwitch: true }
        : { ...selected, mountId: null }
      const visual = kind === 'captain' ? captain.visualAssetId : kind === 'ranger' ? 'maki-archer-t4' as const : kind === 'commander' ? townCommanderHeroAsset(faction) : undefined
      const npc = new NPC(this.scene, 0, 0, Faction.TOWN, faction, loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
        kind === 'commander' ? `${faction === 'roman' ? '羅馬' : '維京'}指揮官` : kind === 'captain' ? '隊長' : kind === 'ranger' ? '遊俠' : '士兵',
        kind === 'ordinary' ? Math.min(3, tier) as 1 | 2 | 3 : 4, false, loadout, kind === 'ordinary' ? presetId : undefined, undefined, id, undefined,
        visual, kind === 'ranger' ? 'ranger' : visual ? HERO_COMBAT_PROFILE_BY_ASSET[visual] : undefined, kind === 'ranger' ? 'maki-ranger' : undefined,
        undefined, undefined, undefined, undefined, kind === 'commander' ? 5 : kind === 'ordinary' ? undefined : 4)
      npc.setTownPeaceful()
      let homeMount: Mount | undefined
      if (withMount && selected.mountId) {
        homeMount = this.trackMount(new Mount(this.scene, mountTypeFromId(kind === 'captain' ? captain.mountOverride ?? selected.mountId : selected.mountId), 0, 0))
        homeMount.reservedForTown = true
        npc.mountVehicle(homeMount)
        mounts.push(homeMount)
      }
      const role = kind === 'commander' ? 'commander' : kind === 'captain' ? 'captain' : kind === 'ranger' ? 'ranger' : 'soldier'
      return { spec: spec(id, role as TownActorSpec['role'], Boolean(homeMount)), npc, homeMount }
    }
    const plan = arenaDuelPartyPlan(active)
    const residents: CareerDuelResident[] = [build(opponentId, plan.opponent, plan.opponentBorrowsMount)]
    if (plan.referee) residents.push(build(refereeId, plan.referee, false))
    if (plan.captain) residents.push(build(captainId, 'captain', false))
    return { residents, mounts, blackCat }
  }

  /** The chosen T4/T5 class body, built like the Town double with the resident's identity. */
  private createClassBody({ resident, hero, presetId, loadout }: CareerDuelOpponentRequest): NPC | null {
    const native = resident.npc
    const npc = new NPC(this.scene, native.group.position.x, native.group.position.z, native.faction, native.characterFaction,
      loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE, native.name, 4, Boolean(loadout.mountId), loadout, presetId,
      undefined, native.combatantId, undefined, hero.visualAssetId, hero.combatProfileId, undefined, undefined, undefined, undefined, undefined, hero.tier, hero.heroArchetype)
    npc.setTownPeaceful()
    return npc
  }

  private get mountObstacles(): ObstacleData[] {
    return this.arena.obstacles.filter(obstacle => !(obstacle.navigationPassable && !obstacle.walkSurface && obstacle.box.min.y > 4))
  }

  private chaseWaypoint: { x: number; z: number } | null = null
  private readonly chaseRoute: ArenaChaseRoute
  private chaseCommand = 900_000
  private readonly ownedMounts = new Set<Mount>()
  private trackMount(mount: Mount): Mount { this.ownedMounts.add(mount); return mount }

  private bindInput(): void {
    const signal = this.listeners.signal
    this.equipment = new ArenaEquipmentMenu(this.input, this.skills, this.inventory, this.renderer.domElement,
      () => !this.disposed && !this.player.dead && !this.panel && !this.pendingSettlement && !this.profile.activeMission?.result,
      this.careerMounts)
    this.renderer.domElement.addEventListener('click', () => {
      this.sound.unlockAudio()
      if (!location.search.includes('nolock') && !this.panel && !this.equipment?.visible) this.input.requestPointerLock(this.renderer.domElement)
    }, { signal })
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement
      const released = this.pointerWasLocked && !locked
      this.pointerWasLocked = locked
      if (released && !location.search.includes('nolock')) this.openPauseMenu()
    }, { signal })
    window.addEventListener('keydown', e => {
      if (this.disposed || this.coopGuest || this.pendingSettlement || this.profile.activeMission?.result) return
      if (this.pauseMenuOpen) {
        if (!e.repeat && e.code === 'KeyS') { e.preventDefault(); this.saveMissionManually(); return }
        if (!e.repeat && e.code === 'Escape') { e.preventDefault(); this.closePauseMenu(); return }
      } else if (!e.repeat && e.code === 'Escape' && !this.equipment?.visible && !this.panel) {
        e.preventDefault()
        this.openPauseMenu()
      }
    }, { signal })
    bindWindowResize(this.camera, this.renderer, signal)
  }

  start(): void {
    this.last = performance.now()
    if (!this.coopGuest && coopSession().isHost) {
      this.coopHost = new CoopHostMission(this.coopPort(false))
      this.duel.coopPartnerAlive = () => Boolean(this.coopPartner)
      announceCoopScene('arena')
    }
    if (this.profile.activeMission?.result && !this.coopGuest) this.openResult(this.profile.activeMission.result)
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
    if (this.equipment?.visible || this.pauseMenuOpen) { this.input.clear(); return }
    if (this.pendingSettlement) {
      // Only presentation moves while the decided result waits for its save.
      this.arena.update(dt)
      this.damageNumbers.update(dt, this.camera)
      return
    }
    this.elapsed += dt
    // Co-op 2v1 bridge: after the freezes above, so a paused duel never advances for the guest either.
    if (this.coopHost) { this.coopHost.update(dt); this.updateCoopArrows(dt) }
    const active = this.profile.activeMission
    if (!this.panel) this.orbit.update(this.input, dt, this.arena.obstacles)
    if (!this.player.dead && !this.panel) {
      let step: ReturnType<PlayerInput['consumeWheelStep']>
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
    const combat = Boolean(active && !active.result && this.duel.active)
    this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(this.aimPoint), this.arena.obstacles,
      this.stamina, this.quiver, this.sound, this.inventory, this.skills.getRangedMultiplier(), combat && !this.panel)
    // The ground boundary holds living, supported bodies only; falls always complete.
    if (!this.player.dead && this.player.isGrounded) {
      const mount = this.player.currentMount
      if (mount) { if (this.arena.constrainGroundedBody(mount.group.position, true)) this.player.syncMountTransform() }
      else this.arena.constrainGroundedBody(this.player.group.position)
    }
    this.updatePlayerSupport()
    // Actors keep animating after the result (death, idle); only live combat routes damage.
    if (this.duel.actors.length) this.updateActors(dt)
    if (combat) {
      this.melee()
      this.resolveBodies()
    }
    separateLocalPlayerFromPeer(this.player, this.coopHost?.guestProxy, this.arena.obstacles)
    this.updateShots(dt)
    this.careerMounts.update(dt)
    this.player.fitMountedSeat()
    this.arena.update(dt)
    if (combat) {
      this.duel.update(dt)
      // In co-op 2v1 the duel is lost only when both players are down.
      this.settleFrame(this.duel.evaluate())
    }
    this.damageNumbers.update(dt, this.camera)
    const phase = this.duel?.active && !this.panel ? this.duel.phase : null
    this.duelHud.update(phase, this.duel.countdownRemaining, this.duel.combatRemaining, this.duel.combatElapsedSeconds)
    this.weaponWheelUI.update(this.inventory, !this.panel && !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    this.session.tickSkillFlush(this.elapsed, dt)
  }

  /**
   * Where the player is supported: a ground mount's own position when riding, else the feet under the
   * pelvis-origin body. Sampled every frame (countdown included), so the last grounded level is already
   * known whenever the opponent starts chasing.
   */
  private updatePlayerSupport(): void {
    const mount = this.player.isMounted ? this.player.currentMount : null
    this.playerFeet = this.playerSupport.observe(
      arenaStandingFeet(this.player.position, mount && !mount.isFlyingMount ? mount.group.position : null, PLAYER_HALF_HEIGHT),
      this.player.isGrounded)
  }
  private readonly playerSupport = new ArenaSupportTracker()
  private playerFeet = { x: 0, y: 0, z: 0 }

  private updateActors(dt: number): void {
    // Same per-frame topology sync and path-search budget reset as Town; without it the budget never refills.
    this.navigation.sync(this.arena.obstacles)
    this.navigation.beginFrame()
    this.stairNavigation.beginFrame()
    for (const actor of this.duel.actors) {
      const distance = actor.group.position.distanceTo(this.camera.position)
      if (actor.dead) { actor.update(dt, this.player, [], [], this.arena.obstacles, this.hp, () => {}, () => false, false, distance); continue }
      const combatant = actor === this.duel.opponent && this.duel.combatEnabled
      // Co-op 2v1: the opponent fights whichever living player is nearer.
      const partner = combatant ? this.coopPartner : null
      const onPartner = Boolean(partner && (this.player.dead
        || partner.combatPosition.distanceToSquared(actor.combatPosition) < this.player.combatPosition.distanceToSquared(actor.combatPosition)))
      if (combatant) actor.setMissionCombatTarget(onPartner ? partner : undefined)
      // Raised stands/dais are reached by their stairs; the route holds its flight until the far end.
      const chase = combatant && !this.player.dead && !onPartner
      if (!chase && actor === this.duel.opponent) this.chaseRoute.reset()
      const waypoint = chase ? this.chaseRoute.next(
        { x: actor.combatPosition.x, y: actor.combatPosition.y, z: actor.combatPosition.z },
        this.playerFeet) : null
      if (waypoint) {
        if (!this.chaseWaypoint || this.chaseWaypoint.x !== waypoint.x || this.chaseWaypoint.z !== waypoint.z) {
          this.chaseWaypoint = waypoint
          const target = new THREE.Vector3(waypoint.x, actor.combatPosition.y, waypoint.z)
          actor.assignFormationTarget(++this.chaseCommand, target, target.clone().sub(actor.combatPosition), actor.mount ? 11 : 7)
        }
        // Stair legs are straight; the ground grid cannot see a flight crossing the arena wall,
        // so travel uses an open route while physics still follows walk planes and walls.
        actor.updateTownTravel(dt, distance, [], this.arena.obstacles, this.stairNavigation)
        continue
      }
      if (this.chaseWaypoint && actor === this.duel.opponent) { this.chaseWaypoint = null; actor.setTacticalOrder('attack') }
      if (combatant) {
        actor.update(dt, this.player, partner ? [...this.duel.actors, partner] : this.duel.actors, [], this.arena.obstacles, this.hp,
          // The opponent can only reach the players (host or co-op partner) or their mounts.
          (damage, isPlayer, target, targetMount) => {
            if (isPlayer) this.damagePlayerFrom(actor, damage, 'melee')
            else if (partner && (target === partner || targetMount === partner.mount)) this.damagePartnerFrom(actor, damage, 'melee')
            else if (targetMount) this.hitMount(targetMount, damage, 'melee', actor)
          },
          (origin, direction, kind) => this.fire(origin, direction, actor.rangedProjectileSpeed, actor.rangedDamage, kind, actor),
          false, distance, null, null, this.navigation)
      } else {
        if (actor.mount) { actor.mount.beginControlledFrame(); actor.mount.finishControlledFrame(dt, this.arena.obstacles) }
        actor.updateTownPeace(dt, distance, false, false)
      }
    }
    for (const mount of new Set([...this.duel.allMounts, ...this.party.mounts].filter(mount => !mount.disposed))) {
      mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
      if (mount.dead || !mount.riderNpc && !mount.riderPlayer) mount.update(dt, this.arena.obstacles)
    }
    // Mounted contacts both ways, through the same impact rules as Town.
    const opponent = this.duel.opponent
    if (!opponent || !this.duel.combatEnabled) return
    const opponentMount = opponent.mount
    if (opponentMount && !opponentMount.dead && !opponent.dead && !this.player.dead && checkMountImpact(opponentMount, this.player.combatPosition, 0.6)) {
      applyMountImpactDamage(opponentMount, this.player, this.player.combatPosition, this.elapsed, damage => this.damagePlayerFrom(opponent, damage, 'mount-impact'))
    }
    const playerMount = this.player.currentMount
    if (playerMount && !playerMount.dead && !opponent.dead && checkMountImpact(playerMount, opponent.combatPosition, 0.5)) {
      applyMountImpactDamage(playerMount, opponent, opponent.combatPosition, this.elapsed, damage => this.hitOpponent(opponent, damage, 'mount-impact'))
    }
  }

  /** Host: the guest's living proxy fighting on this side of a 2v1 duel. */
  private get coopPartner(): NPC | null {
    const proxy = this.coopHost?.guestProxy
    return proxy && !proxy.dead ? proxy : null
  }

  private damagePartnerFrom(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    const partner = this.coopPartner
    contact ??= source.unarmedContact
    if (!partner || !this.duel.canDamagePlayer(source) || amount <= 0) return
    const result = damageNpc(partner, amount, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined), hostileToTarget: true,
      source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : (contact?.attackSource === 'unarmed' ? 'unarmed' : source.meleeWeaponId)) ?? undefined,
      emit: event => this.emit(event, source.currentLod),
    })
    if (result.appliedDamage > 0 && method !== 'projectile') this.sound.playSwordHit(partner.currentLod, false)
  }

  private coopPort(guest: boolean): CoopGamePort {
    const arena = this, scene = this.scene
    const inScene = (group: THREE.Object3D): boolean => {
      for (let node: THREE.Object3D | null = group; node; node = node.parent) if (node === scene) return true
      return false
    }
    const hostNpcs: NPC[] = [], hostMounts: Mount[] = []
    return {
      scene, camera: this.camera, hpBar: this.hp,
      get player() { return arena.player },
      get npcs() { return guest ? arena.coopGuestNpcs : NPC.live.collect(npc => inScene(npc.group), hostNpcs) },
      get mounts() { return guest ? arena.coopGuestMounts : Mount.live.collect(mount => !mount.disposed && inScene(mount.group), hostMounts) },
      arrows: this.coopArrows, selfUpdatesPuppets: true, guestSquad: false,
      // Only the duel opponent (and its mount), only while the duel is live.
      acceptsGuestHit: target => this.duel.canDamageOpponent(target),
      guestTarget: npc => npc === this.duel.opponent,
      // The guest earns its own duel merit once the host's claim is saved.
      missionSettlement: () => {
        const missionId = this.profile.activeMission?.id
        const saved = missionId ? new CareerProfileStore().loadChecked().profile : null
        if (!missionId || !saved?.claimedBattleIds.includes(missionId)) return null
        return { missionId, kind: 'duel' as const, victory: saved.activeMission?.result?.outcome === 'victory' }
      },
      combatEmit: event => this.emit(event),
      get ownMount() { return arena.careerMounts?.activeMount ?? null },
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

  /** LAN co-op guest: show the host's arena; this page's own duel actors leave the scene. */
  startCoopGuest(): void {
    const own = new Set([this.careerMounts?.activeMount, this.player.currentMount].filter((mount): mount is Mount => Boolean(mount)))
    for (const npc of NPC.live.collect(() => true)) npc.group.removeFromParent()
    for (const mount of Mount.live.collect(mount => !own.has(mount))) mount.group.removeFromParent()
    for (const shot of this.shots) shot.arrow.destroy()
    this.shots = []
    // Stand beside the host instead of inside it.
    const body = this.player.currentMount?.group.position ?? this.player.group.position
    body.x += 2.5
    this.coopGuest = new CoopGuestMission(this.coopPort(true), reason => showCoopGuestEnd(reason))
    this.start()
  }

  /** Guest frame: own movement and attacks; the host owns the opponent, the timer and the result. */
  private updateCoopGuest(dt: number): void {
    if (this.equipment?.visible || this.pauseMenuOpen) { this.input.clear(); return }
    this.elapsed += dt
    this.orbit.update(this.input, dt, this.arena.obstacles)
    if (!this.player.dead) {
      let step: ReturnType<PlayerInput['consumeWheelStep']>
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
    this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(this.aimPoint), this.arena.obstacles,
      this.stamina, this.quiver, this.sound, this.inventory, this.skills.getRangedMultiplier(), true)
    if (!this.player.dead && this.player.isGrounded) {
      const mount = this.player.currentMount
      if (mount) { if (this.arena.constrainGroundedBody(mount.group.position, true)) this.player.syncMountTransform() }
      else this.arena.constrainGroundedBody(this.player.group.position)
    }
    this.coopGuest!.updateWorld(dt)
    separateLocalPlayerFromPeer(this.player, this.coopGuest!.hostAvatar, this.arena.obstacles)
    this.melee()
    this.updateShots(dt)
    this.updateCoopArrows(dt)
    this.careerMounts.update(dt)
    this.player.fitMountedSeat()
    this.arena.update(dt)
    this.damageNumbers.update(dt, this.camera)
    this.weaponWheelUI.update(this.inventory, !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    this.session.tickSkillFlush(this.elapsed, dt)
  }

  private melee(): void {
    const opponent = this.coopGuest ? this.coopGuest.targets.find(npc => !npc.dead) ?? null : this.duel.opponent
    if (this.player.dead || !opponent) { this.player.consumeFistStrikes(); return }
    const targets = opponent.dead ? [] : [opponent]
    const mounts = opponent.mount && !opponent.mount.dead ? [opponent.mount] : []
    const activeMelee = this.inventory.activeMelee
    if (!activeMelee) {
      for (const strike of this.player.consumeFistStrikes()) {
        const contact = traceFistStrike(strike, this.player.position, [...targets, ...mounts], this.arena.obstacles)
        if (!contact) continue
        const amount = unarmedDamage(this.skills.getMultiplier('unarmed'), this.player.heroAssetId)
        if (contact.kind === 'mount' && contact.mount) this.hitMount(contact.mount, amount, 'melee', undefined, contact)
        else this.hitOpponent(opponent, amount, 'melee', contact)
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
    const contact = this.player.weaponSweep.traceFirst(targets, mounts, this.player.currentMount)
    if (!contact) return
    this.player.markHitProcessed()
    const target = contact.target as NPC | Mount
    const amount = Math.round(damage.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, contact.kind === 'mount' || target.isMounted))
    if (contact.kind === 'mount' && contact.mount) this.hitMount(contact.mount, amount, 'melee', undefined, contact)
    else this.hitOpponent(opponent, amount, 'melee', contact)
    if (damage.isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
  }

  private emit(event: CombatEvent, lod = 0): void {
    this.coopHost?.recordCombatEvent(event)
    // The co-op partner follows the player's unarmed-duel rule, not the "commanded helper" one;
    // its damage still never counts toward the player's own stats or merit.
    const partner = this.coopPartner
    this.duel.recordCombatEvent(partner && event.source.actorId === partner.combatantId
      ? { ...event, source: { ...event.source, actorType: 'player' } } : event)
    playAppliedPunchHit(event, this.sound, lod, event.source.actorType === 'player')
    const weapon = event.type === 'damage_applied' && event.weaponId ? WEAPONS[event.weaponId] : this.inventory.activeMelee
    const award = resolveActivePlayerSkillProgressionAward(event, { dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false },
      weapon, this.player.hasShield)
    if (award) this.session.awardSkillXp(award)
    this.duel.events.emit(event)
  }

  private hitOpponent(target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    // Co-op guest: the host judges the duel; DamageRouter forwards this hit.
    if (!(this.coopGuest ? this.coopGuest.targets.includes(target) : this.duel.canDamageOpponent(target)) || target.dead || amount <= 0) return
    const playerAmount = method === 'mount-impact' ? Math.round(amount * this.skills.getMountedImpactMultiplier()) : amount
    const result = damageNpc(target, playerAmount, {
      contact: contact ?? (method === 'melee' ? this.player.weaponSweep?.contact : undefined),
      source: createPlayerCombatActorRef(this.player), method,
      weaponId: method === 'projectile' ? this.inventory.equippedRanged?.id : (this.inventory.activeMelee?.id ?? 'unarmed'),
      emit: event => this.emit(event, target.currentLod),
    })
    if (!result.hitSuccess) return
    if (method === 'mount-impact' && this.player.currentMount && !result.isMountHit) {
      applyMountImpactKnockback(this.player.currentMount, target, { obstacles: this.arena.obstacles, worldBound: 108 })
    }
    if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
    if (method === 'projectile') this.sound.playProjectileImpact(target.currentLod, true)
    else if (method === 'mount-impact') this.sound.playHorseImpact(target.currentLod, true)
    else if (contact?.attackSource !== 'unarmed') this.sound.playSwordHit(target.currentLod, true)
    this.targetHud.show(result.targetName, result.hpRatio)
  }

  private hitMount(mount: Mount, amount: number, method: CombatDamageMethod, source?: NPC, contact?: CombatContact): void {
    if (mount.dead || mount.disposed || amount <= 0) return
    if (source) {
      // The opponent may only strike the player's own mount, during live combat.
      if (mount !== this.player.currentMount || !this.duel.canDamagePlayer(source)) return
    } else if (!(this.coopGuest ? this.coopGuest.targets.some(npc => npc.mount === mount) : this.duel.canDamageOpponent(mount))) return
    const result = damageMount(mount, amount, {
      contact, source: source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player), method,
      weaponId: source ? (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined
        : method === 'projectile' ? this.inventory.equippedRanged?.id : (this.inventory.activeMelee?.id ?? 'unarmed'),
      emit: event => this.emit(event, mount.currentLod),
    })
    if (!source && result.appliedDamage > 0) {
      this.damageNumbers.spawn(result.appliedDamage, mount.group.position.clone().add(new THREE.Vector3(0, 1, 0)))
      this.targetHud.show(result.targetName, result.hpRatio)
    }
  }

  private damagePlayerFrom(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    contact ??= source.unarmedContact
    if (!this.duel.canDamagePlayer(source)) return
    if (contact?.kind === 'mount' && contact.mount) { this.hitMount(contact.mount, amount, method, source, contact); return }
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined), hostileToTarget: true,
      source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : (contact?.attackSource === 'unarmed' ? 'unarmed' : source.meleeWeaponId)) ?? undefined,
      emit: event => this.emit(event, source.currentLod),
    })
    if (method === 'mount-impact' && source.mount && result.hitSuccess && !result.isMountHit) {
      applyMountImpactKnockback(source.mount, this.player, { obstacles: this.arena.obstacles, worldBound: 108 }, 0.95)
    }
    if (result.appliedDamage <= 0) return
    if (method === 'projectile') this.sound.playProjectileImpact(0, true)
    else if (method === 'mount-impact') this.sound.playHorseImpact(0, true)
    else if (contact?.attackSource !== 'unarmed') this.sound.playSwordHit(0, true)
  }

  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, kind: 'arrow' | 'pilum', source?: NPC,
    visualKind?: 'arrow' | 'pilum'): boolean {
    if (!source && this.player.dead) return this.projectileAdmission.reject()
    return this.projectileAdmission.launch(this.shots.length, 0, false, () => {
      this.shots.push({ arrow: ArrowProjectile.acquire(this.scene, origin, direction, speed, damage, source ? Faction.TOWN : Faction.PLAYER, !source, visualKind ?? kind), player: !source, source, age: 0 })
      this.coopHost?.onProjectile(origin, direction, speed, visualKind ?? kind, source ? Faction.ENEMY : Faction.PLAYER)
      if (!source) this.coopGuest?.onProjectile(origin, direction, speed, visualKind ?? kind)
      this.sound.playBowRelease(source ? source.currentLod : 0, !source, source ? origin.distanceTo(this.player.combatPosition) : 0)
    })
  }

  private updateShots(dt: number): void {
    if (!this.shots.length) return
    const opponent = this.coopGuest ? this.coopGuest.targets.find(npc => !npc.dead) ?? null : this.duel.opponent
    for (const shot of this.shots) {
      if (!shot.arrow.isAlive) continue
      shot.age += dt
      const step = shot.arrow.stepFlight(dt)
      if (!step) continue
      const { from } = step
      const to = step.to
      const targets: (Player | NPC | Mount)[] = shot.player
        ? [...(opponent ? [opponent] : []), ...(opponent?.mount ? [opponent.mount] : [])]
        : [this.player, ...(this.player.currentMount ? [this.player.currentMount] : []), ...(this.coopPartner ? [this.coopPartner] : [])]
      const hit = this.shotContacts.find(from, to, {
        world: { kind: 'town', practiceTargets: [], traceSiege: () => null },
        obstacles: this.arena.obstacles,
        targets,
        acceptsTarget: target => !target.dead && !(target instanceof Mount && (target.disposed || shot.player && target.riderPlayer === this.player)),
      })
      if (hit) {
        if (hit.kind === 'actor') {
          const { target, contact } = hit
          if (contact.kind === 'mount' && contact.mount && contact.mount !== this.coopPartner?.mount) this.hitMount(contact.mount, shot.arrow.damage, 'projectile', shot.source, contact)
          else if (target instanceof Player && shot.source) this.damagePlayerFrom(shot.source, shot.arrow.damage, 'projectile', contact)
          else if (target instanceof NPC && shot.source && target === this.coopPartner) this.damagePartnerFrom(shot.source, shot.arrow.damage, 'projectile', contact)
          else if (target instanceof NPC && shot.player) this.hitOpponent(target, shot.arrow.damage, 'projectile', contact)
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
    for (const npc of this.duel.actors) {
      if (npc.dead || npc.combatPosition.distanceTo(this.player.combatPosition) > 3) continue
      resolveEntityCollision(body, { position: npc.combatPosition, radius: npc.mount ? 0.95 : 0.42, height: npc.mount ? 2.8 : 1.8, bottomOffset: 0, anchored: npc !== this.duel.opponent, walkSurfaces: !npc.mount }, this.arena.obstacles)
    }
  }

  private persistNow(): boolean {
    if (this.disposed || !this.duel) return false
    this.session.flushSkills()
    if (this.duel.active && !this.profile.activeMission?.result) return this.duel.persistRuntimeProgress(true, true)
    return true
  }

  private openPauseMenu(message?: string): void {
    if (this.disposed || this.coopGuest || this.pendingSettlement || this.profile.activeMission?.result || this.equipment?.visible) return
    if (this.panel && !this.pauseMenuOpen) return
    this.pauseMenuOpen = true
    this.input.clear()
    this.player.clearTownAction()
    if (document.pointerLockElement) document.exitPointerLock?.()
    const body = message ?? '按 S 手動存檔目前任務進度；直接返回主選單不會自動存檔，下次進入將從任務開頭重新開始。'
    this.session.panel.show('生涯模式 · 暫停', body)
    this.session.panel.button('繼續遊戲', () => this.closePauseMenu())
    this.session.panel.button('存檔 (S)', () => this.saveMissionManually())
    this.session.panel.button('返回主選單（不存檔）', () => this.returnToMainMenuWithoutSave())
  }

  private closePauseMenu(): void {
    if (!this.pauseMenuOpen) return
    this.pauseMenuOpen = false
    this.session.panel.close()
    this.input.clear()
    this.last = performance.now()
    if (!location.search.includes('nolock') && !this.player.dead && !this.pendingSettlement) {
      this.input.requestPointerLock(this.renderer.domElement)
    }
  }

  private saveMissionManually(): void {
    if (!this.pauseMenuOpen || this.coopGuest || this.pendingSettlement || this.profile.activeMission?.result) return
    const saved = this.persistNow()
    this.openPauseMenu(saved ? '已保存目前任務進度。' : '任務存檔失敗，請確認儲存空間後再按 S 重試。')
  }

  private returnToMainMenuWithoutSave(): void {
    if (this.disposed) return
    this.pauseMenuOpen = false
    this.session.panel.close()
    this.dispose()
    sessionStorage.removeItem(TOWN_ENTRY_KEY)
    window.location.href = window.location.pathname
  }

  /** Per-frame settlement: a decided outcome is claimed once; a failed save waits for the player's retry. */
  private settleFrame(outcome: CareerMissionOutcome | null): void {
    if (outcome && !this.pendingSettlement) this.finish(outcome)
  }

  private captureSettlement(outcome: CareerMissionOutcome): ArenaSettlement {
    const stats = this.duel.snapshot()
    return { outcome, player: { ...stats.player }, merit: stats.meritPlayer && { ...stats.meritPlayer } }
  }

  private finish(outcome: CareerMissionOutcome): void {
    this.session.finish(() => this.captureSettlement(outcome))
  }

  private openResult(result: NonNullable<ActiveCareerMission['result']>): void {
    this.session.markSettled()
    const active = this.profile.activeMission!
    const complete = result.outcome === 'victory'
    const merit = result.merit
    const illegal = active.duelFailureReason === 'illegal_attack' ? '\n\n失敗原因：空手對決中使用了拳擊以外的攻擊' : ''
    const label = active.duelClassId ? ` · ${HERO_CLASS_NAMES[active.duelClassId].zh}` : ''
    this.session.panel.show(complete ? '單挑勝利' : '單挑失敗',
      `${DUEL_ARENA_LABELS[this.arenaId]} · ${active.duelMode === 'unarmed' ? '空手' : UNIT_PRESETS[active.duelPresetId!].nameZh} T${active.duelTier}${label}\n\n`
      + `戰鬥表現（你）\n擊殺敵人：${result.stats.kills}\n造成傷害：${Math.round(result.stats.damageDealt)}\n是否存活：${result.stats.survived ? '存活' : '陣亡'}\n\n`
      + `軍功獎勵（每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功）\n傷害軍功：${merit.damage}\n擊殺軍功：${merit.kills}\n任務貢獻：${merit.contribution}\n本次總軍功：${merit.total}${illegal}${complete ? '' : '\n\n未能達成任務目標。'}`)
    this.session.addReturnButton()
  }

  private leave(): void {
    this.dispose()
    this.callbacks.returnToTown()
  }

  dispose(): void {
    if (this.disposed) return
    this.pauseMenuOpen = false
    // A co-op guest saves only its own skill progress; the host mission waits for settlement or ESC -> S.
    if (this.coopGuest) this.session.flushSkills()
    // A return to Town announces the Town; only the end of co-op itself sends 'end'.
    this.coopHost?.dispose(false); this.coopHost = undefined
    this.coopGuest?.dispose(); this.coopGuest = undefined
    for (const arrow of this.coopArrows) arrow.destroy()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.listeners.abort()
    this.equipment?.dispose()
    this.session.panel.close()
    this.inventory?.dispose()
    this.input.dispose()
    this.duelHud.dispose()
    this.targetHud.dispose()
    this.weaponWheelUI.dispose()
    this.damageNumbers.clear()
    for (const shot of this.shots) shot.arrow.destroy()
    this.shots = []
    this.duel?.cleanupMission()
    this.careerMounts?.dispose()
    for (const resident of this.party?.residents ?? []) resident.npc.dispose()
    for (const mount of this.ownedMounts) if (!mount.disposed) { mount.releaseRider(); mount.dispose() }
    this.player?.dispose()
    for (const shot of this.shots) shot.arrow.destroy()
    this.shots.length = 0
    ProjectileInstanceBatch.dispose(this.scene)
    this.arena?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** DEV QA: advance the real gameplay step at a fixed 60 Hz with held key codes. */
  advanceForQa(seconds: number, held: string[] = []): void {
    if (!import.meta.env.DEV) return
    for (const code of held) this.input.keys[code] = true
    try { for (let t = 0; t < seconds; t += 1 / 60) this.update(1 / 60) }
    finally { for (const code of held) this.input.keys[code] = false }
  }
  get qa() {
    return import.meta.env.DEV ? { player: this.player, duel: this.duel, orbit: this.orbit, arena: this.arena, careerMounts: this.careerMounts, profile: () => this.profile } : null
  }
}
