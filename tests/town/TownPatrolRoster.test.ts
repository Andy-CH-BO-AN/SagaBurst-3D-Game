import { describe, expect, it } from 'vitest'
import { selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'

describe('Town patrol roster contracts', () => {
  it('keeps two twenty-rider patrols distinct from the service Captain, training and gate guards', () => {
    const roster = townRoster(), patrol = roster.filter(s => s.duty === 'patrol')
    expect(roster).toHaveLength(230); expect(patrol).toHaveLength(40)
    expect(new Set(roster.map(s => s.id)).size).toBe(230); expect(townRoster()).toEqual(roster)
    expect(roster.filter(s => s.role === 'captain')).toHaveLength(1)
    for (const id of ['A', 'B']) {
      const members = patrol.filter(s => s.patrolId === id)
      expect(members).toHaveLength(20); expect(members.filter(s => s.patrolLeader)).toHaveLength(1)
      expect(members.filter(s => !s.patrolLeader)).toHaveLength(19)
      for (const s of members) {
        expect(s).toMatchObject({ mounted: true, training: false, assaultObjective: false, tier: s.patrolLeader ? 4 : 2 })
        expect(s.defenseGroup).toBeUndefined(); expect(s.role).not.toBe('captain')
      }
    }
    expect(roster.filter(s => s.mounted && s.duty === 'training')).toHaveLength(60)
    expect(roster.filter(s => s.duty === 'gate_guard')).toHaveLength(40)
  })

  it('excludes patrol identities from ordinary mission cavalry selection', () => {
    const roster = townRoster()
    const fake = roster.map(spec => ({ spec, npc: { dead: false, combatantId: spec.id, mount: { dead: false } } as NPC }))
    expect(selectMissionCavalryActorIds(fake, 59)).toEqual(selectMissionCavalryActorIds(fake.filter(r => r.spec.duty !== 'patrol'), 59))
  })
})
