import { markObstacleTopologyChanged } from '../world/ObstacleTopology'
import { removeObstacleData } from '../world/Terrain'
import * as THREE from 'three'
import { bakedMesh } from '../world/EnvironmentVisuals'
import {
  getTerrainHeight,
  getWalkRampHeight,
  type ObstacleData,
  type WalkRampSurface,
} from '../world/Terrain'
import type { CampaignOutpostPlacement } from './CampaignOutpost'
import type { DefenseCampaignLaunchConfig } from './DefenseCampaignLaunch'

/**
 * Phase-1 rampart: a raised timber walkway behind each front palisade wing plus
 * one wooden stair per wing. The low destructible palisade is untouched; the
 * walkway is a separate, indestructible structure that stands above the ground
 * lane so ground units, arrows and the navigation grid keep their old routes.
 */
export const OUTPOST_WALKWAY = {
  deckDepth: 3.2,
  deckThickness: 0.25,
  /** Underside clearance over the highest ground below the deck (>= 4.2m gate clearance for cavalry). */
  deckClearance: 4.6,
  /** Gap kept between the gate leaves and the nearest walkway end. */
  gateMargin: 1.2,
  /** Distance left to the side wall so the walkway can later continue around the corner. */
  endMargin: 0.4,
  railHeight: 0.9,
  railThickness: 0.25,
  /** Lower breastwork sill of the front parapet, allowing archery over the sill / through crenels. */
  parapetSillHeight: 0.4,
  /** Periodic spacing of battlements along the front parapet. */
  crenelPeriod: 2.4,
  /** Width of the open firing gap (crenel) in each period. */
  crenelWidth: 1.4,
  postHalf: 0.25,
  postXs: [8, 16, 24, 31, 41.5],
  stairCenterX: 36,
  stairHalfWidth: 1.1,
  stairLanding: 0.9,
  stairSlope: 0.46,
} as const

export type OutpostWalkwaySide = -1 | 1

/** World-space horizontal opening in the raised front parapet. */
export interface OutpostWalkwayCrenelSpan {
  minX: number
  maxX: number
}

export interface OutpostWalkwayDeck {
  side: OutpostWalkwaySide
  /** Walking surface height; flat along the whole deck. */
  topY: number
  slab: THREE.Box3
  walkSurface: WalkRampSurface
  rails: THREE.Box3[]
  posts: THREE.Box3[]
  frontRailProjectileBoxes: THREE.Box3[]
  /** Actual gaps between raised merlons, ordered from the gate toward the side end. */
  frontCrenelSpans: OutpostWalkwayCrenelSpan[]
}

export interface OutpostWalkwayBridge {
  /** Average top walking surface height of the bridge. */
  topY: number
  slab: THREE.Box3
  walkSurface: WalkRampSurface
  rails: THREE.Box3[]
  posts: THREE.Box3[]
  frontRailProjectileBoxes: THREE.Box3[]
  /** Actual gaps between raised merlons, ordered from world left to right. */
  frontCrenelSpans: OutpostWalkwayCrenelSpan[]
}

export interface OutpostWalkwayStair {
  side: OutpostWalkwaySide
  ramp: WalkRampSurface
  /** Ground-to-top envelope of the ramp, used for body collision and navigation. */
  bounds: THREE.Box3
  rails: THREE.Box3[]
  /** Seals the space under the ramp where it meets the deck underside. */
  cap: THREE.Box3
}

export interface OutpostWalkwayLayout {
  /** +1 when the interior lies toward +Z of the front wall, otherwise -1. */
  zSign: 1 | -1
  decks: OutpostWalkwayDeck[]
  stairs: OutpostWalkwayStair[]
  bridge: OutpostWalkwayBridge
}

const SIDES: readonly OutpostWalkwaySide[] = [-1, 1]

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
    new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
  )
}

