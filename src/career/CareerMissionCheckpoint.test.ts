import { describe, expect, it, vi } from 'vitest'
import { CareerMissionCheckpoint } from './CareerMissionCheckpoint'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from './CareerProfile'
import { createActiveCareerMission } from './CareerMissionState'
import { CAREER_STORAGE_KEY, CareerProfileStore } from './CareerProfileStore'

function fixture() {
  let profile = createCareerProfile('roman')
  profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'checkpoint', 'bandit', 'captain')
  let saving = true
  let stage = 0
  const read = vi.fn(() => profile)
  const commit = vi.fn((next: CareerProfile) => { if (!saving) return false; profile = next; return true })
  const checkpoint = new CareerMissionCheckpoint(read, commit)
  const snapshot = vi.fn(() => ({ ...profile.activeMission!, routeStage: stage }))
  return { checkpoint, read, commit, snapshot,
    get profile() { return profile },
    setStage(value: number) { stage = value },
    setSaving(value: boolean) { saving = value },
    setProfile(value: CareerProfile) { profile = value },
  }
}

describe('CareerMissionCheckpoint', () => {
  it('waits five seconds for periodic changes and restarts the clock only after saving', () => {
    const h = fixture(), periodic = { immediate: false, periodic: true }
    h.setStage(1)
    h.checkpoint.advance(4.99)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(false)
    expect(h.read).not.toHaveBeenCalled()
    expect(h.snapshot).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    h.checkpoint.advance(.01)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(true)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    h.setStage(2)
    h.checkpoint.advance(4.99)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(false)
    h.checkpoint.advance(.01)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(true)
    expect(h.profile.activeMission!.routeStage).toBe(2)
  })

  it('saves immediate changes with the complete current snapshot and resets the periodic clock', () => {
    const h = fixture()
    h.checkpoint.advance(4)
    const snapshot = () => ({ ...h.profile.activeMission!, routeStage: 3,
      mountedMarchPosition: { x: 12, z: 34 },
      playerStats: { damageDealt: 90, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    })
    expect(h.checkpoint.persist(snapshot, { immediate: true })).toBe(true)
    expect(h.profile.activeMission).toMatchObject({ routeStage: 3, mountedMarchPosition: { x: 12, z: 34 }, playerStats: { damageDealt: 90, kills: 1 } })
    h.checkpoint.advance(1)
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, periodic: true })).toBe(false)
    expect(h.commit).toHaveBeenCalledOnce()
  })

  it('forces only changed periodic data, never an unchanged snapshot', () => {
    const h = fixture()
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, periodic: false, force: true })).toBe(false)
    h.checkpoint.advance(5)
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, force: true })).toBe(false)
    expect(h.commit).not.toHaveBeenCalled()
    h.checkpoint.reset()
    h.setStage(1)
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, periodic: true, force: true })).toBe(true)
  })

  it.each([true, false])('retries a failed immediate=%s write with fresh runtime and profile, without another five seconds', immediate => {
    const h = fixture(), reason = { immediate, periodic: !immediate }
    h.checkpoint.advance(5)
    h.setStage(1)
    h.setSaving(false)
    const before = cloneCareerProfile(h.profile)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(false)
    expect(h.profile).toEqual(before)
    h.setStage(2)
    h.setProfile({ ...h.profile, ownedWeapons: ['gladius_rusty'] })
    h.setSaving(true)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(true)
    expect(h.profile).toMatchObject({ ownedWeapons: ['gladius_rusty'], activeMission: { routeStage: 2 } })
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, periodic: true })).toBe(false)
  })

  it('isolates profile mutations and preserves unrelated Career state across a snapshot commit', () => {
    const h = fixture()
    h.setProfile({ ...h.profile, totalMerit: 25, availableMerit: 25, claimedBattleIds: ['battle'],
      ownedWeapons: ['gladius_rusty'], activeMission: { ...h.profile.activeMission!,
        mountState: { activeMountId: 'horse', hp: { horse: 43 }, unavailable: ['corgi'] },
      } })
    const before = h.profile
    h.setStage(3)
    h.checkpoint.persist(h.snapshot, { immediate: true })
    expect(h.profile).toEqual({ ...before, activeMission: { ...before.activeMission!, routeStage: 3 } })
    expect(h.profile).not.toBe(before)
    h.profile.ownedWeapons.push('longsword')
    h.profile.claimedBattleIds.push('another-battle')
    expect(before.ownedWeapons).toEqual(['gladius_rusty'])
    expect(before.claimedBattleIds).toEqual(['battle'])
    expect(before.activeMission!.routeStage).toBeUndefined()
  })

  it('resets elapsed time for a new mission and does not advance it for negative dt', () => {
    const h = fixture(), reason = { immediate: false, periodic: true }
    h.checkpoint.advance(4)
    h.checkpoint.reset()
    h.checkpoint.advance(-10)
    h.checkpoint.advance(1)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(false)
    h.checkpoint.advance(4)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(true)
  })

  it('retries an actual storage exception through the existing boolean commit contract and save format', () => {
    const h = fixture()
    let profile = h.profile
    const data = new Map<string, string>()
    let fail = true
    const store = new CareerProfileStore({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { if (fail) throw new Error('quota'); data.set(key, value) },
    } as Storage)
    const checkpoint = new CareerMissionCheckpoint(() => profile, next => {
      if (!store.save(next)) return false
      profile = next
      return true
    })
    checkpoint.advance(5)
    let damage = 100
    const snapshot = () => ({ ...profile.activeMission!, playerStats: {
      damageDealt: damage, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0,
    } })
    expect(checkpoint.persist(snapshot, { immediate: false, periodic: true })).toBe(false)
    expect(profile.activeMission!.playerStats).toBeUndefined()
    expect(data.size).toBe(0)
    damage = 120
    fail = false
    expect(checkpoint.persist(snapshot, { immediate: false, periodic: true })).toBe(true)
    expect([...data.keys()]).toEqual([CAREER_STORAGE_KEY])
    expect(JSON.parse(data.get(CAREER_STORAGE_KEY)!)).toMatchObject({ version: 1, activeMission: { id: 'checkpoint', playerStats: { damageDealt: 120 } } })
    expect(store.loadChecked().profile!.activeMission!.playerStats!.damageDealt).toBe(120)
  })
})
