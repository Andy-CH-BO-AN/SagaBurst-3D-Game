import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { cloneCareerProfile, createCareerProfile } from '../../src/career/CareerProfile'
import type { EnemyEaglePatrolCheckpoint } from '../../src/town/EnemyEaglePatrolState'
import { MemoryStorage } from '../helpers/memoryStorage'
import { townProfileCheckpoint } from '../helpers/townProfileCheckpoint'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { Player } from '../../src/player/Player'
import type { TownOutskirtsCombatRuntime } from '../../src/town/TownMissionCombat'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { combatActor, combatFixture, combatMount, combatResident } from '../helpers/townMissionCombat'

function warfareFixture(actors: NPC[], engaging = true) {
  const outskirts = {
    actors, mounts: [] as TownOutskirtsCombatRuntime['mounts'],
    synchronizeRank: vi.fn<TownOutskirtsCombatRuntime['synchronizeRank']>(),
    prepareFrame: vi.fn<TownOutskirtsCombatRuntime['prepareFrame']>(),
    owns: vi.fn((actor: NPC) => outskirts.actors.includes(actor)),
    combatEnabled: vi.fn(() => engaging),
    updateTravel: vi.fn<TownOutskirtsCombatRuntime['updateTravel']>(),
  }
  return { ...combatFixture({ simulation: { outskirts: () => outskirts } }), outskirts }
}

function veteranMission(phase: 'ASSEMBLING' | 'MARCHING' | 'ENGAGING' = 'ENGAGING'): ActiveCareerMission {
  return {
    id: 'mission', kind: 'veteran-field', templateId: 'veteran-scout-hunters', phase,
    targetCampId: -1, targetActorIds: ['objective'], friendlyActorIds: ['friendly'], acceptedAt: 0,
    engagedEnemySquadIds: [],
  }
}

