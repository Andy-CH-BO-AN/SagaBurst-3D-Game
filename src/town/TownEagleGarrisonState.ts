import { parseEagleFlightSnapshot, type EagleFlightSnapshot } from '../movement/EagleFlightController'
import { parseFallingRiderSnapshot, type FallingRiderSnapshot } from '../movement/FallingRider'

export const EAGLE_DUTIES = ['standby', 'walking-to-mount', 'mounted-waiting', 'sortie', 'patrolling', 'resting', 'return-queue', 'returning', 'walking-to-standby', 'casualty'] as const
export type TownEagleDuty = typeof EAGLE_DUTIES[number]
interface Position { x: number; y: number; z: number; yaw: number }
export interface TownEaglePairState {
  riderId: string; mountId: string; homePadId: string; duty: TownEagleDuty
  hp: number; ammo: number; position: Position; mounted: boolean; fall?: FallingRiderSnapshot
  mount: { hp: number; position: Position; flight: EagleFlightSnapshot }
  refitAllowed: boolean
  serviceRefit?: boolean
  /** Saved dismissal must finish physical return before native duty resumes. Never grants command authority. */
  commandReturn?: boolean
  patrol?: { active: boolean; waypoint: number; elapsed: number }
  replacementRemaining?: number
  ambientRecovery?: boolean
  restRemaining?: number
}
export interface TownEagleGarrisonState { version: 1; sceneKey: string; layoutVersion?: number; nextTakeoffRemaining?: number; pairs: TownEaglePairState[] }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const position = (value: unknown): value is Position => !!value && typeof value === 'object'
  && ['x', 'y', 'z', 'yaw'].every(key => finite((value as Record<string, unknown>)[key]))
/** Bounded strict optional extension: malformed state never changes legacy mission rosters. */
export function parseTownEagleGarrisonState(value: unknown): TownEagleGarrisonState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<TownEagleGarrisonState>
  if (raw.version !== 1 || typeof raw.sceneKey !== 'string' || !Array.isArray(raw.pairs) || raw.pairs.length > 5) return undefined
  if (raw.nextTakeoffRemaining !== undefined && (!finite(raw.nextTakeoffRemaining) || raw.nextTakeoffRemaining < 0 || raw.nextTakeoffRemaining > 1.5)) return undefined
  const seen = new Set<string>(), pairs: TownEaglePairState[] = []
  for (const pair of raw.pairs) {
    if (!pair || typeof pair !== 'object' || !/^((enemy-town:)?town-eagle-rider:)[1-5]$/.test(pair.riderId)
      || seen.has(pair.riderId.replace(/^enemy-town:/, '')) || pair.mountId !== pair.riderId.replace('rider', 'mount')
      || pair.homePadId !== pair.riderId.replace('enemy-town:', '').replace('rider', 'pad')
      || !EAGLE_DUTIES.includes(pair.duty) || !finite(pair.hp) || pair.hp < 0 || !finite(pair.ammo) || pair.ammo < 0
      || !position(pair.position) || typeof pair.mounted !== 'boolean' || !pair.mount
      || !finite(pair.mount.hp) || pair.mount.hp < 0 || !position(pair.mount.position)) return undefined
    if (pair.patrol !== undefined && (!pair.patrol || typeof pair.patrol.active !== 'boolean'
      || !Number.isInteger(pair.patrol.waypoint) || pair.patrol.waypoint < 0 || pair.patrol.waypoint > 6
      || !finite(pair.patrol.elapsed) || pair.patrol.elapsed < 0 || pair.patrol.elapsed > 180)) return undefined
    if (pair.replacementRemaining !== undefined && (!finite(pair.replacementRemaining) || pair.replacementRemaining < 0 || pair.replacementRemaining > 60)) return undefined
    if (pair.restRemaining !== undefined && (!finite(pair.restRemaining) || pair.restRemaining < 0 || pair.restRemaining > 12)) return undefined
    if (pair.commandReturn !== undefined && typeof pair.commandReturn !== 'boolean') return undefined
    if (pair.serviceRefit !== undefined && typeof pair.serviceRefit !== 'boolean') return undefined
    if (pair.ambientRecovery !== undefined && typeof pair.ambientRecovery !== 'boolean') return undefined
    const flight = parseEagleFlightSnapshot(pair.mount.flight), fall = parseFallingRiderSnapshot(pair.fall)
    if (!flight || pair.fall && !fall) return undefined
    seen.add(pair.riderId.replace(/^enemy-town:/, ''))
    pairs.push({ riderId: pair.riderId, mountId: pair.mountId, homePadId: pair.homePadId, duty: pair.duty,
      hp: pair.hp, ammo: Math.floor(pair.ammo), position: { ...pair.position }, mounted: pair.mounted,
      ...(pair.commandReturn !== undefined ? { commandReturn: pair.commandReturn } : {}),
      ...(pair.patrol ? { patrol: { ...pair.patrol } } : {}),
      ...(pair.replacementRemaining !== undefined ? { replacementRemaining: pair.replacementRemaining } : {}),
      ...(pair.ambientRecovery !== undefined ? { ambientRecovery: pair.ambientRecovery } : {}),
      ...(pair.restRemaining !== undefined ? { restRemaining: pair.restRemaining } : {}),
      ...(pair.serviceRefit ? { serviceRefit: true } : {}),
      refitAllowed: pair.refitAllowed === true, ...(fall ? { fall } : {}),
      mount: { hp: pair.mount.hp, position: { ...pair.mount.position }, flight } })
  }
  return { version: 1, sceneKey: raw.sceneKey, pairs,
    ...(raw.nextTakeoffRemaining !== undefined ? { nextTakeoffRemaining: raw.nextTakeoffRemaining } : {}),
    ...(Number.isSafeInteger(raw.layoutVersion) && raw.layoutVersion! >= 1 ? { layoutVersion: raw.layoutVersion } : {}) }
}

export type TownEagleGarrisons = Partial<Record<'roman' | 'viking', TownEagleGarrisonState>>
export function parseTownEagleGarrisons(value: unknown, legacy?: unknown): TownEagleGarrisons | undefined {
  const result: TownEagleGarrisons = {}
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const old = parseTownEagleGarrisonState(legacy)
  for (const faction of ['roman', 'viking'] as const) {
    const state = parseTownEagleGarrisonState(raw[faction]) ?? (old?.sceneKey === `town:${faction}` ? old : undefined)
    if (state?.sceneKey === `town:${faction}`) result[faction] = state
  }
  return Object.keys(result).length ? result : undefined
}
