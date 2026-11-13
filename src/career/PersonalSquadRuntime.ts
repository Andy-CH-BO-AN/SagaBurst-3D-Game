import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import { generateFormationSlots } from '../battle/FormationMath'
import { registerPersonalCombatDisplayName } from '../ui/CombatTargetDisplayName'
import { assertNpcSpawnJob, gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch, type NpcSpawnScheduler } from '../world/NpcSpawnScheduler'
import type { TacticalOrder } from '../battle/TacticalOrder'
import * as THREE from 'three'
import { PERSONAL_SQUAD_ID } from '../battle/CommandTarget'
import { followLocalOffset } from '../battle/FollowOrder'
import { resolveCharacterIdentity } from '../combat/CharacterIdentity'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { prepareByzantineEquipment, preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CombatEventSink } from '../combat/CombatAttribution'
import type { Player } from '../player/Player'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { Mount } from '../world/Mount'
import { NPC, AIType, Faction } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import type { EagleLandingQueue } from '../world/EagleLandingQueue'
import { isEaglePadArrived } from '../world/EaglePadArrival'
import { legacyPersonalEquipment } from './CareerInventory'
import { careerEaglePadOwners, EaglePadReservations, type EaglePad } from './EaglePadReservations'
import { careerMountType } from './CareerMountController'
import { PERSONAL_SQUAD_LIMIT, type CareerPersonalSquadMember } from './CareerPersonalSquad'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { refitCommandActor, refitCommandCheckpoint, restoreShieldDurability, savedShieldDurability } from './CareerCommandActorCheckpoint'
import { snapshotPersonalMission, clonePersonalMission, preparePersonalMissionAcceptance, type PersonalActorCheckpoint, type PersonalActorPosition,
  type PersonalSquadMission, type PersonalSquadState } from './CareerPersonalSquadMission'

export type PersonalSquadSpawnSlot = PersonalActorPosition
export function personalMemberLoadout(member: CareerPersonalSquadMember, faction: CareerProfile['faction']) {
  const characterFaction = member.characterFaction ?? faction
  const characterTier = member.characterTier ?? (member.type === 'soldier' ? 2 : member.type === 'commander' ? 5 : 4)
  const identity = resolveCharacterIdentity({ characterFaction, characterTier,
    heroArchetype: member.heroArchetype ?? (member.type === 'soldier' ? undefined : member.type), visualAssetId: member.visualAssetId })
  if (member.type === 'ranger' && !member.equipment) throw new Error('Ranger equipment must be migrated and saved before deployment')
  const equipment = member.equipment ?? legacyPersonalEquipment(member.type, characterFaction)
  const primaryWeapon = WEAPONS[equipment.ranged ?? equipment.melee ?? '']
  // Select valid catalog metadata from actual equipment; the hero is always resolved from identity.
  const presets = characterFaction === 'roman'
    ? { melee: 'roman_heavy_infantry', spear: 'roman_spearman', ranged: 'roman_archer', mounted: 'roman_sword_cavalry', mountedRanged: 'roman_horse_archer' } as const
    : { melee: 'viking_berserker', spear: 'viking_spearman', ranged: 'viking_archer', mounted: 'viking_sword_cavalry', mountedRanged: 'viking_horse_archer' } as const
  const presetId: UnitPresetId = equipment.mount ? equipment.ranged ? presets.mountedRanged : presets.mounted
    : equipment.ranged ? presets.ranged : primaryWeapon?.combatKind === 'lance' ? presets.spear : presets.melee
  const hero = identity.heroArchetype ? { visualAssetId: identity.visualAssetId!, combatProfileId: identity.combatProfileId!,
    specialCombatProfile: identity.specialCombatProfile } : undefined
  return { presetId, identity, hero, characterTier: identity.characterTier,
    tier: identity.characterTier <= 3 ? Math.min(4, primaryWeapon?.tier ?? 1) as 1 | 2 | 3 | 4 : 4 as const,
    mounted: Boolean(equipment.mount), loadout: { meleeWeaponId: equipment.melee, rangedWeaponId: equipment.ranged, shieldId: equipment.shield, mountId: equipment.mount,
      ...(identity.heroArchetype === 'ranger' ? { reversibleRangedSwitch: true } : {}) } }
}

/** New hires can deploy after entering Town: prepare their assets before enqueueing materialization. */
export async function preloadPersonalSquadMember(member: CareerPersonalSquadMember, faction: CareerProfile['faction']): Promise<void> {
  const spec = personalMemberLoadout(member, faction)
  await Promise.all([HumanoidAssetRegistry.preload(), preloadHighTierEquipment(), preloadPaladinEquipment(),
    prepareByzantineEquipment([spec.loadout.meleeWeaponId, spec.loadout.shieldId]),
    ...(spec.hero ? [HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[spec.hero.visualAssetId].descriptor)] : []),
    ...(spec.loadout.rangedWeaponId === T4_RANGER_BOW_RANGED_ID ? [preloadMakiRangerBow()] : [])])
}

export function spawnPersonalSquadActor(scene: THREE.Scene, member: CareerPersonalSquadMember,
  faction: CareerProfile['faction'], slot: PersonalSquadSpawnSlot, emit?: CombatEventSink, boardingPad?: PersonalSquadSpawnSlot): { npc: NPC; mount?: Mount } {
  assertNpcSpawnJob()
  const spec = personalMemberLoadout(member, faction)
  const npc = trackNpcSpawn(new NPC(scene, slot.x, slot.z, Faction.PLAYER, spec.identity.characterFaction, spec.loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    member.type === 'soldier' ? 'Personal Soldier' : member.type === 'captain' ? 'Personal Captain' : member.type === 'commander' ? 'Personal Commander' : 'Personal Shadow Warden',
    spec.tier, spec.mounted, spec.loadout, spec.presetId, PERSONAL_SQUAD_ID, member.id, emit,
    spec.hero?.visualAssetId, spec.hero?.combatProfileId, spec.hero?.specialCombatProfile, undefined, undefined, undefined, undefined, spec.characterTier, spec.identity.heroArchetype))
  npc.enableBattlefieldEngagement()
  registerPersonalCombatDisplayName(npc, member, spec.identity.characterFaction)
  npc.combatOwnership = 'player-personal'
  npc.respawnEnabled = false
  npc.group.rotation.y = slot.yaw
  if (slot.y !== undefined) npc.group.position.y = slot.y
  if (!spec.mounted) return { npc }
  const mount = trackNpcSpawn(new Mount(scene, careerMountType(spec.loadout.mountId!), boardingPad?.x ?? slot.x, boardingPad?.z ?? slot.z, (boardingPad ?? slot).y, horseVariantForStableKey(`personal:${member.id}`)))
  mount.group.rotation.y = boardingPad?.yaw ?? slot.yaw; mount.reservedForTown = true
  if (!boardingPad) npc.mountVehicle(mount)
  return { npc, mount }
}

