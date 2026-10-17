import * as THREE from 'three'
import { AvailableBreachEntrances, type BreachEntrance } from './AvailableBreachEntrances'
import { TOWN_CITY, type TownGateId } from '../town/TownLayout'
import { getWalkRampHeight } from '../world/Terrain'
import { townRampartHeight, type TownRamp, type TownRampartLayout } from '../town/TownRamparts'

/** Town layout adapter. Ground approaches still use NavigationWorld's bounded A*.
 * Elevated travel follows a small perimeter graph, never a second navigation grid.
 */
export class TownLayeredNavigation {
  /** Empty and inactive in every existing Town mode. */
  readonly siegeEntrances = new AvailableBreachEntrances()
  siegeActive = false
  constructor(readonly layout: TownRampartLayout, private readonly connected: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false) {}
  rampAt(p: THREE.Vector3): TownRamp | undefined {
    return this.layout.ramps.find(r => { const y = getWalkRampHeight(r.surface, p.x, p.z); return y !== null && Math.abs(p.y - y) < 1.1 })
  }
  isElevated(p: THREE.Vector3): boolean {
    const y = townRampartHeight(this.layout, p.x, p.z)
    return y !== null && Math.abs(p.y - y) < 1.3
  }
  private projection(p: THREE.Vector3): { distance: number; point: THREE.Vector3 } {
    let best = Infinity, distance = 0, offset = 0, point = p.clone()
    for (let i = 0; i < 4; i++) {
      const a = this.layout.corners[i], b = this.layout.corners[(i + 1) % 4], length = this.layout.lengths[i]
      const t = THREE.MathUtils.clamp(((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length ** 2, 0, 1)
      const q = a.clone().lerp(b, t), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2
      if (d < best) { best = d; distance = offset + t * length; point = q }
      offset += length
    }
    point.y = townRampartHeight(this.layout, point.x, point.z) ?? point.y
    return { distance, point }
  }
  private pointAt(distance: number): THREE.Vector3 {
    let d = (distance % this.layout.perimeter + this.layout.perimeter) % this.layout.perimeter
    for (let i = 0; i < 4; i++) {
      if (d <= this.layout.lengths[i]) {
        const p = this.layout.corners[i].clone().lerp(this.layout.corners[(i + 1) % 4], d / this.layout.lengths[i])
        p.y = townRampartHeight(this.layout, p.x, p.z) ?? p.y; return p
      }
      d -= this.layout.lengths[i]
    }
    return this.layout.corners[0].clone()
  }
  private alongRing(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3): void {
    const a = this.projection(current), b = this.projection(goal), perimeter = this.layout.perimeter
    const delta = ((b.distance - a.distance + perimeter * 1.5) % perimeter) - perimeter / 2
    if (Math.abs(delta) < 3) { out.copy(goal); return }
    // First align with the centre aisle before turning a corner.
    if (Math.hypot(a.point.x - current.x, a.point.z - current.z) > 1) { out.copy(a.point); return }
    out.copy(this.pointAt(a.distance + Math.sign(delta) * Math.min(3, Math.abs(delta))))
  }
  clampFollow(out: THREE.Vector3, leader: THREE.Vector3, slot: number, mounted: boolean): void {
    if (this.isElevated(leader)) { out.copy(this.pointAt(this.projection(leader).distance - (slot + 1) * (mounted ? 3.5 : 1.7))); return }
    const ramp = this.rampAt(leader)
    if (!ramp) return
    const s = ramp.surface, along = (leader.x - s.startX) * s.dirX + (leader.z - s.startZ) * s.dirZ - (slot + 1) * (mounted ? 3.5 : 1.7)
    if (along < 0) { out.copy(ramp.entrance).addScaledVector(new THREE.Vector3(s.dirX, 0, s.dirZ), along); return }
    out.set(s.startX + s.dirX * along, s.startY + (s.topY - s.startY) * Math.min(1, along / s.length), s.startZ + s.dirZ * along)
  }
  /** null means ordinary ground travel; ground=true preserves wall/gate topology. */
  resolveMoveTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3, entranceId?: string | null, mounted = false, sectorId?: TownGateId | null): { ground: boolean } | null {
    const siege = this.resolveSiegeTarget(current, goal, out, entranceId, mounted, sectorId)
    if (siege) return siege
    const onDeck = this.isElevated(current), toDeck = this.isElevated(goal), onRamp = this.rampAt(current), toRamp = this.rampAt(goal)
    if (!onDeck && !toDeck && !onRamp && !toRamp) {
      const foot = this.layout.ramps.find(r => {
        const s = r.surface, along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
        const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
        return along >= -2.5 && along <= .2 && lateral < s.halfWidth - .5 && current.distanceTo(r.entrance) > .3
      })
      if (foot) { out.copy(foot.entrance); return { ground: false } }
      return null
    }
    if (onDeck && toDeck && !onRamp) { this.alongRing(current, goal, out); return { ground: false } }
    const ascending = toDeck || Boolean(toRamp)
    const ramp = onRamp ?? toRamp ?? this.layout.ramps.reduce((best, r) => {
      const p = ascending ? current : goal
      return p.distanceToSquared(r.entrance) < p.distanceToSquared(best.entrance) ? r : best
    })
    const s = ramp.surface
    if (onRamp) {
      if (onRamp === toRamp) { out.copy(goal); return { ground: false } }
      if (ascending) {
        if ((current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ >= s.length + .5) out.copy(ramp.connection)
        else out.copy(ramp.landing)
      } else {
        const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
        const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
        // Finish the turn on the flat landing before a mounted follower descends.
        out.copy(along >= s.length && lateral > .25 ? ramp.landing : ramp.entrance)
      }
      return { ground: false }
    }
    if (onDeck) {
      const link = this.layout.decks.find(d => d.id === `landing:${ramp.gateId}`)!
      if (getWalkRampHeight(link.surface, current.x, current.z) !== null) out.copy(ramp.landing)
      else this.alongRing(current, ramp.connection, out)
      return { ground: false }
    }
    const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
    const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
    if (!(along >= -3.2 && along <= .6 && lateral < s.halfWidth - .5)) { out.copy(ramp.entrance); return { ground: true } }
    out.set(s.startX + s.dirX, s.startY + (s.topY - s.startY) / s.length, s.startZ + s.dirZ)
    return { ground: false }
  }
  private resolveSiegeTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3,
    entranceId: string | null | undefined, mounted: boolean, sectorId?: TownGateId | null): { ground: boolean } | null {
    if (!this.siegeActive || this.rampAt(current)) return null
    const outside = current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ
    const goalInside = goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
    const onSurface = (entry: BreachEntrance, p: THREE.Vector3): boolean => [entry.surface, entry.bridgeSurface].some(s => {
      const height = s && getWalkRampHeight(s, p.x, p.z)
      return height !== undefined && height !== null && Math.abs(p.y - height) < 1.1
    })
    const eligible = (entry: BreachEntrance) => entry.walkable && (!mounted || entry.mounted) && (!sectorId || entry.gateId === sectorId)
    let goalCarrier: BreachEntrance | undefined
    for (const candidate of this.siegeEntrances.entries.values()) if (eligible(candidate) && onSurface(candidate, goal)) { goalCarrier = candidate; break }
    if (this.isElevated(current)) {
      if (!goalCarrier) return null
      if (current.distanceTo(goalCarrier.exit) > .8) this.alongRing(current, goalCarrier.exit, out)
      else out.copy(goalCarrier.position)
      return { ground: false }
    }
    // A live surface may extend beyond the perimeter, including its full rear slope.
    let aboard: BreachEntrance | undefined
    for (const entry of this.siegeEntrances.entries.values()) {
      if (!eligible(entry)) continue
      for (const surface of [entry.surface, entry.bridgeSurface]) {
        const height = surface && getWalkRampHeight(surface, current.x, current.z)
        if (height !== undefined && height !== null && Math.abs(current.y - height) < 1.1) { aboard = entry; break }
      }
      if (aboard) break
    }
    const preferred = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
    let entry = aboard ?? (preferred && eligible(preferred) ? preferred : undefined)
    if (!entry && goalCarrier && this.connected(current, goalCarrier.approach)) entry = goalCarrier
    if (!entry && (goalInside || this.isElevated(goal))) {
      entry = this.siegeEntrances.select(current, mounted, null, approach => this.connected(current, approach), undefined, eligible) ?? undefined
    }
    if (!aboard && !outside) return null
    if (!entry || !entry.walkable || mounted && !entry.mounted) {
      if (goalInside || this.isElevated(goal) || entranceId) { out.copy(current); return { ground: true } }
      return null
    }
    if (!entry.surface) {
      out.copy(current.distanceTo(entry.approach) > 1 ? entry.approach : entry.exit)
      return { ground: true }
    }
    const s = entry.surface
    const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
    const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
    if (!aboard && !(along >= -3 && along <= .6 && lateral < s.halfWidth - .6)) {
      out.copy(entry.approach); return { ground: true }
    }
    if (aboard && goalCarrier === entry) { out.copy(goal); return { ground: false } }
    if (aboard && along >= s.length + s.landing - .6) out.copy(entry.exit)
    else {
      const targetAlong = aboard ? s.length + s.landing - .3 : 1
      out.set(s.startX + s.dirX * targetAlong, s.startY + (s.topY - s.startY) * Math.min(1, targetAlong / s.length), s.startZ + s.dirZ * targetAlong)
    }
    return { ground: false }
  }

}
