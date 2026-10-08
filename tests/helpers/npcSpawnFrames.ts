import { vi } from 'vitest'
import { NpcSpawnScheduler, gameplayNpcSpawns } from '../../src/world/NpcSpawnScheduler'

/** A deterministic frame clock scoped to one scheduler instance. */
export class NpcSpawnTestDriver {
  private frame = 0

  constructor(readonly scheduler = new NpcSpawnScheduler()) {}

  advanceFrame(): number {
    const timestamp = ++this.frame * 16
    this.scheduler.tick(timestamp)
    return timestamp
  }

  drain(): void {
    for (let count = 0; this.scheduler.pending; count++) {
      if (count >= 10000) throw new Error('Spawn queue did not finish after 10000 frames')
      this.advanceFrame()
    }
  }

  complete<T>(operation: () => T): T {
    const result = operation()
    this.drain()
    return result
  }
}

/** Explicit integration driver for suites that exercise controllers using the production singleton. */
export const gameplayNpcSpawnDriver = new NpcSpawnTestDriver(gameplayNpcSpawns)

export function advanceNpcFrame(driver: NpcSpawnTestDriver): number {
  return driver.advanceFrame()
}

/** Existing gameplay regressions operate after loading; simulate actual distinct render frames first. */
export function completeNpcDeployment<T>(operation: () => T, driver: NpcSpawnTestDriver): T {
  return driver.complete(operation)
}

export function drainNpcSpawns(driver: NpcSpawnTestDriver): void {
  driver.drain()
}

export function installNpcLoadingFrames(driver: NpcSpawnTestDriver): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const timestamp = driver.advanceFrame()
    callback(timestamp)
    return timestamp / 16
  })
}
