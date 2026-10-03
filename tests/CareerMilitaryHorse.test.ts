import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  CAREER_RANK_THRESHOLDS,
  createCareerProfile,
  type CareerProfile,
  type CareerRank,
} from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { createActiveCareerMission } from '../src/career/CareerMissionState'
import {
  canUseCareerMount,
  CareerMountController,
  careerMountTier,
  ownedCareerMountIds,
} from '../src/career/CareerMountController'
import { productStatus, purchaseTownHorse, sellTownProduct, TOWN_PRODUCTS } from '../src/town/TownRules'
import type { Player } from '../src/player/Player'

function profileFor(rank: CareerRank = 'recruit'): CareerProfile {
  return {
    ...createCareerProfile('roman'),
    rank,
    totalMerit: CAREER_RANK_THRESHOLDS[rank] + 1000,
    availableMerit: 1000,
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

function mountController(profile: CareerProfile) {
  const commit = vi.fn(() => true)
  const player = { currentMount: null, isMounted: false } as unknown as Player
  const controller = new CareerMountController(
    new THREE.Scene(), () => player, () => profile, commit, () => [], () => [],
  )
  return { controller, commit }
}

const ranks = [
  ['recruit', 1], ['soldier', 2], ['veteran', 3], ['captain', 4], ['commander', 4],
] as const

describe('Single military warhorse purchase', () => {
  it('removes a sold active horse and its outing state without another save', () => {
    const profile = purchaseTownHorse(profileFor(), 'horse')!
    profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 0, 0, 'sale-mission')
    profile.activeMission.mountState = { activeMountId: 'horse', hp: { horse: 20 }, unavailable: ['horse'] }
    const { controller, commit } = mountController(profile)
    const mount = { currentHp: 20, dispose: vi.fn() }
    const player = { currentMount: mount, dismountFromMount: vi.fn() }
    Object.assign(controller, { active: { id: 'horse', mount }, player: () => player })
    Object.assign(profile, sellTownProduct(profile, 'horse').profile)
    controller.syncOwnership()
    expect(player.dismountFromMount).toHaveBeenCalledOnce()
    expect(mount.dispose).toHaveBeenCalledOnce()
    expect(controller.activeMount).toBeNull()
    expect(profile.activeMission?.mountState).toEqual({ hp: {}, unavailable: [] })
    expect(commit).not.toHaveBeenCalled()
    expect(purchaseTownHorse(profile, 'horse')).not.toBeNull()
  })
  it('offers one military warhorse without retired tier products', () => {
    const horses = TOWN_PRODUCTS.filter(item => item.category === 'mount' && item.id !== 'black-cat' && item.id !== 'corgi')
    expect(horses).toEqual([{ id: 'horse', category: 'mount', name: '軍用戰馬', tier: 1, price: 200 }])
  })

  it.each(ranks)('buys once at %s and uses the rank-appropriate T%i horse', (rank, tier) => {
    const profile = profileFor(rank)
    const original = JSON.stringify(profile)
    const purchased = purchaseTownHorse(profile, 'horse')!
    expect(purchased).not.toBeNull()
    expect(purchased.availableMerit).toBe(800)
    expect(purchased.totalMerit).toBe(profile.totalMerit)
    expect(purchased.rank).toBe(rank)
    expect(purchased.ownedMounts).toEqual(['horse'])
    expect(purchased.selectedMountId).toBe('horse')
    expect(ownedCareerMountIds(purchased)).toEqual(['horse'])
    expect(careerMountTier('horse', purchased)).toBe(tier)
    expect(canUseCareerMount(purchased, 'horse')).toBe(true)
    expect(JSON.stringify(profile)).toBe(original)
    expect(purchaseTownHorse(purchased, 'horse')).toBeNull()
  })

  it('requires sufficient funds and rejects retired or unrelated purchase IDs', () => {
    const profile = profileFor('captain')
    profile.availableMerit = 199
    const original = JSON.stringify(profile)
    expect(purchaseTownHorse(profile, 'horse')).toBeNull()
    for (const id of ['horse-t1', 'horse-t2', 'horse-t3', 'horse-t4', 'black-cat', 'corgi', '', 'missing']) {
      expect(purchaseTownHorse({ ...profile, availableMerit: 1000 }, id)).toBeNull()
    }
    expect(JSON.stringify(profile)).toBe(original)
  })

  it('unlocks T4 after promotion and returns to the enlistment tier after demotion without another purchase', () => {
    const profile = purchaseTownHorse(profileFor(), 'horse')!
    const { controller } = mountController(profile)
    expect(controller.list()).toEqual([{ id: 'horse', name: '軍用戰馬', tier: 1, active: false, available: true }])
    const afterPurchase = profile.availableMerit
    profile.rank = 'captain'
    expect(controller.list()[0]).toMatchObject({ id: 'horse', tier: 4, available: true })
    expect(careerMountTier('horse', profile)).toBe(4)
    expect(canUseCareerMount(profile, 'horse')).toBe(true)
    profile.rank = 'recruit'
    expect(controller.list()[0]).toMatchObject({ id: 'horse', tier: 1, available: true })
    expect(ownedCareerMountIds(profile)).toEqual(['horse'])
    expect(profile.availableMerit).toBe(afterPurchase)
    expect(purchaseTownHorse(profile, 'horse')).toBeNull()
  })

  it('preserves captain T4 ownership and selection through a saved profile', () => {
    const store = new CareerProfileStore(memoryStorage())
    const purchased = purchaseTownHorse(profileFor('captain'), 'horse')!
    expect(store.save(purchased)).toBe(true)
    const loaded = store.load()!
    expect(loaded.rank).toBe('captain')
    expect(loaded.availableMerit).toBe(800)
    expect(loaded.selectedMountId).toBe('horse')
    expect(ownedCareerMountIds(loaded)).toEqual(['horse'])
    expect(careerMountTier('horse', loaded)).toBe(4)
    expect(purchaseTownHorse(loaded, 'horse')).toBeNull()
  })
})

describe('Legacy warhorse ownership and outing migration', () => {
  it.each([
    { ownedMounts: ['horse'], ownedHorseTiers: undefined },
    { ownedMounts: ['horse'], ownedHorseTiers: [] },
    { ownedMounts: [], ownedHorseTiers: [1] },
    { ownedMounts: [], ownedHorseTiers: [2] },
    { ownedMounts: [], ownedHorseTiers: [3] },
    { ownedMounts: ['horse'], ownedHorseTiers: [1, 2, 3] },
  ] as Pick<CareerProfile, 'ownedMounts' | 'ownedHorseTiers'>[])('retains any prior horse purchase as one owned mount: %j', legacy => {
    const profile = { ...profileFor('captain'), ...legacy }
    const horse = TOWN_PRODUCTS.find(item => item.id === 'horse')!
    expect(ownedCareerMountIds(profile)).toEqual(['horse'])
    expect(productStatus(profile, horse)).toBe('已擁有')
    expect(purchaseTownHorse(profile, 'horse')).toBeNull()
    for (const id of ['horse', 'horse-t1', 'horse-t2', 'horse-t3'] as const) {
      expect(canUseCareerMount(profile, id)).toBe(true)
      expect(careerMountTier(id, profile)).toBe(4)
    }
    const loaded = parseCareerProfile(profile)!
    expect(ownedCareerMountIds(loaded)).toEqual(['horse'])
  })

  it('does not infer ownership from a stale selected mount or grant a T4 pet to a recruit', () => {
    const profile = profileFor()
    profile.selectedMountId = 'horse-t3'
    expect(ownedCareerMountIds(profile)).toEqual([])
    expect(canUseCareerMount(profile, 'horse-t3')).toBe(false)
    profile.ownedMounts = ['horse', 'black-cat', 'corgi']
    profile.ownedHorseTiers = [1, 2, 3]
    expect(ownedCareerMountIds(profile)).toEqual(['horse', 'black-cat', 'corgi'])
    expect(canUseCareerMount(profile, 'horse')).toBe(true)
    expect(canUseCareerMount(profile, 'black-cat')).toBe(false)
    expect(canUseCareerMount(profile, 'corgi')).toBe(false)
  })

  it('canonicalizes selected and active legacy horses while preserving the lowest saved HP', () => {
    const profile = profileFor('captain')
    profile.ownedHorseTiers = [1, 2, 3]
    profile.selectedMountId = 'horse-t3'
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'horse-migration')
    profile.activeMission.mountState = {
      activeMountId: 'horse-t2',
      hp: { horse: 80, 'horse-t1': 43, 'horse-t2': 27, 'horse-t3': 60, corgi: 77 },
      unavailable: [],
    }
    const loaded = parseCareerProfile(profile)!
    expect(loaded.selectedMountId).toBe('horse')
    expect(loaded.activeMission!.mountState).toEqual({
      activeMountId: 'horse', hp: { horse: 27, corgi: 77 }, unavailable: [],
    })
    expect(parseCareerProfile(loaded)).toEqual(loaded)
    expect(profile.activeMission.mountState.hp['horse-t2']).toBe(27)
  })

  it('keeps a defeated legacy horse unavailable after reload and captain promotion', () => {
    const profile = profileFor('soldier')
    profile.ownedMounts = ['horse']
    profile.ownedHorseTiers = [1, 2, 3]
    profile.selectedMountId = 'horse-t2'
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'horse-death')
    profile.activeMission.mountState = {
      activeMountId: 'horse-t2',
      hp: { 'horse-t1': 100, 'horse-t2': 0, 'horse-t3': 100 },
      unavailable: ['horse-t2'],
    }
    const store = new CareerProfileStore(memoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    loaded.rank = 'captain'
    expect(loaded.activeMission!.mountState).toEqual({ activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] })
    const { controller, commit } = mountController(loaded)
    expect(controller.list()).toEqual([{ id: 'horse', name: '軍用戰馬', tier: 4, active: false, available: false }])
    expect(controller.restoreActiveMount()).toBe(false)
    expect(controller.activate('horse')).toBe(false)
    expect(controller.activate('horse-t3')).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(controller.activeMount).toBeNull()
  })
})
