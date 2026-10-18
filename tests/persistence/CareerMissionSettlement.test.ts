import { Vector3 } from 'three'
import { describe,expect,it,vi } from 'vitest'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { createActiveCareerMission,createTownDefenseMission,type ActiveCareerMission } from '../../src/career/CareerMissionState'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import { claimCareerMission,createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TownMissionSettlement } from '../../src/town/TownMissionSettlement'
import { NPC } from '../../src/world/NPC'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { townStationSpec } from '../../src/town/TownGarrison'
import { getTerrainHeight } from '../../src/world/Terrain'
import { MemoryStorage } from '../helpers/memoryStorage'
import { townRoster } from '../../src/town/TownRules'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { resolveTownActorEquipment } from '../../src/career/CareerTownEquipmentState'
import { addCareerItem } from '../../src/career/CareerInventory'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'

/** Casualty input for settlement; no controller, combat, or result transition is simulated. */
function fourGateCasualties(mission: ActiveCareerMission, ids: readonly string[]): void {
  mission.deadTargetActorIds = [...ids]
  for (const id of ids) {
    const actor = mission.fourGateDefense!.actors[id]
    actor.status = 'dead'; actor.hp = 0
    if (actor.mount) actor.mount.mounted = false
    const ground = mission.fourGateDefense!.siege!.actors[id]
    if (ground) { ground.status = 'dead'; ground.hp = 0; if (ground.mount) ground.mount.mounted = false }
  }
}

/** Save/controller boundaries only. Position and yaw are data, never an Object3D or scene tree. */
function fixture(kind: 'bandit' | 'captain-patrol-command' | 'town-defense' | 'commander-four-gate-defense' | 'veteran-field' | 'duel' = 'bandit', completed = false) {
  const events: string[] = []
  let profile = kind === 'commander-four-gate-defense' ? createFourGateDefenseProfile('ATTACKING') : createCareerProfile('roman')
  if (kind !== 'commander-four-gate-defense') profile.activeMission = kind === 'captain-patrol-command'
    ? createCaptainPatrolCommandMission(profile, ['patrol:captain'], 'settlement')
    : kind === 'duel' ? createCareerDuelMission(profile, 'roman_archer', 1, 'resident', 'captain', 'settlement')!
    : kind === 'town-defense' ? createTownDefenseMission(['resident'], [], 'settlement')
    : { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'settlement'), kind }
  const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
  if (completed) {
    if (kind === 'commander-four-gate-defense') fourGateCasualties(profile.activeMission!, profile.activeMission!.targetActorIds)
    profile = claimCareerMission(profile, profile.activeMission!.id, 'victory', stats).profile
    profile.activeMission!.phase = 'RETURNING'
  }
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  // The large formal input is already supplied by the persistence fixture. Seed
  // bytes directly; settlement's actual save/retry and final reload own validation.
  if (kind === 'commander-four-gate-defense') storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
  else expect(store.save(profile)).toBe(true)
  const residentState = { dead: true, group: { position: new Vector3(9, 0, 9), rotation: { y: 0 } },
    dismountFromMount: vi.fn(), restoreCombatLoadout: vi.fn(),
    restoreForTown: vi.fn((_destination?: Parameters<NPC['restoreForTown']>[0]) => { residentState.dead = false; events.push('restore') }), mountVehicle: vi.fn() }
  const resident = { spec: { id: 'resident', role: 'melee_infantry', x: 2, z: 3, yaw: .5 },
    npc: residentState as unknown as NPC, cycle: 3, walkTime: 2 }
  const field = { friendlies: [resident.npc], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn(() => events.push('cleanup')) }
  const duel = { actors: kind === 'duel' ? [resident.npc] : [], snapshot: vi.fn(() => ({ player: stats, squads: [] })), cleanupMission: vi.fn() }
  const defense = { active: kind === 'town-defense' || kind === 'commander-four-gate-defense' ? profile.activeMission : undefined,
    snapshot: vi.fn(() => ({ player: stats, squads: [] })), snapshotActiveMission: vi.fn((): ActiveCareerMission | undefined => undefined),
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
    // save already validates and normalizes the profile. Publish its stored JSON;
    // explicit load/reload assertions below still exercise the real restore boundary.
    profile = JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!) as CareerProfile
    return true
  })
  // The concrete controller requires the full render-facing Player.group type; only position/yaw is consumed here.
  const settlement = new TownMissionSettlement({ read: () => profile, commit }, { field, duel, defense, patrol },
    town as unknown as ConstructorParameters<typeof TownMissionSettlement>[2])
  return { settlement, field, defense, patrol, town, player, resident, residentState, storage, store, events, commit, stats,
    read: () => profile, reload: () => { profile = store.load()! }, publish: (next: CareerProfile) => { profile = next } }
}

