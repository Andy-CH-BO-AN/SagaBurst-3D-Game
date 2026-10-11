import * as THREE from 'three'
import {
  getTerrainHeight,
  getWalkRampHeight,
} from '../world/Terrain'
import {
  type OutpostWalkwayDeck,
  type OutpostWalkwayLayout,
  type OutpostWalkwaySide,
  type OutpostWalkwayStair,
} from '../campaign/CampaignOutpostWalkways'

export type OutpostNavLayer =
  | 'ground'
  | 'rampart_left'
  | 'rampart_right'
  | 'stair_left'
  | 'stair_right'

export type OutpostLayeredRouteStep =
  | 'direct'
  | 'ground_approach'
  | 'ascend_stair'
  | 'deck_approach'
  | 'descend_stair'
  | 'ground_cross'

export interface StairWaypoints {
  side: OutpostWalkwaySide
  stair: OutpostWalkwayStair
  deck: OutpostWalkwayDeck
  groundEntrance: THREE.Vector3
  stairBottom: THREE.Vector3
  stairTopLanding: THREE.Vector3
  deckConnection: THREE.Vector3
}

export interface OutpostLayeredMoveResult {
  target: THREE.Vector3
  isCrossLayer: boolean
  currentLayer: OutpostNavLayer
  targetLayer: OutpostNavLayer
  step: OutpostLayeredRouteStep
}

export function isRampartLayer(layer: OutpostNavLayer): boolean {
  return layer === 'rampart_left' || layer === 'rampart_right'
}

export function isStairLayer(layer: OutpostNavLayer): boolean {
  return layer === 'stair_left' || layer === 'stair_right'
}

export function isGroundLayer(layer: OutpostNavLayer): boolean {
  return layer === 'ground'
}

export function layerSide(layer: OutpostNavLayer): OutpostWalkwaySide | null {
  if (layer === 'rampart_left' || layer === 'stair_left') return -1
  if (layer === 'rampart_right' || layer === 'stair_right') return 1
  return null
}

/**
 * Determines whether a position is on the ground, on a stair ramp, or on a rampart deck.
 */
export function getOutpostNavLayer(
  pos: THREE.Vector3,
  layout: OutpostWalkwayLayout,
): OutpostNavLayer {
  // 1. Check stairs first (sloped ramp surfaces).
  for (const stair of layout.stairs) {
    const ramp = stair.ramp
    const surfaceY = getWalkRampHeight(ramp, pos.x, pos.z)
    if (surfaceY !== null) {
      if (Math.abs(pos.y - surfaceY) <= 0.85 || (pos.y >= surfaceY - 0.3 && pos.y <= surfaceY + 1.2)) {
        return stair.side < 0 ? 'stair_left' : 'stair_right'
      }
    }
  }

  // 2. Check decks (elevated flat platforms).
  for (const deck of layout.decks) {
    const slab = deck.slab
    const inSlabXZ =
      pos.x >= slab.min.x - 0.3 &&
      pos.x <= slab.max.x + 0.3 &&
      pos.z >= slab.min.z - 0.3 &&
      pos.z <= slab.max.z + 0.3

    if (inSlabXZ) {
      // Must be near the deck top surface (not on the ground 3.5m beneath it).
      if (Math.abs(pos.y - deck.topY) <= 0.85 || (pos.y >= deck.topY - 0.3 && pos.y <= deck.topY + 1.2)) {
        return deck.side < 0 ? 'rampart_left' : 'rampart_right'
      }
    }
  }

  return 'ground'
}

/**
 * Clamps a follow slot onto the safe walkable area of a rampart deck.
 * Ensures the slot sits firmly on the deck slab without hanging in midair or
 * penetrating the outer railings.
 */
export function clampFollowSlotToDeck(
  out: THREE.Vector3,
  rawPosition: THREE.Vector3,
  leaderPosition: THREE.Vector3,
  slotIndex: number,
  deck: OutpostWalkwayDeck,
): THREE.Vector3 {
  const slab = deck.slab
  const marginX = 0.6
  const marginZ = 0.55

  const minX = slab.min.x + marginX
  const maxX = slab.max.x - marginX
  const minZ = slab.min.z + marginZ
  const maxZ = slab.max.z - marginZ

  // Spread multiple followers longitudinally along X (the deck hallway).
  let targetX = rawPosition.x
  if (Math.abs(rawPosition.x - leaderPosition.x) < 0.5) {
    const side = slotIndex % 2 === 0 ? -1 : 1
    const spread = (Math.floor(slotIndex / 2) + 1) * 1.6
    targetX = leaderPosition.x + side * spread
  }

  const clampedX = THREE.MathUtils.clamp(targetX, minX, maxX)
  const clampedZ = THREE.MathUtils.clamp(rawPosition.z, minZ, maxZ)

  return out.set(clampedX, deck.topY, clampedZ)
}

