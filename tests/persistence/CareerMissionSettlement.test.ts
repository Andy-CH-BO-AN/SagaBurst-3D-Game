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
import { townRoster } from '../../src/town/TownRules'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { resolveTownActorEquipment } from '../../src/career/CareerTownEquipmentState'
import { addCareerItem } from '../../src/career/CareerInventory'

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
    preservesResident: vi.fn(() => false), inventory: { sheathAll: vi.fn() }, releaseExternalThreat: vi.fn(), beginPatrolMissionReturn: vi.fn(() => events.push('native-return')),
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
  it('atomically rebuilds Commander defense at home without replaying battle checkpoints or rewards', () => {
    const h = fixture('town-defense', true), profile = h.read()
    profile.rank = 'commander'; profile.totalMerit = 20000
    const civilians = townRoster().filter(spec => spec.role === 'civilian' || spec.role === 'merchant').map(spec => spec.id)
    profile.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      missionId: profile.activeMission!.id, actorIds: civilians,
      owners: Object.fromEntries(civilians.map(id => [id, 'player' as const])),
      members: Object.fromEntries(civilians.map(id => [id, { status: 'dead' as const, hp: 0 }])) }
    const services = ['commander', 'hr-officer', 'eagle-trainer', 'captain', 'horse-vendor']
    profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', sceneKey: 'town-home', squadId: 1,
      commandRank: 'commander', actorIds: ['resident', ...services], squads: [{ squadId: 1, actorIds: ['resident', ...services] }],
      commandedActorIds: [...services], nativeReturnStates: { resident: 'REFIT' }, state: 'FOLLOWING', authorized: true,
      contribution: emptyPersonalContribution(), members: Object.fromEntries(['resident', ...services].map(id => [id,
        { status: 'dead' as const, hp: 0, position: { x: 500, z: 500, yaw: 1 } }])) }
    profile.townAirCommandSquad = { type: 'town-air-command', squadId: 8, townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: ['town-eagle-rider:1'], commandedActorIds: ['town-eagle-rider:1'],
      members: { 'town-eagle-rider:1': { status: 'deployed', order: 'charge', position: { x: 500, z: 500, yaw: 1 } } } }
    profile.townEagleGarrisons = { roman: { version: 1, sceneKey: 'town:roman', pairs: [] } }
    addCareerItem(profile, 'horse', 1)
    const refs = resolveTownActorEquipment(profile, 'roman', 'merchant').refs
    profile.townEquipment = { roman: { version: 1, residentEquipmentVersion: 1, nativeReserve: [],
      actors: { merchant: { ...refs, mount: { itemId: 'horse', source: 'inventory' } } } } }
    const equipment = structuredClone(profile.townEquipment)
    h.town.preservesResident.mockReturnValue(true)
    expect(h.store.save(profile)).toBe(true)
    h.storage.writable = false
    expect(h.settlement.returnToTown('direct').status).toBe('save-failed')
    expect(h.events).toEqual(['save'])
    expect(h.town.restart).not.toHaveBeenCalled()
    expect(h.store.load()!.townCommandSquad!.members!.resident).toMatchObject({ status: 'dead', hp: 0 })
    h.storage.writable = true; h.events.length = 0
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    expect(h.events).toEqual(['save', 'defense-cleanup'])
    const saved = h.store.load()!
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(saved)
    expect(saved.civilianCommandSquad?.actorIds).toHaveLength(21)
    expect(new Set(Object.values(saved.civilianCommandSquad!.owners))).toEqual(new Set(['daily']))
    expect(saved.civilianCommandSquad?.members.merchant).toEqual({ status: 'deployed', order: 'attack' })
    expect(saved.townCommandSquad?.members?.resident).toEqual({ status: 'reserve' })
    for (const id of ['commander', 'hr-officer', 'eagle-trainer', 'captain'])
      expect(saved.townCommandSquad?.members?.[id]).toEqual({ status: 'reserve', order: 'attack' })
    expect(saved.townCommandSquad?.nativeReturnStates).toBeUndefined()
    expect(saved.townCommandSquad?.commandedActorIds).toEqual([])
    expect(saved.townCommandSquad?.state).toBe('TRAINING')
    expect(saved.townAirCommandSquad).toBeUndefined()
    expect(saved.townEagleGarrisons?.roman).toBeUndefined()
    expect(saved.townEquipment).toEqual(equipment)
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    const merit = saved.totalMerit
    h.reload(); expect(h.settlement.returnToTown('direct').status).toBe('ignored')
    expect(h.store.load()?.totalMerit).toBe(merit)
    expect(h.town.beginPatrolMissionReturn).not.toHaveBeenCalled()
  })

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

  it('rebuilds Captain defense only after saving instead of partially repairing the outgoing scene', () => {
    const h = fixture('town-defense', true)
    expect(h.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(h.events).toEqual(['save', 'defense-cleanup'])
    expect(h.read().activeMission).toBeUndefined()
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(h.store.load())
    expect(h.town.navigation.sync).not.toHaveBeenCalled()
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
