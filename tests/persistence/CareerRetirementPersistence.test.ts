import { expect, it } from 'vitest'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { parseCareerRetirementState } from '../../src/career/CareerRetirementState'
import { MemoryStorage } from '../helpers/memoryStorage'
import { withNativeRetirementCheckpoints } from '../helpers/RetirementMobilizationFixture'

function preparedRetirement(): CareerProfile {

  const ready = withNativeRetirementCheckpoints({ ...createCareerProfile('roman'),
    rank: 'commander', totalMerit: 20000, commanderMeleeGranted: true,
    careerRetirement: { version: 1, phase: 'final-stand', acceptedAt: 123, combatElapsedSeconds: 42.5,
      mobilization: { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true } },
    retirementRuntime: { player: { position: { x: 0, y: 0, z: 0, yaw: 0 },
      hp: 0, stamina: 21, arrows: 3, shieldImpact: 4, mounted: false },
      stats: {
        player: { damageDealt: 12.5, damageTaken: 9, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
        personal: { damageDealt: 17, damageTaken: 4, kills: 3, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      } },
  })
  const casualty = ready.townCommandSquad!.members!.captain
  casualty.hp = 0
  casualty.status = 'dead'
  casualty.mount!.hp = 0
  casualty.mount!.mounted = false
  return ready
}

it('round-trips a prepared final stand without healing dead player, captain or mount', () => {
  const ready = preparedRetirement()
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(ready)).toBe(true)
  const restored = store.loadChecked().profile!
  expect(restored.careerRetirement).toEqual(ready.careerRetirement)
  expect(restored.townCommandSquad!.members!.captain).toEqual(ready.townCommandSquad!.members!.captain)
  expect(restored.retirementRuntime).toEqual(ready.retirementRuntime)
  // Player death is a resumable resource checkpoint, not an automatic ending.
  expect(restored.careerRetirement?.phase).toBe('final-stand')
  expect(restored.retirementRuntime?.player.hp).toBe(0)
})

it('rejects incomplete prepared native retirement checkpoints without replacing the durable save', () => {
  const ready = preparedRetirement()
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(ready)).toBe(true)
  const saved = storage.getItem(CAREER_STORAGE_KEY)
  // Complete receipts cannot silently recover missing owners, actors, mounts or resources.
  const { [Object.keys(ready.retirementTowerGuards!)[0]]: missingGuard, ...remainingGuards } = ready.retirementTowerGuards!
  expect(missingGuard).toBeDefined()
  const { mount, ...unmountedCaptain } = ready.townCommandSquad!.members!.captain
  expect(mount).toBeDefined()
  const incomplete: CareerProfile[] = [
    { ...ready, townCommandSquad: undefined },
    { ...ready, retirementTowerGuards: remainingGuards },
    { ...ready, townCommandSquad: { ...ready.townCommandSquad!,
      members: { ...ready.townCommandSquad!.members, captain: unmountedCaptain } } },
    { ...ready, retirementRuntime: undefined },
    { ...ready, retirementRuntime: { ...ready.retirementRuntime!, stats: { ...ready.retirementRuntime!.stats!,
      personal: { ...ready.retirementRuntime!.stats!.personal, kills: -1 } } } },
  ]
  for (const corrupt of incomplete) {
    expect(store.save(corrupt)).toBe(false)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  }
})

it('accepts legacy prepared retirement resources without inventing missing combat counters', () => {
  const ready = preparedRetirement()
  const store = new CareerProfileStore(new MemoryStorage())
  const legacy = { ...ready, retirementRuntime: { ...ready.retirementRuntime!, stats: undefined } }
  expect(store.save(legacy)).toBe(true)
  expect(store.load()?.retirementRuntime?.stats).toBeUndefined()
})

it('round-trips minimal retirement progress and resource snapshots without sharing mutable state', () => {
  const profile = retirementProfile()
  profile.retirementRuntime = {
    player: { position: { x: 1, y: 2, z: -318, yaw: 0.4 }, hp: 17, stamina: 21,
      arrows: 3, shieldImpact: 4, shieldDurability: { shield_t1: 0 }, mounted: true },
    mountState: { activeMountId: 'horse', hp: { horse: 9 }, unavailable: ['corgi'] },
    mount: { position: { x: 1, y: 2, z: -318, yaw: 0.4 }, hp: 9 },
  }
  const original = structuredClone(profile)
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const loaded = store.loadChecked().profile!
  expect(loaded).toEqual(original)
  expect(profile).toEqual(original)
  const copy = cloneCareerProfile(loaded)
  copy.careerRetirement!.combatElapsedSeconds = 99
  copy.retirementRuntime!.player.hp = 90
  copy.retirementRuntime!.player.shieldDurability!.shield_t1 = 90
  copy.retirementRuntime!.mountState!.hp.horse = 90
  copy.retirementRuntime!.mount!.position.x = 90
  expect(loaded).toEqual(original)
})

it('rejects corrupted retirement saves without overwriting persisted bytes', () => {
  const profile = retirementProfile()
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const saved = storage.getItem(CAREER_STORAGE_KEY)
  // Rank normalization must not admit a retirement checkpoint below Commander.
  expect(store.save({ ...profile, totalMerit: 5200 })).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  const invalidRuntime = { ...profile, retirementRuntime: { player: {
    position: { x: 0, y: 0, z: 0, yaw: 0 }, hp: Number.NaN, stamina: 0,
    arrows: 0, shieldImpact: 0, mounted: false,
  } } }
  expect(store.save(invalidRuntime)).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  delete profile.careerRetirement!.outcome
  expect(store.save(profile)).toBe(false)
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  const corrupted = JSON.stringify(profile)
  storage.setItem(CAREER_STORAGE_KEY, corrupted)
  const rejected = store.loadChecked()
  expect(rejected.profile).toBeNull()
  expect(rejected.error).toBeTruthy()
  expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(corrupted)
})

it('round-trips a prepared retirement receipt and rejects incomplete or misplaced receipts', () => {
  const receipt = { version: 1 as const, commandRevoked: true as const,
    refillCompleted: true as const, formationPrepared: true as const }
  const progress = { version: 1 as const, phase: 'mobilizing' as const,
    acceptedAt: 123, combatElapsedSeconds: 0, mobilization: receipt }
  const parsed = parseCareerRetirementState(JSON.parse(JSON.stringify(progress)))!
  expect(parsed).toEqual(progress)
  expect(parsed.mobilization).not.toBe(receipt)
  for (const invalid of [null, {}, { ...receipt, version: 2 }, { ...receipt, commandRevoked: false },
    { ...receipt, refillCompleted: false }, { ...receipt, formationPrepared: false }]) {
    expect(parseCareerRetirementState({ ...progress, mobilization: invalid })).toBeNull()
  }
  expect(parseCareerRetirementState({ ...progress, phase: 'departing' })).toBeNull()
})

function retirementProfile(): CareerProfile {
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'
  profile.totalMerit = 20000
  profile.commanderMeleeGranted = true
  profile.inventory = { version: 1, quantities: {} }
  profile.equipment = {}
  profile.careerRetirement = { version: 1, phase: 'completed', acceptedAt: 123,
    combatElapsedSeconds: 42.5, outcome: 'fallen' }
  return profile
}
