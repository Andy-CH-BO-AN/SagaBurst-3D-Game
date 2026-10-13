/** Pure maximum-weight assignment. Each physical candidate can have only one holder. */
export type BulkEquipmentCategory = 'bow' | 'sword' | 'axe' | 'spear' | 'mount'
export const naturalActorCompare = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true }) || a.localeCompare(b, 'en')
export interface BulkEquipmentCandidate { key: string; itemId: string | null; tier: number; holderId?: string; requested?: boolean }
export interface BulkEquipmentActor { actorId: string; tier: number; currentKey?: string; currentRequested?: boolean }
export interface BulkEquipmentAssignment { actorId: string; candidate: BulkEquipmentCandidate }

/** Effective upgrade count dominates final combat tier and assigned item tier, then natural Actor IDs.
 * A result-tier callback accounts for retained weapons and loadout side effects per recipient.
 * Compatibility and no-downgrade are hard constraints supplied at the domain boundary.
 * Hungarian matching uses integers, so the lexicographic priorities cannot lose precision.
 */
export function planBulkEquipment(actors: readonly BulkEquipmentActor[], candidates: readonly BulkEquipmentCandidate[],
  accepts: (actor: BulkEquipmentActor, candidate: BulkEquipmentCandidate) => boolean,
  resultTier: (actor: BulkEquipmentActor, candidate: BulkEquipmentCandidate) => number = (_, candidate) => candidate.tier): BulkEquipmentAssignment[] {
  const rows = [...actors].sort((a, b) => naturalActorCompare(a.actorId, b.actorId))
  const cols = [...candidates].sort((a, b) => b.tier - a.tier
    || naturalActorCompare(a.itemId ?? '', b.itemId ?? '') || naturalActorCompare(a.key, b.key))
  const n = rows.length, m = cols.length
  if (!n) return []
  if (m < n) throw new Error('Not enough assignment candidates')
  const itemBase = BigInt(m + 1), itemSpace = itemBase ** BigInt(n)
  const retainSpace = BigInt(n + 1) * itemSpace, categorySpace = 2n ** BigInt(n) * retainSpace
  const actorTierSpace = 5n ** BigInt(n) * categorySpace
  const combatTierSpace = actorTierSpace * BigInt(n * 4 + 1)
  const upgradeWeight = combatTierSpace * BigInt(n * 4 + 1)
  const infinity = upgradeWeight * BigInt(n * 16 + 100)
  const costs = rows.map((actor, row) => cols.map((candidate, column) => {
    const tier = resultTier(actor, candidate)
    if (tier < actor.tier || !accepts(actor, candidate)) return infinity
    return -((tier > actor.tier ? upgradeWeight : 0n) + BigInt(tier) * combatTierSpace + BigInt(candidate.tier) * actorTierSpace
      + BigInt(candidate.tier) * 5n ** BigInt(n - row - 1) * categorySpace
      + (candidate.requested && !actor.currentRequested ? 2n ** BigInt(n - row - 1) * retainSpace : 0n)
      + (candidate.key === actor.currentKey ? itemSpace : 0n)
      + BigInt(m - column) * itemBase ** BigInt(n - row - 1))
  }))
  const u = Array<bigint>(n + 1).fill(0n), v = Array<bigint>(m + 1).fill(0n)
  const p = Array<number>(m + 1).fill(0), way = Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = Array<bigint>(m + 1).fill(infinity), used = Array<boolean>(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = infinity, j1 = 0
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = costs[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      if (!j1 || delta >= infinity) throw new Error('No legal complete equipment matching')
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta }
        else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0 !== 0)
  }
  const result: BulkEquipmentAssignment[] = []
  for (let j = 1; j <= m; j++) if (p[j]) {
    if (costs[p[j] - 1][j - 1] >= infinity) throw new Error('Illegal matching')
    result.push({ actorId: rows[p[j] - 1].actorId, candidate: cols[j - 1] })
  }
  return result.sort((a, b) => naturalActorCompare(a.actorId, b.actorId))
}
