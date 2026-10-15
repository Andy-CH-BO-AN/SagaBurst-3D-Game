import { describe,expect,it } from 'vitest'
import { acceptCaptainFrontline,createCaptainFrontlineLaunch } from '../../src/career/CaptainBattleLaunch'
import type { CareerOutpostCheckpoint } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'



describe('Captain Stage IX checkpoint storage contract', () => {
  it('round-trips the battle timeline, partial wave, casualties and official commands without using free Campaign progress', () => {
    const profile = acceptCaptainFrontline({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000 }, 'stage-nine-save')!
    const launch = createCaptainFrontlineLaunch(profile), mission = profile.activeMission!
    const checkpoint: CareerOutpostCheckpoint = {
      runtime: { phase: 'assault', activePhase: 'assault', deploymentRemainingSeconds: 0, assaultElapsedSeconds: 121,
        reinforcementRemainingSeconds: 0, reinforcementTriggered: true, battleFinished: false },
      actors: { [mission.friendlyActorIds[0]]: { hp: 31, x: 2, z: -11, yaw: 1, checkpoint: { status: 'deployed', hp: 31, ammo: 2, shieldImpact: 6, order: 'defend', position: { x: 2, y: 4, z: -11, yaw: 1 }, mount: { hp: 18, mounted: false, position: { x: 3, z: -12, yaw: 1 } } } },
        [mission.targetActorIds[0]]: { hp: 0, x: 41, z: 21, yaw: 2, mountHp: 0 } },
      player: { hp: 42, stamina: 13, dead: false, x: 4, z: -10, yaw: 1, ammo: 3, shieldImpact: 7, mountHp: 12,
        mounted: false, mountPosition: { x: 18, y: 3.5, z: -24, yaw: 2.2 } },
      playerStats: { damageDealt: 81, damageTaken: 16, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      wave: 'reinforcement', waveIndex: 8, attackersStarted: true, reinforcementsSpawned: true, gate: { hp: 319, state: 'destroyed' },
    }
    mission.battle = checkpoint
    mission.deadTargetActorIds = [mission.targetActorIds[0]]
    mission.officialSquad!.contribution.damageDealt = 156
    mission.officialSquad!.members = Object.fromEntries(mission.officialSquad!.actorIds.map((id, index) => [id, { status: 'deployed' as const,
      hp: 22 + index, ammo: 5, shieldImpact: 9, order: 'formation' as const,
      formation: { commandId: 91, reached: false, position: { x: 10, z: -12, yaw: 1 } } }]))
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission!.battle).toEqual(checkpoint)
    expect(loaded.activeMission!.battle!.player.mounted).toBe(false)
    expect(loaded.activeMission!.battle!.player.mountPosition).toEqual({ x: 18, y: 3.5, z: -24, yaw: 2.2 })
    expect(loaded.activeMission!.officialSquad).toEqual(mission.officialSquad)
    expect(loaded.activeMission!.deadTargetActorIds).toEqual([mission.targetActorIds[0]])
    expect(createCaptainFrontlineLaunch(loaded)).toMatchObject({ stageId: 9, careerMissionKind: 'captain-outpost-defense', careerMissionId: launch.careerMissionId })
    expect(loaded.completedOutpostStages).toBeUndefined()
    expect(loaded.claimedBattleIds).toEqual([])
    expect(loaded.totalMerit).toBe(5000)
  })
})
