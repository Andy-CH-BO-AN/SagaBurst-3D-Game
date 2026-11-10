import { isAutonomousTownGuard } from '../town/TownNativeGuardIdentity'
import { hrOfficerSpec } from '../town/TownHRLayout'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'
import type { PersonalEquipmentSlot } from './CareerInventory'
import type { CareerProfile } from './CareerProfile'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { townRoster, withTownCommandSquadRoster, townMilitaryEquipment, townActorHeroProfile, townDeploymentTokenLoadout, CIVILIAN_PROFILE, type TownActorSpec } from '../town/TownRules'
import { townCommanderSpec, TOWN_COMMANDER_MOUNT_ID } from '../town/TownCommanderIdentity'
import { eagleTrainerSpec } from '../town/TownEagleTrainingGround'
import { defaultRangerMeleeWeaponId, WEAPONS, T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { townMerchantLoadout } from '../town/TownMerchantEquipment'
import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'

export const TOWN_EQUIPMENT_SLOTS = ['melee', 'ranged', 'shield', 'mount'] as const
export interface TownEquipmentRef { itemId: string; source: 'inventory' | 'native'; nativeId?: string }
export type TownEquipmentRefs = Record<PersonalEquipmentSlot, TownEquipmentRef | null>
export interface CareerTownEquipmentState {
  version: 1; actors: Record<string, TownEquipmentRefs>; nativeReserve: string[]
  /** Version 1 extension: absent in old saves, permanently excludes sold tokens from every owner. */
  soldNativeIds?: string[]
  /** Missing only in saves preceding resident native weapons; never reissue after migration. */
  residentEquipmentVersion?: 1
  /** Pins the one Commander token's species after migration, including transfers/reserve/sales. */
  commanderShieldItemId?: 'paladin_shield_t4' | 'commander_shield_t5' | 'viking_berserker_shield_t5'
  /** Present only for newly created catalogues; old native T4 shield tokens retain their species. */
  factionShieldVersion?: 1
  /** Absent only in saves preceding the mounted T5 deployment officer; its mount token is issued to its holder once on load. */
  deploymentMountVersion?: 1
}
export type CareerTownEquipment = Partial<Record<CharacterFaction, CareerTownEquipmentState>>
export interface TownNativeItem { nativeId: string; itemId: string; actorId: string; slot: PersonalEquipmentSlot; squadId: number | 'civilian' | 'autonomous'; tier: number }
export interface ResolvedTownActorEquipment {
  spec: TownActorSpec; loadout: UnitLoadout; refs: TownEquipmentRefs; tier: 1 | 2 | 3 | 4; mountTier: number
  fixedWeapons: boolean; readOnly: boolean
}
const specCache = new Map<CharacterFaction, TownActorSpec[]>()
const nativeCache = new Map<CharacterFaction, { current: TownNativeItem[]; variants: Map<string, TownNativeItem[]> }>()
let squadCache: Map<string, number | 'civilian'> | undefined
let legacySquadCache: Map<string, number> | undefined
const slotKeys = { melee: 'meleeWeaponId', ranged: 'rangedWeaponId', shield: 'shieldId', mount: 'mountId' } as const
function nativeShieldId(actorId: string, current: string | null | undefined,
  state?: Pick<CareerTownEquipmentState, 'commanderShieldItemId' | 'factionShieldVersion'>): string | null | undefined {
  if (!state) return current
  if (actorId === 'commander') return state.commanderShieldItemId ?? 'commander_shield_t5'
  return !state.factionShieldVersion && current === 'roman_officer_shield_t4' ? 'paladin_shield_t4' : current
}
export function townEquipmentActorSpecs(faction: CharacterFaction): TownActorSpec[] {
  let specs = specCache.get(faction)
  if (!specs) {
    const roster = townRoster().filter(spec => spec.duty !== 'watchtower_guard')
    // Equipment identities and squad membership share the same authored roster.
    // Avoid constructing a second garrison/housing layout just to obtain its IDs.
    squadCache ??= new Map<string, number | 'civilian'>([...commanderGateDefenseSlots(roster).flatMap(squad => squad.actorIds.map(id => [id, squad.squadId] as const)),
      ...Array.from({ length: 20 }, (_, i) => [`civilian-${i}`, 'civilian'] as const), ['merchant', 'civilian']])
    legacySquadCache ??= new Map(commanderGateDefenseSlots(roster, 1).flatMap(squad => squad.actorIds.map(id => [id, squad.squadId] as const)))
    specs = [...withTownCommandSquadRoster(faction, roster),
      hrOfficerSpec({ officer: { x: 0, z: 0, yaw: 0 } }), townCommanderSpec({ x: 0, z: 0, yaw: 0 }), eagleTrainerSpec({ site: { x: 0, z: 0, yaw: 0 }, trainer: { x: 0, z: 0, yaw: 0 }, pads: [] })]; specCache.set(faction, specs) }
  return specs
}
export function townEquipmentSquadForActor(actorId: string): number | 'civilian' | undefined {
  if (!squadCache) townEquipmentActorSpecs('roman')
  return squadCache!.get(actorId)
}
export function townDefaultActorLoadout(faction: CharacterFaction, spec: TownActorSpec): UnitLoadout {
  if (spec.role === 'merchant') return townMerchantLoadout()
  if (spec.role === 'civilian') return { meleeWeaponId: CIVILIAN_PROFILE.retaliationWeapon, rangedWeaponId: null, shieldId: null, mountId: null }
  if (spec.role === 'cat') return { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null }
  if (spec.role === 'ranger' || spec.role === 'eagle-trainer') return { meleeWeaponId: defaultRangerMeleeWeaponId(faction), rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: spec.role === 'ranger' ? 'black-cat' : null, reversibleRangedSwitch: true }
  if (spec.role === 'deployment') return townDeploymentTokenLoadout(faction)
  const military = townMilitaryEquipment(faction, spec), hero = townActorHeroProfile(faction, spec)
  if (spec.role === 'commander') return { ...military.loadout, mountId: spec.mounted ? TOWN_COMMANDER_MOUNT_ID : null }
  return { ...military.loadout, mountId: spec.eagle ? 'xongkoro' : spec.mounted ? hero?.mountOverride ?? military.loadout.mountId ?? 'horse' : null }
}
export function townNativeItems(faction: CharacterFaction, state?: Pick<CareerTownEquipmentState, 'commanderShieldItemId' | 'factionShieldVersion'>): TownNativeItem[] {
  let cached = nativeCache.get(faction)
  if (!cached) {
    const items = townEquipmentActorSpecs(faction).flatMap(spec => {
      const squadId = isAutonomousTownGuard(spec.id) ? 'autonomous' as const : townEquipmentSquadForActor(spec.id)
      if (squadId === undefined) return []
      const loadout = townDefaultActorLoadout(faction, spec)
      return TOWN_EQUIPMENT_SLOTS.flatMap(slot => {
        const itemId = loadout[slotKeys[slot]]
        if (!itemId) return []
        return [{ nativeId: `${faction}/${spec.id}/${slot}`, itemId, actorId: spec.id, slot, squadId,
          tier: slot === 'mount' ? itemId === TOWN_COMMANDER_MOUNT_ID ? 5 : itemId === 'horse' ? 1 : 4 : (WEAPONS[itemId] ?? ARMORS[itemId]).tier }]
      })
    })
    cached = { current: items, variants: new Map() }
    nativeCache.set(faction, cached)
  }
  // A historical catalogue is a lazy variant of this faction's canonical cache,
  // never a mutation of its current items or a second independently owned map.
  if (!state) return cached.current
  const commander = state.commanderShieldItemId ?? 'commander_shield_t5'
  const key = `${commander}/${state.factionShieldVersion ?? 0}`
  let variant = cached.variants.get(key)
  if (!variant) {
    variant = cached.current.map(item => {
      const itemId = item.slot === 'shield' ? nativeShieldId(item.actorId, item.itemId, state)! : item.itemId
      return itemId === item.itemId ? item : { ...item, itemId, tier: ARMORS[itemId].tier }
    })
    cached.variants.set(key, variant)
  }
  return variant
}
/** Protected native service gear and mounts never participate in merchant resale. */
export function isResalableTownNativeItem(faction: CharacterFaction, item: TownNativeItem): boolean {
  const spec = townEquipmentActorSpecs(faction).find(actor => actor.id === item.actorId)
  return item.slot !== 'mount' && Boolean(spec && !isAutonomousTownGuard(spec.id) && !['merchant', 'ranger', 'eagle-trainer'].includes(spec.role))
}
export function townEquipmentRefTier(profile: Pick<CareerProfile, 'rank' | 'townEquipment'>, ref: TownEquipmentRef | null, faction: CharacterFaction): number {
  if (!ref) return 0
  if (ref.source === 'native') return townNativeItems(faction, profile.townEquipment?.[faction]).find(item => item.nativeId === ref.nativeId)?.tier ?? 0
  return (WEAPONS[ref.itemId] ?? ARMORS[ref.itemId])?.tier ?? (ref.itemId === TOWN_COMMANDER_MOUNT_ID ? 5 : ref.itemId === 'horse' ? ['captain', 'commander'].includes(profile.rank) ? 4 : profile.rank === 'veteran' ? 3 : profile.rank === 'soldier' ? 2 : 1 : 4)
}
/** Active weapons use the same ranged-first tier as permanent NPC loadouts. */
export function townEquipmentWeaponTier(profile: Pick<CareerProfile, 'rank' | 'townEquipment'>, refs: TownEquipmentRefs, faction: CharacterFaction): number {
  return townEquipmentRefTier(profile, refs.ranged ?? refs.melee, faction)
}
export function resolveTownActorEquipment(profile: CareerProfile, faction: CharacterFaction, actorId: string): ResolvedTownActorEquipment {
  const spec = townEquipmentActorSpecs(faction).find(actor => actor.id === actorId)
  if (!spec) throw new Error('Unknown town actor')
  const base = townDefaultActorLoadout(faction, spec)
  const refs = createTownEquipmentRefsResolver(profile, faction)(spec, base)
  // Non-managed residents and fixed identities keep their authored equipment.
  const managed = townEquipmentSquadForActor(actorId) !== undefined || Boolean(profile.townEquipment?.[faction]?.actors[actorId])
  const held = managed ? { ...base, ...Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => [slotKeys[slot], refs[slot]?.itemId ?? null])) } : base
  const loadout = spec.role === 'deployment' ? deploymentClassLoadout(faction, base, refs, held) : held
  return { spec, refs, loadout, tier: Math.min(4, townEquipmentWeaponTier(profile, refs, faction) || 1) as 1 | 2 | 3 | 4, mountTier: townEquipmentRefTier(profile, refs.mount, faction),
    fixedWeapons: spec.role === 'merchant', readOnly: isAutonomousTownGuard(actorId) }
}
/** The deployment officer's T5 heavy cavalry weapon and shield replace only the slots still holding their untouched native default
 * token, so a Commander's own purchases and transfers always win and no weapon or shield token changes identity. Its class mount
 * is a native token like any other and follows token ownership. */
