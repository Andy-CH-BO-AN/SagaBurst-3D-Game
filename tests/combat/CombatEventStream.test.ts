import { describe, expect, it, vi } from 'vitest'
import { CombatEventStream, type CombatDamageContext } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'

function sourceContext(
  stream: CombatEventStream,
  overrides: Partial<CombatDamageContext> = {},
): CombatDamageContext {
  return {
    source: {
      actorId: 'attacker',
      actorType: 'npc',
      allegiance: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_archer',
      squadId: 3,
    },
    method: 'melee',
    emit: stream.emit,
    ...overrides,
  }
}

describe('Combat event stream subscriptions', () => {
  it('supports synchronous subscriptions for the next BattleStats layer', () => {
    const stream = new CombatEventStream()
    const listener = vi.fn()
    const unsubscribe = stream.subscribe(listener)
    const source = sourceContext(stream).source

    stream.emit({
      type: 'actor_killed',
      source,
      target: {
        targetId: 'npc-x',
        targetType: 'npc',
        name: 'NPC X',
      },
      method: 'melee',
    })
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    stream.emit({
      type: 'actor_killed',
      source,
      target: {
        targetId: 'npc-y',
        targetType: 'npc',
        name: 'NPC Y',
      },
      method: 'melee',
    })
    expect(listener).toHaveBeenCalledOnce()
  })
})
