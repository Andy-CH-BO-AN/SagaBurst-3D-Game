import { commanderFourGateGarrisonSlots, commanderFourGateGroundResidents, FOUR_GATE_RESERVE_SQUAD, prepareFourGateGroundResident } from '../../src/career/CommanderFourGateDefenseRoster'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import type { CareerProfile } from '../../src/career/CareerProfile'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { NavigationGrid } from '../../src/navigation/NavigationGrid'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { townAuthoredRoster, type TownRole } from '../../src/town/TownRules'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { Faction } from '../../src/world/NPC'
import { ActorDouble, asNpc, asPlayer, MountDouble, PlayerDouble, recordingActorFactory, residentSpec } from './careerActorDoubles'
import { recordingRampFactory, townSiegeWorld } from './townSiegeDoubles'

const SERVICE_ROLES: Record<string, TownRole> = { commander: 'commander', 'hr-officer': 'hr-officer', 'eagle-trainer': 'eagle-trainer' }

export function fourGateNativeSpecs(mission: ActiveCareerMission) {
  const authored = new Map(townAuthoredRoster().map(spec => [spec.id, spec]))
  const garrison = new Set(commanderFourGateGarrisonSlots(mission.id).map(slot => slot.actorId))
  const nativeIds = [...mission.friendlyActorIds.filter(id => !garrison.has(id)), ...(mission.fourGateDefense?.autonomousActorIds ?? [])]
  const ground = commanderFourGateGroundResidents()
  const reserve = mission.officialSquad!.squads!.find(squad => squad.squadId === FOUR_GATE_RESERVE_SQUAD)!.actorIds
  const civilians = new Set(mission.civilianActorIds)
  return nativeIds.map(id => {
    const column = reserve.indexOf(id)
    const spec = authored.get(id) ?? residentSpec(id, SERVICE_ROLES[id] ?? (civilians.has(id) ? 'civilian' : 'melee_infantry'))
    const company = ground.get(id)
    if (company) return prepareFourGateGroundResident(spec, company)
    if (column >= 0) return { ...spec, x: 32 + column * 2.5, y: 2, z: 30, yaw: 0, mounted: true }
    return spec
  })
}

/**
 * The real home-Town four-gate owner over the real rampart layout and an open Town field. Residents
 * and attackers are plain bodies, vehicles run the real crew controller, and attacker spawning
 * uses a private scheduler. Only the case's own calls move the mission forward.
 */
export function fourGateDefenseRuntime(initial: CareerProfile, options: {
  commit?: (next: CareerProfile) => boolean
  autoSave?: boolean
} = {}) {
  let profile = initial
  const civilians = new Set(initial.activeMission!.civilianActorIds)
  const residents = fourGateNativeSpecs(initial.activeMission!).map(spec => {
    const actor = new ActorDouble(spec.id, { faction: Faction.TOWN, ...(civilians.has(spec.id) ? { townCategory: 'civilian' } : {}) })
    if (spec.mounted) actor.mountVehicle(new MountDouble('horse', spec.x, spec.z))
    return { spec, actor }
  })
  const layout = getTownRampartLayout(), world = townSiegeWorld(layout)
  // An open, fully connected Town field: the real cell grid and layered Town navigation, no obstacle rebuild.
  const navigation = { grid: new NavigationGrid(TOWN_NAVIGATION_BOUNDS), townNav: new TownLayeredNavigation(layout, () => true),
    areConnected: () => true, sync: () => false }
  const factory = recordingActorFactory(), createRamp = recordingRampFactory(), scheduler = new NpcSpawnScheduler(), player = new PlayerDouble()
  const controller = new CommanderFourGateDefenseController(factory, residents.map(r => ({ spec: r.spec, npc: asNpc(r.actor) })),
    () => asPlayer(player), () => profile, next => {
      if (options.commit?.(next) === false) return false
      profile = next
      return true
    }, navigation, { world, createRamp, registerHit: () => {}, unregisterHit: () => {} }, scheduler, options.autoSave)
  return { controller, player, scheduler, residents: new Map(residents.map(r => [r.spec.id, r.actor])), profile: () => profile }
}
