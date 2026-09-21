import * as THREE from 'three'
import { Faction, NPC } from '../world/NPC'
import { clampToPlayableWorld, getTerrainHeight } from '../world/Terrain'
import type { ArmyCommandTarget } from './ArmyCommandController'
import {
  assignUnitsToSlots,
  FORMATION_SLOT_SPACING,
  formationRowAxis,
  generateLineFormationSlots,
  horizontalFormationForward,
} from './FormationMath'
import { FormationPreview } from '../ui/FormationPreview'

export interface FormationCommandResult {
  accepted: boolean
  count: number
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

export type FormationCompletionHandler = (target: ArmyCommandTarget, participants: readonly NPC[]) => void

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
    this.previewFrame = 0
    this.preview.clear()
    this.updatePlacement()
  }

  cancelPlacement(): void {
    this.placementTarget = null
    this.previewInitialized = false
    this.previewValid = false
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
      this.preview.clear()
      return
    }

    const center = intersections[0].point.clone()
    clampToPlayableWorld(center)
    center.y = getTerrainHeight(center.x, center.z)
    const forward = horizontalFormationForward(this.raycaster.ray.direction)
    const slots = this.makeClampedSlots(center, forward, this.previewParticipants.length)
    const changed = !this.previewInitialized
      || center.distanceToSquared(this.previewCenter) > 0.01
      || forward.dot(this.previewForward) < 0.999
      || slots.length !== this.previewSlots.length

    this.previewValid = true
    if (changed) {
      this.previewCenter.copy(center)
      this.previewForward.copy(forward)
      this.previewSlots = slots
      this.previewInitialized = true
      this.preview.show(center, slots, true)
    }
  }

  confirmPlacement(): FormationCommandResult {
    if (this.placementTarget === null) return { accepted: false, count: 0 }
    const snapshot = this.resolvePlacementSnapshot(this.placementTarget)
    if (!snapshot || !this.previewValid) return { accepted: false, count: 0 }

    const commandId = this.nextCommandId++
    const rowAxis = formationRowAxis(snapshot.forward)
    const assignments = assignUnitsToSlots(
      snapshot.participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      snapshot.slots,
      rowAxis,
      snapshot.center,
    )
    for (const assignment of assignments) {
      assignment.unit.npc.assignFormationTarget(commandId, assignment.slot, snapshot.forward)
    }
    this.activeCommands.push({ id: commandId, target: this.placementTarget, participants: snapshot.participants })
    this.cancelPlacement()
    return { accepted: true, count: assignments.length }
  }

  /** Call after NPC updates so arrival is observed without adding work to every NPC frame. */
  updateCompletion(): void {
    if (this.activeCommands.length === 0) return
    const remaining: FormationCommand[] = []
    for (const command of this.activeCommands) {
      const active = command.participants.filter(npc => !npc.dead && npc.formationCommandId === command.id)
      if (active.length === 0) continue
      if (active.every(npc => npc.isFormationTargetReached(command.id))) {
        this.completionHandler?.(command.target, active)
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
      slots: this.makeClampedSlots(center, forward, participants.length),
      participants,
    }
  }

  private makeClampedSlots(center: THREE.Vector3, forward: THREE.Vector3, count: number): THREE.Vector3[] {
    return generateLineFormationSlots(center, forward, count, FORMATION_SLOT_SPACING).map(slot => {
      clampToPlayableWorld(slot)
      slot.y = getTerrainHeight(slot.x, slot.z)
      return slot
    })
  }
}
