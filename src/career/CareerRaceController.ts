import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import { raceReturnProfile } from './CareerRaceReturn'
import * as THREE from 'three'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { HpBar } from '../ui/HpBar'
import type { Player } from '../player/Player'
import { AIType, Faction, NPC } from '../world/NPC'
import { Mount, mountTypeFromId, felineVariantFromMountId } from '../world/Mount'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch } from '../world/NpcSpawnScheduler'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import type { CareerProfile } from './CareerProfile'
import { findMountParkingPoint, findSergeantResident, isMountParkingClear, planSergeantReturn, resolveTownEntryFallbackPoint, sergeantReturnFromResidents, type SergeantResidentLike } from '../town/SergeantReturn'
import { townPlayerEntryPoint } from '../town/TownRules'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import { cloneCareerProfile, canonicalCareerMountId } from './CareerProfile'
import { CAREER_MOUNT_INTERACTION_DISTANCE, canUseCareerMount, findSafeCareerMountPosition, type CareerMountController } from './CareerMountController'
import { activateCareerStoryEvent, careerStoryPending } from './CareerStoryEvents'
import { advanceRaceClock, advanceRaceRider, canEnterRace, finalizeRaceDeployment, lockRace, MOUNTED_RACES, pickRaceOpponentMount, RACE_SCHEDULE_VERSION, RACE_STORY_ID, RACE_STORY_RACE_ID, raceDefinitionForSchedule, raceRecordProfile, raceIsRunning, raceRiderDone, resolveRace, selectRaceCommander, updateRaceGuidance,
  type CareerRaceSession, type RaceId, type RaceRider, type RaceReferee, type RaceMountId } from './CareerRaceState'
import { legalRaceStart, RACE_START, RACE_START_SLOTS, raceWaypoints, raceMovementIsLegal, raceCheckpointTarget, type RacePoint, type RacePosition } from './CareerRaceRoute'

interface RaceResident { npc: NPC; homeMount?: Mount; spec: { id: string; role?: string; x: number; z: number; yaw?: number } }
const commandId = -7400
const RACE_DEPLOY_RETRY_MS = 3000
function vector(p: RacePoint): THREE.Vector3 { return new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z) }
function position(p: THREE.Vector3, yaw: number): RacePosition { return { x: p.x, y: p.y, z: p.z, yaw } }

/** Owns racing only. Town combat still owns damage, collision, animation and entity updates. */
export class CareerRaceController {
  session?: CareerRaceSession
  private racer?: NPC
  private borrowedCommander?: RaceResident
  private mount?: Mount
  private captain?: RaceResident
  private captainReturning = false
  private captainHp?: number
  private guideAnchor?: RacePoint
  private commanded = new Map<NPC, string>()
  private readonly waypoints = raceWaypoints()
  private saveElapsed = 0
  private framePhase?: CareerRaceSession['phase']
  private frameDt = 0
  private frameMovementDt = 0
  private lastPlayerMount?: Mount | null
  private stallSeconds = 0
  private lastOpponentPosition?: RacePosition
  private batch?: NpcSpawnBatch
  private preloadInFlight = false
  error = ''
  saveFailed = false
  /** Unridden mounts and other floor occupants the Town knows about; part of every return clearance. */
  parkedBlockers?: (except?: Mount | null) => { x: number; z: number; radius: number }[]
  /** Town return candidates may stand on the Town Center floor instead of terrain. */
  returnGroundHeight?: (x: number, z: number) => number

  constructor(private readonly scene: THREE.Scene, private readonly navigation: NavigationWorld,
    private readonly obstacles: readonly ObstacleData[], private readonly residents: readonly RaceResident[],
    private readonly player: () => Player, private readonly hp: HpBar, private readonly mounts: CareerMountController,
    private readonly read: () => CareerProfile, private readonly commit: (p: CareerProfile) => boolean) {}

