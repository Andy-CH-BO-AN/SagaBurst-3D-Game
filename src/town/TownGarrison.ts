import { TownGroundStations } from './TownGroundStation'
import type { NPC } from '../world/NPC'
import { TOWN_EAGLE_ALERT_RADIUS } from './TownEagleGarrison'
import { siegeDefensePlans } from '../career/TownDefenseRoster'
import { getTerrainHeight } from '../world/Terrain'
import { TOWN_GATES, townGatePoint, type TownGateId } from './TownLayout'
import { getTownRampartLayout, townRampartHeight, TOWN_RAMPART } from './TownRamparts'
import { isTownMilitary, type TownActorSpec } from './TownRules'
import type { TownWatchtowerNavigation } from '../navigation/TownWatchtowerNavigation'

export interface TownGarrisonStation { kind: 'rampart' | 'gate' | 'reserve'; gateId: TownGateId; x: number; y: number; z: number; yaw: number; rampartHome?: TownGarrisonStation; groundFallback?: { x: number; y: number; z: number; yaw: number } }
// Town roster queries repeat during service/layout resolution. Cache only derived
// placement data, cloning it into each fresh roster so equipment cannot mutate peers.
let placementCache: { key: string; stations: Map<string, TownGarrisonStation> } | undefined
function copyStation(station: TownGarrisonStation): TownGarrisonStation {
  return { ...station, ...(station.groundFallback ? { groundFallback: { ...station.groundFallback } } : {}) }
}

/** Placement only: legacy duty/training/group fields remain the mission identity contract. */
export function assignTownGarrison(roster: TownActorSpec[]): TownActorSpec[] {
  const layout = getTownRampartLayout()
  const key = JSON.stringify([roster.map(a => [a.id, a.role, a.duty, a.mounted, a.unitKind, a.gateId, a.index, a.x, a.z, a.assaultObjective]), layout.ramps, layout.wallSpans])
  if (placementCache?.key === key) {
    for (const actor of roster) {
      const station = placementCache.stations.get(actor.id)
      if (station) actor.garrison = copyStation(station)
    }
    return roster
  }
  const plans = siegeDefensePlans(roster)
  const gateByActor = new Map(plans.flatMap(p => [...p.infantry, ...p.cavalry].map(id => [id, p.gateId] as const)))
  const occupied: { x: number; z: number }[] = []
  const rampartCandidates = new Map<TownGateId, {
    points: { x: number; z: number; yaw: number }[]; checkedOccupancy: number
  }>()
  const ranged = roster.filter(a => !a.mounted && (a.duty === 'training' || a.duty === 'gate_guard') && (a.unitKind === 'ranged' || a.unitKind === 'archer'))
  const melee = roster.filter(a => !a.mounted && (a.duty === 'training' || a.duty === 'gate_guard') && (a.unitKind === 'melee' || a.unitKind === 'spearman'))
  const cavalry = roster.filter(a => a.mounted && a.duty === 'training')
  const stationed = new Set([...ranged, ...melee, ...cavalry])
  const ground = new TownGroundStations(layout, roster.filter(a => !stationed.has(a) && !a.eagle)
    .map(a => ({ x: a.x, z: a.z, radius: a.mounted ? 1.8 : .7 })))
  for (const [kind, actors] of [['rampart', ranged], ['gate', melee], ['reserve', cavalry]] as const) {
    const counts = new Map<TownGateId, number>(TOWN_GATES.map(g => [g.id, 0]))
    // Preserve the existing defense/command membership when relocating residents.
    for (const actor of [...actors.filter(a => a.gateId), ...actors.filter(a => !a.gateId)]) {
      const gate = TOWN_GATES.find(g => g.id === gateByActor.get(actor.id))!
      const index = counts.get(gate.id)!; counts.set(gate.id, index + 1)
      let side: number, inward: number
      if (kind === 'rampart') { side = (index % 2 ? 1 : -1) * (15 + Math.floor(index / 2) * 5); inward = 2.4 }
      else if (kind === 'gate') {
        side = (index % 2 ? 1 : -1) * (11 + Math.floor(index / 2) % 4 * 2.6); inward = 10 + Math.floor(index / 8) * 3
        // West's narrow corridor runs beside the HR hall and airfield.
        if (gate.id === 'west') { inward = 10; side += Math.sign(side) * Math.floor(index / 8) * 11 }
        if (gate.id === 'east' && side < -17) inward = 7
      }
      else { side = 20 + index % 5 * 6; inward = 20 + Math.floor(index / 5) * 6
        if (gate.id === 'north') side = -side
        if (gate.id === 'west') { side = 18 + Math.floor(index / 5) * 6; inward = 70 + index % 5 * 6 }
      }
      let p = townGatePoint(gate, side, inward)
      if (kind === 'rampart') {
        let available = rampartCandidates.get(gate.id)
        if (!available) {
          available = {
            points: layout.wallSpans.filter(d => d.gateId === gate.id).flatMap(d => {
              const s = d.surface
              return [.4, 2.55, 4.65].filter(along => along < s.length - .25).map(along => ({
                x: s.startX + s.dirX * along + s.dirZ * (TOWN_RAMPART.width / 2 - 1.2), z: s.startZ + s.dirZ * along - s.dirX * (TOWN_RAMPART.width / 2 - 1.2), yaw: gate.yaw,
              }))
            }).filter(q => Math.hypot(q.x - gate.x, q.z - gate.z) > 12),
            checkedOccupancy: 0,
          }
          rampartCandidates.set(gate.id, available)
        }
        // Occupancy only grows during this call, so prior exclusions stay valid.
        available.points = available.points.filter(q => {
          for (let i = available.checkedOccupancy; i < occupied.length; i++) {
            const o = occupied[i]
            if (!(Math.hypot(o.x - q.x, o.z - q.z) >= 2.5)) return false
          }
          return true
        })
        available.checkedOccupancy = occupied.length
        // Sort a copy: preserve authored order for equal-distance ties each time.
        const candidates = [...available.points]
        candidates.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
        p = candidates[0]; occupied.push(p)
      }
      if (kind !== 'rampart') p = ground.allocate(gate.id, p, actor.mounted)
      const y = kind === 'rampart' ? townRampartHeight(layout, p.x, p.z)! : getTerrainHeight(p.x, p.z)
      actor.garrison = { kind, gateId: gate.id, ...p, y }
    }
  }
  // Allocate unique fallback slots once, against every final ground station.
  // Reusing these on return/equipment changes avoids order-dependent overlap.
  for (const actor of ranged) {
    const station = actor.garrison!, gate = TOWN_GATES.find(g => g.id === station.gateId)!
    station.groundFallback = ground.allocate(gate.id, townGatePoint(gate, 48 + actor.index % 5 * 3, 18 + Math.floor(actor.index / 5) * 4), true)
  }
  placementCache = { key, stations: new Map(roster.flatMap(actor => actor.garrison ? [[actor.id, copyStation(actor.garrison)]] : [])) }
  return roster
}
/** Equipment can release a default ranged station without changing the resident's identity. */
export function townStationSpec<T extends { x: number; z: number; y?: number; yaw?: number; garrison?: TownGarrisonStation }>(spec: T, mounted: boolean, ranged: boolean): T {
  const station = spec.garrison?.rampartHome ?? spec.garrison
  if (!station) return spec
  if (station.kind === 'rampart' && (mounted || !ranged)) {
    const gate = TOWN_GATES.find(g => g.id === station.gateId)!
    const p = station.groundFallback ?? new TownGroundStations(getTownRampartLayout(), []).allocate(gate.id, station, mounted)
    return { ...spec, ...p, y: getTerrainHeight(p.x, p.z), garrison: { ...station, ...p, y: getTerrainHeight(p.x, p.z), kind: 'reserve', rampartHome: station } }
  }
  return { ...spec, garrison: station, x: station.x, y: station.y, z: station.z, yaw: station.yaw }
}

