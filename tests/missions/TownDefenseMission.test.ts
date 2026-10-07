import { withMissionCheckpoint } from '../helpers/missionCheckpoint'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCareerProfile, claimCareerMission, clearCareerMission } from '../../src/career/CareerProfile'
import { acceptsCareerMissionStat, createTownDefenseMission } from '../../src/career/CareerMissionState'
import {
  TOWN_DEFENSE_CIVILIAN_LIMIT,
  TOWN_DEFENSE_LAYOUT,
  civilianShelterSlots,
  resolveTownDefenseOutcome,
} from '../../src/career/TownDefenseState'
import { Faction } from '../../src/combat/CombatFaction'
import { townRoster } from '../../src/town/TownRules'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'

const stats = (damageDealt = 0, kills = 0, survived = true) => ({ damageDealt, kills, survived, damageTaken: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 })

describe('Town Siege civilians', () => {
  const roster = townRoster()

  it('arms civilians when enemies reach ten metres and returns them to shelter beyond that range', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission([], [], 'civilian-range')
    const civilian = { townCategory: 'civilian', dead: false, hostileToPlayer: false, combatPosition: new THREE.Vector3(), armTownCivilian: vi.fn(), setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn() }
    const enemy = { combatPosition: new THREE.Vector3(10, 0, 0) }
    const controller = Object.assign(withMissionCheckpoint(Object.create(TownDefenseController.prototype)), {
      readProfile: () => profile, player: () => ({ dead: true }), peersFor: () => [enemy],
      residents: [{ spec: { role: 'civilian' }, npc: civilian }], civilianCombat: new Set(), commandId: 1,
      walkable: vi.fn(() => new THREE.Vector3()),
    })
    controller.updateCivilianOrder(civilian)
    expect(civilian.armTownCivilian).not.toHaveBeenCalled()
    profile.activeMission.phase = 'ATTACKING'
    enemy.combatPosition.x = 10.01
    controller.updateCivilianOrder(civilian)
    expect(civilian.armTownCivilian).not.toHaveBeenCalled()
    enemy.combatPosition.x = 10
    controller.updateCivilianOrder(civilian)
    expect(civilian.armTownCivilian).toHaveBeenCalledWith('gladius_rusty')
    expect(civilian.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('attack')
    enemy.combatPosition.x = 9
    controller.updateCivilianOrder(civilian)
    expect(civilian.setTacticalOrder).toHaveBeenCalledOnce()
    enemy.combatPosition.x = 10.01
    controller.updateCivilianOrder(civilian)
    expect(civilian.assignFormationTarget).toHaveBeenCalledOnce()
  })

  it('evacuates exactly 20 ordinary civilians to unique grouped shelter slots', () => {
    expect(roster.filter(actor => actor.role === 'civilian')).toHaveLength(20)
    const slots = civilianShelterSlots()
    expect(slots).toHaveLength(20)
    expect(new Set(slots.map(slot => `${slot.x.toFixed(3)}:${slot.z.toFixed(3)}`)).size).toBe(20)
    expect(slots.every(slot => slot.distanceTo(new THREE.Vector3()) < 10)).toBe(true)
  })

})

