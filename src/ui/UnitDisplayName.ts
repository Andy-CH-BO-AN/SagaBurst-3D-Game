import type { TownActorSpec } from '../town/TownRules'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { HeroCombatProfileId } from '../battle/HeroCombatProfile'
import { PERSONAL_SQUAD_PRODUCTS, type CareerPersonalSquadMember } from '../career/CareerPersonalSquad'
import { legacyPersonalEquipment } from '../career/CareerInventory'
import { WEAPONS } from '../rpg/WeaponDatabase'

const FACTIONS = { roman: '羅馬', viking: '維京' } as const
const GATES = { north: '北門', south: '南門', east: '東門', west: '西門' } as const
const SERVICES: Partial<Record<TownActorSpec['role'], string>> = {
  commander: '指揮官', captain: '隊長', deployment: '士官長', merchant: '武器商人',
  ranger: '遊俠', civilian: '平民', 'hr-officer': '人資官', 'eagle-trainer': '巨鷹訓練師', cat: '黑貓',
}
const number = (ordinal: number) => String(Math.max(1, Math.trunc(ordinal))).padStart(2, '0')
const tierSuffix = (tier?: number) => tier && Number.isFinite(tier) ? ` · T${tier}` : ''

/** Display rank, not equipment tier or the legacy NPC tier-4 storage used by T5 heroes. */
export function townUnitDisplayTier(spec: TownActorSpec, _faction: CharacterFaction, ordinaryTier: number = spec.tier): number {
  if (spec.role === 'commander') return 5
  if (['captain', 'deployment', 'hr-officer', 'ranger', 'eagle-trainer'].includes(spec.role) || spec.patrolLeader) return 4
  return ordinaryTier
}

export interface TownDisplayOptions {
  tier?: number
  /** One-based durable roster position; null omits numbering for compact combat labels. */
  ordinal?: number | null
  enemy?: boolean
  includeTier?: boolean
  mounted?: boolean
}
export function townUnitDisplayName(spec: TownActorSpec, faction: CharacterFaction, options: TownDisplayOptions = {}): string {
  const melee = faction === 'roman' ? '劍兵' : '斧兵'
  const kind = spec.unitKind ?? ({
    melee_cavalry: 'sword_cavalry', lancer_cavalry: 'lancer', ranged_cavalry: 'horse_archer',
    melee_infantry: 'melee', spearman_infantry: 'spearman', ranged_infantry: 'ranged', archer_infantry: 'archer',
  } as Partial<Record<TownActorSpec['role'], TownActorSpec['unitKind']>>)[spec.role]
  const cavalry = options.mounted ?? spec.mounted
  const unit = kind === 'lancer' || kind === 'spearman' ? cavalry ? '槍騎兵' : '槍兵'
    : kind === 'horse_archer' || kind === 'archer' ? cavalry ? '弓騎兵' : '弓兵'
    : kind === 'ranged' ? faction === 'roman' ? cavalry ? '標槍騎兵' : '標槍兵' : cavalry ? '弓騎兵' : '弓兵'
    : kind === 'sword_cavalry' || kind === 'melee' ? cavalry ? `${melee.slice(0, -1)}騎兵` : melee
    : cavalry ? '騎兵' : '士兵'
  const service = SERVICES[spec.role]
  const location = spec.gateId ? GATES[spec.gateId]
    : spec.duty === 'patrol' ? `${spec.patrolId === 'B' ? '第二' : '第一'}巡邏隊`
    : spec.duty === 'eagle_garrison' ? '巨鷹隊' : spec.duty === 'training' ? '訓練隊' : FACTIONS[faction]
  const identity = spec.patrolLeader ? `${location}隊長` : service ? `${spec.role === 'commander' ? FACTIONS[faction] : ''}${service}` : `${location}${unit}`
  const numbered = !service || spec.role === 'civilian'
  const ordinal = options.ordinal === undefined ? spec.index + 1 : options.ordinal
  return `${options.enemy ? '敵方' : ''}${identity}${numbered && ordinal != null ? ` ${number(ordinal)}` : ''}${options.includeTier === false || spec.role === 'civilian' || spec.role === 'merchant' || spec.role === 'cat' ? '' : tierSuffix(townUnitDisplayTier(spec, faction, options.tier))}`
}

/** Permanent member order is supplied by the roster, never inferred from its UUID. */
export function personalUnitDisplayName(member: CareerPersonalSquadMember, faction: CharacterFaction, index?: number, ordinaryTier?: number): string {
  const product = PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)
  const equipment = member.equipment ?? legacyPersonalEquipment(member.type, faction)
  const tier = member.type === 'soldier' ? Math.min(4, ordinaryTier ?? WEAPONS[equipment.ranged ?? equipment.melee ?? '']?.tier ?? 1)
    : member.type === 'commander' ? 5 : 4
  return `私兵・${product?.name.replace(/^T\d+\s+/, '') ?? '士兵'}${index === undefined ? '' : ` ${number(index + 1)}`}${tierSuffix(tier)}`
}

export interface CombatUnitDisplayInfo {
  faction?: CharacterFaction
  tier?: number
  presetId?: UnitPresetId
  combatProfileId?: HeroCombatProfileId
  civilian?: boolean
  bandit?: boolean
  mounted?: boolean
  enemy?: boolean
  townSpec?: TownActorSpec
}
/** Only structured metadata enters this resolver. Runtime names/IDs are intentionally not accepted. */
export function combatUnitDisplayName(info: CombatUnitDisplayInfo): string {
  if (info.townSpec && info.faction) return townUnitDisplayName(info.townSpec, info.faction, { tier: info.tier, enemy: info.enemy, ordinal: null, mounted: info.mounted })
  const prefix = info.enemy ? '敵方' : ''
  if (info.bandit) return '盜匪'
  if (info.civilian) return `${prefix}平民`
  const profile = info.combatProfileId
  const hero = profile === 'roman-commander' || profile === 'viking-commander' ? '指揮官'
    : profile === 'ranger' ? '遊俠' : profile ? '隊長' : undefined
  const name = hero ? `${info.faction ? FACTIONS[info.faction] : ''}${hero}`
    : info.presetId ? UNIT_PRESETS[info.presetId]?.nameZh : undefined
  return `${prefix}${name ?? (info.mounted ? '騎兵' : '士兵')}${tierSuffix(hero === '指揮官' ? 5 : hero ? 4 : info.tier)}`
}
