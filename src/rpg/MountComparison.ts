import { MOUNT_RIDER_SPEED_EXCEPTIONS, mountStats, type GroundMountKind, type GroundMountStats, type MountKind, type MountStats } from '../combat/MountStats'

/** Player-language mount comparison. Numbers come from MountStats (the same source Mount uses); nothing here builds a Mount or model. */
export type MountComparisonRelation = 'none' | 'same' | 'upgrade' | 'downgrade' | 'mixed'
export interface MountComparison {
  relation: MountComparisonRelation
  lines: string[]
  /** Set when the candidate is the comparison basis itself; there is no difference to report. */
  self?: boolean
  /** Name and kind of basis the comparison is against; empty when none is set. */
  basisName: string
  basisSource?: MountComparisonBasis['source']
}
/** The mount compared against: the one being ridden, else the one allocated to the player. */
export interface MountComparisonBasis { id: string; name: string; source: 'riding' | 'allocated'; kind: MountKind }

/**
 * Pick the mount to compare against. What the Player is actually riding wins; a ridden mount that is not an owned
 * private one (a battlefield or town temporary mount) gets its own identity, so it is never mistaken for an owned
 * mount of the same type. With nothing ridden, the allocated, still-owned private mount is used.
 */
export function mountComparisonBasis(input: {
  riding: { kind: MountKind; name: string; /** Set only when the ridden mount is the Player's own private mount. */ privateId?: string } | null
  allocated: { id: string; name: string; kind: MountKind } | null
}): MountComparisonBasis | null {
  const { riding, allocated } = input
  if (riding) return riding.privateId !== undefined
    ? { id: riding.privateId, name: riding.name, source: 'riding', kind: riding.kind }
    : { id: `temporary:${riding.kind}`, name: `${riding.name}（臨時）`, source: 'riding', kind: riding.kind }
  return allocated ? { ...allocated, source: 'allocated' } : null
}

const SOURCE_LABEL = { riding: '目前騎乘', allocated: '目前分配' } as const
const RELATION_LABEL: Record<Exclude<MountComparisonRelation, 'none'>, string> = { upgrade: '▲ 能力提升', downgrade: '▼ 能力下降', mixed: '◆ 各有取捨', same: '＝ 能力相近' }
export const MOUNT_FLIGHT_NOTE = '飛行與地面機動能力不可直接比較'

const num = (value: number): string => String(Math.round(value * 10) / 10)
const signedPct = (value: number, base: number): string => {
  const pct = Math.round((value - base) / base * 1000) / 10
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}
const kmh = (metresPerSecond: number): string => `${Math.round(metresPerSecond * 3.6)} km/h`

/** Short trait words for the main card. */
export function mountTraits(stats: MountStats): string[] {
  if (stats.kind === 'flying') return ['飛行坐騎']
  const traits: string[] = []
  if (stats.baseSpeed >= 13) traits.push('高速型')
  if (stats.armorMax > 0) traits.push('重裝防護')
  if (stats.impactMultiplier > 1) traits.push('強力衝撞')
  if (stats.maxHp >= 150 && stats.armorMax === 0) traits.push('生命較高')
  return traits.length ? traits : ['機動均衡']
}

/** Exact figures for the collapsed 詳細屬性 view, for the given rider's actual speed. */
export function mountDetails(kind: MountKind, riderHeroAssetId?: string | null): string[] {
  const stats = mountStats(kind, riderHeroAssetId)
  if (stats.kind === 'flying') {
    return [`飛行巡航 ${kmh(stats.cruiseSpeed)}`, `衝刺 ${kmh(stats.sprintSpeed)}`, `最大生命 ${stats.maxHp}`, `飛行攻擊 ${stats.attackDamage} 傷害 · 冷卻 ${stats.attackCooldown} 秒`, MOUNT_FLIGHT_NOTE]
  }
  const lines = [`基礎速度 ${num(stats.baseSpeed)} m/s`, `最大生命 ${stats.maxHp}`]
  if (stats.armorMax > 0) lines.push(`護甲耐久上限 ${stats.armorMax}`)
  lines.push(`撞擊倍率 ×${num(stats.impactMultiplier)}`)
  const exception = MOUNT_RIDER_SPEED_EXCEPTIONS[kind as GroundMountKind]
  if (exception && riderHeroAssetId !== exception.heroAssetId) lines.push(`${exception.riderName}騎乘時速度 ${num(exception.speed)} m/s`)
  return lines
}

