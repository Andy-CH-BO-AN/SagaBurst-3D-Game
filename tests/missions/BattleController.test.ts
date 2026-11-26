import { describe, expect, it } from "vitest"
import { PRESET_10V10 } from "../../src/battle/BattleConfig"
import { BattleController } from "../../src/battle/BattleController"
import { Faction, NPC } from "../../src/world/NPC"

// Helper to create mock NPC objects
function createMockNpc(
  faction: Faction,
  dead: boolean = false,
  characterFaction: 'viking' | 'roman' = faction === Faction.ENEMY ? 'roman' : 'viking',
): NPC & { dead: boolean } {
  return {
    faction,
    characterFaction,
    dead,
  } as unknown as NPC & { dead: boolean }
}

describe('BattleController: Player-Inclusive Victory & Defeat Rules', () => {
  it('counts the lone surviving player through to Viking victory', () => {
    const config = { ...PRESET_10V10, playerFaction: 'viking' as const, spectator: false }
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    npcs[0].dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBeNull()
    npcs[1].dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBe('VIKING_VICTORY')
  })

  it('continues after player death and awards Roman victory after the last ally falls', () => {
    const config = { ...PRESET_10V10, playerFaction: 'viking' as const, spectator: false }
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    player.dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBeNull()
    npcs[0].dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBe('ROMAN_VICTORY')
  })

  it('determines DRAW when both sides are eliminated simultaneously', () => {
    const config = { ...PRESET_10V10, playerFaction: 'viking' as const, spectator: false }
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    npcs[0].dead = true
    npcs[1].dead = true
    player.dead = true
    controller.update(npcs, player)
    expect(controller.getResult()).toBe('DRAW')
  })

  it('does not include player in counts or victory logic when spectator mode is active', () => {
    const config = { ...PRESET_10V10, playerFaction: 'viking' as const, spectator: false }
    config.spectator = true
    const controller = new BattleController(config)
    const player = { dead: false }
    const npcs = [
      createMockNpc(Faction.PLAYER, false, 'viking'),
      createMockNpc(Faction.ENEMY, false, 'roman'),
    ]
    controller.initCounts(npcs, player)

    // In spectator mode, Viking AI dying should immediately trigger Roman victory
    npcs[0].dead = true
    controller.update(npcs, player)

    expect(controller.getResult()).toBe('ROMAN_VICTORY')
  })
})
