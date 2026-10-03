import type { Player } from '../player/Player'
import type { SquadId } from '../battle/CommandTarget'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { DamageableObstacle, DamageableObstacleKind } from '../world/DamageableObstacle'
import type { Mount } from '../world/Mount'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { Faction, NPC } from '../world/NPC'

export type CombatActorType = 'player' | 'npc'
export type CombatTargetType = CombatActorType | 'mount' | 'structure'
export type CombatDamageMethod = 'melee' | 'projectile' | 'mount-impact' | 'siege'

export interface CombatActorRef {
  actorId: string
  actorType: CombatActorType
  allegiance: Faction
  characterFaction: CharacterFaction
  presetId?: UnitPresetId
  squadId?: SquadId
}

export interface CombatTargetRef {
  targetId: string
  targetType: CombatTargetType
  name: string
  ownerActorId?: string
  allegiance?: Faction
  characterFaction?: CharacterFaction
  presetId?: UnitPresetId
  squadId?: SquadId
  structureKind?: DamageableObstacleKind
}

export interface CombatDamageContext {
  contact?: import('./ShieldBlocking').CombatContact
  hostileToTarget?: boolean
  source: CombatActorRef
  method: CombatDamageMethod
  weaponId?: string
  emit?: CombatEventSink
}

export interface DamageAppliedEvent {
  type: 'damage_applied'
  source: CombatActorRef
  target: CombatTargetRef
  method: CombatDamageMethod
  weaponId?: string
  requestedDamage: number
  appliedDamage: number
}

export interface ActorKilledEvent {
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
  owner: CombatActorRef,
  name: string,
): CombatTargetRef {
  return {
    targetId: `mount:${mount.group.uuid}`,
    targetType: 'mount',
    name,
    ownerActorId: owner.actorId,
    allegiance: owner.allegiance,
    characterFaction: owner.characterFaction,
    presetId: owner.presetId,
    squadId: owner.squadId,
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
