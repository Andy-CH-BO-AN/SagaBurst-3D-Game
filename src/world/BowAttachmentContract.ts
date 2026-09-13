import * as THREE from 'three'

/**
 * HandGripFrame defines the anatomical contact parameters of a character hand.
 * This is authored asset calibration metadata attached to the rig/socket,
 * completely decoupled from weapon-specific profiles.
 */
export interface HandGripFrame {
  /** Authored contact center on the palm surface in hand local space (meters) */
  readonly palmContactCenter: THREE.Vector3
  /** Unit normal pointing OUT of the palm surface into the weapon grip cavity */
  readonly palmNormal: THREE.Vector3
  /** Legacy procedural fixture fallback; calibrated assets use thumbDirection. */
  readonly thumbDir: number
  readonly thumbDirection?: THREE.Vector3
  readonly fingerDirection?: THREE.Vector3
  readonly wristCenter?: THREE.Vector3
  readonly fingerBase?: number
  readonly thumbBaseCenter?: THREE.Vector3
}

/**
 * BowGripProfile defines the intrinsic geometry and contact parameters of a bow handle
 * relative to the canonical hand grip coordinate system.
 *
 * Both Roman and Viking share the exact same BowGripProfile (no faction-specific magic numbers).
 */
export interface BowGripProfile {
  readonly id: string
  /** Physical outer radius of the rendered bow handle cylinder in world/socket scale (meters) */
  readonly gripRadius: number
  /** Length of the grip handle section along longitudinal axis in world/socket scale (meters) */
  readonly gripLength: number
  /** Visual scale applied to bow body model relative to weapon socket root */
  readonly visualScale: number
  /** Authored center of the handle in weapon local space */
  readonly gripCenterLocal: THREE.Vector3
  /** Arrow flight / launch direction in weapon local space */
  readonly shootingAxis: THREE.Vector3
  /** Upright limb axis (top tip direction) in weapon local space */
  readonly longitudinalAxis: THREE.Vector3
  /** Normal vector pointing from grip center toward palm contact surface */
  readonly contactNormal: THREE.Vector3
}

export const DEFAULT_BOW_GRIP_PROFILE: BowGripProfile = Object.freeze({
  id: 'bow_standard',
  gripRadius: 0.028,
  gripLength: 0.14,
  visualScale: 1,
  gripCenterLocal: new THREE.Vector3(0, 0, 0),
  shootingAxis: new THREE.Vector3(0, 0, -1),
  longitudinalAxis: new THREE.Vector3(0, 1, 0),
  contactNormal: new THREE.Vector3(-1, 0, 0),
})

// Reusable scratch objects to prevent garbage collection during combat loops
const tmpAimTarget = new THREE.Vector3()
const tmpBowWorldPos = new THREE.Vector3()
const tmpForwardDir = new THREE.Vector3()
const tmpAimMatrix = new THREE.Matrix4()
const tmpDesiredQuat = new THREE.Quaternion()
const tmpSocketWorldQuat = new THREE.Quaternion()
const tmpParentQuat = new THREE.Quaternion()
const tmpSignedVec = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Computes signed distance of a grip point from the hand's palm contact plane along the palm normal.
 * Positive value indicates the point lies on the palmar side of the contact plane.
 */
export function getGripSignedDistance(gripCenterInHand: THREE.Vector3, handGrip: HandGripFrame): number {
  return tmpSignedVec.subVectors(gripCenterInHand, handGrip.palmContactCenter).dot(handGrip.palmNormal)
}

/**
 * Validates whether the bow grip center is strictly on the PALMAR side of the hand.
 */
export function isGripOnPalmarSide(gripCenterInHand: THREE.Vector3, handGrip: HandGripFrame): boolean {
  return getGripSignedDistance(gripCenterInHand, handGrip) > 0
}

/**
 * Fallback resolver for HandGripFrame if asset metadata has not yet been populated.
 */
export function resolveHandGripFrame(socket?: THREE.Object3D, handGrip?: HandGripFrame): HandGripFrame {
  if (handGrip) return handGrip
  if (socket?.userData?.handGripFrame) return socket.userData.handGripFrame as HandGripFrame
  return {
    palmContactCenter: new THREE.Vector3(0.015, 0.070, -0.077),
    palmNormal: new THREE.Vector3(0, 0, -1),
    thumbDir: 1,
  }
}

/**
 * Construct the canonical hand grip frame inside the palm cavity for archery grasp.
 * The grip cylinder center is positioned at distance `profile.gripRadius` along `handGrip.palmNormal`
 * from `handGrip.palmContactCenter`. This is a tangent-plane construction, NOT
 * proof of mesh clearance; curved palm, thumb/web and limbs require visual QA.
 */
