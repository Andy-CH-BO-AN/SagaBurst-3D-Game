import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { createCareerReliefSpawnPlan, initializeCareerReliefBattlefield } from '../../src/career/CareerOutpostRelief'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { CampaignGateController } from '../../src/campaign/CampaignGate'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { AIType, NPC } from '../../src/world/NPC'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}

function launch(faction: 'roman' | 'viking' = 'roman') { return createCareerOutpostLaunch(acceptCareerOutpostRelief(ready(faction), 'relief')!) }

describe('shared relief gate breach', () => {
  const faction = 'roman'
  it('destroys real gate geometry and collision, opens navigation and starts breach combat', () => {
    const scene = new THREE.Scene(), obstacles: NonNullable<Parameters<typeof createCampaignOutpost>[2]>['obstacles'] = []
    const outpost = createCampaignOutpost(scene, faction, { obstacles, obstacleMeshes: [] })
    const navigation = new NavigationWorld(); navigation.sync(obstacles)
    const revision = navigation.revision
    const plan = createCareerReliefSpawnPlan(launch(faction))
    const npcs = plan.npcSpecs.map(spec => ({ ...spec, dead: false, setTacticalOrder: vi.fn() }))
    initializeCareerReliefBattlefield(outpost.gateController, npcs as unknown as NPC[])
    expect(outpost.gateController.state).toBe('destroyed'); expect(outpost.breachController.breached).toBe(true)
    expect(outpost.gate.root.visible).toBe(false); expect(outpost.gate.root.parent).toBeNull()
    expect(obstacles.some(obstacle => obstacle.damageable === outpost.gate)).toBe(false)
    expect(navigation.sync(obstacles)).toBe(true); expect(navigation.revision).toBeGreaterThan(revision)
    const front = getCampaignOutpostPlacement(faction).frontZ
    expect(navigation.queryPath({ x: 0, z: front - 12 }, { x: 0, z: front + 12 }).status).toBe('path')
    for (const npc of npcs) expect(npc.setTacticalOrder).toHaveBeenCalledWith(npc.characterFaction === faction || npc.aiType === AIType.RANGED ? 'attack' : 'charge')
  })
})

describe('Relief breach faction wiring', () => {
  it.each([
    { defender: 'roman', attacker: 'viking' },
    { defender: 'viking', attacker: 'roman' },
  ] as const)('maps $defender defenders and $attacker attackers to their breach orders without a battlefield', ({ defender, attacker }) => {
    // A minimal real gate and three command consumers preserve the caller's faction binding.
    // Full Outpost geometry, collision/navigation and breach lifecycle remain in the shared case above.
    const damageable = new DamageableObstacle({ kind: 'gate', root: new THREE.Group(), maxHp: 1, ownerFaction: defender })
    const obstacle = {
      box: new THREE.Box3(new THREE.Vector3(-4, 0, -.45), new THREE.Vector3(4, 1.38, .45)),
      isBarricade: true, damageable,
    }
    const gate = new CampaignGateController({
      defenderFaction: defender, damageable, obstacle, obstacles: [obstacle],
      leftHinge: new THREE.Object3D(), rightHinge: new THREE.Object3D(), openRotationY: Math.PI / 2,
    })
    expect(gate.attackerFaction).toBe(attacker)
    const npcs = [
      { characterFaction: defender, aiType: AIType.MELEE, dead: false, setTacticalOrder: vi.fn() },
      { characterFaction: attacker, aiType: AIType.MELEE, dead: false, setTacticalOrder: vi.fn() },
      { characterFaction: attacker, aiType: AIType.RANGED, dead: false, setTacticalOrder: vi.fn() },
    ]
    initializeCareerReliefBattlefield(gate, npcs as unknown as NPC[])
    expect(npcs[0].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('attack')
    expect(npcs[1].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
    expect(npcs[2].setTacticalOrder).toHaveBeenCalledExactlyOnceWith('attack')
  })
})
