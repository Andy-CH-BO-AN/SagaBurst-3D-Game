import * as THREE from 'three'
import { Faction } from './NPC'
import { proceduralMaterial } from './ProceduralMaterials'

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

function addWrappedGrip(pivot: THREE.Group, length: number, radius: number, y: number, leather: THREE.Material, metal: THREE.Material): void {
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, length, 12), leather)
  handle.position.y = y
  pivot.add(handle)
  for (let ring = 0; ring < 7; ring++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.1, 6, 16), metal)
    wrap.rotation.x = Math.PI / 2
    wrap.position.y = y - length / 2 + (ring + 0.5) * length / 7
    pivot.add(wrap)
  }
}

function curvedLimb(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, radius, 8, false)
  return new THREE.Mesh(geometry, material)
}

function curvedShieldBoard(width: number, height: number, depth: number, curve: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 12, 14, 1)
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

function curvedRectangleRim(width: number, height: number, curve: number, radius: number, material: THREE.Material): THREE.Mesh {
  const points: THREE.Vector3[] = []
  const steps = 8
  const addEdge = (from: THREE.Vector2, to: THREE.Vector2) => {
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      const x = THREE.MathUtils.lerp(from.x, to.x, t)
      const y = THREE.MathUtils.lerp(from.y, to.y, t)
      const z = 0.15 + curve * (1 - (x / (width / 2)) ** 2)
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

    if (weaponId === 'rusty_dagger') {
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x3a3028, flatShading: true })
      const guardMat = new THREE.MeshLambertMaterial({ color: 0x555555, flatShading: true })
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true })

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), hiltMat)
      hilt.position.y = 0.09
      pivot.add(hilt)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), guardMat)
      guard.position.y = 0.18
      pivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.55, 0.02), bladeMat)
      blade.position.y = 0.48
      blade.castShadow = true
      pivot.add(blade)

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), bladeMat)
      tip.position.y = 0.81
      pivot.add(tip)
      tipLocal.set(0, 0.87, 0)

    } else if (weaponId === 'runic_greatsword') {
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true })
      const ringMat  = new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true })
      const guardMat = new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true })
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, flatShading: true })
      const gemMat   = new THREE.MeshBasicMaterial({ color: 0x00d2ff })

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 8), hiltMat)
      hilt.position.y = 0.225
      pivot.add(hilt)

      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 16), ringMat)
        ring.rotation.x = Math.PI / 2
        ring.position.y = 0.1 + i * 0.12
        pivot.add(ring)
      }

      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), gemMat)
      gem.position.y = -0.04
      pivot.add(gem)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.12), guardMat)
      guard.position.y = 0.48
      pivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.55, 0.048), bladeMat)
      blade.position.y = 1.3
      blade.castShadow = true
      pivot.add(blade)

      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.065, 1.35, 0.058), gemMat)
      fuller.position.y = 1.25
      pivot.add(fuller)
      tipLocal.set(0, 2.1, 0)

    } else if (weaponId === 'steel_lance') {
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true })
      const headMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })

      // The lance is held near the back. The pole goes from y = -0.5 to y = 2.0
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), poleMat)
      pole.position.y = 0.75 // Center of pole (2.5/2 = 1.25, minus offset to hold it lower)
      pivot.add(pole)

      // Lance cone head
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 8), headMat)
      head.position.y = 2.3 // 0.75 + 1.25 + 0.3
      head.castShadow = true
      pivot.add(head)
      tipLocal.set(0, 2.6, 0)

    } else {
      const leather = proceduralMaterial({ kind: 'leather', color: 0x3f2b21, roughness: 0.82 })
      const steel = proceduralMaterial({ kind: 'iron', color: 0xc2c7c9, roughness: 0.27, metalness: 0.92 })
      const darkSteel = proceduralMaterial({ kind: 'iron', color: 0x555c60, roughness: 0.38, metalness: 0.82 })
      addWrappedGrip(pivot, 0.29, 0.037, 0.15, leather, darkSteel)

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

      const blade = new THREE.Mesh(profiledBladeGeometry(1.18, [0.105, 0.102, 0.086, 0.052, 0.004], 0.038), steel)
      blade.position.y = 0.33
      blade.name = 'steel-sword-profiled-blade'
      blade.castShadow = true
      pivot.add(blade)
      const fullerFront = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.78, 0.004, 1, 8, 1), darkSteel)
      fullerFront.position.set(0, 0.82, 0.021)
      pivot.add(fullerFront)
      const fullerBack = fullerFront.clone()
      fullerBack.position.z = -0.021
      pivot.add(fullerBack)

      tipLocal.set(0, 1.51, 0)
    }

    // Orient sword to naturally rest along the hand forward
    pivot.rotation.set(0, 0, 0)

    return { tipLocal }
  }

  /**
   * 建構遠程武器的 3D mesh group
   */
  static buildRanged(weaponId: string, pivot: THREE.Group): { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number } {
    const bowModel = new THREE.Group()
    bowModel.name = 'bow-model'
    pivot.add(bowModel)
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true })

    const topTip = new THREE.Vector3(0, 0.75, 0.12)
    const botTip = new THREE.Vector3(0, -0.75, 0.12)
    let stringLength = 0.78

    if (weaponId === 'wooden_shortbow') {
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x6e4e2e, flatShading: true })
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), gripMat)
      bowModel.add(grip)

      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.6, 6), woodMat)
      upperArm.position.set(0, 0.38, 0.05)
      upperArm.rotation.x = -0.2
      bowModel.add(upperArm)

      const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.6, 6), woodMat)
      lowerArm.position.set(0, -0.38, 0.05)
      lowerArm.rotation.x = 0.2
      bowModel.add(lowerArm)

      topTip.set(0, 0.62, 0.05)
      botTip.set(0, -0.62, 0.05)
      stringLength = 0.62

    } else if (weaponId === 'elven_runebow') {
      const elvenMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })
      const runeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })
      
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 8), gripMat)
      bowModel.add(grip)

      // Sleek long curved arms
      for (let i = 1; i <= 3; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03 - i*0.005, 0.035 - i*0.005, 0.3, 8), elvenMat)
        seg.position.set(0, 0.1 + i*0.25, i*0.02)
        seg.rotation.x = -0.15 * i
        bowModel.add(seg)

        const botSeg = new THREE.Mesh(new THREE.CylinderGeometry(0.035 - i*0.005, 0.03 - i*0.005, 0.3, 8), elvenMat)
        botSeg.position.set(0, -0.1 - i*0.25, i*0.02)
        botSeg.rotation.x = 0.15 * i
        bowModel.add(botSeg)
      }

      // Glowing Runes
      const rune1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), runeMat)
      rune1.position.set(0, 0.5, 0.04)
      bowModel.add(rune1)
      const rune2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), runeMat)
      rune2.position.set(0, -0.5, 0.04)
      bowModel.add(rune2)

      topTip.set(0, 1.0, -0.01)
      botTip.set(0, -1.0, -0.01)
      stringLength = 1.0

    } else {
      // Default: recurve longbow
      const woodMat = proceduralMaterial({ kind: 'wood', color: 0x6a4227, roughness: 0.76, repeat: [2, 6] })
      const laminateMat = proceduralMaterial({ kind: 'wood', color: 0xb48752, roughness: 0.7, repeat: [2, 7] })
      const leatherMat = proceduralMaterial({ kind: 'leather', color: 0x302019, roughness: 0.84 })
      const hornMat = proceduralMaterial({ kind: 'leather', color: 0xc6a674, roughness: 0.72 })

      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.048, 0.27, 12), leatherMat)
      bowModel.add(grip)
      for (const side of [-1, 1]) {
        const points = [
          new THREE.Vector3(0, side * 0.12, 0),
          new THREE.Vector3(0, side * 0.38, 0.075),
          new THREE.Vector3(0, side * 0.67, 0.135),
          new THREE.Vector3(0, side * 0.86, 0.02),
        ]
        const limb = curvedLimb(points, 0.032, woodMat)
        limb.scale.x = 1.18
        bowModel.add(limb)
        const laminate = curvedLimb(points.map((point) => point.clone().add(new THREE.Vector3(0.019, 0, -0.002))), 0.009, laminateMat)
        bowModel.add(laminate)
        const nock = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.11, 8), hornMat)
        nock.position.set(0, side * 0.9, -0.005)
        nock.rotation.z = side === 1 ? 0 : Math.PI
        bowModel.add(nock)
      }
      topTip.set(0, 0.9, -0.005)
      botTip.set(0, -0.9, -0.005)
      stringLength = 0.9
    }

    // Scale only the bow limbs and grip. Strings and the arrow are siblings on
    // the weapon socket so their thickness/length and release alignment stay exact.
    const visualScale = 1.22
    // Mirror only the solid bow body toward local -Z (the target). Strings and
    // arrows are sibling objects and remain on the archer side of the limbs.
    bowModel.scale.set(visualScale, visualScale, -visualScale)
    topTip.multiplyScalar(visualScale)
    botTip.multiplyScalar(visualScale)
    topTip.z *= -1
    botTip.z *= -1
    stringLength *= visualScale

    return { topTip, botTip, stringLength }
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
  static buildNpcMelee(faction: Faction, tier: number, isLance: boolean, pivot: THREE.Group): THREE.Vector3 {
    if (isLance) {
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true })
      const headMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), poleMat)
      pole.position.y = 0.75
      pivot.add(pole)

      const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 8), headMat)
      head.position.y = 2.3
      head.castShadow = true
      pivot.add(head)
      return new THREE.Vector3(0, 2.6, 0)
    }

    if (faction === Faction.PLAYER) {
      return this.buildMelee('steel_sword', pivot).tipLocal
    } else {
      // Roman Gladius
      let bladeColor = 0x888888
      let bladeLength = 0.6
      let bladeWidth = 0.08
      let metalness = 0.4

      if (tier === 2) {
        bladeColor = 0xbfc3c3
        bladeLength = 0.68
        bladeWidth = 0.105
        metalness = 0.8
      } else if (tier === 3) {
        bladeColor = 0xd6d2b4
        bladeLength = 0.75
        bladeWidth = 0.1
        metalness = 1.0
      }

      const bladeMat = proceduralMaterial({ kind: 'iron', color: bladeColor, metalness, roughness: 0.3 })
      const handleMat = proceduralMaterial({ kind: 'leather', color: 0x3a2117, roughness: 0.82 })
      const pommelMat = proceduralMaterial({ kind: tier === 3 ? 'bronze' : 'iron', color: tier === 3 ? 0xb38a4c : 0x575b5d, metalness: 0.8, roughness: 0.38 })

      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pommelMat)
      pommel.scale.y = 0.78
      pivot.add(pommel)
      addWrappedGrip(pivot, 0.16, 0.028, 0.1, handleMat, pommelMat)

      const guard = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), pommelMat)
      guard.scale.set(1.3, 0.38, 0.65)
      guard.position.y = 0.2
      pivot.add(guard)

      const blade = new THREE.Mesh(profiledBladeGeometry(bladeLength, [bladeWidth * 0.72, bladeWidth, bladeWidth * 0.92, bladeWidth * 0.58, 0.004], 0.034), bladeMat)
      blade.position.y = 0.2
      blade.name = 'roman-gladius-profiled-blade'
      pivot.add(blade)
      return new THREE.Vector3(0, 0.2 + bladeLength, 0)
    }
  }

  /**
   * 建構 NPC 專用遠程武器（羅馬標槍 vs 維京弓）
   */
  static buildNpcRanged(faction: Faction, tier: number, pivot: THREE.Group): NpcRangedMeshParts {
    if (faction === Faction.ENEMY) {
      // Roman Pilum (Javelin)
      const woodMat = proceduralMaterial({ kind: 'wood', color: 0x68452c, roughness: 0.78, repeat: [2, 7] })
      const ironMat = proceduralMaterial({ kind: 'iron', color: 0x777d7f, roughness: 0.36, metalness: 0.82 })
      const goldMat = proceduralMaterial({ kind: 'bronze', color: 0xa98248, roughness: 0.4, metalness: 0.74 })

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, 1.2, 10), woodMat)
      shaft.position.y = 0.6
      pivot.add(shaft)

      const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.023, 0.16, 10), ironMat)
      socket.position.y = 1.24
      pivot.add(socket)

      if (tier === 1) {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), ironMat)
        head.position.y = 1.275
        pivot.add(head)
      } else if (tier === 2) {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, 0.4, 8), ironMat)
        neck.position.y = 1.4
        pivot.add(neck)
        
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 4), ironMat)
        head.position.y = 1.65
        pivot.add(head)
      } else {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.5, 8), ironMat)
        neck.position.y = 1.45
        pivot.add(neck)
        
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), goldMat)
        wrap.position.y = 1.2
        pivot.add(wrap)

        const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), ironMat)
        head.position.y = 1.775
        pivot.add(head)
      }

      return {}
    } else {
      // Viking Bow
      const bowMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })

      const upperCurve = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.5, 6), bowMat)
      upperCurve.position.set(0, 0.25, 0)
      upperCurve.rotation.z = -0.1
      pivot.add(upperCurve)

      const lowerCurve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.5, 6), bowMat)
      lowerCurve.position.set(0, -0.25, 0)
      lowerCurve.rotation.z = 0.1
      pivot.add(lowerCurve)

      const stringMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, flatShading: true })
      const stringTop = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat)
      const stringBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4), stringMat)
      pivot.add(stringTop, stringBottom)

      const nockedArrow = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), bowMat)
      shaft.rotation.x = Math.PI / 2
      nockedArrow.add(shaft)
      const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 6), new THREE.MeshLambertMaterial({ color: 0xaaaaaa }))
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
    const isRoman = shieldId.startsWith('scutum')
    const tier = parseInt(shieldId.split('_t')[1]) || 1
    const iron = proceduralMaterial({ kind: 'iron', color: tier === 3 ? 0xbfc2bd : 0x686d70, roughness: 0.4, metalness: 0.82 })
    const bronze = proceduralMaterial({ kind: 'bronze', color: 0xa47b42, roughness: 0.43, metalness: 0.72 })
    const leather = proceduralMaterial({ kind: 'leather', color: 0x3d281d, roughness: 0.86 })

    if (isRoman) {
      const boardMat = proceduralMaterial({ kind: 'leather', color: tier === 1 ? 0x68412b : 0x7f211d, roughness: 0.78, repeat: [4, 5] })
      const board = new THREE.Mesh(curvedShieldBoard(0.58, 0.98, 0.055, 0.13), boardMat)
      board.position.z = 0.02
      board.name = 'curved-scutum-board'
      board.castShadow = true
      board.receiveShadow = true
      pivot.add(board)
      pivot.add(curvedRectangleRim(0.58, 0.98, 0.13, 0.022, tier >= 2 ? iron : leather))

      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron)
      boss.position.set(0, 0, 0.285)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      const emblemMat = tier === 3 ? bronze : proceduralMaterial({ kind: 'bronze', color: 0x9a7445, roughness: 0.55, metalness: 0.5 })
      for (const rotation of [Math.PI / 4, -Math.PI / 4]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.012, 1, 5, 1), emblemMat)
        wing.position.set(0, 0.08, 0.285)
        wing.rotation.z = rotation
        pivot.add(wing)
      }
      const rearGrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.2, 4, 8), leather)
      rearGrip.position.set(0, 0, 0.085)
      rearGrip.rotation.z = Math.PI / 2
      rearGrip.name = 'shield-rear-grip'
      pivot.add(rearGrip)
    } else {
      const wood = proceduralMaterial({ kind: 'wood', color: 0x65452d, roughness: 0.84, repeat: [5, 3] })
      const paint = proceduralMaterial({ kind: 'wood', color: tier === 3 ? 0x294d64 : 0x435443, roughness: 0.82, repeat: [5, 3] })
      const board = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.052, 32), tier >= 2 ? paint : wood)
      board.rotation.x = Math.PI / 2
      board.position.z = 0.15
      board.name = 'round-shield-board'
      board.castShadow = true
      pivot.add(board)
      for (let seam = -3; seam <= 3; seam++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.72 - Math.abs(seam) * 0.055, 0.008), leather)
        line.position.set(seam * 0.1, 0, 0.18)
        pivot.add(line)
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.023, 10, 32), tier >= 2 ? iron : leather)
      rim.position.z = 0.18
      pivot.add(rim)
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), tier === 3 ? bronze : iron)
      boss.position.set(0, 0, 0.205)
      boss.scale.z = 0.58
      boss.name = 'shield-boss'
      pivot.add(boss)
      for (const y of [-0.14, 0.14]) {
        const rearStrap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.025, 4, 1, 1), leather)
        rearStrap.position.set(0, y, 0.11)
        rearStrap.name = 'shield-rear-strap'
        pivot.add(rearStrap)
      }
      if (tier === 3) {
        for (let index = 0; index < 8; index++) {
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), bronze)
          const angle = index / 8 * Math.PI * 2
          rivet.position.set(Math.cos(angle) * 0.31, Math.sin(angle) * 0.31, 0.202)
          pivot.add(rivet)
        }
      }
    }
  }
}