  get actors(): NPC[] { return [...(this.racer ? [this.racer] : []), ...(this.ownsCaptain && this.captain ? [this.captain.npc] : [])] }
  get allMounts(): Mount[] { return this.mount ? [this.mount] : [] }
  get ownsCaptain(): boolean {
    return Boolean(this.captain && !this.captain.npc.dead && !this.captain.npc.hostileToPlayer
      && !this.session?.guideFallback && (this.session?.phase === 'guiding' || this.session?.phase === 'countdown' || this.session?.phase === 'returning' || this.captainReturning))
  }
  owns(npc: NPC): boolean { return npc === this.racer || this.ownsCaptain && npc === this.captain?.npc }
  get ready(): boolean { return Boolean(this.racer && this.batch?.ready) }
  get resultSaved(): boolean { return Boolean(this.session?.result && this.session.phase !== 'finishing' && this.read().raceRecords?.some(r => r.sessionId === this.session!.id)) }
  get canWalkBack(): boolean { return !this.player().dead && Boolean(this.captain && !this.captain.npc.dead && !this.captain.npc.hostileToPlayer) }
  get returnComplete(): boolean {
    if (this.session?.phase !== 'returning' || !this.captain) return false
    const playerPos = this.player().combatPosition
    const captainArrived = Math.hypot(this.captain.npc.combatPosition.x - this.captain.spec.x, this.captain.npc.combatPosition.z - this.captain.spec.z) < 4
    const nearCaptain = Math.hypot(playerPos.x - this.captain.spec.x, playerPos.z - this.captain.spec.z) < 12
    const sergeant = findSergeantResident(this.residents.map(r => ({ spec: { ...r.spec, role: r.spec.role ?? '' }, npc: r.npc })) as readonly SergeantResidentLike[])
    const nearSergeant = Boolean(sergeant && Math.hypot(playerPos.x - sergeant.spec.x, playerPos.z - sergeant.spec.z) < 12)
    return captainArrived && (nearCaptain || nearSergeant)
  }
  get guideTarget(): THREE.Vector3 | null {
    const s = this.session
    if (!s || s.result && s.phase !== 'returning' && s.phase !== 'finishing') return null
    if (s.phase === 'returning') return this.captain ? vector(this.captain.spec) : null
    if (!raceIsRunning(s)) return vector(RACE_START_SLOTS[0])
    const target = raceCheckpointTarget(s.player.checkpoint, s.player.position)
    return raceRiderDone(s.player) || !target ? null : vector(target)
  }

  /** The ordinary entry rules, shared by every way into a race: an owned, usable, ridden ground mount and no other activity. */
  private canEnter(fresh: CareerProfile): boolean {
    const p = this.player(), mount = p.currentMount
    return !p.dead && Boolean(mount) && canEnterRace(fresh, {
      id: this.mounts.activeMountId, ownedActive: this.mounts.activeMount === mount,
      mounted: p.isMounted, dead: mount!.dead, hp: mount!.currentHp, airborne: mount!.isAirborne,
      legal: Boolean(this.mounts.activeMountId && canUseCareerMount(fresh, this.mounts.activeMountId)),
    })
  }
  /** The Commander's invitation is about the ordinary military horse, ridden under the ordinary entry rules. */
  canEnterStoryRace(fresh: CareerProfile): boolean {
    return careerStoryPending(fresh, RACE_STORY_ID) && this.canEnter(fresh)
      && this.mounts.activeMountId !== null && canonicalCareerMountId(this.mounts.activeMountId) === 'horse'
  }

  accept(id: RaceId, fresh: CareerProfile, options: { story?: boolean } = {}): boolean {
    const definition = MOUNTED_RACES.find(race => race.id === id), p = this.player(), mount = p.currentMount
    if (!definition || !mount || !this.canEnter(fresh)) { this.error = '需實際騎乘自己持有、可用的地面坐騎，且沒有其他任務或賽馬。'; return false }
    if (options.story && (id !== RACE_STORY_RACE_ID || !this.canEnterStoryRace(fresh))) {
      this.error = '指揮官的邀請需要騎乘你自己持有的普通軍用戰馬，並且沒有其他任務或賽馬。'; return false
    }
    this.navigation.sync(this.obstacles)
    const captain = this.residents.find(r => r.spec.id === 'captain' && !r.npc.dead && !r.npc.hostileToPlayer)
    const commander = selectRaceCommander(this.residents)
    if (!captain || !commander || !this.startSlotsLegal() || !this.routePlanValid()
      || !this.navigation.areConnected(captain.npc.combatPosition, RACE_START)
      || !this.navigation.areConnected(commander.npc.combatPosition, RACE_START)) {
      this.error = 'Captain、指揮官或北門起跑路線暫時不可用，請確認城門與路面。'; return false
    }
    const sessionId = crypto.randomUUID(), origin = position(mount.group.position, mount.group.rotation.y)
    const makeRider = (actorId: string, mountId: RaceMountId, point: RacePosition, hp: number, mountHp: number): RaceRider => ({
      actorId, mountId, position: { ...point }, mountPosition: { ...point }, hp, mountHp, stamina: 100,
      mounted: true, dead: false, checkpoint: 0,
    })
    const spawn = commander.npc.combatPosition
    if (!this.legalSegment(spawn, spawn)) { this.error = '指揮官所在位置沒有足夠坐騎空間。'; return false }
    const opponentMount = pickRaceOpponentMount(definition)
    const session: CareerRaceSession = { version: 1, scheduleVersion: RACE_SCHEDULE_VERSION, ...(options.story ? { story: RACE_STORY_ID } : {}), deployed: false, id: sessionId, raceId: id, phase: 'guiding', countdownSeconds: 10,
      elapsedSeconds: 0, gameSeconds: 0, phaseSeconds: 0, waypoint: 0,
      referee: this.captureReferee(captain),
      opponentHome: this.captureReferee(commander), opponentAmmo: commander.npc.combatAmmo,
      player: { ...makeRider('player', canonicalCareerMountId(this.mounts.activeMountId!) as RaceMountId, origin, p.hp, mount.currentHp), mountArmorImpact: mount.armorImpactRemaining, stamina: p.staminaValue },
      // The mount is race-owned; the actual native Commander and his equipment are borrowed intact.
      opponent: { ...makeRider(TOWN_COMMANDER_ID, opponentMount, position(spawn, commander.npc.group.rotation.y), commander.npc.hp, 1), stamina: commander.npc.staminaValue } }
    const next = cloneCareerProfile(fresh); next.activeRace = session
    // The accepted invitation and the session it may settle are saved together, or not at all.
    if (options.story && !activateCareerStoryEvent(next, RACE_STORY_ID, sessionId)) { this.error = '指揮官的邀請已不可用。'; return false }
    if (!this.commit(next)) { this.error = '參賽狀態保存失敗，比賽尚未部署。請重試。'; return false }
    this.session = structuredClone(session); this.captain = captain; this.captainHp = captain.npc.hp
    this.lastPlayerMount = p.currentMount
    this.deploy(true)
    return true
  }