/** Pure geometry for both factions; the Roman/Viking mirror is the sign of the front-to-back direction. */
export function getOutpostWalkwayLayout(placement: CampaignOutpostPlacement): OutpostWalkwayLayout {
  const W = OUTPOST_WALKWAY
  const zSign = (placement.backZ > placement.frontZ ? 1 : -1) as 1 | -1
  const zAt = (inward: number): number => placement.frontZ + zSign * inward
  const xNear = placement.gateWidth / 2 + W.gateMargin
  const xFar = placement.halfWidth - W.endMargin

  const decks: OutpostWalkwayDeck[] = []
  const stairs: OutpostWalkwayStair[] = []

  for (const side of SIDES) {
    let maxGround = -Infinity
    for (let x = xNear; x <= xFar + 1e-6; x += 1.5) {
      for (const d of [0, W.deckDepth / 2, W.deckDepth]) {
        maxGround = Math.max(maxGround, getTerrainHeight(side * x, zAt(d)))
      }
    }
    const topY = maxGround + W.deckClearance
    const slab = box(side * xNear, topY - W.deckThickness, zAt(0), side * xFar, topY, zAt(W.deckDepth))
    const railTop = topY + W.railHeight
    // Front parapet and outer end-cap only; inner end-cap is removed so the walkway connects to the gate bridge.
    const rails = [
      box(side * xNear, topY, zAt(0), side * xFar, railTop, zAt(W.railThickness)),
      box(side * (xFar - W.railThickness), topY, zAt(0), side * xFar, railTop, zAt(W.deckDepth)),
    ]

    // Front parapet projectile geometry: continuous lower sill plus raised merlon battlements.
    // Archers shoot over the lower sill through open crenels, while striking the wood (sill or merlons)
    // physically stops projectiles.
    const frontRailProjectileBoxes: THREE.Box3[] = [
      box(side * xNear, topY, zAt(0), side * xFar, topY + W.parapetSillHeight, zAt(W.railThickness)),
    ]
    const frontCrenelSpans: OutpostWalkwayCrenelSpan[] = []
    const worldSpan = (a: number, b: number): OutpostWalkwayCrenelSpan => ({
      minX: Math.min(side * a, side * b),
      maxX: Math.max(side * a, side * b),
    })
    const hC = W.crenelWidth / 2
    const totalPeriods = Math.ceil((xFar - xNear) / W.crenelPeriod)
    let openStart = xNear
    for (let i = 0; i < totalPeriods; i++) {
      const mX0 = xNear + i * W.crenelPeriod + hC
      const mX1 = xNear + (i + 1) * W.crenelPeriod - hC
      if (mX0 < xFar) {
        frontCrenelSpans.push(worldSpan(openStart, mX0))
        const merlonEnd = Math.min(xFar, mX1)
        frontRailProjectileBoxes.push(box(
          side * mX0,
          topY + W.parapetSillHeight,
          zAt(0),
          side * merlonEnd,
          railTop,
          zAt(W.railThickness),
        ))
        openStart = merlonEnd
      }
    }
    if (openStart < xFar) frontCrenelSpans.push(worldSpan(openStart, xFar))
    const midZ = (zAt(0) + zAt(W.deckDepth)) / 2
    const deckWalkSurface: WalkRampSurface = {
      startX: side * xNear,
      startZ: midZ,
      dirX: side,
      dirZ: 0,
      halfWidth: W.deckDepth / 2,
      length: xFar - xNear,
      landing: 0,
      startY: topY,
      topY,
    }
    const posts = W.postXs.map(px => {
      const x = side * px
      const groundY = getTerrainHeight(x, zAt(W.deckDepth - W.postHalf)) - 0.3
      return box(x - W.postHalf, groundY, zAt(W.deckDepth - 2 * W.postHalf), x + W.postHalf, topY - W.deckThickness, zAt(W.deckDepth))
    })
    decks.push({ side, topY, slab, walkSurface: deckWalkSurface, rails, posts,
      frontRailProjectileBoxes, frontCrenelSpans })

    // Stair: climbs toward the wall along the Z axis, ends in a flat landing
    // that butts against the inner edge of the deck.
    const cx = side * W.stairCenterX
    const hw = W.stairHalfWidth
    const dirZ = -zSign
    // The low end sits 3cm above the centre-line ground so walking on is a tiny lift.
    // Slope (0.46) exceeds any terrain gradient, so the ramp stays above the ground beyond it.
    const groundAtStart = (z: number): number => getTerrainHeight(cx, z) + 0.03
    let length = 8
    let startZ = zAt(W.deckDepth + W.stairLanding + length)
    let startY = groundAtStart(startZ)
    for (let i = 0; i < 4; i++) {
      length = Math.max(3, (topY - startY) / W.stairSlope)
      startZ = zAt(W.deckDepth + W.stairLanding + length)
      startY = groundAtStart(startZ)
    }
    length = Math.max(3, (topY - startY) / W.stairSlope)
    startZ = zAt(W.deckDepth + W.stairLanding + length)
    const ramp: WalkRampSurface = {
      startX: cx, startZ, dirX: 0, dirZ, halfWidth: hw, length, landing: W.stairLanding, startY, topY,
    }

    const zAlong = (along: number): number => startZ + dirZ * along
    const surfaceAt = (along: number): number => getWalkRampHeight(ramp, cx, zAlong(along)) ?? topY
    const lowestGround = (z0: number, z1: number): number => {
      let m = Infinity
      for (const x of [cx - hw, cx, cx + hw]) {
        for (let t = 0; t <= 4; t++) m = Math.min(m, getTerrainHeight(x, z0 + (z1 - z0) * t / 4))
      }
      return m
    }

    const stairRails: THREE.Box3[] = []
    const slices = Math.ceil(length / 2)
    const spans: [number, number][] = []
    for (let i = 0; i < slices; i++) spans.push([length * i / slices, length * (i + 1) / slices])
    spans.push([length, length + W.stairLanding])
    for (const [a0, a1] of spans) {
      const z0 = zAlong(a0)
      const z1 = zAlong(a1)
      const minY = lowestGround(z0, z1) - 0.3
      const maxY = surfaceAt(a1) + 0.95
      stairRails.push(box(cx + hw, minY, z0, cx + hw + W.railThickness, maxY, z1))
      stairRails.push(box(cx - hw - W.railThickness, minY, z0, cx - hw, maxY, z1))
    }

    const bounds = box(cx - hw, lowestGround(startZ, zAt(W.deckDepth)) - 0.5, startZ, cx + hw, topY, zAt(W.deckDepth))
    const cap = box(
      cx - hw - W.railThickness, bounds.min.y, zAt(W.deckDepth - 0.3),
      cx + hw + W.railThickness, topY - W.deckThickness, zAt(W.deckDepth),
    )
    stairs.push({ side, ramp, bounds, rails: stairRails, cap })
  }

  const leftDeck = decks.find(d => d.side === -1)!
  const rightDeck = decks.find(d => d.side === 1)!
  const yLeft = leftDeck.topY
  const yRight = rightDeck.topY
  const bridgeSpan = 2 * xNear
  const midZ = (zAt(0) + zAt(W.deckDepth)) / 2
  const topY = (yLeft + yRight) / 2
  const slab = box(-xNear, Math.min(yLeft, yRight) - W.deckThickness, zAt(0), xNear, Math.max(yLeft, yRight), zAt(W.deckDepth))

  const walkSurface: WalkRampSurface = yLeft <= yRight
    ? {
        startX: -xNear,
        startZ: midZ,
        dirX: 1,
        dirZ: 0,
        halfWidth: W.deckDepth / 2,
        length: bridgeSpan,
        landing: 0,
        startY: yLeft,
        topY: yRight,
      }
    : {
        startX: xNear,
        startZ: midZ,
        dirX: -1,
        dirZ: 0,
        halfWidth: W.deckDepth / 2,
        length: bridgeSpan,
        landing: 0,
        startY: yRight,
        topY: yLeft,
      }

  const surfaceYAt = (x: number): number => yLeft + (yRight - yLeft) * ((x + xNear) / bridgeSpan)

  const bridgeRails = [
    // Front parapet envelope
    box(-xNear, Math.min(yLeft, yRight), zAt(0), xNear, Math.max(yLeft, yRight) + W.railHeight, zAt(W.railThickness)),
    // Rear courtyard safety rail
    box(-xNear, Math.min(yLeft, yRight), zAt(W.deckDepth - W.railThickness), xNear, Math.max(yLeft, yRight) + W.railHeight, zAt(W.deckDepth)),
  ]

  // Front parapet projectile geometry: local breastwork sills in open crenels plus full merlon battlements.
  const bridgeFrontRailProjectileBoxes: THREE.Box3[] = []
  const crenelSpans: [number, number][] = [
    [-xNear, -4.1],
    [-3.1, -1.7],
    [-0.7, 0.7], // central gate crenel
    [1.7, 3.1],
    [4.1, xNear],
  ]
  for (const [c0, c1] of crenelSpans) {
    const y0 = surfaceYAt(c0)
    const y1 = surfaceYAt(c1)
    bridgeFrontRailProjectileBoxes.push(box(
      c0,
      Math.min(y0, y1),
      zAt(0),
      c1,
      Math.max(y0, y1) + W.parapetSillHeight,
      zAt(W.railThickness),
    ))
  }

  // Raised timber battlements (merlons)
  const merlonSpans: [number, number][] = [
    [-4.1, -3.1],
    [-1.7, -0.7],
    [0.7, 1.7],
    [3.1, 4.1],
  ]
  for (const [m0, m1] of merlonSpans) {
    const y0 = surfaceYAt(m0)
    const y1 = surfaceYAt(m1)
    bridgeFrontRailProjectileBoxes.push(box(
      m0,
      Math.min(y0, y1),
      zAt(0),
      m1,
      Math.max(y0, y1) + W.railHeight,
      zAt(W.railThickness),
    ))
  }

  // Posts at the walkway ends flanking the gate corridor, outside gate opening [-4, 4]
  const bridgePosts = [-xNear + W.postHalf, xNear - W.postHalf].map(px => {
    const groundY = getTerrainHeight(px, zAt(W.deckDepth - W.postHalf)) - 0.3
    const postTopY = surfaceYAt(px) - W.deckThickness
    return box(
      px - W.postHalf,
      groundY,
      zAt(W.deckDepth - 2 * W.postHalf),
      px + W.postHalf,
      postTopY,
      zAt(W.deckDepth),
    )
  })

  const bridge: OutpostWalkwayBridge = {
    topY,
    slab,
    walkSurface,
    rails: bridgeRails,
    posts: bridgePosts,
    frontRailProjectileBoxes: bridgeFrontRailProjectileBoxes,
    frontCrenelSpans: crenelSpans.map(([minX, maxX]) => ({ minX, maxX })),
  }

  return { zSign, decks, stairs, bridge }
}

