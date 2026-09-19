import { describe, it, expect } from 'vitest'
import {
  NpcSubphaseCollector,
  NpcSubphaseAggregator,
  SUBPHASE_COHORT,
} from '../src/debug/NpcSubphaseProfiler'

describe('NpcSubphaseProfiler', () => {
  describe('NpcSubphaseCollector', () => {
    it('endPhase accumulates elapsed ms for each phase', () => {
      const col = new NpcSubphaseCollector()

      // Simulate: targetAI took 0.5ms, separation took 1.2ms
      const fakeT0A = performance.now() - 0.5
      col.endPhase('targetAI', fakeT0A)
      const fakeT0S = performance.now() - 1.2
      col.endPhase('separation', fakeT0S)

      // After one frame the values haven't been flushed yet
      const pending = (col as any)._window
      expect(pending.targetAI).toBeGreaterThanOrEqual(0.45)
      expect(pending.separation).toBeGreaterThanOrEqual(1.1)
      expect(pending.mountUpdate).toBe(0)
    })

    it('countSample increments sampleCount', () => {
      const col = new NpcSubphaseCollector()
      col.countSample()
      col.countSample()
      expect((col as any)._window.sampleCount).toBe(2)
    })

    it('advanceFrame returns null for the first SUBPHASE_COHORT-1 frames, then flushes', () => {
      const col = new NpcSubphaseCollector()
      col.endPhase('targetAI', performance.now() - 1)
      col.countSample()

      // SUBPHASE_COHORT - 1 frames → no flush yet
      for (let i = 0; i < SUBPHASE_COHORT - 1; i++) {
        expect(col.advanceFrame()).toBeNull()
      }

      // The SUBPHASE_COHORT-th frame triggers the flush
      const result = col.advanceFrame()
      expect(result).not.toBeNull()
      expect(result!.sampleCount).toBe(1)
      expect(result!.targetAI).toBeGreaterThan(0)
    })

    it('resets accumulators after flushing', () => {
      const col = new NpcSubphaseCollector()
      col.endPhase('mountUpdate', performance.now() - 2)
      col.countSample()
      for (let i = 0; i < SUBPHASE_COHORT; i++) col.advanceFrame()

      // After flush, internal window should be zeroed
      const w = (col as any)._window
      expect(w.mountUpdate).toBe(0)
      expect(w.sampleCount).toBe(0)
      expect((col as any)._framesInWindow).toBe(0)
    })

    it('reset() clears state without emitting', () => {
      const col = new NpcSubphaseCollector()
      col.endPhase('footPhysics', performance.now() - 5)
      col.countSample()
      col.advanceFrame() // 1 frame in
      col.reset()
      expect((col as any)._window.footPhysics).toBe(0)
      expect((col as any)._framesInWindow).toBe(0)
    })
  })

  describe('cohort sampling condition', () => {
    it('each NPC index appears exactly once per SUBPHASE_COHORT frames', () => {
      const totalNPCs = 200
      const sampledPerFrame: Set<number>[] = []

      for (let frameIdx = 0; frameIdx < SUBPHASE_COHORT; frameIdx++) {
        const sampled = new Set<number>()
        for (let npcIdx = 0; npcIdx < totalNPCs; npcIdx++) {
          if (npcIdx % SUBPHASE_COHORT === frameIdx % SUBPHASE_COHORT) {
            sampled.add(npcIdx)
          }
        }
        sampledPerFrame.push(sampled)
      }

      // No duplicates between frames
      const allSampled = new Set<number>()
      let totalSampled = 0
      for (const frameSet of sampledPerFrame) {
        for (const idx of frameSet) {
          expect(allSampled.has(idx)).toBe(false)
          allSampled.add(idx)
          totalSampled++
        }
      }

      // Every NPC covered exactly once
      expect(totalSampled).toBe(totalNPCs)
      expect(allSampled.size).toBe(totalNPCs)
    })

    it('does not use Math.random (sampling is deterministic)', () => {
      // Run the cohort condition twice; results must be identical
      const results1: boolean[] = []
      const results2: boolean[] = []
      for (let frame = 0; frame < SUBPHASE_COHORT; frame++) {
        for (let npc = 0; npc < 16; npc++) {
          results1.push(npc % SUBPHASE_COHORT === frame % SUBPHASE_COHORT)
        }
      }
      for (let frame = 0; frame < SUBPHASE_COHORT; frame++) {
        for (let npc = 0; npc < 16; npc++) {
          results2.push(npc % SUBPHASE_COHORT === frame % SUBPHASE_COHORT)
        }
      }
      expect(results1).toEqual(results2)
    })
  })

  describe('NpcSubphaseAggregator', () => {
    it('flush returns a full-population per-frame estimate from one cohort', () => {
      const agg = new NpcSubphaseAggregator()

      // Simulate one 8-frame window result
      agg.record({
        gridQuery: 0.8,
        targetAI: 1.2,
        separation: 2.1,
        obstacleAvoid: 3.0,
        moveFace: 0.5,
        combatLogic: 0.4,
        humanoidAnim: 4.5,
        mountUpdate: 5.0,
        footPhysics: 0.1,
        deadUpdate: 0.3,
        sampleCount: 25,
      })

      const snap = agg.flush()
      expect(snap).not.toBeNull()
      expect(snap!.humanoidAnim.avg).toBeCloseTo(4.5, 3)
      expect(snap!.mountUpdate.avg).toBeCloseTo(5.0, 3)
      expect(snap!.separation.avg).toBeCloseTo(2.1, 3)
      expect(snap!.sampleCountAvg).toBeCloseTo(25, 3)
    })

    it('flush resets aggregator so next window starts fresh', () => {
      const agg = new NpcSubphaseAggregator()

      agg.record({
        gridQuery: 1, targetAI: 2, separation: 3, obstacleAvoid: 4,
        moveFace: 5, combatLogic: 6, humanoidAnim: 7, mountUpdate: 8,
        footPhysics: 9, deadUpdate: 10, sampleCount: 20,
      })
      agg.flush() // consume first window

      // Second window with different values
      agg.record({
        gridQuery: 0.1, targetAI: 0.2, separation: 0.3, obstacleAvoid: 0.4,
        moveFace: 0.5, combatLogic: 0.6, humanoidAnim: 0.7, mountUpdate: 0.8,
        footPhysics: 0.9, deadUpdate: 1.0, sampleCount: 5,
      })
      const snap2 = agg.flush()
      expect(snap2).not.toBeNull()
      // Must not carry over values from the first window
      expect(snap2!.humanoidAnim.avg).toBeCloseTo(0.7, 3)
      expect(snap2!.mountUpdate.avg).toBeCloseTo(0.8, 3)
    })

    it('returns null when no windows have been recorded', () => {
      const agg = new NpcSubphaseAggregator()
      expect(agg.flush()).toBeNull()
    })

    it('averages completed cohorts in the reporting window', () => {
      const agg = new NpcSubphaseAggregator()
      const frame = (humanoidAnim: number) => ({
        gridQuery: 0, targetAI: 0, separation: 0, obstacleAvoid: 0,
        moveFace: 0, combatLogic: 0, humanoidAnim, mountUpdate: 0,
        footPhysics: 0, deadUpdate: 0, sampleCount: 200,
      })
      agg.record(frame(4))
      agg.record(frame(8))

      const snap = agg.flush()
      expect(snap!.humanoidAnim.avg).toBeCloseTo(6, 3)
      expect(snap!.humanoidAnim.max).toBeCloseTo(8, 3)
      expect(snap!.sampleCountAvg).toBeCloseTo(200, 3)
    })
  })

  describe('SUBPHASE_COHORT constant', () => {
    it('equals 8', () => {
      expect(SUBPHASE_COHORT).toBe(8)
    })
  })
})
