import { describe, expect, it } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCareerTutorialDuelMission } from '../../src/career/CareerDuelState'
import { acceptCommanderMission, COMMANDER_DECAPITATION_ID } from '../../src/career/CommanderMissionCatalog'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { townDeploymentReady } from '../../src/town/TownDeploymentReady'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { Faction } from '../../src/world/NPC'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { ActorDouble, asNpc, asPlayer, PlayerDouble, recordingActorFactory, residentSpec } from '../helpers/careerActorDoubles'

/** The real Commander controller with plain actor bodies, and the real Town readiness rule over it. */
function readiness(initial: CareerProfile) {
  let profile = initial, saving = true
  const scheduler = new NpcSpawnScheduler(), player = new PlayerDouble()
  const commander = new ActorDouble('commander', { faction: Faction.ENEMY, characterFaction: 'viking' })
  const defense = new CommanderTownMissionController(recordingActorFactory(), [{ spec: residentSpec('commander', 'commander'), npc: asNpc(commander) }],
    () => asPlayer(player), () => profile, next => { if (!saving) return false; profile = next; return true },
    new NavigationWorld({ minX: -4, maxX: 4, minZ: -4, maxZ: 4 }), scheduler)
  const town = { mission: { ready: true }, personalSquad: { ready: true } }
  const ready = () => townDeploymentReady({ ...town, defense, activeMission: profile.activeMission })
  let frame = 0
  const materialize = () => { while (scheduler.pending > 0) scheduler.tick(++frame) }
  return { defense, town, ready, materialize, setSaving: (value: boolean) => { saving = value }, profile: () => profile }
}

describe('Town gameplay deployment readiness', () => {
  it('runs Town and Captain tutorial travel when the inactive Commander controller has no deployment', () => {
    const profile = createCareerProfile('roman'), h = readiness(profile)
    expect(h.defense.ready).toBe(false)
    expect(h.ready()).toBe(true)
    profile.activeMission = createCareerTutorialDuelMission(profile, 'roman_sword_cavalry', 'captain', 'ranger')!
    expect(profile.activeMission).toBeDefined()
    expect(h.defense.active).toBeUndefined()
    expect(h.ready()).toBe(true)
  })

  it('holds an active Commander mission until its own roster and personal squad are ready', () => {
    const base = createCareerProfile('roman')
    Object.assign(base, careerRankFixture('roman', 'commander'), { totalMerit: 20_000, availableMerit: 20_000 })
    const accepted = acceptCommanderMission(base, COMMANDER_DECAPITATION_ID, 'deployment')!
    // A reloaded deployment: the saved perimeter position is authoritative, so no Town-wide placement is planned.
    accepted.activeMission!.commanderMission!.playerPosition = { x: 0, z: -300, yaw: 0 }
    const h = readiness(accepted)
    expect(h.defense.active?.id).toBe('deployment')
    expect(h.ready()).toBe(false)
    h.setSaving(false)
    expect(h.defense.startActiveMission()).toBe(false) // The roster commit is still pending.
    expect(h.ready()).toBe(false)
    h.setSaving(true)
    expect(h.defense.startActiveMission()).toBe(true)
    expect(h.ready()).toBe(false) // Official actors are still queued.
    h.materialize()
    expect(h.defense.fieldNpcs).toHaveLength(30)
    h.town.personalSquad.ready = false
    expect(h.ready()).toBe(false)
    h.town.personalSquad.ready = true
    expect(h.ready()).toBe(true)
    h.defense.dispose()
  })
})
