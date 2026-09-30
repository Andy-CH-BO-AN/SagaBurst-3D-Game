import * as THREE from 'three'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream } from '../combat/CombatAttribution'
import type { Player } from '../player/Player'
import { getTerrainHeight } from '../world/Terrain'
import { Mount, MountType } from '../world/Mount'
import { AIType, Faction, NPC } from '../world/NPC'
import type { TownActorSpec } from '../town/TownRules'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { acceptsCareerMissionStat, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { MissionGuide } from './MissionGuide'
import {
  TOWN_DEFENSE_ATTACK_GROUPS,
  TOWN_DEFENSE_LAYOUT,
  TOWN_DEFENSE_PREPARATION_SECONDS,
  civilianShelterSlots,
  createTownDefenseGroups,
  formationSlots,
  resolveTownDefenseOutcome,
  shouldChargeReserve,
  shouldFallback,
  townDefenseFailureLocked,
  type TownDefenseGroupId,
} from './TownDefenseState'

export interface TownDefenseResident { spec: TownActorSpec; npc: NPC }
interface RuntimeGroup { id: TownDefenseGroupId; members: NPC[]; fallbackApplied: boolean }
interface RuntimeAttackGroup { id: string; delaySeconds: number; members: NPC[]; released: boolean }

export class TownDefenseController {
  readonly events = new CombatEventStream()
  readonly guide = new MissionGuide()
  readonly enemies: NPC[] = []
  readonly enemyMounts: Mount[] = []
  readonly groups: RuntimeGroup[] = []
  private attackGroups: RuntimeAttackGroup[] = []
  private tracker: BattleStatsTracker | null = null
  private preparationStarted = false
  private preparationElapsed = 0
  private attackElapsed = 0
  private reserveCharged = false
  private combatOrdersIssued = false
  private commandId = 100_000
  private statsCheckpointElapsed = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly residents: readonly TownDefenseResident[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
  ) {}

  get active(): ActiveCareerMission | undefined {
    const mission = this.readProfile().activeMission
    return mission?.kind === 'town-defense' ? mission : undefined
  }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get defenders(): NPC[] { return this.groups.flatMap(group => group.members) }
  get civilians(): NPC[] { return this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.npc) }
  get captain(): NPC | null { return this.residents.find(resident => resident.spec.role === 'captain')?.npc ?? null }
  get releasedEnemies(): NPC[] { return this.attackGroups.filter(group => group.released).flatMap(group => group.members) }
  get fieldNpcs(): NPC[] { return [...this.defenders, ...(this.captain ? [this.captain] : []), ...this.civilians, ...this.releasedEnemies] }
  get remainingEnemies(): number { return this.enemies.filter(enemy => !enemy.dead).length }
  get civilianDeaths(): number { return this.civilians.filter(civilian => civilian.dead).length }
  get civilianSurvived(): number { return this.civilians.length - this.civilianDeaths }
  get servicesLocked(): boolean { return Boolean(this.active && this.phase !== 'RESULT' && this.phase !== 'RESET') }
  get preparationRemaining(): number { return Math.max(0, TOWN_DEFENSE_PREPARATION_SECONDS - this.preparationElapsed) }

  startActiveMission(): boolean {
    const active = this.active
    if (!active || active.result) return false
    this.disposeEnemies()
    const plans = createTownDefenseGroups(this.residents.map(resident => resident.spec))
    const byId = new Map(this.residents.map(resident => [resident.spec.id, resident.npc]))
    if (plans.some(plan => plan.actorIds.length !== 10 || plan.actorIds.some(id => !byId.has(id)))) return false
    this.groups.length = 0
    for (const plan of plans) this.groups.push({ id: plan.id, members: plan.actorIds.map(id => byId.get(id)!), fallbackApplied: false })
    const deadFriendlies = new Set(active.deadFriendlyActorIds ?? [])
    const deadCivilians = new Set(active.deadCivilianActorIds ?? [])
    for (const resident of this.residents) {
      if ((deadFriendlies.has(resident.spec.id) || deadCivilians.has(resident.spec.id)) && !resident.npc.dead) resident.npc.takeDamage(999999)
    }
    this.spawnAttackers(active)
    this.tracker = new BattleStatsTracker(this.events, false, event => acceptsCareerMissionStat(active, event), active.playerStats)
    this.prepareDeployment()
    this.preparationStarted = active.phase !== 'PREPARING'
    this.preparationElapsed = 0
    this.attackElapsed = active.defenseElapsed ?? 0
    this.reserveCharged = false
    this.combatOrdersIssued = false
    if (active.phase !== 'PREPARING') {
      this.beginAttack()
      if (this.attackElapsed >= 4) this.issueCombatOrders()
      for (const group of this.attackGroups) if (this.attackElapsed >= group.delaySeconds) this.releaseAttackGroup(group)
    }
    return true
  }

  updateFlow(dt: number, cameraYaw: number): void {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.phase === 'RESET') { this.guide.hide(); return }
    const rally = this.anchorVector('playerRallyPoint')
    this.statsCheckpointElapsed += Math.max(0, dt)
    if (active.phase === 'PREPARING') {
      if (this.player().combatPosition.distanceTo(rally) <= 8) this.preparationStarted = true
      if (this.preparationStarted) this.preparationElapsed += dt
      if (this.preparationElapsed >= TOWN_DEFENSE_PREPARATION_SECONDS && this.deploymentReady() && this.setPhase('ATTACKING')) this.beginAttack()
    } else {
      this.attackElapsed += dt
      if (!this.combatOrdersIssued && this.attackElapsed >= 4) this.issueCombatOrders()
      for (const group of this.attackGroups) if (!group.released && this.attackElapsed >= group.delaySeconds) this.releaseAttackGroup(group)
      this.updateScriptedDefense()
      if (townDefenseFailureLocked(this.civilianDeaths) && active.phase !== 'FAILURE_LOCKED') this.setPhase('FAILURE_LOCKED')
      else if (this.remainingEnemies === 0 && active.phase !== 'VICTORY_LOCKED') this.setPhase('VICTORY_LOCKED')
    }
    this.persistRuntimeProgress()
    this.guide.updateTownDefense(this.phase ?? active.phase, this.player().combatPosition, cameraYaw, rally, this.remainingEnemies, this.civilianDeaths, this.preparationRemaining)
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.result || active.phase === 'PREPARING' || active.phase === 'RESULT') return null
    const expectedIds = new Set(active.targetActorIds)
    const accountedIds = new Set([
      ...this.enemies.map(enemy => enemy.combatantId),
      ...(active.deadTargetActorIds ?? []),
    ])
    const registrationComplete = expectedIds.size === 50 && [...expectedIds].every(id => accountedIds.has(id))
    return resolveTownDefenseOutcome(playerDead, this.civilianDeaths, registrationComplete, this.remainingEnemies)
  }

  snapshot(): BattleStatsSnapshot {
    return this.tracker?.snapshot(this.fieldNpcs, this.player()) ?? {
      player: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: !this.player().dead },
      squads: [],
    }
  }

  peersFor(npc: NPC): NPC[] {
    if (npc.faction === Faction.ENEMY) {
      const insideTown = npc.combatPosition.distanceTo(this.anchorVector('townCenter')) < 45
      return [...this.defenders, ...(this.captain && !this.captain.dead ? [this.captain] : []), ...(insideTown ? this.civilians : [])]
    }
    return this.releasedEnemies
  }

  cleanupMission(): void {
    this.disposeEnemies()
    this.groups.length = 0
    this.preparationStarted = false
    this.preparationElapsed = 0
    this.attackElapsed = 0
    this.reserveCharged = false
    this.combatOrdersIssued = false
    this.guide.hide()
  }

  private prepareDeployment(): void {
    const plans = createTownDefenseGroups(this.residents.map(resident => resident.spec))
    for (const plan of plans) {
      const runtime = this.groups.find(group => group.id === plan.id)!
      const anchor = TOWN_DEFENSE_LAYOUT[plan.anchor]
      const leader = runtime.members[0]
      leader.assignFormationTarget(this.commandId++, this.anchorVector(plan.anchor), new THREE.Vector3(anchor.facingX, 0, anchor.facingZ))
      for (let index = 1; index < runtime.members.length; index++) runtime.members[index].assignFollowTarget(leader, index - 1)
    }
    const shelters = civilianShelterSlots(this.civilians.length)
    this.civilians.forEach((civilian, index) => civilian.assignFormationTarget(this.commandId++, this.withTerrain(shelters[index]), new THREE.Vector3(0, 0, 1)))
    this.captain?.assignFormationTarget(this.commandId++, this.anchorVector('cavalryReserve'), new THREE.Vector3(0, 0, 1))
  }

  private beginAttack(): void {
    const plans = createTownDefenseGroups(this.residents.map(resident => resident.spec))
    for (const plan of plans) {
      const runtime = this.groups.find(group => group.id === plan.id)!
      const anchor = TOWN_DEFENSE_LAYOUT[plan.anchor]
      const slots = formationSlots(anchor, runtime.members.length, plan.mounted)
      runtime.members.forEach((member, index) => member.assignFormationTarget(this.commandId++, this.withTerrain(slots[index]), new THREE.Vector3(anchor.facingX, 0, anchor.facingZ)))
    }
    this.captain?.setTacticalOrder('defend')
    this.releaseAttackGroup(this.attackGroups[0])
  }

  private updateScriptedDefense(): void {
    const south = this.groups.find(group => group.id === 'A')!
    const west = this.groups.find(group => group.id === 'B')!
    const frontlineContact = this.releasedEnemies.some(enemy => !enemy.dead && (
      south.members.some(defender => !defender.dead && defender.combatPosition.distanceTo(enemy.combatPosition) < 8)
      || west.members.some(defender => !defender.dead && defender.combatPosition.distanceTo(enemy.combatPosition) < 8)
    ))
    const enemiesInside = this.releasedEnemies.filter(enemy => !enemy.dead && enemy.combatPosition.distanceTo(this.anchorVector('townCenter')) < 62).length
    const southBreached = this.releasedEnemies.some(enemy => !enemy.dead && enemy.combatPosition.z < 47 && Math.abs(enemy.combatPosition.x) < 38)
    const westBreached = this.releasedEnemies.some(enemy => !enemy.dead && enemy.combatPosition.x > -54 && Math.abs(enemy.combatPosition.z - 18) < 34)
    if (shouldChargeReserve(this.reserveCharged, frontlineContact, southBreached || westBreached, enemiesInside)) {
      this.reserveCharged = true
      for (const member of this.groups.find(group => group.id === 'E')!.members) member.setTacticalOrder('charge')
    }
    for (const [front, ranged, breached, fallbackKey] of [
      ['A', 'C', southBreached, 'inner-south'],
      ['B', 'D', westBreached, 'inner-west'],
    ] as const) {
      const frontline = this.groups.find(group => group.id === front)!
      if (!frontline.fallbackApplied && shouldFallback(frontline.members.filter(npc => !npc.dead).length, breached)) {
        this.applyFallback(frontline, fallbackKey)
        this.applyFallback(this.groups.find(group => group.id === ranged)!, fallbackKey)
      }
    }
  }

  private issueCombatOrders(): void {
    this.combatOrdersIssued = true
    for (const group of this.groups) {
      const order = group.id === 'F' ? 'attack' : 'defend'
      for (const member of group.members) member.setTacticalOrder(order)
    }
    this.captain?.setTacticalOrder('defend')
  }

  private deploymentReady(): boolean {
    const plans = createTownDefenseGroups(this.residents.map(resident => resident.spec))
    const groupsReady = plans.every(plan => {
      const runtime = this.groups.find(group => group.id === plan.id)!
      const anchor = this.anchorVector(plan.anchor)
      return runtime.members.filter(member => !member.dead && member.combatPosition.distanceTo(anchor) <= 18).length >= 7
    })
    const shelter = this.anchorVector('civilianShelter')
    const civiliansReady = this.civilians.filter(civilian => !civilian.dead && civilian.combatPosition.distanceTo(shelter) <= 12).length >= 16
    return groupsReady && civiliansReady
  }

  private applyFallback(group: RuntimeGroup, key: 'inner-south' | 'inner-west' | 'inner-east'): void {
    if (group.fallbackApplied) return
    group.fallbackApplied = true
    const centers = { 'inner-south': new THREE.Vector3(0, 0, 18), 'inner-west': new THREE.Vector3(-18, 0, 1), 'inner-east': new THREE.Vector3(18, 0, 1) }
    const center = centers[key]
    const angleBase = key === 'inner-south' ? 0 : key === 'inner-west' ? Math.PI / 2 : -Math.PI / 2
    const living = group.members.filter(member => !member.dead)
    living.forEach((member, index) => {
      const angle = angleBase + (index - (living.length - 1) / 2) * .13
      const target = center.clone().add(new THREE.Vector3(Math.sin(angle) * 4, 0, Math.cos(angle) * 4))
      member.assignFormationTarget(this.commandId++, this.withTerrain(target), center.clone().negate().normalize())
    })
  }

  private spawnAttackers(active: ActiveCareerMission): void {
    const enemyFaction = this.readProfile().faction === 'roman' ? 'viking' : 'roman'
    let actorIndex = 0
    this.attackGroups = TOWN_DEFENSE_ATTACK_GROUPS.map((group, groupIndex) => {
      const members: NPC[] = []
      const kinds = (['melee', 'lancer', 'horse-archer'] as const).flatMap(kind => Array.from({ length: group.composition[kind] }, () => kind))
      const anchor = TOWN_DEFENSE_LAYOUT[group.approach]
      for (let index = 0; index < kinds.length; index++) {
        const kind = kinds[index]
        const presetId = `${enemyFaction}_${kind === 'melee' ? 'sword_cavalry' : kind === 'lancer' ? 'lancer' : 'horse_archer'}` as UnitPresetId
        const x = anchor.x + (index % 5 - 2) * 5 + groupIndex * .7
        const z = anchor.z + Math.floor(index / 5) * 6
        const actorId = active.targetActorIds[actorIndex++]
        if ((active.deadTargetActorIds ?? []).includes(actorId)) continue
        const npc = new NPC(this.scene, x, z, Faction.ENEMY, enemyFaction, kind === 'horse-archer' ? AIType.RANGED : AIType.MELEE, `Raider ${actorIndex}`, 2, true, { ...UNIT_PRESETS[presetId].tierLoadouts[2] }, presetId, undefined, actorId, this.events.emit)
        npc.respawnEnabled = false
        const mount = new Mount(this.scene, MountType.HORSE, x, z)
        npc.mountVehicle(mount)
        npc.setTacticalOrder('defend')
        this.enemies.push(npc); this.enemyMounts.push(mount); members.push(npc)
      }
      return { id: group.id, delaySeconds: group.delaySeconds, members, released: false }
    })
  }

  private releaseAttackGroup(group?: RuntimeAttackGroup): void {
    if (!group || group.released) return
    group.released = true
    for (const enemy of group.members) enemy.setTacticalOrder('charge')
  }

  private setPhase(phase: CareerMissionPhase): boolean {
    const active = this.active
    if (!active || active.phase === phase) return true
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, phase, defenseElapsed: this.attackElapsed, playerStats: this.tracker?.checkpoint() ?? active.playerStats, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds], civilianActorIds: [...(active.civilianActorIds ?? [])] }
    const saved = this.commit(profile)
    if (saved) this.statsCheckpointElapsed = 0
    return saved
  }

  private persistRuntimeProgress(): void {
    const active = this.active
    if (!active || active.result) return
    const deadTargets = new Set(active.deadTargetActorIds ?? [])
    for (const enemy of this.enemies) if (enemy.dead) deadTargets.add(enemy.combatantId)
    const deadFriendlies = this.defenders.filter(npc => npc.dead).map(npc => npc.combatantId).sort()
    if (this.captain?.dead) deadFriendlies.push(this.captain.combatantId)
    deadFriendlies.sort()
    const deadCivilians = this.civilians.filter(npc => npc.dead).map(npc => npc.combatantId).sort()
    const targetIds = [...deadTargets].filter(id => active.targetActorIds.includes(id)).sort()
    const playerStats = this.tracker?.checkpoint() ?? active.playerStats
    const statsChanged = JSON.stringify(playerStats) !== JSON.stringify(active.playerStats)
    const statsCheckpointReached = statsChanged && this.statsCheckpointElapsed >= 5
    const same = targetIds.join('|') === [...(active.deadTargetActorIds ?? [])].sort().join('|')
      && deadFriendlies.join('|') === [...(active.deadFriendlyActorIds ?? [])].sort().join('|')
      && deadCivilians.join('|') === [...(active.deadCivilianActorIds ?? [])].sort().join('|')
      && Math.abs((active.defenseElapsed ?? 0) - this.attackElapsed) < 1
    if (same && !statsCheckpointReached) return
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, deadTargetActorIds: targetIds, deadFriendlyActorIds: deadFriendlies, deadCivilianActorIds: deadCivilians, defenseElapsed: this.attackElapsed, ...(playerStats ? { playerStats } : {}) }
    if (this.commit(profile)) this.statsCheckpointElapsed = 0
  }

  private anchorVector(key: keyof typeof TOWN_DEFENSE_LAYOUT): THREE.Vector3 {
    const anchor = TOWN_DEFENSE_LAYOUT[key]
    return this.withTerrain(new THREE.Vector3(anchor.x, 0, anchor.z))
  }

  private withTerrain(point: THREE.Vector3): THREE.Vector3 {
    point.y = getTerrainHeight(point.x, point.z)
    return point
  }

  private disposeEnemies(): void {
    this.tracker?.dispose(); this.tracker = null
    for (const enemy of this.enemies) enemy.dispose()
    for (const mount of this.enemyMounts) mount.dispose()
    this.enemies.length = 0; this.enemyMounts.length = 0; this.attackGroups = []
    this.statsCheckpointElapsed = 0
  }

  dispose(): void { this.disposeEnemies(); this.guide.dispose() }
}
