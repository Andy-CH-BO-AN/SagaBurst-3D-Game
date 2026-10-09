import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createTownDefenseMission, type CareerMissionPhase } from '../../src/career/CareerMissionState'
import { createCavalrySweepMission } from '../../src/career/CavalrySweep'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { getTerrainHeight } from '../../src/world/Terrain'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { combatActor, combatFixture, combatMount, combatResident } from '../helpers/townMissionCombat'

function duelFixture(phase: CareerMissionPhase = 'ENGAGING') {
  const h = combatFixture()
  h.duel.active = createCareerDuelMission(createCareerProfile('roman'), 'roman_archer', 1, 'opponent', 'captain')!
  h.duel.phase = phase
  h.duel.combatEnabled = phase === 'ENGAGING'
  const opponent = combatActor('opponent'), captain = combatActor('captain')
  h.duel.fieldNpcs = [captain, opponent]
  h.duel.opponent = opponent
  opponent.hostileToPlayer = phase === 'ENGAGING'
  return { ...h, opponent, captain }
}

function defenseFixture(phase: CareerMissionPhase = 'ATTACKING', assault = false) {
  const h = combatFixture()
  h.defense.active = assault ? createEnemyTownAssaultMission() : createTownDefenseMission(['captain'], [], 'defense')
  h.defense.phase = phase
  h.defense.assault = assault
  return h
}

/** Sensor wiring only: no real NPC, Mount, TownWorld or visual assets. */
function eagleAlertFixture() {
  const h = combatFixture()
  const spec = townEagleRoster({ pads: [{ id: 'town-eagle-pad:1', x: 0, z: 0, yaw: 0 }] })[0]
  const eagle = combatActor(spec.id), resident = { ...combatResident(eagle, 'archer_infantry'), spec }
  const bowRange = { value: 40 }
  Object.defineProperty(eagle, 'maxRangedAttackDistance', { get: () => bowRange.value })
  const duty = vi.fn((npc: NPC) => npc === eagle)
  h.simulation.residents = [resident]
  h.simulation.updateEagleDuty = duty
  return { ...h, eagle, resident, bowRange, duty }
}

