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
  clampFollowSlotToStair,
  isGroundLayer,
  isRampartLayer,
  isStairLayer,
  OutpostLayeredNavigation,
} from '../../src/navigation/OutpostLayeredNavigation'
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

  describe('Layer Identification', () => {
    it.each(['viking', 'roman'] as const)(
      'distinguishes ground, stairs, and left/right rampart decks in %s layout',
      faction => {
        const placement = faction === 'viking' ? vikingPlacement : romanPlacement
        const layout = faction === 'viking' ? vikingLayout : romanLayout
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
      },
    )
  })

  describe('Mounted Unit Ground Restriction', () => {
    it('restricts mounted units to ground when goal is on rampart', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
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

      // Phase 3: Unit on stair near landing
      const onStairTop = new THREE.Vector3(stair.ramp.startX, deck.topY, wp.stairTopLanding.z)
      const r3 = nav.resolveMoveTarget(onStairTop, goalOnDeck, false, out)
      expect(r3.step).toBe('deck_approach')
      expect(out.distanceTo(wp.deckConnection)).toBeLessThan(0.01)

      // Phase 4: Unit on deck slab
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

      // Phase 2: Unit at deck connection / stair landing
      const atTopLanding = new THREE.Vector3(stair.ramp.startX, deck.topY, wp.stairTopLanding.z)
      const r2 = nav.resolveMoveTarget(atTopLanding, goalOnGround, false, out)
      expect(r2.step).toBe('descend_stair')
      // Aims down toward ground entrance with descending lane offset (-0.3m)
      expect(out.x).toBeCloseTo(stair.ramp.startX - 0.3, 2)

      // Phase 3: Unit on ground
      const onGround = new THREE.Vector3(-36, getTerrainHeight(-36, 130), 130)
      const r3 = nav.resolveMoveTarget(onGround, goalOnGround, false, out)
      expect(r3.step).toBe('direct')
      expect(r3.isCrossLayer).toBe(false)
      expect(out.distanceTo(goalOnGround)).toBeLessThan(0.01)
    })
  })

  describe('Wing-to-Wing Crossing (Left to Right Rampart)', () => {
    it('routes continuously across elevated bridge when bridge is present', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const leftDeck = vikingLayout.decks.find(d => d.side === -1)!
      const rightDeck = vikingLayout.decks.find(d => d.side === 1)!
      const bridge = vikingLayout.bridge

      const goalOnRight = new THREE.Vector3(25, rightDeck.topY, (rightDeck.slab.min.z + rightDeck.slab.max.z) / 2)
      const startOnLeft = new THREE.Vector3(-20, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)

      const out = new THREE.Vector3()

      // Phase 1: On left deck -> routes to bridge left portal without descending
      const r1 = nav.resolveMoveTarget(startOnLeft, goalOnRight, false, out)
      expect(r1.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.min.x, 2)

      // Phase 2: Near bridge left portal -> routes across bridge
      const atLeftPortal = new THREE.Vector3(bridge.slab.min.x - 0.2, leftDeck.topY, (bridge.slab.min.z + bridge.slab.max.z) / 2)
      const r2 = nav.resolveMoveTarget(atLeftPortal, goalOnRight, false, out)
      expect(r2.step).toBe('deck_approach')
      expect(out.x).toBeGreaterThan(bridge.slab.min.x)

      // Phase 3: At bridge center -> routes to right portal
      const atCenter = new THREE.Vector3(0, bridge.topY, (bridge.slab.min.z + bridge.slab.max.z) / 2)
      const r3 = nav.resolveMoveTarget(atCenter, goalOnRight, false, out)
      expect(r3.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.max.x, 2)
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

    it('handles full circular cross-wing circuit: ground -> left stair -> left deck -> bridge -> right deck -> right stair -> ground and reverse', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
      const leftDeck = vikingLayout.decks.find(d => d.side === -1)!
      const rightDeck = vikingLayout.decks.find(d => d.side === 1)!
      const leftWp = nav.getWaypoints(-1)
      const rightWp = nav.getWaypoints(1)
      const bridge = vikingLayout.bridge!
      const out = new THREE.Vector3()

      // Part 1: Forward circuit (Ground Left -> Left Stair -> Left Deck -> Bridge -> Right Deck -> Right Stair -> Ground Right)
      // 1. From Ground Left aiming for Left Deck
      const groundLeft = new THREE.Vector3(leftWp.groundEntrance.x, leftWp.groundEntrance.y, leftWp.groundEntrance.z + 4)
      const r1 = nav.resolveMoveTarget(groundLeft, new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(r1.step).toBe('ground_approach')
      expect(out.distanceTo(leftWp.groundEntrance)).toBeLessThan(0.01)

      // 2. At left ground entrance aiming for Left Deck -> begins ascending
      const r2 = nav.resolveMoveTarget(leftWp.groundEntrance, new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(r2.step).toBe('ascend_stair')

      // 3. Ascending left stair
      const midZ = leftWp.stair.ramp.startZ + leftWp.stair.ramp.dirZ * 8
      const midY = getWalkRampHeight(leftWp.stair.ramp, leftWp.stair.ramp.startX, midZ)!
      const midLeftStair = new THREE.Vector3(leftWp.stair.ramp.startX, midY, midZ)
      const r3 = nav.resolveMoveTarget(midLeftStair, new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(r3.step).toBe('ascend_stair')

      // 4. At top of left stair
      const r4 = nav.resolveMoveTarget(leftWp.stairTopLanding, new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(r4.step).toBe('deck_approach')

      // 5. Walking left deck toward right deck (cross-wing via bridge)
      const r5 = nav.resolveMoveTarget(new THREE.Vector3(-25, leftDeck.topY, 110), new THREE.Vector3(25, rightDeck.topY, 110), false, out)
      expect(r5.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.min.x, 2)

      // 6. Walking across bridge
      const r6 = nav.resolveMoveTarget(new THREE.Vector3(0, bridge.topY, 110), new THREE.Vector3(25, rightDeck.topY, 110), false, out)
      expect(r6.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.max.x, 2)

      // 7. On right deck aiming for ground right
      const groundRight = new THREE.Vector3(rightWp.groundEntrance.x, rightWp.groundEntrance.y, rightWp.groundEntrance.z + 4)
      const r7 = nav.resolveMoveTarget(new THREE.Vector3(20, rightDeck.topY, 110), groundRight, false, out)
      expect(r7.step).toBe('deck_approach')
      expect(out.distanceTo(rightWp.deckConnection)).toBeLessThan(0.01)

      // 8. At right deck connection descending right stair
      const r8 = nav.resolveMoveTarget(rightWp.deckConnection, groundRight, false, out)
      expect(r8.step).toBe('descend_stair')

      // Part 2: Reverse circuit (Ground Right -> Right Stair -> Right Deck -> Bridge -> Left Deck -> Left Stair -> Ground Left)
      const rev1 = nav.resolveMoveTarget(groundRight, new THREE.Vector3(25, rightDeck.topY, 110), false, out)
      expect(rev1.step).toBe('ground_approach')
      expect(out.distanceTo(rightWp.groundEntrance)).toBeLessThan(0.01)

      const rev2 = nav.resolveMoveTarget(rightWp.groundEntrance, new THREE.Vector3(25, rightDeck.topY, 110), false, out)
      expect(rev2.step).toBe('ascend_stair')

      const rev3 = nav.resolveMoveTarget(new THREE.Vector3(25, rightDeck.topY, 110), new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(rev3.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.max.x, 2)

      const rev4 = nav.resolveMoveTarget(new THREE.Vector3(0, bridge.topY, 110), new THREE.Vector3(-25, leftDeck.topY, 110), false, out)
      expect(rev4.step).toBe('deck_approach')
      expect(out.x).toBeCloseTo(bridge.slab.min.x, 2)

      const rev5 = nav.resolveMoveTarget(new THREE.Vector3(-20, leftDeck.topY, 110), groundLeft, false, out)
      expect(rev5.step).toBe('deck_approach')
      expect(out.distanceTo(leftWp.deckConnection)).toBeLessThan(0.01)

      const rev6 = nav.resolveMoveTarget(leftWp.deckConnection, groundLeft, false, out)
      expect(rev6.step).toBe('descend_stair')
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
    it.each(['viking', 'roman'] as const)(
      'resolves deck_left -> stair_left via deckConnection then down slope in %s layout',
      faction => {
        const layout = faction === 'viking' ? vikingLayout : romanLayout
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
      },
    )

    it.each(['viking', 'roman'] as const)(
      'resolves deck_left -> stair_right via deckConnection, down left stair, then to right stair entrance in %s layout',
      faction => {
        const layout = faction === 'viking' ? vikingLayout : romanLayout
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
      },
    )

    it.each(['viking', 'roman'] as const)(
      'resolves stair_left -> stair_right by descending to ground first before crossing in %s layout',
      faction => {
        const layout = faction === 'viking' ? vikingLayout : romanLayout
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
      },
    )
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
    it.each(['viking', 'roman'] as const)(
      'allocates bodies >= 1.0m apart for slots 0..29 on %s decks with leader at various positions including boundaries',
      faction => {
        const layout = faction === 'viking' ? vikingLayout : romanLayout
        for (const side of [-1, 1] as const) {
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
                  `Slots ${i} and ${j} on ${faction} side=${side} deck (leader x=${leaderPos.x.toFixed(1)}) must be at least 1.0m apart to avoid body push collision, got ${planarDist.toFixed(3)}m (slot ${i}: ${slots[i].x.toFixed(2)},${slots[i].z.toFixed(2)} vs slot ${j}: ${slots[j].x.toFixed(2)},${slots[j].z.toFixed(2)})`,
                ).toBeGreaterThanOrEqual(1.0)
              }
            }
          }
        }
      },
    )
  })

  describe('Mid-Stair Follow Slot Safe Corridor Projection (P2 Review)', () => {
    it.each(['viking', 'roman'] as const)(
      'projects follow slots strictly inside stair ramp corridor with proper slope height in %s layout',
      faction => {
        const layout = faction === 'viking' ? vikingLayout : romanLayout
        for (const side of [-1, 1] as const) {
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

          // 3. Staggered behind leader along ramp with no duplicate coordinates
          for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
              expect(
                slots[i].distanceTo(slots[j]),
                `Stair slots ${i} and ${j} must not overlap`,
              ).toBeGreaterThanOrEqual(1.0)
            }
          }
        }
      },
    )
  })
})
