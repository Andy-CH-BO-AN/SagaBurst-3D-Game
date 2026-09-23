import * as THREE from 'three'
import { Faction, NPC } from '../world/NPC'
import { ObstacleData, PLAYABLE_WORLD_BOUND, clampToPlayableWorld, getTerrainHeight } from '../world/Terrain'
import type { ArmyCommandTarget } from './ArmyCommandController'
import {
  assignUnitsToSlots,
  FORMATION_ALL_MAX_COLUMNS,
  FORMATION_UNIT_MAX_COLUMNS,
  formationRowAxis,
  generateFormationSlots,
  getFormationBoundaryShift,
  horizontalFormationForward,
} from './FormationMath'
import { resolveFormationSlots } from './FormationPlacement'
import type { FormationPlacement } from './FormationPlacement'
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
  target: ArmyCommandTarget
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
  private readonly previewHitCenter = new THREE.Vector3()
  private readonly previewCenter = new THREE.Vector3()
  private readonly previewForward = new THREE.Vector3(0, 0, 1)
  private previewSlots: THREE.Vector3[] = []
  private previewParticipants: NPC[] = []
  private previewParticipantsSignature = ''
  private previewBlocked = false
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
    this.previewParticipantsSignature = ''
    this.previewBlocked = false
    this.previewInitialized = false
    this.previewSlots = []
    this.previewFrame = 0
    this.preview.clear()
    this.updatePlacement()
  }

  cancelPlacement(): void {
    this.placementTarget = null
    this.previewParticipantsSignature = ''
    this.previewBlocked = false
    this.previewInitialized = false
    this.previewSlots = []
    this.preview.clear()
  }

  updatePlacement(): void {
    if (this.placementTarget === null) return
    this.previewFrame++
    const participantsChanged = this.previewFrame % 6 === 1 || this.previewParticipants.length === 0
    let participantCompositionChanged = false
    if (participantsChanged) {
      const participants = this.resolveParticipants(this.placementTarget)
      const signature = this.getParticipantSignature(participants)
      participantCompositionChanged = signature !== this.previewParticipantsSignature
      this.previewParticipants = participants
      this.previewParticipantsSignature = signature
    }

    this.raycaster.setFromCamera(this.screenCenter, this.camera)
    const intersections = this.raycaster.intersectObject(this.terrainMesh, false)
    if (intersections.length === 0 || this.previewParticipants.length === 0) {
      this.previewParticipantsSignature = ''
      this.previewBlocked = false
      this.previewInitialized = false
      this.previewSlots = []
      this.preview.clear()
      return
    }

    const hitCenter = intersections[0].point.clone()
    clampToPlayableWorld(hitCenter)
    hitCenter.y = getTerrainHeight(hitCenter.x, hitCenter.z)
    const forward = horizontalFormationForward(this.raycaster.ray.direction)
    const geometryChanged = !this.previewInitialized
      || hitCenter.distanceToSquared(this.previewHitCenter) > 0.01
      || forward.dot(this.previewForward) < 0.999
    if (!geometryChanged && !participantCompositionChanged) return

    const placement = this.resolvePlacement(hitCenter, forward, this.previewParticipants, this.placementTarget)
    const formation = placement ?? this.makeFormation(
      hitCenter,
      forward,
      this.previewParticipants.length,
      this.getMaxColumns(this.placementTarget),
    )
    this.previewBlocked = placement === null
    this.previewHitCenter.copy(hitCenter)
    this.previewCenter.copy(formation.center)
    this.previewForward.copy(forward)
    this.previewSlots = placement?.slots ?? []
    this.previewInitialized = true
    this.preview.show(formation.center, formation.slots, placement !== null)
  }

  confirmPlacement(): FormationCommandResult {
    if (this.placementTarget === null) return { accepted: false, count: 0, commandId: null, participants: [] }
    const snapshot = this.resolvePlacementSnapshot(this.placementTarget)
    if (!snapshot) {
      this.markCurrentPlacementInvalid()
      return { accepted: false, count: 0, commandId: null, participants: [] }
    }

    const commandId = this.nextCommandId++
    const rowAxis = formationRowAxis(snapshot.forward)
    const assignments = assignUnitsToSlots(
      snapshot.participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      snapshot.slots,
      rowAxis,
      snapshot.center,
      snapshot.forward,
      this.getMaxColumns(snapshot.target),
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
    if (!this.previewInitialized) return null
    const participants = this.resolveParticipants(target)
    if (participants.length === 0) return null
    const forward = this.previewForward.clone()
    const compositionUnchanged = this.getParticipantSignature(participants) === this.previewParticipantsSignature
    const shown = compositionUnchanged && !this.previewBlocked
      ? { center: this.previewCenter.clone(), slots: this.previewSlots.map(slot => slot.clone()) }
      : null
    const placement = shown && this.areSlotsUsable(shown.slots, participants, shown.center, forward, target)
      ? shown
      : this.resolvePlacement(this.previewHitCenter, forward, participants, target)
    if (!placement) return null
    return {
      target,
      center: placement.center,
      forward,
      slots: placement.slots,
      participants,
    }
  }

  private resolvePlacement(
    requestedCenter: THREE.Vector3,
    forward: THREE.Vector3,
    participants: readonly NPC[],
    target: ArmyCommandTarget,
  ): FormationPlacement | null {
    const formation = this.makeFormation(requestedCenter, forward, participants.length, this.getMaxColumns(target))
    const assignments = assignUnitsToSlots(
      participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      formation.slots,
      formationRowAxis(forward),
      formation.center,
      forward,
      this.getMaxColumns(target),
    )
    const slots = resolveFormationSlots(
      formation.slots,
      forward,
      assignments.map(assignment => assignment.unit.npc),
      npc => npc.isMounted ? 1 : 0.5,
      (slot, npc) => !this.isSlotBlocked(slot, npc),
      getTerrainHeight,
      PLAYABLE_WORLD_BOUND,
    )
    return slots ? { center: formation.center, slots } : null
  }

  private makeFormation(center: THREE.Vector3, forward: THREE.Vector3, count: number, maxColumns: number): { center: THREE.Vector3; slots: THREE.Vector3[] } {
    const rawSlots = generateFormationSlots(center, forward, count, maxColumns)
    const shift = getFormationBoundaryShift(rawSlots, PLAYABLE_WORLD_BOUND)
    const shiftedCenter = center.clone().add(shift)
    const slots = rawSlots.map(slot => slot.add(shift))
    for (const slot of slots) {
      slot.y = getTerrainHeight(slot.x, slot.z)
    }
    return { center: shiftedCenter, slots }
  }

  private areSlotsUsable(
    slots: readonly THREE.Vector3[],
    participants: readonly NPC[],
    center: THREE.Vector3,
    forward: THREE.Vector3,
    target: ArmyCommandTarget,
  ): boolean {
    if (slots.length !== participants.length) return false
    const rowAxis = formationRowAxis(forward)
    const assignments = assignUnitsToSlots(
      participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      slots,
      rowAxis,
      center,
      forward,
      this.getMaxColumns(target),
    )
    for (let index = 0; index < assignments.length; index++) {
      const { slot, unit } = assignments[index]
      if (Math.abs(slot.x) > PLAYABLE_WORLD_BOUND || Math.abs(slot.z) > PLAYABLE_WORLD_BOUND || this.isSlotBlocked(slot, unit.npc)) return false
      const radius = unit.npc.isMounted ? 1 : 0.5
      for (let other = 0; other < index; other++) {
        const otherRadius = assignments[other].unit.npc.isMounted ? 1 : 0.5
        const dx = slot.x - assignments[other].slot.x
        const dz = slot.z - assignments[other].slot.z
        if (dx * dx + dz * dz < (radius + otherRadius) ** 2 - 0.0001) return false
      }
    }
    return true
  }

  private isSlotBlocked(slot: THREE.Vector3, npcOrMounted: NPC | boolean): boolean {
    const mounted = typeof npcOrMounted === 'boolean' ? npcOrMounted : npcOrMounted.isMounted
    const radius = mounted ? 1 : 0.5
    const bottom = slot.y
    const top = bottom + (mounted ? 2.6 : 2.3)
    return this.obstacles.some(obstacle => {
      const box = obstacle.box
      if (bottom >= box.max.y - 0.001 || top <= box.min.y + 0.001) return false
      return slot.x + radius > box.min.x && slot.x - radius < box.max.x
        && slot.z + radius > box.min.z && slot.z - radius < box.max.z
    })
  }

  private getMaxColumns(target: ArmyCommandTarget): number {
    return target === 'all' ? FORMATION_ALL_MAX_COLUMNS : FORMATION_UNIT_MAX_COLUMNS
  }

  private markCurrentPlacementInvalid(): void {
    if (this.placementTarget === null || !this.previewInitialized) return
    const participants = this.resolveParticipants(this.placementTarget)
    if (participants.length === 0) {
      this.previewInitialized = false
      this.preview.clear()
      return
    }
    const formation = this.makeFormation(
      this.previewHitCenter,
      this.previewForward,
      participants.length,
      this.getMaxColumns(this.placementTarget),
    )
    this.previewCenter.copy(formation.center)
    this.previewSlots = []
    this.previewParticipants = participants
    this.previewParticipantsSignature = this.getParticipantSignature(participants)
    this.previewBlocked = true
    this.previewInitialized = true
    this.preview.show(formation.center, formation.slots, false)
  }

  private getParticipantSignature(participants: readonly NPC[]): string {
    return participants
      .map(npc => `${npc.name}:${npc.isMounted ? 'mounted' : 'foot'}`)
      .join('|')
  }
}