describe('Town eagle external alert through the mission interface', () => {
  it.each(['ambient', 'mission', 'roaming'] as const)('starts a first sortie for a hostile from %s at 80m and retains the alert while boarding', source => {
    const h = eagleAlertFixture(), hostile = combatActor('hostile', Faction.BANDIT)
    hostile.group.position.x = 80
    h.field.fieldNpcs = [hostile]
    if (source === 'ambient') h.field.ambientBandits = [hostile]
    else if (source === 'mission') h.field.missionBandits = [hostile]
    else {
      const outskirts = { actors: [hostile], mounts: [], synchronizeRank: vi.fn(), prepareFrame: vi.fn(),
        owns: (npc: NPC) => npc === hostile, combatEnabled: () => false, updateTravel: vi.fn() }
      h.simulation.outskirts = () => outskirts
    }
    if (source !== 'roaming') expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(true)

    h.combat.update(.02, 0, 0)
    h.combat.update(.02, 0, .02)

    expect(h.eagle.beginExternalThreat).toHaveBeenCalledOnce()
    expect(h.eagle.endExternalThreat).not.toHaveBeenCalled()
    expect(h.combat.externalDefenders).toEqual([h.eagle])
    expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(true)
    expect(h.duty.mock.calls.filter(([npc]) => npc === h.eagle)).toEqual([[h.eagle, .02, true], [h.eagle, .02, true]])
    expect(h.simulation.peaceResident).not.toHaveBeenCalled()
    expect(h.field.friendlies).toEqual([])
  })

  it.each([
    { scenario: 'inclusive 120m edge', x: 120, y: 0, faction: Faction.BANDIT, dead: false, expected: true },
    { scenario: 'beyond the initial radius', x: 120.01, y: 0, faction: Faction.BANDIT, dead: false, expected: false },
    { scenario: '3D distance outside despite nearby XZ', x: 100, y: 70, faction: Faction.BANDIT, dead: false, expected: false },
    { scenario: 'same-faction resident', x: 80, y: 0, faction: Faction.TOWN, dead: false, expected: false },
    { scenario: 'dead hostile', x: 80, y: 0, faction: Faction.BANDIT, dead: true, expected: false },
  ])('gates initial alert and friendly protection for $scenario', ({ x, y, faction, dead, expected }) => {
    const h = eagleAlertFixture(), target = combatActor('candidate', faction)
    target.group.position.set(x, y, 0); target.dead = dead
    h.field.ambientBandits = [target]; h.field.fieldNpcs = [target]
    // A long bow must not widen the first alert before assignment.
    h.bowRange.value = 400
    expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(expected)

    h.combat.update(.02, 0, 0)

    expect(h.combat.externalDefenders.includes(h.eagle)).toBe(expected)
    expect(h.eagle.beginExternalThreat).toHaveBeenCalledTimes(expected ? 1 : 0)
    expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(expected)
  })

  it.each([
    { scenario: 'outside the home alert area', homeX: 0, actorX: 100, targetX: 180 },
    { scenario: 'outside the Town world bounds', homeX: 300, actorX: 300, targetX: 351 },
  ])('does not alert to a nearby hostile $scenario', ({ homeX, actorX, targetX }) => {
    const h = eagleAlertFixture(), hostile = combatActor('hostile', Faction.BANDIT)
    h.resident.spec.eagle!.home.x = homeX
    h.eagle.group.position.x = actorX; hostile.group.position.x = targetX
    h.field.ambientBandits = [hostile]; h.field.fieldNpcs = [hostile]
    expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(false)

    h.combat.update(.02, 0, 0)

    expect(h.eagle.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.combat.externalDefenders).toEqual([])
    expect(h.simulation.peaceResident).toHaveBeenCalledExactlyOnceWith(h.resident, .02)
  })

  it('retains the mounted bow engagement range but releases a nearby hostile beyond the home boundary', () => {
    const h = eagleAlertFixture(), hostile = combatActor('hostile', Faction.BANDIT)
    h.resident.spec.eagle!.home.x = -100; h.eagle.group.position.x = -100
    hostile.group.position.x = -20
    h.field.ambientBandits = [hostile]; h.field.fieldNpcs = [hostile]
    h.combat.update(.02, 0, 0)
    expect(h.eagle.beginExternalThreat).toHaveBeenCalledOnce()

    h.bowRange.value = 400
    h.eagle.group.position.set(-100, 30, 0); hostile.group.position.x = 100
    h.combat.update(.02, 0, .02)
    expect(h.combat.externalDefenders).toEqual([h.eagle])
    expect(h.eagle.endExternalThreat).not.toHaveBeenCalled()

    // The target remains in-world and close to the moving eagle, but is 401m from home.
    h.eagle.group.position.x = 250; hostile.group.position.x = 301
    h.combat.update(.02, 0, .04)
    expect(h.combat.externalDefenders).toEqual([])
    expect(h.eagle.endExternalThreat).toHaveBeenCalledOnce()
    expect(h.eagle.group.position).toEqual(new THREE.Vector3(250, 30, 0))
  })

  it('does not grant Player protection to a hostile enemy-town eagle alerted by nearby scouts', () => {
    const h = eagleAlertFixture(), scout = combatActor('scout', Faction.TOWN)
    h.eagle.combatantId = 'enemy-town:town-eagle-rider:1'
    h.resident.spec.id = h.eagle.combatantId
    h.eagle.faction = Faction.ENEMY; h.eagle.hostileToPlayer = true
    scout.group.position.x = 80; h.player.combatPosition.x = 1000
    h.field.active = { ...createCavalrySweepMission(), kind: 'veteran-field',
      templateId: 'veteran-tragedy-of-the-scouts', phase: 'ENGAGING' }
    h.field.friendlies = [scout]; h.field.fieldNpcs = [scout]

    h.combat.update(.02, 0, 0)

    expect(h.eagle.beginExternalThreat).toHaveBeenCalledOnce()
    expect(h.combat.enemyTownHostiles).toEqual([h.eagle])
    expect(h.combat.isExternalThreatDefender(h.eagle)).toBe(false)
    expect(h.combat.externalDefenders).toEqual([])
  })

  it.each([20, 20.01, 80])('keeps ground garrison detection at 20m with a hostile at %sm', distance => {
    const h = combatFixture(), guard = combatActor('ground-guard'), hostile = combatActor('hostile', Faction.BANDIT)
    h.simulation.residents = [combatResident(guard)]
    hostile.group.position.x = distance
    h.field.ambientBandits = [hostile]; h.field.fieldNpcs = [hostile]
    expect(h.combat.isExternalThreatDefender(guard)).toBe(distance === 20)

    h.combat.update(.02, 0, 0)

    expect(guard.beginExternalThreat).toHaveBeenCalledTimes(distance === 20 ? 1 : 0)
    expect(h.combat.externalDefenders.includes(guard)).toBe(distance === 20)
  })

  it('keeps a siege-owned eagle peaceful during preparation despite a hostile inside the alert radius', () => {
    const h = eagleAlertFixture(), hostile = combatActor('roaming-hostile', Faction.BANDIT)
    hostile.group.position.x = 80
    const outskirts = { actors: [hostile], mounts: [], synchronizeRank: vi.fn(), prepareFrame: vi.fn(),
      owns: (npc: NPC) => npc === hostile, combatEnabled: () => false, updateTravel: vi.fn() }
    h.simulation.outskirts = () => outskirts
    h.defense.active = createTownDefenseMission([h.eagle.combatantId], [], 'defense')
    h.defense.phase = 'PREPARING'; h.defense.fieldNpcs = [h.eagle]

    h.combat.update(.02, 0, 0)

    expect(h.eagle.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.combat.externalDefenders).toEqual([])
    expect(h.duty).toHaveBeenCalledExactlyOnceWith(h.eagle, .02, false)
    expect(h.eagle.update).not.toHaveBeenCalled()
  })
})

