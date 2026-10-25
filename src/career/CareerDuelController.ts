import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import * as THREE from 'three'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { applyHeroIncomingDamage, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatEvent } from '../combat/CombatAttribution'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import type { Player } from '../player/Player'
import { townPlayerEntryPoint, type TownActorSpec } from '../town/TownRules'
import type { TownWorld } from '../town/TownWorld'
import { findTownDuelArena, townDuelPosition, DUEL_OPPONENT_OFFSET, DUEL_REFEREE_OFFSET, DUEL_PLAYER_OFFSET } from '../town/TownDuelArena'
import { Mount, mountTypeFromId } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import type { CareerProfile } from './CareerProfile'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import type { ActiveCareerMission, CareerMissionOutcome, CareerMissionPhase } from './CareerMissionState'
import { careerDuelOpponentHealth, createCareerDuelMission, DUEL_COMBAT_SECONDS, DUEL_COUNTDOWN_SECONDS, isCareerDuelPresetId, isCareerDuelTier, resolveCareerDuelOutcome, type CareerDuelTier, type CareerDuelCommanderHome, type CareerDuelTravelCheckpoint } from './CareerDuelState'

export interface CareerDuelResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }

export interface CareerDuelRoster {
  captain: CareerDuelResident
  opponent: CareerDuelResident
  referee: CareerDuelResident
  loadout: UnitLoadout
  mount: Mount | null
}

/** Existing Duel classes retain their weapons/mounts; shield-bearing T5 Commanders use their war shield. */
function duelLoadout(presetId: UnitPresetId, tier: CareerDuelTier): UnitLoadout {
  if (tier === 5) {
    const selected = resolveT4UnitLoadout(presetId)
    return { ...selected, shieldId: selected.shieldId ? 'commander_shield_t5' : null,
      ...(UNIT_PRESETS[presetId].traits.includes('bow_fire') ? { rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null } : {}) }
  }
  const base = UNIT_PRESETS[presetId].tierLoadouts[tier === 4 ? 3 : tier]
  return tier === 4 ? { ...resolveT4UnitLoadout(presetId), mountId: base.mountId } : base
}

/** Selection changes equipment on existing residents, rather than creating a second Town roster. */
export function selectCareerDuelRoster(residents: readonly CareerDuelResident[], blackCat: Mount, presetId: UnitPresetId, tier: CareerDuelTier): CareerDuelRoster | null {
  if (!isCareerDuelPresetId(presetId) || !isCareerDuelTier(tier)) return null
  const preset = UNIT_PRESETS[presetId]
  const captain = residents.find(resident => resident.spec.role === 'captain')
  const ranger = residents.find(resident => resident.spec.role === 'ranger')
  if (!preset || !captain || captain.npc.dead) return null
  const archery = preset.traits.includes('bow_fire')
  const loadout = duelLoadout(presetId, tier)
  let opponent: CareerDuelResident | undefined
  if (tier === 5) opponent = residents.find(resident => resident.spec.id === 'commander' && resident.spec.role === 'commander')
  else if (tier === 4) opponent = archery ? ranger : captain
  else {
    const mounted = Boolean(loadout.mountId)
    opponent = residents.filter(resident => resident.spec.duty === 'training' && !resident.npc.dead
      && resident.npc.characterTier !== 4 && !resident.npc.visualAssetId && !resident.npc.combatProfileId && !resident.npc.specialCombatProfile
      && (!mounted || Boolean((resident.homeMount ?? resident.npc.mount) && !(resident.homeMount ?? resident.npc.mount)!.dead)))
      .sort((a, b) => {
        const score = (resident: CareerDuelResident) => Number(resident.npc.presetId === presetId) * 4
          + Number(Boolean(resident.homeMount ?? resident.npc.mount) === mounted) * 2
          + Number(archery ? resident.spec.unitKind === 'ranged' || resident.spec.unitKind === 'horse_archer' : resident.spec.unitKind === 'melee' || resident.spec.unitKind === 'sword_cavalry')
        return score(b) - score(a) || Number(a.spec.garrison?.kind === 'rampart') - Number(b.spec.garrison?.kind === 'rampart')
      })[0]
  }
  const referee = opponent === captain ? ranger : captain
  if (!opponent || opponent.npc.dead || !referee || referee.npc.dead) return null
  // T5 creates its own mount only when the saved mission starts, never during selection.
  const mount = !loadout.mountId || tier === 5 ? null : tier === 4 && archery ? blackCat : opponent.homeMount ?? opponent.npc.mount
  if (tier !== 5 && loadout.mountId && (!mount || mount.dead)) return null
  return { captain, opponent, referee, loadout: tier === 4 && archery ? { ...opponent.npc.loadout } : loadout, mount }
}

