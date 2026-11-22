import { describe, expect, it } from 'vitest'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { careerMissionMerit, createCareerProfile } from '../../src/career/CareerProfile'
import { applyCoopMissionMerit, emptyCoopStats, parseCoopMissionMerit, recordCoopGuestEvent } from '../../src/coop/CoopMissionMerit'

const actor = (actorId: string, allegiance: string) => ({ actorId, actorType: 'npc', allegiance }) as unknown as CombatEvent['source']
const target = (targetId: string, allegiance: string) => ({ targetId, allegiance }) as unknown as CombatEvent['target']

describe('Co-op guest mission merit', () => {
  it('counts only the guest’s own combat and awards it once by the host’s single-player rules', () => {
    const stats = emptyCoopStats(), guest = new Set(['proxy-1', 'personal:a'])
    const damage = (source: string, to: string, from: string, toSide: string, applied: number) =>
      ({ type: 'damage_applied', source: actor(source, from), target: target(to, toSide), method: 'melee', requestedDamage: applied, appliedDamage: applied }) as CombatEvent
    recordCoopGuestEvent(stats, damage('proxy-1', 'enemy-1', 'PLAYER', 'ENEMY', 120), guest)
    recordCoopGuestEvent(stats, damage('personal:a', 'enemy-2', 'PLAYER', 'ENEMY', 30), guest)
    recordCoopGuestEvent(stats, damage('host-squad', 'enemy-3', 'PLAYER', 'ENEMY', 500), guest) // the host's, not the guest's
    recordCoopGuestEvent(stats, damage('enemy-1', 'proxy-1', 'ENEMY', 'PLAYER', 40), guest)
    recordCoopGuestEvent(stats, { type: 'actor_killed', source: actor('proxy-1', 'PLAYER'), target: target('enemy-1', 'ENEMY'), method: 'melee' } as CombatEvent, guest)
    expect([stats.damageDealt, stats.damageTaken, stats.kills]).toEqual([150, 40, 1])
    // Siege vehicles the guest breaks count as its structure contribution; the host's do not.
    const structure = (source: string, type: 'structure_damaged' | 'structure_destroyed') => ({ type, source: actor(source, 'PLAYER'),
      target: target('ramp:west', 'ENEMY'), method: 'melee', requestedDamage: 80, appliedDamage: 80, hpRatio: 0 }) as CombatEvent
    recordCoopGuestEvent(stats, structure('proxy-1', 'structure_damaged'), guest)
    recordCoopGuestEvent(stats, structure('proxy-1', 'structure_destroyed'), guest)
    recordCoopGuestEvent(stats, structure('host-squad', 'structure_damaged'), guest)
    expect([stats.structureDamage, stats.structuresDestroyed]).toEqual([80, 1])

    const record = parseCoopMissionMerit({ missionId: 'host-mission-1', kind: 'captain-outpost-defense', victory: true, stats })!
    const expected = careerMissionMerit('captain-outpost-defense', 'victory', stats).total
    const profile = createCareerProfile('roman')
    const awarded = applyCoopMissionMerit(profile, record)
    expect(awarded.merit).toBe(expected)
    expect(awarded.profile.totalMerit - profile.totalMerit).toBe(expected)
    expect(awarded.profile.claimedBattleIds).toContain('host-mission-1')
    // A re-sent record for the same host mission never pays twice.
    expect(applyCoopMissionMerit(awarded.profile, record)).toEqual({ profile: awarded.profile, merit: 0 })
    expect(parseCoopMissionMerit({ ...record, stats: { ...stats, kills: -1 } })).toBeNull()
  })

  it('pays a prison escape the fixed single-player reward under its own receipt, once, without touching battle stats', () => {
    const profile = createCareerProfile('viking')
    profile.claimedBattleIds.push('host-mission-2') // the lost parent battle's own receipt
    const record = parseCoopMissionMerit({ missionId: 'host-mission-2:prison-break', kind: 'prison-break', victory: true, prison: 'veteran-iron-tide', stats: emptyCoopStats() })!
    const awarded = applyCoopMissionMerit(profile, record)
    expect(awarded.merit).toBe(200)
    expect(awarded.profile.availableMerit - profile.availableMerit).toBe(200)
    expect(awarded.profile.lifetimeStats).toEqual(profile.lifetimeStats)
    expect(applyCoopMissionMerit(awarded.profile, record).merit).toBe(0)
    expect(applyCoopMissionMerit(profile, { ...record, missionId: 'host-mission-3:prison-break', victory: false }).merit).toBe(0)
    expect(parseCoopMissionMerit({ ...record, prison: 'arena-trial' })).toBeNull()
    expect(parseCoopMissionMerit({ ...record, prison: undefined })).toBeNull()
  })
})
