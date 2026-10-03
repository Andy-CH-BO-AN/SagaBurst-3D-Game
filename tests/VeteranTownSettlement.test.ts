import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TownMissionSettlement } from '../src/town/TownMissionSettlement'
import { createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'

function fixture(result = true, liveSkills?: CareerProfile['skills']) {
  let profile = createCareerProfile('roman')
  profile.rank = 'veteran'
  const stats = { damageDealt: 40, damageTaken: 100, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
  profile.activeMission = {
    id: 'settlement-veteran', templateId: 'veteran-scout-hunters', kind: 'veteran-field', targetCampId: 0, phase: result ? 'RESULT' : 'ENGAGING',
    targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 0,
    ...(result ? { result: { outcome: 'victory', stats, claimed: true, merit: { damage: 2, kills: 6, contribution: 12, total: 20 } } as const } : {}),
  }
  const npc = { group: new THREE.Group(), dismountFromMount: vi.fn(), restoreForTown: vi.fn(), mountVehicle: vi.fn() }
  const bystander = { group: new THREE.Group(), dismountFromMount: vi.fn(), restoreForTown: vi.fn(), mountVehicle: vi.fn() }
  const homeMount = { restoreForTown: vi.fn(), dispose: vi.fn() }
  const friendlies = [npc]
  const field = { friendlies, snapshot: () => ({ player: stats, squads: [] }), cleanupMission: vi.fn(() => { friendlies.length = 0 }) }
  const duel = { actors: [], snapshot: vi.fn(), cleanupMission: vi.fn() }
  const defense = { active: undefined, snapshot: vi.fn(), cleanupMission: vi.fn(), civilianSurvived: 20, civilianDeaths: 0 }
  const town = {
    residents: [
      { npc, homeMount, spec: { role: 'captain', x: 5, z: 7, yaw: .3 }, cycle: 4, walkTime: 3 },
      { npc: bystander, spec: { role: 'merchant', x: -5, z: 7 }, cycle: 4, walkTime: 3 },
    ],
    player: { group: new THREE.Group() }, releaseExternalThreat: vi.fn(),
    cat: { restoreForTown: vi.fn() }, world: { obstacles: [], restoreTownDamage: vi.fn() },
    navigation: { sync: vi.fn() }, inventory: { sheathAll: vi.fn() },
    clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn(),
  }
  const settlement = new TownMissionSettlement({ read: () => profile, commit: next => { profile = liveSkills ? { ...next, skills: liveSkills } : next; return true } }, { field, duel, defense } as any, town as any)
  return { settlement, field, town, npc, bystander, homeMount, profile: () => profile }
}

describe('Veteran field return through existing Career settlement', () => {
  it('restarts from the committed live skills when returning from enemy territory', () => {
    const skills = { ...createCareerProfile('roman').skills!, ranged: { level: 3, xp: 61 } }
    const f = fixture(true, skills)
    f.profile().activeMission!.templateId = 'veteran-tragedy-of-the-scouts'

    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })

    expect(f.town.restart).toHaveBeenCalledExactlyOnceWith(f.profile())
    expect(f.town.restart.mock.calls[0][0].skills.ranged).toEqual({ level: 3, xp: 61 })
    expect(f.profile().activeMission).toBeUndefined()
  })

  it('restores borrowed residents and home mounts in place after a result, without touching bystanders', () => {
    const f = fixture()
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'party' })
    expect(f.profile().activeMission).toBeUndefined()
    expect(f.field.cleanupMission).toHaveBeenCalledExactlyOnceWith(0)
    expect(f.npc.restoreForTown).toHaveBeenCalledOnce()
    expect(f.homeMount.restoreForTown).toHaveBeenCalledExactlyOnceWith(5, 7, .3)
    expect(f.homeMount.dispose).not.toHaveBeenCalled()
    expect(f.bystander.restoreForTown).not.toHaveBeenCalled()
    expect(f.town.clearCombatShots).toHaveBeenCalledOnce()
    expect(f.town.restPlayer).toHaveBeenCalledOnce()
    expect(f.town.restart).not.toHaveBeenCalled()
  })
  it('cannot abandon or settle an unfinished Veteran battle through direct return', () => {
    const f = fixture(false)
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(f.profile().activeMission).toBeDefined()
    expect(f.field.cleanupMission).not.toHaveBeenCalled()
  })
})

it('clears a completed physical return without awarding merit again or restarting the scene', () => {
  const f = fixture()
  f.profile().activeMission!.phase = 'RETURNING'
  f.town.player.group.position.set(8, 0, 12)
  const position = f.town.player.group.position.clone()
  const merit = f.profile().totalMerit
  expect(f.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
  expect(f.profile().activeMission).toBeUndefined()
  expect(f.profile().totalMerit).toBe(merit)
  expect(f.town.player.group.position).toEqual(position)
  expect(f.npc.restoreForTown).toHaveBeenCalledOnce()
  expect(f.town.restart).not.toHaveBeenCalled()
  expect(f.settlement.returnToTown('arrived')).toEqual({ status: 'ignored' })
})
