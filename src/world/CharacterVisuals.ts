import * as THREE from 'three'

export type CharacterFaction = 'viking' | 'roman'

export interface CharacterVisualConfig {
  faction: CharacterFaction
  tier: 1 | 2 | 3
  isPlayer: boolean
}

export interface CharacterVisualParts {
  bodyMesh: THREE.Group
  headMesh: THREE.Mesh
  bodyMaterial: THREE.MeshStandardMaterial
  headMaterial: THREE.MeshStandardMaterial
  rightArm: THREE.Group
  leftArm: THREE.Group
  rig: CharacterRig
}

export interface ArmRig {
  shoulder: THREE.Group
  elbow: THREE.Group
  wrist: THREE.Group
  handSocket: THREE.Group
}

export interface CharacterRig {
  right: ArmRig
  left: ArmRig
}

function mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material, position?: THREE.Vector3 | THREE.Vector3Tuple): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material)
  if (position instanceof THREE.Vector3) result.position.copy(position)
  else if (position) result.position.set(position[0], position[1], position[2])
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function standardMaterial(color: number, metalness = 0, roughness = 0.7, emissive = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity: emissive ? 0.35 : 0,
  })
}

function addBox(root: THREE.Group, size: THREE.Vector3Tuple, position: THREE.Vector3Tuple, material: THREE.Material, rotation?: THREE.Vector3Tuple): THREE.Mesh {
  const part = mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material, position)
  if (rotation) part.rotation.set(rotation[0], rotation[1], rotation[2])
  root.add(part)
  return part
}

function addLeg(root: THREE.Group, x: number, hipY: number, footBottomY: number, clothMat: THREE.Material, leatherMat: THREE.Material): void {
  const leg = new THREE.Group()
  leg.position.set(x, hipY, 0)
  
  const totalLength = hipY - footBottomY
  const thighLen = totalLength * 0.45
  const calfLen = totalLength * 0.40
  const bootHeight = totalLength * 0.15

  // Thigh
  const thigh = mesh(new THREE.CylinderGeometry(0.15, 0.12, thighLen, 8), clothMat, [0, -thighLen / 2, 0])
  leg.add(thigh)
  // Calf
  const calf = mesh(new THREE.CylinderGeometry(0.13, 0.10, calfLen, 8), clothMat, [0, -thighLen - calfLen / 2, -0.05])
  calf.rotation.x = 0.1 // lower leg leans toward character-forward (-Z)
  leg.add(calf)
  // Front-long/back-short boot silhouette. Character-forward is local -Z.
  const boot = mesh(new THREE.BoxGeometry(0.25, bootHeight, 0.45), leatherMat, [0, -thighLen - calfLen - bootHeight / 2, -0.12])
  boot.name = x < 0 ? 'left-boot' : 'right-boot'
  leg.add(boot)
  root.add(leg)
}

function addArm(
  root: THREE.Group,
  side: -1 | 1,
  shoulderY: number,
  clothMat: THREE.Material,
  leatherMat: THREE.Material,
): ArmRig {
  const shoulder = new THREE.Group()
  shoulder.position.set(side * 0.49, shoulderY, 0)
  shoulder.rotation.z = side * -0.12

  shoulder.add(mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.38, 8), clothMat, [0, -0.19, 0]))

  const elbow = new THREE.Group()
  elbow.position.set(0, -0.38, 0)
  const lowerArm = mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.35, 8), leatherMat, [0, -0.175, 0])
  elbow.add(lowerArm)
  shoulder.add(elbow)

  const wrist = new THREE.Group()
  wrist.position.set(0, -0.35, 0)
  const hand = mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), leatherMat, [0, -0.09, 0])
  wrist.add(hand)
  elbow.add(wrist)

  const handSocket = new THREE.Group()
  handSocket.name = side === 1 ? 'right-hand-socket' : 'left-hand-socket'
  handSocket.position.set(0, -0.18, 0)
  wrist.add(handSocket)

  root.add(shoulder)
  return { shoulder, elbow, wrist, handSocket }
}

