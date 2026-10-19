import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { acceptCaptainEagle, acceptCaptainFrontline, createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_GATE_DEFENSE_ID, captainGateDefenseActorIds, commanderGateDefenseSlots, commanderGateDefenseSquads, createCaptainGateDefenseMission, getCaptainMissionAvailability, getCaptainMissionDefinition } from '../../src/career/CaptainMissionCatalog'
import { townDefenseForceCountsForProfile } from '../../src/career/TownDefenseRoster'
import { hasCompleteRetirementMobilizationCheckpoint, retirementAssaultFormations, retirementGroundStaging, retirementMobilizationNeedsPreparation } from '../../src/career/CareerRetirementMobilization'
import { townDefaultActorLoadout, townEquipmentActorSpecs } from '../../src/career/CareerTownEquipmentState'
import { TOWN_CENTER, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, townHousing } from '../../src/town/TownLayout'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../../src/town/TownNativeGuardIdentity'
import { getTerrainHeight } from '../../src/world/Terrain'
import { townCommanderSpec } from '../../src/town/TownCommanderIdentity'
import { VETERAN_TOWN_DEFENSE_TEMPLATE } from '../../src/career/CareerMissionCatalog'
import { officialActorSquadId, officialCommandSquads } from '../../src/career/CareerCommandAuthority'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { buildCommanderAuthorityForMission } from '../../src/career/CommanderMissionAcceptance'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { townAssaultObjectiveRoster, townDefenseForceCounts, townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'
import { withNativeRetirementCheckpoints } from '../helpers/RetirementMobilizationFixture'

const captain = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000, ownedMounts: ['horse', 'xongkoro'] })

describe('Retirement ground muster capacity without actor materialization', () => {
  it.each(['native', 'all-mountable'] as const)('stages the complete %s army between the north gate and plaza with roads open', equipment => {
    const natives = townEquipmentActorSpecs('roman')
    const formations = retirementAssaultFormations([...natives, ...TOWN_WATCHTOWER_ARCHER_IDS.map(id => ({ id, role: 'archer_infantry' as const }))])!
    const groundIds = formations.filter(formation => formation.source !== 'town-air').flatMap(formation => formation.actorIds)
    const mounted = new Set(equipment === 'native'
      ? natives.filter(spec => townDefaultActorLoadout('roman', spec).mountId).map(spec => spec.id)
      : groundIds.filter(id => !TOWN_WATCHTOWER_ARCHER_IDS.includes(id)))
    expect(groundIds.filter(id => mounted.has(id))).toHaveLength(equipment === 'native' ? 104 : 227)
    // Conservative authored building envelopes; no world or mesh construction.
    const obstacles = [...townHousing('viking'), TOWN_CENTER,
      { x: -6, z: -17, width: 10, depth: 11 }, { x: -5, z: -39, width: 11, depth: 14 },
      { x: 72, z: 30, width: 2.6, depth: 2.6 }, { x: -29, z: -41, width: 22.4, depth: 32.4 },
      { x: 43, z: -10, width: 1, depth: 1 }, { x: 61, z: -10, width: 1, depth: 1 },
    ].map(box => ({ isBarricade: false, box: new Box3(new Vector3(box.x - box.width / 2 - .25, -10, box.z - box.depth / 2 - .25),
      new Vector3(box.x + box.width / 2 + .25, 50, box.z + box.depth / 2 + .25)) }))
    const destinations = retirementGroundStaging(formations, mounted, obstacles, { areConnected: () => true })
    expect(destinations?.size).toBe(232)
    expect(new Set(destinations!.keys())).toEqual(new Set(groundIds))
    const points = [...destinations!].map(([id, point]) => ({ ...point, radius: mounted.has(id) ? 1.8 : .7 }))
    let overlap = false, blockedRoad = false
    for (const [index, point] of points.entries()) {
      expect(point.x).toBeGreaterThanOrEqual(-15 + point.radius)
      expect(point.x).toBeLessThanOrEqual(90 - point.radius)
      expect(point.z).toBeGreaterThanOrEqual(-105 + point.radius)
      expect(point.z).toBeLessThanOrEqual(28 - point.radius)
      expect(point.y).toBe(getTerrainHeight(point.x, point.z))
      for (const other of points.slice(0, index)) if (Math.hypot(point.x - other.x, point.z - other.z) < point.radius + other.radius - .0001) overlap = true
      for (const road of [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS.slice(1)]) {
        const dx = road.bx - road.ax, dz = road.bz - road.az
        const t = Math.max(0, Math.min(1, ((point.x - road.ax) * dx + (point.z - road.az) * dz) / (dx * dx + dz * dz)))
        if (Math.hypot(point.x - road.ax - dx * t, point.z - road.az - dz * t) < road.width / 2 + point.radius + .5999) blockedRoad = true
      }
    }
    expect(overlap).toBe(false)
    expect(blockedRoad).toBe(false)
    expect(points.some(point => point.z < -70)).toBe(true)
    expect(points.some(point => point.z > 0)).toBe(true)
  })
})