export interface PersonalSquadRuntimeOptions {
  scheduler?: NpcSpawnScheduler
  canRefit?: () => boolean
  sceneKey?: string
  hasHR?: boolean
  /** Validated outdoor pads; flying mounts never materialize in the HR courtyard. */
  eagleMuster?: readonly PersonalSquadSpawnSlot[]
  /** One shared allocator for Player and the private squad in this scene. */
  eaglePads?: EaglePadReservations
  /** Scene-owned automatic approach queue; permanent pad reservations remain independent. */
  eagleLandingQueue?: EagleLandingQueue
  eaglePadClear?(pad: PersonalSquadSpawnSlot, mount: Mount): boolean
  layoutVersion?: number
  emit?: CombatEventSink
  formationSlots?(anchor: PersonalActorPosition, occupied: readonly PersonalActorPosition[], count: number): PersonalActorPosition[]
  onSpawn?(npc: NPC, mount?: Mount): void
  onDispose?(npc: NPC, mount?: Mount): void
}

/** Owns personal membership and refit. The scene's common combat loop updates its actors. */
export class PersonalSquadRuntime {
  readonly actors: NPC[] = []
  readonly mounts: Mount[] = []
  state: PersonalSquadState = 'RESERVE'
  private mission?: PersonalSquadMission
  private battleWorn = false
  private readonly actorSet = new Set<NPC>()
  private readonly slots = new Map<NPC, PersonalSquadSpawnSlot>()
  private readonly memberMounts = new Map<string, Mount>()
  private readonly boarding = new Map<NPC, { pad: PersonalSquadSpawnSlot; index: number }>()
  private readonly returningOnFoot = new Set<NPC>()
  /** Eagle riders who walked home from the parked eagle during this return; never re-routed. */
  private readonly homeArrivals = new Set<NPC>()
  private readonly awaitingEaglePad = new Set<NPC>()
  private readonly approachingEagles = new Set<NPC>()
  private lastPlayerPosition?: PersonalActorPosition
  private returnCommand = -1000
  private readonly pending = new Map<string, NpcSpawnBatch>()
  private readonly batches: NpcSpawnBatch[] = []
  private command?: TacticalOrder
  private commandRevision = 0
  private spawnFailed = false
  /** HR standby materialization is not a deployment: its batches and failure stay separate. */
  private readonly standbyBatches = new Set<NpcSpawnBatch>()
  /** Only the failed IDs pause; later hires and the rest of HR standby keep materializing. */
  private readonly standbyFailures = new Map<string, unknown>()
  /** Members held at HR while the rest of the squad is deployed (later hires); not command recipients. */
  private readonly standbyIds = new Set<string>()
  /** Equipment each live actor materialized with; HR standby rebuilds an actor whose saved loadout changed. */
  private readonly spawnedLoadouts = new Map<string, string>()
  private readonly eaglePads: EaglePadReservations
  private readonly reservedEagleOwners = new Set<string>()
  /** Deployment failure only; an HR standby failure is `standbyError` and never blocks the Town. */
  get error(): unknown { return this.batches.find(batch => batch.status === 'failed')?.error }
  get standbyError(): unknown { return this.standbyFailures.values().next().value }
  get spawning(): boolean { return [...this.pending.values()].some(batch => batch.status === 'pending' && !this.standbyBatches.has(batch)) }
  get ready(): boolean { return !this.spawning && !this.spawnFailed }
  async waitForSpawns(): Promise<void> {
    for (const batch of this.batches) if (batch.status === 'pending' || batch.status === 'failed')
      await (this.options.scheduler ?? gameplayNpcSpawns).wait(batch)
  }

  constructor(private readonly scene: THREE.Scene, private muster: readonly PersonalSquadSpawnSlot[],
    private readonly read: () => CareerProfile, private readonly player: () => Player,
    private readonly spawn = spawnPersonalSquadActor, private readonly options: PersonalSquadRuntimeOptions = {}) {
    this.eaglePads = options.eaglePads ?? new EaglePadReservations((options.eagleMuster ?? []).map((pad, index) => ({
      ...pad, id: `private-eagle-pad:${index + 1}`,
    })))
  }

  owns(actor: NPC): boolean { return this.actorSet.has(actor) }
  /** HR standby (the whole RESERVE squad, or a later hire beside a deployed squad) only answers Follow. */
  isStandby(id: string): boolean { return this.hasHR && this.state === 'RESERVE' || this.standbyIds.has(id) }
  acceptsCommand(actor: NPC): boolean { return this.owns(actor) && !this.isStandby(actor.combatantId) }
  /** HUD-only views: expose the live accepted roster without checkpoint writes or spawning actors. */
  get hudMission(): Readonly<PersonalSquadMission> | undefined { return this.mission }
  get hudReturningIds(): readonly string[] {
    return this.state === 'RETURNING' ? this.actors.filter(actor => !actor.dead && !this.standbyIds.has(actor.combatantId)).map(actor => actor.combatantId) : []
  }
  get hudPendingIds(): readonly string[] {
    return [...this.pending].filter(([, batch]) => batch.status === 'pending' && !this.standbyBatches.has(batch)).map(([id]) => id)
  }
  get aliveCombatants(): number {
    return this.actors.filter(actor => !actor.dead).length + [...this.pending.keys()].filter(id => {
      if (this.pending.get(id)?.status !== 'pending') return false
      const saved = this.mission?.members[id]
      return saved?.status !== 'dead' && saved?.status !== 'exited' && saved?.hp !== 0
    }).length
  }
  get sceneKey(): string { return this.options.sceneKey ?? 'town-home' }
  get hasHR(): boolean { return this.options.hasHR !== false }
  /** Final retirement has no HR refit boundary: every live resource and casualty stays owned. */
  private get retirementResourcesLocked(): boolean {
    const phase = this.read().careerRetirement?.phase
    return phase === 'final-stand' || phase === 'completed'
  }
  setMuster(slots: readonly PersonalSquadSpawnSlot[], eaglePads?: readonly EaglePad[]): void {
    if (eaglePads) this.eaglePads.setPads(eaglePads)
    this.muster = slots
  }
  captureForMission(value: PersonalSquadMission): PersonalSquadMission {
    const previous = this.mission
    this.mission = clonePersonalMission(value)
    // A casualty or wounded reserve may have no materialized actor after reload.
    // Retain every owned checkpoint; live actors overwrite theirs below.
    const savedMembers = previous ? clonePersonalMission(previous).members : undefined
    for (const id of this.mission.memberIds) if (savedMembers?.[id]) this.mission.members[id] = savedMembers[id]
    try { return this.checkpoint()! }
    finally { this.mission = previous }
  }

  /** Stage a fresh roster without changing the live Town owner before storage succeeds.
   * Members already back at HR keep their live wounds: arrival is not a refit boundary. */
  captureForNewMission(value: PersonalSquadMission): PersonalSquadMission {
    return preparePersonalMissionAcceptance(this.captureForMission(value))
  }

  /** Adopt fresh acceptance only after saving; pending callbacks use the new command revision. */
  beginMission(value: PersonalSquadMission | undefined): void {
    if (value) {
      this.state = value.state
      this.command = 'defend'; this.commandRevision++
      this.returningOnFoot.clear(); this.awaitingEaglePad.clear(); this.homeArrivals.clear()
      // A formal mission deploys the whole roster, including later HR hires.
      this.deployStandby()
      for (const actor of this.actors) {
        this.releaseEagleApproach(actor)
        const saved = value.members[actor.combatantId]
        if (!saved || actor.dead) continue
        if (saved.status === 'reserve') refitCommandActor(actor, this.memberMounts.get(actor.combatantId))
        if (actor.mount?.isFlyingMount) actor.setEagleFlightOrder(null)
        actor.setTacticalOrder('defend')
        this.applyCommand(actor, value.memberIds.indexOf(actor.combatantId))
      }
    }
    this.bindMission(value)
  }

