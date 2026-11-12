export type OnDemandAssetStatus = 'idle' | 'loading' | 'ready' | 'failed'

export class AssetLoadTimeout extends Error {
  constructor(id: string, timeoutMs: number) {
    super(`Asset ${id} did not load within ${timeoutMs} ms`)
    this.name = 'AssetLoadTimeout'
  }
}

export interface OnDemandAssetOptions<Id extends string> {
  /** A request still pending after this long counts as failed; its late result is discarded. */
  timeoutMs: number
  /** Minimum gap between automatic `poll` retries. An explicit `load` retries at once. */
  retryDelayMs: number
  onFailure?: (id: Id, error: unknown) => void
}

/** Optional assets loaded only when something needs them: one bounded in-flight request per id. A failed or
 * timed-out request is forgotten, so the next one starts fresh and a late old result can never replace it. */
export class OnDemandAssets<Id extends string, Asset> {
  private readonly requests = new Map<Id, Promise<Asset>>()
  private readonly abortControllers = new Map<Id, AbortController>()
  private readonly loaded = new Map<Id, Asset>()
  private readonly failedAt = new Map<Id, number>()
  private disposed = false

  constructor(private readonly loader: (id: Id, signal: AbortSignal) => Promise<Asset>, private readonly options: OnDemandAssetOptions<Id>) {}

  get(id: Id): Asset | undefined { return this.loaded.get(id) }

  status(id: Id): OnDemandAssetStatus {
    return this.loaded.has(id) ? 'ready' : this.requests.has(id) ? 'loading' : this.failedAt.has(id) ? 'failed' : 'idle'
  }

  load(id: Id): Promise<Asset> {
    const asset = this.loaded.get(id)
    if (asset !== undefined) return Promise.resolve(asset)
    const existing = this.requests.get(id)
    if (existing) return existing
    this.failedAt.delete(id)
    const { timeoutMs, onFailure } = this.options
    const abort = new AbortController()
    this.abortControllers.set(id, abort)
    const tracked = new Promise<Asset>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AssetLoadTimeout(id, timeoutMs))
        abort.abort()
      }, timeoutMs)
      const settle = () => {
        clearTimeout(timer)
        this.abortControllers.delete(id)
      }
      let work: Promise<Asset>
      try { work = this.loader(id, abort.signal) } catch (error) { work = Promise.reject(error) }
      work.then(result => { settle(); resolve(result) }, error => { settle(); reject(error) })
    }).then(result => {
      this.requests.delete(id)
      if (!this.disposed) this.loaded.set(id, result)
      return result
    }, error => {
      this.requests.delete(id)
      if (!this.disposed) {
        this.failedAt.set(id, Date.now())
        onFailure?.(id, error)
      }
      throw error
    })
    this.requests.set(id, tracked)
    return tracked
  }

  /** Safe to call every frame: returns the asset when loaded and otherwise keeps at most one paced request going. */
  poll(id: Id): Asset | undefined {
    const asset = this.loaded.get(id)
    if (asset !== undefined || this.requests.has(id)) return asset
    const failedAt = this.failedAt.get(id)
    if (failedAt === undefined || Date.now() - failedAt >= this.options.retryDelayMs) void this.load(id).catch(() => {})
    return undefined
  }

  dispose(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    this.abortControllers.clear()
    this.requests.clear()
    this.loaded.clear()
    this.failedAt.clear()
  }
}
