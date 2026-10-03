import { withMissionCheckpoint } from './helpers/missionCheckpoint'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCareerProfile, claimCareerMission, clearCareerMission } from '../src/career/CareerProfile'
import { acceptsCareerMissionStat, createTownDefenseMission } from '../src/career/CareerMissionState'
import {
  TOWN_DEFENSE_ATTACK_GROUPS,
  TOWN_DEFENSE_CIVILIAN_LIMIT,
  TOWN_DEFENSE_LAYOUT,
  TOWN_DEFENSE_PREPARATION_SECONDS,
  civilianShelterSlots,
  horseshoeDefenseSlots,
  createTownDefenseGroups,
  formationSlots,
  resolveTownDefenseOutcome,
  townDefenseEnemyTotals,
} from '../src/career/TownDefenseState'
import { Faction } from '../src/combat/CombatFaction'
import { townRoster } from '../src/town/TownRules'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { NavigationWorld } from '../src/navigation/NavigationWorld'

const stats = (damageDealt = 0, kills = 0, survived = true) => ({ damageDealt, kills, survived, damageTaken: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 })

describe('Recruit Town Defense layout and rosters', () => {
  const roster = townRoster()
  const groups = createTownDefenseGroups(roster)

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

  it('splits the existing 60 garrison into six groups of ten without duplicate actors', () => {
    expect(groups).toHaveLength(6)
    expect(groups.every(group => group.actorIds.length === 10)).toBe(true)
    const ids = groups.flatMap(group => group.actorIds)
    expect(ids).toHaveLength(60)
    expect(new Set(ids).size).toBe(60)
  })

  it('groups swords and spears outside the ranged infantry', () => {
    expect(groups.find(group => group.id === 'A')?.role).toBe('melee-ring')
    expect(groups.find(group => group.id === 'B')?.role).toBe('melee-ring')
    expect(groups.find(group => group.id === 'C')?.role).toBe('ranged-ring')
    expect(groups.find(group => group.id === 'D')?.role).toBe('ranged-ring')
    expect(groups.find(group => group.id === 'B')?.actorIds.every(id => id.startsWith('spearman_infantry'))).toBe(true)
  })

  it('retains converted infantry in the reserve and outer screen under stable actor IDs', () => {
    expect(groups.find(group => group.id === 'E')).toMatchObject({ role: 'reserve', initialOrder: 'DEFEND', mounted: false })
    expect(groups.find(group => group.id === 'E')?.actorIds.filter(id => id.startsWith('lancer_cavalry'))).toHaveLength(5)
    expect(groups.find(group => group.id === 'F')).toMatchObject({ role: 'outer-screen', initialOrder: 'DEFEND', mounted: false })
  })

  it('forms three front-facing horseshoe layers, with spears outside swords and ranged troops', () => {
    const ranged = horseshoeDefenseSlots(20, [10, 13])
    const melee = horseshoeDefenseSlots(11, [18])
    const spears = horseshoeDefenseSlots(10, [24])
    const center = TOWN_DEFENSE_LAYOUT.civilianShelter
    const distance = (point: { x: number; z: number }) => Math.hypot(point.x - center.x, point.z - center.z - 4)
    expect(Math.max(...civilianShelterSlots().map(distance))).toBeLessThan(Math.min(...ranged.map(distance)))
    expect(Math.max(...ranged.map(distance))).toBeLessThan(Math.min(...melee.map(distance)))
    expect(Math.max(...melee.map(distance))).toBeLessThan(Math.min(...spears.map(distance)))
    expect([...ranged, ...melee, ...spears].every(slot => slot.z >= center.z + 4)).toBe(true)
    expect(new Set([...ranged, ...melee, ...spears].map(slot => `${slot.x.toFixed(2)}:${slot.z.toFixed(2)}`)).size).toBe(41)
    expect(new Set(formationSlots(TOWN_DEFENSE_LAYOUT.cavalryReserve, 10, true).map(slot => slot.x)).size).toBe(2)
    const horseArchers = formationSlots(TOWN_DEFENSE_LAYOUT.horseArcherLine, 10, true, 10)
    expect(new Set(horseArchers.map(slot => slot.x)).size).toBe(1)
    expect(horseArchers.every(slot => slot.z > center.z)).toBe(true)
    const civilians = civilianShelterSlots()
    expect(Math.max(...civilians.map(slot => slot.x)) - Math.min(...civilians.map(slot => slot.x))).toBe(8)
    expect(Math.max(...civilians.map(slot => slot.z)) - Math.min(...civilians.map(slot => slot.z))).toBe(6)
  })

  it('defines exactly 70 enemy cavalry with the required composition across three concurrent attack groups', () => {
    expect(TOWN_DEFENSE_ATTACK_GROUPS).toHaveLength(3)
    expect(townDefenseEnemyTotals()).toEqual({ melee: 28, lancer: 21, 'horse-archer': 21 })
    expect(TOWN_DEFENSE_ATTACK_GROUPS.map(group => Object.values(group.composition).reduce((a, b) => a + b, 0))).toEqual([21, 21, 28])
    expect(TOWN_DEFENSE_ATTACK_GROUPS.map(group => group.approach)).toEqual(['southApproach', 'westStableApproach', 'eastBarracksApproach'])
    expect(TOWN_DEFENSE_ATTACK_GROUPS.every(group => !('delaySeconds' in group))).toBe(true)
  })

  it('evacuates exactly 20 ordinary civilians to unique grouped shelter slots', () => {
    expect(roster.filter(actor => actor.role === 'civilian')).toHaveLength(20)
    const slots = civilianShelterSlots()
    expect(slots).toHaveLength(20)
    expect(new Set(slots.map(slot => `${slot.x.toFixed(3)}:${slot.z.toFixed(3)}`)).size).toBe(20)
    expect(slots.every(slot => slot.distanceTo(formationSlots(TOWN_DEFENSE_LAYOUT.townCenter, 1)[0]) < 10)).toBe(true)
  })

  it('keeps the rear open and the horse archers in one line when snapping away from buildings', () => {
    const navigation = new NavigationWorld()
    navigation.sync([
      { box: new THREE.Box3(new THREE.Vector3(-9, -10, -41), new THREE.Vector3(9, 10, -27)), isBarricade: false },
      { box: new THREE.Box3(new THREE.Vector3(-36, -10, -17), new THREE.Vector3(-22, 10, -3)), isBarricade: false },
      { box: new THREE.Box3(new THREE.Vector3(-42, -10, 14), new THREE.Vector3(-26, 10, 27)), isBarricade: false },
    ])
    const actors = roster.filter(spec => Boolean(spec.defenseGroup) || ['captain', 'ranger', 'deployment', 'civilian'].includes(spec.role))
      .map(spec => ({ spec, npc: { dead: false, isMounted: spec.mounted || spec.role === 'captain' || spec.role === 'ranger', mount: null as unknown, assignFormationTarget: vi.fn(), mountVehicle: vi.fn(function (this: any, mount: unknown) { this.mount = mount }) } }))
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    Object.assign(controller, { groups: groups.map(group => ({ id: group.id, members: group.actorIds.map(id => actors.find(actor => actor.spec.id === id)!.npc) })), residents: actors, navigation, blackCat: { dead: false, catVisual: { setEquipmentVisible: vi.fn() } }, commandId: 0 })
    controller.readProfile ??= () => createCareerProfile('roman')
    controller.military.forEach((npc: any) => { npc.beginExternalThreat ??= vi.fn() })
    controller.prepareDeployment()
    const positions = actors.map(actor => actor.npc.assignFormationTarget.mock.lastCall?.[1] as THREE.Vector3)
    expect(positions).toHaveLength(83)
    expect(positions.every(point => point && !navigation.grid.isBlocked(navigation.grid.worldToCell(point)!))).toBe(true)
    expect(new Set(positions.map(point => `${point.x}:${point.z}`)).size).toBe(positions.length)
    const center = TOWN_DEFENSE_LAYOUT.civilianShelter
    const radius = (id: string) => { const point = actors.find(actor => actor.spec.id === id)!.npc.assignFormationTarget.mock.lastCall![1] as THREE.Vector3; return Math.hypot(point.x - center.x, point.z - center.z) }
    expect(radius('spearman_infantry-0')).toBeGreaterThan(radius('melee_infantry-0'))
    expect(radius('melee_infantry-0')).toBeGreaterThan(radius('ranged_infantry-0'))
    expect(radius('deployment')).toBeGreaterThan(radius('ranged_infantry-0'))
    expect(radius('ranger')).toBeGreaterThan(radius('melee_infantry-0'))
    expect(actors.filter(actor => actor.spec.role !== 'civilian').every(actor => actor.npc.assignFormationTarget.mock.lastCall![1].z >= center.z)).toBe(true)
    const horseArchers = actors.filter(actor => actor.spec.defenseGroup === 'F').map(actor => actor.npc.assignFormationTarget.mock.lastCall![1] as THREE.Vector3)
    expect(new Set(horseArchers.map(point => point.x)).size).toBe(1)
  })
})