/** Read live equipment/state on every sensor pass; ordinary residents retain their old radius. */
export function townExternalThreatAlertRange(eagle: boolean, npc: Pick<NPC,
  'isTownRampartGarrisonActive' | 'isMounted' | 'hasActiveRangedWeapon' | 'maxRangedAttackDistance'>): number {
  if (eagle) return TOWN_EAGLE_ALERT_RADIUS
  return npc.isTownRampartGarrisonActive && !npc.isMounted && npc.hasActiveRangedWeapon
    ? npc.maxRangedAttackDistance : 20
}

export type TownDefenseThreatResponse = 'ignore' | 'defend' | 'pursue'

/** Home-sector pursuit and stationary close defense have distinct movement permissions. */
export function townDefenseThreatResponse(spec: TownActorSpec, npc: Pick<NPC,
  'isMounted' | 'rangedWeaponId' | 'combatPosition'>, target: { x: number; y: number; z: number }, range: number, tower?: TownWatchtowerNavigation | null): TownDefenseThreatResponse {
  if (![target.x, target.y, target.z, range].every(Number.isFinite) || range < 0) return 'ignore'
  const station = townStationSpec(spec, npc.isMounted, Boolean(npc.rangedWeaponId))
  const radius = isCivilianRole(spec.role) ? Math.min(10, range) : range
  const distanceSquared = npc.combatPosition.distanceToSquared(target)
  let awarenessDistance = distanceSquared
  if (isTownMilitary(spec) && tower) {
    const sourceOnTower = tower.surfaceAt(npc.combatPosition) >= 0, targetOnTower = tower.surfaceAt(target) >= 0
    const sourceReachable = sourceOnTower || Math.abs(npc.combatPosition.y - getTerrainHeight(npc.combatPosition.x, npc.combatPosition.z)) < 1.3
    const targetReachable = targetOnTower || Math.abs(target.y - getTerrainHeight(target.x, target.z)) < 1.3
    if ((sourceOnTower || targetOnTower) && sourceReachable && targetReachable) {
      awarenessDistance = (target.x - npc.combatPosition.x) ** 2 + (target.z - npc.combatPosition.z) ** 2
    }
  }
  // Tower sentries may fire across height differences, but never pursue off their deck.
  if (spec.duty === 'watchtower_guard') return distanceSquared <= radius * radius ? 'defend' : 'ignore'
  if (awarenessDistance > radius * radius) return 'ignore'
  if (Math.hypot(target.x - station.x, target.z - station.z) <= radius
    && Math.hypot(npc.combatPosition.x - station.x, npc.combatPosition.z - station.z) <= radius) return 'pursue'
  // Nearby contact may be answered beyond the leash, but cannot authorize another chase step.
  return distanceSquared <= Math.min(8, radius) ** 2 ? 'defend' : 'ignore'
}

/** Target eligibility includes close self-defense; callers retain the movement response above. */
export function townDefenseThreatInRange(spec: TownActorSpec, npc: Pick<NPC,
  'isMounted' | 'rangedWeaponId' | 'combatPosition'>, target: { x: number; y: number; z: number }, range: number, tower?: TownWatchtowerNavigation | null): boolean {
  return townDefenseThreatResponse(spec, npc, target, range, tower) !== 'ignore'
}

function isCivilianRole(role: TownActorSpec['role']): boolean { return role === 'civilian' || role === 'merchant' }
