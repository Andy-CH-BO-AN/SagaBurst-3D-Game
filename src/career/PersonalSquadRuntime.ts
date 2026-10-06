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
import { careerMountType } from './CareerMountController'
import type { CareerPersonalSquadMember } from './CareerPersonalSquad'
import type { CareerProfile } from './CareerProfile'
import { clonePersonalMission, type PersonalActorCheckpoint, type PersonalActorPosition,
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
  faction: CareerProfile['faction'], slot: PersonalSquadSpawnSlot, emit?: CombatEventSink): { npc: NPC; mount?: Mount } {
  const spec = personalMemberLoadout(member, faction)
  const npc = new NPC(scene, slot.x, slot.z, Faction.PLAYER, faction, spec.loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    member.type === 'soldier' ? 'Personal Soldier' : member.type === 'captain' ? 'Personal Captain' : 'Personal Maki',
    spec.tier, spec.mounted, spec.loadout, spec.presetId, PERSONAL_SQUAD_ID, member.id, emit,
    spec.hero?.visualAssetId, spec.hero?.combatProfileId, spec.hero?.specialCombatProfile)
  npc.combatOwnership = 'player-personal'
  npc.respawnEnabled = false
  npc.group.rotation.y = slot.yaw
  if (!spec.mounted) return { npc }
  let mount: Mount | undefined
  try {
    mount = new Mount(scene, careerMountType(spec.loadout.mountId!), slot.x, slot.z)
    mount.group.rotation.y = slot.yaw; mount.reservedForTown = true
    npc.mountVehicle(mount)
    return { npc, mount }
  } catch (error) {
    mount?.dispose(); npc.dispose()
    throw error
  }
}

export interface PersonalSquadRuntimeOptions {
  sceneKey?: string
  hasHR?: boolean
  emit?: CombatEventSink
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
  private lastPlayerPosition?: PersonalActorPosition
  private returnCommand = -1000

  constructor(private readonly scene: THREE.Scene, private muster: readonly PersonalSquadSpawnSlot[],
    private readonly read: () => CareerProfile, private readonly player: () => Player,
    private readonly spawn = spawnPersonalSquadActor, private readonly options: PersonalSquadRuntimeOptions = {}) {}

  owns(actor: NPC): boolean { return this.actorSet.has(actor) }
  get aliveCombatants(): number { return this.actors.filter(actor => !actor.dead).length }
  get sceneKey(): string { return this.options.sceneKey ?? 'town-home' }
  get hasHR(): boolean { return this.options.hasHR !== false }
  setMuster(slots: readonly PersonalSquadSpawnSlot[]): void { this.muster = slots }
  captureForMission(value: PersonalSquadMission): PersonalSquadMission {
    const previous = this.mission
    this.mission = clonePersonalMission(value)
    try { return this.checkpoint()! }
    finally { this.mission = previous }
  }

  bindMission(value: PersonalSquadMission | undefined): void {
    this.mission = value ? clonePersonalMission(value) : undefined
    if (value) { this.battleWorn = true; this.checkpoint() }
  }

  restoreMission(value: PersonalSquadMission | undefined): void {
    if (!value || this.actors.length) return
    this.mission = clonePersonalMission(value)
    this.battleWorn = true
    const changedScene = value.sceneKey !== this.sceneKey
    this.state = changedScene ? 'ACTIVE' : value.state
    this.lastPlayerPosition = changedScene ? this.position(this.player().combatPosition, this.player().group.rotation.y) : value.playerLastPosition
    const owned = new Map((this.read().personalSquad?.members ?? []).map(member => [member.id, member]))
    for (const [index, id] of value.memberIds.entries()) {
      const saved = value.members[id] ?? { status: 'reserve' as const }
      const member = owned.get(id)
      if (!member || saved.status === 'exited' || saved.status === 'dead' || saved.status === 'reserve' && !changedScene) continue
      const slot = changedScene ? this.muster[index] : saved.position ?? this.muster[index]
      if (!slot) continue
      this.restoreActor(this.spawnMember(member, slot), saved, changedScene, index)
    }
    this.mission.sceneKey = this.sceneKey
    this.returnCommand = Math.min(-1000, ...Object.values(this.mission.members).map(member => member.formation?.commandId ?? -1000))
    this.checkpoint()
  }

