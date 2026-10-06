import { vi } from 'vitest'
import { gameplayNpcSpawns, type NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
let frame = 0
export function advanceNpcFrame(scheduler: NpcSpawnScheduler = gameplayNpcSpawns): number {
  const timestamp = ++frame * 16
  scheduler.tick(timestamp)
  return timestamp
}
/** Existing gameplay regressions operate after loading; simulate actual distinct render frames first. */
export function completeNpcDeployment<T>(operation: () => T): T {
  const result = operation()
  drainNpcSpawns()
  return result
}
export function drainNpcSpawns(scheduler: NpcSpawnScheduler = gameplayNpcSpawns): void {
  for (let count = 0; scheduler.pending; count++) {
    if (count > 10000) throw new Error('Spawn queue did not finish')
    advanceNpcFrame(scheduler)
  }
}

export function installNpcLoadingFrames(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const timestamp = ++frame * 16
    callback(timestamp)
    return frame
  })
}
