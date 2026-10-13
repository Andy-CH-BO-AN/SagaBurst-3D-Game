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

/** 0 real NPC/Mount, 0 GLB/TownWorld/full terrain; one real Outpost and NavigationWorld.
 * Participants are placement records. Existing terrain-hit spies supply the external pointer input.
 */
function campaignPlacementFixture({ walkways = false, openGate = false } = {}) {
  const scene = new THREE.Scene()
  const terrainMaterial = new THREE.MeshBasicMaterial()
  const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(), terrainMaterial)
  const ownedGeometries = new Set<THREE.BufferGeometry>([terrainMesh.geometry])
  onTestFinished(() => {
    // FormationPreview owns its line geometry; its marker/center geometries stay shared.
    scene.traverse(object => {
      if (object instanceof THREE.Line) ownedGeometries.add(object.geometry)
    })
    for (const geometry of ownedGeometries) geometry.dispose()
    terrainMaterial.dispose()
    // Outpost materials and the FormationPreview's marker geometries are shared caches.
    scene.clear()
  })

  try {
    const outpost = createCampaignOutpost(scene, 'roman', undefined, { walkways })
    if (openGate) outpost.gateController.open()
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    if (outpost.walkways) navigation.setOutpostWalkways(outpost.walkways.layout)
    return { scene, terrainMesh, outpost, navigation }
  } finally {
    // Capture only scenery built here, before FormationController adds shared preview resources.
    // This also owns partial scenery if setup throws.
    scene.traverse(object => {
      if (object instanceof THREE.Mesh) ownedGeometries.add(object.geometry)
    })
  }
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

  it('keeps formation slots clear of a real campaign tent', () => {
    const { outpost, navigation } = campaignPlacementFixture()
    const kind = 'tent'
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
  })

  it.each([
    ['inside', -140],
    ['outside', -80],
  ] as const)('keeps a group entirely %s the closed gate', (_side, originZ) => {
    const { outpost, navigation } = campaignPlacementFixture()
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
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ openGate: true })
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`p-${index}`, index - 2)
      npc.combatPosition.z = -140
      return npc
    })
    const formation = new FormationController(scene, new THREE.PerspectiveCamera(), participants as any,
      terrainMesh, outpost.obstacles, navigation, romanRegion())
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
    const { outpost, navigation } = campaignPlacementFixture({ openGate: true })
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

  it('keeps all 50 Roman defenders together near the side wall', () => {
    // Fifty placement records exercise the whole-formation width fallback beside the wall.
    const x = -44, z = -140
    const { outpost, navigation } = campaignPlacementFixture()
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
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture()
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    // Match the representative solver's +Z input while exercising the real preview caller.
    const camera = new THREE.PerspectiveCamera()
    camera.lookAt(0, 0, 1)
    camera.updateMatrixWorld()
    const formation = new FormationController(scene, camera, participants as any,
      terrainMesh, outpost.obstacles, navigation, romanRegion())
    onTestFinished(() => formation.cancelPlacement())
    const center = new THREE.Vector3(-16, getTerrainHeight(-16, -156), -156)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('all')
    const shown = preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]
    // This owns both campfire clearance/capacity and the preview-to-confirmation handoff.
    expect(shown).toHaveLength(50)
    expect(shown.every(slot => !(formation as any).isSlotBlocked(slot, false))).toBe(true)
    expect(shown.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
    expect((formation as any).previewColumns).toBeLessThan(FORMATION_ALL_MAX_COLUMNS)
    expect(formation.confirmPlacement()).toMatchObject({ accepted: true, count: 50 })
    const assigned = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
    expect(assigned.map(slot => `${slot.x},${slot.z}`).sort())
      .toEqual(shown.map(slot => `${slot.x},${slot.z}`).sort())
  })

  it('places foot soldiers in a 1D corridor on the elevated rampart deck', () => {
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ walkways: true })
    const deck = outpost.walkways!.layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 6 }, (_, index) => {
      const npc = placementParticipant(`roman-foot-${index}`, index - 3)
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = new FormationController(
      scene,
      new THREE.PerspectiveCamera(),
      participants as any,
      terrainMesh,
      outpost.obstacles,
      navigation,
      romanRegion(),
    )
    onTestFinished(() => formation.cancelPlacement())

    const center = new THREE.Vector3(deck.slab.getCenter(new THREE.Vector3()).x, deck.topY, deck.slab.getCenter(new THREE.Vector3()).z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(false)
    const shown = preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]
    expect(shown).toHaveLength(6)
    expect(shown.every(slot => Math.abs(slot.y - deck.topY) < 0.001)).toBe(true)
    expect(shown.every(slot => slot.x >= deck.slab.min.x + 0.6 && slot.x <= deck.slab.max.x - 0.6)).toBe(true)

    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    expect(result.count).toBe(6)
    expect(participants.every(npc => npc.assignFormationTarget.mock.calls.length === 1)).toBe(true)
    const assignedSlots = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
    expect(assignedSlots.every(slot => Math.abs(slot.y - deck.topY) < 0.001)).toBe(true)
  })

  it('rejects rampart deck placement when participants include mounted units', () => {
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ walkways: true })
    const deck = outpost.walkways!.layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 3 }, (_, index) => {
      const npc = placementParticipant(`cavalry-${index}`, index)
      npc.isMounted = true
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = new FormationController(
      scene,
      new THREE.PerspectiveCamera(),
      participants as any,
      terrainMesh,
      outpost.obstacles,
      navigation,
      romanRegion(),
    )
    onTestFinished(() => formation.cancelPlacement())

    const center = new THREE.Vector3(deck.slab.getCenter(new THREE.Vector3()).x, deck.topY, deck.slab.getCenter(new THREE.Vector3()).z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(true)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(false)
    expect(participants.every(npc => npc.assignFormationTarget.mock.calls.length === 0)).toBe(true)
  })

  it('rejects rampart deck placement when participant count exceeds deck capacity', () => {
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ walkways: true })
    const deck = outpost.walkways!.layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`foot-${index}`, index)
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = new FormationController(
      scene,
      new THREE.PerspectiveCamera(),
      participants as any,
      terrainMesh,
      outpost.obstacles,
      navigation,
      romanRegion(),
    )
    onTestFinished(() => formation.cancelPlacement())

    const center = new THREE.Vector3(deck.slab.getCenter(new THREE.Vector3()).x, deck.topY, deck.slab.getCenter(new THREE.Vector3()).z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(true)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(false)
  })

  it('excludes rampart deck hit when ray is cast from underneath the platform looking up (P3 review)', () => {
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ walkways: true })
    const deck = outpost.walkways!.layout.decks.find(d => d.side === -1)!
    const deckCenter = deck.slab.getCenter(new THREE.Vector3())

    const participants = [placementParticipant('foot-1', 0)]
    const formation = new FormationController(
      scene,
      new THREE.PerspectiveCamera(),
      participants as any,
      terrainMesh,
      outpost.obstacles,
      navigation,
      romanRegion(),
    )
    onTestFinished(() => formation.cancelPlacement())

    // 1. Ray from below looking straight up at underside: must return null!
    const rayFromBelow = new THREE.Ray(
      new THREE.Vector3(deckCenter.x, 1.5, deckCenter.z), // origin below deck (topY ≈ 4.75m)
      new THREE.Vector3(0, 1, 0),                         // looking up
    )
    const hitFromBelow = formation.findRampartDeckHit(rayFromBelow)
    expect(hitFromBelow, 'Ray from below looking up must NOT hit rampart deck top surface').toBeNull()

    // 2. Ray from below looking diagonally upward towards deck slab: must return null!
    const rayDiagonalUp = new THREE.Ray(
      new THREE.Vector3(deckCenter.x, 2.0, deckCenter.z - 5),
      new THREE.Vector3(0, 0.5, 1).normalize(),
    )
    const hitDiagonalUp = formation.findRampartDeckHit(rayDiagonalUp)
    expect(hitDiagonalUp, 'Upward angled ray from below must NOT hit rampart deck').toBeNull()

    // 3. Ray from above looking down towards deck top surface: must return valid deck hit!
    const rayFromAbove = new THREE.Ray(
      new THREE.Vector3(deckCenter.x, deck.topY + 2.0, deckCenter.z),
      new THREE.Vector3(0, -1, 0),
    )
    const hitFromAbove = formation.findRampartDeckHit(rayFromAbove)
    expect(hitFromAbove, 'Ray from above looking down must hit rampart deck top surface').not.toBeNull()
    expect(hitFromAbove?.hitPoint.y).toBeCloseTo(deck.topY, 3)
    expect(hitFromAbove?.deck).toBe(deck)

    // 4. Ray from courtyard ground aiming at the visible upper rear rampart structure: must return valid deck hit (P1 requirement)!
    const rayFromCourtyardAtDeck = new THREE.Ray(
      new THREE.Vector3(deckCenter.x, 1.8, deckCenter.z - 15),
      new THREE.Vector3(0, (deck.topY + 0.5 - 1.8) / 15, 1).normalize(),
    )
    const hitFromCourtyard = formation.findRampartDeckHit(rayFromCourtyardAtDeck)
    expect(hitFromCourtyard, 'Ray from courtyard aiming at rampart must hit rampart deck').not.toBeNull()
    expect(hitFromCourtyard?.deck).toBe(deck)
    expect(hitFromCourtyard?.hitPoint.y).toBeCloseTo(deck.topY, 3)

    // 5. Ray from courtyard ground aiming at the visible gate bridge structure: must return valid bridge hit (P1 requirement)!
    const bridge = outpost.walkways!.layout.bridge
    const bridgeCenter = bridge.slab.getCenter(new THREE.Vector3())
    const rayFromCourtyardAtBridge = new THREE.Ray(
      new THREE.Vector3(0, 1.8, bridgeCenter.z - 15),
      new THREE.Vector3(0, (bridge.topY + 0.5 - 1.8) / 15, 1).normalize(),
    )
    const hitBridge = formation.findRampartDeckHit(rayFromCourtyardAtBridge)
    expect(hitBridge, 'Ray from courtyard aiming at bridge must hit bridge').not.toBeNull()
    expect(hitBridge?.deck).toBe(bridge)
  })

  it('places foot soldiers in a 1D corridor on the elevated gate bridge (rampart_gate)', () => {
    const { scene, terrainMesh, outpost, navigation } = campaignPlacementFixture({ walkways: true })
    const bridge = outpost.walkways!.layout.bridge

    const participants = [
      placementParticipant('bridge-foot-1', 0),
      placementParticipant('bridge-foot-2', 1),
      placementParticipant('bridge-foot-3', 2),
    ]
    for (const p of participants) {
      p.combatPosition.set(0, getTerrainHeight(0, -140), -140)
    }
    const formation = new FormationController(
      scene,
      new THREE.PerspectiveCamera(),
      participants as any,
      terrainMesh,
      outpost.obstacles,
      navigation,
      romanRegion(),
    )
    onTestFinished(() => formation.cancelPlacement())

    const bridgeCenter = bridge.slab.getCenter(new THREE.Vector3())
    const bridgeTarget = new THREE.Vector3(0, bridge.topY, bridgeCenter.z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: bridgeTarget }])

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(false)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    expect(result.count).toBe(3)

    expect(participants.every(npc => npc.assignFormationTarget.mock.calls.length === 1)).toBe(true)
    const assignedSlots = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
    for (const slot of assignedSlots) {
      expect(slot.x).toBeGreaterThanOrEqual(bridge.slab.min.x + 0.5)
      expect(slot.x).toBeLessThanOrEqual(bridge.slab.max.x - 0.5)
      expect(slot.z).toBeGreaterThanOrEqual(bridge.slab.min.z + 0.5)
      expect(slot.z).toBeLessThanOrEqual(bridge.slab.max.z - 0.5)
      expect(slot.y).toBeGreaterThanOrEqual(bridge.slab.min.y)
      expect(slot.y).toBeLessThanOrEqual(bridge.slab.max.y + 0.5)
    }
  })
})
