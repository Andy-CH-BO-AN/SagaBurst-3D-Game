import { TownMissionCombat, type TownCombatResident } from '../../src/town/TownMissionCombat'
import { Faction } from '../../src/combat/CombatFaction'
import { TownWatchtowerNavigation } from '../../src/navigation/TownWatchtowerNavigation'
import { getTownCommandWatchtowerLayout } from '../../src/town/TownCommandWatchtowerLayout'
import { describe, expect, it } from 'vitest'
import { BanditMissionController, selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { MissionTravelEncounter } from '../../src/career/MissionTravelEncounter'
import type { Player } from '../../src/player/Player'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { NPC, AIState } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { townDefenseThreatInRange, townDefenseThreatResponse } from '../../src/town/TownGarrison'
import { Vector3 } from 'three'

/** Only data and real methods cross this seam; no scene/model constructor runs. */
function modelFreePrototype<T>(prototype: object, fields: Record<string, unknown>): T {
  return Object.defineProperties(Object.create(prototype), Object.fromEntries(Object.entries(fields)
    .map(([key, value]) => [key, { value, writable: true, configurable: true }]))) as T
}

function borrowedTownCombat(phase: ActiveCareerMission['phase'], kind: ActiveCareerMission['kind'] = 'bandit') {
  const spec: TownActorSpec = { id: 'borrowed-soldier', role: 'melee_infantry', duty: 'training',
    mounted: false, training: true, assaultObjective: false, tier: 2, index: 0, x: 0, z: 0 }
  const actor = (id: string, faction = Faction.TOWN, x = 100): NPC => modelFreePrototype<NPC>(NPC.prototype, {
    combatantId: id, faction, dead: false, mount: null, combatPosition: new Vector3(x, 0, 0),
    characterFaction: 'roman', rangedActive: false, arrows: 0, state: AIState.IDLE, tacticalOrder: 'follow',
    shield: { active: false, shieldRaised: false }, alertSprite: { visible: false }, followNavigationGoal: new Vector3(),
    _friendlyBypass: new Map(), _navigationPath: { clear() {} },
  })
  const captain = actor('captain'), soldier = actor(spec.id), bandit = actor('mission-bandit', Faction.BANDIT, 112)
  const profile: { activeMission: ActiveCareerMission } = { activeMission: {
    id: 'bandit-mission', templateId: 'recruit-bandits-01', kind, targetCampId: 0, phase,
    targetActorIds: [bandit.combatantId], friendlyActorIds: [captain.combatantId, soldier.combatantId], acceptedAt: 0,
  } }
  const travelEncounter = new MissionTravelEncounter()
  const mission = modelFreePrototype<BanditMissionController>(BanditMissionController.prototype, {
    readProfile: () => profile, player: () => player, friendlies: [captain, soldier], camps: [{ ambient: [], mission: [bandit] }],
    veteranEnemies: [bandit], veteranTargetActorIds: new Set([bandit.combatantId]),
    veteranFriendlyActorIds: new Set([captain.combatantId, soldier.combatantId]),
    routeIndex: 0, travelEncounter,
    checkpoint: { persist(next: () => ActiveCareerMission) { profile.activeMission = next(); return true } },
  })
  type CombatInputs = ConstructorParameters<typeof TownMissionCombat>
  const combat = new TownMissionCombat(
    modelFreePrototype<CombatInputs[0]>(Object.prototype, { field: mission }),
    modelFreePrototype<CombatInputs[1]>(Object.prototype, {}),
  )
  const scene = modelFreePrototype<TownScene>(TownScene.prototype, {
    mission, missionCombat: combat, event: { hostile: false }, navigation: {},
  })
  for (const npc of [captain, soldier]) npc.combatTargetAllowed = target => scene['residentCombatTargetAllowed'](spec, npc, target)
  const player = modelFreePrototype<Player>(Object.prototype, { targetable: false, dead: false, combatPosition: new Vector3(100, 0, 0) })
  return { spec, actor, captain, soldier, bandit, profile, mission, combat, travelEncounter, scene, player }
}

describe('Borrowed Town mission target permission', () => {
  it('acquires the formal bandit target for the Captain and borrowed soldier after engagement releases their home leash', () => {
    const { spec, captain, soldier, bandit, mission, player } = borrowedTownCombat('MARCHING')
    expect(townDefenseThreatResponse(spec, soldier, bandit.combatPosition, 20)).toBe('ignore')
    mission.engageFormalMission()
    expect(mission.phase).toBe('ENGAGING')
    for (const friendly of [captain, soldier]) {
      expect(friendly.tacticalOrder).toBe('charge')
      expect(friendly['state']).toBe(AIState.CHASE)
      expect(friendly.combatTargetAllowed?.(bandit)).toBe(true)
      expect(friendly['_findTarget'](player, mission.combatPeersFor(friendly))?.npc).toBe(bandit)
    }
  })

  it('keeps unrelated hostile actors outside a borrowed soldier\'s mission pursuit permission', () => {
    const { actor, soldier, scene, spec, player } = borrowedTownCombat('ENGAGING')
    const unrelated = actor('unrelated-bandit', Faction.BANDIT, 111)
    expect(scene['residentCombatTargetAllowed'](spec, soldier, unrelated)).toBe(false)
    expect(soldier['_findTarget'](player, [unrelated])).toBeNull()
  })

  it('retains the home leash for a resident outside the active friendly roster', () => {
    const { actor, bandit, scene, spec, player } = borrowedTownCombat('ENGAGING')
    const resident = actor('native-resident')
    resident.combatTargetAllowed = target => scene['residentCombatTargetAllowed'](spec, resident, target)
    expect(resident.combatTargetAllowed(bandit)).toBe(false)
    expect(resident['_findTarget'](player, [bandit])).toBeNull()
  })

  it('does not release mission target pursuit or change the follow order while marching', () => {
    const { soldier, bandit, mission, player } = borrowedTownCombat('MARCHING')
    expect(soldier.combatTargetAllowed?.(bandit)).toBe(false)
    expect(soldier['_findTarget'](player, mission.combatPeersFor(soldier))).toBeNull()
    expect(soldier.tacticalOrder).toBe('follow')
    expect(mission.phase).toBe('MARCHING')
  })

  it.each([
    { kind: 'patrol', templateId: 'recruit-patrol-01' },
    { kind: 'cavalry-sweep', templateId: 'career-cavalry-sweep' },
    { kind: 'veteran-field', templateId: 'veteran-scout-hunters' },
  ] as const)('acquires the engaged $kind mission target beyond a borrowed actor\'s station', ({ kind, templateId }) => {
    const { soldier, bandit, profile, mission, player } = borrowedTownCombat('ENGAGING', kind)
    profile.activeMission.templateId = templateId
    soldier.setTacticalOrder('charge')
    expect(soldier.combatTargetAllowed?.(bandit)).toBe(true)
    expect(soldier['_findTarget'](player, mission.combatPeersFor(soldier))?.npc).toBe(bandit)
    expect(soldier['state']).toBe(AIState.CHASE)
  })

  it('acquires only a veteran enemy in the live engaged squad roster before formal engagement', () => {
    const { actor, soldier, bandit, mission, combat, player } = borrowedTownCombat('MARCHING', 'veteran-field')
    const held = actor('held-veteran-enemy', Faction.BANDIT, 111)
    mission['veteranEnemies'].push(held)
    mission['veteranTargetActorIds'].add(held.combatantId)
    expect(soldier['_findTarget'](player, [held, bandit])).toBeNull()
    // The combat owner has activated this squad and uses this same set for its hostile grid.
    combat['engagedVeteranEnemies'].add(bandit)
    expect(soldier.combatTargetAllowed?.(held)).toBe(false)
    expect(soldier['_findTarget'](player, [held, bandit])?.npc).toBe(bandit)
    expect(mission.phase).toBe('MARCHING')
  })

  it('limits scout survival native targets to the exact hostile Town combat roster', () => {
    const { actor, soldier, profile, combat, player } = borrowedTownCombat('ENGAGING', 'veteran-field')
    profile.activeMission.templateId = 'veteran-tragedy-of-the-scouts'
    const guard = actor('enemy-town:active-guard', Faction.ENEMY, 112)
    const unrelated = actor('enemy-town:unassigned-guard', Faction.ENEMY, 111)
    const friendly = actor('same-faction-guard', Faction.TOWN, 111)
    combat['enemyTownHostileActors'].push(guard, friendly)
    expect(soldier.combatTargetAllowed?.(unrelated)).toBe(false)
    expect(soldier.combatTargetAllowed?.(friendly)).toBe(false)
    expect(soldier['_findTarget'](player, [unrelated, friendly, guard])?.npc).toBe(guard)
  })

  it.each(['MARCHING', 'RETURNING'] as const)('acquires only live travel encounter threats during $0 and releases permission when they leave', phase => {
    const { actor, soldier, profile, mission, travelEncounter, player } = borrowedTownCombat(phase, 'cavalry-sweep')
    if (phase === 'RETURNING') profile.activeMission.result = {
      outcome: 'victory', claimed: false, merit: { damage: 0, kills: 0, contribution: 0, total: 0 },
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true },
    }
    const roaming = actor('roaming-hostile', Faction.BANDIT, 112)
    const unrelated = actor('unrelated-roaming-hostile', Faction.BANDIT, 111)
    const runtime = { owns: (npc: NPC) => npc === roaming }
    const grid = new SpatialGrid<NPC>(8)
    grid.insert(roaming)
    expect(soldier.combatTargetAllowed?.(roaming)).toBe(false)
    expect(mission.noteTravelHit(soldier, roaming, runtime)).toBe(true)
    travelEncounter.prepareFrame(.01, mission.friendlies, player, grid, runtime)
    expect(soldier.tacticalOrder).toBe('charge')
    expect(soldier.combatTargetAllowed?.(unrelated)).toBe(false)
    expect(soldier['_findTarget'](player, [unrelated, roaming])?.npc).toBe(roaming)
    expect(mission.phase).toBe(phase)
    // Clearing the real live encounter must revoke its extra target permission.
    roaming.combatPosition.set(200, 0, 0)
    travelEncounter.prepareFrame(.01, mission.friendlies, player, grid, runtime)
    expect(travelEncounter.active).toBe(false)
    expect(soldier.combatTargetAllowed?.(roaming)).toBe(false)
    expect(soldier['_findTarget'](player, [roaming])).toBeNull()
  })
})