  restore(): void {
    const saved = this.read().activeRace
    if (!saved) return
    this.session = structuredClone(saved)
    this.captain = this.residents.find(r => r.spec.id === 'captain')
    this.captainHp = this.captain?.npc.hp
    if (this.captain && saved.referee) {
      const r = saved.referee, npc = this.captain.npc, mount = this.captain.homeMount ?? npc.mount
      npc.restoreCombatHealth(r.hp)
      if (mount && r.mountPosition) {
        mount.restoreArmor(r.mountArmorImpact)
        mount.currentHp = Math.min(mount.maxHp, r.mountHp ?? mount.currentHp)
        if (r.mountHp === 0) mount.takeDamage(mount.maxHp * 100)
        mount.group.position.set(r.mountPosition.x, r.mountPosition.y, r.mountPosition.z); mount.group.rotation.y = r.mountPosition.yaw
        if (r.mounted && !npc.dead && !mount.dead) npc.mountVehicle(mount)
        else npc.dismountFromMount()
      }
      if (!npc.mount) npc.group.position.set(r.position.x, r.position.y, r.position.z)
      this.captainHp = npc.hp
    }
    this.deploy(!saved.deployed, true)
  }

  private preloadPromise?: Promise<void>
  /** Set when the opponent asset failed to load; the persisted session is kept and deployment is retried. */
  private deployRetry?: { initial: boolean; restoring: boolean; sessionId: string; at: number }

  async waitForDeployment(): Promise<void> {
    if (this.preloadPromise) await this.preloadPromise
    if (this.batch) await gameplayNpcSpawns.wait(this.batch)
  }

  /** True while a failed opponent asset load is waiting to be retried. */
  get deploymentRetryPending(): boolean { return Boolean(this.deployRetry) }

  private deploy(initial: boolean, restoring = false): void {
    const s = this.session!
    this.deployRetry = undefined
    const feline = felineVariantFromMountId(s.opponent.mountId)
    if (feline && !BlackCatVisual.isPreloaded(feline)) {
      if (this.preloadInFlight) return
      this.preloadInFlight = true
      this.preloadPromise = BlackCatVisual.preload(feline).then(() => {
        this.preloadInFlight = false
        if (this.session?.id === s.id && !this.batch?.ready && !this.racer) this.enqueueDeployment(s, initial, restoring)
      }).catch(() => {
        this.preloadInFlight = false
        if (this.session?.id !== s.id) return
        this.error = '賽手坐騎資源載入失敗，正在重試；賽事與對手已保留。'
        this.deployRetry = { initial, restoring, sessionId: s.id, at: Date.now() + RACE_DEPLOY_RETRY_MS }
      })
      return
    }
    this.enqueueDeployment(s, initial, restoring)
  }

