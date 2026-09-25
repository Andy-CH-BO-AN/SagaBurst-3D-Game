import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CharacterFaction } from './CharacterVisuals'
import { proceduralMaterial } from './ProceduralMaterials'
import { DEFAULT_BOW_GRIP_PROFILE } from './BowAttachmentContract'
import { equipmentDetail, equipmentShadowUntil } from './EquipmentVisualLODController'
import { LANCE_RADIUS } from './EquipmentAttachmentContract'
import { WEAPONS } from '../rpg/WeaponDatabase'

function profiledBladeGeometry(length: number, widths: number[], thickness: number): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const stationCount = widths.length
  for (let station = 0; station < stationCount; station++) {
    const y = length * station / (stationCount - 1)
    const halfWidth = widths[station] / 2
    positions.push(
      halfWidth, y, 0,
      0, y, thickness / 2,
      -halfWidth, y, 0,
      0, y, -thickness / 2,
    )
    const v = station / (stationCount - 1)
    uvs.push(1, v, 0.5, v, 0, v, 0.5, v)
  }
  for (let station = 0; station < stationCount - 1; station++) {
    const base = station * 4
    const next = (station + 1) * 4
    for (let face = 0; face < 4; face++) {
      const adjacent = (face + 1) % 4
      indices.push(base + face, next + face, next + adjacent, base + face, next + adjacent, base + adjacent)
    }
  }
  indices.push(0, 3, 2, 0, 2, 1)
  const tip = (stationCount - 1) * 4
  indices.push(tip, tip + 1, tip + 2, tip, tip + 2, tip + 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/** Only builder-owned, rigid siblings with identical material/render state belong here. */
function mergeRigidGeometryParts(parts: THREE.Mesh[], material: THREE.Material, name: string): THREE.Mesh {
  const first = parts[0]
  if (!first || parts.some(part => part.material !== material
    || part.parent !== first.parent || part.children.length > 0
    || part instanceof THREE.SkinnedMesh || Object.keys(part.geometry.morphAttributes).length > 0
    || part.castShadow !== first.castShadow || part.receiveShadow !== first.receiveShadow
    || part.visible !== first.visible || part.layers.mask !== first.layers.mask
    || part.renderOrder !== first.renderOrder || part.frustumCulled !== first.frustumCulled)) {
    throw new Error('Rigid equipment parts must share material, parent and render state')
  }
  const geometries = parts.map(part => {
    part.updateMatrix()
    const geometry = part.geometry.clone().applyMatrix4(part.matrix)
    // OctahedronGeometry is non-indexed; keep every original vertex and triangle.
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i))
    return geometry
  })
  let geometry: THREE.BufferGeometry | null
  try {
    geometry = mergeGeometries(geometries, false)
  } finally {
    for (const temporary of geometries) temporary.dispose()
  }
  if (!geometry) throw new Error('Incompatible rigid equipment geometry attributes')
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const merged = new THREE.Mesh(geometry, material)
  merged.name = name
  merged.castShadow = first.castShadow
  merged.receiveShadow = first.receiveShadow
  merged.visible = first.visible
  merged.layers.mask = first.layers.mask
  merged.renderOrder = first.renderOrder
  merged.frustumCulled = first.frustumCulled
  // These explicitly supplied parts are discarded, never cached or runtime-moving.
  for (const part of parts) part.removeFromParent()
  for (const source of new Set(parts.map(part => part.geometry))) source.dispose()
  return merged
}

function addWrappedGrip(pivot: THREE.Group, length: number, radius: number, y: number, leather: THREE.Material, metal: THREE.Material): THREE.Mesh[] {
  const handle = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, length, 12), leather), -1)
  handle.position.y = y
  pivot.add(handle)
  const wraps: THREE.Mesh[] = []
  for (let ring = 0; ring < 7; ring++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.1, 6, 16), metal)
    wrap.rotation.x = Math.PI / 2
    wrap.position.y = y - length / 2 + (ring + 0.5) * length / 7
    pivot.add(wrap)
    wraps.push(wrap)
  }
  return wraps
}


function curvedLimb(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, radius, 8, false), material)
}

