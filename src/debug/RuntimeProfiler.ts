/**
 * Lightweight DevCombat runtime profiler.
 * Measures CPU frame work and breakdown metrics using performance.now().
 *
 * NOTE: CPU Frame Work measures the synchronous JS work in _loop()
 * including renderer.render() submission, and does NOT equal rAF frame interval
 * or true GPU execution time.
 */

import type { NpcSubphaseSnapshot } from './NpcSubphaseProfiler'

export interface ProfilerFrameMetrics {
  cpuFrameMs: number
  npcGridMs: number
  npcUpdateMs: number
  mountInteractionMs: number
  collisionMs: number
  arrowMs: number
  impactMs: number
  renderSubmitMs: number
  otherMs: number
}

export interface MetricStat {
  avg: number
  max: number
}

export interface RuntimeProfileSnapshot {
  fps: number
  sampleCount: number
  windowDurationMs: number
  cpuFrame: MetricStat
  npcGrid: MetricStat
  npcUpdate: MetricStat
  mountInteraction: MetricStat
  collision: MetricStat
  arrow: MetricStat
  impact: MetricStat
  renderSubmit: MetricStat
  other: MetricStat
}

export interface ExtraHUDMetrics {
  npcCount: number
  aliveCount?: number
  deadCount?: number
  activeAttackCount?: number
  horseCount: number
  arrowCount: number
  drawCalls: number
  triangles: number
  mixers: number
  lodCounts: number[]
  textures: number
  geometries?: number
}

interface MetricAccumulator {
  sum: number
  max: number
}

function createAccumulator(): MetricAccumulator {
  return { sum: 0, max: 0 }
}

function updateAccumulator(acc: MetricAccumulator, value: number): void {
  acc.sum += value
  if (value > acc.max) acc.max = value
}

function finalizeStat(acc: MetricAccumulator, count: number): MetricStat {
  return {
    avg: count > 0 ? acc.sum / count : 0,
    max: acc.max,
  }
}

function resetAccumulator(acc: MetricAccumulator): void {
  acc.sum = 0
  acc.max = 0
}

export class RuntimeProfiler {
  private readonly sampleWindowMs: number
  private lastFrameTime: number | null = null
  private accumulatedDurationMs: number = 0
  private sampleCount: number = 0

  private readonly accCpuFrame = createAccumulator()
  private readonly accNpcGrid = createAccumulator()
  private readonly accNpcUpdate = createAccumulator()
  private readonly accMountInteraction = createAccumulator()
  private readonly accCollision = createAccumulator()
  private readonly accArrow = createAccumulator()
  private readonly accImpact = createAccumulator()
  private readonly accRenderSubmit = createAccumulator()
  private readonly accOther = createAccumulator()

  private latestSnapshot: RuntimeProfileSnapshot | null = null

  // NPC subphase snapshot (DEV-only, populated by recordNpcSubphase)
  private latestSubphaseSnapshot: NpcSubphaseSnapshot | null = null

  constructor(sampleWindowMs: number = 1000) {
    this.sampleWindowMs = sampleWindowMs
  }

