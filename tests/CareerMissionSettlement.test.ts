import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCavalrySweepMission } from '../src/career/CavalrySweep'
import { createEnemyTownAssaultMission } from '../src/career/EnemyTownAssault'
import { createCareerDuelMission } from '../src/career/CareerDuelState'
import { createActiveCareerMission, createTownDefenseMission, type ActiveCareerMission, type CareerMissionOutcome } from '../src/career/CareerMissionState'
import { claimCareerMission, createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore, CAREER_STORAGE_KEY } from '../src/career/CareerProfileStore'
import { TownMissionSettlement } from '../src/town/TownMissionSettlement'
import { townRoster, townSitePoint, type TownActorSpec } from '../src/town/TownRules'
import { getTerrainHeight } from '../src/world/Terrain'
import type { Mount } from '../src/world/Mount'
import type { NPC } from '../src/world/NPC'

const kinds = ['bandit', 'patrol', 'town-defense', 'cavalry-sweep', 'enemy-town-assault', 'duel'] as const
type MissionKind = typeof kinds[number]
const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  writable = true
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    if (!this.writable) throw new Error('storage full')
    this.values.set(key, value)
  }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

function createMission(profile: CareerProfile, kind: MissionKind): ActiveCareerMission {
  if (kind === 'town-defense') return createTownDefenseMission(['captain'], ['civilian-0'], 'settlement')
  if (kind === 'cavalry-sweep') return createCavalrySweepMission('settlement', ['captain', 'infantry'])
  if (kind === 'enemy-town-assault') return createEnemyTownAssaultMission('settlement')
  if (kind === 'duel') return createCareerDuelMission(profile, 'roman_archer', 1, 'infantry', 'captain', 'settlement')!
  return createActiveCareerMission(kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01', 2, 3, 0, 'settlement', kind)
}

function fixture(kind: MissionKind, options: { savedResult?: boolean; survived?: boolean; phase?: ActiveCareerMission['phase']; fullTown?: boolean } = {}) {
  const events: string[] = []
  let profile = createCareerProfile('roman')
  profile.ownedMounts = ['horse', 'corgi']
  profile.ownedHorseTiers = [1, 2]
  profile.townEvent = { id: 'unrelated-town-event', state: 'hostile' }
  profile.activeMission = createMission(profile, kind)
  const playerStats = { ...stats, survived: options.survived ?? false }
  profile.activeMission.playerDead = !playerStats.survived
  if (options.savedResult) {
    profile = claimCareerMission(profile, 'settlement', 'victory', playerStats).profile
    if (kind === 'town-defense') profile.activeMission!.result!.defense = { civilianSurvived: 19, civilianDeaths: 1 }
  }
  if (options.phase) profile.activeMission!.phase = options.phase
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)

  const restoreResident = (spec: Pick<TownActorSpec, 'role' | 'x' | 'z' | 'yaw'>) => {
    const npc = {
      group: new THREE.Group(), dead: true,
      dismountFromMount: vi.fn(() => events.push('dismount')),
      restoreForTown: vi.fn(() => { events.push('resident'); npc.dead = false }),
      mountVehicle: vi.fn(() => events.push('remount')), dispose: vi.fn(),
    }
    const mount = spec.role === 'captain' || spec.role.includes('cavalry') ? {
      restoreForTown: vi.fn(() => events.push('home-mount')), dispose: vi.fn(),
    } : undefined
    return { spec, npc: npc as unknown as NPC, homeMount: mount as unknown as Mount | undefined, cycle: 5, walkTime: 4 }
  }
  const residents = options.fullTown ? townRoster().filter(spec => spec.role !== 'cat').map(restoreResident) : [
    restoreResident({ role: 'captain', x: 25, z: 11, yaw: -.5 }),
    restoreResident({ role: 'melee_infantry', x: 12, z: 7 }),
    restoreResident({ role: 'merchant', x: 0, z: 0 }),
  ]
  const fieldActors = residents.slice(0, 2).map(resident => resident.npc)
  const duelActors = [...fieldActors]
  const field = {
    friendlies: fieldActors, snapshot: vi.fn(() => ({ player: playerStats, squads: [] })),
    cleanupMission: vi.fn(() => { events.push('field-cleanup'); fieldActors.length = 0 }),
  }
  const duel = {
    actors: duelActors, snapshot: vi.fn(() => ({ player: playerStats, squads: [] })),
    cleanupMission: vi.fn(() => { events.push('duel-cleanup'); duelActors.length = 0 }),
  }
  const defense = {
    get active() { return profile.activeMission?.kind === 'town-defense' || profile.activeMission?.kind === 'enemy-town-assault' ? profile.activeMission : undefined },
    civilianSurvived: 19, civilianDeaths: 1,
    snapshot: vi.fn(() => ({ player: playerStats, squads: [] })), cleanupMission: vi.fn(() => events.push('defense-cleanup')),
  }
  const cat = {
    restoreForTown: vi.fn(() => events.push('cat')),
    catVisual: { setEquipmentVisible: vi.fn() } as unknown as Mount['catVisual'],
  }
  const threats = new Set(residents.map(resident => resident.npc))
  const town = {
    residents, cat,
    releaseExternalThreat: vi.fn((npc: NPC) => { threats.delete(npc) }),
    world: { obstacles: [], restoreTownDamage: vi.fn(() => events.push('town-repair')) },
    navigation: { sync: vi.fn(() => events.push('navigation')) },
    inventory: { sheathAll: vi.fn(() => events.push('sheath')) },
    player: { group: new THREE.Group() },
    clearCombatShots: vi.fn(() => events.push('shots')),
    restPlayer: vi.fn(() => events.push('player-rest')),
    restart: vi.fn(() => events.push('restart')),
  }
  town.player.group.position.set(9, 1, -4)
  const commit = vi.fn((next: CareerProfile) => {
    events.push('save')
    if (!store.save(next)) return false
    profile = store.loadChecked().profile!
    return true
  })
  const settlement = new TownMissionSettlement({ read: () => profile, commit }, { field, duel, defense }, town)
  return { settlement, field, duel, defense, town, threats, events, commit, storage, store, playerStats,
    profile: () => profile, reload: () => { profile = store.loadChecked().profile! } }
}

