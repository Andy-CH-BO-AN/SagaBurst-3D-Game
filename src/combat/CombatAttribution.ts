import type { Player } from '../player/Player'
import type { SquadIdentity } from '../battle/CommandTarget'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { DamageableObstacle, DamageableObstacleKind } from '../world/DamageableObstacle'
import type { Mount } from '../world/Mount'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { Faction, NPC } from '../world/NPC'

export type CombatActorType = 'player' | 'npc'
export type CombatTargetType = CombatActorType | 'mount' | 'structure' | 'training'
export type CombatDamageMethod = 'melee' | 'projectile' | 'mount-impact' | 'siege' | 'fall'
export type CombatAttackSource = 'xongkoro'

export interface CombatActorRef {
  actorId: string
  actorType: CombatActorType
  allegiance: Faction
  characterFaction: CharacterFaction
  presetId?: UnitPresetId
  squadId?: SquadIdentity
  ownership?: 'player-personal'
  /** Riding state when this source reference was captured, including melee hit time. */
  isMounted?: boolean
}

export interface CombatTargetRef {
  targetId: string
  targetType: CombatTargetType
  name: string
  ownerActorId?: string
  allegiance?: Faction
  characterFaction?: CharacterFaction
  presetId?: UnitPresetId
  squadId?: SquadIdentity
  structureKind?: DamageableObstacleKind
}

export interface CombatDamageContext {
  attackSource?: CombatAttackSource
  contact?: import('./ShieldBlocking').CombatContact
  hostileToTarget?: boolean
  source: CombatActorRef
  method: CombatDamageMethod
  weaponId?: string
  emit?: CombatEventSink
}

export interface DamageAppliedEvent {
  contactKind?: import('./ShieldBlocking').CombatContact['kind']
  attackSource?: CombatAttackSource
  type: 'damage_applied'
  source: CombatActorRef
  target: CombatTargetRef
  method: CombatDamageMethod
  weaponId?: string
  requestedDamage: number
  appliedDamage: number
}

export interface ActorKilledEvent {
  attackSource?: CombatAttackSource
  type: 'actor_killed'
  source: CombatActorRef
  target: CombatTargetRef
  method: CombatDamageMethod
  weaponId?: string
}

export interface StructureDamagedEvent {
  type: 'structure_damaged'
  source: CombatActorRef
  target: CombatTargetRef
  method: CombatDamageMethod
  weaponId?: string
  requestedDamage: number
  appliedDamage: number
  hpRatio: number
}

export interface StructureDestroyedEvent {
  type: 'structure_destroyed'
  source: CombatActorRef
  target: CombatTargetRef
  method: CombatDamageMethod
  weaponId?: string
}

export type CombatEvent =
  | DamageAppliedEvent
  | ActorKilledEvent
  | StructureDamagedEvent
  | StructureDestroyedEvent

export type CombatEventSink = (event: CombatEvent) => void

/** Small synchronous event stream. BattleStats can subscribe without coupling combat code to UI/progression. */
export class CombatEventStream {
  private readonly listeners = new Set<CombatEventSink>()

  readonly emit: CombatEventSink = (event) => {
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: CombatEventSink): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function createPlayerCombatActorRef(player: Player): CombatActorRef {
  return {
    actorId: 'player',
    actorType: 'player',
    allegiance: 'PLAYER' as Faction,
    characterFaction: player.characterFaction,
    isMounted: player.isMounted,
  }
}

export function createNpcCombatActorRef(npc: NPC): CombatActorRef {
  return {
    actorId: npc.combatantId,
    actorType: 'npc',
    allegiance: npc.faction,
    characterFaction: npc.characterFaction,
    presetId: npc.presetId,
    squadId: npc.squadId,
    ...(npc.combatOwnership ? { ownership: npc.combatOwnership } : {}),
    isMounted: npc.isMounted,
  }
}

export function createPlayerCombatTargetRef(player: Player): CombatTargetRef {
  return {
    targetId: 'player',
    targetType: 'player',
    name: 'Player',
    allegiance: 'PLAYER' as Faction,
    characterFaction: player.characterFaction,
  }
}

export function createNpcCombatTargetRef(npc: NPC): CombatTargetRef {
  return {
    targetId: npc.combatantId,
    targetType: 'npc',
    name: npc.name,
    allegiance: npc.faction,
    characterFaction: npc.characterFaction,
    presetId: npc.presetId,
    squadId: npc.squadId,
  }
}

export function createMountCombatTargetRef(
  mount: Mount,
  owner: CombatActorRef | undefined = mount.combatOwner,
  name: string = mount.displayName,
): CombatTargetRef {
  return {
    targetId: `mount:${mount.group.uuid}`,
    targetType: 'mount',
    name,
    ownerActorId: owner?.actorId,
    allegiance: owner?.allegiance,
    characterFaction: owner?.characterFaction,
    presetId: owner?.presetId,
    squadId: owner?.squadId,
  }
}

export function createStructureCombatTargetRef(obstacle: DamageableObstacle): CombatTargetRef {
  return {
    targetId: `structure:${obstacle.root.uuid}`,
    targetType: 'structure',
    name: obstacle.displayName,
    characterFaction: obstacle.ownerFaction ?? undefined,
    structureKind: obstacle.kind,
  }
}

export function emitDamageApplied(
  context: CombatDamageContext | undefined,
  target: CombatTargetRef,
  requestedDamage: number,
  appliedDamage: number,
): void {
  if (!context?.emit || appliedDamage <= 0) return
  context.emit({
    type: 'damage_applied',
    ...(context.contact ? { contactKind: context.contact.kind } : {}),
    ...((context.attackSource ?? context.contact?.attackSource) ? { attackSource: context.attackSource ?? context.contact?.attackSource } : {}),
    source: context.source,
    target,
    method: context.method,
    weaponId: context.weaponId,
    requestedDamage,
    appliedDamage,
  })
}

export function emitActorKilled(
  context: CombatDamageContext | undefined,
  target: CombatTargetRef,
): void {
  if (!context?.emit || (target.targetType !== 'player' && target.targetType !== 'npc')) return
  context.emit({
    type: 'actor_killed',
    ...((context.attackSource ?? context.contact?.attackSource) ? { attackSource: context.attackSource ?? context.contact?.attackSource } : {}),
    source: context.source,
    target,
    method: context.method,
    weaponId: context.weaponId,
  })
}

export function emitStructureDamage(
  context: CombatDamageContext | undefined,
  target: CombatTargetRef,
  requestedDamage: number,
  appliedDamage: number,
  hpRatio: number,
  destroyed: boolean,
): void {
  if (!context?.emit || appliedDamage <= 0) return
  context.emit({
    type: 'structure_damaged',
    source: context.source,
    target,
    method: context.method,
    weaponId: context.weaponId,
    requestedDamage,
    appliedDamage,
    hpRatio,
  })
  if (destroyed) {
    context.emit({
      type: 'structure_destroyed',
      source: context.source,
      target,
      method: context.method,
      weaponId: context.weaponId,
    })
  }
}
