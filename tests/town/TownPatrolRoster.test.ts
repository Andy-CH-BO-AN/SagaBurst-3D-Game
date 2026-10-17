import { Box3, Vector3 } from 'three'
import { townHousing } from '../../src/town/TownLayout'
import { describe, expect, it } from 'vitest'
import { selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
import { civilianHumanoidAssetId } from '../../src/world/CivilianAppearance'
import { civilianDistrict, civilianHomeAnchor, civilianPointLegal } from '../../src/town/TownCivilianLife'

describe('Town patrol roster contracts', () => {
  it('selects faction civilian sources without changing resident identities or district allocation', () => {
    const residents = townRoster().filter(spec => spec.role === 'civilian')
    expect(residents.map(spec => spec.id)).toEqual(Array.from({ length: 20 }, (_, i) => `civilian-${i}`))
    expect(residents.map(spec => civilianDistrict(spec.index))).toEqual([
      ...Array(20).fill('housing'),
    ])
    const obstacles = townHousing('viking').map(home => ({ isBarricade: false, box: new Box3(
      new Vector3(home.x - home.width / 2 - .2, -100, home.z - home.depth / 2 - .2),
      new Vector3(home.x + home.width / 2 + .2, 100, home.z + home.depth / 2 + .2)) }))
    const placed: { x: number; z: number }[] = []
    for (const resident of residents) {
      const anchor = civilianHomeAnchor(resident.index, placed, obstacles)
      expect(anchor).toEqual(civilianHomeAnchor(resident.index, placed, obstacles))
      expect(civilianPointLegal(anchor, placed, obstacles)).toBe(true)
      expect(townHousing('viking').some(home => Math.hypot(anchor.x - home.x, anchor.z - home.z) < 11)).toBe(true)
      placed.push(anchor)
    }
    expect(new Set(placed.map(p => townHousing('viking').reduce((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b).id)).size).toBeGreaterThanOrEqual(8)
    expect(civilianHumanoidAssetId('roman')).toBe('roman-civilian')
    expect(civilianHumanoidAssetId('viking')).toBe('viking-civilian')
  })
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
