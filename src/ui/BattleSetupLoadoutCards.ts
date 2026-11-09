import type { PlayerLoadoutConfig, PlayerMeleeWeaponId, PlayerRangedWeaponId, PlayerShieldId } from '../battle/BattleConfig'

export interface LoadoutCard { id: string | null; zh?: string; en?: string }
export interface LoadoutCardGroup { title: string; subtitle: string; cards: readonly LoadoutCard[] }

/** Item names and stats come from the databases when rendered; these lists only choose and order the cards. */
export const BATTLE_SETUP_MELEE_GROUPS: readonly LoadoutCardGroup[] = [
  { title: '長槍與騎戰長矛', subtitle: 'LANCE & SPEARS', cards: [
    { id: 'hunting_spear' }, { id: 'steel_lance' }, { id: 'heavy_lance' }, { id: 'spear_t4' }, { id: 'spear_t5' }, { id: 'byzantine_standard_lance_t5' },
  ] },
  { title: '羅馬佩劍與長劍', subtitle: 'ROMAN & KNIGHT SWORDS', cards: [
    { id: 'gladius_rusty' }, { id: 'gladius_standard' }, { id: 'centurion_blade' }, { id: 'paladin_sword_t4' }, { id: 'sword_t5' },
  ] },
  { title: '維京戰斧系列', subtitle: 'VIKING BATTLE AXES', cards: [
    { id: 'viking_axe_t1' }, { id: 'viking_axe_t2' }, { id: 'viking_axe_t3' }, { id: 'paladin_mace_t4' }, { id: 'axe_t5' },
  ] },
]

export const BATTLE_SETUP_SHIELD_GROUPS: readonly LoadoutCardGroup[] = [
  { title: '通用與特殊盾牌', subtitle: 'GENERAL & HERO SHIELDS', cards: [
    { id: null, zh: '不攜帶盾牌', en: 'NO SHIELD' },
    { id: 'paladin_shield_t4' }, { id: 'commander_shield_t5' }, { id: 'roman_officer_shield_t4' }, { id: 'viking_berserker_shield_t5' }, { id: 'byzantine_eagle_shield_t5' },
  ] },
  { title: '維京圓盾', subtitle: 'VIKING ROUND SHIELDS', cards: [{ id: 'round_shield_t1' }, { id: 'round_shield_t2' }, { id: 'round_shield_t3' }] },
  { title: '羅馬方盾', subtitle: 'ROMAN SCUTA', cards: [{ id: 'scutum_t1' }, { id: 'scutum_t2' }, { id: 'scutum_t3' }] },
]

/** Applies a clicked equipment card; mount cards also carry UI-only saved state and stay with the setup screen. */
export function applyLoadoutCard(loadout: PlayerLoadoutConfig, kind: string | undefined, id: string | null): void {
  if (kind === 'melee') loadout.meleeWeaponId = id as PlayerMeleeWeaponId
  else if (kind === 'ranged') loadout.rangedWeaponId = id as PlayerRangedWeaponId
  else if (kind === 'shield') loadout.shieldId = id as PlayerShieldId | null
}
