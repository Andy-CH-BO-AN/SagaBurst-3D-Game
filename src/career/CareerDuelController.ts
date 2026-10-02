import * as THREE from 'three'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId, type UnitTier } from '../battle/UnitPresetCatalog'
import { applyHeroIncomingDamage } from '../battle/T4HeroCatalog'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatEvent } from '../combat/CombatAttribution'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { townSitePoint, type TownActorSpec } from '../town/TownRules'
import type { TownWorld } from '../town/TownWorld'
import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { ActiveCareerMission, CareerMissionOutcome, CareerMissionPhase } from './CareerMissionState'
import { createCareerDuelMission, DUEL_COMBAT_SECONDS, DUEL_COUNTDOWN_SECONDS, isCareerDuelPresetId, isCareerDuelTier, resolveCareerDuelOutcome } from './CareerDuelState'

export interface CareerDuelResident { spec: TownActorSpec; npc: NPC; homeMount?: Mount }

export interface CareerDuelRoster {
  captain: CareerDuelResident
  opponent: CareerDuelResident
  referee: CareerDuelResident
  loadout: UnitLoadout
  mount: Mount | null
}

/** Selection changes equipment on existing residents, rather than creating a second Town roster. */
export function selectCareerDuelRoster(residents: readonly CareerDuelResident[], blackCat: Mount, presetId: UnitPresetId, tier: UnitTier): CareerDuelRoster | null {
  if (!isCareerDuelPresetId(presetId) || !isCareerDuelTier(tier)) return null
  const preset = UNIT_PRESETS[presetId]
  const captain = residents.find(resident => resident.spec.role === 'captain')
  const ranger = residents.find(resident => resident.spec.role === 'ranger')
  if (!preset || !captain || captain.npc.dead) return null
  const archery = preset.traits.includes('bow_fire')
  const loadout = preset.tierLoadouts[tier === 4 ? 3 : tier]
  let opponent: CareerDuelResident | undefined
  if (tier === 4) opponent = archery ? ranger : captain
  else {
    const mounted = Boolean(loadout.mountId)
    opponent = residents.filter(resident => resident.spec.role.includes('_') && !resident.npc.dead
      && (!mounted || Boolean((resident.homeMount ?? resident.npc.mount) && !(resident.homeMount ?? resident.npc.mount)!.dead)))
      .sort((a, b) => {
        const score = (resident: CareerDuelResident) => Number(resident.npc.presetId === presetId) * 4
          + Number(Boolean(resident.homeMount ?? resident.npc.mount) === mounted) * 2
          + Number(archery ? resident.spec.role.startsWith('ranged') : !resident.spec.role.startsWith('ranged'))
        return score(b) - score(a)
      })[0]
  }
  const referee = opponent === captain ? ranger : captain
  if (!opponent || opponent.npc.dead || !referee || referee.npc.dead) return null
  const mount = !loadout.mountId ? null : tier === 4 && archery ? blackCat : opponent.homeMount ?? opponent.npc.mount
  if (loadout.mountId && (!mount || mount.dead)) return null
  return { captain, opponent, referee, loadout: tier === 4 && archery ? { ...opponent.npc.loadout } : loadout, mount }
}

const MARCH_SPEED = 6
const RETURN_PLAYER_RADIUS = 12
const DUEL_AREA_CANDIDATES = [112, 135].flatMap(z => [0, 20, -20, 40, -40, 60, -60].map(x => ({ x, z })))

/** Owns the duel flow; TownScene retains entity updates, damage routing, and the established Town restore. */
export class CareerDuelController {
  readonly events = new CombatEventStream()
  onMarchStarted: (() => void) | null = null
  onReturnStarted: (() => void) | null = null
  private tracker: BattleStatsTracker | null = null
  private missionActors: NPC[] = []
  private missionMounts: Mount[] = []
  private missionOpponent: NPC | null = null
  private missionCaptain: NPC | null = null
  private missionReferee: NPC | null = null
  private opponentMount: Mount | null = null
  private returnLeader: NPC | null = null
  private route: THREE.Vector3[] = []
  private routeIndex = 0
  private commandId = 1
  private countdownElapsed = 0
  private combatElapsed = 0
  private area = new THREE.Vector3()

