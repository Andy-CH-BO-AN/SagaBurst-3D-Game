import { canonicalCareerMountId, type CareerMountId } from './CareerProfile'
import type { ActiveCareerMission } from './CareerMissionState'

/** Primitive save-field parsers shared by the Career profile and mission parsers. */

export function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function nonNegativeInteger(value: unknown): number {
  return Math.floor(nonNegativeNumber(value))
}

export function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === 'string' && entry.trim().length > 0
  )).map(entry => entry.trim()))]
}

export function parseMissionPlayerStats(value: unknown): ActiveCareerMission['playerStats'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const stats = {
    damageDealt: nonNegativeNumber(raw.damageDealt),
    damageTaken: nonNegativeNumber(raw.damageTaken),
    kills: nonNegativeInteger(raw.kills),
    structureDamage: nonNegativeNumber(raw.structureDamage),
    structuresDestroyed: nonNegativeInteger(raw.structuresDestroyed),
    gateBreaches: nonNegativeInteger(raw.gateBreaches),
  }
  return Object.values(stats).some(value => value > 0) ? stats : undefined
}

export const CAREER_MOUNT_IDS: CareerMountId[] = ['horse', 'armored-horse', 'horse-t1', 'horse-t2', 'horse-t3', 'black-cat', 'white-cat', 'orange-cat', 'serval', 'caracal', 'corgi', 'snow-leopard', 'xongkoro']

export function parseMountArmor(value: unknown): Partial<Record<CareerMountId, number>> {
  const result: Partial<Record<CareerMountId, number>> = {}
  if (!value || typeof value !== 'object') return result
  for (const id of ['armored-horse', 'snow-leopard'] as const) {
    const remaining = (value as Record<string, unknown>)[id]
    if (typeof remaining === 'number') result[id] = Number.isFinite(remaining) ? Math.max(0, Math.min(50, remaining)) : 0
  }
  return result
}

export function parseMissionMountState(value: unknown): ActiveCareerMission['mountState'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const activeMountId = CAREER_MOUNT_IDS.includes(raw.activeMountId as CareerMountId)
    ? canonicalCareerMountId(raw.activeMountId as CareerMountId)
    : undefined
  const rawHp = raw.hp && typeof raw.hp === 'object' ? raw.hp as Record<string, unknown> : {}
  const hp: Partial<Record<CareerMountId, number>> = {}
  for (const id of CAREER_MOUNT_IDS) {
    const value = rawHp[id]
    const canonical = canonicalCareerMountId(id)
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) hp[canonical] = Math.min(hp[canonical] ?? value, value)
  }
  const unavailable = [...new Set(uniqueStrings(raw.unavailable)
    .filter((id): id is CareerMountId => CAREER_MOUNT_IDS.includes(id as CareerMountId))
    .map(canonicalCareerMountId))]
  if (!activeMountId && Object.keys(hp).length === 0 && unavailable.length === 0) return undefined
  return { ...(activeMountId ? { activeMountId } : {}), hp, ...(Object.keys(parseMountArmor(raw.armorImpact)).length ? { armorImpact: parseMountArmor(raw.armorImpact) } : {}), unavailable }
}