export class OutpostLayeredNavigation {
  readonly layout: OutpostWalkwayLayout
  private readonly leftWaypoints: StairWaypoints
  private readonly rightWaypoints: StairWaypoints

  constructor(layout: OutpostWalkwayLayout) {
    this.layout = layout
    this.leftWaypoints = this._buildStairWaypoints(-1)
    this.rightWaypoints = this._buildStairWaypoints(1)
  }

  getWaypoints(side: OutpostWalkwaySide): StairWaypoints {
    return side < 0 ? this.leftWaypoints : this.rightWaypoints
  }

  getNavLayer(pos: THREE.Vector3): OutpostNavLayer {
    return getOutpostNavLayer(pos, this.layout)
  }

  getDeck(side: OutpostWalkwaySide): OutpostWalkwayDeck | undefined {
    return this.layout.decks.find(d => d.side === side)
  }

  getStair(side: OutpostWalkwaySide): OutpostWalkwayStair | undefined {
    return this.layout.stairs.find(s => s.side === side)
  }

  private _buildStairWaypoints(side: OutpostWalkwaySide): StairWaypoints {
    const stair = this.layout.stairs.find(s => s.side === side)!
    const deck = this.layout.decks.find(d => d.side === side)!
    const { ramp } = stair

    // Ground entrance: 1.2m outward from the ramp base onto ground terrain.
    const groundZ = ramp.startZ - ramp.dirZ * 1.2
    const groundEntrance = new THREE.Vector3(
      ramp.startX,
      getTerrainHeight(ramp.startX, groundZ),
      groundZ,
    )

    // Stair bottom: 0.6m along the ramp slope.
    const bottomZ = ramp.startZ + ramp.dirZ * 0.6
    const stairBottom = new THREE.Vector3(
      ramp.startX,
      ramp.startY + 0.2,
      bottomZ,
    )

    // Stair top landing: at the flat landing at top of stairs.
    const topZ = ramp.startZ + ramp.dirZ * (ramp.length + ramp.landing * 0.5)
    const stairTopLanding = new THREE.Vector3(
      ramp.startX,
      ramp.topY,
      topZ,
    )

    // Deck connection: 0.6m inside the deck slab from the landing.
    const deckMidZ = (deck.slab.min.z + deck.slab.max.z) * 0.5
    const deckConnection = new THREE.Vector3(
      ramp.startX,
      deck.topY,
      deckMidZ,
    )

    return {
      side,
      stair,
      deck,
      groundEntrance,
      stairBottom,
      stairTopLanding,
      deckConnection,
    }
  }

  /**
   * Resolves the immediate next navigation waypoint for an entity moving from currentPos to goalPos.
   * Handles ground <-> rampart, rampart <-> ground, and wing <-> wing traversals.
   */
  resolveMoveTarget(
    currentPos: THREE.Vector3,
    goalPos: THREE.Vector3,
    isMounted: boolean,
    out: THREE.Vector3,
  ): OutpostLayeredMoveResult {
    let targetLayer = this.getNavLayer(goalPos)

    // Mounted units (cavalry, pets, eagles) CANNOT climb stairs; their destination
    // is projected to ground level beneath/beside the rampart.
    if (isMounted) {
      if (targetLayer !== 'ground') {
        const groundY = getTerrainHeight(goalPos.x, goalPos.z)
        out.set(goalPos.x, groundY, goalPos.z)
        return {
          target: out,
          isCrossLayer: false,
          currentLayer: 'ground',
          targetLayer: 'ground',
          step: 'direct',
        }
      }
      out.copy(goalPos)
      return {
        target: out,
        isCrossLayer: false,
        currentLayer: 'ground',
        targetLayer: 'ground',
        step: 'direct',
      }
    }

    const currentLayer = this.getNavLayer(currentPos)

    // Case 1: Same layer
    if (currentLayer === targetLayer) {
      if (currentLayer === 'ground') {
        out.copy(goalPos)
        return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
      }
      if (isRampartLayer(currentLayer)) {
        const side = layerSide(currentLayer)!
        const deck = this.getDeck(side)!
        const wp = this.getWaypoints(side)
        // If near stair top landing and moving laterally along the deck,
        // route via deckConnection to stay in the open center hallway and avoid catching on rails.
        const nearStairX = Math.abs(currentPos.x - wp.stair.ramp.startX) < 1.3
        const zSign = this.layout.zSign
        const nearStairLandingZ = zSign > 0
          ? currentPos.z > wp.deckConnection.z + 0.6
          : currentPos.z < wp.deckConnection.z - 0.6
        const lateralMove = Math.abs(goalPos.x - currentPos.x) > 1.0

        if (nearStairX && nearStairLandingZ && lateralMove) {
          out.copy(wp.deckConnection)
          return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'deck_approach' }
        }

        const clampedX = THREE.MathUtils.clamp(goalPos.x, deck.slab.min.x + 0.5, deck.slab.max.x - 0.5)
        const clampedZ = THREE.MathUtils.clamp(goalPos.z, deck.slab.min.z + 0.5, deck.slab.max.z - 0.5)
        out.set(clampedX, deck.topY, clampedZ)
        return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
      }
      if (isStairLayer(currentLayer)) {
        out.copy(goalPos)
        return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
      }
    }