  /**
   * Record a single frame's metrics.
   * Returns true if a new aggregation snapshot was produced this frame.
   */
  recordFrame(metrics: ProfilerFrameMetrics, now: number): boolean {
    if (this.lastFrameTime === null) {
      this.lastFrameTime = now
      return false
    }

    const dt = now - this.lastFrameTime
    this.lastFrameTime = now
    if (dt <= 0) return false

    this.accumulatedDurationMs += dt
    this.sampleCount++

    updateAccumulator(this.accCpuFrame, metrics.cpuFrameMs)
    updateAccumulator(this.accNpcGrid, metrics.npcGridMs)
    updateAccumulator(this.accNpcUpdate, metrics.npcUpdateMs)
    updateAccumulator(this.accMountInteraction, metrics.mountInteractionMs)
    updateAccumulator(this.accCollision, metrics.collisionMs)
    updateAccumulator(this.accArrow, metrics.arrowMs)
    updateAccumulator(this.accImpact, metrics.impactMs)
    updateAccumulator(this.accRenderSubmit, metrics.renderSubmitMs)
    updateAccumulator(this.accOther, metrics.otherMs)

    if (this.accumulatedDurationMs >= this.sampleWindowMs && this.sampleCount > 0) {
      const fps = (this.sampleCount / this.accumulatedDurationMs) * 1000

      this.latestSnapshot = {
        fps,
        sampleCount: this.sampleCount,
        windowDurationMs: this.accumulatedDurationMs,
        cpuFrame: finalizeStat(this.accCpuFrame, this.sampleCount),
        npcGrid: finalizeStat(this.accNpcGrid, this.sampleCount),
        npcUpdate: finalizeStat(this.accNpcUpdate, this.sampleCount),
        mountInteraction: finalizeStat(this.accMountInteraction, this.sampleCount),
        collision: finalizeStat(this.accCollision, this.sampleCount),
        arrow: finalizeStat(this.accArrow, this.sampleCount),
        impact: finalizeStat(this.accImpact, this.sampleCount),
        renderSubmit: finalizeStat(this.accRenderSubmit, this.sampleCount),
        other: finalizeStat(this.accOther, this.sampleCount),
      }

      // Reset accumulators for next window
      this.accumulatedDurationMs = 0
      this.sampleCount = 0
      resetAccumulator(this.accCpuFrame)
      resetAccumulator(this.accNpcGrid)
      resetAccumulator(this.accNpcUpdate)
      resetAccumulator(this.accMountInteraction)
      resetAccumulator(this.accCollision)
      resetAccumulator(this.accArrow)
      resetAccumulator(this.accImpact)
      resetAccumulator(this.accRenderSubmit)
      resetAccumulator(this.accOther)

      return true
    }

    return false
  }

  /**
   * Store the latest NPC subphase snapshot (produced by NpcSubphaseAggregator).
   * Called by Game._loop() after each 8-frame cohort window completes.
   * DEV-only; production never calls this.
   */
  setNpcSubphaseSnapshot(snapshot: NpcSubphaseSnapshot): void {
    this.latestSubphaseSnapshot = snapshot
  }

  getLatestSnapshot(): RuntimeProfileSnapshot | null {
    return this.latestSnapshot
  }

  getLatestSubphaseSnapshot(): NpcSubphaseSnapshot | null {
    return this.latestSubphaseSnapshot
  }

  reset(now?: number): void {
    this.lastFrameTime = now !== undefined ? now : null
    this.accumulatedDurationMs = 0
    this.sampleCount = 0
    resetAccumulator(this.accCpuFrame)
    resetAccumulator(this.accNpcGrid)
    resetAccumulator(this.accNpcUpdate)
    resetAccumulator(this.accMountInteraction)
    resetAccumulator(this.accCollision)
    resetAccumulator(this.accArrow)
    resetAccumulator(this.accImpact)
    resetAccumulator(this.accRenderSubmit)
    resetAccumulator(this.accOther)
    this.latestSubphaseSnapshot = null
  }