  bindMission(value: PersonalSquadMission | undefined): void {
    this.mission = value ? clonePersonalMission(value) : undefined
    if (value) for (const [id, batch] of this.pending) if (!value.memberIds.includes(id)) { batch.cancel(); this.pending.delete(id); this.releaseEaglePad(id) }
    if (value) { this.battleWorn = true; this.checkpoint() }
  }

  restoreMission(value: PersonalSquadMission | undefined): void {
    if (!value || this.mission && this.battleWorn) return
    this.mission = clonePersonalMission(value)
    this.battleWorn = true
    this.syncEagleReservations()
    const changedScene = value.sceneKey !== this.sceneKey
    this.state = changedScene ? 'ACTIVE' : value.state
    if (this.state === 'RETURNING') for (const id of this.reservedEagleOwners) {
      const saved = value.members[id]
      if (!saved || saved.status === 'dead' || saved.status === 'exited' || saved.status === 'reserve' && !value.pendingMemberIds?.includes(id)) this.releaseEaglePad(id)
    }
    this.lastPlayerPosition = changedScene ? this.position(this.player().combatPosition, this.player().group.rotation.y) : value.playerLastPosition
    const owned = new Map((this.read().personalSquad?.members ?? []).map(member => [member.id, member]))
    for (const [index, id] of value.memberIds.entries()) {
      const saved = value.members[id] ?? { status: 'reserve' as const }
      const member = owned.get(id)
      if (!member || saved.status === 'exited' || saved.status === 'dead' || saved.status === 'reserve' && !changedScene && !value.pendingMemberIds?.includes(id)) continue
      const slot = changedScene && member.equipment?.mount === 'xongkoro'
        ? this.eaglePads.get(id)
        : changedScene ? this.muster[index] : saved.position ?? this.muster[index]
      if (!slot) continue
      const standby = !changedScene && this.hasHR && (this.state === 'RESERVE' || saved.standby === true)
      if (standby && this.state !== 'RESERVE') this.standbyIds.add(id)
      this.queueMember(member, slot, index, npc => {
        this.restoreActor(npc, saved, changedScene, index)
        // A saved HR standby keeps its own wounds and simply resumes holding its slot.
        if (!changedScene && this.hasHR && this.isStandby(id) && !this.boarding.has(npc)) this.holdAtMuster(npc)
        else if (!changedScene && saved.status === 'reserve' && !saved.order && !this.boarding.has(npc)) npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
      }, standby)
    }
    this.mission.sceneKey = this.sceneKey
    delete this.mission.returnToHR
    this.returnCommand = Math.min(-1000, ...Object.values(this.mission.members).map(member => member.formation?.commandId ?? -1000))
    this.checkpoint()
  }

  /** HR repairs live members; absent casualties return to reserve for the next deployment. */
  get canRefit(): boolean {
    const profile = this.read()
    return this.hasHR && this.ready && !this.retirementResourcesLocked && !profile.activeMission && !profile.activeOutpostMission
      && Boolean(profile.personalSquad?.members.length) && this.command !== 'attack' && this.command !== 'charge'
      && !this.actors.some(actor => !actor.dead && (actor.inCombat || actor.tacticalOrder === 'attack' || actor.tacticalOrder === 'charge'))
      && (this.options.canRefit?.() ?? true)
  }
  refit(commit: (profile: CareerProfile) => boolean): boolean {
    const profile = this.read()
    if (!this.canRefit) return false
    const saved = this.checkpoint()
    if (saved) {
      for (const id of saved.memberIds) {
        const npc = this.actors.find(actor => actor.combatantId === id)
        const previous = saved.members[id], mount = this.memberMounts.get(id)
        saved.members[id] = npc ? { ...refitCommandCheckpoint(npc, mount),
          ...(previous?.eaglePadId ? { eaglePadId: previous.eaglePadId } : {}),
          ...(previous?.boarding && !npc.dead && !mount?.dead ? { boarding: true } : {}) }
          : { status: 'reserve' }
      }
    }
    const next = cloneCareerProfile(profile); next.personalSquadRuntime = saved
    if (!commit(next)) return false
    for (const [index, npc] of this.actors.entries()) {
      const mount = this.memberMounts.get(npc.combatantId)
      refitCommandActor(npc, mount)
      if (mount && npc.mount === mount) this.boarding.delete(npc)
      if (npc.tacticalOrder === 'follow') npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
    }
    if (saved) this.mission = clonePersonalMission(saved)
    this.checkpoint()
    return true
  }

  follow(): boolean {
    const profile = this.read()
    if (profile.activeMission?.kind === 'duel') return false
    if ((profile.activeMission || profile.activeOutpostMission) && !this.mission) return false
    this.mission ??= snapshotPersonalMission(profile, this.sceneKey)
    // Follow is the one order that deploys HR standby, including later hires.
    this.deployStandby()
    const existing = new Set(this.actors.map(actor => actor.combatantId))
    const owned = new Map((profile.personalSquad?.members ?? []).map(member => [member.id, member]))
    if (this.mission && this.hasHR && !this.retirementResourcesLocked && !profile.activeMission && !profile.activeOutpostMission) {
      // Free-town deployment admits later hires and completed HR arrivals. Live
      // wounds and casualties remain authoritative; this is not a refit boundary.
      this.mission.memberIds = [...owned.keys()]
      for (const id of this.mission.memberIds) {
        const saved = this.mission.members[id]
        if ((!saved || saved.status === 'exited') && !existing.has(id) && !this.pending.has(id)) {
          this.mission.members[id] = { status: 'reserve', ...(saved?.eaglePadId ? { eaglePadId: saved.eaglePadId } : {}) }
        }
      }
    }
    this.syncEagleReservations()
    const memberIds = this.mission?.memberIds ?? profile.personalSquad?.members.map(member => member.id) ?? []
    for (const [index, id] of memberIds.entries()) {
      const saved = this.mission?.members[id]
      if (this.retirementResourcesLocked || existing.has(id) || this.pending.has(id) || saved && saved.status !== 'reserve') continue
      const member = owned.get(id), slot = this.muster[index]
      if (member && slot) this.queueMember(member, slot, index)
    }
    if (!this.spawning && !this.actors.some(actor => !actor.dead)) return false
    this.resumeCommand('follow')
    this.state = this.state === 'RESERVE' ? 'DEPLOYING' : this.state === 'RETURNING' ? 'ACTIVE' : this.state
    for (const actor of this.actors) if (!actor.dead) this.applyCommand(actor, memberIds.indexOf(actor.combatantId))
    this.checkpoint()
    return true
  }

  /** Mission settlement must not recruit reserves or restore casualties. */
  regroupAfterMission(): void {
    // A squad already dismissed to HR stays on standby; regrouping is for deployed survivors.
    if (this.state === 'RESERVE') return
    if (!this.spawning && !this.actors.some(actor => !actor.dead)) return
    this.resumeCommand('follow')
    const memberIds = this.mission?.memberIds ?? this.read().personalSquad?.members.map(member => member.id) ?? []
    for (const actor of this.actors) if (!actor.dead && !this.standbyIds.has(actor.combatantId)) this.applyCommand(actor, memberIds.indexOf(actor.combatantId))
    this.checkpoint()
  }

