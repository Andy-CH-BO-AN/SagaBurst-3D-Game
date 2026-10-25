import { isCareerShopItemUseUnlocked } from './CareerShopCatalog'
import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'
import { addCareerItem, normalizeCareerInventory, availableCareerItem, validPersonalEquipment, type PersonalEquipment, type PersonalEquipmentSlot } from './CareerInventory'
import { defaultPersonalRecruitmentChoice, inferLegacyPersonalRecruitmentRole, resolvePersonalRecruitment, type PersonalRecruitmentChoice, type PersonalRecruitmentRole } from './CareerRecruitmentCatalog'
import type { CharacterIdentity, CharacterTier, HeroArchetype } from '../combat/CharacterIdentity'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'

export const PERSONAL_SQUAD_LIMIT = 30
export type PersonalSquadMemberType = 'soldier' | 'captain' | 'ranger' | 'commander'
export interface CareerPersonalSquadMember {
  id: string; type: PersonalSquadMemberType; originalHirePrice?: number; equipment?: PersonalEquipment
  characterFaction?: CharacterIdentity['characterFaction']
  characterTier?: CharacterTier
  heroArchetype?: HeroArchetype
  recruitmentRole?: PersonalRecruitmentRole
  /** New recruitment grant receipt; a saved null slot is never a missing legacy grant. */
  initialEquipmentVersion?: 1
  /** Durable migration receipt: removed/sold weapons are never granted again. */
  rangerEquipmentVersion?: 1
}
/** Historical four-product prices, retained only for receiptless save migration and refunds. */
export const PERSONAL_SQUAD_PRODUCTS = [
  { type: 'soldier', name: 'Sword / Axe Soldier', price: 50 },
  { type: 'captain', name: 'T4 Captain', price: 500 },
  { type: 'ranger', name: 'T4 Shadow Warden / Mounted Ranger', price: 500 },
  { type: 'commander', name: 'T5 Commander', price: 2000 },
] as const
export function canRecruitPersonalSquad(profile: Pick<CareerProfile, 'rank'>, type?: PersonalSquadMemberType): boolean {
  return profile.rank === 'commander' || profile.rank === 'captain' && type !== 'commander'
}
export type RecruitmentFailure = 'rank-locked' | 'invalid-product' | 'insufficient-merit' | 'squad-full' | 'invalid-id' | 'save-failed'
export interface RecruitmentResult { profile: CareerProfile; recruited: boolean; reason?: RecruitmentFailure }
/** Catalog-owned prices; ownership and currency are staged on a clone before one save. */
export function recruitPersonalSquadMember(current: CareerProfile, choice: PersonalRecruitmentChoice | PersonalSquadMemberType,
  save: (profile: CareerProfile) => boolean, createId: () => string = () => `personal:${crypto.randomUUID()}`): RecruitmentResult {
  const fail = (reason: RecruitmentFailure): RecruitmentResult => ({ profile: current, recruited: false, reason })
  const input = typeof choice === 'string' && PERSONAL_SQUAD_PRODUCTS.some(item => item.type === choice)
    ? defaultPersonalRecruitmentChoice(choice, current.faction) : typeof choice === 'object' ? choice : undefined
  const product = input && resolvePersonalRecruitment(current.faction, input)
  if (!product) return fail('invalid-product')
  const type = product.type
  if (!canRecruitPersonalSquad(current, type)) return fail('rank-locked')
  const members = current.personalSquad?.members ?? []
  if (members.length >= PERSONAL_SQUAD_LIMIT) return fail('squad-full')
  if (current.availableMerit < product.price) return fail('insufficient-merit')
  const id = createId()
  if (!/^personal:[A-Za-z0-9-]+$/.test(id) || members.some(member => member.id === id)) return fail('invalid-id')
  const next = cloneCareerProfile(current)
  normalizeCareerInventory(next)
  const equipment = { ...product.equipment }
  for (const id of Object.values(equipment)) if (id) addCareerItem(next, id, 1)
  next.availableMerit -= product.price
  next.personalSquad = { members: [...(next.personalSquad?.members ?? []), { id, type, characterFaction: product.characterFaction, characterTier: product.characterTier,
    ...(product.heroArchetype ? { heroArchetype: product.heroArchetype } : {}), recruitmentRole: product.recruitmentRole,
    initialEquipmentVersion: 1, originalHirePrice: product.price, equipment, ...(type === 'ranger' ? { rangerEquipmentVersion: 1 as const } : {}) }] }
  const key = `${next.faction}:hr-recruit-${type}`
  next.townDialogueSeen = [...new Set([...(next.townDialogueSeen ?? []), key])]
  try { if (!save(next)) return fail('save-failed') } catch { return fail('save-failed') }
  return { profile: next, recruited: true }
}
export function parsePersonalSquad(value: unknown, faction: CareerProfile['faction'] = 'roman'): { members: CareerPersonalSquadMember[] } | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || !Array.isArray((value as { members?: unknown }).members)) throw new Error('Invalid personal squad')
  const members = (value as { members: unknown[] }).members
  if (members.length > PERSONAL_SQUAD_LIMIT) throw new Error('Personal squad exceeds limit')
  const ids = new Set<string>()
  return { members: members.map(value => {
    const member = value as CareerPersonalSquadMember | null
    if (!member || typeof member.id !== 'string' || !/^personal:[A-Za-z0-9-]+$/.test(member.id)
      || ids.has(member.id) || !PERSONAL_SQUAD_PRODUCTS.some(item => item.type === member.type)) throw new Error('Invalid personal member')
    ids.add(member.id)
    const product = PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)!
    if (member.rangerEquipmentVersion !== undefined && member.rangerEquipmentVersion !== 1) throw new Error('Invalid ranger equipment version')
    if (member.initialEquipmentVersion !== undefined && member.initialEquipmentVersion !== 1) throw new Error('Invalid initial equipment version')
    const equipment = member.equipment
    if (equipment && (typeof equipment !== 'object' || Array.isArray(equipment))) throw new Error('Invalid equipment')
    const characterFaction = member.characterFaction === undefined ? faction : member.characterFaction
    if (characterFaction !== 'roman' && characterFaction !== 'viking') throw new Error('Invalid member faction')
    const defaults = defaultPersonalRecruitmentChoice(member.type, characterFaction)
    // Legacy type is the durable identity. Equipment is consulted only for the previously unsaved role.
    const characterTier = member.characterTier === undefined ? defaults.characterTier : member.characterTier
    const heroArchetype = member.characterTier === undefined ? defaults.heroArchetype : member.heroArchetype
    const recruitmentRole = member.recruitmentRole === undefined ? inferLegacyPersonalRecruitmentRole(equipment, member.type, characterFaction) : member.recruitmentRole
    const resolved = resolvePersonalRecruitment(characterFaction, { characterTier, heroArchetype, recruitmentRole })
    if (!resolved || resolved.type !== member.type || member.characterTier === undefined && member.heroArchetype !== undefined && member.heroArchetype !== defaults.heroArchetype
      || member.initialEquipmentVersion === 1 && (!equipment || member.characterTier === undefined || member.recruitmentRole === undefined)) throw new Error('Invalid member identity')
    const originalHirePrice = member.originalHirePrice === undefined
      ? member.initialEquipmentVersion === 1 ? resolved.price : product.price : member.originalHirePrice
    if (!Number.isSafeInteger(originalHirePrice) || originalHirePrice < 0) throw new Error('Invalid hire price')
    return { id: member.id, type: member.type, originalHirePrice, characterFaction, characterTier, ...(heroArchetype ? { heroArchetype } : {}), recruitmentRole,
      ...(member.initialEquipmentVersion === 1 ? { initialEquipmentVersion: 1 as const } : {}),
      ...(member.rangerEquipmentVersion === 1 ? { rangerEquipmentVersion: 1 as const } : {}), ...(equipment ? { equipment: {
      melee: equipment.melee ?? null, ranged: equipment.ranged ?? null, shield: equipment.shield ?? null,
      mount: (['horse-t1', 'horse-t2', 'horse-t3'].includes(equipment.mount as string) ? 'horse' : equipment.mount) ?? null,
    } } : {}) }
  }) }
}
export function personalSquadGreeting(profile: CareerProfile): string {
  switch (profile.rank) {
    case 'recruit': return '新兵？去兵營報到。\n這裡處理的是軍官自己的部隊，不是替你找同伴的地方。'
    case 'soldier': return '先學會跟著命令走，再來談帶人。\n等你真的有資格指揮自己的部隊，我們再談。'
    case 'veteran': return '你很能打，Veteran。\n但能打，和能讓三十個人跟著你，是兩回事。\n等你升任 Captain，再來找我。'
    case 'commander': return 'Commander，需要補充你的人嗎？'
    case 'captain': return profile.townDialogueSeen?.includes(`${profile.faction}:hr-unlocked`)
      ? 'Captain，需要補充你的隊伍嗎？'
      : 'Captain。現在你有資格建立自己的隨行隊伍了。\n最多三十人。他們不屬於巡邏隊，也不屬於城防軍，只聽你的命令。\nT1／T2／T3 士兵為 100／200／300 軍功，T4 隊長與遊俠各 500 軍功。\n需要他們時，下令 Follow me；不要用了，就讓他們 Dismiss 回來。'
  }
}
export const PERSONAL_RECRUIT_DIALOGUE: Record<PersonalSquadMemberType, string> = {
  soldier: '人已經登記到你的隊伍。\n需要他們時，下令 Follow me。',
  captain: '這不是普通士兵。\n他能獨立帶人，但現在，他聽你的命令。',
  ranger: '遊俠已經登記，並領取你選擇的兵種裝備。\n需要他們時，下令 Follow me。',
  commander: 'Commander 已經登記到你的隊伍。\n他有統率全軍的能力，現在由你下令。',
}

