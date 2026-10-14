import * as THREE from 'three'
import { Faction, NPC } from '../world/NPC'
import { ObstacleData, PLAYABLE_WORLD_BOUND, clampToPlayableWorld, getTerrainHeight } from '../world/Terrain'
import { matchesArmyCommandTarget, type ArmyCommandTarget } from './CommandTarget'
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
import { getOutpostNavLayer, isRampartLayer, layerSide } from '../navigation/OutpostLayeredNavigation'
import { OUTPOST_WALKWAY, type OutpostWalkwayBridge, type OutpostWalkwayDeck } from '../campaign/CampaignOutpostWalkways'
import { getWalkRampHeight } from '../world/Terrain'
import { getOutpostRampartArcherSlots } from '../campaign/OutpostRampartGarrison'
import { getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { XONGKORO } from '../movement/XongkoroConfig'

/** Exact resolved checkpoint, available to save before the corresponding NPC mutation. */
export interface FormationCommandAssignment {
  readonly npc: NPC
  readonly commandId: number
  readonly position: Readonly<{ x: number; y: number; z: number; yaw: number }>
  readonly reached: false
}

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
  private participantPolicy: ((npc: NPC) => boolean) | null = null

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

  setParticipantPolicy(policy: (npc: NPC) => boolean): void { this.participantPolicy = policy }

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
    const deckHit = this.findRampartDeckHit(this.raycaster.ray)
    if ((intersections.length === 0 && !deckHit) || this.previewParticipants.length === 0) {
      this.previewParticipantsSignature = ''
      this.previewBlocked = false
      this.previewInitialized = false
      this.previewSlots = []
      this.preview.clear()
      return
    }

    const hitCenter = deckHit && (intersections.length === 0 || deckHit.distance < intersections[0].distance)
      ? deckHit.hitPoint.clone()
      : intersections[0].point.clone()
    const outpostNav = this.navigationWorld?.outpostNav
    const isDeckHit = Boolean(deckHit && (intersections.length === 0 || deckHit.distance < intersections[0].distance))
      || Boolean(outpostNav && isRampartLayer(getOutpostNavLayer(hitCenter, outpostNav.layout)))

    if (!isDeckHit) {
      clampToPlayableWorld(hitCenter)
      hitCenter.y = getTerrainHeight(hitCenter.x, hitCenter.z)
    }
    const forward = horizontalFormationForward(this.raycaster.ray.direction)
    const geometryChanged = !this.previewInitialized
      || hitCenter.distanceToSquared(this.previewHitCenter) > 0.01
      || forward.dot(this.previewForward) < 0.999
      || this.previewTopologyRevision !== (this.navigationWorld?.revision ?? -1)
    if (!geometryChanged && !participantCompositionChanged) return

    const rampartLayer = outpostNav ? getOutpostNavLayer(hitCenter, outpostNav.layout) : 'ground'
    const deck = isRampartLayer(rampartLayer)
      ? (rampartLayer === 'rampart_gate'
          ? outpostNav!.layout.bridge
          : outpostNav!.getDeck(layerSide(rampartLayer)!)) ?? null
      : null

    const placement = this.resolvePlacement(hitCenter, forward, this.previewParticipants, this.placementTarget)
    const formation = placement ?? (deck
      ? this.makeRampartFormation(hitCenter, forward, this.previewParticipants.length, deck)
      : this.makeFormation(
          hitCenter,
          forward,
          this.previewParticipants.length,
          this.getMaxColumns(this.placementTarget),
        ))
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

  findRampartDeckHit(ray: THREE.Ray): { deck: OutpostWalkwayDeck | OutpostWalkwayBridge; hitPoint: THREE.Vector3; distance: number } | null {
    const outpostNav = this.navigationWorld?.outpostNav
    if (!outpostNav) return null
    let best: { deck: OutpostWalkwayDeck | OutpostWalkwayBridge; hitPoint: THREE.Vector3; distance: number } | null = null

    const candidates: (OutpostWalkwayDeck | OutpostWalkwayBridge)[] = [...outpostNav.layout.decks]
    if (outpostNav.layout.bridge) {
      candidates.push(outpostNav.layout.bridge)
    }

    const tmpBox = new THREE.Box3()
    const tmpHit = new THREE.Vector3()

    for (const item of candidates) {
      const slab = item.slab

      // 1. Underside check: If the ray origin is underneath the slab footprint in X/Z and below slab top,
      // looking upwards must NEVER hit the rampart (avoids false hits when looking straight up at ceiling).
      const isUnderSlab =
        ray.origin.x >= slab.min.x - 0.2 &&
        ray.origin.x <= slab.max.x + 0.2 &&
        ray.origin.z >= slab.min.z - 0.2 &&
        ray.origin.z <= slab.max.z + 0.2 &&
        ray.origin.y < slab.max.y

      if (isUnderSlab && ray.direction.y > 0) continue

      // 2. Upper bounding box of the walkway (slab top surface + parapet/railings).
      // Bottom of upperBox is slab.min.y (bottom of wooden planks).
      // Top of upperBox is slab.max.y + railHeight + margin.
      const railH = OUTPOST_WALKWAY.railHeight
      tmpBox.min.set(slab.min.x, slab.min.y, slab.min.z)
      tmpBox.max.set(slab.max.x, slab.max.y + railH + 0.3, slab.max.z)

      const intersection = ray.intersectBox(tmpBox, tmpHit)
      if (!intersection) continue

      // 3. Entry face check: If ray is pointing upwards and enters through the bottom face (-Y face)
      // of the wood planks, it is striking the underside of the floor planks from below, not a visible face.
      if (ray.direction.y > 0 && tmpHit.y <= slab.min.y + 0.08) {
        continue
      }

      // 4. Safe margin clamping on the walkable surface
      const minX = slab.min.x + 0.6
      const maxX = slab.max.x - 0.6
      const minZ = slab.min.z + 0.55
      const maxZ = slab.max.z - 0.55

      let targetX: number
      let targetZ: number

      if (ray.origin.y > slab.max.y && ray.direction.y < -0.0001) {
        const tPlane = (item.topY - ray.origin.y) / ray.direction.y
        if (tPlane > 0) {
          targetX = ray.origin.x + tPlane * ray.direction.x
          targetZ = ray.origin.z + tPlane * ray.direction.z
        } else {
          targetX = tmpHit.x
          targetZ = tmpHit.z
        }
      } else {
        targetX = tmpHit.x
        targetZ = tmpHit.z
      }

      if (targetX < minX || targetX > maxX || targetZ < minZ || targetZ > maxZ) {
        targetX = THREE.MathUtils.clamp(targetX, minX, maxX)
        targetZ = THREE.MathUtils.clamp(targetZ, minZ, maxZ)
      }

      const surfaceY = ('walkSurface' in item && item.walkSurface)
        ? (getWalkRampHeight(item.walkSurface, targetX, targetZ) ?? item.topY)
        : item.topY

      const dist = ray.origin.distanceTo(tmpHit)
      if (!best || dist < best.distance) {
        best = {
          deck: item,
          hitPoint: new THREE.Vector3(targetX, surfaceY, targetZ),
          distance: dist,
        }
      }
    }
    return best
  }

  confirmPlacement(beforeAssign?: (
    participants: readonly NPC[], assignments: readonly FormationCommandAssignment[],
  ) => boolean): FormationCommandResult {
    if (this.placementTarget === null) return { accepted: false, count: 0, commandId: null, participants: [] }
    this.navigationWorld?.sync(this.obstacles)
    const snapshot = this.resolvePlacementSnapshot(this.placementTarget)
    if (!snapshot) {
      this.markCurrentPlacementInvalid()
      return { accepted: false, count: 0, commandId: null, participants: [] }
    }

    // Reload restores NPC targets independently of this controller. Reserve a fresh
    // ID above every restored command, including squads outside this selection.
    let commandId = this.nextCommandId
    for (const npc of this.npcs) {
      const restoredId = npc.formationCommandId
      if (restoredId != null && Number.isSafeInteger(restoredId) && restoredId > 0) {
        commandId = Math.max(commandId, restoredId + 1)
      }
    }
    const rowAxis = formationRowAxis(snapshot.forward)
    const assignments: FormationCommandAssignment[] = assignUnitsToSlots(
      snapshot.participants.map(npc => ({ id: npc.name, position: npc.combatPosition, npc })),
      snapshot.slots,
      rowAxis,
      snapshot.center,
      snapshot.forward,
      snapshot.columns,
    ).map(assignment => {
      const npc = assignment.unit.npc
      const slot = assignment.slot
      return { npc, commandId, reached: false, position: {
        x: slot.x, z: slot.z,
        y: npc.mount?.isFlyingMount ? getTerrainHeight(slot.x, slot.z) + XONGKORO.aiCruiseHeight : slot.y,
        yaw: Math.atan2(snapshot.forward.x, snapshot.forward.z),
      } }
    })
    // Save both authority and these exact slots before mutation. A denied save also
    // leaves the command ID available for a safe retry of the same placement.
    if (beforeAssign && !beforeAssign(snapshot.participants, assignments)) {
      return { accepted: false, count: 0, commandId: null, participants: [] }
    }
    this.nextCommandId = commandId + 1
    for (const assignment of assignments) {
      const { x, y, z } = assignment.position
      assignment.npc.assignFormationTarget(commandId, new THREE.Vector3(x, y, z), snapshot.forward)
    }
    this.activeCommands.push({ id: commandId, target: this.placementTarget, participants: snapshot.participants })
    this.cancelPlacement()
    return { accepted: true, count: assignments.length, commandId, participants: snapshot.participants }
  }

  /** Add a newly commandable member without moving soldiers already assigned to this formation. */
  joinCommand(npc: NPC, reference: NPC): boolean {
    const saved = reference.combatFormationCheckpoint
    if (!saved || npc.dead || this.participantPolicy && !this.participantPolicy(npc)) return false
    this.navigationWorld?.sync(this.obstacles)
    const participants = this.npcs.filter(actor => actor !== npc && !actor.dead && actor.formationCommandId === saved.commandId)
    const point = new THREE.Vector3(saved.position.x, getTerrainHeight(saved.position.x, saved.position.z), saved.position.z)
    const forward = new THREE.Vector3(Math.sin(saved.position.yaw), 0, Math.cos(saved.position.yaw))
    const component = this.getFormationComponent([reference, npc]), inside = this.getFormationRegionSide(point, [reference])
    const radius = npc.isMounted ? 1 : .5
    const slots = resolveFormationSlots([point], forward, [npc], () => radius, slot => {
      if (Math.abs(slot.x) > PLAYABLE_WORLD_BOUND || Math.abs(slot.z) > PLAYABLE_WORLD_BOUND
        || this.isSlotBlocked(slot, npc) || !npc.mount?.isFlyingMount && !this.isInFormationComponent(slot, component)
        || !this.isInFormationRegion(slot, inside)) return false
      return participants.every(actor => {
        const p = actor.combatFormationCheckpoint?.position
        if (!p) return true
        return (slot.x - p.x) ** 2 + (slot.z - p.z) ** 2 >= (radius + (actor.isMounted ? 1 : .5)) ** 2
      })
    }, getTerrainHeight, PLAYABLE_WORLD_BOUND)
    if (!slots) return false
    const slot = slots[0]
    if (npc.mount?.isFlyingMount) slot.y = getTerrainHeight(slot.x, slot.z) + XONGKORO.aiCruiseHeight
    npc.assignFormationTarget(saved.commandId, slot, forward, saved.speedLimit, saved.arrivalOrder)
    this.nextCommandId = Math.max(this.nextCommandId, saved.commandId + 1)
    const command = this.activeCommands.find(command => command.id === saved.commandId)
    if (command) { if (!command.participants.includes(npc)) command.participants.push(npc) }
    else this.activeCommands.push({ id: saved.commandId, target: 'all', participants: [...participants, npc] })
    return true
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
    return this.npcs.filter(npc => (
      (this.participantPolicy ? this.participantPolicy(npc) : npc.faction === Faction.PLAYER)
      && !npc.dead
      && matchesArmyCommandTarget(npc, target)
    ))
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
    const outpostNav = this.navigationWorld?.outpostNav
    if (outpostNav) {
      const layer = getOutpostNavLayer(requestedCenter, outpostNav.layout)
      if (isRampartLayer(layer)) {
        const deck = layer === 'rampart_gate'
          ? outpostNav.layout.bridge
          : outpostNav.getDeck(layerSide(layer)!)
        if (deck) return this.resolveRampartPlacement(requestedCenter, forward, participants, deck)
      }
    }

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
          && (npc.mount?.isFlyingMount || this.isInFormationComponent(slot, component))
          && this.isInFormationRegion(slot, inside),
        getTerrainHeight,
        PLAYABLE_WORLD_BOUND,
      )
      if (slots) return { center: formation.center, slots, columns }
    }
    return null
  }

  private resolveRampartPlacement(
    requestedCenter: THREE.Vector3,
    _forward: THREE.Vector3,
    participants: readonly NPC[],
    _deck: OutpostWalkwayDeck | OutpostWalkwayBridge,
  ): FormationPlacement | null {
    const nav = this.navigationWorld!.outpostNav!
    const mounted = participants.some(npc => npc.isMounted || npc.mount || (npc as any).isAnimal || (npc as any).species)
    if (mounted && (!nav.hasMountedAccess || participants.some(npc => npc.mount?.isFlyingMount))) return null
    const faction = nav.layout.zSign < 0 ? 'roman' : 'viking'
    const available = getOutpostRampartArcherSlots(faction)
    const spacing = mounted ? 3.2 : 1.6
    const candidates: THREE.Vector3[] = []
    if (mounted) {
      // Mixed groups use mounted clearance throughout, so slot assignment cannot
      // accidentally place a rider in a narrow infantry firing position.
      const left = nav.getDeck(-1)!, right = nav.getDeck(1)!
      for (let x = left.slab.min.x + 1.2; x <= right.slab.max.x - 1.2; x += spacing) {
        const surface = x < nav.layout.bridge.slab.min.x ? left : x > nav.layout.bridge.slab.max.x ? right : nav.layout.bridge
        for (let z = surface.slab.min.z + 1.6; z <= surface.slab.max.z - 1.6 + .001; z += spacing) {
          candidates.push(new THREE.Vector3(x, getWalkRampHeight(surface.walkSurface, x, z) ?? surface.topY, z))
        }
      }
    } else {
      const front = [...available.left, ...available.gate, ...available.right]
      // Keep the front firing positions and add two ranks on the widened deck.
      for (const inward of [0, 1.6, 3.2]) {
        candidates.push(...front.map(slot => new THREE.Vector3(slot.x, slot.y, slot.z + nav.layout.zSign * inward)))
      }
    }
    const unselected = this.npcs.filter(npc => !npc.dead && !participants.includes(npc))
    const clear = (slot: THREE.Vector3) => unselected.every(npc => {
      const radius = (mounted ? 1 : .5) + (npc.isMounted ? 1 : .5)
      const occupied = [npc.combatPosition, npc.formationDestination].filter(Boolean)
      return occupied.every(point => Math.abs(slot.y - point!.y) > 2.6
        || (slot.x - point!.x) ** 2 + (slot.z - point!.z) ** 2 >= radius ** 2)
    })
    const slots = candidates
      .filter(clear)
      .sort((a, b) => a.distanceToSquared(requestedCenter) - b.distanceToSquared(requestedCenter))
      .slice(0, participants.length)
    if (slots.length < participants.length) {
      const placement = getCampaignOutpostPlacement(faction)
      const reserve: THREE.Vector3[] = []
      // Interior-only reserve rows. Physical obstacles and occupied orders retain
      // ownership; no existing defender is displaced to make room.
      const depth = Math.abs(placement.backZ - placement.frontZ)
      for (let inward = 8; inward < depth - 3; inward += spacing) {
        for (let x = -placement.halfWidth + 3; x < placement.halfWidth - 3; x += spacing) {
          const z = placement.frontZ + nav.layout.zSign * inward
          const slot = new THREE.Vector3(x, getTerrainHeight(x, z), z)
          if (clear(slot) && !this.isSlotBlocked(slot, mounted)) reserve.push(slot)
        }
      }
      reserve.sort((a, b) => a.distanceToSquared(requestedCenter) - b.distanceToSquared(requestedCenter))
      slots.push(...reserve.slice(0, participants.length - slots.length))
    }
    if (slots.length !== participants.length) return null
    return { center: requestedCenter.clone(), slots, columns: participants.length }
  }

  private makeRampartFormation(
    center: THREE.Vector3,
    _forward: THREE.Vector3,
    count: number,
    deck: OutpostWalkwayDeck | OutpostWalkwayBridge,
  ): { center: THREE.Vector3; slots: THREE.Vector3[] } {
    const minX = deck.slab.min.x + 0.6
    const maxX = deck.slab.max.x - 0.6
    const minZ = deck.slab.min.z + 0.55
    const maxZ = deck.slab.max.z - 0.55
    const spacing = 1.6
    const totalSpan = (count - 1) * spacing
    const halfSpan = totalSpan / 2
    const clampedCenterX = THREE.MathUtils.clamp(center.x, minX + halfSpan, maxX - halfSpan)
    const clampedZ = THREE.MathUtils.clamp(center.z, minZ, maxZ)
    const startX = clampedCenterX - halfSpan

    const slots: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      const slotX = startX + i * spacing
      const slotY = ('walkSurface' in deck && deck.walkSurface)
        ? (getWalkRampHeight(deck.walkSurface, slotX, clampedZ) ?? deck.topY)
        : deck.topY
      slots.push(new THREE.Vector3(slotX, slotY, clampedZ))
    }
    const centerY = ('walkSurface' in deck && deck.walkSurface)
      ? (getWalkRampHeight(deck.walkSurface, clampedCenterX, clampedZ) ?? deck.topY)
      : deck.topY
    return {
      center: new THREE.Vector3(clampedCenterX, centerY, clampedZ),
      slots,
    }
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
    const outpostNav = this.navigationWorld?.outpostNav
    if (outpostNav && slots.length > 0) {
      const slotLayer = getOutpostNavLayer(slots[0], outpostNav.layout)
      if (isRampartLayer(slotLayer)) {
        const deck = slotLayer === 'rampart_gate'
          ? outpostNav.layout.bridge
          : outpostNav.getDeck(layerSide(slotLayer)!)
        const placement = deck ? this.resolveRampartPlacement(center, forward, participants, deck) : null
        return placement !== null && placement.slots.length === slots.length
          && placement.slots.every((slot, index) => slot.distanceToSquared(slots[index]) < 1e-8)
      }
    }
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
        || this.isSlotBlocked(slot, unit.npc) || !unit.npc.mount?.isFlyingMount && !this.isInFormationComponent(slot, component)
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
      if (npc.mount?.isFlyingMount) continue
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
    if (this.navigationWorld.outpostNav) {
      const slotLayer = getOutpostNavLayer(slot, this.navigationWorld.outpostNav.layout)
      if (isRampartLayer(slotLayer)) return true
    }
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
    const outpostNav = this.navigationWorld?.outpostNav
    if (outpostNav) {
      const slotLayer = getOutpostNavLayer(slot, outpostNav.layout)
      if (isRampartLayer(slotLayer)) return false
    }
    const mounted = typeof npcOrMounted === 'boolean' ? npcOrMounted : npcOrMounted.isMounted
    const radius = mounted ? 1 : 0.5
    const bottom = typeof npcOrMounted !== 'boolean' && npcOrMounted.mount?.isFlyingMount
      ? getTerrainHeight(slot.x, slot.z) + XONGKORO.aiCruiseHeight : slot.y
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