  /** Scene teardown cancels everything; Dismiss keeps HR standby materialization running. */
  cancelPendingSpawns(includeStandby = true): void {
    for (const [id, batch] of this.pending) {
      if (!includeStandby && this.standbyBatches.has(batch)) continue
      batch.cancel(); this.releaseEaglePad(id); this.pending.delete(id); this.standbyBatches.delete(batch)
    }
  }

  dismiss(): boolean {
    if (!this.hasHR || this.state === 'RESERVE' || this.state === 'RETURNING') return false
    this.cancelPendingSpawns(false)
    this.state = 'RETURNING'; this.returnCommand--
    this.boarding.clear(); this.returningOnFoot.clear(); this.awaitingEaglePad.clear(); this.homeArrivals.clear()
    // Reserve-only legacy owners have no physical mount occupying their assigned pad.
    for (const id of this.reservedEagleOwners) if (!this.actors.some(actor => actor.combatantId === id) && !this.pending.has(id)) this.releaseEaglePad(id)
    for (const actor of this.actors) {
      // Later hires already stand at HR; Dismiss only returns the deployed members.
      if (this.standbyIds.has(actor.combatantId)) continue
      if (actor.dead) { this.releaseEaglePad(actor.combatantId); continue }
      if (actor.mount?.isFlyingMount) this.orderEagleReturn(actor)
      else this.walkTo(actor, this.slots.get(actor)!)
    }
    this.checkpoint()
    return true
  }

  resumeCommand(order?: TacticalOrder): void {
    // An undeployed HR squad has no recipients for a tactical order (ALL may still command others).
    if (this.hasHR && this.state === 'RESERVE' && order !== 'follow') return
    if (this.state === 'RETURNING') {
      this.state = 'ACTIVE'; this.awaitingEaglePad.clear(); this.homeArrivals.clear()
      for (const actor of this.actors) {
        this.releaseEagleApproach(actor)
        if (actor.mount?.isFlyingMount) actor.setEagleFlightOrder(null)
      }
    }
    if (order) {
      for (const actor of this.actors) actor.missionMovement = false
      this.command = order; this.commandRevision++
      const formation = order === 'formation' ? this.actors.find(actor => !actor.dead && actor.combatFormationCheckpoint)?.combatFormationCheckpoint : undefined
      const ids = [...this.pending.keys()].filter(id => !this.standbyIds.has(id))
      const occupied = this.actors.flatMap(actor => actor.combatFormationCheckpoint ? [actor.combatFormationCheckpoint.position] : [])
      const reserved = formation ? this.options.formationSlots?.(formation.position, occupied, ids.length)
        ?? generateFormationSlots(new THREE.Vector3(formation.position.x, 0, formation.position.z)
          .addScaledVector(new THREE.Vector3(Math.sin(formation.position.yaw), 0, Math.cos(formation.position.yaw)), -8),
          new THREE.Vector3(Math.sin(formation.position.yaw), 0, Math.cos(formation.position.yaw)), ids.length, 6, 5, 5)
          .map(point => ({ x: point.x, z: point.z, yaw: formation.position.yaw })) : []
      for (const id of ids) if (this.mission?.members[id]) {
        this.mission.members[id].order = order
        if (formation) this.mission.members[id].formation = { ...formation, position: reserved[ids.indexOf(id)], reached: false }
        else delete this.mission.members[id].formation
      }
    }
  }

  updateLifecycle(): void {
    const player = this.player()
    this.updateEagleTransfers()
    if (!player.dead) this.lastPlayerPosition = this.position(player.combatPosition, player.group.rotation.y)
    else for (const [index, actor] of this.actors.entries()) {
      if (actor.dead || actor.tacticalOrder !== 'follow') continue
      const anchor = this.lastPlayerPosition ?? this.position(player.combatPosition, player.group.rotation.y)
      const offset = followLocalOffset(index, actor.isMounted).applyAxisAngle(new THREE.Vector3(0, 1, 0), anchor.yaw)
      const point = new THREE.Vector3(anchor.x, getTerrainHeight(anchor.x, anchor.z), anchor.z).add(offset)
      actor.assignFormationTarget(-2000 - index, point, new THREE.Vector3(Math.sin(anchor.yaw), 0, Math.cos(anchor.yaw)), undefined, 'defend')
    }
    this.materializeStandby()
    if (this.state === 'RESERVE') return
    // Later hires standing at HR take no part in the deployed squad's lifecycle.
    const live = this.actors.filter(actor => !actor.dead && !this.standbyIds.has(actor.combatantId))
    this.checkpoint()
    if (this.state === 'RETURNING' && live.every(actor => !actor.mount?.isFlyingMount && !actor.mount?.isAirborne && !actor.pendingFall?.active && actor.formationCommandId !== null && actor.isFormationTargetReached(actor.formationCommandId))) {
      if (this.retirementResourcesLocked) {
        // Returning remains a movement command, never a resurrection/healing boundary.
        this.state = 'ACTIVE'; this.battleWorn = true
        for (const actor of live) actor.missionMovement = false
        this.checkpoint()
        return
      }
      if (this.hasHR) {
        // Dismiss ends at HR standby: the same actors, mounts and wounds stay in Town.
        this.enterStandby(live)
        return
      }
      if (this.mission) for (const actor of live) this.mission.members[actor.combatantId].status = 'exited'
      this.disposeActors()
      if (!this.read().activeMission && !this.read().activeOutpostMission) { this.mission = undefined; this.battleWorn = false }
      return
    }
    if (!this.spawning && !live.length && !this.read().activeMission && !this.read().activeOutpostMission && !this.battleWorn) {
      // At home the casualties stay on record until an HR refit; nothing respawns for free.
      if (this.standbyAllowed && this.mission) { this.state = 'RESERVE'; this.battleWorn = true; this.endMemberStandby(); this.checkpoint(); return }
      this.cleanup(); return
    }
    if (this.ready && !this.boarding.size && this.state === 'DEPLOYING' && live.length > 0 && live.every(actor => {
      const slot = this.slots.get(actor)!
      return Math.hypot(actor.combatPosition.x - slot.x, actor.combatPosition.z - slot.z) > 2
    })) this.state = 'ACTIVE'
  }

  /** Free home Town with an HR: owned, living members stand at their muster slots. */
  get standbyAllowed(): boolean {
    const profile = this.read()
    return this.hasHR && !this.retirementResourcesLocked && !profile.activeMission && !profile.activeOutpostMission
  }

