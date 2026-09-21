import * as THREE from 'three'
import { Faction, NPC } from '../world/NPC'
import { ObstacleData, PLAYABLE_WORLD_BOUND, clampToPlayableWorld, getTerrainHeight } from '../world/Terrain'
import type { ArmyCommandTarget } from './ArmyCommandController'
import {
  assignUnitsToSlots,
  formationRowAxis,
  generateFormationSlots,
  getFormationBoundaryShift,
  horizontalFormationForward,
} from './FormationMath'
import { FormationPreview } from '../ui/FormationPreview'

export interface FormationCommandResult {
  accepted: boolean
  count: number
  commandId: number | null
  participants: readonly NPC[]
}

interface FormationCommand {
  id: number
  target: ArmyCommandTarget
  participants: NPC[]
}

interface PlacementSnapshot {
  center: THREE.Vector3
  forward: THREE.Vector3
  slots: THREE.Vector3[]
  participants: NPC[]
}

export type FormationCompletionHandler = (
  commandId: number,
  target: ArmyCommandTarget,
  participants: readonly NPC[],
  status: 'completed' | 'abandoned',
) => void

/** Owns placement, one-shot slot assignment, and formation command completion. */
export class FormationController {
  private readonly raycaster = new THREE.Raycaster()
  private readonly screenCenter = new THREE.Vector2(0, 0)
  private readonly preview: FormationPreview
  private readonly previewCenter = new THREE.Vector3()
  private readonly previewForward = new THREE.Vector3(0, 0, 1)
  private previewSlots: THREE.Vector3[] = []
  private previewParticipants: NPC[] = []
  private previewValid = false
  private previewInitialized = false
  private previewRenderedValid = false
  private previewFrame = 0
  private placementTarget: ArmyCommandTarget | null = null
  private nextCommandId = 1
  private activeCommands: FormationCommand[] = []
  private completionHandler: FormationCompletionHandler | null = null

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly npcs: readonly NPC[],
    private readonly terrainMesh: THREE.Object3D,
    private readonly obstacles: readonly ObstacleData[],
  ) {
    this.preview = new FormationPreview(scene)
    this.raycaster.far = 500
  }

  setCompletionHandler(handler: FormationCompletionHandler): void {
    this.completionHandler = handler
  }

  get isPlacementMode(): boolean { return this.placementTarget !== null }

  beginPlacement(target: ArmyCommandTarget): void {
    this.placementTarget = target
    this.previewInitialized = false
    this.previewValid = false
    this.previewRenderedValid = false
    this.previewFrame = 0
    this.preview.clear()
    this.updatePlacement()
  }

  cancelPlacement(): void {
    this.placementTarget = null
    this.previewInitialized = false
    this.previewValid = false
    this.previewRenderedValid = false
    this.preview.clear()
  }

  updatePlacement(): void {
    if (this.placementTarget === null) return
    this.previewFrame++
    const participantsChanged = this.previewFrame % 6 === 1 || this.previewParticipants.length === 0
    if (participantsChanged) {
      this.previewParticipants = this.resolveParticipants(this.placementTarget)
    }

    this.raycaster.setFromCamera(this.screenCenter, this.camera)
    const intersections = this.raycaster.intersectObject(this.terrainMesh, false)
    if (intersections.length === 0 || this.previewParticipants.length === 0) {
      this.previewValid = false
      this.previewInitialized = false
      this.previewRenderedValid = false
      this.preview.clear()
      return
    }

    const hitCenter = intersections[0].point.clone()
    clampToPlayableWorld(hitCenter)
    hitCenter.y = getTerrainHeight(hitCenter.x, hitCenter.z)
    const forward = horizontalFormationForward(this.raycaster.ray.direction)
    const formation = this.makeFormation(hitCenter, forward, this.previewParticipants.length)
    const blocked = formation.slots.some(slot => this.isSlotBlocked(slot))
    const changed = !this.previewInitialized
      || formation.center.distanceToSquared(this.previewCenter) > 0.01
      || forward.dot(this.previewForward) < 0.999
      || formation.slots.length !== this.previewSlots.length
      || blocked !== !this.previewRenderedValid

    this.previewValid = !blocked
    if (changed) {
      this.previewCenter.copy(formation.center)
      this.previewForward.copy(forward)
      this.previewSlots = formation.slots
      this.previewInitialized = true
      this.previewRenderedValid = !blocked
      this.preview.show(formation.center, formation.slots, !blocked)
    }
  }

  confirmPlacement(): FormationCommandResult {
    if (this.placementTarget === null) return { accepted: false, count: 0, commandId: null, participants: [] }
    const snapshot = this.resolvePlacementSnapshot(this.placementTarget)
    if (!snapshot || !this.previewValid) return { accepted: false, count: 0, commandId: null, participants: [] }

    const commandId = this.nextCommandId++
    const rowAxis = formationRowAxis(snapshot.forward)
    const assignments = assignUnitsToSlots(
      snapshot.participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      snapshot.slots,
      rowAxis,
      snapshot.center,
      snapshot.forward,
    )
    for (const assignment of assignments) {
      assignment.unit.npc.assignFormationTarget(commandId, assignment.slot, snapshot.forward)
    }
    this.activeCommands.push({ id: commandId, target: this.placementTarget, participants: snapshot.participants })
    this.cancelPlacement()
    return { accepted: true, count: assignments.length, commandId, participants: snapshot.participants }
  }

  /** Call after NPC updates so arrival is observed without adding work to every NPC frame. */
  updateCompletion(): void {
    if (this.activeCommands.length === 0) return
    const remaining: FormationCommand[] = []
    for (const command of this.activeCommands) {
      const active = command.participants.filter(npc => !npc.dead && npc.formationCommandId === command.id)
      if (active.length === 0) {
        this.completionHandler?.(command.id, command.target, command.participants, 'abandoned')
        continue
      }
      if (active.every(npc => npc.isFormationTargetReached(command.id))) {
        this.completionHandler?.(command.id, command.target, active, 'completed')
      } else {
        remaining.push(command)
      }
    }
    this.activeCommands = remaining
  }

  private resolveParticipants(target: ArmyCommandTarget): NPC[] {
    return this.npcs.filter(npc => {
      if (npc.faction !== Faction.PLAYER || npc.dead) return false
      if (target === 'all') return true
      return npc.presetId === target
    })
  }

  private resolvePlacementSnapshot(target: ArmyCommandTarget): PlacementSnapshot | null {
    if (!this.previewValid) return null
    const participants = this.resolveParticipants(target)
    if (participants.length === 0) return null
    const center = this.previewCenter.clone()
    const forward = this.previewForward.clone()
    return {
      center,
      forward,
      slots: this.makeFormation(center, forward, participants.length).slots,
      participants,
    }
  }

  private makeFormation(center: THREE.Vector3, forward: THREE.Vector3, count: number): { center: THREE.Vector3; slots: THREE.Vector3[] } {
    const rawSlots = generateFormationSlots(center, forward, count)
    const shift = getFormationBoundaryShift(rawSlots, PLAYABLE_WORLD_BOUND)
    const shiftedCenter = center.clone().add(shift)
    const slots = rawSlots.map(slot => slot.add(shift))
    for (const slot of slots) {
      slot.y = getTerrainHeight(slot.x, slot.z)
    }
    return { center: shiftedCenter, slots }
  }

  private isSlotBlocked(slot: THREE.Vector3): boolean {
    const radius = 0.5
    const bottom = slot.y
    const top = bottom + 2.3
    return this.obstacles.some(obstacle => {
      const box = obstacle.box
      if (bottom >= box.max.y - 0.001 || top <= box.min.y + 0.001) return false
      return slot.x + radius > box.min.x && slot.x - radius < box.max.x
        && slot.z + radius > box.min.z && slot.z - radius < box.max.z
    })
  }
}
