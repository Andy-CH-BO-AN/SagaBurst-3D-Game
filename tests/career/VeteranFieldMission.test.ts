import { describe, expect, it } from 'vitest'
import { createVeteranMissionProfile } from '../helpers/veteranFieldBuilders'
import { createVeteranRoster, createVeteranSpawnSpec, getVeteranMissionDefinition } from '../../src/career/VeteranMission'

describe('Veteran field mission contracts without runtime materialization', () => {
  it.each([
    ['veteran-scout-hunters', 100, 40, 22, 77, 4, 40],
    ['veteran-village-intercept', 50, 100, 49, 0, 2, 2],
    ['veteran-spear-line-hunt', 50, 100, 48, 1, 2, 4],
    ['veteran-tragedy-of-the-scouts', 20, 100, 2, 17, 19, 4],
  ] as const)('creates %s with its official composition, metadata and stable actor mapping',
    (templateId, friendlyTotal, enemyTotal, borrowed, support, friendlyT4, enemyT4) => {
      const profile = createVeteranMissionProfile(templateId, { missionId: 'contract' })
      const active = profile.activeMission!
      const roster = createVeteranRoster(templateId, profile.faction, active.id, active.veteranRosterVersion ?? 1)
      expect(getVeteranMissionDefinition(templateId)).toMatchObject({
        kind: 'veteran-field', minRank: 'veteran', requiresMount: true,
        friendlyCombatants: friendlyTotal, enemyCombatants: enemyTotal,
      })
      expect(active).toMatchObject({ kind: 'veteran-field', phase: 'ASSEMBLING', acceptedAt: 0 })
      expect(roster.friendly).toHaveLength(friendlyTotal - 1)
      expect(roster.enemy).toHaveLength(enemyTotal)
      expect(roster.friendly.filter(unit => unit.source === 'town')).toHaveLength(borrowed)
      expect(roster.friendly.filter(unit => unit.source === 'temporary')).toHaveLength(support)
      expect(roster.friendly.filter(unit => unit.tier === 4)).toHaveLength(friendlyT4)
      expect(roster.enemy.filter(unit => unit.tier === 4)).toHaveLength(enemyT4)
      expect(roster.friendly.every(unit => unit.mounted)).toBe(true)
      expect(roster.enemy.every(unit => unit.mounted)).toBe(
        templateId === 'veteran-scout-hunters' || templateId === 'veteran-tragedy-of-the-scouts')
      expect(active.friendlyActorIds).toEqual(roster.friendly.map(unit => unit.actorId))
      expect(active.targetActorIds).toEqual(roster.enemy.map(unit => unit.actorId))
      expect(active.borrowedActorIds).toEqual(roster.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId))
      const ids = [...active.friendlyActorIds, ...active.targetActorIds]
      expect(new Set(ids).size).toBe(ids.length)
      for (const unit of roster.friendly) {
        expect(createVeteranSpawnSpec(unit, profile.faction)).toMatchObject({
          actorId: unit.actorId, tier: unit.tier, squadId: unit.squadId,
          cavalry: true, respawnEnabled: false,
        })
      }
    })
})
