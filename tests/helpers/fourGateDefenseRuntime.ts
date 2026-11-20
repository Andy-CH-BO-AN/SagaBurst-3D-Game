import type { CareerProfile } from '../../src/career/CareerProfile'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
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
 * The real home-Town four-gate owner over the real rampart layout and Town navigation. Residents
 * and attackers are plain bodies, vehicles run the real crew controller, and spawning uses a
 * private scheduler the case ticks itself. Only the case's own calls move the mission forward.
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
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(world.obstacles); navigation.townNav = new TownLayeredNavigation(layout)
  const factory = recordingActorFactory(), createRamp = recordingRampFactory(), scheduler = new NpcSpawnScheduler(), player = new PlayerDouble()
  const controller = new CommanderFourGateDefenseController(factory, residents.map(r => ({ spec: r.spec, npc: asNpc(r.actor) })),
    () => asPlayer(player), () => profile, next => { if (!commit(next)) return false; profile = next; return true }, navigation,
    { world, createRamp, registerHit: () => {}, unregisterHit: () => {} }, scheduler)
  let frame = 0
  return {
    controller, player, world, factory, ramps: createRamp.ramps,
    residents: new Map(residents.map(r => [r.spec.id, r.actor])),
    profile: () => profile, setProfile: (next: CareerProfile) => { profile = next },
    /** Runs every queued spawn job, one per frame as the Town loop would. */
    materialize: () => {
      for (const batch of controller.spawnBatches) for (let jobs = batch.actors.size; jobs > 0 && batch.status === 'pending'; jobs--) scheduler.tick(++frame)
    },
    /** Natives deployed, preparation spent, attackers materialized and released by the real flow. */
    toAttack() {
      if (!controller.startActiveMission()) throw new Error('four-gate mission did not start')
      controller.completeInitialDeployment()
      controller.updateFlow(controller.preparationRemaining, 0)
      this.materialize()
      controller.updateFlow(0, 0)
    },
  }
}
