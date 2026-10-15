import { describe, expect, it, vi } from 'vitest'
import { acceptCaptainFrontline } from '../../src/career/CaptainBattleLaunch'
import { addCareerItem } from '../../src/career/CareerInventory'
import { prepareFailedCareerMissionReturn, recoverFailedCareerMission } from '../../src/career/CareerMissionRecovery'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'

function withMission(): CareerProfile {
  const base = createCareerProfile('viking')
  base.rank = 'captain'
  base.totalMerit = 10000
  base.availableMerit = 3700
  // Producing valid Career inventory and mission actor IDs through real APIs.
  const recruited = recruitPersonalSquadMember(base, 'captain', () => true, () => 'personal:a')
  if (!recruited.recruited) throw new Error('Failed to create owned Captain test fixture')
  const profile = recruited.profile
  addCareerItem(profile, 'xongkoro', 1)
  profile.personalSquad!.members[0].equipment!.mount = 'xongkoro'
  const accepted = acceptCaptainFrontline(profile, 'mission:a')
  if (!accepted) throw new Error('Failed to accept Captain test fixture mission')
  return accepted
}

describe('Career mission technical failure recovery', () => {
  it('removes only failed mission state and preserves owned eagles, member IDs and permanent progress', () => {
    const current = withMission()
    const recovered = prepareFailedCareerMissionReturn(current, 'mission:a')!
    expect(recovered.activeMission).toBeUndefined()
    expect(recovered.personalSquad).toEqual(current.personalSquad)
    expect(recovered.personalSquadRuntime?.memberIds).toEqual(['personal:a'])
    expect(recovered.totalMerit).toBe(10000)
    expect(recovered.availableMerit).toBe(3200)
    expect(recovered.rank).toBe('captain')
    expect(recovered.lifetimeStats).toEqual(current.lifetimeStats)
    expect(recovered.claimedBattleIds).toEqual([])
    expect(current.activeMission?.id).toBe('mission:a')
  })

  it('retains a documented loss in the failed mission checkpoint without reviving the actor', () => {
    const current = withMission()
    current.activeMission!.personalSquad!.members['personal:a'] = { status: 'dead', hp: 0 }
    const recovered = prepareFailedCareerMissionReturn(current, 'mission:a')!
    expect(recovered.personalSquadRuntime?.members['personal:a']).toMatchObject({ status: 'dead', hp: 0 })
  })

  it('refuses a stale mission ID without altering a new active mission', () => {
    const current = withMission()
    expect(prepareFailedCareerMissionReturn(current, 'mission:another')).toBeNull()
    const save = vi.fn(() => true)
    expect(recoverFailedCareerMission({ loadChecked: () => ({ profile: current }), save }, 'mission:another')).toBe('stale')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not claim or settle an Outpost mission on technical failure', () => {
    const current = withMission()
    delete current.activeMission
    current.activeOutpostMission = { id: 'mission:outpost', kind: 'outpost-defense', stageId: 3, acceptedAt: 1 }
    const recovered = prepareFailedCareerMissionReturn(current, 'mission:outpost')!
    expect(recovered.activeOutpostMission).toBeUndefined()
    expect(recovered.totalMerit).toBe(current.totalMerit)
    expect(recovered.lifetimeStats.battles).toBe(current.lifetimeStats.battles)
    expect(recovered.outpostBattleRecords).toEqual(current.outpostBattleRecords)
    expect(recovered.claimedBattleIds).toEqual(current.claimedBattleIds)
  })

  it('round-trips recovered state through the CareerProfileStore and is idempotent', () => {
    const items = new Map<string, string>()
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
    } as Storage
    const store = new CareerProfileStore(storage)
    expect(store.save(withMission())).toBe(true)
    expect(recoverFailedCareerMission(store, 'mission:a')).toBe('recovered')
    const loaded = store.loadChecked()
    expect(loaded.error).toBeUndefined()
    expect(loaded.profile?.activeMission).toBeUndefined()
    expect(loaded.profile?.personalSquad?.members.map(member => member.id)).toEqual(['personal:a'])
    expect(recoverFailedCareerMission(store, 'mission:a')).toBe('stale')
  })

  it('does not alter the original profile if the storage write fails', () => {
    const current = withMission(), before = JSON.stringify(current)
    const save = vi.fn(() => false)
    expect(recoverFailedCareerMission({ loadChecked: () => ({ profile: current }), save }, 'mission:a')).toBe('storage-error')
    expect(save).toHaveBeenCalledOnce()
    expect(JSON.stringify(current)).toBe(before)
  })
})