describe('Town field combat through the mission interface', () => {
  it.each(['PREPARING', 'ATTACKING', 'RESULT'] as const)('passes %s siege phase permission to air duty before any normal actor simulation', phase => {
    const h = defenseFixture(phase), eagle = combatActor('town-eagle-rider:1')
    h.defense.fieldNpcs = [eagle]
    const duty = vi.fn(() => true)
    h.simulation.updateEagleDuty = duty
    h.combat.update(.02, 0, 0)
    expect(duty).toHaveBeenCalledExactlyOnceWith(eagle, .02, phase === 'ATTACKING')
    expect(eagle.update).not.toHaveBeenCalled()
  })
  it('forwards the verified shot budget from NPC release through the Town mission boundary', () => {
    const h = combatFixture(), eagle = combatActor('town-eagle-rider:1')
    h.field.fieldNpcs = [eagle]
    h.combat.update(.02, 0, 0)
    const origin = new THREE.Vector3(0, 30, 0), direction = new THREE.Vector3(0, .5, .5)
    const budget = { maxLifetimeSeconds: 9, maxTravelDistance: 1600 }
    eagle.update.mock.calls[0][7](origin, direction, 'arrow', budget)
    expect(h.simulation.fireNpc).toHaveBeenCalledExactlyOnceWith(origin, direction, 'arrow', eagle, budget)
  })

  it('updates navigation, flow, cues and residents before actors, then the active career mount', () => {
    const h = combatFixture(), log: string[] = []
    const actor = combatActor('captain'), bystander = combatResident(combatActor('merchant'), 'merchant')
    h.field.fieldNpcs = [actor]; h.field.friendlies = [actor]
    h.simulation.residents = [combatResident(actor, 'captain'), bystander]
    vi.spyOn(h.simulation.navigation, 'sync').mockImplementation(() => { log.push('navigation-sync') })
    vi.spyOn(h.simulation.navigation, 'beginFrame').mockImplementation(() => { log.push('navigation-frame') })
    h.field.updateFlow.mockImplementation(() => { log.push('flow') })
    vi.mocked(h.simulation.updateCommandCue).mockImplementation(() => { log.push('cue') })
    vi.mocked(h.simulation.peaceResident).mockImplementation(() => { log.push('resident') })
    actor.update.mockImplementation(() => { log.push('actor') })
    h.careerMounts.update.mockImplementation(() => { log.push('career-mount') })
    h.combat.update(.02, 1.7, 5)
    expect(log).toEqual(['navigation-sync', 'navigation-frame', 'flow', 'cue', 'resident', 'actor', 'career-mount'])
    expect(h.field.updateFlow).toHaveBeenCalledExactlyOnceWith(.02, 1.7)
    expect(h.simulation.peaceResident).toHaveBeenCalledExactlyOnceWith(bystander, .02)
    expect(h.duel.update).not.toHaveBeenCalled(); expect(h.defense.updateFlow).not.toHaveBeenCalled()
  })

  it('deduplicates mission and external defenders in original order, excludes corpses from neighbors, and reuses neighbor storage', () => {
    const h = combatFixture(), seen: Array<{ actor: NPC; peers: NPC[]; nearby: NPC[]; buffer: NPC[] }> = []
    const bandit = combatActor('bandit', Faction.BANDIT), captain = combatActor('captain'), defender = combatActor('soldier'), corpse = combatActor('corpse')
    corpse.dead = true
    h.field.fieldNpcs = [bandit, captain, bandit, corpse, defender]
    h.field.friendlies = [captain]; h.field.ambientBandits = [bandit]
    h.simulation.residents = [combatResident(captain, 'captain'), combatResident(defender), combatResident(combatActor('merchant'), 'merchant')]
    for (const actor of [bandit, captain, corpse, defender]) actor.update.mockImplementation((_dt, _player, peers, nearby) => {
      seen.push({ actor, peers: [...peers], nearby: [...nearby], buffer: nearby })
    })
    h.combat.update(.02, 0, 1)
    expect(seen.map(entry => entry.actor)).toEqual([bandit, captain, corpse, defender])
    expect(seen[0].peers).toEqual([bandit, captain, corpse, defender])
    expect(seen[3].peers).toEqual([bandit, defender])
    for (const entry of seen) expect(entry.nearby).toEqual([bandit, captain, defender])
    expect(new Set(seen.map(entry => entry.buffer)).size).toBe(1)
    expect(defender.beginExternalThreat).toHaveBeenCalledOnce()
    h.combat.update(.02, 0, 2)
    expect(defender.beginExternalThreat).toHaveBeenCalledOnce()
    expect(seen[4].buffer).toBe(seen[0].buffer)
  })

  it('protects military before threat assignment and returns a mounted defender home when the encounter leaves range', () => {
    const h = combatFixture(), defender = combatActor('soldier'), bandit = combatActor('bandit', Faction.BANDIT), merchant = combatActor('merchant')
    const home = combatResident(defender), mount = combatMount()
    defender.mount = mount; mount.riderNpc = defender
    h.simulation.residents = [home, combatResident(merchant, 'merchant')]
    h.field.fieldNpcs = [bandit]; h.field.ambientBandits = [bandit]
    bandit.group.position.x = 20
    expect(h.combat.isExternalThreatDefender(defender)).toBe(true)
    expect(h.combat.isExternalThreatDefender(merchant)).toBe(false)
    h.combat.update(.02, 0, 0)
    const npcPosition = defender.group.position.clone()
    bandit.group.position.x = 60
    // Registered defenders remain protected until the frame releases their assignment.
    expect(h.combat.isExternalThreatDefender(defender)).toBe(true)
    h.combat.update(.02, 0, 1)
    expect(h.combat.isExternalThreatDefender(defender)).toBe(false)
    expect(defender.endExternalThreat).toHaveBeenCalledOnce()
    expect(mount.group.position).toEqual(new THREE.Vector3(home.spec.x, getTerrainHeight(home.spec.x, home.spec.z), home.spec.z))
    expect(mount.group.rotation.y).toBe(home.spec.yaw)
    expect(defender.group.position).toEqual(npcPosition)
  })

  it('releases a restored resident registration without applying a second physical reset', () => {
    const h = combatFixture(), defender = combatActor('soldier'), bandit = combatActor('bandit', Faction.BANDIT)
    h.simulation.residents = [combatResident(defender)]
    h.field.fieldNpcs = [bandit]; h.field.ambientBandits = [bandit]
    h.combat.update(.02, 0, 0)
    bandit.group.position.x = 50
    h.combat.releaseExternalThreat(defender)
    expect(h.combat.isExternalThreatDefender(defender)).toBe(false)
    expect(defender.endExternalThreat).not.toHaveBeenCalled()
  })

  it('carries each actor identity through melee, player damage and delayed use of its projectile callback', () => {
    const h = combatFixture(), first = combatActor('first', Faction.BANDIT), second = combatActor('second'), target = combatActor('target')
    h.field.fieldNpcs = [first, second]
    for (const actor of [first, second]) actor.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, hit) => {
      hit(7, false, target); hit(9, true)
    })
    h.combat.update(.02, 0, 0)
    const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1)
    for (const actor of [first, second]) actor.update.mock.calls[0][7](origin, direction, 'arrow')
    expect(h.simulation.hitNpc).toHaveBeenNthCalledWith(1, target, 7, 'melee', first)
    expect(h.simulation.hitNpc).toHaveBeenNthCalledWith(2, target, 7, 'melee', second)
    expect(h.simulation.damagePlayer).toHaveBeenNthCalledWith(1, first, 9, 'melee')
    expect(h.simulation.damagePlayer).toHaveBeenNthCalledWith(2, second, 9, 'melee')
    expect(h.simulation.fireNpc).toHaveBeenNthCalledWith(1, origin, direction, 'arrow', first)
    expect(h.simulation.fireNpc).toHaveBeenNthCalledWith(2, origin, direction, 'arrow', second)
  })

  it.each([false, true])('keeps cavalry sweep impacts attributed to the rider during Observer=%s', dead => {
    const h = combatFixture(), rider = combatActor('captain'), bandit = combatActor('bandit', Faction.BANDIT), ally = combatActor('ally'), mount = combatMount()
    h.field.active = createCavalrySweepMission()
    h.field.friendlies = [rider]; h.field.fieldNpcs = [rider, bandit, ally]; h.field.missionBandits = [bandit]
    rider.mount = mount; mount.riderNpc = rider; h.player.dead = dead
    h.combat.update(.02, 0, 6)
    expect(rider.update).toHaveBeenCalledOnce(); expect(bandit.update).toHaveBeenCalledOnce()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(bandit, expect.any(Number), 'mount-impact', rider)
    expect(mount.canImpact).toHaveBeenCalledExactlyOnceWith(bandit, 6)
  })

  it('uses only the active mounted career vehicle for player impacts against both bandit rosters', () => {
    const h = combatFixture(), ambient = combatActor('ambient', Faction.BANDIT), mission = combatActor('mission', Faction.BANDIT), mount = combatMount()
    h.field.fieldNpcs = [ambient, mission]; h.field.ambientBandits = [ambient]; h.field.missionBandits = [mission]
    h.careerMounts.activeMount = mount
    h.combat.update(.02, 0, 0)
    expect(h.simulation.hitNpc).not.toHaveBeenCalled()
    h.player.currentMount = mount
    h.combat.update(.02, 0, 1)
    expect(h.simulation.hitNpc).toHaveBeenNthCalledWith(1, ambient, expect.any(Number), 'mount-impact')
    expect(h.simulation.hitNpc).toHaveBeenNthCalledWith(2, mission, expect.any(Number), 'mount-impact')
  })

  it('advances departing riders after controller cleanup and keeps dead or unowned cavalry mounts updating', () => {
    const h = combatFixture(), rider = combatActor('departing'), dead = combatMount(), unowned = combatMount(), controlled = combatMount(), log: string[] = []
    dead.dead = true; dead.riderNpc = rider; controlled.riderNpc = rider
    h.field.departingNpcs = [rider]; h.field.cavalryMounts = [dead, unowned, controlled]
    h.field.updateDepartingCavalry.mockImplementation(() => { log.push('cleanup') })
    rider.update.mockImplementation(() => { log.push('rider') })
    dead.update.mockImplementation(() => { log.push('dead-mount') }); unowned.update.mockImplementation(() => { log.push('unowned-mount') })
    h.combat.updateDepartingCavalry(.02)
    expect(log).toEqual(['cleanup', 'rider', 'dead-mount', 'unowned-mount'])
    expect(controlled.update).not.toHaveBeenCalled()
    for (const mount of [dead, unowned, controlled]) expect(mount.setCameraDistance).toHaveBeenCalledOnce()
    expect(rider.update.mock.calls[0][2]).toEqual([]); expect(rider.update.mock.calls[0][3]).toEqual([])
  })
})

