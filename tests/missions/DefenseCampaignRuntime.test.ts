import { describe, expect, it } from 'vitest'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'

function state(overrides: Partial<{
  playerDead: boolean
  originalDefendersAlive: number
  defendersAlive: number
  personalPlayerSideAlive: number
  attackersAlive: number
  reinforcementSpawned: boolean
  reinforcementActive?: boolean
}> = {}) {
  return {
    playerDead: false,
    originalDefendersAlive: 80,
    defendersAlive: 80,
    attackersAlive: 0,
    reinforcementSpawned: false,
    ...overrides,
  }
}

describe('DefenseCampaignRuntime', () => {

  it('uses a per-launch reinforcement delay and restores its elapsed timer', () => {
    const runtime = new DefenseCampaignRuntime({
      reinforcementDelaySeconds: 90,
      initialSnapshot: {
        phase: 'assault',
        activePhase: 'assault',
        deploymentRemainingSeconds: 0,
        assaultElapsedSeconds: 89.9,
        reinforcementRemainingSeconds: 0.1,
        reinforcementTriggered: false,
      },
    })

    expect(runtime.getSnapshot().reinforcementRemainingSeconds).toBeCloseTo(0.1)
    expect(runtime.update(0.1, state({ attackersAlive: 50 }))).toEqual(['reinforcement_due'])

    const reloaded = new DefenseCampaignRuntime({
      reinforcementDelaySeconds: 90,
      initialSnapshot: runtime.getSnapshot(),
    })
    expect(reloaded.update(1, state({ attackersAlive: 50 }))).toEqual([])
    expect(reloaded.getSnapshot().reinforcementTriggered).toBe(true)
  })


  it('keeps the defender side alive while an activated reinforcement queue has living riders pending', () => {
    const runtime = new DefenseCampaignRuntime({ reinforcementDelaySeconds: 90 })
    runtime.update(60, state())
    runtime.update(90, state({ playerDead: true, originalDefendersAlive: 1, defendersAlive: 1, attackersAlive: 50 }))

    expect(runtime.update(0.1, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 2,
      attackersAlive: 50,
      reinforcementSpawned: false,
      reinforcementActive: true,
    }))).toEqual([])
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'assault', battleFinished: false, reinforcementTriggered: true })
  })

  it('still locks a wipe reported before reinforcement activation', () => {
    const runtime = new DefenseCampaignRuntime({ reinforcementDelaySeconds: 90 })
    runtime.update(60, state())
    runtime.update(89.9, state({ playerDead: true, originalDefendersAlive: 0, defendersAlive: 0, attackersAlive: 50 }))

    expect(runtime.getSnapshot()).toMatchObject({ phase: 'defeat', battleFinished: false })
    expect(runtime.update(0.1, state({
      playerDead: true,
      originalDefendersAlive: 0,
      defendersAlive: 50,
      attackersAlive: 50,
      reinforcementSpawned: false,
      reinforcementActive: true,
    }))).toEqual(['reinforcement_due'])
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'defeat', battleFinished: false, reinforcementTriggered: true })
  })

  it('wins immediately when attackers are eliminated before reinforcements spawn', () => {
    const runtime = new DefenseCampaignRuntime()
    runtime.update(60, state({ attackersAlive: 100 }))

    expect(runtime.update(30, state({
      defendersAlive: 10,
      attackersAlive: 0,
      reinforcementSpawned: false,
    }))).toEqual(['battle_victory'])
    expect(runtime.getSnapshot().phase).toBe('victory')
    expect(runtime.getSnapshot().reinforcementTriggered).toBe(false)

    // A finished battle never reaches the scheduled reinforcement event later.
    expect(runtime.update(90, state({
      defendersAlive: 10,
      attackersAlive: 0,
      reinforcementSpawned: false,
    }))).toEqual([])
    expect(runtime.getSnapshot().reinforcementTriggered).toBe(false)
  })

  it('keeps Commander elimination outcomes behind the full 60-second deployment phase', () => {
    const runtime = new DefenseCampaignRuntime({
      eliminationObjective: true,
      eliminationUsesDeployment: true,
      reinforcementsEnabled: false,
      deploymentSeconds: 60,
    })
    const wiped = state({ playerDead: true, originalDefendersAlive: 0, defendersAlive: 0, attackersAlive: 0 })

    expect(runtime.update(59.999, wiped)).toEqual([])
    expect(runtime.getSnapshot()).toMatchObject({ activePhase: 'deployment', battleFinished: false })
    expect(runtime.update(0.001, wiped)).toEqual(['assault_started'])
    expect(runtime.getSnapshot()).toMatchObject({ activePhase: 'assault', battleFinished: false })
    expect(runtime.update(0, wiped)).toEqual(['battle_victory'])
  })

  it('gives Commander elimination victory priority over a same-frame friendly wipe', () => {
    const runtime = new DefenseCampaignRuntime({
      eliminationObjective: true,
      eliminationUsesDeployment: true,
      reinforcementsEnabled: false,
      deploymentSeconds: 60,
      initialSnapshot: {
        phase: 'assault', activePhase: 'assault', deploymentRemainingSeconds: 0,
        assaultElapsedSeconds: 12, reinforcementRemainingSeconds: 0, reinforcementTriggered: false,
      },
    })

    expect(runtime.update(0.016, state({
      playerDead: true, originalDefendersAlive: 0, defendersAlive: 0,
      personalPlayerSideAlive: 0, attackersAlive: 0,
    }))).toEqual(['battle_victory'])
    expect(runtime.getSnapshot().phase).toBe('victory')
  })

  it('keeps Commander elimination active until the last personal ally dies', () => {
    const options = {
      eliminationObjective: true,
      eliminationUsesDeployment: true,
      reinforcementsEnabled: false,
      deploymentSeconds: 60,
      initialSnapshot: {
        phase: 'assault' as const, activePhase: 'assault' as const, deploymentRemainingSeconds: 0,
        assaultElapsedSeconds: 12, reinforcementRemainingSeconds: 0, reinforcementTriggered: false,
      },
    }
    const runtime = new DefenseCampaignRuntime(options)
    expect(runtime.update(0.016, state({
      playerDead: true, defendersAlive: 0, personalPlayerSideAlive: 1, attackersAlive: 10,
    }))).toEqual([])
    expect(runtime.update(0.016, state({
      playerDead: true, defendersAlive: 0, personalPlayerSideAlive: 0, attackersAlive: 10,
    }))).toEqual(['battle_defeat'])
  })
})
