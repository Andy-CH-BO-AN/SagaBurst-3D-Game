import * as THREE from 'three'

export type CharacterFaction = 'viking' | 'roman'

export interface CharacterVisualConfig {
  faction: CharacterFaction
  tier: 1 | 2 | 3
  isPlayer: boolean
}

export interface CharacterVisualParts {
  bodyMesh: THREE.Mesh
  headMesh: THREE.Mesh
  bodyMaterial: THREE.MeshStandardMaterial
  headMaterial: THREE.MeshStandardMaterial
  rightArm: THREE.Group
  leftArm: THREE.Group
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

function addLimb(root: THREE.Group, position: THREE.Vector3Tuple, material: THREE.Material, rotationZ = 0): THREE.Mesh {
  const limb = mesh(new THREE.CapsuleGeometry(0.105, 0.42, 4, 8), material, position)
  limb.rotation.z = rotationZ
  root.add(limb)
  return limb
}

export function buildCharacterVisual(root: THREE.Group, config: CharacterVisualConfig): CharacterVisualParts {
  const isViking = config.faction === 'viking'
  const bodyCenter = config.isPlayer ? 0 : 0.65
  const feetY = config.isPlayer ? -0.48 : 0.17
  const headY = config.isPlayer ? 0.95 : 1.55

  const skin = standardMaterial(0xd9a066, 0, 0.82)
  const bodyMaterial = standardMaterial(isViking ? 0x4a3420 : 0x6b6b6b, 0.05, 0.72) // Leather for Viking, Iron grey for Roman
  const cloth = standardMaterial(0x3e352f, 0, 0.85) // Neutral dark cloth
  const leather = standardMaterial(0x30251f, 0.05, 0.9)
  const iron = standardMaterial(isViking ? 0x555555 : 0x6b6b6b, 0.82, 0.28)
  const bronze = standardMaterial(0x8a7a5c, 0.7, 0.34)
  const accent = standardMaterial(isViking ? 0x3d4a5c : 0xaa2222, 0.1, 0.7) // Viking blue-grey / Roman red
  const fur = standardMaterial(0xa89880, 0, 1)

  const body = mesh(new THREE.CapsuleGeometry(0.34, 0.68, 6, 12), bodyMaterial, [0, bodyCenter, 0])
  root.add(body)

  // Legs, boots, arms and gloves give the silhouette readable joints.
  addLimb(root, [-0.19, feetY, 0], cloth, 0.02)
  addLimb(root, [0.19, feetY, 0], cloth, -0.02)
  addBox(root, [0.25, 0.18, 0.42], [-0.19, feetY - 0.22, -0.05], leather)
  addBox(root, [0.25, 0.18, 0.42], [0.19, feetY - 0.22, -0.05], leather)
  const leftArm = new THREE.Group()
  leftArm.position.set(-0.49, bodyCenter + 0.35, 0)
  leftArm.rotation.z = 0.12
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.105, 0.42, 4, 8), cloth, [0, -0.16, 0]))
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.095, 0.34, 4, 8), leather, [0, -0.47, -0.02]))
  leftArm.add(mesh(new THREE.BoxGeometry(0.18, 0.2, 0.2), leather, [0, -0.7, -0.03]))
  root.add(leftArm)

  const rightArm = new THREE.Group()
  rightArm.position.set(0.49, bodyCenter + 0.35, 0)
  rightArm.rotation.z = -0.12
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.105, 0.42, 4, 8), cloth, [0, -0.16, 0]))
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.095, 0.34, 4, 8), leather, [0, -0.47, -0.02]))
  rightArm.add(mesh(new THREE.BoxGeometry(0.18, 0.2, 0.2), leather, [0, -0.7, -0.03]))
  root.add(rightArm)

  // Layered torso: cloth underlayer, cuirass, belt and back cape/tabard.
  if (!isViking && config.tier >= 2) {
    // Roman Lorica Segmentata (banded armor)
    for (let i = 0; i < 4; i++) {
      const ring = mesh(new THREE.CylinderGeometry(0.41, 0.38, 0.15, 12), iron, [0, bodyCenter + 0.18 - i * 0.12, 0])
      ring.scale.z = 0.83
      root.add(ring)
    }
  } else {
    const cuirass = mesh(new THREE.CylinderGeometry(0.405, 0.36, 0.66, 10), config.tier >= 2 ? iron : bodyMaterial, [0, bodyCenter + 0.02, 0])
    cuirass.scale.z = 0.82
    root.add(cuirass)
  }
  
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

  const belt = mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 16), leather, [0, bodyCenter - 0.28, 0])
  belt.rotation.x = Math.PI / 2
  root.add(belt)
  
  // Cape
  if (config.tier >= 2) {
    const capeMat = standardMaterial(isViking ? 0x3d4a5c : 0x8b2e2e, 0.05, 0.9)
    const cape = mesh(new THREE.BoxGeometry(0.6, 0.75, 0.05), capeMat, [0, bodyCenter + 0.05, 0.38])
    cape.rotation.x = 0.05
    root.add(cape)
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
    addBox(root, [0.18, 0.38, 0.28], [-0.51, bodyCenter - 0.05, -0.02], iron)
    addBox(root, [0.18, 0.38, 0.28], [0.51, bodyCenter - 0.05, -0.02], iron)
  }

  if (config.tier >= 3) {
    addBox(root, [0.5, 0.22, 0.08], [0, bodyCenter + 0.15, -0.37], bronze)
    addBox(root, [0.16, 0.34, 0.08], [-0.25, bodyCenter - 0.38, -0.3], iron)
    addBox(root, [0.16, 0.34, 0.08], [0.25, bodyCenter - 0.38, -0.3], iron)
    const emblem = mesh(new THREE.OctahedronGeometry(0.075), accent, [0, bodyCenter + 0.05, -0.43])
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

  return { bodyMesh: body, headMesh: head, bodyMaterial, headMaterial: skin, rightArm, leftArm }
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
  })
}
