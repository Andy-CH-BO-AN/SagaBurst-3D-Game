import * as THREE from "three"
import { describe, it, expect } from "vitest"
import { NPC, Faction, AIType, AIState } from "../src/world/NPC"
import { Player } from "../src/player/Player"

describe("NPC Deterministic Respawn Rules", () => {
  it.each(['peace', 'travel'] as const)('hides a Town corpse after three seconds during %s without reviving it', mode => {
    const npc = new NPC(new THREE.Scene(), 0, 80, Faction.TOWN, 'roman', AIType.MELEE, 'Town guard', 1, false)
    npc.setTownPeaceful()
    npc.takeDamage(9999)
    const tick = (dt: number) => mode === 'peace'
      ? npc.updateTownPeace(dt, 0, false, false)
      : npc.updateTownTravel(dt, 0, [], [], null as any)
    tick(2.99)
    expect(npc.group.visible).toBe(true)
    tick(.02)
    expect(npc.group.visible).toBe(false)
    expect(npc.deathPresentationComplete).toBe(true)
    tick(10)
    expect(npc.dead).toBe(true)
    expect(npc.hp).toBe(0)
    npc.restoreForTown()
    expect(npc.group.visible).toBe(true)
    expect(npc.dead).toBe(false)
    npc.dispose()
  })
  it("never respawns when respawnEnabled is false, even after advancing past the 10.0s window", () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, "TestRoman", 1, false)

    // Explicitly configure rules: respawn disabled
    npc.respawnEnabled = false
    expect(npc.dead).toBe(false)
    expect(npc.hp).toBeGreaterThan(0)

    // Apply lethal damage
    const killed = npc.takeDamage(9999)
    expect(killed).toBe(true)
    expect(npc.currentState).toBe(AIState.DEAD)
    expect(npc.dead).toBe(true)
    expect(npc.hp).toBe(0)

    // Advance delta time in increments totaling > 10.0s (12 seconds)
    // RESPAWN_TIME is 10.0s
    for (let step = 0; step < 12; step++) {
      npc.update(
        1.0,
        player,
        [npc],
        [npc],
        [],
        null as any,
        () => {},
        () => {},
        true
      )
    }

    // Must strictly remain DEAD with 0 HP
    expect(npc.currentState).toBe(AIState.DEAD)
    expect(npc.dead).toBe(true)
    expect(npc.hp).toBe(0)
  })

  it("respawns when respawnEnabled is true after the 10.0s window", () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const npc = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, "TestRoman", 1, false)

    // Explicitly configure rules: respawn enabled
    npc.respawnEnabled = true
    expect(npc.dead).toBe(false)

    // Apply lethal damage
    npc.takeDamage(9999)
    expect(npc.currentState).toBe(AIState.DEAD)
    expect(npc.dead).toBe(true)

    // Advance 5 seconds (less than 10.0s RESPAWN_TIME) -> should still be dead
    for (let step = 0; step < 5; step++) {
      npc.update(
        1.0,
        player,
        [npc],
        [npc],
        [],
        null as any,
        () => {},
        () => {},
        true
      )
    }
    expect(npc.currentState).toBe(AIState.DEAD)
    expect(npc.dead).toBe(true)

    // Advance another 6 seconds (total 11s > 10.0s RESPAWN_TIME) -> should respawn
    for (let step = 0; step < 6; step++) {
      npc.update(
        1.0,
        player,
        [npc],
        [npc],
        [],
        null as any,
        () => {},
        () => {},
        true
      )
    }
    expect(npc.currentState).not.toBe(AIState.DEAD)
    expect(npc.dead).toBe(false)
    expect(npc.hp).toBe(npc.maxHp)
  })
})