describe('Town Duel simulation through the mission interface', () => {
  it.each(['ASSEMBLING', 'MARCHING', 'PREPARING', 'ENGAGING', 'RETURNING'] as const)('runs world warfare, sensors and Patrol while preserving mission ownership in %s', phase => {
    const h = duelFixture(phase)
    const bandit = combatActor('bandit', Faction.BANDIT), cavalry = combatActor('cavalry', Faction.ENEMY)
    const patrolMember = combatActor('patrol'), training = combatActor('training'), civilian = combatActor('civilian')
    const excluded: Set<NPC>[] = []
    h.simulation.residents = [combatResident(h.captain, 'captain'), combatResident(h.opponent), combatResident(training), combatResident(patrolMember), combatResident(civilian, 'civilian')]
    const outskirts = {
      actors: [bandit, cavalry], mounts: [], synchronizeRank: vi.fn(), prepareFrame: vi.fn(),
      owns: (npc: NPC) => npc === bandit || npc === cavalry,
      combatEnabled: () => true, updateTravel: vi.fn(),
    }
    h.simulation.outskirts = () => outskirts
    const patrol = { combatActors: [patrolMember, h.captain], prepareCombatFrame: vi.fn(), combatEnabled: () => false, noteHostileHit: vi.fn() }
    h.simulation.patrol = () => patrol
    h.simulation.preparePeaceResidents = set => { excluded.push(new Set(set)) }
    // Duplicate rosters deliberately exercise mission ownership precedence.
    h.field.fieldNpcs = [bandit, h.captain]; h.field.ambientBandits = [bandit]
    for (let frame = 0; frame < 3; frame++) h.combat.update(.02, 0, frame)
    expect(outskirts.synchronizeRank).toHaveBeenCalledTimes(3)
    expect(outskirts.prepareFrame).toHaveBeenCalledTimes(3)
    expect(patrol.prepareCombatFrame).toHaveBeenCalledTimes(3)
    for (const npc of [bandit, cavalry, training, patrolMember, h.captain, h.opponent]) {
      expect(npc.update.mock.calls.length + npc.updateTownPeace.mock.calls.length, npc.combatantId).toBe(3)
      expect(h.combat.runtimeParticipants).toContain(npc)
      expect(h.combat.runtimeGrid.getNearby(npc.combatPosition, 8)).toContain(npc)
    }
    expect(excluded.every(set => set.has(h.captain) && set.has(h.opponent))).toBe(true)
    expect(h.captain.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledTimes(3)
    expect(h.duel.setExternalCombat).toHaveBeenCalledWith(h.captain, true)
    expect(h.duel.persistRuntimeProgress).toHaveBeenCalledTimes(3)
  })

  it('refreshes a replaced roaming generation and does not update a global mission mount twice', () => {
    const h = duelFixture(), old = combatActor('old', Faction.BANDIT), replacement = combatActor('new', Faction.BANDIT), mount = combatMount()
    const outskirts = { actors: [old], mounts: [mount], synchronizeRank: vi.fn(),
      prepareFrame: vi.fn(() => { outskirts.actors = [replacement] }), owns: (actor: NPC) => outskirts.actors.includes(actor),
      combatEnabled: () => true, updateTravel: vi.fn() }
    h.simulation.outskirts = () => outskirts; h.simulation.mounts = [mount]; h.duel.allMounts = [mount, mount]
    h.combat.update(.02, 0, 0)
    expect(old.update).not.toHaveBeenCalled(); expect(replacement.update).toHaveBeenCalledOnce()
    expect(h.combat.runtimeParticipants).not.toContain(old); expect(h.combat.runtimeParticipants).toContain(replacement)
    expect(mount.update).not.toHaveBeenCalled()
  })

  it('lets a referee walk back to its mission station after an external fight during ENGAGING', () => {
    const h = duelFixture()
    Object.assign(h.captain, { formationCommandId: 9, isFormationTargetReached: vi.fn(() => false), updateTownTravel: vi.fn() })
    h.combat.update(.02, 0, 1)
    expect(h.duel.setExternalCombat).toHaveBeenCalledWith(h.captain, false)
    expect(h.captain.updateTownTravel).toHaveBeenCalledOnce()
    expect(h.captain.update).not.toHaveBeenCalled(); expect(h.captain.updateTownPeace).not.toHaveBeenCalled()
    expect(h.opponent.update).toHaveBeenCalledOnce()
  })
  it('advances a defeated opponent through collapse and despawn while the result panel pauses the duel', () => {
    const h = duelFixture('RESULT')
    const opponent = new NPC(new THREE.Scene(), 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Duel opponent', 1, false)
    opponent.respawnEnabled = false
    const animation = { play: vi.fn(), update: vi.fn(), stop: vi.fn(), has: vi.fn(() => false), setEquipmentState: vi.fn() }
    ;(opponent as any).rig.animation = animation
    opponent.setDuelHostility(true)
    h.duel.fieldNpcs = [h.captain, opponent]
    const animator = (opponent as any).animator
    const animationUpdate = vi.spyOn(animator, 'update')
    opponent.takeDamage(10000)
    opponent.setDuelHostility(false)
    expect(animation.play).toHaveBeenLastCalledWith('death', { fadeSeconds: .12, loop: false })
    h.combat.updateDefeatedActors(.5)
    expect(animationUpdate).toHaveBeenCalledOnce()
    expect(opponent.group.visible).toBe(true)
    expect(h.captain.update).not.toHaveBeenCalled()
    expect(h.duel.update).not.toHaveBeenCalled()
    expect(h.duel.persistRuntimeProgress).not.toHaveBeenCalled()
    h.combat.updateDefeatedActors(2.6)
    expect(opponent.group.visible).toBe(false)
    expect(opponent.dead).toBe(true)
    opponent.dispose()
  })

  it.each(['ENGAGING', 'RESULT', 'RETURNING'] as const)('keeps dead duelists on the death update path in %s', phase => {
    const h = duelFixture(phase)
    h.opponent.dead = true
    h.combat.update(.02, 0, 0)
    expect(h.opponent.update).toHaveBeenCalledOnce()
    expect(h.opponent.updateTownPeace).not.toHaveBeenCalled()
    expect(h.opponent.update.mock.calls[0][2]).toEqual([])
    expect(h.opponent.update.mock.calls[0][3]).toEqual([])
  })

  it.each(['ASSEMBLING', 'MARCHING', 'PREPARING', 'ENGAGING', 'RESULT', 'RETURNING'] as const)('preserves opponent and referee updates in %s', phase => {
    const h = duelFixture(phase), mount = combatMount()
    h.captain.mount = mount
    h.simulation.residents = [combatResident(h.opponent), combatResident(h.captain, 'captain'), combatResident(combatActor('bystander'), 'merchant')]
    h.combat.update(.02, 0, 0)
    const peaceful = phase === 'PREPARING' || phase === 'RESULT'
    expect(h.opponent.update).toHaveBeenCalledTimes(peaceful ? 0 : 1)
    expect(h.opponent.updateTownPeace).toHaveBeenCalledTimes(peaceful ? 1 : 0)
    expect(h.captain.update).toHaveBeenCalledTimes(peaceful || phase === 'ENGAGING' ? 0 : 1)
    expect(h.captain.updateTownPeace).toHaveBeenCalledTimes(peaceful || phase === 'ENGAGING' ? 1 : 0)
    expect(mount.beginControlledFrame).toHaveBeenCalledTimes(peaceful || phase === 'ENGAGING' ? 1 : 0)
    expect(mount.finishControlledFrame).toHaveBeenCalledTimes(peaceful || phase === 'ENGAGING' ? 1 : 0)
    expect(h.simulation.peaceResident).toHaveBeenCalledExactlyOnceWith(h.simulation.residents[2], .02)
    expect(h.duel.persistRuntimeProgress).toHaveBeenCalledOnce()
    expect(h.field.updateFlow).not.toHaveBeenCalled(); expect(h.defense.updateFlow).not.toHaveBeenCalled()
  })

  it('preserves world projectiles at FIGHT and persists after mounts advance', () => {
    const h = duelFixture('PREPARING'), log: string[] = [], mount = combatMount()
    mount.dead = true; h.duel.allMounts = [mount]
    h.duel.update.mockImplementation(() => { log.push('countdown'); h.duel.phase = 'ENGAGING'; h.duel.combatEnabled = true })
    vi.mocked(h.simulation.clearCombatShots).mockImplementation(() => { log.push('clear-shots') })
    h.captain.updateTownPeace.mockImplementation(() => { log.push('referee'); return false })
    h.opponent.update.mockImplementation(() => { log.push('opponent') })
    mount.update.mockImplementation(() => { log.push('dead-mount') })
    h.careerMounts.update.mockImplementation(() => { log.push('career-mount') })
    h.duel.persistRuntimeProgress.mockImplementation(() => { log.push('persist') })
    h.combat.update(.02, 0, 1)
    expect(log).toEqual(['countdown', 'referee', 'opponent', 'dead-mount', 'career-mount', 'persist'])
    h.combat.update(.02, 0, 2)
    expect(h.simulation.clearCombatShots).not.toHaveBeenCalled()
  })

  it('keeps a timed-out ENGAGING opponent peaceful and updates abandoned mounts', () => {
    const h = duelFixture(), abandoned = combatMount(), controlled = combatMount()
    h.duel.combatEnabled = false
    controlled.riderNpc = h.opponent; h.duel.allMounts = [abandoned, controlled]
    h.combat.update(.02, 0, 0)
    expect(h.opponent.update).not.toHaveBeenCalled(); expect(h.opponent.updateTownPeace).toHaveBeenCalledOnce()
    expect(abandoned.update).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
    expect(controlled.update).not.toHaveBeenCalled(); expect(h.simulation.hitNpc).not.toHaveBeenCalled()
  })

  it('routes opponent damage and shots with its identity across ownership', () => {
    const h = duelFixture(), unrelated = combatActor('unrelated', Faction.BANDIT), origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1)
    h.opponent.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, hit, fire) => {
      hit(8, true); hit(8, false, unrelated); fire(origin, direction, 'arrow')
    })
    h.combat.update(.02, 0, 0)
    expect(h.simulation.damagePlayer).toHaveBeenCalledExactlyOnceWith(h.opponent, 8, 'melee')
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(unrelated, 8, 'melee', h.opponent)
    expect(h.simulation.fireNpc).toHaveBeenCalledExactlyOnceWith(origin, direction, 'arrow', h.opponent)
  })

  it.each([false, true])('gates both mount impacts on FIGHT=%s and the opposing rider on a living player', fight => {
    const h = duelFixture(fight ? 'ENGAGING' : 'PREPARING'), playerMount = combatMount(), opponentMount = combatMount()
    h.player.currentMount = playerMount; h.opponent.mount = opponentMount
    h.combat.update(.02, 0, 1)
    expect(h.simulation.hitNpc).toHaveBeenCalledTimes(fight ? 1 : 0)
    expect(h.simulation.damagePlayer).toHaveBeenCalledTimes(fight ? 1 : 0)
    if (fight) {
      expect(h.simulation.hitNpc).toHaveBeenLastCalledWith(h.opponent, expect.any(Number), 'mount-impact')
      expect(h.simulation.damagePlayer).toHaveBeenLastCalledWith(h.opponent, expect.any(Number), 'mount-impact')
      h.player.dead = true
      h.combat.update(.02, 0, 2)
      expect(h.simulation.damagePlayer).toHaveBeenCalledOnce()
    }
  })
})

