import { describe, expect, it } from 'vitest'
import { townActorCaptainProfile, townCaptainProfile, townRoster, townMilitaryEquipment, townAssaultObjectiveRoster } from '../src/town/TownRules'
import { townConquestRoster, resolveTownHRLayout } from '../src/town/TownHRLayout'
import { selectMissionCavalryActorIds } from '../src/career/BanditMissionController'
import { siegeDefensePlans } from '../src/career/TownSiege'
import type { NPC } from '../src/world/NPC'

describe('Town patrol roster contracts', () => {
  it('keeps two twenty-rider patrols distinct from the service Captain, training and gate guards', () => {
    const roster = townRoster(), patrol = roster.filter(s => s.duty === 'patrol')
    expect(roster).toHaveLength(225); expect(patrol).toHaveLength(40)
    expect(new Set(roster.map(s => s.id)).size).toBe(225); expect(townRoster()).toEqual(roster)
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

  it.each(['roman', 'viking'] as const)('equips %s patrol officers with the canonical T4 hero profile and ordinary riders with T2 weapons', faction => {
    for (const spec of townRoster().filter(s => s.duty === 'patrol')) {
      const equipment = townMilitaryEquipment(faction, spec)
      expect(equipment.presetId).toBe(`${faction}_sword_cavalry`)
      expect(equipment.loadout.mountId).toBe('horse')
      if (spec.patrolLeader) expect(townActorCaptainProfile(faction, spec)).toEqual(townCaptainProfile(faction))
      else {
        expect(equipment.level).toBe(2)
        expect(townActorCaptainProfile(faction, spec)).toBeUndefined()
        if (faction === 'viking') expect(equipment.loadout.meleeWeaponId).toBe('viking_axe_t2')
      }
    }
  })

  it.each(['roman', 'viking'] as const)('includes patrols in the %s conquest population while preserving assault objective membership', faction => {
    const roster = townRoster()
    expect(townConquestRoster(resolveTownHRLayout(faction, [], []))).toHaveLength(roster.length + 1)
    expect(townAssaultObjectiveRoster()).toHaveLength(203)
  })

  it('keeps patrol cavalry in the siege defense plans', () => {
    expect(siegeDefensePlans(townRoster()).flatMap(g => g.cavalry)).toHaveLength(102)
  })

  it('excludes patrol identities from ordinary mission cavalry selection', () => {
    const roster = townRoster()
    const fake = roster.map(spec => ({ spec, npc: { dead: false, combatantId: spec.id, mount: { dead: false } } as NPC }))
    expect(selectMissionCavalryActorIds(fake, 59)).toEqual(selectMissionCavalryActorIds(fake.filter(r => r.spec.duty !== 'patrol'), 59))
  })
})
