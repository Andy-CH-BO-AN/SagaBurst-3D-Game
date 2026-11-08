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

const THIGH_FORWARD = .75
const THIGH_CLEARANCE = .1
const CALF_CLEARANCE = .08
const CALF_BACK = -.15

export function barrelHalfWidth(barrel: readonly number[], below: number): number {
  if (below <= 0) return barrel[0]
  const u = below * 10, i = Math.min(Math.floor(u), barrel.length - 1), j = Math.min(i + 1, barrel.length - 1)
  return barrel[i] + (barrel[j] - barrel[i]) * (u - i)
}

export interface SeatedLegDirections { thigh: THREE.Vector3; calf: THREE.Vector3; foot: THREE.Vector3 }

/** Smallest outward lean that keeps the limb outside the mount; the calf may hug the flank by leaning back in.
 * Positions are metres from the pelvis in rider space (+Z forward). `side` is the sign of the hip's X. */
export function solveSeatedLeg(hip: THREE.Vector3, thighLength: number, calfLength: number, side: 1 | -1, barrel: readonly number[]): SeatedLegDirections {
  const clear = (from: THREE.Vector3, direction: THREE.Vector3, length: number, margin: number) => {
    for (const t of [.35, .7, 1]) {
      const x = side * (from.x + direction.x * length * t), below = -(from.y + direction.y * length * t)
      if (below > .03 && x < barrelHalfWidth(barrel, below) + margin) return false
    }
    return true
  }
  const thigh = new THREE.Vector3()
  for (let abduct = .2; abduct <= 1.5; abduct += .05) {
    thigh.set(side * Math.sin(abduct), -Math.cos(abduct) * Math.cos(THIGH_FORWARD), Math.cos(abduct) * Math.sin(THIGH_FORWARD)).normalize()
    if (clear(hip, thigh, thighLength, THIGH_CLEARANCE)) break
  }
  const knee = hip.clone().addScaledVector(thigh, thighLength)
  const calf = new THREE.Vector3()
  for (let lean = -.45; lean <= 1.2; lean += .05) {
    calf.set(side * lean, -1, CALF_BACK).normalize()
    if (clear(knee, calf, calfLength, CALF_CLEARANCE)) break
  }
  return { thigh, calf, foot: new THREE.Vector3(side * .2, -.12, 1).normalize() }
}
