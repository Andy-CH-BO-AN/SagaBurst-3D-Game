/**
 * ArrowProjectile.ts
 * Arrow projectile with realistic parabolic gravity trajectory and hit detection on all targetable entities based on Factions.
 */
import * as THREE from 'three'
import type { DummyEnemy } from './DummyEnemy'
import { NPC, Faction } from './NPC'
import type { Player } from '../player/Player'
import type { ObstacleData } from './Terrain'
import { damageNpc } from '../combat/DamageRouter'

const GRAVITY = -9.8 // m/s² downforce for arrow arc

export class ArrowProjectile {
  readonly mesh: THREE.Group
  private velocity: THREE.Vector3
  private alive = true
  private stuck = false
  private stuckTimer = 0

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpTargetPos = new THREE.Vector3()

  readonly damage: number
  readonly shooterFaction: Faction
  readonly isPlayerFired: boolean

  get isAlive(): boolean { return this.alive }
  get isStuck(): boolean { return this.stuck }

  constructor(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterFaction: Faction,
    isPlayerFired: boolean = false
  ) {
    this.damage = damage
    this.shooterFaction = shooterFaction
    this.isPlayerFired = isPlayerFired
    this.mesh = new THREE.Group()

    // ── Build Arrow Mesh ──
    const woodMat  = new THREE.MeshLambertMaterial({ color: 0x6e4722 })
    const tipMat   = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.1 })
    const featherMat = new THREE.MeshBasicMaterial({ color: 0xe8e0d0 })

    // Shaft (cylinder)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), woodMat)
    shaft.rotation.x = Math.PI / 2
    shaft.castShadow = true
    this.mesh.add(shaft)

    // Tip (cone)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 6), tipMat)
    tip.rotation.x = -Math.PI / 2
    tip.position.z = -0.5
    this.mesh.add(tip)

    // Fletching feathers (2 flat fins)
    const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.18), featherMat)
    fin1.position.z = 0.4
    this.mesh.add(fin1)

    this.mesh.position.copy(origin)
    this.velocity = direction.clone().normalize().multiplyScalar(speed)

    // Point arrow along velocity
    this.mesh.lookAt(origin.clone().add(this.velocity))
    scene.add(this.mesh)
  }

  update(
    dt: number,
    dummy: DummyEnemy,
    player: Player,
    npcs: NPC[],
    obstacles: ObstacleData[],
    onHitTarget: (damage: number, hitPos: THREE.Vector3, targetName: string, hpRatio: number, isPlayerHit: boolean, npc?: NPC, isMountHit?: boolean) => void
  ): void {
    if (!this.alive) return

    // If stuck in ground or wall, countdown decay
    if (this.stuck) {
      this.stuckTimer += dt
      if (this.stuckTimer >= 5.0) {
        this.destroy()
      }
      return
    }

    // Apply gravity
    this.velocity.y += GRAVITY * dt

    // Move along velocity
    this.mesh.position.addScaledVector(this.velocity, dt)

    // Orient arrow towards velocity
    const targetPos = this._tmpTargetPos.copy(this.mesh.position).add(this.velocity)
    this.mesh.lookAt(targetPos)

    // ── Hit Detection 1: Terrain / Ground (y <= 0) ──
    if (this.mesh.position.y <= 0.05) {
      this.mesh.position.y = 0.05
      this.stuck = true
      return
    }

    // ── Hit Detection 2: Obstacles (Rocks / Trees / Barricades) ──
    for (const obs of obstacles) {
      if (obs.box.containsPoint(this.mesh.position)) {
        this.stuck = true
        return
      }
    }

    // ── Hit Detection 3: Dummy Enemy ──
    if (this.shooterFaction === Faction.PLAYER && !dummy.dead) {
      const enemyCenter = dummy.position.clone()
      enemyCenter.y += 1.0 // Torso height

      const dist = this.mesh.position.distanceTo(enemyCenter)
      if (dist <= 0.9) {
        const hitSuccess = dummy.takeDamage(this.damage)
        if (hitSuccess) {
          onHitTarget(this.damage, this.mesh.position.clone(), '訓練假人 Dummy Target', dummy.hpRatio, false)
        }
        this.destroy()
        return
      }
    }

    // ── Hit Detection 4: Player (If shooter is ENEMY) ──
    if (this.shooterFaction === Faction.ENEMY && !player.dead) {
      const playerCenter = player.combatPosition.clone()
      playerCenter.y += 1.0 // Torso height
      const dist = this.mesh.position.distanceTo(playerCenter)
      if (dist <= 0.9) {
        if (player.isMounted && player.currentMount) {
          const mount = player.currentMount
          const hitSuccess = mount.takeDamage(this.damage)
          if (hitSuccess) {
            const mountName = `坐騎：${mount.displayName}`
            onHitTarget(this.damage, this.mesh.position.clone(), mountName, mount.currentHp / mount.maxHp, true, undefined, true)
            if (mount.dead) player.dismountFromMount()
          }
        } else {
          onHitTarget(this.damage, this.mesh.position.clone(), 'Player', player.hpRatio, true, undefined, false)
        }
        this.destroy()
        return
      }
    }

    // ── Hit Detection 5: NPCs (Faction Check) ──
    for (const npc of npcs) {
      if (npc.dead || npc.faction === this.shooterFaction) continue
      const aiCenter = npc.combatPosition.clone()
      aiCenter.y += 1.0 // Torso height

      const dist = this.mesh.position.distanceTo(aiCenter)
      if (dist <= 1.0) {
        const result = damageNpc(npc, this.damage)
        if (result.hitSuccess) {
          onHitTarget(this.damage, this.mesh.position.clone(), result.targetName, result.hpRatio, false, npc, result.isMountHit)
        }
        this.destroy()
        return
      }
    }

    // Out of bounds check
    if (this.mesh.position.lengthSq() > 200 * 200) {
      this.destroy()
    }
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh)
    }
  }
}
