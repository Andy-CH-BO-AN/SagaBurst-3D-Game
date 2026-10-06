import { initialPersonalEquipment } from '../career/CareerInventory'
import { careerMountType } from '../career/CareerMountController'
import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import type { CareerPersonalSquadMember } from '../career/CareerPersonalSquad'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { type UnitPresetId } from '../battle/UnitPresetCatalog'
import { followLocalOffset } from '../battle/FollowOrder'
import { NPC, AIType, Faction } from '../world/NPC'
import { Mount } from '../world/Mount'
import { getTerrainHeight } from '../world/Terrain'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import type { Player } from '../player/Player'
import type { TownHRLayout } from './TownHRLayout'

export type PersonalSquadState = 'RESERVE' | 'DEPLOYING' | 'ACTIVE' | 'RETURNING'
export function personalMemberLoadout(member: CareerPersonalSquadMember, faction: CareerProfile['faction']) {
  // Identity and allocated gear survive faction switches; visuals/profile adopt
  // the current faction. Only legacy fixtures without saved equipment use defaults.
  const presetId = `${faction}_${member.type === 'soldier' ? faction === 'roman' ? 'heavy_infantry' : 'berserker' : member.type === 'ranger' ? 'horse_archer' : 'sword_cavalry'}` as UnitPresetId
  const hero = member.type === 'soldier' ? undefined : T4_UNIT_PROFILES[member.type === 'ranger' ? `${faction}_archer` as UnitPresetId : presetId]
  const equipment = member.equipment ?? initialPersonalEquipment(member.type, faction)
  return { presetId, hero, tier: member.type === 'soldier' ? 2 as const : 4 as const,
    mounted: Boolean(equipment.mount),
    loadout: member.type === 'ranger'
      ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: equipment.mount }
      : { meleeWeaponId: equipment.melee, rangedWeaponId: equipment.ranged, shieldId: equipment.shield, mountId: equipment.mount } }
}
export function spawnPersonalSquadActor(scene: THREE.Scene, member: CareerPersonalSquadMember,
  faction: CareerProfile['faction'], slot: TownHRLayout['muster'][number]): { npc: NPC; mount?: Mount } {
  const spec = personalMemberLoadout(member, faction)
  const npc = new NPC(scene, slot.x, slot.z, Faction.PLAYER, faction, spec.loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    member.type === 'soldier' ? 'Personal Soldier' : member.type === 'captain' ? 'Personal Captain' : 'Personal Maki',
    spec.tier, spec.mounted, spec.loadout, spec.presetId, 1, member.id, undefined,
    spec.hero?.visualAssetId, spec.hero?.combatProfileId, spec.hero?.specialCombatProfile)
  npc.combatOwnership = 'player-personal'
  npc.respawnEnabled = false
  npc.group.rotation.y = slot.yaw
  if (!spec.mounted) return { npc }
  const mount = new Mount(scene, careerMountType(spec.loadout.mountId!), slot.x, slot.z)
  mount.group.rotation.y = slot.yaw; mount.reservedForTown = true
  npc.mountVehicle(mount)
  return { npc, mount }
}
/** Owns only Player actors; not residents, borrowed mission troops, or service officers.
 * Fresh construction on a complete deployment restores HP/ammo/shield/mount HP using native defaults.
 */
export class TownPersonalSquadController {
  readonly actors: NPC[] = []
  readonly mounts: Mount[] = []
  state: PersonalSquadState = 'RESERVE'
  private returnCommand = -1
  private readonly slots = new Map<NPC, TownHRLayout['muster'][number]>()
  constructor(private readonly scene: THREE.Scene, readonly layout: TownHRLayout,
    private readonly read: () => CareerProfile, private readonly player: () => Player,
    private readonly spawn = spawnPersonalSquadActor) {}
  owns(actor: NPC): boolean { return this.actors.includes(actor) }
  follow(): boolean {
    const profile = this.read()
    if (profile.activeMission || profile.activeOutpostMission) return false
    if (this.state === 'RESERVE') {
      const members = profile.personalSquad?.members ?? []
      if (!members.length) return false
      this.state = 'DEPLOYING'
      try {
        for (const [index, member] of members.entries()) {
          const slot = this.layout.muster[index]
          const { npc, mount } = this.spawn(this.scene, member, profile.faction, slot)
          this.actors.push(npc); this.slots.set(npc, slot)
          if (mount) this.mounts.push(mount)
        }
      } catch (error) { this.cleanup(); throw error }
    } else if (this.state === 'RETURNING') this.state = 'ACTIVE'
    for (const [index, actor] of this.actors.entries()) if (!actor.dead) actor.assignFollowTarget(this.player(), index, followLocalOffset(index, actor.isMounted))
    return true
  }
  dismiss(): boolean {
    if (this.state === 'RESERVE' || this.state === 'RETURNING') return false
    this.state = 'RETURNING'; this.returnCommand--
    for (const actor of this.actors) {
      if (actor.dead) continue
      const slot = this.slots.get(actor)!
      actor.assignFormationTarget(this.returnCommand, new THREE.Vector3(slot.x, getTerrainHeight(slot.x, slot.z), slot.z),
        new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw)))
    }
    return true
  }
  updateLifecycle(): void {
    if (this.state === 'RESERVE') return
    const live = this.actors.filter(actor => !actor.dead)
    if (!live.length) { this.cleanup(); return }
    if (this.state === 'RETURNING' && live.every(actor => actor.isFormationTargetReached(this.returnCommand))) {
      this.cleanup(); return
    }
    if (this.state === 'DEPLOYING' && live.every(actor => {
      const slot = this.slots.get(actor)!
      return Math.hypot(actor.combatPosition.x - slot.x, actor.combatPosition.z - slot.z) > 2
    })) this.state = 'ACTIVE'
  }
  cleanup(): void {
    for (const actor of this.actors) { if (actor.mount) actor.dismountFromMount(); actor.dispose() }
    for (const mount of this.mounts) mount.dispose()
    this.actors.length = 0; this.mounts.length = 0; this.slots.clear(); this.state = 'RESERVE'
  }
}
