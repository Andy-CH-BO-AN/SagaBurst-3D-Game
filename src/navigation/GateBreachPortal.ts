import type { BreachEntrance } from './AvailableBreachEntrances'

/** Physical gate width, distinct from the centre waypoint used by legacy entrances. */
export interface GateBreachPortal { halfWidth: number; halfDepth: number }

/** Stable actor-local lanes require no live crowd ordering or checkpoint migration. */
export function gateBreachLane(actorId: string, mounted: boolean, halfWidth: number): number {
  const radius = mounted ? 1.25 : .6, margin = .35
  const available = Math.max(0, halfWidth - radius - margin)
  const count = Math.max(1, Math.floor(available * 2 / (radius * 2 + .3)) + 1)
  let hash = 2166136261
  for (let i = 0; i < actorId.length; i++) hash = Math.imul(hash ^ actorId.charCodeAt(i), 16777619)
  return count === 1 ? 0 : -available + ((hash >>> 0) % count) * available * 2 / (count - 1)
}

export function gateBreachProgress(entry: BreachEntrance, point: { x: number; z: number }): { along: number; lateral: number; dx: number; dz: number } {
  const dx = entry.exit.x - entry.approach.x, dz = entry.exit.z - entry.approach.z
  const length = Math.hypot(dx, dz) || 1, x = dx / length, z = dz / length
  return { along: (point.x - entry.position.x) * x + (point.z - entry.position.z) * z,
    lateral: (point.x - entry.position.x) * -z + (point.z - entry.position.z) * x, dx: x, dz: z }
}

export function hasClearedGateBreach(entry: BreachEntrance, point: { x: number; z: number }, mounted: boolean): boolean {
  if (!entry.portal || entry.type !== 'gate' || !entry.walkable) return false
  const p = gateBreachProgress(entry, point), radius = mounted ? 1.25 : .6
  // Legacy saves can already be deep inside and laterally off-axis. Once the
  // whole body crossed the inward frame plane, portal ownership must stay released.
  return p.along >= entry.portal.halfDepth + radius
}
