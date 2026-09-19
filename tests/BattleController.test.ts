import { describe, it, expect, beforeEach } from "vitest"
import { BattleController } from "../src/battle/BattleController"
import { PRESET_10V10 } from "../src/battle/BattleConfig"
import { Faction, AIType, NPC } from "../src/world/NPC"

// Helper to create mock NPC objects
function createMockNpc(
  faction: Faction,
  dead: boolean = false,
  characterFaction: 'viking' | 'roman' = faction === Faction.ENEMY ? 'roman' : 'viking',
): NPC {
  return {
    faction,
    characterFaction,
    dead,
  } as unknown as NPC
}

describe("BattleController Outcome Determination", () => {
  it("determines VIKING_VICTORY when all Roman NPCs are eliminated", () => {
    const controller = new BattleController(PRESET_10V10)
    const npcs = [
      createMockNpc(Faction.PLAYER, false),
      createMockNpc(Faction.ENEMY, false),
    ]
    controller.initCounts(npcs)

    // Roman dies
    npcs[1].dead = true
    controller.update(npcs)

    expect(controller.getResult()).toBe("VIKING_VICTORY")
  })

  it("determines ROMAN_VICTORY when all Viking NPCs are eliminated", () => {
    const controller = new BattleController(PRESET_10V10)
    const npcs = [
      createMockNpc(Faction.PLAYER, false),
      createMockNpc(Faction.ENEMY, false),
    ]
    controller.initCounts(npcs)

    // Viking dies
    npcs[0].dead = true
    controller.update(npcs)

    expect(controller.getResult()).toBe("ROMAN_VICTORY")
  })

  it("determines DRAW on Double KO when both sides are eliminated on the same frame", () => {
    const controller = new BattleController(PRESET_10V10)
    const npcs = [
      createMockNpc(Faction.PLAYER, false),
      createMockNpc(Faction.ENEMY, false),
    ]
    controller.initCounts(npcs)

    // Both die simultaneously
    npcs[0].dead = true
    npcs[1].dead = true
    controller.update(npcs)

    expect(controller.getResult()).toBe("DRAW")
  })
})
