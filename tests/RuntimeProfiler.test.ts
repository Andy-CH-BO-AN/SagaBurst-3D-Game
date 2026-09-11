import { describe, it, expect } from 'vitest'
import { RuntimeProfiler, ProfilerFrameMetrics } from '../src/debug/RuntimeProfiler'

describe('RuntimeProfiler', () => {
  it('aggregates avg and max accurately over a sampling window', () => {
    const profiler = new RuntimeProfiler(1000)

    const frame1: ProfilerFrameMetrics = {
      cpuFrameMs: 100,
      npcGridMs: 2,
      npcUpdateMs: 40,
      mountInteractionMs: 4,
      collisionMs: 20,
      arrowMs: 5,
      impactMs: 1,
      renderSubmitMs: 20,
      otherMs: 8,
    }

    const frame2: ProfilerFrameMetrics = {
      cpuFrameMs: 120,
      npcGridMs: 4,
      npcUpdateMs: 50,
      mountInteractionMs: 6,
      collisionMs: 30,
      arrowMs: 7,
      impactMs: 3,
      renderSubmitMs: 10,
      otherMs: 10,
    }

    // Frame 1 at t=0
    expect(profiler.recordFrame(frame1, 0)).toBe(false)
    expect(profiler.getLatestSnapshot()).toBeNull()

    // Frame 2 at t=1000 (completes 1000ms window)
    const emitted = profiler.recordFrame(frame2, 1000)
    expect(emitted).toBe(true)

    const snapshot = profiler.getLatestSnapshot()
    expect(snapshot).not.toBeNull()
    if (!snapshot) return

    expect(snapshot.sampleCount).toBe(2)
    expect(snapshot.windowDurationMs).toBe(1000)
    // 2 samples in 1000ms = 2.0 FPS
    expect(snapshot.fps).toBeCloseTo(2.0, 3)

    // CPU Frame Work: avg = (100 + 120)/2 = 110, max = 120
    expect(snapshot.cpuFrame.avg).toBeCloseTo(110, 3)
    expect(snapshot.cpuFrame.max).toBe(120)

    // NPC Update: avg = (40 + 50)/2 = 45, max = 50
    expect(snapshot.npcUpdate.avg).toBeCloseTo(45, 3)
    expect(snapshot.npcUpdate.max).toBe(50)

    // Collision: avg = (20 + 30)/2 = 25, max = 30
    expect(snapshot.collision.avg).toBeCloseTo(25, 3)
    expect(snapshot.collision.max).toBe(30)

    // Other: avg = (8 + 10)/2 = 9, max = 10
    expect(snapshot.other.avg).toBeCloseTo(9, 3)
    expect(snapshot.other.max).toBe(10)
  })

  it('resets accumulators cleanly for the next sampling window', () => {
    const profiler = new RuntimeProfiler(1000)

    // First window (0 to 1000ms)
    profiler.recordFrame({
      cpuFrameMs: 80,
      npcGridMs: 1,
      npcUpdateMs: 30,
      mountInteractionMs: 2,
      collisionMs: 10,
      arrowMs: 2,
      impactMs: 1,
      renderSubmitMs: 25,
      otherMs: 9,
    }, 0)
    profiler.recordFrame({
      cpuFrameMs: 90,
      npcGridMs: 1,
      npcUpdateMs: 35,
      mountInteractionMs: 2,
      collisionMs: 15,
      arrowMs: 3,
      impactMs: 1,
      renderSubmitMs: 25,
      otherMs: 8,
    }, 1000)

    expect(profiler.getLatestSnapshot()?.cpuFrame.max).toBe(90)

    // Second window (1000 to 2000ms) with lower values
    profiler.recordFrame({
      cpuFrameMs: 40,
      npcGridMs: 0.5,
      npcUpdateMs: 15,
      mountInteractionMs: 1,
      collisionMs: 5,
      arrowMs: 1,
      impactMs: 0.5,
      renderSubmitMs: 12,
      otherMs: 5,
    }, 1500)
    profiler.recordFrame({
      cpuFrameMs: 50,
      npcGridMs: 0.5,
      npcUpdateMs: 20,
      mountInteractionMs: 1,
      collisionMs: 6,
      arrowMs: 1,
      impactMs: 0.5,
      renderSubmitMs: 15,
      otherMs: 6,
    }, 2050)

    const snapshot2 = profiler.getLatestSnapshot()
    expect(snapshot2).not.toBeNull()
    // Max in window 2 must be 50, not carry over 90 from window 1
    expect(snapshot2?.cpuFrame.max).toBe(50)
    expect(snapshot2?.cpuFrame.avg).toBeCloseTo(45, 3)
  })

  it('formats HUD output with both required profiling metrics and existing fields', () => {
    const profiler = new RuntimeProfiler(1000)

    profiler.recordFrame({
      cpuFrameMs: 100,
      npcGridMs: 1.5,
      npcUpdateMs: 35,
      mountInteractionMs: 3.2,
      collisionMs: 25.1,
      arrowMs: 2,
      impactMs: 0.8,
      renderSubmitMs: 22,
      otherMs: 10.4,
    }, 0)
    profiler.recordFrame({
      cpuFrameMs: 110,
      npcGridMs: 1.5,
      npcUpdateMs: 40,
      mountInteractionMs: 3.2,
      collisionMs: 25.1,
      arrowMs: 2,
      impactMs: 0.8,
      renderSubmitMs: 22,
      otherMs: 15.4,
    }, 1000)

    const hud = profiler.formatHUD({
      npcCount: 200,
      horseCount: 50,
      arrowCount: 8,
      drawCalls: 180,
      triangles: 95000,
      mixers: 50,
      lodCounts: [50, 0, 0],
      textures: 3085,
      geometries: 1447,
    })

    // Verify required breakdown metrics
    expect(hud).toContain('FPS:')
    expect(hud).toContain('CPU Frame Work')
    expect(hud).toContain('NPC Grid Build')
    expect(hud).toContain('NPC Update')
    expect(hud).toContain('Mount / Interaction')
    expect(hud).toContain('Entity Collision')
    expect(hud).toContain('Arrow / Projectile')
    expect(hud).toContain('Impact / Damage')
    expect(hud).toContain('Renderer Submit')
    expect(hud).toContain('Other / Unaccounted')

    // Verify entity & render counters
    expect(hud).toContain('NPC Count: 200')
    expect(hud).toContain('Horse Count: 50')
    expect(hud).toContain('Arrow Count: 8')
    expect(hud).toContain('Draw Calls: 180')
    expect(hud).toContain('Triangles: 95000')

    // Verify preserved legacy fields
    expect(hud).toContain('horses: 50')
    expect(hud).toContain('mixers: 50')
    expect(hud).toContain('LOD 0/1/2: 50/0/0')
    expect(hud).toContain('textures: 3085')
    expect(hud).toContain('geometry: 1447')
  })
})