function deploymentClassLoadout(faction: CharacterFaction, base: UnitLoadout, refs: TownEquipmentRefs, held: UnitLoadout): UnitLoadout {
  const kit = townMilitaryEquipment(faction, 'deployment').loadout
  const next = { ...held }
  for (const slot of ['melee', 'shield'] as const) {
    const ref = refs[slot], key = slotKeys[slot]
    if (ref?.source === 'native' && ref.nativeId === `${faction}/deployment/${slot}` && ref.itemId === base[key]) next[key] = kit[key]
  }
  return next
}
/** Evaluation view of a resolved actor's refs: untouched deployment class-kit slots carry the weapon/shield it actually wields,
 * so tier and category decisions see T5 lance and shield. It is never persisted or transferable; ownership stays with the tokens. */
export function effectiveTownRefs(resolved: Pick<ResolvedTownActorEquipment, 'refs' | 'loadout'>): TownEquipmentRefs {
  const refs = { ...resolved.refs }
  for (const slot of ['melee', 'shield'] as const) {
    const ref = refs[slot], itemId = resolved.loadout[slotKeys[slot]]
    if (ref && itemId && ref.itemId !== itemId) refs[slot] = { itemId, source: 'inventory' }
  }
  return refs
}
/** One read-only scan of current ownership. Recreate after any state write/parse;
 * returned refs remain independent mutable copies for equipment transactions. */
