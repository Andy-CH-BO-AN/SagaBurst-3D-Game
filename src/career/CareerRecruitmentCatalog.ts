import { characterIdentityMaxHp, resolveCharacterIdentity, type CharacterIdentity, type CharacterTier, type HeroArchetype } from '../combat/CharacterIdentity'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { PersonalEquipment } from './CareerInventory'
import type { PersonalSquadMemberType } from './CareerPersonalSquad'

export const PERSONAL_RECRUITMENT_ROLES = ['archer', 'swordsman', 'javelin', 'axeman', 'spearman'] as const
export type PersonalRecruitmentRole = typeof PERSONAL_RECRUITMENT_ROLES[number]
export interface PersonalRecruitmentChoice {
  characterTier: CharacterTier
  heroArchetype?: HeroArchetype
  recruitmentRole: PersonalRecruitmentRole
}
export interface PersonalRecruitmentProduct extends PersonalRecruitmentChoice {
  characterFaction: CharacterIdentity['characterFaction']
  type: PersonalSquadMemberType
  price: number
  maxHp: number
  equipment: PersonalEquipment
}
export const PERSONAL_ROLE_NAMES: Record<PersonalRecruitmentRole, string> = {
  archer: '弓兵', swordsman: '劍兵', javelin: '標槍兵', axeman: '斧兵', spearman: '槍兵',
}
const PRICES: Record<CharacterTier, number> = { 1: 100, 2: 200, 3: 300, 4: 500, 5: 2000 }

/** Only recruitment owns these grants. Mission loadouts and saved equipment never use this table. */
export function resolvePersonalRecruitment(faction: CharacterIdentity['characterFaction'], choice: PersonalRecruitmentChoice): PersonalRecruitmentProduct | undefined {
  if (faction !== 'roman' && faction !== 'viking' || !choice || ![1, 2, 3, 4, 5].includes(choice.characterTier)
    || !(PERSONAL_RECRUITMENT_ROLES as readonly string[]).includes(choice.recruitmentRole)) return undefined
  const { characterTier, heroArchetype, recruitmentRole } = choice
  if (characterTier <= 3 ? heroArchetype !== undefined : characterTier === 4
    ? heroArchetype !== 'captain' && heroArchetype !== 'ranger' : heroArchetype !== 'commander') return undefined
  const weaponTier = characterTier <= 3 ? 1 : 2
  const index = weaponTier - 1
  const sword = (faction === 'roman' ? ['gladius_rusty', 'gladius_standard'] : ['rusty_dagger', 'steel_sword'])[index]!
  const equipment: PersonalEquipment = { melee: sword, ranged: null, shield: null, mount: characterTier <= 3 ? null : 'horse' }
  switch (recruitmentRole) {
    case 'archer': equipment.ranged = ['wooden_shortbow', 'recurve_longbow'][index]!; break
    case 'javelin': equipment.ranged = ['pilum_basic', 'pilum_standard'][index]!; break
    case 'spearman': equipment.melee = ['hunting_spear', 'steel_lance'][index]!; break
    case 'axeman': equipment.melee = ['viking_axe_t1', 'viking_axe_t2'][index]!; break
  }
  if (recruitmentRole === 'swordsman' || recruitmentRole === 'axeman') equipment.shield = `${faction === 'roman' ? 'scutum' : 'round_shield'}_t${weaponTier}`
  const type = heroArchetype ?? 'soldier'
  const maxHp = characterIdentityMaxHp(resolveCharacterIdentity({ characterFaction: faction, characterTier, heroArchetype }))
  return { characterFaction: faction, characterTier, ...(heroArchetype ? { heroArchetype } : {}), recruitmentRole, type, price: PRICES[characterTier], maxHp, equipment }
}

/** Compatibility for callers of the old four-product API; all new hires still use the catalog. */
export function defaultPersonalRecruitmentChoice(type: PersonalSquadMemberType, faction: CharacterIdentity['characterFaction']): PersonalRecruitmentChoice {
  const recruitmentRole = type === 'ranger' ? 'archer' : faction === 'roman' ? 'swordsman' : 'axeman'
  return type === 'soldier' ? { characterTier: 2, recruitmentRole }
    : { characterTier: type === 'commander' ? 5 : 4, heroArchetype: type, recruitmentRole }
}

/** One-time migration estimate: old saves never recorded the original recruitment choice. */
export function inferLegacyPersonalRecruitmentRole(equipment: PersonalEquipment | undefined, type: PersonalSquadMemberType,
  faction: CharacterIdentity['characterFaction']): PersonalRecruitmentRole {
  const ranged = equipment?.ranged ? WEAPONS[equipment.ranged] : undefined
  if (ranged?.combatKind === 'javelin') return 'javelin'
  if (ranged?.combatKind === 'bow') return 'archer'
  const melee = equipment?.melee ? WEAPONS[equipment.melee] : undefined
  if (melee?.combatKind === 'lance') return 'spearman'
  if (melee?.animationKind === 'axe') return 'axeman'
  if (melee) return 'swordsman'
  return defaultPersonalRecruitmentChoice(type, faction).recruitmentRole
}
