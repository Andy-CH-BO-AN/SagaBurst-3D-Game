import {
  DEFENSE_CAMPAIGN_RULES,
  DEFENSE_CAMPAIGN_TIMINGS,
} from './CampaignConfig'

export type DefenseCampaignPhase =
  | 'deployment'
  | 'assault'
  | 'victory'
  | 'defeat'

type ActiveDefenseCampaignPhase = 'deployment' | 'assault'
type DefenseCampaignResult = 'victory' | 'defeat' | null

export type DefenseCampaignRuntimeEvent =
  | 'assault_started'
  | 'reinforcement_due'
  | 'defeat'
  | 'battle_victory'
  | 'battle_defeat'

export interface DefenseCampaignCombatState {
  playerDead: boolean
  originalDefendersAlive: number
  /** All living defender NPCs, including reinforcements. Player is counted separately. */
  defendersAlive: number
  attackersAlive: number
  /** True only after the reinforcement wave has actually been spawned into the scene. */
  reinforcementSpawned: boolean
}

export interface DefenseCampaignRuntimeSnapshot {
  /** Result-facing phase kept for result UI compatibility. */
  phase: DefenseCampaignPhase
  /** Timeline phase continues even after defeat is locked. */
  activePhase: ActiveDefenseCampaignPhase
  deploymentRemainingSeconds: number
  assaultElapsedSeconds: number
  reinforcementRemainingSeconds: number
  reinforcementTriggered: boolean
}

export class DefenseCampaignRuntime {
  private phase: ActiveDefenseCampaignPhase = 'deployment'
  private result: DefenseCampaignResult = null
  private deploymentElapsed = 0
  private assaultElapsed = 0
  private reinforcementTriggered = false
  private battleFinished = false

  getSnapshot(): DefenseCampaignRuntimeSnapshot {
    return {
      phase: this.result ?? this.phase,
      activePhase: this.phase,
      deploymentRemainingSeconds: Math.max(
        0,
        DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds - this.deploymentElapsed,
      ),
      assaultElapsedSeconds: this.assaultElapsed,
      reinforcementRemainingSeconds: Math.max(
        0,
        DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds - this.assaultElapsed,
      ),
      reinforcementTriggered: this.reinforcementTriggered,
    }
  }

  update(
    dt: number,
    state: DefenseCampaignCombatState,
  ): DefenseCampaignRuntimeEvent[] {
    if (this.battleFinished) return []
    const events: DefenseCampaignRuntimeEvent[] = []

    if (
      this.result === null
      && DEFENSE_CAMPAIGN_RULES.lockDefeatWhenPlayerAndOriginalDefendersEliminated
      && !state.reinforcementSpawned
      && state.playerDead
      && state.originalDefendersAlive <= 0
    ) {
      // Defeat is locked, but the battlefield timeline intentionally continues.
      // Assault and scheduled relief cavalry still occur for spectator simulation.
      this.result = 'defeat'
      events.push('defeat')
    }

    if (this.phase === 'deployment') {
      this.deploymentElapsed += Math.max(0, dt)
      if (this.deploymentElapsed >= DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds) {
        this.phase = 'assault'
        this.assaultElapsed = 0
        events.push('assault_started')
      }
      return events
    }

    this.assaultElapsed += Math.max(0, dt)
    const defenderSideAlive = state.defendersAlive + (state.playerDead ? 0 : 1)

    // Destroying the entire attacking army is an immediate terminal result.
    // Do this before reinforcement scheduling so a clean win never queues relief.
    if (state.attackersAlive <= 0) {
      this.battleFinished = true
      if (
        this.result === 'defeat'
        || (state.reinforcementSpawned && defenderSideAlive <= 0)
      ) {
        // Preserve an already locked defeat and the existing simultaneous-wipe
        // rule where the defender side reaching zero remains a defeat.
        this.result = 'defeat'
        events.push('battle_defeat')
      } else {
        this.result = 'victory'
        events.push('battle_victory')
      }
      return events
    }

    if (
      !this.reinforcementTriggered
      && this.assaultElapsed >= DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds
    ) {
      this.reinforcementTriggered = true
      events.push('reinforcement_due')
    }

    if (
      DEFENSE_CAMPAIGN_RULES.finishDefenderEliminationAfterReinforcement
      && state.reinforcementSpawned
      && defenderSideAlive <= 0
    ) {
      this.battleFinished = true
      this.result = 'defeat'
      events.push('battle_defeat')
    }

    return events
  }
}
