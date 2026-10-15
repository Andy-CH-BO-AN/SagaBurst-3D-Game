import { describe, expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import {
  acceptVeteranMission,
  restoreVeteranTownCavalryReserveRoster,
  VETERAN_MISSION_IDS,
  type VeteranMissionRoster
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

describe('Veteran Town cavalry reserve roster integration', () => {

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
})
