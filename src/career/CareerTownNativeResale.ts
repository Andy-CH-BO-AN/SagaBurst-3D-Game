import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { normalizeCareerInventory } from './CareerInventory'
import { createTownEquipmentRefsResolver, isResalableTownNativeItem, townEquipmentActorSpecs, townEquipmentSquadForActor, townNativeItems } from './CareerTownEquipmentState'
import { TOWN_PRODUCTS, townResalePrice, type TownProduct } from '../town/TownRules'

export interface TownNativeSaleContext {
  townFaction: CareerProfile['faction']; peaceful: boolean; playerAlive: boolean; merchantAvailable: boolean
}
export type TownNativeSaleFailure = 'rank-locked' | 'enemy-town' | 'not-safe' | 'mission-active' | 'invalid-token' | 'invalid-quantity' | 'save-failed'
export interface TownNativeSaleResult {
  sold: boolean; profile: CareerProfile; soldCount: number; earnedMerit: number; reason?: TownNativeSaleFailure
}
export interface TownNativeSaleRequest { itemId: string; quantity: number }
export interface TownNativeSaleStock { product: TownProduct; nativeIds: string[]; price: number }

export function townNativeSaleGate(profile: CareerProfile, context: TownNativeSaleContext): TownNativeSaleFailure | undefined {
  if (profile.rank !== 'commander') return 'rank-locked'
  if (profile.faction !== context.townFaction) return 'enemy-town'
  if (!context.peaceful || !context.playerAlive || !context.merchantAvailable || profile.townEvent?.state === 'hostile') return 'not-safe'
  if (profile.activeMission || profile.activeOutpostMission) return 'mission-active'
  return undefined
}

function nativeHolders(profile: CareerProfile, faction: CareerProfile['faction']): Set<string> {
  const held = new Set<string>()
  const resolveRefs = createTownEquipmentRefsResolver(profile, faction)
  for (const spec of townEquipmentActorSpecs(faction)) {
    if (townEquipmentSquadForActor(spec.id) === undefined && !spec.eagle) continue
    for (const ref of Object.values(resolveRefs(spec))) {
      if (ref?.source === 'native') held.add(ref.nativeId!)
    }
  }
  return held
}
function validateNativeOwnership(profile: CareerProfile, faction: CareerProfile['faction']): void {
  const state = profile.townEquipment?.[faction], held = nativeHolders(profile, faction)
  const all = [...held, ...(state?.nativeReserve ?? []), ...(state?.soldNativeIds ?? [])]
  // The schema validator already authenticates IDs; this also rejects missing token ownership.
  if (all.length !== new Set(all).size || all.length !== townNativeItems(faction, state).length) throw new Error('Invalid native ownership')
}
/** Only catalog-priced, idle native weapons and shields; inventory quantities stay separate. */
export function townNativeSaleStock(profile: CareerProfile, faction: CareerProfile['faction']): TownNativeSaleStock[] {
  const state = profile.townEquipment?.[faction], reserve = new Set(state?.nativeReserve ?? []), sold = new Set(state?.soldNativeIds ?? [])
  const held = nativeHolders(profile, faction)
  const stock = new Map<string, TownNativeSaleStock>()
  for (const item of townNativeItems(faction, state)) {
    if (!reserve.has(item.nativeId) || sold.has(item.nativeId) || held.has(item.nativeId) || !isResalableTownNativeItem(faction, item)) continue
    const product = TOWN_PRODUCTS.find(product => product.id === item.itemId && product.category !== 'mount')
    const price = townResalePrice(profile, item.itemId)
    if (!product || !Number.isSafeInteger(product.price) || product.price <= 0 || !Number.isSafeInteger(price) || price <= 0) continue
    const entry: TownNativeSaleStock = stock.get(item.itemId) ?? { product, nativeIds: [], price }
    entry.nativeIds.push(item.nativeId); stock.set(item.itemId, entry)
  }
  return [...stock.values()].map(entry => ({ ...entry, nativeIds: entry.nativeIds.sort() })).sort((a, b) => a.product.id.localeCompare(b.product.id))
}

/** Read live state, stage the entire sale, and publish only after one durable save. */
function transact(read: () => CareerProfile, context: () => TownNativeSaleContext,
  select: (stock: TownNativeSaleStock[]) => readonly string[] | undefined,
  save: (profile: CareerProfile) => boolean): TownNativeSaleResult {
  const current = read(), live = context()
  const fail = (reason: TownNativeSaleFailure): TownNativeSaleResult => ({ sold: false, profile: current, soldCount: 0, earnedMerit: 0, reason })
  const gate = townNativeSaleGate(current, live)
  if (gate) return fail(gate)
  let next: CareerProfile, ids: readonly string[], earnedMerit = 0
  try {
    next = cloneCareerProfile(current)
    normalizeCareerInventory(next)
    validateNativeOwnership(next, live.townFaction)
    const stock = townNativeSaleStock(next, live.townFaction), selected = select(stock)
    if (!selected?.length || new Set(selected).size !== selected.length) return fail('invalid-token')
    ids = selected
    const tokens = new Map(stock.flatMap(entry => entry.nativeIds.map(id => [id, entry.price] as const)))
    for (const id of ids) {
      const price = tokens.get(id)
      if (price === undefined) return fail('invalid-token')
      earnedMerit += price
    }
    if (!Number.isSafeInteger(earnedMerit) || !Number.isSafeInteger(next.availableMerit + earnedMerit)) return fail('invalid-quantity')
    const state = next.townEquipment![live.townFaction]!, consumed = new Set(ids)
    state.nativeReserve = state.nativeReserve.filter(id => !consumed.has(id))
    state.soldNativeIds = [...(state.soldNativeIds ?? []), ...ids].sort()
    next.availableMerit += earnedMerit
    normalizeCareerInventory(next)
    validateNativeOwnership(next, live.townFaction)
  } catch { return fail('invalid-token') }
  try { if (!save(next)) return fail('save-failed') } catch { return fail('save-failed') }
  return { sold: true, profile: next, soldCount: ids.length, earnedMerit }
}

/** Explicit token requests reject duplicates, foreign tokens, active holders, and partial batches. */
export function sellTownNativeEquipment(read: () => CareerProfile, context: () => TownNativeSaleContext,
  nativeIds: readonly string[], save: (profile: CareerProfile) => boolean): TownNativeSaleResult {
  return transact(read, context, () => nativeIds, save)
}

/** Select canonical native IDs in stable order, rechecking quantity at the moment of sale. */
export function sellTownNativeProducts(read: () => CareerProfile, context: () => TownNativeSaleContext,
  requests: readonly TownNativeSaleRequest[], save: (profile: CareerProfile) => boolean): TownNativeSaleResult {
  return transact(read, context, stock => {
    if (new Set(requests.map(request => request.itemId)).size !== requests.length) return undefined
    const ids: string[] = []
    for (const request of requests) {
      const entry = stock.find(entry => entry.product.id === request.itemId)
      if (!entry || !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > entry.nativeIds.length) return undefined
      ids.push(...entry.nativeIds.slice(0, request.quantity))
    }
    return ids
  }, save)
}
