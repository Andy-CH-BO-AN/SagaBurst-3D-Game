import { Vector3 } from 'three'
import { describe,expect,it,vi } from 'vitest'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { createActiveCareerMission,createTownDefenseMission } from '../../src/career/CareerMissionState'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import { claimCareerMission,createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import type { NPC } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Save/controller boundaries only. Position and yaw are data, never an Object3D or scene tree. */
function fixture(kind: 'bandit' | 'captain-patrol-command' | 'town-defense' | 'veteran-field' = 'bandit', completed = false) {
  const events: string[] = []
  let profile = createCareerProfile('roman')
  profile.activeMission = kind === 'captain-patrol-command'
    ? createCaptainPatrolCommandMission(profile, ['patrol:captain'], 'settlement')
    : kind === 'town-defense' ? createTownDefenseMission(['resident'], [], 'settlement')
    : { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'settlement'), kind }
  const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
  if (completed) {
    profile = claimCareerMission(profile, 'settlement', 'victory', stats).profile
    profile.activeMission!.phase = 'RETURNING'
  }
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const residentState = { dead: true, group: { position: new Vector3(9, 0, 9), rotation: { y: 0 } },
    dismountFromMount: vi.fn(), restoreForTown: vi.fn(() => { residentState.dead = false; events.push('restore') }), mountVehicle: vi.fn() }
  const resident = { spec: { id: 'resident', role: 'melee_infantry', x: 2, z: 3, yaw: .5 },
    npc: residentState as unknown as NPC, cycle: 3, walkTime: 2 }
  const field = { friendlies: [resident.npc], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn(() => events.push('cleanup')) }
  const duel = { actors: [], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn() }
  const defense = { active: kind === 'town-defense' ? profile.activeMission : undefined, snapshot: vi.fn(() => ({ player: stats, squads: [] })),
    civilianSurvived: 2, civilianDeaths: 1, cleanupMission: vi.fn(() => events.push('defense-cleanup')) }
  const patrol = { actors: [resident.npc], statsSnapshot: { player: stats, squads: [] }, release: vi.fn(() => events.push('release')) }
  const player = { group: { position: new Vector3(50, 80, 70), rotation: { y: 0 } }, resetForScene: vi.fn((x: number, y: number, z: number) => {
    expect(store.load()!.playerAerialState).toBeUndefined()
    player.group.position.set(x, y, z); events.push('reset')
  }) }
  const town = { residents: [resident], player, cat: { restoreForTown: vi.fn(), catVisual: null },
    world: { obstacles: [], restoreTownDamage: vi.fn(() => events.push('repair')) }, navigation: { sync: vi.fn(() => { events.push('navigation'); return true }) },
    inventory: { sheathAll: vi.fn() }, releaseExternalThreat: vi.fn(), beginPatrolMissionReturn: vi.fn(() => events.push('native-return')),
    clearCombatShots: vi.fn(), restPlayer: vi.fn(), restart: vi.fn(), returnPersonalSquad: vi.fn() }
  const commit = vi.fn((next: CareerProfile, options?: { groundedTownReturn?: boolean }) => {
    if (options?.groundedTownReturn) expect(next.playerAerialState).toBeUndefined()
    events.push('save')
    if (!store.save(next)) return false
    profile = store.load()!
    return true
  })
  // The concrete controller requires the full render-facing Player.group type; only position/yaw is consumed here.
  const settlement = new TownMissionSettlement({ read: () => profile, commit }, { field, duel, defense, patrol },
    town as unknown as ConstructorParameters<typeof TownMissionSettlement>[2])
  return { settlement, field, defense, patrol, town, player, resident, residentState, storage, store, events, commit, stats,
    read: () => profile, reload: () => { profile = store.load()! } }
}

