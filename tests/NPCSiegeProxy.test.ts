import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createCampaignOutpost } from '../src/campaign/CampaignOutpost'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { Player } from '../src/player/Player'
import {
  DAMAGEABLE_OBSTACLE_HP,
  DamageableObstacle,
  type DamageableObstacleKind,
} from '../src/world/DamageableObstacle'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { SpatialGrid } from '../src/world/SpatialGrid'
import type { ObstacleData } from '../src/world/Terrain'

function buildHostileGrid(npc: NPC, npcs: NPC[]): SpatialGrid<NPC> {
  const grid = new SpatialGrid<NPC>(20)
  for (const candidate of npcs) {
    if (!candidate.dead && candidate.faction !== npc.faction) grid.insert(candidate)
  }
  return grid
}

function breachObstacle(
  kind: Extract<DamageableObstacleKind, 'gate' | 'palisade'>,
  x: number,
  z: number,
): ObstacleData {
  const root = new THREE.Group()
  const damageable = new DamageableObstacle({
    kind,
    maxHp: DAMAGEABLE_OBSTACLE_HP[kind],
    root,
    ownerFaction: 'roman',
  })

  return {
    box: new THREE.Box3(
      new THREE.Vector3(x - 1, 0, z - 0.5),
      new THREE.Vector3(x + 1, 3, z + 0.5),
    ),
    isBarricade: true,
    damageable,
  }
}

describe('NPC siege proxy routing', () => {
  it('prefers the weaker gate when gate and palisade routes are similar', () => {
    const scene = new THREE.Scene()
    const attacker = new NPC(
      scene,
      0,
      0,
      Faction.PLAYER,
      'viking',
      AIType.MELEE,
      'Attacker',
      1,
      false,
    )
    const gate = breachObstacle('gate', 0, 8)
    const wall = breachObstacle('palisade', 5, 8)
    const target = new THREE.Vector3(0, 0, 20)

    expect(
      (attacker as any)._findSiegeProxyObstacle(target, [wall, gate]),
    ).toBe(gate)
  })

  it('uses a nearby palisade when it is much cheaper than a distant gate', () => {
    const scene = new THREE.Scene()
    const attacker = new NPC(
      scene,
      0,
      0,
      Faction.PLAYER,
      'viking',
      AIType.MELEE,
      'Attacker',
      1,
      false,
    )
    const gate = breachObstacle('gate', 35, 8)
    const wall = breachObstacle('palisade', 0, 8)
    const target = new THREE.Vector3(0, 0, 20)

    expect(
      (attacker as any)._findSiegeProxyObstacle(target, [gate, wall]),
    ).toBe(wall)
  })

  it('keeps the selected breach stable while it remains attackable', () => {
    const scene = new THREE.Scene()
    const attacker = new NPC(
      scene,
      0,
      0,
      Faction.PLAYER,
      'viking',
      AIType.MELEE,
      'Attacker',
      1,
      false,
    )
    const gate = breachObstacle('gate', 35, 8)
    const wall = breachObstacle('palisade', 0, 8)
    const target = new THREE.Vector3(0, 0, 20)

    const selected = (attacker as any)._findSiegeProxyObstacle(target, [gate, wall])
    expect(selected).toBe(wall)

    ;(attacker as any)._siegeTargetObstacle = selected
    attacker.position.set(35, attacker.position.y, 0)

    expect(
      (attacker as any)._findSiegeProxyObstacle(target, [gate, wall]),
    ).toBe(wall)
  })

  it('drops the gate proxy after breach reconnects the real target', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 150)

    const outpost = createCampaignOutpost(scene, 'roman')
    const navigationWorld = new NavigationWorld()
    navigationWorld.sync(outpost.obstacles)

    const attacker = new NPC(
      scene,
      0,
      -100,
      Faction.PLAYER,
      'viking',
      AIType.MELEE,
      'Attacker',
      1,
      false,
    )
    const defender = new NPC(
      scene,
      0,
      -128,
      Faction.ENEMY,
      'roman',
      AIType.MELEE,
      'Defender',
      1,
      false,
    )
    ;(attacker as any).state = AIState.CHASE
    const npcs = [attacker, defender]
    const hostileGrid = buildHostileGrid(attacker, npcs)

    navigationWorld.beginFrame()
    attacker.update(
      0.016,
      player,
      npcs,
      [],
      outpost.obstacles,
      null as any,
      () => {},
      () => {},
      false,
      0,
      null,
      hostileGrid,
      navigationWorld,
    )

    expect((attacker as any)._siegeTargetObstacle?.damageable?.kind).toBe('gate')

    outpost.gate.destroy()
    navigationWorld.sync(outpost.obstacles)
    navigationWorld.beginFrame()

    expect(
      navigationWorld.areConnected(attacker.combatPosition, defender.combatPosition),
    ).toBe(true)

    attacker.update(
      0.016,
      player,
      npcs,
      [],
      outpost.obstacles,
      null as any,
      () => {},
      () => {},
      false,
      0,
      null,
      hostileGrid,
      navigationWorld,
    )

    expect((attacker as any)._siegeTargetObstacle).toBeNull()
    expect(attacker.tacticalOrder).toBe('attack')
  })
})