function bendShieldGeometry(geometry: THREE.BoxGeometry, width: number, curve: number): THREE.BoxGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const normalized = x / (width / 2)
    position.setZ(index, position.getZ(index) + curve * (1 - normalized * normalized))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function curvedRectangleRim(width: number, height: number, curve: number, frontZ: number, radius: number, material: THREE.Material): THREE.Mesh {
  const points: THREE.Vector3[] = []
  const steps = 8
  const addEdge = (from: THREE.Vector2, to: THREE.Vector2) => {
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      const x = THREE.MathUtils.lerp(from.x, to.x, t)
      const y = THREE.MathUtils.lerp(from.y, to.y, t)
      const z = frontZ + curve * (1 - (x / (width / 2)) ** 2)
      points.push(new THREE.Vector3(x, y, z))
    }
  }
  addEdge(new THREE.Vector2(-width / 2, height / 2), new THREE.Vector2(width / 2, height / 2))
  addEdge(new THREE.Vector2(width / 2, height / 2), new THREE.Vector2(width / 2, -height / 2))
  addEdge(new THREE.Vector2(width / 2, -height / 2), new THREE.Vector2(-width / 2, -height / 2))
  addEdge(new THREE.Vector2(-width / 2, -height / 2), new THREE.Vector2(-width / 2, height / 2))
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 56, radius, 8, true), material)
}

export interface NpcRangedMeshParts {
  stringTop?: THREE.Mesh
  stringBottom?: THREE.Mesh
  nockedArrow?: THREE.Group
}

