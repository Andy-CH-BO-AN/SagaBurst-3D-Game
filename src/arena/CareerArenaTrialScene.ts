import * as THREE from 'three'
import { createDuelArena, type DuelArenaEnvironment } from './DuelArena'
import { DUEL_ARENA_LABELS, type DuelArenaId } from './DuelArenaCatalog'
import { assignArenaTrialSlots, planArenaTrialFormation, type ArenaTrialFormation } from './ArenaTrialFormation'
import {
  ARENA_TRIAL_COUNTDOWN_SECONDS, ARENA_TRIAL_DEFINITIONS, ARENA_TRIAL_TIME_LIMIT_SECONDS, arenaTrialCounts, arenaTrialPreloadPlan,
  arenaTrialRestorablePlan, arenaTrialRoster, arenaTrialUnitSpec, careerArenaTrial, resolveArenaTrialEnd,
  type ArenaTrialActorState, type ArenaTrialEndReason, type ArenaTrialState,
} from '../career/CareerArenaTrials'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { resolveCareerHeroAsset, resolveCareerOrdinaryTier, resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import type { ActiveCareerMission, CareerMissionOutcome } from '../career/CareerMissionState'
import { BattleStatsTracker, type PlayerBattleStats } from '../combat/BattleStatsTracker'
import { CombatEventStream, createNpcCombatActorRef, createPlayerCombatActorRef, type CombatDamageMethod, type CombatEvent } from '../combat/CombatAttribution'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { damageNpc, damagePlayer } from '../combat/DamageRouter'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { ProjectileAdmission } from '../combat/ProjectileAdmission'
import { ProjectileContactQuery } from '../combat/ProjectileContactQuery'
import { SHIELD_CONFIG, type CombatContact } from '../combat/ShieldBlocking'
import { traceFistStrike, unarmedDamage } from '../combat/UnarmedCombat'
import { playAppliedPunchHit, SoundManager } from '../audio/SoundManager'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { Player, DEFAULT_PLAYER_MAX_HP } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { WeaponWheel } from '../player/WeaponWheel'
import { canAwardPlayerSkillProgression, resolveActivePlayerSkillProgressionAward, resolveCombatSkill, type SkillProgressionAward } from '../rpg/CombatSkillProgression'
import { SkillManager } from '../rpg/SkillManager'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { TownEquipment } from '../town/TownEquipment'
import { ArenaTrialHUD } from '../ui/ArenaTrialHUD'
import { CombatTargetHud } from '../ui/CombatTargetHud'
import { DamageNumbers } from '../ui/DamageNumbers'
import { HpBar } from '../ui/HpBar'
import { QuiverUI } from '../ui/QuiverUI'
import { StaminaBar } from '../ui/StaminaBar'
import { WeaponWheelUI } from '../ui/WeaponWheelUI'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { prepareByzantineEquipment, preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { Faction, NPC } from '../world/NPC'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { resolveEntityCollision } from '../world/Terrain'

const PLAYER_HALF_HEIGHT = 0.95
const RESUME_GRACE_SECONDS = 3
const CHECKPOINT_SECONDS = 2

export interface CareerArenaTrialCallbacks {
  /** The trial is settled (or cancelled) and saved; Town may be rebuilt. */
  returnToTown(): void
}

interface Body {
  readonly actorId: string
  readonly team: 'friendly' | 'enemy'
  readonly npc: NPC
  marker: THREE.Sprite
}
interface Shot { arrow: ArrowProjectile; player: boolean; source?: NPC; age: number }
interface PendingSettlement { readonly outcome: CareerMissionOutcome; readonly reason?: ArenaTrialEndReason; readonly player: PlayerBattleStats }

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
 * Independent Career scene for a formal Arena Squad Trial: two same-culture teams fight on a Duel arena floor.
 * Team identity is the NPC allegiance (PLAYER vs ENEMY), never the Roman/Viking look. HP zero is a knock-out:
 * the body leaves targeting, counts and later reloads, but nothing is lost permanently. Rules live in
 * CareerArenaTrials; this host owns the arena, the bodies, damage routing and the claim/return transactions.
 */
export class CareerArenaTrialScene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900)
  private readonly store = new CareerProfileStore()
  private readonly input = new PlayerInput()
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly hud = new ArenaTrialHUD()
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
  private readonly navigation = new NavigationWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 120 })
  private readonly markerMaterials = { friendly: new THREE.SpriteMaterial({ map: teamMarkerTexture(), color: 0x4da3ff, depthTest: false }),
    enemy: new THREE.SpriteMaterial({ map: teamMarkerTexture(), color: 0xff5a4d, depthTest: false }) }
  private arena!: DuelArenaEnvironment
  private player!: Player
  private orbit!: ThirdPersonCamera
  private inventory!: TownEquipment
  private tracker!: BattleStatsTracker
  private formation!: ArenaTrialFormation
  private bodies: Body[] = []
  /** Everyone out of the fight, including bodies knocked before a reload (those are never rebuilt). */
  private readonly knocked = new Set<string>()
  private shots: Shot[] = []
  private phase: 'countdown' | 'fight' | 'result' = 'countdown'
  private countdownRemaining = ARENA_TRIAL_COUNTDOWN_SECONDS
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
  private skillsDirty = false
  private readonly aimPoint = new THREE.Vector3()

  private constructor(private readonly container: HTMLElement, private readonly renderer: THREE.WebGLRenderer,
    private profile: CareerProfile, private readonly arenaId: DuelArenaId, private readonly callbacks: CareerArenaTrialCallbacks) {}

  private get mission(): ActiveCareerMission { return this.profile.activeMission! }
  private get trial(): ArenaTrialState { return careerArenaTrial(this.profile.activeMission)! }

  /** Loads and builds the saved trial. Throws on a technical failure; the save is untouched. */
  static async create(container: HTMLElement, callbacks: CareerArenaTrialCallbacks, progress: (text: string) => void = () => {}): Promise<CareerArenaTrialScene> {
    const profile = new CareerProfileStore().loadChecked().profile
    const trial = careerArenaTrial(profile?.activeMission)
    if (!profile || !trial) throw new Error('沒有可載入的競技場軍團試煉')
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    renderer.setSize(innerWidth, innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = trial.arenaId === 'roman-colosseum' ? 1.08 : 1.2
    const scene = new CareerArenaTrialScene(container, renderer, profile, trial.arenaId, callbacks)
    try { await scene.initialize(progress); return scene }
    catch (error) { scene.dispose(); throw error }
  }

  private commit(next: CareerProfile): boolean {
    if (!this.store.save(next)) return false
    this.profile = next
    return true
  }

  private async initialize(progress: (text: string) => void): Promise<void> {
    const faction = this.profile.faction
    const trial = this.trial, mission = this.mission
    const settled = Boolean(mission.result)
    progress(`正在載入${DUEL_ARENA_LABELS[this.arenaId]}與雙方部隊…`)
    const plan = arenaTrialPreloadPlan(trial.tier, faction)
    const [, equipment] = await Promise.all([
      Promise.all([HumanoidAssetRegistry.preload(), preloadPaladinEquipment(), preloadHighTierEquipment(), preloadMakiRangerBow(),
        resolveCareerHeroAsset(this.profile) ? HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[resolveCareerHeroAsset(this.profile)!].descriptor) : Promise.resolve(),
        ...plan.heroAssets.map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))]),
      prepareByzantineEquipment([...plan.equipmentIds, this.profile.equipment?.melee, this.profile.equipment?.shield]),
    ])
    if (equipment !== 'ready') throw new Error('試煉裝備資源載入失敗')
    if (this.disposed) return
    this.container.appendChild(this.renderer.domElement)
    // The arena installs ground, bounds and fall rules before any actor reads them.
    this.arena = createDuelArena(this.arenaId, this.scene)
    this.navigation.sync(this.arena.obstacles)
    const sizes = { friendly: mission.friendlyActorIds.length, enemy: mission.targetActorIds.length }
    const formation = planArenaTrialFormation(this.arenaId, this.arena.obstacles, sizes.friendly, sizes.enemy)
    if (!formation) throw new Error(`${DUEL_ARENA_LABELS[this.arenaId]}沒有足夠空間部署雙方部隊`)
    this.formation = formation
    this.skills.setSkillState(this.profile.skills ?? {})
    this.inventory = new TownEquipment(() => this.profile, next => this.commit(next))
    this.player = new Player(this.scene, faction, resolveCareerHeroAsset(this.profile), resolveCareerOrdinaryTier(this.profile))
    const maxHp = resolveCareerPlayerMaxHp(this.profile, DEFAULT_PLAYER_MAX_HP)
    this.player.setMaxHp(maxHp, true)
    this.player.setDamageHud(this.hp)
    this.player.blockingLevel = this.skills.skillState.blocking.level
    this.player.onShieldBlock = impact => this.awardSkillXp({ skill: 'blocking', xp: impact * SHIELD_CONFIG.xpPerBlockedImpact })
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, 'arrow', undefined, event.visualKind)
    const engaged = trial.stage === 'engaged'
    const saved = engaged ? trial.player : undefined
    const spawn = saved ?? { x: formation.player.x, z: formation.player.z, yaw: formation.player.yaw }
    this.player.resetForScene(spawn.x, saved?.y ?? this.arena.spawns.player.y + PLAYER_HALF_HEIGHT, spawn.z)
    this.player.faceDirection(Math.sin(spawn.yaw), Math.cos(spawn.yaw))
    if (saved) {
      this.player.setHp(Math.min(maxHp, saved.hp)); this.player.setStamina(saved.stamina)
      if (saved.knocked) this.player.takeDamage(this.player.maxHp * 100, this.hp)
    }
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.orbit.setYaw(spawn.yaw + Math.PI)
    this.tracker = new BattleStatsTracker(this.events, false, undefined, mission.playerStats)
    this.inventory.prepareForCombat()
    // prepareForCombat tops up supplies; a saved fight restores what was really left (0 means spent or broken).
    if (saved) {
      if (saved.ammo !== undefined) this.player.setArrowCount(saved.ammo)
      if (saved.shieldDurability) this.player.shield.restoreDurability(saved.shieldDurability)
      if (saved.shieldImpact !== undefined) this.player.shield.shieldImpactRemaining = Math.min(this.player.shield.shieldImpactMax, saved.shieldImpact)
    }
    if (!settled) await this.buildBodies(trial, progress)
    this.hp.setFill(this.player.hpRatio)
    this.quiver.setArrowCount(this.player.arrowCount)
    this.combatElapsed = trial.combatElapsed
    // A reload never skips the grace: positions and counts are restored exactly, then the fight resumes.
    this.countdownRemaining = engaged ? RESUME_GRACE_SECONDS : ARENA_TRIAL_COUNTDOWN_SECONDS
    this.phase = settled ? 'result' : 'countdown'
    this.bindInput()
    progress('準備完成')
  }

  /** Builds only the bodies still standing: knocked-out actors of a saved fight are never recreated. */
  private async buildBodies(trial: ArenaTrialState, progress: (text: string) => void): Promise<void> {
    const mission = this.mission, faction = this.profile.faction
    const roster = arenaTrialRoster(mission.id, trial.tier)
    const slots = assignArenaTrialSlots(roster, this.formation)
    const standing = arenaTrialRestorablePlan(mission, trial)
    for (const [actorId, state] of Object.entries(trial.actors)) if (state.status === 'knocked') this.knocked.add(actorId)
    let built = 0
    for (const { actorId, saved } of standing) {
      const entry = roster.find(candidate => candidate.actorId === actorId)!
      const slot = slots.get(actorId)!
      const spec = arenaTrialUnitSpec(actorId, faction, entry.team === 'friendly' ? Faction.PLAYER : Faction.ENEMY, entry.group, saved?.x ?? slot.x, saved?.z ?? slot.z)
      const npc = new NPC(this.scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier, false,
        spec.loadout, spec.presetId, undefined, spec.actorId, this.events.emit, spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile,
        undefined, undefined, undefined, undefined, spec.characterTier, spec.heroArchetype)
      npc.respawnEnabled = false
      npc.enableBattlefieldEngagement()
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
      this.bodies.push({ actorId, team: entry.team, npc, marker })
      this.tracker.registerNpc(npc, entry.team === 'friendly')
      if (++built % 6 === 0) {
        progress(`部署部隊 ${built} / ${standing.length}…`)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (this.disposed) return
      }
    }
  }

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
    if (this.pendingSettlement) { this.arena.update(dt); this.damageNumbers.update(dt, this.camera); return }
    this.elapsed += dt
    const fighting = this.phase === 'fight'
    if (!this.panel) this.orbit.update(this.input, dt, this.arena.obstacles)
    if (!this.player.dead && !this.panel) {
      let step: ReturnType<PlayerInput['consumeWheelStep']>
      while ((step = this.input.consumeWheelStep()) !== 0) this.weaponWheel.cycle(this.inventory, step)
    }
    this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(this.aimPoint), this.arena.obstacles,
      this.stamina, this.quiver, this.sound, this.inventory, this.skills.getRangedMultiplier(), fighting && !this.panel)
    // The ground boundary holds living, supported bodies only; falls always complete.
    if (!this.player.dead && this.player.isGrounded) this.arena.constrainGroundedBody(this.player.group.position)
    this.updateBodies(dt)
    if (fighting) { this.melee(); this.resolveBodies() }
    this.updateShots(dt)
    this.arena.update(dt)
    this.advancePhase(dt)
    this.updateMarkers()
    this.damageNumbers.update(dt, this.camera)
    this.weaponWheelUI.update(this.inventory, !this.panel && !this.player.dead)
    this.hp.setFill(this.player.hpRatio)
    this.hud.update({
      phase: this.phase, countdown: this.countdownRemaining, label: ARENA_TRIAL_DEFINITIONS[this.trial.tier].label,
      friendly: { active: this.counts().friendlyActive + (this.player.dead ? 0 : 1), total: this.mission.friendlyActorIds.length + 1 },
      enemy: { active: this.counts().enemyActive, total: this.mission.targetActorIds.length },
      remainingSeconds: ARENA_TRIAL_TIME_LIMIT_SECONDS - this.combatElapsed, playerKnocked: this.player.dead })
    if (this.skillsDirty && this.elapsed % 5 < dt) this.flushSkills()
  }

  private counts() {
    return arenaTrialCounts(this.mission, { actors: {}, player: { knocked: this.player.dead } as ArenaTrialState['player'] },
      new Set([...this.knocked, ...this.bodies.filter(body => body.npc.dead).map(body => body.actorId)]))
  }

  private advancePhase(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt
      if (this.countdownRemaining > 0) return
      this.phase = 'fight'
      for (const body of this.bodies) if (!body.npc.dead) body.npc.setTacticalOrder('attack')
      this.persistProgress()
      return
    }
    if (this.phase !== 'fight') return
    this.combatElapsed += dt
    let changed = false
    for (const body of this.bodies) if (body.npc.dead && !this.knocked.has(body.actorId)) { this.knocked.add(body.actorId); changed = true }
    // A knock-out is saved at once so a reload can never stand the body back up.
    this.checkpointClock += dt
    if (changed || this.checkpointClock >= CHECKPOINT_SECONDS) this.persistProgress()
    const end = resolveArenaTrialEnd(this.counts(), this.combatElapsed)
    if (end && !this.pendingSettlement) this.finish(end.outcome, end.reason)
  }

  private updateBodies(dt: number): void {
    // Same per-frame topology sync and path-search budget reset as Town; without it the budget never refills.
    this.navigation.sync(this.arena.obstacles)
    this.navigation.beginFrame()
    const live = this.bodies.filter(body => !body.npc.dead).map(body => body.npc)
    for (const { npc } of this.bodies) {
      const distance = npc.group.position.distanceTo(this.camera.position)
      if (npc.dead) { npc.update(dt, this.player, [], [], this.arena.obstacles, this.hp, () => {}, () => false, false, distance); continue }
      if (this.phase !== 'fight') { npc.updateTownPeace(dt, distance, false, false); continue }
      npc.update(dt, this.player, live, live, this.arena.obstacles, this.hp,
        (damage, isPlayer, target) => {
          if (isPlayer) this.damagePlayerFrom(npc, damage, 'melee')
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
  }

  private melee(): void {
    const enemies = this.bodies.filter(body => body.team === 'enemy' && !body.npc.dead).map(body => body.npc)
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
      isMounted: false, mountSpeed: 0,
      oneHandedMultiplier: this.skills.getMultiplier(resolveCombatSkill('melee', weapon, Boolean(this.inventory.shieldEnabled && this.inventory.equippedShield))!),
      faction: this.player.characterFaction, hasShield: this.inventory.shieldEnabled, heroAssetId: this.player.heroAssetId ?? undefined,
    })
    const contact = this.player.weaponSweep.traceFirst(enemies, [], null)
    if (!contact) return
    this.player.markHitProcessed()
    this.hitEnemy(contact.target as NPC, Math.round(damage.damage * getAntiCavalryMultiplier(weapon.combatKind, false, false)), 'melee', contact)
  }

  private emit(event: CombatEvent, lod = 0): void {
    playAppliedPunchHit(event, this.sound, lod, event.source.actorType === 'player')
    const weapon = event.type === 'damage_applied' && event.weaponId ? WEAPONS[event.weaponId] : this.inventory.activeMelee
    const award = resolveActivePlayerSkillProgressionAward(event, { dead: this.player.dead, spectatorOnly: this.player.spectatorOnly, observer: false }, weapon, this.player.hasShield)
    if (award) this.awardSkillXp(award)
    this.events.emit(event)
  }

  private hitEnemy(target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.phase !== 'fight' || target.dead || amount <= 0) return
    const result = damageNpc(target, amount, {
      contact: contact ?? (method === 'melee' ? this.player.weaponSweep?.contact : undefined),
      source: createPlayerCombatActorRef(this.player), method,
      weaponId: method === 'projectile' ? this.inventory.equippedRanged?.id : (this.inventory.activeMelee?.id ?? 'unarmed'),
      emit: event => this.emit(event, target.currentLod),
    })
    if (!result.hitSuccess) return
    if (result.appliedDamage > 0) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
    if (method === 'projectile') this.sound.playProjectileImpact(target.currentLod, true)
    else if (contact?.attackSource !== 'unarmed') this.sound.playSwordHit(target.currentLod, true)
    this.targetHud.show(result.targetName, result.hpRatio)
  }

  /** NPC → NPC: only across teams (allegiance), only in live combat. */
  private damageBodyFrom(source: NPC, target: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.phase !== 'fight' || source === target || source.faction === target.faction || target.dead || source.dead || amount <= 0) return
    damageNpc(target, amount, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined),
      source: createNpcCombatActorRef(source), method,
      weaponId: (method === 'projectile' ? source.rangedWeaponId : source.meleeWeaponId) ?? undefined,
      emit: event => this.emit(event, target.currentLod),
    })
  }

  private damagePlayerFrom(source: NPC, amount: number, method: CombatDamageMethod, contact?: CombatContact): void {
    if (this.phase !== 'fight' || this.player.dead || source.faction !== Faction.ENEMY || source.dead) return
    contact ??= source.unarmedContact
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      contact: contact ?? (method === 'melee' ? source.weaponSweep?.contact : undefined), hostileToTarget: true,
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
    if (this.phase !== 'fight' || (!source && this.player.dead)) return this.projectileAdmission.reject()
    return this.projectileAdmission.launch(this.shots.length, 0, false, () => {
      this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, source?.faction ?? Faction.PLAYER, !source, visualKind ?? kind), player: !source, source, age: 0 })
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
      const targets: (Player | NPC)[] = [
        ...this.bodies.filter(body => body.team !== shooterTeam && !body.npc.dead).map(body => body.npc),
        ...(shooterTeam === 'enemy' && !this.player.dead ? [this.player] : []),
      ]
      const hit = this.shotContacts.find(from, shot.arrow.mesh.position, {
        world: { kind: 'town', practiceTargets: [], traceSiege: () => null },
        obstacles: this.arena.obstacles, targets, acceptsTarget: target => !target.dead,
      })
      if (hit) {
        if (hit.kind === 'actor') {
          const { target, contact } = hit
          if (target instanceof Player && shot.source) this.damagePlayerFrom(shot.source, shot.arrow.damage, 'projectile', contact)
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
    for (const { npc } of this.bodies) {
      if (npc.dead || npc.combatPosition.distanceTo(this.player.combatPosition) > 3) continue
      resolveEntityCollision(body, { position: npc.combatPosition, radius: 0.42, height: 1.8, bottomOffset: 0, walkSurfaces: true }, this.arena.obstacles)
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

  /** The roster checkpoint: knocked-out actors stay knocked, everyone else keeps HP and place. Best effort between frames. */
  private persistProgress(): boolean {
    this.checkpointClock = 0
    const mission = this.profile.activeMission
    if (this.disposed || !mission || mission.result || !careerArenaTrial(mission)) return false
    const next = cloneCareerProfile(this.profile)
    const active = next.activeMission!
    const actors: Record<string, ArenaTrialActorState> = {}
    for (const id of [...mission.friendlyActorIds, ...mission.targetActorIds]) {
      const body = this.bodies.find(candidate => candidate.actorId === id)
      if (!body || this.knocked.has(id) || body.npc.dead) { actors[id] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }; continue }
      actors[id] = { status: 'active', hp: body.npc.hp, x: body.npc.combatPosition.x, z: body.npc.combatPosition.z, yaw: body.npc.group.rotation.y,
        y: body.npc.group.position.y, ammo: body.npc.combatAmmo, shieldImpact: body.npc.shield.shieldImpactRemaining }
    }
    active.arenaTrial = { ...this.trial, stage: 'engaged', combatElapsed: this.combatElapsed, actors, player: {
      knocked: this.player.dead, hp: this.player.dead ? 0 : this.player.hp, stamina: this.player.staminaValue,
      x: this.player.position.x, z: this.player.position.z, yaw: this.player.facingYaw,
      y: this.player.group.position.y, ammo: this.player.arrowCount, shieldImpact: this.player.shield.shieldImpactRemaining,
      shieldDurability: { ...this.player.shield.captureDurability() } } }
    active.phase = 'ENGAGING'
    active.playerStats = this.tracker.checkpoint()
    return this.commit(next)
  }

  private persistNow(): void {
    if (this.disposed || !this.tracker) return
    this.flushSkills()
    if (this.phase === 'fight') this.persistProgress()
  }

  private captureSettlement(outcome: CareerMissionOutcome, reason?: ArenaTrialEndReason): PendingSettlement {
    const stats = this.tracker.snapshot(this.bodies.map(body => body.npc), this.player)
    return { outcome, ...(reason ? { reason } : {}), player: { ...stats.player } }
  }

  /** Saves the decided result, or the one already frozen by an earlier failed save. */
  private finish(outcome: CareerMissionOutcome, reason?: ArenaTrialEndReason): void {
    if (this.settled) return
    this.flushSkills()
    const active = this.profile.activeMission
    if (!active || active.result) return
    this.phase = 'result'
    const settlement = this.pendingSettlement ?? this.captureSettlement(outcome, reason)
    // The end reason is saved in the same transaction as the result, so a reload shows the same wording.
    const staged = cloneCareerProfile(this.profile)
    if (settlement.reason && staged.activeMission?.arenaTrial) staged.activeMission.arenaTrial.endReason = settlement.reason
    const claim = claimCareerMission(staged, active.id, settlement.outcome, settlement.player, settlement.player)
    if (!this.commit(claim.profile)) {
      this.pendingSettlement = settlement
      this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
      this.openPanel('試煉結算尚未保存', '保存失敗；軍功尚未入帳，結果保留在競技場。')
      this.button('重試保存結算', () => { this.closePanel(); this.finish(settlement.outcome, settlement.reason) })
      return
    }
    this.pendingSettlement = null
    this.settled = true
    this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
    this.openResult(this.profile.activeMission!.result!)
  }

  private openResult(result: NonNullable<ActiveCareerMission['result']>): void {
    this.settled = true
    this.phase = 'result'
    const trial = this.trial, merit = result.merit
    const complete = result.outcome === 'victory'
    this.openPanel(complete ? '試煉勝利' : '試煉失敗',
      `${DUEL_ARENA_LABELS[this.arenaId]} · ${ARENA_TRIAL_DEFINITIONS[trial.tier].label}\n\n`
      + `戰鬥表現（你）\n擊倒敵人：${result.stats.kills}\n造成傷害：${Math.round(result.stats.damageDealt)}\n結束時狀態：${result.stats.survived ? '仍站立' : '被擊倒'}\n\n`
      + `軍功獎勵（每 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點有效傷害 = 1 軍功）\n傷害軍功：${merit.damage}\n擊倒軍功：${merit.kills}\n任務貢獻：${merit.contribution}\n本次總軍功：${merit.total}`
      + `${complete ? '' : trial.endReason === 'timeout' ? '\n\n試煉逾時：時限內未分出勝負，本場計為失敗；不造成永久傷亡或裝備損失。' : '\n\n我方全員被擊倒；試煉不造成永久傷亡或裝備損失。'}`)
    this.button(`返回 ${this.profile.faction === 'roman' ? 'vinum 村' : 'økse 村'}`, () => this.returnToTown())
  }

  /** Clears the claimed trial exactly like a Town return; a failed save keeps the arena for retry. */
  private returnToTown(): void {
    const active = this.profile.activeMission
    if (!active) { this.leave(); return }
    if (!this.commit(clearCareerMission(this.profile, active.id))) {
      this.openPanel('返回狀態尚未保存', '試煉結算仍安全保留。請重試保存後返回小鎮。')
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
  }

  private button(label: string, action: () => void): void {
    if (!this.panel) return
    const button = document.createElement('button')
    button.className = 'town-button'; button.textContent = label; button.style.marginRight = '8px'; button.onclick = action
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
    this.hud.dispose(); this.targetHud.dispose(); this.weaponWheelUI.dispose(); this.damageNumbers.clear()
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
