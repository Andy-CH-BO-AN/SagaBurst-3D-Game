import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { FORMATION_ALL_MAX_COLUMNS } from '../../src/battle/FormationMath'
import { FormationController, type FormationRegion } from '../../src/battle/FormationController'
import { createTerrain, getTerrainHeight, TERRAIN_TREE_POSITIONS } from '../../src/world/Terrain'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'

import { createFormationPlacementHarness, placementParticipant } from '../helpers/formationPlacement'
function placementHarness(...args: Parameters<typeof createFormationPlacementHarness>) {
  const fixture = createFormationPlacementHarness(...args)
  onTestFinished(() => fixture.formation.cancelPlacement())
  return fixture
}

function romanRegion(): FormationRegion {
  const placement = getCampaignOutpostPlacement('roman')
  return {
    minX: placement.centerX - placement.halfWidth,
    maxX: placement.centerX + placement.halfWidth,
    minZ: Math.min(placement.frontZ, placement.backZ),
    maxZ: Math.max(placement.frontZ, placement.backZ),
  }
}

describe('Campaign formation placement wiring', () => {
  it('routes just the center slot around a real terrain pine tree', () => {
    const [treeX, treeZ] = TERRAIN_TREE_POSITIONS[0]
    const { obstacles } = createTerrain(new THREE.Scene())
    const participants = Array.from({ length: 5 }, (_, index) => placementParticipant(`p-${index}`, index - 2))
    const { formation, solve } = placementHarness(obstacles, participants)
    const center = new THREE.Vector3(treeX, getTerrainHeight(treeX, treeZ), treeZ)
    const ideal = (formation as any).makeFormation(center, new THREE.Vector3(0, 0, 1), 5, 10).slots as THREE.Vector3[]
    const placement = solve(center)

    expect(placement?.center).toEqual(center)
    expect(placement?.slots.filter((slot, index) => !slot.equals(ideal[index]))).toHaveLength(1)
    expect(placement?.slots[2].equals(ideal[2])).toBe(false)
    expect(placement?.slots.every(slot => !(formation as any).isSlotBlocked(slot, false))).toBe(true)
  })

  it.each(['tent', 'campfire', 'palisade', 'gate'] as const)(
    'keeps formation slots clear of a real campaign %s', kind => {
      const scene = new THREE.Scene()
      const terrain = createTerrain(scene)
      const outpost = createCampaignOutpost(scene, 'roman', terrain)
      const navigation = new NavigationWorld()
      navigation.sync(outpost.obstacles)
      const piece = outpost.damageableObstacles.find(obstacle => obstacle.kind === kind)!
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === piece)!
      const center = obstacle.box.getCenter(new THREE.Vector3())
      center.y = getTerrainHeight(center.x, center.z)
      const participants = Array.from({ length: 5 }, (_, index) => {
        const npc = placementParticipant(`p-${index}`, index - 2)
        npc.combatPosition.z = -140
        return npc
      })
      const { formation, solve } = placementHarness(outpost.obstacles, participants, navigation, romanRegion())
      const placement = solve(center)

      expect(placement, kind).not.toBeNull()
      expect(placement?.slots.every(slot => !(formation as any).isSlotBlocked(slot, false))).toBe(true)
      expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
    },
  )

  it('keeps all slots on the Roman defenders side of the outpost wall', () => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, -30 + index)
      npc.combatPosition.z = -140
      return npc
    })
    const { solve } = placementHarness(outpost.obstacles, participants, navigation, romanRegion())
    const center = new THREE.Vector3(-44, getTerrainHeight(-44, -140), -140)
    const placement = solve(center, 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
  })

  it.each([
    ['inside', -140],
    ['outside', -80],
  ] as const)('keeps a group entirely %s the closed gate', (_side, originZ) => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`p-${index}`, index - 2)
      npc.combatPosition.z = originZ
      return npc
    })
    const { solve } = placementHarness(outpost.obstacles, participants, navigation, romanRegion())
    const placement = solve(new THREE.Vector3(0, getTerrainHeight(0, -108), -108), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
  })

  it('rechecks the gate side if the gate closes between preview and confirmation', () => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    const navigation = new NavigationWorld()
    outpost.gateController.open()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`p-${index}`, index - 2)
      npc.combatPosition.z = -140
      return npc
    })
    const formation = new FormationController(scene, new THREE.PerspectiveCamera(), participants as any,
      terrain.terrainMesh, outpost.obstacles, navigation, romanRegion())
    onTestFinished(() => formation.cancelPlacement())
    const center = new THREE.Vector3(0, getTerrainHeight(0, -104), -104)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])
    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(false)

    outpost.gateController.close()
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(false)
    expect(participants.every(npc => npc.assignFormationTarget.mock.calls.length === 0)).toBe(true)
  })

  it.each([
    ['inside', -16, -156, true],
    ['outside', 0, -104, false],
  ] as const)('keeps every slot %s the outpost when the gate is open', (_side, x, z, inside) => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    outpost.gateController.open()
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    const { solve } = placementHarness(outpost.obstacles, participants, navigation, romanRegion())
    const placement = solve(new THREE.Vector3(x, getTerrainHeight(x, z), z), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => (
      slot.x > -44 && slot.x < 44 && slot.z > -180 && slot.z < -108
    ) === inside)).toBe(true)
  })

  it.each([
    ['campfire', -16, -156],
    ['side wall', -44, -140],
  ] as const)('keeps all 50 Roman defenders together near the %s', (_name, x, z) => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    const { formation, solve } = placementHarness(outpost.obstacles, participants, navigation, romanRegion())
    const placement = solve(new THREE.Vector3(x, getTerrainHeight(x, z), z), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots).toHaveLength(50)
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
    expect(placement?.slots.every(slot => !(formation as any).isSlotBlocked(slot, false))).toBe(true)
  })

  it('confirms the same narrowed formation shown to all 50 defenders near a campfire', () => {
    const scene = new THREE.Scene()
    const terrain = createTerrain(scene)
    const outpost = createCampaignOutpost(scene, 'roman', terrain)
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    const formation = new FormationController(scene, new THREE.PerspectiveCamera(), participants as any,
      terrain.terrainMesh, outpost.obstacles, navigation, romanRegion())
    onTestFinished(() => formation.cancelPlacement())
    const center = new THREE.Vector3(-16, getTerrainHeight(-16, -156), -156)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('all')
    const shown = preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]
    expect((formation as any).previewColumns).toBeLessThan(FORMATION_ALL_MAX_COLUMNS)
    expect(formation.confirmPlacement().accepted).toBe(true)
    const assigned = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
    expect(assigned.map(slot => `${slot.x},${slot.z}`).sort())
      .toEqual(shown.map(slot => `${slot.x},${slot.z}`).sort())
  })
})
