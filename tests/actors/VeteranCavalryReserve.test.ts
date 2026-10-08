import { describe, expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import {
  acceptVeteranMission,
  createVeteranRoster,
  restoreVeteranTownCavalryReserveRoster,
  veteranTownCavalryReserveSlots,
  VETERAN_MISSION_IDS,
  type VeteranMissionRoster,
  type VeteranMissionTemplateId,
  type VeteranRosterVersion,
} from '../../src/career/VeteranMission'
import { selectTownCavalryReserve, type TownCavalryReserveResident } from '../../src/town/TownCavalryReserve'
import { townRoster } from '../../src/town/TownRules'
import type { Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'

const veteran = (): CareerProfile => ({
  ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900,
  ownedMounts: ['horse'], completedCareerMissionTemplateIds: [...VETERAN_MISSION_IDS],
})

function residents(): TownCavalryReserveResident[] {
  return townRoster().map(spec => {
    const npc = { combatantId: spec.id, dead: false } as NPC
    const mount = { dead: false, disposed: false, riderNpc: npc, riderPlayer: null } as Mount
    npc.mount = spec.mounted || spec.role === 'ranger' ? mount : null
    return { spec, npc }
  })
}

function composition(roster: VeteranMissionRoster) {
  return roster.friendly.map(({ presetId, tier, squadId, leader, heroRole, mounted }) => ({
    presetId, tier, squadId, leader, heroRole, mounted,
  }))
}

describe('Veteran Town cavalry reserve roster integration', () => {
  it.each([
    'veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt',
  ] as const)('fills existing slots for %s without changing mission composition', templateId => {
    const original = createVeteranRoster(templateId, 'roman', 'reserve')
    const slots = veteranTownCavalryReserveSlots(original)
    const selected = selectTownCavalryReserve(residents(), slots)
    const accepted = acceptVeteranMission(veteran(), templateId, {
      missionId: 'reserve', townCavalryReserveActorIds: selected,
    })!
    const active = accepted.activeMission!
    const restored = restoreVeteranTownCavalryReserveRoster(
      createVeteranRoster(templateId, 'roman', active.id, active.veteranRosterVersion, active.borrowedActorIds), active,
    )
    expect(restored.friendly).toHaveLength(original.friendly.length)
    expect(composition(restored)).toEqual(composition(original))
    expect(restored.squadSizes).toEqual(original.squadSizes)
    expect(restored.friendlyTotal).toBe(original.friendlyTotal)
    expect(active.borrowedActorIds).toEqual(selected.filter(id => id !== undefined))
    selected.forEach((actorId, index) => {
      if (actorId !== undefined) expect(restored.friendly[index]).toMatchObject({ actorId, source: 'town' })
      else expect(restored.friendly[index].source).toBe('temporary')
    })
    expect(new Set(active.friendlyActorIds).size).toBe(original.friendly.length)
    if (templateId === 'veteran-scout-hunters') {
      expect(selected.filter(id => id?.startsWith('cavalry-training:'))).toHaveLength(60)
      expect(selected.filter(id => id?.startsWith('town-patrol:a:') && !id.endsWith(':captain'))).toHaveLength(19)
      expect(selected.filter(id => id?.startsWith('town-patrol:b:') && !id.endsWith(':captain'))).toHaveLength(16)
    }
  })

  it('uses Patrol Captains only for compatible Tragedy T4 Captain slots, including non-leaders', () => {
    const original = createVeteranRoster('veteran-tragedy-of-the-scouts', 'roman', 'tragedy', 2)
    const slots = veteranTownCavalryReserveSlots(original)
    expect(slots).toHaveLength(19)
    expect(slots.filter(slot => slot.officer === 'captain')).toHaveLength(9)
    expect(slots.filter(slot => slot.officer === 'ranger')).toHaveLength(10)
    expect(slots.filter(slot => slot.preferredActorId).map(slot => slot.preferredActorId)).toEqual(['captain', 'ranger'])
    const selected = selectTownCavalryReserve(residents(), slots)
    expect(selected.filter(Boolean)).toEqual(['captain', 'town-patrol:a:captain', 'town-patrol:b:captain', 'ranger'])
    const accepted = acceptVeteranMission(veteran(), 'veteran-tragedy-of-the-scouts', {
      missionId: 'tragedy', townCavalryReserveActorIds: selected,
    })!
    const active = accepted.activeMission!
    const restored = restoreVeteranTownCavalryReserveRoster(
      createVeteranRoster('veteran-tragedy-of-the-scouts', 'roman', active.id, active.veteranRosterVersion), active,
    )
    expect(composition(restored)).toEqual(composition(original))
    expect(restored.friendly.filter(unit => unit.source === 'town')).toHaveLength(4)
    expect(restored.friendly.filter(unit => unit.actorId.startsWith('town-patrol:')).every(unit =>
      unit.tier === 4 && unit.heroRole === 'captain' && !unit.leader)).toBe(true)
    expect(restored.friendly.filter(unit => unit.source === 'temporary')).toHaveLength(15)
  })

  it('writes sparse selections into their exact official slots and assigns identities to missing slots without spawning', () => {
    // Acceptance owns an official data roster; none of its slots need materialized actors.
    const accepted = acceptVeteranMission(veteran(), 'veteran-scout-hunters', {
      missionId: 'sparse', townCavalryReserveActorIds: ['captain', undefined, 'cavalry-training:melee_cavalry:0'],
    })!
    const active = accepted.activeMission!
    expect(active.friendlyActorIds).toHaveLength(99)
    expect(active.friendlyActorIds.slice(0, 3)).toEqual(['captain', 'sparse:temporary:friendly:reserve-1', 'cavalry-training:melee_cavalry:0'])
    expect(active.borrowedActorIds).toEqual(['captain', 'cavalry-training:melee_cavalry:0'])
    expect(active.friendlyActorIds.filter(id => id.startsWith('sparse:temporary:friendly:'))).toHaveLength(97)
    expect(new Set(active.friendlyActorIds).size).toBe(99)
  })

  it('keeps a saved borrowed/temporary pair even when fresh candidates fill both slots', () => {
    const candidates = residents().filter(r => r.spec.duty === 'training' && r.spec.unitKind === 'sword_cavalry').slice(0, 2)
    const saved = { kind: 'veteran-field' as const,
      friendlyActorIds: ['cavalry-training:melee_cavalry:0', 'saved:temporary:x'],
      borrowedActorIds: ['cavalry-training:melee_cavalry:0'] }
    const freshIds = selectTownCavalryReserve(candidates, [{ unitType: 'sword_cavalry' }, { unitType: 'sword_cavalry' }])
    expect(freshIds).toEqual(['cavalry-training:melee_cavalry:0', 'cavalry-training:melee_cavalry:1'])
    const fresh: VeteranMissionRoster = { playerIncluded: true, friendlyTotal: 3, enemyTotal: 0,
      reinforcementTotal: 0, squadSizes: [3], enemy: [], reinforcements: [],
      friendly: freshIds.map(actorId => ({ actorId: actorId!, source: 'town', townRole: 'melee_cavalry',
        presetId: 'roman_sword_cavalry', tier: 3, squadId: 1, leader: false, mounted: true })) }
    const restored = restoreVeteranTownCavalryReserveRoster(fresh, saved)
    expect(restored.friendly.map(({ actorId, source }) => ({ actorId, source }))).toEqual([
      { actorId: 'cavalry-training:melee_cavalry:0', source: 'town' },
      { actorId: 'saved:temporary:x', source: 'temporary' },
    ])
    expect(restored.friendly[1].townRole).toBeUndefined()
    expect(saved.friendlyActorIds).toEqual(['cavalry-training:melee_cavalry:0', 'saved:temporary:x'])
  })

  it('honors explicit empty and undefined selections without automatically borrowing Training actors', () => {
    for (const selected of [[], Array.from({ length: 49 }, () => undefined)]) {
      const accepted = acceptVeteranMission(veteran(), 'veteran-village-intercept', {
        missionId: 'shortage', townCavalryReserveActorIds: selected,
        availableTownCavalryActorIds: townRoster().filter(spec => spec.training && spec.mounted).map(spec => spec.id),
      })!
      const active = accepted.activeMission!
      expect(active.borrowedActorIds).toEqual([])
      expect(active.friendlyActorIds).toHaveLength(49)
      expect(active.friendlyActorIds.every(id => id.startsWith('shortage:temporary:friendly:'))).toBe(true)
      const restored = restoreVeteranTownCavalryReserveRoster(
        createVeteranRoster('veteran-village-intercept', 'roman', active.id, active.veteranRosterVersion), active,
      )
      expect(restored.friendly.every(unit => unit.source === 'temporary')).toBe(true)
      expect(new Set(active.friendlyActorIds).size).toBe(49)
    }
  })

  it('restores each saved friendly slot and source without recalculating available residents', () => {
    const templateId = 'veteran-scout-hunters'
    const roster = createVeteranRoster(templateId, 'roman', 'reload')
    const selected = selectTownCavalryReserve(residents(), veteranTownCavalryReserveSlots(roster),
      new Set(['cavalry-training:lancer_cavalry:0', 'town-patrol:a:0']))
    const accepted = acceptVeteranMission(veteran(), templateId, {
      missionId: 'reload', townCavalryReserveActorIds: selected,
    })!
    const active = parseCareerProfile(JSON.parse(JSON.stringify(accepted)))!.activeMission!
    const restored = restoreVeteranTownCavalryReserveRoster(createVeteranRoster(templateId, 'roman', active.id, 1), active)
    expect(restored.friendly.map(unit => unit.actorId)).toEqual(active.friendlyActorIds)
    expect(restored.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId)).toEqual(active.borrowedActorIds)
    expect(composition(restored)).toEqual(composition(roster))
    // Metadata is sufficient to identify old Town borrowing if a legacy save omitted the explicit list.
    const inferred = restoreVeteranTownCavalryReserveRoster(createVeteranRoster(templateId, 'roman', active.id, 1), {
      ...active, borrowedActorIds: undefined,
    })
    expect(inferred.friendly.map(unit => unit.source)).toEqual(restored.friendly.map(unit => unit.source))
  })

  it.each(['veteran-dread-outpost', 'veteran-outpost-assault'] as const)('leaves %s Campaign behavior unchanged', templateId => {
    const baseline = acceptVeteranMission(veteran(), templateId, { missionId: 'campaign', acceptedAt: 1 })!
    const selected = acceptVeteranMission(veteran(), templateId, {
      missionId: 'campaign', acceptedAt: 1, townCavalryReserveActorIds: ['town-patrol:a:0'],
    })!
    expect(selected).toEqual(baseline)
    const roster = createVeteranRoster(templateId, 'roman', 'campaign')
    const original = JSON.parse(JSON.stringify(roster))
    restoreVeteranTownCavalryReserveRoster(roster, selected.activeMission!)
    expect(roster).toEqual(original)
  })

  it.each([
    ['veteran-scout-hunters', 1],
    ['veteran-village-intercept', 1],
    ['veteran-spear-line-hunt', 2],
    ['veteran-village-intercept', 3],
    ['veteran-tragedy-of-the-scouts', 2],
  ] as const)('preserves saved %s roster version %s and explicit legacy E/F borrowing', (templateId, version) => {
    const explicit = version === 3 ? ['lancer_cavalry-0', 'ranged_cavalry-1'] : undefined
    const original = createVeteranRoster(templateId as VeteranMissionTemplateId, 'roman', 'legacy', version as VeteranRosterVersion, explicit)
    const active = {
      kind: 'veteran-field' as const,
      friendlyActorIds: original.friendly.map(unit => unit.actorId),
      borrowedActorIds: original.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId),
    }
    const restored = restoreVeteranTownCavalryReserveRoster(
      createVeteranRoster(templateId as VeteranMissionTemplateId, 'roman', 'legacy', version as VeteranRosterVersion, explicit), active,
    )
    expect(restored).toEqual(original)
    if (version === 3) expect(active.borrowedActorIds).toEqual(['captain', 'ranger', 'lancer_cavalry-0', 'ranged_cavalry-1'])
  })
})
