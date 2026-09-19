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

/** Internal work measured inside the humanoid animation phase. */
export type HumanoidAnimationPhase =
  | 'mixerUpdate'        // AnimationMixer.update() and retained mixer debt
  | 'locomotionState'    // repeated play() state/loop/time-scale setup
  | 'proceduralPose'     // procedural melee/idle pose writes
  | 'equipmentState'     // equipment flags, hand morphs, bow locomotion state
  | 'bowLancePose'       // bow/lance procedural pose and bow visual update
  | 'rigBoneApplication' // equipment IK, mounted pose, morphs, socket followers

const PHASES: NpcSubphasePhase[] = [
  'gridQuery', 'targetAI', 'separation', 'obstacleAvoid', 'moveFace',
  'combatLogic', 'humanoidAnim', 'mountUpdate', 'footPhysics', 'deadUpdate',
]

const HUMANOID_PHASES: HumanoidAnimationPhase[] = [
  'mixerUpdate', 'locomotionState', 'proceduralPose', 'equipmentState',
  'bowLancePose', 'rigBoneApplication',
]

export type HumanoidAnimationFrame = Record<HumanoidAnimationPhase, number>

export type HumanoidAnimationStat = Record<HumanoidAnimationPhase, NpcSubphaseStat>

function emptyHumanoidFrame(): HumanoidAnimationFrame {
  return {
    mixerUpdate: 0,
    locomotionState: 0,
    proceduralPose: 0,
    equipmentState: 0,
    bowLancePose: 0,
    rigBoneApplication: 0,
  }
}

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
  /** Internal breakdown of the humanoidAnim phase for sampled NPCs. */
  humanoid: HumanoidAnimationFrame
  /** Number of NPC samples collected in this window (alive + dead). */
  sampleCount: number
}

function emptyFrame(): NpcSubphaseFrame {
  return {
    gridQuery: 0, targetAI: 0, separation: 0, obstacleAvoid: 0, moveFace: 0,
    combatLogic: 0, humanoidAnim: 0, mountUpdate: 0, footPhysics: 0, deadUpdate: 0,
    humanoid: emptyHumanoidFrame(),
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

  /** Call at the end of one internal humanoid-animation span. */
  endHumanoidPhase(phase: HumanoidAnimationPhase, t0: number): void {
    this._window.humanoid[phase] += performance.now() - t0
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
  humanoidBreakdown: HumanoidAnimationStat
  /** Avg sample count per 8-frame window. */
  sampleCountAvg: number
}

/** Accumulates 8-frame flush results over a 1-second reporting window. */
export class NpcSubphaseAggregator {
  private _windowCount = 0
  private _acc: Record<NpcSubphasePhase, { sum: number; max: number }> = {} as any
  private _humanoidAcc: Record<HumanoidAnimationPhase, { sum: number; max: number }> = {} as any
  private _sampleCountSum = 0

  constructor() {
    this._resetAcc()
  }

  private _resetAcc(): void {
    for (const p of PHASES) {
      this._acc[p] = { sum: 0, max: 0 }
    }
    for (const p of HUMANOID_PHASES) {
      this._humanoidAcc[p] = { sum: 0, max: 0 }
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
      // Eight frames contain one sampled eighth of the NPCs per frame, so a
      // completed cohort has measured every NPC exactly once. Its total is
      // therefore already the estimated full-population per-frame phase cost.
      const v = frame[p]
      this._acc[p].sum += v
      if (v > this._acc[p].max) this._acc[p].max = v
    }
    for (const p of HUMANOID_PHASES) {
      const v = frame.humanoid[p]
      this._humanoidAcc[p].sum += v
      if (v > this._humanoidAcc[p].max) this._humanoidAcc[p].max = v
    }
  }

  /** Emit the cohorts accumulated during one RuntimeProfiler reporting window. */
  flush(): NpcSubphaseSnapshot | null {
    if (this._windowCount === 0) return null
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
      humanoidBreakdown: this._humanoidStat(n),
      sampleCountAvg: n > 0 ? this._sampleCountSum / n : 0,
    }
    this._resetAcc()
    return snap
  }

  /** Discard partial cohort aggregation when the matching runtime window resets. */
  reset(): void {
    this._resetAcc()
  }

  private _stat(p: NpcSubphasePhase, n: number): NpcSubphaseStat {
    return { avg: n > 0 ? this._acc[p].sum / n : 0, max: this._acc[p].max }
  }

  private _humanoidStat(n: number): HumanoidAnimationStat {
    return {
      mixerUpdate: this._humanoidStatFor('mixerUpdate', n),
      locomotionState: this._humanoidStatFor('locomotionState', n),
      proceduralPose: this._humanoidStatFor('proceduralPose', n),
      equipmentState: this._humanoidStatFor('equipmentState', n),
      bowLancePose: this._humanoidStatFor('bowLancePose', n),
      rigBoneApplication: this._humanoidStatFor('rigBoneApplication', n),
    }
  }

  private _humanoidStatFor(phase: HumanoidAnimationPhase, n: number): NpcSubphaseStat {
    return { avg: n > 0 ? this._humanoidAcc[phase].sum / n : 0, max: this._humanoidAcc[phase].max }
  }
}
