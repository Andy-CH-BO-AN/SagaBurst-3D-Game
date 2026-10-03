import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createCampaignOutpost } from '../campaign/CampaignOutpost'
import { BattleStatsTracker } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatActorRef } from '../combat/CombatAttribution'
import { damageObstacle } from '../combat/DamageRouter'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { Faction } from '../world/NPC'
import type { Player } from '../player/Player'
import { acceptsCareerMissionStat } from './CareerMissionState'
import { claimCareerMission, createCareerProfile } from './CareerProfile'
import { parseCareerProfile } from './CareerProfileStore'
import { acceptVeteranMission } from './VeteranMission'

function assault(faction: 'roman' | 'viking') {
  return acceptVeteranMission({
    ...createCareerProfile(faction), rank: 'veteran', totalMerit: 900, availableMerit: 900,
    ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept',
    ],
  }, 'veteran-outpost-assault', { missionId: 'structure-assault', acceptedAt: 1 })!
}

describe('Career Outpost assault structure contribution', () => {
  it.each(['roman', 'viking'] as const)('counts actual enemy Outpost damage and persists %s merit exactly once', faction => {
    const profile = assault(faction)
    const mission = profile.activeMission!
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event))
    const outpost = createCampaignOutpost(new THREE.Scene(), faction === 'roman' ? 'viking' : 'roman')
    const source: CombatActorRef = { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: faction }
    let damage = 0
    for (const kind of ['gate', 'palisade', 'chevaux_de_frise', 'tent', 'campfire'] as const) {
      const obstacle = outpost.damageableObstacles.find(candidate => candidate.kind === kind)!
      damage += obstacle.maxHp
      damageObstacle(obstacle, obstacle.maxHp + 100, { source, method: 'melee', emit: events.emit })
      damageObstacle(obstacle, 100, { source, method: 'melee', emit: events.emit })
    }
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, structureDamage: damage, structuresDestroyed: 5, gateBreaches: 1 })

    profile.activeMission!.playerStats = tracker.checkpoint()
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const resumedEvents = new CombatEventStream()
    const resumed = new BattleStatsTracker(resumedEvents, true, event => acceptsCareerMissionStat(loaded.activeMission!, event), loaded.activeMission!.playerStats)
    const remainingWall = outpost.damageableObstacles.find(candidate => candidate.kind === 'palisade' && !candidate.destroyed)!
    damageObstacle(remainingWall, 40, { source, method: 'projectile', emit: resumedEvents.emit })
    damage += 40
    const stats = resumed.snapshot([], { dead: false } as Player).player
    const claim = claimCareerMission(loaded, mission.id, 'victory', stats)
    const expectedMerit = Math.floor(damage / 20) + 80 + 20 + 25
    expect(claim.meritAwarded).toBe(expectedMerit)
    expect(claim.profile.activeMission!.result!.merit.damage).toBe(Math.floor(damage / 20))
    expect(claim.profile.totalMerit).toBe(900 + expectedMerit)
    expect(claim.profile.availableMerit).toBe(900 + expectedMerit)
    expect(claim.profile.lifetimeStats).toMatchObject({ structureDamage: damage, breaches: 1 })
    const settled = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(settled.activeMission!.result!.stats.structureDamage).toBe(damage)
    const duplicate = claimCareerMission(settled, mission.id, 'victory', stats)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(settled.totalMerit)
    expect(claimCareerMission(loaded, mission.id, 'failure', { ...stats, survived: false }).meritAwarded)
      .toBe(Math.floor(damage / 20) + 25)
    tracker.dispose()
    resumed.dispose()
  })

  it('excludes friendly and neutral structures, AI contribution, and defense missions', () => {
    const mission = assault('roman').activeMission!
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event))
    const source: CombatActorRef = { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' }
    for (const ownerFaction of ['roman', null] as const) {
      const obstacle = new DamageableObstacle({ kind: 'tent', root: new THREE.Group(), maxHp: 40, ownerFaction })
      damageObstacle(obstacle, 40, { source, method: 'melee', emit: events.emit })
    }
    const enemy = createCampaignOutpost(new THREE.Scene(), 'viking')
    damageObstacle(enemy.gate, 40, { source: { ...source, actorId: 'ally', actorType: 'npc' }, method: 'melee', emit: events.emit })
    expect(tracker.checkpoint().structureDamage).toBe(0)
    const defense = { ...mission, kind: 'veteran-outpost-defense' as const }
    events.subscribe(event => expect(acceptsCareerMissionStat(defense, event)).toBe(false))
    damageObstacle(enemy.gate, 20, { source, method: 'melee', emit: events.emit })
    expect(tracker.checkpoint().structureDamage).toBe(20)
    tracker.dispose()
  })
})
