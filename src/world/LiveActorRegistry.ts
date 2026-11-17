/**
 * Weakly tracks live scene actors so a LAN co-op host can snapshot every NPC and
 * mount in a scene (Town, arena) without each owning controller reporting them.
 * Entries never keep an actor alive; dispose() removes them eagerly.
 */
// The project targets ES2020 typings; every supported browser/Electron runtime has WeakRef (ES2021).
interface WeakRefLike<T extends object> { deref(): T | undefined }
const WeakRefImpl = (globalThis as unknown as { WeakRef: new <T extends object>(target: T) => WeakRefLike<T> }).WeakRef

export class LiveActorRegistry<T extends object> {
  private readonly refs = new Set<WeakRefLike<T>>()
  private readonly byActor = new WeakMap<T, WeakRefLike<T>>()

  add(actor: T): void {
    if (this.byActor.has(actor)) return
    const ref = new WeakRefImpl(actor)
    this.byActor.set(actor, ref)
    this.refs.add(ref)
  }

  delete(actor: T): void {
    const ref = this.byActor.get(actor)
    if (!ref) return
    this.refs.delete(ref)
    this.byActor.delete(actor)
  }

  /** Live actors matching the filter; collected entries are pruned. */
  collect(filter: (actor: T) => boolean, out: T[] = []): T[] {
    out.length = 0
    for (const ref of this.refs) {
      const actor = ref.deref()
      if (!actor) { this.refs.delete(ref); continue }
      if (filter(actor)) out.push(actor)
    }
    return out
  }
}