describe('Town Defense simulation through the mission interface', () => {
  it('builds hostile grids in roster order and reacquires a living target after an earlier same-frame death', () => {
    const h = defenseFixture(), killer = combatActor('killer'), first = combatActor('first', Faction.ENEMY), second = combatActor('second', Faction.ENEMY), observer = combatActor('observer')
    first.group.position.x = -1; second.group.position.x = 1
    h.defense.fieldNpcs = [killer, first, second, observer]
    const acquired: Array<NPC | null> = []
    vi.mocked(h.simulation.hitNpc).mockImplementation(target => { target.dead = true })
    killer.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, hit, _fire, _skip, _distance, _collector, grid) => {
      acquired.push(grid!.findNearest(killer.combatPosition, candidate => !candidate.dead && candidate.faction !== killer.faction))
      hit(100, false, first)
    })
    observer.update.mockImplementation((_dt, _player, peers, _nearby, _obstacles, _hp, _hit, _fire, _skip, _distance, _collector, grid) => {
      expect(peers.filter(actor => !actor.dead && actor.faction !== observer.faction)).toEqual([second])
      acquired.push(grid!.findNearest(observer.combatPosition, candidate => !candidate.dead && candidate.faction !== observer.faction))
    })
    h.combat.update(.02, 0, 0)
    expect(acquired).toEqual([first, second])
    expect(first.update).toHaveBeenCalledOnce()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(first, 100, 'melee', killer)
    expect(killer.update.mock.calls[0][11]).toBe(observer.update.mock.calls[0][11])
    expect(killer.update.mock.calls[0][11]).toBe(first.update.mock.calls[0][11])
  })

  it.each([false, true])('preserves PREPARING assault=%s exceptions for living military, civilians and corpses', assault => {
    const h = defenseFixture('PREPARING', assault), soldier = combatActor('soldier'), civilian = combatActor('civilian'), corpse = combatActor('corpse')
    civilian.townCategory = 'civilian'; corpse.dead = true
    h.defense.fieldNpcs = [soldier, civilian, corpse]
    h.combat.update(.02, 2, 1)
    expect(soldier.update).toHaveBeenCalledTimes(1)
    expect(soldier.updateTownPeace).toHaveBeenCalledTimes(0)
    expect(h.defense.updateCivilianOrder).toHaveBeenCalledTimes(3)
    expect(civilian.update).toHaveBeenCalledOnce(); expect(corpse.update).toHaveBeenCalledOnce()
    expect(h.defense.updateFlow).toHaveBeenCalledExactlyOnceWith(.02, 2)
  })

  it('uses the new phase immediately when preparation ends, before civilian orders or actor updates', () => {
    const h = defenseFixture('PREPARING', true), actor = combatActor('soldier'), log: string[] = []
    h.defense.fieldNpcs = [actor]
    h.defense.updateFlow.mockImplementation(() => { h.defense.phase = 'ATTACKING'; log.push('flow') })
    vi.mocked(h.simulation.updateCommandCue).mockImplementation(() => { log.push('cue') })
    h.defense.updateCivilianOrder.mockImplementation(() => { log.push('civilian-order') })
    actor.update.mockImplementation(() => { log.push('actor') })
    h.careerMounts.update.mockImplementation(() => { log.push('career-mount') })
    h.combat.update(.02, 0, 0)
    expect(log).toEqual(['flow', 'cue', 'civilian-order', 'actor', 'career-mount'])
    expect(actor.updateTownPeace).not.toHaveBeenCalled()
  })

  it('keeps waiting enemies out of combat while advancing their mounts, dead mounts and riderless mounts', () => {
    const h = defenseFixture(), waiting = combatActor('waiting', Faction.ENEMY), dead = combatActor('dead-waiting', Faction.ENEMY), controlled = combatMount(), corpseMount = combatMount(), unowned = combatMount()
    waiting.mount = controlled; controlled.riderNpc = waiting
    dead.dead = true; corpseMount.dead = true
    h.defense.waitingEnemies = [waiting, dead]; h.defense.enemyMounts = [controlled, corpseMount, unowned]
    h.combat.update(.02, 0, 0)
    expect(waiting.update).not.toHaveBeenCalled(); expect(waiting.updateTownPeace).toHaveBeenCalledOnce()
    expect(controlled.beginControlledFrame).toHaveBeenCalledOnce()
    expect(controlled.finishControlledFrame).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
    expect(dead.updateTownPeace).not.toHaveBeenCalled(); expect(controlled.update).not.toHaveBeenCalled()
    expect(corpseMount.update).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
    expect(unowned.update).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
  })

  it.each(['PREPARING', 'ATTACKING'] as const)('gates NPC impacts in %s, preserving hostile attribution and player hostility', phase => {
    const h = defenseFixture(phase), rider = combatActor('rider', Faction.ENEMY), ally = combatActor('enemy-ally', Faction.ENEMY), target = combatActor('town-target'), mount = combatMount()
    rider.mount = mount; mount.riderNpc = rider; rider.hostileToPlayer = true
    h.defense.fieldNpcs = [rider, ally, target]
    h.combat.update(.02, 0, 5)
    expect(h.simulation.hitNpc).toHaveBeenCalledTimes(1)
    expect(h.simulation.damagePlayer).toHaveBeenCalledTimes(1)
    if (phase === 'ATTACKING') {
      expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(target, expect.any(Number), 'mount-impact', rider)
      expect(h.simulation.damagePlayer).toHaveBeenCalledExactlyOnceWith(rider, expect.any(Number), 'mount-impact')
      rider.hostileToPlayer = false
      h.combat.update(.02, 0, 6)
      expect(h.simulation.damagePlayer).toHaveBeenCalledOnce()
      rider.hostileToPlayer = true; h.player.dead = true
      h.combat.update(.02, 0, 7)
      expect(h.simulation.damagePlayer).toHaveBeenCalledOnce()
    }
  })

  it('routes player mount impacts only to living enemies and preserves NPC projectile identity', () => {
    const h = defenseFixture(), enemy = combatActor('enemy', Faction.ENEMY), ally = combatActor('ally'), dead = combatActor('dead', Faction.ENEMY), mount = combatMount()
    dead.dead = true; h.player.currentMount = mount; h.careerMounts.activeMount = mount
    h.defense.fieldNpcs = [enemy, ally, dead]
    const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1)
    enemy.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, hit, fire) => { hit(8, true); fire(origin, direction, 'pilum') })
    h.combat.update(.02, 0, 0)
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(enemy, expect.any(Number), 'mount-impact')
    expect(h.simulation.damagePlayer).toHaveBeenCalledExactlyOnceWith(enemy, 8, 'melee')
    expect(h.simulation.fireNpc).toHaveBeenCalledExactlyOnceWith(origin, direction, 'pilum', enemy)
  })
})
