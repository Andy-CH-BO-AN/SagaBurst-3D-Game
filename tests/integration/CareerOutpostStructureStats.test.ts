import * as THREE from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createCampaignOutpost } from '../../src/campaign/CampaignOutpost'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream, type CombatActorRef } from '../../src/combat/CombatAttribution'
import { damageObstacle } from '../../src/combat/DamageRouter'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { Faction } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { acceptsCareerMissionStat } from '../../src/career/CareerMissionState'
import { claimCareerMission, createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { acceptVeteranMission } from '../../src/career/VeteranMission'

function assault(faction: 'roman' | 'viking') {
  return acceptVeteranMission({
    ...createCareerProfile(faction), rank: 'veteran', totalMerit: 900, availableMerit: 900,
    ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept',
    ],
  }, 'veteran-outpost-assault', { missionId: 'structure-assault', acceptedAt: 1 })!
}

describe('Career Outpost assault structure contribution', () => {
  it('counts actual enemy Outpost damage and persists merit exactly once', () => {
    const faction = 'roman'
    const profile = assault(faction)
    const mission = profile.activeMission!
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, event => acceptsCareerMissionStat(mission, event))
    onTestFinished(() => tracker.dispose())
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
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    const resumedEvents = new CombatEventStream()
    const resumed = new BattleStatsTracker(resumedEvents, true, event => acceptsCareerMissionStat(loaded.activeMission!, event), loaded.activeMission!.playerStats)
    onTestFinished(() => resumed.dispose())
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
    expect(store.save(claim.profile)).toBe(true)
    const settled = store.load()!
    expect(settled.activeMission!.result!.stats.structureDamage).toBe(damage)
    const duplicate = claimCareerMission(settled, mission.id, 'victory', stats)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(settled.totalMerit)
    expect(claimCareerMission(loaded, mission.id, 'failure', { ...stats, survived: false }).meritAwarded)
      .toBe(Math.floor(damage / 20) + 25)

  })

  it.each([
    { faction: 'roman', enemyFaction: 'viking' },
    { faction: 'viking', enemyFaction: 'roman' },
  ] as const)('accepts $faction contribution only against $enemyFaction structures without replaying damage and settlement', ({ faction, enemyFaction }) => {
    const mission = assault(faction).activeMission!
    const source: CombatActorRef = { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: faction }
    const event = {
      type: 'structure_damaged' as const, source, method: 'melee' as const,
      target: { targetId: 'gate', targetType: 'structure' as const, name: 'gate', characterFaction: enemyFaction },
      requestedDamage: 40, appliedDamage: 40, hpRatio: .5,
    }
    expect(acceptsCareerMissionStat(mission, event)).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { ...event.target, characterFaction: faction } })).toBe(false)
    expect(acceptsCareerMissionStat(mission, { ...event, source: { ...source, actorId: 'ally', actorType: 'npc' } })).toBe(false)
    expect(acceptsCareerMissionStat({ ...mission, kind: 'veteran-outpost-defense' }, event)).toBe(false)
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
