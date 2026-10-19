import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { revokeRetirementTownCommandClaims } from './CareerRetirementCommand'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { TOWN_CITY } from '../town/TownLayout'
import type { TownActorSpec } from '../town/TownRules'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'
import { createTownEquipmentRefsResolver, townEquipmentActorSpecs } from './CareerTownEquipmentState'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'

export interface RetirementAssaultFormation {
  id: string
  actorIds: string[]
  source: 'town-ground' | 'town-air' | 'native-guard' | 'auxiliary'
}

/** Same authored city rectangle for walkers and every ridden mount; height is irrelevant. */
export function outsideRetirementTownCore(point: { x: number; z: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && (point.x < TOWN_CITY.minX || point.x > TOWN_CITY.maxX || point.z < TOWN_CITY.minZ || point.z > TOWN_CITY.maxZ)
}

/** Only this owner may advance the phase. The caller saves before publishing any effect. */
export function advanceCommanderRetirementToMobilizing(current: CareerProfile): CareerProfile | null {
  if (current.rank !== 'commander' || current.careerRetirement?.phase !== 'departing'
    || current.activeMission || current.activeOutpostMission || current.activeRace) return null
  const next = cloneCareerProfile(current)
  next.careerRetirement = { ...current.careerRetirement, phase: 'mobilizing' }
  return next
}

/** Save the isolated transition before any live command, refill or staging reconciliation.
 * A rejected save leaves the caller's departure checkpoint and authority untouched.
 */
export function commitCommanderRetirementToMobilizing(current: CareerProfile,
  save: (next: CareerProfile) => boolean, reconcile: () => boolean): boolean {
  const next = advanceCommanderRetirementToMobilizing(current)
  if (!next) return false
  revokeRetirementTownCommandClaims(next)
  if (!save(next)) return false
  return reconcile()
}

/** Gate membership already includes the native patrols and services. Native provenance
 * survives in the actor specs; adding a second patrol formation would double-assign them. */
export function retirementAssaultFormations(canonical: readonly Pick<TownActorSpec, 'id' | 'role'>[]): RetirementAssaultFormation[] | null {
  const expected = canonicalRetirementTownActorIds()
  const humanoids = canonical.filter(actor => expected.has(actor.id))
  const ids = new Set(humanoids.map(actor => actor.id))
  if (ids.size !== humanoids.length || ids.size !== expected.size) return null
  const formations: RetirementAssaultFormation[] = commanderGateDefenseSlots().map(squad => ({
    id: `retirement-gate:${squad.squadId}`, actorIds: [...squad.actorIds], source: 'town-ground',
  }))
  formations.push({ id: 'retirement-native-air', actorIds: TOWN_EAGLE_PAIRS.map(pair => pair.riderId), source: 'town-air' },
    { id: 'retirement-watchtower', actorIds: [...TOWN_WATCHTOWER_ARCHER_IDS], source: 'native-guard' })
  const assigned = new Set<string>()
  for (const formation of formations) for (const id of formation.actorIds) {
    if (!ids.has(id) || assigned.has(id)) return null
    assigned.add(id)
  }
  const remaining = [...ids].filter(id => !assigned.has(id)).sort()
  for (let index = 0; index < remaining.length; index += 30) formations.push({
    id: `retirement-auxiliary:${index / 30 + 1}`, actorIds: remaining.slice(index, index + 30), source: 'auxiliary',
  })
  for (const formation of formations.filter(f => f.source === 'auxiliary')) for (const id of formation.actorIds) assigned.add(id)
  return assigned.size === ids.size ? formations : null
}

export function retirementMobilizationNeedsPreparation(profile: CareerProfile): boolean {
  return profile.careerRetirement?.phase === 'mobilizing' && !profile.careerRetirement.mobilization
}

/** The authored Town population, including service identities added by the native builders. */
export function canonicalRetirementTownActorIds(): Set<string> {
  return new Set([...townEquipmentActorSpecs('roman').filter(actor => actor.role !== 'cat').map(actor => actor.id),
    ...TOWN_WATCHTOWER_ARCHER_IDS])
}

/** Existing checkpoint parser normalizes legacy records. A prepared retirement receipt
 * instead requires complete resource snapshots; missing records must never heal on reload. */
export function parseRetirementActorCheckpoints(value: unknown, ids: readonly string[]): Record<string, PersonalActorCheckpoint> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>, parsed: Record<string, PersonalActorCheckpoint> = {}
  if (Object.keys(raw).length !== ids.length) return null
  for (const id of ids) {
    const input = raw[id] as PersonalActorCheckpoint | undefined
    if (!input || !['deployed', 'dead'].includes(input.status)
      || typeof input.hp !== 'number' || !Number.isFinite(input.hp) || input.hp < 0
      || !input.position || ![input.position.x, input.position.y, input.position.z, input.position.yaw].every(Number.isFinite)
      || typeof input.ammo !== 'number' || !Number.isFinite(input.ammo) || input.ammo < 0
      || typeof input.shieldImpact !== 'number' || !Number.isFinite(input.shieldImpact) || input.shieldImpact < 0
      || (input.status === 'dead') !== (input.hp === 0)) return null
    if (input.mount && (typeof input.mount.hp !== 'number' || !Number.isFinite(input.mount.hp) || input.mount.hp < 0
      || typeof input.mount.mounted !== 'boolean' || !input.mount.position
      || ![input.mount.position.x, input.mount.position.y, input.mount.position.z, input.mount.position.yaw].every(Number.isFinite))) return null
    const member = parseCommandActorCheckpoint(input)
    if (!member || input.mount && !member.mount || input.mount?.flight && !member.mount?.flight
      || input.fall && !member.fall || input.formation && (!member.formation
        || ![input.formation.position.x, input.formation.position.y, input.formation.position.z, input.formation.position.yaw].every(Number.isFinite))) return null
    parsed[id] = member
  }
  return parsed
}

