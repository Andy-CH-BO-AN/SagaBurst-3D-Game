import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { revokeRetirementTownCommandClaims } from './CareerRetirementCommand'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { TOWN_EAGLE_PAIRS } from '../town/TownEagleGarrison'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { TOWN_CITY, TOWN_CITY_ROADS, TOWN_GARRISON_EAGLE_SITES, TOWN_LOCAL_ROADS, TOWN_PRIVATE_EAGLE_SITES } from '../town/TownLayout'
import { Vector3 } from 'three'
import { generateFormationSlots } from '../battle/FormationMath'
import { resolveFormationSlots } from '../battle/FormationPlacement'
import { civilianBodyClear } from '../town/TownCivilianLife'
import { townRampGroundExcluded } from '../town/TownGroundStation'
import { getTownRampartLayout } from '../town/TownRamparts'
import { getTownCommandWatchtowerLayout, watchtowerFootprints } from '../town/TownCommandWatchtowerLayout'
import { EAGLE_APPROACH } from '../world/EagleApproach'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import type { NavigationWorld } from '../navigation/NavigationWorld'
import type { TownActorSpec } from '../town/TownRules'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'
import { createTownEquipmentRefsResolver, townEquipmentActorSpecs } from './CareerTownEquipmentState'
import type { PersonalActorCheckpoint, PersonalActorPosition } from './CareerPersonalSquadMission'

export interface RetirementAssaultFormation {
  id: string
  actorIds: string[]
  source: 'town-ground' | 'town-air' | 'native-guard' | 'auxiliary'
}

/** Retirement alone uses these ground muster banks. Native gate homes and roster
 * membership remain untouched. Wider ranks also accommodate reassigned horses. */
const RETIREMENT_MOUNTED_BANKS = [
  { x: 20, z: -90, columns: 6 }, { x: 43, z: -90, columns: 6 }, { x: 69, z: -85, columns: 7 },
  { x: 35.5, z: -43, columns: 6 }, { x: 57.1, z: -43, columns: 6 },
  { x: 37.4, z: 3.6, columns: 7 }, { x: 62.6, z: 3.6, columns: 7 },
  { x: 37.4, z: 20.4, columns: 7 }, { x: 62.6, z: 20.4, columns: 7 },
] as const
const RETIREMENT_FOOT_BANKS = [3, 13, 23].flatMap(z => [42, 64].map(x => ({ x, z, columns: 10 })))

/** Plan the whole ground population before saving or changing live actors.
 * FormationPlacement owns local obstacle recovery; this adapter supplies Town's
 * real body clearance, open roads, stair exits and one shared occupancy set. */
export function retirementGroundStaging(formations: readonly RetirementAssaultFormation[], mountedIds: ReadonlySet<string>,
  obstacles: readonly ObstacleData[], navigation: Pick<NavigationWorld, 'areConnected'>): Map<string, PersonalActorPosition> | null {
  const ground = formations.filter(formation => formation.source !== 'town-air')
  const ids = ground.flatMap(formation => formation.actorIds)
  if (new Set(ids).size !== ids.length) return null
  const layout = getTownRampartLayout(), tower = getTownCommandWatchtowerLayout()
  const towerBoxes = watchtowerFootprints(tower), forward = new Vector3(0, 0, -1)
  const eaglePads = [...TOWN_PRIVATE_EAGLE_SITES, ...TOWN_GARRISON_EAGLE_SITES]
  // Local road zero is the complete authored plaza surface, rather than a passage.
  const roads = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS.slice(1)]
  const anchor = { x: 53, z: 12 }, occupied: { point: Vector3; radius: number }[] = []
  const destinations = new Map<string, PersonalActorPosition>()
  const radius = (id: string) => mountedIds.has(id) ? 1.8 : .7
  const usable = (point: Vector3, id: string): boolean => {
    const r = radius(id)
    if (point.x < -15 + r || point.x > 90 - r || point.z < -105 + r || point.z > 28 - r
      || townRampGroundExcluded(layout, point, Math.max(1.8, r))
      || !civilianBodyClear(point, obstacles, { radius: r, height: mountedIds.has(id) ? 2.6 : 2.3 })) return false
    if (towerBoxes.some(box => point.x > box.min.x - r && point.x < box.max.x + r
      && point.z > box.min.z - r - 2 && point.z < box.max.z + r + 2)) return false
    for (const road of roads) {
      const dx = road.bx - road.ax, dz = road.bz - road.az
      const t = Math.max(0, Math.min(1, ((point.x - road.ax) * dx + (point.z - road.az) * dz) / (dx * dx + dz * dz)))
      if (Math.hypot(point.x - road.ax - dx * t, point.z - road.az - dz * t) < road.width / 2 + r + .6) return false
    }
    for (const pad of eaglePads) {
      const along = (pad.z - point.z) * Math.cos(pad.yaw)
      if (Math.abs(point.x - pad.x) < 16 + r && along >= -15 - r && along <= EAGLE_APPROACH.terminalDistance + r) return false
    }
    return occupied.every(other => (point.x - other.point.x) ** 2 + (point.z - other.point.z) ** 2 >= (r + other.radius) ** 2 - .0001)
      && navigation.areConnected(anchor, point)
  }
  let mountedBank = 0, footBank = 0
  for (const formation of ground) {
    if (!formation.actorIds.length) continue
    const mounted = formation.actorIds.some(id => mountedIds.has(id))
    const preferred = mounted ? RETIREMENT_MOUNTED_BANKS : RETIREMENT_FOOT_BANKS
    const index = mounted ? mountedBank++ : footBank++
    const banks = [...preferred.slice(index), ...preferred.slice(0, index), ...(mounted ? RETIREMENT_FOOT_BANKS : RETIREMENT_MOUNTED_BANKS)]
    let slots: Vector3[] | null = null
    for (const bank of banks) {
      const ideal = generateFormationSlots(new Vector3(bank.x, 0, bank.z), forward, formation.actorIds.length,
        bank.columns, mounted ? 3.6 : 2, mounted ? 4.2 : 2.5)
      for (const point of ideal) point.y = getTerrainHeight(point.x, point.z)
      slots = resolveFormationSlots(ideal, forward, formation.actorIds, radius, usable, getTerrainHeight, 150)
      if (slots) break
    }
    if (!slots) return null
    slots.forEach((point, index) => {
      const id = formation.actorIds[index]
      occupied.push({ point, radius: radius(id) })
      destinations.set(id, { x: point.x, y: point.y, z: point.z, yaw: Math.PI })
    })
  }
  return destinations
}

/** Same authored city rectangle for walkers and every ridden mount; height is irrelevant. */
export function outsideRetirementTownCore(point: { x: number; z: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && (point.x < TOWN_CITY.minX || point.x > TOWN_CITY.maxX || point.z < TOWN_CITY.minZ || point.z > TOWN_CITY.maxZ)
}

/** Only this owner may advance the phase. The caller saves before publishing any effect. */
export function advanceCommanderRetirementToMobilizing(current: CareerProfile): CareerProfile | null {
  if (current.rank !== 'commander' || current.careerRetirement?.phase !== 'departing'
    || current.activeMission || current.activeOutpostMission || current.activeRace
    || current.townEvent?.state === 'hostile') return null
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