export function createTownEquipmentRefsResolver(profile: CareerProfile, faction: CharacterFaction) {
  const state = profile.townEquipment?.[faction]
  const assigned = new Set(Object.values(state?.actors ?? {}).flatMap(refs => Object.values(refs).flatMap(ref => ref?.source === 'native' ? [ref.nativeId!] : [])))
  const reserve = new Set([...(state?.nativeReserve ?? []), ...(state?.soldNativeIds ?? [])])
  return (spec: TownActorSpec, base = townDefaultActorLoadout(faction, spec)): TownEquipmentRefs => {
    const saved = state?.actors[spec.id]
    return Object.fromEntries(TOWN_EQUIPMENT_SLOTS.map(slot => {
      if (saved) return [slot, saved[slot] ? { ...saved[slot] } : null]
      const nativeId = `${faction}/${spec.id}/${slot}`
      const itemId = slot === 'shield' ? nativeShieldId(spec.id, base.shieldId, state) : base[slotKeys[slot]]
      return [slot, itemId && !assigned.has(nativeId) && !reserve.has(nativeId) ? { itemId, source: 'native', nativeId } : null]
    })) as TownEquipmentRefs
  }
}
export function allocatedTownEquipment(profile: Pick<CareerProfile, 'townEquipment'>, itemId: string): number {
  return Object.values(profile.townEquipment ?? {}).reduce((count, state) => count + Object.values(state?.actors ?? {}).reduce((sum, refs) =>
    sum + Object.values(refs).filter(ref => ref?.source === 'inventory' && ref.itemId === itemId).length, 0), 0)
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
/** Authenticate provenance before changing a default; an explicit empty/inventory/foreign slot is custom. */
function unchangedCommanderNativeShield(actors: Record<string, unknown>, faction: CharacterFaction): boolean {
  const entry = actors.commander
  if (!object(entry)) return false
  const defaults = townNativeItems(faction).filter(item => item.actorId === 'commander')
  return defaults.every(item => {
    const ref = entry[item.slot]
    if (!object(ref) || ref.source !== 'native' || ref.nativeId !== item.nativeId) return false
    return ref.itemId === (item.slot === 'shield' ? 'paladin_shield_t4' : item.itemId)
      || item.slot === 'mount' && ref.itemId === (faction === 'roman' ? 'corgi' : 'black-cat')
  })
}
export function parseTownEquipment(value: unknown): CareerTownEquipment | undefined {
  if (value === undefined) return undefined
  if (!object(value) || Object.keys(value).some(key => key !== 'roman' && key !== 'viking')) throw new Error('Invalid town equipment')
  const parsed: CareerTownEquipment = {}
  for (const faction of ['roman', 'viking'] as const) {
    const raw = value[faction]
    if (raw === undefined) continue
    if (!object(raw) || raw.version !== 1 || !object(raw.actors) || !Array.isArray(raw.nativeReserve)) throw new Error('Invalid town equipment state')
    if (raw.residentEquipmentVersion !== undefined && raw.residentEquipmentVersion !== 1) throw new Error('Invalid resident equipment version')
    if (raw.commanderShieldItemId !== undefined && raw.commanderShieldItemId !== 'paladin_shield_t4'
      && raw.commanderShieldItemId !== 'commander_shield_t5' && raw.commanderShieldItemId !== 'viking_berserker_shield_t5') throw new Error('Invalid Commander shield version')
    if (raw.factionShieldVersion !== undefined && raw.factionShieldVersion !== 1) throw new Error('Invalid faction shield version')
    if (raw.deploymentMountVersion !== undefined && raw.deploymentMountVersion !== 1) throw new Error('Invalid deployment mount version')
    const legacyResidents = raw.residentEquipmentVersion === undefined
    const commanderShieldId = `${faction}/commander/shield`
    const upgradeCommanderShield = raw.commanderShieldItemId === undefined && unchangedCommanderNativeShield(raw.actors, faction)
    const legacyCommanderShield = raw.commanderShieldItemId === undefined && !upgradeCommanderShield
      && (raw.nativeReserve.includes(commanderShieldId) || Array.isArray(raw.soldNativeIds) && raw.soldNativeIds.includes(commanderShieldId)
        || Object.values(raw.actors).some(entry => object(entry) && object(entry.shield)
          && entry.shield.source === 'native' && entry.shield.nativeId === commanderShieldId && entry.shield.itemId === 'paladin_shield_t4'))
    const state: CareerTownEquipmentState = { version: 1, actors: {}, nativeReserve: [], residentEquipmentVersion: 1,
      ...(raw.factionShieldVersion === 1 ? { factionShieldVersion: 1 as const } : {}), deploymentMountVersion: 1 as const,
      commanderShieldItemId: raw.commanderShieldItemId ?? (legacyCommanderShield ? 'paladin_shield_t4' : 'commander_shield_t5') }
    const native = new Map(townNativeItems(faction, state).map(item => [item.nativeId, item]))
    const claimed = new Set<string>()
    for (const [actorId, entry] of Object.entries(raw.actors)) {
      const squadId = townEquipmentSquadForActor(actorId)
        ?? (townEquipmentActorSpecs(faction).some(spec => spec.id === actorId && spec.eagle) ? 'autonomous' : undefined)
      if (squadId === undefined || !object(entry)) throw new Error('Invalid equipment actor')
      const refs = {} as TownEquipmentRefs
      for (const slot of TOWN_EQUIPMENT_SLOTS) {
        const rawRef = entry[slot]
        if (rawRef === null) { refs[slot] = null; continue }
        if (!object(rawRef) || typeof rawRef.itemId !== 'string' || !['inventory', 'native'].includes(rawRef.source as string)) throw new Error('Invalid equipment reference')
        // Authenticate the original fixed token before upgrading its item identity.
        const legacyMerchantSword = legacyResidents && actorId === 'merchant' && slot === 'melee'
          && rawRef.source === 'native' && rawRef.nativeId === `${faction}/merchant/melee` && rawRef.itemId === 'paladin_sword_t4'
        // Only the authored Commander token changes species. Retain its holder/reserve
        // identity, and never convert an inventory purchase or another resident's mount.
        const legacyCommanderMount = slot === 'mount' && rawRef.source === 'native'
          && rawRef.nativeId === `${faction}/commander/mount`
          && rawRef.itemId === (faction === 'roman' ? 'corgi' : 'black-cat')
        const legacyCommanderShieldRef = upgradeCommanderShield && actorId === 'commander' && slot === 'shield'
          && rawRef.source === 'native' && rawRef.nativeId === commanderShieldId && rawRef.itemId === 'paladin_shield_t4'
        const itemId = legacyCommanderShieldRef ? 'commander_shield_t5' : legacyCommanderMount ? TOWN_COMMANDER_MOUNT_ID
          : legacyMerchantSword ? townMerchantLoadout().meleeWeaponId! : rawRef.itemId
        const item = WEAPONS[itemId] ?? ARMORS[itemId]
        if (slot === 'mount' ? !(PLAYER_MOUNT_IDS as readonly string[]).includes(itemId) : !item || item.type !== slot) throw new Error('Invalid equipment slot')
        if (rawRef.source === 'native') {
          const source = native.get(rawRef.nativeId as string)
          // Authored regrouping must not confiscate an existing native token shared in a legacy squad.
          const legacySameSquad = source && legacySquadCache?.has(actorId)
            && legacySquadCache.get(actorId) === legacySquadCache.get(source.actorId)
          if (!source || source.itemId !== itemId || source.slot !== slot || source.squadId !== squadId && !legacySameSquad || claimed.has(source.nativeId)) throw new Error('Invalid native equipment owner')
          claimed.add(source.nativeId); refs[slot] = { itemId, source: 'native', nativeId: source.nativeId }
        } else {
          if (rawRef.nativeId !== undefined) throw new Error('Invalid owned equipment')
          refs[slot] = { itemId, source: 'inventory' }
        }
      }
      state.actors[actorId] = refs
    }
    // Before the mounted deployment officer, an explicit configuration could only hold an empty mount for it: hand it its own
    // native token once. The token did not exist before, so it can be neither reserved, sold nor held by anyone else.
    const deploymentMount = `${faction}/deployment/mount`
    if (raw.deploymentMountVersion === undefined && state.actors.deployment && !state.actors.deployment.mount
      && native.has(deploymentMount) && !claimed.has(deploymentMount)
      && !raw.nativeReserve.includes(deploymentMount) && !(Array.isArray(raw.soldNativeIds) && raw.soldNativeIds.includes(deploymentMount))) {
      state.actors.deployment.mount = { itemId: native.get(deploymentMount)!.itemId, source: 'native', nativeId: deploymentMount }
      claimed.add(deploymentMount)
    }
    const reserve = new Set<string>()
    for (const id of raw.nativeReserve) {
      if (typeof id !== 'string' || !native.has(id) || claimed.has(id) || reserve.has(id)) throw new Error('Invalid native reserve')
      reserve.add(id); state.nativeReserve.push(id)
    }
    if (raw.soldNativeIds !== undefined) {
      if (!Array.isArray(raw.soldNativeIds)) throw new Error('Invalid sold native equipment')
      state.soldNativeIds = []
      const sold = new Set<string>()
      for (const id of raw.soldNativeIds) {
        const item = typeof id === 'string' ? native.get(id) : undefined
        if (!item || !(isResalableTownNativeItem(faction, item) || item.squadId === 'autonomous') || claimed.has(item.nativeId)
          || reserve.has(item.nativeId) || sold.has(item.nativeId)) throw new Error('Invalid sold native equipment')
        sold.add(item.nativeId); state.soldNativeIds.push(item.nativeId)
      }
    }
    // A saved configuration owns every slot, including explicit null. Retain it and
    // account for the new default token once without granting an inventory item.
    if (state.actors.commander && !claimed.has(commanderShieldId) && !reserve.has(commanderShieldId)
      && !state.soldNativeIds?.includes(commanderShieldId)) state.nativeReserve.push(commanderShieldId)
    if (legacyResidents) {
      // Older civilians had no native token. Preserve purchases, transfers and sales;
      // issue a missing token exactly once, equipping only an empty legacy melee slot.
      const sold = new Set(state.soldNativeIds ?? [])
      for (const item of native.values()) {
        if (!item.actorId.startsWith('civilian-') || item.slot !== 'melee'
          || claimed.has(item.nativeId) || reserve.has(item.nativeId) || sold.has(item.nativeId)) continue
        const refs = state.actors[item.actorId]
        if (!refs) continue // Sparse actors already resolve their own native default.
        if (!refs.melee) refs.melee = { itemId: item.itemId, source: 'native', nativeId: item.nativeId }
        else state.nativeReserve.push(item.nativeId)
      }
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
    const resolveRefs = createTownEquipmentRefsResolver(profile, faction)
    for (const spec of townEquipmentActorSpecs(faction)) {
      if (townEquipmentSquadForActor(spec.id) === undefined && !spec.eagle) continue
      const refs = resolveRefs(spec)
      if (spec.role === 'merchant') {
        const base = townDefaultActorLoadout(faction, spec)
        for (const slot of ['melee', 'ranged', 'shield'] as const) {
          const ref = refs[slot], itemId = base[slotKeys[slot]] ?? null
          if ((ref?.itemId ?? null) !== itemId || ref && (ref.source !== 'native' || ref.nativeId !== `${faction}/${spec.id}/${slot}`)) throw new Error('Changed fixed town equipment')
        }
      }
      if (spec.role === 'merchant' && refs.mount && (refs.mount.itemId !== 'horse' || refs.mount.source !== 'inventory')) throw new Error('Invalid merchant mount')
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
    ...(state!.residentEquipmentVersion ? { residentEquipmentVersion: state!.residentEquipmentVersion } : {}),
    ...(state!.commanderShieldItemId ? { commanderShieldItemId: state!.commanderShieldItemId } : {}),
    ...(state!.factionShieldVersion ? { factionShieldVersion: state!.factionShieldVersion } : {}),
    ...(state!.deploymentMountVersion ? { deploymentMountVersion: state!.deploymentMountVersion } : {}),
    ...(state!.soldNativeIds ? { soldNativeIds: [...state!.soldNativeIds] } : {}),
  }])) as CareerTownEquipment
}