describe('Town mission settlement transactions', () => {
  it('restores a borrowed rampart training archer at its authored height and reactivates home duty after Duel return', () => {
    const h = fixture('duel', true)
    const spec = townStationSpec(townRoster().find(a => a.duty === 'training' && a.garrison?.kind === 'rampart')!, false, true)
    Object.assign(h.resident.spec, spec)
    h.read().activeMission!.duelOpponentActorId = spec.id
    // Plain reset ports only: execute the actual restoreForTown/respawn methods,
    // without constructing an NPC, rig, Object3D, material or scene.
    const body = Object.assign(h.residentState, {
      dead: false, isMounted: false, combatantId: spec.id, combatPosition: h.residentState.group.position,
      rangedWeaponId: undefined as string | undefined, hasActiveRangedWeapon: true,
      shield: { reset: vi.fn() }, weaponSweep: { reset: vi.fn() }, deathFade: { reset: vi.fn() },
      pendingFall: { clear: vi.fn() }, maxHp: 100, rig: {}, onRespawnCallbacks: [],
      swordPivot: { visible: false }, bowPivot: { visible: false }, alertSprite: { visible: false },
      _clearObstacleDetour: vi.fn(), _clearSiegeFallback: vi.fn(), _alignExternalVisualToMount: vi.fn(),
      _refreshActiveShield: vi.fn(), _cancelEquipmentCombatState: vi.fn(), animator: { cancel: vi.fn() },
      setTacticalOrder: vi.fn(), setTownPeaceful: vi.fn(), respawn: NPC.prototype.respawn,
      activateTownRampartGarrison: vi.fn(),
    })
    Object.assign(body.group.rotation, { set(_x: number, y: number, _z: number) { body.group.rotation.y = y } })
    body.restoreCombatLoadout.mockImplementation(() => { body.rangedWeaponId = 'wooden_shortbow' })
    body.restoreForTown.mockImplementation(destination => NPC.prototype.restoreForTown.call(h.resident.npc, destination))
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(body.combatPosition.toArray()).toEqual([spec.x, spec.y, spec.z])
    expect(body.combatPosition.y).toBeGreaterThan(getTerrainHeight(spec.x, spec.z) + 5)
    expect(body.activateTownRampartGarrison).toHaveBeenCalledOnce()
    expect(h.resident.spec).toMatchObject({ id: spec.id, duty: 'training', garrison: spec.garrison })
    expect(h.read().activeMission).toBeUndefined()
  })

  it('atomically rebuilds Commander V at home without replaying four-gate checkpoints or rewards', () => {
    const h = fixture('commander-four-gate-defense', true), profile = h.read()
    profile.rank = 'commander'; profile.totalMerit = 20000
    profile.personalSquad = { members: [{ id: 'personal:dead', type: 'soldier' }] }
    profile.activeMission!.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission!.personalSquad!.members['personal:dead'] = { status: 'dead', hp: 0 }
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
    h.town.preservesResident.mockReturnValue(true)
    h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
    const beforeReturn = h.storage.getItem(CAREER_STORAGE_KEY)
    h.storage.writable = false
    expect(h.settlement.returnToTown('direct').status).toBe('save-failed')
    expect(h.events).toEqual(['save'])
    expect(h.town.restart).not.toHaveBeenCalled()
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(beforeReturn)
    h.storage.writable = true; h.events.length = 0
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    expect(h.events).toEqual(['save', 'defense-cleanup'])
    h.reload()
    const saved = h.read()
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(saved)
    expect(saved.activeMission).toBeUndefined()
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
    expect(saved.personalSquadRuntime?.members['personal:dead']).toEqual({ status: 'deployed', order: 'defend' })
    expect(h.residentState.restoreForTown).not.toHaveBeenCalled()
    const merit = saved.totalMerit
    const savedBytes = h.storage.getItem(CAREER_STORAGE_KEY)
    expect(h.settlement.returnToTown('direct').status).toBe('ignored')
    expect(h.read().totalMerit).toBe(merit)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBytes)
    expect(h.town.beginPatrolMissionReturn).not.toHaveBeenCalled()
  })

  it('preserves merchant native equipment and its purchased horse through completed return staging', () => {
    const h = fixture('town-defense', true), profile = h.read()
    profile.rank = 'commander'; profile.totalMerit = 20000
    addCareerItem(profile, 'horse', 1)
    const refs = resolveTownActorEquipment(profile, 'roman', 'merchant').refs
    profile.townEquipment = { roman: { version: 1, residentEquipmentVersion: 1, nativeReserve: [],
      actors: { merchant: { ...refs, mount: { itemId: 'horse', source: 'inventory' } } } } }
    const equipment = structuredClone(profile.townEquipment)
    // Settlement owns preserving staged data. Inventory/parser transactions are
    // covered by CareerTownEquipment; keep only the commit boundary here.
    h.commit.mockImplementation(next => { h.publish(next); return true })
    expect(h.settlement.returnToTown('direct').status).toBe('restarted')
    expect(h.read().townEquipment).toEqual(equipment)
    expect(h.read().inventory?.quantities.horse).toBe(1)
    expect(h.town.restart).toHaveBeenCalledExactlyOnceWith(h.read())
    expect(profile.townEquipment).toEqual(equipment)
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

  it('atomically captures Commander V final casualties and grants defense merit and Tier 5 completion once after retry', () => {
    const h = fixture('commander-four-gate-defense'), before = h.read(), active = before.activeMission!
    const missionId = active.id, templateId = active.templateId, lastTargetId = active.targetActorIds[229]
    expect(active.targetActorIds).toHaveLength(230)
    // The durable frame has 229 deaths. Only the controller boundary knows the final contact.
    fourGateCasualties(active, active.targetActorIds.slice(0, 229))
    h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(before))
    const savedBefore = h.storage.getItem(CAREER_STORAGE_KEY), latest = structuredClone(active)
    fourGateCasualties(latest, latest.targetActorIds)
    latest.deadCivilianActorIds = [...latest.civilianActorIds!]
    for (const id of latest.deadCivilianActorIds) Object.assign(latest.fourGateDefense!.actors[id], { status: 'dead', hp: 0 })
    h.defense.civilianDeaths = 20; h.defense.civilianSurvived = 0
    latest.fourGateDefense!.actors[lastTargetId].mount!.hp = 22
    latest.fourGateDefense!.player!.hp = 57
    latest.playerHp = 57
    latest.fourGateDefense!.siege!.gates[0].hp = 400
    h.defense.snapshotActiveMission.mockReturnValue(latest)
    Object.assign(h.stats, { structureDamage: 900, structuresDestroyed: 1, gateBreaches: 1, survived: true })
    const beforeMerit = before.totalMerit, beforeAvailable = before.availableMerit
    const beforeTier5 = before.careerMissionCompletionsByTier?.[5] ?? 0
    // Inject the transaction-port rejection here; storage transport failure has
    // its own owner coverage. The successful retry still saves and reloads the
    // complete final checkpoint through the real store.
    h.commit.mockImplementationOnce(() => false)
    expect(h.settlement.finish('victory')).toEqual({ status: 'save-failed' })
    expect(h.read()).toBe(before)
    expect(h.read().activeMission!.result).toBeUndefined()
    expect(h.read().activeMission!.deadTargetActorIds).toHaveLength(229)
    expect(h.read().activeMission!.fourGateDefense!.phase).toBe('ATTACKING')
    expect(h.read().claimedBattleIds).not.toContain(missionId)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBefore)
    expect(latest.fourGateDefense!.phase).toBe('ATTACKING')
    expect(h.defense.cleanupMission).not.toHaveBeenCalled()
    expect(h.settlement.finish('victory').status).toBe('saved')
    h.reload()
    const saved = h.read(), result = saved.activeMission!.result!
    expect(saved.activeMission!.deadTargetActorIds).toHaveLength(230)
    expect(saved.activeMission!.deadTargetActorIds).toContain(lastTargetId)
    expect(saved.activeMission).toMatchObject({ phase: 'RESULT',
      fourGateDefense: { phase: 'RESULT', attackStarted: true, actors: { [lastTargetId]: { status: 'dead', hp: 0, mount: { hp: 22, mounted: false } } },
        player: { hp: 57 } } })
    expect(saved.activeMission!.fourGateDefense!.siege!.gates[0].hp).toBe(400)
    // Defense: 200 / 20 damage + 2 * 8 kills + 80 victory + 20 survival, no structure/breach bonus.
    expect(result).toMatchObject({ outcome: 'victory', merit: { damage: 10, kills: 16, contribution: 100, total: 126 },
      defense: { civilianSurvived: 0, civilianDeaths: 20 }, stats: { structureDamage: 900, gateBreaches: 1 } })
    expect(saved.totalMerit).toBe(beforeMerit + 126)
    expect(saved.availableMerit).toBe(beforeAvailable + 126)
    expect(saved.careerMissionCompletionsByTier?.[5]).toBe(beforeTier5 + 1)
    expect(saved.completedCareerMissionTemplateIds?.filter(id => id === templateId)).toEqual([templateId])
    expect(saved.claimedBattleIds.filter(id => id === missionId)).toEqual([missionId])
    const savedBytes = h.storage.getItem(CAREER_STORAGE_KEY)
    expect(h.settlement.finish('victory')).toEqual({ status: 'ignored' })
    expect(h.read()).toBe(saved)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBytes)
    expect(h.defense.snapshotActiveMission).toHaveBeenCalledTimes(2)
    expect(h.read().lifetimeStats).toMatchObject({ battles: 1, victories: 1, deaths: 0 })
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

  it('keeps private wounds and casualties on same-scene arrival without awarding merit again', () => {
    const h = fixture('bandit', true), profile = h.read()
    profile.personalSquad = { members: [{ id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' }] }
    profile.activeMission!.personalSquad = snapshotPersonalMission(profile)!
    profile.activeMission!.personalSquad!.state = 'ACTIVE'
    profile.activeMission!.personalSquad!.members['personal:wounded'] = { status: 'deployed', hp: 9, ammo: 0, shieldImpact: 1 }
    profile.activeMission!.personalSquad!.members['personal:dead'] = { status: 'dead', hp: 0 }
    const merit = profile.totalMerit, position = h.player.group.position.clone()
    expect(h.settlement.returnToTown('arrived')).toEqual({ status: 'returned', kind: 'party' })
    expect(h.read().activeMission).toBeUndefined()
    expect(h.read().personalSquadRuntime?.members['personal:wounded']).toMatchObject({ hp: 9, ammo: 0, shieldImpact: 1 })
    expect(h.read().personalSquadRuntime?.members['personal:dead']).toEqual({ status: 'dead', hp: 0 })
    expect(h.read().personalSquadRuntime?.returnToHR).toBeUndefined()
    expect(h.read().personalSquad?.members.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'personal:wounded', type: 'soldier' }, { id: 'personal:dead', type: 'soldier' },
    ])
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