  /**
   * Formats HUD lines for devcombat status display.
   */
  formatHUD(extra: ExtraHUDMetrics): string {
    const s = this.latestSnapshot

    const fmtStat = (label: string, stat: MetricStat | undefined, width: number = 20): string => {
      const avgStr = stat ? stat.avg.toFixed(1) : '--'
      const maxStr = stat ? stat.max.toFixed(1) : '--'
      return `${label.padEnd(width)}: ${avgStr.padStart(5)} / ${maxStr.padStart(5)} ms`
    }

    const fpsStr = s ? s.fps.toFixed(1) : '--'
    const cpuFrameLine = fmtStat('CPU Frame Work', s?.cpuFrame, 20)

    const lines: string[] = [
      `FPS: ${fpsStr}`,
      cpuFrameLine,
      '',
      fmtStat('NPC Grid Build', s?.npcGrid, 20),
      fmtStat('NPC Update', s?.npcUpdate, 20),
      fmtStat('Mount / Interaction', s?.mountInteraction, 20),
      fmtStat('Entity Collision', s?.collision, 20),
      fmtStat('Arrow / Projectile', s?.arrow, 20),
      fmtStat('Impact / Damage', s?.impact, 20),
      fmtStat('Renderer Submit', s?.renderSubmit, 20),
      fmtStat('Other / Unaccounted', s?.other, 20),
      '',
      `NPC Count: ${extra.npcCount}`,
      ...(extra.aliveCount !== undefined ? [`Alive: ${extra.aliveCount}`] : []),
      ...(extra.deadCount !== undefined ? [`Dead: ${extra.deadCount}`] : []),
      ...(extra.activeAttackCount !== undefined ? [`Active Attack NPCs: ${extra.activeAttackCount}`] : []),
      `Horse Count: ${extra.horseCount}`,
      `Arrow Count: ${extra.arrowCount}`,
      `Main-pass Draw Calls: ${extra.drawCalls}`,
      `Main-pass Triangles: ${extra.triangles}`,
      `horses: ${extra.horseCount}`,
      `mixers: ${extra.mixers}`,
      `LOD 0/1/2: ${extra.lodCounts.join('/')}`,
      `textures: ${extra.textures}`,
    ]

    if (extra.geometries !== undefined) {
      lines.push(`geometry: ${extra.geometries}`)
    }

    // NPC subphase breakdown (DEV-only, only present when npcsubphase=1)
    const sp = this.latestSubphaseSnapshot
    if (sp) {
      const npcUpdateAvg = s?.npcUpdate.avg ?? 0

      const fmtPhase = (label: string, stat: MetricStat, w = 22): string => {
        const avgStr = stat.avg.toFixed(2)
        const pct = npcUpdateAvg > 0 ? (stat.avg / npcUpdateAvg * 100).toFixed(0) : '--'
        return `  ${label.padEnd(w)}: ${avgStr.padStart(6)} ms  ${pct.padStart(3)}%`
      }

      // Sum of all classified phases for Other estimation
      const classifiedSum =
        sp.gridQuery.avg + sp.targetAI.avg + sp.separation.avg +
        sp.obstacleAvoid.avg + sp.moveFace.avg + sp.combatLogic.avg +
        sp.humanoidAnim.avg + sp.mountUpdate.avg + sp.footPhysics.avg +
        sp.deadUpdate.avg
      const otherEst = Math.max(0, npcUpdateAvg - classifiedSum)
      const otherPct = npcUpdateAvg > 0 ? (otherEst / npcUpdateAvg * 100).toFixed(0) : '--'
      const mountUpdateAvg = sp.mountUpdate.avg
      const mountInternalSum =
        sp.mountPhysics.avg + sp.mountObstacleCollision.avg +
        sp.mountHorseAnimation.avg + sp.mountRiderEquipment.avg +
        sp.mountSaddleTransform.avg + sp.mountRiderTransform.avg
      const mountOtherEst = Math.max(0, mountUpdateAvg - mountInternalSum)
      const mountOtherPct = mountUpdateAvg > 0 ? (mountOtherEst / mountUpdateAvg * 100).toFixed(0) : '--'
      const fmtMountPhase = (label: string, stat: MetricStat): string => {
        const avgStr = stat.avg.toFixed(2)
        const pct = mountUpdateAvg > 0 ? (stat.avg / mountUpdateAvg * 100).toFixed(0) : '--'
        return `  ${label.padEnd(22)}: ${avgStr.padStart(6)} ms  ${pct.padStart(3)}%`
      }

      lines.push(
        '',
        '── NPC Subphase (cohort estimate) ──',
        fmtPhase('Grid Nearby Query', sp.gridQuery),
        fmtPhase('Target / AI', sp.targetAI),
        fmtPhase('Separation', sp.separation),
        fmtPhase('Obstacle Avoidance', sp.obstacleAvoid),
        fmtPhase('Movement / Facing', sp.moveFace),
        fmtPhase('Combat Logic', sp.combatLogic),
        fmtPhase('Humanoid Animation', sp.humanoidAnim),
        fmtPhase('Mount Update', sp.mountUpdate),
        '  ├─ Mount internal breakdown',
        fmtMountPhase('Physics / Gravity', sp.mountPhysics),
        fmtMountPhase('Obstacle Collision', sp.mountObstacleCollision),
        fmtMountPhase('Horse Animation', sp.mountHorseAnimation),
        fmtMountPhase('Rider Equipment', sp.mountRiderEquipment),
        fmtMountPhase('Saddle World Transform', sp.mountSaddleTransform),
        fmtMountPhase('Rider Transform', sp.mountRiderTransform),
        `  ${'Mount Other (est.)'.padEnd(22)}: ${mountOtherEst.toFixed(2).padStart(6)} ms  ${mountOtherPct.padStart(3)}%`,
        fmtPhase('Foot Physics', sp.footPhysics),
        fmtPhase('Dead Update', sp.deadUpdate),
        `  ${'Other (est.)'.padEnd(22)}: ${otherEst.toFixed(2).padStart(6)} ms  ${otherPct.padStart(3)}%`,
        `  (subphase = cohort est.; % relative to NPC Update raw)`,
      )
    }

    return lines.join('\n')
  }
}
