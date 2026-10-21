import { commanderGateDefenseSlots } from '../../src/career/CommanderTownRoster'
import { acceptCommanderMission } from '../../src/career/CommanderMissionCatalog'
import { COMMANDER_FOUR_GATE_DEFENSE_ID, createCommanderFourGateDefenseRoster } from '../../src/career/CommanderFourGateDefenseRoster'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import type { TownFourGateSiegeCheckpoint } from '../../src/career/TownFourGateSiegeCheckpoint'
import { allocateTownSiegeCrews, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'

/** Saved data at a stated boundary, never a simulated deployment or a scene/actor constructor. */
export function createFourGateDefenseProfile(phase: 'PREPARING' | 'SPAWNING' | 'ATTACKING' = 'PREPARING',
  options: { legacyPrepared?: boolean; rosterVersion?: 1 | 2 } = {}): CareerProfile {
  const base = createCareerProfile('roman')
  base.rank = 'commander'; base.totalMerit = 20_000; base.availableMerit = 20_000
  const profile = acceptCommanderMission(base, COMMANDER_FOUR_GATE_DEFENSE_ID, 'four-gate-save')!
  const mission = profile.activeMission!, state = mission.fourGateDefense!
  if (options.rosterVersion === 1) {
    delete state.rosterVersion; delete state.autonomousActorIds
    mission.officialSquad!.squads = commanderGateDefenseSlots(undefined, 1)
    mission.friendlyActorIds = mission.officialSquad!.squads.flatMap(squad => squad.actorIds)
    mission.officialSquad!.actorIds = [...mission.friendlyActorIds]
  }
  const actor = (mounted: boolean): PersonalActorCheckpoint => ({
    status: 'deployed', hp: 100, position: { x: 20, y: 10, z: 30, yaw: .3 },
    ...(mounted ? { mount: { hp: 90, mounted: true, position: { x: 20, y: 10, z: 30, yaw: .3 } } } : {}),
  })
  for (const id of [...mission.friendlyActorIds, ...(state.autonomousActorIds ?? []), ...(mission.civilianActorIds ?? [])]) {
    state.actors[id] = actor(false)
  }
  mission.phase = phase
  Object.assign(state, { phase, preparationRemainingSeconds: phase === 'PREPARING' ? 180 : 0,
    player: { hp: 85, stamina: 70, dead: false, position: { x: 12, y: 10, z: 18, yaw: .5 }, ammo: 7, shieldImpact: 2 } })
  if (phase !== 'ATTACKING' && !options.legacyPrepared) return profile
  const roster = createCommanderFourGateDefenseRoster(mission.id, 'viking')
  for (const spec of roster.all) state.actors[spec.actorId!] = actor(Boolean(spec.loadout?.mountId))
  // The bounded parser requires all crew; other ground records are present only when
  // a case exercises their route/command mirror. Full actor identity capacity stays real.
  const groundIds = [...roster.crew.map(slot => slot.spec.actorId!), 'gate:north:7',
    'four-gate-save:east:archer:t3:1', 'four-gate-save:east:lancer:t3:1']
  const siege: TownFourGateSiegeCheckpoint = {
    version: 1, faction: 'viking', playerCommandedActorIds: [],
    actors: Object.fromEntries(groundIds.map(id => [id, { ...structuredClone(state.actors[id]), order: 'defend', entranceId: null, breachCompleted: false }])),
    ramps: allocateTownSiegeCrews(roster.crew).map(assignment => {
      const f = townSiegeFrame(assignment.gateId)
      const position = { x: f.gate.x + f.outward.x * 41.9 + f.tangent.x * assignment.side * 25,
        y: 10, z: f.gate.z + f.outward.z * 41.9 + f.tangent.z * assignment.side * 25 }
      return { assignment, stagingZ: position.z, position, hp: 520, state: phase === 'PREPARING' ? 'DEPLOYING' : 'PUSHING',
        distance: 0, travelDistance: 40, dockingProgress: 0 }
    }),
    gates: new TownGateBreachPolicy(() => []).snapshot().map(gate => ({ ...gate, hp: 2080 })),
  }
  mission.phase = phase; mission.commanderMission!.deploymentComplete = true
  Object.assign(state, { phase, preparationRemainingSeconds: phase === 'PREPARING' ? 180 : 0,
    deploymentComplete: true, attackStarted: phase === 'ATTACKING', registeredTargetActorIds: [...mission.targetActorIds], siege,
    player: { hp: 85, stamina: 70, dead: false, position: { x: 12, y: 10, z: 18, yaw: .5 }, ammo: 7, shieldImpact: 2 } })
  return profile
}
