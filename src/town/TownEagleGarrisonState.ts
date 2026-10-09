import { parseEagleFlightSnapshot, type EagleFlightSnapshot } from '../movement/EagleFlightController'
import { parseFallingRiderSnapshot, type FallingRiderSnapshot } from '../movement/FallingRider'

export const EAGLE_DUTIES = ['standby', 'walking-to-mount', 'mounted-waiting', 'sortie', 'return-queue', 'returning', 'walking-to-standby', 'casualty'] as const
export type TownEagleDuty = typeof EAGLE_DUTIES[number]
interface Position { x: number; y: number; z: number; yaw: number }
export interface TownEaglePairState {
  riderId: string; mountId: string; homePadId: string; duty: TownEagleDuty
  hp: number; ammo: number; position: Position; mounted: boolean; fall?: FallingRiderSnapshot
  mount: { hp: number; position: Position; flight: EagleFlightSnapshot }
  refitAllowed: boolean
}
export interface TownEagleGarrisonState { version: 1; sceneKey: string; pairs: TownEaglePairState[] }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const position = (value: unknown): value is Position => !!value && typeof value === 'object'
  && ['x', 'y', 'z', 'yaw'].every(key => finite((value as Record<string, unknown>)[key]))
/** Bounded strict optional extension: malformed state never changes legacy mission rosters. */
export function parseTownEagleGarrisonState(value: unknown): TownEagleGarrisonState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<TownEagleGarrisonState>
  if (raw.version !== 1 || typeof raw.sceneKey !== 'string' || !Array.isArray(raw.pairs) || raw.pairs.length > 5) return undefined
  const seen = new Set<string>(), pairs: TownEaglePairState[] = []
  for (const pair of raw.pairs) {
    if (!pair || typeof pair !== 'object' || !/^((enemy-town:)?town-eagle-rider:)[1-5]$/.test(pair.riderId)
      || seen.has(pair.riderId) || pair.mountId !== pair.riderId.replace('rider', 'mount')
      || pair.homePadId !== pair.riderId.replace('enemy-town:', '').replace('rider', 'pad')
      || !EAGLE_DUTIES.includes(pair.duty) || !finite(pair.hp) || pair.hp < 0 || !finite(pair.ammo) || pair.ammo < 0
      || !position(pair.position) || typeof pair.mounted !== 'boolean' || !pair.mount
      || !finite(pair.mount.hp) || pair.mount.hp < 0 || !position(pair.mount.position)) return undefined
    const flight = parseEagleFlightSnapshot(pair.mount.flight), fall = parseFallingRiderSnapshot(pair.fall)
    if (!flight || pair.fall && !fall) return undefined
    seen.add(pair.riderId)
    pairs.push({ riderId: pair.riderId, mountId: pair.mountId, homePadId: pair.homePadId, duty: pair.duty,
      hp: pair.hp, ammo: Math.floor(pair.ammo), position: { ...pair.position }, mounted: pair.mounted,
      refitAllowed: pair.refitAllowed === true, ...(fall ? { fall } : {}),
      mount: { hp: pair.mount.hp, position: { ...pair.mount.position }, flight } })
  }
  return { version: 1, sceneKey: raw.sceneKey, pairs }
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
