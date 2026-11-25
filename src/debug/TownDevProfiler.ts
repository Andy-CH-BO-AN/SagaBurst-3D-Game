/**
 * Lightweight DEV-only segmented profiler for Town and Four-Gate benchmarks.
 * Pure TypeScript (no Three.js) and stripped by Vite in production builds.
 */

export type TownDevSegmentKey =
  | 'missionFlowMs'
  | 'gridBuildMs'
  | 'siegeMs'
  | 'actorUpdateMs'
  | 'collisionMs'
  | 'shotsMs'
  | 'persistMs'
  | 'hudMs'

export interface TownDevFrameRecord {
  readonly frameTotalMs: number
  readonly missionFlowMs: number
  readonly gridBuildMs: number
  readonly siegeMs: number
  readonly actorUpdateMs: number
  readonly collisionMs: number
  readonly shotsMs: number
  readonly persistMs: number
  readonly hudMs: number
}

export interface TownSaveTelemetryRecord {
  readonly atMs: number
  readonly parseMs: number
  readonly cloneMs: number
  readonly stringifyMs: number
  readonly setItemMs: number
  readonly totalMs: number
  readonly bytes: number
}

export interface TownSegmentStats {
  readonly medianMs: number | null
  readonly p95Ms: number | null
  readonly maxMs: number | null
}

export interface TownSaveTelemetrySummary {
  readonly count: number
  readonly totalMsSum: number
  readonly medianTotalMs: number | null
  readonly maxTotalMs: number | null
  readonly medianParseMs: number | null
  readonly medianCloneMs: number | null
  readonly medianStringifyMs: number | null
  readonly medianSetItemMs: number | null
  readonly medianBytes: number | null
  readonly maxBytes: number | null
}

export interface TownDevProfilerSummary {
  readonly frameCount: number
  readonly segments: {
    readonly frameTotalMs: TownSegmentStats
    readonly missionFlowMs: TownSegmentStats
    readonly gridBuildMs: TownSegmentStats
    readonly siegeMs: TownSegmentStats
    readonly actorUpdateMs: TownSegmentStats
    readonly collisionMs: TownSegmentStats
    readonly shotsMs: TownSegmentStats
    readonly persistMs: TownSegmentStats
    readonly hudMs: TownSegmentStats
  }
  readonly saves: TownSaveTelemetrySummary
}

const MAX_FRAMES = 3600
const MAX_SAVES = 500

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function summarizeSeries(values: readonly number[]): TownSegmentStats {
  if (values.length === 0) return { medianMs: null, p95Ms: null, maxMs: null }
  let maxMs = -Infinity
  for (let i = 0; i < values.length; i++) if (values[i] > maxMs) maxMs = values[i]
  return {
    medianMs: median(values),
    p95Ms: percentile(values, 0.95),
    maxMs,
  }
}

export class TownDevProfiler {
  private enabled = false
  private frames: TownDevFrameRecord[] = []
  private saves: TownSaveTelemetryRecord[] = []
  private curMissionFlow = 0
  private curGridBuild = 0
  private curSiege = 0
  private curActorUpdate = 0
  private curCollision = 0
  private curShots = 0
  private curPersist = 0
  private curHud = 0

  isEnabled(): boolean {
    return this.enabled
  }

  enableAndReset(): void {
    this.enabled = true
    this.frames.length = 0
    this.saves.length = 0
    this.resetCurrent()
  }

  disable(): void {
    this.enabled = false
    this.resetCurrent()
  }

  beginFrame(): void {
    if (!this.enabled) return
    this.resetCurrent()
  }

  add(key: TownDevSegmentKey, ms: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0) return
    switch (key) {
      case 'missionFlowMs': this.curMissionFlow += ms; break
      case 'gridBuildMs': this.curGridBuild += ms; break
      case 'siegeMs': this.curSiege += ms; break
      case 'actorUpdateMs': this.curActorUpdate += ms; break
      case 'collisionMs': this.curCollision += ms; break
      case 'shotsMs': this.curShots += ms; break
      case 'persistMs': this.curPersist += ms; break
      case 'hudMs': this.curHud += ms; break
    }
  }

  endFrame(frameTotalMs: number): void {
    if (!this.enabled) return
    if (this.frames.length >= MAX_FRAMES) this.frames.shift()
    this.frames.push({
      frameTotalMs,
      missionFlowMs: this.curMissionFlow,
      gridBuildMs: this.curGridBuild,
      siegeMs: this.curSiege,
      actorUpdateMs: this.curActorUpdate,
      collisionMs: this.curCollision,
      shotsMs: this.curShots,
      persistMs: this.curPersist,
      hudMs: this.curHud,
    })
  }

  recordSave(record: TownSaveTelemetryRecord): void {
    if (!this.enabled) return
    if (this.saves.length >= MAX_SAVES) this.saves.shift()
    this.saves.push(record)
  }

  readSummary(): TownDevProfilerSummary {
    const frames = this.frames
    const saves = this.saves
    let saveSum = 0
    let maxSaveMs = 0
    let maxBytes = 0
    for (const s of saves) {
      saveSum += s.totalMs
      if (s.totalMs > maxSaveMs) maxSaveMs = s.totalMs
      if (s.bytes > maxBytes) maxBytes = s.bytes
    }
    return {
      frameCount: frames.length,
      segments: {
        frameTotalMs: summarizeSeries(frames.map(f => f.frameTotalMs)),
        missionFlowMs: summarizeSeries(frames.map(f => f.missionFlowMs)),
        gridBuildMs: summarizeSeries(frames.map(f => f.gridBuildMs)),
        siegeMs: summarizeSeries(frames.map(f => f.siegeMs)),
        actorUpdateMs: summarizeSeries(frames.map(f => f.actorUpdateMs)),
        collisionMs: summarizeSeries(frames.map(f => f.collisionMs)),
        shotsMs: summarizeSeries(frames.map(f => f.shotsMs)),
        persistMs: summarizeSeries(frames.map(f => f.persistMs)),
        hudMs: summarizeSeries(frames.map(f => f.hudMs)),
      },
      saves: {
        count: saves.length,
        totalMsSum: saveSum,
        medianTotalMs: median(saves.map(s => s.totalMs)),
        maxTotalMs: saves.length ? maxSaveMs : null,
        medianParseMs: median(saves.map(s => s.parseMs)),
        medianCloneMs: median(saves.map(s => s.cloneMs)),
        medianStringifyMs: median(saves.map(s => s.stringifyMs)),
        medianSetItemMs: median(saves.map(s => s.setItemMs)),
        medianBytes: median(saves.map(s => s.bytes)),
        maxBytes: saves.length ? maxBytes : null,
      },
    }
  }

  private resetCurrent(): void {
    this.curMissionFlow = 0
    this.curGridBuild = 0
    this.curSiege = 0
    this.curActorUpdate = 0
    this.curCollision = 0
    this.curShots = 0
    this.curPersist = 0
    this.curHud = 0
  }
}

let devCareerSaveSink: ((record: TownSaveTelemetryRecord) => void) | null = null

export function setDevCareerSaveTelemetrySink(sink: ((record: TownSaveTelemetryRecord) => void) | null): void {
  devCareerSaveSink = sink
}

export function hasDevCareerSaveTelemetrySink(): boolean {
  return devCareerSaveSink !== null
}

export function recordDevCareerSaveTelemetry(record: TownSaveTelemetryRecord): void {
  devCareerSaveSink?.(record)
}
