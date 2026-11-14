/** A visible interaction is the only target an E press may activate. */
export interface InteractionCandidate<T> {
  target: T
  position: { x: number; y: number; z: number }
  range: number
  /** Changes when the result shown to the player changes. */
  action: string
  prompt: string
}

type Point = { x: number; y: number; z: number }

export class InteractionFocus<T> {
  private shown: InteractionCandidate<T> | null = null

  clear(): void { this.shown = null }

  /** Revalidate the previously displayed target, never substitute a new target for this press. */
  pressed(pressed: boolean, candidates: readonly InteractionCandidate<T>[], origin: Point): InteractionCandidate<T> | null {
    if (!pressed || !this.shown) return null
    const candidate = candidates.find(item => item.target === this.shown!.target && item.action === this.shown!.action)
    return candidate && this.inRange(candidate, origin) ? candidate : null
  }

  /** Prefer a broad forward cone; keep the previous focus while the scores are close. */
  select(candidates: readonly InteractionCandidate<T>[], origin: Point, direction: Pick<Point, 'x' | 'z'>): InteractionCandidate<T> | null {
    const viewLength = Math.hypot(direction.x, direction.z)
    const available = candidates.filter(item => this.inRange(item, origin)).map(item => {
      const dx = item.position.x - origin.x, dz = item.position.z - origin.z
      const horizontal = Math.hypot(dx, dz)
      const dot = viewLength > 1e-6 && horizontal > 1e-6
        ? (dx * direction.x + dz * direction.z) / (horizontal * viewLength) : -1
      const distance = Math.hypot(dx, item.position.y - origin.y, dz) / item.range
      return { item, dot, distance }
    })
    const forward = available.filter(entry => entry.dot >= 0.45)
    const pool = forward.length ? forward : available
    const score = (entry: typeof available[number]) => forward.length ? (1 - entry.dot) * 1.2 + entry.distance * 0.25 : entry.distance
    pool.sort((a, b) => score(a) - score(b))
    const best = pool[0]
    const current = pool.find(entry => entry.item.target === this.shown?.target)
    this.shown = current && best && score(current) <= score(best) + 0.12 ? current.item : best?.item ?? null
    return this.shown
  }

  private inRange(candidate: InteractionCandidate<T>, origin: Point): boolean {
    const p = candidate.position
    return Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) < candidate.range
  }
}
