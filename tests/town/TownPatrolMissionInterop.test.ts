import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { Faction, NPC, AIType, AIState } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { TOWN_SITES, townMilitaryEquipment, townRoster } from '../../src/town/TownRules'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { CaptainPatrolCommandController } from '../../src/career/CaptainPatrolCommandController'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { getTerrainHeight } from '../../src/world/Terrain'
import { combatActor, combatFixture } from '../helpers/townMissionCombat'
import { advanceUntil } from '../helpers/simulation'
import { createActiveCareerMission, createTownDefenseMission } from '../../src/career/CareerMissionState'
import { installTownPatrolFixtureEnvironment } from '../helpers/townPatrolFixture'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const createTownPatrolFixture = installTownPatrolFixtureEnvironment()


function expectBarracksRefitPoint(point: { x: number; z: number; yaw?: number }) {
  const barracks = TOWN_SITES.barracks, dx = point.x - barracks.x, dz = point.z - barracks.z
  const side = Math.cos(barracks.yaw) * dx - Math.sin(barracks.yaw) * dz
  const forward = Math.sin(barracks.yaw) * dx + Math.cos(barracks.yaw) * dz
  // The actual hut is at (34, 30); its clear southern courtyard is local side 22..40, forward -31.5..0.
  expect(side).toBeGreaterThanOrEqual(22 - 1e-8); expect(side).toBeLessThanOrEqual(40 + 1e-8)
  expect(forward).toBeGreaterThanOrEqual(-31.5 - 1e-8); expect(forward).toBeLessThanOrEqual(1e-8)
  if (point.yaw !== undefined) expect(point.yaw).toBe(barracks.yaw)
}