  private retryDeploymentIfDue(): void {
    const retry = this.deployRetry
    if (!retry || Date.now() < retry.at) return
    if (this.session?.id !== retry.sessionId || this.racer || this.batch?.status === 'pending') { this.deployRetry = undefined; return }
    this.error = ''
    this.deploy(retry.initial, retry.restoring)
  }

  private enqueueDeployment(s: CareerRaceSession, initial: boolean, restoring: boolean): void {
    this.batch = gameplayNpcSpawns.batch(() => { this.disposeRacer(); this.error = '賽手部署失敗；重新載入可重試同場賽事。' })
    this.batch.enqueue(s.opponent.actorId, () => {
      const presetId: UnitPresetId = this.read().faction === 'roman' ? 'roman_sword_cavalry' : 'viking_sword_cavalry'
      const loadout = { ...UNIT_PRESETS[presetId].tierLoadouts[1], mountId: s.opponent.mountId }
      this.borrowedCommander = s.opponent.actorId === TOWN_COMMANDER_ID ? this.residents.find(r => r.spec.id === TOWN_COMMANDER_ID) : undefined
      if (s.opponent.actorId === TOWN_COMMANDER_ID && !this.borrowedCommander) throw new Error('Race Commander resident unavailable')
      // Legacy in-progress sessions retain their actor identity until they finish.
      const npc = this.borrowedCommander?.npc ?? trackNpcSpawn(new NPC(this.scene, s.opponent.position.x, s.opponent.position.z, Faction.TOWN,
        this.read().faction, AIType.MELEE, 'Circuit Rider', 1, true, loadout, presetId, undefined, s.opponent.actorId))
      this.racer = npc
      if (this.borrowedCommander) {
        const home = this.borrowedCommander.homeMount
        if (home && s.opponentHome?.mountPosition) {
          if (restoring) {
            const point = s.opponentHome.mountPosition
            home.group.position.set(point.x, point.y, point.z); home.group.rotation.y = point.yaw
            home.restoreArmor(s.opponentHome.mountArmorImpact)
            home.currentHp = Math.min(home.maxHp, s.opponentHome.mountHp ?? home.currentHp)
            if (home.currentHp === 0) home.takeDamage(home.maxHp * 100)
          }
          home.visualHold = true
        }
        npc.dismountFromMount()
      } else npc.setTownPeaceful()
      const mount = trackNpcSpawn(new Mount(this.scene, mountTypeFromId(s.opponent.mountId), s.opponent.mountPosition.x, s.opponent.mountPosition.z, undefined, horseVariantForStableKey(`town:${this.read().faction}:${s.opponent.actorId}`)))
      mount.reservedForTown = true; this.mount = mount
      if (!npc.dead) npc.mountVehicle(mount)
      if (initial) {
        if (restoring && this.borrowedCommander) {
          npc.restoreCombatHealth(s.opponent.hp); npc.restoreCombatStamina(s.opponent.stamina)
          if (s.opponentAmmo !== undefined) npc.restoreCombatAmmo(s.opponentAmmo)
        }
        s.opponent.hp = npc.hp; s.opponent.mountArmorImpact = mount.armorImpactRemaining; s.opponent.mountHp = mount.currentHp; s.opponent.stamina = npc.staminaValue
      }
      else {
        mount.group.position.set(s.opponent.mountPosition.x, s.opponent.mountPosition.y, s.opponent.mountPosition.z)
        mount.group.rotation.y = s.opponent.mountPosition.yaw
        mount.restoreArmor(s.opponent.mountArmorImpact)
        mount.currentHp = Math.min(mount.maxHp, s.opponent.mountHp)
        if (s.opponent.mountHp === 0) mount.takeDamage(mount.maxHp * 100)
        if (!s.opponent.mounted || mount.dead) npc.dismountFromMount()
        if (!s.opponent.mounted) npc.group.position.set(s.opponent.position.x, s.opponent.position.y, s.opponent.position.z)
        npc.restoreCombatHealth(s.opponent.hp); npc.restoreCombatStamina(s.opponent.stamina)
        if (s.opponentAmmo !== undefined) npc.restoreCombatAmmo(s.opponentAmmo)
      }
    })
    this.batch.seal(() => {
      if (!restoring) this.snapshot()
      finalizeRaceDeployment(s, () => this.persist())
    })
  }

