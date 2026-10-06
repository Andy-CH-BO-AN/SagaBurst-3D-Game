/** A batch owns identities and cancellation; the renderer's RAF timestamp owns the budget. */
export type SpawnStatus = 'pending' | 'complete' | 'cancelled' | 'failed'
export type ActorSpawnStatus = 'queued' | 'spawning' | 'spawned' | 'cancelled' | 'failed'
interface SpawnJob { batch: NpcSpawnBatch; id: string; create(): void }
let activeDisposables: Array<{ dispose(): void }> | undefined

/** Track resources immediately after construction, before mount binding or registration can fail. */
export function trackNpcSpawn<T extends { dispose(): void }>(resource: T): T {
  if (activeDisposables && !activeDisposables.includes(resource)) activeDisposables.push(resource)
  return resource
}
export function assertNpcSpawnJob(): void {
  if (!activeDisposables) throw new Error('NPC materialization requires a frame spawn job')
}

export class NpcSpawnBatch {
  readonly actors = new Map<string, ActorSpawnStatus>()
  status: SpawnStatus = 'pending'
  error?: unknown
  completed = 0
  private sealed = false
  private finish?: () => void
  constructor(private readonly scheduler: NpcSpawnScheduler, private readonly failure?: () => void) {}
  get pending(): number { return [...this.actors.values()].filter(s => s === 'queued' || s === 'spawning').length }
  get ready(): boolean { return this.status === 'complete' }
  enqueue(id: string, create: () => void): boolean {
    if (this.status !== 'pending' || this.sealed || this.actors.has(id)) return false
    this.actors.set(id, 'queued')
    this.scheduler.enqueue({ batch: this, id, create })
    return true
  }
  seal(finish?: () => void): void {
    this.sealed = true; this.finish = finish
    try { this.checkComplete() } catch (error) { this.fail(undefined, error) }
  }
  cancel(): void {
    if (this.status !== 'pending') return
    this.status = 'cancelled'
    for (const [id, state] of this.actors) if (state === 'queued') this.actors.set(id, 'cancelled')
  }
  succeed(id: string): void {
    this.actors.set(id, 'spawned'); this.completed++; this.checkComplete()
  }
  fail(id: string | undefined, error: unknown): void {
    this.error = error; this.cancel(); this.status = 'failed'
    if (id !== undefined) this.actors.set(id, 'failed')
    try { this.failure?.() } catch (cleanupError) { console.error('NPC spawn cleanup failed', cleanupError) }
  }
  private checkComplete(): void {
    if (!this.sealed || this.status !== 'pending' || this.pending) return
    // Finalization belongs to readiness: a failed finalizer is never reported as ready.
    this.finish?.()
    this.status = 'complete'
  }
}

export class NpcSpawnScheduler {
  private jobs: SpawnJob[] = []
  private lastFrame: number | undefined
  get pending(): number { return this.jobs.filter(job => job.batch.status === 'pending' && job.batch.actors.get(job.id) === 'queued').length }
  batch(onFailure?: () => void): NpcSpawnBatch { return new NpcSpawnBatch(this, onFailure) }
  enqueue(job: SpawnJob): void { this.jobs.push(job) }
  /** Call only with the browser RAF timestamp (shared by all callbacks in that render frame). */
  tick(frame: number): void {
    if (activeDisposables || this.lastFrame !== undefined && frame <= this.lastFrame) return
    // Record even an empty frame: reentrant enqueues cannot reopen this frame's budget.
    this.lastFrame = frame
    let job: SpawnJob | undefined
    while ((job = this.jobs.shift())) {
      if (job.batch.status === 'pending' && job.batch.actors.get(job.id) === 'queued') break
    }
    if (!job) return
    const resources: Array<{ dispose(): void }> = []
    activeDisposables = resources
    job.batch.actors.set(job.id, 'spawning')
    try { job.create(); job.batch.succeed(job.id) }
    catch (error) {
      for (const resource of resources.reverse()) { try { resource.dispose() } catch { /* Continue rolling back. */ } }
      job.batch.fail(job.id, error)
    } finally { activeDisposables = undefined }
  }
  /** Loading runs real RAF frames without running simulation or consuming mission time. */
  async wait(batch: NpcSpawnBatch, progress: (completed: number, total: number) => void = () => {}): Promise<void> {
    while (batch.status === 'pending') {
      await new Promise<void>(resolve => requestAnimationFrame(frame => { this.tick(frame); resolve() }))
      progress(batch.completed, batch.actors.size)
    }
    if (!batch.ready) throw batch.error ?? new Error('NPC spawn batch cancelled')
  }
}

// Town, Game, loaders and concurrent transition callbacks share one render-frame budget.
export const gameplayNpcSpawns = new NpcSpawnScheduler()