describe('Town mission settlement transactions', () => {
  it('freezes the first personal result across a failed-save retry instead of appending later contribution', () => {
    const h = fixture()
    h.read().personalSquad = { members: [{ id: 'personal:credited', type: 'soldier' }] }
    h.read().activeMission!.personalSquad = snapshotPersonalMission(h.read())!
    const initial = { player: { ...h.stats }, squads: [], meritPlayer: { ...h.stats, damageDealt: 500, kills: 5 } }
    h.field.snapshot.mockReturnValue(initial)
    h.storage.writable = false
    expect(h.settlement.finish('victory').status).toBe('save-failed')
    initial.meritPlayer.damageDealt = 99999
    h.storage.writable = true
    expect(h.settlement.finish('failure').status).toBe('saved')
    expect(h.field.snapshot).toHaveBeenCalledOnce()
    expect(h.read().activeMission!.result).toMatchObject({ outcome: 'victory', stats: { damageDealt: 200 }, meritStats: { damageDealt: 500, kills: 5 } })
  })

  it('does not publish a failed result and grants its reward once after retry and reload', () => {
    const h = fixture(), before = h.read()
    h.storage.writable = false
    expect(h.settlement.finish('victory')).toEqual({ status: 'save-failed' })
    expect(h.read()).toBe(before)
    expect(h.read().activeMission!.result).toBeUndefined()
    expect(h.field.cleanupMission).not.toHaveBeenCalled()
    h.storage.writable = true
    expect(h.settlement.finish('victory').status).toBe('saved')
    const merit = h.read().totalMerit
    expect(merit).toBeGreaterThan(0)
    h.reload()
    expect(h.settlement.finish('victory')).toEqual({ status: 'ignored' })
    expect(h.read().totalMerit).toBe(merit)
    expect(h.read().lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 1 })
    expect(h.commit).toHaveBeenCalledTimes(2)
  })

  it('keeps borrowed ownership and live state untouched when saving the return fails', () => {
    const h = fixture('captain-patrol-command', true)
    h.storage.writable = false
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'save-failed', destination: 'party' })
    expect(h.read().activeMission).toBeDefined()
    expect(h.patrol.release).not.toHaveBeenCalled()
    expect(h.town.returnPersonalSquad).not.toHaveBeenCalled()
    expect(h.player.resetForScene).not.toHaveBeenCalled()
    expect(h.town.restPlayer).not.toHaveBeenCalled()
  })

  it('carries battle-worn private state into an arrived return without awarding merit again', () => {
    const h = fixture('bandit', true), profile = h.read()
    profile.personalSquad = { members: [{ id: 'personal:wounded', type: 'soldier' }] }
    profile.activeMission!.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission!.personalSquad!.state = 'ACTIVE'
    profile.activeMission!.personalSquad!.members['personal:wounded'] = { status: 'deployed', hp: 9, ammo: 0, shieldImpact: 1 }
    const merit = profile.totalMerit, position = h.player.group.position.clone()
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.read().activeMission).toBeUndefined()
    expect(h.read().personalSquadRuntime?.members['personal:wounded']).toMatchObject({ hp: 9, ammo: 0, shieldImpact: 1 })
    expect(h.read().personalSquad?.members.map(({ id, type }) => ({ id, type }))).toEqual([{ id: 'personal:wounded', type: 'soldier' }])
    expect(h.read().totalMerit).toBe(merit)
    expect(h.player.group.position).toEqual(position)
    expect(h.town.returnPersonalSquad).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('commits a grounded Captain return before resetting the airborne player and releasing the patrol once', () => {
    const h = fixture('captain-patrol-command', true)
    h.read().playerAerialState = { sceneKey: 'town-home', hp: 100, dead: false, position: { x: 50, y: 80, z: 70, yaw: 0 },
      fall: { active: true, highestFeetY: 100, velocity: { x: 0, y: -10, z: 0 } } }
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.events).toEqual(['save', 'release', 'reset'])
    expect(h.read().playerAerialState).toBeUndefined()
    expect(h.read().activeMission).toBeUndefined()
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(h.patrol.release).toHaveBeenCalledOnce()
  })

  it('commits defense recovery before cleanup, repairs and navigation synchronization', () => {
    const h = fixture('town-defense', true)
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'defense' })
    expect(h.events).toEqual(['save', 'defense-cleanup', 'restore', 'repair', 'navigation'])
    expect(h.read().activeMission).toBeUndefined()
    expect(h.town.navigation.sync).toHaveBeenCalledExactlyOnceWith(h.town.world.obstacles)
  })

  it('cannot abandon an unfinished Veteran battle through direct return', () => {
    const h = fixture('veteran-field')
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(h.read().activeMission).toBeDefined()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.field.cleanupMission).not.toHaveBeenCalled()
  })

  it('hands a borrowed patrol member to its native return owner only after clearing the saved mission', () => {
    const h = fixture('veteran-field', true)
    Object.assign(h.resident.spec, { duty: 'patrol' })
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.events).toEqual(['save', 'cleanup', 'native-return'])
    expect(h.town.beginPatrolMissionReturn).toHaveBeenCalledExactlyOnceWith('resident')
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
  })
})