export function buildCharacterVisual(root: THREE.Group, config: CharacterVisualConfig): CharacterVisualParts {
  const isViking = config.faction === 'viking'
  const bodyCenter = config.isPlayer ? 0 : 0.8
  const headY = bodyCenter + 0.95 // Standardize head height relative to bodyCenter

  const skin = standardMaterial(0xd9a066, 0, 0.82)
  const bodyMaterial = standardMaterial(isViking ? 0x4a3420 : 0x6b6b6b, 0.05, 0.72) // Leather for Viking, Iron grey for Roman
  const cloth = standardMaterial(0x3e352f, 0, 0.85) // Neutral dark cloth
  const leather = standardMaterial(0x30251f, 0.05, 0.9)
  const iron = standardMaterial(isViking ? 0x555555 : 0x6b6b6b, 0.82, 0.28)
  const bronze = standardMaterial(0x8a7a5c, 0.7, 0.34)
  const accent = standardMaterial(isViking ? 0x3d4a5c : 0xaa2222, 0.1, 0.7) // Viking blue-grey / Roman red
  const fur = standardMaterial(0xa89880, 0, 1)

  const body = new THREE.Group()
  body.position.set(0, bodyCenter, 0)
  
  // Chest (Wider top, tapered bottom)
  const chest = mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.35, 10), bodyMaterial, [0, 0.325, 0])
  chest.userData.originalMat = bodyMaterial
  body.add(chest)
  
  // Abdomen (Waist)
  const abdomen = mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.25, 10), bodyMaterial, [0, 0.025, 0])
  abdomen.userData.originalMat = bodyMaterial
  body.add(abdomen)

  // Neck - made taller to penetrate head and chest, avoiding visual gaps from sphere curvature
  const neck = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.35, 8), skin, [0, 0.65, 0])
  neck.userData.originalMat = skin
  body.add(neck)
  
  root.add(body)

  // Legs and boots
  const hipY = bodyCenter - 0.10
  const footBottomY = config.isPlayer ? -0.8 : 0
  addLeg(root, -0.2, hipY, footBottomY, cloth, leather)
  addLeg(root, 0.2, hipY, footBottomY, cloth, leather)

  const leftRig = addArm(root, -1, bodyCenter + 0.35, cloth, leather)
  const rightRig = addArm(root, 1, bodyCenter + 0.35, cloth, leather)
  const leftArm = leftRig.shoulder
  const rightArm = rightRig.shoulder

  // Layered torso: cloth underlayer, cuirass, belt and back cape/tabard.
  if (!isViking && config.tier >= 2) {
    // Roman Lorica Segmentata (banded armor)
    for (let i = 0; i < 4; i++) {
      const ring = mesh(new THREE.CylinderGeometry(0.41, 0.38, 0.15, 12), iron, [0, bodyCenter + 0.28 - i * 0.12, 0])
      ring.scale.z = 0.83
      root.add(ring)
    }
  } else {
    // Viking Cuirass
    const cuirass = mesh(new THREE.CylinderGeometry(0.405, 0.36, 0.60, 10), config.tier >= 2 ? iron : bodyMaterial, [0, bodyCenter + 0.15, 0])
    cuirass.scale.z = 0.85
    root.add(cuirass)
  }

  // Belt
  const belt = mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 16), leather, [0, bodyCenter - 0.10, 0])
  belt.rotation.x = Math.PI / 2
  root.add(belt)

  // Cape removed due to clipping with dynamic back shield and quiver

  if (!isViking) {
    // Roman Pteruges (Leather skirt strips)
    const pterugesMat = standardMaterial(0x6b4423, 0.05, 0.9)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      const strip = mesh(new THREE.BoxGeometry(0.08, 0.28, 0.02), pterugesMat, [
        Math.cos(angle) * 0.32,
        bodyCenter - 0.38,
        Math.sin(angle) * 0.32
      ])
      strip.rotation.y = -angle
      strip.rotation.x = 0.1 // slight outward flare
      root.add(strip)
    }
  }

  if (config.tier >= 2) {
    const shoulderMaterial = isViking ? fur : bronze
    const leftShoulder = mesh(new THREE.SphereGeometry(0.2, 10, 6), shoulderMaterial, [-0.43, bodyCenter + 0.34, 0])
    leftShoulder.scale.set(1.15, 0.55, 1.25)
    root.add(leftShoulder)
    const rightShoulder = mesh(new THREE.SphereGeometry(0.2, 10, 6), shoulderMaterial, [0.43, bodyCenter + 0.34, 0])
    rightShoulder.scale.set(1.15, 0.55, 1.25)
    root.add(rightShoulder)
    if (isViking) {
      for (const side of [-1, 1]) {
        for (let i = -1; i <= 1; i++) {
          const tuft = mesh(new THREE.IcosahedronGeometry(0.11, 0), fur, [side * (0.43 + Math.abs(i) * 0.08), bodyCenter + 0.27 + Math.abs(i) * 0.04, i * 0.13])
          tuft.scale.set(1, 0.7, 1.2)
          root.add(tuft)
        }
      }
    }
    // Upper-arm plates follow the FK shoulders instead of masking the moving arms.
    addBox(leftRig.shoulder, [0.17, 0.30, 0.23], [0, -0.17, 0], iron)
    addBox(rightRig.shoulder, [0.17, 0.30, 0.23], [0, -0.17, 0], iron)
  }

  if (config.tier >= 3) {
    addBox(root, [0.5, 0.22, 0.08], [0, bodyCenter + 0.30, -0.37], bronze)
    addBox(root, [0.16, 0.34, 0.08], [-0.25, bodyCenter - 0.15, -0.3], iron)
    addBox(root, [0.16, 0.34, 0.08], [0.25, bodyCenter - 0.15, -0.3], iron)
  }

  if (isViking && config.tier >= 2) {
    // Viking Rune emblem on chest
    const emblem = mesh(new THREE.OctahedronGeometry(0.075), accent, [0, bodyCenter + 0.20, -0.43])
    root.add(emblem)
  }

  const head = mesh(new THREE.SphereGeometry(0.31, 12, 8), skin, [0, headY, 0])
  root.add(head)

  // Helmet dome, brow, cheek guards and faction-specific crest.
  const helmet = mesh(new THREE.SphereGeometry(0.39, 12, 8), iron, [0, headY + 0.16, 0])
  helmet.scale.set(1, 0.62, 1)
  root.add(helmet)
  const brow = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.065, 12), bronze, [0, headY + 0.02, 0])
  root.add(brow)
  addBox(root, [0.42, 0.08, 0.07], [0, headY + 0.01, -0.34], iron)
  if (config.tier >= 2) {
    addBox(root, [0.13, 0.36, 0.16], [-0.29, headY - 0.02, 0], bronze)
    addBox(root, [0.13, 0.36, 0.16], [0.29, headY - 0.02, 0], bronze)
  }
  if (isViking) {
    const hornMaterial = standardMaterial(0x3a2a1a, 0.05, 0.72) // dark horns
    const leftHorn = mesh(new THREE.ConeGeometry(0.105, 0.42, 7), hornMaterial, [-0.27, headY + 0.42, 0])
    leftHorn.rotation.z = -0.45
    root.add(leftHorn)
    const rightHorn = mesh(new THREE.ConeGeometry(0.105, 0.42, 7), hornMaterial, [0.27, headY + 0.42, 0])
    rightHorn.rotation.z = 0.45
    root.add(rightHorn)
  } else if (config.tier >= 2) {
    // Roman transverse crest (Red)
    const crestMat = standardMaterial(0xaa2222, 0.05, 0.8)
    const crest = mesh(new THREE.BoxGeometry(0.6, 0.15, 0.08), crestMat, [0, headY + 0.45, 0])
    const crestHolder = mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), bronze, [0, headY + 0.38, 0])
    root.add(crest)
    root.add(crestHolder)
  }

  if (!isViking && config.tier >= 2) {
    for (let i = 0; i < 3; i++) {
      addBox(root, [0.68, 0.065, 0.08], [0, bodyCenter - 0.18 + i * 0.16, -0.36], bronze)
    }
  }

  if (config.isPlayer) {
    // Quiver for Player
    addBox(root, [0.18, 0.55, 0.15], [0, bodyCenter + 0.15, 0.42], leather)
    // Arrows in quiver
    for (let i = 0; i < 5; i++) {
      const arrow = mesh(new THREE.BoxGeometry(0.02, 0.65, 0.02), bronze, [-0.06 + i * 0.03, bodyCenter + 0.3, 0.42])
      arrow.rotation.z = 0.1 * (i - 2) // Fan out slightly
      root.add(arrow)
    }
  }

  return {
    bodyMesh: body,
    headMesh: head,
    bodyMaterial,
    headMaterial: skin,
    rightArm,
    leftArm,
    rig: { right: rightRig, left: leftRig },
  }
}

/** Converts legacy Lambert weapon parts to consistent physically based materials. */
export function polishWeaponMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const upgrade = (material: THREE.Material): THREE.Material => {
      if (!(material instanceof THREE.MeshLambertMaterial)) return material
      return new THREE.MeshStandardMaterial({
        color: material.color,
        roughness: 0.32,
        metalness: 0.62,
      })
    }
    object.material = Array.isArray(object.material)
      ? object.material.map(upgrade)
      : upgrade(object.material)
    object.userData.originalMat = object.material
  })
}
