import type { CharacterFaction } from '../world/CharacterVisuals'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'
import type { PersonalEquipmentSlot } from './CareerInventory'
import type { CareerProfile } from './CareerProfile'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { townRoster, withTownCommandSquadRoster, townMilitaryEquipment, townActorHeroProfile, type TownActorSpec } from '../town/TownRules'
import { townCommanderSpec } from '../town/TownCommanderIdentity'
import { eagleTrainerSpec } from '../town/TownEagleTrainingGround'
import { WEAPONS, T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'

export const TOWN_EQUIPMENT_SLOTS = ['melee', 'ranged', 'shield', 'mount'] as const
export interface TownEquipmentRef { itemId: string; source: 'inventory' | 'native'; nativeId?: string }
export type TownEquipmentRefs = Record<PersonalEquipmentSlot, TownEquipmentRef | null>
export interface CareerTownEquipmentState { version: 1; actors: Record<string, TownEquipmentRefs>; nativeReserve: string[] }
export type CareerTownEquipment = Partial<Record<CharacterFaction, CareerTownEquipmentState>>
export interface TownNativeItem { nativeId: string; itemId: string; actorId: string; slot: PersonalEquipmentSlot; squadId: number | 'civilian'; tier: number }
export interface ResolvedTownActorEquipment {
  spec: TownActorSpec; loadout: UnitLoadout; refs: TownEquipmentRefs; tier: 1 | 2 | 3 | 4; mountTier: number
  fixedWeapons: boolean; readOnly: boolean
}
const specCache = new Map<CharacterFaction, TownActorSpec[]>()
const nativeCache = new Map<CharacterFaction, TownNativeItem[]>()
let squadCache: Map<string, number | 'civilian'> | undefined
const slotKeys = { melee: 'meleeWeaponId', ranged: 'rangedWeaponId', shield: 'shieldId', mount: 'mountId' } as const
export function townEquipmentActorSpecs(faction: CharacterFaction): TownActorSpec[] {
  let specs = specCache.get(faction)
  if (!specs) { specs = [...withTownCommandSquadRoster(faction, townRoster()), townCommanderSpec({ x: 0, z: 0, yaw: 0 }), eagleTrainerSpec({ site: { x: 0, z: 0, yaw: 0 }, trainer: { x: 0, z: 0, yaw: 0 }, pads: [] })]; specCache.set(faction, specs) }
  return specs
}
export function townEquipmentSquadForActor(actorId: string): number | 'civilian' | undefined {
  squadCache ??= new Map<string, number | 'civilian'>([...commanderGateDefenseSlots().flatMap(squad => squad.actorIds.map(id => [id, squad.squadId] as const)),
    ...Array.from({ length: 20 }, (_, i) => [`civilian-${i}`, 'civilian'] as const), ['merchant', 'civilian']])
  return squadCache.get(actorId)
}
export function townDefaultActorLoadout(faction: CharacterFaction, spec: TownActorSpec): UnitLoadout {
  if (spec.role === 'merchant') return { meleeWeaponId: 'paladin_sword_t4', secondaryMeleeWeaponId: 'paladin_mace_t4', shieldId: 'paladin_shield_t4', rangedWeaponId: null, mountId: null }
  if (spec.role === 'civilian' || spec.role === 'cat') return { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null }
  if (spec.role === 'ranger' || spec.role === 'eagle-trainer') return { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: spec.role === 'ranger' ? 'black-cat' : null }
  const military = townMilitaryEquipment(faction, spec), hero = townActorHeroProfile(faction, spec)
  return { ...military.loadout, mountId: spec.eagle ? 'xongkoro' : spec.mounted ? hero?.mountOverride ?? military.loadout.mountId ?? 'horse' : null }
}
export function townNativeItems(faction: CharacterFaction): TownNativeItem[] {
  const cached = nativeCache.get(faction)
  if (cached) return cached
  const items = townEquipmentActorSpecs(faction).flatMap(spec => {
    const squadId = townEquipmentSquadForActor(spec.id)
    if (squadId === undefined) return []
    const loadout = townDefaultActorLoadout(faction, spec)
    return TOWN_EQUIPMENT_SLOTS.flatMap(slot => {
      const itemId = loadout[slotKeys[slot]]
      if (!itemId) return []
      return [{ nativeId: `${faction}/${spec.id}/${slot}`, itemId, actorId: spec.id, slot, squadId,
        tier: slot === 'mount' ? itemId === 'horse' ? 1 : 4 : (WEAPONS[itemId] ?? ARMORS[itemId]).tier }]
    })
  })
  nativeCache.set(faction, items)
  return items
}
export function townEquipmentRefTier(profile: Pick<CareerProfile, 'rank'>, ref: TownEquipmentRef | null, faction: CharacterFaction): number {
  if (!ref) return 0
  if (ref.source === 'native') return townNativeItems(faction).find(item => item.nativeId === ref.nativeId)?.tier ?? 0
  return (WEAPONS[ref.itemId] ?? ARMORS[ref.itemId])?.tier ?? (ref.itemId === 'horse' ? ['captain', 'commander'].includes(profile.rank) ? 4 : profile.rank === 'veteran' ? 3 : profile.rank === 'soldier' ? 2 : 1 : 4)
}
/** Active weapons use the same ranged-first tier as permanent NPC loadouts. */
export function townEquipmentWeaponTier(profile: Pick<CareerProfile, 'rank'>, refs: TownEquipmentRefs, faction: CharacterFaction): number {
  return townEquipmentRefTier(profile, refs.ranged ?? refs.melee, faction)
}
export function resolveTownActorEquipment(profile: CareerProfile, faction: CharacterFaction, actorId: string): ResolvedTownActorEquipment {
  const spec = townEquipmentActorSpecs(faction).find(actor => actor.id === actorId)
  if (!spec) throw new Error('Unknown town actor')
  const base = townDefaultActorLoadout(faction, spec), state = profile.townEquipment?.[faction]
  const assigned = new Set(Object.values(state?.actors ?? {}).flatMap(refs => Object.values(refs).flatMap(ref => ref?.source === 'native' ? [ref.nativeId!] : [])))
  const reserve = new Set(state?.nativeReserve ?? [])
  const saved = state?.actors[actorId]
  const refs = Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => {
    if (saved) return [slot, saved[slot] ? { ...saved[slot] } : null]
    const itemId = base[slotKeys[slot]], nativeId = `${faction}/${actorId}/${slot}`
    return [slot, itemId && !assigned.has(nativeId) && !reserve.has(nativeId) ? { itemId, source: 'native', nativeId } : null]
  })) as TownEquipmentRefs
  // Non-managed residents and fixed identities keep their authored equipment.
  const managed = townEquipmentSquadForActor(actorId) !== undefined
  const loadout = managed ? { ...base, ...Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => [slotKeys[slot], refs[slot]?.itemId ?? null])) } : base
  return { spec, refs, loadout, tier: Math.min(4, townEquipmentWeaponTier(profile, refs, faction) || 1) as 1 | 2 | 3 | 4, mountTier: townEquipmentRefTier(profile, refs.mount, faction),
    fixedWeapons: spec.role === 'ranger' || spec.role === 'eagle-trainer', readOnly: spec.role === 'merchant' }
}
export function allocatedTownEquipment(profile: Pick<CareerProfile, 'townEquipment'>, itemId: string): number {
  return Object.values(profile.townEquipment ?? {}).reduce((count, state) => count + Object.values(state?.actors ?? {}).reduce((sum, refs) =>
    sum + Object.values(refs).filter(ref => ref?.source === 'inventory' && ref.itemId === itemId).length, 0), 0)
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
export function parseTownEquipment(value: unknown): CareerTownEquipment | undefined {
  if (value === undefined) return undefined
  if (!object(value) || Object.keys(value).some(key => key !== 'roman' && key !== 'viking')) throw new Error('Invalid town equipment')
  const parsed: CareerTownEquipment = {}
  for (const faction of ['roman', 'viking'] as const) {
    const raw = value[faction]
    if (raw === undefined) continue
    if (!object(raw) || raw.version !== 1 || !object(raw.actors) || !Array.isArray(raw.nativeReserve)) throw new Error('Invalid town equipment state')
    const native = new Map(townNativeItems(faction).map(item => [item.nativeId, item]))
    const state: CareerTownEquipmentState = { version: 1, actors: {}, nativeReserve: [] }
    const claimed = new Set<string>()
    for (const [actorId, entry] of Object.entries(raw.actors)) {
      const squadId = townEquipmentSquadForActor(actorId)
      if (squadId === undefined || !object(entry)) throw new Error('Invalid equipment actor')
      const refs = {} as TownEquipmentRefs
      for (const slot of TOWN_EQUIPMENT_SLOTS) {
        const rawRef = entry[slot]
        if (rawRef === null) { refs[slot] = null; continue }
        if (!object(rawRef) || typeof rawRef.itemId !== 'string' || !['inventory', 'native'].includes(rawRef.source as string)) throw new Error('Invalid equipment reference')
        const itemId = rawRef.itemId, item = WEAPONS[itemId] ?? ARMORS[itemId]
        if (slot === 'mount' ? !(PLAYER_MOUNT_IDS as readonly string[]).includes(itemId) : !item || item.type !== slot) throw new Error('Invalid equipment slot')
        if (rawRef.source === 'native') {
          const source = native.get(rawRef.nativeId as string)
          if (!source || source.itemId !== itemId || source.slot !== slot || source.squadId !== squadId || claimed.has(source.nativeId)) throw new Error('Invalid native equipment owner')
          claimed.add(source.nativeId); refs[slot] = { itemId, source: 'native', nativeId: source.nativeId }
        } else {
          if (rawRef.nativeId !== undefined || itemId === 'maki-ranger-bow') throw new Error('Invalid owned equipment')
          refs[slot] = { itemId, source: 'inventory' }
        }
      }
      state.actors[actorId] = refs
    }
    const reserve = new Set<string>()
    for (const id of raw.nativeReserve) {
      if (typeof id !== 'string' || !native.has(id) || claimed.has(id) || reserve.has(id)) throw new Error('Invalid native reserve')
      reserve.add(id); state.nativeReserve.push(id)
    }
    parsed[faction] = state
  }
  return parsed
}
/** Validates authored identities and effective native owners after the schema parser. */
export function validateTownEquipment(profile: CareerProfile): void {
  const parsed = parseTownEquipment(profile.townEquipment)
  if (!parsed) return
  profile.townEquipment = parsed
  for (const faction of ['roman', 'viking'] as const) {
    const state = parsed[faction]
    if (!state) continue
    const holders = new Set<string>()
    for (const spec of townEquipmentActorSpecs(faction)) {
      if (townEquipmentSquadForActor(spec.id) === undefined) continue
      const resolved = resolveTownActorEquipment(profile, faction, spec.id), { refs } = resolved
      if (refs.ranged && refs.shield) throw new Error('Incompatible town equipment')
      if (resolved.readOnly || resolved.fixedWeapons) {
        const base = townDefaultActorLoadout(faction, spec)
        for (const slot of resolved.readOnly ? TOWN_EQUIPMENT_SLOTS : ['melee', 'ranged', 'shield'] as const) {
          const ref = refs[slot], itemId = base[slotKeys[slot]] ?? null
          if ((ref?.itemId ?? null) !== itemId || ref && (ref.source !== 'native' || ref.nativeId !== `${faction}/${spec.id}/${slot}`)) throw new Error('Changed fixed town equipment')
        }
      }
      if (spec.eagle && (refs.mount?.source !== 'native' || refs.mount.nativeId !== `${faction}/${spec.id}/mount`)) throw new Error('Changed garrison eagle')
      if (refs.mount?.source === 'inventory' && refs.mount.itemId === 'xongkoro') throw new Error('Town actors cannot own private eagles')
      if (spec.role !== 'civilian' && !refs.melee && !refs.ranged) throw new Error('Unarmed town soldier')
      for (const ref of Object.values(refs)) if (ref?.source === 'native') {
        if (holders.has(ref.nativeId!)) throw new Error('Duplicate native equipment')
        holders.add(ref.nativeId!)
      }
    }
  }
}
export function cloneTownEquipment(value: CareerTownEquipment): CareerTownEquipment {
  return Object.fromEntries(Object.entries(value).map(([faction, state]) => [faction, { version: 1,
    actors: Object.fromEntries(Object.entries(state!.actors).map(([id, refs]) => [id,
      Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => [slot, refs[slot] ? { ...refs[slot] } : null]))])),
    nativeReserve: [...state!.nativeReserve],
  }])) as CareerTownEquipment
}
