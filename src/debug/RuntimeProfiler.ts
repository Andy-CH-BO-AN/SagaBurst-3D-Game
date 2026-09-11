/**
 * Lightweight DevCombat runtime profiler.
 * Measures CPU frame work and breakdown metrics using performance.now().
 *
 * NOTE: CPU Frame Work measures the synchronous JS work in _loop()
 * including renderer.render() submission, and does NOT equal rAF frame interval
 * or true GPU execution time.
 */

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
  private hasWindowStarted: boolean = false
  private windowStart: number = 0
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

  constructor(sampleWindowMs: number = 1000) {
    this.sampleWindowMs = sampleWindowMs
  }

  /**
   * Record a single frame's metrics.
   * Returns true if a new aggregation snapshot was produced this frame.
   */
  recordFrame(metrics: ProfilerFrameMetrics, now: number): boolean {
    if (!this.hasWindowStarted) {
      this.windowStart = now
      this.hasWindowStarted = true
    }

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

    const elapsed = now - this.windowStart
    if (elapsed >= this.sampleWindowMs && this.sampleCount > 0) {
      const fps = (this.sampleCount / elapsed) * 1000

      this.latestSnapshot = {
        fps,
        sampleCount: this.sampleCount,
        windowDurationMs: elapsed,
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
      this.windowStart = now
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

  getLatestSnapshot(): RuntimeProfileSnapshot | null {
    return this.latestSnapshot
  }

  reset(now?: number): void {
    if (now !== undefined) {
      this.windowStart = now
      this.hasWindowStarted = true
    } else {
      this.windowStart = 0
      this.hasWindowStarted = false
    }
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
      `Horse Count: ${extra.horseCount}`,
      `Arrow Count: ${extra.arrowCount}`,
      `Draw Calls: ${extra.drawCalls}`,
      `Triangles: ${extra.triangles}`,
      `horses: ${extra.horseCount}`,
      `mixers: ${extra.mixers}`,
      `LOD 0/1/2: ${extra.lodCounts.join('/')}`,
      `textures: ${extra.textures}`,
    ]

    if (extra.geometries !== undefined) {
      lines.push(`geometry: ${extra.geometries}`)
    }

    return lines.join('\n')
  }
}