  follow(): boolean {
    const profile = this.read()
    if (profile.activeMission?.kind === 'duel') return false
    if ((profile.activeMission || profile.activeOutpostMission) && !this.mission) return false
    const memberIds = this.mission?.memberIds ?? profile.personalSquad?.members.map(member => member.id) ?? []
    const existing = new Set(this.actors.map(actor => actor.combatantId))
    const owned = new Map((profile.personalSquad?.members ?? []).map(member => [member.id, member]))
    for (const [index, id] of memberIds.entries()) {
      const saved = this.mission?.members[id]
      if (existing.has(id) || saved && saved.status !== 'reserve') continue
      const member = owned.get(id), slot = this.muster[index]
      if (member && slot) this.spawnMember(member, slot)
    }
    if (!this.actors.some(actor => !actor.dead)) return false
    this.state = this.state === 'RESERVE' ? 'DEPLOYING' : this.state === 'RETURNING' ? 'ACTIVE' : this.state
    for (const [index, actor] of this.actors.entries()) if (!actor.dead) actor.assignFollowTarget(this.player(), index, followLocalOffset(index, actor.isMounted))
    this.checkpoint()
    return true
  }

  dismiss(): boolean {
    if (!this.hasHR || this.state === 'RESERVE' || this.state === 'RETURNING') return false
    this.state = 'RETURNING'; this.returnCommand--
    for (const actor of this.actors) {
      if (actor.dead) continue
      const slot = this.slots.get(actor)!
      actor.assignFormationTarget(this.returnCommand, new THREE.Vector3(slot.x, getTerrainHeight(slot.x, slot.z), slot.z),
        new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw)))
    }
    this.checkpoint()
    return true
  }

  resumeCommand(): void { if (this.state === 'RETURNING') this.state = 'ACTIVE' }

  updateLifecycle(): void {
    const player = this.player()
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
    if (this.state === 'RETURNING' && live.every(actor => actor.formationCommandId !== null && actor.isFormationTargetReached(actor.formationCommandId))) {
      if (this.mission) for (const actor of live) this.mission.members[actor.combatantId].status = 'exited'
      this.disposeActors()
      if (!this.read().activeMission && !this.read().activeOutpostMission) { this.mission = undefined; this.battleWorn = false }
      return
    }
    if (!live.length && !this.mission && !this.battleWorn) { this.cleanup(); return }
    if (this.state === 'DEPLOYING' && live.every(actor => {
      const slot = this.slots.get(actor)!
      return Math.hypot(actor.combatPosition.x - slot.x, actor.combatPosition.z - slot.z) > 2
    })) this.state = 'ACTIVE'
  }

  checkpoint(): PersonalSquadMission | undefined {
    if (!this.mission) return undefined
    this.mission.state = this.state; this.mission.sceneKey = this.sceneKey
    if (this.lastPlayerPosition) this.mission.playerLastPosition = { ...this.lastPlayerPosition }
    for (const actor of this.actors) {
      if (!this.mission.memberIds.includes(actor.combatantId)) continue
      const mount = this.memberMounts.get(actor.combatantId)
      this.mission.members[actor.combatantId] = { status: actor.dead ? 'dead' : 'deployed', hp: actor.hp,
        position: this.position(actor.combatPosition, actor.mount?.group.rotation.y ?? actor.group.rotation.y),
        ammo: actor.combatAmmo, shieldImpact: actor.shield.shieldImpactRemaining, order: actor.tacticalOrder,
        ...(mount ? { mount: { hp: mount.dead ? 0 : mount.currentHp, mounted: actor.mount === mount,
          position: this.position(mount.group.position, mount.group.rotation.y) } } : {}),
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
    for (const actor of this.actors) {
      this.options.onDispose?.(actor, this.memberMounts.get(actor.combatantId))
      if (actor.mount) actor.dismountFromMount()
      actor.dispose()
    }
    for (const mount of this.mounts) mount.dispose()
    this.actors.length = 0; this.mounts.length = 0
    this.actorSet.clear(); this.slots.clear(); this.memberMounts.clear(); this.state = 'RESERVE'
  }

  private spawnMember(member: CareerPersonalSquadMember, slot: PersonalSquadSpawnSlot): NPC {
    const { npc, mount } = this.spawn(this.scene, member, this.read().faction, slot, this.options.emit)
    this.actors.push(npc); this.actorSet.add(npc)
    const index = this.mission?.memberIds.indexOf(member.id) ?? this.read().personalSquad?.members.findIndex(value => value.id === member.id) ?? 0
    this.slots.set(npc, this.muster[Math.max(0, index)] ?? slot)
    if (mount) { this.mounts.push(mount); this.memberMounts.set(member.id, mount) }
    this.options.onSpawn?.(npc, mount)
    return npc
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
          mount.group.position.set(p.x, getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
        }
      }
    }
    if (changedScene) { npc.setTacticalOrder('defend'); return }
    if (saved.order === 'follow') npc.assignFollowTarget(this.player(), index, followLocalOffset(index, npc.isMounted))
    else if (saved.formation) {
      const f = saved.formation, p = f.position
      npc.assignFormationTarget(f.commandId, new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z),
        new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), f.speedLimit, f.arrivalOrder, f.reached)
    } else npc.setTacticalOrder(saved.order ?? 'defend')
  }

  private position(point: THREE.Vector3, yaw: number): PersonalActorPosition { return { x: point.x, z: point.z, yaw } }
}