describe('Town patrol roster contracts', () => {
  it('permits stationary close defense outside home while bounding pursuit to the home sector', () => {
    const spec = townRoster().find(spec => spec.role === 'commander') ?? townRoster().find(spec => spec.duty === 'gate_guard')!
    const npc = { isMounted: false, rangedWeaponId: undefined, combatPosition: new Vector3(spec.x, spec.y ?? 0, spec.z) }
    const near = npc.combatPosition.clone().add(new Vector3(10, 0, 0))
    expect(townDefenseThreatInRange(spec, npc, near, 20)).toBe(true)
    expect(townDefenseThreatResponse(spec, npc, near, 20)).toBe('pursue')
    expect(townDefenseThreatInRange(spec, npc, near.clone().add(new Vector3(20, 0, 0)), 20)).toBe(false)
    npc.combatPosition.add(new Vector3(22, 0, 0))
    expect(townDefenseThreatInRange(spec, npc, npc.combatPosition.clone().add(new Vector3(1, 0, 0)), 20)).toBe(true)
    expect(townDefenseThreatResponse(spec, npc, npc.combatPosition.clone().add(new Vector3(1, 0, 0)), 20)).toBe('defend')
    expect(townDefenseThreatResponse(spec, npc, npc.combatPosition.clone().add(new Vector3(9, 0, 0)), 20)).toBe('ignore')
  })
  it('keeps two twenty-rider patrols distinct from the service Captain, training and gate guards', () => {
    const roster = townRoster(), patrol = roster.filter(s => s.duty === 'patrol')
    expect(roster).toHaveLength(235); expect(patrol).toHaveLength(40)
    expect(new Set(roster.map(s => s.id)).size).toBe(roster.length)
    expect(roster.filter(s => s.role === 'captain')).toHaveLength(1)
    for (const id of ['A', 'B']) {
      const members = patrol.filter(s => s.patrolId === id)
      expect(members).toHaveLength(20); expect(members.filter(s => s.patrolLeader)).toHaveLength(1)
      expect(members.filter(s => !s.patrolLeader)).toHaveLength(19)
      for (const s of members) {
        expect(s).toMatchObject({ mounted: true, training: false, assaultObjective: false, tier: s.patrolLeader ? 4 : 2 })
        expect(s.defenseGroup).toBeUndefined(); expect(s.role).not.toBe('captain')
      }
    }
    expect(roster.filter(s => s.mounted && s.duty === 'training')).toHaveLength(60)
    expect(roster.filter(s => s.duty === 'gate_guard')).toHaveLength(40)
  })

  it('excludes patrol identities from ordinary mission cavalry selection', () => {
    const roster = townRoster()
    const fake = roster.map(spec => ({ spec, npc: { dead: false, combatantId: spec.id, mount: { dead: false } } as NPC }))
    expect(selectMissionCavalryActorIds(fake, 59)).toEqual(selectMissionCavalryActorIds(fake.filter(r => r.spec.duty !== 'patrol'), 59))
  })
})