describe('Recruit Town Defense outcome, orders and rewards', () => {
  it('starts the attack on the countdown even if the player never visits the rally marker', () => {
    expect(TOWN_DEFENSE_PREPARATION_SECONDS).toBe(20)
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'defense-timed-start')
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.blackCat = { dead: false }
    controller.player = () => ({ combatPosition: { distanceTo: () => 1000 } })
    controller.residents = []; controller.enemies = []; controller.attackElapsed = 0
    controller.preparationElapsed = 0; controller.tracker = null
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

  it('starts all 70 attackers together while all defenders hold until a military hit', () => {
    const soldier = () => ({ dead: false, combatPosition: { distanceTo: () => 100 }, setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn() })
    const captain = soldier()
    const groups = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(id => ({ id, members: Array.from({ length: 10 }, soldier) }))
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    controller.groups = groups
    controller.residents = [{ spec: { role: 'captain' }, npc: captain }]
    controller.attackGroups = [21, 21, 28].map(count => ({ members: Array.from({ length: count }, soldier), released: false }))
    controller.reserveCharged = false
    controller.commandId = 0
    controller.readProfile ??= () => createCareerProfile('roman')
    controller.beginAttack()
    expect(captain.setTacticalOrder).not.toHaveBeenCalled()
    expect(groups.flatMap(group => group.members).every(member => member.setTacticalOrder.mock.calls.length === 0)).toBe(true)
    expect(controller.attackGroups.every((group: any) => group.released)).toBe(true)
    expect(controller.attackGroups.flatMap((group: any) => group.members).every((enemy: any) => enemy.setTacticalOrder.mock.lastCall?.[0] === 'charge')).toBe(true)
  })

  it('mounts Maki on the existing black cat, stages them on a separate flank, then joins the attack', () => {
    const roster = townRoster()
    const actor = () => ({ dead: false, mount: null as unknown, assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn(), mountVehicle: vi.fn(function (this: any, mount: unknown) { this.mount = mount }) })
    const residents = roster.filter(spec => Boolean(spec.defenseGroup) || spec.role === 'captain' || spec.role === 'ranger' || spec.role === 'civilian').map(spec => ({ spec, npc: actor() }))
    const blackCat = { dead: false, catVisual: { setEquipmentVisible: vi.fn() } }
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    Object.assign(controller, { groups: [], residents, blackCat, attackGroups: [], commandId: 0, navigation: { grid: { findNearestWalkableCell: () => null } } })
    const byId = new Map(residents.map(resident => [resident.spec.id, resident.npc]))
    controller.groups.push(...createTownDefenseGroups(roster).map(plan => ({ id: plan.id, members: plan.actorIds.map(id => byId.get(id)) })))
    controller.attackGroups = []
    controller.readProfile ??= () => createCareerProfile('roman')
    controller.military.forEach((npc: any) => { npc.beginExternalThreat ??= vi.fn() })
    controller.prepareDeployment()
    const ranger = residents.find(resident => resident.spec.role === 'ranger')!.npc
    expect(ranger.mountVehicle).toHaveBeenCalledExactlyOnceWith(blackCat)
    expect(blackCat.catVisual.setEquipmentVisible).toHaveBeenCalledWith(true)
    expect(ranger.assignFormationTarget.mock.lastCall?.[1]).toMatchObject({ x: TOWN_DEFENSE_LAYOUT.rangerFlank.x, z: TOWN_DEFENSE_LAYOUT.rangerFlank.z })
    expect(ranger.assignFormationTarget.mock.lastCall?.[4]).toBe('defend')
    controller.readProfile ??= () => createCareerProfile('roman')
    controller.beginAttack()
    expect(ranger.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('attacks with foot soldiers and leaders while cavalry charge exactly once on military damage', () => {
    const soldier = () => ({ dead: false, setTacticalOrder: vi.fn() })
    const captain = soldier(), ranger = soldier(), sergeant = soldier(), civilian = soldier(), outsider = soldier()
    const groups = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(id => ({ id, members: Array.from({ length: 10 }, soldier) }))
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], [], 'first-hit-charge')
    profile.activeMission.phase = 'ATTACKING'
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    Object.assign(controller, { groups, residents: [{ spec: { role: 'captain' }, npc: captain }, { spec: { role: 'ranger' }, npc: ranger }, { spec: { role: 'deployment' }, npc: sergeant }, { spec: { role: 'civilian' }, npc: civilian }], reserveCharged: false })
    controller.readProfile = () => profile
    controller.persistRuntimeProgress = vi.fn()
    controller.noteEffectiveFriendlyDamage(civilian)
    controller.noteEffectiveFriendlyDamage(outsider)
    expect(controller.reserveHasCharged).toBe(false)
    expect(groups.flatMap(group => group.members).every(member => member.setTacticalOrder.mock.calls.length === 0)).toBe(true)
    profile.activeMission.phase = 'FAILURE_LOCKED'
    controller.noteEffectiveFriendlyDamage(groups[0].members[0])
    expect(controller.reserveHasCharged).toBe(true)
    expect(captain.setTacticalOrder).toHaveBeenLastCalledWith('attack')
    expect(ranger.setTacticalOrder).toHaveBeenLastCalledWith('attack')
    expect(sergeant.setTacticalOrder).toHaveBeenLastCalledWith('attack')
    expect(groups.find(group => group.id === 'E')!.members.every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'charge')).toBe(true)
    expect(groups.filter(group => group.id !== 'E').flatMap(group => group.members).every(member => member.setTacticalOrder.mock.lastCall?.[0] === 'attack')).toBe(true)
    expect(controller.persistRuntimeProgress).toHaveBeenCalledOnce()
    controller.noteEffectiveFriendlyDamage(groups[1].members[0])
    expect(controller.persistRuntimeProgress).toHaveBeenCalledOnce()

    profile = { ...profile, activeMission: { ...profile.activeMission!, defenseReserveCharged: true } }
    expect(parseCareerProfile(JSON.parse(JSON.stringify(profile)))?.activeMission?.defenseReserveCharged).toBe(true)
  })

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
    expect(profile.activeMission?.deadTargetActorIds).toHaveLength(50)
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
      blackCat: { dead: true }, attackElapsed: 1, preparationElapsed: TOWN_DEFENSE_PREPARATION_SECONDS,
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

  it('persists the sergeant death and restores it as dead on Town Defense reload', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission([...townRoster().filter(actor => Boolean(actor.defenseGroup)).map(actor => actor.id), 'captain', 'ranger', 'deployment'], [], 'sergeant-reload')
    profile.activeMission.phase = 'ATTACKING'
    const roster = townRoster()
    const residents = roster.filter(spec => Boolean(spec.defenseGroup) || spec.role === 'captain' || spec.role === 'ranger' || spec.role === 'deployment')
      .map(spec => ({ spec, npc: { combatantId: spec.id, dead: spec.role === 'deployment', takeDamage: vi.fn(function (this: any) { this.dead = true }) } }))
    const controller = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    controller.player = () => ({ dead: false })
    Object.assign(controller, { residents, enemies: [], enemyMounts: [], groups: createTownDefenseGroups(roster).map(plan => ({ id: plan.id, members: plan.actorIds.map(id => residents.find(resident => resident.spec.id === id)!.npc) })), attackElapsed: 1, preparationElapsed: 45, tracker: null, blackCat: { dead: false } })
    controller.readProfile = () => profile
    controller.commit = (next: typeof profile) => { profile = next; return true }
    controller.persistRuntimeProgress()
    expect(profile.activeMission.deadFriendlyActorIds).toContain('deployment')
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const reloaded = withMissionCheckpoint(Object.create(TownDefenseController.prototype)) as any
    const sergeant = residents.find(resident => resident.spec.role === 'deployment')!.npc
    sergeant.dead = false
    Object.assign(reloaded, { civilianCombat: new Set(), residents, enemies: [], enemyMounts: [], groups: [], blackCat: { dead: false }, events: new CombatEventStream() })
    reloaded.readProfile = () => profile
    reloaded.player = () => ({ dead: false })
    reloaded.spawnAttackers = vi.fn(); reloaded.prepareDeployment = vi.fn(); reloaded.beginAttack = vi.fn()
    expect(reloaded.startActiveMission()).toBe(true)
    expect(sergeant.takeDamage).toHaveBeenCalledWith(999999)
    expect(sergeant.dead).toBe(true)
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
    expect(mission.targetActorIds).toHaveLength(50)
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
    expect(townRoster()).toHaveLength(185)
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
