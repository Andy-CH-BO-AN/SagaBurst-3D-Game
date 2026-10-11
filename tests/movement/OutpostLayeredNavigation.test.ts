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
  isGroundLayer,
  isRampartLayer,
  isStairLayer,
  OutpostLayeredNavigation,
} from '../../src/navigation/OutpostLayeredNavigation'
import { getTerrainHeight } from '../../src/world/Terrain'

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

      // Must stay on ground, projecting destination down to terrain
      expect(result.currentLayer).toBe('ground')
      expect(result.targetLayer).toBe('ground')
      expect(result.isCrossLayer).toBe(false)
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
    it('descends left wing stair first before crossing ground to right wing stair', () => {
      const nav = new OutpostLayeredNavigation(vikingLayout)
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

      // Lateral distance between ascending and descending lanes
      expect(Math.abs(ascendingOut.x - descendingOut.x)).toBeCloseTo(0.6, 2)
    })
  })
})
