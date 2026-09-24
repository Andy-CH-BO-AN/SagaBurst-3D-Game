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
import type { NavigationWorld } from '../navigation/NavigationWorld'

export interface FormationCommandResult {
  accepted: boolean
  count: number
  commandId: number | null
  participants: readonly NPC[]
}

export interface FormationRegion {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
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
  columns: number
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
  private previewColumns = 0
  private previewParticipants: NPC[] = []
  private previewParticipantsSignature = ''
  private previewBlocked = false
  private previewInitialized = false
  private previewFrame = 0
  private previewTopologyRevision = -1
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
    private readonly navigationWorld: NavigationWorld | null = null,
    private readonly region: FormationRegion | null = null,
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
    this.navigationWorld?.sync(this.obstacles)
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
      || this.previewTopologyRevision !== (this.navigationWorld?.revision ?? -1)
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
    this.previewTopologyRevision = this.navigationWorld?.revision ?? -1
    this.previewSlots = placement?.slots ?? []
    this.previewColumns = placement?.columns ?? 0
    this.previewInitialized = true
    this.preview.show(formation.center, formation.slots, placement !== null)
  }

  confirmPlacement(): FormationCommandResult {
    if (this.placementTarget === null) return { accepted: false, count: 0, commandId: null, participants: [] }
    this.navigationWorld?.sync(this.obstacles)
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
      snapshot.columns,
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
      ? { center: this.previewCenter.clone(), slots: this.previewSlots.map(slot => slot.clone()), columns: this.previewColumns }
      : null
    const placement = shown && this.areSlotsUsable(shown.slots, participants, shown.center, forward, shown.columns)
      ? shown
      : this.resolvePlacement(this.previewHitCenter, forward, participants, target)
    if (!placement) return null
    return {
      target,
      center: placement.center,
      forward,
      slots: placement.slots,
      columns: placement.columns,
      participants,
    }
  }

  private resolvePlacement(
    requestedCenter: THREE.Vector3,
    forward: THREE.Vector3,
    participants: readonly NPC[],
    target: ArmyCommandTarget,
  ): FormationPlacement | null {
    const component = this.getFormationComponent(participants)
    const inside = this.getFormationRegionSide(requestedCenter, participants)
    const maxColumns = this.getMaxColumns(target)
    const widths = target === 'all'
      ? [maxColumns, 25, 10].filter((columns, index) => index === 0 || columns < participants.length)
      : [maxColumns]
    for (const columns of widths) {
      const formation = this.makeFormation(requestedCenter, forward, participants.length, columns)
      const assignments = assignUnitsToSlots(
        participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
        formation.slots,
        formationRowAxis(forward),
        formation.center,
        forward,
        columns,
      )
      const slots = resolveFormationSlots(
        formation.slots,
        forward,
        assignments.map(assignment => assignment.unit.npc),
        npc => npc.isMounted ? 1 : 0.5,
        (slot, npc) => !this.isSlotBlocked(slot, npc)
          && this.isInFormationComponent(slot, component)
          && this.isInFormationRegion(slot, inside),
        getTerrainHeight,
        PLAYABLE_WORLD_BOUND,
      )
      if (slots) return { center: formation.center, slots, columns }
    }
    return null
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
    columns: number,
  ): boolean {
    if (slots.length !== participants.length) return false
    const component = this.getFormationComponent(participants)
    const inside = this.getFormationRegionSide(this.previewHitCenter, participants)
    const rowAxis = formationRowAxis(forward)
    const assignments = assignUnitsToSlots(
      participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      slots,
      rowAxis,
      center,
      forward,
      columns,
    )
    for (let index = 0; index < assignments.length; index++) {
      const { slot, unit } = assignments[index]
      if (Math.abs(slot.x) > PLAYABLE_WORLD_BOUND || Math.abs(slot.z) > PLAYABLE_WORLD_BOUND
        || this.isSlotBlocked(slot, unit.npc) || !this.isInFormationComponent(slot, component)
        || !this.isInFormationRegion(slot, inside)) return false
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

  private getFormationComponent(participants: readonly NPC[]): number {
    if (!this.navigationWorld) return -1
    const counts = new Map<number, number>()
    let chosen = -1
    let most = 0
    for (const npc of participants) {
      const component = this.navigationWorld.componentAt(npc.combatPosition)
      if (component < 0) continue
      const count = (counts.get(component) ?? 0) + 1
      counts.set(component, count)
      if (count > most) { chosen = component; most = count }
    }
    return chosen
  }

  private isInFormationComponent(slot: THREE.Vector3, component: number): boolean {
    if (!this.navigationWorld) return true
    if (component < 0) return false
    const cell = this.navigationWorld.grid.worldToCell(slot)
    return Boolean(cell && !this.navigationWorld.grid.isBlocked(cell)
      && this.navigationWorld.componentAt(slot) === component)
  }

  private regionSide(position: THREE.Vector3): boolean | null {
    if (!this.region) return null
    const { minX, maxX, minZ, maxZ } = this.region
    if ((position.z >= minZ - 0.5 && position.z <= maxZ + 0.5
      && (Math.abs(position.x - minX) < 0.5 || Math.abs(position.x - maxX) < 0.5))
      || (position.x >= minX - 0.5 && position.x <= maxX + 0.5
        && (Math.abs(position.z - minZ) < 0.5 || Math.abs(position.z - maxZ) < 0.5))) return null
    return position.x > minX && position.x < maxX && position.z > minZ && position.z < maxZ
  }

  private getFormationRegionSide(center: THREE.Vector3, participants: readonly NPC[]): boolean | null {
    if (!this.region) return null
    const side = this.regionSide(center)
    if (side !== null) return side
    let inside = 0
    let outside = 0
    for (const npc of participants) {
      if (this.regionSide(npc.combatPosition)) inside++
      else outside++
    }
    return inside >= outside
  }

  private isInFormationRegion(slot: THREE.Vector3, inside: boolean | null): boolean {
    return inside === null || this.regionSide(slot) === inside
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
