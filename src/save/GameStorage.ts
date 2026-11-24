/**
 * Durable game storage seam. A LAN co-op guest plays inside the host's mission
 * with an in-memory copy of the host's saves, so it never reads or writes its
 * own Career/RPG data while a co-op mission runs.
 */
let override: Storage | null = null

export function gameStorage(): Storage {
  return override ?? localStorage
}

/** The co-op override alone, for callers that keep their own default storage lookup. */
export function gameStorageOverride(): Storage | null {
  return override
}

export function installGameStorageOverride(storage: Storage | null): void {
  override = storage
}

/** Minimal Storage backed by a Map; writes stay in this page only. */
export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  constructor(entries: Record<string, string | null | undefined> = {}) {
    for (const [key, value] of Object.entries(entries)) if (typeof value === 'string') this.values.set(key, value)
  }
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
}
