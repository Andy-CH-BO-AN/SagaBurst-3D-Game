import { describe, expect, it } from 'vitest'
import type { Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'
import { townRoster } from '../../src/town/TownRules'
import {
  selectTownCavalryReserve, townCavalryReserveSource,
  type TownCavalryMissionSlot, type TownCavalryReserveResident,
} from '../../src/town/TownCavalryReserve'

function residents(): TownCavalryReserveResident[] {
  return townRoster().map(spec => {
    const npc = { combatantId: spec.id, dead: false, mount: null } as unknown as NPC
    const homeMount = { dead: false, disposed: false, riderNpc: null, riderPlayer: null } as unknown as Mount
    if (spec.mounted) npc.mount = homeMount
    return { spec, npc, homeMount }
  })
}
function ordinary(count: number, unitType: TownCavalryMissionSlot['unitType'] = 'sword_cavalry'): TownCavalryMissionSlot[] {
  return Array.from({ length: count }, () => ({ unitType }))
}
function selectedResidents(roster: TownCavalryReserveResident[], ids: (string | undefined)[]): TownCavalryReserveResident[] {
  return ids.flatMap(id => id === undefined ? [] : [roster.find(r => r.npc.combatantId === id)!])
}
function sourceCounts(roster: TownCavalryReserveResident[], ids: (string | undefined)[]): number[] {
  const selected = selectedResidents(roster, ids)
  return ['training', 'patrol-a', 'patrol-b'].map(source => selected.filter(r => townCavalryReserveSource(r.spec) === source).length)
}

describe('Town cavalry reserve minimal shortage matrix', () => {
  it.each([
    { available: 0, expected: [undefined, undefined] },
    { available: 1, expected: ['cavalry-training:melee_cavalry:0', undefined] },
    { available: 2, expected: ['cavalry-training:melee_cavalry:0', 'cavalry-training:melee_cavalry:1'] },
  ])('fills two slots from $available available actors without spawning', ({ available, expected }) => {
    const candidates = residents().filter(r => r.spec.duty === 'training' && r.spec.unitKind === 'sword_cavalry').slice(0, available)
    expect(selectTownCavalryReserve(candidates, ordinary(2))).toEqual(expected)
  })

  it('leaves a missing slot rather than reusing the available actor or claiming an unavailable actor', () => {
    const candidates = residents().filter(r => r.spec.duty === 'training' && r.spec.unitKind === 'sword_cavalry').slice(0, 2)
    expect(selectTownCavalryReserve([candidates[0], candidates[0], candidates[1]], ordinary(2), new Set([candidates[1].spec.id])))
      .toEqual(['cavalry-training:melee_cavalry:0', undefined])
  })
})

describe('Town cavalry reserve source and roster boundaries', () => {
  it.each([
    { count: 50, sources: [50, 0, 0], temporary: 0 },
    { count: 80, sources: [60, 19, 1], temporary: 0 },
    { count: 99, sources: [60, 19, 19], temporary: 1 },
    { count: 120, sources: [60, 19, 19], temporary: 22 },
  ])('fills $count ordinary slots without changing composition', ({ count, sources, temporary }) => {
    const roster = residents(), slots = ordinary(count), selected = selectTownCavalryReserve(roster, slots)
    expect(selected).toHaveLength(count)
    expect(sourceCounts(roster, selected)).toEqual(sources)
    expect(selected.filter(id => id === undefined)).toHaveLength(temporary)
    expect(new Set(selected.filter(id => id !== undefined)).size).toBe(count - temporary)
    expect(selectedResidents(roster, selected).every(r => r.spec.tier === 2 && !r.spec.patrolLeader)).toBe(true)
    expect(slots).toEqual(ordinary(count))
  })

  it('borrows all 30 sword slots from Training before considering Patrol native swords', () => {
    const roster = residents(), selected = selectTownCavalryReserve(roster, ordinary(30))
    expect(sourceCounts(roster, selected)).toEqual([30, 0, 0])
    const chosen = selectedResidents(roster, selected)
    expect(chosen.slice(0, 20).every(r => r.spec.unitKind === 'sword_cavalry')).toBe(true)
    expect(chosen.slice(20).every(r => r.spec.unitKind !== 'sword_cavalry')).toBe(true)
  })

  it('matches the entire Training source before taking fallback actors for earlier slot types', () => {
    const roster = residents()
    const slots = [...ordinary(25), ...ordinary(20, 'lancer'), ...ordinary(15, 'horse_archer')]
    const selected = selectTownCavalryReserve(roster, slots)
    expect(sourceCounts(roster, selected)).toEqual([60, 0, 0])
    const chosen = selectedResidents(roster, selected)
    expect(chosen.slice(0, 20).every(r => r.spec.unitKind === 'sword_cavalry')).toBe(true)
    expect(chosen.slice(20, 25).every(r => r.spec.unitKind === 'horse_archer')).toBe(true)
    expect(chosen.slice(25, 45).every(r => r.spec.unitKind === 'lancer')).toBe(true)
    expect(chosen.slice(45).every(r => r.spec.unitKind === 'horse_archer')).toBe(true)
  })

  it('borrows seven individual Patrol A members and leaves both canonical Captains out of ordinary slots', () => {
    const roster = residents()
    const unavailable = new Set(roster.filter(r => r.spec.duty === 'training').map(r => r.spec.id))
    const selected = selectTownCavalryReserve(roster, ordinary(7), unavailable)
    expect(sourceCounts(roster, selected)).toEqual([0, 7, 0])
    expect(selected).toEqual(Array.from({ length: 7 }, (_, index) => `town-patrol:a:${index}`))
    expect(selected).not.toContain('town-patrol:a:captain')
    expect(selected).not.toContain('town-patrol:b:captain')
  })

  it('never implicitly inserts Town Captain, Maki or a Patrol officer', () => {
    const roster = residents()
    expect(selectTownCavalryReserve(roster, [])).toEqual([])
    const selected = selectTownCavalryReserve(roster, ordinary(120, 'horse_archer'))
    expect(selected.filter(Boolean)).toHaveLength(98)
    expect(selected).not.toContain('captain')
    expect(selected).not.toContain('ranger')
    expect(selectedResidents(roster, selected).some(r => r.spec.patrolLeader)).toBe(false)
  })
})

describe('Town cavalry reserve officer compatibility', () => {
  it('reserves named officers first and fills only compatible remaining officer slots from Patrol A then B', () => {
    const roster = residents()
    const slots: TownCavalryMissionSlot[] = [
      { unitType: 'sword_cavalry', officer: 'captain' },
      { unitType: 'sword_cavalry', officer: 'captain', preferredActorId: 'captain' },
      { unitType: 'horse_archer', officer: 'ranger', preferredActorId: 'ranger' },
      { unitType: 'horse_archer', officer: 'captain' },
      { unitType: 'lancer', officer: 'captain' },
      { unitType: 'horse_archer', officer: 'ranger' },
      ...ordinary(1),
    ]
    const selected = selectTownCavalryReserve(roster, slots)
    expect(selected.slice(0, 6)).toEqual(['town-patrol:a:captain', 'captain', 'ranger', 'town-patrol:b:captain', undefined, undefined])
    expect(sourceCounts(roster, selected)).toEqual([1, 0, 0])
  })

  it.each(['sword_cavalry', 'lancer', 'horse_archer'] as const)('fills compatible T4 %s Captain-profile slots without borrowing ordinary actors', unitType => {
    const roster = residents()
    const slots: TownCavalryMissionSlot[] = [
      { unitType, officer: 'captain' },
      { unitType, officer: 'captain' },
      { unitType, officer: 'captain' },
      { unitType: 'horse_archer', officer: 'ranger' },
    ]
    expect(selectTownCavalryReserve(roster, slots)).toEqual(['town-patrol:a:captain', 'town-patrol:b:captain', undefined, undefined])
  })

  it('never promotes an ordinary actor or substitutes a Captain for an unavailable Maki', () => {
    const roster = residents()
    const slots: TownCavalryMissionSlot[] = [
      { unitType: 'sword_cavalry', officer: 'captain', preferredActorId: 'cavalry-training:melee_cavalry:0' },
      { unitType: 'horse_archer', officer: 'ranger', preferredActorId: 'ranger' },
    ]
    const selected = selectTownCavalryReserve(roster, slots, new Set(['ranger']))
    expect(selected).toEqual(['town-patrol:a:captain', undefined])
  })

  it('does not select an actor twice, including duplicate named slots and duplicate resident entries', () => {
    const roster = residents()
    const selected = selectTownCavalryReserve([...roster, ...roster], [
      { unitType: 'sword_cavalry', officer: 'captain', preferredActorId: 'captain' },
      { unitType: 'sword_cavalry', officer: 'captain', preferredActorId: 'captain' },
      { unitType: 'horse_archer', officer: 'ranger', preferredActorId: 'ranger' },
      { unitType: 'horse_archer', officer: 'ranger', preferredActorId: 'ranger' },
      ...ordinary(100),
    ])
    expect(selected.slice(0, 4)).toEqual(['captain', 'town-patrol:a:captain', 'ranger', undefined])
    const ids = selected.filter(id => id !== undefined)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(101)
  })
})

describe('Town cavalry reserve readiness and determinism', () => {
  it('excludes dead actors, unavailable identities and mounts that are dead, disposed or occupied', () => {
    const roster = residents().filter(r => r.spec.duty === 'training' && r.spec.mounted).slice(0, 8)
    roster[0].npc.dead = true
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
    const roster = residents().filter(r => r.spec.duty === 'training' && r.spec.mounted).slice(0, 3)
    roster[0].npc.mount = { dead: true } as Mount
    roster[1].homeMount = { dead: true } as Mount
    roster[2].npc.mount = null
    const selected = selectTownCavalryReserve(roster, ordinary(3))
    expect(selected).toEqual(roster.map(r => r.spec.id))
  })

  it('accepts deterministic NPC identity and rejects unavailable IDs from either spec or runtime identity', () => {
    const roster = residents().filter(r => r.spec.duty === 'training' && r.spec.mounted).slice(0, 1)
    roster[0].npc.combatantId = 'town-runtime:cavalry-0'
    expect(selectTownCavalryReserve(roster, ordinary(1))).toEqual(['town-runtime:cavalry-0'])
    expect(selectTownCavalryReserve(roster, ordinary(1), new Set([roster[0].spec.id]))).toEqual([undefined])
    expect(selectTownCavalryReserve(roster, ordinary(1), new Set([roster[0].npc.combatantId]))).toEqual([undefined])
  })

  it('keeps shortage selection stable across resident ordering without mutating roster metadata', () => {
    const roster = residents(), slots = [...ordinary(45, 'lancer'), ...ordinary(75, 'horse_archer')]
    const original = roster.map(r => ({ ...r.spec }))
    const first = selectTownCavalryReserve(roster, slots)
    expect(selectTownCavalryReserve([...roster].reverse(), slots)).toEqual(first)
    expect(selectTownCavalryReserve(roster, slots)).toEqual(first)
    expect(first.filter(id => id === undefined)).toHaveLength(22)
    expect(roster.map(r => r.spec)).toEqual(original)
  })
})
