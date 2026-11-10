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
 * NPC.group is at the feet when walking and at the pelvis seat on ground mounts, so the
 * head sits ~0.9 m above the group there. Flying riders stand on the eagle socket (feet).
 * The existing alert sprite spans roughly 1.9–2.7 m; the marker sits above that band.
 */
const STANDING_HEAD_TOP = 1.95
const GROUND_MOUNT_HEAD_TOP = 0.9
const HEAD_CLEARANCE = 0.7

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

  constructor(private readonly scene: THREE.Scene, private readonly source: CommandPreviewSource) {
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
      this.source.forEachCommandPreviewMember(this.collect)
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
      const mount = npc.mount
      const headTop = mount && !mount.isFlyingMount ? GROUND_MOUNT_HEAD_TOP : STANDING_HEAD_TOP
      const offset = count * 3
      positions[offset] = position.x
      positions[offset + 1] = position.y + headTop + HEAD_CLEARANCE
      positions[offset + 2] = position.z
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
