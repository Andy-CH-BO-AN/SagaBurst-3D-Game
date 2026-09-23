import { describe, expect, it } from 'vitest'
import { DefenseCampaignRuntime } from './DefenseCampaignRuntime'

function state(overrides: Partial<{
  playerDead: boolean
  originalDefendersAlive: number
  defendersAlive: number
  attackersAlive: number
  reinforcementSpawned: boolean
}> = {}) {
  return {
    playerDead: false,
    originalDefendersAlive: 50,
    defendersAlive: 50,
    attackersAlive: 0,
    reinforcementSpawned: false,
    ...overrides,
  }
}

describe('DefenseCampaignRuntime', () => {
  it('holds deployment for 60 seconds before starting the assault', () => {
    const runtime = new DefenseCampaignRuntime()

    expect(runtime.update(59.9, state())).toEqual([])
    expect(runtime.getSnapshot().phase).toBe('deployment')

    expect(runtime.update(0.1, state())).toEqual(['assault_started'])
    expect(runtime.getSnapshot().activePhase).toBe('assault')
  })

  it('triggers reinforcement once after 180 assault seconds', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())

    expect(runtime.update(179.9, state({
      originalDefendersAlive: 40,
      defendersAlive: 40,
      attackersAlive: 100,
    }))).toEqual([])

    expect(runtime.update(0.1, state({
      originalDefendersAlive: 40,
      defendersAlive: 40,
      attackersAlive: 80,
    }))).toEqual(['reinforcement_due'])

    expect(runtime.update(5, state({
      originalDefendersAlive: 40,
      defendersAlive: 90,
      attackersAlive: 70,
      reinforcementSpawned: true,
    }))).toEqual([])
  })

  it('does not finish even if a faction reaches zero before reinforcements spawn', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())

    expect(runtime.update(30, state({
      defendersAlive: 10,
      attackersAlive: 0,
      reinforcementSpawned: false,
    }))).toEqual([])

    expect(runtime.update(150, state({
      defendersAlive: 10,
      attackersAlive: 0,
      reinforcementSpawned: false,
    }))).toEqual(['reinforcement_due'])
  })

  it('finishes after reinforcements spawn when attackers have no living units', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())
    runtime.update(180, state({ attackersAlive: 100 }))

    expect(runtime.update(0.016, state({
      defendersAlive: 60,
      attackersAlive: 0,
      reinforcementSpawned: true,
    }))).toEqual(['battle_victory'])

    expect(runtime.update(1, state({
      defendersAlive: 60,
      attackersAlive: 0,
      reinforcementSpawned: true,
    }))).toEqual([])
  })

  it('does not lock defeat when player dies after reinforcements spawned and defenders remain', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())
    runtime.update(180, state({ attackersAlive: 100 }))

    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 50,
      attackersAlive: 80,
      reinforcementSpawned: true,
    }))).toEqual([])
    expect(runtime.getSnapshot().phase).toBe('assault')
  })

  it('shows victory when the player dies after reinforcements arrive but surviving defenders later win', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())
    runtime.update(180, state({ attackersAlive: 100 }))

    // Player dies after relief has arrived, but cavalry are still alive.
    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 35,
      attackersAlive: 40,
      reinforcementSpawned: true,
    }))).toEqual([])
    expect(runtime.getSnapshot().phase).toBe('assault')

    // Surviving relief cavalry wipe out the attackers.
    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 12,
      attackersAlive: 0,
      reinforcementSpawned: true,
    }))).toEqual(['battle_victory'])
    expect(runtime.getSnapshot().phase).toBe('victory')
  })

  it('finishes after reinforcements spawn when the entire defender side is gone', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())
    runtime.update(180, state({ attackersAlive: 100 }))

    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
      attackersAlive: 25,
      reinforcementSpawned: true,
    }))).toEqual(['battle_defeat'])
    expect(runtime.getSnapshot().phase).toBe('defeat')
  })

  it('counts the living player as part of the defender side', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state())
    runtime.update(180, state({ attackersAlive: 100 }))

    expect(runtime.update(0.016, state({
      playerDead: false,
      originalDefendersAlive: 0,
      defendersAlive: 0,
      attackersAlive: 25,
      reinforcementSpawned: true,
    }))).toEqual([])
  })

  it('locks defeat early but still runs assault and reinforcement timeline', () => {
    const runtime = new DefenseCampaignRuntime()

    expect(runtime.update(5, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
    }))).toEqual(['defeat'])
    expect(runtime.getSnapshot().phase).toBe('defeat')
    expect(runtime.getSnapshot().activePhase).toBe('deployment')
    expect(runtime.getSnapshot().deploymentRemainingSeconds).toBe(55)

    expect(runtime.update(55, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
    }))).toEqual(['assault_started'])

    expect(runtime.update(180, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
      attackersAlive: 100,
    }))).toEqual(['reinforcement_due'])

    // Not terminal until the reinforcement wave has actually spawned.
    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
      attackersAlive: 100,
      reinforcementSpawned: false,
    }))).toEqual([])

    // Once spawned, the whole side elimination rule becomes authoritative.
    expect(runtime.update(0.016, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 0,
      attackersAlive: 100,
      reinforcementSpawned: true,
    }))).toEqual(['battle_defeat'])
  })
})
