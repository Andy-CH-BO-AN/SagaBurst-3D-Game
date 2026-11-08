import * as THREE from 'three'
import type { MountedPoseKind } from './CharacterVisuals'

/** Measured half-width (m) of each mount and its saddle around the rider, sampled every 10 cm below the seated
 * pelvis (index 0 = pelvis height). Measured in the hero studio, 98th percentile, data only: no runtime mesh queries. */
export const MOUNT_BARREL: Partial<Record<MountedPoseKind, readonly number[]>> = {
  CORGI: [.05, .16, .26, .32, .36, .39, .41, .42, .40, .39],
  BLACK_CAT: [.25, .26, .30, .34, .36, .36, .37, .39, .35, .34],
  WHITE_CAT: [.28, .29, .34, .38, .40, .41, .41, .42, .34, .30],
  ORANGE_CAT: [.26, .26, .31, .34, .37, .38, .38, .39, .32, .33],
  SERVAL: [.22, .27, .33, .37, .39, .39, .38, .38, .35, .28],
  CARACAL: [.24, .24, .28, .32, .34, .37, .38, .38, .42, .30],
  SNOW_LEOPARD: [.24, .34, .42, .45, .44, .44, .47, .44, .44, .38],
  HORSE: [.11, .16, .21, .28, .33, .35, .35, .33, .28, .22],
  ARMORED_HORSE: [.24, .27, .32, .38, .41, .43, .46, .45, .48, .44],
}

const THIGH_FORWARD = .85
const CALF_BACK = .12
const LEG_CLEARANCE = .09
/** A hip opens about this far at most; beyond it a leg reads as dislocated. */
const MAX_ABDUCTION = .75
/** Slim cats: the measured width includes the saddle, so the shared cap reads as splayed. */
export const MOUNT_MAX_ABDUCTION: Partial<Record<MountedPoseKind, number>> = { SERVAL: .5, CARACAL: .5 }

export function barrelHalfWidth(barrel: readonly number[], below: number): number {
  if (below <= 0) return barrel[0]
  const u = below * 10, i = Math.min(Math.floor(u), barrel.length - 1), j = Math.min(i + 1, barrel.length - 1)
  return barrel[i] + (barrel[j] - barrel[i]) * (u - i)
}

export interface SeatedLeg {
  /** Rotation of the whole leg outward about the forward axis through the hip. */
  abduct: number
  /** Directions inside the leg's own hinge plane, before abduction: the knee only bends one way. */
  thighPlane: THREE.Vector3
  calfPlane: THREE.Vector3
  thigh: THREE.Vector3
  calf: THREE.Vector3
}

const FORWARD_AXIS = new THREE.Vector3(0, 0, 1)

/** Bends the leg in its hinge plane, then opens the whole leg at the hip just far enough to clear the mount.
 * Positions are metres from the pelvis in rider space (+Z forward). `side` is the sign of the hip's X. */
export function solveSeatedLeg(hip: THREE.Vector3, thighLength: number, calfLength: number, side: 1 | -1, barrel: readonly number[], maxAbduction = MAX_ABDUCTION): SeatedLeg {
  const thighPlane = new THREE.Vector3(0, -Math.cos(THIGH_FORWARD), Math.sin(THIGH_FORWARD))
  const calfPlane = new THREE.Vector3(0, -Math.cos(CALF_BACK), -Math.sin(CALF_BACK))
  const thigh = new THREE.Vector3(), calf = new THREE.Vector3(), knee = new THREE.Vector3()
  const clearAt = (point: THREE.Vector3) => side * point.x >= barrelHalfWidth(barrel, -point.y) + LEG_CLEARANCE
  const mid = new THREE.Vector3(), ankle = new THREE.Vector3()
  // The thigh root necessarily sits on the saddle; only the knee and the calf must clear the body.
  let abduct = .05
  for (; abduct < maxAbduction; abduct += .02) {
    thigh.copy(thighPlane).applyAxisAngle(FORWARD_AXIS, side * abduct)
    calf.copy(calfPlane).applyAxisAngle(FORWARD_AXIS, side * abduct)
    knee.copy(hip).addScaledVector(thigh, thighLength)
    mid.copy(knee).addScaledVector(calf, calfLength * .5)
    ankle.copy(knee).addScaledVector(calf, calfLength)
    if (clearAt(knee) && clearAt(mid) && clearAt(ankle)) break
  }
  return { abduct, thighPlane, calfPlane, thigh, calf }
}