describe('Town Siege outcomes and rewards', () => {
  it('accounts for stable attacker ids without double-counting persisted deaths', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'defense-registration')
    profile.activeMission.phase = 'ATTACKING'
    const player = { dead: false } as any
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as TownDefenseController & Record<string, any>
    Object.assign(controller, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, blackCat: { dead: false } })
    ;(controller as any).player = () => player; (controller as any).readProfile = () => profile; (controller as any).commit = (next: typeof profile) => { profile = next; return true }
    controller.enemies.push(...profile.activeMission.targetActorIds.map(combatantId => ({ combatantId, dead: false }) as any))

    controller.enemies[0].dead = true
    ;(controller as any).persistRuntimeProgress()
    expect(profile.activeMission?.deadTargetActorIds).toEqual([profile.activeMission?.targetActorIds[0]])
    for (const enemy of controller.enemies) enemy.dead = true
    ;(controller as any).persistRuntimeProgress()
    expect(profile.activeMission?.deadTargetActorIds).toHaveLength(120)
    expect(controller.evaluate(false)).toBe('victory')

    const saved = profile
    const reloaded = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as TownDefenseController & Record<string, any>
    Object.assign(reloaded, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, blackCat: { dead: false } })
    ;(reloaded as any).player = () => player; (reloaded as any).readProfile = () => profile; (reloaded as any).commit = (next: typeof profile) => { profile = next; return true }
    profile = { ...saved, activeMission: { ...saved.activeMission!, deadTargetActorIds: [saved.activeMission!.targetActorIds[0]] } }
    reloaded.enemies.push(...profile.activeMission!.targetActorIds.slice(1).map(combatantId => ({ combatantId, dead: true }) as any))
    ;(reloaded as any).persistRuntimeProgress()
    expect(reloaded.evaluate(false)).toBe('victory')
  })

  it('checkpoints and resumes Town Defense player contribution without deriving kills from casualties', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'defense-stats')
    profile.activeMission.phase = 'ATTACKING'
    const active = profile.activeMission
    const events = new CombatEventStream()
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as TownDefenseController & Record<string, any>
    Object.assign(controller, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, blackCat: { dead: false } })
    ;(controller as any).checkpoint.advance(5)
    ;(controller as any).player = () => ({ dead: false }); (controller as any).readProfile = () => profile; (controller as any).commit = (next: typeof profile) => { profile = next; return true }
    ;(controller as any).tracker = new BattleStatsTracker(events, false, event => acceptsCareerMissionStat(active, event))
    const source = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'roman' as const }
    const target = { targetId: active.targetActorIds[0], targetType: 'npc' as const, name: 'Raider' }
    events.emit({ type: 'damage_applied', source, target, method: 'projectile', requestedDamage: 90, appliedDamage: 90 })
    events.emit({ type: 'actor_killed', source, target, method: 'projectile' })
    ;(controller as any).persistRuntimeProgress()
    expect(profile.activeMission?.playerStats).toMatchObject({ damageDealt: 90, kills: 1 })

    const resumedEvents = new CombatEventStream()
    const resumed = new BattleStatsTracker(resumedEvents, false, event => acceptsCareerMissionStat(profile.activeMission!, event), profile.activeMission?.playerStats)
    resumedEvents.emit({ type: 'damage_applied', source, target: { ...target, targetId: active.targetActorIds[1] }, method: 'melee', requestedDamage: 35, appliedDamage: 35 })
    expect(resumed.checkpoint()).toMatchObject({ damageDealt: 125, kills: 1 })
  })

  it('persists Maki death and black-cat death separately for Town Defense reload', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain', 'ranger'], [], 'ranger-cat-reload')
    profile.activeMission.phase = 'ATTACKING'
    const ranger = { combatantId: 'ranger', dead: true }
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    Object.assign(controller, {
      residents: [{ spec: { role: 'ranger' }, npc: ranger }], enemies: [], groups: [],
      blackCat: { dead: true }, attackElapsed: 1, preparationElapsed: 1,
      tracker: null,
    })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.persistRuntimeProgress()
    expect(profile.activeMission?.deadFriendlyActorIds).toContain('ranger')
    expect(profile.activeMission?.defenseCatDead).toBe(true)
    const parsed = parseCareerProfile(JSON.parse(JSON.stringify(profile)))
    expect(parsed?.activeMission?.deadFriendlyActorIds).toContain('ranger')
    expect(parsed?.activeMission?.defenseCatDead).toBe(true)
  })

  it('allows ten civilian deaths but locks failure at eleven', () => {
    expect(resolveTownDefenseOutcome(false, TOWN_DEFENSE_CIVILIAN_LIMIT, true, 0)).toBe('victory')
    expect(resolveTownDefenseOutcome(false, TOWN_DEFENSE_CIVILIAN_LIMIT + 1, true, 0)).toBe('failure')
  })

  it('prioritizes defeated enemies over player and captain casualties', () => {
    expect(resolveTownDefenseOutcome(true, 0, true, 0)).toBe('victory')
    expect(resolveTownDefenseOutcome(false, 0, true, 0)).toBe('victory')
  })

  it('waits for all 70 registered attackers and all remaining enemies', () => {
    expect(resolveTownDefenseOutcome(false, 0, false, 0)).toBeNull()
    expect(resolveTownDefenseOutcome(false, 0, true, 1)).toBeNull()
    expect(resolveTownDefenseOutcome(false, 0, true, 0)).toBe('victory')
  })

  it('creates Recruit rosters for 50 enemies, 60 garrison plus captain, Maki and sergeant, and 20 civilians', () => {
    const roster = townRoster()
    const military = roster.filter(actor => Boolean(actor.defenseGroup) || actor.role === 'captain' || actor.role === 'ranger' || actor.role === 'deployment').map(actor => actor.id)
    const civilians = roster.filter(actor => actor.role === 'civilian').map(actor => actor.id)
    const mission = createTownDefenseMission(military, civilians, 'defense-stable')
    expect(mission.kind).toBe('town-defense')
    expect(mission.targetActorIds).toHaveLength(120)
    expect(mission.friendlyActorIds).toHaveLength(63)
    expect(mission.friendlyActorIds).toContain('ranger')
    expect(mission.friendlyActorIds).toContain('deployment')
    expect(mission.civilianActorIds).toHaveLength(20)
  })

  it('awards zero merit for a successful spectator defense', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(Array.from({ length: 61 }, (_, i) => `friendly-${i}`), Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'defense-zero')
    const claim = claimCareerMission(profile, 'defense-zero', 'victory', stats())
    expect(claim.meritAwarded).toBe(0)
    expect(claim.profile.completedCareerMissionTemplateIds).toEqual(['veteran-town-defense-01'])
  })

  it('calibrates normal participation to roughly 30–45 merit without a fixed completion grant', () => {
    const profile = createCareerProfile('viking')
    profile.activeMission = createTownDefenseMission(Array.from({ length: 61 }, (_, i) => `friendly-${i}`), Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'defense-normal')
    const claim = claimCareerMission(profile, 'defense-normal', 'victory', stats(300, 2))
    expect(claim.meritAwarded).toBeGreaterThanOrEqual(30)
    expect(claim.meritAwarded).toBeLessThanOrEqual(45)
    expect(claim.profile.rank).toBe('recruit')
  })

  it('does not attribute friendly damage or kills to the player', () => {
    const mission = createTownDefenseMission(['captain'], ['civilian-0'], 'defense-attribution')
    const event = { type: 'actor_killed' as const, source: { actorId: 'captain', actorType: 'npc' as const, allegiance: Faction.TOWN, characterFaction: 'roman' as const }, target: { targetId: mission.targetActorIds[0], targetType: 'npc' as const, name: 'Raider' }, method: 'melee' as const }
    expect(acceptsCareerMissionStat(mission, event)).toBe(false)
  })

  it('claims a reloaded result only once', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], ['civilian-0'], 'defense-once')
    const first = claimCareerMission(profile, 'defense-once', 'victory', stats(300, 2))
    const duplicate = claimCareerMission(first.profile, 'defense-once', 'victory', stats(999, 10))
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.profile.totalMerit).toBe(first.profile.totalMerit)
  })

  it('restores peaceful population by clearing only the mission while preserving career ownership', () => {
    const profile = createCareerProfile('roman'); profile.ownedMounts = ['horse']
    profile.activeMission = createTownDefenseMission(['captain'], ['civilian-0'], 'defense-reset')
    const reset = clearCareerMission(profile, 'defense-reset')
    expect(reset.activeMission).toBeUndefined()
    expect(reset.ownedMounts).toEqual(['horse'])
    expect(townRoster()).toHaveLength(225)
  })

  it('never creates or clears Town Crime state as part of mission claiming/reset', () => {
    const profile = createCareerProfile('roman')
    profile.townEvent = { id: 'crime', state: 'hostile' }
    profile.activeMission = createTownDefenseMission(['captain'], ['civilian-0'], 'defense-crime')
    const claim = claimCareerMission(profile, 'defense-crime', 'failure', stats(0, 0, false))
    expect(claim.profile.townEvent).toEqual({ id: 'crime', state: 'hostile' })
    expect(clearCareerMission(claim.profile, 'defense-crime').townEvent).toEqual({ id: 'crime', state: 'hostile' })
  })
})
