import * as THREE from 'three'
import { slabGeometry, surfaceBox } from './TownRamparts'
import { removeObstacleData, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { markObstacleTopologyChanged } from '../world/ObstacleTopology'
import type { TownGateId } from './TownLayout'
import type { TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import type { TownSiegeAirspace } from './TownSiegeAirspace'

export interface TownDockSite { rampId: TownSiegeRampId; gateId: TownGateId; point: THREE.Vector3; halfWidth: number }
interface Rail { gateId: TownGateId; a: THREE.Vector3; b: THREE.Vector3; width: number; thickness: number; material: THREE.Material }
interface Piece { mesh: THREE.Mesh; obstacles: ObstacleData[]; rampId?: TownSiegeRampId }

/** Opt-in owner of just the exterior rail/crenel slices crossed by a bridge.
 * The ordinary Town builder never creates this owner and retains its static batch.
 */
export class TownDockPassages {
  readonly root = new THREE.Group()
  private readonly rails: Rail[] = []
  private readonly pieces: Piece[] = []
  private readonly railObstacles = new Set<ObstacleData>()
  private readonly open = new Set<TownSiegeRampId>()
  private configured = false
  constructor(private readonly obstacles: ObstacleData[], private readonly airspace?: TownSiegeAirspace) { this.root.name = 'town-siege-dock-passages' }

  addRail(gateId: TownGateId, a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number, material: THREE.Material): void {
    if (this.configured) throw new Error('Dock rails already configured')
    const rail = { gateId, a, b, width, thickness, material }
    this.rails.push(rail); this.addPiece(rail, 0, 1)
  }
  isRailObstacle(obstacle: ObstacleData): boolean { return this.railObstacles.has(obstacle) }
  configure(sites: readonly TownDockSite[]): void {
    if (this.configured || sites.length !== 8 || new Set(sites.map(s => s.rampId)).size !== 8) throw new Error('Expected eight unique dock passages')
    this.configured = true
    this.clearPieces()
    for (const rail of this.rails) {
      const delta = rail.b.clone().sub(rail.a), length = Math.hypot(delta.x, delta.z)
      const intervals = sites.filter(site => site.gateId === rail.gateId).map(site => {
        const center = ((site.point.x - rail.a.x) * delta.x + (site.point.z - rail.a.z) * delta.z) / length ** 2
        return { from: Math.max(0, center - site.halfWidth / length), to: Math.min(1, center + site.halfWidth / length), id: site.rampId }
      }).filter(i => i.to > i.from).sort((a, b) => a.from - b.from)
      let from = 0
      for (const interval of intervals) {
        if (interval.from < from) throw new Error('Overlapping dock passages')
        if (interval.from > from) this.addPiece(rail, from, interval.from)
        this.addPiece(rail, interval.from, interval.to, interval.id); from = interval.to
      }
      if (from < 1) this.addPiece(rail, from, 1)
    }
  }
  isOpen(id: TownSiegeRampId): boolean { return this.open.has(id) }
  setOpen(id: TownSiegeRampId, value: boolean): void {
    if (!this.configured) throw new Error('Dock passages not configured')
    if (this.open.has(id) === value) return
    if (value) this.open.add(id); else this.open.delete(id)
    for (const piece of this.pieces) if (piece.rampId === id) {
      piece.mesh.visible = !value
      for (const obstacle of piece.obstacles) {
        if (value) removeObstacleData(this.obstacles, obstacle)
        else if (!this.obstacles.includes(obstacle)) { this.obstacles.push(obstacle); markObstacleTopologyChanged(this.obstacles) }
      }
      if (value) this.airspace?.remove(piece.obstacles)
      else this.airspace?.add(piece.obstacles)
    }
  }
  private addPiece(rail: Rail, from: number, to: number, rampId?: TownSiegeRampId): void {
    const a = rail.a.clone().lerp(rail.b, from), b = rail.a.clone().lerp(rail.b, to), length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length < 1e-6) return
    const surface: WalkRampSurface = { startX: a.x, startZ: a.z, startY: a.y, topY: b.y,
      dirX: (b.x - a.x) / length, dirZ: (b.z - a.z) / length, halfWidth: rail.width / 2, length, landing: 0 }
    const mesh = new THREE.Mesh(slabGeometry(surface, rail.thickness), rail.material)
    mesh.castShadow = mesh.receiveShadow = true; this.root.add(mesh)
    const obstacles: ObstacleData[] = []
    const count = Math.max(1, Math.ceil(Math.abs(b.y - a.y) / .16))
    for (let i = 0; i < count; i++) {
      const s = { ...surface, startX: a.x + (b.x - a.x) * i / count, startZ: a.z + (b.z - a.z) * i / count,
        startY: a.y + (b.y - a.y) * i / count, topY: a.y + (b.y - a.y) * (i + 1) / count, length: length / count }
      obstacles.push({ box: surfaceBox(s, rail.thickness), isBarricade: false, navigationPassable: true })
    }
    for (const obstacle of obstacles) this.railObstacles.add(obstacle)
    this.obstacles.push(...obstacles); this.pieces.push({ mesh, obstacles, rampId })
    // Initial uncut rails enter TownWorld's native snapshot at construction end.
    // Only later configuration creates replacement records that need admission.
    if (this.configured) this.airspace?.add(obstacles)
  }
  private clearPieces(): void {
    this.railObstacles.clear()
    for (const piece of this.pieces.splice(0)) {
      this.airspace?.remove(piece.obstacles)
      piece.mesh.removeFromParent(); piece.mesh.geometry.dispose()
      for (const obstacle of piece.obstacles) removeObstacleData(this.obstacles, obstacle)
    }
  }
  dispose(): void { this.clearPieces(); this.rails.length = 0; this.open.clear(); this.root.removeFromParent() }
}
