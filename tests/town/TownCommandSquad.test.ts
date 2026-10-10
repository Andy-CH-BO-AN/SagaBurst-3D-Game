import * as THREE from 'three'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { createCareerProfile, cloneCareerProfile, claimCareerMission } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { CaptainPatrolCommandController, resolveCaptainPatrolCommandOutcome } from '../../src/career/CaptainPatrolCommandController'
import { TownCommandSquadController, TOWN_COMMAND_RETURN_ID } from '../../src/town/TownCommandSquadController'
import { TownScene } from '../../src/town/TownScene'
import { createArmyCommandHarness } from '../helpers/armyCommandHarness'
import type { ArmyHudRoster } from '../../src/battle/ArmyCommandHudRoster'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TownEvent, townCommandSquadRoster, townRoster, townSitePoint, type TownActorSpec } from '../../src/town/TownRules'
import { Faction, type NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { getTerrainHeight } from '../../src/world/Terrain'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'

/** Recording resident boundary: 0 real NPC/0 Mount/0 world. It verifies ownership and saved state, not locomotion. */
function resident(spec: TownActorSpec) {
  const group = new THREE.Group(); group.position.set(spec.x, getTerrainHeight(spec.x, spec.z), spec.z)
  const homeMount = spec.mounted ? { group: new THREE.Group(), currentHp: 61, maxHp: 100, dead: false, disposed: false,
    riderPlayer: null, riderNpc: null as NPC | null, flight: undefined, type: 'horse', takeDamage: vi.fn() } : undefined
  homeMount?.group.position.copy(group.position)
  let formation: NPC['combatFormationCheckpoint']
  const actor = { group, combatPosition: group.position, combatantId: spec.id, name: spec.id,
    dead: false, hp: 73, maxHp: 100, combatAmmoCapacity: 30, inCombat: false, faction: Faction.TOWN, squadId: undefined as NPC['squadId'], combatOwnership: undefined as NPC['combatOwnership'],
    mount: homeMount ?? null, isMounted: Boolean(homeMount), isFalling: false, combatAmmo: 12,
    tacticalOrder: 'attack' as NPC['tacticalOrder'], formationCommandId: null as number | null,
    shield: { shieldImpactRemaining: 1, shieldImpactMax: 8 }, respawnEnabled: false,
    setCommandAllegiance: vi.fn((faction: Faction) => { actor.faction = faction }),
    setCommandSquad: vi.fn((squad: NPC['squadId']) => { actor.squadId = squad }),
    setTownPeaceful: vi.fn(), clearEncounter: vi.fn(), assignFollowTarget: vi.fn(() => { actor.tacticalOrder = 'follow'; actor.formationCommandId = null; formation = undefined }),
    setTacticalOrder: vi.fn((order: NPC['tacticalOrder']) => { actor.tacticalOrder = order; actor.formationCommandId = null; formation = undefined }),
    assignFormationTarget: vi.fn((id: number, point: THREE.Vector3) => { actor.formationCommandId = id; actor.tacticalOrder = 'formation'; formation = { commandId: id, position: { x: point.x, z: point.z, yaw: 0 }, reached: false } }),
    isFormationTargetReached: vi.fn(() => false), updateTownTravel: vi.fn(),
    refitCombat: vi.fn(() => { actor.hp = 100; actor.dead = false; actor.combatAmmo = 30; actor.shield.shieldImpactRemaining = 8 }),
    restoreCombatHealth: vi.fn((hp: number) => { actor.hp = hp; actor.dead = hp === 0 }), restoreCombatAmmo: vi.fn(),
    get combatFormationCheckpoint() { return formation },
  }
  // The constructor boundary intentionally supplies only actor methods used by this controller.
  const npc = actor as unknown as NPC
  if (homeMount) homeMount.riderNpc = npc
  return { spec, npc, homeMount: homeMount as unknown as Mount | undefined, actor }
}
function player() { return { dead: false, group: new THREE.Group(), combatPosition: new THREE.Vector3() } as unknown as Player }

describe('permanent Captain Town command roster', () => {
  it.each(['roman', 'viking'] as const)('selects fixed native T2 training residents for %s without officers or Patrol', faction => {
    const roster = townCommandSquadRoster(faction)
    expect(roster).toHaveLength(30); expect(new Set(roster.map(actor => actor.id)).size).toBe(30)
    expect(roster.every(actor => actor.duty === 'training' && actor.tier === 2)).toBe(true)
    expect(roster.filter(actor => actor.unitKind === 'sword_cavalry')).toHaveLength(5)
    expect(roster.filter(actor => actor.unitKind === 'lancer')).toHaveLength(5)
    expect(roster.filter(actor => actor.unitKind === 'horse_archer')).toHaveLength(4)
    expect(roster.filter(actor => actor.unitKind === 'archer')).toHaveLength(faction === 'roman' ? 4 : 8)
    expect(roster.filter(actor => actor.unitKind === 'ranged')).toHaveLength(faction === 'roman' ? 4 : 0)
    expect(roster.filter(actor => actor.unitKind === 'melee')).toHaveLength(4)
    expect(roster.filter(actor => actor.unitKind === 'spearman')).toHaveLength(4)
    expect(townCommandSquadRoster(faction, [...townRoster()].reverse()).map(actor => actor.id)).toEqual(roster.map(actor => actor.id))
  })
  it.each(['captain', 'commander'] as const)('persists automatic %s grant before live allegiance and retains it through Dismiss and hostility', rank => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = rank
    const commit = vi.fn((next: typeof profile) => { profile = cloneCareerProfile(next); return true })
    const controller = new TownCommandSquadController(residents, () => p, () => profile, commit)
    expect(controller.grant()).toBe(true)
    expect(controller.authorizedActorIds).toHaveLength(30)
    expect(controller.state).toBe('TRAINING')
    expect(residents.every(r => r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
    expect(residents.every(r => r.npc.faction === Faction.PLAYER)).toBe(true)
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(residents[0].actor.setCommandAllegiance.mock.invocationCallOrder[0])
    residents[0].npc.combatPosition.x = 140
    expect(controller.issue('dismiss')).toBe(true)
    expect(profile.townCommandSquad?.authorized).toBe(true)
    expect(profile.townCommandSquad?.members?.[residents[0].spec.id].formation?.commandId).toBe(TOWN_COMMAND_RETURN_ID)
    const saves = commit.mock.calls.length
    expect(controller.grant()).toBe(true); expect(commit.mock.calls.length).toBe(saves)
    expect(controller.state).toBe('RETURNING')
    residents[1].actor.dead = true; residents[1].actor.hp = 0
    controller.beginHostility()
    expect(controller.authorizedActorIds).toHaveLength(30); expect(residents[0].npc.faction).toBe(Faction.PLAYER)
  })
  it('Sergeant refit commits full resources before reviving the permanent residents and rejects offensive orders', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    let saving = true
    const commit = vi.fn((next: typeof profile) => { if (!saving) return false; profile = next; return true })
    const controller = new TownCommandSquadController(residents, () => p, () => profile, commit)
    controller.grant(); controller.issue('follow')
    // An unmounted resident is enough to verify transaction staging; real rider revival belongs to HR lifecycle.
    const foot = residents.find(r => !r.homeMount)!
    foot.actor.dead = true; foot.actor.hp = 0
    saving = false; expect(controller.refit()).toBe(false); expect(foot.npc.dead).toBe(true)
    saving = true; expect(controller.refit()).toBe(true)
    expect(foot.npc.hp).toBe(100); expect(foot.npc.dead).toBe(false)
    expect(profile.townCommandSquad?.members?.[foot.spec.id]).toMatchObject({ hp: 100, ammo: 30, shieldImpact: 8, status: 'deployed' })
    foot.actor.inCombat = true; expect(controller.refit()).toBe(false)
    foot.actor.inCombat = false
    foot.actor.tacticalOrder = 'attack'; expect(controller.refit()).toBe(false)
    foot.actor.tacticalOrder = 'charge'; expect(controller.refit()).toBe(false)
  })

  it('keeps returning soldiers loyal but rejects new orders until their real travel owner reports arrival', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const controller = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    controller.grant(); const returning = residents[0]
    returning.npc.combatPosition.set(140, 0, 150)
    expect(controller.issue('dismiss')).toBe(true)
    const position = returning.npc.combatPosition.clone()
    expect(controller.accepts(returning.npc)).toBe(false)
    expect(controller.issue('follow')).toBe(false); expect(controller.issue('attack')).toBe(false)
    expect(returning.actor.assignFollowTarget).not.toHaveBeenCalled()
    expect(returning.npc.combatPosition.equals(position)).toBe(true)
    expect(returning.npc.hp).toBe(73); expect(returning.homeMount!.currentHp).toBe(61)
    expect(returning.npc.faction).toBe(Faction.PLAYER); expect(controller.authorizedActorIds).toHaveLength(30)
    // The recording travel boundary reports completion; locomotion is covered by its real NPC owner.
    returning.actor.isFormationTargetReached.mockReturnValue(true)
    controller.updateResident(returning, .016, new THREE.Vector3(), [], {} as NavigationWorld)
    expect(controller.accepts(returning.npc)).toBe(true)
    expect(controller.issue('follow')).toBe(true)
    expect(returning.actor.assignFollowTarget).toHaveBeenCalledOnce()
    expect(residents.slice(1).every(r => r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
    expect(returning.npc.hp).toBe(73); expect(returning.homeMount!.currentHp).toBe(61)
  })
  it('shows 30 living Town soldiers as returning, refuses phantom orders, and restores commandability on arrival', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    const initial = createCareerProfile('roman'); initial.rank = 'captain'
    // Real TownScene provider and Town command owner; zero constructed NPCs, mounts or world.
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile: initial, player: p, world: { faction: 'roman' },
      residents, commandActors: residents.map(r => r.npc),
    }) as { profile: typeof initial; townCommand?: TownCommandSquadController; commandActors: NPC[]; commandHudRoster(): ArmyHudRoster }
    const owner = new TownCommandSquadController(residents, () => p, () => town.profile,
      next => { town.profile = next; return true })
    town.townCommand = owner
    expect(owner.grant()).toBe(true)
    for (const r of residents) {
      r.npc.combatPosition.x += 25
      r.homeMount?.group.position.copy(r.npc.combatPosition)
    }
    const positions = residents.map(r => r.npc.combatPosition.clone())
    const hpAndMount = residents.map(r => [r.npc.hp, r.homeMount?.currentHp])
    const h = createArmyCommandHarness(town.commandActors, null, null, null, 'roman', 'squad', true,
      undefined, { accepts: npc => owner.accepts(npc), enabled: () => owner.commandsEnabled,
        issue: (order, target) => owner.issue(order, target) }, () => town.commandHudRoster(),
      (order, target) => { owner.issue(order, target) })
    const summary = () => h.ui.render.mock.lastCall![0].find(entry => entry.target === 'squad:1')?.summary

    expect(summary()).toBe('30/30')
    expect(owner.trainingActorIds).toHaveLength(30)
    expect(h.ui.render.mock.lastCall![0].every(entry => entry.order === 'training')).toBe(true)
    h.input.pressAll(); h.controller.update(); h.input.press('1'); h.controller.update()
    expect(owner.trainingActorIds).toEqual([])
    expect(h.ui.render.mock.lastCall![0].every(entry => entry.order === 'attack')).toBe(true)
    h.input.press('1'); h.controller.update(); h.input.press('6'); h.controller.update()
    expect(owner.state).toBe('RETURNING')
    expect(owner.returningActorIds).toHaveLength(30)
    expect(summary()).toBe('30/30 · 返回中 30')
    expect(h.ui.render.mock.lastCall![0].map(entry => [entry.target, entry.order])).toEqual([
      ['squad:1', 'returning'], ['all', 'returning'],
    ])
    // A newly constructed HUD must read real return state even with default attack caches.
    const resumedHud = createArmyCommandHarness(town.commandActors, null, null, null, 'roman', 'squad', true,
      undefined, { accepts: npc => owner.accepts(npc), enabled: () => owner.commandsEnabled }, () => town.commandHudRoster())
    expect(resumedHud.ui.render.mock.lastCall![0].every(entry => entry.order === 'returning')).toBe(true)
    expect(owner.actors.every(actor => !owner.accepts(actor))).toBe(true)
    const successes = h.ui.showFeedback.mock.calls.length
    const orderCalls = residents.map(r => r.actor.setTacticalOrder.mock.calls.length)
    for (const commandKey of ['1', '3']) {
      h.input.press('1'); h.controller.update(); h.input.press(commandKey); h.controller.update()
    }
    expect(h.ui.showFeedback).toHaveBeenCalledTimes(successes)
    expect(residents.map(r => r.actor.setTacticalOrder.mock.calls.length)).toEqual(orderCalls)
    expect(residents.map(r => r.npc.combatPosition.equals(positions[residents.indexOf(r)]))).toEqual(Array(30).fill(true))

    // Early arrivals resume training while the remainder still return; this is still a return lifecycle.
    const first = residents[0]
    first.actor.isFormationTargetReached.mockReturnValue(true)
    owner.updateResident(first, .016, new THREE.Vector3(), [], {} as NavigationWorld)
    h.controller.update()
    expect(owner.trainingActorIds).toEqual([first.spec.id])
    expect(summary()).toBe('30/30 · 返回中 29')
    expect(h.ui.render.mock.lastCall![0].every(entry => entry.order === 'returning')).toBe(true)
    // Existing travel owner, not HUD, decides when the physical return finishes.
    for (const r of residents.slice(1)) {
      r.actor.isFormationTargetReached.mockReturnValue(true)
      expect(owner.updateResident(r, .016, new THREE.Vector3(), [], {} as NavigationWorld)).toBe(true)
    }
    expect(owner.returningActorIds).toEqual([])
    expect(owner.state).toBe('TRAINING')
    h.controller.update()
    expect(summary()).toBe('30/30')
    expect(h.ui.render.mock.lastCall![0].every(entry => entry.order === 'training')).toBe(true)
    // A fresh HUD and real serialization reload must both ignore their initial attack cache.
    const saved = owner.checkpoint()!
    town.profile = parseCareerProfile(JSON.parse(JSON.stringify({ ...town.profile, townCommandSquad: saved })))!
    const restored = new TownCommandSquadController(residents, () => p, () => town.profile,
      next => { town.profile = next; return true })
    town.townCommand = restored
    expect(restored.restore()).toBe(true)
    const trainingHud = createArmyCommandHarness(town.commandActors, null, null, null, 'roman', 'squad', true,
      undefined, { accepts: npc => restored.accepts(npc), enabled: () => restored.commandsEnabled }, () => town.commandHudRoster())
    expect(trainingHud.ui.render.mock.lastCall![0].every(entry => entry.order === 'training')).toBe(true)
    expect(trainingHud.ui.render.mock.lastCall![0].every(entry => entry.summary === '30/30')).toBe(true)
    // The existing live owner remains available to this HUD's command adapter.
    town.townCommand = owner
    h.input.press('1'); h.controller.update(); h.input.press('3'); h.controller.update()
    expect(h.ui.showFeedback).toHaveBeenLastCalledWith('第 1 隊 → 防禦')
    expect(residents.every(r => r.actor.setTacticalOrder.mock.lastCall?.[0] === 'defend')).toBe(true)
    expect(residents.map(r => [r.npc.hp, r.homeMount?.currentHp])).toEqual(hpAndMount)
    expect(owner.authorizedActorIds).toHaveLength(30)
  })
  it('interrupts peaceful returns during saved hostility and restores normal command/combat without changing the soldiers', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const controller = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    controller.grant(); const returning = residents[0], actorIds = residents.map(r => r.spec.id)
    returning.npc.combatPosition.set(140, 0, 150); returning.homeMount!.group.position.copy(returning.npc.combatPosition)
    const position = returning.npc.combatPosition.clone(), mountPosition = returning.homeMount!.group.position.clone()
    expect(controller.issue('dismiss')).toBe(true)
    expect(controller.accepts(returning.npc)).toBe(false); expect(controller.issue('follow')).toBe(false)
    expect(controller.issue('attack')).toBe(false); expect(controller.combatActors).not.toContain(returning.npc)
    expect(controller.ownsPeacefulTravel(returning.npc)).toBe(true)
    expect(controller.updateResident(returning, .016, new THREE.Vector3(), [], {} as NavigationWorld)).toBe(true)
    expect(returning.actor.updateTownTravel).toHaveBeenCalledOnce(); returning.actor.updateTownTravel.mockClear()

    // The real caller persists hostile phase/loyal IDs before beginning live hostility.
    profile.townEvent = { id: 'return-interrupted', state: 'hostile', authorizedTownCommandActorIds: [...actorIds] }
    const savedDuringHandover = JSON.stringify(profile)
    expect(controller.accepts(returning.npc)).toBe(true); expect(controller.combatActors).toContain(returning.npc)
    expect(controller.ownsPeacefulTravel(returning.npc)).toBe(false)
    controller.beginHostility()
    expect(returning.npc.formationCommandId).toBeNull(); expect(returning.npc.tacticalOrder).toBe('attack')
    expect(controller.updateResident(returning, .016, new THREE.Vector3(), [], {} as NavigationWorld)).toBe(false)
    expect(returning.actor.updateTownTravel).not.toHaveBeenCalled()
    expect(controller.checkpoint()?.members?.[returning.spec.id]).toMatchObject({ status: 'deployed', order: 'attack' })
    expect(controller.checkpoint()?.members?.[returning.spec.id].formation).toBeUndefined()

    // Reload may contain the old RETURNING checkpoint alongside the durably saved hostile phase.
    profile = parseCareerProfile(JSON.parse(savedDuringHandover))!
    const reload = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    expect(reload.restore()).toBe(true)
    expect(reload.authorizedActorIds).toEqual(actorIds); expect(reload.actors).toEqual(residents.map(r => r.npc))
    expect(reload.combatActors).toHaveLength(30); expect(reload.accepts(returning.npc)).toBe(true)
    expect(reload.ownsPeacefulTravel(returning.npc)).toBe(false)
    expect(reload.updateResident(returning, .016, new THREE.Vector3(), [], {} as NavigationWorld)).toBe(false)
    expect(returning.actor.updateTownTravel).not.toHaveBeenCalled()
    for (const order of ['follow', 'attack', 'charge', 'defend', 'formation'] as const) {
      expect(reload.issue(order), `Hostile returning soldiers accept ${order}`).toBe(true)
      expect(profile.townCommandSquad?.members?.[returning.spec.id].order).toBe(order)
    }
    expect(reload.issue('dismiss')).toBe(true)
    expect(returning.npc.formationCommandId).toBe(TOWN_COMMAND_RETURN_ID)
    expect(profile.townCommandSquad?.members?.[returning.spec.id].formation?.commandId).toBe(TOWN_COMMAND_RETURN_ID)
    expect(reload.ownsPeacefulTravel(returning.npc)).toBe(false)
    expect(reload.issue('follow')).toBe(true)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(saved.townEvent?.authorizedTownCommandActorIds).toEqual(actorIds)
    expect(saved.townCommandSquad?.actorIds).toEqual(actorIds)
    expect(saved.townCommandSquad?.members?.[returning.spec.id].formation).toBeUndefined()
    expect(returning.npc.faction).toBe(Faction.PLAYER); expect(returning.npc.hp).toBe(73)
    expect(returning.homeMount!.currentHp).toBe(61); expect(returning.npc.isMounted).toBe(true)
    expect(returning.npc.combatPosition.equals(position)).toBe(true)
    expect(returning.homeMount!.group.position.equals(mountPosition)).toBe(true)
    expect(saved.townCommandSquad?.members?.[returning.spec.id]).toMatchObject({ hp: 73,
      position: { x: 140, y: 0, z: 150 }, mount: { hp: 61, mounted: true, position: { x: 140, y: 0, z: 150 } } })
  })
  it('failed handover save leaves granted soldiers unchanged; successful handover preserves injured resident and mount', () => {
    const residents = townCommandSquadRoster('roman').map(resident), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const controller = new TownCommandSquadController(residents, () => p, () => profile, next => { profile = next; return true })
    controller.grant(); const borrowed = residents[0]; borrowed.npc.combatPosition.set(140, 0, 150)
    borrowed.homeMount!.group.position.copy(borrowed.npc.combatPosition)
    const staged = controller.stageMissionHandoff(profile)
    expect(borrowed.npc.faction).toBe(Faction.PLAYER)
    expect(controller.commandsEnabled).toBe(true)
    profile = staged; controller.applySavedState(staged.townCommandSquad)
    expect(borrowed.npc.faction).toBe(Faction.TOWN); expect(controller.commandsEnabled).toBe(false)
    expect(borrowed.npc.hp).toBe(73); expect(borrowed.homeMount!.currentHp).toBe(61)
    expect(borrowed.npc.combatPosition.toArray()).toEqual([140, 0, 150])
    expect(controller.isReserveAvailable(borrowed.spec.id)).toBe(false)
    expect(controller.checkpoint()?.members?.[borrowed.spec.id].mount?.hp).toBe(61)
  })
  it('excludes exactly saved loyal Actor IDs from conquest while requiring every other resident', () => {
    const event = new TownEvent([{ id: 'loyal' }, { id: 'defender' }])
    event.register('loyal', { dead: false }); event.register('defender', { dead: true }); event.complete(); event.hostile = true
    expect(event.evaluate(false)).toBeNull()
    event.excludeAuthorizedActors(['loyal', 'outsider'])
    expect(event.evaluate(false)).toBe('town_defeated')
    event.actors.get('defender')!.dead = false
    expect(event.evaluate(false)).toBeNull()
  })
})