export function hasCompleteRetirementMobilizationCheckpoint(profile: CareerProfile): boolean {
  try { return validMobilizationCheckpoint(profile) } catch { return false }
}

function validMobilizationCheckpoint(profile: CareerProfile): boolean {
  if (!profile.careerRetirement?.mobilization) return true
  const groundIds = commanderGateDefenseSlots().flatMap(squad => squad.actorIds)
  const civilians = townEquipmentActorSpecs(profile.faction).filter(spec => spec.role === 'civilian' || spec.role === 'merchant').map(spec => spec.id)
  const ground = profile.townCommandSquad, civil = profile.civilianCommandSquad
  const eagle = profile.townEagleGarrisons?.[profile.faction]
  const equipment = createTownEquipmentRefsResolver(profile, profile.faction)
  const mounted = new Set(townEquipmentActorSpecs(profile.faction).filter(spec => equipment(spec).mount).map(spec => spec.id))
  return Boolean(ground && !ground.authorized && ground.commandRank === 'commander'
    && ground.sceneKey === 'town-home' && ground.townFaction === profile.faction
    && ground.actorIds.length === groundIds.length && groundIds.every(id => ground.actorIds.includes(id))
    && ground.squads?.length === 8 && commanderGateDefenseSlots().every(expected => {
      const saved = ground.squads!.find(squad => squad.squadId === expected.squadId)
      return saved?.actorIds.length === expected.actorIds.length && expected.actorIds.every((id, index) => saved.actorIds[index] === id)
    })
    && !ground.commandedActorIds?.length && !ground.refittingActorIds?.length && !Object.keys(ground.nativeReturnStates ?? {}).length
    && parseRetirementActorCheckpoints(ground.members, groundIds)
    && civil && civil.sceneKey === `town:${profile.faction}` && civil.townFaction === profile.faction
    && civil.actorIds.length === civilians.length && civilians.every(id => civil.actorIds.includes(id) && civil.owners[id] === 'daily')
    && parseRetirementActorCheckpoints(civil.members, civilians)
    && parseRetirementActorCheckpoints(profile.retirementTowerGuards, TOWN_WATCHTOWER_ARCHER_IDS)
    && [...groundIds, ...civilians].every(id => {
      const member = ground.members?.[id] ?? civil.members[id] ?? profile.retirementTowerGuards?.[id]
      return Boolean(member?.mount) === mounted.has(id)
    })
    && eagle?.sceneKey === `town:${profile.faction}` && eagle.pairs.length === TOWN_EAGLE_PAIRS.length
    && TOWN_EAGLE_PAIRS.every(pair => eagle.pairs.filter(saved => saved.riderId === pair.riderId
      && saved.mountId === pair.mountId && saved.homePadId === pair.homePadId
      && !saved.refitAllowed && !saved.serviceRefit && !saved.ambientRecovery && !saved.commandReturn
      && !saved.patrol?.active).length === 1))
}
