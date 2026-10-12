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
  /** Underside clearance over the highest ground below the deck. */
  deckClearance: 3.5,
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

export interface OutpostWalkwayDeck {
  side: OutpostWalkwaySide
  /** Walking surface height; flat along the whole deck. */
  topY: number
  slab: THREE.Box3
  rails: THREE.Box3[]
  posts: THREE.Box3[]
  frontRailProjectileBoxes: THREE.Box3[]
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
    const rails = [
      box(side * xNear, topY, zAt(0), side * xFar, railTop, zAt(W.railThickness)),
      box(side * xNear, topY, zAt(0), side * (xNear + W.railThickness), railTop, zAt(W.deckDepth)),
      box(side * (xFar - W.railThickness), topY, zAt(0), side * xFar, railTop, zAt(W.deckDepth)),
    ]

    // Front parapet projectile geometry: continuous lower sill plus raised merlon battlements.
    // Archers shoot over the lower sill through open crenels, while striking the wood (sill or merlons)
    // physically stops projectiles.
    const frontRailProjectileBoxes: THREE.Box3[] = [
      box(side * xNear, topY, zAt(0), side * xFar, topY + W.parapetSillHeight, zAt(W.railThickness)),
    ]
    const hC = W.crenelWidth / 2
    const totalPeriods = Math.ceil((xFar - xNear) / W.crenelPeriod)
    for (let i = 0; i < totalPeriods; i++) {
      const mX0 = xNear + i * W.crenelPeriod + hC
      const mX1 = xNear + (i + 1) * W.crenelPeriod - hC
      if (mX0 < xFar) {
        frontRailProjectileBoxes.push(box(
          side * mX0,
          topY + W.parapetSillHeight,
          zAt(0),
          side * Math.min(xFar, mX1),
          railTop,
          zAt(W.railThickness),
        ))
      }
    }
    const posts = W.postXs.map(px => {
      const x = side * px
      const groundY = getTerrainHeight(x, zAt(W.deckDepth - W.postHalf)) - 0.3
      return box(x - W.postHalf, groundY, zAt(W.deckDepth - 2 * W.postHalf), x + W.postHalf, topY - W.deckThickness, zAt(W.deckDepth))
    })
    decks.push({ side, topY, slab, rails, posts, frontRailProjectileBoxes })

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

  return { zSign, decks, stairs }
}

export type OutpostWalkwayLaunchFields = Pick<DefenseCampaignLaunchConfig,
  'type' | 'careerMissionId' | 'careerMissionKind' | 'careerReliefPhase'
  | 'careerVeteranOutpost' | 'careerPersonalSquad'>

/**
 * Standard Defense Campaign launches (no Career linkage) get the rampart.
 * DEV previews opt in explicitly.
 */
export function isOutpostWalkwayEnabled(
  config: OutpostWalkwayLaunchFields | null | undefined,
  devPreview: boolean,
): boolean {
  if (devPreview) return true
  return Boolean(config)
    && config!.type === 'defense'
    && !config!.careerMissionId
    && !config!.careerMissionKind
    && !config!.careerReliefPhase
    && !config!.careerVeteranOutpost
    && !config!.careerPersonalSquad
}

export interface OutpostWalkways {
  root: THREE.Group
  layout: OutpostWalkwayLayout
  obstacles: ObstacleData[]
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
): OutpostWalkways {
  const W = OUTPOST_WALKWAY
  const layout = getOutpostWalkwayLayout(placement)
  const root = new THREE.Group()
  root.name = `campaign-outpost-walkways-${layout.zSign < 0 ? 'roman' : 'viking'}`
  const created: ObstacleData[] = []
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
      ...frontBoxes.map(boxGeometry),
      ...deck.rails.slice(1).map(boxGeometry),
    ]
    const dark: THREE.BufferGeometry[] = []
    // Overhead slab: does not block ground navigation grid, but physically stops projectiles hitting it.
    register({ box: deck.slab, isBarricade: false, navigationPassable: true })

    // Front parapet: 0.9m envelope prevents player from stepping/falling off;
    // projectileBoxes models the lower sill and merlon risers so archers can shoot
    // through open crenels or over the sill while solid timber blocks shots.
    register({
      box: deck.rails[0],
      isBarricade: false,
      navigationPassable: true,
      projectileBoxes: frontBoxes,
    })

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

  return { root, layout, obstacles: created }
}
