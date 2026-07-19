import * as THREE from 'three'
import { Faction } from './NPC'

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
      // Tier 2 Authentic Medieval Steel Sword (標準中世紀十字鋼鐵長劍)
      const hiltMat  = new THREE.MeshLambertMaterial({ color: 0x4a3525, flatShading: true }) // 皮革握把
      const guardMat = new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true }) // 黃金/青銅十字護手
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, flatShading: true }) // 亮銀高金屬感長劍刀刃
      const pommelMat= new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true })

      // 握柄 Hilt
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), hiltMat)
      hilt.position.y = 0.15
      pivot.add(hilt)

      // 劍尾球 Pommel
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pommelMat)
      pommel.position.y = 0.0
      pivot.add(pommel)

      // 十字護手 Crossguard
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.08), guardMat)
      guard.position.y = 0.3
      pivot.add(guard)

      // 鋼鐵長劍刀刃 Blade
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.03), bladeMat)
      blade.position.y = 0.85
      blade.castShadow = true
      pivot.add(blade)

      // 劍尖 Tip
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.056, 0.2, 4), bladeMat)
      tip.rotation.y = Math.PI / 4
      tip.position.y = 1.48
      pivot.add(tip)

      tipLocal.set(0, 1.58, 0)
    }

    // Orient sword to naturally rest along the hand forward
    pivot.rotation.set(0, 0, 0)

    return { tipLocal }
  }

  /**
   * 建構遠程武器的 3D mesh group
   */
  static buildRanged(weaponId: string, pivot: THREE.Group): { topTip: THREE.Vector3, botTip: THREE.Vector3, stringLength: number } {

    const gripMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true })

    const topTip = new THREE.Vector3(0, 0.75, 0.12)
    const botTip = new THREE.Vector3(0, -0.75, 0.12)
    let stringLength = 0.78

    if (weaponId === 'wooden_shortbow') {
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x6e4e2e, flatShading: true })
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), gripMat)
      pivot.add(grip)

      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.6, 6), woodMat)
      upperArm.position.set(0, 0.38, 0.05)
      upperArm.rotation.x = -0.2
      pivot.add(upperArm)

      const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.6, 6), woodMat)
      lowerArm.position.set(0, -0.38, 0.05)
      lowerArm.rotation.x = 0.2
      pivot.add(lowerArm)

    } else if (weaponId === 'elven_runebow') {
      const elvenMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa, flatShading: true })
      const runeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })
      
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 8), gripMat)
      pivot.add(grip)

      // Sleek long curved arms
      for (let i = 1; i <= 3; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03 - i*0.005, 0.035 - i*0.005, 0.3, 8), elvenMat)
        seg.position.set(0, 0.1 + i*0.25, i*0.02)
        seg.rotation.x = -0.15 * i
        pivot.add(seg)

        const botSeg = new THREE.Mesh(new THREE.CylinderGeometry(0.035 - i*0.005, 0.03 - i*0.005, 0.3, 8), elvenMat)
        botSeg.position.set(0, -0.1 - i*0.25, i*0.02)
        botSeg.rotation.x = 0.15 * i
        pivot.add(botSeg)
      }

      // Glowing Runes
      const rune1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), runeMat)
      rune1.position.set(0, 0.5, 0.04)
      pivot.add(rune1)
      const rune2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), runeMat)
      rune2.position.set(0, -0.5, 0.04)
      pivot.add(rune2)

      topTip.set(0, 1.0, -0.01)
      botTip.set(0, -1.0, -0.01)
      stringLength = 1.0

    } else {
      // Default: recurve longbow
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3525, flatShading: true })
      
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 8), gripMat)
      pivot.add(grip)

      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.6, 6), woodMat)
      upperArm.position.set(0, 0.4, 0.08)
      upperArm.rotation.x = -0.25
      pivot.add(upperArm)

      const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.025, 0.6, 6), woodMat)
      lowerArm.position.set(0, -0.4, 0.08)
      lowerArm.rotation.x = 0.25
      pivot.add(lowerArm)

      const upperRecurve = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.25, 6), woodMat)
      upperRecurve.position.set(0, 0.78, 0.06)
      upperRecurve.rotation.x = 0.3
      pivot.add(upperRecurve)

      const lowerRecurve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.25, 6), woodMat)
      lowerRecurve.position.set(0, -0.78, 0.06)
      lowerRecurve.rotation.x = -0.3
      pivot.add(lowerRecurve)

      topTip.set(0, 0.82, -0.04)
      botTip.set(0, -0.82, -0.04)
    }

    return { topTip, botTip, stringLength }
  }

  /**
   * 建構地面掉落用的簡化武器模型
   */
  static buildPickupMesh(weaponId: string, isArrowPack: boolean, colorHex: number, pivot: THREE.Group): void {
    if (isArrowPack || weaponId.includes('bow')) {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.3 })
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 12, Math.PI), mat)
      bow.position.y = 0.45
      pivot.add(bow)
    } else {
      // 打造正宗中世紀十字鋼鐵長劍 (Steel Sword / Greatsword Pickup)
      const hiltMat   = new THREE.MeshLambertMaterial({ color: 0x4a3525 })
      const guardMat  = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
      const bladeMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.1 })
      const pommelMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })

      const swordGroup = new THREE.Group()

      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), hiltMat)
      hilt.position.y = 0.125
      swordGroup.add(hilt)

      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pommelMat)
      pommel.position.y = 0.0
      swordGroup.add(pommel)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.045, 0.07), guardMat)
      guard.position.y = 0.25
      swordGroup.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.025), bladeMat)
      blade.position.y = 0.725
      blade.castShadow = true
      swordGroup.add(blade)

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), bladeMat)
      tip.rotation.y = Math.PI / 4
      tip.position.y = 1.28
      swordGroup.add(tip)

      swordGroup.scale.set(0.7, 0.7, 0.7)
      swordGroup.position.y = 0.2
      pivot.add(swordGroup)
    }
  }

  /**
   * 建構 NPC 專用近戰武器（含羅馬/維京差異）
   */
  static buildNpcMelee(faction: Faction, tier: number, isLance: boolean, pivot: THREE.Group): void {
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
      return
    }

    if (faction === Faction.PLAYER) {
      // Viking Steel Sword (T2)
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.2 })
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e })
      const guardMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), handleMat)
      handle.position.y = 0.09
      pivot.add(handle)

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.06), guardMat)
      guard.position.y = 0.2
      pivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.015), bladeMat)
      blade.position.y = 0.62
      pivot.add(blade)
    } else {
      // Roman Gladius
      let bladeColor = 0x888888 // T1 Rusty
      let bladeLength = 0.6
      let bladeWidth = 0.08
      let metalness = 0.4
      let emissive = 0x000000

      if (tier === 2) {
        bladeColor = 0xcccccc // Standard
        metalness = 0.8
      } else if (tier === 3) {
        bladeColor = 0xffffcc // Centurion
        bladeLength = 0.75
        bladeWidth = 0.1
        metalness = 1.0
        emissive = 0x555500
      }

      const bladeMat = new THREE.MeshStandardMaterial({ color: bladeColor, metalness, roughness: 0.2, emissive })
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x3a1e00 })
      const pommelMat = new THREE.MeshStandardMaterial({ color: tier === 3 ? 0xd4af37 : 0x444444, metalness: 0.8 })

      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pommelMat)
      pivot.add(pommel)

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.15, 8), handleMat)
      handle.position.y = 0.1
      pivot.add(handle)

      const guard = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pommelMat)
      guard.scale.set(1, 0.4, 0.6)
      guard.position.y = 0.2
      pivot.add(guard)

      const blade = new THREE.Mesh(new THREE.BoxGeometry(bladeWidth, bladeLength, 0.02), bladeMat)
      blade.position.y = 0.2 + bladeLength / 2
      pivot.add(blade)
      
      const tip = new THREE.Mesh(new THREE.ConeGeometry(bladeWidth / 2, 0.1, 4), bladeMat)
      tip.rotation.y = Math.PI / 4
      tip.position.y = 0.2 + bladeLength + 0.05
      pivot.add(tip)
    }
  }

  /**
   * 建構 NPC 專用遠程武器（羅馬標槍 vs 維京弓）
   */
  static buildNpcRanged(faction: Faction, tier: number, pivot: THREE.Group): void {
    if (faction === Faction.ENEMY) {
      // Roman Pilum (Javelin)
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21, flatShading: true })
      const ironMat = new THREE.MeshLambertMaterial({ color: 0x777777, flatShading: true })
      const goldMat = new THREE.MeshLambertMaterial({ color: 0xd4af37, flatShading: true })

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), woodMat)
      shaft.position.y = 0.6
      pivot.add(shaft)

      if (tier === 1) {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), ironMat)
        head.position.y = 1.275
        pivot.add(head)
      } else if (tier === 2) {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.015, 0.4, 4), ironMat)
        neck.position.y = 1.4
        pivot.add(neck)
        
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4), ironMat)
        head.position.y = 1.65
        pivot.add(head)
      } else {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.5, 4), ironMat)
        neck.position.y = 1.45
        pivot.add(neck)
        
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), goldMat)
        wrap.position.y = 1.2
        pivot.add(wrap)

        const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 4), ironMat)
        head.position.y = 1.775
        pivot.add(head)
      }

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
      const bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1.0, 4), stringMat)
      bowString.position.set(0.05, 0, 0)
      pivot.add(bowString)
    }
  }
}
