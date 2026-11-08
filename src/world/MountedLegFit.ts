import * as THREE from 'three'
import type { MountedPoseKind } from './CharacterVisuals'

/** Measured half-width (m) of each mount's body, without hanging saddle straps, around the rider. Sampled every
 * 10 cm below the seated pelvis (index 0 = pelvis height) in the hero studio, 98th percentile; no runtime mesh queries. */
export const MOUNT_BARREL: Partial<Record<MountedPoseKind, readonly number[]>> = {
  CORGI: [.05, .12, .22, .29, .33, .35, .35, .35, .33, .30],
  BLACK_CAT: [0, .03, .16, .25, .28, .30, .30, .28, .26, .30],
  WHITE_CAT: [0, .04, .18, .26, .29, .31, .29, .26, .23, .21],
  ORANGE_CAT: [0, 0, .14, .23, .27, .31, .32, .32, .32, .30],
  SERVAL: [0, 0, .22, .32, .36, .39, .39, .38, .35, .27],
  CARACAL: [0, 0, .12, .22, .31, .33, .34, .34, .32, .28],
  SNOW_LEOPARD: [.01, .17, .32, .38, .42, .46, .46, .44, .42, .37],
  HORSE: [.06, .13, .19, .24, .29, .32, .33, .31, .26, .19],
  ARMORED_HORSE: [.21, .25, .32, .38, .41, .43, .46, .47, .49, .43],
}

/** Half-width of the saddle's leather flap, where one hangs at knee height: the thigh lies over it. */
export const MOUNT_SADDLE_FLAP: Partial<Record<MountedPoseKind, number>> = { WHITE_CAT: .39, ORANGE_CAT: .36, BLACK_CAT: .33 }

/** Ankle distance from the pelvis as a share of the full leg: sets how bent the seated knee is. */
const LEG_EXTENSION = .86
/** Bone centre to mount surface: the calf lies against the flank. */
const ANKLE_CLEARANCE = .09
const KNEE_CLEARANCE = .1
const ANKLE_FORWARD = .06
const MAX_KNEE_TURN = 1.2

export function barrelHalfWidth(barrel: readonly number[], below: number): number {
  if (below <= 0) return barrel[0]
  const u = below * 10, i = Math.min(Math.floor(u), barrel.length - 1), j = Math.min(i + 1, barrel.length - 1)
  return barrel[i] + (barrel[j] - barrel[i]) * (u - i)
}

export interface SeatedLeg { thigh: THREE.Vector3; calf: THREE.Vector3; knee: THREE.Vector3; ankle: THREE.Vector3; kneeTurn: number }

/** The ankle hangs against the flank; the hip turns the knee outward just far enough to pass the body. A rider's leg:
 * knee widest, calf hugging, with both bones in one hinge plane so the knee only ever bends one way.
 * Positions are metres from the pelvis in rider space (+Z forward). `side` is the sign of the hip's X. */
export function solveSeatedLeg(hip: THREE.Vector3, thighLength: number, calfLength: number, side: 1 | -1, barrel: readonly number[], saddleFlap = 0): SeatedLeg {
  const reach = (thighLength + calfLength) * LEG_EXTENSION
  let below = -hip.y + reach, x = 0, depth = 0
  for (let pass = 0; pass < 3; pass++) {
    x = barrelHalfWidth(barrel, below) + ANKLE_CLEARANCE - side * hip.x
    depth = Math.sqrt(Math.max(.01, reach * reach - x * x - ANKLE_FORWARD * ANKLE_FORWARD))
    below = -hip.y + depth
  }
  const ankle = hip.clone().add(new THREE.Vector3(side * x, -depth, ANKLE_FORWARD))
  const axis = ankle.clone().sub(hip).normalize()
  const along = (thighLength * thighLength - calfLength * calfLength + reach * reach) / (2 * reach)
  const height = Math.sqrt(Math.max(0, thighLength * thighLength - along * along))
  const knee = new THREE.Vector3(), pole = new THREE.Vector3()
  let kneeTurn = .1
  for (; kneeTurn < MAX_KNEE_TURN; kneeTurn += .02) {
    pole.set(side * Math.sin(kneeTurn), 0, Math.cos(kneeTurn))
    pole.addScaledVector(axis, -pole.dot(axis)).normalize()
    knee.copy(hip).addScaledVector(axis, along).addScaledVector(pole, height)
    if (side * knee.x >= Math.max(barrelHalfWidth(barrel, -knee.y), saddleFlap) + KNEE_CLEARANCE) break
  }
  return { thigh: knee.clone().sub(hip).normalize(), calf: ankle.clone().sub(knee).normalize(), knee: knee.clone(), ankle, kneeTurn }
}