  /**
   * Keep the HR standby in step with the saved roster: release actors whose
   * member left, rebuild an actor whose saved equipment changed (keeping its
   * wounds), and queue every living member without an actor at a free muster
   * slot. Casualties wait for an HR refit. While the squad is deployed only
   * later hires are admitted, one by one, without touching deployed orders.
   * A failed batch is only retried by `retryStandby()`, so a broken asset
   * never loops or duplicates actors.
   */
  materializeStandby(): void {
    if (!this.standbyAllowed) return
    const profile = this.read()
    const owned = (profile.personalSquad?.members ?? []).slice(0, PERSONAL_SQUAD_LIMIT)
    const ownedIds = new Set(owned.map(member => member.id))
    // A failure ends once that member left or has an actor (e.g. a later Follow deployed it).
    for (const id of this.standbyFailures.keys()) if (!ownedIds.has(id) || this.actors.some(actor => actor.combatantId === id)) this.standbyFailures.delete(id)
    if (this.state !== 'RESERVE') { this.admitStandbyHires(); return }
    const departed = this.actors.filter(actor => !ownedIds.has(actor.combatantId))
    const changed = this.actors.filter(actor => {
      const member = owned.find(value => value.id === actor.combatantId)
      return member && !actor.dead && this.spawnedLoadouts.get(member.id) !== loadoutKey(member)
    })
    const missing = owned.some(member => !this.pending.has(member.id) && !this.standbyFailures.has(member.id) && !this.actors.some(actor => actor.combatantId === member.id)
      && this.mission?.members[member.id]?.status !== 'dead' && this.mission?.members[member.id]?.hp !== 0)
    if (!departed.length && !changed.length && !missing && (!this.mission || this.mission.memberIds.length === owned.length)) return
    for (const actor of departed) this.removeActor(actor)
    if (!owned.length) { this.mission = undefined; this.battleWorn = false; return }
    this.mission ??= snapshotPersonalMission(profile, this.sceneKey)
    if (!this.mission) return
    this.checkpoint()
    for (const actor of changed) {
      const saved = this.mission.members[actor.combatantId]
      this.removeActor(actor)
      this.mission.members[actor.combatantId] = { status: 'reserve', ...(saved?.hp !== undefined ? { hp: saved.hp } : {}),
        ...(saved?.eaglePadId ? { eaglePadId: saved.eaglePadId } : {}) }
    }
    this.mission.memberIds = owned.map(member => member.id)
    for (const id of Object.keys(this.mission.members)) if (!ownedIds.has(id)) delete this.mission.members[id]
    for (const [id, batch] of this.pending) if (!ownedIds.has(id)) { batch.cancel(); this.pending.delete(id); this.releaseEaglePad(id) }
    this.battleWorn = true
    this.syncEagleReservations()
    for (const [index, member] of owned.entries()) {
      if (this.pending.has(member.id) || this.standbyFailures.has(member.id) || this.actors.some(actor => actor.combatantId === member.id)) continue
      const saved = this.mission.members[member.id]
      if (saved?.status === 'dead' || saved?.hp === 0) continue
      // Earlier HR arrivals and refits stored as `exited` are ordinary standby now.
      const standby: PersonalActorCheckpoint = saved && saved.status !== 'exited' ? saved : { status: 'reserve', ...(saved?.eaglePadId ? { eaglePadId: saved.eaglePadId } : {}) }
      this.mission.members[member.id] = standby
      const slot = this.freeMusterSlot(index)
      if (slot) this.queueMember(member, slot, index, npc => this.restoreStandby(npc, standby), true)
    }
    this.checkpoint()
  }

  /** Deployed squad: a saved hire without an actor stands at its own HR slot, outside the formation. */
  private admitStandbyHires(): void {
    if (!this.mission || this.retirementResourcesLocked) return
    const owned = (this.read().personalSquad?.members ?? []).slice(0, PERSONAL_SQUAD_LIMIT)
    for (const [index, member] of owned.entries()) {
      if (this.pending.has(member.id) || this.standbyFailures.has(member.id) || this.actors.some(actor => actor.combatantId === member.id)) continue
      const saved = this.mission.members[member.id]
      // Deployed members without an actor (a failed deployment) and casualties are not new hires.
      if (saved && saved.status !== 'reserve' && saved.status !== 'exited' && !saved.standby || saved?.status === 'dead' || saved?.hp === 0) continue
      const slot = this.freeMusterSlot(index)
      if (!slot) continue
      const standby: PersonalActorCheckpoint = { ...(saved && saved.status !== 'exited' ? saved : { status: 'reserve' as const,
        ...(saved?.eaglePadId ? { eaglePadId: saved.eaglePadId } : {}) }), standby: true }
      delete standby.order; delete standby.formation
      if (!this.mission.memberIds.includes(member.id)) this.mission.memberIds.push(member.id)
      this.mission.members[member.id] = standby
      this.standbyIds.add(member.id)
      this.syncEagleReservations()
      this.queueMember(member, slot, index, npc => this.restoreStandby(npc, standby), true)
    }
  }

  /** Clear the paused HR standby IDs and queue those saved members once more (same IDs, no charge). */
  retryStandby(): void {
    this.standbyFailures.clear()
    this.materializeStandby()
  }

  private enterStandby(live: readonly NPC[]): void {
    this.state = 'RESERVE'; this.battleWorn = true
    this.command = undefined; this.commandRevision++
    this.returningOnFoot.clear(); this.awaitingEaglePad.clear(); this.homeArrivals.clear()
    // The whole squad is HR standby again: loading hires keep their HR classification.
    this.endMemberStandby()
    for (const actor of live) { this.releaseEagleApproach(actor); this.holdAtMuster(actor) }
    this.checkpoint()
  }

  /** RESERVE covers every member: per-member standby marks end, standby batches stay HR standby. */
  private endMemberStandby(): void {
    this.standbyIds.clear()
    if (this.mission) for (const saved of Object.values(this.mission.members)) delete saved.standby
  }

  /** Follow/mission deploys the whole roster: queued standby jobs now report as deployment. */
  private deployStandby(): void {
    for (const batch of this.standbyBatches) if (batch.status === 'pending') this.batches.push(batch)
    this.standbyBatches.clear()
    this.endMemberStandby()
  }

