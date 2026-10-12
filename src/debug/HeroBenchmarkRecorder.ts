import type * as THREE from 'three'
import { AIState, type NPC } from '../world/NPC'
import { HERO_BENCHMARK_NPC_COUNT, HERO_BENCHMARK_PROTOCOL, heroBenchmarkIdentity, heroBenchmarkLods, type HeroBenchmarkSettings } from './HeroBenchmark'
import { summarizeHeroFrames } from './HeroBenchmarkMetrics'
import { characterResourceMetrics, measureGpuRender } from './HeroBenchmarkRenderMetrics'
import type { RuntimeProfiler, RuntimeProfileSnapshot } from './RuntimeProfiler'

export interface HeroBenchmarkScene {
  npcs: NPC[]
  mounts: unknown[]
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  profiler?: RuntimeProfiler
}

export function heroBenchmarkSnapshot(game: HeroBenchmarkScene, settings: HeroBenchmarkSettings) {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
  return {
    atMs: performance.now(), alive: game.npcs.filter(npc => !npc.dead).length,
    population: game.npcs.length, mounts: game.mounts.length,
    activeAttack: game.npcs.filter(npc => npc.currentState === AIState.ATTACK).length,
    finitePositions: game.npcs.every(npc => npc.position.toArray().every(Number.isFinite)),
    identity: heroBenchmarkIdentity(game.npcs, settings),
    ...heroBenchmarkLods(game.npcs),
    characterResources: characterResourceMetrics(game.npcs.map(npc => npc.characterVisualGroup)),
    drawCalls: game.renderer.info.render.calls, mainPassTriangles: game.renderer.info.render.triangles,
    jsHeapUsedBytes: memory?.usedJSHeapSize ?? null, jsHeapTotalBytes: memory?.totalJSHeapSize ?? null,
    geometries: game.renderer.info.memory.geometries, textures: game.renderer.info.memory.textures,
    programs: game.renderer.info.programs?.length ?? null,
    camera: { position: game.camera.position.toArray(), quaternion: game.camera.quaternion.toArray(), fov: game.camera.fov },
    quality: { pixelRatio: game.renderer.getPixelRatio(), width: game.renderer.domElement.width,
      height: game.renderer.domElement.height, shadows: game.renderer.shadowMap.enabled,
      shadowType: game.renderer.shadowMap.type, toneMapping: game.renderer.toneMapping },
  }
}

/** Collect rAF intervals, separate from CPU work profiler and without polling duplicate HUD windows. */
export function createHeroBenchmarkRecorder(game: HeroBenchmarkScene, settings: HeroBenchmarkSettings,
  cycle: () => Promise<void>) {
  let recording = false
  return {
    protocol: HERO_BENCHMARK_PROTOCOL, settings,
    fixture: '100 real NPCs, 50 vs 50 continuous melee; restore HP before each hit, preserve original damage receiver and all hero modifiers',
    memoryScope: 'Chrome JavaScript heap bytes and WebGL resource counts; not total RAM or VRAM',
    snapshot: () => heroBenchmarkSnapshot(game, settings),
    async cycle() {
      if (recording) throw new Error('Cannot reload actors during a measured window')
      await cycle()
      return heroBenchmarkSnapshot(game, settings)
    },
    async measure(durationMs = 20000) {
      if (recording) throw new Error('Benchmark already recording')
      if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 120000) throw new Error('Measurement duration must be 1–120 seconds')
      recording = true
      const frames: Array<{ atMs: number; frameMs: number; drawCalls: number; triangles: number }> = []
      const states: ReturnType<typeof heroBenchmarkSnapshot>[] = []
      const violations: string[] = []
      const cpu: RuntimeProfileSnapshot[] = []
      const gpu = measureGpuRender(game.renderer)
      let started = 0, previous = 0, lastSnapshot = -Infinity
      try {
        await new Promise<void>((resolve, reject) => {
          let request = 0
          const timeout = setTimeout(() => {
            cancelAnimationFrame(request)
            reject(new Error('Benchmark rAF window did not finish within its bounded deadline'))
          }, durationMs + 30000)
          const sample = (now: number) => {
            try {
              if (!started) started = now
              if (previous) frames.push({ atMs: now, frameMs: now - previous,
                drawCalls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles })
              previous = now
              const profile = game.profiler?.getLatestSnapshot()
              if (profile && profile.timestamp - profile.windowDurationMs >= started
                && profile.generation !== cpu.at(-1)?.generation) cpu.push(profile)
              if (now - lastSnapshot >= 1000 || now - started >= durationMs) {
                const state = heroBenchmarkSnapshot(game, settings)
                states.push(state)
                if (state.population !== HERO_BENCHMARK_NPC_COUNT || state.alive !== HERO_BENCHMARK_NPC_COUNT) violations.push(`Population changed at ${now}: ${state.alive}/${state.population}`)
                if (!state.identity.valid) violations.push(`Actor identity, stats or 50/50 allegiance differs from fixture at ${now}`)
                if (!state.finitePositions || state.mounts !== 0) violations.push(`Unexpected position or mount at ${now}`)
                if (state.counts.reduce((sum, count) => sum + count, 0) !== HERO_BENCHMARK_NPC_COUNT) violations.push(`Missing humanoid LOD at ${now}`)
                lastSnapshot = now
              }
              if (now - started >= durationMs) { clearTimeout(timeout); resolve() }
              else request = requestAnimationFrame(sample)
            } catch (error) { clearTimeout(timeout); reject(error) }
          }
          request = requestAnimationFrame(sample)
        })
        if (!states.some(state => state.activeAttack > 0)) violations.push('No actual combat observed')
        if (states.some(state => JSON.stringify(state.camera) !== JSON.stringify(states[0].camera))) violations.push('Camera moved during measurement')
        if (states.some(state => JSON.stringify(state.quality) !== JSON.stringify(states[0].quality))) violations.push('Quality changed during measurement')
        return { settings, startedAtMs: started, endedAtMs: previous, frames, states, cpu, gpu: gpu.finish(),
          summary: summarizeHeroFrames(frames.map(frame => frame.frameMs)), valid: violations.length === 0, violations }
      } finally { gpu.finish(); recording = false }
    },
  }
}
