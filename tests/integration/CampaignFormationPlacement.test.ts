import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { FORMATION_ALL_MAX_COLUMNS } from '../../src/battle/FormationMath'
import { FormationController, type FormationRegion } from '../../src/battle/FormationController'
import { createTerrain, getTerrainHeight, TERRAIN_TREE_POSITIONS, type ObstacleData } from '../../src/world/Terrain'
import type { NPC } from '../../src/world/NPC'
import { getOutpostWalkwayLayout, type OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { getSiegeRampPlacement } from '../../src/campaign/MobileSiegeRampPolicy'
import { getOutpostRampartArcherSlots } from '../../src/campaign/OutpostRampartGarrison'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'

import { createFormationPlacementHarness, placementParticipant, blockingBox, type PlacementParticipantFixture } from '../helpers/formationPlacement'
function placementHarness(...args: Parameters<typeof createFormationPlacementHarness>) {
  const fixture = createFormationPlacementHarness(...args)
  onTestFinished(() => fixture.dispose())
  return fixture
}

/** Pure input records: no NPC/Mount, GLB, TownWorld, terrain or visual Outpost. */
function navigationFor(obstacles: ObstacleData[], layout?: OutpostWalkwayLayout) {
  const navigation = new NavigationWorld()
  navigation.sync(obstacles)
  if (layout) navigation.setOutpostWalkways(layout)
  return navigation
}

function walkwayInputs() {
  const layout = getOutpostWalkwayLayout(getCampaignOutpostPlacement('roman'))
  const obstacles: ObstacleData[] = []
  return { layout, obstacles, navigation: navigationFor(obstacles, layout) }
}

/** Real controller/preview with typed placement records and an external pointer-hit seam.
 * Cost: one preview Scene, no terrain/Outpost/NPC/Mount/GLB/TownWorld; navigation is caller-owned.
 */
function placementController(
  participants: PlacementParticipantFixture[],
  obstacles: ObstacleData[],
  navigation: NavigationWorld | null,
  camera = new THREE.PerspectiveCamera(),
) {
  const scene = new THREE.Scene()
  // The pointer boundary supplies hits below; no rendered terrain surface is necessary.
  const formation = new FormationController(scene, camera, participants as unknown as NPC[],
    new THREE.Object3D(), obstacles, navigation, romanRegion())
  onTestFinished(() => {
    formation.cancelPlacement()
    scene.traverse(object => { if (object instanceof THREE.Line) object.geometry.dispose() })
    // FormationPreview's marker/center geometries and materials are shared.
    scene.clear()
  })
  return formation
}

/** The sole visual Outpost here owns gate-controller mutation -> placement topology revalidation.
 * Cost: one real Outpost + NavigationWorld; no full terrain, NPC/Mount/GLB/TownWorld.
 * Ordinary placement rules use the explicit minimum records above.
 */
function registeredGateFixture() {
  const scene = new THREE.Scene()
  const ownedGeometries = new Set<THREE.BufferGeometry>()
  onTestFinished(() => {
    for (const geometry of ownedGeometries) geometry.dispose()
    // Procedural materials stay owned by the production cache.
    scene.clear()
  })
  try {
    const outpost = createCampaignOutpost(scene, 'roman')
    outpost.gateController.open()
    return { outpost, navigation: navigationFor(outpost.obstacles) }
  } finally {
    scene.traverse(object => { if (object instanceof THREE.Mesh) ownedGeometries.add(object.geometry) })
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
  it('requires mounted access and spreads cavalry across the entire connected wall', () => {
    const { layout, obstacles, navigation } = walkwayInputs()
    for (const stair of layout.stairs) stair.ramp.mounted = false
    const placement = getSiegeRampPlacement(layout, -1)
    const participants = [placementParticipant('mounted-a', 0, true), placementParticipant('mounted-b', 2, true)]
    const { solve } = placementHarness(obstacles, participants, navigation)
    expect(solve(placement.deckConnection)).toBeNull()
    navigation.outpostNav!.entrances.set({ id: 'siege-ramp-left', type: 'siege-ramp-left',
      position: placement.dock, approach: placement.start, exit: placement.deckConnection,
      mounted: true, walkable: true, faction: null, connectionId: 'siege-ramp-left', surface: placement.surface, side: -1 })
    const result = solve(placement.deckConnection)!
    expect(result).not.toBeNull()
    expect(result.slots[0].distanceTo(result.slots[1])).toBeCloseTo(3.2)
    expect(result.slots.every(slot => navigation.outpostNav!.getNavLayer(slot) !== 'ground')).toBe(true)
    participants.push(...Array.from({ length: 40 }, (_, i) => placementParticipant(`overflow-${i}`, i, true)))
    const expanded = solve(placement.deckConnection)!
    expect(expanded.slots).toHaveLength(42)
    expect(expanded.slots.some(slot => slot.x > 0)).toBe(true)
    for (let i = 0; i < expanded.slots.length; i++) for (let j = 0; j < i; j++) {
      expect(expanded.slots[i].distanceTo(expanded.slots[j])).toBeGreaterThanOrEqual(3.19)
    }
    navigation.outpostNav!.entrances.remove('siege-ramp-left')
    participants.splice(2)
    expect(solve(placement.deckConnection)).toBeNull()
  })

  it('routes just the center slot around a real terrain pine tree', () => {
    // This sole full terrain owner verifies builder registration -> actual formation clearance.
    const [treeX, treeZ] = TERRAIN_TREE_POSITIONS[0]
    const scene = new THREE.Scene()
    onTestFinished(() => {
      const geometries = new Set<THREE.BufferGeometry>()
      scene.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry) })
      for (const geometry of geometries) geometry.dispose()
      // Procedural materials remain owned by production's cache.
      scene.clear()
    })
    const { obstacles } = createTerrain(scene)
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

  it.each([
    ['inside', -140],
    ['outside', -80],
  ] as const)('keeps a group entirely %s the closed doorway barrier', (_side, originZ) => {
    // One closed-boundary record separates inside/outside components; no perimeter scenery.
    const obstacles = [blockingBox(-300, 300, -108.45, -107.55)]
    const navigation = navigationFor(obstacles)
    const inside = new THREE.Vector3(0, getTerrainHeight(0, -140), -140)
    const outside = new THREE.Vector3(0, getTerrainHeight(0, -80), -80)
    expect(navigation.componentAt(inside)).toBeGreaterThanOrEqual(0)
    expect(navigation.componentAt(outside)).toBeGreaterThanOrEqual(0)
    expect(navigation.componentAt(inside)).not.toBe(navigation.componentAt(outside))
    expect(navigation.areConnected(inside, outside)).toBe(false)
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`p-${index}`, index - 2)
      npc.combatPosition.z = originZ
      return npc
    })
    const { solve } = placementHarness(obstacles, participants, navigation, romanRegion())
    const placement = solve(new THREE.Vector3(0, getTerrainHeight(0, -108), -108), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
  })

  it('rechecks the gate side if the gate closes between preview and confirmation', () => {
    const { outpost, navigation } = registeredGateFixture()
    const participants = Array.from({ length: 5 }, (_, index) => {
      const npc = placementParticipant(`p-${index}`, index - 2)
      npc.combatPosition.z = -140
      return npc
    })
    const formation = placementController(participants, outpost.obstacles, navigation)
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
  ] as const)('keeps every slot %s the outpost region with an open doorway', (_side, x, z, inside) => {
    const obstacles: ObstacleData[] = []
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    const { solve } = placementHarness(obstacles, participants, null, romanRegion())
    const placement = solve(new THREE.Vector3(x, getTerrainHeight(x, z), z), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => (
      slot.x > -44 && slot.x < 44 && slot.z > -180 && slot.z < -108
    ) === inside)).toBe(true)
  })

  it('keeps all 50 Roman defenders together near the side wall', () => {
    // Fifty placement records exercise the whole-formation width fallback beside the wall.
    const x = -44, z = -140
    const obstacles = [blockingBox(-44.45, -43.55, -300, 300)]
    const navigation = navigationFor(obstacles)
    const inside = new THREE.Vector3(0, getTerrainHeight(0, -140), -140)
    const outside = new THREE.Vector3(-60, getTerrainHeight(-60, -140), -140)
    expect(navigation.componentAt(inside)).toBeGreaterThanOrEqual(0)
    expect(navigation.componentAt(outside)).toBeGreaterThanOrEqual(0)
    expect(navigation.componentAt(inside)).not.toBe(navigation.componentAt(outside))
    expect(navigation.areConnected(inside, outside)).toBe(false)
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    const { formation, solve } = placementHarness(obstacles, participants, navigation, romanRegion())
    const placement = solve(new THREE.Vector3(x, getTerrainHeight(x, z), z), 'all')

    expect(placement).not.toBeNull()
    expect(placement?.slots).toHaveLength(50)
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
    expect(placement?.slots.every(slot => !(formation as any).isSlotBlocked(slot, false))).toBe(true)
  })

  it('confirms the same narrowed formation shown to all 50 defenders near a campfire', () => {
    const groundY = getTerrainHeight(-16, -156)
    const obstacles: ObstacleData[] = [{
      box: new THREE.Box3(new THREE.Vector3(-16.9, groundY, -156.9), new THREE.Vector3(-15.1, groundY + 1, -155.1)),
      isBarricade: false,
    }]
    const navigation = navigationFor(obstacles)
    const participants = Array.from({ length: 50 }, (_, index) => {
      const npc = placementParticipant(`roman-${index}`, index - 25)
      npc.combatPosition.z = -140
      return npc
    })
    // Match the representative solver's +Z input while exercising the real preview caller.
    const camera = new THREE.PerspectiveCamera()
    camera.lookAt(0, 0, 1)
    camera.updateMatrixWorld()
    const formation = placementController(participants, obstacles, navigation, camera)
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
    const { layout, obstacles, navigation } = walkwayInputs()
    const deck = layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 6 }, (_, index) => {
      const npc = placementParticipant(`roman-foot-${index}`, index - 3)
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = placementController(participants, obstacles, navigation)

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

  it('admits mounted single-file formation through the interior ramps', () => {
    const { layout, obstacles, navigation } = walkwayInputs()
    const deck = layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 3 }, (_, index) => {
      const npc = placementParticipant(`cavalry-${index}`, index)
      npc.isMounted = true
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = placementController(participants, obstacles, navigation)

    const center = new THREE.Vector3(deck.slab.getCenter(new THREE.Vector3()).x, deck.topY, deck.slab.getCenter(new THREE.Vector3()).z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(false)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    expect(participants.every(npc => npc.assignFormationTarget.mock.calls.length === 1)).toBe(true)
  })

  it.each(['infantry', 'cavalry', 'mixed'] as const)('deploys 91 %s across the wall with safe courtyard overflow', kind => {
    const { layout, obstacles, navigation } = walkwayInputs()
    const deck = layout.decks.find(d => d.side === -1)!
    const participants = Array.from({ length: 91 }, (_, index) => {
      const npc = placementParticipant(`unit-${index}`, index, kind === 'cavalry' || (kind === 'mixed' && index % 2 === 0))
      npc.combatPosition.set(0, getTerrainHeight(0, -140), -140)
      return npc
    })
    const formation = placementController(participants, obstacles, navigation)

    const center = new THREE.Vector3(deck.slab.getCenter(new THREE.Vector3()).x, deck.topY, deck.slab.getCenter(new THREE.Vector3()).z)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: center }])

    formation.beginPlacement('all')
    expect((formation as any).previewBlocked).toBe(false)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    expect(result.count).toBe(91)
    const slots = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
    const elevated = slots.filter(slot => navigation.outpostNav!.getNavLayer(slot) !== 'ground')
    expect(elevated.length).toBeGreaterThanOrEqual(26)
    expect(elevated.some(slot => slot.x < -10)).toBe(true)
    expect(elevated.some(slot => slot.x > 10)).toBe(true)
    for (let i = 0; i < slots.length; i++) for (let j = 0; j < i; j++) {
      expect(slots[i].distanceTo(slots[j])).toBeGreaterThanOrEqual(kind === 'infantry' ? 1 : 3.19)
    }
    for (const slot of slots.filter(slot => !elevated.includes(slot))) {
      expect(slot.y).toBe(getTerrainHeight(slot.x, slot.z))
      expect(slot.z).toBeLessThan(-108)
    }
  })

  it('excludes rampart deck hit when ray is cast from underneath the platform looking up (P3 review)', () => {
    const { layout, obstacles, navigation } = walkwayInputs()
    const deck = layout.decks.find(d => d.side === -1)!
    const deckCenter = deck.slab.getCenter(new THREE.Vector3())

    const participants = [placementParticipant('foot-1', 0)]
    const formation = placementController(participants, obstacles, navigation)

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
      new THREE.Vector3(0, (deck.topY + 0.5 - 1.8) / (15 - (deck.slab.max.z - deck.slab.min.z) / 2), 1).normalize(),
    )
    const hitFromCourtyard = formation.findRampartDeckHit(rayFromCourtyardAtDeck)
    expect(hitFromCourtyard, 'Ray from courtyard aiming at rampart must hit rampart deck').not.toBeNull()
    expect(hitFromCourtyard?.deck).toBe(deck)
    expect(hitFromCourtyard?.hitPoint.y).toBeCloseTo(deck.topY, 3)

    // 5. Ray from courtyard ground aiming at the visible gate bridge structure: must return valid bridge hit (P1 requirement)!
    const bridge = layout.bridge
    const bridgeCenter = bridge.slab.getCenter(new THREE.Vector3())
    const rayFromCourtyardAtBridge = new THREE.Ray(
      new THREE.Vector3(0, 1.8, bridgeCenter.z - 15),
      new THREE.Vector3(0, (bridge.topY + 0.5 - 1.8) / (15 - (bridge.slab.max.z - bridge.slab.min.z) / 2), 1).normalize(),
    )
    const hitBridge = formation.findRampartDeckHit(rayFromCourtyardAtBridge)
    expect(hitBridge, 'Ray from courtyard aiming at bridge must hit bridge').not.toBeNull()
    expect(hitBridge?.deck).toBe(bridge)
  })

  it('places foot soldiers in a 1D corridor on the elevated gate bridge (rampart_gate)', () => {
    const { layout, obstacles, navigation } = walkwayInputs()
    const bridge = layout.bridge

    const participants = [
      placementParticipant('bridge-foot-1', 0),
      placementParticipant('bridge-foot-2', 1),
      placementParticipant('bridge-foot-3', 2),
    ]
    for (const p of participants) {
      p.combatPosition.set(0, getTerrainHeight(0, -140), -140)
    }
    const formation = placementController(participants, obstacles, navigation)

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


describe('Archer rampart command capacity', () => {
  it.each([6, 16, 36, 37, 40, 109])('%i archers use the real preview/confirm path with safe overflow', count => {
    const { layout, obstacles, navigation } = walkwayInputs()
    const participants = Array.from({ length: count }, (_, index) => Object.assign(
      placementParticipant(`archer-${index}`, index), { rangedCombatKind: 'bow' as const }))
    const formation = placementController(participants, obstacles, navigation)
    const deck = layout.decks[0]
    const center = deck.slab.getCenter(new THREE.Vector3()).setY(deck.topY)
    const seam = formation as unknown as { raycaster: THREE.Raycaster; preview: { show(center: THREE.Vector3, slots: THREE.Vector3[], valid: boolean): void } }
    vi.spyOn(seam.raycaster, 'intersectObject').mockReturnValue([{ point: center, distance: 10, object: new THREE.Object3D() }])
    const preview = vi.spyOn(seam.preview, 'show')
    formation.beginPlacement('all')
    const shown = preview.mock.calls.at(-1)![1]
    expect(shown).toHaveLength(count)
    expect(shown.filter(slot => slot.y > getTerrainHeight(slot.x, slot.z) + 3)).toHaveLength(Math.min(count, 108))
    for (let i = 0; i < shown.length; i++) for (let j = 0; j < i; j++) expect(shown[i].distanceTo(shown[j])).toBeGreaterThanOrEqual(1)
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    const assigned = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1].toArray().join(','))
    expect(assigned.sort()).toEqual(shown.map(slot => slot.toArray().join(',')).sort())
    for (const slot of shown.slice(108)) {
      expect(slot.y).toBe(getTerrainHeight(slot.x, slot.z))
      expect(slot.z).toBeLessThan(-108)
      expect(Math.abs(slot.x)).toBeLessThan(43)
    }
  })

  it('six selected archers leave an unselected defender and its reserved destination untouched', () => {
    const { obstacles, navigation } = walkwayInputs()
    const participants = Array.from({ length: 6 }, (_, i) => Object.assign(
      placementParticipant(`selected-${i}`, i), { rangedCombatKind: 'bow' as const }))
    const slots = getOutpostRampartArcherSlots('roman').left
    const occupied = new THREE.Vector3(slots[0].x, slots[0].y, slots[0].z)
    const reserved = new THREE.Vector3(slots[1].x, slots[1].y, slots[1].z)
    const unselected = Object.assign(placementParticipant('unselected', 0), {
      presetId: 'roman_heavy_infantry', combatPosition: occupied.clone(), formationDestination: reserved,
    })
    const formation = placementController([...participants, unselected], obstacles, navigation)
    const seam = formation as unknown as { raycaster: THREE.Raycaster }
    vi.spyOn(seam.raycaster, 'intersectObject').mockReturnValue([{ point: occupied, distance: 10, object: new THREE.Object3D() }])
    formation.beginPlacement('viking_spearman')
    expect(formation.confirmPlacement().accepted).toBe(true)
    for (const npc of participants) {
      const assigned = npc.assignFormationTarget.mock.calls[0][1]
      expect(assigned.distanceTo(occupied)).toBeGreaterThanOrEqual(1)
      expect(assigned.distanceTo(reserved)).toBeGreaterThanOrEqual(1)
      expect(navigation.outpostNav!.getNavLayer(assigned)).not.toBe('ground')
    }
    expect(unselected.assignFormationTarget).not.toHaveBeenCalled()
    expect(unselected.combatPosition).toEqual(occupied)
    expect(unselected.formationDestination).toEqual(reserved)
  })
})
