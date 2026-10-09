import { describe, expect, it } from 'vitest'
import { townActorHeroProfile, townCaptainProfile, townRoster, townMilitaryEquipment, townAssaultObjectiveRoster } from '../../src/town/TownRules'
import { townConquestRoster, resolveTownHRLayout } from '../../src/town/TownHRLayout'
import { selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { siegeDefensePlans } from '../../src/career/TownSiege'
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

  // Faction is a policy axis; no actors, world or movement state machine are created here.
  it.each([
    { faction: 'roman', presetId: 'roman_sword_cavalry', officerWeapon: 'centurion_blade', weapon: 'gladius_standard',
      shield: 'scutum_t2', hero: { visualAssetId: 'roman-hero-t4', combatProfileId: 'praetorian', baseLoadoutTier: 3, mountOverride: 'corgi' } },
    { faction: 'viking', presetId: 'viking_sword_cavalry', officerWeapon: 'viking_axe_t3', weapon: 'viking_axe_t2',
      shield: 'round_shield_t2', hero: { visualAssetId: 'viking-hero-t4', combatProfileId: 'varangian', baseLoadoutTier: 3, mountOverride: 'black-cat' } },
  ] as const)('equips $faction patrol officers with the canonical T4 hero profile and ordinary riders with T2 weapons', ({ faction, presetId, officerWeapon, weapon, shield, hero }) => {
    expect(townCaptainProfile(faction)).toEqual(hero)
    for (const spec of townRoster().filter(s => s.duty === 'patrol')) {
      const equipment = townMilitaryEquipment(faction, spec)
      expect(equipment.presetId).toBe(presetId)
      expect(equipment.loadout.mountId).toBe('horse')
      if (spec.patrolLeader) {
        expect(townActorHeroProfile(faction, spec)).toEqual(hero)
        expect(equipment).toMatchObject({ tier: 3, level: 4, loadout: { meleeWeaponId: officerWeapon } })
      } else {
        expect(equipment).toMatchObject({ tier: 2, level: 2,
          loadout: { meleeWeaponId: weapon, rangedWeaponId: null, shieldId: shield, mountId: 'horse' } })
        expect(townActorHeroProfile(faction, spec)).toBeUndefined()
      }
    }
  })

  it.each(['roman', 'viking'] as const)('includes patrols in the %s conquest population while preserving assault objective membership', faction => {
    const roster = townRoster()
    expect(townConquestRoster(resolveTownHRLayout(faction, [], []))).toHaveLength(roster.length + 1)
    expect(townAssaultObjectiveRoster()).toHaveLength(208)
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
