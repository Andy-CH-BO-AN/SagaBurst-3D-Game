import type { TacticalOrder } from './TacticalOrder'
import { matchesArmyCommandTarget, type ArmyCommandTarget, type SquadIdentity } from './CommandTarget'
import { UNIT_PRESETS, type UnitPresetId, type UnitLoadout } from './UnitPresetCatalog'

export const ARMY_HUD_UNIT_TYPES = {
  melee: { icon: '⚔️', label: '近戰步兵' }, spear: { icon: '🔱', label: '槍兵' },
  archer: { icon: '🏹', label: '弓兵' }, javelin: { icon: '➶', label: '標槍兵' },
  cavalry: { icon: '🐎', label: '近戰騎兵' }, lancer: { icon: '♞', label: '槍騎兵' },
  horseArcher: { icon: '🏇', label: '弓騎兵' }, eagle: { icon: '🦅', label: '巨鷹' }, civilian: { icon: '👤', label: '平民／商人' },
} as const
export type ArmyHudUnitType = keyof typeof ARMY_HUD_UNIT_TYPES
export interface ArmyHudUnitSource { presetId?: UnitPresetId; loadout?: UnitLoadout; townCategory?: string }

/** Permanent loadout/preset metadata survives death, dismounting and weapon switching. */
export function armyHudUnitType(source: ArmyHudUnitSource): ArmyHudUnitType | undefined {
  if (source.townCategory === 'civilian') return 'civilian'
  if (source.loadout?.mountId === 'xongkoro') return 'eagle'
  const preset = source.presetId && UNIT_PRESETS[source.presetId]
  if (!preset) return undefined
  const mounted = source.loadout ? Boolean(source.loadout.mountId)
    : /cavalry|lancer|horse_archer/.test(preset.id)
  if (mounted) return preset.traits.includes('bow_fire') ? 'horseArcher'
    : preset.traits.includes('lance_charge') || preset.traits.includes('lance_anti_cavalry') ? 'lancer' : 'cavalry'
  return preset.traits.includes('bow_fire') ? 'archer' : preset.traits.includes('javelin_throw') ? 'javelin'
    : preset.traits.includes('lance_anti_cavalry') || preset.traits.includes('lance_charge') ? 'spear' : 'melee'
}

export function armyHudUnitSummary(members: readonly ArmyHudMember[], target: ArmyCommandTarget): { icons: string; description: string } {
  const types = new Set(members.filter(member => matchesArmyCommandTarget(member, target)).map(member => member.unitType))
  const units = (Object.keys(ARMY_HUD_UNIT_TYPES) as ArmyHudUnitType[]).filter(type => types.has(type)).map(type => ARMY_HUD_UNIT_TYPES[type])
  return { icons: units.map(unit => unit.icon).join(' '),
    description: units.map(unit => `${unit.icon} ${unit.label}`).join('、') }
}

/** Read-only display membership. A pending identity has no NPC and cannot receive orders. */
export type ArmyHudMemberState = 'deployed' | 'returning' | 'training' | 'pending' | 'dead' | 'missing' | 'reserve' | 'exited'

export interface ArmyHudMember {
  id: string
  squadId: SquadIdentity
  state: ArmyHudMemberState
  /** Live/checkpoint order; omitted when the runtime does not expose it. */
  order?: TacticalOrder
  unitType?: ArmyHudUnitType
}

export interface ArmyHudRoster {
  /** Must change on scene, mission, faction, authority or roster identity transitions. */
  contextId: string
  members: readonly ArmyHudMember[]
}

export interface ArmyHudCounts {
  total: number
  alive: number
  deployed: number
  returning: number
  training: number
  pending: number
  dead: number
  missing: number
  reserve: number
  exited: number
}

/** Counts people by combatant ID, not mounts or rendered objects; reserves have no field presence. */
export function countArmyHudRoster(roster: ArmyHudRoster, target: ArmyCommandTarget): ArmyHudCounts {
  const counts: ArmyHudCounts = { total: 0, alive: 0, deployed: 0, returning: 0, training: 0, pending: 0, dead: 0, missing: 0, reserve: 0, exited: 0 }
  const seen = new Set<string>()
  for (const member of roster.members) {
    if (!matchesArmyCommandTarget(member, target) || seen.has(member.id)) continue
    seen.add(member.id)
    if (member.state === 'reserve' || member.state === 'exited') {
      counts[member.state]++
      continue
    }
    counts.total++
    if (member.state === 'deployed' || member.state === 'returning' || member.state === 'training') {
      // Returning and training Town residents remain living, present soldiers.
      counts.deployed++
      counts.alive++
      if (member.state === 'returning') counts.returning++
      if (member.state === 'training') counts.training++
    } else {
      counts[member.state]++
    }
  }
  return counts
}

export function armyHudCountSummary(counts: ArmyHudCounts): string {
  return `${counts.alive}/${counts.total}${counts.dead ? ` · 陣亡 ${counts.dead}` : ''}${counts.pending ? ` · 部署中 ${counts.pending}` : ''}${counts.missing ? ` · 未部署 ${counts.missing}` : ''}${counts.returning ? ` · 返回中 ${counts.returning}` : ''}`
}
