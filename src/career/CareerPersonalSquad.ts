import { cloneCareerProfile, type CareerProfile } from './CareerProfile'

export const PERSONAL_SQUAD_LIMIT = 30
export type PersonalSquadMemberType = 'soldier' | 'captain' | 'ranger'
export interface CareerPersonalSquadMember { id: string; type: PersonalSquadMemberType }
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
  next.availableMerit -= product.price
  next.personalSquad = { members: [...(next.personalSquad?.members ?? []), { id, type }] }
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
    return { id: member.id, type: member.type }
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