export interface PersonalSquadAuthority { readonly state: 'RESERVE' | 'DEPLOYING' | 'ACTIVE' | 'RETURNING' }
export type PersonalManagementFailure = 'rank-locked' | 'not-reserve' | 'missing-member' | 'invalid-item' | 'no-available-item' | 'last-weapon' | 'save-failed'
export function personalMemberRefund(profile: CareerProfile, member: CareerPersonalSquadMember): number {
  const price = member.originalHirePrice ?? PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)!.price
  return Math.floor(price * (profile.rank === 'commander' ? .9 : profile.rank === 'captain' ? .8 : 0))
}
export function changePersonalEquipment(read: () => CareerProfile, authority: PersonalSquadAuthority, memberId: string,
  slot: PersonalEquipmentSlot, id: string | null, save: (profile: CareerProfile) => boolean) {
  const current = read()
  const fail = (reason: PersonalManagementFailure) => ({ changed: false, profile: current, reason })
  if (!canRecruitPersonalSquad(current)) return fail('rank-locked')
  if (authority.state !== 'RESERVE' || current.activeMission || current.activeOutpostMission) return fail('not-reserve')
  const existing = current.personalSquad?.members.find(member => member.id === memberId)
  if (!existing) return fail('missing-member')
  if (!['melee', 'ranged', 'shield', 'mount'].includes(slot)) return fail('invalid-item')
  if (id !== null && (typeof id !== 'string' || !id)) return fail('invalid-item')
  const item = id ? WEAPONS[id] ?? ARMORS[id] : undefined
  if (id && (slot === 'mount' ? !(PLAYER_MOUNT_IDS as readonly string[]).includes(id) :
    !item || item.type !== (slot === 'shield' ? 'shield' : slot))) return fail('invalid-item')
  const next = cloneCareerProfile(current)
  normalizeCareerInventory(next)
  const member = next.personalSquad!.members.find(member => member.id === memberId)!
  const equipment = member.equipment!
  if (id !== equipment[slot] && id && availableCareerItem(next, id) < 1) return fail('no-available-item')
  if (id && !isCareerShopItemUseUnlocked(current, id)) return fail('rank-locked')
  Object.assign(equipment, { [slot]: id })
  if (!equipment.melee && !equipment.ranged) return fail('last-weapon')
  if (!validPersonalEquipment(member.type, equipment)) return fail('invalid-item')
  try { if (!save(next)) return fail('save-failed') } catch { return fail('save-failed') }
  return { changed: true, profile: next, reason: undefined }
}
export function sellPersonalSquadMember(read: () => CareerProfile, authority: PersonalSquadAuthority, memberId: string,
  save: (profile: CareerProfile) => boolean) {
  const current = read()
  const fail = (reason: PersonalManagementFailure) => ({ sold: false, profile: current, refund: 0, reason })
  if (!canRecruitPersonalSquad(current)) return fail('rank-locked')
  if (authority.state !== 'RESERVE' || current.activeMission || current.activeOutpostMission) return fail('not-reserve')
  const member = current.personalSquad?.members.find(member => member.id === memberId)
  if (!member) return fail('missing-member')
  if (member.equipment && !member.equipment.melee && !member.equipment.ranged
    && (member.type !== 'ranger' || member.rangerEquipmentVersion === 1)) return fail('last-weapon')
  const next = cloneCareerProfile(current)
  normalizeCareerInventory(next)
  const refund = personalMemberRefund(current, member)
  const equipment = next.personalSquad!.members.find(member => member.id === memberId)!.equipment!
  next.personalSquad!.members = next.personalSquad!.members.filter(member => member.id !== memberId)
  for (const id of Object.values(equipment)) if (id) addCareerItem(next, id, -1)
  next.availableMerit += refund
  try { if (!save(next)) return fail('save-failed') } catch { return fail('save-failed') }
  return { sold: true, profile: next, refund, reason: undefined }
}

/** Reuse member-sale rules, staging the whole selection before one persistent save. */
export function sellPersonalSquadMembers(read: () => CareerProfile, authority: PersonalSquadAuthority, memberIds: readonly string[],
  save: (profile: CareerProfile) => boolean) {
  const current = read(), ids = [...new Set(memberIds)]
  const fail = (reason: PersonalManagementFailure) => ({ sold: false, profile: current, soldCount: 0, refund: 0, reason })
  if (!ids.length) return fail('missing-member')
  let staged = current, refund = 0
  for (const id of ids) {
    const result = sellPersonalSquadMember(() => staged, authority, id, next => { staged = next; return true })
    if (!result.sold) return fail(result.reason!)
    refund += result.refund
  }
  try { if (!save(staged)) return fail('save-failed') } catch { return fail('save-failed') }
  return { sold: true, profile: staged, soldCount: ids.length, refund, reason: undefined }
}
