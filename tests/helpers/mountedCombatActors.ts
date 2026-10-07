import * as THREE from 'three'
import { Player } from '../../src/player/Player'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { createPlayerCombatActorRef, type CombatDamageContext } from '../../src/combat/CombatAttribution'
import type { CombatContact } from '../../src/combat/ShieldBlocking'
import type { CombatEvent } from '../../src/combat/CombatAttribution'

/** Caller registers every acquired resource immediately, including failed setup. */
export function createMountedCombatActors(type: MountType, own: (resource: { dispose(): void }) => void) {
  const scene = new THREE.Scene()
  const player = new Player(scene)
  own(player)
  const rider = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Rider', 1, false)
  own(rider)
  const mount = new Mount(scene, type, 0, 0, 50)
  own(mount)
  rider.mountVehicle(mount)
  return { scene, player, rider, mount }
}

export function createMountedDamageContext(
  player: Player, kind: CombatContact['kind'], mount?: Mount,
  method: CombatDamageContext['method'] = 'melee', events: CombatEvent[] = [],
): CombatDamageContext {
  return { source: createPlayerCombatActorRef(player), method, weaponId: 'steel_sword',
    contact: { kind, mount, time: .1 }, emit: event => events.push(event) }
}
