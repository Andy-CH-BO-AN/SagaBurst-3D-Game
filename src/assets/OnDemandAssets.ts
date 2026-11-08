/** Optional assets loaded only when something needs them: one in-flight request per id, and a failure is forgotten
 * so that the next request retries. Nothing here waits on assets another caller did not ask for. */
export class OnDemandAssets<Id extends string, Asset> {
  private readonly requests = new Map<Id, Promise<Asset>>()
  private readonly loaded = new Map<Id, Asset>()

  constructor(private readonly loader: (id: Id) => Promise<Asset>) {}

  get(id: Id): Asset | undefined { return this.loaded.get(id) }

  load(id: Id): Promise<Asset> {
    const existing = this.requests.get(id)
    if (existing) return existing
    let request: Promise<Asset>
    try { request = this.loader(id) } catch (error) { request = Promise.reject(error) }
    const tracked = request.then(asset => {
      this.loaded.set(id, asset)
      return asset
    }, error => {
      this.requests.delete(id)
      throw error
    })
    this.requests.set(id, tracked)
    return tracked
  }
}

/** Waits for needed assets without ever rejecting or waiting forever: scenes must still open if one is unavailable. */
export async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<'ready' | 'failed' | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timed-out'>(resolve => { timer = setTimeout(() => resolve('timed-out'), timeoutMs) })
  try {
    return await Promise.race([work.then(() => 'ready' as const, () => 'failed' as const), timeout])
  } finally {
    clearTimeout(timer)
  }
}
