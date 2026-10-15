import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { CareerReliefMarchController, createCareerReliefSpawnPlan } from '../../src/career/CareerOutpostRelief'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { NPC } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

describe('shared relief march checkpoint', () => {
  const faction = 'roman'
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
})