/** The resident's normal loadout remains authoritative; only its borrowed resources were saved. */
export function restoreCareerDuelCommander(npc: NPC, home: CareerDuelCommanderHome, homeMount?: Mount): void {
  const yaw = npc.group.rotation.y
  npc.dismountFromMount()
  npc.restoreForTown()
  npc.group.rotation.y = yaw
  npc.restoreCombatHealth(home.hp)
  npc.restoreCombatAmmo(home.ammo)
  if (homeMount) {
    homeMount.restoreForTown(npc.group.position.x, npc.group.position.z, yaw)
    npc.mountVehicle(homeMount)
  }
}

const MARCH_SPEED = 6
const RETURN_PLAYER_RADIUS = 12

/** Owns duel flow; TownMissionCombat advances entities and TownScene retains damage routing.
 * TownMissionSettlement owns saved return and resident restoration.
 */
export class CareerDuelController {
  readonly events = new CombatEventStream()
  onMarchStarted: (() => void) | null = null
  onReturnStarted: (() => void) | null = null
  private tracker: BattleStatsTracker | null = null
  private missionActors: NPC[] = []
  private missionMounts: Mount[] = []
  private missionOpponent: NPC | null = null
  private commanderHome: CareerDuelCommanderHome | null = null
  private missionCaptain: NPC | null = null
  private missionReferee: NPC | null = null
  private opponentMount: Mount | null = null
  private ownedDuelMount: Mount | null = null
  private routeLeader: NPC | null = null
  private route: THREE.Vector3[] = []
  private routeIndex = 0
  private commandId = 1
  private countdownElapsed = 0
  private combatElapsed = 0
  private area = new THREE.Vector3()
  private staging = false
  private readonly externalCombat = new Set<NPC>()
  private readonly checkpoint = new CareerMissionCheckpoint(() => this.readProfile(), profile => this.commit(profile))

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: TownWorld,
    private readonly navigation: NavigationWorld,
    private readonly residents: readonly CareerDuelResident[],
    private readonly blackCat: Mount,
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly createMount: (scene: THREE.Scene, mountId: NonNullable<UnitLoadout['mountId']>, x: number, z: number) => Mount
      = (scene, mountId, x, z) => new Mount(scene, mountTypeFromId(mountId), x, z),
  ) {}

  get active(): ActiveCareerMission | undefined { const mission = this.readProfile().activeMission; return mission?.kind === 'duel' ? mission : undefined }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get captain(): NPC | null { return this.missionCaptain }
  get opponent(): NPC | null { return this.missionOpponent }
  get referee(): NPC | null { return this.missionReferee }
  get actors(): NPC[] { return this.missionActors }
  get fieldNpcs(): NPC[] { return this.missionActors }
  get allMounts(): Mount[] { return this.missionMounts }
  get countdownRemaining(): number { return Math.max(0, DUEL_COUNTDOWN_SECONDS - this.countdownElapsed) }
  get combatRemaining(): number { return Math.max(0, DUEL_COMBAT_SECONDS - this.combatElapsed) }
  get combatEnabled(): boolean { return this.phase === 'ENGAGING' && !this.active?.result && this.combatElapsed < DUEL_COMBAT_SECONDS }
  get remainingEnemies(): number { return this.opponent && !this.opponent.dead ? 1 : 0 }
  get guideTarget(): THREE.Vector3 | null {
    if (this.phase === 'RETURNING') return this.returnPoint()
    if (this.phase === 'ASSEMBLING' || this.phase === 'MARCHING') return this.staging ? townDuelPosition(this.area, DUEL_PLAYER_OFFSET) : this.area.clone()
    return null
  }
  get returnComplete(): boolean {
    return this.phase === 'RETURNING' && this.player().combatPosition.distanceTo(this.returnPoint()) < RETURN_PLAYER_RADIUS
      && this.actors.filter(actor => !actor.dead).every(actor => actor.combatPosition.distanceTo(this.returnPoint()) < RETURN_PLAYER_RADIUS)
  }
  get isReturned(): boolean { return this.returnComplete }
  get outcome(): CareerMissionOutcome | null { return this.evaluate() }

  createMission(presetId: UnitPresetId, tier: CareerDuelTier): ActiveCareerMission | null {
    const roster = selectCareerDuelRoster(this.residents, this.blackCat, presetId, tier)
    if (!roster) return null
    const mission = createCareerDuelMission(this.readProfile(), presetId, tier, roster.opponent.npc.combatantId,
      roster.captain.npc.combatantId, undefined, roster.referee.npc.combatantId)
    if (!mission) return null
    const player = this.player()
    const ordinaryHealth = tier <= 3 ? careerDuelOpponentHealth(roster.opponent.npc.characterFaction, tier,
      roster.opponent.npc.hp, roster.opponent.npc.maxHp) : undefined
    return { ...mission, ...(tier === 5 ? { duelCommanderHome: { hp: roster.opponent.npc.hp, ammo: roster.opponent.npc.combatAmmo },
      duelTravel: this.travelCheckpoint([roster.captain.npc, roster.opponent.npc], false) } : {}), duelOpponentHp: ordinaryHealth?.hp ?? roster.opponent.npc.hp,
      ...(ordinaryHealth ? { duelOpponentMaxHp: ordinaryHealth.maxHp } : {}),
      ...(roster.mount ? { duelOpponentMountHp: roster.mount.currentHp } : {}),
      ...(Number.isFinite(player.hp) && player.hp >= 0 ? { duelPlayerHp: player.hp } : {}),
      ...(Number.isFinite(player.staminaValue) && player.staminaValue >= 0 ? { duelPlayerStamina: player.staminaValue } : {}) }
  }

  startActiveMission(): boolean {
    const active = this.active
    if (!active || !isCareerDuelPresetId(active.duelPresetId) || !isCareerDuelTier(active.duelTier)) return false
    const captain = this.residents.find(resident => resident.npc.combatantId === active.duelCaptainActorId)
    const opponent = this.residents.find(resident => resident.npc.combatantId === active.duelOpponentActorId)
    const referee = this.residents.find(resident => resident.npc.combatantId === (active.duelRefereeActorId ?? active.duelCaptainActorId))
    if (!captain || !opponent || !referee) return false
    if (active.duelTier <= 3 && (opponent.npc.characterTier === 4 || opponent.npc.visualAssetId
      || opponent.npc.combatProfileId || opponent.npc.specialCombatProfile)) return false
    if (active.duelTier === 5 && (opponent.spec.id !== 'commander' || opponent.spec.role !== 'commander'
      || captain.spec.role !== 'captain' || referee !== captain)) return false
    const area = findTownDuelArena(this.world.obstacles, this.navigation, this.residents.map(resident => resident.spec))
    if (!area) return false
    this.cleanupMission()
    this.commanderHome = active.duelTier === 5 ? active.duelCommanderHome ?? { hp: opponent.npc.hp, ammo: opponent.npc.combatAmmo } : null
    this.missionCaptain = captain.npc
    this.missionOpponent = opponent.npc
    this.missionReferee = referee.npc
    this.missionActors = [...new Set([captain.npc, opponent.npc, referee.npc])]
    this.missionMounts = [...new Set(this.missionActors.flatMap(actor => {
      // The Commander's service mount stays at home; T5 owns a separate selected-class mount.
      if (active.duelTier === 5 && actor === opponent.npc) return []
      const resident = this.residents.find(candidate => candidate.npc === actor)
      return [actor.mount, resident?.homeMount].filter((mount): mount is Mount => Boolean(mount))
    }))]
    for (const actor of this.actors) { actor.setDuelHostility(false); actor.respawnEnabled = false }
    const selected = duelLoadout(active.duelPresetId, active.duelTier)
    const ordinaryHealth = active.duelTier <= 3 ? careerDuelOpponentHealth(opponent.npc.characterFaction, active.duelTier,
      active.duelOpponentHp ?? opponent.npc.hp, active.duelOpponentMaxHp ?? opponent.npc.maxHp) : undefined
    if (active.duelTier <= 3) opponent.npc.applyTemporaryOrdinaryTier(active.duelTier as 1 | 2 | 3)
    const ranger = active.duelTier === 4 && UNIT_PRESETS[active.duelPresetId].traits.includes('bow_fire')
    opponent.npc.applyTemporaryCombatLoadout(ranger ? { ...opponent.npc.loadout } : selected,
      active.duelTier <= 3 ? active.duelTier as 1 | 2 | 3 : undefined)
    if (active.duelOpponentAmmo !== undefined) opponent.npc.restoreCombatAmmo(active.duelOpponentAmmo)
    const originalMount = opponent.homeMount ?? opponent.npc.mount
    opponent.npc.dismountFromMount()
    if (active.duelTier === 5 && originalMount) originalMount.visualHold = true
    if (selected.mountId) {
      const mount = active.duelTier === 5
        ? this.createMount(this.scene, selected.mountId, opponent.npc.group.position.x, opponent.npc.group.position.z)
        : ranger ? this.blackCat : originalMount
      if (active.duelTier === 5 && mount) {
        mount.setAppearanceVariant(horseVariantForStableKey(`town:${this.readProfile().faction}:${opponent.spec.id}`))
        this.ownedDuelMount = mount
        mount.reservedForTown = true
      }
      if (!mount || mount.dead) { this.cleanupMission(); return false }
      opponent.npc.mountVehicle(mount)
      this.opponentMount = mount
      if (!this.missionMounts.includes(mount)) this.missionMounts.push(mount)
      if (mount === this.blackCat) mount.catVisual?.setEquipmentVisible(true)
      if (active.duelOpponentMountHp !== undefined && mount.currentHp > active.duelOpponentMountHp) {
        mount.takeDamage(mount.currentHp - active.duelOpponentMountHp)
        if (mount.dead) opponent.npc.dismountFromMount()
      }
    }
    if (active.duelOpponentDead || active.deadTargetActorIds?.includes(opponent.npc.combatantId)) opponent.npc.takeDamage(Number.MAX_SAFE_INTEGER)
    else if (ordinaryHealth) opponent.npc.restoreCombatHealth(ordinaryHealth.hp)
    else if (active.duelTier === 5 && active.duelOpponentHp !== undefined) opponent.npc.restoreCombatHealth(active.duelOpponentHp)
    else if (active.duelOpponentHp !== undefined && opponent.npc.hp > active.duelOpponentHp) {
      opponent.npc.takeDamage((opponent.npc.hp - active.duelOpponentHp) / applyHeroIncomingDamage(1, opponent.npc.combatProfileId))
    }
    this.countdownElapsed = active.duelCountdownElapsed ?? 0
    this.combatElapsed = active.duelCombatElapsed ?? 0
    if (active.duelPlayerHp !== undefined) this.player().setHp(active.duelPlayerHp)
    if (active.duelPlayerStamina !== undefined) this.player().setStamina(active.duelPlayerStamina)
    this.area.copy(area)
    this.tracker = new BattleStatsTracker(this.events, false, event => this.acceptCombatEvent(event), active.playerStats)
    if (active.phase === 'ASSEMBLING') {
      // Legacy T5 saves can already be away from home: restore their physical
      // checkpoint before deriving the new direct route's starting position.
      if (active.duelTier === 5 && active.duelTravel) this.restoreTravelCheckpoint(active.duelTravel)
      this.beginMarch()
    }
    else if (active.phase === 'MARCHING') {
      // Outbound travel starts where the actors actually are, including an old
      // ASSEMBLING save. No removed-barracks detour or placement onto the route.
      this.setRoute(this.selectRouteLeader()?.combatPosition ?? this.player().combatPosition, this.area)
      this.ensureRouteLeader()
    } else if (active.phase === 'RETURNING') {
      // Old return saves contain stages toward the removed barracks. Restore
      // physical positions first, then derive a new route to the service home.
      if (active.duelTier === 5 && active.duelTravel) this.restoreTravelCheckpoint(active.duelTravel)
      this.setRoute(this.selectRouteLeader()?.combatPosition ?? this.player().combatPosition, this.returnPoint())
      this.ensureRouteLeader()
    } else {
      this.placeDuelParty()
      if (active.phase === 'ENGAGING' && !active.result) opponent.npc.setDuelHostility(true)
    }
    if (active.duelTier === 5 && active.duelTravel) {
      this.restoreTravelCheckpoint(active.duelTravel)
      if (active.phase === 'MARCHING' && this.staging) this.assignDuelPositions()
      else if (active.phase === 'MARCHING' || active.phase === 'RETURNING') {
        const leader = this.ensureRouteLeader()
        if (leader) {
          if (active.phase === 'MARCHING') this.setRoute(leader.combatPosition, this.area)
          this.assignMarch(leader)
        }
      }
    }
    return true
  }

  /** Town combat defers the runtime snapshot until its actors and mounts have advanced. */
  update(dt: number, deferCheckpoint = false): void {
    const active = this.active
    if (!active || !this.captain || !this.opponent || active.phase === 'RESULT') return
    for (const actor of this.externalCombat) if (actor.dead) this.externalCombat.delete(actor)
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0
    this.checkpoint.advance(elapsed)
    if (active.phase === 'ASSEMBLING' && !this.player().dead) {
      this.beginMarch()
    } else if (active.phase === 'MARCHING') {
      if (!this.staging) {
        const leader = this.ensureRouteLeader()
        if (leader && !this.externalCombat.has(leader)) this.advanceRoute(leader)
        if (!this.externalCombat.size && (!leader || leader.combatPosition.distanceTo(this.area) < 6)
          && this.actors.filter(actor => !actor.dead).every(actor => actor.combatPosition.distanceTo(this.area) < 16)
          && this.player().combatPosition.distanceTo(this.area) < 20) {
          this.staging = true
          this.assignDuelPositions()
        }
      }
      if (this.staging && !this.externalCombat.size && this.actors.filter(actor => !actor.dead)
        .every(actor => actor.combatPosition.distanceTo(this.duelPosition(actor)) < 2)
        && this.player().combatPosition.distanceTo(this.area) < 20 && this.setPhase('PREPARING')) this.placePlayer()
    } else if (active.phase === 'PREPARING') {
      this.countdownElapsed = Math.min(DUEL_COUNTDOWN_SECONDS, this.countdownElapsed + elapsed)
      if (this.countdownElapsed >= DUEL_COUNTDOWN_SECONDS && this.setPhase('ENGAGING')) this.opponent.setDuelHostility(true)
    } else if (active.phase === 'ENGAGING') {
      this.combatElapsed = Math.min(DUEL_COMBAT_SECONDS, this.combatElapsed + elapsed)
      if (this.evaluate()) this.opponent.setDuelHostility(false)
    } else if (active.phase === 'RETURNING') {
      const leader = this.ensureRouteLeader()
      if (leader && !this.externalCombat.has(leader)) this.advanceRoute(leader)
    }
    if (!deferCheckpoint) this.persistRuntimeProgress()
  }

  evaluate(playerDead = this.player().dead): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.result || active.phase === 'RESULT' || active.phase === 'RETURNING' || !this.opponent) return null
    if (playerDead || active.playerDead) return 'failure'
    return active.phase === 'ENGAGING' ? resolveCareerDuelOutcome(false, this.opponent.dead, this.combatElapsed) : null
  }

  isMissionActor(actor: NPC): boolean { return this.actors.includes(actor) }
  isMissionMount(mount: Mount): boolean { return this.allMounts.includes(mount) }
  isMissionTarget(actor: NPC): boolean { return actor === this.opponent }
  canDamageOpponent(target: NPC | Mount): boolean { return this.combatEnabled && (target === this.opponent || target === this.opponent?.mount) }
  canDamagePlayer(source: NPC | Mount): boolean { return this.combatEnabled && (source === this.opponent || source === this.opponent?.mount) }
  combatPeersFor(_actor: NPC): NPC[] { return [] }

  /** A temporary fight borrows behavior, never mission ownership or its saved route. */
  setExternalCombat(actor: NPC, enabled: boolean): void {
    if (!this.isMissionActor(actor)) return
    if (actor.dead || actor === this.opponent && this.combatEnabled) { this.externalCombat.delete(actor); return }
    if (enabled) {
      if (!this.externalCombat.has(actor)) { this.externalCombat.add(actor); actor.setTacticalOrder('attack') }
    } else if (this.externalCombat.delete(actor)) {
      if (this.phase === 'ASSEMBLING') this.beginMarch()
      else if ((this.phase === 'MARCHING' && !this.staging) || this.phase === 'RETURNING') {
        const leader = this.ensureRouteLeader()
        if (leader) this.assignMarch(leader)
      }
      else this.assignDuelPositions()
    }
  }

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.actors, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead }, squads: [],
    }
  }

  beginReturn(): boolean {
    const active = this.active
    if (active?.phase !== 'RESULT' || active.result?.outcome !== 'victory' || this.player().dead || !this.captain || !this.referee) return false
    const leader = this.selectRouteLeader()
    if (!this.setPhase('RETURNING', 0)) return false
    for (const actor of this.actors) actor.setDuelHostility(false)
    this.routeLeader = null
    this.setRoute(leader?.combatPosition ?? this.player().combatPosition, this.returnPoint())
    this.ensureRouteLeader()
    this.onReturnStarted?.()
    return true
  }
  startReturning(): boolean { return this.beginReturn() }

  persistRuntimeProgress(force = false): void {
    const active = this.active
    if (!active || !this.opponent || active.result && active.phase !== 'RETURNING') return
    const player = this.player()
    const validResource = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0
    const stamina = validResource(player.staminaValue) ? player.staminaValue : undefined
    const resourceChanged = validResource(player.hp) && player.hp !== active.duelPlayerHp
      || this.opponent.hp !== active.duelOpponentHp
      || validResource(this.opponent.combatAmmo) && this.opponent.combatAmmo !== active.duelOpponentAmmo
      || Boolean(this.opponentMount && this.opponentMount.currentHp !== active.duelOpponentMountHp)
    const playerStats = this.tracker?.checkpoint()
    const statsChanged = Boolean(playerStats && (Object.keys(playerStats) as (keyof typeof playerStats)[])
      .some(key => playerStats[key] !== (active.playerStats?.[key] ?? 0)))
    const travel = active.duelTier === 5 ? this.travelCheckpoint(this.actors, this.staging) : undefined
    const samePosition = (left: CareerDuelTravelCheckpoint['player'], right: CareerDuelTravelCheckpoint['player'] | undefined) =>
      Boolean(right && left.x === right.x && left.y === right.y && left.z === right.z && left.yaw === right.yaw)
    const travelChanged = Boolean(travel && (travel.staging !== active.duelTravel?.staging
      || !samePosition(travel.player, active.duelTravel?.player)
      || Object.entries(travel.actors).some(([id, position]) => !samePosition(position, active.duelTravel?.actors[id]))))
    const immediate = resourceChanged
      || this.opponent.dead !== Boolean(active.duelOpponentDead)
      || player.dead && !active.playerDead
      || this.combatElapsed >= DUEL_COMBAT_SECONDS && (active.duelCombatElapsed ?? 0) < DUEL_COMBAT_SECONDS
    // Movement, clocks and continuous stamina drain/recovery share the periodic cadence.
    const periodic = this.countdownElapsed !== (active.duelCountdownElapsed ?? 0)
      || this.combatElapsed !== (active.duelCombatElapsed ?? 0)
      || this.routeIndex !== (active.routeStage ?? 0)
      || stamina !== undefined && stamina !== active.duelPlayerStamina
      || travelChanged || statsChanged
    this.checkpoint.persist(() => this.runtimeMission(active), { immediate, periodic, force })
  }

  cleanupMission(): void {
    this.tracker?.dispose()
    this.tracker = null
    for (const actor of this.actors) { actor.setDuelHostility(false); actor.restoreCombatLoadout(); actor.restoreOrdinaryTier(); actor.setTacticalOrder('attack') }
    if (this.commanderHome && this.missionOpponent) {
      const resident = this.residents.find(candidate => candidate.npc === this.missionOpponent)
      this.missionOpponent.group.rotation.y = resident?.spec.yaw ?? Math.PI
      restoreCareerDuelCommander(this.missionOpponent, this.commanderHome, resident?.homeMount)
    }
    this.commanderHome = null
    // Borrowed Town mounts belong to their residents. Only this mission's mount is disposed.
    if (this.ownedDuelMount) {
      this.ownedDuelMount.releaseRider()
      this.ownedDuelMount.dispose()
      this.ownedDuelMount = null
    }
    this.missionActors = []
    this.missionMounts = []
    this.missionCaptain = this.missionOpponent = this.missionReferee = this.routeLeader = null
    this.opponentMount = null
    this.route = []
    this.routeIndex = 0
    this.staging = false
    this.externalCombat.clear()
    this.checkpoint.reset()
  }
  dispose(): void { this.cleanupMission() }

  private runtimeMission(active: ActiveCareerMission): ActiveCareerMission {
    const player = this.player()
    return { ...active, ...(active.duelTier === 5 ? { duelTravel: this.travelCheckpoint(this.actors, this.staging) } : {}), duelCountdownElapsed: this.countdownElapsed, duelCombatElapsed: this.combatElapsed,
      duelOpponentHp: this.opponent?.hp,
      ...(active.duelTier! <= 3 ? { duelOpponentMaxHp: this.opponent?.maxHp } : {}), ...(this.opponentMount ? { duelOpponentMountHp: this.opponentMount.currentHp } : {}),
      ...(Number.isFinite(player.hp) && player.hp >= 0 ? { duelPlayerHp: player.hp } : {}),
      ...(Number.isFinite(player.staminaValue) && player.staminaValue >= 0 ? { duelPlayerStamina: player.staminaValue } : {}),
      ...(Number.isFinite(this.opponent?.combatAmmo) ? { duelOpponentAmmo: this.opponent!.combatAmmo } : {}),
      duelOpponentDead: Boolean(this.opponent?.dead), playerDead: this.player().dead || Boolean(active.playerDead),
      deadTargetActorIds: this.opponent?.dead ? [this.opponent.combatantId] : [], routeStage: this.routeIndex,
      playerStats: this.tracker?.checkpoint() ?? active.playerStats }
  }
  private travelCheckpoint(actors: readonly NPC[], staging: boolean): CareerDuelTravelCheckpoint {
    const position = (p: THREE.Vector3, yaw: number) => ({ x: p.x, y: p.y, z: p.z, yaw })
    const player = this.player()
    return { actors: Object.fromEntries(actors.map(actor => [actor.combatantId,
      position(actor.combatPosition, actor.mount?.group.rotation.y ?? actor.group.rotation.y)])),
      player: position(player.currentMount?.group.position ?? player.group.position,
        player.currentMount?.group.rotation.y ?? player.group.rotation.y), staging }
  }
  private restoreTravelCheckpoint(saved: CareerDuelTravelCheckpoint): void {
    this.staging = saved.staging
    for (const actor of this.actors) {
      const p = saved.actors[actor.combatantId]
      if (!p) continue
      actor.group.position.set(p.x, p.y, p.z); actor.group.rotation.y = p.yaw
      if (actor.mount && !actor.mount.dead) {
        actor.mount.group.position.set(p.x, p.y, p.z); actor.mount.group.rotation.y = p.yaw
      }
    }
    const player = this.player(), p = saved.player
    if (player.currentMount && !player.currentMount.dead) {
      player.currentMount.group.position.set(p.x, p.y, p.z); player.currentMount.group.rotation.y = p.yaw
      player.syncMountTransform()
    } else { player.group.position.set(p.x, p.y, p.z); player.group.rotation.y = p.yaw }
  }
  private setPhase(phase: CareerMissionPhase, routeStage = this.routeIndex): boolean {
    const active = this.active
    if (!active || active.phase === phase) return false
    return this.checkpoint.persist(() => ({ ...this.runtimeMission(active), phase, routeStage }), { immediate: true })
  }
  private acceptCombatEvent(event: CombatEvent): boolean {
    if (this.phase !== 'ENGAGING' || !this.opponent || (event.type !== 'damage_applied' && event.type !== 'actor_killed')) return false
    return event.source.actorType === 'player'
      ? event.target.targetId === this.opponent.combatantId || event.target.ownerActorId === this.opponent.combatantId
      : event.source.actorId === this.opponent.combatantId && (event.target.targetId === 'player' || event.target.ownerActorId === 'player')
  }
  private returnPoint(): THREE.Vector3 {
    // Captain's authored service station is at the town hall, not the former
    // training/barracks anchor. Final settlement restores each borrowed home.
    const home = this.residents.find(resident => resident.npc === this.captain)?.spec ?? townPlayerEntryPoint()
    return new THREE.Vector3(home.x, 'y' in home && home.y !== undefined ? home.y : getTerrainHeight(home.x, home.z), home.z)
  }
  private groundPoint(point: { x: number; z: number }): THREE.Vector3 { return new THREE.Vector3(point.x, getTerrainHeight(point.x, point.z), point.z) }
  private beginMarch(): void {
    // ASSEMBLING remains readable for old saves, but is no longer a location.
    // Do not issue travel until the phase checkpoint has been acknowledged.
    if (!this.setPhase('MARCHING', 0)) return
    this.setRoute(this.selectRouteLeader()?.combatPosition ?? this.player().combatPosition, this.area)
    this.ensureRouteLeader()
    this.onMarchStarted?.()
  }
  private selectRouteLeader(): NPC | null {
    return [this.captain, this.referee, ...this.actors].find((actor): actor is NPC => Boolean(actor && !actor.dead)) ?? null
  }
  /** Keep the remaining route and physical positions when a fallen leader is replaced. */
  private ensureRouteLeader(): NPC | null {
    if (!this.routeLeader || this.routeLeader.dead) {
      this.routeLeader = this.selectRouteLeader()
      if (this.routeLeader) this.assignMarch(this.routeLeader)
    }
    return this.routeLeader
  }
  private setRoute(from: THREE.Vector3, target: THREE.Vector3, stage = 0): void {
    this.navigation.beginFrame()
    const query = this.navigation.queryPath(from, target)
    this.route = []
    if (query.status === 'path') for (const cell of query.path) {
      const point = this.groundPoint(this.navigation.grid.cellToWorld(cell))
      if (!this.route.length || this.route[this.route.length - 1].distanceToSquared(point) >= 144) this.route.push(point)
    }
    this.route.push(target.clone())
    this.routeIndex = Math.min(Math.max(0, stage), this.route.length - 1)
  }
  private assignMarch(leader: NPC): void {
    const target = this.route[this.routeIndex]
    if (!target) return
    if (!this.externalCombat.has(leader)) leader.assignFormationTarget(this.commandId++, target, target.clone().sub(leader.combatPosition).setY(0).normalize(), MARCH_SPEED)
    let slot = 0
    for (const actor of this.actors) if (actor !== leader && !actor.dead && !this.externalCombat.has(actor)) actor.assignFollowTarget(leader, slot++, new THREE.Vector3(-3, 0, -5), MARCH_SPEED)
  }
  private advanceRoute(leader: NPC): void {
    const target = this.route[this.routeIndex]
    if (target && leader.combatPosition.distanceTo(target) < 4 && this.routeIndex < this.route.length - 1) { this.routeIndex++; this.assignMarch(leader) }
  }
  private placeActor(actor: NPC, point: THREE.Vector3, yaw: number): void {
    point.y = getTerrainHeight(point.x, point.z)
    if (actor.mount && !actor.mount.dead) { actor.mount.group.position.copy(point); actor.mount.group.rotation.y = yaw }
    actor.group.position.copy(point)
    actor.group.rotation.y = yaw
    actor.assignFormationTarget(this.commandId++, point, new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), MARCH_SPEED)
  }
  private placeDuelParty(): void {
    if (!this.opponent || !this.referee) return
    this.placeActor(this.opponent, this.duelPosition(this.opponent), Math.PI)
    if (this.referee !== this.opponent) this.placeActor(this.referee, this.duelPosition(this.referee), -Math.PI / 2)
    this.placePlayer()
  }
  private duelPosition(actor: NPC): THREE.Vector3 { return townDuelPosition(this.area, actor === this.opponent ? DUEL_OPPONENT_OFFSET : DUEL_REFEREE_OFFSET) }
  private assignDuelPositions(): void {
    for (const actor of this.actors) if (!actor.dead && !this.externalCombat.has(actor) && !(actor === this.opponent && this.combatEnabled)) {
      const yaw = actor === this.opponent ? Math.PI : -Math.PI / 2
      actor.assignFormationTarget(this.commandId++, this.duelPosition(actor), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), MARCH_SPEED)
    }
  }
  private placePlayer(): void {
    const player = this.player(), playerPoint = townDuelPosition(this.area, DUEL_PLAYER_OFFSET)
    if (player.currentMount && !player.currentMount.dead) { player.currentMount.group.position.copy(playerPoint); player.syncMountTransform() }
    else player.group.position.copy(playerPoint).add(new THREE.Vector3(0, .9, 0))
    player.faceDirection(0, 1)
  }
}
