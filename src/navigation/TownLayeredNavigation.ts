import * as THREE from 'three'
import { TownWatchtowerNavigation } from './TownWatchtowerNavigation'
import type { CommandWatchtowerLayout } from '../town/TownCommandWatchtowerLayout'
import { crossingGateBreach, gateBreachLane, gateBreachProgress, hasClearedGateBreach } from './GateBreachPortal'
import { AvailableBreachEntrances, type BreachEntrance } from './AvailableBreachEntrances'
import { TOWN_CITY, TOWN_GATES, TOWN_GATE_ASSAULT_APPROACH, townGatePoint, type TownGateId } from '../town/TownLayout'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData } from '../world/Terrain'
import { gatehouseLocal, gatehousePoint, gatehouseSection, TOWN_GATEHOUSE, type TownGatehouse } from '../town/TownGatehouse'
import { townRampartHeight, type TownRamp, type TownRampartLayout } from '../town/TownRamparts'

import type { CampaignGateController } from '../campaign/CampaignGate'

export interface TownNavigationStep {
  ground: boolean
  blocked?: boolean
  tower?: boolean
  entranceId?: string
}

export interface TownGateApproach {
  id: TownGateId
  approach: THREE.Vector3
  gate: Pick<CampaignGateController, 'state' | 'siegeObstacle'>
}

/** Town layout adapter. Ground approaches still use NavigationWorld's bounded A*.
 * Elevated travel follows a small perimeter graph, never a second navigation grid.
 */
