import * as THREE from 'three'
import { proceduralMaterial } from './ProceduralMaterials'

export type CharacterFaction = 'viking' | 'roman'
export type MountedPoseKind = 'BLACK_CAT' | 'CORGI' | 'HORSE'

export interface CharacterVisualConfig {
  faction: CharacterFaction
  tier: 1 | 2 | 3
  isPlayer: boolean
}

export interface ArmRig {
  shoulder: THREE.Object3D
  elbow: THREE.Object3D
  wrist: THREE.Object3D
  handSocket: THREE.Object3D
}

export interface LegRig {
  hip: THREE.Object3D
  knee: THREE.Object3D
  ankle: THREE.Object3D
  foot: THREE.Object3D
  side: -1 | 1
  /** Local-X sign that bends the lower leg toward character-forward. */
  forwardBendSign: -1 | 1
}

export interface HumanoidAnimationController {
  play(state: string, fadeSeconds?: number, loop?: boolean): void
  update(dt: number, cameraDistance?: number): void
  stop(): void
}

export interface CharacterRig {
  right: ArmRig
  left: ArmRig
  rightLeg: LegRig
  leftLeg: LegRig
  pelvis?: THREE.Object3D
  spine?: THREE.Object3D
  head?: THREE.Object3D
  leftFootSocket?: THREE.Object3D
  rightFootSocket?: THREE.Object3D
  animation?: HumanoidAnimationController
}

export interface CharacterVisualParts {
  bodyMesh: THREE.Group
  headMesh: THREE.Mesh
  bodyMaterial: THREE.MeshStandardMaterial
  headMaterial: THREE.MeshStandardMaterial
  rightArm: THREE.Object3D
  leftArm: THREE.Object3D
  rig: CharacterRig
}

const rigPoseEuler = new THREE.Euler()
const rigPoseQuaternion = new THREE.Quaternion()

/** Apply an animation delta without destroying an imported bone's bind rotation. */
export function setRigRotation(node: THREE.Object3D, x: number, y: number, z: number): void {
  const rest = node.userData.humanoidRestQuaternion as [number, number, number, number] | undefined
  if (!rest) {
    node.rotation.set(x, y, z)
    return
  }
  rigPoseEuler.set(x, y, z)
  rigPoseQuaternion.setFromEuler(rigPoseEuler)
  node.quaternion.fromArray(rest).multiply(rigPoseQuaternion)
}

function mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material, position?: THREE.Vector3Tuple): THREE.Mesh<T> {
  const result = new THREE.Mesh(geometry, material)
  if (position) result.position.set(position[0], position[1], position[2])
  result.castShadow = true
  result.receiveShadow = true
  result.userData.originalMat = material
  return result
}

function addBox(
  root: THREE.Object3D,
  size: THREE.Vector3Tuple,
  position: THREE.Vector3Tuple,
  material: THREE.Material,
  rotation?: THREE.Vector3Tuple,
  name?: string,
): THREE.Mesh {
  const part = mesh(new THREE.BoxGeometry(...size, 2, 2, 2), material, position)
  if (rotation) part.rotation.set(...rotation)
  if (name) part.name = name
  root.add(part)
  return part
}

function addArm(root: THREE.Group, side: -1 | 1, shoulderY: number, upperMat: THREE.Material, leather: THREE.Material): ArmRig {
  const shoulder = new THREE.Group()
  shoulder.position.set(side * 0.47, shoulderY, 0)
  shoulder.rotation.z = side * -0.09

  const upperArm = mesh(new THREE.CapsuleGeometry(0.105, 0.19, 5, 10), upperMat, [0, -0.19, 0])
  upperArm.name = side === 1 ? 'right-upper-arm' : 'left-upper-arm'
  shoulder.add(upperArm)

  const elbow = new THREE.Group()
  elbow.position.set(0, -0.38, 0)
  const lowerArm = mesh(new THREE.CapsuleGeometry(0.085, 0.17, 5, 10), leather, [0, -0.175, 0])
  lowerArm.name = side === 1 ? 'right-forearm' : 'left-forearm'
  elbow.add(lowerArm)
  shoulder.add(elbow)

  const wrist = new THREE.Group()
  wrist.position.set(0, -0.35, 0)
  const hand = mesh(new THREE.CapsuleGeometry(0.072, 0.045, 4, 8), leather, [0, -0.09, 0])
  hand.scale.set(0.9, 1, 0.78)
  wrist.add(hand)
  elbow.add(wrist)

  const handSocket = new THREE.Group()
  handSocket.name = side === 1 ? 'right-hand-socket' : 'left-hand-socket'
  handSocket.position.set(0, -0.18, 0)
  wrist.add(handSocket)
  root.add(shoulder)
  return { shoulder, elbow, wrist, handSocket }
}

