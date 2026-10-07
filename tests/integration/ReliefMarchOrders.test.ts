import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { CareerReliefMarchController, createCareerReliefSpawnPlan } from '../../src/career/CareerOutpostRelief'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { NPC } from '../../src/world/NPC'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

function launch(faction: 'roman' | 'viking' = 'roman') { return createCareerOutpostLaunch(acceptCareerOutpostRelief(ready(faction), 'relief')!) }

describe('shared relief march orders', () => {
  const faction = 'roman'
  it('marches using mount speed and charges both squads exactly once when Follow finishes, regardless of distance', () => {
    const plan = createCareerReliefSpawnPlan(launch(faction))
    const rescue = plan.npcSpecs.filter(spec => spec.squadId).map(spec => ({ ...spec, dead: false,
      combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn() }))
    const captain = rescue.find(npc => npc.name === 'Captain')!, maki = rescue.find(npc => npc.name === 'Maki')!
    const follow = vi.fn(), charge = vi.fn(), breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const triggered = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, triggered, charge, false, { chargeAfterFollow: true })
    controller.start(); controller.start()
    expect(follow).toHaveBeenCalledTimes(1)
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(300)
    expect(captain.assignFormationTarget.mock.calls[0][3]).toBe(12)
    expect(maki.assignFollowTarget.mock.calls[0][0]).toBe(captain)
    expect(maki.assignFollowTarget.mock.calls[0][2].x).toBe(28)
    for (const rider of rescue.filter(npc => npc !== captain && npc !== maki)) {
      expect(rider.assignFollowTarget.mock.calls[0][0]).toBe(rider.squadId === 1 ? captain : maki)
      expect(rider.assignFollowTarget.mock.calls[0][3]).toBe(12)
    }
    captain.combatPosition.copy(breach).add(new THREE.Vector3(0, 0, 50.1)); controller.update()
    expect(charge).not.toHaveBeenCalled()
    captain.combatPosition.copy(breach); controller.update()
    expect(charge).not.toHaveBeenCalled()
    captain.combatPosition.copy(breach).add(new THREE.Vector3(0, 0, 300))
    follow.mock.calls[0][0]!()
    controller.update(); controller.update()
    expect(triggered).toHaveBeenCalledTimes(1)
    expect(charge).toHaveBeenCalledTimes(1); expect(controller.hasCharged).toBe(true)
    for (const rider of rescue) expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
  })
})