it('lets nearby military pursue a reachable tower target while preserving civilian and home-sector limits', () => {
  const tower = new TownWatchtowerNavigation(getTownCommandWatchtowerLayout())
  const template = townRoster().find(spec => spec.unitKind && !spec.eagle)!
  const spec = { ...template, garrison: undefined, x: -21, y: tower.layout.groundY, z: -28 }
  const npc = { isMounted: false, rangedWeaponId: undefined, combatPosition: new Vector3(spec.x, spec.y, spec.z) }
  const target = new Vector3(-29, tower.layout.platformY, -41)
  expect(townDefenseThreatResponse(spec, npc, target, 20)).toBe('ignore')
  expect(townDefenseThreatResponse(spec, npc, target, 20, tower)).toBe('pursue')
  expect(townDefenseThreatResponse({ ...spec, role: 'civilian', unitKind: undefined }, npc, target, 20, tower)).toBe('ignore')
  expect(townDefenseThreatResponse({ ...spec, x: 60 }, npc, target, 20, tower)).toBe('ignore')
  // An airborne point above the structure is not proof of a reachable floor.
  expect(townDefenseThreatResponse(spec, npc, target.clone().add(new Vector3(0, 5, 0)), 20, tower)).toBe('ignore')
})

it('assigns the nearest eligible tower threat and retains the first equal-distance candidate', () => {
  const tower = new TownWatchtowerNavigation(getTownCommandWatchtowerLayout())
  const template = townRoster().find(spec => spec.unitKind && !spec.eagle)!
  const spec = { ...template, garrison: undefined, x: -21, y: tower.layout.groundY, z: -28 }
  let selected: NPC | undefined
  const body = { dead: false, faction: Faction.TOWN, isMounted: false, rangedWeaponId: undefined,
    combatPosition: new Vector3(spec.x, spec.y, spec.z),
    setMissionCombatTarget(target: NPC | undefined) { selected = target }, beginExternalThreat() {} }
  const resident: TownCombatResident = { spec, npc: body as unknown as NPC, cycle: 0, walkTime: 0 }
  const threat = (x: number, y: number, z: number, faction = Faction.BANDIT, dead = false): NPC =>
    ({ combatPosition: new Vector3(x, y, z), faction, dead }) as NPC
  // The farther threat precedes both nearest ties in the same spatial bucket.
  const farther = threat(-30, tower.layout.platformY, -41)
  const first = threat(-29, tower.layout.platformY, -41)
  const tie = threat(-29, tower.layout.platformY, -41)
  const friendly = threat(spec.x, spec.y, spec.z, Faction.TOWN)
  const dead = threat(spec.x, spec.y, spec.z, Faction.BANDIT, true)
  type Inputs = ConstructorParameters<typeof TownMissionCombat>
  // Exercise only real sensing/assignment; no actors, render scene or movement engine.
  const combat = new TownMissionCombat({
    field: { ambientBandits: [farther, first, tie, friendly, dead], missionBandits: [], friendlies: [] },
    duel: { fieldNpcs: [], isMissionActor: () => false }, defense: {},
  } as unknown as Inputs[0], {
    residents: [resident], navigation: { townNav: { watchtower: tower } },
  } as unknown as Inputs[1])
  combat['updateExternalThreatAssignments']()
  expect(selected).toBe(first)
})
