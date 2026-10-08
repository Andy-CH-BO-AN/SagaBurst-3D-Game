import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'
import { addCareerItem, initialPersonalEquipment, normalizeCareerInventory, availableCareerItem, validPersonalEquipment, type PersonalEquipment, type PersonalEquipmentSlot } from './CareerInventory'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { cloneCareerProfile, getCareerPurchaseTier, type CareerProfile } from './CareerProfile'

export const PERSONAL_SQUAD_LIMIT = 30
export type PersonalSquadMemberType = 'soldier' | 'captain' | 'ranger'
export interface CareerPersonalSquadMember { id: string; type: PersonalSquadMemberType; originalHirePrice?: number; equipment?: PersonalEquipment }
export const PERSONAL_SQUAD_PRODUCTS = [
  { type: 'soldier', name: 'T2 Sword / Axe Soldier', price: 50 },
  { type: 'captain', name: 'T4 Captain', price: 500 },
  { type: 'ranger', name: 'T4 Maki / Mounted Ranger', price: 500 },
] as const
export function canRecruitPersonalSquad(profile: Pick<CareerProfile, 'rank'>): boolean {
  return profile.rank === 'captain' || profile.rank === 'commander'
}
export type RecruitmentFailure = 'rank-locked' | 'invalid-product' | 'insufficient-merit' | 'squad-full' | 'invalid-id' | 'save-failed'
export interface RecruitmentResult { profile: CareerProfile; recruited: boolean; reason?: RecruitmentFailure }
/** Catalog-owned prices; ownership and currency are staged on a clone before one save. */
export function recruitPersonalSquadMember(current: CareerProfile, type: PersonalSquadMemberType,
  save: (profile: CareerProfile) => boolean, createId: () => string = () => `personal:${crypto.randomUUID()}`): RecruitmentResult {
  const fail = (reason: RecruitmentFailure): RecruitmentResult => ({ profile: current, recruited: false, reason })
  if (!canRecruitPersonalSquad(current)) return fail('rank-locked')
  const product = PERSONAL_SQUAD_PRODUCTS.find(item => item.type === type)
  if (!product) return fail('invalid-product')
  const members = current.personalSquad?.members ?? []
  if (members.length >= PERSONAL_SQUAD_LIMIT) return fail('squad-full')
  if (current.availableMerit < product.price) return fail('insufficient-merit')
  const id = createId()
  if (!/^personal:[A-Za-z0-9-]+$/.test(id) || members.some(member => member.id === id)) return fail('invalid-id')
  const next = cloneCareerProfile(current)
  normalizeCareerInventory(next)
  const equipment = initialPersonalEquipment(type, next.faction)
  for (const id of Object.values(equipment)) if (id) addCareerItem(next, id, 1)
  next.availableMerit -= product.price
  next.personalSquad = { members: [...(next.personalSquad?.members ?? []), { id, type, originalHirePrice: product.price, equipment }] }
  const key = `${next.faction}:hr-recruit-${type}`
  next.townDialogueSeen = [...new Set([...(next.townDialogueSeen ?? []), key])]
  try { if (!save(next)) return fail('save-failed') } catch { return fail('save-failed') }
  return { profile: next, recruited: true }
}
export function parsePersonalSquad(value: unknown): { members: CareerPersonalSquadMember[] } | undefined {
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
    const originalHirePrice = member.originalHirePrice === undefined ? product.price : member.originalHirePrice
    if (!Number.isSafeInteger(originalHirePrice) || originalHirePrice < 0) throw new Error('Invalid hire price')
    const equipment = member.equipment
    if (equipment && (typeof equipment !== 'object' || Array.isArray(equipment))) throw new Error('Invalid equipment')
    return { id: member.id, type: member.type, originalHirePrice, ...(equipment ? { equipment: {
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
      : 'Captain。現在你有資格建立自己的隨行隊伍了。\n最多三十人。他們不屬於巡邏隊，也不屬於城防軍，只聽你的命令。\n普通戰士五十軍功。Captain 和 Mounted Ranger 各五百軍功。\n需要他們時，下令 Follow me；不要用了，就讓他們 Dismiss 回來。'
  }
}
export const PERSONAL_RECRUIT_DIALOGUE: Record<PersonalSquadMemberType, string> = {
  soldier: '人已經登記到你的隊伍。\n需要他們時，下令 Follow me。',
  captain: '這不是普通士兵。\n他能獨立帶人，但現在，他聽你的命令。',
  ranger: 'Mounted Ranger 已經登記。\n她擅長遠距離作戰。別把她浪費在最前排。',
}

export interface PersonalSquadAuthority { readonly state: 'RESERVE' | 'DEPLOYING' | 'ACTIVE' | 'RETURNING' }
export type PersonalManagementFailure = 'rank-locked' | 'not-reserve' | 'missing-member' | 'fixed-equipment' | 'invalid-item' | 'no-available-item' | 'last-weapon' | 'save-failed'
export function personalMemberRefund(profile: CareerProfile, member: CareerPersonalSquadMember): number {
  const price = member.originalHirePrice ?? PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)!.price
  return Math.floor(price * (profile.rank === 'commander' ? .9 : profile.rank === 'captain' ? .8 : 0))
}
export function changePersonalEquipment(read: () => CareerProfile, authority: PersonalSquadAuthority, memberId: string,
  slot: PersonalEquipmentSlot, id: string | null, save: (profile: CareerProfile) => boolean) {
  const current = read()
  const fail = (reason: PersonalManagementFailure) => ({ changed: false, profile: current, reason })
  if (authority.state !== 'RESERVE' || current.activeMission || current.activeOutpostMission) return fail('not-reserve')
  const existing = current.personalSquad?.members.find(member => member.id === memberId)
  if (!existing) return fail('missing-member')
  if (existing.type === 'ranger' && slot !== 'mount') return fail('fixed-equipment')
  if (!['melee', 'ranged', 'shield', 'mount'].includes(slot)) return fail('invalid-item')
  if (id !== null && (typeof id !== 'string' || !id)) return fail('invalid-item')
  const item = id ? WEAPONS[id] ?? ARMORS[id] : undefined
  if (id && (slot === 'mount' ? !(PLAYER_MOUNT_IDS as readonly string[]).includes(id) :
    !item || item.type !== (slot === 'shield' ? 'shield' : slot) || id.startsWith('maki-ranger-bow'))) return fail('invalid-item')
  const next = cloneCareerProfile(current)
  normalizeCareerInventory(next)
  const member = next.personalSquad!.members.find(member => member.id === memberId)!
  const equipment = member.equipment!
  if (id !== equipment[slot] && id && availableCareerItem(next, id) < 1) return fail('no-available-item')
  if (id && (item?.tier ?? (id === 'horse' ? 1 : 4)) > getCareerPurchaseTier(current.rank)) return fail('rank-locked')
  Object.assign(equipment, { [slot]: id })
  if (id && slot === 'ranged') equipment.shield = null
  if (id && slot === 'shield') equipment.ranged = null
  if (member.type !== 'ranger' && !equipment.melee && !equipment.ranged) return fail('last-weapon')
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
  if (member.type !== 'ranger' && member.equipment && !member.equipment.melee && !member.equipment.ranged) return fail('last-weapon')
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
