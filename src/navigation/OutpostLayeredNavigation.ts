import { AvailableBreachEntrances, type BreachEntrance } from './AvailableBreachEntrances'
import * as THREE from 'three'
import {
  getTerrainHeight,
  getWalkRampHeight,
} from '../world/Terrain'
import {
  type OutpostWalkwayBridge,
  type OutpostWalkwayDeck,
  type OutpostWalkwayLayout,
  type OutpostWalkwaySide,
  type OutpostWalkwayStair,
} from '../campaign/CampaignOutpostWalkways'

export type OutpostNavLayer =
  | 'ground'
  | 'siege_left'
  | 'siege_right'
  | 'rampart_left'
  | 'rampart_right'
  | 'rampart_gate'
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
  return layer === 'rampart_left' || layer === 'rampart_right' || layer === 'rampart_gate'
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

const BRIDGE_LAYER_MARGIN = 0.3

/**
 * Determines whether a position is on the ground, on a stair ramp, on a rampart deck,
 * or on the gatehouse bridge connecting the two ramparts.
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

  // 2. Check bridge (elevated gatehouse span connecting the left and right decks).
  if (layout.bridge) {
    const bridge = layout.bridge
    const slab = bridge.slab
    const inSlabXZ =
      pos.x >= slab.min.x - BRIDGE_LAYER_MARGIN &&
      pos.x <= slab.max.x + BRIDGE_LAYER_MARGIN &&
      pos.z >= slab.min.z - 0.3 &&
      pos.z <= slab.max.z + 0.3

    if (inSlabXZ) {
      const surfaceY = bridge.walkSurface
        ? (getWalkRampHeight(bridge.walkSurface, pos.x, pos.z) ?? bridge.topY)
        : bridge.topY
      if (Math.abs(pos.y - surfaceY) <= 0.85 || (pos.y >= surfaceY - 0.3 && pos.y <= surfaceY + 1.2)) {
        return 'rampart_gate'
      }
    }
  }

  // 3. Check decks (elevated flat platforms).
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
 * Gate followers occupy one continuous row across the bridge and both wings.
 * The row stays near the front parapet, leaving the courtyard side for traffic.
 * Leader-relative X offsets keep slot identities stable during movement/turning.
 */
export function clampFollowSlotToBridge(
  out: THREE.Vector3,
  leaderPosition: THREE.Vector3,
  slotIndex: number,
  layout: OutpostWalkwayLayout,
): THREE.Vector3 {
  const left = layout.decks.find(d => d.side === -1)!
  const right = layout.decks.find(d => d.side === 1)!
  const bridge = layout.bridge
  const spacing = 1.6
  const leaderX = THREE.MathUtils.clamp(leaderPosition.x, bridge.slab.min.x, bridge.slab.max.x)
  const maxNeg = Math.floor((leaderX - (left.slab.min.x + 0.6)) / spacing)
  const maxPos = Math.floor((right.slab.max.x - 0.6 - leaderX) / spacing)
  const index = Math.max(0, Math.floor(slotIndex))
  const capacity = maxNeg + maxPos

  if (index >= capacity) {
    // Exhausted both wings: unique courtyard queues reachable through each stair.
    const overflow = index - capacity
    const side = overflow % 2 === 0 ? -1 : 1
    const stair = layout.stairs.find(s => s.side === side)!
    const rank = Math.floor(overflow / 2)
    const x = stair.ramp.startX + (rank % 2 === 0 ? -0.7 : 0.7)
    const z = stair.ramp.startZ - stair.ramp.dirZ * (2.2 + Math.floor(rank / 2) * 1.4)
    return out.set(x, getTerrainHeight(x, z), z)
  }

  let neg = 0
  let pos = 0
  let x = leaderX
  for (let i = 0; i <= index; i++) {
    if ((i % 2 === 0 && neg < maxNeg) || pos >= maxPos) {
      x = leaderX - ++neg * spacing
    } else {
      x = leaderX + ++pos * spacing
    }
  }
  const deck = x < bridge.slab.min.x ? left : x > bridge.slab.max.x ? right : bridge
  // 0.9m from the front edge clears 0.25m timber plus the 0.5m body radius.
  const z = layout.zSign > 0 ? deck.slab.min.z + 0.9 : deck.slab.max.z - 0.9
  const y = getWalkRampHeight(deck.walkSurface, x, z) ?? deck.topY
  return out.set(x, y, z)
}

/**
 * Clamps a follow slot onto the safe walkable area of a rampart deck.
 * Ensures the slot sits firmly on the deck slab without hanging in midair or
 * penetrating the outer railings.
 */