describe('Captain mission eligibility and official roster policy without actor materialization', () => {
  it('requires actual Eagle ownership, independent of the selected mount', () => {
    const unowned = { ...captain(), ownedMounts: ['horse' as const], selectedMountId: 'xongkoro' as const }
    expect(getCaptainMissionAvailability(unowned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(false)
    expect(acceptCaptainEagle(unowned)).toBeNull()
    const owned = { ...captain(), selectedMountId: 'horse' as const }
    expect(getCaptainMissionAvailability(owned, CAPTAIN_EAGLE_BATTLE_ID).unlocked).toBe(true)
    expect(acceptCaptainEagle(owned)!.selectedMountId).toBe('xongkoro')
  })
})

describe('Commander accepted production rosters without actor materialization', () => {
  const commander = (): CareerProfile => ({ ...captain(), rank: 'commander', totalMerit: 20000 })

  it('excludes unavailable or unaccepted military without moving the remaining defenders between squads', () => {
    const residents = townRoster(), accepted = townAssaultObjectiveRoster(residents).map(actor => actor.id)
    // Canonical membership needs authored metadata only; adding real garrison/home
    // positions must preserve every official squad's complete ID order.
    expect(commanderGateDefenseSlots()).toEqual(commanderGateDefenseSlots(residents))
    const full = commanderGateDefenseSquads(residents, accepted)
    const unavailable = new Set(['captain', 'town-patrol:a:captain', 'town-eagle-rider:2'])
    const reduced = commanderGateDefenseSquads(residents, accepted.filter(id => id !== 'gate:south:0'), unavailable)
    expect(reduced.flatMap(squad => squad.actorIds)).toHaveLength(200)
    expect(reduced).toEqual(full.map(squad => ({ ...squad,
      actorIds: squad.actorIds.filter(id => !unavailable.has(id) && id !== 'gate:south:0'),
    })))
    const highMeritCaptain = createCaptainGateDefenseMission({ ...commander(), rank: 'captain' }, accepted, [], residents)
    expect(highMeritCaptain.officialSquad!.actorIds).toEqual(captainGateDefenseActorIds(residents))
    expect(highMeritCaptain.officialSquad!.commandRank).toBeUndefined()
    const force = townDefenseForceCounts(residents)
    expect(force).toEqual({ friendlySoldiers: 213, friendlyCombatants: 214 })
    expect(force.friendlySoldiers).toBe(highMeritCaptain.friendlyActorIds.length)
    expect(VETERAN_TOWN_DEFENSE_TEMPLATE).toMatchObject(force)
    expect(getCaptainMissionDefinition(CAPTAIN_GATE_DEFENSE_ID)).toMatchObject(force)
    expect(highMeritCaptain.friendlyActorIds.filter(id => id.startsWith('watchtower-archer:'))).toHaveLength(5)
    expect(highMeritCaptain.officialSquad!.actorIds.some(id => id.startsWith('watchtower-archer:'))).toBe(false)
    const withCommander = [...residents, townCommanderSpec({ x: 0, z: 0, yaw: 0 })]
    const commandedDefense = createCaptainGateDefenseMission(commander(), accepted, [], withCommander)
    expect(townDefenseForceCountsForProfile(commander(), withCommander)).toEqual({ friendlySoldiers: 214, friendlyCombatants: 215 })
    expect(townDefenseForceCountsForProfile(commander(), withCommander).friendlySoldiers).toBe(commandedDefense.friendlyActorIds.length)
    expect(townDefenseForceCountsForProfile(commander(), withCommander, new Set(['commander']))).toEqual(force)
  })

  it('replays Frontline saved membership instead of regrouping actors after reload', () => {
    const profile = acceptCaptainFrontline(commander(), 'frontline-save')!, authority = profile.activeMission!.officialSquad!
    const first = authority.squads![0].actorIds[0], last = authority.squads![2].actorIds[0]
    authority.squads![0].actorIds[0] = last
    authority.squads![2].actorIds[0] = first
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!, saved = loaded.activeMission!.officialSquad!
    expect(saved.squads).toEqual(authority.squads)
    const specs = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(loaded), saved).npcSpecs
    expect(specs.find(spec => spec.actorId === first)!.squadId).toBe(3)
    expect(specs.find(spec => spec.actorId === last)!.squadId).toBe(1)
  })

  it('uses Veteran authored squads with distinct pending reinforcement groups at fresh Commander acceptance', () => {
    const profile = acceptVeteranMission(commander(), 'veteran-dread-outpost', { missionId: 'grouped-veteran' })!
    const mission = profile.activeMission!, authority = buildCommanderAuthorityForMission(profile, mission)!
    expect(officialCommandSquads(authority).map(squad => [squad.squadId, squad.actorIds.length]))
      .toEqual([[1, 24], [2, 25], [3, 25], [4, 25], [5, 25], [6, 25]])
    expect(new Set(authority.actorIds)).toEqual(new Set([...mission.friendlyActorIds, ...mission.reinforcementActorIds!]))
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![0])).toBe(5)
    expect(officialActorSquadId(authority, mission.reinforcementActorIds![1])).toBe(6)
    expect(mission.officialSquad).toBeUndefined()
    expect(buildCommanderAuthorityForMission({ ...profile, rank: 'captain' }, mission)).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, kind: 'duel' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, phase: 'RETURNING' })).toBeUndefined()
    expect(buildCommanderAuthorityForMission(profile, { ...mission, officialSquad: authority })).toBeUndefined()
  })

  it('assigns every native retirement humanoid exactly once and stops preparation after its durable receipt', () => {
    const natives: Pick<TownActorSpec, 'id' | 'role'>[] = [...townRoster(),
      { id: 'commander', role: 'commander' }, { id: 'hr-officer', role: 'hr-officer' }, { id: 'eagle-trainer', role: 'eagle-trainer' }]
    const excluded: Pick<TownActorSpec, 'id' | 'role'>[] = [
      { id: 'player', role: 'commander' }, { id: 'personal:1', role: 'melee_infantry' },
      { id: 'enemy-town:captain', role: 'captain' }, { id: 'bandit:1', role: 'melee_infantry' },
      { id: 'mission:temporary', role: 'melee_infantry' }, { id: 'town-eagle-mount:1', role: 'cat' },
    ]
    const formations = retirementAssaultFormations([...natives, ...excluded])!
    const actorIds = formations.flatMap(formation => formation.actorIds)
    expect(actorIds).toHaveLength(237)
    expect(new Set(actorIds).size).toBe(237)
    expect(new Set(actorIds)).toEqual(new Set(natives.filter(actor => actor.role !== 'cat').map(actor => actor.id)))
    const ground = formations.filter(formation => formation.source === 'town-ground')
    expect(ground).toHaveLength(8)
    expect(ground.flatMap(formation => formation.actorIds)).toHaveLength(206)
    expect(ground.map(formation => formation.actorIds)).toEqual(commanderGateDefenseSlots().map(squad => squad.actorIds))
    expect(formations.find(formation => formation.source === 'town-air')?.actorIds).toHaveLength(5)
    expect(formations.find(formation => formation.source === 'native-guard')?.actorIds).toHaveLength(5)
    const auxiliary = formations.filter(formation => formation.source === 'auxiliary')
    expect(auxiliary.map(formation => formation.actorIds)).toEqual([
      [...Array.from({ length: 20 }, (_, index) => `civilian-${index}`), 'merchant'].sort(),
    ])
    expect(retirementAssaultFormations([...excluded, ...natives].reverse())).toEqual(formations)
    expect(excluded.every(actor => !actorIds.includes(actor.id))).toBe(true)
    expect(retirementAssaultFormations([...natives, natives[0]])).toBeNull()
    expect(retirementAssaultFormations(natives.filter(actor => actor.id !== 'merchant'))).toBeNull()
    const pending = withNativeRetirementCheckpoints({ ...commander(), careerRetirement: {
      version: 1, phase: 'mobilizing', acceptedAt: 123, combatElapsedSeconds: 0,
    } })
    expect(retirementMobilizationNeedsPreparation(pending)).toBe(true)
    pending.careerRetirement!.mobilization = { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true }
    expect(hasCompleteRetirementMobilizationCheckpoint(pending)).toBe(true)
    expect(retirementMobilizationNeedsPreparation(pending)).toBe(false)
  })
})