  /** Restore uses the existing owned-mount adapter, never a selection-only free mount. */
  restorePlayer(options: { preservePlacement?: boolean; dismount?: boolean; mountPark?: { x: number; z: number } } = {}): void {
    const r = this.session?.player ?? this.read().racePlayerState
    if (!r || this.read().activeMission || this.read().activeOutpostMission) return
    const p = this.player()
    this.mounts.restoreRaceMount(r)
    const mount = this.mounts.activeMount
    const keepPlacement = Boolean(!this.session && options.preservePlacement)
    if (keepPlacement) {
      const groundAt = this.returnGroundHeight ?? getTerrainHeight
      if (mount) {
        if (r.mounted && !mount.dead && !r.dead && !options.dismount) {
          mount.group.position.set(p.group.position.x, groundAt(p.group.position.x, p.group.position.z), p.group.position.z)
          mount.group.rotation.y = p.group.rotation.y
          p.mountVehicle(mount)
        } else {
          // The planner already proved a legal parking spot; never fall back to the player's feet.
          const pos = options.mountPark ?? findSafeCareerMountPosition(p.group.position, this.obstacles, [p.group.position])
          if (pos) {
            mount.group.position.set(pos.x, groundAt(pos.x, pos.z), pos.z)
            mount.group.rotation.y = p.group.rotation.y
          }
        }
      }
    } else {
      if (mount) {
        mount.group.position.set(r.mountPosition.x, r.mountPosition.y, r.mountPosition.z); mount.group.rotation.y = r.mountPosition.yaw
        if (r.mounted && !mount.dead && !r.dead) p.mountVehicle(mount)
      }
      if (!r.mounted || r.dead) p.dismountFromMount({ preserveWorldPosition: true })
      p.group.position.set(r.position.x, r.position.y, r.position.z)
      p.faceDirection(Math.sin(r.position.yaw), Math.cos(r.position.yaw)); p.syncMountTransform()
    }
    p.setStamina(r.stamina)
    if (r.dead) p.takeDamage(p.maxHp * 100, this.hp)
    else p.setHp(r.hp)
    this.lastPlayerMount = p.currentMount
  }

  prepare(): void {
    this.retryDeploymentIfDue()
    const s = this.session
    if (!s || !this.ready) {
      if (this.captainReturning && this.ownsCaptain && this.captain) {
        this.order(this.captain.npc, this.captain.spec, false, 5)
        if (this.captain.npc.combatPosition.distanceTo(vector(this.captain.spec)) < 3) { this.captainReturning = false; this.captain.npc.setTacticalOrder('attack') }
      }
      return
    }
    const definition = raceDefinitionForSchedule(s.raceId, s.scheduleVersion)!
    if (this.ownsCaptain && this.captain) {
      const home = s.phase === 'returning' || this.captainReturning
      this.order(this.captain.npc, home ? this.captain.spec : { x: RACE_START.x, z: RACE_START.z + 7 }, false, 5)
      if (home && Math.hypot(this.captain.npc.combatPosition.x - this.captain.spec.x, this.captain.npc.combatPosition.z - this.captain.spec.z) < 2) {
        this.captainReturning = false
        if (!s || s.phase !== 'returning') this.captain.npc.setTacticalOrder('attack')
      }
    }
    const npc = this.racer!
    if (s.result && s.phase !== 'finishing' || raceRiderDone(s.opponent)) { if (!npc.dead) this.order(npc, npc.combatPosition, false); return }
    if (!raceIsRunning(s)) {
      const captain = this.captain?.npc
      if (s.phase === 'guiding' && !s.guideFallback && captain && captain.combatPosition.distanceTo(vector(RACE_START)) > 12) {
        if (!this.guideAnchor || Math.hypot(this.guideAnchor.x - captain.combatPosition.x, this.guideAnchor.z - captain.combatPosition.z) > 5)
          this.guideAnchor = { x: captain.combatPosition.x, z: captain.combatPosition.z + 4 }
        this.order(npc, this.guideAnchor, false, 5)
      } else this.order(npc, RACE_START_SLOTS[1], false, 5)
      return
    }
    let goal = this.waypoints[s.waypoint]
    while (goal && s.waypoint < this.waypoints.length - 1 && Math.hypot(npc.combatPosition.x - goal.x, npc.combatPosition.z - goal.z) < 3.6) {
      goal = this.waypoints[++s.waypoint]
    }
    if (goal && s.waypoint === this.waypoints.length - 1 && Math.hypot(npc.combatPosition.x - goal.x, npc.combatPosition.z - goal.z) < 1.8) {
      goal = this.waypoints[++s.waypoint]
    }
    if (goal) {
      const nextGoal = this.waypoints[s.waypoint + 1]
      const facing = nextGoal
        ? new THREE.Vector3(nextGoal.x - goal.x, 0, nextGoal.z - goal.z).normalize()
        : new THREE.Vector3(0, 0, -1)
      this.order(npc, goal, definition.sprint && !s.story, undefined, facing)
    }
  }
  private order(npc: NPC, point: RacePoint, sprint: boolean, speed?: number, facing = new THREE.Vector3(0, 0, -1)): void {
    const key = `${point.x}:${point.z}:${sprint}:${speed}`
    npc.missionMovement = sprint
    if (this.commanded.get(npc) === key && npc.formationCommandId === commandId) return
    npc.assignFormationTarget(commandId, vector(point), facing, speed)
    this.commanded.set(npc, key)
  }