/**
 * Clamps a follow slot onto the safe walkable area of a rampart deck.
 * Ensures the slot sits firmly on the deck slab without hanging in midair or
 * penetrating the outer railings. When the primary row along X is exhausted,
 * seamlessly allocates into a secondary lateral sub-row or an explicit ground
 * waiting queue, ensuring non-overlapping unique positions for all slots 0..29.
 */
export function clampFollowSlotToDeck(
  out: THREE.Vector3,
  _rawPosition: THREE.Vector3,
  leaderPosition: THREE.Vector3,
  slotIndex: number,
  deck: OutpostWalkwayDeck | OutpostWalkwayBridge,
  leaderYaw?: number,
  stair?: OutpostWalkwayStair,
): THREE.Vector3 {
  const slab = deck.slab
  const marginX = 0.6
  const marginZ = 0.55

  const minX = slab.min.x + marginX
  const maxX = slab.max.x - marginX
  const minZ = slab.min.z + marginZ
  const maxZ = slab.max.z - marginZ

  const clampedLeaderX = THREE.MathUtils.clamp(leaderPosition.x, minX, maxX)
  const deckMidZ = (slab.min.z + slab.max.z) * 0.5

  const SLOT_SPACING = 1.6

  // Available room along X in both directions from clamped leader
  const roomNeg = Math.max(0, clampedLeaderX - minX)
  const roomPos = Math.max(0, maxX - clampedLeaderX)
  const maxNeg = Math.floor(roomNeg / SLOT_SPACING)
  const maxPos = Math.floor(roomPos / SLOT_SPACING)
  const singleRowCapacity = maxNeg + maxPos

  // Determine preferred trailing side along X based on leader facing.
  let preferredSide: -1 | 1 = -1
  if (leaderYaw !== undefined && Math.abs(Math.sin(leaderYaw)) > 0.3) {
    preferredSide = Math.sin(leaderYaw) > 0 ? -1 : 1
  }

  const safeIndex = Math.max(0, Math.floor(slotIndex))

  // Tier 0 (primary row along deck at -0.55m) and Tier 1 (secondary row along deck at +0.55m).
  // Within each tier, followers have distinct X coordinates spaced by 1.6m.
  // Across tiers, the Z separation is strictly 1.10m >= 1.0m, ensuring body collision clearance (2 * 0.5m radius)
  // even if X coordinates align or clamp near boundaries.
  if (singleRowCapacity > 0) {
    const tier = Math.floor(safeIndex / singleRowCapacity)
    const tierIndex = safeIndex % singleRowCapacity

    if (tier < 2) {
      let negCount = 0
      let posCount = 0
      let targetOffsetX = 0

      for (let i = 0; i <= tierIndex; i++) {
        const pref: -1 | 1 = (i % 2 === 0) ? preferredSide : (preferredSide === -1 ? 1 : -1)
        if (pref < 0) {
          if (negCount < maxNeg) {
            negCount++
            targetOffsetX = -negCount * SLOT_SPACING
          } else {
            posCount++
            targetOffsetX = posCount * SLOT_SPACING
          }
        } else {
          if (posCount < maxPos) {
            posCount++
            targetOffsetX = posCount * SLOT_SPACING
          } else {
            negCount++
            targetOffsetX = -negCount * SLOT_SPACING
          }
        }
      }

      // In Tier 1, offset by 0.8m along X if possible for diagonal checkerboard separation
      const staggerX = tier === 1
        ? (clampedLeaderX + targetOffsetX + 0.8 <= maxX ? 0.8 : -0.8)
        : 0
      const targetX = THREE.MathUtils.clamp(clampedLeaderX + targetOffsetX + staggerX, minX, maxX)

      // Tier 0 uses -0.55m, Tier 1 uses +0.55m from deckMidZ.
      // Every pair of slots across tiers has at least 1.10m Z separation (>= 1.0m body diameter).
      const staggerZ = tier === 0 ? -0.55 : 0.55
      const targetZ = THREE.MathUtils.clamp(deckMidZ + staggerZ, minZ, maxZ)

      const surfaceY = ('walkSurface' in deck && deck.walkSurface)
        ? (getWalkRampHeight(deck.walkSurface, targetX, targetZ) ?? deck.topY)
        : deck.topY

      return out.set(targetX, surfaceY, targetZ)
    }
  }

  // Tier >= 2: Total deck capacity exhausted. Provide explicit standby waiting queue at stair foot.
  const overflowIndex = safeIndex - 2 * singleRowCapacity
  if (stair) {
    const ramp = stair.ramp
    const groundZ = ramp.startZ - ramp.dirZ * (1.5 + Math.floor(overflowIndex / 2) * 1.4)
    const groundX = ramp.startX + (overflowIndex % 2 === 0 ? -0.7 : 0.7)
    const groundY = getTerrainHeight(groundX, groundZ)
    return out.set(groundX, groundY, groundZ)
  }

  const fallbackX = THREE.MathUtils.clamp(minX + (overflowIndex * 1.6) % (maxX - minX), minX, maxX)
  const fallbackZ = overflowIndex % 2 === 0 ? minZ : maxZ
  const fallbackY = ('walkSurface' in deck && deck.walkSurface)
    ? (getWalkRampHeight(deck.walkSurface, fallbackX, fallbackZ) ?? deck.topY)
    : deck.topY
  return out.set(fallbackX, fallbackY, fallbackZ)
}