it('rejects incomplete prepared native retirement checkpoints without replacing the durable save', () => {
  const ready = withNativeRetirementCheckpoints({ ...createCareerProfile('roman'),
    rank: 'commander', totalMerit: 20000, commanderMeleeGranted: true,
    careerRetirement: { version: 1, phase: 'final-stand', acceptedAt: 123, combatElapsedSeconds: 42.5,
      mobilization: { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true } },
    retirementRuntime: { player: { position: { x: 0, y: 0, z: 0, yaw: 0 },
      hp: 0, stamina: 21, arrows: 3, shieldImpact: 4, mounted: false },
      stats: {
        player: { damageDealt: 12.5, damageTaken: 9, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
        personal: { damageDealt: 17, damageTaken: 4, kills: 3, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      } },
  })
  const casualty = ready.townCommandSquad!.members!.captain
  casualty.hp = 0
  casualty.status = 'dead'
  casualty.mount!.hp = 0
  casualty.mount!.mounted = false
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(ready)).toBe(true)
  const saved = storage.getItem(CAREER_STORAGE_KEY)
  const restored = store.loadChecked().profile!
  expect(restored.careerRetirement).toEqual(ready.careerRetirement)
  expect(restored.townCommandSquad!.members!.captain).toEqual(casualty)
  expect(restored.retirementRuntime).toEqual(ready.retirementRuntime)
  // Player death is a resumable resource checkpoint, not an automatic ending.
  expect(restored.careerRetirement?.phase).toBe('final-stand')
  expect(restored.retirementRuntime?.player.hp).toBe(0)
  // Complete receipts cannot silently recover missing owners, actors, mounts or resources.
  const { [Object.keys(ready.retirementTowerGuards!)[0]]: missingGuard, ...remainingGuards } = ready.retirementTowerGuards!
  expect(missingGuard).toBeDefined()
  const { mount, ...unmountedCaptain } = casualty
  expect(mount).toBeDefined()
  const incomplete: CareerProfile[] = [
    { ...ready, townCommandSquad: undefined },
    { ...ready, retirementTowerGuards: remainingGuards },
    { ...ready, townCommandSquad: { ...ready.townCommandSquad!,
      members: { ...ready.townCommandSquad!.members, captain: unmountedCaptain } } },
    { ...ready, retirementRuntime: undefined },
    { ...ready, retirementRuntime: { ...ready.retirementRuntime!, stats: { ...ready.retirementRuntime!.stats!,
      personal: { ...ready.retirementRuntime!.stats!.personal, kills: -1 } } } },
  ]
  for (const corrupt of incomplete) {
    expect(store.save(corrupt)).toBe(false)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
  }
  const legacy = { ...ready, retirementRuntime: { ...ready.retirementRuntime!, stats: undefined } }
  expect(store.save(legacy)).toBe(true)
  expect(store.load()?.retirementRuntime?.stats).toBeUndefined()
})
