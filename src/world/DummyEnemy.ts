/**
 * DummyEnemy.ts
 * Training Dummy Target Enemy.
 * Calibrated with getTerrainHeight(x, z) for procedural heightmap terrain.
 */
import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'

export class DummyEnemy {
  readonly group: THREE.Group
  private bodyMesh!: THREE.Mesh
  private headMesh!: THREE.Mesh
  private baseMesh!: THREE.Mesh

  private bodyMat: THREE.MeshLambertMaterial
  private flashMat: THREE.MeshBasicMaterial

  readonly maxHp = 100
  private currentHp = 100

  private isDead = false
  private respawnTimer = 0

  private flashTimer = 0
  private tiltTimer = 0

  private spawnX: number
  private spawnZ: number

  get hp(): number { return this.currentHp }
  get hpRatio(): number { return Math.max(0, this.currentHp / this.maxHp) }
  get dead(): boolean { return this.isDead }
  get position(): THREE.Vector3 { return this.group.position }

  constructor(scene: THREE.Scene, x = 0, z = -6) {
    this.spawnX = x
    this.spawnZ = z

    this.group = new THREE.Group()
    this.group.name = 'dummy_enemy'

    this.bodyMat  = new THREE.MeshLambertMaterial({ color: 0x992222 })
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff })

    // Base pedestal
    const baseGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.3, 12)
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a3525 })
    this.baseMesh = new THREE.Mesh(baseGeo, baseMat)
    this.baseMesh.position.y = 0.15
    this.baseMesh.receiveShadow = true
    this.group.add(this.baseMesh)

    // Body cylinder (Red wooden dummy)
    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12)
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    this.bodyMesh.position.y = 0.9
    this.bodyMesh.castShadow = true
    this.bodyMesh.visible = true
    this.group.add(this.bodyMesh)

    // Head sphere
    const headGeo = new THREE.SphereGeometry(0.38, 12, 8)
    this.headMesh = new THREE.Mesh(headGeo, this.bodyMat)
    this.headMesh.position.y = 1.85
    this.headMesh.castShadow = true
    this.headMesh.visible = true
    this.group.add(this.headMesh)

    // Eye target cross
    const targetMat = new THREE.MeshBasicMaterial({ color: 0xffd700 })
    const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.18, 12), targetMat)
    targetRing.position.set(0, 1.85, 0.39)
    targetRing.visible = true
    this.group.add(targetRing)

    // Calibrate initial spawn position Y to terrain height
    const terrainY = getTerrainHeight(x, z)
    this.group.position.set(x, terrainY, z)
    scene.add(this.group)
  }

  takeDamage(amount: number): boolean {
    if (this.isDead) return false

    this.currentHp = Math.max(0, this.currentHp - amount)
    this.flashTimer = 0.15
    this.tiltTimer = 0.25

    if (this.currentHp <= 0) {
      this.isDead = true
      this.respawnTimer = 2.5
    }
    return true
  }

  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.bodyMesh.material = this.flashMat
      this.headMesh.material = this.flashMat
    } else {
      this.bodyMesh.material = this.bodyMat
      this.headMesh.material = this.bodyMat
    }

    if (this.isDead) {
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, dt * 10)
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) {
        this.respawn()
      }
    } else if (this.tiltTimer > 0) {
      this.tiltTimer -= dt
      this.group.rotation.z = Math.sin(this.tiltTimer * 30) * 0.15
    } else {
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, 0, dt * 10)
    }
  }

  respawn(): void {
    this.isDead = false
    this.currentHp = this.maxHp
    this.group.rotation.z = 0
    const terrainY = getTerrainHeight(this.spawnX, this.spawnZ)
    this.group.position.set(this.spawnX, terrainY, this.spawnZ)
  }
}
