import { installTestGlobals } from './threeTestEnvironment'

export interface MemoryStorageOptions {
  writable?: boolean
  failWrites?: boolean
  initialValues?: Iterable<readonly [string, string]>
}

/** A small Storage implementation for save/load tests, with controllable write failures. */
export class MemoryStorage implements Storage {
  private readonly values: Map<string, string>
  writable: boolean
  failWrites: boolean

  constructor(options: MemoryStorageOptions = {}) {
    this.values = new Map(options.initialValues)
    this.writable = options.writable ?? true
    this.failWrites = options.failWrites ?? false
  }

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(String(key)) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(String(key)) }
  setItem(key: string, value: string): void {
    if (!this.writable || this.failWrites) throw new Error('MemoryStorage is not writable')
    this.values.set(String(key), String(value))
  }
}

/** Temporarily installs storage globals and restores their exact prior descriptors. */
export function installStorageGlobals(storage: { localStorage?: Storage; sessionStorage?: Storage }): () => void {
  return installTestGlobals(storage)
}