function compareGround(candidate: GroundMountStats, current: GroundMountStats): Pick<MountComparison, 'relation' | 'lines'> {
  const lines: string[] = [], signs: number[] = []
  // Mount stats are discrete design values, so any difference is a real one; "same" means every ability matches exactly.
  if (candidate.baseSpeed !== current.baseSpeed) { lines.push(`速度 ${signedPct(candidate.baseSpeed, current.baseSpeed)}`); signs.push(Math.sign(candidate.baseSpeed - current.baseSpeed)) }
  if (candidate.maxHp !== current.maxHp) { lines.push(`最大生命 ${signedPct(candidate.maxHp, current.maxHp)}`); signs.push(Math.sign(candidate.maxHp - current.maxHp)) }
  if (candidate.armorMax !== current.armorMax) {
    // A percentage of zero armor is meaningless, so gaining or losing it all is stated outright.
    lines.push(current.armorMax === 0 ? `新增護甲 ${candidate.armorMax}` : candidate.armorMax === 0 ? `失去護甲 ${current.armorMax}` : `護甲 ${signedPct(candidate.armorMax, current.armorMax)}`)
    signs.push(Math.sign(candidate.armorMax - current.armorMax))
  }
  if (candidate.impactMultiplier !== current.impactMultiplier) {
    // A multiplier applies to the base impact formula; it is not a percentage of damage.
    lines.push(`撞擊倍率 ×${num(current.impactMultiplier)} → ×${num(candidate.impactMultiplier)}`)
    signs.push(Math.sign(candidate.impactMultiplier - current.impactMultiplier))
  }
  const up = signs.includes(1), down = signs.includes(-1)
  return { relation: up && down ? 'mixed' : up ? 'upgrade' : down ? 'downgrade' : 'same', lines }
}

/** Flying and ground mounts move by different rules, so this never ranks them: it lists each side's own abilities as a trade-off. */
function compareAcrossFlight(candidate: MountStats, current: MountStats): Pick<MountComparison, 'relation' | 'lines'> {
  const lines: string[] = [candidate.kind === 'flying' ? `飛行坐騎 · ${MOUNT_FLIGHT_NOTE}` : `地面坐騎 · ${MOUNT_FLIGHT_NOTE}`]
  lines.push(candidate.kind === 'flying' ? `巡航 ${kmh(candidate.cruiseSpeed)} · 衝刺 ${kmh(candidate.sprintSpeed)}` : `基礎速度 ${num(candidate.baseSpeed)} m/s`)
  // Max HP and barding are the same quantities on both sides, so they can still be stated as differences.
  if (candidate.maxHp !== current.maxHp) lines.push(`最大生命 ${signedPct(candidate.maxHp, current.maxHp)}`)
  if (candidate.armorMax !== current.armorMax) lines.push(current.armorMax === 0 ? `新增護甲 ${candidate.armorMax}` : candidate.armorMax === 0 ? `失去護甲 ${current.armorMax}` : `護甲 ${signedPct(candidate.armorMax, current.armorMax)}`)
  lines.push(candidate.kind === 'flying' ? `飛行攻擊 ${candidate.attackDamage} 傷害，無地面撞擊` : `地面撞擊 ×${num(candidate.impactMultiplier)}，無飛行攻擊`)
  return { relation: 'mixed', lines }
}

/**
 * Compare a candidate with the basis mount. No basis, or the candidate being the basis, never claims stronger or weaker.
 * Both sides use the same rider, because a rider-dependent speed (armored horse) is a property of who is riding.
 */
export function compareMounts(candidateId: string, candidateKind: MountKind, basis: MountComparisonBasis | null | undefined, riderHeroAssetId?: string | null): MountComparison {
  if (!basis) return { relation: 'none', lines: ['尚未設定比較坐騎'], basisName: '' }
  if (basis.id === candidateId) return { relation: 'same', lines: [SOURCE_LABEL[basis.source]], self: true, basisName: basis.name, basisSource: basis.source }
  const candidate = mountStats(candidateKind, riderHeroAssetId), current = mountStats(basis.kind, riderHeroAssetId)
  const result = candidate.kind === 'ground' && current.kind === 'ground' ? compareGround(candidate, current) : compareAcrossFlight(candidate, current)
  return { ...result, basisName: basis.name, basisSource: basis.source }
}

/** One compact line for a card or shop row, e.g. `◆ 各有取捨（相較目前騎乘：軍用戰馬）：速度 −12.5% · …`. */
export function mountComparisonText(comparison: MountComparison): string {
  if (comparison.relation === 'none' || comparison.self) return comparison.lines.join(' · ')
  const label = RELATION_LABEL[comparison.relation]
  const against = `相較${comparison.basisSource ? `${SOURCE_LABEL[comparison.basisSource]}：` : ''}${comparison.basisName}`
  return `${label}（${against}）${comparison.lines.length ? `：${comparison.lines.join(' · ')}` : ''}`
}