  beginFrame(dt: number, movementDt: number): void {
    const s = this.session
    if (!s || !this.ready || s.result && s.phase !== 'finishing') return
    this.framePhase = s.phase; this.frameDt = dt; this.frameMovementDt = movementDt
    const previous = { ...s.player.position }
    const mount = this.player().currentMount
    const mountingDistance = mount && this.lastPlayerMount !== undefined && mount !== this.lastPlayerMount
      ? CAREER_MOUNT_INTERACTION_DISTANCE : 0
    this.lastPlayerMount = mount
    this.snapshot()
    const guideReady = s.guideFallback || this.ownsCaptain && this.captain!.npc.combatPosition.distanceTo(vector({ x: RACE_START.x, z: RACE_START.z + 7 })) < 4
    const ready = Boolean(guideReady && (s.player.dead || s.player.dnf || legalRaceStart(s.player.position))
      && (s.opponent.dead || s.opponent.dnf || legalRaceStart(s.opponent.position))
      && (s.player.dead || s.opponent.dead || Math.hypot(s.player.position.x - s.opponent.position.x, s.player.position.z - s.opponent.position.z) > 2.1))
    advanceRaceClock(s, dt, ready)
    if (raceIsRunning(s) && (this.framePhase === 'racing' || this.framePhase === 'finishing')) this.progress('player', previous, mountingDistance)
  }
  observeActorMovement(actor: NPC): void {
    if (actor !== this.racer || !this.session || !raceIsRunning(this.session)) return
    const previous = { ...this.session.opponent.position }
    this.snapshot()
    if (this.framePhase === 'racing' || this.framePhase === 'finishing') this.progress('opponent', previous)
  }
  private progress(side: 'player' | 'opponent', previous: RacePosition, mountingDistance = 0): void {
    const s = this.session!
    const rider = s[side], mount = side === 'player' ? this.player().currentMount : this.racer!.mount
    if (raceRiderDone(rider)) return
    previous = rider.routePosition ?? previous
    advanceRaceRider(rider, previous, s.elapsedSeconds, this.frameDt,
      raceMovementIsLegal(previous, rider.position, this.obstacles) && Boolean(!mount?.isAirborne),
      (mount?.baseSpeed ?? 10) * 2.5 * Math.min(1, this.frameMovementDt / Math.max(this.frameDt, .001)), mountingDistance)
    if (side === 'player' && rider.dnf === '不合法路線或位移') lockRace(s, 'loss', rider.dnf)
    // Finish timestamps are immutable before later damage. Resolve after both actors
    // have sampled this frame, so fractional crossing times win over update order.
  }

  advance(dt: number): void {
    const s = this.session
    if (!s || !this.ready) return
    const phase = s.phase
    this.snapshot()
    if (!s.result || s.phase === 'finishing') {
      updateRaceGuidance(s, Boolean(this.captain && !this.captain.npc.dead && !this.captain.npc.hostileToPlayer),
        Boolean(this.captain && this.captain.npc.hp < (this.captainHp ?? this.captain.npc.hp)))
      if ((raceIsRunning(s) || phase === 'guiding') && !raceRiderDone(s.opponent)) {
        if (!(phase === 'guiding' && legalRaceStart(s.opponent.position)) && this.lastOpponentPosition && Math.hypot(s.opponent.position.x - this.lastOpponentPosition.x, s.opponent.position.z - this.lastOpponentPosition.z) < .01) this.stallSeconds += dt
        else this.stallSeconds = 0
        this.lastOpponentPosition = { ...s.opponent.position }
        if (this.stallSeconds > 45) s.opponent.dnf = '路線阻塞，賽手無法繼續'
      }
      if (s.elapsedSeconds > 900) for (const rider of [s.player, s.opponent]) if (!raceRiderDone(rider)) rider.dnf = '超過賽事時間'
      // Entering another gate or an illegal route is an explicit player disqualification.
      if (!s.result && s.player.dnf && !s.player.dead && s.player.dnf !== '超過賽事時間') lockRace(s, 'loss', s.player.dnf)
      resolveRace(s)
    }
    this.saveElapsed += dt
    if (this.saveElapsed >= 1 || s.phase === 'result' && !this.resultSaved || s.phase !== this.framePhase) this.persist()
  }

