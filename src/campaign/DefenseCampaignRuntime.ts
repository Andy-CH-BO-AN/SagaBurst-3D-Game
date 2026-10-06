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
  /** Initial fort defenders; only used by defense timelines, not elimination objectives. */
  originalDefendersAlive: number
  /** Official Player-side NPCs, including reinforcements. Veteran assault attackers map here. */
  defendersAlive: number
  /** Deployed private combatants on Player's side, regardless of the fort's physical roles. */
  personalPlayerSideAlive?: number
  /** Official enemy-side NPCs. Veteran assault Outpost defenders map here. */
  attackersAlive: number
  /** True only after the reinforcement wave has actually been spawned into the scene. */
  reinforcementSpawned: boolean
  /** True once the wave is queued or materialized; arrival is tracked separately. */
  reinforcementActive?: boolean
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
  /** Distinguishes a locked defeat, whose timeline still runs, from a terminal result. */
  battleFinished: boolean
}

export interface DefenseCampaignRuntimeOptions {
  reinforcementsEnabled?: boolean
  eliminationObjective?: boolean
  deploymentSeconds?: number
  /** Override the global schedule for a single launch. */
  reinforcementDelaySeconds?: number
  /** Resume a persisted Career mission without resetting its timeline. */
  initialSnapshot?: Partial<DefenseCampaignRuntimeSnapshot>
}

export class DefenseCampaignRuntime {
  private phase: ActiveDefenseCampaignPhase = 'deployment'
  private result: DefenseCampaignResult = null
  private deploymentElapsed = 0
  private assaultElapsed = 0
  private reinforcementTriggered = false
  private battleFinished = false

  constructor(private readonly options: DefenseCampaignRuntimeOptions = {}) {
    if (options.eliminationObjective) this.phase = 'assault'
    const saved = options.initialSnapshot
    if (saved) {
      this.phase = saved.activePhase ?? (saved.phase === 'deployment' ? 'deployment' : 'assault')
      this.result = saved.phase === 'victory' || saved.phase === 'defeat' ? saved.phase : null
      this.deploymentElapsed = Math.max(0, (options.deploymentSeconds ?? DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds) - (saved.deploymentRemainingSeconds ?? 0))
      this.assaultElapsed = Math.max(0, saved.assaultElapsedSeconds ?? 0)
      this.reinforcementTriggered = Boolean(saved.reinforcementTriggered)
      this.battleFinished = Boolean(saved.battleFinished) || saved.phase === 'victory'
    }
  }

  getSnapshot(): DefenseCampaignRuntimeSnapshot {
    return {
      phase: this.result ?? this.phase,
      activePhase: this.phase,
      deploymentRemainingSeconds: Math.max(
        0,
        this.options.eliminationObjective ? 0 : (this.options.deploymentSeconds ?? DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds) - this.deploymentElapsed,
      ),
      assaultElapsedSeconds: this.assaultElapsed,
      reinforcementRemainingSeconds: Math.max(
        0,
        (this.options.reinforcementDelaySeconds ?? DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds) - this.assaultElapsed,
      ),
      reinforcementTriggered: this.reinforcementTriggered,
      battleFinished: this.battleFinished,
    }
  }

  update(
    dt: number,
    state: DefenseCampaignCombatState,
  ): DefenseCampaignRuntimeEvent[] {
    if (this.battleFinished) return []
    const events: DefenseCampaignRuntimeEvent[] = []
    const personalAlive = Math.max(0, state.personalPlayerSideAlive ?? 0)
    const reinforcementActive = state.reinforcementActive ?? state.reinforcementSpawned
    if (this.options.eliminationObjective) {
      this.assaultElapsed += Math.max(0, dt)
      // Annihilation wins even if the last friendly dies in the same frame.
      if (state.attackersAlive === 0) {
        this.battleFinished = true
        this.result = 'victory'
        return ['battle_victory']
      }
      if (state.playerDead && state.defendersAlive + personalAlive === 0 && state.attackersAlive > 0) {
        this.battleFinished = true
        this.result = 'defeat'
        return ['battle_defeat']
      }
      return []
    }

    if (this.options.reinforcementsEnabled === false && state.playerDead && state.defendersAlive + personalAlive <= 0) {
      this.battleFinished = true
      this.result = 'defeat'
      return ['battle_defeat']
    }

    if (
      this.options.reinforcementsEnabled !== false
      && this.result === null
      && DEFENSE_CAMPAIGN_RULES.lockDefeatWhenPlayerAndOriginalDefendersEliminated
      && !reinforcementActive
      && state.playerDead
      && state.originalDefendersAlive <= 0
      && personalAlive === 0
    ) {
      // Defeat is locked, but the battlefield timeline intentionally continues.
      // Assault and scheduled relief cavalry still occur for spectator simulation.
      this.result = 'defeat'
      events.push('defeat')
    }

    if (this.phase === 'deployment') {
      this.deploymentElapsed += Math.max(0, dt)
      if (this.deploymentElapsed >= (this.options.deploymentSeconds ?? DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds)) {
        this.phase = 'assault'
        this.assaultElapsed = 0
        events.push('assault_started')
      }
      return events
    }

    this.assaultElapsed += Math.max(0, dt)
    const defenderSideAlive = state.defendersAlive + personalAlive + (state.playerDead ? 0 : 1)

    // Destroying the entire attacking army is an immediate terminal result.
    // Do this before reinforcement scheduling so a clean win never queues relief.
    if (state.attackersAlive <= 0) {
      this.battleFinished = true
      if (
        this.result === 'defeat'
        || (reinforcementActive && defenderSideAlive <= 0)
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
      this.options.reinforcementsEnabled !== false
      && !this.reinforcementTriggered
      && this.assaultElapsed >= (this.options.reinforcementDelaySeconds ?? DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds)
    ) {
      this.reinforcementTriggered = true
      events.push('reinforcement_due')
    }

    if (
      DEFENSE_CAMPAIGN_RULES.finishDefenderEliminationAfterReinforcement
      && reinforcementActive
      && defenderSideAlive <= 0
    ) {
      this.battleFinished = true
      this.result = 'defeat'
      events.push('battle_defeat')
    }

    return events
  }
}