/**
 * Clamps a follow slot onto the safe walkable area of a stair ramp.
 * Projects slot onto the stair ramp with width clamping, longitudinal spacing along dirZ,
 * and height interpolated on the ramp slope. If the slot extends beyond the stair foot
 * (ground side), it sits at the ground entrance; if beyond the top landing, it sits on the deck connection.
 */
export function clampFollowSlotToStair(
  out: THREE.Vector3,
  leaderPosition: THREE.Vector3,
  slotIndex: number,
  stair: OutpostWalkwayStair,
  deck?: OutpostWalkwayDeck,
  leaderYaw?: number,
): THREE.Vector3 {
  const ramp = stair.ramp
  const safeIndex = Math.max(0, Math.floor(slotIndex))

  // Lateral X: clamp to stair ramp width margin
  // stairHalfWidth is typically 1.1m; keep within [ramp.startX - 0.7, ramp.startX + 0.7]
  const lateralMargin = 0.7
  const staggerX = safeIndex % 2 === 0 ? -0.25 : 0.25
  const targetX = THREE.MathUtils.clamp(
    ramp.startX + staggerX,
    ramp.startX - lateralMargin,
    ramp.startX + lateralMargin,
  )

  // Trailing direction along ramp Z:
  // By default, followers trail downhill behind the leader (in direction -ramp.dirZ).
  // If leader is advancing downhill (facing along -ramp.dirZ), followers trail uphill behind leader (+ramp.dirZ).
  let trailDirZ = -ramp.dirZ
  if (leaderYaw !== undefined) {
    const facingZ = Math.cos(leaderYaw)
    if (facingZ * (-ramp.dirZ) > 0.5) {
      trailDirZ = ramp.dirZ
    }
  }

  // Stagger slot along stair length behind leader
  const trailDistance = 1.2 + safeIndex * 1.4
  const slotZ = leaderPosition.z + trailDirZ * trailDistance

  // Calculate distance along ramp from ramp start (low end):
  const along = (slotZ - ramp.startZ) * ramp.dirZ

  // 1. Beyond stair foot (ground side):
  if (along < 0) {
    const groundY = getTerrainHeight(targetX, slotZ)
    return out.set(targetX, groundY, slotZ)
  }

  // 2. Beyond top landing (deck side):
  if (along > ramp.length + ramp.landing) {
    if (deck) {
      const deckMidZ = (deck.slab.min.z + deck.slab.max.z) * 0.5
      return out.set(targetX, deck.topY, deckMidZ)
    }
    return out.set(targetX, ramp.topY, ramp.startZ + ramp.dirZ * (ramp.length + ramp.landing))
  }

  // 3. On stair ramp slope or top landing:
  let slotY = ramp.topY
  if (along < ramp.length) {
    const t = along / ramp.length
    slotY = ramp.startY + t * (ramp.topY - ramp.startY)
  }

  return out.set(targetX, slotY, slotZ)
}