  /** Stand at the actor's own muster slot (on the HR floor) and defend it. */
  private holdAtMuster(npc: NPC): void {
    const slot = this.slots.get(npc)
    npc.missionMovement = false
    npc.setTacticalOrder('defend')
    if (!slot || npc.mount?.isFlyingMount) return
    npc.assignFormationTarget(this.returnCommand, new THREE.Vector3(slot.x, slot.y ?? getTerrainHeight(slot.x, slot.z), slot.z),
      new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw)), undefined, 'defend')
  }

  private restoreStandby(npc: NPC, saved: PersonalActorCheckpoint): void {
    // Only resources the member already lost are carried over; a fresh hire has none.
    if (saved.hp !== undefined) npc.restoreCombatHealth(saved.hp)
    if (saved.ammo !== undefined) npc.restoreCombatAmmo(saved.ammo)
    if (saved.shieldImpact !== undefined) restoreShieldDurability(npc, saved.shieldImpact)
    const mount = this.memberMounts.get(npc.combatantId)
    if (mount && saved.mount) {
      mount.restoreArmor(saved.mount.armorImpactRemaining)
      mount.currentHp = Math.min(mount.maxHp, Math.max(1, saved.mount.hp))
    }
    this.holdAtMuster(npc)
  }

  /** Lowest free HR slot, preferring the member's own roster index. */
  private freeMusterSlot(index: number): PersonalSquadSpawnSlot | undefined {
    const taken = new Set([...this.slots.values()])
    const preferred = this.muster[index]
    if (preferred && !taken.has(preferred)) return preferred
    return this.muster.find(slot => !taken.has(slot))
  }

  /** Release one actor and its mount for a member who left the squad or is being rebuilt. */
  private removeActor(actor: NPC): void {
    const mount = this.memberMounts.get(actor.combatantId)
    this.releaseEagleApproach(actor)
    this.options.onDispose?.(actor, mount)
    if (actor.mount) actor.dismountFromMount()
    actor.dispose()
    if (mount) { mount.dispose(); this.mounts.splice(this.mounts.indexOf(mount), 1) }
    this.actors.splice(this.actors.indexOf(actor), 1)
    this.actorSet.delete(actor); this.slots.delete(actor); this.memberMounts.delete(actor.combatantId); this.spawnedLoadouts.delete(actor.combatantId)
    this.boarding.delete(actor); this.returningOnFoot.delete(actor); this.awaitingEaglePad.delete(actor); this.homeArrivals.delete(actor)
    this.standbyIds.delete(actor.combatantId)
    this.releaseEaglePad(actor.combatantId)
  }

  checkpoint(): PersonalSquadMission | undefined {
    if (!this.mission) return undefined
    this.mission.pendingMemberIds = [...this.pending.keys()]
    this.mission.state = this.state; this.mission.sceneKey = this.sceneKey
    if (this.options.layoutVersion !== undefined) this.mission.layoutVersion = this.options.layoutVersion
    if (this.lastPlayerPosition) this.mission.playerLastPosition = { ...this.lastPlayerPosition }
    for (const actor of this.actors) {
      if (!this.mission.memberIds.includes(actor.combatantId)) continue
      const mount = this.memberMounts.get(actor.combatantId)
      this.mission.members[actor.combatantId] = { status: actor.dead ? 'dead' : 'deployed', hp: actor.hp,
        position: this.position(actor.combatPosition, actor.mount?.group.rotation.y ?? actor.group.rotation.y),
        ammo: actor.combatAmmo, shieldImpact: savedShieldDurability(actor), order: actor.tacticalOrder,
        ...(this.boarding.has(actor) ? { boarding: true } : {}),
        ...(this.standbyIds.has(actor.combatantId) ? { standby: true } : {}),
        ...(this.eaglePads.get(actor.combatantId) ? { eaglePadId: this.eaglePads.get(actor.combatantId)!.id } : {}),
        ...(actor.isFalling ? { fall: actor.fallSnapshot } : {}),
        ...(mount ? { mount: { armorImpactRemaining: mount.armorImpactRemaining, hp: mount.dead ? 0 : mount.currentHp, mounted: actor.mount === mount,
          position: this.position(mount.group.position, mount.group.rotation.y),
          ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) } } : {}),
        ...(actor.combatFormationCheckpoint ? { formation: actor.combatFormationCheckpoint } : {}),
      }
    }
    return clonePersonalMission(this.mission)
  }

  /** `rebuild` is a scene-replacing return; an in-place return keeps the squad as it is. */
  endMission(rebuild: boolean): void {
    // In place, a squad dismissed to HR keeps its checkpoint even when only casualty
    // records remain (no actors after a reload): nothing refills it from the roster.
    if (rebuild || this.state === 'RESERVE' && !(this.hasHR && this.mission)) this.cleanup()
    else this.battleWorn = Boolean(this.mission || this.actors.length)
  }
  cleanup(): void { this.disposeActors(); this.mission = undefined; this.battleWorn = false }

  private disposeActors(): void {
    for (const batch of this.pending.values()) batch.cancel()
    this.pending.clear(); this.batches.length = 0; this.spawnFailed = false
    this.standbyBatches.clear(); this.standbyIds.clear(); this.standbyFailures.clear(); this.homeArrivals.clear()
    this.command = undefined; this.commandRevision++
    for (const actor of this.actors) {
      this.releaseEagleApproach(actor)
      this.options.onDispose?.(actor, this.memberMounts.get(actor.combatantId))
      if (actor.mount) actor.dismountFromMount()
      actor.dispose()
    }
    for (const mount of this.mounts) mount.dispose()
    for (const id of this.reservedEagleOwners) this.eaglePads.release(id)
    this.reservedEagleOwners.clear()
    this.actors.length = 0; this.mounts.length = 0
    this.actorSet.clear(); this.slots.clear(); this.memberMounts.clear(); this.spawnedLoadouts.clear(); this.boarding.clear(); this.returningOnFoot.clear(); this.awaitingEaglePad.clear(); this.state = 'RESERVE'
  }

  private queueMember(member: CareerPersonalSquadMember, slot: PersonalSquadSpawnSlot, index: number, restore?: (npc: NPC) => void, standby = false): void {
    if (this.pending.has(member.id) || this.actors.some(npc => npc.combatantId === member.id)) return
    const eaglePad = member.equipment?.mount === 'xongkoro' ? this.eaglePads.reserve(member.id, this.mission?.members[member.id]?.eaglePadId) : undefined
    // New excess legacy deployments wait in reserve. Existing same-scene actors retain their saved flight/position.
    const saved = this.mission?.members[member.id]
    const returningHome = this.hasHR && this.mission?.returnToHR === true
    const restoreExistingEagle = Boolean(restore && this.mission?.sceneKey === this.sceneKey && saved?.status === 'deployed' && saved.position && saved.mount)
    if (member.equipment?.mount === 'xongkoro' && !eaglePad && !restoreExistingEagle) return
    if (eaglePad) this.reservedEagleOwners.add(member.id)
    const revision = this.commandRevision
    const batch = (this.options.scheduler ?? gameplayNpcSpawns).batch(() => {
      if (this.standbyBatches.delete(batch)) {
        // HR standby: only this member is affected. Free its identity so `retryStandby()`
        // can queue the same saved member again; the Town and deployments stay usable.
        this.standbyFailures.set(member.id, batch.error)
        if (this.pending.get(member.id) === batch) this.pending.delete(member.id)
        this.releaseEaglePad(member.id)
        const npc = this.actors.find(actor => actor.combatantId === member.id)
        if (npc) this.removeActor(npc)
        return
      }
      this.spawnFailed = true
      // Retain missing identities in the checkpoint so reloading can retry the intended deployment.
      for (const [id, pending] of this.pending) {
        if (this.standbyBatches.has(pending)) continue
        pending.cancel(); this.releaseEaglePad(id)
      }
      this.releaseEaglePad(member.id)
      const npc = this.actors.find(actor => actor.combatantId === member.id)
      if (npc) {
        const mount = this.memberMounts.get(member.id)
        try { this.options.onDispose?.(npc, mount) } finally {
          this.actors.splice(this.actors.indexOf(npc), 1); this.actorSet.delete(npc); this.slots.delete(npc)
          if (mount) this.mounts.splice(this.mounts.indexOf(mount), 1)
          this.memberMounts.delete(member.id)
        }
      }
    })
    this.pending.set(member.id, batch)
    if (standby) this.standbyBatches.add(batch)
    else this.batches.push(batch)
    if (!restore && this.mission) this.mission.members[member.id] = { ...this.mission.members[member.id],
      status: 'reserve', position: { ...slot }, order: 'follow' }
    const enqueue = () => {
      if (batch.status !== 'pending') return
      batch.enqueue(member.id, () => {
        const saved = this.mission?.members[member.id]
        const boardAtHome = !returningHome && this.hasHR && (!restore || saved?.boarding || saved?.status === 'reserve' && !saved.mount)
        const deployment = !this.hasHR && eaglePad && !restoreExistingEagle ? eaglePad : slot
        // HR standby: the rider stands at its slot while the eagle stays parked on its pad.
        const npc = standby ? this.spawnMember(member, slot, undefined, index, eaglePad)
          : this.spawnMember(member, deployment, boardAtHome ? eaglePad : undefined, index, returningHome ? eaglePad : undefined)
        restore?.(npc)
        // HR standby holds its slot until Follow releases it; no other order reaches it.
        if ((!restore || revision !== this.commandRevision) && !this.isStandby(member.id)) this.applyCommand(npc, index)
        this.holdDeadPlayerFollow(npc, index)
        // Publish only fully restored actors; common combat sees a complete rider/mount pair.
        this.options.onSpawn?.(npc, this.memberMounts.get(member.id))
        this.pending.delete(member.id); this.standbyBatches.delete(batch)
      })
      batch.seal()
    }
    // A custom materialization factory owns its asset preparation; the built-in factory preloads before scheduling.
    if (this.spawn === spawnPersonalSquadActor) {
      void preloadPersonalSquadMember(member, this.read().faction).then(enqueue, error => {
        if (batch.status === 'pending') batch.fail(undefined, error)
      })
    } else enqueue()
  }

  private holdDeadPlayerFollow(actor: NPC, index: number): void {
    if (!this.player().dead || actor.tacticalOrder !== 'follow' || actor.dead) return
    const anchor = this.lastPlayerPosition ?? this.position(this.player().combatPosition, this.player().group.rotation.y)
    const offset = followLocalOffset(index, actor.isMounted).applyAxisAngle(new THREE.Vector3(0, 1, 0), anchor.yaw)
    actor.assignFormationTarget(-2000 - index, new THREE.Vector3(anchor.x, getTerrainHeight(anchor.x, anchor.z), anchor.z).add(offset),
      new THREE.Vector3(Math.sin(anchor.yaw), 0, Math.cos(anchor.yaw)), undefined, 'defend')
  }

  private applyCommand(npc: NPC, index: number): void {
    npc.missionMovement = false
    if (npc.mount?.isFlyingMount) npc.setEagleFlightOrder(null)
    // A formal HR return parks the owned eagle separately from its rider. A
    // later Follow, including one issued while restore jobs are pending, boards
    // that same mount through the ordinary live-contact transfer.
    const ownedMount = this.memberMounts.get(npc.combatantId)
    if (this.command === 'follow' && this.hasHR && !npc.mount && !npc.isFalling
      && ownedMount?.isFlyingMount && !ownedMount.dead && !this.boarding.has(npc)) {
      this.orderBoarding(npc, ownedMount, index)
      return
    }
    const boarding = this.boarding.get(npc)
    if (boarding) {
      const mount = this.memberMounts.get(npc.combatantId)
      if (mount && !mount.dead) this.orderBoarding(npc, mount, boarding.index)
      return
    }
    if (this.command === 'follow') npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
    else if (this.command === 'formation' && this.mission?.members[npc.combatantId]?.formation) {
      const f = this.mission.members[npc.combatantId].formation!, p = f.position
      npc.assignFormationTarget(f.commandId, new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z),
        new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), f.speedLimit, f.arrivalOrder, f.reached)
    } else if (this.command) npc.setTacticalOrder(this.command)
  }

  private spawnMember(member: CareerPersonalSquadMember, slot: PersonalSquadSpawnSlot, boardingPad?: PersonalSquadSpawnSlot,
    memberIndex = 0, parkedPad?: PersonalSquadSpawnSlot): NPC {
    assertNpcSpawnJob()
    const { npc, mount } = this.spawn(this.scene, member, this.read().faction, slot, this.options.emit, boardingPad ?? parkedPad)
    trackNpcSpawn(npc); if (mount) trackNpcSpawn(mount)
    this.actors.push(npc); this.actorSet.add(npc)
    const index = this.mission?.memberIds.indexOf(member.id) ?? this.read().personalSquad?.members.findIndex(value => value.id === member.id) ?? 0
    // Each live actor owns one distinct muster slot; Dismiss returns it there.
    this.slots.set(npc, this.hasHR ? this.freeMusterSlot(Math.max(0, index)) ?? slot : this.muster[Math.max(0, index)] ?? slot)
    this.spawnedLoadouts.set(member.id, loadoutKey(member))
    if (mount) { this.mounts.push(mount); this.memberMounts.set(member.id, mount) }
    // HR private eagles lift from and settle onto their pads vertically, like the Town air force.
    if (mount?.isFlyingMount && this.hasHR) npc.eagleVerticalFlight = true
    if (boardingPad && mount) this.boarding.set(npc, { pad: boardingPad, index: memberIndex })
    return npc
  }

  private eaglePad(actor: NPC): PersonalSquadSpawnSlot | undefined {
    return this.eaglePads.get(actor.combatantId)
  }

  private syncEagleReservations(): void {
    const owners = careerEaglePadOwners(this.read()).filter(id => id !== 'player' || this.hasHR || this.options.eaglePads)
    // Restore explicit home identities before filling currently unassigned pads.
    for (const id of owners) {
      const savedPadId = this.mission?.members[id]?.eaglePadId
      if (savedPadId) this.eaglePads.reserve(id, savedPadId)
    }
    this.eaglePads.syncOwners(owners)
    for (const id of owners) if (id !== 'player' && this.eaglePads.get(id)) this.reservedEagleOwners.add(id)
  }

  private releaseEaglePad(id: string): void {
    this.options.eagleLandingQueue?.release(id)
    this.eaglePads.release(id)
    this.reservedEagleOwners.delete(id)
  }

  private orderEagleReturn(actor: NPC): void {
    const pad = this.eaglePads.reserve(actor.combatantId)
    if (!pad) {
      actor.setTacticalOrder('defend')
      actor.setEagleFlightOrder({ kind: 'hold' })
      this.awaitingEaglePad.add(actor)
      return
    }
    this.reservedEagleOwners.add(actor.combatantId)
    this.awaitingEaglePad.delete(actor)
    this.walkTo(actor, pad)
    actor.setEagleFlightOrder({ kind: 'hold' })
    this.updateEagleApproach(actor, pad)
  }

  private releaseEagleApproach(actor: NPC, completed = false): void {
    if (completed) this.options.eagleLandingQueue?.complete(actor.combatantId)
    else this.options.eagleLandingQueue?.release(actor.combatantId)
    this.approachingEagles.delete(actor)
  }

  private updateEagleApproach(actor: NPC, pad: PersonalSquadSpawnSlot): void {
    const mount = this.memberMounts.get(actor.combatantId)
    if (!mount || mount.dead || actor.dead) { this.releaseEagleApproach(actor); return }
    const clear = this.options.eaglePadClear?.(pad, mount) ?? true
    // Distance still to fly and sink: real approach progress keeps the permission alive.
    const at = mount.group.position
    const remaining = Math.hypot(at.x - pad.x, at.z - pad.z) + Math.max(0, at.y - getTerrainHeight(pad.x, pad.z))
    const permitted = this.options.eagleLandingQueue?.request(actor.combatantId, clear, remaining, pad) ?? clear
    if (permitted && !this.approachingEagles.has(actor)) {
      this.approachingEagles.add(actor)
      actor.setEagleFlightOrder({ kind: 'return', target: new THREE.Vector3(pad.x, getTerrainHeight(pad.x, pad.z), pad.z), landingYaw: pad.yaw })
    } else if (!permitted && this.approachingEagles.delete(actor)) actor.setEagleFlightOrder({ kind: 'hold' })
  }

  /** A rider who walked back from the parked eagle is home: rider and eagle stay; the pad remains reserved. */
  private finishEagleReturn(actor: NPC): void {
    if (this.retirementResourcesLocked) return
    this.returningOnFoot.delete(actor)
    // Stays out of the transfer branch below: a new walk order would reset its arrival.
    this.homeArrivals.add(actor)
  }

  private walkTo(actor: NPC, slot: PersonalSquadSpawnSlot): void {
    actor.missionMovement = this.state === 'RETURNING'
    actor.assignFormationTarget(this.returnCommand, new THREE.Vector3(slot.x, slot.y ?? getTerrainHeight(slot.x, slot.z), slot.z),
      new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw)), undefined, actor.mount?.isFlyingMount ? 'defend' : undefined)
  }

  private orderBoarding(actor: NPC, mount: Mount, index: number): void {
    const pad = this.position(mount.group.position, mount.group.rotation.y)
    this.boarding.set(actor, { pad, index })
    this.walkTo(actor, pad)
  }

  private updateEagleTransfers(): void {
    for (const [actor, boarding] of this.boarding) {
      const mount = this.memberMounts.get(actor.combatantId)
      if (actor.dead || !mount || mount.dead) { this.boarding.delete(actor); continue }
      // The reserved home is not necessarily where a restored/moving mount is.
      const position = mount.group.position
      if (Math.hypot(position.x - boarding.pad.x, position.z - boarding.pad.z,
        position.y - (boarding.pad.y ?? getTerrainHeight(boarding.pad.x, boarding.pad.z))) > .25) {
        this.orderBoarding(actor, mount, boarding.index)
      }
      if (mount.isAirborne || actor.combatPosition.distanceTo(position) > 2) continue
      actor.mountVehicle(mount)
      if (actor.mount !== mount) continue
      this.boarding.delete(actor)
      if (!this.command) actor.assignFollowTarget(this.player(), boarding.index, followLocalOffset(boarding.index, true))
      this.applyCommand(actor, boarding.index)
    }
    if (this.state !== 'RETURNING') return
    for (const actor of [...this.returningOnFoot]) if (!actor.dead && actor.formationCommandId !== null && actor.isFormationTargetReached(actor.formationCommandId)) this.finishEagleReturn(actor)
    for (const actor of this.awaitingEaglePad) {
      if (actor.dead || !actor.mount?.isFlyingMount) this.awaitingEaglePad.delete(actor)
      else if (this.eaglePads.get(actor.combatantId) || this.eaglePads.reserve(actor.combatantId)) this.orderEagleReturn(actor)
    }
    for (const actor of this.actors) {
      if (actor.dead) { this.releaseEagleApproach(actor); continue }
      if (this.returningOnFoot.has(actor) || this.awaitingEaglePad.has(actor) || this.homeArrivals.has(actor) || this.standbyIds.has(actor.combatantId)) continue
      const mount = this.memberMounts.get(actor.combatantId)
      if (mount?.dead) this.releaseEagleApproach(actor)
      if (mount?.isFlyingMount && actor.mount !== mount && !actor.isFalling) {
        this.releaseEagleApproach(actor)
        this.returningOnFoot.add(actor)
        this.walkTo(actor, this.slots.get(actor)!)
        continue
      }
      const pad = this.eaglePad(actor)
      if (!mount?.isFlyingMount || actor.mount !== mount || !pad) continue
      this.updateEagleApproach(actor, pad)
      if (!mount.flight || !isEaglePadArrived({ position: mount.group.position, flight: mount.flight, pad,
        groundHeight: getTerrainHeight(mount.group.position.x, mount.group.position.z),
        clear: this.options.eaglePadClear?.({ x: mount.group.position.x, z: mount.group.position.z, yaw: mount.flight.yaw }, mount) ?? true })) continue
      actor.setEagleFlightOrder(null)
      actor.dismountFromMount()
      if (actor.mount === mount) continue
      this.releaseEagleApproach(actor, true)
      this.returningOnFoot.add(actor)
      this.walkTo(actor, this.slots.get(actor)!)
    }
  }

  private restoreActor(npc: NPC, saved: PersonalActorCheckpoint, changedScene: boolean, index: number): void {
    npc.restoreCombatHealth(saved.hp ?? npc.hp)
    if (saved.ammo !== undefined) npc.restoreCombatAmmo(saved.ammo)
    if (saved.shieldImpact !== undefined) restoreShieldDurability(npc, saved.shieldImpact)
    const mount = this.memberMounts.get(npc.combatantId)
    if (mount && saved.mount) {
      mount.restoreArmor(saved.mount.armorImpactRemaining)
      if (saved.mount.hp <= 0) { mount.takeDamage(mount.maxHp + 1); if (npc.mount) npc.dismountFromMount() }
      else {
        mount.currentHp = Math.min(mount.maxHp, saved.mount.hp)
        if (!saved.mount.mounted && npc.mount) npc.dismountFromMount()
        if (!changedScene) {
          const p = saved.mount.position
          mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
          if (saved.mount.flight && mount.flight) { mount.flight.restore(saved.mount.flight); mount.group.rotation.set(-saved.mount.flight.pitch, saved.mount.flight.yaw, saved.mount.flight.bank, 'YXZ') }
        }
      }
    }
    if (changedScene) { npc.setTacticalOrder('defend'); return }
    if (saved.position) npc.group.position.set(saved.position.x, saved.position.y ?? getTerrainHeight(saved.position.x, saved.position.z), saved.position.z)
    if (saved.fall) { npc.dismountFromMount(); npc.restorePendingFall(saved.fall) }
    if ((saved.boarding || this.boarding.has(npc)) && mount && !mount.dead) {
      this.orderBoarding(npc, mount, index)
      return
    }
    if (this.state === 'RETURNING' && npc.mount?.isFlyingMount) { this.orderEagleReturn(npc); return }
    if (saved.order === 'follow') npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
    else if (saved.formation) {
      const f = saved.formation, p = f.position
      npc.assignFormationTarget(f.commandId, new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z),
        new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), f.speedLimit, f.arrivalOrder, f.reached)
    } else npc.setTacticalOrder(saved.order ?? 'defend')
  }

  private position(point: THREE.Vector3, yaw: number): PersonalActorPosition { return { x: point.x, y: point.y, z: point.z, yaw } }
}

/** Saved equipment identity of a member, compared with what its live actor materialized with. */
function loadoutKey(member: CareerPersonalSquadMember): string {
  const e = member.equipment
  return e ? `${e.melee ?? ''}|${e.ranged ?? ''}|${e.shield ?? ''}|${e.mount ?? ''}` : 'legacy'
}
