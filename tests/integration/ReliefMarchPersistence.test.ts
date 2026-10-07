import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { CareerReliefMarchController, createCareerReliefSpawnPlan } from '../../src/career/CareerOutpostRelief'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { NPC } from '../../src/world/NPC'
import { Game } from '../../src/Game'
import { MemoryStorage } from '../helpers/memoryStorage'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

describe.each(['roman', 'viking'] as const)('%s relief march checkpoint', faction => {
  it('persists the charge checkpoint and resumes both squads without repeating voice or march', () => {
    const profile = acceptCareerOutpostRelief(ready(faction), 'reload')!
    profile.activeOutpostMission!.reliefPhase = 'charge'
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
    const config = createCareerOutpostLaunch(store.load()!)
    const plan = createCareerReliefSpawnPlan(config)
    const rescue = plan.npcSpecs.filter(spec => spec.squadId).map(spec => ({ ...spec, dead: false,
      combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn() }))
    const breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const captain = rescue.find(npc => npc.name === 'Captain')!
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(300)
    const follow = vi.fn(), charge = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, vi.fn(), charge, config.careerReliefPhase === 'charge', { chargeAfterFollow: true })
    controller.start(); controller.start(); controller.update(); controller.update()
    expect(controller.hasCharged).toBe(true)
    expect(follow).not.toHaveBeenCalled(); expect(charge).not.toHaveBeenCalled()
    for (const rider of rescue) {
      expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
      expect(rider.assignFollowTarget).not.toHaveBeenCalled()
      expect(rider.assignFormationTarget).not.toHaveBeenCalled()
    }
  })

  it.each(['Captain', 'Maki'])('saves Charge when %s dies beyond 50m and reloads without replaying march or voice', leader => {
    const profile = acceptCareerOutpostRelief(ready(faction), 'leader-death')!
    const store = new CareerProfileStore(new MemoryStorage()); expect(store.save(profile)).toBe(true)
    const config = createCareerOutpostLaunch(profile)
    const makeRescue = (currentConfig: typeof config) => createCareerReliefSpawnPlan(currentConfig).npcSpecs.filter(spec => spec.squadId).map(spec => ({
      ...spec, dead: false, combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn(),
    }))
    const rescue = makeRescue(config)
    const breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const captain = rescue.find(npc => npc.name === 'Captain')!
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(50)
    const game = Object.assign(Object.create(Game.prototype), {
    spawnBatches: [], initializing: false, spawningStopped: false,
      careerStore: store, careerProfile: profile, defenseCampaignConfig: config, _showNotify: vi.fn(),
      careerVeteranActorMounts: new Map(),
    }) as { _persistCareerReliefCharge: () => void; careerProfile: CareerProfile }
    const persist = vi.fn(() => game._persistCareerReliefCharge()), follow = vi.fn(), charge = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, persist, charge, false, { chargeAfterFollow: true })
    controller.start()
    rescue.find(npc => npc.name === leader)!.dead = true
    controller.update(); controller.update()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(charge).toHaveBeenCalledTimes(leader === 'Captain' ? 0 : 1)
    expect(store.load()!.activeOutpostMission!.reliefPhase).toBe('charge')
    expect(game.careerProfile.activeOutpostMission!.reliefPhase).toBe('charge')
    for (const rider of rescue.filter(npc => !npc.dead)) expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')

    const reloadedConfig = createCareerOutpostLaunch(store.load()!), reloadedRescue = makeRescue(reloadedConfig)
    const reloadFollow = vi.fn(), reloadPersist = vi.fn(), reloadCharge = vi.fn()
    const reloaded = new CareerReliefMarchController(reloadedRescue as unknown as NPC[], breach, reloadFollow, reloadPersist, reloadCharge, reloadedConfig.careerReliefPhase === 'charge', { chargeAfterFollow: true })
    reloaded.start(); reloaded.update()
    expect(reloadFollow).not.toHaveBeenCalled(); expect(reloadPersist).not.toHaveBeenCalled(); expect(reloadCharge).not.toHaveBeenCalled()
    for (const rider of reloadedRescue) {
      expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
      expect(rider.assignFormationTarget).not.toHaveBeenCalled(); expect(rider.assignFollowTarget).not.toHaveBeenCalled()
    }
  })
})
