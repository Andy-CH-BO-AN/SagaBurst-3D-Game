/**
 * WeaponPickup.ts
 * 3D world weapon/item drop node (Optimised for high FPS performance).
 * Uses emissive glow materials instead of heavy PointLights to keep 60+ FPS even with 30+ items.
 */
import * as THREE from 'three'
import { WEAPONS, getTierColor } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WeaponMeshFactory } from './WeaponMeshFactory'
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
    const armor = ARMORS[weaponId]
    
    if (isArrowPack) {
      this.name = `箭矢補給包 Arrow Pack (x${arrowQuantity})`
      this.tier = 1
    } else if (weapon) {
      this.name = weapon.name
      this.tier = weapon.tier
    } else if (armor) {
      this.name = armor.name
      this.tier = armor.tier
    } else {
      this.name = '未知物品 Item'
      this.tier = 1
    }

    this.group = new THREE.Group()
    this.meshGroup = new THREE.Group()
    this.group.add(this.meshGroup)

    const colorHex = parseInt(getTierColor(this.tier).replace('#', '0x'))

    // ── Build 3D Representative Mesh ──
    WeaponMeshFactory.buildPickupMesh(this.weaponId, this.isArrowPack, colorHex, this.meshGroup)

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