describe('Captain Patrol actual combat objective and handover', () => {
  it.each(['normal', 'combat', 'wounded', 'dead', 'unmounted', 'missing mount', 'dead mount', 'occupied mount', 'rejoining'] as const)('allows %s permanent Patrol without altering actual readiness', scenario => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident)
    const patrol = new TownCavalryPatrolController(residents), r = residents[0]
    if (scenario === 'combat') r.actor.inCombat = true
    if (scenario === 'dead') { r.actor.dead = true; r.actor.hp = 0 }
    if (scenario === 'unmounted') { r.actor.mount = null; r.actor.isMounted = false }
    if (scenario === 'missing mount') { r.actor.mount = null; r.actor.isMounted = false; r.homeMount = undefined }
    if (scenario === 'dead mount') r.actor.mount!.dead = true
    if (scenario === 'occupied mount') r.homeMount!.riderPlayer = {} as Player
    if (scenario === 'rejoining') patrol.restoreMissionReturn(r.spec.id, 'REJOIN_PATROL')
    const hp = r.actor.hp, mount = r.actor.mount
    expect(patrol.selectAvailableSquad()?.actorIds).toHaveLength(20)
    expect(r.actor.hp).toBe(hp); expect(r.actor.mount).toBe(mount)
    expect(r.actor.refitCombat).not.toHaveBeenCalled()
    if (scenario === 'missing mount') {
      expect(patrol.beginMissionReturn(r.spec.id)).toBe(true)
      expect(patrol.returnStateFor(r.spec.id)).toBe('RETURN_TO_BARRACKS')
    }
  })

  it('reports returning only for both returning squads and distinguishes mission ownership, Siege and invalid identities', () => {
    const residents = townRoster().filter(spec => spec.duty === 'patrol').map(resident)
    const patrol = new TownCavalryPatrolController(residents)
    patrol.beginMissionReturn(residents.find(r => r.spec.patrolId === 'A')!.spec.id)
    expect(patrol.selectAvailableSquad()?.patrolId).toBe('B')
    patrol.beginMissionReturn(residents.find(r => r.spec.patrolId === 'B')!.spec.id)
    expect(patrol.selectAvailableSquad()).toBeNull()
    expect(patrol.unavailableReason).toBe('巡邏隊正在返回兵營，請稍後再接受任務。')
    residents.find(r => r.spec.patrolId === 'A')!.npc.combatOwnership = 'mission-official'
    expect(patrol.unavailableReason).toContain('其他任務')
    patrol.recallForSiege()
    expect(patrol.unavailableReason).toContain('Siege')
    const invalid = new TownCavalryPatrolController(residents.filter(r => r.spec.patrolId === 'A'))
    residents[1].actor.combatantId = residents[0].spec.id
    expect(invalid.selectAvailableSquad()).toBeNull()
    expect(invalid.unavailableReason).toContain('編制')
  })

  it('live combat handover retains orders, HP and mounts, and guides the moving Captain until death regardless of dismount', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true })
    onTestFinished(() => runtime.dispose())
    const leader = residents.find(r => r.spec.patrolLeader)!
    leader.actor.inCombat = true; leader.actor.tacticalOrder = 'charge'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'live')
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    expect(profile.activeMission.officialSquad!.members![leader.spec.id].order).toBe('charge')
    expect(runtime.resume(false)).toBe(true)
    expect(runtime.commandsEnabled).toBe(true); expect(runtime.accepts(leader.npc)).toBe(true)
    expect(leader.actor.clearEncounter).not.toHaveBeenCalled(); expect(leader.actor.setTownPeaceful).not.toHaveBeenCalled()
    expect(leader.actor.setTacticalOrder).not.toHaveBeenCalled()
    expect(leader.actor.hp).toBe(73); expect(leader.actor.combatAmmo).toBe(12)
    expect(leader.homeMount!.currentHp).toBe(61); expect(leader.actor.shield.shieldImpactRemaining).toBe(1)
    leader.npc.combatPosition.x = 185
    expect(runtime.guideTarget?.x).toBe(185)
    leader.actor.mount = null; leader.actor.isMounted = false
    expect(runtime.guideTarget).toBe(leader.npc.combatPosition)
    leader.actor.dead = true
    expect(runtime.guideTarget).toBe(residents.find(r => r !== leader)!.npc.combatPosition)
    residents.forEach(r => { r.actor.dead = true })
    expect(runtime.guideTarget).toBeNull()
    profile = claimCareerMission(profile, 'live', 'victory', { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }).profile
    expect(runtime.guideTarget).toBeNull()
  })

  it('saves physical RETURNING before relinquishing ownership, restores travel checkpoints without refit, and completes even with no survivors', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'return')
    let writable = true
    const commit = vi.fn((next: typeof profile) => { if (!writable) return false; profile = parseCareerProfile(JSON.parse(JSON.stringify(next)))!; return true })
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, commit)
    onTestFinished(() => runtime.dispose())
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    runtime.resume(false)
    profile = claimCareerMission(profile, 'return', 'victory', { damageDealt: 200, damageTaken: 0, kills: 30, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }).profile
    const merit = profile.totalMerit, before = residents[0].npc.combatPosition.clone()
    writable = false
    expect(runtime.startReturning()).toBe(false)
    expect(runtime.owns(residents[0].npc)).toBe(true)
    expect(patrol.returnStateFor(residents[0].spec.id)).toBeNull()
    writable = true
    expect(runtime.startReturning()).toBe(true)
    expect(profile.activeMission!.phase).toBe('RETURNING')
    expect(runtime.fieldNpcs).toEqual([]); expect(runtime.owns(residents[0].npc)).toBe(false)
    expect(residents[0].npc.combatPosition).toEqual(before)
    expect(patrol.returnStateFor(residents[0].spec.id)).toBe('RETURN_TO_BARRACKS')
    patrol.restoreMissionReturn(residents[0].spec.id, 'REJOIN_PATROL')
    expect(runtime.persist(true)).toBe(true)
    expect(profile.activeMission!.patrolReturnStates![residents[0].spec.id]).toBe('REJOIN_PATROL')
    runtime.dispose()
    const restoredPatrol = new TownCavalryPatrolController(residents)
    const restored = new CaptainPatrolCommandController(residents, restoredPatrol, () => p, () => profile, commit)
    onTestFinished(() => restored.dispose())
    expect(restored.resume()).toBe(true)
    expect(restoredPatrol.returnStateFor(residents[0].spec.id)).toBe('REJOIN_PATROL')
    expect(restoredPatrol.returnStateFor(residents[1].spec.id)).toBe('RETURN_TO_BARRACKS')
    expect(residents.every(r => !r.actor.refitCombat.mock.calls.length)).toBe(true)
    expect(profile.totalMerit).toBe(merit)
    expect(restored.returnComplete).toBe(false)
    const point = townSitePoint('barracks', 0, 15)
    p.combatPosition.set(point.x, getTerrainHeight(point.x, point.z), point.z)
    residents.forEach(r => { r.actor.dead = true })
    expect(restored.returnComplete).toBe(true)
    const returnAgain = vi.spyOn(restoredPatrol, 'returnSquad')
    const peaceful = residents[0].actor.setTownPeaceful.mock.calls.length
    profile.activeMission = undefined
    restored.release()
    expect(returnAgain).not.toHaveBeenCalled()
    expect(residents[0].actor.setTownPeaceful).toHaveBeenCalledTimes(peaceful)
    expect(restored.actors).toEqual([])
  })
  it('borrows all twenty original A residents and never lets autonomous patrol overwrite their command', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents)
    expect(patrol.selectAvailableSquad()?.actorIds).toHaveLength(20)
    expect(patrol.selectAvailableSquad()?.actorIds[0]).toBe('town-patrol:a:captain')
    const ids = patrol.selectAvailableSquad()!.actorIds
    expect(patrol.resumeSquad(ids)).toBe(true); expect(patrol.selectAvailableSquad()).toBeNull()
    patrol.beginFrame(new Set())
    expect(residents.every(r => !patrol.owns(r.npc))).toBe(true)
    expect(residents.every(r => r.actor.assignFormationTarget.mock.calls.length === 0 && r.actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
  })
  it('counts only actual authorized kills once and retains the kill set and independent contributions after reload', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'patrol')
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId.startsWith('enemy:') })
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    const source = { actorId: 'town-patrol:a:captain', actorType: 'npc' as const, allegiance: Faction.TOWN, characterFaction: 'roman' as const, squadId: 1 as const, ownership: 'mission-official' as const }
    const kill = (id: string): CombatEvent => ({ type: 'actor_killed', source, target: { targetId: id, targetType: 'npc', name: id, allegiance: Faction.ENEMY }, method: 'projectile' })
    expect(runtime.recordEvent(kill('enemy:before-acceptance'))).toBe(false)
    expect(runtime.resume(false)).toBe(true)
    expect(runtime.killCount).toBe(0)
    expect(runtime.recordEvent(kill('enemy:1'))).toBe(true); expect(runtime.recordEvent(kill('enemy:1'))).toBe(false)
    expect(runtime.recordEvent(kill('town:civilian'))).toBe(false)
    expect(runtime.killCount).toBe(1)
    expect(runtime.statsSnapshot?.player.kills).toBe(0); expect(runtime.statsSnapshot?.meritPlayer?.kills).toBe(1)
    runtime.persist(true); runtime.dispose()
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(profile.activeMission?.patrolKilledActorIds).toEqual(['enemy:1'])
    const reload = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId.startsWith('enemy:') })
    expect(reload.resume()).toBe(true); expect(reload.killCount).toBe(1)
    expect(reload.recordEvent(kill('enemy:1'))).toBe(false)
    expect(reload.statsSnapshot?.meritPlayer?.kills).toBe(1)
    reload.dispose()
  })
  it('wins at thirty while allies survive Player death and fails only when all deployed participants die', () => {
    expect(resolveCaptainPatrolCommandOutcome(30, true, 1, 0)).toBe('victory')
    expect(resolveCaptainPatrolCommandOutcome(29, true, 0, 1)).toBeNull()
    expect(resolveCaptainPatrolCommandOutcome(29, true, 0, 0)).toBe('failure')
  })
  it('records real enemy damage to each authorized squad without crediting Player merit and preserves it through storage', () => {
    const residents = townRoster().filter(spec => spec.patrolId === 'A').map(resident), patrol = new TownCavalryPatrolController(residents), p = player()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'incoming')
    profile.activeMission.personalSquad = { squadId: 'personal', memberIds: ['personal:guard'], sceneKey: 'town-home', state: 'ACTIVE',
      members: { 'personal:guard': { status: 'deployed' } }, contribution: emptyPersonalContribution() }
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true },
      { isEligibleTarget: target => target.targetId === 'enemy:actual' })
    profile.activeMission = runtime.captureForMission(profile.activeMission)!
    expect(runtime.resume(false)).toBe(true)
    const incoming = (id: string, squadId: 1 | 'personal', appliedDamage: number, sourceId = 'enemy:actual'): CombatEvent => ({
      type: 'damage_applied', source: { actorId: sourceId, actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'viking' },
      target: { targetId: id, targetType: 'npc', name: id, allegiance: squadId === 1 ? Faction.TOWN : Faction.PLAYER, squadId },
      method: 'melee', requestedDamage: appliedDamage, appliedDamage,
    })
    expect(runtime.recordEvent(incoming(residents[0].spec.id, 1, 40))).toBe(true)
    expect(runtime.recordEvent(incoming('personal:guard', 'personal', 11))).toBe(true)
    expect(runtime.recordEvent(incoming('personal:guard', 'personal', 99, 'enemy:unregistered'))).toBe(false)
    expect(runtime.recordEvent(incoming('town:unrelated', 1, 99))).toBe(false)
    expect(runtime.statsSnapshot?.squads.find(squad => squad.squadId === 1)?.damageTaken).toBe(40)
    expect(runtime.statsSnapshot?.squads.find(squad => squad.squadId === 'personal')?.damageTaken).toBe(11)
    expect(runtime.statsSnapshot?.meritPlayer?.damageDealt).toBe(0); expect(runtime.killCount).toBe(0)
    runtime.persist(true); runtime.dispose()
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    const reload = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true })
    expect(reload.resume()).toBe(true)
    expect(reload.statsSnapshot?.squads.find(squad => squad.squadId === 1)?.damageTaken).toBe(40)
    expect(reload.statsSnapshot?.squads.find(squad => squad.squadId === 'personal')?.damageTaken).toBe(11)
    reload.dispose()
  })
})
