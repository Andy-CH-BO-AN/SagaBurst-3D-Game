import * as THREE from 'three'
import type { CharacterFaction } from './CharacterVisuals'

export type DamageableObstacleKind =
  | 'tree'
  | 'palisade'
  | 'gate'
  | 'chevaux_de_frise'
  | 'tent'

export const DAMAGEABLE_OBSTACLE_HP: Readonly<Record<DamageableObstacleKind, number>> = {
  tree: 180,
  palisade: 260,
  gate: 520,
  chevaux_de_frise: 160,
  tent: 120,
}

export interface DamageableObstacleOptions {
  kind: DamageableObstacleKind
  maxHp: number
  root: THREE.Object3D
  hitMeshes?: readonly THREE.Object3D[]
  ownerFaction?: CharacterFaction | null
}

export const DAMAGEABLE_OBSTACLE_NAMES: Readonly<Record<DamageableObstacleKind, string>> = {
  tree: 'Tree',
  palisade: 'Palisade',
  gate: 'Gate',
  chevaux_de_frise: 'Chevaux-de-frise',
  tent: 'Tent',
}

export interface DamageableObstacleHitResult {
  appliedDamage: number
  remainingHp: number
  hpRatio: number
  destroyed: boolean
}

/**
 * Runtime HP/lifecycle for destructible world obstacles.
 *
 * Navigation/collision ownership intentionally stays outside this class. Builders
 * subscribe to onDestroyed() and remove their ObstacleData from the shared
 * obstacles array so existing movement/detour code immediately sees the opening.
 */
export class DamageableObstacle {
  readonly kind: DamageableObstacleKind
  readonly maxHp: number
  readonly root: THREE.Object3D
  readonly hitMeshes: readonly THREE.Object3D[]
  readonly ownerFaction: CharacterFaction | null

  private _currentHp: number
  private _destroyed = false
  private readonly _onDestroyedCallbacks = new Set<(obstacle: DamageableObstacle) => void>()

  constructor(options: DamageableObstacleOptions) {
    if (!Number.isFinite(options.maxHp) || options.maxHp <= 0) {
      throw new Error(`DamageableObstacle maxHp must be > 0, got ${options.maxHp}`)
    }

    this.kind = options.kind
    this.maxHp = options.maxHp
    this._currentHp = options.maxHp
    this.root = options.root
    this.hitMeshes = options.hitMeshes ?? [options.root]
    this.ownerFaction = options.ownerFaction ?? null
  }

  get currentHp(): number {
    return this._currentHp
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this._currentHp / this.maxHp : 0
  }

  get destroyed(): boolean {
    return this._destroyed
  }

  get displayName(): string {
    return DAMAGEABLE_OBSTACLE_NAMES[this.kind]
  }

  isDamageableBy(attackerFaction: CharacterFaction): boolean {
    return this.ownerFaction === null || this.ownerFaction !== attackerFaction
  }

  takeDamage(amount: number): DamageableObstacleHitResult {
    if (this._destroyed || !Number.isFinite(amount) || amount <= 0) {
      return {
        appliedDamage: 0,
        remainingHp: this._currentHp,
        hpRatio: this.hpRatio,
        destroyed: this._destroyed,
      }
    }

    const previousHp = this._currentHp
    this._currentHp = Math.max(0, this._currentHp - amount)
    const appliedDamage = previousHp - this._currentHp

    if (this._currentHp <= 0) {
      this.destroy()
    }

    return {
      appliedDamage,
      remainingHp: this._currentHp,
      hpRatio: this.hpRatio,
      destroyed: this._destroyed,
    }
  }

  /** Force destruction. Returns true only for the first transition. */
  destroy(): boolean {
    if (this._destroyed) return false

    this._destroyed = true
    this._currentHp = 0
    this.root.visible = false
    this.root.removeFromParent()

    for (const callback of [...this._onDestroyedCallbacks]) {
      callback(this)
    }

    return true
  }

  onDestroyed(callback: (obstacle: DamageableObstacle) => void): () => void {
    this._onDestroyedCallbacks.add(callback)
    return () => {
      this._onDestroyedCallbacks.delete(callback)
    }
  }
}