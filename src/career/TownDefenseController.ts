import * as THREE from 'three'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { BattleStatsTracker, type BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { CombatEventStream } from '../combat/CombatAttribution'
import type { Player } from '../player/Player'
import { getTerrainHeight } from '../world/Terrain'
import { ASSAULT_PREPARATION_SECONDS, createAssaultRoster, resolveAssaultOutcome } from './EnemyTownAssault'
import { civilianShouldFight, civilianWartimeWeapon, townWartimePeers } from '../town/TownWartime'
import { Mount, MountType, mountTypeFromId } from '../world/Mount'
import { AIType, Faction, NPC } from '../world/NPC'
import type { TownActorSpec } from '../town/TownRules'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { acceptsCareerMissionStat, type ActiveCareerMission, type CareerMissionOutcome, type CareerMissionPhase } from './CareerMissionState'
import { MissionGuide } from './MissionGuide'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import {
  townDefenseAttackGroups,
  TOWN_DEFENSE_LAYOUT,
  TOWN_DEFENSE_PREPARATION_SECONDS,
  civilianShelterSlots,
  concentricDefenseSlots,
  createTownDefenseGroups,
  formationSlots,
  resolveTownDefenseOutcome,
  townDefenseFailureLocked,
  type TownDefenseGroupId,
} from './TownDefenseState'

export interface TownDefenseResident { spec: TownActorSpec; npc: NPC }
interface RuntimeGroup { id: TownDefenseGroupId; members: NPC[] }
interface RuntimeAttackGroup { id: string; members: NPC[]; released: boolean }

/** Shared Town war runtime: resident defense, civilian shelter behavior and faction peers.
 * In assault, the spawned army is friendly; objectives still count resident military only.
 */
export class TownDefenseController {
  onAssaultAttackStarted?: () => void
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
  private statsCheckpointElapsed = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly residents: readonly TownDefenseResident[],
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly blackCat: Mount,
    private readonly navigation: NavigationWorld,
  ) {}

  get active(): ActiveCareerMission | undefined {
    const mission = this.readProfile().activeMission
    return mission?.kind === 'town-defense' || mission?.kind === 'enemy-town-assault' ? mission : undefined
  }
  get assault(): boolean { return this.active?.kind === 'enemy-town-assault' }
  get military(): NPC[] { return [...this.defenders, this.captain, this.ranger, this.sergeant].filter((npc): npc is NPC => Boolean(npc)) }
  get playerEnemies(): NPC[] { return this.fieldNpcs.filter(npc => npc.faction === Faction.ENEMY) }
  get preparationSeconds(): number { return this.assault ? ASSAULT_PREPARATION_SECONDS : TOWN_DEFENSE_PREPARATION_SECONDS }
  get phase(): CareerMissionPhase | null { return this.active?.phase ?? null }
  get defenders(): NPC[] { return this.groups.flatMap(group => group.members) }
  get civilians(): NPC[] { return this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.npc) }
  get captain(): NPC | null { return this.residents.find(resident => resident.spec.role === 'captain')?.npc ?? null }
  get ranger(): NPC | null { return this.residents.find(resident => resident.spec.role === 'ranger')?.npc ?? null }
  get sergeant(): NPC | null { return this.residents.find(resident => resident.spec.role === 'deployment')?.npc ?? null }
  get releasedEnemies(): NPC[] { return this.attackGroups.filter(group => group.released).flatMap(group => group.members) }
  get waitingEnemies(): NPC[] { return this.attackGroups.filter(group => !group.released).flatMap(group => group.members) }
  get fieldNpcs(): NPC[] { return [...this.defenders, ...(this.captain ? [this.captain] : []), ...(this.ranger ? [this.ranger] : []), ...(this.sergeant ? [this.sergeant] : []), ...this.civilians, ...this.releasedEnemies] }
  get remainingEnemies(): number { return this.enemies.filter(enemy => !enemy.dead).length }
  get civilianDeaths(): number { return this.civilians.filter(civilian => civilian.dead).length }
  get civilianSurvived(): number { return this.civilians.length - this.civilianDeaths }
  get servicesLocked(): boolean { return Boolean(this.active && this.phase !== 'RESULT' && this.phase !== 'RESET') }
  get preparationRemaining(): number { return Math.max(0, this.preparationSeconds - this.preparationElapsed) }
  get reserveHasCharged(): boolean { return this.reserveCharged }

  startActiveMission(): boolean {
    const active = this.active
    if (!active || active.result) return false
    this.disposeEnemies()
    this.civilianCombat.clear()
    const plans = createTownDefenseGroups(this.residents.map(resident => resident.spec))
    const byId = new Map(this.residents.map(resident => [resident.spec.id, resident.npc]))
    if (plans.some(plan => plan.actorIds.length !== 10 || plan.actorIds.some(id => !byId.has(id)))) return false
    this.groups.length = 0
    for (const plan of plans) this.groups.push({ id: plan.id, members: plan.actorIds.map(id => byId.get(id)!) })
    if (this.assault && (active.friendlyActorIds.length !== 89 || new Set(active.friendlyActorIds).size !== 89
      || active.targetActorIds.length !== 63 || this.military.some(npc => !active.targetActorIds.includes(npc.combatantId))
      || active.civilianActorIds?.length !== 20)) return false
    const deadFriendlies = new Set(this.assault ? active.deadTargetActorIds ?? [] : active.deadFriendlyActorIds ?? [])
    const deadCivilians = new Set(active.deadCivilianActorIds ?? [])
    for (const resident of this.residents) {
      if ((deadFriendlies.has(resident.spec.id) || deadCivilians.has(resident.spec.id)) && !resident.npc.dead) resident.npc.takeDamage(999999)
    }
    if (active.defenseCatDead && !this.blackCat.dead) this.blackCat.takeDamage(999999)
    if (this.blackCat.dead && this.ranger?.mount === this.blackCat) this.ranger.dismountFromMount()
    if (this.assault) this.spawnAssaultArmy(active)
    else this.spawnAttackers(active)
    this.tracker = new BattleStatsTracker(this.events, this.assault, event => acceptsCareerMissionStat(active, event), active.playerStats)
    this.prepareDeployment()
    this.preparationElapsed = active.defensePreparationElapsed ?? 0
    this.attackElapsed = active.defenseElapsed ?? 0
    this.reserveCharged = active.defenseReserveCharged === true
      || Boolean(this.captain && deadFriendlies.has(this.captain.combatantId))
      || Boolean(this.ranger && deadFriendlies.has(this.ranger.combatantId))
      || Boolean(this.sergeant && deadFriendlies.has(this.sergeant.combatantId))
      || this.defenders.some(defender => deadFriendlies.has(defender.combatantId))
    if (active.phase !== 'PREPARING') {
      this.beginAttack()
    }
    return true
  }

  updateFlow(dt: number, cameraYaw: number): void {
    const active = this.active
    if (!active || active.phase === 'RESULT' || active.phase === 'RESET') { this.guide.hide(); return }
    if (this.blackCat.dead && this.ranger?.mount === this.blackCat) this.ranger.dismountFromMount()
    const rally = this.anchorVector('playerRallyPoint')
    this.statsCheckpointElapsed += Math.max(0, dt)
    if (active.phase === 'PREPARING') {
      this.preparationElapsed += dt
      if (this.preparationElapsed >= this.preparationSeconds && this.setPhase('ATTACKING')) {
        this.beginAttack()
        if (this.assault) this.onAssaultAttackStarted?.()
      }
    } else if (!this.assault) {
      this.attackElapsed += dt
      if (townDefenseFailureLocked(this.civilianDeaths) && active.phase !== 'FAILURE_LOCKED') this.setPhase('FAILURE_LOCKED')
      else if (!townDefenseFailureLocked(this.civilianDeaths) && this.remainingEnemies === 0 && active.phase !== 'VICTORY_LOCKED') this.setPhase('VICTORY_LOCKED')
    }
    this.persistRuntimeProgress()
    if (!this.assault) this.guide.updateTownDefense(this.phase ?? active.phase, this.player().combatPosition, cameraYaw, rally, this.remainingEnemies, this.civilianDeaths, this.preparationRemaining)
  }

  evaluate(playerDead: boolean): CareerMissionOutcome | null {
    const active = this.active
    if (!active || active.result || active.phase === 'RESULT') return null
    if (this.assault) {
      if (this.military.length !== 63 || new Set([...this.enemies.map(npc => npc.combatantId), ...(active.deadFriendlyActorIds ?? [])]).size !== 89) return null
      return resolveAssaultOutcome(playerDead, this.military.filter(npc => !npc.dead).length, this.enemies.filter(npc => !npc.dead).length)
    }
    const expectedIds = new Set(active.targetActorIds)
    const accountedIds = new Set([
      ...this.enemies.map(enemy => enemy.combatantId),
      ...(active.deadTargetActorIds ?? []),
    ])
    const registrationComplete = (expectedIds.size === 50 || expectedIds.size === 70) && [...expectedIds].every(id => accountedIds.has(id))
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
      const slot = civilianShelterSlots(this.civilians.length)[this.civilians.indexOf(npc)]
      const point = this.walkable(slot, [], 1.8)
      npc.assignFormationTarget(this.commandId++, point, new THREE.Vector3(0, 0, 1))
    }
  }

  cleanupMission(): void {
    this.disposeEnemies()
    this.groups.length = 0
    this.civilianCombat.clear()
    this.preparationElapsed = 0
    this.attackElapsed = 0
    this.reserveCharged = false
    this.guide.hide()
  }

  private prepareDeployment(): void {
    for (const npc of this.military) npc.beginExternalThreat()
    const byGroup = (id: TownDefenseGroupId) => this.groups.find(group => group.id === id)?.members ?? []
    const occupied: { point: THREE.Vector3; spacing: number }[] = []
    const place = (point: THREE.Vector3, spacing: number) => this.walkable(point, occupied, spacing)
    const melee = [...byGroup('A'), ...byGroup('B'), ...(this.sergeant ? [this.sergeant] : [])]
    const ranged = [...byGroup('C'), ...byGroup('D')]
    const screen = byGroup('F')
    const assignRing = (members: NPC[], radii: number[], phase: number) => {
      const slots = concentricDefenseSlots(members.length, radii, phase)
      members.forEach((member, index) => {
        const slot = place(slots[index], member.isMounted ? 5 : 2.2)
        const facing = slot.clone().sub(this.anchorVector('townCenter')).setY(0).normalize()
        if (this.assault) this.positionNpc(member, slot, facing)
        member.assignFormationTarget(this.commandId++, slot, facing, undefined, 'defend')
      })
    }
    assignRing(ranged, [12.5, 16], .12)
    assignRing(melee, [21, 25], .28)
    assignRing(screen, [30, 35], .48)
    const reserve = byGroup('E')
    const reserveSlots = formationSlots(TOWN_DEFENSE_LAYOUT.cavalryReserve, reserve.length, true)
    reserve.forEach((member, index) => {
      const point = place(reserveSlots[index], 5), facing = new THREE.Vector3(0, 0, 1)
      if (this.assault) this.positionNpc(member, point, facing)
      member.assignFormationTarget(this.commandId++, point, facing, undefined, 'defend')
    })
    const shelters = civilianShelterSlots(this.civilians.length)
    this.civilians.forEach((civilian, index) => civilian.assignFormationTarget(this.commandId++, place(shelters[index], 1.8), new THREE.Vector3(0, 0, 1)))
    if (this.captain) {
      const point = place(concentricDefenseSlots(1, [18], 2.5)[0], 5), facing = new THREE.Vector3(0, 0, 1)
      if (this.assault) this.positionNpc(this.captain, point, facing)
      this.captain.assignFormationTarget(this.commandId++, point, facing, undefined, 'defend')
    }
    if (this.ranger && !this.ranger.dead) {
      if (!this.blackCat.dead && this.ranger.mount !== this.blackCat) this.ranger.mountVehicle(this.blackCat)
      if (!this.blackCat.dead) this.blackCat.catVisual?.setEquipmentVisible(true)
      const flank = TOWN_DEFENSE_LAYOUT.rangerFlank
      const point = place(this.anchorVector('rangerFlank'), this.blackCat.dead ? 2.2 : 5), facing = new THREE.Vector3(flank.facingX, 0, flank.facingZ)
      if (this.assault) this.positionNpc(this.ranger, point, facing)
      this.ranger.assignFormationTarget(this.commandId++, point, facing, undefined, 'defend')
    }
  }

  private beginAttack(): void {
    if (this.assault) {
      for (const npc of this.enemies) if (!npc.dead) npc.setTacticalOrder('attack')
      return
    }
    if (this.reserveCharged) this.issueCombatOrders()
    for (const group of this.attackGroups) this.releaseAttackGroup(group)
  }

  noteEffectiveFriendlyDamage(target: NPC): void {
    if (this.assault) return
    if ((this.phase !== 'ATTACKING' && this.phase !== 'FAILURE_LOCKED') || this.reserveCharged
      || !(target === this.captain || target === this.ranger || target === this.sergeant || this.groups.some(group => group.members.includes(target)))) return
    this.reserveCharged = true
    this.issueCombatOrders()
    this.persistRuntimeProgress()
  }

  private issueCombatOrders(): void {
    for (const group of this.groups) {
      const order = group.id === 'E' ? 'charge' : 'attack'
      for (const member of group.members) if (!member.dead) member.setTacticalOrder(order)
    }
    for (const actor of [this.captain, this.ranger, this.sergeant]) if (actor && !actor.dead) actor.setTacticalOrder('attack')
  }

  private positionNpc(npc: NPC, point: THREE.Vector3, facing: THREE.Vector3): void {
    npc.group.position.copy(point)
    npc.group.rotation.y = Math.atan2(facing.x, facing.z)
    if (npc.mount) { npc.mount.group.position.copy(point); npc.mount.group.rotation.y = npc.group.rotation.y }
  }

  private spawnAssaultArmy(active: ActiveCareerMission): void {
    const occupied: { point: THREE.Vector3; spacing: number }[] = []
    const facing = new THREE.Vector3(0, 0, -1)
    // Reserve Player's slot before NPC placement. Player has no AI controller.
    const playerPoint = this.walkable(new THREE.Vector3(-51, 0, 132), occupied, 7)
    this.player().group.position.copy(playerPoint).y += .9
    this.player().faceDirection(0, -1)
    createAssaultRoster(this.readProfile().faction).forEach((spec, index) => {
      const actorId = active.friendlyActorIds[index]
      if (active.deadFriendlyActorIds?.includes(actorId)) return
      const point = this.walkable(new THREE.Vector3(spec.x, 0, spec.z), occupied, spec.cavalry ? 7 : 3)
      const npc = new NPC(this.scene, point.x, point.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId, spec.squadId, actorId, this.events.emit, spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile)
      npc.respawnEnabled = false
      if (spec.loadout?.mountId) {
        const mount = new Mount(this.scene, mountTypeFromId(spec.loadout.mountId), point.x, point.z)
        npc.mountVehicle(mount); this.enemyMounts.push(mount)
      }
      this.positionNpc(npc, point, facing)
      npc.assignFormationTarget(this.commandId++, point, facing)
      this.enemies.push(npc)
    })
    this.attackGroups = [{ id: 'assault', members: this.enemies, released: true }]
  }

  private spawnAttackers(active: ActiveCareerMission): void {
    const enemyFaction = this.readProfile().faction === 'roman' ? 'viking' : 'roman'
    let actorIndex = 0
    this.attackGroups = townDefenseAttackGroups(active.targetActorIds.length).map((group, groupIndex) => {
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
      return { id: group.id, members, released: false }
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
    profile.activeMission = { ...active, phase, defenseElapsed: this.attackElapsed, defensePreparationElapsed: this.preparationElapsed, defenseReserveCharged: this.reserveCharged, defenseCatDead: this.blackCat.dead, playerStats: this.tracker?.checkpoint() ?? active.playerStats, targetActorIds: [...active.targetActorIds], friendlyActorIds: [...active.friendlyActorIds], civilianActorIds: [...(active.civilianActorIds ?? [])] }
    const saved = this.commit(profile)
    if (saved) this.statsCheckpointElapsed = 0
    return saved
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
    const targetIds = [...deadTargets].filter(id => active.targetActorIds.includes(id)).sort()
    const playerStats = this.tracker?.checkpoint() ?? active.playerStats
    const statsChanged = JSON.stringify(playerStats) !== JSON.stringify(active.playerStats)
    const statsCheckpointReached = statsChanged && (forceStats || this.statsCheckpointElapsed >= 5)
    const same = targetIds.join('|') === [...(active.deadTargetActorIds ?? [])].sort().join('|')
      && uniqueDeadFriendlies.join('|') === [...(active.deadFriendlyActorIds ?? [])].sort().join('|')
      && deadCivilians.join('|') === [...(active.deadCivilianActorIds ?? [])].sort().join('|')
      && Math.abs((active.defenseElapsed ?? 0) - this.attackElapsed) < 1
      && Math.abs((active.defensePreparationElapsed ?? 0) - this.preparationElapsed) < 1
      && Boolean(active.defenseReserveCharged) === this.reserveCharged
      && Boolean(active.defenseCatDead) === this.blackCat.dead
    const playerDead = this.player().dead
    if (same && !statsCheckpointReached && Boolean(active.playerDead) === playerDead) return
    const profile = cloneCareerProfile(this.readProfile())
    profile.activeMission = { ...active, playerDead, deadTargetActorIds: targetIds, deadFriendlyActorIds: uniqueDeadFriendlies, deadCivilianActorIds: deadCivilians, defenseElapsed: this.attackElapsed, defensePreparationElapsed: this.preparationElapsed, defenseReserveCharged: this.reserveCharged, defenseCatDead: this.blackCat.dead, ...(playerStats ? { playerStats } : {}) }
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

  private walkable(point: THREE.Vector3, occupied: { point: THREE.Vector3; spacing: number }[], spacing: number): THREE.Vector3 {
    const grid = this.navigation.grid
    for (const radius of [0, 2, 4, 6, 8, 10, 12]) {
      for (let step = 0; step < (radius === 0 ? 1 : 12); step++) {
        const angle = step * Math.PI / 6
        const candidate = new THREE.Vector3(point.x + Math.sin(angle) * radius, 0, point.z + Math.cos(angle) * radius)
        const cell = grid.findNearestWalkableCell(candidate, 2)
        if (!cell) continue
        const snapped = grid.cellToWorld(cell)
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
    this.tracker?.dispose(); this.tracker = null
    for (const enemy of this.enemies) enemy.dispose()
    for (const mount of this.enemyMounts) mount.dispose()
    this.enemies.length = 0; this.enemyMounts.length = 0; this.attackGroups = []
    this.statsCheckpointElapsed = 0
  }

  dispose(): void { this.disposeEnemies(); this.guide.dispose() }
}
