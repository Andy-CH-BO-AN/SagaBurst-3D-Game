import { describe, expect, it } from 'vitest'
import {
  selectTownCavalryReserve,
  type TownCavalryMissionSlot, type TownCavalryReserveResident
} from '../../src/town/TownCavalryReserve'
import { townRoster } from '../../src/town/TownRules'
import type { Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'

function residents(select: (spec: ReturnType<typeof townRoster>[number]) => boolean, count: number): TownCavalryReserveResident[] {
  // Keep the production roster as the identity oracle, but only materialize needed candidate doubles.
  return townRoster().filter(select).slice(0, count).map(spec => {
    const npc = { combatantId: spec.id, dead: false, mount: null } as unknown as NPC
    const homeMount = { dead: false, disposed: false, riderNpc: null, riderPlayer: null } as unknown as Mount
    if (spec.mounted) npc.mount = homeMount
    return { spec, npc, homeMount }
  })
}
function ordinary(count: number, unitType: TownCavalryMissionSlot['unitType'] = 'sword_cavalry'): TownCavalryMissionSlot[] {
  return Array.from({ length: count }, () => ({ unitType }))
}

describe('Town cavalry reserve minimal shortage matrix', () => {

  it('leaves a missing slot rather than reusing the available actor or claiming an unavailable actor', () => {
    const candidates = residents(spec => spec.duty === 'training' && spec.unitKind === 'sword_cavalry', 2)
    expect(selectTownCavalryReserve([candidates[0], candidates[0], candidates[1]], ordinary(2), new Set([candidates[1].spec.id])))
      .toEqual(['cavalry-training:melee_cavalry:0', undefined])
  })
})

describe('Town cavalry reserve readiness and determinism', () => {
  it('excludes dead actors, unavailable identities and mounts that are dead, disposed or occupied', () => {
    const roster = residents(spec => spec.duty === 'training' && spec.mounted, 8)
    Object.assign(roster[0].npc, { dead: true })
    Object.assign(roster[2].homeMount!, { dead: true })
    Object.assign(roster[3].homeMount!, { disposed: true })
    Object.assign(roster[4].homeMount!, { riderPlayer: {} })
    Object.assign(roster[5].homeMount!, { riderNpc: {} })
    Object.assign(roster[6].homeMount!, { riderNpc: roster[6].npc })
    const selected = selectTownCavalryReserve(roster, ordinary(8), new Set([roster[1].spec.id]))
    expect(selected.filter(Boolean)).toEqual([roster[6].spec.id, roster[7].spec.id])
    expect(selected.filter(id => id === undefined)).toHaveLength(6)
  })

  it('can use a healthy home mount when the current mount is unavailable, or a healthy current mount when home is unavailable', () => {
    const roster = residents(spec => spec.duty === 'training' && spec.mounted, 3)
    roster[0].npc.mount = { dead: true } as Mount
    roster[1].homeMount = { dead: true } as Mount
    roster[2].npc.mount = null
    const selected = selectTownCavalryReserve(roster, ordinary(3))
    expect(selected).toEqual(roster.map(r => r.spec.id))
  })
})