export function getBowHandGripFrame(
  handGrip: HandGripFrame,
  profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE,
): THREE.Matrix4 {
  const origin = new THREE.Vector3()
    .copy(handGrip.palmContactCenter)
    .addScaledVector(handGrip.palmNormal, profile.gripRadius)

  const yAxis = handGrip.thumbDirection?.clone() ?? new THREE.Vector3(handGrip.thumbDir, 0, 0)
  const zAxis = new THREE.Vector3().copy(handGrip.palmNormal).negate()
  if (zAxis.lengthSq() < 1e-4) zAxis.set(0, 0, -1)
  else zAxis.normalize()

  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize()
  yAxis.crossVectors(zAxis, xAxis).normalize()

  const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
  return new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).multiply(rotMatrix)
}

/**
 * Construct the weapon grip frame for the bow.
 */
export function getBowWeaponGripFrame(profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE): THREE.Matrix4 {
  const rotMatrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(profile.longitudinalAxis, profile.contactNormal).normalize(),
    profile.longitudinalAxis,
    profile.contactNormal,
  )
  return new THREE.Matrix4()
    .makeTranslation(profile.gripCenterLocal.x, profile.gripCenterLocal.y, profile.gripCenterLocal.z)
    .multiply(rotMatrix)
}

/**
 * Computes the attachment transform for a bow parented to socket_hand_l.
 */
export function computeBowSocketAttachment(
  socket: THREE.Object3D,
  handGrip?: HandGripFrame,
  profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE,
): { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 } {
  const frame = resolveHandGripFrame(socket, handGrip)
  const fHand = getBowHandGripFrame(frame, profile)
  const fWeapon = getBowWeaponGripFrame(profile)

  const invW = new THREE.Matrix4().copy(fWeapon).invert()
  const attachInHand = new THREE.Matrix4().multiplyMatrices(fHand, invW)

  socket.updateMatrix()
  const invSocket = new THREE.Matrix4().copy(socket.matrix).invert()
  const attachInSocket = new THREE.Matrix4().multiplyMatrices(invSocket, attachInHand)

  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  attachInSocket.decompose(position, quaternion, scale)

  return { position, quaternion, scale }
}

/**
 * Applies the canonical BowGripProfile attachment transform onto a bow pivot.
 */
export function applyBowAttachment(
  socket: THREE.Object3D,
  bowPivot: THREE.Object3D,
  profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE,
  handGrip?: HandGripFrame,
): void {
  const { position, quaternion, scale } = computeBowSocketAttachment(socket, handGrip, profile)
  bowPivot.position.copy(position)
  bowPivot.quaternion.copy(quaternion)
  bowPivot.scale.copy(scale)
  bowPivot.updateMatrix()
}

/**
 * Uncalibrated procedural fixture fallback only. Calibrated humanoid bows keep
 * the static palm attachment; aiming must not overwrite its rotation.
 */
export function updateBowOrientation(
  socket: THREE.Object3D,
  bowPivot: THREE.Object3D,
  targetWorld: THREE.Vector3 | undefined,
  _profile: BowGripProfile = DEFAULT_BOW_GRIP_PROFILE,
  targetYOffset = 0,
): void {
  const parent = bowPivot.parent ?? socket
  parent.updateWorldMatrix(true, false)
  bowPivot.getWorldPosition(tmpBowWorldPos)

  if (targetWorld) {
    tmpAimTarget.copy(targetWorld)
    tmpAimTarget.y += targetYOffset
  } else {
    // Stable default aim line extending 10m forward along archer body orientation
    tmpForwardDir.set(0, 0, 1)
    parent.getWorldQuaternion(tmpParentQuat)
    tmpForwardDir.applyQuaternion(tmpParentQuat)
    tmpForwardDir.y = 0
    if (tmpForwardDir.lengthSq() > 1e-4) tmpForwardDir.normalize()
    else tmpForwardDir.set(0, 0, 1)
    tmpAimTarget.copy(tmpBowWorldPos).addScaledVector(tmpForwardDir, 10)
  }

  // Construct target orientation:
  // lookAt aligns -Z to (target - eye) and +Y perpendicular along world up
  tmpAimMatrix.lookAt(tmpBowWorldPos, tmpAimTarget, WORLD_UP)
  tmpDesiredQuat.setFromRotationMatrix(tmpAimMatrix)

  // Map desired world orientation into parent socket local coordinate frame
  parent.getWorldQuaternion(tmpSocketWorldQuat).invert()
  bowPivot.quaternion.copy(tmpSocketWorldQuat).multiply(tmpDesiredQuat)
  bowPivot.updateWorldMatrix(false, true)
}
