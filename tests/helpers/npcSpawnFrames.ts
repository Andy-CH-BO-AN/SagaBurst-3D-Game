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

const drivers = new WeakMap<NpcSpawnScheduler, NpcSpawnTestDriver>()
function driverFor(scheduler: NpcSpawnScheduler): NpcSpawnTestDriver {
  let driver = drivers.get(scheduler)
  if (!driver) { driver = new NpcSpawnTestDriver(scheduler); drivers.set(scheduler, driver) }
  return driver
}

/** Legacy convenience defaults to the integration singleton; isolated tests should pass a driver. */
export function advanceNpcFrame(scheduler: NpcSpawnScheduler = gameplayNpcSpawns): number {
  return driverFor(scheduler).advanceFrame()
}

/** Existing gameplay regressions operate after loading; simulate actual distinct render frames first. */
export function completeNpcDeployment<T>(operation: () => T, scheduler: NpcSpawnScheduler = gameplayNpcSpawns): T {
  return driverFor(scheduler).complete(operation)
}

export function drainNpcSpawns(scheduler: NpcSpawnScheduler = gameplayNpcSpawns): void {
  driverFor(scheduler).drain()
}

export function installNpcLoadingFrames(scheduler: NpcSpawnScheduler = gameplayNpcSpawns): void {
  const driver = driverFor(scheduler)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const timestamp = driver.advanceFrame()
    callback(timestamp)
    return timestamp / 16
  })
}
