import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createTownDefenseMission, type CareerMissionPhase } from '../src/career/CareerMissionState'
import { createCavalrySweepMission } from '../src/career/CavalrySweep'
import { createCareerDuelMission } from '../src/career/CareerDuelState'
import { createCareerProfile } from '../src/career/CareerProfile'
import { createEnemyTownAssaultMission } from '../src/career/EnemyTownAssault'
import { getTerrainHeight } from '../src/world/Terrain'
import { Faction, type NPC } from '../src/world/NPC'
import { combatActor, combatFixture, combatMount, combatResident } from './helpers/townMissionCombat'

function duelFixture(phase: CareerMissionPhase = 'ENGAGING') {
  const h = combatFixture()
  h.duel.active = createCareerDuelMission(createCareerProfile('roman'), 'roman_archer', 1, 'opponent', 'captain')!
  h.duel.phase = phase
  h.duel.combatEnabled = phase === 'ENGAGING'
  const opponent = combatActor('opponent'), captain = combatActor('captain')
  h.duel.fieldNpcs = [captain, opponent]
  h.duel.opponent = opponent
  return { ...h, opponent, captain }
}

function defenseFixture(phase: CareerMissionPhase = 'ATTACKING', assault = false) {
  const h = combatFixture()
  h.defense.active = assault ? createEnemyTownAssaultMission() : createTownDefenseMission(['captain'], [], 'defense')
  h.defense.phase = phase
  h.defense.assault = assault
  return h
}

describe('Town field combat through the mission interface', () => {
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

  it('clears preparing projectiles before the first FIGHT actor update and persists only after mounts advance', () => {
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
    expect(log).toEqual(['countdown', 'clear-shots', 'referee', 'opponent', 'dead-mount', 'career-mount', 'persist'])
    h.combat.update(.02, 0, 2)
    expect(h.simulation.clearCombatShots).toHaveBeenCalledOnce()
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

  it('routes opponent damage and shots with its identity while ignoring NPC damage requests', () => {
    const h = duelFixture(), unrelated = combatActor('unrelated'), origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1)
    h.opponent.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, hit, fire) => {
      hit(8, true); hit(8, false, unrelated); fire(origin, direction, 'arrow')
    })
    h.combat.update(.02, 0, 0)
    expect(h.simulation.damagePlayer).toHaveBeenCalledExactlyOnceWith(h.opponent, 8, 'melee')
    expect(h.simulation.hitNpc).not.toHaveBeenCalled()
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
      expect(peers).toEqual([second])
      acquired.push(grid!.findNearest(observer.combatPosition, candidate => !candidate.dead && candidate.faction !== observer.faction))
    })
    h.combat.update(.02, 0, 0)
    expect(acquired).toEqual([first, second])
    expect(first.update).toHaveBeenCalledOnce()
    expect(h.simulation.hitNpc).toHaveBeenCalledExactlyOnceWith(first, 100, 'melee', killer)
    expect(killer.update.mock.calls[0][11]).toBe(observer.update.mock.calls[0][11])
    expect(killer.update.mock.calls[0][11]).not.toBe(first.update.mock.calls[0][11])
  })

  it.each([false, true])('preserves PREPARING assault=%s exceptions for living military, civilians and corpses', assault => {
    const h = defenseFixture('PREPARING', assault), soldier = combatActor('soldier'), civilian = combatActor('civilian'), corpse = combatActor('corpse')
    civilian.townCategory = 'civilian'; corpse.dead = true
    h.defense.fieldNpcs = [soldier, civilian, corpse]
    h.combat.update(.02, 2, 1)
    expect(soldier.update).toHaveBeenCalledTimes(assault ? 0 : 1)
    expect(soldier.updateTownPeace).toHaveBeenCalledTimes(assault ? 1 : 0)
    expect(h.defense.updateCivilianOrder).toHaveBeenCalledTimes(assault ? 2 : 3)
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
    expect(h.simulation.hitNpc).toHaveBeenCalledTimes(phase === 'PREPARING' ? 0 : 1)
    expect(h.simulation.damagePlayer).toHaveBeenCalledTimes(phase === 'PREPARING' ? 0 : 1)
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
