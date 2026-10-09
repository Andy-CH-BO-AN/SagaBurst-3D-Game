import { generateFormationSlots } from '../battle/FormationMath'
import { assertNpcSpawnJob, gameplayNpcSpawns, trackNpcSpawn, type NpcSpawnBatch, type NpcSpawnScheduler } from '../world/NpcSpawnScheduler'
import type { TacticalOrder } from '../battle/TacticalOrder'
import * as THREE from 'three'
import { PERSONAL_SQUAD_ID } from '../battle/CommandTarget'
import { followLocalOffset } from '../battle/FollowOrder'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CombatEventSink } from '../combat/CombatAttribution'
import type { Player } from '../player/Player'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { Mount } from '../world/Mount'
import { NPC, AIType, Faction } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import { initialPersonalEquipment } from './CareerInventory'
import { careerEaglePadOwners, EaglePadReservations } from './EaglePadReservations'
import { careerMountType } from './CareerMountController'
import type { CareerPersonalSquadMember } from './CareerPersonalSquad'
import type { CareerProfile } from './CareerProfile'
import { snapshotPersonalMission, clonePersonalMission, type PersonalActorCheckpoint, type PersonalActorPosition,
  type PersonalSquadMission, type PersonalSquadState } from './CareerPersonalSquadMission'

export type PersonalSquadSpawnSlot = PersonalActorPosition
export function personalMemberLoadout(member: CareerPersonalSquadMember, faction: CareerProfile['faction']) {
  const presetId = `${faction}_${member.type === 'soldier' ? faction === 'roman' ? 'heavy_infantry' : 'berserker' : member.type === 'ranger' ? 'horse_archer' : 'sword_cavalry'}` as UnitPresetId
  const hero = member.type === 'soldier' ? undefined : T4_UNIT_PROFILES[member.type === 'ranger' ? `${faction}_archer` as UnitPresetId : presetId]
  const equipment = member.equipment ?? initialPersonalEquipment(member.type, faction)
  return { presetId, hero, tier: member.type === 'soldier' ? 2 as const : 4 as const,
    mounted: Boolean(equipment.mount), loadout: member.type === 'ranger'
      ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: equipment.mount }
      : { meleeWeaponId: equipment.melee, rangedWeaponId: equipment.ranged, shieldId: equipment.shield, mountId: equipment.mount } }
}

export function spawnPersonalSquadActor(scene: THREE.Scene, member: CareerPersonalSquadMember,
  faction: CareerProfile['faction'], slot: PersonalSquadSpawnSlot, emit?: CombatEventSink, boardingPad?: PersonalSquadSpawnSlot): { npc: NPC; mount?: Mount } {
  assertNpcSpawnJob()
  const spec = personalMemberLoadout(member, faction)
  const npc = trackNpcSpawn(new NPC(scene, slot.x, slot.z, Faction.PLAYER, faction, spec.loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    member.type === 'soldier' ? 'Personal Soldier' : member.type === 'captain' ? 'Personal Captain' : 'Personal Maki',
    spec.tier, spec.mounted, spec.loadout, spec.presetId, PERSONAL_SQUAD_ID, member.id, emit,
    spec.hero?.visualAssetId, spec.hero?.combatProfileId, spec.hero?.specialCombatProfile))
  npc.combatOwnership = 'player-personal'
  npc.respawnEnabled = false
  npc.group.rotation.y = slot.yaw
  if (!spec.mounted) return { npc }
  const mount = trackNpcSpawn(new Mount(scene, careerMountType(spec.loadout.mountId!), boardingPad?.x ?? slot.x, boardingPad?.z ?? slot.z))
  mount.group.rotation.y = boardingPad?.yaw ?? slot.yaw; mount.reservedForTown = true
  if (!boardingPad) npc.mountVehicle(mount)
  return { npc, mount }
}