  private captureReferee(resident: RaceResident): RaceReferee {
    const npc = resident.npc, mount = resident.homeMount ?? npc.mount
    return { position: position(npc.combatPosition, npc.group.rotation.y), hp: npc.hp, mounted: Boolean(npc.mount),
      ...(mount ? { mountHp: mount.currentHp, mountArmorImpact: mount.armorImpactRemaining, mountPosition: position(mount.group.position, mount.group.rotation.y) } : {}) }
  }
  snapshot(): void {
    const s = this.session
    if (!s || !this.racer || !this.mount) return
    if (this.captain) s.referee = this.captureReferee(this.captain)
    if (this.borrowedCommander && s.opponentHome) {
      s.opponentAmmo = this.borrowedCommander.npc.combatAmmo
      const home = this.borrowedCommander.homeMount
      if (home) { s.opponentHome.mountHp = home.currentHp; s.opponentHome.mountPosition = position(home.group.position, home.group.rotation.y) }
    }
    const p = this.player(), playerMount = this.mounts.activeMount
    for (const side of ['player', 'opponent'] as const) {
      const actor = side === 'player' ? p : this.racer, mount = side === 'player' ? playerMount : this.mount, rider = s[side]
      rider.hp = actor.hp; rider.dead = actor.dead; rider.stamina = actor.staminaValue
      const active = side === 'player' ? p.currentMount : this.racer.mount
      // Save the owned mount separately; borrowed mounts must not become owned on reload.
      rider.mounted = Boolean(mount && active === mount && !mount.dead)
      const point = active === mount && mount ? mount.group.position : actor.combatPosition
      rider.position = position(point, side === 'player' ? p.facingYaw : this.racer.group.rotation.y)
      if (mount) { rider.mountArmorImpact = mount.armorImpactRemaining; rider.mountHp = mount.currentHp; rider.mountPosition = position(mount.group.position, mount.group.rotation.y) }
    }
  }
  persist(): boolean {
    if (!this.session) return true
    const saved = this.commit(raceRecordProfile(this.read(), this.session))
    this.saveFailed = !saved
    if (saved) this.saveElapsed = 0
    return saved
  }
  startReturning(): boolean {
    if (!this.session || !this.resultSaved || !this.canWalkBack) return false
    delete this.session.guideFallback
    this.session.phase = 'returning'
    if (this.persist()) return true
    this.session.phase = 'result'
    return false
  }
  capturePlayerState(): RaceRider | undefined {
    const saved = this.session?.player ?? this.read().racePlayerState
    if (!saved) return undefined
    const p = this.player(), mount = this.mounts.activeMount, active = p.currentMount
    const id = this.mounts.activeMountId && canonicalCareerMountId(this.mounts.activeMountId)
    return { ...structuredClone(saved), ...(!this.session && id && id !== 'xongkoro' ? { mountId: id } : {}), hp: p.hp, dead: p.dead, stamina: p.staminaValue,
      mounted: Boolean(mount && mount === active && !mount.dead),
      position: position(active === mount && mount ? mount.group.position : p.combatPosition, p.facingYaw),
      ...(mount ? { mountHp: mount.currentHp, mountArmorImpact: mount.armorImpactRemaining, mountPosition: position(mount.group.position, mount.group.rotation.y) } : {}) }
  }
  clear(_direct = true): boolean {
    if (!this.session || !this.resultSaved) return false
    this.snapshot()
    const current = cloneCareerProfile(this.read())
    if (this.borrowedCommander && !this.borrowedCommander.npc.dead) current.townCommanderRecovery = {
      faction: current.faction, hp: this.borrowedCommander.npc.hp, ammo: this.borrowedCommander.npc.combatAmmo,
    }
    const player = this.capturePlayerState()
    if (!player) return false
    let target: RacePosition | undefined
    let mountTarget: RacePosition | undefined
    let dismount = false
    if (!current.townEvent?.pendingResult) {
      const sergeant = this.residents.filter((r): r is RaceResident & { spec: { id: string; role: string } } =>
        r.spec.id === 'deployment' && (!r.spec.role || r.spec.role === 'deployment'))
        .map(r => ({ ...r, spec: { ...r.spec, role: 'deployment' } }))
      const playerMount = this.mounts.activeMount
      const blockers = [...this.residents.filter(r => !r.npc.dead).map(r => ({ x: r.npc.combatPosition.x, z: r.npc.combatPosition.z, radius: 1.5 })),
        // Only the mount being planned is excluded, by identity; any other animal standing there still blocks.
        ...(this.parkedBlockers?.(playerMount) ?? [])]
      const groundAt = this.returnGroundHeight ?? getTerrainHeight
      const stance = (mounted: boolean) => ({ clearanceRadius: mounted ? 1.25 : 0.75, obstacles: this.obstacles, blockers,
        terrainHeight: groundAt, isValid: (point: { x: number; z: number }) => this.legalSegment(point, point, groundAt) })
      const plan = planSergeantReturn({
        resolve: mounted => sergeantReturnFromResidents(sergeant, stance(mounted)) ?? resolveTownEntryFallbackPoint(townPlayerEntryPoint(), stance(mounted)),
        restoreMounted: player.mounted && !player.dead,
        hasMount: Boolean(playerMount),
        // A mount already standing clear may stay; either way the same radius-aware clearance decides.
        findMountPark: point => {
          const radius = playerMount?.combatRadius
          const options = { obstacles: this.obstacles, terrainHeight: groundAt, radius, isValid: (p: { x: number; z: number }) => this.legalSegment(p, p, groundAt),
            occupied: [{ x: point.x, z: point.z, radius: 0.75 }, ...blockers] }
          const there = playerMount && !playerMount.dead && !player.mounted ? { x: playerMount.group.position.x, z: playerMount.group.position.z } : null
          if (there && isMountParkingClear(there, options)) return there
          return findMountParkingPoint(point, options)
        },
      })
      if (plan.status === 'blocked') { this.error = '鎮內沒有合法返回位置（含停馬位），請稍後重試。'; return false }
      const standing = player.mounted && !player.dead && !plan.dismount
      target = { x: plan.point.x, z: plan.point.z, y: plan.point.y + (standing ? 0 : .9), yaw: plan.point.yaw }
      if (plan.mountPark) mountTarget = { x: plan.mountPark.x, z: plan.mountPark.z, y: groundAt(plan.mountPark.x, plan.mountPark.z), yaw: plan.point.yaw }
      dismount = plan.dismount || !standing && player.mounted
    }
    const next = raceReturnProfile(current, player, target, this.player().maxHp, { dismount, mountDestination: mountTarget })
    if (!next) return false
    if (!this.commit(next)) return false
    this.error = ''
    this.captainReturning = Boolean(this.captain && !this.captain.npc.dead && !this.captain.npc.hostileToPlayer)
    this.disposeRacer()
    this.session = undefined
    return true
  }
  private routePlanValid(): boolean {
    const points = [RACE_START_SLOTS[1], ...this.waypoints]
    return points.every((point, index) => this.legalSegment(point, point)
      && (index === 0 || this.navigation.areConnected(points[index - 1], point)))
  }
  private startSlotsLegal(): boolean {
    return RACE_START_SLOTS.every(p => this.legalSegment(p, p) && this.navigation.areConnected(RACE_START, p))
  }
  /** Swept ground body clearance uses the real, current obstacles (including closed gate leaves). */
  private legalSegment(a: RacePoint, b: RacePoint, groundAt = getTerrainHeight): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(distance / .5))
    if (distance > 20) return false
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps, y = groundAt(x, z)
      if (Math.max(Math.abs(x), Math.abs(z)) > 348 || this.obstacles.some(o => !o.navigationPassable && o.box.max.y > y + .4 && o.box.min.y < y + 2.6
        && x > o.box.min.x - 1 && x < o.box.max.x + 1 && z > o.box.min.z - 1 && z < o.box.max.z + 1)) return false
    }
    return true
  }
  private disposeRacer(): void {
    this.deployRetry = undefined
    if (this.player().currentMount === this.mount) this.player().dismountFromMount({ preserveWorldPosition: true })
    this.batch?.cancel()
    const borrowed = this.borrowedCommander, home = this.session?.opponentHome
    if (borrowed) {
      const npc = borrowed.npc, mount = borrowed.homeMount
      if (mount) mount.visualHold = false
      npc.missionMovement = false; npc.setTacticalOrder(npc.hostileToPlayer ? 'charge' : 'attack')
      if (!npc.dead && home) {
        npc.dismountFromMount()
        // Release the native resident back to his service position only after the saved return.
        // Do not call restoreForTown: health, ammunition and hostility stay as actually played.
        npc.group.position.set(home.position.x, home.position.y, home.position.z); npc.group.rotation.y = home.position.yaw
        if (home.mounted && mount && !mount.dead) npc.mountVehicle(mount)
      }
      this.commanded.delete(npc)
    } else this.racer?.dispose()
    this.mount?.dispose(); this.racer = undefined; this.mount = undefined; this.borrowedCommander = undefined
  }
  dispose(): void { this.disposeRacer(); this.commanded.clear() }
}
