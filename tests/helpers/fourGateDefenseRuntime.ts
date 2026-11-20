import type { CareerProfile } from '../../src/career/CareerProfile'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { NavigationGrid } from '../../src/navigation/NavigationGrid'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { townAuthoredRoster, type TownRole } from '../../src/town/TownRules'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { Faction } from '../../src/world/NPC'
import { ActorDouble, asNpc, asPlayer, PlayerDouble, recordingActorFactory, residentSpec } from './careerActorDoubles'
import { recordingRampFactory, townSiegeWorld } from './townSiegeDoubles'

const SERVICE_ROLES: Record<string, TownRole> = { commander: 'commander', 'hr-officer': 'hr-officer', 'eagle-trainer': 'eagle-trainer' }

/**
 * The real home-Town four-gate owner over the real rampart layout and an open Town field. Residents
 * and attackers are plain bodies, vehicles run the real crew controller, and attacker spawning
 * uses a private scheduler. Only the case's own calls move the mission forward.
 */
export function fourGateDefenseRuntime(initial: CareerProfile, commit: (next: CareerProfile) => boolean = () => true) {
  let profile = initial
  const mission = initial.activeMission!, authored = new Map(townAuthoredRoster().map(spec => [spec.id, spec]))
  const nativeIds = [...mission.friendlyActorIds, ...(mission.fourGateDefense?.autonomousActorIds ?? [])]
  const residents = [...nativeIds.map(id => ({ spec: authored.get(id) ?? residentSpec(id, SERVICE_ROLES[id] ?? 'melee_infantry'),
    actor: new ActorDouble(id, { faction: Faction.TOWN }) })),
  ...(mission.civilianActorIds ?? []).map(id => ({ spec: residentSpec(id, 'civilian'),
    actor: new ActorDouble(id, { faction: Faction.TOWN, townCategory: 'civilian' }) }))]
  const layout = getTownRampartLayout(), world = townSiegeWorld(layout)
  // An open, fully connected Town field: the real cell grid and layered Town navigation, no obstacle rebuild.
  const navigation = { grid: new NavigationGrid(TOWN_NAVIGATION_BOUNDS), townNav: new TownLayeredNavigation(layout, () => true),
    areConnected: () => true, sync: () => false }
  const factory = recordingActorFactory(), createRamp = recordingRampFactory(), scheduler = new NpcSpawnScheduler(), player = new PlayerDouble()
  const controller = new CommanderFourGateDefenseController(factory, residents.map(r => ({ spec: r.spec, npc: asNpc(r.actor) })),
    () => asPlayer(player), () => profile, next => { if (!commit(next)) return false; profile = next; return true }, navigation,
    { world, createRamp, registerHit: () => {}, unregisterHit: () => {} }, scheduler)
  return { controller, player, residents: new Map(residents.map(r => [r.spec.id, r.actor])), profile: () => profile }
}
