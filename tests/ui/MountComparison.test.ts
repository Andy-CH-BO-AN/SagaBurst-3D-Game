import { describe, expect, it } from 'vitest'
import { mountStats } from '../../src/combat/MountStats'
import { XONGKORO } from '../../src/movement/XongkoroConfig'
import { compareMounts, mountComparisonText, mountDetails, type MountComparisonBasis } from '../../src/rpg/MountComparison'

const basis = (id: string, kind: MountComparisonBasis['kind'], source: MountComparisonBasis['source'] = 'riding'): MountComparisonBasis => ({ id, name: id, source, kind })
const BYZANTINE = 'byzantine-cataphract-t5'

describe('Mount comparison', () => {
  it('compares ground mounts ability by ability, follows the real rider speed, and claims nothing without a basis', () => {
    const horse = basis('horse', 'HORSE')
    expect(compareMounts('armored-horse', 'ARMORED_HORSE', horse, null)).toMatchObject({
      relation: 'mixed', lines: ['速度 −12.5%', '最大生命 +500%', '新增護甲 50', '撞擊倍率 ×1 → ×2.5'] })
    // A Byzantine cataphract rides it at 12 m/s, so speed is no longer a drawback and the figures stay finite.
    const byzantine = compareMounts('armored-horse', 'ARMORED_HORSE', horse, BYZANTINE)
    expect(byzantine).toMatchObject({ relation: 'upgrade', lines: ['最大生命 +500%', '新增護甲 50', '撞擊倍率 ×1 → ×2.5'] })
    expect(mountDetails('ARMORED_HORSE', BYZANTINE)[0]).toBe('基礎速度 12 m/s')
    expect(mountDetails('ARMORED_HORSE', null).join()).toContain('拜占庭鐵甲重騎兵騎乘時速度 12 m/s')
    expect(compareMounts('horse', 'HORSE', basis('armored-horse', 'ARMORED_HORSE'), null).lines).toContain('失去護甲 50')
    expect(compareMounts('corgi', 'CORGI', horse)).toMatchObject({ relation: 'same', lines: [] })
    expect(compareMounts('serval', 'SERVAL', horse)).toMatchObject({ relation: 'upgrade', lines: ['速度 +25%'] })
    expect(compareMounts('horse', 'HORSE', horse)).toMatchObject({ relation: 'same', self: true, lines: ['目前騎乘'] })
    expect(compareMounts('horse', 'HORSE', basis('horse', 'HORSE', 'allocated')).lines).toEqual(['目前分配'])
    const none = compareMounts('snow-leopard', 'SNOW_LEOPARD', null)
    expect(none).toMatchObject({ relation: 'none', lines: ['尚未設定比較坐騎'] })
    expect(mountComparisonText(none)).not.toMatch(/較強|較弱|提升|下降/)
  })

  it('never ranks the eagle against ground mounts by flight speed, in either direction', () => {
    const toEagle = compareMounts('xongkoro', 'xongkoro', basis('horse', 'HORSE')), fromEagle = compareMounts('horse', 'HORSE', basis('xongkoro', 'xongkoro'))
    for (const result of [toEagle, fromEagle]) {
      expect(result.relation).toBe('mixed')
      expect(result.lines[0]).toContain('飛行與地面機動能力不可直接比較')
      expect(result.lines.join()).not.toMatch(/速度 [+−]|Infinity|NaN/)
    }
    expect(toEagle.lines).toContain('巡航 48 km/h · 衝刺 96 km/h')
    expect(toEagle.lines).toContain('最大生命 +100%')
    expect(mountStats('xongkoro')).toMatchObject({ kind: 'flying', maxHp: XONGKORO.maxHp, cruiseSpeed: XONGKORO.cruiseSpeed, sprintSpeed: XONGKORO.sprintSpeed, attackDamage: XONGKORO.attackDamage })
    expect(mountComparisonText(toEagle)).toMatch(/^◆ 各有取捨（相較目前騎乘：horse）/)
  })
})
