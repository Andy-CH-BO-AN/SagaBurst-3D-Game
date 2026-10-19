import type { CareerProfile } from './CareerProfile'
import { cloneCareerProfile, getCareerPurchaseTier } from './CareerProfile'
import { availableCareerItem, careerItemTotals, normalizeCareerInventory, type PersonalEquipmentSlot } from './CareerInventory'
import { canRecruitPersonalSquad, type PersonalSquadAuthority } from './CareerPersonalSquad'
import type { SquadId } from '../battle/CommandTarget'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { commanderTownSquadLabel } from './CommanderTownSquadLabels'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { planBulkEquipment, naturalActorCompare, type BulkEquipmentCategory, type BulkEquipmentCandidate, type BulkEquipmentActor } from './BulkEquipmentPlanner'
import { resolveTownActorEquipment, townNativeItems, townEquipmentRefTier, townEquipmentWeaponTier, TOWN_EQUIPMENT_SLOTS,
  createTownEquipmentRefsResolver, townEquipmentActorSpecs, townEquipmentSquadForActor,
  type TownEquipmentRef, type TownEquipmentRefs } from './CareerTownEquipmentState'
export { resolveTownActorEquipment, townEquipmentRefTier, townNativeItems } from './CareerTownEquipmentState'
export type { TownEquipmentRef, TownEquipmentRefs, ResolvedTownActorEquipment } from './CareerTownEquipmentState'
export type { BulkEquipmentCategory } from './BulkEquipmentPlanner'
export type TownEquipmentSquadId = SquadId | 'personal' | 'civilian'
export interface TownEquipmentSquad { id: TownEquipmentSquadId; name: string; actorIds: readonly string[] }
export interface TownEquipmentContext {
  townFaction: CareerProfile['faction']; peaceful: boolean; safeActorIds: ReadonlySet<string>
  personalState: PersonalSquadAuthority['state']
}
export type TownEquipmentFailure = 'rank-locked' | 'enemy-town' | 'not-safe' | 'not-reserve' | 'mission-active' | 'missing-member'
  | 'fixed-equipment' | 'invalid-item' | 'no-available-item' | 'last-weapon' | 'save-failed' | 'no-op'