export class TownLayeredNavigation {
  /** Empty and inactive in every existing Town mode. */
  readonly siegeEntrances = new AvailableBreachEntrances()
  siegeActive = false
  private readonly gateApproaches = new Map<TownGateId, TownGateApproach>()
  /** Live physical gate state; registration never opens or damages a gate. */
  setSiegeGates(gates: ReadonlyMap<TownGateId, TownGateApproach['gate']>): void {
    this.gateApproaches.clear()
    for (const spec of TOWN_GATES) {
      const gate = gates.get(spec.id)
      if (!gate) continue
      const p = townGatePoint(spec, 0, -TOWN_GATE_ASSAULT_APPROACH)
      this.gateApproaches.set(spec.id, { id: spec.id, gate,
        approach: new THREE.Vector3(p.x, getTerrainHeight(p.x, p.z), p.z) })
    }
  }
  /** Only after ordinary human/entrance navigation has failed. Component checks
   * reuse the ground topology; no A* is run for the four candidate approaches. */
  selectClosedGateApproach(current: THREE.Vector3, goal: THREE.Vector3,
    accepts: (obstacle: ObstacleData) => boolean, sector?: TownGateId | null, preferred?: TownGateId): TownGateApproach | null {
    const outside = current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX
      || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ
    const insideGoal = goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX
      && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
    if (!outside || !insideGoal || this.isElevated(current) || this.rampAt(current)
      || Math.abs(current.y - getTerrainHeight(current.x, current.z)) > 1.1) return null
    const valid = (entry: TownGateApproach) => (!sector || entry.id === sector) && entry.gate.state === 'closed'
      && accepts(entry.gate.siegeObstacle) && this.connected(current, entry.approach)
    const prior = preferred ? this.gateApproaches.get(preferred) : undefined
    if (prior && valid(prior)) return prior
    let nearest: TownGateApproach | null = null, distance = Infinity
    for (const entry of this.gateApproaches.values()) {
      if (!valid(entry)) continue
      const d = current.distanceToSquared(entry.approach)
      if (d < distance) { nearest = entry; distance = d }
    }
    return nearest
  }
  watchtower: TownWatchtowerNavigation | null = null
  setWatchtower(layout: CommandWatchtowerLayout): void { this.watchtower = new TownWatchtowerNavigation(layout) }
  constructor(readonly layout: TownRampartLayout, private readonly connected: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false) {}
  rampAt(p: THREE.Vector3): TownRamp | undefined {
    return this.layout.ramps.find(r => { const y = getWalkRampHeight(r.surface, p.x, p.z); return y !== null && Math.abs(p.y - y) < 1.1 })
  }
  isElevated(p: THREE.Vector3): boolean {
    if (this.gatehouseAt(p)) return true
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
  private gatehouseAt(p: THREE.Vector3): { house: TownGatehouse; section: NonNullable<ReturnType<typeof gatehouseSection>> } | null {
    for (const house of this.layout.gatehouses ?? []) {
      const section = gatehouseSection(house, p)
      if (section !== null) return { house, section }
    }
    return null
  }
  /** Leave a gallery via its real link, then reuse the existing ring to reach
   * other gates, stairs or live siege docks. Keep ordinary ring travel on the ring. */
  private alongElevated(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3): TownNavigationStep {
    const from = this.gatehouseAt(current), to = this.gatehouseAt(goal)
    if (!from && !to) { this.alongRing(current, goal, out); return { ground: false } }
    const near = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z) <= .2
    const nearest = (house: TownGatehouse, p: THREE.Vector3) =>
      house.links[gatehouseLocal(house.gate, p).x < 0 ? 0 : 1]
    if (from) {
      const sameHouse = to?.house === from.house
      if (from.section === 'gallery') {
        const local = gatehouseLocal(from.house.gate, current)
        const leaving = !sameHouse || to.section !== 'gallery'
        const link = sameHouse && to.section !== 'gallery' ? from.house.links.find(l => l.side === to.section)! : nearest(from.house, goal)
        const aligned = Math.abs(local.x - link.side * TOWN_GATEHOUSE.towerCenter) <= .2 && local.z <= TOWN_GATEHOUSE.galleryCenter + .2
        const arrivalLink = nearest(from.house, current)
        const inThreshold = local.z < 1.25 && Math.abs(local.x - arrivalLink.side * TOWN_GATEHOUSE.towerCenter) < 1.1
        if (leaving && aligned) out.copy(sameHouse ? goal : link.entry)
        else if (inThreshold && (!sameHouse || to.section !== 'gallery' ||
          Math.abs(gatehouseLocal(from.house.gate, goal).x - arrivalLink.side * TOWN_GATEHOUSE.towerCenter) > 1.1)) out.copy(arrivalLink.junction)
        else out.copy(leaving ? link.junction : goal)
      } else if (sameHouse && from.section === to.section) {
        out.copy(goal)
      } else {
        const link = from.house.links.find(l => l.side === from.section)!
        out.copy(sameHouse ? link.junction : link.entry)
      }
    } else if (to) {
      const link = to.section === 'gallery' ? nearest(to.house, current) : to.house.links.find(l => l.side === to.section)!
      if (near(current, link.entry)) out.copy(to.section === 'gallery' ? link.junction : goal)
      else this.alongRing(current, link.entry, out)
    }
    // NPC Follow/Formation caps movement at precise tower waypoints.
    return { ground: false, tower: true }
  }
  private clampGatehouseFollow(out: THREE.Vector3, leader: THREE.Vector3, spacing: number): boolean {
    const location = this.gatehouseAt(leader)
    if (!location) return false
    const { house, section } = location, [left, right] = house.links, G = TOWN_GATEHOUSE
    const p = gatehouseLocal(house.gate, leader)
    const galleryWidth = G.towerCenter * 2
    const leftLength = left.surface.length + G.galleryCenter
    const progress = section === -1 ? left.surface.length + p.z
      : section === 1 ? leftLength + galleryWidth + G.galleryCenter - p.z
      : leftLength + THREE.MathUtils.clamp(p.x + G.towerCenter, 0, galleryWidth)
    const slot = progress - spacing
    if (slot < 0) {
      const a = this.projection(left.entry).distance, b = this.projection(right.entry).distance
      const leftDirection = a < b ? -1 : 1
      out.copy(this.pointAt(a - slot * leftDirection))
    } else if (slot < leftLength || slot > leftLength + galleryWidth) {
      const link = slot < leftLength ? left : right
      const z = link === left ? slot - left.surface.length : leftLength + galleryWidth + G.galleryCenter - slot
      const y = THREE.MathUtils.lerp(link.entry.y, house.floorY, THREE.MathUtils.clamp(1 + z / link.surface.length, 0, 1))
      out.copy(gatehousePoint(house.gate, link.side * G.towerCenter, z, y))
    } else {
      out.copy(gatehousePoint(house.gate, slot - leftLength - G.towerCenter, G.galleryCenter, house.floorY))
    }
    return true
  }
  clampFollow(out: THREE.Vector3, leader: THREE.Vector3, slot: number, mounted: boolean): void {
    const spacing = (slot + 1) * (mounted ? 3.5 : 1.7)
    if (this.watchtower?.clampFollow(out, leader) || this.clampGatehouseFollow(out, leader, spacing)) return
    if (this.isElevated(leader)) { out.copy(this.pointAt(this.projection(leader).distance - spacing)); return }
    const ramp = this.rampAt(leader)
    if (!ramp) return
    const s = ramp.surface, along = (leader.x - s.startX) * s.dirX + (leader.z - s.startZ) * s.dirZ - spacing
    if (along < 0) { out.copy(ramp.entrance).addScaledVector(new THREE.Vector3(s.dirX, 0, s.dirZ), along); return }
    out.set(s.startX + s.dirX * along, s.startY + (s.topY - s.startY) * Math.min(1, along / s.length), s.startZ + s.dirZ * along)
  }
  private nativeRampUsable(ramp: TownRamp, mounted: boolean): boolean {
    return !mounted || Boolean(ramp.surface.mounted && ramp.surface.halfWidth >= 1.6)
  }
  private interiorSiegeExit(current: THREE.Vector3, goal: THREE.Vector3, mounted: boolean,
    preferredId?: string | null, sectorId?: TownGateId | null): BreachEntrance | null {
    if (!this.siegeActive || goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
      || current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ) return null
    const onRamp = this.rampAt(current)
    if (!onRamp && Math.abs(current.y - getTerrainHeight(current.x, current.z)) > 1.1 || this.isElevated(goal) || this.rampAt(goal)) return null
    if (!onRamp && this.connected(current, goal)) return null
    const hasStair = onRamp ? this.nativeRampUsable(onRamp, mounted) : this.layout.ramps.some(r => this.nativeRampUsable(r, mounted) && this.connected(current, r.entrance))
    if (!hasStair) return null
    const valid = (e: BreachEntrance) => this.siegeEntranceUsable(e, mounted, sectorId) && Boolean(e.surface)
      && this.isElevated(e.exit) && this.connected(e.approach, goal)
    const prior = preferredId ? this.siegeEntrances.entries.get(preferredId) : undefined
    if (prior && valid(prior)) return prior
    let selected: BreachEntrance | null = null, cost = Infinity
    for (const e of this.siegeEntrances.entries.values()) {
      if (!valid(e)) continue
      const distance = current.distanceTo(e.exit) + e.approach.distanceTo(goal)
      if (distance < cost) { selected = e; cost = distance }
    }
    return selected
  }
  /** null means ordinary ground travel; ground=true preserves wall/gate topology. */
  resolveMoveTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3, entranceId?: string | null, mounted = false, sectorId?: TownGateId | null, actorId?: string): TownNavigationStep | null {
    const transfer = this.interiorSiegeExit(current, goal, mounted, entranceId, sectorId)
    if (transfer) {
      const step = this.resolveMoveTarget(current, transfer.exit, out, transfer.id, mounted, sectorId, actorId)
      if (step) step.entranceId = transfer.id
      return step
    }
    const siege = this.resolveSiegeTarget(current, goal, out, entranceId, mounted, sectorId, actorId)
    if (siege) return siege
    const onDeck = this.isElevated(current), onRamp = this.rampAt(current)
    if (!onDeck && !onRamp) {
      const tower = this.watchtower?.resolve(current, goal, out)
      if (tower) return tower
    } else if (this.watchtower && this.watchtower.surfaceAt(goal) >= 0) {
      // Leave the existing rampart through its own stairs before ground A* can
      // approach the tower. Never route straight off a wall toward its entrance.
      goal = this.watchtower.approach
    }
    const toDeck = this.isElevated(goal), toRamp = this.rampAt(goal)
    // Once a descent reaches ground, release the entrance to ordinary A* and
    // friendly avoidance. Recapturing nearby ground movers here traps them in
    // the 0.3m entrance tolerance forever, even when their goal is on ground.
    if (!onDeck && !toDeck && !onRamp && !toRamp) return null
    if (onDeck && toDeck && !onRamp) return this.alongElevated(current, goal, out)
    const ascending = toDeck || Boolean(toRamp)
    const carrier = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
    const interiorTransfer = ascending && !onRamp && Boolean(carrier?.surface && goal.distanceToSquared(carrier.exit) < .01)
    const available = this.layout.ramps.filter(r => this.nativeRampUsable(r, mounted) && (!interiorTransfer || this.connected(current, r.entrance)))
    const ramp = onRamp ?? toRamp ?? available.reduce<TownRamp | undefined>((best, r) => {
      const p = ascending ? current : goal
      return !best || p.distanceToSquared(r.entrance) < p.distanceToSquared(best.entrance) ? r : best
    }, undefined)
    if (!ramp || !this.nativeRampUsable(ramp, mounted)) { out.copy(current); return { ground: true, blocked: true } }
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
      else return this.alongElevated(current, ramp.connection, out)
      return { ground: false }
    }
    const along = (current.x - s.startX) * s.dirX + (current.z - s.startZ) * s.dirZ
    const lateral = Math.abs((current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX)
    if (!(along >= -3.2 && along <= .6 && lateral < s.halfWidth - .5)) { out.copy(ramp.entrance); return { ground: true } }
    out.set(s.startX + s.dirX, s.startY + (s.topY - s.startY) / s.length, s.startZ + s.dirZ)
    return { ground: false }
  }
  hasClearedSiegeGate(current: THREE.Vector3, entranceId: string | null, mounted: boolean): boolean {
    const entry = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
    return Boolean(this.siegeActive && entry && hasClearedGateBreach(entry, current, mounted))
  }
  private onSiegeSurface(entry: BreachEntrance, p: THREE.Vector3): boolean {
    return [entry.surface, entry.bridgeSurface].some(s => {
      const height = s && getWalkRampHeight(s, p.x, p.z)
      return height !== undefined && height !== null && Math.abs(p.y - height) < 1.1
    })
  }
  private siegeEntranceUsable(entry: BreachEntrance, mounted: boolean, sectorId?: TownGateId | null): boolean {
    return entry.walkable && (!mounted || entry.mounted
      && (!entry.surface || entry.surface.halfWidth >= 1.6)
      && (!entry.bridgeSurface || entry.bridgeSurface.halfWidth >= 1.6))
      && (!sectorId || entry.gateId === sectorId)
  }
  private resolveSiegeTarget(current: THREE.Vector3, goal: THREE.Vector3, out: THREE.Vector3,
    entranceId: string | null | undefined, mounted: boolean, sectorId?: TownGateId | null, actorId?: string): TownNavigationStep | null {
    if (!this.siegeActive || this.rampAt(current)) return null
    const outside = current.x <= TOWN_CITY.minX || current.x >= TOWN_CITY.maxX || current.z <= TOWN_CITY.minZ || current.z >= TOWN_CITY.maxZ
    const goalInside = goal.x > TOWN_CITY.minX && goal.x < TOWN_CITY.maxX && goal.z > TOWN_CITY.minZ && goal.z < TOWN_CITY.maxZ
    const eligible = (entry: BreachEntrance) => this.siegeEntranceUsable(entry, mounted, sectorId)
    let goalCarrier: BreachEntrance | undefined
    for (const candidate of this.siegeEntrances.entries.values()) if (eligible(candidate) && this.onSiegeSurface(candidate, goal)) { goalCarrier = candidate; break }
    // Interior goals use the native stairs. Exterior ground goals may leave by
    // any live same-sector carrier whose rear approach connects to the goal.
    const descending = !this.isElevated(goal) && !this.rampAt(goal) && !goalInside
    if (this.isElevated(current)) {
      let carrier = goalCarrier
      if (!carrier && descending) {
        const preferred = entranceId ? this.siegeEntrances.entries.get(entranceId) : undefined
        const valid = (e: BreachEntrance) => eligible(e) && Boolean(e.surface) && this.connected(e.approach, goal)
        if (preferred && valid(preferred)) carrier = preferred
        else {
          let cost = Infinity
          for (const candidate of this.siegeEntrances.entries.values()) {
            if (!valid(candidate)) continue
            const distance = current.distanceTo(candidate.exit) + candidate.approach.distanceTo(goal)
            if (distance < cost) { carrier = candidate; cost = distance }
          }
        }
      }
      if (!carrier) return null
      if (current.distanceTo(carrier.exit) > .8) return this.alongElevated(current, carrier.exit, out)
      else out.copy(carrier.position)
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
    // A preferred assault entrance does not own unrelated exterior pursuit.
    if (!aboard && outside && descending && !goalCarrier) return null
    const preferred = entranceId ? this.siegeEntrances.entries.get(entranceId)
      : sectorId && actorId && (goalInside || this.isElevated(goal))
        ? crossingGateBreach(this.siegeEntrances.entries.values(), current, mounted, sectorId) : undefined
    let entry = aboard ?? (preferred && eligible(preferred) ? preferred : undefined)
    if (!entry && goalCarrier && this.connected(current, goalCarrier.approach)) entry = goalCarrier
    if (!entry && (goalInside || this.isElevated(goal))) {
      entry = this.siegeEntrances.select(current, mounted, null, approach => this.connected(current, approach), undefined, eligible) ?? undefined
    }
    // Centre-inside is not body-clear: retain the preferred portal until the
    // whole mounted/foot footprint has passed the wall plane before chasing laterally.
    const crossingPortal = entry === preferred && entry?.portal && actorId && !hasClearedGateBreach(entry, current, mounted)
    if (!aboard && !outside && !crossingPortal) return null
    if (!entry || !entry.walkable || mounted && !entry.mounted) {
      if (goalInside || this.isElevated(goal) || entranceId) { out.copy(current); return { ground: true, blocked: true } }
      return null
    }
    if (!entry.surface) {
      if (entry.portal && actorId && entry.type === 'gate') {
        const p = gateBreachProgress(entry, current), approach = gateBreachProgress(entry, entry.approach)
        const radius = mounted ? 1.25 : .6
        const lane = gateBreachLane(actorId, mounted, entry.portal.halfWidth)
        // Once admitted into the opening, keep moving through it. Euclidean
        // distance to the old approach must not send a crossing actor backwards.
        const crossing = p.along >= approach.along - 1
          && Math.abs(p.lateral) + radius <= entry.portal.halfWidth
        out.copy(crossing ? entry.exit : entry.approach)
        out.x += -p.dz * lane; out.z += p.dx * lane
        return { ground: true }
      }
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
    if (aboard && descending) {
      // Align on the flat deck/bridge before committing to the slope centreline.
      const lateralOffset = (current.x - s.startX) * -s.dirZ + (current.z - s.startZ) * s.dirX
      if (along > s.length && Math.abs(lateralOffset) > .25) {
        out.set(s.startX + s.dirX * along, s.topY, s.startZ + s.dirZ * along)
      } else out.copy(entry.approach)
      return { ground: false }
    }
    if (aboard && along >= s.length + s.landing - .6) out.copy(entry.exit)
    else {
      const targetAlong = aboard ? s.length + s.landing - .3 : 1
      out.set(s.startX + s.dirX * targetAlong, s.startY + (s.topY - s.startY) * Math.min(1, targetAlong / s.length), s.startZ + s.dirZ * targetAlong)
    }
    return { ground: false }
  }

}