  constructor(
    _scene: THREE.Scene,
    private readonly world: TownWorld,
    private readonly navigation: NavigationWorld,
    private readonly residents: readonly CareerDuelResident[],
    private readonly blackCat: Mount,
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
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
  get returnComplete(): boolean {
    return this.phase === 'RETURNING' && this.player().combatPosition.distanceTo(this.assemblyPoint()) < RETURN_PLAYER_RADIUS
      && this.actors.filter(actor => !actor.dead).every(actor => actor.combatPosition.distanceTo(this.assemblyPoint()) < RETURN_PLAYER_RADIUS)
  }
  get isReturned(): boolean { return this.returnComplete }
  get outcome(): CareerMissionOutcome | null { return this.evaluate() }

  createMission(presetId: UnitPresetId, tier: UnitTier): ActiveCareerMission | null {
    const roster = selectCareerDuelRoster(this.residents, this.blackCat, presetId, tier)
    if (!roster) return null
    const mission = createCareerDuelMission(this.readProfile(), presetId, tier, roster.opponent.npc.combatantId,
      roster.captain.npc.combatantId, undefined, roster.referee.npc.combatantId)
    if (!mission) return null
    const player = this.player()
    return { ...mission, duelOpponentHp: roster.opponent.npc.hp,
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
    this.cleanupMission()
    this.missionCaptain = captain.npc
    this.missionOpponent = opponent.npc
    this.missionReferee = referee.npc
    this.missionActors = [...new Set([captain.npc, opponent.npc, referee.npc])]
    this.missionMounts = [...new Set(this.missionActors.flatMap(actor => {
      const resident = this.residents.find(candidate => candidate.npc === actor)
      return [actor.mount, resident?.homeMount].filter((mount): mount is Mount => Boolean(mount))
    }))]
    for (const actor of this.actors) { actor.setDuelHostility(false); actor.respawnEnabled = false }
    const selected = UNIT_PRESETS[active.duelPresetId].tierLoadouts[active.duelTier === 4 ? 3 : active.duelTier]
    const ranger = active.duelTier === 4 && UNIT_PRESETS[active.duelPresetId].traits.includes('bow_fire')
    opponent.npc.applyTemporaryCombatLoadout(ranger ? { ...opponent.npc.loadout } : selected)
    if (active.duelOpponentAmmo !== undefined) opponent.npc.restoreCombatAmmo(active.duelOpponentAmmo)
    const originalMount = opponent.homeMount ?? opponent.npc.mount
    opponent.npc.dismountFromMount()
    if (selected.mountId) {
      const mount = ranger ? this.blackCat : originalMount
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
    else if (active.duelOpponentHp !== undefined && opponent.npc.hp > active.duelOpponentHp) {
      opponent.npc.takeDamage((opponent.npc.hp - active.duelOpponentHp) / applyHeroIncomingDamage(1, opponent.npc.combatProfileId))
    }
    this.countdownElapsed = active.duelCountdownElapsed ?? 0
    this.combatElapsed = active.duelCombatElapsed ?? 0
    if (active.duelPlayerHp !== undefined) this.player().setHp(active.duelPlayerHp)
    if (active.duelPlayerStamina !== undefined) this.player().setStamina(active.duelPlayerStamina)
    this.area.copy(this.findDuelArea())
    this.tracker = new BattleStatsTracker(this.events, false, event => this.acceptCombatEvent(event), active.playerStats)
    if (active.phase === 'ASSEMBLING') this.assignAssembly()
    else if (active.phase === 'MARCHING') {
      this.setRoute(this.assemblyPoint(), this.area, active.routeStage)
      this.placeMarchParty(this.route[this.routeIndex] ?? this.area)
      this.assignMarch(captain.npc)
    } else if (active.phase === 'RETURNING') {
      this.returnLeader = !captain.npc.dead ? captain.npc : referee.npc
      this.setRoute(this.area, this.assemblyPoint(), active.routeStage)
      this.placeMarchParty(this.route[this.routeIndex] ?? this.assemblyPoint())
      this.assignMarch(this.returnLeader)
    } else {
      this.placeDuelParty()
      if (active.phase === 'ENGAGING' && !active.result) opponent.npc.setDuelHostility(true)
    }
    return true
  }

  update(dt: number): void {
    const active = this.active
    if (!active || !this.captain || !this.opponent || active.phase === 'RESULT') return
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0
    if (active.phase === 'ASSEMBLING' && !this.player().dead && this.player().combatPosition.distanceTo(this.captain.combatPosition) <= 12) {
      if (this.setPhase('MARCHING', 0)) {
        this.setRoute(this.captain.combatPosition, this.area)
        this.assignMarch(this.captain)
        this.onMarchStarted?.()
      }
    } else if (active.phase === 'MARCHING') {
      this.advanceRoute(this.captain)
      if (this.captain.combatPosition.distanceTo(this.area) < 6 && this.opponent.combatPosition.distanceTo(this.area) < 16
        && this.player().combatPosition.distanceTo(this.area) < 20 && this.setPhase('PREPARING')) this.placeDuelParty()
    } else if (active.phase === 'PREPARING') {
      this.countdownElapsed = Math.min(DUEL_COUNTDOWN_SECONDS, this.countdownElapsed + elapsed)
      if (this.countdownElapsed >= DUEL_COUNTDOWN_SECONDS && this.setPhase('ENGAGING')) this.opponent.setDuelHostility(true)
    } else if (active.phase === 'ENGAGING') {
      this.combatElapsed = Math.min(DUEL_COMBAT_SECONDS, this.combatElapsed + elapsed)
      if (this.evaluate()) this.opponent.setDuelHostility(false)
    } else if (active.phase === 'RETURNING' && this.returnLeader) this.advanceRoute(this.returnLeader)
    this.persistRuntimeProgress()
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

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.actors, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead }, squads: [],
    }
  }

  beginReturn(): boolean {
    const active = this.active
    if (active?.phase !== 'RESULT' || active.result?.outcome !== 'victory' || this.player().dead || !this.captain || !this.referee) return false
    const leader = !this.captain.dead ? this.captain : this.referee
    if (leader.dead || !this.setPhase('RETURNING', 0)) return false
    for (const actor of this.actors) actor.setDuelHostility(false)
    this.returnLeader = leader
    this.setRoute(leader.combatPosition, this.assemblyPoint())
    this.assignMarch(leader)
    this.onReturnStarted?.()
    return true
  }
  startReturning(): boolean { return this.beginReturn() }

  persistRuntimeProgress(_force = false): void {
    const active = this.active
    if (!active || !this.opponent || active.result && active.phase !== 'RETURNING') return
    const next = this.runtimeMission(active)
    if (JSON.stringify(next) === JSON.stringify(active)) return
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = next
    this.commit(profile)
  }

  cleanupMission(): void {
    this.tracker?.dispose()
    this.tracker = null
    for (const actor of this.actors) { actor.setDuelHostility(false); actor.restoreCombatLoadout(); actor.setTacticalOrder('attack') }
    this.missionActors = []
    this.missionMounts = []
    this.missionCaptain = this.missionOpponent = this.missionReferee = this.returnLeader = null
    this.opponentMount = null
    this.route = []
    this.routeIndex = 0
  }
  dispose(): void { this.cleanupMission() }

  private runtimeMission(active: ActiveCareerMission): ActiveCareerMission {
    const player = this.player()
    return { ...active, duelCountdownElapsed: this.countdownElapsed, duelCombatElapsed: this.combatElapsed,
      duelOpponentHp: this.opponent?.hp, ...(this.opponentMount ? { duelOpponentMountHp: this.opponentMount.currentHp } : {}),
      ...(Number.isFinite(player.hp) && player.hp >= 0 ? { duelPlayerHp: player.hp } : {}),
      ...(Number.isFinite(player.staminaValue) && player.staminaValue >= 0 ? { duelPlayerStamina: player.staminaValue } : {}),
      ...(Number.isFinite(this.opponent?.combatAmmo) ? { duelOpponentAmmo: this.opponent!.combatAmmo } : {}),
      duelOpponentDead: Boolean(this.opponent?.dead), playerDead: this.player().dead || Boolean(active.playerDead),
      deadTargetActorIds: this.opponent?.dead ? [this.opponent.combatantId] : [], routeStage: this.routeIndex,
      playerStats: this.tracker?.checkpoint() ?? active.playerStats }
  }
  private setPhase(phase: CareerMissionPhase, routeStage = this.routeIndex): boolean {
    const active = this.active
    if (!active || active.phase === phase) return false
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...this.runtimeMission(active), phase, routeStage }
    return this.commit(profile)
  }
  private acceptCombatEvent(event: CombatEvent): boolean {
    if (this.phase !== 'ENGAGING' || !this.opponent || (event.type !== 'damage_applied' && event.type !== 'actor_killed')) return false
    return event.source.actorType === 'player'
      ? event.target.targetId === this.opponent.combatantId || event.target.ownerActorId === this.opponent.combatantId
      : event.source.actorId === this.opponent.combatantId && (event.target.targetId === 'player' || event.target.ownerActorId === 'player')
  }
  private assemblyPoint(): THREE.Vector3 { const point = townSitePoint('barracks', 0, 15); return this.groundPoint(point) }
  private groundPoint(point: { x: number; z: number }): THREE.Vector3 { return new THREE.Vector3(point.x, getTerrainHeight(point.x, point.z), point.z) }
  private findDuelArea(): THREE.Vector3 {
    for (const candidate of DUEL_AREA_CANDIDATES) {
      const area = this.groundPoint(candidate)
      const bounds = new THREE.Box3().setFromCenterAndSize(area.clone().setY(0), new THREE.Vector3(34, 1000, 34))
      if (this.world.obstacles.some(obstacle => obstacle.box.intersectsBox(bounds))) continue
      if (this.world.camps.some(camp => camp.spawnPoints.some(point => point.distanceTo(area) < 65))) continue
      if (this.navigation.areConnected(this.assemblyPoint(), area)) return area
    }
    // The navigation grid also handles topology changes after damaged buildings.
    const nearest = this.navigation.grid.findNearestWalkableCell(DUEL_AREA_CANDIDATES[0], 10)
    return nearest ? this.groundPoint(this.navigation.grid.cellToWorld(nearest)) : this.groundPoint(DUEL_AREA_CANDIDATES[0])
  }
  private assignAssembly(): void {
    const assembly = this.assemblyPoint()
    this.actors.forEach((actor, index) => actor.assignFormationTarget(this.commandId++, assembly.clone().add(new THREE.Vector3(index * 3, 0, 0)), new THREE.Vector3(0, 0, 1), MARCH_SPEED))
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
    leader.assignFormationTarget(this.commandId++, target, target.clone().sub(leader.combatPosition).setY(0).normalize(), MARCH_SPEED)
    let slot = 0
    for (const actor of this.actors) if (actor !== leader && !actor.dead) actor.assignFollowTarget(leader, slot++, new THREE.Vector3(-3, 0, -5), MARCH_SPEED)
  }
  private advanceRoute(leader: NPC): void {
    const target = this.route[this.routeIndex]
    if (target && leader.combatPosition.distanceTo(target) < 4 && this.routeIndex < this.route.length - 1) { this.routeIndex++; this.assignMarch(leader) }
  }
  private placeMarchParty(anchor: THREE.Vector3): void {
    this.actors.forEach((actor, index) => { if (!actor.dead) this.placeActor(actor, anchor.clone().add(new THREE.Vector3(index * 3, 0, 0)), 0) })
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
    const opponentPoint = this.area.clone().add(new THREE.Vector3(0, 0, 8))
    this.placeActor(this.opponent, opponentPoint, Math.PI)
    if (this.referee !== this.opponent) this.placeActor(this.referee, this.area.clone().add(new THREE.Vector3(12, 0, 0)), -Math.PI / 2)
    const player = this.player(), playerPoint = this.area.clone().add(new THREE.Vector3(0, 0, -8))
    playerPoint.y = getTerrainHeight(playerPoint.x, playerPoint.z)
    if (player.currentMount && !player.currentMount.dead) { player.currentMount.group.position.copy(playerPoint); player.syncMountTransform() }
    else player.group.position.copy(playerPoint).add(new THREE.Vector3(0, .9, 0))
    player.faceDirection(0, 1)
  }
}
