import { describe, expect, it, vi } from 'vitest'
import { TOWN_SITES, townMilitaryEquipment, townPatrolRefitPoint } from '../../src/town/TownRules'
import { MountType } from '../../src/world/Mount'
import { getTerrainHeight } from '../../src/world/Terrain'
import { combatFixture } from '../helpers/townMissionCombat'
import { createTownPatrolEncounter } from '../helpers/townPatrolEncounter'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
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

describe('Town patrol outskirts engagement and casualty recovery', () => {
  it('refits a whole Patrol wiped by mission enemies with the same identities and mounts, without roaming actors', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3, B: 2 } }), e = createTownPatrolEncounter(h)
    const f = combatFixture({ simulation: {
      residents: h.residents, patrol: () => h.controller,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: (r, dt) => { h.controller.updateResident(r, dt, h.camera, h.obstacles, h.navigation) },
    } })
    f.field.active = { ...createActiveCareerMission('patrol-wipe', 0, 0, 0, 'patrol-wipe'), kind: 'veteran-field' }
    f.field.missionBandits = [e.bandit]; f.field.fieldNpcs = [e.bandit]
    const updates = h.residents.map(r => vi.spyOn(r.npc, 'update').mockImplementation(() => {}))
    const originals = e.a.members.map(r => ({ npc: r.npc, id: r.spec.id, mount: r.homeMount }))
    f.combat.update(.4, 0, 0)
    expect(e.a.state).toBe('ENGAGING')
    expect(e.b!.state).not.toBe('ENGAGING')
    expect(h.controller.combatActors).toHaveLength(3)
    expect(updates.slice(0, 3).every(update => update.mock.calls.length === 1)).toBe(true)
    for (const r of e.a.members) { r.npc.takeDamage(999999); r.homeMount!.takeDamage(999999) }
    expect(e.a.members.every(r => r.npc.dead)).toBe(true)
    f.combat.update(.01, 0, .41)
    expect(e.a.state).not.toBe('ENGAGING')
    for (const [i, r] of e.a.members.entries()) {
      expect(r.npc).toBe(originals[i].npc)
      expect(r.npc.combatantId).toBe(originals[i].id)
      expect(r.npc.dead).toBe(false)
      expect(r.npc.hpRatio).toBe(1)
      expect(r.npc.mount).toBe(originals[i].mount)
      expect(r.homeMount!.dead).toBe(false)
      expectBarracksRefitPoint(r.npc.combatPosition)
      expect(h.controller.isReserveAvailable(r.spec.id)).toBe(true)
    }
    expect(f.field.missionBandits).toEqual([e.bandit])
    expect(f.field.friendlies).toEqual([])
  })

  it('alerts A from a rear member while excluding one mission borrower and keeping B independent', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3, B: 2 } }), e = createTownPatrolEncounter(h), borrowed = e.a.members.slice(0, 1)
    for (const r of borrowed) h.controller.relinquish(r.spec.id)
    const commands = borrowed.map(r => r.npc.formationCommandId)
    e.frame(.1)
    expect(e.a.state).toBe('ENGAGING'); expect(e.b!.state).not.toBe('ENGAGING')
    expect(h.controller.combatActors).toHaveLength(2)
    expect(e.a.members.slice(1).every(r => !h.controller.isReserveAvailable(r.spec.id))).toBe(true)
    expect(borrowed.every(r => !h.controller.combatEnabled(r.npc))).toBe(true)
    expect(borrowed.map(r => r.npc.formationCommandId)).toEqual(commands)
    expect(h.controller.relinquish(e.a.members[1].spec.id)).toBe(false)
  })

  it('queries nearby hostiles only once across three short frames after A engages', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h)
    for (const r of e.a.members.slice(0, 1)) h.controller.relinquish(r.spec.id)
    const query = vi.spyOn(e.grid, 'getNearbyInto')
    e.frame(.1)
    expect(e.a.state).toBe('ENGAGING')
    expect(query).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) e.frame(.01)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('keeps one origin while a second hostile squad joins, then returns everyone after the last squad disengages', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h)
    e.frame()
    const origin = e.a.engagementOrigin!.clone()
    e.cavalry.group.position.copy(origin).x += 30
    e.frame()
    e.bandit.dead = true; e.frame()
    expect(e.a.state).toBe('ENGAGING'); expect(e.a.engagementOrigin).toEqual(origin)
    Object.assign(e.cavalry, { encounterAggroState: 'returning' }); e.frame()
    expect(e.a.state).toBe('RETURN_TO_BARRACKS')
    expect(e.a.members.every(r => h.controller.returnStateFor(r.spec.id) === 'RETURN_TO_BARRACKS')).toBe(true)
    expect(h.controller.combatActors).toHaveLength(0)
  })

  it('ends a leashed engagement without pursuing the surviving enemy across the map', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h)
    e.frame(); const origin = e.a.engagementOrigin!.clone()
    e.bandit.group.position.copy(origin).x += 59
    e.frame()
    expect(e.bandit.dead).toBe(false); expect(e.a.state).toBe('RETURN_TO_BARRACKS')
    e.frame()
    expect(e.a.state).toBe('RETURN_TO_BARRACKS')
  })

  it('lets a lethal first hit alert the survivors, delays Captain restore and keeps a returning deputy until physical reunion', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h), [captain, deputy] = e.a.members
    const identity = captain.npc, originalMount = captain.homeMount
    e.bandit.group.position.copy(captain.npc.combatPosition).x += 3
    captain.npc.takeDamage(999999)
    expect(h.controller.noteHostileHit(captain.npc, e.bandit)).toBe(true)
    e.frame()
    expect(captain.npc.dead).toBe(true); expect(h.controller.returnStateFor(captain.spec.id)).toBeNull()
    expect(h.controller.combatActors).toHaveLength(3)
    expect(e.a.activeLeaderActorId).toBe(deputy.spec.id)
    e.bandit.dead = true; e.frame()
    expect(captain.npc).toBe(identity); expect(captain.homeMount).toBe(originalMount)
    expect(captain.npc.dead).toBe(false); expect(h.controller.returnStateFor(captain.spec.id)).toBe('REJOIN_PATROL')
    expectBarracksRefitPoint(captain.npc.combatPosition)
    e.frame()
    expect(e.a.activeLeaderActorId).toBe(deputy.spec.id)
    expect(h.controller.isReserveAvailable(captain.spec.id)).toBe(true)
  })

  it('keeps a dismounted Captain leading and ordinary dismounted members fighting until human death', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h), [captain, ordinary, deputy] = e.a.members
    e.frame()
    captain.homeMount!.takeDamage(999999); ordinary.homeMount!.takeDamage(999999)
    e.frame()
    expect(captain.npc.isMounted).toBe(false); expect(ordinary.npc.isMounted).toBe(false)
    expect(e.a.activeLeaderActorId).toBe(captain.spec.id)
    expect(h.controller.combatEnabled(captain.npc)).toBe(true); expect(h.controller.combatEnabled(ordinary.npc)).toBe(true)
    captain.npc.takeDamage(999999); e.frame()
    expect(e.a.activeLeaderActorId).toBe(ordinary.spec.id)
    expect(e.a.activeLeaderActorId).not.toBe(deputy.spec.id)
  })

  it('treats a complete Patrol wipe as engagement end and restores the same three identities only then', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h), identities = e.a.members.map(r => r.npc)
    e.frame()
    for (const r of e.a.members) { r.npc.takeDamage(999999); r.homeMount!.takeDamage(999999) }
    expect(e.a.members.every(r => r.npc.dead)).toBe(true)
    e.frame(.01)
    expect(e.a.members.map(r => r.npc)).toEqual(identities)
    expect(e.a.members.every(r => !r.npc.dead && r.npc.mount === r.homeMount && h.controller.returnStateFor(r.spec.id) === 'REJOIN_PATROL')).toBe(true)
    expect(new Set(e.a.members.map(r => `${r.npc.combatPosition.x},${r.npc.combatPosition.z}`)).size).toBe(3)
  })

  it('reengages returners and refitted rejoiners on a hit at B, preserving wounds and the original refit destination', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 4 } }), e = createTownPatrolEncounter(h), [captain, rejoined, borrowed, wounded] = e.a.members
    e.frame(); e.bandit.dead = true; e.frame()
    for (const r of [rejoined, borrowed]) {
      const p = townPatrolRefitPoint(r.spec)
      r.homeMount!.group.position.set(p.x, getTerrainHeight(p.x, p.z), p.z)
      h.navigation.beginFrame(); h.controller.updateResident(r, .1, h.camera, h.obstacles, h.navigation)
      expect(h.controller.returnStateFor(r.spec.id)).toBe('REJOIN_PATROL')
    }
    h.controller.relinquish(borrowed.spec.id)
    wounded.homeMount!.takeDamage(999999); wounded.npc.takeDamage(30)
    const hp = wounded.npc.hp, target = vi.spyOn(wounded.npc, 'assignFormationTarget')
    h.navigation.beginFrame(); h.controller.updateResident(wounded, .1, h.camera, h.obstacles, h.navigation)
    const originalDestination = target.mock.calls[0][1].clone()
    e.bandit.dead = false
    captain.homeMount!.group.position.set(80, getTerrainHeight(80, 0), 0)
    e.bandit.group.position.copy(captain.npc.combatPosition).x += 3
    expect(h.controller.noteHostileHit(captain.npc, e.bandit)).toBe(true)
    expect(e.a.engagementOrigin).toEqual(captain.npc.combatPosition)
    expect(h.controller.combatActors).toHaveLength(3)
    expect(h.controller.combatEnabled(rejoined.npc)).toBe(true)
    expect(h.controller.combatEnabled(borrowed.npc)).toBe(false)
    expect(h.controller.combatEnabled(wounded.npc)).toBe(true)
    expect(wounded.npc.hp).toBe(hp); expect(wounded.homeMount!.dead).toBe(true)
    e.bandit.dead = true; e.frame()
    h.navigation.beginFrame(); h.controller.updateResident(wounded, .1, h.camera, h.obstacles, h.navigation)
    expect(target.mock.calls.at(-1)![1]).toEqual(originalDestination)
    expect(wounded.npc.hp).toBe(hp); expect(wounded.homeMount!.dead).toBe(true)
  })

  it('restores Roman combat casualties with canonical Captain mounts and loadout only at their slots', () => {
    const faction = 'roman' as const
    const h = createTownPatrolFixture({ faction, patrolMembers: { A: 3 } }), e = createTownPatrolEncounter(h), [captain, foot, dead] = e.a.members
    e.frame()
    captain.npc.applyTemporaryCombatLoadout(townMilitaryEquipment(faction, 'lancer_cavalry').loadout, 3)
    captain.npc.takeDamage(999999); captain.homeMount!.takeDamage(999999)
    dead.npc.takeDamage(999999); foot.homeMount!.takeDamage(999999); foot.npc.takeDamage(30)
    e.frame()
    expect(captain.npc.dead).toBe(true); expect(dead.npc.dead).toBe(true); expect(foot.homeMount!.dead).toBe(true)
    e.bandit.dead = true; e.frame()
    expect(captain.npc.hpRatio).toBe(1); expect(captain.npc.tier).toBe(4)
    expect(captain.npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(captain.homeMount!.type).toBe(MountType.CORGI)
    expect(dead.npc.hpRatio).toBe(1); expect(dead.npc.mount).toBe(dead.homeMount)
    expect(foot.homeMount!.dead).toBe(true); expect(h.controller.isReserveAvailable(foot.spec.id)).toBe(false)
    const p = townPatrolRefitPoint(foot.spec)
    foot.npc.group.position.set(p.x, getTerrainHeight(p.x, p.z), p.z)
    h.navigation.beginFrame(); h.controller.updateResident(foot, .1, h.camera, h.obstacles, h.navigation)
    expect(foot.npc.mount).toBe(foot.homeMount); expect(foot.homeMount!.dead).toBe(false)
    expect(foot.npc.hpRatio).toBe(1); expect(h.controller.isReserveAvailable(foot.spec.id)).toBe(true)
  })

  it('runs the available minimal Patrol exactly once through shared mission combat without stealing borrowed actors', () => {
    const h = createTownPatrolFixture({ patrolMembers: { A: 3, B: 2 } }), e = createTownPatrolEncounter(h), borrowed = e.a.members.slice(0, 1)
    for (const r of borrowed) h.controller.relinquish(r.spec.id)
    const outskirts = { ...e.roaming, actors: e.actors, mounts: [], synchronizeRank() {}, prepareFrame() {}, combatEnabled: () => true, updateTravel() {} }
    const f = combatFixture({ simulation: {
      residents: h.residents, patrol: () => h.controller, outskirts: () => outskirts,
      preparePeaceResidents: excluded => h.controller.beginFrame(excluded),
      peaceResident: vi.fn(r => { h.controller.updateResident(r, .1, h.camera, h.obstacles, h.navigation) }),
    } })
    f.field.fieldNpcs = borrowed.map(r => r.npc); f.field.friendlies = borrowed.map(r => r.npc)
    const updates = h.residents.map(r => vi.spyOn(r.npc, 'update').mockImplementation(() => {}))
    f.combat.update(.4, 0, 1)
    expect(h.controller.combatActors).toHaveLength(2)
    expect(updates.slice(0, 3).every(update => update.mock.calls.length === 1)).toBe(true)
    expect(updates.slice(3).every(update => update.mock.calls.length === 0)).toBe(true)
    expect(f.simulation.peaceResident).toHaveBeenCalledTimes(2)
    expect(f.combat.isExternalThreatDefender(e.a.members[1].npc)).toBe(true)
  })
})
