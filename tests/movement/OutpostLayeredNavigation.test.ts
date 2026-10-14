import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  getCampaignOutpostPlacement,
} from '../../src/campaign/CampaignOutpost'
import {
  getOutpostWalkwayLayout,
} from '../../src/campaign/CampaignOutpostWalkways'
import {
  clampFollowSlotToDeck,
  clampFollowSlotToBridge,
  clampFollowSlotToStair,
  isGroundLayer,
  isRampartLayer,
  isStairLayer,
  OutpostLayeredNavigation,
} from '../../src/navigation/OutpostLayeredNavigation'
import { getSiegeRampPlacement } from '../../src/campaign/MobileSiegeRampPolicy'
import { getTerrainHeight, getWalkRampHeight } from '../../src/world/Terrain'
import {
  followLocalOffset,
  followSlotWorldPosition,
} from '../../src/battle/FollowOrder'

describe('OutpostLayeredNavigation', () => {
  const vikingPlacement = getCampaignOutpostPlacement('viking')
  const vikingLayout = getOutpostWalkwayLayout(vikingPlacement)
  const romanPlacement = getCampaignOutpostPlacement('roman')
  const romanLayout = getOutpostWalkwayLayout(romanPlacement)

  it('last siege ramp destruction retains deck routes and interior mounted descent', () => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    dockLeft(nav)
    nav.entrances.remove('left')
    expect(nav.entrances.hasMountedRamp).toBe(false)
    const left = nav.getWaypoints(-1).deckConnection.clone()
    const right = nav.getWaypoints(1).deckConnection.clone()
    const bridge = romanLayout.bridge!
    const gate = bridge.slab.getCenter(new THREE.Vector3()).setY(bridge.topY)
    expect(nav.getNavLayer(left)).toBe('rampart_left')
    for (const goal of [gate, right]) {
      const route = nav.resolveMoveTarget(left, goal, true, new THREE.Vector3())
      expect(route.currentLayer).toBe('rampart_left')
      expect(isRampartLayer(route.targetLayer)).toBe(true)
      expect(route.step).toBe('deck_approach')
      expect(route.target.y).toBe(left.y)
      expect(route.target.x).toBe(bridge.slab.min.x)
    }
    const courtyard = new THREE.Vector3(0, 0, nav.getWaypoints(-1).groundEntrance.z)
    courtyard.y = getTerrainHeight(courtyard.x, courtyard.z)
    for (const current of [left, gate, right]) {
      const route = nav.resolveMoveTarget(current, courtyard, true, new THREE.Vector3())
      expect(route.currentLayer).toBe(nav.getNavLayer(current))
      expect(route.targetLayer).toBe('ground')
      expect(route.target).not.toEqual(current)
      expect(['deck_approach', 'descend_stair']).toContain(route.step)
    }
  })

  // Pure topology: no scene, actors, geometry, or A* grid.
  function dockLeft(nav: OutpostLayeredNavigation) {
    const placement = getSiegeRampPlacement(romanLayout, -1)
    const surface = placement.surface
    const approach = new THREE.Vector3(surface.startX, surface.startY, surface.startZ - surface.dirZ * 2)
    nav.entrances.set({ id: 'left', type: 'siege-ramp-left', position: placement.dock,
      approach, exit: placement.deckConnection, surface, side: -1, walkable: true,
      mounted: true, faction: null, connectionId: 'left-connection' })
    return approach
  }

  it.each(['gate', 'palisade'] as const)('%s-first foot routes remain unchanged when a ramp docks later', type => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    const current = new THREE.Vector3(0, 0, -70)
    const goal = nav.getWaypoints(-1).deckConnection
    nav.entrances.set({ id: type, type, position: current, approach: current, exit: current,
      walkable: true, mounted: true, faction: null, connectionId: type })
    const groundGoal = nav.getWaypoints(-1).groundEntrance
    const before = [goal, groundGoal].map(target => nav.resolveMoveTarget(current, target, false, new THREE.Vector3(), type))
    const approach = dockLeft(nav)
    for (const [index, target] of [goal, groundGoal].entries()) {
      const after = nav.resolveMoveTarget(current, target, false, new THREE.Vector3(), type)
      expect(after).toEqual(before[index])
      expect(after.target.equals(approach)).toBe(false)
    }
    // Mounted cannot use the interior foot stair; invalid preferences can reselect too.
    expect(nav.resolveMoveTarget(current, goal, true, new THREE.Vector3(), type).target).toEqual(approach)
    nav.entrances.remove(type)
    expect(nav.resolveMoveTarget(current, goal, false, new THREE.Vector3(), type).target).toEqual(approach)
  })

  it.each([-1, 1])('mounted Follow queues locally at endpoint %i without wraparound or overlapping slots', side => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    dockLeft(nav)
    const deck = nav.getDeck(side as -1 | 1)!
    const leader = new THREE.Vector3(side * 42, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)
    const slots = Array.from({ length: 5 }, (_, slot) => {
      const out = new THREE.Vector3()
      nav.clampMountedFollow(out, leader, slot)
      expect(Math.abs(out.x - leader.x)).toBeCloseTo((slot + 1) * 3.2)
      expect(isRampartLayer(nav.getNavLayer(out))).toBe(true)
      const moved = new THREE.Vector3()
      nav.clampMountedFollow(moved, leader.clone().add(new THREE.Vector3(-side * .1, 0, 0)), slot)
      expect(moved.x - out.x).toBeCloseTo(-side * .1)
      return out
    })
    for (let i = 1; i < slots.length; i++) expect(Math.abs(slots[i].x - slots[i - 1].x)).toBeCloseTo(3.2)
    const overflow = [30, 31].map(slot => {
      const out = new THREE.Vector3(); nav.clampMountedFollow(out, leader, slot); return out
    })
    expect(overflow.every(p => nav.getNavLayer(p) === 'ground')).toBe(true)
    expect(overflow[0].distanceTo(overflow[1])).toBeGreaterThanOrEqual(3.2)
    nav.entrances.remove('left')
    const interior = [30, 31].map(slot => {
      const out = new THREE.Vector3(); nav.clampMountedFollow(out, leader, slot); return out
    })
    expect(interior.every(p => nav.getNavLayer(p) === 'ground' && p.z < -108)).toBe(true)
    expect(interior[0].distanceTo(interior[1])).toBeGreaterThanOrEqual(3.2)
  })

  it('mounted Follow preserves leader-specific slot sides while repeatedly crossing the bridge midpoint', () => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    dockLeft(nav)
    // Stable identity is separate from the per-follower smoothed position.
    const leader = {}, otherLeader = {}
    const positions = [-.02, .02, -.02].map(x => {
      const slots = Array.from({ length: 5 }, (_, slot) => {
        const out = new THREE.Vector3()
        nav.clampMountedFollow(out, new THREE.Vector3(x, romanLayout.bridge.topY,
          romanLayout.bridge.walkSurface.startZ), slot, leader)
        expect(isRampartLayer(nav.getNavLayer(out))).toBe(true)
        return out
      })
      for (let slot = 1; slot < slots.length; slot++) expect(slots[slot].x - slots[slot - 1].x).toBeCloseTo(3.2)
      // Another leader at the opposite boundary must not flip this queue.
      nav.clampMountedFollow(new THREE.Vector3(), new THREE.Vector3(42, 0, 0), 0, otherLeader)
      return slots
    })
    for (let slot = 0; slot < 5; slot++) {
      expect(positions[1][slot].x - positions[0][slot].x).toBeCloseTo(.04)
      expect(positions[2][slot]).toEqual(positions[0][slot])
    }
    // Boundary reversal is retained when the leader moves back a little.
    const nearEdge = [40, 39, 40].map(x => {
      const out = new THREE.Vector3(); nav.clampMountedFollow(out, new THREE.Vector3(x, 0, 0), 0, leader); return out.x
    })
    expect(nearEdge).toEqual([36.8, 35.8, 36.8])
  })

  it.each([true, false])('mounted courtyard routing descends first, then delegates to ground navigation (gate walkable=%s)', open => {
    const footOnly = { ...romanLayout, stairs: romanLayout.stairs.map(stair => ({ ...stair, ramp: { ...stair.ramp, mounted: false } })) }
    const nav = new OutpostLayeredNavigation(footOnly)
    const approach = dockLeft(nav)
    const entry = nav.entrances.entries.get('left')!, ramp = entry.surface!
    const courtyard = new THREE.Vector3(0, getTerrainHeight(0, -125), -125)
    const gateApproach = new THREE.Vector3(0, getTerrainHeight(0, -105), -105)
    const gateExit = new THREE.Vector3(0, getTerrainHeight(0, -111), -111)
    nav.entrances.set({ id: 'gate', type: 'gate', position: new THREE.Vector3(0, 0, -108), approach: gateApproach, exit: gateExit,
      mounted: true, walkable: open, faction: null, connectionId: 'gate' })
    const deck = entry.exit.clone().add(new THREE.Vector3(5, 0, 0))
    const deckStep = nav.resolveMoveTarget(deck, courtyard, true, new THREE.Vector3(), 'gate')
    expect(deckStep.target).toEqual(entry.exit)
    expect(deckStep.step).toBe('deck_approach')
    const topStep = nav.resolveMoveTarget(entry.exit, courtyard, true, new THREE.Vector3(), 'gate')
    expect(topStep.step).toBe('descend_stair')
    expect(topStep.target).toEqual(new THREE.Vector3(ramp.startX, ramp.startY, ramp.startZ))
    const crossing = entry.exit.clone().add(new THREE.Vector3(0, 0, -ramp.dirZ * .8))
    expect(nav.resolveMoveTarget(crossing, courtyard, true, new THREE.Vector3()).step).toBe('descend_stair')
    const middle = new THREE.Vector3(ramp.startX, 0, ramp.startZ + ramp.dirZ * ramp.length / 2)
    middle.y = getWalkRampHeight(ramp, middle.x, middle.z)!
    expect(nav.resolveMoveTarget(middle, courtyard, true, new THREE.Vector3(), 'left').target).toEqual(approach)
    // Clear the low edge with the whole body before turning out of the ramp lane.
    const lowStep = nav.resolveMoveTarget(approach, courtyard, true, new THREE.Vector3(), 'left')
    expect(lowStep.step).toBe('descend_stair')
    expect((lowStep.target.z - ramp.startZ) * ramp.dirZ).toBeCloseTo(-3)
    const clearStep = nav.resolveMoveTarget(lowStep.target, courtyard, true, new THREE.Vector3(), 'left')
    if (open) expect(Math.abs(clearStep.target.x - ramp.startX)).toBeGreaterThan(3.7)
    else expect(clearStep.target).toEqual(lowStep.target)
    // Stale-but-walkable ramp preference cannot cause another ascent. Ground
    // waypoints still invoke A*, never a direct movement through a closed gate.
    const groundStep = nav.resolveMoveTarget(clearStep.target, courtyard, true, new THREE.Vector3(), 'left')
    expect(groundStep.step).toBe('ground_approach')
    expect(groundStep.target).toEqual(open ? gateApproach : clearStep.target)
    if (open) {
      for (const z of [-105, -106, -107]) {
        expect(nav.resolveMoveTarget(new THREE.Vector3(0, getTerrainHeight(0, z), z), courtyard, true,
          new THREE.Vector3(), 'left').target).toEqual(gateExit)
      }
      expect(nav.resolveMoveTarget(gateExit, courtyard, true, new THREE.Vector3(), 'left').target).toEqual(courtyard)
    }
    expect(nav.entrances.entries.get('gate')!.walkable).toBe(open)
    expect(nav.resolveMoveTarget(middle, approach, true, new THREE.Vector3()).step).toBe('descend_stair')
  })

  it('places bridge exit waypoints beyond layer tolerance on either connected wing', () => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    const bridge = romanLayout.bridge
    const z = bridge.walkSurface.startZ
    for (const side of [-1, 1] as const) {
      const current = new THREE.Vector3(side * 0.1, bridge.topY, z)
      const ground = nav.getWaypoints(side).groundEntrance
      const target = new THREE.Vector3()
      nav.resolveMoveTarget(current, ground, false, target)
      expect(nav.getNavLayer(target)).toBe(side < 0 ? 'rampart_left' : 'rampart_right')
      const next = nav.resolveMoveTarget(target, ground, false, new THREE.Vector3())
      expect(next.target.distanceTo(target)).toBeGreaterThan(1)
    }
  })

  it('enters the stair from its safe foot corridor instead of routing back through the inflated ground cell', () => {
    const nav = new OutpostLayeredNavigation(romanLayout)
    const ramp = nav.getStair(-1)!.ramp
    const current = new THREE.Vector3(ramp.startX + 0.59, ramp.startY, ramp.startZ - ramp.dirZ * 0.04)
    const goal = new THREE.Vector3(0, romanLayout.bridge.topY, romanLayout.bridge.walkSurface.startZ)
    expect(nav.getNavLayer(current)).toBe('ground')
    expect(nav.resolveMoveTarget(current, goal, false, new THREE.Vector3()).step).toBe('ascend_stair')
  })

  it('spreads 30 bridge follow slots across connected wings with exact heights, spacing and stable movement', () => {
    // Capacity is a data contract: zero real actors, one representative layout.
    const layout = romanLayout
    const nav = new OutpostLayeredNavigation(layout)
    const leader = new THREE.Vector3(0, layout.bridge.topY, layout.bridge.walkSurface.startZ)
    const slots = Array.from({ length: 30 }, (_, i) =>
      clampFollowSlotToBridge(new THREE.Vector3(), leader, i, layout))
    const layers = new Set(slots.map(p => nav.getNavLayer(p)))
    expect(layers).toEqual(new Set(['rampart_gate', 'rampart_left', 'rampart_right']))
    for (const [i, slot] of slots.entries()) {
      const surface = [layout.bridge, ...layout.decks].find(d =>
        getWalkRampHeight(d.walkSurface, slot.x, slot.z) !== null)!
      expect(slot.y).toBeCloseTo(getWalkRampHeight(surface.walkSurface, slot.x, slot.z)!, 8)
      expect(slot.z).toBeGreaterThan(surface.slab.min.z + 0.75)
      expect(slot.z).toBeLessThan(surface.slab.max.z - 0.75)
      for (const other of slots.slice(i + 1)) {
        expect(Math.hypot(slot.x - other.x, slot.z - other.z)).toBeGreaterThanOrEqual(1)
      }
      const moved = clampFollowSlotToBridge(new THREE.Vector3(), leader.clone().add(new THREE.Vector3(0.1, 0, 0)), i, layout)
      expect(moved.x - slot.x).toBeCloseTo(0.1)
      expect(moved.z).toBe(slot.z)
    }
    // Once both wings fill, the next four slots form unique legal ground queues.
    const overflow = [52, 53, 54, 55].map(i => clampFollowSlotToBridge(new THREE.Vector3(), leader, i, layout))
    expect(overflow.every(p => nav.getNavLayer(p) === 'ground')).toBe(true)
    for (const p of overflow) expect(p.y).toBe(getTerrainHeight(p.x, p.z))
    expect(new Set(overflow.map(p => p.toArray().join(','))).size).toBe(4)
  })

  describe('Layer Identification', () => {
    it('distinguishes ground, stairs, and both rampart sides in the representative Viking layout', () => {
      // CampaignOutpost's pure Mirror Contract owns faction geometry; side labels are distinct branches.
      const placement = vikingPlacement
      const layout = vikingLayout
      const nav = new OutpostLayeredNavigation(layout)

      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightDeck = layout.decks.find(d => d.side === 1)!
      const leftStair = layout.stairs.find(s => s.side === -1)!
      const rightStair = layout.stairs.find(s => s.side === 1)!

      // 1. Deck positions
      const leftDeckPos = new THREE.Vector3(-20, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)
      expect(nav.getNavLayer(leftDeckPos)).toBe('rampart_left')
      expect(isRampartLayer(nav.getNavLayer(leftDeckPos))).toBe(true)

      const rightDeckPos = new THREE.Vector3(20, rightDeck.topY, (rightDeck.slab.min.z + rightDeck.slab.max.z) / 2)
      expect(nav.getNavLayer(rightDeckPos)).toBe('rampart_right')
      expect(isRampartLayer(nav.getNavLayer(rightDeckPos))).toBe(true)

      // 2. Ground directly beneath the deck slab (same X, Z but at ground terrain height)
      const groundUnderLeftDeck = new THREE.Vector3(
        -20,
        getTerrainHeight(-20, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2),
        (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2,
      )
      expect(nav.getNavLayer(groundUnderLeftDeck)).toBe('ground')
      expect(isGroundLayer(nav.getNavLayer(groundUnderLeftDeck))).toBe(true)

      // 3. Open ground courtyard
      const courtyardZ = (placement.frontZ + placement.backZ) / 2
      const courtyardGround = new THREE.Vector3(0, getTerrainHeight(0, courtyardZ), courtyardZ)
      expect(nav.getNavLayer(courtyardGround)).toBe('ground')

      // 4. Stair positions (halfway up the ramp)
      const leftMidZ = (leftStair.ramp.startZ + leftStair.ramp.startZ + leftStair.ramp.dirZ * leftStair.ramp.length) / 2
      const leftMidY = (leftStair.ramp.startY + leftStair.ramp.topY) / 2
      const leftStairPos = new THREE.Vector3(leftStair.ramp.startX, leftMidY, leftMidZ)
      expect(nav.getNavLayer(leftStairPos)).toBe('stair_left')
      expect(isStairLayer(nav.getNavLayer(leftStairPos))).toBe(true)

      const rightMidZ = (rightStair.ramp.startZ + rightStair.ramp.startZ + rightStair.ramp.dirZ * rightStair.ramp.length) / 2
      const rightMidY = (rightStair.ramp.startY + rightStair.ramp.topY) / 2
      const rightStairPos = new THREE.Vector3(rightStair.ramp.startX, rightMidY, rightMidZ)
      expect(nav.getNavLayer(rightStairPos)).toBe('stair_right')
      expect(isStairLayer(nav.getNavLayer(rightStairPos))).toBe(true)
    })
  })

  describe('Mounted Unit Ground Restriction', () => {
    it('restricts mounted units to ground when all available stairs are explicitly foot-only', () => {
      const nav = new OutpostLayeredNavigation({ ...vikingLayout, stairs: vikingLayout.stairs.map(stair => ({ ...stair, ramp: { ...stair.ramp, mounted: false } })) })
      const deck = vikingLayout.decks[0]
      const goalOnDeck = new THREE.Vector3(-20, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)
      const currentGround = new THREE.Vector3(0, getTerrainHeight(0, 130), 130)

      const out = new THREE.Vector3()
      const result = nav.resolveMoveTarget(currentGround, goalOnDeck, true, out)

      // Must stay on ground, projecting destination down to terrain with ground_approach step
      expect(result.currentLayer).toBe('ground')
      expect(result.targetLayer).toBe('rampart_left')
      expect(result.isCrossLayer).toBe(true)
      expect(result.step).toBe('ground_approach')
      expect(out.y).toBeCloseTo(getTerrainHeight(-20, goalOnDeck.z), 1)
      expect(out.x).toBeCloseTo(-20, 1)
    })
  })

  describe('Ground to Rampart Progression', () => {
    it('steps from ground entrance to stair top to deck target', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const stair = vikingLayout.stairs.find(s => s.side === -1)!
      const goalOnDeck = new THREE.Vector3(-20, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)

      const out = new THREE.Vector3()

      // Phase 1: Ground unit far from stair
      const farGround = new THREE.Vector3(-10, getTerrainHeight(-10, 140), 140)
      const r1 = nav.resolveMoveTarget(farGround, goalOnDeck, false, out)
      expect(r1.step).toBe('ground_approach')
      expect(r1.isCrossLayer).toBe(true)
      // Destination is the ground entrance of left stair
      const wp = nav.getWaypoints(-1)
      expect(out.distanceTo(wp.groundEntrance)).toBeLessThan(0.01)

      // Phase 2: Unit arrives at ground entrance
      const atEntrance = wp.groundEntrance.clone()
      const r2 = nav.resolveMoveTarget(atEntrance, goalOnDeck, false, out)
      expect(r2.step).toBe('ascend_stair')
      // Aims up toward landing with ascending lane offset (+0.3m)
      expect(out.x).toBeCloseTo(stair.ramp.startX + 0.3, 2)
      expect(out.y).toBeCloseTo(deck.topY, 1)

      // Phase 3: A unit partway up the slope keeps ascending rather than crossing to the deck early.
      const midZ = stair.ramp.startZ + stair.ramp.dirZ * 8
      const midY = getWalkRampHeight(stair.ramp, stair.ramp.startX, midZ)!
      const midStair = new THREE.Vector3(stair.ramp.startX, midY, midZ)
      expect(nav.resolveMoveTarget(midStair, goalOnDeck, false, out).step).toBe('ascend_stair')

      // Phase 4: Unit on stair near landing
      const onStairTop = new THREE.Vector3(stair.ramp.startX, deck.topY, wp.stairTopLanding.z)
      const r3 = nav.resolveMoveTarget(onStairTop, goalOnDeck, false, out)
      expect(r3.step).toBe('deck_approach')
      expect(out.distanceTo(wp.deckConnection)).toBeLessThan(0.01)

      // Traffic can displace an actor sideways after it passes the landing.
      // Routing back to the landing would deadlock followers at the exit.
      const displaced = onStairTop.clone().add(new THREE.Vector3(-.55, 0, stair.ramp.dirZ * .6))
      for (const goal of [goalOnDeck, vikingLayout.bridge.slab.getCenter(new THREE.Vector3()).setY(vikingLayout.bridge.topY)]) {
        expect(nav.resolveMoveTarget(displaced, goal, false, out).step).toBe('deck_approach')
        expect((out.z - displaced.z) * stair.ramp.dirZ).toBeGreaterThan(0)
      }

      // Phase 5: Unit on deck slab
      const onDeck = new THREE.Vector3(-30, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)
      const r4 = nav.resolveMoveTarget(onDeck, goalOnDeck, false, out)
      expect(r4.step).toBe('direct')
      expect(r4.isCrossLayer).toBe(false)
      expect(out.distanceTo(goalOnDeck)).toBeLessThan(0.01)
    })
  })

  describe('Rampart to Ground Progression', () => {
    it('steps from deck connection down stair to ground target', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const stair = vikingLayout.stairs.find(s => s.side === -1)!
      const wp = nav.getWaypoints(-1)
      const goalOnGround = new THREE.Vector3(-15, getTerrainHeight(-15, 140), 140)

      const out = new THREE.Vector3()

      // Phase 1: Unit on deck far from stair
      const onDeckFar = new THREE.Vector3(-15, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)
      const r1 = nav.resolveMoveTarget(onDeckFar, goalOnGround, false, out)
      expect(r1.step).toBe('deck_approach')
      expect(out.distanceTo(wp.deckConnection)).toBeLessThan(0.01)

      // Phase 2: The deck-side connection enters the descent branch before reaching the stair layer.
      const atConnection = nav.resolveMoveTarget(wp.deckConnection, goalOnGround, false, out)
      expect(atConnection.step).toBe('descend_stair')
      expect(out.x).toBeCloseTo(stair.ramp.startX - 0.3, 2)

      // Phase 3: Unit at stair landing
      const atTopLanding = new THREE.Vector3(stair.ramp.startX, deck.topY, wp.stairTopLanding.z)
      const r2 = nav.resolveMoveTarget(atTopLanding, goalOnGround, false, out)
      expect(r2.step).toBe('descend_stair')
      // Aims down toward ground entrance with descending lane offset (-0.3m)
      expect(out.x).toBeCloseTo(stair.ramp.startX - 0.3, 2)

      // Phase 4: Unit on ground
      const onGround = wp.groundEntrance.clone().add(new THREE.Vector3(0, 0, 3))
      onGround.y = getTerrainHeight(onGround.x, onGround.z)
      const r3 = nav.resolveMoveTarget(onGround, goalOnGround, false, out)
      expect(r3.step).toBe('direct')
      expect(r3.isCrossLayer).toBe(false)
      expect(out.distanceTo(goalOnGround)).toBeLessThan(0.01)
    })
  })

  describe('Wing-to-Wing Crossing', () => {
    it('routes continuously across the elevated bridge in both directions', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const bridge = vikingLayout.bridge
      const midZ = (bridge.slab.min.z + bridge.slab.max.z) / 2
      const out = new THREE.Vector3()

      // Left -> right and right -> left have separate production branches.
      for (const startSide of [-1, 1] as const) {
        const startDeck = nav.getDeck(startSide)!
        const goalDeck = nav.getDeck(startSide === -1 ? 1 : -1)!
        const direction = startSide < 0 ? 'left -> right' : 'right -> left'
        const entryX = startSide < 0 ? bridge.slab.min.x : bridge.slab.max.x
        const exitX = startSide < 0 ? bridge.slab.max.x : bridge.slab.min.x
        const start = new THREE.Vector3(startSide * 20, startDeck.topY, midZ)
        const goal = new THREE.Vector3(-startSide * 25, goalDeck.topY, midZ)

        // The starting wing approaches its bridge portal without descending.
        const approach = nav.resolveMoveTarget(start, goal, false, out)
        expect(approach.step, direction).toBe('deck_approach')
        expect(out.x, direction).toBeCloseTo(entryX, 2)

        // At the entry portal, the next target advances across the bridge.
        const atPortal = new THREE.Vector3(entryX + startSide * 0.2, startDeck.topY, midZ)
        const crossing = nav.resolveMoveTarget(atPortal, goal, false, out)
        expect(crossing.step, direction).toBe('deck_approach')
        if (startSide < 0) expect(out.x, direction).toBeGreaterThan(entryX)
        else expect(out.x, direction).toBeLessThan(entryX)

        // The bridge center approaches the destination wing's portal.
        const center = nav.resolveMoveTarget(new THREE.Vector3(0, bridge.topY, midZ), goal, false, out)
        expect(center.step, direction).toBe('deck_approach')
        expect(out.x, direction).toBeCloseTo(exitX, 2)
      }
    })

    it('descends left wing stair first before crossing ground to right wing stair when bridge is absent', () => {
      const layoutWithoutBridge = { ...vikingLayout, bridge: undefined as any }
      const nav = new OutpostLayeredNavigation(layoutWithoutBridge)
      const leftDeck = vikingLayout.decks.find(d => d.side === -1)!
      const rightDeck = vikingLayout.decks.find(d => d.side === 1)!
      const leftWp = nav.getWaypoints(-1)
      const rightWp = nav.getWaypoints(1)

      const goalOnRight = new THREE.Vector3(25, rightDeck.topY, (rightDeck.slab.min.z + rightDeck.slab.max.z) / 2)
      const startOnLeft = new THREE.Vector3(-20, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)

      const out = new THREE.Vector3()

      // On left deck: heads to left stair deck connection to descend
      const r1 = nav.resolveMoveTarget(startOnLeft, goalOnRight, false, out)
      expect(r1.step).toBe('deck_approach')
      expect(out.distanceTo(leftWp.deckConnection)).toBeLessThan(0.01)

      // Once on ground: heads to right stair ground entrance to ascend opposite wing
      const onGroundBetween = new THREE.Vector3(0, getTerrainHeight(0, 130), 130)
      const r2 = nav.resolveMoveTarget(onGroundBetween, goalOnRight, false, out)
      expect(r2.step).toBe('ground_approach')
      expect(out.distanceTo(rightWp.groundEntrance)).toBeLessThan(0.01)
    })

    it('handles height delta between left and right rampart wings across bridge walk surface', () => {
      // Create a layout where left deck is at 6.0m and right deck is at 7.5m
      const asymmetricLayout = {
        ...vikingLayout,
        decks: vikingLayout.decks.map(d => ({
          ...d,
          topY: d.side === -1 ? 6.0 : 7.5,
          slab: d.side === -1
            ? new THREE.Box3(new THREE.Vector3(-30, 5.0, 105), new THREE.Vector3(-10, 6.0, 115))
            : new THREE.Box3(new THREE.Vector3(10, 6.5, 105), new THREE.Vector3(30, 7.5, 115)),
        })),
        bridge: {
          ...vikingLayout.bridge!,
          topY: 6.75,
          slab: new THREE.Box3(new THREE.Vector3(-10, 5.0, 105), new THREE.Vector3(10, 7.5, 115)),
          walkSurface: {
            startX: -10,
            startY: 6.0,
            startZ: 110,
            dirX: 1,
            dirZ: 0,
            length: 20,
            halfWidth: 2,
            topY: 7.5,
            landing: 0,
          },
        },
      }

      const nav = new OutpostLayeredNavigation(asymmetricLayout)

      // Test layer classification across asymmetric span
      // At x = -10 (left portal), Y is 6.0
      expect(nav.getNavLayer(new THREE.Vector3(-10, 6.0, 110))).toBe('rampart_gate')
      // At x = 0 (bridge mid), surface height is 6.0 + 1.5 * (10/20) = 6.75
      expect(nav.getNavLayer(new THREE.Vector3(0, 6.75, 110))).toBe('rampart_gate')
      // At x = 10 (right portal), Y is 7.5
      expect(nav.getNavLayer(new THREE.Vector3(10, 7.5, 110))).toBe('rampart_gate')

      // Ground directly underneath bridge at x = 0, y = 0 must be classified as 'ground', not 'rampart_gate'
      expect(nav.getNavLayer(new THREE.Vector3(0, 0, 110))).toBe('ground')
    })
  })

  describe('Follow Slot Clamping on Rampart Deck', () => {
    it('clamps follow slots within slab surface and rails', () => {
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const leaderPos = new THREE.Vector3(-20, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)

      const rawBehind = new THREE.Vector3(-20, deck.topY, 150) // Raw slot far outside deck depth
      const clamped = new THREE.Vector3()
      clampFollowSlotToDeck(clamped, rawBehind, leaderPos, 0, deck)

      expect(clamped.y).toBe(deck.topY)
      expect(clamped.x).toBeGreaterThanOrEqual(deck.slab.min.x + 0.5)
      expect(clamped.x).toBeLessThanOrEqual(deck.slab.max.x - 0.5)
      expect(clamped.z).toBeGreaterThanOrEqual(deck.slab.min.z + 0.5)
      expect(clamped.z).toBeLessThanOrEqual(deck.slab.max.z - 0.5)
    })

    it('staggers multiple follower slots along X so they do not overlap', () => {
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const leaderPos = new THREE.Vector3(-20, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)

      const slot0 = clampFollowSlotToDeck(new THREE.Vector3(), leaderPos.clone(), leaderPos, 0, deck)
      const slot1 = clampFollowSlotToDeck(new THREE.Vector3(), leaderPos.clone(), leaderPos, 1, deck)
      const slot2 = clampFollowSlotToDeck(new THREE.Vector3(), leaderPos.clone(), leaderPos, 2, deck)

      // Slots must have distinct X coordinates along the deck corridor
      expect(slot0.x).not.toBe(slot1.x)
      expect(slot1.x).not.toBe(slot2.x)
      expect(slot0.distanceTo(slot1)).toBeGreaterThan(1.0)
    })
  })

  describe('Stair Traffic Lane Separation', () => {
    it('assigns +0.3m offset for ascending and -0.3m offset for descending', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const stair = vikingLayout.stairs.find(s => s.side === -1)!
      const wp = nav.getWaypoints(-1)

      const goalOnDeck = new THREE.Vector3(-20, deck.topY, (deck.slab.min.z + deck.slab.max.z) / 2)
      const goalOnGround = new THREE.Vector3(-20, getTerrainHeight(-20, 140), 140)

      const ascendingOut = new THREE.Vector3()
      nav.resolveMoveTarget(wp.groundEntrance, goalOnDeck, false, ascendingOut)

      const descendingOut = new THREE.Vector3()
      nav.resolveMoveTarget(wp.stairTopLanding, goalOnGround, false, descendingOut)

      expect(ascendingOut.x).toBeCloseTo(stair.ramp.startX + 0.3, 2)
      expect(descendingOut.x).toBeCloseTo(stair.ramp.startX - 0.3, 2)
      expect(Math.abs(ascendingOut.x - descendingOut.x)).toBeCloseTo(0.6, 2)
    })
  })

  describe('Comprehensive Layer Transitions: deck->stair and stair->stair', () => {
    it('resolves deck_left -> stair_left via deckConnection then down slope', () => {
      const layout = vikingLayout
      const nav = new OutpostLayeredNavigation(layout)
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const leftStair = layout.stairs.find(s => s.side === -1)!
      const leftWp = nav.getWaypoints(-1)

      const startOnDeck = new THREE.Vector3(-20, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)
      const midStairZ = (leftStair.ramp.startZ + leftStair.ramp.startZ + leftStair.ramp.dirZ * leftStair.ramp.length) / 2
      const midStairY = (leftStair.ramp.startY + leftStair.ramp.topY) / 2
      const goalOnStair = new THREE.Vector3(leftStair.ramp.startX, midStairY, midStairZ)

      const out = new THREE.Vector3()

      // Phase 1: On deck far from stair -> must walk along deck corridor to deckConnection first
      const r1 = nav.resolveMoveTarget(startOnDeck, goalOnStair, false, out)
      expect(r1.step).toBe('deck_approach')
      expect(r1.isCrossLayer).toBe(true)
      expect(out.distanceTo(leftWp.deckConnection)).toBeLessThan(0.01)

      // Phase 2: At deck connection -> descends stair toward goal on stair
      const atConnection = leftWp.deckConnection.clone()
      const r2 = nav.resolveMoveTarget(atConnection, goalOnStair, false, out)
      expect(r2.step).toBe('descend_stair')
      expect(r2.isCrossLayer).toBe(true)
      expect(out.x).toBeCloseTo(leftStair.ramp.startX - 0.3, 2)
      expect(out.z).toBeCloseTo(goalOnStair.z, 2)
    })

    it('resolves deck_left -> stair_right via deckConnection, down left stair, then to right stair entrance', () => {
      const layout = vikingLayout
      const nav = new OutpostLayeredNavigation(layout)
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightStair = layout.stairs.find(s => s.side === 1)!
      const leftWp = nav.getWaypoints(-1)
      const rightWp = nav.getWaypoints(1)

      const startOnLeftDeck = new THREE.Vector3(-20, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)
      const midRightStairZ = (rightStair.ramp.startZ + rightStair.ramp.startZ + rightStair.ramp.dirZ * rightStair.ramp.length) / 2
      const midRightStairY = (rightStair.ramp.startY + rightStair.ramp.topY) / 2
      const goalOnRightStair = new THREE.Vector3(rightStair.ramp.startX, midRightStairY, midRightStairZ)

      const out = new THREE.Vector3()

      // Phase 1: On left deck -> deck_approach to left deckConnection
      const r1 = nav.resolveMoveTarget(startOnLeftDeck, goalOnRightStair, false, out)
      expect(r1.step).toBe('deck_approach')
      expect(out.distanceTo(leftWp.deckConnection)).toBeLessThan(0.01)

      // Phase 2: At left deck connection -> descend left stair toward ground
      const atLeftConnection = leftWp.deckConnection.clone()
      const r2 = nav.resolveMoveTarget(atLeftConnection, goalOnRightStair, false, out)
      expect(r2.step).toBe('descend_stair')
      expect(out.x).toBeCloseTo(leftWp.stair.ramp.startX - 0.3, 2)

      // Phase 3: Once on ground courtyard -> ground_approach toward right stair entrance
      const onCourtyardGround = new THREE.Vector3(0, getTerrainHeight(0, leftWp.groundEntrance.z), leftWp.groundEntrance.z)
      const r3 = nav.resolveMoveTarget(onCourtyardGround, goalOnRightStair, false, out)
      expect(r3.step).toBe('ground_approach')
      expect(out.distanceTo(rightWp.groundEntrance)).toBeLessThan(0.01)
    })

    it('resolves stair_left -> stair_right by descending to ground first before crossing', () => {
      const layout = vikingLayout
      const nav = new OutpostLayeredNavigation(layout)
      const leftStair = layout.stairs.find(s => s.side === -1)!
      const rightStair = layout.stairs.find(s => s.side === 1)!
      const leftWp = nav.getWaypoints(-1)
      const rightWp = nav.getWaypoints(1)

      const midLeftStairZ = (leftStair.ramp.startZ + leftStair.ramp.startZ + leftStair.ramp.dirZ * leftStair.ramp.length) / 2
      const midLeftStairY = (leftStair.ramp.startY + leftStair.ramp.topY) / 2
      const startOnLeftStair = new THREE.Vector3(leftStair.ramp.startX, midLeftStairY, midLeftStairZ)

      const midRightStairZ = (rightStair.ramp.startZ + rightStair.ramp.startZ + rightStair.ramp.dirZ * rightStair.ramp.length) / 2
      const midRightStairY = (rightStair.ramp.startY + rightStair.ramp.topY) / 2
      const goalOnRightStair = new THREE.Vector3(rightStair.ramp.startX, midRightStairY, midRightStairZ)

      const out = new THREE.Vector3()

      // Phase 1: On left stair -> descend toward left ground entrance
      const r1 = nav.resolveMoveTarget(startOnLeftStair, goalOnRightStair, false, out)
      expect(r1.step).toBe('descend_stair')
      expect(r1.isCrossLayer).toBe(true)
      // Must NOT aim directly across empty air to right stair
      expect(out.x).toBeCloseTo(leftStair.ramp.startX - 0.3, 2)

      // Phase 2: At left ground entrance -> now on ground, navigates to right entrance
      const r2 = nav.resolveMoveTarget(leftWp.groundEntrance, goalOnRightStair, false, out)
      expect(r2.step).toBe('ground_approach')
      expect(out.distanceTo(rightWp.groundEntrance)).toBeLessThan(0.01)
    })
  })

  describe('Follow Slot Clamping at Deck Boundaries (P2 Regression)', () => {
    it('prevents slot collapse at deck boundaries (P2 review scenario)', () => {
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const slab = deck.slab
      const minX = slab.min.x + 0.6
      const maxX = slab.max.x - 0.6
      const minZ = slab.min.z + 0.55
      const maxZ = slab.max.z - 0.55

      // Reviewer scenario: Viking left deck, leader at x = -42.5 (near minX = -43.0), yaw = 0
      const leaderPos = new THREE.Vector3(-42.5, deck.topY, 109.6)
      const slotIndices = [0, 1, 2, 3, 4, 6]
      const clampedSlots: THREE.Vector3[] = []

      for (const slotIndex of slotIndices) {
        const offset = followLocalOffset(slotIndex, false)
        const rawPos = followSlotWorldPosition(leaderPos, 0, offset)
        const clamped = clampFollowSlotToDeck(new THREE.Vector3(), rawPos, leaderPos, slotIndex, deck, 0)
        clampedSlots.push(clamped)
      }

      // 1. All slots stay strictly within safe deck boundaries
      for (const slot of clampedSlots) {
        expect(slot.x).toBeGreaterThanOrEqual(minX)
        expect(slot.x).toBeLessThanOrEqual(maxX)
        expect(slot.z).toBeGreaterThanOrEqual(minZ)
        expect(slot.z).toBeLessThanOrEqual(maxZ)
        expect(slot.y).toBe(deck.topY)
      }

      // 2. Slots 0, 2, 4, 6 must NOT collapse to the identical corner point (-43, deckY, 108.55)
      const slot0 = clampedSlots[0]
      const slot2 = clampedSlots[2]
      const slot4 = clampedSlots[4]
      const slot6 = clampedSlots[5]
      expect(slot0.distanceTo(slot2)).toBeGreaterThan(1.2)
      expect(slot2.distanceTo(slot4)).toBeGreaterThan(1.2)
      expect(slot4.distanceTo(slot6)).toBeGreaterThan(1.2)

      // 3. Every pair of slots has distinct X coordinates with >= 1.2m separation
      for (let i = 0; i < clampedSlots.length; i++) {
        for (let j = i + 1; j < clampedSlots.length; j++) {
          expect(
            Math.abs(clampedSlots[i].x - clampedSlots[j].x),
            `Slots ${slotIndices[i]} and ${slotIndices[j]} must not share the same X`,
          ).toBeGreaterThanOrEqual(1.2)
        }
      }
    })

    it('prevents slot collapse at positive deck boundary (maxX)', () => {
      const deck = vikingLayout.decks.find(d => d.side === -1)!
      const slab = deck.slab
      const minX = slab.min.x + 0.6
      const maxX = slab.max.x - 0.6

      // Leader backed up to the right end of the deck
      const leaderPos = new THREE.Vector3(maxX + 0.2, deck.topY, 109.6)
      const slotIndices = [0, 1, 2, 3, 4, 6]
      const clampedSlots: THREE.Vector3[] = []

      for (const slotIndex of slotIndices) {
        const offset = followLocalOffset(slotIndex, false)
        const rawPos = followSlotWorldPosition(leaderPos, 0, offset)
        const clamped = clampFollowSlotToDeck(new THREE.Vector3(), rawPos, leaderPos, slotIndex, deck, 0)
        clampedSlots.push(clamped)
      }

      for (let i = 0; i < clampedSlots.length; i++) {
        expect(clampedSlots[i].x).toBeGreaterThanOrEqual(minX)
        expect(clampedSlots[i].x).toBeLessThanOrEqual(maxX)
        for (let j = i + 1; j < clampedSlots.length; j++) {
          expect(
            Math.abs(clampedSlots[i].x - clampedSlots[j].x),
          ).toBeGreaterThanOrEqual(1.2)
        }
      }
    })
  })

  describe('30-Person Follow Slot Allocation Across Full Deck (0..29 Non-Overlapping Bodies >= 1.0m)', () => {
    it('allocates bodies >= 1.0m apart for slots 0..29 on the representative deck at interior and both boundary positions', () => {
      // The allocator consumes geometry, with faction/side dimensions owned by the pure Mirror Contract.
      const layout = vikingLayout
      const side = -1
      const deck = layout.decks.find(d => d.side === side)!
      const stair = layout.stairs.find(s => s.side === side)!
      const slab = deck.slab
      const minX = slab.min.x + 0.6
      const maxX = slab.max.x - 0.6
      const minZ = slab.min.z + 0.55
      const maxZ = slab.max.z - 0.55
      const deckMidZ = (slab.min.z + slab.max.z) * 0.5

      // Test 3 leader positions: reviewer's condition (x=-42.5), near far boundary, and near near boundary
      const leaderPositions = [
        new THREE.Vector3(side < 0 ? (slab.min.x + 7.1) : (slab.max.x - 7.1), deck.topY, deckMidZ),
        new THREE.Vector3(minX + 0.8, deck.topY, deckMidZ),
        new THREE.Vector3(maxX - 0.8, deck.topY, deckMidZ),
      ]

      for (const leaderPos of leaderPositions) {
        const slots: THREE.Vector3[] = []
        for (let slotIndex = 0; slotIndex < 30; slotIndex++) {
          const offset = followLocalOffset(slotIndex, false)
          const rawPos = followSlotWorldPosition(leaderPos, 0, offset)
          const pos = clampFollowSlotToDeck(new THREE.Vector3(), rawPos, leaderPos, slotIndex, deck, 0, stair)
          slots.push(pos)
        }

        // 1. All 30 slots are either within deck boundary or at ground queue at stair foot
        for (const [i, slot] of slots.entries()) {
          if (Math.abs(slot.y - deck.topY) < 0.01) {
            expect(slot.x, `Slot ${i} X within deck bounds`).toBeGreaterThanOrEqual(minX - 0.01)
            expect(slot.x, `Slot ${i} X within deck bounds`).toBeLessThanOrEqual(maxX + 0.01)
            expect(slot.z, `Slot ${i} Z within deck bounds`).toBeGreaterThanOrEqual(minZ - 0.01)
            expect(slot.z, `Slot ${i} Z within deck bounds`).toBeLessThanOrEqual(maxZ + 0.01)
          }
        }

        // 2. Real body contract: EVERY pair of slots has planar distance >= 1.0m (no physical overlap)
        for (let i = 0; i < 30; i++) {
          for (let j = i + 1; j < 30; j++) {
            const planarDist = Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)
            expect(
              planarDist,
              `Slots ${i} and ${j} on Viking side=${side} deck (leader x=${leaderPos.x.toFixed(1)}) must be at least 1.0m apart to avoid body push collision, got ${planarDist.toFixed(3)}m (slot ${i}: ${slots[i].x.toFixed(2)},${slots[i].z.toFixed(2)} vs slot ${j}: ${slots[j].x.toFixed(2)},${slots[j].z.toFixed(2)})`,
            ).toBeGreaterThanOrEqual(1.0)
          }
        }
      }
    })
  })

  describe('Mid-Stair Follow Slot Safe Corridor Projection (P2 Review)', () => {
    it('projects follow slots strictly inside the representative stair corridor with slope and ground heights', () => {
      const layout = vikingLayout
      const side = -1
      const stair = layout.stairs.find(s => s.side === side)!
      const deck = layout.decks.find(d => d.side === side)!
      const ramp = stair.ramp

      // Mid-stair leader position: halfway up the ramp slope
      const midAlong = ramp.length * 0.5
      const leaderZ = ramp.startZ + ramp.dirZ * midAlong
      const leaderY = ramp.startY + 0.5 * (ramp.topY - ramp.startY)
      const leaderPos = new THREE.Vector3(ramp.startX, leaderY, leaderZ)

      const nav = new OutpostLayeredNavigation(layout)
      expect(isStairLayer(nav.getNavLayer(leaderPos))).toBe(true)

      const slots: THREE.Vector3[] = []
      for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
        const out = new THREE.Vector3()
        clampFollowSlotToStair(out, leaderPos, slotIndex, stair, deck)
        slots.push(out)

        // 1. Clamped within ramp width [startX - 0.7, startX + 0.7]
        expect(out.x).toBeGreaterThanOrEqual(ramp.startX - 0.7)
        expect(out.x).toBeLessThanOrEqual(ramp.startX + 0.7)

        // 2. Height matches slope interpolation or ground terrain
        const along = (out.z - ramp.startZ) * ramp.dirZ
        if (along >= 0 && along <= ramp.length) {
          const expectedY = ramp.startY + (along / ramp.length) * (ramp.topY - ramp.startY)
          expect(out.y).toBeCloseTo(expectedY, 2)
          // Valid stair layer
          expect(isStairLayer(nav.getNavLayer(out))).toBe(true)
        } else if (along < 0) {
          // Beyond stair foot -> ground entrance
          expect(out.y).toBeCloseTo(getTerrainHeight(out.x, out.z), 2)
          expect(isGroundLayer(nav.getNavLayer(out))).toBe(true)
        }
      }
      // The representative terrain must exercise both slope and overflow-to-ground branches.
      expect(slots.some(slot => isStairLayer(nav.getNavLayer(slot)))).toBe(true)
      expect(slots.some(slot => isGroundLayer(nav.getNavLayer(slot)))).toBe(true)

      // 3. Staggered behind leader along ramp with no duplicate coordinates
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(
            slots[i].distanceTo(slots[j]),
            `Stair slots ${i} and ${j} must not overlap`,
          ).toBeGreaterThanOrEqual(1.0)
        }
      }
    })
  })
})