function addLeg(
  root: THREE.Group,
  side: -1 | 1,
  hipY: number,
  cloth: THREE.Material,
  leather: THREE.Material,
): LegRig {
  const hip = new THREE.Group()
  hip.position.set(side * 0.19, hipY, 0)

  const thigh = mesh(new THREE.CapsuleGeometry(0.135, 0.13, 5, 10), cloth, [0, -0.155, 0])
  thigh.name = side === 1 ? 'right-thigh' : 'left-thigh'
  hip.add(thigh)

  const knee = new THREE.Group()
  knee.position.set(0, -0.31, 0)
  const calf = mesh(new THREE.CapsuleGeometry(0.105, 0.11, 5, 10), cloth, [0, -0.13, 0])
  calf.name = side === 1 ? 'right-calf' : 'left-calf'
  knee.add(calf)
  hip.add(knee)

  const ankle = new THREE.Group()
  ankle.position.set(0, -0.26, 0)
  const foot = mesh(new THREE.BoxGeometry(0.23, 0.13, 0.42, 2, 1, 3), leather, [0, -0.065, -0.13])
  foot.geometry.translate(0, 0, -0.02)
  foot.name = side === 1 ? 'right-boot' : 'left-boot'
  ankle.add(foot)
  knee.add(ankle)
  root.add(hip)
  return { hip, knee, ankle, foot, side, forwardBendSign: -1 }
}

export function applyCharacterMountedPose(rig: CharacterRig, mounted: boolean, kind: MountedPoseKind = 'BLACK_CAT'): void {
  for (const leg of [rig.leftLeg, rig.rightLeg]) {
    if (!mounted) {
      setRigRotation(leg.hip, 0, 0, 0)
      setRigRotation(leg.knee, 0, 0, 0)
      setRigRotation(leg.ankle, 0, 0, 0)
      continue
    }
    const spread = kind === 'CORGI' ? 0.34 : kind === 'HORSE' ? 0.25 : 0.28
    const kneeBend = kind === 'CORGI' ? 1.28 : kind === 'HORSE' ? 1.22 : 1.18
    setRigRotation(leg.hip, -0.68 * leg.forwardBendSign, 0, leg.side * spread)
    setRigRotation(leg.knee, kneeBend * leg.forwardBendSign, 0, 0)
    setRigRotation(leg.ankle, (kind === 'HORSE' ? -0.44 : -0.38) * leg.forwardBendSign, 0, 0)
  }
}

function addRivetRing(root: THREE.Group, y: number, radius: number, material: THREE.Material): void {
  for (let i = 0; i < 10; i++) {
    const angle = i / 10 * Math.PI * 2
    const rivet = mesh(new THREE.SphereGeometry(0.018, 6, 4), material, [Math.cos(angle) * radius, y, Math.sin(angle) * radius * 0.82])
    root.add(rivet)
  }
}