afterEach(() => vi.restoreAllMocks())

function expectSceneUntouched(f: ReturnType<typeof fixture>) {
  expect(f.field.cleanupMission).not.toHaveBeenCalled()
  expect(f.duel.cleanupMission).not.toHaveBeenCalled()
  expect(f.defense.cleanupMission).not.toHaveBeenCalled()
  expect(f.town.residents.every(resident => vi.mocked(resident.npc.restoreForTown).mock.calls.length === 0)).toBe(true)
  expect(f.town.releaseExternalThreat).not.toHaveBeenCalled()
  expect(f.town.cat.restoreForTown).not.toHaveBeenCalled()
  expect(f.town.world.restoreTownDamage).not.toHaveBeenCalled()
  expect(f.town.navigation.sync).not.toHaveBeenCalled()
  expect(f.town.inventory.sheathAll).not.toHaveBeenCalled()
  expect(f.town.clearCombatShots).not.toHaveBeenCalled()
  expect(f.town.restPlayer).not.toHaveBeenCalled()
  expect(f.town.restart).not.toHaveBeenCalled()
  expect(f.town.player.group.position).toEqual(new THREE.Vector3(9, 1, -4))
}

describe('Town mission result saving through the settlement interface', () => {
  const results = kinds.flatMap(kind => ([false, true] as const).flatMap(survived => (['victory', 'failure'] as const).map(outcome => [kind, survived, outcome] as const)))
  it.each(results)('saves %s survived=%s outcome=%s once, including after reload', (kind, survived, outcome) => {
    const f = fixture(kind, { survived })
    const expected = claimCareerMission(f.profile(), 'settlement', outcome, f.playerStats)
    const finished = f.settlement.finish(outcome)
    expect(finished).toEqual({ status: 'saved', result: f.profile().activeMission!.result })
    expect(f.profile().activeMission!.result).toMatchObject({ outcome, stats: f.playerStats, merit: expected.profile.activeMission!.result!.merit })
    expect(f.profile().lifetimeStats).toMatchObject({ battles: 1, victories: outcome === 'victory' ? 1 : 0, deaths: survived ? 0 : 1 })
    expect(f.profile().careerMissionCompletions ?? 0).toBe(outcome === 'victory' && kind !== 'duel' ? 1 : 0)
    expect(f.profile().rank).toBe('recruit')
    const source = kind === 'duel' ? f.duel : kind === 'town-defense' || kind === 'enemy-town-assault' ? f.defense : f.field
    expect(source.snapshot).toHaveBeenCalledOnce()
    for (const other of [f.field, f.duel, f.defense].filter(controller => controller !== source)) expect(other.snapshot).not.toHaveBeenCalled()
    if (kind === 'town-defense') expect(f.profile().activeMission!.result!.defense).toEqual({ civilianSurvived: 19, civilianDeaths: 1 })
    else expect(f.profile().activeMission!.result!.defense).toBeUndefined()
    if (outcome === 'victory' && !survived) {
      expect(f.profile().activeMission!.result!.merit).toEqual(kind === 'cavalry-sweep' || kind === 'enemy-town-assault'
        ? { damage: 10, kills: 16, contribution: 80, total: 106 } : { damage: 10, kills: 12, contribution: 12, total: 34 })
    }
    expectSceneUntouched(f)
    expect(f.settlement.finish(outcome)).toEqual({ status: 'ignored' })
    f.reload()
    expect(f.settlement.finish(outcome)).toEqual({ status: 'ignored' })
    expect(f.commit).toHaveBeenCalledOnce()
    expect(claimCareerMission(f.profile(), 'settlement', outcome, f.playerStats).meritAwarded).toBe(0)
  })

  it.each(kinds)('retries %s after storage rejects a dead-player result without granting merit twice', kind => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fixture(kind)
    const before = f.profile(), saved = f.storage.getItem(CAREER_STORAGE_KEY)
    const outcome: CareerMissionOutcome = kind === 'duel' ? 'failure' : 'victory'
    f.storage.writable = false
    expect(f.settlement.finish(outcome)).toEqual({ status: 'save-failed' })
    expect(f.profile()).toBe(before)
    expect(f.profile().totalMerit).toBe(0)
    expect(f.profile().activeMission!.result).toBeUndefined()
    expect(f.storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
    expectSceneUntouched(f)
    f.storage.writable = true
    expect(f.settlement.finish(outcome).status).toBe('saved')
    const total = f.profile().totalMerit
    expect(total).toBe(claimCareerMission(before, 'settlement', outcome, f.playerStats).meritAwarded)
    expect(f.profile().activeMission!.result!.stats.survived).toBe(false)
    f.reload()
    expect(f.settlement.finish(outcome)).toEqual({ status: 'ignored' })
    expect(f.commit).toHaveBeenCalledTimes(2)
    expect(f.profile().totalMerit).toBe(total)
  })

  it('ignores an absent mission without reading combat statistics or saving', () => {
    const f = fixture('bandit')
    delete f.profile().activeMission
    expect(f.settlement.finish('victory')).toEqual({ status: 'ignored' })
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.field.snapshot).not.toHaveBeenCalled()
    expectSceneUntouched(f)
  })
})

