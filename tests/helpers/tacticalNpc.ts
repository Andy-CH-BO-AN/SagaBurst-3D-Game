import type * as THREE from 'three'
import { AIType, NPC, type Faction } from '../../src/world/NPC'

export type TacticalNpcArgs = [
  scene: THREE.Scene,
  faction: Faction,
  characterFaction: 'viking' | 'roman',
  presetId: ConstructorParameters<typeof NPC>[10],
  loadout: ConstructorParameters<typeof NPC>[9],
  z: number,
  cavalry?: boolean,
]

/** Real NPC setup only; the consumer registers cleanup before any later setup can fail. */
export function createTacticalNpc(own: (npc: NPC) => void, ...args: TacticalNpcArgs): NPC {
  const [scene, faction, characterFaction, presetId, loadout, z, cavalry = false] = args
  const npc = new NPC(scene, 0, z, faction, characterFaction, AIType.MELEE, String(presetId), 2, cavalry, loadout, presetId)
  own(npc)
  return npc
}
