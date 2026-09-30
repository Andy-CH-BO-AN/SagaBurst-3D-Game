import { describe, expect, it, vi } from 'vitest'
import { createCareerProfile, claimCareerMission, clearCareerMission } from '../src/career/CareerProfile'
import { acceptsCareerMissionStat, createTownDefenseMission } from '../src/career/CareerMissionState'
import {
  TOWN_DEFENSE_ATTACK_GROUPS,
  TOWN_DEFENSE_CIVILIAN_LIMIT,
  TOWN_DEFENSE_LAYOUT,
  TOWN_DEFENSE_PREPARATION_SECONDS,
  civilianShelterSlots,
  createTownDefenseGroups,
  formationSlots,
  resolveTownDefenseOutcome,
  shouldChargeReserve,
  townDefenseEnemyTotals,
} from '../src/career/TownDefenseState'
import { Faction } from '../src/combat/CombatFaction'
import { townRoster } from '../src/town/TownRules'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { parseCareerProfile } from '../src/career/CareerProfileStore'

const stats = (damageDealt = 0, kills = 0, survived = true) => ({ damageDealt, kills, survived, damageTaken: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 })

describe('Recruit Town Defense layout and rosters', () => {
  const roster = townRoster()
  const groups = createTownDefenseGroups(roster)

  it('splits the existing 60 garrison into six groups of ten without duplicate actors', () => {
    expect(groups).toHaveLength(6)
    expect(groups.every(group => group.actorIds.length === 10)).toBe(true)
    const ids = groups.flatMap(group => group.actorIds)
    expect(ids).toHaveLength(60)
    expect(new Set(ids).size).toBe(60)
  })

  it('binds A/C to the south line and B/D to the west line', () => {
    expect(groups.find(group => group.id === 'A')?.anchor).toBe('southMeleeLine')
    expect(groups.find(group => group.id === 'C')?.anchor).toBe('southRangedLine')
    expect(groups.find(group => group.id === 'B')?.anchor).toBe('westMeleeLine')
    expect(groups.find(group => group.id === 'D')?.anchor).toBe('westRangedLine')
  })

  it('keeps E as a reserve and F as a mounted archer flank', () => {
    expect(groups.find(group => group.id === 'E')).toMatchObject({ role: 'reserve', initialOrder: 'DEFEND', mounted: true })
    expect(groups.find(group => group.id === 'F')).toMatchObject({ role: 'mounted-flank', initialOrder: 'SKIRMISH', mounted: true })
  })

  it('uses semantic anchors and produces 2x5 infantry and 2-column cavalry slots', () => {
    expect(TOWN_DEFENSE_LAYOUT.southApproach.z).toBeGreaterThan(TOWN_DEFENSE_LAYOUT.southMeleeLine.z)
    expect(formationSlots(TOWN_DEFENSE_LAYOUT.southMeleeLine, 10)).toHaveLength(10)
    expect(new Set(formationSlots(TOWN_DEFENSE_LAYOUT.cavalryReserve, 10, true).map(slot => slot.x)).size).toBe(2)
    expect(formationSlots(TOWN_DEFENSE_LAYOUT.cavalryReserve, 10, true).every(slot => slot.distanceTo(formationSlots(TOWN_DEFENSE_LAYOUT.captainReserve, 1, true)[0]) > 8)).toBe(true)
  })

  it('defines exactly 50 enemy cavalry with the required composition across three concurrent attack groups', () => {
    expect(TOWN_DEFENSE_ATTACK_GROUPS).toHaveLength(3)
    expect(townDefenseEnemyTotals()).toEqual({ melee: 20, lancer: 15, 'horse-archer': 15 })
    expect(TOWN_DEFENSE_ATTACK_GROUPS.map(group => Object.values(group.composition).reduce((a, b) => a + b, 0))).toEqual([15, 15, 20])
    expect(TOWN_DEFENSE_ATTACK_GROUPS.map(group => group.delaySeconds)).toEqual([0, 10, 22])
  })

  it('evacuates exactly 20 ordinary civilians to unique grouped shelter slots', () => {
    expect(roster.filter(actor => actor.role === 'civilian')).toHaveLength(20)
    const slots = civilianShelterSlots()
    expect(slots).toHaveLength(20)
    expect(new Set(slots.map(slot => `${slot.x.toFixed(3)}:${slot.z.toFixed(3)}`)).size).toBe(20)
    expect(slots.every(slot => slot.distanceTo(formationSlots(TOWN_DEFENSE_LAYOUT.townCenter, 1)[0]) < 10)).toBe(true)
  })
})