export interface TownEquipmentSummary { equipped: number; upgraded: number; unchanged: number; insufficient: number; ineligible: number }
export interface TownEquipmentResult {
  changed: boolean; profile: CareerProfile; reason?: TownEquipmentFailure; changedActorIds: string[]; summary: TownEquipmentSummary
}
export function townEquipmentSquads(profile: CareerProfile): TownEquipmentSquad[] {
  return [...commanderGateDefenseSlots().map(squad => ({ id: squad.squadId, name: commanderTownSquadLabel(squad.squadId)!, actorIds: [...squad.actorIds] })),
    { id: 'personal' as const, name: commanderTownSquadLabel('personal')!, actorIds: (profile.personalSquad?.members ?? []).map(member => member.id) },
    { id: 'civilian' as const, name: commanderTownSquadLabel('civilian')!, actorIds: [...Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'merchant'] }]
}
export function careerEquipmentCategory(itemId: string): BulkEquipmentCategory | undefined {
  if (['horse', 'corgi', 'black-cat'].includes(itemId)) return 'mount'
  const item = WEAPONS[itemId]
  if (!item) return undefined
  if (item.type === 'ranged') return item.combatKind === 'bow' ? 'bow' : undefined
  if (item.type !== 'melee') return undefined
  if (item.combatKind === 'lance') return 'spear'
  if (item.animationKind === 'axe') return 'axe'
  return item.combatKind === 'sword' ? 'sword' : undefined
}
export function canManageCareerEquipment(profile: CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId): TownEquipmentFailure | undefined {
  return managementGate(profile, context, target)
    ?? (townEquipmentSquads(profile).some(squad => squad.id === target) ? undefined : 'missing-member')
}
/** Membership is checked by callers that already resolved the target squad. */
function managementGate(profile: CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId): TownEquipmentFailure | undefined {
  if (target === 'personal' ? !canRecruitPersonalSquad(profile) : profile.rank !== 'commander') return 'rank-locked'
  if (context.townFaction !== profile.faction) return 'enemy-town'
  if (!context.peaceful || profile.townEvent?.state === 'hostile') return 'not-safe'
  if (profile.activeMission || profile.activeOutpostMission) return 'mission-active'
  if (target === 'personal' && context.personalState !== 'RESERVE') return 'not-reserve'
  return undefined
}
function emptySummary(): TownEquipmentSummary { return { equipped: 0, upgraded: 0, unchanged: 0, insufficient: 0, ineligible: 0 } }
function fail(profile: CareerProfile, reason: TownEquipmentFailure, summary = emptySummary()): TownEquipmentResult {
  return { changed: false, profile, reason, changedActorIds: [], summary }
}
function refEqual(a: TownEquipmentRef | null, b: TownEquipmentRef | null): boolean {
  return a?.itemId === b?.itemId && a?.source === b?.source && a?.nativeId === b?.nativeId
}
function memberRefs(profile: CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId, actorId: string): TownEquipmentRefs {
  if (target !== 'personal') return resolveTownActorEquipment(profile, context.townFaction, actorId).refs
  const equipment = profile.personalSquad!.members.find(member => member.id === actorId)!.equipment!
  return Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => [slot, equipment[slot] ? { itemId: equipment[slot], source: 'inventory' } : null])) as TownEquipmentRefs
}
function memberFixed(profile: CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId, actorId: string, slot: PersonalEquipmentSlot): boolean {
  if (target === 'personal') return false
  const member = resolveTownActorEquipment(profile, context.townFaction, actorId)
  return member.readOnly || member.fixedWeapons && slot !== 'mount' || Boolean(member.spec.eagle && slot === 'mount')
}
function writeRefs(profile: CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId, actorId: string, refs: TownEquipmentRefs): void {
  if (target === 'personal') {
    profile.personalSquad!.members.find(member => member.id === actorId)!.equipment = {
      melee: refs.melee?.itemId ?? null, ranged: refs.ranged?.itemId ?? null, shield: refs.shield?.itemId ?? null,
      mount: (refs.mount?.itemId ?? null) as PlayerMountId | null,
    }
    return
  }
  profile.townEquipment ??= {}
  const state = profile.townEquipment[context.townFaction] ??= { version: 1, actors: {}, nativeReserve: [], residentEquipmentVersion: 1 }
  state.actors[actorId] = refs
}
/** Persist every native token either at one holder or in the same authored Squad's reserve. */
function rebuildNativeReserve(profile: CareerProfile, faction: CareerProfile['faction']): void {
  const state = profile.townEquipment?.[faction]
  if (!state) return
  const held = new Set<string>()
  const resolveRefs = createTownEquipmentRefsResolver(profile, faction)
  for (const spec of townEquipmentActorSpecs(faction)) if (townEquipmentSquadForActor(spec.id) !== undefined || spec.eagle) {
    for (const ref of Object.values(resolveRefs(spec))) if (ref?.source === 'native') held.add(ref.nativeId!)
  }
  state.nativeReserve = townNativeItems(faction).filter(item => !held.has(item.nativeId) && !state.soldNativeIds?.includes(item.nativeId)).map(item => item.nativeId).sort(naturalActorCompare)
}
function validateStaged(next: CareerProfile, context: TownEquipmentContext): void {
  rebuildNativeReserve(next, context.townFaction)
  normalizeCareerInventory(next)
}
function finish(current: CareerProfile, next: CareerProfile, ids: string[], summary: TownEquipmentSummary,
  save: (profile: CareerProfile) => boolean): TownEquipmentResult {
  if (!ids.length) return fail(current, 'no-op', summary)
  try { if (!save(next)) return fail(current, 'save-failed', { ...summary, equipped: 0, upgraded: 0 }) }
  catch { return fail(current, 'save-failed', { ...summary, equipped: 0, upgraded: 0 }) }
  return { changed: true, profile: next, changedActorIds: ids.sort(naturalActorCompare), summary }
}
export function changeTownEquipment(read: () => CareerProfile, context: TownEquipmentContext, actorId: string,
  slot: PersonalEquipmentSlot, itemId: string | null, save: (profile: CareerProfile) => boolean): TownEquipmentResult {
  const current = read(), authored = townEquipmentSquadForActor(actorId)
  // Reuse fixed membership without rebuilding the full positioned town roster.
  // Keep the same military, personal, civilian precedence as townEquipmentSquads.
  const target = typeof authored === 'number' ? authored as SquadId
    : current.personalSquad?.members.some(member => member.id === actorId) ? 'personal' : authored
  if (target === undefined) return fail(current, 'missing-member')
  const gate = managementGate(current, context, target)
  if (gate) return fail(current, gate)
  if (!context.safeActorIds.has(actorId)) return fail(current, 'not-safe')
  if (!TOWN_EQUIPMENT_SLOTS.includes(slot)) return fail(current, 'invalid-item')
  if (memberFixed(current, context, target, actorId, slot)) return fail(current, 'fixed-equipment')
  if (actorId === 'merchant' && slot === 'mount' && itemId !== null && itemId !== 'horse') return fail(current, 'invalid-item')
  if (itemId !== null && (typeof itemId !== 'string' || !itemId)) return fail(current, 'invalid-item')
  const item = itemId ? WEAPONS[itemId] ?? ARMORS[itemId] : undefined
  if (itemId && (slot === 'mount' ? !(PLAYER_MOUNT_IDS as readonly string[]).includes(itemId) || target !== 'personal' && itemId === 'xongkoro'
    : !item || item.type !== slot)) return fail(current, 'invalid-item')
  const next = cloneCareerProfile(current)
  try { normalizeCareerInventory(next) } catch { return fail(current, 'invalid-item') }
  const refs = memberRefs(next, context, target, actorId), previous = refs[slot]
  if ((previous?.itemId ?? null) === itemId) return fail(current, 'no-op')
  if (itemId && availableCareerItem(next, itemId) < 1) return fail(current, 'no-available-item')
  const ref: TownEquipmentRef | null = itemId ? { itemId, source: 'inventory' } : null
  if (ref && townEquipmentRefTier(current, ref, context.townFaction) > getCareerPurchaseTier(current.rank)) return fail(current, 'rank-locked')
  refs[slot] = ref
  if (target !== 'civilian' && !refs.melee && !refs.ranged) return fail(current, 'last-weapon')
  writeRefs(next, context, target, actorId, refs)
  try { validateStaged(next, context) } catch { return fail(current, 'invalid-item') }
  return finish(current, next, [actorId], { ...emptySummary(), equipped: 1,
    upgraded: townEquipmentRefTier(current, ref, context.townFaction) > townEquipmentRefTier(current, previous, context.townFaction) ? 1 : 0 }, save)
}
export function bulkCareerEquipment(read: () => CareerProfile, context: TownEquipmentContext, target: TownEquipmentSquadId,
  category: BulkEquipmentCategory, save: (profile: CareerProfile) => boolean): TownEquipmentResult {
  const current = read(), gate = managementGate(current, context, target)
  if (gate) return fail(current, gate)
  const squad = townEquipmentSquads(current).find(squad => squad.id === target)
  if (!squad) return fail(current, 'missing-member')
  if (!['bow', 'sword', 'axe', 'spear', 'mount'].includes(category)) return fail(current, 'invalid-item')
  const next = cloneCareerProfile(current)
  try { normalizeCareerInventory(next) } catch { return fail(current, 'invalid-item') }
  const slot: PersonalEquipmentSlot = category === 'bow' ? 'ranged' : category === 'mount' ? 'mount' : 'melee'
  const actorIds = squad.actorIds.filter(id => context.safeActorIds.has(id) && !memberFixed(next, context, target, id, slot)).sort(naturalActorCompare)
  const summary = { ...emptySummary(), ineligible: squad.actorIds.length - actorIds.length }
  if (!actorIds.length) return fail(current, 'not-safe', summary)
  const before = new Map(actorIds.map(id => [id, memberRefs(next, context, target, id)]))
  const refsByKey = new Map<string, TownEquipmentRef | null>(), candidates: BulkEquipmentCandidate[] = []
  const add = (key: string, ref: TownEquipmentRef | null, holderId?: string) => {
    refsByKey.set(key, ref)
    candidates.push({ key, itemId: ref?.itemId ?? null, tier: townEquipmentRefTier(next, ref, context.townFaction), holderId,
      requested: Boolean(ref && careerEquipmentCategory(ref.itemId) === category) })
  }
  for (const actorId of actorIds) add(`current/${actorId}`, before.get(actorId)![slot], actorId)
  for (const itemId of Object.keys(careerItemTotals(next)).sort(naturalActorCompare)) {
    if (careerEquipmentCategory(itemId) !== category) continue
    for (let copy = 0; copy < Math.min(actorIds.length, availableCareerItem(next, itemId)); copy++) add(`stock/${itemId}/${copy}`, { itemId, source: 'inventory' })
  }
  if (target !== 'personal') {
    const reserve = new Set(next.townEquipment?.[context.townFaction]?.nativeReserve ?? [])
    for (const item of townNativeItems(context.townFaction)) if (item.squadId === target && reserve.has(item.nativeId) && careerEquipmentCategory(item.itemId) === category) {
      add(`reserve/${item.nativeId}`, { itemId: item.itemId, source: 'native', nativeId: item.nativeId })
    }
  }
  const finalRefs = (actorId: string, candidate: BulkEquipmentCandidate): TownEquipmentRefs => {
    const refs = { ...before.get(actorId)!, [slot]: refsByKey.get(candidate.key)! }
    return refs
  }
  const effectiveTier = (refs: TownEquipmentRefs) => slot === 'mount'
    ? townEquipmentRefTier(next, refs.mount, context.townFaction) : townEquipmentWeaponTier(next, refs, context.townFaction)
  const actors = actorIds.map(actorId => ({ actorId, tier: effectiveTier(before.get(actorId)!), currentKey: `current/${actorId}`,
    currentRequested: Boolean(before.get(actorId)![slot] && careerEquipmentCategory(before.get(actorId)![slot]!.itemId) === category) }))
  const actorsById = new Map(actors.map(actor => [actor.actorId, actor]))
  const resultTier = (actor: BulkEquipmentActor, candidate: BulkEquipmentCandidate) => effectiveTier(finalRefs(actor.actorId, candidate))
  if (!candidates.some(candidate => candidate.requested)) { summary.insufficient = actorIds.length; return fail(current, 'no-available-item', summary) }
  const accepts = (actor: BulkEquipmentActor, candidate: BulkEquipmentCandidate) => {
    if (candidate.holderId === actor.actorId) return true
    if (!candidate.requested || actor.actorId === 'merchant' && candidate.itemId !== 'horse') return false
    // Both the changed slot and the resulting active weapon must retain their previous tiers.
    return candidate.tier >= townEquipmentRefTier(next, before.get(actor.actorId)![slot], context.townFaction)
      && candidate.tier <= getCareerPurchaseTier(current.rank)
  }
  const plan = planBulkEquipment(actors, candidates, accepts, resultTier)
  const changed: string[] = []
  for (const assignment of plan) {
    const previous = before.get(assignment.actorId)!, proposed = refsByKey.get(assignment.candidate.key)!
    if (refEqual(previous[slot], proposed)) { summary.unchanged++; continue }
    const refs = finalRefs(assignment.actorId, assignment.candidate)
    writeRefs(next, context, target, assignment.actorId, refs)
    changed.push(assignment.actorId); summary.equipped++
    const actor = actorsById.get(assignment.actorId)!
    if (resultTier(actor, assignment.candidate) > actor.tier) summary.upgraded++
  }
  summary.insufficient = plan.filter(assignment => {
    if (changed.includes(assignment.actorId)) return false
    const actor = actorsById.get(assignment.actorId)!
    return candidates.some(candidate => candidate.requested && accepts(actor, candidate) && resultTier(actor, candidate) >= actor.tier
      && (resultTier(actor, candidate) > actor.tier || candidate.tier > assignment.candidate.tier
        || candidate.tier === assignment.candidate.tier && !assignment.candidate.requested))
  }).length
  try { validateStaged(next, context) } catch { return fail(current, 'invalid-item', summary) }
  return finish(current, next, changed, summary, save)
}