export type OutpostWalkwayLaunchFields = Pick<DefenseCampaignLaunchConfig,
  'type' | 'careerMissionId' | 'careerMissionKind' | 'careerReliefPhase'
  | 'careerVeteranOutpost' | 'careerPersonalSquad'>

/** Defense Outpost launches get the rampart; relief and assault keep their original map. */
export function isOutpostWalkwayEnabled(
  config: OutpostWalkwayLaunchFields | null | undefined,
  devPreview: boolean,
): boolean {
  if (devPreview) return true
  if (!config || config.type !== 'defense' || config.careerReliefPhase) return false
  if (config.careerMissionKind) {
    return config.careerMissionKind === 'outpost-defense'
      || config.careerMissionKind === 'captain-outpost-defense'
      || config.careerMissionKind === 'veteran-outpost-defense'
  }
  if (config.careerVeteranOutpost) {
    return config.careerVeteranOutpost.missionKind === 'veteran-outpost-defense'
  }
  return !config.careerMissionId && !config.careerPersonalSquad
}

export interface OutpostWalkways {
  root: THREE.Group
  layout: OutpostWalkwayLayout
  obstacles: ObstacleData[]
  setDockPassage(side: OutpostWalkwaySide, open: boolean): void
}

function boxGeometry(source: THREE.Box3): THREE.BufferGeometry {
  const size = source.getSize(new THREE.Vector3())
  const center = source.getCenter(new THREE.Vector3())
  return new THREE.BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z)
}

