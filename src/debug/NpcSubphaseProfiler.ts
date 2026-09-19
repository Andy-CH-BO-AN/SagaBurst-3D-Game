/**
 * NpcSubphaseProfiler.ts
 * DEV-only NPC update subphase measurement helpers.
 *
 * Production builds tree-shake this module entirely because every usage site
 * is guarded by `import.meta.env.DEV`.
 *
 * Sampling strategy: 8-frame cohort window.
 *   Frame N measures NPCs where  npcIndex % SUBPHASE_COHORT === N % SUBPHASE_COHORT
 *   After 8 frames every NPC has been sampled exactly once.
 *   The 8-frame window is then flushed to produce one snapshot.
 */

export const SUBPHASE_COHORT = 8

/** All phases tracked inside NPC.update() plus gridQuery (measured in Game._loop). */
export type NpcSubphasePhase =
  | 'gridQuery'     // npcGrid.getNearbyInto() – measured in Game._loop()
  | 'targetAI'      // _getTarget(), cached validation, periodic reacquisition
  | 'separation'    // nearbyNPCs iteration, distance calc, _tmpSep/_tmpPush
  | 'obstacleAvoid' // getObstacleAvoidanceDirection() calls
  | 'moveFace'      // _faceTarget(), _moveByDirection(), clampToPlayableWorld()
  | 'combatLogic'   // melee range, attack timer, hit window, ranged state logic
  | 'humanoidAnim'  // animator.update(), poseIdle, poseBow, setLocomotion
  | 'mountUpdate'   // mount.finishControlledFrame(), _syncToMount()
  | 'footPhysics'   // gravity, getTerrainHeight(), resolveObstacleCollision()
  | 'deadUpdate'    // dead NPC path: flash, death anim, respawn

const PHASES: NpcSubphasePhase[] = [
  'gridQuery', 'targetAI', 'separation', 'obstacleAvoid', 'moveFace',
  'combatLogic', 'humanoidAnim', 'mountUpdate', 'footPhysics', 'deadUpdate',
]

/** Accumulated ms for each phase across one 8-frame cohort window. */
export interface NpcSubphaseFrame {
  gridQuery: number
  targetAI: number
  separation: number
  obstacleAvoid: number
  moveFace: number
  combatLogic: number
  humanoidAnim: number
  mountUpdate: number
  footPhysics: number
  deadUpdate: number
  /** Number of NPC samples collected in this window (alive + dead). */
  sampleCount: number
}

function emptyFrame(): NpcSubphaseFrame {
  return {
    gridQuery: 0, targetAI: 0, separation: 0, obstacleAvoid: 0, moveFace: 0,
    combatLogic: 0, humanoidAnim: 0, mountUpdate: 0, footPhysics: 0, deadUpdate: 0,
    sampleCount: 0,
  }
}

/**
 * Collects per-NPC subphase timings for the current frame's cohort slice.
 * One instance lives in Game; NPC.update() receives it (or null in production).
 *
 * Usage inside NPC.update():
 *   if (import.meta.env.DEV && _collector) {
 *     const _t0 = performance.now()
 *     // ... phase work ...
 *     _collector.endPhase('targetAI', _t0)
 *   }
 */
export class NpcSubphaseCollector {
  private _window: NpcSubphaseFrame = emptyFrame()
  private _framesInWindow = 0

  /** Call at the end of a phase to record elapsed ms since t0. */
  endPhase(phase: NpcSubphasePhase, t0: number): void {
    this._window[phase] += performance.now() - t0
  }

  /** Call once per sampled NPC to track sample count. */
  countSample(): void {
    this._window.sampleCount++
  }

  /**
   * Called by Game._loop() after every frame.
   * Returns the completed window data and resets after SUBPHASE_COHORT frames.
   * Returns null if the window is not yet complete.
   */
  advanceFrame(): NpcSubphaseFrame | null {
    this._framesInWindow++
    if (this._framesInWindow < SUBPHASE_COHORT) return null

    const result = this._window
    this._window = emptyFrame()
    this._framesInWindow = 0
    return result
  }

  /** Force-reset without emitting (e.g. on scene change). */
  reset(): void {
    this._window = emptyFrame()
    this._framesInWindow = 0
  }
}

/** Avg and max stat for one subphase over the 1-second reporting window. */
export interface NpcSubphaseStat {
  avg: number
  max: number
}

/** One reporting-window snapshot of all subphase stats. */
export interface NpcSubphaseSnapshot {
  gridQuery: NpcSubphaseStat
  targetAI: NpcSubphaseStat
  separation: NpcSubphaseStat
  obstacleAvoid: NpcSubphaseStat
  moveFace: NpcSubphaseStat
  combatLogic: NpcSubphaseStat
  humanoidAnim: NpcSubphaseStat
  mountUpdate: NpcSubphaseStat
  footPhysics: NpcSubphaseStat
  deadUpdate: NpcSubphaseStat
  /** Avg sample count per 8-frame window. */
  sampleCountAvg: number
}

/** Accumulates 8-frame flush results over a 1-second reporting window. */
export class NpcSubphaseAggregator {
  private _windowCount = 0
  private _acc: Record<NpcSubphasePhase, { sum: number; max: number }> = {} as any
  private _sampleCountSum = 0

  constructor() {
    this._resetAcc()
  }

  private _resetAcc(): void {
    for (const p of PHASES) {
      this._acc[p] = { sum: 0, max: 0 }
    }
    this._sampleCountSum = 0
    this._windowCount = 0
  }

  /**
   * Record one flushed 8-frame window.
   * Returns a snapshot if enough windows have accumulated (≥ 1).
   * (The RuntimeProfiler drives the 1-second cadence via recordNpcSubphase.)
   */
  record(frame: NpcSubphaseFrame): void {
    this._windowCount++
    this._sampleCountSum += frame.sampleCount
    for (const p of PHASES) {
      // A full cohort contains one sampled eighth of the NPCs from each of
      // eight frames. Normalize its total to the same per-frame scale as the
      // RuntimeProfiler NPC Update raw metric before reporting it.
      const v = frame[p] / SUBPHASE_COHORT
      this._acc[p].sum += v
      if (v > this._acc[p].max) this._acc[p].max = v
    }
  }

  flush(windowCount: number): NpcSubphaseSnapshot | null {
    if (windowCount <= 0 || this._windowCount === 0) return null
    const n = this._windowCount
    const snap: NpcSubphaseSnapshot = {
      gridQuery: this._stat('gridQuery', n),
      targetAI: this._stat('targetAI', n),
      separation: this._stat('separation', n),
      obstacleAvoid: this._stat('obstacleAvoid', n),
      moveFace: this._stat('moveFace', n),
      combatLogic: this._stat('combatLogic', n),
      humanoidAnim: this._stat('humanoidAnim', n),
      mountUpdate: this._stat('mountUpdate', n),
      footPhysics: this._stat('footPhysics', n),
      deadUpdate: this._stat('deadUpdate', n),
      sampleCountAvg: n > 0 ? this._sampleCountSum / n : 0,
    }
    this._resetAcc()
    return snap
  }

  private _stat(p: NpcSubphasePhase, n: number): NpcSubphaseStat {
    return { avg: n > 0 ? this._acc[p].sum / n : 0, max: this._acc[p].max }
  }
}
