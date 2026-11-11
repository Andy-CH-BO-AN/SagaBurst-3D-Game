import * as THREE from 'three'
import { createDuelArena, type DuelArenaEnvironment } from './DuelArena'
import { DUEL_ARENA_LABELS, type DuelArenaId } from './DuelArenaCatalog'
import { ARENA_DUEL_REFEREE_SLOTS } from './DuelArenaVenue'
import { arenaChaseWaypoint } from './DuelArenaChase'
import { CareerDuelController, duelLoadout, type CareerDuelOpponentRequest, type CareerDuelResident } from '../career/CareerDuelController'
import { resolveCareerDuelClass } from '../career/CareerDuelClasses'
import { careerDuelArena, isCareerDuelPresetId, isCareerDuelTier, type CareerDuelTier } from '../career/CareerDuelState'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CareerMountController } from '../career/CareerMountController'
import { HERO_CLASS_NAMES } from '../career/CareerHeroClasses'
import { resolveCareerHeroAsset, resolveCareerOrdinaryTier, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
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
import { canAwardPlayerSkillProgression, resolveActivePlayerSkillProgressionAward, resolveCombatSkill, type SkillProgressionAward } from '../rpg/CombatSkillProgression'
import { SkillManager } from '../rpg/SkillManager'
import { defaultRangerMeleeWeaponId, T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { TownEquipment } from '../town/TownEquipment'
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
    opponentBorrowsMount: tier < 5 && !archer && active.duelMode !== 'unarmed',
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
  private careerMounts!: CareerMountController
  private duel!: CareerDuelController
  private party!: ArenaDuelParty
  private readonly navigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 })
  private readonly stairNavigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 })
  private shots: Shot[] = []
  private elapsed = 0
  private raf = 0
  private last = 0
  private disposed = false
  private panel: HTMLElement | null = null
  private settled = false
  private skillsDirty = false
  private readonly aimPoint = new THREE.Vector3()

  private constructor(private readonly container: HTMLElement, private readonly renderer: THREE.WebGLRenderer,
    private profile: CareerProfile, private readonly arenaId: DuelArenaId, private readonly callbacks: CareerDuelArenaCallbacks) {}

  get activeMission(): ActiveCareerMission | undefined { return this.profile.activeMission }

  /** Loads and builds the saved arena duel. Throws on a technical failure; the save is untouched. */
  static async create(container: HTMLElement, callbacks: CareerDuelArenaCallbacks, progress: (text: string) => void = () => {}): Promise<CareerDuelArenaScene> {
    const loaded = new CareerProfileStore().loadChecked()
    const profile = loaded.profile
    const arenaId = careerDuelArena(profile?.activeMission)
    if (!profile || !arenaId) throw new Error('沒有可載入的競技場單挑任務')
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    renderer.setSize(innerWidth, innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = arenaId === 'roman-colosseum' ? 1.08 : 1.2
    const scene = new CareerDuelArenaScene(container, renderer, profile, arenaId, callbacks)
    try {
      await scene.initialize(progress)
      return scene
    } catch (error) {
      scene.dispose()
      throw error
    }
  }

  private commit(next: CareerProfile): boolean {
    if (!this.store.save(next)) return false
    this.profile = next
    return true
  }

  private async initialize(progress: (text: string) => void): Promise<void> {
    const active = this.profile.activeMission!
    const faction = this.profile.faction
    if (!isCareerDuelPresetId(active.duelPresetId) || !isCareerDuelTier(active.duelTier)) throw new Error('單挑任務資料不完整')
    progress(`正在載入${DUEL_ARENA_LABELS[this.arenaId]}、對手與坐騎…`)
    const hero = active.duelClassId ? resolveCareerDuelClass(faction, active.duelPresetId, active.duelTier, active.duelClassId) : undefined
    const selected = duelLoadout(active.duelPresetId, active.duelTier, hero)
    const heroAssets = new Set([resolveCareerHeroAsset(this.profile), townCaptainProfile(faction).visualAssetId, 'maki-archer-t4' as const,
      townCommanderHeroAsset(faction), hero?.visualAssetId].filter((id): id is NonNullable<typeof id> => Boolean(id)))
    const [, equipment] = await Promise.all([
      Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(this.renderer), preloadPaladinEquipment(), preloadHighTierEquipment(),
        preloadMakiRangerBow(), BlackCatVisual.preloadVariants(new Set(['black-cat'])), CorgiVisual.preload(), SnowLeopardVisual.preload(),
        ...[...heroAssets].map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))]),
      prepareByzantineEquipment([selected.meleeWeaponId, selected.shieldId, this.profile.equipment?.melee, this.profile.equipment?.shield]),
    ])
    if (equipment !== 'ready') throw new Error('單挑裝備資源載入失敗')
    if (this.disposed) return
    this.container.appendChild(this.renderer.domElement)
    // The arena installs ground, bounds and fall rules before any actor reads them.
    this.arena = createDuelArena(this.arenaId, this.scene)
    this.navigation.sync(this.arena.obstacles)
    this.stairNavigation.sync([])
    this.skills.setSkillState(this.profile.skills ?? {})
    this.inventory = new TownEquipment(() => this.profile, next => this.commit(next))
    this.player = new Player(this.scene, faction, resolveCareerHeroAsset(this.profile), resolveCareerOrdinaryTier(this.profile))
    this.player.setMaxHp(resolveCareerPlayerMaxHp(this.profile, DEFAULT_PLAYER_MAX_HP), true)
    this.player.setDamageHud(this.hp)
    this.player.blockingLevel = this.skills.skillState.blocking.level
    this.player.onShieldBlock = impact => this.awardSkillXp({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, 'arrow', undefined, event.visualKind)
    const spawn = this.arena.spawns.player
    this.player.resetForScene(spawn.x, spawn.y + PLAYER_HALF_HEIGHT, spawn.z)
    this.player.faceDirection(Math.sin(spawn.yaw), Math.cos(spawn.yaw))
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.orbit.setYaw(spawn.yaw + Math.PI)
    this.party = this.createParty(active, selected)
    this.careerMounts = new CareerMountController(this.scene, () => this.player, () => this.profile, next => this.commit(next),
      // Overhead roof volumes cannot block summoning a mount on the floor below them.
      () => this.mountObstacles, () => this.party.residents.map(resident => resident.npc.combatPosition), () => `duel-arena:${this.arenaId}`)
    // A ridden ground mount comes along to an armed duel; eagles never fly inside an arena.
    if (active.duelMode !== 'unarmed' && active.mountState?.activeMountId && active.mountState.activeMountId !== 'xongkoro') this.careerMounts.restoreActiveMount(false)
    const venueReferee = ARENA_DUEL_REFEREE_SLOTS[this.arenaId]
    this.duel = new CareerDuelController(this.scene, { obstacles: this.arena.obstacles }, this.navigation, this.party.residents, this.party.blackCat,
      () => this.player, () => this.profile, next => this.commit(next),
      (scene, mountId, x, z) => this.trackMount(new Mount(scene, mountTypeFromId(mountId), x, z)),
      request => this.createClassBody(request),
      { area: new THREE.Vector3(0, 0, 0), player: spawn, opponent: this.arena.spawns.opponent, referee: venueReferee })
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
  private chaseCommand = 900_000
  private readonly ownedMounts = new Set<Mount>()
  private trackMount(mount: Mount): Mount { this.ownedMounts.add(mount); return mount }

  private bindInput(): void {
    const signal = this.listeners.signal
    this.renderer.domElement.addEventListener('click', () => {
      this.sound.unlockAudio()
      if (!location.search.includes('nolock') && !this.panel) this.input.requestPointerLock(this.renderer.domElement)
    }, { signal })
    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(innerWidth, innerHeight)
    }, { signal })
    window.addEventListener('pagehide', () => this.persistNow(), { signal })
  }

  start(): void {
    this.last = performance.now()
    if (this.profile.activeMission?.result) this.openResult(this.profile.activeMission.result)
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
    this.elapsed += dt
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
      if (mount) { if (this.arena.constrainGroundedBody(mount.group.position)) this.player.syncMountTransform() }
      else this.arena.constrainGroundedBody(this.player.group.position)
    }
    // Actors keep animating after the result (death, idle); only live combat routes damage.
    if (this.duel.actors.length) this.updateActors(dt)
    if (combat) {
      this.melee()
      this.resolveBodies()
    }
    this.updateShots(dt)
    this.careerMounts.update(dt)
    this.player.fitMountedSeat()
    this.arena.update(dt)
    if (combat) {
      this.duel.update(dt)
      const outcome = this.duel.evaluate(this.player.dead)
      if (outcome) this.finish(outcome)
    }
    this.damageNumbers.update(dt, this.camera)
    const phase = this.duel?.active && !this.panel ? this.duel.phase : null
    this.duelHud.update(phase, this.duel.countdownRemaining, this.duel.combatRemaining, this.duel.combatElapsedSeconds)
    this.weaponWheelUI.update(this.inventory, !this.panel && !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    if (this.skillsDirty && this.elapsed % 5 < dt) this.flushSkills()
  }

  private updateActors(dt: number): void {
    for (const actor of this.duel.actors) {
      const distance = actor.group.position.distanceTo(this.camera.position)
      if (actor.dead) { actor.update(dt, this.player, [], [], this.arena.obstacles, this.hp, () => {}, () => false, false, distance); continue }
      const combatant = actor === this.duel.opponent && this.duel.combatEnabled
      // Raised stands/dais are reached by their stairs; pursuit resumes once both share a level.
      const waypoint = combatant && !this.player.dead ? arenaChaseWaypoint(this.arenaId,
        { x: actor.combatPosition.x, y: actor.combatPosition.y, z: actor.combatPosition.z },
        { x: this.player.position.x, y: this.player.position.y - PLAYER_HALF_HEIGHT, z: this.player.position.z }) : null
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
        actor.update(dt, this.player, this.duel.actors, [], this.arena.obstacles, this.hp,
          // A 1v1 opponent can only reach the player or the player's mount.
          (damage, isPlayer, _target, targetMount) => {
            if (isPlayer) this.damagePlayerFrom(actor, damage, 'melee')
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

  private melee(): void {
    const opponent = this.duel.opponent
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
    this.duel.recordCombatEvent(event)
    playAppliedPunchHit(event, this.sound, lod, event.source.actorType === 'player')
    const weapon = event.type === 'damage_applied' && event.weaponId ? WEAPONS[event.weaponId] : this.inventory.activeMelee
    const award = resolveActivePlayerSkillProgressionAward(event, { dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false },
      weapon, this.player.hasShield)
    if (award) this.awardSkillXp(award)
    this.duel.events.emit(event)
  }

  private hitOpponent(target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (!this.duel.canDamageOpponent(target) || target.dead || amount <= 0) return
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
    } else if (!this.duel.canDamageOpponent(mount)) return
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
      this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, source ? Faction.TOWN : Faction.PLAYER, !source, visualKind ?? kind), player: !source, source, age: 0 })
      this.sound.playBowRelease(source ? source.currentLod : 0, !source, source ? origin.distanceTo(this.player.combatPosition) : 0)
    })
  }

  private updateShots(dt: number): void {
    if (!this.shots.length) return
    const opponent = this.duel.opponent
    for (const shot of this.shots) {
      if (!shot.arrow.isAlive) continue
      const from = shot.arrow.mesh.position.clone()
      shot.age += dt
      shot.arrow.update(dt, this.player, [], [], () => {}, amount => damagePlayer(this.player, amount, this.hp, null), undefined, true)
      if (!shot.arrow.isAlive) continue
      const to = shot.arrow.mesh.position
      const targets: (Player | NPC | Mount)[] = shot.player
        ? [...(opponent ? [opponent] : []), ...(opponent?.mount ? [opponent.mount] : [])]
        : [this.player, ...(this.player.currentMount ? [this.player.currentMount] : [])]
      const hit = this.shotContacts.find(from, to, {
        world: { kind: 'town', practiceTargets: [], traceSiege: () => null },
        obstacles: this.arena.obstacles,
        targets,
        acceptsTarget: target => !target.dead && !(target instanceof Mount && (target.disposed || shot.player && target.riderPlayer === this.player)),
      })
      if (hit) {
        if (hit.kind === 'actor') {
          const { target, contact } = hit
          if (contact.kind === 'mount' && contact.mount) this.hitMount(contact.mount, shot.arrow.damage, 'projectile', shot.source, contact)
          else if (target instanceof Player && shot.source) this.damagePlayerFrom(shot.source, shot.arrow.damage, 'projectile', contact)
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

  private awardSkillXp({ skill, xp }: SkillProgressionAward): void {
    if (xp <= 0 || !canAwardPlayerSkillProgression({ dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false })) return
    const levels = this.skills.addXp(skill, xp, this.sound)
    this.player.blockingLevel = this.skills.skillState.blocking.level
    this.skillsDirty = true
    if (levels > 0) {
      this.flushSkills()
      const before = this.player.hp
      const maxHp = resolveCareerPlayerMaxHp(this.profile, DEFAULT_PLAYER_MAX_HP)
      this.player.setMaxHp(maxHp, false)
      this.player.setHp(Math.min(maxHp, before + levels))
    }
  }

  private flushSkills(): void {
    if (!this.skillsDirty) return
    const next = cloneCareerProfile(this.profile)
    next.skills = this.skills.skillState
    if (this.commit(next)) this.skillsDirty = false
  }

  private persistNow(): void {
    if (this.disposed || !this.duel) return
    this.flushSkills()
    if (this.duel.active && !this.profile.activeMission?.result) this.duel.persistRuntimeProgress(true)
  }

  private finish(outcome: CareerMissionOutcome): void {
    if (this.settled) return
    this.flushSkills()
    const active = this.profile.activeMission
    if (!active || active.result) return
    const stats = this.duel.snapshot()
    const claim = claimCareerMission(cloneCareerProfile(this.profile), active.id, outcome, stats.player, stats.meritPlayer)
    if (!this.commit(claim.profile)) {
      this.openPanel('單挑結算尚未保存', '保存失敗；軍功尚未入帳，結果保留在競技場。')
      this.button('重試保存結算', () => { this.closePanel(); this.finish(outcome) })
      return
    }
    this.settled = true
    this.input.clear()
    this.player.clearTownAction()
    document.exitPointerLock?.()
    this.openResult(this.profile.activeMission!.result!)
  }

  private openResult(result: NonNullable<ActiveCareerMission['result']>): void {
    this.settled = true
    const active = this.profile.activeMission!
    const complete = result.outcome === 'victory'
    const merit = result.merit
    const illegal = active.duelFailureReason === 'illegal_attack' ? '\n\n失敗原因：空手對決中使用了拳擊以外的攻擊' : ''
    const label = active.duelClassId ? ` · ${HERO_CLASS_NAMES[active.duelClassId].zh}` : ''
    this.openPanel(complete ? '單挑勝利' : '單挑失敗',
      `${DUEL_ARENA_LABELS[this.arenaId]} · ${active.duelMode === 'unarmed' ? '空手' : UNIT_PRESETS[active.duelPresetId!].nameZh} T${active.duelTier}${label}\n\n`
      + `戰鬥表現（你）\n擊殺敵人：${result.stats.kills}\n造成傷害：${Math.round(result.stats.damageDealt)}\n是否存活：${result.stats.survived ? '存活' : '陣亡'}\n\n`
      + `軍功獎勵（每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功）\n傷害軍功：${merit.damage}\n擊殺軍功：${merit.kills}\n任務貢獻：${merit.contribution}\n本次總軍功：${merit.total}${illegal}${complete ? '' : '\n\n未能達成任務目標。'}`)
    this.button(`返回 ${this.profile.faction === 'roman' ? 'vinum 村' : 'økse 村'}`, () => this.returnToTown())
  }

  /** Clears the claimed duel exactly like a Town return; a failed save keeps the arena for retry. */
  private returnToTown(): void {
    const active = this.profile.activeMission
    if (!active) { this.leave(); return }
    const completed = Boolean(active.result || this.profile.claimedBattleIds.includes(active.id))
    const next = clearCareerMission(this.profile, active.id)
    if (completed) delete next.mountArmor
    if (!this.commit(next)) {
      this.openPanel('返回狀態尚未保存', '單挑結算仍安全保留。請重試保存後返回小鎮。')
      this.button('重試返回小鎮', () => this.returnToTown())
      return
    }
    this.leave()
  }

  private leave(): void {
    this.dispose()
    this.callbacks.returnToTown()
  }

  private openPanel(title: string, text: string): void {
    this.closePanel()
    const panel = document.createElement('section')
    panel.id = 'duel-arena-panel'
    panel.className = 'town-panel'
    panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10002;min-width:340px;max-width:560px;background:#1b1712f0;color:#f2eadb;border:1px solid #8a6f45;border-radius:10px;padding:20px 22px;font:15px/1.6 system-ui;white-space:pre-line'
    const heading = document.createElement('h2')
    heading.textContent = title
    heading.style.margin = '0 0 10px'
    const body = document.createElement('p')
    body.textContent = text
    panel.append(heading, body)
    document.body.append(panel)
    this.panel = panel
  }

  private button(label: string, action: () => void): void {
    if (!this.panel) return
    const button = document.createElement('button')
    button.className = 'town-button'
    button.textContent = label
    button.style.marginRight = '8px'
    button.onclick = action
    this.panel.append(button)
  }

  private closePanel(): void { this.panel?.remove(); this.panel = null }

  dispose(): void {
    if (this.disposed) return
    this.persistNow()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.listeners.abort()
    this.closePanel()
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