function slopedBar(a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number): THREE.BufferGeometry {
  const direction = b.clone().sub(a)
  const geometry = new THREE.BoxGeometry(width, thickness, direction.length())
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize()))
  const mid = a.clone().add(b).multiplyScalar(0.5)
  return geometry.translate(mid.x, mid.y, mid.z)
}

/** Builds the meshes and registers collision into the shared obstacle collections. */
export function createOutpostWalkways(
  placement: CampaignOutpostPlacement,
  collections: { obstacles: ObstacleData[]; obstacleMeshes: THREE.Object3D[] },
  woodMaterial: THREE.Material,
  darkWoodMaterial: THREE.Material,
  siegePassages = false,
): OutpostWalkways {
  const W = OUTPOST_WALKWAY
  const layout = getOutpostWalkwayLayout(placement)
  const root = new THREE.Group()
  root.name = `campaign-outpost-walkways-${layout.zSign < 0 ? 'roman' : 'viking'}`
  const created: ObstacleData[] = []
  const portals = new Map<OutpostWalkwaySide, { mesh: THREE.Mesh; obstacle: ObstacleData }>()
  const register = (data: ObstacleData): void => { created.push(data); collections.obstacles.push(data) }
  const finish = (name: string, wood: THREE.BufferGeometry[], dark: THREE.BufferGeometry[]): void => {
    for (const [suffix, parts, material] of [['wood', wood, woodMaterial], ['dark', dark, darkWoodMaterial]] as const) {
      const mesh = bakedMesh([...parts], material)
      mesh.name = `${name}-${suffix}`
      root.add(mesh)
      collections.obstacleMeshes.push(mesh)
    }
  }
  const zAt = (inward: number): number => placement.frontZ + layout.zSign * inward

  for (const deck of layout.decks) {
    const sideName = deck.side < 0 ? 'left' : 'right'
    const frontBoxes = deck.frontRailProjectileBoxes ?? [deck.rails[0]]
    const wood: THREE.BufferGeometry[] = [
      boxGeometry(deck.slab),
      ...(siegePassages ? [] : frontBoxes.map(boxGeometry)),
      ...deck.rails.slice(1).map(boxGeometry),
    ]
    const dark: THREE.BufferGeometry[] = []
    // Overhead slab: does not block ground navigation grid, but physically stops projectiles hitting it.
    register({
      box: deck.slab,
      isBarricade: false,
      navigationPassable: true,
      walkSurface: deck.walkSurface,
    })

    // Front parapet: 0.9m envelope prevents player from stepping/falling off;
    // projectileBoxes models the lower sill and merlon risers so archers can shoot
    // through open crenels or over the sill while solid timber blocks shots.
    if (siegePassages) {
      deck.walkSurface.mounted = true
      const centre = (deck.slab.min.x + deck.slab.max.x) / 2
      const endpoints = [deck.slab.min.x, centre - 2.5, centre + 2.5, deck.slab.max.x]
      for (let i = 0; i < 3; i++) {
        const rail = deck.rails[0].clone()
        rail.min.x = endpoints[i]; rail.max.x = endpoints[i + 1]
        const boxes = frontBoxes.map(source => source.clone().intersect(rail)).filter(b => !b.isEmpty() && b.max.x > b.min.x)
        const mesh = bakedMesh(boxes.map(boxGeometry), woodMaterial)
        mesh.name = `campaign-dock-parapet-${sideName}-${i}`
        root.add(mesh); collections.obstacleMeshes.push(mesh)
        const obstacle: ObstacleData = { box: rail, isBarricade: false, navigationPassable: true, projectileBoxes: boxes }
        register(obstacle)
        if (i === 1) portals.set(deck.side, { mesh, obstacle })
      }
    } else {
      register({ box: deck.rails[0], isBarricade: false, navigationPassable: true, projectileBoxes: frontBoxes })
    }

    // End-cap rails: solid barriers at the side ends.
    for (let i = 1; i < deck.rails.length; i++) {
      register({ box: deck.rails[i], isBarricade: false, navigationPassable: true })
    }
    for (const post of deck.posts) {
      register({ box: post, isBarricade: false })
      dark.push(boxGeometry(post))
      const x = (post.min.x + post.max.x) / 2
      // Cross beam back to the wall and a brace so the deck reads as supported.
      dark.push(new THREE.BoxGeometry(0.3, 0.3, W.deckDepth).translate(x, deck.topY - W.deckThickness - 0.15, zAt(W.deckDepth / 2)))
      dark.push(slopedBar(
        new THREE.Vector3(x, post.min.y + 1.2, zAt(W.deckDepth - W.postHalf)),
        new THREE.Vector3(x, deck.topY - W.deckThickness - 0.3, zAt(W.deckDepth * 0.4)),
        0.18, 0.18,
      ))
    }
    finish(`campaign-walkway-deck-${sideName}`, wood, dark)
  }

  for (const stair of layout.stairs) {
    const sideName = stair.side < 0 ? 'left' : 'right'
    const { ramp } = stair
    const cx = ramp.startX
    const zAlong = (along: number): number => ramp.startZ + ramp.dirZ * along
    const surfaceAt = (along: number): number => getWalkRampHeight(ramp, cx, zAlong(along)) ?? ramp.topY
    const wood: THREE.BufferGeometry[] = []
    const dark: THREE.BufferGeometry[] = []

    const stepBoxes: THREE.Box3[] = []
    const steps = Math.max(6, Math.round(ramp.length / 0.45))
    const hw = ramp.halfWidth
    for (let i = 0; i < steps; i++) {
      const a0 = i * ramp.length / steps
      const a1 = (i + 1) * ramp.length / steps
      const yMid = surfaceAt((i + 0.5) * ramp.length / steps)
      stepBoxes.push(box(cx - hw, yMid - 0.14, zAlong(a0), cx + hw, yMid, zAlong(a1)))
      wood.push(new THREE.BoxGeometry(hw * 2, 0.14, ramp.length / steps + 0.02)
        .translate(cx, yMid - 0.07, zAlong((i + 0.5) * ramp.length / steps)))
    }
    const landingBox = box(
      cx - hw, ramp.topY - 0.14, zAlong(ramp.length),
      cx + hw, ramp.topY, zAlong(ramp.length + ramp.landing),
    )
    stepBoxes.push(landingBox)
    wood.push(new THREE.BoxGeometry(hw * 2, 0.14, ramp.landing)
      .translate(cx, ramp.topY - 0.07, zAlong(ramp.length + ramp.landing / 2)))
    for (const rail of stair.rails) wood.push(boxGeometry(rail))

    for (const lateral of [-1, 1]) {
      const x = cx + lateral * (ramp.halfWidth + W.railThickness / 2)
      dark.push(slopedBar(
        new THREE.Vector3(x, ramp.startY + 0.95, zAlong(0)),
        new THREE.Vector3(x, ramp.topY + 0.95, zAlong(ramp.length)),
        0.16, 0.12,
      ))
      dark.push(new THREE.BoxGeometry(0.16, 0.12, ramp.landing)
        .translate(x, ramp.topY + 0.95, zAlong(ramp.length + ramp.landing / 2)))
    }

    register({
      box: stair.bounds,
      isBarricade: false,
      walkSurface: ramp,
      projectileBoxes: [...stepBoxes, ...stair.rails, stair.cap],
    })
    for (const rail of stair.rails) register({ box: rail, isBarricade: false })
    register({ box: stair.cap, isBarricade: false })
    finish(`campaign-walkway-stair-${sideName}`, wood, dark)
  }

  const bridge = layout.bridge
  if (bridge) {
    if (siegePassages) bridge.walkSurface.mounted = true
    const leftDeck = layout.decks.find(d => d.side === -1)!
    const rightDeck = layout.decks.find(d => d.side === 1)!
    const yLeft = leftDeck.topY
    const yRight = rightDeck.topY
    const xNear = placement.gateWidth / 2 + W.gateMargin
    const bridgeSpan = 2 * xNear
    const theta = Math.atan2(yRight - yLeft, bridgeSpan)
    const slabLen = Math.hypot(bridgeSpan, yRight - yLeft)
    const midZ = (zAt(0) + zAt(W.deckDepth)) / 2
    const midY = (yLeft + yRight) / 2
    // Use exactly the same rigid transform for the visible slab and its precise
    // projectile/camera volume. The world AABB remains the navigation broadphase.
    const slabLocalBox = box(-slabLen / 2, -W.deckThickness / 2, -W.deckDepth / 2,
      slabLen / 2, W.deckThickness / 2, W.deckDepth / 2)
    const slabLocalToWorld = new THREE.Matrix4().makeRotationZ(theta)
    slabLocalToWorld.setPosition(0, midY - W.deckThickness / 2, midZ)
    const slabGeom = boxGeometry(slabLocalBox).applyMatrix4(slabLocalToWorld)

    const wood: THREE.BufferGeometry[] = [
      slabGeom,
      ...bridge.frontRailProjectileBoxes.map(boxGeometry),
      boxGeometry(bridge.rails[1]),
    ]
    const dark: THREE.BufferGeometry[] = []

    register({
      box: bridge.slab,
      isBarricade: false,
      navigationPassable: true,
      walkSurface: bridge.walkSurface,
      projectileBoxes: [slabLocalBox],
      projectileWorldToLocal: slabLocalToWorld.clone().invert(),
    })

    register({
      box: bridge.rails[0],
      isBarricade: false,
      navigationPassable: true,
      projectileBoxes: bridge.frontRailProjectileBoxes,
    })

    register({
      box: bridge.rails[1],
      isBarricade: false,
      navigationPassable: true,
    })

    for (const post of bridge.posts) {
      register({ box: post, isBarricade: false })
      dark.push(boxGeometry(post))
      const x = (post.min.x + post.max.x) / 2
      const postTopY = yLeft + (yRight - yLeft) * ((x + xNear) / bridgeSpan) - W.deckThickness
      dark.push(new THREE.BoxGeometry(0.3, 0.3, W.deckDepth).translate(x, postTopY - 0.15, midZ))
      dark.push(slopedBar(
        new THREE.Vector3(x, post.min.y + 1.2, zAt(W.deckDepth - W.postHalf)),
        new THREE.Vector3(x, postTopY - 0.3, zAt(W.deckDepth * 0.4)),
        0.18, 0.18,
      ))
    }

    const girder0 = new THREE.BoxGeometry(slabLen, 0.28, 0.3)
    girder0.rotateZ(theta)
    girder0.translate(0, midY - W.deckThickness - 0.14, zAt(0.5))
    const girder1 = new THREE.BoxGeometry(slabLen, 0.28, 0.3)
    girder1.rotateZ(theta)
    girder1.translate(0, midY - W.deckThickness - 0.14, zAt(W.deckDepth - 0.5))
    dark.push(girder0, girder1)

    finish('campaign-walkway-bridge', wood, dark)
  }

  return { root, layout, obstacles: created, setDockPassage(side, open) {
    const portal = portals.get(side)
    if (!portal || portal.mesh.visible === !open) return
    portal.mesh.visible = !open
    if (open) portal.mesh.layers.disableAll()
    else portal.mesh.layers.enable(0)
    if (open) removeObstacleData(collections.obstacles, portal.obstacle)
    else { collections.obstacles.push(portal.obstacle); markObstacleTopologyChanged(collections.obstacles) }
  } }
}
