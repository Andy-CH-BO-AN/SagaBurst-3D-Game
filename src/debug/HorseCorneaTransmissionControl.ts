import type * as THREE from 'three'
import { collectMainPassCensus, type MainPassCensus, type MainPassCensusScene } from './MainPassCensus'
import { inspectHorseCorneaMaterials, setHorseCorneaTransmission, type HorseCorneaMaterialSnapshot } from '../world/HorseCorneaMaterial'

export interface FrozenCorneaControlBlock {
  label: 'A' | 'B'
  transmissionEnabled: boolean
  warmupFrames: number
  renderOnlySamplesMs: number[]
  renderOnlyMedianMs: number
  census: MainPassCensus
}

export interface FrozenCorneaControlResult {
  protocol: string
  materialCount: number
  initialMaterials: HorseCorneaMaterialSnapshot[]
  blocks: FrozenCorneaControlBlock[]
  restoredMaterials: HorseCorneaMaterialSnapshot[]
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function horseRoots(game: MainPassCensusScene): THREE.Object3D[] {
  return game.mounts.flatMap((mount) => mount.horseVisual ? [mount.horseVisual.root] : [])
}

function uniqueMaterialSnapshots(snapshots: HorseCorneaMaterialSnapshot[]): HorseCorneaMaterialSnapshot[] {
  const byValue = new Map<string, HorseCorneaMaterialSnapshot>()
  for (const snapshot of snapshots) byValue.set(JSON.stringify(snapshot), snapshot)
  return [...byValue.values()]
}

/**
 * Performs A1→B1→A2→B2→A3→B3 without calling the game loop. It neither
 * spawns entities nor advances AI, camera, animation, projectiles or LODs.
 * This is DEV-only on-demand instrumentation; do not call in a timed benchmark.
 */
export function runFrozenHorseCorneaTransmissionControl(
  game: MainPassCensusScene,
  options: { blocks?: number, warmupFrames?: number, sampleFrames?: number } = {},
): FrozenCorneaControlResult {
  const blocks = options.blocks ?? 3
  const warmupFrames = options.warmupFrames ?? 4
  const sampleFrames = options.sampleFrames ?? 9
  if (!Number.isInteger(blocks) || blocks < 1) throw new Error('blocks must be a positive integer')
  if (!Number.isInteger(warmupFrames) || warmupFrames < 0) throw new Error('warmupFrames must be a non-negative integer')
  if (!Number.isInteger(sampleFrames) || sampleFrames < 1) throw new Error('sampleFrames must be a positive integer')

  const roots = horseRoots(game)
  const allInitialMaterials = roots.flatMap(inspectHorseCorneaMaterials)
  const initialMaterials = uniqueMaterialSnapshots(allInitialMaterials)
  if (initialMaterials.length === 0) throw new Error('No horse cornea material is present in the scene')

  const result: FrozenCorneaControlBlock[] = []
  const run = (label: 'A' | 'B', transmissionEnabled: boolean) => {
    for (const root of roots) setHorseCorneaTransmission(root, transmissionEnabled)
    for (let index = 0; index < warmupFrames; index++) game.renderer.render(game.scene, game.camera)
    const renderOnlySamplesMs: number[] = []
    for (let index = 0; index < sampleFrames; index++) {
      const start = performance.now()
      game.renderer.render(game.scene, game.camera)
      renderOnlySamplesMs.push(performance.now() - start)
    }
    result.push({
      label,
      transmissionEnabled,
      warmupFrames,
      renderOnlySamplesMs,
      renderOnlyMedianMs: median(renderOnlySamplesMs),
      census: collectMainPassCensus(game),
    })
  }

  try {
    for (let index = 0; index < blocks; index++) {
      run('A', true)
      run('B', false)
    }
  } finally {
    // Both material strategies are uniform by design: use the source scene's
    // first snapshot as the restoration authority after every alternating block.
    for (const root of roots) setHorseCorneaTransmission(root, initialMaterials[0].transmission > 0)
  }
  return {
    protocol: `${Array.from({ length: blocks }, (_, index) => `A${index + 1}→B${index + 1}`).join('→')}; ${warmupFrames} render-only warmup frames and ${sampleFrames} render-only samples per block`,
    materialCount: allInitialMaterials.length,
    initialMaterials,
    blocks: result,
    restoredMaterials: uniqueMaterialSnapshots(roots.flatMap(inspectHorseCorneaMaterials)),
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__runFrozenHorseCorneaTransmissionControl = runFrozenHorseCorneaTransmissionControl
}