function addVikingArmor(
  root: THREE.Group,
  bodyCenter: number,
  tier: 1 | 2 | 3,
  leather: THREE.Material,
  iron: THREE.Material,
  fur: THREE.Material,
  bronze: THREE.Material,
  accent: THREE.Material,
  rigs: { left: ArmRig, right: ArmRig },
): void {
  const cuirass = mesh(
    new THREE.CylinderGeometry(0.395, 0.335, 0.59, 16, 3),
    tier >= 2 ? iron : leather,
    [0, bodyCenter + 0.15, 0],
  )
  cuirass.scale.z = 0.82
  cuirass.name = 'viking-cuirass'
  root.add(cuirass)

  if (tier >= 2) {
    for (let i = 0; i < 5; i++) {
      const strap = mesh(new THREE.TorusGeometry(0.365 - i * 0.006, 0.018, 6, 24), leather, [0, bodyCenter + 0.37 - i * 0.11, 0])
      strap.rotation.x = Math.PI / 2
      strap.scale.z = 0.82
      root.add(strap)
    }
    addRivetRing(root, bodyCenter + 0.34, 0.36, bronze)
    for (const side of [-1, 1] as const) {
      const mantle = mesh(new THREE.SphereGeometry(0.235, 14, 8), fur, [side * 0.42, bodyCenter + 0.39, 0.02])
      mantle.scale.set(1.25, 0.52, 1.2)
      root.add(mantle)
      const bracer = mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.27, 12), leather, [0, -0.17, 0])
      bracer.name = side === 1 ? 'right-bracer' : 'left-bracer'
      rigs[side === 1 ? 'right' : 'left'].elbow.add(bracer)
    }
  }
  const emblem = mesh(new THREE.OctahedronGeometry(0.066, 0), accent, [0, bodyCenter + 0.2, -0.35])
  emblem.scale.set(0.72, 1.15, 0.28)
  root.add(emblem)
}

function addRomanArmor(
  root: THREE.Group,
  bodyCenter: number,
  tier: 1 | 2 | 3,
  iron: THREE.Material,
  bronze: THREE.Material,
  leather: THREE.Material,
  redCloth: THREE.Material,
  rigs: { left: ArmRig, right: ArmRig },
): void {
  const tunic = mesh(new THREE.CylinderGeometry(0.365, 0.32, 0.62, 16), redCloth, [0, bodyCenter + 0.08, 0])
  tunic.scale.z = 0.82
  root.add(tunic)
  if (tier >= 2) {
    for (let i = 0; i < 5; i++) {
      const band = mesh(new THREE.CylinderGeometry(0.405 - i * 0.009, 0.39 - i * 0.009, 0.13, 18), iron, [0, bodyCenter + 0.39 - i * 0.105, 0])
      band.scale.z = 0.81
      band.name = `lorica-band-${i}`
      root.add(band)
      addRivetRing(root, bodyCenter + 0.41 - i * 0.105, 0.385 - i * 0.008, bronze)
    }
    for (const side of [-1, 1] as const) {
      for (let plate = 0; plate < 3; plate++) {
        const shoulderPlate = addBox(
          rigs[side === 1 ? 'right' : 'left'].shoulder,
          [0.2 + plate * 0.025, 0.09, 0.31],
          [0, -0.06 - plate * 0.075, 0],
          plate === 0 ? bronze : iron,
          [0, 0, side * 0.05],
        )
        shoulderPlate.scale.x = 1.05
      }
    }
  }

  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2
    const strip = mesh(new THREE.BoxGeometry(0.09, 0.32, 0.025, 1, 2, 1), leather, [
      Math.cos(angle) * 0.31,
      bodyCenter - 0.36,
      Math.sin(angle) * 0.27,
    ])
    strip.rotation.y = -angle
    strip.rotation.x = 0.08
    root.add(strip)
  }
}

function addFace(root: THREE.Group, headY: number, skin: THREE.Material, hair: THREE.Material, isViking: boolean): THREE.Mesh {
  const head = mesh(new THREE.SphereGeometry(0.29, 20, 14), skin, [0, headY, 0])
  head.scale.set(0.92, 1.05, 0.9)
  head.name = 'character-head'
  root.add(head)

  const jaw = mesh(new THREE.SphereGeometry(0.22, 16, 10), skin, [0, headY - 0.14, -0.025])
  jaw.scale.set(0.9, 0.75, 0.88)
  root.add(jaw)
  const nose = mesh(new THREE.ConeGeometry(0.055, 0.16, 8), skin, [0, headY + 0.015, -0.285])
  nose.rotation.x = -Math.PI / 2
  root.add(nose)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.42 })
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.026, 8, 6), eyeMat, [side * 0.105, headY + 0.065, -0.265])
    eye.scale.y = 0.68
    root.add(eye)
    const brow = mesh(new THREE.CapsuleGeometry(0.018, 0.11, 3, 6), hair, [side * 0.105, headY + 0.125, -0.275])
    brow.rotation.z = Math.PI / 2 + side * 0.08
    root.add(brow)
    const ear = mesh(new THREE.SphereGeometry(0.065, 10, 7), skin, [side * 0.285, headY, 0])
    ear.scale.set(0.4, 1, 0.72)
    root.add(ear)
  }

  const hairCap = mesh(new THREE.SphereGeometry(0.305, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, [0, headY + 0.08, 0.015])
  root.add(hairCap)
  if (isViking) {
    for (let i = 0; i < 7; i++) {
      const angle = (i - 3) * 0.23
      const beard = mesh(new THREE.CapsuleGeometry(0.055, 0.22 + Math.abs(i - 3) * -0.018, 4, 7), hair, [
        Math.sin(angle) * 0.21,
        headY - 0.23 - Math.cos(angle) * 0.04,
        -0.24 + Math.abs(i - 3) * 0.016,
      ])
      beard.rotation.z = angle * 0.25
      root.add(beard)
    }
  }
  return head
}