export interface PersonalSquadRuntimeOptions {
  scheduler?: NpcSpawnScheduler
  sceneKey?: string
  hasHR?: boolean
  /** Validated outdoor pads; flying mounts never materialize in the HR courtyard. */
  eagleMuster?: readonly PersonalSquadSpawnSlot[]
  /** One shared allocator for Player and the private squad in this scene. */
  eaglePads?: EaglePadReservations
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
  private readonly awaitingEaglePad = new Set<NPC>()
  private lastPlayerPosition?: PersonalActorPosition
  private returnCommand = -1000
  private readonly pending = new Map<string, NpcSpawnBatch>()
  private readonly batches: NpcSpawnBatch[] = []
  private command?: TacticalOrder
  private commandRevision = 0
  private spawnFailed = false
  private readonly eaglePads: EaglePadReservations
  private readonly reservedEagleOwners = new Set<string>()
  get error(): unknown { return this.batches.find(batch => batch.status === 'failed')?.error }
  get spawning(): boolean { return [...this.pending.values()].some(batch => batch.status === 'pending') }
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
  get aliveCombatants(): number {
    return this.actors.filter(actor => !actor.dead).length + [...this.pending.keys()].filter(id => {
      if (this.pending.get(id)?.status !== 'pending') return false
      const saved = this.mission?.members[id]
      return saved?.status !== 'dead' && saved?.status !== 'exited' && saved?.hp !== 0
    }).length
  }
  get sceneKey(): string { return this.options.sceneKey ?? 'town-home' }
  get hasHR(): boolean { return this.options.hasHR !== false }
  setMuster(slots: readonly PersonalSquadSpawnSlot[]): void { this.muster = slots }
  captureForMission(value: PersonalSquadMission): PersonalSquadMission {
    const previous = this.mission
    this.mission = clonePersonalMission(value)
    for (const id of this.pending.keys()) if (this.mission.memberIds.includes(id) && previous?.members[id])
      this.mission.members[id] = clonePersonalMission(previous).members[id]
    try { return this.checkpoint()! }
    finally { this.mission = previous }
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
      this.queueMember(member, slot, index, npc => { this.restoreActor(npc, saved, changedScene, index); if (!changedScene && saved.status === 'reserve' && !saved.order && !this.boarding.has(npc)) npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted)) })
    }
    this.mission.sceneKey = this.sceneKey
    this.returnCommand = Math.min(-1000, ...Object.values(this.mission.members).map(member => member.formation?.commandId ?? -1000))
    this.checkpoint()
  }

  follow(): boolean {
    const profile = this.read()
    if (profile.activeMission?.kind === 'duel') return false
    if ((profile.activeMission || profile.activeOutpostMission) && !this.mission) return false
    this.mission ??= snapshotPersonalMission(profile, this.sceneKey)
    this.syncEagleReservations()
    const memberIds = this.mission?.memberIds ?? profile.personalSquad?.members.map(member => member.id) ?? []
    const existing = new Set(this.actors.map(actor => actor.combatantId))
    const owned = new Map((profile.personalSquad?.members ?? []).map(member => [member.id, member]))
    for (const [index, id] of memberIds.entries()) {
      const saved = this.mission?.members[id]
      if (existing.has(id) || this.pending.has(id) || saved && saved.status !== 'reserve') continue
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
    if (!this.spawning && !this.actors.some(actor => !actor.dead)) return
    this.resumeCommand('follow')
    const memberIds = this.mission?.memberIds ?? this.read().personalSquad?.members.map(member => member.id) ?? []
    for (const actor of this.actors) if (!actor.dead) this.applyCommand(actor, memberIds.indexOf(actor.combatantId))
    this.checkpoint()
  }

  cancelPendingSpawns(): void {
    for (const [id, batch] of this.pending) { batch.cancel(); this.releaseEaglePad(id) }
    this.pending.clear()
  }

  dismiss(): boolean {
    if (!this.hasHR || this.state === 'RESERVE' || this.state === 'RETURNING') return false
    this.cancelPendingSpawns()
    this.state = 'RETURNING'; this.returnCommand--
    this.boarding.clear(); this.returningOnFoot.clear(); this.awaitingEaglePad.clear()
    // Reserve-only legacy owners have no physical mount occupying their assigned pad.
    for (const id of this.reservedEagleOwners) if (!this.actors.some(actor => actor.combatantId === id)) this.releaseEaglePad(id)
    for (const actor of this.actors) {
      if (actor.dead) { this.releaseEaglePad(actor.combatantId); continue }
      if (actor.mount?.isFlyingMount) this.orderEagleReturn(actor)
      else this.walkTo(actor, this.slots.get(actor)!)
    }
    this.checkpoint()
    return true
  }

  resumeCommand(order?: TacticalOrder): void {
    if (this.state === 'RETURNING') {
      this.state = 'ACTIVE'; this.awaitingEaglePad.clear()
      for (const actor of this.actors) if (actor.mount?.isFlyingMount) actor.setEagleFlightOrder(null)
    }
    if (order) {
      this.command = order; this.commandRevision++
      const formation = order === 'formation' ? this.actors.find(actor => !actor.dead && actor.combatFormationCheckpoint)?.combatFormationCheckpoint : undefined
      const ids = [...this.pending.keys()]
      const occupied = this.actors.flatMap(actor => actor.combatFormationCheckpoint ? [actor.combatFormationCheckpoint.position] : [])
      const reserved = formation ? this.options.formationSlots?.(formation.position, occupied, ids.length)
        ?? generateFormationSlots(new THREE.Vector3(formation.position.x, 0, formation.position.z)
          .addScaledVector(new THREE.Vector3(Math.sin(formation.position.yaw), 0, Math.cos(formation.position.yaw)), -8),
          new THREE.Vector3(Math.sin(formation.position.yaw), 0, Math.cos(formation.position.yaw)), ids.length, 6, 5, 5)
          .map(point => ({ x: point.x, z: point.z, yaw: formation.position.yaw })) : []
      for (const id of this.pending.keys()) if (this.mission?.members[id]) {
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
    if (this.state === 'RESERVE') return
    const live = this.actors.filter(actor => !actor.dead)
    this.checkpoint()
    if (this.state === 'RETURNING' && live.every(actor => !actor.mount?.isFlyingMount && !actor.mount?.isAirborne && !actor.pendingFall?.active && actor.formationCommandId !== null && actor.isFormationTargetReached(actor.formationCommandId))) {
      if (this.mission) for (const actor of live) this.mission.members[actor.combatantId].status = 'exited'
      this.disposeActors()
      if (!this.read().activeMission && !this.read().activeOutpostMission) { this.mission = undefined; this.battleWorn = false }
      return
    }
    if (!this.spawning && !live.length && !this.read().activeMission && !this.read().activeOutpostMission && !this.battleWorn) { this.cleanup(); return }
    if (this.ready && !this.boarding.size && this.state === 'DEPLOYING' && live.length > 0 && live.every(actor => {
      const slot = this.slots.get(actor)!
      return Math.hypot(actor.combatPosition.x - slot.x, actor.combatPosition.z - slot.z) > 2
    })) this.state = 'ACTIVE'
  }

  checkpoint(): PersonalSquadMission | undefined {
    if (!this.mission) return undefined
    this.mission.pendingMemberIds = [...this.pending.keys()]
    this.mission.state = this.state; this.mission.sceneKey = this.sceneKey
    if (this.lastPlayerPosition) this.mission.playerLastPosition = { ...this.lastPlayerPosition }
    for (const actor of this.actors) {
      if (!this.mission.memberIds.includes(actor.combatantId)) continue
      const mount = this.memberMounts.get(actor.combatantId)
      this.mission.members[actor.combatantId] = { status: actor.dead ? 'dead' : 'deployed', hp: actor.hp,
        position: this.position(actor.combatPosition, actor.mount?.group.rotation.y ?? actor.group.rotation.y),
        ammo: actor.combatAmmo, shieldImpact: actor.shield.shieldImpactRemaining, order: actor.tacticalOrder,
        ...(this.boarding.has(actor) ? { boarding: true } : {}),
        ...(this.eaglePads.get(actor.combatantId) ? { eaglePadId: this.eaglePads.get(actor.combatantId)!.id } : {}),
        ...(actor.isFalling ? { fall: actor.fallSnapshot } : {}),
        ...(mount ? { mount: { hp: mount.dead ? 0 : mount.currentHp, mounted: actor.mount === mount,
          position: this.position(mount.group.position, mount.group.rotation.y),
          ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) } } : {}),
        ...(actor.combatFormationCheckpoint ? { formation: actor.combatFormationCheckpoint } : {}),
      }
    }
    return clonePersonalMission(this.mission)
  }

  endMission(directReturn: boolean): void {
    if (directReturn || this.state === 'RESERVE') this.cleanup()
    else this.battleWorn = Boolean(this.mission || this.actors.length)
  }
  cleanup(): void { this.disposeActors(); this.mission = undefined; this.battleWorn = false }

  private disposeActors(): void {
    for (const batch of this.pending.values()) batch.cancel()
    this.pending.clear(); this.batches.length = 0; this.spawnFailed = false
    this.command = undefined; this.commandRevision++
    for (const actor of this.actors) {
      this.options.onDispose?.(actor, this.memberMounts.get(actor.combatantId))
      if (actor.mount) actor.dismountFromMount()
      actor.dispose()
    }
    for (const mount of this.mounts) mount.dispose()
    for (const id of this.reservedEagleOwners) this.eaglePads.release(id)
    this.reservedEagleOwners.clear()
    this.actors.length = 0; this.mounts.length = 0
    this.actorSet.clear(); this.slots.clear(); this.memberMounts.clear(); this.boarding.clear(); this.returningOnFoot.clear(); this.awaitingEaglePad.clear(); this.state = 'RESERVE'
  }

  private queueMember(member: CareerPersonalSquadMember, slot: PersonalSquadSpawnSlot, index: number, restore?: (npc: NPC) => void): void {
    if (this.pending.has(member.id) || this.actors.some(npc => npc.combatantId === member.id)) return
    const eaglePad = member.equipment?.mount === 'xongkoro' ? this.eaglePads.reserve(member.id, this.mission?.members[member.id]?.eaglePadId) : undefined
    // New excess legacy deployments wait in reserve. Existing same-scene actors retain their saved flight/position.
    const saved = this.mission?.members[member.id]
    const restoreExistingEagle = Boolean(restore && this.mission?.sceneKey === this.sceneKey && saved?.status === 'deployed' && saved.position && saved.mount)
    if (member.equipment?.mount === 'xongkoro' && !eaglePad && !restoreExistingEagle) return
    if (eaglePad) this.reservedEagleOwners.add(member.id)
    const revision = this.commandRevision
    const batch = (this.options.scheduler ?? gameplayNpcSpawns).batch(() => {
      this.spawnFailed = true
      // Retain missing identities in the checkpoint so reloading can retry the intended deployment.
      for (const [id, pending] of this.pending) { pending.cancel(); this.releaseEaglePad(id) }
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
    this.pending.set(member.id, batch); this.batches.push(batch)
    if (!restore && this.mission) this.mission.members[member.id] = { ...this.mission.members[member.id],
      status: 'reserve', position: { ...slot }, order: 'follow' }
    batch.enqueue(member.id, () => {
      const saved = this.mission?.members[member.id]
      const boardAtHome = this.hasHR && (!restore || saved?.boarding || saved?.status === 'reserve' && !saved.mount)
      const npc = this.spawnMember(member, slot, boardAtHome ? eaglePad : undefined, index)
      restore?.(npc)
      if (!restore || revision !== this.commandRevision) this.applyCommand(npc, index)
      this.holdDeadPlayerFollow(npc, index)
      // Publish only fully restored actors; common combat sees a complete rider/mount pair.
      this.options.onSpawn?.(npc, this.memberMounts.get(member.id))
      this.pending.delete(member.id)
    })
    batch.seal()
  }

  private holdDeadPlayerFollow(actor: NPC, index: number): void {
    if (!this.player().dead || actor.tacticalOrder !== 'follow' || actor.dead) return
    const anchor = this.lastPlayerPosition ?? this.position(this.player().combatPosition, this.player().group.rotation.y)
    const offset = followLocalOffset(index, actor.isMounted).applyAxisAngle(new THREE.Vector3(0, 1, 0), anchor.yaw)
    actor.assignFormationTarget(-2000 - index, new THREE.Vector3(anchor.x, getTerrainHeight(anchor.x, anchor.z), anchor.z).add(offset),
      new THREE.Vector3(Math.sin(anchor.yaw), 0, Math.cos(anchor.yaw)), undefined, 'defend')
  }

  private applyCommand(npc: NPC, index: number): void {
    if (npc.mount?.isFlyingMount) npc.setEagleFlightOrder(null)
    const boarding = this.boarding.get(npc)
    if (boarding) { this.walkTo(npc, boarding.pad); return }
    if (this.command === 'follow') npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
    else if (this.command === 'formation' && this.mission?.members[npc.combatantId]?.formation) {
      const f = this.mission.members[npc.combatantId].formation!, p = f.position
      npc.assignFormationTarget(f.commandId, new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z),
        new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), f.speedLimit, f.arrivalOrder, f.reached)
    } else if (this.command) npc.setTacticalOrder(this.command)
  }

  private spawnMember(member: CareerPersonalSquadMember, slot: PersonalSquadSpawnSlot, boardingPad?: PersonalSquadSpawnSlot, memberIndex = 0): NPC {
    assertNpcSpawnJob()
    const { npc, mount } = this.spawn(this.scene, member, this.read().faction, slot, this.options.emit, boardingPad)
    trackNpcSpawn(npc); if (mount) trackNpcSpawn(mount)
    this.actors.push(npc); this.actorSet.add(npc)
    const index = this.mission?.memberIds.indexOf(member.id) ?? this.read().personalSquad?.members.findIndex(value => value.id === member.id) ?? 0
    this.slots.set(npc, this.muster[Math.max(0, index)] ?? slot)
    if (mount) { this.mounts.push(mount); this.memberMounts.set(member.id, mount) }
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
    actor.setEagleFlightOrder({ kind: 'return', target: new THREE.Vector3(pad.x, getTerrainHeight(pad.x, pad.z), pad.z), landingYaw: pad.yaw })
  }

  /** Refit each returned rider before admitting a legacy overflow owner to the same physical pad. */
  private finishEagleReturn(actor: NPC): void {
    const mount = this.memberMounts.get(actor.combatantId)
    if (this.mission?.members[actor.combatantId]) this.mission.members[actor.combatantId].status = 'exited'
    this.options.onDispose?.(actor, mount)
    actor.dispose()
    if (mount) { mount.dispose(); this.mounts.splice(this.mounts.indexOf(mount), 1) }
    this.actors.splice(this.actors.indexOf(actor), 1)
    this.actorSet.delete(actor); this.slots.delete(actor); this.memberMounts.delete(actor.combatantId)
    this.returningOnFoot.delete(actor); this.releaseEaglePad(actor.combatantId)
  }

  private walkTo(actor: NPC, slot: PersonalSquadSpawnSlot): void {
    actor.assignFormationTarget(this.returnCommand, new THREE.Vector3(slot.x, getTerrainHeight(slot.x, slot.z), slot.z),
      new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw)), undefined, actor.mount?.isFlyingMount ? 'defend' : undefined)
  }

  private updateEagleTransfers(): void {
    for (const [actor, boarding] of this.boarding) {
      const mount = this.memberMounts.get(actor.combatantId)
      if (actor.dead || !mount || mount.dead) { this.boarding.delete(actor); continue }
      if (Math.hypot(actor.combatPosition.x - boarding.pad.x, actor.combatPosition.z - boarding.pad.z) > 2) continue
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
      if (actor.dead || this.returningOnFoot.has(actor) || this.awaitingEaglePad.has(actor)) continue
      const mount = this.memberMounts.get(actor.combatantId)
      if (mount?.isFlyingMount && actor.mount !== mount && !actor.isFalling) {
        this.returningOnFoot.add(actor)
        this.walkTo(actor, this.slots.get(actor)!)
        continue
      }
      const pad = this.eaglePad(actor)
      if (!mount?.isFlyingMount || actor.mount !== mount || mount.isAirborne || !pad
        || Math.hypot(mount.group.position.x - pad.x, mount.group.position.z - pad.z) > 3) continue
      actor.setEagleFlightOrder(null)
      actor.dismountFromMount()
      if (actor.mount === mount) continue
      this.returningOnFoot.add(actor)
      this.walkTo(actor, this.slots.get(actor)!)
    }
  }

  private restoreActor(npc: NPC, saved: PersonalActorCheckpoint, changedScene: boolean, index: number): void {
    npc.restoreCombatHealth(saved.hp ?? npc.hp)
    if (saved.ammo !== undefined) npc.restoreCombatAmmo(saved.ammo)
    if (saved.shieldImpact !== undefined) npc.shield.shieldImpactRemaining = Math.min(npc.shield.shieldImpactMax, saved.shieldImpact)
    const mount = this.memberMounts.get(npc.combatantId)
    if (mount && saved.mount) {
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
      const pad = this.eaglePad(npc)
      if (pad) { this.boarding.set(npc, { pad, index }); this.walkTo(npc, pad); return }
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