describe('Recruit Town Defense outcome, orders and rewards', () => {
  it('starts the attack on the countdown even if the player never visits the rally marker', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'defense-timed-start')
    const controller = Object.create(TownDefenseController.prototype) as any
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.player = () => ({ combatPosition: { distanceTo: () => 1000 } })
    controller.residents = []; controller.enemies = []; controller.attackElapsed = 0
    controller.preparationElapsed = 0; controller.statsCheckpointElapsed = 0; controller.tracker = null
    controller.guide = { updateTownDefense: vi.fn() }
    controller.beginAttack = vi.fn(); controller.persistRuntimeProgress = vi.fn()
    controller.updateFlow(TOWN_DEFENSE_PREPARATION_SECONDS - .1, 0)
    expect(profile.activeMission.phase).toBe('PREPARING')
    controller.updateFlow(.1, 0)
    expect(profile.activeMission.phase).toBe('ATTACKING')
    expect(controller.beginAttack).toHaveBeenCalledOnce()
    expect(profile.activeMission.defensePreparationElapsed).toBeCloseTo(TOWN_DEFENSE_PREPARATION_SECONDS)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(profile)))?.activeMission?.defensePreparationElapsed).toBeCloseTo(TOWN_DEFENSE_PREPARATION_SECONDS)
  })

  it('holds the frontline while the first defender death sends captain and cavalry to charge', () => {
    const soldier = () => ({ dead: false, combatPosition: { distanceTo: () => 100 }, setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn() })
    const captain = soldier()
    const groups = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(id => ({ id, members: Array.from({ length: 10 }, soldier) }))
    const controller = Object.create(TownDefenseController.prototype) as any
    controller.groups = groups
    controller.residents = [{ spec: { role: 'captain' }, npc: captain }]
    controller.attackGroups = []
    controller.reserveCharged = false
    controller.issueCombatOrders()
    expect(captain.setTacticalOrder).toHaveBeenLastCalledWith('defend')
    expect(groups.find(group => group.id === 'E')!.members.every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'defend')).toBe(true)

    groups[0].members[0].dead = true
    controller.updateScriptedDefense()
    expect(captain.setTacticalOrder).toHaveBeenLastCalledWith('charge')
    expect(groups.find(group => group.id === 'E')!.members.every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'charge')).toBe(true)
    expect(groups.filter(group => group.id !== 'E').flatMap(group => group.members).every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'attack')).toBe(true)
    expect(groups.slice(0, 4).flatMap(group => group.members).every(member => member.assignFormationTarget.mock.calls.length === 0)).toBe(true)
    controller.issueCombatOrders()
    expect(captain.setTacticalOrder).toHaveBeenLastCalledWith('charge')
    expect(groups.find(group => group.id === 'E')!.members.every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'charge')).toBe(true)
  })

  it('accounts for stable attacker ids without double-counting persisted deaths', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'defense-registration')
    profile.activeMission.phase = 'ATTACKING'
    const player = { dead: false } as any
    const controller = Object.create(TownDefenseController.prototype) as TownDefenseController & Record<string, any>
    Object.assign(controller, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, statsCheckpointElapsed: 0 })
    ;(controller as any).player = () => player; (controller as any).readProfile = () => profile; (controller as any).commit = (next: typeof profile) => { profile = next; return true }
    controller.enemies.push(...profile.activeMission.targetActorIds.map(combatantId => ({ combatantId, dead: false }) as any))

    controller.enemies[0].dead = true
    ;(controller as any).persistRuntimeProgress()
    expect(profile.activeMission?.deadTargetActorIds).toEqual([profile.activeMission?.targetActorIds[0]])
    for (const enemy of controller.enemies) enemy.dead = true
    ;(controller as any).persistRuntimeProgress()
    expect(profile.activeMission?.deadTargetActorIds).toHaveLength(50)
    expect(controller.evaluate(false)).toBe('victory')

    const saved = profile
    const reloaded = Object.create(TownDefenseController.prototype) as TownDefenseController & Record<string, any>
    Object.assign(reloaded, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, statsCheckpointElapsed: 0 })
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
    const controller = Object.create(TownDefenseController.prototype) as TownDefenseController & Record<string, any>
    Object.assign(controller, { residents: [], enemies: [], groups: [], attackElapsed: 0, tracker: null, statsCheckpointElapsed: 5 })
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

  it('allows ten civilian deaths but locks failure at eleven', () => {
    expect(resolveTownDefenseOutcome(false, TOWN_DEFENSE_CIVILIAN_LIMIT, true, 0)).toBe('victory')
    expect(resolveTownDefenseOutcome(false, TOWN_DEFENSE_CIVILIAN_LIMIT + 1, true, 0)).toBe('failure')
  })

  it('gives player death priority while captain death is absent from the outcome contract', () => {
    expect(resolveTownDefenseOutcome(true, 0, true, 0)).toBe('failure')
    expect(resolveTownDefenseOutcome(false, 0, true, 0)).toBe('victory')
  })

  it('waits for all 50 registered attackers and all remaining enemies', () => {
    expect(resolveTownDefenseOutcome(false, 0, false, 0)).toBeNull()
    expect(resolveTownDefenseOutcome(false, 0, true, 1)).toBeNull()
    expect(resolveTownDefenseOutcome(false, 0, true, 0)).toBe('victory')
  })

  it('triggers the reserve charge only on the first friendly death', () => {
    expect(shouldChargeReserve(false, false)).toBe(false)
    expect(shouldChargeReserve(false, true)).toBe(true)
    expect(shouldChargeReserve(true, true)).toBe(false)
  })

  it('creates stable mission rosters for 50 enemies, 61 military defenders, and 20 civilians', () => {
    const roster = townRoster()
    const military = roster.filter(actor => actor.role.includes('_') || actor.role === 'captain').map(actor => actor.id)
    const civilians = roster.filter(actor => actor.role === 'civilian').map(actor => actor.id)
    const mission = createTownDefenseMission(military, civilians, 'defense-stable')
    expect(mission.kind).toBe('town-defense')
    expect(mission.targetActorIds).toHaveLength(50)
    expect(mission.friendlyActorIds).toHaveLength(61)
    expect(mission.civilianActorIds).toHaveLength(20)
  })

  it('awards zero merit for a successful spectator defense', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(Array.from({ length: 61 }, (_, i) => `friendly-${i}`), Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'defense-zero')
    const claim = claimCareerMission(profile, 'defense-zero', 'victory', stats())
    expect(claim.meritAwarded).toBe(0)
    expect(claim.profile.completedCareerMissionTemplateIds).toEqual(['recruit-town-defense-01'])
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
    expect(townRoster()).toHaveLength(85)
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