function addHelmet(
  root: THREE.Group,
  headY: number,
  isViking: boolean,
  tier: 1 | 2 | 3,
  iron: THREE.Material,
  bronze: THREE.Material,
  bone: THREE.Material,
  accent: THREE.Material,
): void {
  const dome = mesh(new THREE.SphereGeometry(0.335, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), iron, [0, headY + 0.12, 0])
  dome.scale.z = 1.04
  root.add(dome)
  const brow = mesh(new THREE.TorusGeometry(0.305, 0.035, 8, 24), bronze, [0, headY + 0.075, 0])
  brow.rotation.x = Math.PI / 2
  brow.scale.z = 1.04
  root.add(brow)
  addBox(root, [0.07, 0.28, 0.055], [0, headY - 0.025, -0.31], iron, [0.08, 0, 0], 'nasal-guard')

  if (tier >= 2) {
    for (const side of [-1, 1]) {
      const cheek = addBox(root, [0.12, 0.29, 0.11], [side * 0.245, headY - 0.04, -0.02], bronze, [0, 0, side * 0.08])
      cheek.scale.z = 0.78
    }
  }

  if (isViking) {
    for (const side of [-1, 1]) {
      const collar = mesh(new THREE.CylinderGeometry(0.09, 0.105, 0.12, 10), bronze, [side * 0.29, headY + 0.29, 0])
      collar.rotation.z = side * -0.75
      root.add(collar)
      const horn = mesh(new THREE.ConeGeometry(0.082, 0.31, 10), bone, [side * 0.39, headY + 0.39, 0])
      horn.rotation.z = side * -0.72
      horn.rotation.x = side * 0.08
      root.add(horn)
    }
  } else if (tier >= 2) {
    const holder = addBox(root, [0.09, 0.12, 0.12], [0, headY + 0.38, 0], bronze)
    holder.rotation.x = 0.05
    for (let i = -5; i <= 5; i++) {
      const plume = addBox(root, [0.045, 0.24 - Math.abs(i) * 0.012, 0.065], [i * 0.052, headY + 0.5, 0], accent)
      plume.rotation.z = i * -0.025
    }
  }
}