describe('Town mission return saving and recovery through the settlement interface', () => {
  const returns = [
    ...kinds.map(kind => [kind, 'direct'] as const),
    ...(['bandit', 'patrol', 'cavalry-sweep', 'duel'] as const).map(kind => [kind, 'arrived'] as const),
  ]
  it.each(returns)('retries %s %s return before cleanup, preserves the claim and performs the return once', (kind, intent) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fixture(kind, { savedResult: true, phase: intent === 'arrived' ? 'RETURNING' : 'RESULT' })
    const before = f.profile(), saved = f.storage.getItem(CAREER_STORAGE_KEY)
    f.storage.writable = false
    const inPlace = kind === 'town-defense' || kind === 'cavalry-sweep' || intent === 'arrived'
    expect(f.settlement.returnToTown(intent)).toEqual({ status: 'save-failed', destination: kind === 'town-defense' ? 'defense' : inPlace ? 'party' : 'restart' })
    expect(f.profile()).toBe(before)
    expect(f.storage.getItem(CAREER_STORAGE_KEY)).toBe(saved)
    expectSceneUntouched(f)
    expect(f.events).toEqual(['save'])

    f.storage.writable = true
    f.reload()
    expect(f.settlement.returnToTown(intent)).toEqual(inPlace
      ? { status: 'returned', kind: kind === 'town-defense' ? 'defense' : kind === 'cavalry-sweep' ? 'sweep' : 'party' }
      : { status: 'restarted' })
    expect(f.profile().activeMission).toBeUndefined()
    expect(f.store.loadChecked().profile!.activeMission).toBeUndefined()
    expect(f.profile()).toMatchObject({ totalMerit: before.totalMerit, availableMerit: before.availableMerit, lifetimeStats: before.lifetimeStats,
      claimedBattleIds: ['settlement'], townEvent: before.townEvent, ownedMounts: before.ownedMounts, ownedHorseTiers: before.ownedHorseTiers, rank: before.rank })
    const source = kind === 'town-defense' || kind === 'enemy-town-assault' ? f.defense : kind === 'duel' ? f.duel : f.field
    expect(source.cleanupMission).toHaveBeenCalledOnce()
    expect(f.events[1]).toBe('save')
    expect(f.events[2]).toBe(kind === 'town-defense' || kind === 'enemy-town-assault' ? 'defense-cleanup' : kind === 'duel' ? 'duel-cleanup' : 'field-cleanup')
    if (kind === 'bandit' || kind === 'patrol') expect(f.field.cleanupMission).toHaveBeenCalledExactlyOnceWith(2)
    if (kind === 'cavalry-sweep') expect(f.field.cleanupMission).toHaveBeenCalledExactlyOnceWith(before.activeMission!.targetCampId, true)
    expect(f.town.clearCombatShots).toHaveBeenCalledTimes(inPlace ? 1 : 0)
    expect(f.town.restPlayer).toHaveBeenCalledTimes(inPlace ? 1 : 0)
    expect(f.town.restart).toHaveBeenCalledTimes(inPlace ? 0 : 1)
    if (!inPlace) {
      expect(f.town.inventory.sheathAll).toHaveBeenCalledOnce()
      expect(f.town.restart).toHaveBeenCalledExactlyOnceWith(f.commit.mock.calls[1][0])
      expect(f.events.slice(2)).toEqual([f.events[2], 'sheath', 'restart'])
    }
    expect(f.settlement.returnToTown(intent)).toEqual({ status: 'ignored' })
    expect(f.commit).toHaveBeenCalledTimes(2)
    expect(source.cleanupMission).toHaveBeenCalledOnce()
  })

  it.each([['bandit', 'arrived'], ['patrol', 'arrived'], ['cavalry-sweep', 'direct'], ['cavalry-sweep', 'arrived'], ['duel', 'arrived']] as const)('returns %s %s borrowed residents and their home mounts without resetting a bystander', (kind, intent) => {
    const f = fixture(kind, { savedResult: true, phase: intent === 'arrived' ? 'RETURNING' : 'RESULT' })
    const [captain, infantry, bystander] = f.town.residents
    // This bystander was not a casualty; dead nonborrowed residents now recover on return.
    Object.assign(bystander.npc, { dead: false })
    const position = f.town.player.group.position.clone()
    expect(f.settlement.returnToTown(intent).status).toBe('returned')
    for (const resident of [captain, infantry]) {
      expect(resident.npc.restoreForTown).toHaveBeenCalledOnce()
      expect(resident.npc.dead).toBe(false)
      expect(resident.npc.group.rotation.y).toBe(resident.spec.yaw ?? Math.PI)
      expect(resident.cycle).toBe(-1); expect(resident.walkTime).toBe(0)
      expect(f.threats.has(resident.npc)).toBe(false)
      expect(f.town.releaseExternalThreat).toHaveBeenCalledWith(resident.npc)
    }
    expect(captain.homeMount!.restoreForTown).toHaveBeenCalledExactlyOnceWith(25, 11, -.5)
    expect(captain.npc.mountVehicle).toHaveBeenCalledExactlyOnceWith(captain.homeMount)
    expect(bystander.npc.restoreForTown).not.toHaveBeenCalled()
    expect(bystander.cycle).toBe(5); expect(bystander.walkTime).toBe(4)
    expect(f.threats.has(bystander.npc)).toBe(true)
    expect(f.town.releaseExternalThreat).not.toHaveBeenCalledWith(bystander.npc)
    expect(f.town.residents.every(resident => vi.mocked(resident.npc.dispose).mock.calls.length === 0)).toBe(true)
    expect(captain.homeMount!.dispose).not.toHaveBeenCalled()
    expect(f.events.indexOf('shots')).toBeLessThan(f.events.indexOf('resident'))
    expect(f.events.indexOf('resident')).toBeLessThan(f.events.indexOf('player-rest'))
    expect(f.town.restart).not.toHaveBeenCalled()
    expect(f.town.world.restoreTownDamage).not.toHaveBeenCalled()
    if (kind === 'duel') {
      const catSpot = townSitePoint('stable', -3, 8)
      expect(f.town.cat.restoreForTown).toHaveBeenCalledExactlyOnceWith(catSpot.x, catSpot.z, catSpot.yaw)
      expect(f.town.cat.catVisual!.setEquipmentVisible).toHaveBeenCalledExactlyOnceWith(false)
    } else expect(f.town.cat.restoreForTown).not.toHaveBeenCalled()
    if (kind === 'cavalry-sweep' && intent === 'direct') expect(f.town.player.group.position).toEqual(new THREE.Vector3(0, getTerrainHeight(0, 9) + .9, 9))
    else expect(f.town.player.group.position).toEqual(position)
  })

  it('restores all Town casualties after defense, including guards outside the defense roster', () => {
    const f = fixture('town-defense', { savedResult: true, fullTown: true })
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'returned', kind: 'defense' })
    expect(f.town.residents).toHaveLength(224)
    for (const resident of f.town.residents) {
      expect(resident.npc.restoreForTown).toHaveBeenCalledOnce()
      expect(resident.npc.dead).toBe(false)
      expect(f.threats.has(resident.npc)).toBe(false)
      expect(resident.npc.dispose).not.toHaveBeenCalled()
    }
    const catSpot = townSitePoint('stable', -3, 8)
    expect(f.town.cat.restoreForTown).toHaveBeenCalledExactlyOnceWith(catSpot.x, catSpot.z, catSpot.yaw)
    expect(f.town.cat.catVisual!.setEquipmentVisible).toHaveBeenCalledExactlyOnceWith(false)
    expect(f.town.world.restoreTownDamage).toHaveBeenCalledOnce()
    expect(f.town.navigation.sync).toHaveBeenCalledExactlyOnceWith(f.town.world.obstacles)
    expect(f.events.indexOf('town-repair')).toBeLessThan(f.events.indexOf('navigation'))
    expect(f.events.indexOf('navigation')).toBeLessThan(f.events.indexOf('player-rest'))
    expect(f.town.player.group.position).toEqual(new THREE.Vector3(9, 1, -4))
    expect(f.town.restart).not.toHaveBeenCalled()
  })

  it.each(['cavalry-sweep', 'town-defense'] as const)('recovers all 40 gate guards after a failed %s without resetting living reserve cavalry', kind => {
    const f = fixture(kind, { savedResult: true, fullTown: true })
    f.profile().activeMission!.result!.outcome = 'failure'
    for (const resident of f.town.residents) Object.assign(resident.npc, { dead: resident.spec.duty === 'gate_guard' })
    const guards = f.town.residents.filter(resident => resident.spec.duty === 'gate_guard')
    const originals = guards.map(resident => ({ npc: resident.npc, id: resident.spec.id }))
    const livingReserve = f.town.residents.filter(resident => resident.spec.mounted && resident.spec.duty === 'training')
    expect(guards).toHaveLength(40)

    expect(f.settlement.returnToTown('direct').status).toBe('returned')

    for (const [i, resident] of guards.entries()) {
      expect(resident.npc).toBe(originals[i].npc)
      expect(resident.spec.id).toBe(originals[i].id)
      expect(resident.npc.dead).toBe(false)
      expect(resident.npc.restoreForTown).toHaveBeenCalledOnce()
      expect(f.threats.has(resident.npc)).toBe(false)
    }
    for (const resident of livingReserve) expect(resident.npc.restoreForTown).toHaveBeenCalledTimes(kind === 'town-defense' ? 1 : 0)
    expect(f.profile().activeMission).toBeUndefined()
  })

  it('keeps dead gate guards untouched when saving the defense return fails', () => {
    const f = fixture('town-defense', { savedResult: true, fullTown: true })
    f.storage.writable = false
    expect(f.settlement.returnToTown('direct').status).toBe('save-failed')
    expect(f.town.residents.filter(resident => resident.spec.duty === 'gate_guard').every(resident => resident.npc.dead)).toBe(true)
    expectSceneUntouched(f)
  })

  it('returns dead Patrol members to their barracks lifecycle after defense', () => {
    const f = fixture('town-defense', { savedResult: true, fullTown: true })
    const patrol = f.town.residents.filter(resident => resident.spec.duty === 'patrol')
    const beginPatrolMissionReturn = vi.fn(() => expect(f.profile().activeMission).toBeUndefined())
    Object.assign(f.town, { beginPatrolMissionReturn })
    expect(f.settlement.returnToTown('direct').status).toBe('returned')
    expect(beginPatrolMissionReturn).toHaveBeenCalledTimes(40)
    for (const resident of patrol) {
      expect(beginPatrolMissionReturn).toHaveBeenCalledWith(resident.spec.id)
      expect(resident.npc.restoreForTown).not.toHaveBeenCalled()
      expect(resident.homeMount!.restoreForTown).not.toHaveBeenCalled()
    }
  })

  it.each(kinds)('keeps %s active when physical return is requested before RETURNING', kind => {
    const f = fixture(kind)
    expect(f.settlement.returnToTown('arrived')).toEqual({ status: 'ignored' })
    expect(f.commit).not.toHaveBeenCalled()
    expectSceneUntouched(f)
  })

  it.each(['town-defense', 'cavalry-sweep'] as const)('does not clear an unfinished %s on direct return', kind => {
    const f = fixture(kind)
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'ignored' })
    expect(f.commit).not.toHaveBeenCalled()
    expectSceneUntouched(f)
  })

  it.each(['bandit', 'patrol', 'enemy-town-assault', 'duel'] as const)('preserves the existing direct %s return without a saved result', kind => {
    const f = fixture(kind)
    expect(f.settlement.returnToTown('direct')).toEqual({ status: 'restarted' })
    expect(f.profile().activeMission).toBeUndefined()
    expect(f.profile().totalMerit).toBe(0)
    expect(f.town.restart).toHaveBeenCalledOnce()
  })

  it('keeps a saved defense result active when an arrived-party return is requested', () => {
    const f = fixture('town-defense', { savedResult: true, phase: 'RETURNING' })
    expect(f.settlement.returnToTown('arrived')).toEqual({ status: 'ignored' })
    expect(f.commit).not.toHaveBeenCalled()
    expectSceneUntouched(f)
  })
})
