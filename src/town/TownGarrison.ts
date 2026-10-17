import type { NPC } from '../world/NPC'
import { TOWN_EAGLE_ALERT_RADIUS } from './TownEagleGarrison'
import { siegeDefensePlans } from '../career/TownDefenseRoster'
import { getTerrainHeight } from '../world/Terrain'
import { TOWN_GATES, townGatePoint, type TownGateId } from './TownLayout'
import { getTownRampartLayout, townRampartHeight } from './TownRamparts'
import type { TownActorSpec } from './TownRules'

export interface TownGarrisonStation { kind: 'rampart' | 'gate' | 'reserve'; gateId: TownGateId; x: number; y: number; z: number; yaw: number }
/** Placement only: legacy duty/training/group fields remain the mission identity contract. */
export function assignTownGarrison(roster: TownActorSpec[]): TownActorSpec[] {
  const layout = getTownRampartLayout()
  const plans = siegeDefensePlans(roster)
  const gateByActor = new Map(plans.flatMap(p => [...p.infantry, ...p.cavalry].map(id => [id, p.gateId] as const)))
  const occupied: { x: number; z: number }[] = []
  const rampartCandidates = new Map<TownGateId, {
    points: { x: number; z: number; yaw: number }[]; checkedOccupancy: number
  }>()
  const ranged = roster.filter(a => !a.mounted && (a.duty === 'training' || a.duty === 'gate_guard') && (a.unitKind === 'ranged' || a.unitKind === 'archer'))
  const melee = roster.filter(a => !a.mounted && (a.duty === 'training' || a.duty === 'gate_guard') && (a.unitKind === 'melee' || a.unitKind === 'spearman'))
  const cavalry = roster.filter(a => a.mounted && a.duty === 'training')
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
                x: s.startX + s.dirX * along + s.dirZ * 2, z: s.startZ + s.dirZ * along - s.dirX * 2, yaw: gate.yaw,
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
      const y = kind === 'rampart' ? townRampartHeight(layout, p.x, p.z)! : getTerrainHeight(p.x, p.z)
      actor.garrison = { kind, gateId: gate.id, ...p, y }
    }
  }
  return roster
}
/** Equipment can release a default ranged station without changing the resident's identity. */
export function townStationSpec(spec: TownActorSpec, mounted: boolean, ranged: boolean): TownActorSpec {
  const station = spec.garrison
  if (!station) return spec
  if (station.kind === 'rampart' && (mounted || !ranged)) {
    const gate = TOWN_GATES.find(g => g.id === station.gateId)!
    const p = townGatePoint(gate, 48 + spec.index % 5 * 3, 18 + Math.floor(spec.index / 5) * 4)
    return { ...spec, ...p, y: getTerrainHeight(p.x, p.z), garrison: { ...station, ...p, y: getTerrainHeight(p.x, p.z), kind: 'reserve' } }
  }
  return { ...spec, x: station.x, y: station.y, z: station.z, yaw: station.yaw }
}

/** Read live equipment/state on every sensor pass; ordinary residents retain their old radius. */
export function townExternalThreatAlertRange(eagle: boolean, npc: Pick<NPC,
  'isTownRampartGarrisonActive' | 'isMounted' | 'hasActiveRangedWeapon' | 'maxRangedAttackDistance'>): number {
  if (eagle) return TOWN_EAGLE_ALERT_RADIUS
  return npc.isTownRampartGarrisonActive && !npc.isMounted && npc.hasActiveRangedWeapon
    ? npc.maxRangedAttackDistance : 20
}