export class OutpostLayeredNavigation {
  readonly entrances = new AvailableBreachEntrances()
  private readonly mountedFollowDirections = new WeakMap<object, -1 | 1>()
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
    const layer = getOutpostNavLayer(pos, this.layout)
    if (layer !== 'ground') return layer
    for (const entry of this.entrances.entries.values()) {
      if (!entry.walkable || !entry.surface) continue
      const height = getWalkRampHeight(entry.surface, pos.x, pos.z)
      if (height !== null && Math.abs(pos.y - height) <= .85) return entry.side === -1 ? 'siege_left' : 'siege_right'
      const minZ = Math.min(entry.position.z, entry.exit.z), maxZ = Math.max(entry.position.z, entry.exit.z)
      if (Math.abs(pos.x - entry.position.x) <= entry.surface.halfWidth && pos.z >= minZ && pos.z <= maxZ
        && Math.abs(pos.y - entry.exit.y) <= .85) return entry.side === -1 ? 'siege_left' : 'siege_right'
    }
    return layer
  }

  getDeck(side: OutpostWalkwaySide): OutpostWalkwayDeck | undefined {
    return this.layout.decks.find(d => d.side === side)
  }

  getStair(side: OutpostWalkwaySide): OutpostWalkwayStair | undefined {
    return this.layout.stairs.find(s => s.side === side)
  }

  private _atStairEntrance(position: THREE.Vector3, wp: StairWaypoints): boolean {
    if (Math.hypot(position.x - wp.groundEntrance.x, position.z - wp.groundEntrance.z) <= 2.2) return true
    const ramp = wp.stair.ramp
    const along = (position.z - ramp.startZ) * ramp.dirZ
    // A walker already inside the safe foot corridor must enter the stair,
    // even when lateral offset places it just outside the circular approach
    // threshold. Ground A* cannot route it out of the stair's inflated cell.
    return Math.abs(position.x - ramp.startX) <= ramp.halfWidth - 0.5
      && along >= -2.2 && along <= 0.6
  }

  private _buildStairWaypoints(side: OutpostWalkwaySide): StairWaypoints {
    const stair = this.layout.stairs.find(s => s.side === side)!
    const deck = this.layout.decks.find(d => d.side === side)!
    const { ramp } = stair

    // Ground entrance: 2.2m outward from the ramp base onto ground terrain.
    // Keeps waypoint safely outside the 2.0m navigation grid discretization cell of the stair base obstacle.
    const groundZ = ramp.startZ - ramp.dirZ * 2.2
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

  /** Body-sized single file shared by mounted Follow and its initial assignment. */
  clampMountedFollow(out: THREE.Vector3, leader: THREE.Vector3, slot: number, leaderIdentity: object = leader): void {
    const left = this.getDeck(-1)!, right = this.getDeck(1)!
    const minX = left.slab.min.x + 1.2, maxX = right.slab.max.x - 1.2
    const spacing = 3.2
    const anchor = THREE.MathUtils.clamp(leader.x, minX, maxX)
    // Keep the queue's side across the bridge midpoint. Only an outer boundary
    // can reverse it; the opposite boundary is the hysteresis reset. Key by the
    // actual leader, not each follower's independently smoothed position.
    let direction = this.mountedFollowDirections.get(leaderIdentity)
      ?? (anchor > (minX + maxX) / 2 ? -1 : 1)
    if (anchor + spacing > maxX) direction = -1
    else if (anchor - spacing < minX) direction = 1
    this.mountedFollowDirections.set(leaderIdentity, direction)
    const capacity = Math.floor((direction < 0 ? anchor - minX : maxX - anchor) / spacing)
    if (slot >= capacity) {
      const entrance = [...this.entrances.entries.values()].find(entry => entry.walkable && entry.mounted && entry.surface)
      if (entrance) {
        out.copy(entrance.approach)
        out.z -= this.layout.zSign * (slot - capacity + 1) * spacing
        out.y = getTerrainHeight(out.x, out.z)
      }
      return
    }
    const x = anchor + direction * (slot + 1) * spacing
    const deck = x < this.layout.bridge.slab.min.x ? left : x > this.layout.bridge.slab.max.x ? right : this.layout.bridge
    const z = (deck.slab.min.z + deck.slab.max.z) / 2
    out.set(x, getWalkRampHeight(deck.walkSurface, x, z) ?? deck.topY, z)
  }

  /** Siege connections are opt-in; the original interior stairs remain foot-only. */
  needsSiegeRoute(current: THREE.Vector3, goal: THREE.Vector3): boolean {
    if (!this.entrances.hasMountedRamp) return false
    const currentLayer = this.getNavLayer(current)
    const goalLayer = this.getNavLayer(goal)
    if (currentLayer.startsWith('siege_') || goalLayer.startsWith('siege_')) return true
    const frontZ = this.layout.bridge.walkSurface.startZ - this.layout.zSign * 1.6
    return this.entrances.hasMountedRamp && ((current.z - frontZ) * this.layout.zSign < 0
      && ((goal.z - frontZ) * this.layout.zSign >= 0 || isRampartLayer(goalLayer)))
  }

  private siegeRoute(current: THREE.Vector3, goal: THREE.Vector3, mounted: boolean,
    out: THREE.Vector3, preferred?: string | null): OutpostLayeredMoveResult | null {
    if (!this.entrances.hasMountedRamp) return null
    const currentLayer = this.getNavLayer(current), targetLayer = this.getNavLayer(goal)
    const frontZ = this.layout.bridge.walkSurface.startZ - this.layout.zSign * 1.6
    const outside = (point: THREE.Vector3): boolean => (point.z - frontZ) * this.layout.zSign < -.3
    const preferredEntry = preferred ? this.entrances.entries.get(preferred) : undefined
    const chosen = preferredEntry?.walkable ? preferredEntry : undefined
    // A valid foot entrance still reaches ramparts via the interior stairs. Only
    // mounted actors need a different connection because those stairs are foot-only.
    if (!mounted && currentLayer === 'ground' && chosen && !chosen.surface
      && !targetLayer.startsWith('siege_')) return null
    const ramps = [...this.entrances.entries.values()].filter(e => e.walkable && e.surface && (!mounted || e.mounted))
    if (!ramps.length) return null
    let entry: BreachEntrance | undefined
    if (currentLayer.startsWith('siege_')) entry = ramps.find(e => e.side === (currentLayer === 'siege_left' ? -1 : 1))
    if (!entry && chosen?.walkable && chosen.surface) entry = chosen
    if (!entry) entry = ramps.reduce((a, b) => current.distanceToSquared(a.exit) <= current.distanceToSquared(b.exit) ? a : b)
    const result = (step: OutpostLayeredRouteStep): OutpostLayeredMoveResult => ({ target: out, currentLayer, targetLayer, isCrossLayer: true, step })
    // Siege ramps reach the deck, not the courtyard. Once mounted actors are
    // back on ground, hand the final ground goal to A* (and its physical gate
    // collision), even if the actor's preferred assault entrance is a ramp.
    // Never ascend again merely because that ground goal is inside the wall.
    if (mounted && currentLayer === 'ground' && targetLayer === 'ground') {
      if (outside(current) && !outside(goal)) {
        const groundEntries = [...this.entrances.entries.values()].filter(e => e.walkable && e.mounted && !e.surface)
        const groundEntry = chosen && groundEntries.includes(chosen) ? chosen : groundEntries.reduce<BreachEntrance | undefined>(
          (best, candidate) => !best || current.distanceToSquared(candidate.approach) < current.distanceToSquared(best.approach) ? candidate : best, undefined)
        const ramp = entry.surface!
        const along = (current.z - ramp.startZ) * ramp.dirZ
        // Clear the low end with the whole mounted body before turning. Ground
        // A* treats this elevated structure as passable and must not lead the
        // rider straight back across its ramp/rails while leaving the surface.
        if (Math.abs(current.x - ramp.startX) < ramp.halfWidth + 1.2 && along > -6 && along < 1) {
          if (along > -2.5) {
            out.set(ramp.startX, ramp.startY, ramp.startZ - ramp.dirZ * 3)
            return result('descend_stair')
          }
          if (groundEntry) {
            const side = groundEntry.approach.x < ramp.startX ? -1 : 1
            out.set(ramp.startX + side * (ramp.halfWidth + 1.4), current.y, ramp.startZ - ramp.dirZ * 3)
            return result('ground_approach')
          }
        }
        if (!groundEntry) out.copy(current) // No physical ground breach: wait safely outside.
        else {
          const dx = groundEntry.exit.x - groundEntry.approach.x, dz = groundEntry.exit.z - groundEntry.approach.z
          const length = Math.hypot(dx, dz)
          const x = current.x - groundEntry.approach.x, z = current.z - groundEntry.approach.z
          const lateral = length > 0 ? Math.abs(x * dz - z * dx) / length : 0
          const progress = length > 0 ? (x * dx + z * dz) / length : 0
          out.copy(lateral > 1 || progress < -1 ? groundEntry.approach : groundEntry.exit)
        }
        return result('ground_approach')
      }
      out.copy(goal)
      return result('ground_approach')
    }
    const ramp = entry.surface!
    const ground = new THREE.Vector3(ramp.startX, ramp.startY, ramp.startZ)
    const onRamp = currentLayer.startsWith('siege_')
    const descend = targetLayer === 'ground' && (mounted || outside(goal))
    if (onRamp) {
      out.copy(descend ? entry.approach : entry.exit)
      if (descend && Math.hypot(current.x - ground.x, current.z - ground.z) < 1) out.copy(entry.approach)
      return result(descend ? 'descend_stair' : 'ascend_stair')
    }
    if (isRampartLayer(currentLayer) && descend) {
      // After aligning with the portal, keep moving outward while still within
      // the deck's layer tolerance. A radial check would send the actor back to
      // the portal as soon as it moved .7m down the bridge.
      if (Math.abs(current.x - entry.exit.x) > .7 || (current.z - entry.exit.z) * ramp.dirZ > .7) {
        out.copy(entry.exit); return result('deck_approach')
      }
      out.copy(ground); return result('descend_stair')
    }
    if (currentLayer === 'ground' && (isRampartLayer(targetLayer) || targetLayer.startsWith('siege_')
      || outside(current) && !outside(goal) && (!chosen || chosen.surface))) {
      if (Math.hypot(current.x - entry.approach.x, current.z - entry.approach.z) > 2.4) {
        out.copy(entry.approach); return result('ground_approach')
      }
      out.set(ramp.startX, ramp.startY, ramp.startZ + ramp.dirZ * 1.2)
      return result('ascend_stair')
    }
    return null
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
    preferredEntrance?: string | null,
  ): OutpostLayeredMoveResult {
    const siege = this.siegeRoute(currentPos, goalPos, isMounted, out, preferredEntrance)
    if (siege) return siege
    let targetLayer = this.getNavLayer(goalPos)

    // Mounted units (cavalry, pets, eagles) CANNOT climb stairs; their destination
    // is projected to ground level beneath/beside the rampart and must be reached via ground navigation.
    if (isMounted && !(this.entrances.hasMountedRamp && isRampartLayer(this.getNavLayer(currentPos)) && isRampartLayer(targetLayer))) {
      if (targetLayer !== 'ground') {
        const groundY = getTerrainHeight(goalPos.x, goalPos.z)
        out.set(goalPos.x, groundY, goalPos.z)
        return {
          target: out,
          isCrossLayer: true,
          currentLayer: 'ground',
          targetLayer,
          step: 'ground_approach',
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

    // Case 1: Both are Rampart layers (rampart_left, rampart_right, rampart_gate)
    if (isRampartLayer(currentLayer) && isRampartLayer(targetLayer)) {
      if (this.layout.bridge) {
        const bridge = this.layout.bridge
        const leftDeck = this.getDeck(-1)!
        const rightDeck = this.getDeck(1)!
        const corridorMidZ = (bridge.slab.min.z + bridge.slab.max.z) * 0.5
        const bridgeMidY = bridge.walkSurface
          ? (getWalkRampHeight(bridge.walkSurface, 0, corridorMidZ) ?? bridge.topY)
          : bridge.topY
        const leftPortal = new THREE.Vector3(bridge.slab.min.x, leftDeck.topY, corridorMidZ)
        const bridgeCenter = new THREE.Vector3(0, bridgeMidY, corridorMidZ)
        const rightPortal = new THREE.Vector3(bridge.slab.max.x, rightDeck.topY, corridorMidZ)

        // 1a: Same rampart section
        if (currentLayer === targetLayer) {
          if (currentLayer === 'rampart_gate') {
            const clampedX = THREE.MathUtils.clamp(goalPos.x, bridge.slab.min.x + 0.5, bridge.slab.max.x - 0.5)
            const clampedZ = THREE.MathUtils.clamp(goalPos.z, bridge.slab.min.z + 0.5, bridge.slab.max.z - 0.5)
            const clampedY = bridge.walkSurface
              ? (getWalkRampHeight(bridge.walkSurface, clampedX, clampedZ) ?? bridge.topY)
              : bridge.topY
            out.set(clampedX, clampedY, clampedZ)
            return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
          }

          const side = layerSide(currentLayer)!
          const deck = this.getDeck(side)!
          const wp = this.getWaypoints(side)
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

        // 1b: Rampart Left <-> Rampart Gate
        if (currentLayer === 'rampart_left' && targetLayer === 'rampart_gate') {
          if (currentPos.x < bridge.slab.min.x - 0.4) {
            out.copy(leftPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          }
          const clampedX = THREE.MathUtils.clamp(goalPos.x, bridge.slab.min.x + 0.5, bridge.slab.max.x - 0.5)
          const clampedZ = THREE.MathUtils.clamp(goalPos.z, bridge.slab.min.z + 0.5, bridge.slab.max.z - 0.5)
          const clampedY = bridge.walkSurface
            ? (getWalkRampHeight(bridge.walkSurface, clampedX, clampedZ) ?? bridge.topY)
            : bridge.topY
          out.set(clampedX, clampedY, clampedZ)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
        }

        if (currentLayer === 'rampart_gate' && targetLayer === 'rampart_left') {
          if (currentPos.x > bridge.slab.min.x + 0.4) {
            out.copy(leftPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          }
          const clampedX = THREE.MathUtils.clamp(goalPos.x, leftDeck.slab.min.x + 0.5, leftDeck.slab.max.x - 0.5)
          const clampedZ = THREE.MathUtils.clamp(goalPos.z, leftDeck.slab.min.z + 0.5, leftDeck.slab.max.z - 0.5)
          out.set(clampedX, leftDeck.topY, clampedZ)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
        }

        // 1c: Rampart Right <-> Rampart Gate
        if (currentLayer === 'rampart_right' && targetLayer === 'rampart_gate') {
          if (currentPos.x > bridge.slab.max.x + 0.4) {
            out.copy(rightPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          }
          const clampedX = THREE.MathUtils.clamp(goalPos.x, bridge.slab.min.x + 0.5, bridge.slab.max.x - 0.5)
          const clampedZ = THREE.MathUtils.clamp(goalPos.z, bridge.slab.min.z + 0.5, bridge.slab.max.z - 0.5)
          const clampedY = bridge.walkSurface
            ? (getWalkRampHeight(bridge.walkSurface, clampedX, clampedZ) ?? bridge.topY)
            : bridge.topY
          out.set(clampedX, clampedY, clampedZ)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
        }

        if (currentLayer === 'rampart_gate' && targetLayer === 'rampart_right') {
          if (currentPos.x < bridge.slab.max.x - 0.4) {
            out.copy(rightPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          }
          const clampedX = THREE.MathUtils.clamp(goalPos.x, rightDeck.slab.min.x + 0.5, rightDeck.slab.max.x - 0.5)
          const clampedZ = THREE.MathUtils.clamp(goalPos.z, rightDeck.slab.min.z + 0.5, rightDeck.slab.max.z - 0.5)
          out.set(clampedX, rightDeck.topY, clampedZ)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
        }

        // 1d: Rampart Left <-> Rampart Right (Direct elevated bridge traversal)
        if (currentLayer === 'rampart_left' && targetLayer === 'rampart_right') {
          if (currentPos.x < bridge.slab.min.x - 0.4) {
            out.copy(leftPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else if (currentPos.x < 0) {
            out.copy(bridgeCenter)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else if (currentPos.x < bridge.slab.max.x + 0.4) {
            out.copy(rightPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else {
            const clampedX = THREE.MathUtils.clamp(goalPos.x, rightDeck.slab.min.x + 0.5, rightDeck.slab.max.x - 0.5)
            const clampedZ = THREE.MathUtils.clamp(goalPos.z, rightDeck.slab.min.z + 0.5, rightDeck.slab.max.z - 0.5)
            out.set(clampedX, rightDeck.topY, clampedZ)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
          }
        }

        if (currentLayer === 'rampart_right' && targetLayer === 'rampart_left') {
          if (currentPos.x > bridge.slab.max.x + 0.4) {
            out.copy(rightPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else if (currentPos.x > 0) {
            out.copy(bridgeCenter)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else if (currentPos.x > bridge.slab.min.x - 0.4) {
            out.copy(leftPortal)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
          } else {
            const clampedX = THREE.MathUtils.clamp(goalPos.x, leftDeck.slab.min.x + 0.5, leftDeck.slab.max.x - 0.5)
            const clampedZ = THREE.MathUtils.clamp(goalPos.z, leftDeck.slab.min.z + 0.5, leftDeck.slab.max.z - 0.5)
            out.set(clampedX, leftDeck.topY, clampedZ)
            return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'direct' }
          }
        }
      }
    }

    // Case 2: Rampart Gate -> Ground or Stair (Must NOT leap off bridge; route to nearest stair)
    if (currentLayer === 'rampart_gate') {
      const bridge = this.layout.bridge!
      const targetSide: OutpostWalkwaySide =
        targetLayer === 'stair_left' || (targetLayer !== 'stair_right' && currentPos.x < 0) ? -1 : 1
      const deck = this.getDeck(targetSide)!
      const corridorMidZ = (bridge.slab.min.z + bridge.slab.max.z) * 0.5
      const portal = targetSide < 0
        ? new THREE.Vector3(bridge.slab.min.x - BRIDGE_LAYER_MARGIN - 0.6, deck.topY, corridorMidZ)
        : new THREE.Vector3(bridge.slab.max.x + BRIDGE_LAYER_MARGIN + 0.6, deck.topY, corridorMidZ)
      out.copy(portal)
      return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
    }

    // Case 3: Ground -> Rampart Gate (Ascend nearest stair to deck, then bridge)
    if (currentLayer === 'ground' && targetLayer === 'rampart_gate') {
      const targetSide: OutpostWalkwaySide = (goalPos.x < 0 || currentPos.x < 0) ? -1 : 1
      const wp = this.getWaypoints(targetSide)
      if (!this._atStairEntrance(currentPos, wp)) {
        out.copy(wp.groundEntrance)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ground_approach' }
      } else {
        this._writeStairTarget(wp, true, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
      }
    }

    // Case 4: Stair Ramp -> Rampart Gate (Ascend stair to deck)
    if (isStairLayer(currentLayer) && targetLayer === 'rampart_gate') {
      const stairSide = layerSide(currentLayer)!
      const wp = this.getWaypoints(stairSide)
      const distToLanding = Math.hypot(currentPos.x - wp.stairTopLanding.x, currentPos.z - wp.stairTopLanding.z)
      if (distToLanding > 0.8) {
        this._writeStairTarget(wp, true, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
      } else {
        out.copy(wp.deckConnection)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
      }
    }


    // Case 6: Same layer (ground or stair)
    if (currentLayer === targetLayer) {
      out.copy(goalPos)
      return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
    }

    // Case 7: Ground -> Rampart Deck or Stair
    if (currentLayer === 'ground' && (isRampartLayer(targetLayer) || isStairLayer(targetLayer))) {
      const targetSide = layerSide(targetLayer) ?? ((goalPos.x < 0 || currentPos.x < 0) ? -1 : 1)
      const wp = this.getWaypoints(targetSide)
      if (!this._atStairEntrance(currentPos, wp)) {
        out.copy(wp.groundEntrance)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ground_approach' }
      } else {
        this._writeStairTarget(wp, true, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
      }
    }

    // Case 8: Rampart Deck -> Ground or Same-Side Stair
    if (isRampartLayer(currentLayer)) {
      const currentSide = layerSide(currentLayer) ?? (currentPos.x < 0 ? -1 : 1)
      const wp = this.getWaypoints(currentSide)
      const distToStairX = Math.abs(currentPos.x - wp.stair.ramp.startX)

      // Step 8a: Walk along elevated deck corridor to stair connection first
      if (distToStairX > 1.0) {
        out.copy(wp.deckConnection)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
      }

      // Step 8b: At stair top landing:
      // If target is on the SAME stair ramp, descend stair aiming directly toward target on stair
      if (isStairLayer(targetLayer) && layerSide(targetLayer) === currentSide) {
        out.set(wp.stair.ramp.startX - 0.3, goalPos.y, goalPos.z)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }

      // If target is ground or opposite stair, descend stair to ground entrance
      this._writeStairTarget(wp, false, out)
      return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
    }

    // Case 9: Stair Ramp -> Other Layers (Same-side rampart, ground, opposite rampart, or opposite stair)
    if (isStairLayer(currentLayer)) {
      const currentSide = layerSide(currentLayer)!
      const wp = this.getWaypoints(currentSide)

      // Target is on the SAME side rampart deck -> ascend toward top landing / deck connection
      if (isRampartLayer(targetLayer) && layerSide(targetLayer) === currentSide) {
        const distToLanding = Math.hypot(currentPos.x - wp.stairTopLanding.x, currentPos.z - wp.stairTopLanding.z)
        if (distToLanding > 0.8) {
          this._writeStairTarget(wp, true, out)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ascend_stair' }
        } else {
          out.copy(wp.deckConnection)
          return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'deck_approach' }
        }
      }

      // Target is ground, opposite rampart, or opposite stair -> must descend to ground entrance first
      const distToEntrance = Math.hypot(currentPos.x - wp.groundEntrance.x, currentPos.z - wp.groundEntrance.z)
      if (distToEntrance > 0.8) {
        this._writeStairTarget(wp, false, out)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      } else {
        out.copy(wp.groundEntrance)
        return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'descend_stair' }
      }
    }

    // Fallback: only genuine same-layer / direct movement is allowed
    if (currentLayer === targetLayer) {
      out.copy(goalPos)
      return { target: out, isCrossLayer: false, currentLayer, targetLayer, step: 'direct' }
    }

    // Unknown cross-layer combination: NEVER return direct across midair!
    // Safely route toward the ground entrance of the target or current wing
    const fallbackSide = layerSide(targetLayer) ?? layerSide(currentLayer) ?? -1
    const fallbackWp = this.getWaypoints(fallbackSide)
    out.copy(fallbackWp.groundEntrance)
    return { target: out, isCrossLayer: true, currentLayer, targetLayer, step: 'ground_approach' }
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
