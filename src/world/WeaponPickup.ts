/**
 * WeaponPickup.ts
 * 3D world weapon/item drop node (Optimised for high FPS performance).
 * Uses emissive glow materials instead of heavy PointLights to keep 60+ FPS even with 30+ items.
 */
import * as THREE from 'three'
import { WEAPONS, getTierColor } from '../rpg/WeaponDatabase'
import { getTerrainHeight } from './Terrain'

export class WeaponPickup {
  readonly group: THREE.Group
  readonly weaponId: string
  readonly isArrowPack: boolean
  readonly arrowQuantity: number
  readonly name: string
  readonly tier: 1 | 2 | 3

  private meshGroup: THREE.Group
  private alive = true
  private hoverTimer = 0

  get position(): THREE.Vector3 { return this.group.position }
  get isAlive(): boolean { return this.alive }

  constructor(
    scene: THREE.Scene,
    weaponId: string,
    x: number,
    z: number,
    isArrowPack = false,
    arrowQuantity = 15
  ) {
    this.weaponId = weaponId
    this.isArrowPack = isArrowPack
    this.arrowQuantity = arrowQuantity

    const weapon = WEAPONS[weaponId]
    if (isArrowPack) {
      this.name = `箭矢補給包 Arrow Pack (x${arrowQuantity})`
      this.tier = 1
    } else if (weapon) {
      this.name = weapon.name
      this.tier = weapon.tier
    } else {
      this.name = '未知物品 Item'
      this.tier = 1
    }

    this.group = new THREE.Group()
    this.meshGroup = new THREE.Group()
    this.group.add(this.meshGroup)

    const colorHex = parseInt(getTierColor(this.tier).replace('#', '0x'))

    // ── Build 3D Representative Mesh ──
    this._buildMesh(colorHex)

    // ── Glowing Light Ring (Lightweight Basic Material) ──
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 12), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    this.group.add(ring)

    // Calibrate base Y to terrain height
    const terrainY = getTerrainHeight(x, z)
    this.group.position.set(x, terrainY, z)

    scene.add(this.group)
  }

  private _buildMesh(colorHex: number): void {
    if (this.isArrowPack || this.weaponId.includes('bow')) {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.3 })
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 12, Math.PI), mat)
      bow.position.y = 0.45
      this.meshGroup.add(bow)
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
      this.meshGroup.add(swordGroup)
    }
  }

  update(dt: number): void {
    if (!this.alive) return

    this.hoverTimer += dt
    this.meshGroup.rotation.y += dt * 1.5
    this.meshGroup.position.y = 0.4 + Math.sin(this.hoverTimer * 3) * 0.12
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
  }
}