describe('Town patrol mission ownership and return interop', () => {
  it('hands over a real attacking Captain without cancelling animation or losing either combat target (2 NPC, 1 Mount)', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 1 } }), leader = h.residents[0]
    leader.npc.dismountFromMount()
    leader.npc.group.position.set(150, getTerrainHeight(150, 0), 0)
    const enemy = new NPC(h.scene, 150, 2, Faction.ENEMY, 'viking', AIType.MELEE, 'Hostile', 2, false, undefined, undefined, undefined, 'enemy:live')
    enemy.respawnEnabled = false
    onTestFinished(() => enemy.dispose())
    // The other 19 official identities are casualties: records protect handover policy without constructing a full squad.
    const records = townRoster().filter(spec => spec.patrolId === 'A' && spec.id !== leader.spec.id).map(spec => {
      const npc = Object.assign(combatActor(spec.id), { dead: true, hp: 0, combatAmmo: 0, shield: { shieldImpactRemaining: 0 },
        name: spec.id, setCommandAllegiance: vi.fn(), setCommandSquad: vi.fn(), setTownPeaceful: vi.fn() })
      return { spec, npc }
    })
    const residents = [leader, ...records], patrol = new TownCavalryPatrolController(residents)
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    const p = { dead: false, targetable: false, combatPosition: new THREE.Vector3(1000, 0, 1000), currentMount: null } as unknown as Player
    leader.npc.configureBanditEncounter(leader.npc.combatPosition, [], 58); leader.npc.triggerEncounterAlert()
    const f = combatFixture({ simulation: { player: () => p,
      residents: [leader, { ...leader, npc: enemy, spec: { ...leader.spec, id: enemy.combatantId } }],
      commandActors: () => [leader.npc, enemy] } })
    advanceUntil(() => leader.npc.currentState === AIState.ATTACK && enemy.inCombat,
      () => f.combat.update(.05, 0, 0), { secondsPerStep: .05, maxSimulationSeconds: 5, failureMessage: 'Both real NPCs must engage before handover' })
    // Narrow observation seam: the public state plus actual targeting cache protect the ongoing swing.
    const captainTarget = leader.npc as unknown as { _cachedTargetNpc: NPC | null; animator: { cancel(): void } }
    const enemyTarget = enemy as unknown as { _cachedTargetNpc: NPC | null }
    expect(captainTarget._cachedTargetNpc).toBe(enemy); expect(enemyTarget._cachedTargetNpc).toBe(leader.npc)
    const cancel = vi.spyOn(captainTarget.animator, 'cancel'), hp = leader.npc.hp, position = leader.npc.combatPosition.clone()
    const runtime = new CaptainPatrolCommandController(residents, patrol, () => p, () => profile, next => { profile = next; return true })
    onTestFinished(() => runtime.dispose())
    profile.activeMission = runtime.captureForMission(createCaptainPatrolCommandMission(profile, patrol.selectAvailableSquad()!.actorIds, 'combat-handover'))!
    expect(runtime.resume(false)).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    expect(leader.npc.currentState).toBe(AIState.ATTACK)
    expect(captainTarget._cachedTargetNpc).toBe(enemy); expect(enemyTarget._cachedTargetNpc).toBe(leader.npc)
    expect(leader.npc.hp).toBe(hp); expect(leader.npc.combatPosition).toEqual(position)
    expect(leader.npc.mount).toBeNull(); expect(runtime.aliveCombatants).toBe(1)
    expect(runtime.commandsEnabled).toBe(true)
    f.combat.update(.05, 0, 1)
    expect(captainTarget._cachedTargetNpc).toBe(enemy); expect(enemyTarget._cachedTargetNpc).toBe(leader.npc)
    leader.npc.setTacticalOrder('defend')
    expect(leader.npc.tacticalOrder).toBe('defend')
  })
  it.each(['field', 'duel', 'defense'] as const)('continues during active %s while excluding only actual mission actors', kind => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 2 } }), borrowed = h.residents[1], before = h.residents[0].npc.combatPosition.clone()
    const mission = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    if (kind === 'field') mission.field.active = { ...createActiveCareerMission('patrol-test', 0, 0, 0, 'patrol-test'), kind: 'cavalry-sweep' }
    else if (kind === 'duel') { mission.duel.active = { ...createActiveCareerMission('patrol-duel', 0, 0, 0, 'patrol-duel'), kind: 'duel', phase: 'PREPARING' }; mission.duel.phase = 'PREPARING' }
    else { mission.defense.active = createTownDefenseMission([], [], 'patrol-defense'); mission.defense.phase = 'PREPARING' }
    mission.combat.update(.1, 0, 0)
    expect(h.residents[0].npc.combatPosition.distanceTo(before)).toBeGreaterThan(0)
    if (kind === 'field') mission.field.fieldNpcs = [borrowed.npc]
    else if (kind === 'duel') mission.duel.fieldNpcs = [borrowed.npc]
    else mission.defense.fieldNpcs = [borrowed.npc]
    const travel = vi.spyOn(borrowed.npc, 'updateTownTravel')
    vi.spyOn(borrowed.npc, 'update').mockImplementation(() => {})
    mission.combat.update(.1, 0, 1); expect(travel).not.toHaveBeenCalled()
  })

  it('keeps physical return ownership when an ambient bandit is nearby, without combat enrollment or a spawn reset', () => {
    const h = createTownPatrolFixture({ withWorld: true, patrolMembers: { A: 2 } }), resident = h.residents[1]
    h.controller.relinquish(resident.spec.id)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.npc.takeDamage(30)
    h.controller.beginMissionReturn(resident.spec.id)
    const bandit = combatActor('ambient-return-threat', Faction.BANDIT)
    bandit.group.position.copy(resident.npc.combatPosition)
    const combat = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation, obstacles: h.obstacles, cameraPosition: h.camera,
      ownsPeacefulTravel: npc => h.controller.returnStateFor(npc.combatantId) !== null,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    combat.field.ambientBandits = [bandit]; combat.field.fieldNpcs = [bandit]
    const enroll = vi.spyOn(resident.npc, 'beginExternalThreat')
    const start = resident.npc.combatPosition.clone(), hp = resident.npc.hp
    // Observe three seconds near a hostile: no combat enrollment or interrupted return.
    for (let frame = 0; frame < 30; frame++) {
      const previous = resident.npc.combatPosition.clone()
      combat.combat.update(.1, 0, frame / 10)
      expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
      expect(resident.npc.encounterIsAlerted).toBe(false)
      expect(h.controller.combatEnabled(resident.npc)).toBe(false)
    }
    expect(resident.npc.combatPosition.distanceTo(start)).toBeGreaterThan(1)
    expect(enroll).not.toHaveBeenCalled(); expect(resident.npc.encounterIsAlerted).toBe(false)
    expect(resident.npc.encounterAggroState).toBe('idle')
    expect(h.controller.combatEnabled(resident.npc)).toBe(false)
    expect(resident.npc.hp).toBe(hp)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
    combat.field.ambientBandits = []; combat.field.fieldNpcs = []
    const previous = resident.npc.combatPosition.clone()
    combat.combat.update(.1, 0, 3)
    expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
  })

  it('resumes ordinary Patrol navigation at its actual position after an ambient threat ends', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 2 } }), captain = h.residents[0]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'Patrol A must reach the exterior patrol loop',
    })
    const bandit = combatActor('ambient-patrol-threat', Faction.BANDIT)
    bandit.group.position.copy(captain.npc.combatPosition)
    const combat = combatFixture({ simulation: {
      residents: h.residents, navigation: h.navigation, cameraPosition: h.camera,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    h.residents.forEach(r => vi.spyOn(r.npc, 'update').mockImplementation(() => {}))
    combat.field.ambientBandits = [bandit]; combat.field.fieldNpcs = [bandit]
    combat.combat.update(.1, 0, 0)
    expect(captain.npc.formationCommandId).toBeNull()
    combat.field.ambientBandits = []; combat.field.fieldNpcs = []
    const previous = captain.npc.combatPosition.clone()
    combat.combat.update(.1, 0, .1)
    expect(captain.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
    let elapsed = .2
    advanceUntil(() => captain.npc.formationCommandId === -3 && captain.npc.combatPosition.distanceTo(previous) > 1, () => {
      const last = captain.npc.combatPosition.clone()
      combat.combat.update(.1, 0, elapsed)
      elapsed += .1
      expect(captain.npc.combatPosition.distanceTo(last)).toBeLessThan(2)
    }, { maxSimulationSeconds: 2, secondsPerStep: .1, failureMessage: 'captain must resume patrol travel after the threat ends' })
    expect(captain.npc.combatPosition.distanceTo(previous)).toBeGreaterThan(1)
    expect(captain.npc.formationCommandId).toBe(-3)
  })

  it('ordinary Patrol A rider physically rides home with mission wounds and loadout, refits at barracks, and can be borrowed during rejoin', () => {
    const h = createTownPatrolFixture({ withWorld: true, patrolMembers: { A: 2 } }), resident = h.residents[1]
    h.advanceUntil(() => h.controller.squads.every(s => s.state === 'PATROLLING'), {
      maxSimulationSeconds: 200, failureMessage: 'Patrol A must reach the exterior patrol loop',
    })
    const originalEquipment = { weapon: resident.npc.meleeWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.homeMount.group.position.set(20, getTerrainHeight(20, 140), 140)
    resident.npc.applyTemporaryCombatLoadout(townMilitaryEquipment('roman', 'lancer_cavalry').loadout, 3)
    resident.npc.takeDamage(30); resident.homeMount.takeDamage(40)
    resident.npc.shield.absorb(0, 2)
    const hp = resident.npc.hp, mountHp = resident.homeMount.currentHp, missionWeapon = resident.npc.meleeWeaponId
    const before = resident.npc.combatPosition.clone()
    const restore = vi.spyOn(resident.npc, 'restoreForTown')
    expect(h.controller.beginMissionReturn(resident.spec.id)).toBe(true)
    expect(resident.npc.combatPosition.equals(before)).toBe(true)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('RETURN_TO_BARRACKS')
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(false)
    expect(h.controller.relinquish(resident.spec.id)).toBe(false)
    // During these two seconds of return, mission wounds and equipment must persist.
    h.stepFrames(20)
    expect(resident.npc.combatPosition.distanceTo(before)).toBeGreaterThan(1)
    expect(resident.npc.hp).toBe(hp); expect(resident.homeMount.currentHp).toBe(mountHp)
    expect(resident.npc.meleeWeaponId).toBe(missionWeapon); expect(restore).not.toHaveBeenCalled()
    advanceUntil(
      () => h.controller.returnStateFor(resident.spec.id) === 'REJOIN_PATROL',
      () => {
        const previous = resident.npc.combatPosition.clone()
        h.stepFrame()
        expect(resident.npc.encounterIsAlerted).toBe(false)
        expect(h.controller.combatEnabled(resident.npc)).toBe(false)
        expect(resident.npc.combatPosition.distanceTo(previous)).toBeLessThan(2)
      },
      { maxSimulationSeconds: 250, secondsPerStep: .1, failureMessage: 'resident must complete physical return' },
    )
    expect(restore).toHaveBeenCalledTimes(1)
    const refitPoint = restore.mock.calls[0][0]!
    expectBarracksRefitPoint(refitPoint)
    expect(resident.npc.combatPosition.x).toBe(refitPoint.x); expect(resident.npc.combatPosition.z).toBe(refitPoint.z)
    expect(Math.hypot(refitPoint.x - resident.spec.x, refitPoint.z - resident.spec.z)).toBeGreaterThan(20)
    expect(h.controller.returnStateFor(resident.spec.id)).toBe('REJOIN_PATROL')
    expect(resident.npc.hpRatio).toBe(1); expect(resident.homeMount.currentHp).toBe(resident.homeMount.maxHp)
    expect(resident.npc.mount).toBe(resident.homeMount); expect(resident.npc.combatAmmo).toBe(0)
    expect(resident.npc.shield.shieldImpactRemaining).toBe(resident.npc.shield.shieldImpactMax)
    expect({ weapon: resident.npc.meleeWeaponId, shield: resident.npc.shieldId, tier: resident.npc.tier }).toEqual(originalEquipment)
    expect(resident.npc.encounterIsAlerted).toBe(false)
    expect(resident.npc.encounterAggroState).toBe('idle')
    expect(h.controller.combatEnabled(resident.npc)).toBe(false)
    expect(h.controller.isReserveAvailable(resident.spec.id)).toBe(true)
    expect(h.controller.relinquish(resident.spec.id)).toBe(true)
    resident.npc.assignFormationTarget(988, new THREE.Vector3(70, 0, 60), new THREE.Vector3(0, 0, 1))
    h.stepFrames(10)
    expect(resident.npc.formationCommandId).toBe(988)
    expect(h.controller.returnStateFor(resident.spec.id)).toBeNull()
  })
})