export class WeaponMeshFactory {
  /**
   * 建構近戰武器的 3D mesh group，附加到指定 pivot
   */
  static buildMelee(weaponId: string, pivot: THREE.Group): { tipLocal: THREE.Vector3 } {
    const tipLocal = new THREE.Vector3(0, 1.2, 0)
    pivot.userData.gripCenterLocal = [0, 0.15, 0]

    if (weaponId === 'gladius_rusty' || weaponId === 'gladius_standard' || weaponId === 'centurion_blade') {
      const tier = weaponId === 'gladius_rusty' ? 1 : weaponId === 'centurion_blade' ? 3 : 2
      return { tipLocal: this.buildRomanGladius(tier, pivot) }
    }

    if (weaponId === 'steel_lance' || weaponId === 'hunting_spear' || weaponId === 'heavy_lance' || WEAPONS[weaponId]?.combatKind === 'lance') {
      pivot.userData.supportPointLocal = [0, 0.33, 0]
      pivot.userData.forwardAxisLocal = [0, 1, 0]
      pivot.userData.tipLocal = [0, 2.6, 0]
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true })
      const headMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })

      // The lance is held near the back. The pole goes from y = -0.5 to y = 2.0
      const pole = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(LANCE_RADIUS, LANCE_RADIUS, 2.5, 12), poleMat), 1)
      pole.position.y = 0.75 // Center of pole (2.5/2 = 1.25, minus offset to hold it lower)
      pivot.add(pole)

      // Lance cone head
      const head = equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 8), headMat), 1)
      head.position.y = 2.3 // 0.75 + 1.25 + 0.3
      head.castShadow = true
      pivot.add(head)
      tipLocal.set(0, 2.6, 0)

    } else if (weaponId === 'viking_axe_t1' || weaponId === 'viking_axe_t2' || weaponId === 'viking_axe_t3') {
      const tier = WEAPONS[weaponId].tier
      const wood = proceduralMaterial({ kind: 'wood', color: tier === 3 ? 0x5b3d29 : 0x65472d, roughness: 0.75 })
      const leather = proceduralMaterial({ kind: 'leather', color: tier === 3 ? 0x302b36 : 0x3c3028, roughness: 0.82 })
      const iron = proceduralMaterial({
        kind: 'iron', color: tier === 1 ? 0x797875 : tier === 2 ? 0xb4bdc0 : 0xc9c5b2,
        roughness: tier === 1 ? 0.49 : 0.34, metalness: 0.8,
      })

      // The 1.44 m haft starts below the axe head; the hand stays 0.15 m above its butt.
      const haft = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.03, 1.44, 8), wood), 1)
      haft.position.y = 0.72
      haft.castShadow = true
      haft.name = 'dane-axe-haft'
      pivot.add(haft)

      const grip = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.22, 8), leather), 1)
      grip.position.y = 0.15
      grip.name = 'dane-axe-grip'
      pivot.add(grip)

      const socket = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.24, 8), iron), 1)
      socket.position.y = 1.30
      socket.castShadow = true
      socket.name = 'dane-axe-socket'
      pivot.add(socket)

      // One broad cutting edge on +X and a hooked beard below the socket.
      const outline = new THREE.Shape()
      outline.moveTo(0.025, 1.38)
      outline.lineTo(0.17, 1.42)
      outline.lineTo(0.31, 1.45)
      outline.lineTo(0.33, 1.32)
      outline.lineTo(0.33, 1.11)
      outline.lineTo(0.27, 1.00)
      outline.lineTo(0.16, 0.99)
      outline.lineTo(0.18, 1.13)
      outline.lineTo(0.025, 1.18)
      outline.closePath()
      const blade = equipmentShadowUntil(new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.032, bevelEnabled: false }), iron), 1)
      blade.position.z = -0.016
      blade.castShadow = true
      blade.name = 'dane-axe-single-bearded-blade'
      pivot.add(blade)

      // Splay only the visible axe outward from the hand so it clears the horse.
      // The sword hit reference remains fixed on the original animation path.
      const visual = new THREE.Group()
      visual.name = 'dane-axe-visual'
      visual.position.y = 0.15
      visual.rotation.x = 0.45
      for (const part of [...pivot.children]) {
        part.position.y -= 0.15
        visual.add(part)
      }
      pivot.add(visual)

      // Keep the sword's hit reference and range even though the visible haft ends at 1.45 m.
      tipLocal.set(0, 1.51, 0)
    } else {
      const tier = weaponId === 'rusty_dagger' ? 1 : weaponId === 'runic_greatsword' ? 3 : 2
      const leather = proceduralMaterial({
        kind: 'leather', color: tier === 1 ? 0x4a3428 : tier === 3 ? 0x252038 : 0x3f2b21,
        roughness: 0.82, repeat: [2, tier + 2],
      })
      const steel = proceduralMaterial({
        kind: 'iron', color: tier === 1 ? 0x77716b : tier === 3 ? 0xd8d3bd : 0xc2c7c9,
        roughness: tier === 1 ? 0.48 : 0.27, metalness: tier === 1 ? 0.72 : 0.92, repeat: [tier + 1, 5],
      })
      const darkSteel = proceduralMaterial({
        kind: tier === 3 ? 'bronze' : 'iron', color: tier === 1 ? 0x47413d : tier === 3 ? 0xb78a42 : 0x555c60,
        roughness: 0.38, metalness: 0.82, repeat: [2, tier + 3],
      })
      const fullerMaterial = tier === 3
        ? proceduralMaterial({ kind: 'iron', color: 0x3e6d86, roughness: 0.24, metalness: 0.9, repeat: [2, 8] })
        : darkSteel
      const wraps = addWrappedGrip(pivot, 0.29, 0.037, 0.15, leather, darkSteel)

      const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.064, 1), darkSteel)
      pommel.scale.set(0.92, 1.18, 0.72)
      pommel.position.y = -0.035
      pivot.add(pommel)

      const guard = curvedLimb([
        new THREE.Vector3(-0.23, 0, 0.02),
        new THREE.Vector3(-0.1, 0.018, 0),
        new THREE.Vector3(0, 0.025, 0),
        new THREE.Vector3(0.1, 0.018, 0),
        new THREE.Vector3(0.23, 0, 0.02),
      ], 0.027, darkSteel)
      guard.position.y = 0.31
      pivot.add(guard)

      const blade = equipmentShadowUntil(new THREE.Mesh(profiledBladeGeometry(1.18, [0.105, 0.102, 0.086, 0.052, 0.004], 0.038), steel), 1)
      blade.position.y = 0.33
      blade.name = 'steel-sword-profiled-blade'
      blade.castShadow = true
      pivot.add(blade)
      const fullerFront = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.78, 0.004, 1, 8, 1), fullerMaterial)
      fullerFront.position.set(0, 0.82, 0.021)
      pivot.add(fullerFront)
      const fullerBack = fullerFront.clone()
      fullerBack.position.z = -0.021
      pivot.add(fullerBack)
      pivot.add(equipmentShadowUntil(mergeRigidGeometryParts([...wraps, pommel, guard], darkSteel, 'sword-grip-metal'), 1))
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts([fullerFront, fullerBack], fullerMaterial, 'sword-fullers'), 0), -1))

      tipLocal.set(0, 1.51, 0)
    }

    pivot.rotation.set(0, 0, 0)

    return { tipLocal }
  }

  /**
   * 建構遠程武器的 3D mesh group
   */
  static buildRanged(weaponId: string, pivot: THREE.Group, consolidateMaterialGroups = false): { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number } {
    const profile = DEFAULT_BOW_GRIP_PROFILE
    const halfSpan = weaponId === 'wooden_shortbow' ? 0.62 : weaponId === 'elven_runebow' ? 1.02 : 0.85
    const bowModel = new THREE.Group()
    bowModel.name = 'bow-model'
    pivot.add(bowModel)
    const wood = proceduralMaterial({ kind: 'wood', color: weaponId === 'elven_runebow' ? 0x8b846c : 0x795331, roughness: 0.7 })
    const leather = proceduralMaterial({ kind: 'leather', color: 0x423025, roughness: 0.85 })
    // One connected surface: the central rings form the straight leather grip,
    // and the same rings continue into tapered wood. Separate open cylinders
    // previously exposed jagged triangular overlaps at the grip/limb junction.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, profile.gripLength / 2, 0),
      new THREE.Vector3(0, profile.gripLength / 2 + 0.045, 0),
      new THREE.Vector3(0, halfSpan * 0.3, -0.045),
      new THREE.Vector3(0, halfSpan * 0.72, -0.13),
      new THREE.Vector3(0, halfSpan, -0.035),
    ])
    const rings: Array<{ center: THREE.Vector3; tangent: THREE.Vector3; radius: number }> = []
    for (const side of [-1, 1]) {
      for (let step = 0; step <= 40; step++) {
        const t = side < 0 ? 1 - step / 40 : step / 40
        const center = curve.getPointAt(t)
        const tangent = t === 0 ? new THREE.Vector3(0, 1, 0) : curve.getTangentAt(t)
        center.y *= side
        tangent.z *= side
        rings.push({ center, tangent, radius: profile.gripRadius * THREE.MathUtils.lerp(1, 0.38, t) })
      }
    }
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
    const sides = 16
    for (const ring of rings) {
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), ring.tangent).normalize()
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2
        const point = ring.center.clone().addScaledVector(across, Math.cos(angle) * ring.radius)
        point.x += Math.sin(angle) * ring.radius
        vertices.push(...point.toArray())
        uvs.push(j / sides, (ring.center.y + halfSpan) / (halfSpan * 2))
      }
    }
    const geometry = new THREE.BufferGeometry()
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const start = indices.length
      for (let j = 0; j < sides; j++) {
        const a = ring * (sides + 1) + j, b = a + sides + 1
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
      const materialIndex = ring === 40 ? 1 : 0
      const previous = geometry.groups[geometry.groups.length - 1]
      // NPC bows: contiguous wood rings share one draw range. Preserve index
      // order and the leather boundary; Player/pickup builders keep their path.
      if (consolidateMaterialGroups && previous?.materialIndex === materialIndex) {
        previous.count += indices.length - start
      } else {
        geometry.addGroup(start, indices.length - start, materialIndex)
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const stave = equipmentShadowUntil(new THREE.Mesh(geometry, [wood, leather]), 1)
    stave.name = 'bow-stave-and-grip'
    bowModel.add(stave)
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(profile.gripRadius * 0.38, 10, 8), wood)
      cap.position.set(0, side * halfSpan, -0.035)
      bowModel.add(equipmentShadowUntil(equipmentDetail(cap, 0), -1))
    }
    const topTip = new THREE.Vector3(0, halfSpan, -0.035)
    const botTip = new THREE.Vector3(0, -halfSpan, -0.035)
    return { topTip, botTip, stringLength: halfSpan }
  }

  /**
   * 建構地面掉落用的簡化武器模型
   */
  static buildPickupMesh(weaponId: string, isArrowPack: boolean, colorHex: number, pivot: THREE.Group): void {
    if (isArrowPack) {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.3 })
      for (let i = 0; i < 5; i++) {
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 6), mat)
        arrow.position.set((i - 2) * 0.035, 0.45, 0)
        pivot.add(arrow)
      }
    } else if (weaponId.includes('bow')) {
      const bowGroup = new THREE.Group()
      this.buildRanged(weaponId, bowGroup)
      bowGroup.scale.setScalar(0.62)
      bowGroup.rotation.z = Math.PI / 2
      bowGroup.position.y = 0.45
      pivot.add(bowGroup)
    } else if (weaponId.includes('shield') || weaponId.includes('scutum')) {
      WeaponMeshFactory.buildShield(weaponId, pivot)
      pivot.position.y = 0.5
    } else {
      const swordGroup = new THREE.Group()
      this.buildMelee(weaponId, swordGroup)
      swordGroup.scale.setScalar(0.62)
      swordGroup.position.y = 0.2
      pivot.add(swordGroup)
    }
  }

  /**
   * 建構 NPC 專用近戰武器（含羅馬/維京差異）
   */
  static buildRomanGladius(tier: number, pivot: THREE.Group): THREE.Vector3 {
    pivot.userData.gripCenterLocal = [0, 0.1, 0]
    let bladeColor = 0x77716b
    const bladeLength = 0.68
    const bladeWidth = 0.105
    let metalness = 0.72

    if (tier === 2) {
      bladeColor = 0xbfc3c3
      metalness = 0.8
    } else if (tier === 3) {
      bladeColor = 0xd6d2b4
      metalness = 1.0
    }

    const bladeMat = proceduralMaterial({ kind: 'iron', color: bladeColor, metalness, roughness: tier === 1 ? 0.48 : 0.3, repeat: [tier + 1, 5] })
    const handleMat = proceduralMaterial({ kind: 'leather', color: tier === 3 ? 0x4d241c : 0x3a2117, roughness: 0.82, repeat: [2, tier + 2] })
    const pommelMat = proceduralMaterial({ kind: tier === 3 ? 'bronze' : 'iron', color: tier === 3 ? 0xb38a4c : 0x575b5d, metalness: 0.8, roughness: 0.38 })

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pommelMat)
    pommel.scale.y = 0.78
    pivot.add(pommel)
    const wraps = addWrappedGrip(pivot, 0.16, 0.028, 0.1, handleMat, pommelMat)
    const guard = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), pommelMat)
    guard.scale.set(1.3, 0.38, 0.65)
    guard.position.y = 0.2
    pivot.add(guard)
    const blade = equipmentShadowUntil(new THREE.Mesh(profiledBladeGeometry(bladeLength, [bladeWidth * 0.72, bladeWidth, bladeWidth * 0.92, bladeWidth * 0.58, 0.004], 0.034), bladeMat), 1)
    blade.position.y = 0.2
    blade.name = 'roman-gladius-profiled-blade'
    pivot.add(blade)
    pivot.add(equipmentShadowUntil(mergeRigidGeometryParts([pommel, ...wraps, guard], pommelMat, 'gladius-grip-metal'), 1))
    return new THREE.Vector3(0, 0.2 + bladeLength, 0)
  }

  static buildNpcMelee(characterFaction: CharacterFaction, tier: number, isLance: boolean, pivot: THREE.Group, weaponId?: string): THREE.Vector3 {
    if (weaponId) {
      if (weaponId.startsWith('gladius_') || weaponId === 'centurion_blade') {
        const gladiusTier = weaponId === 'gladius_rusty' ? 1 : weaponId === 'gladius_standard' ? 2 : 3
        return this.buildRomanGladius(gladiusTier, pivot)
      }
      return this.buildMelee(weaponId, pivot).tipLocal
    }
    if (isLance) return this.buildMelee('steel_lance', pivot).tipLocal

    if (characterFaction === 'viking') {
      const wId = tier === 1 ? 'rusty_dagger' : tier === 2 ? 'steel_sword' : 'runic_greatsword'
      return this.buildMelee(wId, pivot).tipLocal
    }
    return this.buildRomanGladius(tier, pivot)
  }

  /**
   * 建構 NPC 專用遠程武器（羅馬標槍 vs 維京弓）
   */
  static buildNpcRanged(characterFaction: CharacterFaction, tier: number, pivot: THREE.Group): NpcRangedMeshParts {
    if (characterFaction === 'roman') {
      // Roman Pilum (Javelin)
      const woodMat = proceduralMaterial({ kind: 'wood', color: 0x68452c, roughness: 0.78, repeat: [2, 7] })
      const ironMat = proceduralMaterial({ kind: 'iron', color: 0x777d7f, roughness: 0.36, metalness: 0.82 })
      const goldMat = proceduralMaterial({ kind: 'bronze', color: 0xa98248, roughness: 0.4, metalness: 0.74 })

      const shaft = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, 1.2, 10), woodMat), 1)
      shaft.position.y = 0.6
      pivot.add(shaft)

      const socket = equipmentShadowUntil(equipmentDetail(new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.023, 0.16, 10), ironMat), 1), -1)
      socket.position.y = 1.24
      pivot.add(socket)

      if (tier === 1) {
        const head = equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), ironMat), 1)
        head.position.y = 1.275
        pivot.add(head)
      } else if (tier === 2) {
        const neck = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, 0.4, 8), ironMat), 1)
        neck.position.y = 1.4
        pivot.add(neck)

        const head = equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 4), ironMat), 1)
        head.position.y = 1.65
        pivot.add(head)
      } else {
        const neck = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.5, 8), ironMat), 1)
        neck.position.y = 1.45
        pivot.add(neck)

        const wrap = equipmentShadowUntil(equipmentDetail(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), goldMat), 0), -1)
        wrap.position.y = 1.2
        pivot.add(wrap)

        const head = equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), ironMat), 1)
        head.position.y = 1.775
        pivot.add(head)
      }

      return {}
    } else {
      // Viking Bow
      const bowMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })

      const upperCurve = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.5, 6), bowMat), 1)
      upperCurve.position.set(0, 0.25, 0)
      upperCurve.rotation.z = -0.1
      pivot.add(upperCurve)

      const lowerCurve = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.5, 6), bowMat), 1)
      lowerCurve.position.set(0, -0.25, 0)
      lowerCurve.rotation.z = 0.1
      pivot.add(lowerCurve)

      const stringMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, flatShading: true })
      const stringTop = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat), -1)
      const stringBottom = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat), -1)
      pivot.add(stringTop, stringBottom)

      const nockedArrow = new THREE.Group()
      equipmentShadowUntil(nockedArrow, -1)
      const shaft = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), bowMat), -1)
      shaft.rotation.x = Math.PI / 2
      nockedArrow.add(shaft)
      const arrowHead = equipmentShadowUntil(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 6), new THREE.MeshLambertMaterial({ color: 0xaaaaaa })), -1)
      arrowHead.rotation.x = -Math.PI / 2
      arrowHead.position.z = -0.45
      nockedArrow.add(arrowHead)
      pivot.add(nockedArrow)
      return { stringTop, stringBottom, nockedArrow }
    }
  }

  /**
   * 建構盾牌的 3D mesh group，附加到指定 pivot
   */
  static buildShield(shieldId: string, pivot: THREE.Group): void {
    pivot.userData.gripCenterLocal = [0, 0, 0.085]
    const isRoman = shieldId.startsWith('scutum')
    const tier = parseInt(shieldId.split('_t')[1]) || 1
    const iron = proceduralMaterial({ kind: 'iron', color: tier === 3 ? 0xbfc2bd : 0x686d70, roughness: 0.4, metalness: 0.82 })
    const bronze = proceduralMaterial({ kind: 'bronze', color: 0xa47b42, roughness: 0.43, metalness: 0.72 })
    const leather = proceduralMaterial({ kind: 'leather', color: 0x3d281d, roughness: 0.86 })

    if (isRoman) {
      const width = 0.58, height = 0.98, depth = 0.055, curve = 0.13, boardZ = 0.02
      const frontZ = boardZ + depth / 2
      const boardMat = proceduralMaterial({ kind: 'leather', color: tier === 1 ? 0x68412b : 0x7f211d, roughness: 0.78, repeat: [4, 5] })
      const board = equipmentShadowUntil(new THREE.Mesh(bendShieldGeometry(new THREE.BoxGeometry(width, height, depth, 12, 14, 1), width, curve), boardMat), 1)
      board.position.z = boardZ
      board.name = 'curved-scutum-board'
      board.castShadow = true
      board.receiveShadow = true
      pivot.add(board)
      const rim = equipmentShadowUntil(curvedRectangleRim(width, height, curve, frontZ, 0.022, tier >= 2 ? iron : leather), 0)
      rim.name = 'scutum-rim'
      pivot.add(rim)

      const boss = equipmentShadowUntil(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron), -1)
      boss.position.set(0, 0, frontZ + curve + 0.025)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      const emblemMat = tier === 3 ? bronze : proceduralMaterial({ kind: 'bronze', color: 0x9a7445, roughness: 0.55, metalness: 0.5 })
      const emblems: THREE.Mesh[] = []
      for (const rotation of [Math.PI / 4, -Math.PI / 4]) {
        // Bend in shield space after rotating so the whole ornament follows the face.
        const geometry = new THREE.BoxGeometry(0.035, 0.34, 0.012, 1, 5, 1)
        geometry.rotateZ(rotation)
        geometry.translate(0, 0.08, frontZ + 0.003)
        const wing = new THREE.Mesh(bendShieldGeometry(geometry, width, curve), emblemMat)
        wing.name = 'scutum-emblem'
        pivot.add(wing)
        emblems.push(wing)
      }
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(emblems, emblemMat, 'scutum-emblem'), 1), -1))
      const rearGrip = equipmentShadowUntil(new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.2, 4, 8), leather), -1)
      rearGrip.position.set(0, 0, 0.085)
      rearGrip.rotation.z = Math.PI / 2
      rearGrip.name = 'shield-rear-grip'
      pivot.add(equipmentDetail(rearGrip, 0))
    } else {
      const wood = proceduralMaterial({ kind: 'wood', color: 0x65452d, roughness: 0.84, repeat: [5, 3] })
      const paint = proceduralMaterial({ kind: 'wood', color: tier === 3 ? 0x294d64 : 0x435443, roughness: 0.82, repeat: [5, 3] })
      const board = equipmentShadowUntil(new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.052, 32), tier >= 2 ? paint : wood), 1)
      board.rotation.x = Math.PI / 2
      board.position.z = 0.15
      board.name = 'round-shield-board'
      board.castShadow = true
      pivot.add(board)
      const leatherDetails: THREE.Mesh[] = []
      for (let seam = -3; seam <= 3; seam++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.72 - Math.abs(seam) * 0.055, 0.008), leather)
        line.position.set(seam * 0.1, 0, 0.18)
        pivot.add(line)
        leatherDetails.push(line)
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.023, 10, 32), tier >= 2 ? iron : leather)
      rim.position.z = 0.18
      pivot.add(equipmentShadowUntil(equipmentDetail(rim, 1), 0))
      const boss = equipmentShadowUntil(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron), -1)
      boss.position.set(0, 0, 0.205)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      for (const y of [-0.14, 0.14]) {
        const rearStrap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.025, 4, 1, 1), leather)
        rearStrap.position.set(0, y, 0.11)
        rearStrap.name = 'shield-rear-strap'
        pivot.add(rearStrap)
        leatherDetails.push(rearStrap)
      }
      pivot.add(equipmentShadowUntil(equipmentDetail(mergeRigidGeometryParts(leatherDetails, leather, 'shield-rear-strap'), 0), -1))
      const rearGrip = equipmentShadowUntil(new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.2, 4, 8), leather), -1)
      rearGrip.position.set(0, 0, 0.085)
      rearGrip.rotation.z = Math.PI / 2
      rearGrip.name = 'shield-rear-grip'
      pivot.add(equipmentDetail(rearGrip, 0))
      if (tier === 3) {
        const bossDetails: THREE.Mesh[] = [boss]
        for (let index = 0; index < 8; index++) {
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), bronze)
          const angle = index / 8 * Math.PI * 2
          rivet.position.set(Math.cos(angle) * 0.31, Math.sin(angle) * 0.31, 0.202)
          pivot.add(rivet)
          bossDetails.push(rivet)
        }
        pivot.add(equipmentShadowUntil(mergeRigidGeometryParts(bossDetails, bronze, 'shield-boss'), -1))
      }
    }
  }
}
