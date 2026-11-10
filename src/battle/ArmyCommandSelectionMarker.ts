import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { ArmyCommandTarget } from './CommandTarget'

/** Read-only view of ArmyCommandController; the marker never issues or changes commands. */
export interface CommandPreviewSource {
  readonly commandPreviewTarget: ArmyCommandTarget | null
  forEachCommandPreviewMember(visit: (npc: NPC) => void): void
}

/** Capacity covers the largest custom battle (10 squads x 50) with headroom. */
const MAX_MARKERS = 1024
/** Markers farther than this are skipped; they would be a few pixels wide anyway. */
const MAX_DISTANCE = 140
const MAX_DISTANCE_SQ = MAX_DISTANCE * MAX_DISTANCE
/** Membership is re-resolved at this cadence; death and position are read every frame. */
const MEMBERSHIP_REFRESH_SECONDS = 0.2
/** Visual diamond width in world units at the marker's distance. */
const MARKER_WORLD_SIZE = 0.5
/**
 * Anchored in NPC.group-local space, the same frame as the existing overhead icons, so one rule
 * covers walking soldiers, ground mounts and flying riders without per-mount height tables.
 * NPC.alertSprite ("!", 0.8 m quad at 2.3 m, can stay visible for a whole ALERT state) tops out at
 * 2.7 m; the diamond's bottom edge starts above it. Town's persistent "?" is cleared via
 * `overheadIconTop`.
 */
const ALERT_ICON_TOP = 2.7
/** Gap between a persistent overhead icon's top edge and the marker's bottom edge. */
const ICON_GAP = 0.05
const BASE_CENTER_HEIGHT = ALERT_ICON_TOP + ICON_GAP + MARKER_WORLD_SIZE / 2

/** Scratch for the per-frame anchor; avoids allocating a Vector3 per marker. */
const anchor = new THREE.Vector3()

function createDiamondTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.beginPath()
  ctx.moveTo(32, 3); ctx.lineTo(58, 32); ctx.lineTo(32, 61); ctx.lineTo(6, 32); ctx.closePath()
  ctx.fillStyle = '#19e6d2'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#05070a'
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Cyan diamonds above NPCs that would receive the player's current command preview.
 *
 * All markers are one THREE.Points batch (one draw call, one shared texture/material), so a
 * 200-unit selection costs a position upload rather than hundreds of sprite draws. Points
 * always face the camera, ignore actor rotation/pitch and cast no shadows.
 * The marker only reads controller state; it owns just its own Points, geometry, material
 * and texture and releases them in dispose(). NPCs and shared assets are never touched.
 */
export class ArmyCommandSelectionMarker {
  private readonly points: THREE.Points
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.PointsMaterial
  private readonly texture: THREE.CanvasTexture | null
  private readonly positions = new Float32Array(MAX_MARKERS * 3)
  private readonly members: NPC[] = []
  private readonly collect = (npc: NPC): void => { this.members.push(npc) }
  private membershipTarget: ArmyCommandTarget | null = null
  private membershipAge = 0
  private shown = false
  private disposed = false

  /** Marker height lifted above a persistent overhead icon, per member; parallel to `members`. */
  private readonly lifts: number[] = []

  /**
   * @param overheadIconTop Optional: group-local Y of the top edge of a persistent icon attached to
   *   the NPC (e.g. Town's "?"), or 0 when none. Read when membership is resolved, not every frame.
   */
  constructor(
    private readonly scene: THREE.Scene,
    private readonly source: CommandPreviewSource,
    private readonly overheadIconTop?: (npc: NPC) => number,
  ) {
    this.texture = createDiamondTexture()
    this.material = new THREE.PointsMaterial({
      map: this.texture ?? undefined,
      size: 1,
      sizeAttenuation: true,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    const attribute = new THREE.BufferAttribute(this.positions, 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', attribute)
    this.geometry.setDrawRange(0, 0)
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.name = 'army-command-selection-markers'
    this.points.frustumCulled = false
    this.points.castShadow = false
    this.points.receiveShadow = false
    this.points.renderOrder = 20
    this.points.visible = false
    // Overhead markers are visual only and must never be hit by scene raycasts.
    this.points.raycast = () => {}
    scene.add(this.points)
  }

  /**
   * Call once per frame after actors moved and before rendering.
   * `inputAllowed` is false while a UI, pause, death, spectate or finished mission owns input.
   */
  update(inputAllowed: boolean, camera: THREE.PerspectiveCamera, dt: number): void {
    if (this.disposed) return
    const target = inputAllowed ? this.source.commandPreviewTarget : null
    if (!target) { this.hide(); return }

    this.membershipAge += dt
    if (target !== this.membershipTarget || this.membershipAge >= MEMBERSHIP_REFRESH_SECONDS) {
      this.membershipTarget = target
      this.membershipAge = 0
      this.members.length = 0
      this.lifts.length = 0
      this.source.forEachCommandPreviewMember(this.collect)
      for (const npc of this.members) {
        const iconTop = this.overheadIconTop?.(npc) ?? 0
        this.lifts.push(iconTop > 0 ? iconTop + ICON_GAP + MARKER_WORLD_SIZE / 2 : 0)
      }
    }

    const camPos = camera.position
    const positions = this.positions
    let count = 0
    for (let i = 0; i < this.members.length && count < MAX_MARKERS; i++) {
      const npc = this.members[i]
      if (npc.dead || !npc.group.visible) continue
      const position = npc.group.position
      const dx = position.x - camPos.x
      const dz = position.z - camPos.z
      if (dx * dx + dz * dz > MAX_DISTANCE_SQ) continue
      const offset = count * 3
      // The "!" and "?" icons are children of npc.group, so they follow its pitch/bank (eagle
      // flight, mount ride pitch). Rotate the same local anchor by the group's quaternion instead
      // of lifting along world Y. The group hangs directly off the scene and its position and
      // quaternion are current after the NPC update; matrixWorld is only refreshed at render.
      anchor.set(0, Math.max(BASE_CENTER_HEIGHT, this.lifts[i]), 0).applyQuaternion(npc.group.quaternion)
      positions[offset] = position.x + anchor.x
      positions[offset + 1] = position.y + anchor.y
      positions[offset + 2] = position.z + anchor.z
      count++
    }

    if (count === 0) { this.hide(); return }
    // PointsMaterial size ignores FOV; compensate so the diamond keeps one world size.
    this.material.size = MARKER_WORLD_SIZE / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.setDrawRange(0, count)
    this.points.visible = true
    this.shown = true
  }

  /** Hide immediately and forget cached membership. Safe to call repeatedly. */
  hide(): void {
    this.membershipTarget = null
    this.membershipAge = 0
    this.members.length = 0
    this.lifts.length = 0
    if (!this.shown) return
    this.shown = false
    this.points.visible = false
    this.geometry.setDrawRange(0, 0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.hide()
    this.scene.remove(this.points)
    this.geometry.dispose()
    this.material.dispose()
    this.texture?.dispose()
  }
}
