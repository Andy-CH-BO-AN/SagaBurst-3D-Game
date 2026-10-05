import * as THREE from 'three'
import { siegeRoster, siegeDefensePlans, siegeMuster, siegePoint, siegeOutward, insideSiegeTown, type TownSiegeState } from './TownSiege'
import { TOWN_GATES, type TownGateId } from '../town/TownLayout'
import type { CampaignGateController } from '../campaign/CampaignGate'
import { closeSiegeGate, overlapsGateClosure, type GateClosureBody } from '../town/TownSiegeGateClosure'
import type { TownOutskirtsWarfareController } from '../town/TownOutskirtsWarfareController'
import type { TownCavalryPatrolController } from '../town/TownCavalryPatrolController'
import type { ObstacleData } from '../world/Terrain'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream } from '../combat/CombatAttribution'
import type { Player } from '../player/Player'
import { getTerrainHeight } from '../world/Terrain'
import { resolveAssaultOutcome } from './EnemyTownAssault'
import { civilianShouldFight, civilianWartimeWeapon, townWartimePeers } from '../town/TownWartime'
import { Mount, mountTypeFromId } from '../world/Mount'
import { Faction, NPC } from '../world/NPC'
import { townAssaultObjectiveRoster, type TownActorSpec } from '../town/TownRules'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { acceptsCareerMissionStat, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { MissionGuide } from './MissionGuide'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import {
  TOWN_DEFENSE_LAYOUT,
  civilianShelterSlots,
  resolveTownDefenseOutcome,
  townDefenseFailureLocked,
} from './TownDefenseState'

export interface TownDefenseResident { spec: TownActorSpec; npc: NPC }
interface RuntimeGroup { id: TownGateId; members: NPC[]; cavalry: NPC[]; leader: NPC | null }
export interface TownSiegeContext {
  gates: ReadonlyMap<TownGateId, CampaignGateController>
  obstacles: ObstacleData[]
  patrol: TownCavalryPatrolController
  outskirts?: TownOutskirtsWarfareController
  closureBodies(): GateClosureBody[]
}
interface RuntimeAttackGroup { id: TownGateId; members: NPC[]; released: boolean; leader: NPC | null }

/** Shared Town war runtime: resident defense, civilian shelter behavior and faction peers.
 * In assault, the spawned army is friendly; objectives still count resident military only.
 */
export class TownDefenseController {
  readonly events = new CombatEventStream()
  readonly guide = new MissionGuide()
  readonly enemies: NPC[] = []
  readonly enemyMounts: Mount[] = []
  readonly groups: RuntimeGroup[] = []
  private readonly civilianCombat = new Set<NPC>()
  private attackGroups: RuntimeAttackGroup[] = []
  private tracker: BattleStatsTracker | null = null
  private preparationElapsed = 0
  private attackElapsed = 0
  private reserveCharged = false
  private commandId = 100_000
  private siege: TownSiegeState | null = null
  private readonly orders = new Map<NPC, THREE.Vector3>()
  private readonly approached = new Set<string>()
  private readonly gateListeners: (() => void)[] = []
  private readonly actorMounts = new Map<NPC, Mount>()
  private readonly checkpoint = new CareerMissionCheckpoint(() => this.readProfile(), profile => this.commit(profile))

  constructor(
    private readonly scene: THREE.Scene,
    private readonly residents: readonly TownDefenseResident[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly blackCat: Mount,
    private readonly navigation: NavigationWorld,
    private readonly siegeContext?: TownSiegeContext,
  ) {}

  get active(): ActiveCareerMission | undefined {
    const mission = this.readProfile().activeMission
    return mission?.kind === 'town-defense' || mission?.kind === 'enemy-town-assault' ? mission : undefined
  }
  get assault(): boolean { return this.active?.kind === 'enemy-town-assault' }
  get military(): NPC[] { const ids = new Set(townAssaultObjectiveRoster(this.residents.map(r => r.spec)).map(s => s.id)); return this.residents.filter(r => ids.has(r.spec.id)).map(r => r.npc) }
  get playerEnemies(): NPC[] { return this.fieldNpcs.filter(npc => npc.faction === Faction.ENEMY) }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get defenders(): NPC[] { return this.military }
  get civilians(): NPC[] { return this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.npc) }
  get captain(): NPC | null { return this.residents.find(resident => resident.spec.role === 'captain')?.npc ?? null }
  get ranger(): NPC | null { return this.residents.find(resident => resident.spec.role === 'ranger')?.npc ?? null }
  get sergeant(): NPC | null { return this.residents.find(resident => resident.spec.role === 'deployment')?.npc ?? null }
  get releasedEnemies(): NPC[] { return this.attackGroups.filter(group => group.released).flatMap(group => group.members) }
  get waitingEnemies(): NPC[] { return [] }
  get fieldNpcs(): NPC[] { return [...this.military, ...this.civilians, ...this.enemies] }
  get remainingEnemies(): number { return this.enemies.filter(enemy => !enemy.dead).length }
  get civilianDeaths(): number { return this.civilians.filter(civilian => civilian.dead).length }
  get civilianSurvived(): number { return this.civilians.length - this.civilianDeaths }
  get servicesLocked(): boolean { return Boolean(this.active && this.phase !== 'RESULT' && this.phase !== 'RESET') }
  get reserveHasCharged(): boolean { return this.reserveCharged }

  startActiveMission(): boolean {
    const active = this.active, context = this.siegeContext
    if (!active?.siege || active.result || !context) return false
    const freshAssault = this.assault && !active.siege.rosterCreated
    this.disposeEnemies()
    this.siege = cloneCareerProfile(this.readProfile()).activeMission!.siege!
    this.civilianCombat.clear(); this.orders.clear(); this.approached.clear()
    for (const id of this.siege.approachedActorIds) this.approached.add(id)
    context.patrol.recallForSiege()
    const residentDead = new Set([...(this.assault ? active.deadTargetActorIds : active.deadFriendlyActorIds) ?? [], ...(active.deadCivilianActorIds ?? [])])
    for (const resident of this.residents) this.restoreActor(resident.npc, active, residentDead.has(resident.spec.id))
    if (active.defenseCatDead && !this.blackCat.dead) this.blackCat.takeDamage(this.blackCat.currentHp + 1)
    if (!this.ranger?.dead && !this.blackCat.dead && this.ranger?.mount !== this.blackCat) this.ranger?.mountVehicle(this.blackCat)
    this.groups.length = 0
    const byId = new Map(this.residents.map(r => [r.spec.id, r.npc]))
    if (!this.siege.defensePlans.length) this.siege.defensePlans = siegeDefensePlans(this.residents.filter(r => !r.npc.dead).map(r => r.spec))
    for (const plan of this.siege.defensePlans) {
      this.groups.push({ id: plan.gateId, members: plan.infantry.map(id => byId.get(id)!), cavalry: plan.cavalry.map(id => byId.get(id)!), leader: plan.leaderId ? byId.get(plan.leaderId)! : null })
    }
    this.spawnSiegeArmy(active)
    this.prepareDeployment()
    this.preparationElapsed = active.defensePreparationElapsed ?? 0
    this.attackElapsed = active.defenseElapsed ?? 0
    this.reserveCharged = Boolean(this.siege.releasedReserveGateIds.length)
    for (const [id, gate] of context.gates) {
      if (this.siege.destroyedGateIds.includes(id)) gate.destroy()
      else {
        const hp = this.siege.gateHealth[id]
        if (hp !== undefined && hp < gate.damageable.currentHp) gate.damageable.takeDamage(gate.damageable.currentHp - hp)
        if (active.phase !== 'PREPARING') gate.close()
      }
      this.gateListeners.push(gate.onStateChange(state => { if (state === 'destroyed') this.releaseReserve(id) }))
      if (gate.state === 'destroyed' || this.siege.releasedReserveGateIds.includes(id)) this.releaseReserve(id)
    }
    context && this.navigation.sync(context.obstacles)
    if (active.phase !== 'PREPARING') for (const npc of this.military) {
      if (!npc.dead && !insideSiegeTown(npc.combatPosition)) this.order(npc, npc.combatPosition.clone())
    }
    const savedPlayer = this.siege.playerPosition
    if (savedPlayer) {
      this.player().group.position.set(savedPlayer.x, getTerrainHeight(savedPlayer.x, savedPlayer.z) + .9, savedPlayer.z)
      this.player().faceDirection(Math.sin(savedPlayer.yaw), Math.cos(savedPlayer.yaw))
    } else if (this.assault) {
      const point = this.withTerrain(siegeMuster('north', 1))
      this.player().group.position.copy(point).y += .9
      this.player().faceDirection(0, 1)
    }
    if (active.playerHp !== undefined && !active.playerDead) this.player().setHp(active.playerHp)
    if (active.playerStamina !== undefined && !active.playerDead) this.player().setStamina(active.playerStamina)
    this.tracker = new BattleStatsTracker(this.events, this.assault, event => acceptsCareerMissionStat(this.active!, event), active.playerStats)
    // Assault enters a new battlefield: create the initial deployment before its
    // first visible frame. Checkpoints keep their actual positions and breaches.
    if (freshAssault) {
      for (const [npc, point] of this.orders) {
        this.positionNpc(npc, point, siegeOutward(this.groupFor(npc)?.id ?? 'south'))
      }
      if (this.closeGates()) this.setPhase('ATTACKING')
    }
    if (this.phase !== 'PREPARING') this.beginAttack()
    this.persistRuntimeProgress(true)
    return true
  }

  updateFlow(dt: number, cameraYaw: number): void {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.phase === 'RESET') { this.guide.hide(); return }
    if (this.blackCat.dead && this.ranger?.mount === this.blackCat) this.ranger.dismountFromMount()
    const rally = this.anchorVector('playerRallyPoint')
    this.checkpoint.advance(dt)
    if (active.phase === 'PREPARING') {
      this.preparationElapsed += dt
      if (this.patrolRecalled() && this.closeGates() && this.setPhase('ATTACKING')) {
        this.beginAttack()
      }
    } else if (!this.assault) {
      this.attackElapsed += dt
      if (townDefenseFailureLocked(this.civilianDeaths) && active.phase !== 'FAILURE_LOCKED') this.setPhase('FAILURE_LOCKED')
      else if (!townDefenseFailureLocked(this.civilianDeaths) && this.remainingEnemies === 0 && active.phase !== 'VICTORY_LOCKED') this.setPhase('VICTORY_LOCKED')
    }
    if (this.phase !== 'PREPARING') this.updateSiegeAttackOrders()
    this.persistRuntimeProgress()
    if (!this.assault) this.guide.updateTownDefense(this.phase ?? active.phase, this.player().combatPosition, cameraYaw, rally, this.remainingEnemies, this.civilianDeaths)
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.result || active.phase === 'RESULT') return null
    if (this.assault) {
      if (this.military.length !== active.targetActorIds.length || new Set([...this.enemies.map(npc => npc.combatantId), ...(active.deadFriendlyActorIds ?? [])]).size !== 119) return null
      return resolveAssaultOutcome(playerDead, this.military.filter(npc => !npc.dead).length, this.enemies.filter(npc => !npc.dead).length)
    }
    const expectedIds = new Set(active.targetActorIds)
    const accountedIds = new Set([
      ...this.enemies.map(enemy => enemy.combatantId),
      ...(active.deadTargetActorIds ?? []),
    ])
    const registrationComplete = expectedIds.size > 0 && expectedIds.size === active.targetActorIds.length && [...expectedIds].every(id => accountedIds.has(id))
    const friendlyIds = new Set(active.friendlyActorIds)
    const combatDefendersAlive = [...this.defenders, this.captain, this.ranger, this.sergeant]
      .filter(npc => npc && friendlyIds.has(npc.combatantId) && !npc.dead).length
    return resolveTownDefenseOutcome(playerDead, this.civilianDeaths, registrationComplete, this.remainingEnemies, combatDefendersAlive)
  }

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.fieldNpcs, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead },
      squads: [],
    }
  }

  peersFor(npc: NPC): NPC[] {
    return townWartimePeers(npc, this.fieldNpcs)
  }

  updateCivilianOrder(npc: NPC): void {
    if (npc.townCategory !== 'civilian' || npc.dead) return
    const distances = this.peersFor(npc).map(target => npc.combatPosition.distanceTo(target.combatPosition))
    if (npc.hostileToPlayer && !this.player().dead) distances.push(npc.combatPosition.distanceTo(this.player().combatPosition))
    const fight = civilianShouldFight(Math.min(Infinity, ...distances), this.phase === 'PREPARING')
    if (fight) {
      const faction = this.assault ? this.readProfile().faction === 'roman' ? 'viking' : 'roman' : this.readProfile().faction
      npc.armTownCivilian(civilianWartimeWeapon(faction))
      if (!this.civilianCombat.has(npc)) npc.setTacticalOrder('attack')
      this.civilianCombat.add(npc)
    } else if (this.civilianCombat.delete(npc)) {
      const slot = this.civilianShelterPoints()[this.civilians.indexOf(npc)]
      const point = this.walkable(slot, [], 1.8)
      npc.assignFormationTarget(this.commandId++, point, new THREE.Vector3(0, 0, 1))
    }
  }

  cleanupMission(): void {
    this.disposeEnemies()
    for (const npc of [...this.military, ...this.civilians]) { npc.missionMovement = false; npc.assignSiegeObstacle(null); npc.restoreCombatLoadout(); npc.endExternalThreat() }
    this.siegeContext?.patrol.releaseSiegeOwnership()
    this.siegeContext?.outskirts?.releaseSiegeOwnership()
    for (const gate of this.siegeContext?.gates.values() ?? []) gate.restoreOpen()
    this.orders.clear(); this.siege = null
    this.groups.length = 0
    this.civilianCombat.clear()
    this.preparationElapsed = 0
    this.attackElapsed = 0
    this.reserveCharged = false
    this.guide.hide()
  }

  private prepareDeployment(): void {
    const occupied: { point: THREE.Vector3; spacing: number }[] = []
    for (const npc of this.military) { npc.beginExternalThreat(); npc.respawnEnabled = false; if (npc.mount) this.actorMounts.set(npc, npc.mount) }
    for (const [groupIndex, group] of this.groups.entries()) {
      group.members.forEach((npc, index) => this.order(npc, this.walkable(siegePoint(group.id, (index % 7 - 3) * 2.6, 12 + Math.floor(index / 7) * 3), occupied, 2.5)))
      group.cavalry.forEach((npc, index) => {
        const point = new THREE.Vector3(-47 + (groupIndex % 2) * 67 + (index % 5) * 5, 0, -42 + Math.floor(groupIndex / 2) * 72 + Math.floor(index / 5) * 5)
        this.order(npc, this.walkable(point, occupied, 4.8))
      })
    }
    this.civilians.forEach((npc, index) => this.order(npc, this.walkable(this.civilianShelterPoints()[index], occupied, 4.8)))
  }

  /** Leave mounted-width aisles and keep the central crossroads clear during recall. */
  private civilianShelterPoints(): THREE.Vector3[] {
    return civilianShelterSlots(this.civilians.length).map(point => point.multiplyScalar(2.5).add(new THREE.Vector3(20, 0, 0)))
  }

  private order(npc: NPC, point: THREE.Vector3): void {
    if (npc.dead) return
    const prior = this.orders.get(npc)
    if (prior && Math.hypot(prior.x - point.x, prior.z - point.z) < .5 && npc.missionMovement) return
    npc.assignSiegeObstacle(null)
    npc.missionMovement = true
    // Use native movement speed so urgent mission travel can sprint without patrol speed caps.
    npc.assignFormationTarget(this.commandId++, this.withTerrain(point), siegeOutward(this.groupFor(npc)?.id ?? 'south'))
    this.orders.set(npc, point.clone())
  }

  private groupFor(npc: NPC): RuntimeGroup | undefined { return this.groups.find(group => group.members.includes(npc) || group.cavalry.includes(npc)) }

  private patrolRecalled(): boolean {
    const context = this.siegeContext!
    const doorway = (npc: NPC) => [...context.gates.values()].some(gate => overlapsGateClosure(gate.collisionBox, npc.combatPosition, npc.isMounted ? 1.4 : .5))
    // The returning patrol is the only preparation barrier. Deployment continues
    // during combat; doorway occupants still follow the shared closure displacement.
    return this.residents.filter(r => r.spec.duty === 'patrol')
      .every(r => r.npc.dead || insideSiegeTown(r.npc.combatPosition) || doorway(r.npc))
  }

  private closeGates(): boolean {
    const context = this.siegeContext!
    for (const [id, gate] of context.gates) if (!closeSiegeGate(id, gate, context.closureBodies(), context.obstacles)) return false
    this.navigation.sync(context.obstacles)
    // A recalled resident displaced outside stays there to fight; never path to another gate.
    for (const npc of this.military) if (!npc.dead && !insideSiegeTown(npc.combatPosition)) this.order(npc, npc.combatPosition.clone())
    return [...context.gates.values()].every(gate => gate.state !== 'open')
  }

  private beginAttack(): void {
    for (const group of this.attackGroups) group.released = true
    this.updateSiegeAttackOrders()
  }

  private updateSiegeAttackOrders(): void {
    if (!this.siege || !this.siegeContext) return
    for (const group of this.attackGroups) {
      if (!group.leader || group.leader.dead) group.leader = group.members.find(npc => !npc.dead) ?? null
      const gate = this.siegeContext.gates.get(group.id)!
      for (const npc of group.members) {
        if (npc.dead || this.siege.crossedActorIds.includes(npc.combatantId)) continue
        const approach = siegePoint(group.id, 0, -12)
        if (!this.approached.has(npc.combatantId) && npc.combatPosition.distanceToSquared(approach) < 225) {
          this.approached.add(npc.combatantId); this.siege.approachedActorIds.push(npc.combatantId)
        }
        if (!this.approached.has(npc.combatantId)) { this.order(npc, approach); continue }
        if (gate.state !== 'destroyed') {
          if (npc.hasActiveRangedWeapon) this.order(npc, siegePoint(group.id, (group.members.indexOf(npc) % 7 - 3) * 3, -18))
          else {
            npc.missionMovement = false
            if (!npc.hasSiegeObstacle) { npc.setTacticalOrder('charge'); npc.assignSiegeObstacle(gate.siegeObstacle) }
          }
        } else {
          const crossing = siegePoint(group.id, (group.members.indexOf(npc) % 3 - 1) * 3, 12)
          this.order(npc, crossing)
          if (npc.combatPosition.clone().sub(siegePoint(group.id, 0, 0)).dot(siegeOutward(group.id)) < -5
            && npc.combatPosition.distanceToSquared(crossing) < 400) {
            this.siege.crossedActorIds.push(npc.combatantId)
            npc.missionMovement = false; npc.assignSiegeObstacle(null); npc.setTacticalOrder('charge'); this.orders.delete(npc)
          }
        }
      }
    }
  }

  private releaseReserve(id: TownGateId): void {
    if (!this.siege) return
    if (!this.siege.destroyedGateIds.includes(id) && this.siegeContext?.gates.get(id)?.state === 'destroyed') this.siege.destroyedGateIds.push(id)
    if (!this.siege.releasedReserveGateIds.includes(id)) this.siege.releasedReserveGateIds.push(id)
    this.reserveCharged = true
    const group = this.groups.find(group => group.id === id)
    // A breach releases this gate's entire defense from its deployment orders.
    // Holding a formation slot would leave infantry idle and cavalry unable to pursue.
    for (const npc of [...group?.members ?? [], ...group?.cavalry ?? []]) {
      if (npc.dead) continue
      npc.missionMovement = false
      npc.assignSiegeObstacle(null)
      npc.setTacticalOrder('charge')
      this.orders.delete(npc)
    }
  }

  /** Military damage no longer releases reserves; each gate's destruction owns that decision. */
  noteEffectiveFriendlyDamage(_target: NPC): void {}

  private positionNpc(npc: NPC, point: THREE.Vector3, facing: THREE.Vector3): void {
    npc.group.position.copy(point)
    npc.group.rotation.y = Math.atan2(facing.x, facing.z)
    if (npc.mount) { npc.mount.group.position.copy(point); npc.mount.group.rotation.y = npc.group.rotation.y }
  }

  private spawnSiegeArmy(active: ActiveCareerMission): void {
    const faction = this.assault ? this.readProfile().faction : this.readProfile().faction === 'roman' ? 'viking' : 'roman'
    const roster = siegeRoster(faction, this.assault)
    const siege = this.siege!
    const claim = !siege.rosterCreated ? this.siegeContext!.outskirts?.claimCavalryForSiege(faction) : undefined
    const available = [...(claim?.actors ?? [])]
    if (!siege.rosterCreated) {
      siege.claimedSquadIds = claim?.squadIds ?? []
      siege.attackerIds = roster.map(({ spec }, index) => spec.tier === 3 && spec.presetId?.endsWith('sword_cavalry') && available.length
        ? available.shift()!.combatantId : `${active.id}:siege:${index}`)
      siege.rosterCreated = true
    }
    const claimedById = new Map((claim?.actors ?? []).map(npc => [npc.combatantId, npc]))
    const occupied: { point: THREE.Vector3; spacing: number }[] = []
    const dead = new Set((this.assault ? active.deadFriendlyActorIds : active.deadTargetActorIds) ?? [])
    this.attackGroups = TOWN_GATES.map(gate => ({ id: gate.id, members: [], released: active.phase !== 'PREPARING', leader: null }))
    roster.forEach(({ gateId, slot, spec }, index) => {
      const id = siege.attackerIds[index]
      if (dead.has(id)) return
      const reused = claimedById.get(id)
      const point = this.walkable(siegeMuster(gateId, slot), occupied, 4.8)
      const npc = reused ?? new NPC(this.scene, point.x, point.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId, spec.squadId, id, this.events.emit, spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile)
      npc.respawnEnabled = false; npc.clearEncounter()
      if (reused) npc.applyTemporaryCombatLoadout(spec.loadout ?? {}, 3, spec.squadId)
      else if (spec.loadout?.mountId && (active.actorHealth?.[id]?.mountHp ?? 1) > 0) {
        const mount = new Mount(this.scene, mountTypeFromId(spec.loadout.mountId), point.x, point.z)
        npc.mountVehicle(mount)
      }
      if (npc.mount) { this.enemyMounts.push(npc.mount); this.actorMounts.set(npc, npc.mount) }
      this.restoreActor(npc, active, false)
      this.enemies.push(npc)
      const group = this.attackGroups.find(group => group.id === gateId)!
      group.members.push(npc); if (spec.tier === 4 || !group.leader) group.leader = npc
      if (siege.crossedActorIds.includes(id)) { npc.missionMovement = false; npc.setTacticalOrder('charge') }
      else this.order(npc, point)
    })
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission!.siege = { ...siege }
    if (this.assault) profile.activeMission!.friendlyActorIds = [...siege.attackerIds]
    else profile.activeMission!.targetActorIds = [...siege.attackerIds]
    // A failed write is retried by the normal full checkpoint; never rebuild or reinforce this runtime roster.
    this.commit(profile)
  }

  private restoreActor(npc: NPC, active: ActiveCareerMission, dead: boolean): void {
    const position = active.actorPositions?.[npc.combatantId], health = active.actorHealth?.[npc.combatantId]
    if (position) this.positionNpc(npc, this.withTerrain(new THREE.Vector3(position.x, 0, position.z)), new THREE.Vector3(Math.sin(position.yaw), 0, Math.cos(position.yaw)))
    if (health && !npc.dead) npc.restoreCombatHealth(Math.min(npc.maxHp, health.hp))
    if (npc.mount && health?.mountHp !== undefined) {
      const mount = npc.mount
      this.actorMounts.set(npc, mount)
      if (health.mountHp <= 0) { mount.takeDamage(mount.currentHp + 1); npc.dismountFromMount() }
      else mount.currentHp = Math.min(mount.maxHp, health.mountHp)
    }
    if ((dead || health?.hp === 0) && !npc.dead) npc.takeDamage(npc.maxHp + 1)
  }

  private setPhase(phase: CareerMissionPhase): boolean {
    const active = this.active
    if (!active || active.phase === phase) return true
    return this.checkpoint.persist(() => ({ ...active, ...this.siegeCheckpoint(), phase, defenseElapsed: this.attackElapsed, defensePreparationElapsed: this.preparationElapsed, defenseReserveCharged: this.reserveCharged, defenseCatDead: this.blackCat.dead, playerStats: this.tracker?.checkpoint() ?? active.playerStats, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds], civilianActorIds: [...(active.civilianActorIds ?? [])] }), { immediate: true })
  }

  persistRuntimeProgress(forceStats = false): void {
    const active = this.active
    if (!active || active.result) return
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    for (const enemy of this.assault ? this.military : this.enemies) if (enemy.dead) deadTargets.add(enemy.combatantId)
    const deadFriendlies = this.defenders.filter(npc => npc.dead).map(npc => npc.combatantId).sort()
    if (this.captain?.dead) deadFriendlies.push(this.captain.combatantId)
    if (this.ranger?.dead) deadFriendlies.push(this.ranger.combatantId)
    if (this.sergeant?.dead) deadFriendlies.push(this.sergeant.combatantId)
    if (this.assault) {
      deadFriendlies.length = 0
      deadFriendlies.push(...(active.deadFriendlyActorIds ?? []), ...this.enemies.filter(npc => npc.dead).map(npc => npc.combatantId))
    }
    const uniqueDeadFriendlies = [...new Set(deadFriendlies)].sort()
    const deadCivilians = this.civilians.filter(npc => npc.dead).map(npc => npc.combatantId).sort()
    const targetRoster = !this.assault && this.siege?.rosterCreated ? this.siege.attackerIds : active.targetActorIds
    const targetIds = [...deadTargets].filter(id => targetRoster.includes(id)).sort()
    const playerStats = this.tracker?.checkpoint() ?? active.playerStats
    const statsChanged = JSON.stringify(playerStats) !== JSON.stringify(active.playerStats)
    const same = targetIds.join('|') === [...(active.deadTargetActorIds ?? [])].sort().join('|')
      && uniqueDeadFriendlies.join('|') === [...(active.deadFriendlyActorIds ?? [])].sort().join('|')
      && deadCivilians.join('|') === [...(active.deadCivilianActorIds ?? [])].sort().join('|')
      && Math.abs((active.defenseElapsed ?? 0) - this.attackElapsed) < 1
      && Math.abs((active.defensePreparationElapsed ?? 0) - this.preparationElapsed) < 1
      && Boolean(active.defenseReserveCharged) === this.reserveCharged
      && Boolean(active.defenseCatDead) === this.blackCat.dead
    const playerDead = this.player().dead || Boolean(active.playerDead)
    this.checkpoint.persist(() => ({ ...active, ...this.siegeCheckpoint(), playerDead, deadTargetActorIds: targetIds, deadFriendlyActorIds: uniqueDeadFriendlies, deadCivilianActorIds: deadCivilians, defenseElapsed: this.attackElapsed, defensePreparationElapsed: this.preparationElapsed, defenseReserveCharged: this.reserveCharged, defenseCatDead: this.blackCat.dead, ...(playerStats ? { playerStats } : {}) }), {
      immediate: !same || Boolean(active.playerDead) !== playerDead,
      periodic: statsChanged || Boolean(this.siege),
      force: forceStats,
    })
  }

  private siegeCheckpoint(): Partial<ActiveCareerMission> {
    if (!this.siege) return {}
    for (const [id, gate] of this.siegeContext?.gates ?? []) this.siege.gateHealth[id] = gate.damageable.currentHp
    const actorHealth: NonNullable<ActiveCareerMission['actorHealth']> = {}
    const actorPositions: NonNullable<ActiveCareerMission['actorPositions']> = {}
    for (const npc of this.fieldNpcs) {
      const mount = npc.mount ?? this.actorMounts.get(npc)
      const mountHp = mount?.currentHp ?? this.active?.actorHealth?.[npc.combatantId]?.mountHp ?? (this.enemies.includes(npc) ? 0 : undefined)
      actorHealth[npc.combatantId] = { hp: npc.hp, ...(mountHp !== undefined ? { mountHp } : {}) }
      actorPositions[npc.combatantId] = { x: npc.combatPosition.x, z: npc.combatPosition.z, yaw: npc.group.rotation.y }
    }
    const player = this.player()
    return { ...(this.assault ? { friendlyActorIds: [...this.siege.attackerIds] } : { targetActorIds: [...this.siege.attackerIds] }), siege: { ...this.siege, attackerIds: [...this.siege.attackerIds], claimedSquadIds: [...this.siege.claimedSquadIds], destroyedGateIds: [...this.siege.destroyedGateIds], releasedReserveGateIds: [...this.siege.releasedReserveGateIds], crossedActorIds: [...this.siege.crossedActorIds], gateHealth: { ...this.siege.gateHealth }, playerPosition: { x: player.combatPosition.x, z: player.combatPosition.z, yaw: player.group.rotation.y } }, actorHealth, actorPositions, playerHp: player.hp, playerStamina: player.staminaValue }
  }

  private anchorVector(key: keyof typeof TOWN_DEFENSE_LAYOUT): THREE.Vector3 {
    const anchor = TOWN_DEFENSE_LAYOUT[key]
    return this.withTerrain(new THREE.Vector3(anchor.x, 0, anchor.z))
  }

  private withTerrain(point: THREE.Vector3): THREE.Vector3 {
    point.y = getTerrainHeight(point.x, point.z)
    return point
  }

  private walkable(point: THREE.Vector3, occupied: { point: THREE.Vector3; spacing: number }[], spacing: number): THREE.Vector3 {
    const grid = this.navigation.grid
    const inside = insideSiegeTown(point)
    for (const radius of [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32]) {
      for (let step = 0; step < (radius === 0 ? 1 : 12); step++) {
        const angle = step * Math.PI / 6
        const candidate = new THREE.Vector3(point.x + Math.sin(angle) * radius, 0, point.z + Math.cos(angle) * radius)
        const cell = grid.findNearestWalkableCell(candidate, 2)
        if (!cell) continue
        const snapped = grid.cellToWorld(cell)
        if (insideSiegeTown(snapped) !== inside || Math.abs(snapped.x) > 345 || Math.abs(snapped.z) > 345) continue
        if (this.siegeContext?.obstacles.some(obstacle => overlapsGateClosure(obstacle.navigationBox ?? obstacle.box, snapped, spacing >= 4 ? 1.5 : .55))) continue
        if (occupied.some(other => snapped.distanceToSquared(other.point) < ((spacing + other.spacing) / 2) ** 2)) continue
        const result = this.withTerrain(snapped)
        occupied.push({ point: result, spacing })
        return result
      }
    }
    const fallback = grid.findNearestWalkableCell(point, 16)
    const result = this.withTerrain(fallback ? grid.cellToWorld(fallback) : point)
    occupied.push({ point: result, spacing })
    return result
  }

  private disposeEnemies(): void {
    for (const off of this.gateListeners.splice(0)) off()
    this.actorMounts.clear()
    this.tracker?.dispose(); this.tracker = null
    for (const enemy of this.enemies) enemy.dispose()
    for (const mount of this.enemyMounts) mount.dispose()
    this.enemies.length = 0; this.enemyMounts.length = 0; this.attackGroups = []
    this.checkpoint.reset()
  }

  dispose(): void { this.disposeEnemies(); this.guide.dispose() }
}