describe('Outskirts participants alongside existing Town missions', () => {
  it('persists separate air cooldowns transactionally, preserves other towns, and retries failed mission handoff saves', () => {
    // Data-only caller/store test: zero actors, mounts, worlds, or scheduler jobs.
    const checkpoint: EnemyEaglePatrolCheckpoint = { version: 1, pairs: [{ id: 1, generation: 2,
      state: 'RESPAWN_COOLDOWN', waypoint: 1, elapsed: 8, restRemaining: 0, respawnRemaining: 31,
      home: { x: 230, z: 190, yaw: 0 } }] }
    const profile = createCareerProfile('roman'), storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    profile.enemyEaglePatrols = { viking: structuredClone(checkpoint) }
    const town = townProfileCheckpoint(profile, store)
    Object.assign(town.player.shield, { reset: vi.fn() })
    const allowed = vi.fn()
    Object.assign(town, { enemyEaglePatrol: { checkpoint: () => structuredClone(checkpoint), setAmbientPatrolAllowed: allowed, actors: [] } })
    expect(town.commit(cloneCareerProfile(profile))).toBe(true)
    expect(store.load()!.enemyEaglePatrols).toEqual({ roman: checkpoint, viking: checkpoint })
    const cloned = cloneCareerProfile(town.profile)
    cloned.enemyEaglePatrols!.roman!.pairs[0].respawnRemaining = 0
    expect(town.profile.enemyEaglePatrols!.roman!.pairs[0].respawnRemaining).toBe(31)
    const transition = cloneCareerProfile(town.profile)
    transition.activeMission = veteranMission()
    const fail = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('full') })
    onTestFinished(() => fail.mockRestore())
    allowed.mockClear()
    expect(town.commit(transition)).toBe(false)
    expect(allowed).not.toHaveBeenCalled()
    expect(town.profile.activeMission).toBeUndefined()
    expect(store.load()!.enemyEaglePatrols!.roman!.pairs[0].respawnRemaining).toBe(31)
    expect(town.commit(transition)).toBe(true)
    expect(allowed).toHaveBeenCalledExactlyOnceWith(false)
    expect(store.load()!.enemyEaglePatrols!.roman).toEqual(checkpoint)
    fail.mockRestore()
  })

  it('keeps separate ambient air ownership on the shared grid without adding mission actors or updating a mount twice', () => {
    // Three recording actors, zero real NPC/Mount constructors or TownWorlds.
    const guard = combatActor('guard'), retired = combatActor('air-old', Faction.ENEMY)
    const eagle = combatActor('air-new', Faction.ENEMY), mount = combatMount()
    const air: TownOutskirtsCombatRuntime = {
      actors: [retired], mounts: [mount], synchronizeRank: vi.fn(), owns: actor => actor === eagle,
      combatEnabled: () => false, updateTravel: vi.fn(),
      prepareFrame: vi.fn(() => { Object.assign(air, { actors: [eagle] }) }),
    }
    const h = combatFixture({ simulation: { airPatrol: () => air, residents: [combatResident(guard)] } })
    h.combat.update(.02, 0, 1)
    expect(h.combat.runtimeParticipants).toEqual([guard, eagle])
    expect(h.combat.runtimeGrid.findNearest(eagle.combatPosition, actor => actor === eagle)).toBe(eagle)
    expect(air.updateTravel).toHaveBeenCalledExactlyOnceWith(eagle, .02, h.simulation.cameraPosition)
    expect(eagle.update).not.toHaveBeenCalled(); expect(retired.update).not.toHaveBeenCalled()
    expect(mount.update).not.toHaveBeenCalled()
    expect(h.field.fieldNpcs).toEqual([]); expect(h.field.missionBandits).toEqual([])
    const airspace = [] as typeof h.simulation.obstacles
    h.simulation.airspaceObstacles = airspace
    Object.assign(mount, { isFlyingMount: true, riderNpc: eagle })
    eagle.mount = mount
    Object.assign(air, { combatEnabled: () => true })
    h.combat.update(.02, 0, 1.02)
    expect(eagle.update).toHaveBeenCalledOnce()
    expect(eagle.update.mock.calls[0][4]).toBe(airspace)
    expect(mount.update).not.toHaveBeenCalled()
  })

  it('intercepts an airborne threat away from the home pad, prioritizes air and drops targets beyond the town leash', () => {
    // Sensor/ownership regression uses three recording actors, no world or render resources.
    const guard = combatActor('town-eagle-rider:1'), ground = combatActor('ground', Faction.ENEMY)
    const enemy = combatActor('air', Faction.ENEMY), mount = combatMount()
    Object.assign(mount, { isAirborne: true }); enemy.mount = mount
    guard.group.position.set(150, 25, 0); ground.group.position.set(151, 25, 0); mount.group.position.set(160, 25, 0)
    Object.assign(guard, { maxRangedAttackDistance: 300, setMissionCombatTarget: vi.fn() })
    const resident = combatResident(guard)
    resident.spec = townEagleRoster({ pads: [{ id: 'town-eagle-pad:1', x: -100, z: 0, yaw: 0 }] })[0]
    const air: TownOutskirtsCombatRuntime = {
      actors: [enemy, ground], mounts: [mount], synchronizeRank: vi.fn(), prepareFrame: vi.fn(),
      owns: actor => actor !== guard, combatEnabled: () => false, updateTravel: vi.fn(),
    }
    const h = combatFixture({ simulation: { airPatrol: () => air, residents: [resident] } })
    h.combat.update(.02, 0, 1)
    expect(guard.beginExternalThreat).toHaveBeenCalledOnce()
    expect(guard.setMissionCombatTarget).toHaveBeenLastCalledWith(enemy)
    mount.group.position.set(250, 25, 0); ground.group.position.set(260, 25, 0)
    h.combat.update(.25, 0, 1.25)
    expect(guard.endExternalThreat).toHaveBeenCalledOnce()
    expect(h.combat.externalDefenders).not.toContain(guard)
  })

  it('prepares sensors before mission flow, shares one grid, and keeps objective/friendly rosters unchanged', () => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT)
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY)
    const friendly = combatActor('friendly'), objective = combatActor('objective', Faction.ENEMY)
    const h = warfareFixture([bandit, enemy]), log: string[] = []
    h.field.active = veteranMission(); h.field.active.engagedEnemySquadIds = [1]
    h.field.friendlies = [friendly]; h.field.missionBandits = [objective]; h.field.fieldNpcs = [friendly, objective]
    h.field.veteranEnemySquads = [{ squadId: 1, leader: objective, members: [objective] }]
    h.field.updateFlow.mockImplementation(() => { log.push('mission-flow') })
    h.outskirts.prepareFrame.mockImplementation((_dt, participants) => {
      log.push('outskirts-prepare'); expect(participants).toEqual([friendly, objective, bandit, enemy])
    })
    const beginFrame = vi.spyOn(h.simulation.navigation, 'beginFrame')
    bandit.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit) => {
      expect(peers).toContain(objective); hit(7, false, objective)
    })
    h.combat.update(.02, 0, 1)
    expect(log).toEqual(['outskirts-prepare', 'mission-flow'])
    expect(beginFrame).toHaveBeenCalledOnce()
    for (const actor of [friendly, objective, bandit, enemy]) expect(actor.update).toHaveBeenCalledOnce()
    expect(bandit.update.mock.calls[0][11]).toBe(friendly.update.mock.calls[0][11])
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(objective, 7, 'melee', bandit)
    expect(h.field.friendlies).toEqual([friendly]); expect(h.field.missionBandits).toEqual([objective])
    expect(h.field.active).toMatchObject({ targetActorIds: ['objective'], friendlyActorIds: ['friendly'] })
  })

  it('keeps peaceful travel lightweight and advances a dead actor without stepping its mount twice', () => {
    const walker = combatActor('outskirts:bandit:a:0', Faction.BANDIT)
    const corpse = combatActor('outskirts:cavalry:a:0', Faction.ENEMY), mount = combatMount()
    corpse.dead = true; mount.dead = true
    const h = warfareFixture([walker, corpse], false)
    h.outskirts.mounts = [mount]
    h.combat.update(.02, 0, 1)
    expect(h.outskirts.updateTravel).toHaveBeenCalledExactlyOnceWith(walker, .02, h.simulation.cameraPosition)
    expect(walker.update).not.toHaveBeenCalled(); expect(corpse.update).toHaveBeenCalledOnce()
    expect(mount.update).not.toHaveBeenCalled()
  })

  it('uses the replacement generation after a wipe without leaving retired actors in a grid', () => {
    const retired = combatActor('outskirts:cavalry:a:0', Faction.ENEMY)
    const replacement = combatActor('outskirts:cavalry:a:0', Faction.ENEMY)
    const h = warfareFixture([retired], false)
    h.outskirts.prepareFrame.mockImplementation(() => { h.outskirts.actors = [replacement] })
    h.combat.update(.02, 0, 1)
    expect(h.combat.runtimeParticipants).toEqual([replacement])
    expect(h.combat.runtimeGrid.findNearest(new THREE.Vector3())).toBe(replacement)
    expect(h.outskirts.updateTravel).toHaveBeenCalledExactlyOnceWith(replacement, .02, h.simulation.cameraPosition)
    expect(retired.update).not.toHaveBeenCalled()
  })

  it('interrupts marching for whole-party combat while preserving the formal phase', () => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT)
    bandit.group.position.x = 6
    const friendly = combatActor('friendly'), h = warfareFixture([bandit])
    friendly.tacticalOrder = 'formation'
    h.field.prepareTravelEncounter.mockImplementation((dt, grid, threats) => h.field.travelEncounter.prepareFrame(dt, h.field.friendlies, h.player, grid, threats))
    h.field.active = veteranMission('MARCHING'); h.field.friendlies = [friendly]; h.field.fieldNpcs = [friendly]
    friendly.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit) => {
      expect(friendly.tacticalOrder).toBe('charge'); expect(peers).toContain(bandit); hit(5, false, bandit)
    })
    h.combat.update(.02, 0, 1)
    expect(friendly.tacticalOrder).toBe('charge')
    expect(h.field.travelEncounter.active).toBe(true)
    expect(h.field.active.phase).toBe('MARCHING')
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(bandit, 5, 'melee', friendly)
  })

  it('hands an incidental encounter to formal Veteran combat as soon as the existing squad sensor activates', () => {
    const roaming = combatActor('outskirts:bandit:a:0', Faction.BANDIT)
    const friendly = combatActor('friendly'), objective = combatActor('objective', Faction.ENEMY)
    const h = warfareFixture([roaming])
    roaming.group.position.x = 10; objective.group.position.x = 200
    h.field.active = veteranMission('MARCHING')
    h.field.friendlies = [friendly]; h.field.missionBandits = [objective]; h.field.fieldNpcs = [friendly, objective]
    h.field.veteranEnemySquads = [{ squadId: 1, leader: objective, members: [objective] }]
    h.field.prepareTravelEncounter.mockImplementation((dt, grid, threats) => h.field.travelEncounter.prepareFrame(dt, h.field.friendlies, h.player, grid, threats))
    h.field.engageFormalMission.mockImplementation(() => {
      h.field.active = { ...h.field.active!, phase: 'ENGAGING' }
      h.field.travelEncounter.clear(); friendly.setTacticalOrder('charge')
    })
    h.combat.update(.01, 0, 0)
    expect(h.field.travelEncounter.active).toBe(true)
    expect(h.field.active.phase).toBe('MARCHING')
    objective.group.position.x = 20
    h.combat.update(.01, 0, .01)
    expect(h.field.engageFormalMission).toHaveBeenCalledOnce()
    expect(h.field.active.phase).toBe('ENGAGING')
    expect(h.field.travelEncounter.active).toBe(false)
    expect(h.field.active.targetActorIds).toEqual(['objective'])
  })

  it('wakes a held Veteran squad near a hostile roaming member and on an attributed hit', () => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT)
    const leader = combatActor('leader', Faction.ENEMY), member = combatActor('objective', Faction.ENEMY)
    leader.group.position.x = 100; member.group.position.x = 55
    bandit.group.position.x = 6
    const h = warfareFixture([bandit])
    h.player.combatPosition.x = 1000; h.field.active = veteranMission('MARCHING')
    h.field.missionBandits = [leader, member]; h.field.fieldNpcs = [leader, member]
    h.field.veteranEnemySquads = [{ squadId: 1, leader, members: [leader, member] }]
    h.combat.update(.02, 0, 1)
    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenCalledExactlyOnceWith(1)
    expect(leader.update).toHaveBeenCalledOnce(); expect(member.update).toHaveBeenCalledOnce()
    h.field.active.engagedEnemySquadIds = []
    h.combat.noteExternalHit(member, bandit)
    expect(h.field.active.engagedEnemySquadIds).toEqual([1])
    expect(h.field.active.phase).toBe('MARCHING')
  })

  it('allows allied foreign cavalry and native guards to fight without joining the mission army', () => {
    const cavalry = combatActor('outskirts:cavalry:a:0', Faction.TOWN)
    const native = combatActor('enemy-town:gate:north:0', Faction.ENEMY)
    const h = warfareFixture([cavalry])
    h.simulation.residents = [combatResident(native)]
    h.field.active = veteranMission(); h.field.active.templateId = 'veteran-tragedy-of-the-scouts'
    h.player.combatPosition.x = 1000
    h.combat.update(.02, 0, 1)
    expect(native.beginExternalThreat).toHaveBeenCalledOnce()
    expect(native.update).toHaveBeenCalledOnce(); expect(cavalry.update).toHaveBeenCalledOnce()
    expect(h.combat.enemyTownHostiles).toContain(native)
    expect(h.field.friendlies).toEqual([])
    expect(cavalry.update.mock.calls[0][11]!.findNearest(cavalry.combatPosition, npc => npc.faction !== cavalry.faction)).toBe(native)
    expect(h.simulation.damagePlayer).not.toHaveBeenCalled()
  })

  it('keeps roaming threats out of Patrol registration and protection while other military retaliate', () => {
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY)
    const patrol = combatActor('town-patrol:a:0'), returning = combatActor('town-patrol:a:1')
    const defender = combatActor('gate:north:0'), trainee = combatActor('training:0')
    const h = warfareFixture([enemy])
    const route = combatResident(patrol, 'melee_cavalry'), home = combatResident(returning, 'melee_cavalry')
    route.spec.duty = 'patrol'; home.spec.duty = 'patrol'
    const guard = combatResident(defender), training = combatResident(trainee)
    guard.spec.duty = 'gate_guard'; training.spec.duty = 'training'
    h.simulation.residents = [route, home, guard, training]
    h.simulation.ownsPeacefulTravel = actor => actor === returning
    enemy.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit) => {
      expect(peers).toContain(patrol); hit(9, false, patrol)
    })
    h.combat.update(.02, 0, 1)
    for (const npc of [patrol, returning]) {
      expect(npc.beginExternalThreat).not.toHaveBeenCalled(); expect(npc.update).not.toHaveBeenCalled()
      expect(h.combat.isExternalThreatDefender(npc)).toBe(false)
      expect(h.combat.runtimeParticipants).toContain(npc)
    }
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(route, .02)
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(home, .02)
    for (const npc of [defender, trainee]) {
      expect(npc.beginExternalThreat).toHaveBeenCalledOnce(); expect(npc.update).toHaveBeenCalledOnce()
      expect(h.combat.isExternalThreatDefender(npc)).toBe(true)
    }
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(patrol, 9, 'melee', enemy)
  })

  it('preserves Patrol camp defense and releases it without teleporting when only roaming threats remain', () => {
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY), camp = combatActor('ambient:0:0', Faction.BANDIT)
    const patrol = combatActor('town-patrol:a:0'), h = warfareFixture([enemy])
    const resident = combatResident(patrol, 'melee_cavalry'); resident.spec.duty = 'patrol'
    h.simulation.residents = [resident]; h.field.ambientBandits = [camp]; h.field.fieldNpcs = [camp]
    expect(h.combat.isExternalThreatDefender(patrol)).toBe(true)
    h.combat.update(.02, 0, 1)
    expect(patrol.beginExternalThreat).toHaveBeenCalledOnce(); expect(patrol.update).toHaveBeenCalledOnce()
    camp.group.position.x = 100; patrol.group.position.set(3, 0, 1)
    h.combat.update(.02, 0, 2)
    expect(patrol.endExternalThreat).toHaveBeenCalledOnce()
    expect(patrol.beginExternalThreat).toHaveBeenCalledOnce(); expect(patrol.update).toHaveBeenCalledOnce()
    expect(patrol.group.position).toEqual(new THREE.Vector3(3, 0, 1))
    expect(h.combat.isExternalThreatDefender(patrol)).toBe(false)
    expect(h.simulation.peaceResident).toHaveBeenCalledExactlyOnceWith(resident, .02)
  })

  it.each(['field', 'defense'] as const)('keeps a formally borrowed Patrol actor fighting in its %s mission roster', owner => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT), patrol = combatActor('town-patrol:a:0')
    bandit.group.position.x = 6; patrol.tacticalOrder = 'formation'
    const h = warfareFixture([bandit]), resident = combatResident(patrol, 'melee_cavalry')
    resident.spec.duty = 'patrol'; h.simulation.residents = [resident]
    h.simulation.ownsPeacefulTravel = actor => actor === patrol
    const mission = { ...veteranMission(owner === 'field' ? 'MARCHING' : 'ENGAGING'), friendlyActorIds: [patrol.combatantId] }
    if (owner === 'field') {
      h.field.active = mission; h.field.friendlies = [patrol]; h.field.fieldNpcs = [patrol]
    } else {
      h.defense.active = { ...mission, kind: 'town-defense', phase: 'ATTACKING' }
      h.defense.phase = 'ATTACKING'; h.defense.fieldNpcs = [patrol]
    }
    patrol.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit) => {
      expect(peers).toContain(bandit); expect(patrol.tacticalOrder).toBe('attack'); hit(5, false, bandit)
    })
    h.combat.update(.02, 0, 1)
    expect(patrol.update).toHaveBeenCalledOnce(); expect(patrol.tacticalOrder).toBe('formation')
    expect(patrol.beginExternalThreat).not.toHaveBeenCalled(); expect(patrol.endExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).not.toHaveBeenCalled()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(bandit, 5, 'melee', patrol)
    expect(owner === 'field' ? h.field.fieldNpcs : h.defense.fieldNpcs).toEqual([patrol])
    expect(owner === 'field' ? h.field.active : h.defense.active).toMatchObject({
      phase: owner === 'field' ? 'MARCHING' : 'ATTACKING', friendlyActorIds: [patrol.combatantId], targetActorIds: ['objective'],
    })
  })

  it.each(['scout', 'player'] as const)('preserves Veteran VI native Patrol response to its existing %s threat', threat => {
    const allied = combatActor('outskirts:cavalry:a:0', Faction.TOWN)
    const native = combatActor('enemy-town:town-patrol:a:0', Faction.ENEMY), scout = combatActor('friendly')
    const h = warfareFixture([allied]), resident = combatResident(native, 'melee_cavalry')
    resident.spec.duty = 'patrol'; h.simulation.residents = [resident]
    h.field.active = veteranMission(); h.field.active.templateId = 'veteran-tragedy-of-the-scouts'
    h.field.friendlies = [scout]; h.field.fieldNpcs = [scout]
    h.player.combatPosition.x = threat === 'player' ? 6 : 1000
    scout.group.position.x = threat === 'scout' ? 6 : 1000
    h.combat.update(.02, 0, 1)
    expect(native.beginExternalThreat).toHaveBeenCalledOnce(); expect(native.update).toHaveBeenCalledOnce()
    expect(h.combat.enemyTownHostiles).toEqual([native]); expect(native.respawnEnabled).toBe(false)
    expect(h.field.friendlies).toEqual([scout]); expect(h.field.active.friendlyActorIds).toEqual(['friendly'])
  })

  it('releases old resident threat membership without resetting a newly borrowed mission actor', () => {
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY), friendly = combatActor('friendly')
    const h = warfareFixture([enemy])
    h.simulation.residents = [combatResident(friendly)]
    h.combat.update(.02, 0, 1)
    expect(friendly.beginExternalThreat).toHaveBeenCalledOnce()
    friendly.group.position.set(3, 0, 1); friendly.tacticalOrder = 'formation'
    h.field.active = veteranMission('MARCHING'); h.field.friendlies = [friendly]; h.field.fieldNpcs = [friendly]
    h.combat.update(.02, 0, 2)
    expect(friendly.endExternalThreat).not.toHaveBeenCalled()
    expect(friendly.group.position).toEqual(new THREE.Vector3(3, 0, 1))
    expect(friendly.tacticalOrder).toBe('formation')
  })

  it('adds three-way combat to assault runtime without counting allied cavalry as army survivors', () => {
    const allied = combatActor('outskirts:cavalry:a:0', Faction.TOWN)
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT), native = combatActor('objective', Faction.ENEMY)
    const mount = combatMount(), h = warfareFixture([allied, bandit])
    allied.mount = mount; mount.riderNpc = allied
    h.defense.active = { ...veteranMission(), kind: 'enemy-town-assault' }
    h.defense.phase = 'ATTACKING'; h.defense.assault = true; h.defense.fieldNpcs = [native]
    h.simulation.residents = [combatResident(native)]
    h.combat.update(.02, 0, 1)
    expect(h.simulation.hitNpc).toHaveBeenCalledWith(native, expect.any(Number), 'mount-impact', allied)
    expect(h.simulation.hitNpc).toHaveBeenCalledWith(bandit, expect.any(Number), 'mount-impact', allied)
    expect(h.defense.fieldNpcs).toEqual([native])
    expect(native.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.defense.active.friendlyActorIds).toEqual(['friendly'])
    expect(h.simulation.damagePlayer).not.toHaveBeenCalled()
  })

  it.each(['formation', 'follow'] as const)('lets a travelling defense actor retaliate with its %s intent preserved after preparation', order => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT), defender = combatActor('friendly')
    bandit.group.position.x = 6; defender.tacticalOrder = order
    const h = warfareFixture([bandit])
    h.defense.active = { ...veteranMission(), kind: 'town-defense', phase: 'ATTACKING' }
    h.defense.phase = 'ATTACKING'; h.defense.fieldNpcs = [defender]
    h.simulation.residents = [combatResident(defender)]
    defender.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit) => {
      expect(defender.tacticalOrder).toBe('attack'); expect(peers).toContain(bandit); hit(6, false, bandit)
    })
    h.combat.update(.02, 0, 1)
    expect(defender.tacticalOrder).toBe(order)
    expect(h.defense.phase).toBe('ATTACKING')
    expect(defender.update).toHaveBeenCalledOnce()
    expect(defender.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(bandit, 6, 'melee', defender)
    expect(h.defense.fieldNpcs).toEqual([defender])
  })

  it.each(['formation', 'follow', 'defend'] as const)('preserves player-owned gate defenders %s while enemies are nearby', order => {
    // Recording update boundary verifies the caller never substitutes Attack for the accepted command.
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT), defender = combatActor('friendly')
    bandit.group.position.x = 6; defender.tacticalOrder = order
    const h = warfareFixture([bandit])
    h.defense.active = { ...veteranMission(), kind: 'town-defense', phase: 'ATTACKING', officialSquad: {
      type: 'mission-official', townFaction: 'roman', squadId: 1, actorIds: ['friendly'],
      contribution: { damageDealt: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    } }
    h.defense.phase = 'ATTACKING'; h.defense.fieldNpcs = [defender]
    h.simulation.residents = [combatResident(defender)]
    defender.update.mockImplementation(() => { expect(defender.tacticalOrder).toBe(order) })
    h.combat.update(.02, 0, 1)
    expect(defender.update).toHaveBeenCalledOnce()
    expect(defender.tacticalOrder).toBe(order)
  })

  it('lets an arriving home defender pursue its roaming Bandit attacker without losing its defend deployment', () => {
    const scene = new THREE.Scene(), player = new Player(scene)
    const defender = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Defender', 1, false)
    const bandit = new NPC(scene, 12, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'Roaming Bandit', 1, false)
    const destination = new THREE.Vector3(0, 0, 30)
    defender.assignFormationTarget(42, destination, new THREE.Vector3(0, 0, 1), undefined, 'defend')
    const deployment = (defender as unknown as { formationTarget: { position: THREE.Vector3 } }).formationTarget
    const h = warfareFixture([bandit], false)
    h.simulation.player = () => player
    h.defense.active = { ...veteranMission(), kind: 'town-defense', phase: 'ATTACKING' }
    h.defense.phase = 'ATTACKING'; h.defense.fieldNpcs = [defender]
    // The effective Bandit hit must release this actor even outside the 8m proximity sensor.
    h.combat.noteExternalHit(defender, bandit)
    h.combat.update(.02, 0, 1)
    expect((defender as unknown as { _cachedTargetNpc: NPC | null })._cachedTargetNpc).toBe(bandit)
    expect(defender.tacticalOrder).toBe('defend')
    expect(defender.formationCommandId).toBe(42)
    expect((defender as unknown as { formationTarget: unknown }).formationTarget).toBe(deployment)
    expect(deployment.position).toEqual(destination)
    expect(h.defense.phase).toBe('ATTACKING'); expect(h.defense.fieldNpcs).toEqual([defender])
    defender.dispose(); bandit.dispose()
  })

  it('keeps a preparing defense actor on its formation movement despite a nearby roaming threat', () => {
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY), defender = combatActor('friendly')
    defender.tacticalOrder = 'formation'
    const h = warfareFixture([enemy])
    h.defense.active = { ...veteranMission(), kind: 'town-defense', phase: 'PREPARING' }
    h.defense.phase = 'PREPARING'; h.defense.fieldNpcs = [defender]; defender.missionMovement = true
    defender.update.mockImplementation(() => { expect(defender.tacticalOrder).toBe('formation') })
    h.combat.update(.02, 0, 1)
    expect(defender.update).toHaveBeenCalledOnce()
    expect(defender.tacticalOrder).toBe('formation')
    expect(h.simulation.hitNpc).not.toHaveBeenCalled()
  })

  it('advances ambient camp combat once during Town crime while TownScene retains resident ownership', () => {
    const enemy = combatActor('outskirts:cavalry:a:0', Faction.ENEMY), camp = combatActor('ambient:0:0', Faction.BANDIT)
    const resident = combatActor('gate:north:0'), h = warfareFixture([enemy])
    enemy.group.position.x = 2; resident.group.position.x = 100
    h.field.ambientBandits = [camp, camp]; h.field.fieldNpcs = [camp]
    h.simulation.residents = [combatResident(resident)]
    const beginFrame = vi.spyOn(h.simulation.navigation, 'beginFrame')
    camp.update.mockImplementation((_dt, _player, peers, _neighbors, _obstacles, _hp, hit, _fire, _skip, _distance, _collector, grid) => {
      expect(peers).toContain(enemy)
      const target = grid!.findNearest(camp.combatPosition, candidate => candidate.faction !== camp.faction)
      expect(target).toBe(enemy); hit(9, false, target!)
    })
    h.combat.updateOutskirtsHostile(.02, 1)
    expect(camp.update).toHaveBeenCalledOnce(); expect(enemy.update).toHaveBeenCalledOnce()
    expect(resident.update).not.toHaveBeenCalled(); expect(h.simulation.peaceResident).not.toHaveBeenCalled()
    expect(beginFrame).not.toHaveBeenCalled()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(enemy, 9, 'melee', camp)
    expect(h.field.ambientBandits).toEqual([camp, camp])
  })

  it('runs Outskirts alongside Duel and never resets the hostile navigation frame', () => {
    const bandit = combatActor('outskirts:bandit:a:0', Faction.BANDIT), h = warfareFixture([bandit])
    h.duel.active = { ...veteranMission(), kind: 'duel' }
    h.combat.update(.02, 0, 1)
    expect(h.outskirts.prepareFrame).toHaveBeenCalledOnce(); expect(bandit.update).toHaveBeenCalledOnce()
    h.duel.active = undefined
    const beginFrame = vi.spyOn(h.simulation.navigation, 'beginFrame')
    h.combat.updateOutskirtsHostile(.02, 2)
    expect(beginFrame).not.toHaveBeenCalled(); expect(bandit.update).toHaveBeenCalledTimes(2)
  })
})
