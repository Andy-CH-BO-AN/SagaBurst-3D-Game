import { describe, expect, it } from 'vitest'
import { claimCareerMission, clearCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptVeteranMission, createVeteranRoster, getVeteranMissionAvailability } from '../../src/career/VeteranMission'
const first = 'veteran-dread-outpost', second = 'veteran-scout-hunters', village = 'veteran-village-intercept'
const stats = { damageDealt: 50, damageTaken: 0, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
const veteran = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'veteran', totalMerit: 900, availableMerit: 900, ownedMounts: ['horse'] })
describe('Veteran progression and stable borrowed rosters', () => {
  it('permits independent Veteran mission selection while enforcing rank, mount and race mutual exclusion', () => {
    const soldier = { ...veteran(), rank: 'soldier' as const }
    expect(getVeteranMissionAvailability(soldier, second).unlocked).toBe(false)
    const unmounted = { ...veteran(), ownedMounts: [] }
    expect(getVeteranMissionAvailability(unmounted, second).unlocked).toBe(false)
    expect(getVeteranMissionAvailability(unmounted, first).unlocked).toBe(true) // first doesn't require mount
    const racing = { ...veteran(), activeRace: { id: 'test-race', raceId: 'cavalry-sprint', laps: 1, currentLap: 1, checkpoints: [] } as any }
    expect(getVeteranMissionAvailability(racing, second).unlocked).toBe(false)
    expect(acceptVeteranMission(racing, second)).toBeNull()
    expect(getVeteranMissionAvailability(veteran(), second).unlocked).toBe(true)
    expect(getVeteranMissionAvailability(veteran(), 'veteran-tragedy-of-the-scouts').unlocked).toBe(true)

    const accepted = acceptVeteranMission(veteran(), first, { missionId: 'victory' })!
    const claimed = claimCareerMission(accepted, 'victory', 'victory', stats)
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(claimed.profile)))!
    expect(loaded.careerMissionCompletionsByTier?.[3]).toBe(1)
    expect(getVeteranMissionAvailability(clearCareerMission(loaded, 'victory'), second).unlocked).toBe(true)
    const duplicate = claimCareerMission(loaded, 'victory', 'victory', stats)
    expect(duplicate.alreadyClaimed).toBe(true); expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(loaded.totalMerit)
  })
  it('allows failed mission to retry and does not block other veteran missions after failure', () => {
    const accepted = acceptVeteranMission(veteran(), first, { missionId: 'failed' })!
    const returned = clearCareerMission(claimCareerMission(accepted, 'failed', 'failure', stats).profile, 'failed')
    expect(getVeteranMissionAvailability(returned, second).unlocked).toBe(true)
    expect(acceptVeteranMission(returned, first, { missionId: 'retry' })).not.toBeNull()
  })
  it('borrows only available permanent cavalry and fills the exact shortage with stable temporary identities', () => {
    const available = ['cavalry-training:ranged_cavalry:7', 'cavalry-training:melee_cavalry:3']
    const profile = { ...veteran(), completedCareerMissionTemplateIds: [first, second] }
    const accepted = acceptVeteranMission(profile, village, {
      missionId: 'shortage', availableTownCavalryActorIds: [...available, 'civilian-0', available[0]],
    })!
    const active = accepted.activeMission!
    const roster = createVeteranRoster(village, 'roman', active.id, active.veteranRosterVersion, active.borrowedActorIds)
    const ordinary = roster.friendly.filter(unit => unit.tier === 3)
    expect(ordinary.filter(unit => unit.source === 'town').map(unit => unit.actorId).sort()).toEqual([...available].sort())
    expect(ordinary.filter(unit => unit.source === 'temporary')).toHaveLength(45)
    expect(roster.friendly.map(unit => unit.actorId)).toEqual(active.friendlyActorIds)
    expect(new Set(active.friendlyActorIds).size).toBe(active.friendlyActorIds.length)
  })
})
