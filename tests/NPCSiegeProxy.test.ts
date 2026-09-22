import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createCampaignOutpost } from '../src/campaign/CampaignOutpost'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { Player } from '../src/player/Player'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { SpatialGrid } from '../src/world/SpatialGrid'

function buildHostileGrid(npc: NPC, npcs: NPC[]): SpatialGrid<NPC> {
  const grid = new SpatialGrid<NPC>(20)
  for (const candidate of npcs) {
    if (!candidate.dead && candidate.faction !== npc.faction) grid.insert(candidate)
  }
  return grid
}

describe('NPC siege proxy routing', () => {
  it('routes disconnected melee attackers to the gate instead of the wall in front of them', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 150)

    const outpost = createCampaignOutpost(scene, 'roman')
    const navigationWorld = new NavigationWorld()
    navigationWorld.sync(outpost.obstacles)
    navigationWorld.beginFrame()

    // Start outside the Roman front wall but offset from the gate. A direct
    // target line crosses a palisade, so local blocker fallback would choose
    // wall. Siege proxy routing should still choose the canonical gate.
    const attacker = new NPC(
      scene,
      20,
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
      20,
      -128,
      Faction.ENEMY,
      'roman',
      AIType.MELEE,
      'Defender',
      1,
      false,
    )
    ;(attacker as any).state = AIState.CHASE

    expect(
      navigationWorld.areConnected(attacker.combatPosition, defender.combatPosition),
    ).toBe(false)

    const npcs = [attacker, defender]
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
      buildHostileGrid(attacker, npcs),
      navigationWorld,
    )

    expect((attacker as any)._siegeTargetObstacle?.damageable?.kind).toBe('gate')
  })

  it('drops the gate proxy after breach reconnects the human target', () => {
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