    // Case 2: Ground -> Rampart or Stair
    if (currentLayer === 'ground' && (isRampartLayer(targetLayer) || isStairLayer(targetLayer))) {
      const targetSide = layerSide(targetLayer)!
      const wp = this.getWaypoints(targetSide)
      const distToEntrance = Math.hypot(currentPos.x - wp.groundEntrance.x, currentPos.z - wp.groundEntrance.z)

      if (distToEntrance > 1.2) {
        // Step 2a: Move to ground entrance
        out.copy(wp.groundEntrance)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ground_approach' }
      } else {
        // Step 2b: Near entrance, aim for top landing with stair lane bias
        this._writeStairTarget(wp, true, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
      }
    }

    // Case 3: On Stair -> Rampart
    if (isStairLayer(currentLayer) && isRampartLayer(targetLayer)) {
      const stairSide = layerSide(currentLayer)!
      const targetSide = layerSide(targetLayer)!

      if (stairSide === targetSide) {
        const wp = this.getWaypoints(stairSide)
        const distToLanding = Math.hypot(currentPos.x - wp.stairTopLanding.x, currentPos.z - wp.stairTopLanding.z)
        if (distToLanding > 0.8) {
          this._writeStairTarget(wp, true, out)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
        } else {
          // Arrived at top landing, step onto deck
          out.copy(wp.deckConnection)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
        }
      } else {
        // Stair side doesn't match target wing: must descend to ground first
        const wp = this.getWaypoints(stairSide)
        this._writeStairTarget(wp, false, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }
    }

    // Case 4: Rampart -> Ground
    if (isRampartLayer(currentLayer) && targetLayer === 'ground') {
      const side = layerSide(currentLayer)!
      const wp = this.getWaypoints(side)
      const distToStairX = Math.abs(currentPos.x - wp.stair.ramp.startX)

      if (distToStairX > 1.0) {
        // Move along deck to the stair connection
        out.copy(wp.deckConnection)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
      } else {
        // Aligned with stair laterally: descend stair toward ground entrance with stair lane bias
        this._writeStairTarget(wp, false, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }
    }

    // Case 5: On Stair -> Ground
    if (isStairLayer(currentLayer) && targetLayer === 'ground') {
      const side = layerSide(currentLayer)!
      const wp = this.getWaypoints(side)
      const distToEntrance = Math.hypot(currentPos.x - wp.groundEntrance.x, currentPos.z - wp.groundEntrance.z)
      if (distToEntrance > 0.8) {
        this._writeStairTarget(wp, false, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      } else {
        out.copy(wp.groundEntrance)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }
    }

    // Case 6: Rampart Left <-> Rampart Right (Wing-to-Wing Crossing)
    if (isRampartLayer(currentLayer) && isRampartLayer(targetLayer) && currentLayer !== targetLayer) {
      // Must descend current wing's stair first
      const currentSide = layerSide(currentLayer)!
      const wp = this.getWaypoints(currentSide)
      const distToStairX = Math.abs(currentPos.x - wp.stair.ramp.startX)

      if (distToStairX > 1.0) {
        out.copy(wp.deckConnection)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
      } else {
        this._writeStairTarget(wp, false, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }
    }

    // Fallback: direct to goal
    out.copy(goalPos)
    return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
  }

  /**
   * Applies a lateral lane offset to prevent head-on traffic deadlock on the 2.2m-wide stairs.
   * Ascending units bias toward +0.3m, descending units bias toward -0.3m from stair center.
   */
  private _writeStairTarget(wp: StairWaypoints, ascending: boolean, out: THREE.Vector3): void {
    const laneOffset = ascending ? 0.3 : -0.3
    const targetZ = ascending ? wp.stairTopLanding.z : wp.groundEntrance.z
    const targetY = ascending ? wp.stairTopLanding.y : wp.groundEntrance.y
    out.set(wp.stair.ramp.startX + laneOffset, targetY, targetZ)
  }
}
