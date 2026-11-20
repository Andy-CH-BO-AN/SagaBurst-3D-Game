import type * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CombatEventSink } from '../combat/CombatAttribution'
import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import { Mount, mountTypeFromId } from '../world/Mount'
import { NPC } from '../world/NPC'

/** Where Town mission controllers get their temporary actors and mounts. Controllers own
 * identity, restore and disposal; this port only materializes one rendered body. */
export interface CareerActorFactory {
  npc(spec: NpcSpawnSpec, actorId: string, emit: CombatEventSink, placement?: { y: number }): NPC
  /** `stableKey` picks the horse coat, so the same actor keeps its look across reloads. */
  mount(mountId: string, x: number, z: number, y: number | undefined, stableKey: string): Mount
}

/** The production factory: real NPC and Mount instances rendered into the Town scene. */
export function sceneCareerActorFactory(scene: THREE.Scene): CareerActorFactory {
  return {
    npc: (spec, actorId, emit, placement) => new NPC(scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType,
      spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId, spec.squadId, actorId, emit,
      spec.visualAssetId, spec.combatProfileId, spec.specialCombatProfile, undefined, undefined, undefined, placement,
      spec.characterTier, spec.heroArchetype),
    mount: (mountId, x, z, y, stableKey) => new Mount(scene, mountTypeFromId(mountId), x, z, y, horseVariantForStableKey(stableKey)),
  }
}
