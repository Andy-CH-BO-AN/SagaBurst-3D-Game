import * as THREE from 'three'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import { AIType, type NPC } from '../world/NPC'
import { removeObstacleData, type ObstacleData } from '../world/Terrain'

export type CampaignGateState = 'closed' | 'open' | 'destroyed'

export interface CampaignGateControllerOptions {
  defenderFaction: CharacterFaction
  damageable: DamageableObstacle
  obstacle: ObstacleData
  obstacles: ObstacleData[]
  leftHinge: THREE.Object3D
  rightHinge: THREE.Object3D
  openRotationY: number
  breachController: CampaignBreachController
}

export interface CampaignBreachOrderResult {
  attackerChargeCount: number
  attackerAttackCount: number
  defenderAttackCount: number
}

export const CAMPAIGN_GATE_CLOSE_CLEARANCE = 1.25

export function opposingFaction(faction: CharacterFaction): CharacterFaction {
  return faction === 'roman' ? 'viking' : 'roman'
}

/** Shared one-shot latch for every way an outpost perimeter can be breached. */
export class CampaignBreachController {
  private _breached = false
  private readonly callbacks = new Set<() => void>()

  get breached(): boolean {
    return this._breached
  }

  trigger(): boolean {
    if (this._breached) return false
    this._breached = true
    for (const callback of [...this.callbacks]) callback()
    return true
  }

  onBreach(callback: () => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }
}

/**
 * Campaign breach transition:
 * - attacker melee units Charge through the opening
 * - attacker ranged units remain on Attack
 * - defenders leave Defend and switch to Attack
 */
export function applyCampaignBreachOrders(
  npcs: readonly NPC[],
  attackerFaction: CharacterFaction,
): CampaignBreachOrderResult {
  const defenderFaction = opposingFaction(attackerFaction)
  let attackerChargeCount = 0
  let attackerAttackCount = 0
  let defenderAttackCount = 0

  for (const npc of npcs) {
    if (npc.dead) continue

    if (npc.characterFaction === attackerFaction) {
      if (npc.aiType === AIType.RANGED) {
        npc.setTacticalOrder('attack')
        attackerAttackCount++
      } else {
        npc.setTacticalOrder('charge')
        attackerChargeCount++
      }
      continue
    }

    if (npc.characterFaction === defenderFaction) {
      npc.setTacticalOrder('attack')
      defenderAttackCount++
    }
  }

  return {
    attackerChargeCount,
    attackerAttackCount,
    defenderAttackCount,
  }
}

/**
 * Uses X/Z occupancy only. Uneven terrain height should not allow a gate to
 * close through a player, NPC, or mount standing in the doorway.
 */
export function isCampaignGateOccupied(
  gateBox: THREE.Box3,
  positions: readonly THREE.Vector3[],
  clearance = CAMPAIGN_GATE_CLOSE_CLEARANCE,
): boolean {
  for (const position of positions) {
    if (
      position.x >= gateBox.min.x - clearance
      && position.x <= gateBox.max.x + clearance
      && position.z >= gateBox.min.z - clearance
      && position.z <= gateBox.max.z + clearance
    ) {
      return true
    }
  }
  return false
}

export class CampaignGateController {
  readonly defenderFaction: CharacterFaction
  readonly attackerFaction: CharacterFaction
  readonly damageable: DamageableObstacle
  readonly collisionBox: THREE.Box3

  private readonly obstacle: ObstacleData
  private readonly obstacles: ObstacleData[]
  private readonly leftHinge: THREE.Object3D
  private readonly rightHinge: THREE.Object3D
  private readonly openRotationY: number
  private readonly breachController: CampaignBreachController

  private _state: CampaignGateState = 'closed'

  constructor(options: CampaignGateControllerOptions) {
    this.defenderFaction = options.defenderFaction
    this.attackerFaction = opposingFaction(options.defenderFaction)
    this.damageable = options.damageable
    this.obstacle = options.obstacle
    this.obstacles = options.obstacles
    this.leftHinge = options.leftHinge
    this.rightHinge = options.rightHinge
    this.openRotationY = options.openRotationY
    this.breachController = options.breachController
    this.collisionBox = options.obstacle.box

    this.damageable.onDestroyed(() => {
      this._state = 'destroyed'
      removeObstacleData(this.obstacles, this.obstacle)
      this.breachController.trigger()
    })
  }

  get state(): CampaignGateState {
    return this._state
  }

  get breached(): boolean {
    return this.breachController.breached
  }

  open(): boolean {
    if (this._state === 'destroyed') return false
    if (this._state === 'open') return true

    this._state = 'open'
    removeObstacleData(this.obstacles, this.obstacle)
    this.leftHinge.rotation.y = this.openRotationY
    this.rightHinge.rotation.y = -this.openRotationY
    this.breachController.trigger()
    return true
  }

  close(occupied = false): boolean {
    if (this._state === 'destroyed') return false
    if (this._state === 'closed') return true
    if (occupied) return false

    this._state = 'closed'
    if (!this.obstacles.includes(this.obstacle)) {
      this.obstacles.push(this.obstacle)
    }
    this.leftHinge.rotation.y = 0
    this.rightHinge.rotation.y = 0
    return true
  }

  toggle(occupied = false): boolean {
    return this._state === 'open' ? this.close(occupied) : this.open()
  }
}