export function buildCharacterVisual(root: THREE.Group, config: CharacterVisualConfig): CharacterVisualParts {
  const isViking = config.faction === 'viking'
  const bodyCenter = config.isPlayer ? 0 : 0.8
  const headY = bodyCenter + 0.96

  const skin = proceduralMaterial({ kind: 'skin', color: isViking ? 0xc98f63 : 0xb97b55, roughness: 0.82 })
  const cloth = proceduralMaterial({ kind: 'cloth', color: isViking ? 0x34312d : 0x74251f, roughness: 0.92, repeat: [4, 4] })
  const leather = proceduralMaterial({ kind: 'leather', color: 0x34241b, roughness: 0.83, repeat: [3, 3] })
  const iron = proceduralMaterial({ kind: 'iron', color: isViking ? 0x687278 : 0x7c8084, roughness: 0.52, metalness: 0.8 })
  const bronze = proceduralMaterial({ kind: 'bronze', color: 0xa47e4a, roughness: 0.5, metalness: 0.7 })
  const accent = proceduralMaterial({ kind: 'cloth', color: isViking ? 0x31485c : 0x8e201d, roughness: 0.86 })
  const fur = proceduralMaterial({ kind: 'fur', color: 0x8a7965, roughness: 0.98, repeat: [5, 5] })
  const hair = proceduralMaterial({ kind: 'fur', color: isViking ? 0x5b3821 : 0x2c211c, roughness: 0.96, repeat: [4, 6] })
  const bone = proceduralMaterial({ kind: 'leather', color: 0xc7aa7a, roughness: 0.76 })

  const body = new THREE.Group()
  body.position.set(0, bodyCenter, 0)
  body.name = 'character-body'
  const chest = mesh(new THREE.CylinderGeometry(0.37, 0.305, 0.37, 16, 3), cloth, [0, 0.325, 0])
  chest.scale.z = 0.82
  body.add(chest)
  const abdomen = mesh(new THREE.CylinderGeometry(0.305, 0.33, 0.25, 16, 2), cloth, [0, 0.02, 0])
  abdomen.scale.z = 0.8
  body.add(abdomen)
  const neck = mesh(new THREE.CylinderGeometry(0.145, 0.185, 0.3, 12), skin, [0, 0.66, 0])
  body.add(neck)
  root.add(body)

  const hipY = bodyCenter - 0.1
  const leftLeg = addLeg(root, -1, hipY, cloth, leather)
  const rightLeg = addLeg(root, 1, hipY, cloth, leather)
  const leftRig = addArm(root, -1, bodyCenter + 0.37, cloth, leather)
  const rightRig = addArm(root, 1, bodyCenter + 0.37, cloth, leather)

  if (isViking) addVikingArmor(root, bodyCenter, config.tier, leather, iron, fur, bronze, accent, { left: leftRig, right: rightRig })
  else addRomanArmor(root, bodyCenter, config.tier, iron, bronze, leather, accent, { left: leftRig, right: rightRig })

  const belt = mesh(new THREE.TorusGeometry(0.335, 0.035, 7, 24), leather, [0, bodyCenter - 0.1, 0])
  belt.rotation.x = Math.PI / 2
  belt.scale.z = 0.82
  root.add(belt)
  const buckle = addBox(root, [0.11, 0.09, 0.035], [0, bodyCenter - 0.1, -0.31], bronze)
  buckle.rotation.z = Math.PI / 4

  if (!isViking && config.tier >= 2) {
    for (const side of [-1, 1]) {
      const greave = mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.27, 12), bronze, [0, -0.13, -0.018])
      greave.scale.z = 0.68
      ;(side === 1 ? rightLeg : leftLeg).knee.add(greave)
    }
  }

  const head = addFace(root, headY, skin, hair, isViking)
  addHelmet(root, headY, isViking, config.tier, iron, bronze, bone, accent)

  if (config.isPlayer) {
    const quiver = mesh(new THREE.CylinderGeometry(0.105, 0.13, 0.56, 12), leather, [0.2, bodyCenter + 0.15, 0.39])
    quiver.rotation.z = -0.12
    root.add(quiver)
    for (let i = 0; i < 5; i++) {
      const arrow = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.7, 6), bronze, [0.14 + i * 0.027, bodyCenter + 0.34, 0.4])
      arrow.rotation.z = (i - 2) * 0.035
      root.add(arrow)
    }
  }

  return {
    bodyMesh: body,
    headMesh: head,
    bodyMaterial: isViking ? iron : cloth,
    headMaterial: skin,
    rightArm: rightRig.shoulder,
    leftArm: leftRig.shoulder,
    rig: { right: rightRig, left: leftRig, rightLeg, leftLeg },
  }
}

/** Converts legacy Lambert weapon parts to consistent physically based materials. */
export function polishWeaponMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const upgrade = (material: THREE.Material): THREE.Material => {
      if (!(material instanceof THREE.MeshLambertMaterial)) return material
      const color = material.color.getHex()
      const brightness = material.color.r + material.color.g + material.color.b
      return proceduralMaterial({
        kind: brightness > 1.45 ? 'iron' : brightness < 0.65 ? 'leather' : 'wood',
        color,
        roughness: brightness > 1.45 ? 0.46 : 0.74,
        metalness: brightness > 1.45 ? 0.82 : 0.04,
      })
    }
    object.material = Array.isArray(object.material) ? object.material.map(upgrade) : upgrade(object.material)
    object.userData.originalMat = object.material
    object.castShadow = true
    object.receiveShadow = true
  })
}
