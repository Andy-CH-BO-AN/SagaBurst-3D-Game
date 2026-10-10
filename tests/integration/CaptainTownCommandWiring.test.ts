import * as THREE from 'three'
import { TownCommandSquadController } from '../../src/town/TownCommandSquadController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { CAPTAIN_GATE_DEFENSE_ID } from '../../src/career/CaptainMissionCatalog'
import { describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { TownEvent } from '../../src/town/TownRules'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { TownCommandSquadState } from '../../src/career/CareerCommandAuthority'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Real TownScene transaction caller + real serialized Store. 0 actors, world, renderer or assets. */
function fixture() {
  const profile = createCareerProfile('roman'); profile.rank = 'captain'
  const command: TownCommandSquadState = { type: 'town-command', squadId: 1, townFaction: 'roman', actorIds: ['loyal'],
    contribution: emptyPersonalContribution(), members: { loyal: { status: 'deployed', hp: 73, position: { x: 140, z: 150, yaw: 1 },
      mount: { hp: 61, mounted: true, position: { x: 140, z: 150, yaw: 1 } } } }, state: 'FOLLOWING', authorized: true, sceneKey: 'town-home' }
  profile.townCommandSquad = command
  const store = new CareerProfileStore(new MemoryStorage()); store.save(profile)
  const changes: string[] = []
  const stageMissionHandoff = vi.fn((next: typeof profile) => {
    const staged = cloneCareerProfile(next); staged.townCommandSquad = { ...command, authorized: false, state: 'RETURNING' }
    changes.push('stage'); return staged
  })
  const state = { profile, store, commandActors: [], skills: { skillState: profile.skills },
    careerSkillSaveTimer: null, careerSaveFailures: 0, careerSkillsDirty: false, garrisonRestored: false,
    residents: [], world: { faction: 'roman' },
    townCommand: { stageMissionHandoff, checkpoint: () => command, applySavedState: vi.fn(() => changes.push('live')),
      grant: vi.fn(() => true) },
  }
  const town = Object.assign(Object.create(TownScene.prototype) as object, state) as typeof state & {
    commit(next: CareerProfile): boolean; prepareDamage(): boolean; activateHostility(shout?: boolean): void
  }
  const save = vi.spyOn(store, 'save').mockImplementation(next => { changes.push('save'); return CareerProfileStore.prototype.save.call(store, next) })
  return { town, command, save, changes }
}

describe('Captain TownScene saved command handover', () => {
  it('persists returning authority and original injured mount before applying the formal handover', () => {
    const h = fixture(), next = cloneCareerProfile(h.town.profile)
    next.activeMission = createCaptainPatrolCommandMission(next, Array.from({ length: 20 }, (_, i) => `town-patrol:a:${i ? i - 1 : 'captain'}`), 'accepted')
    expect(h.town.commit(next)).toBe(true)
    expect(h.changes).toEqual(['stage', 'save', 'live'])
    const saved = h.town.store.load()!
    expect(saved.activeMission?.id).toBe('accepted')
    expect(saved.townCommandSquad).toMatchObject({ authorized: false, state: 'RETURNING', actorIds: ['loyal'], members: { loyal: { hp: 73, mount: { hp: 61 } } } })
  })
  it('a failed formal save keeps the current mission and live ownership unchanged', () => {
    const h = fixture(), next = cloneCareerProfile(h.town.profile)
    next.activeMission = createCaptainPatrolCommandMission(next, Array.from({ length: 20 }, (_, i) => `town-patrol:a:${i ? i - 1 : 'captain'}`), 'failed')
    h.save.mockReturnValueOnce(false)
    expect(h.town.commit(next)).toBe(false)
    expect(h.town.profile.activeMission).toBeUndefined()
    expect(h.town.profile.townCommandSquad?.authorized).toBe(true)
    expect(h.town.townCommand.applySavedState).not.toHaveBeenCalled()
    expect(h.town.store.load()!.activeMission).toBeUndefined()
  })
  it('a saved hostility snapshot keeps its loyal IDs outside conquest objectives after reload', () => {
    const h = fixture(), event = new TownEvent([{ id: 'loyal' }, { id: 'guard' }])
    event.register('loyal', { dead: false }); event.register('guard', { dead: true }); event.complete()
    const loyal = { setTownPeaceful: vi.fn(), setCommandAllegiance: vi.fn(), beginTownHostility: vi.fn(), dead: false }
    const guard = { beginTownHostility: vi.fn(), dead: true }
    Object.assign(h.town, { event, player: { dead: false }, panel: null, equipment: { visible: false },
      patrol: { stopForHostility: vi.fn() }, townCommand: { ...h.town.townCommand, beginHostility: vi.fn() },
      residents: [{ spec: { id: 'loyal', role: 'melee_infantry' }, npc: loyal }, { spec: { id: 'guard', role: 'melee_infantry' }, npc: guard }] })
    expect(h.town.prepareDamage()).toBe(true)
    expect(h.town.store.load()!.townEvent?.authorizedTownCommandActorIds).toEqual(['loyal'])
    h.town.profile = h.town.store.load()!
    h.town.activateHostility(false)
    expect(loyal.beginTownHostility).not.toHaveBeenCalled(); expect(guard.beginTownHostility).toHaveBeenCalledOnce()
    expect(event.evaluate(false)).toBe('town_defeated')
  })

  it('hides stale command controls on Player death and restores live updates on re-entry', () => {
    const setEnabled = vi.fn(), close = vi.fn(), update = vi.fn(() => false)
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile: createCareerProfile('roman'), player: { dead: true }, spectator: null,
      commandActors: [], residents: [], world: { faction: 'roman' },
      townCommand: { commandsEnabled: true },
      personalCommands: { isSubmenuOpen: true, isFormationPlacementMode: false, close, update },
      personalCommandUI: { setEnabled, setOfficialSquadLabel: vi.fn() },
    }) as { updatePlayerCommands(): void; player: { dead: boolean } }
    town.updatePlayerCommands()
    expect(close).toHaveBeenCalledOnce()
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(update).not.toHaveBeenCalled()

    town.player.dead = false
    town.updatePlayerCommands()
    expect(update).toHaveBeenCalledOnce()
  })
})

/** One recording guard, zero real actors/world. Real acceptance, transaction, refit policy and serialized storage. */
function defenseAcceptanceFixture() {
  const profile = createCareerProfile('roman'); profile.rank = 'captain'; profile.totalMerit = 20000
  profile.careerMissionCompletionsByTier = { 3: 5 }
  const spec = townRoster().find(spec => spec.id === 'gate:north:0')!, group = new THREE.Group()
  group.position.set(150, 0, 150)
  const guard = { group, combatPosition: group.position, combatantId: spec.id, dead: true, hp: 0, maxHp: 100,
    combatAmmo: 0, combatAmmoCapacity: 30, shield: { shieldImpactRemaining: 0, shieldImpactMax: 8, reset: vi.fn() },
    tacticalOrder: 'follow' as NPC['tacticalOrder'], mount: null, isFalling: false,
    setTownPeaceful: vi.fn(), setCommandAllegiance: vi.fn(), setCommandSquad: vi.fn(),
    restoreCombatHealth: (hp: number) => { guard.hp = hp; guard.dead = hp === 0 }, restoreCombatAmmo: (ammo: number) => { guard.combatAmmo = ammo },
    assignFollowTarget: vi.fn(),
    setTacticalOrder: (order: NPC['tacticalOrder']) => { guard.tacticalOrder = order },
    refitCombat: () => { guard.dead = false; guard.hp = 100; guard.combatAmmo = 30; guard.shield.shieldImpactRemaining = 8 },
  }
  profile.townCommandSquad = { type: 'town-command', squadId: 1, townFaction: 'roman', actorIds: [spec.id],
    contribution: emptyPersonalContribution(), members: { [spec.id]: { status: 'dead', hp: 0 } },
    state: 'FOLLOWING', authorized: true, sceneKey: 'town-home' }
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage); store.save(profile)
  const changes: string[] = []
  const state = { profile, store, player: { dead: false, group: new THREE.Group(), currentMount: null },
    residents: [{ spec, npc: guard as unknown as NPC }], event: { hostile: false }, commandActors: [] as NPC[],
    skills: { skillState: profile.skills }, careerSaveFailures: 0, garrisonRestored: false,
    world: { faction: 'roman' }, defense: { startActiveMission: vi.fn(), fieldNpcs: [] },
    dispose: vi.fn(() => changes.push('dispose')), onRestart: vi.fn(() => {
      expect(store.load()?.activeMission?.kind).toBe('town-defense'); changes.push('restart')
    }), openPanel: vi.fn(),
  }
  const town = Object.assign(Object.create(TownScene.prototype) as object, state) as typeof state & {
    townCommand: TownCommandSquadController; commit(next: CareerProfile): boolean;
    acceptMission(id: string): void; acceptCaptainMission(id: string): void; restPlayerInTown(): void;
  }
  town.townCommand = new TownCommandSquadController(town.residents, () => town.player as unknown as Player,
    () => town.profile, next => town.commit(next))
  town.townCommand.applySavedState(profile.townCommandSquad)
  const save = vi.spyOn(store, 'save').mockImplementation(next => { changes.push('save'); return CareerProfileStore.prototype.save.call(store, next) })
  return { town, storage, store, guard, spec, changes, save }
}

describe('new defense acceptance refit and reload', () => {
  it.each(['generic', 'generic-with-HR', 'captain'] as const)('%s saves the refit once before reloading and never starts defense in the old scene', kind => {
    const f = defenseAcceptanceFixture()
    if (kind === 'generic-with-HR') {
      f.town.profile.personalSquad = { members: [{ id: 'personal:dead', type: 'soldier', originalHirePrice: 50 }] }
      f.store.save(f.town.profile); f.changes.length = 0; f.save.mockClear()
    }
    const accept = () => kind === 'captain' ? f.town.acceptCaptainMission(CAPTAIN_GATE_DEFENSE_ID) : f.town.acceptMission('veteran-town-defense-01')
    const before = JSON.stringify(f.store.load())
    f.storage.failWrites = true; accept()
    expect(JSON.stringify(f.store.load())).toBe(before)
    expect(f.guard.dead).toBe(true); expect(f.guard.hp).toBe(0)
    expect(f.town.dispose).not.toHaveBeenCalled(); expect(f.town.onRestart).not.toHaveBeenCalled()
    f.storage.failWrites = false; f.changes.length = 0; f.save.mockClear(); accept()
    expect(f.changes).toEqual(['save', 'dispose', 'restart'])
    expect(f.town.defense.startActiveMission).not.toHaveBeenCalled()
    const saved = f.store.load()!
    expect(saved.townCommandSquad?.members?.[f.spec.id]).toMatchObject({ status: 'reserve', hp: 100, ammo: 30, shieldImpact: 8, order: 'attack', position: { x: f.spec.x, z: f.spec.z } })
    expect(saved.townCommandSquad).toMatchObject({ authorized: false, state: 'TRAINING' })
    expect(saved.activeMission?.friendlyActorIds).toContain(f.spec.id)
    if (kind === 'captain') expect(saved.activeMission?.officialSquad?.actorIds).toContain(f.spec.id)
    if (kind === 'generic-with-HR') expect(saved.activeMission?.personalSquad?.memberIds).toEqual(['personal:dead'])
    // Simulate the controller's first runtime checkpoint: accepted IDs cannot trigger another refit.
    f.guard.dead = false; f.guard.hp = 37
    expect(f.town.commit(cloneCareerProfile(f.town.profile))).toBe(true)
    expect(f.store.load()?.townCommandSquad?.members?.[f.spec.id].hp).toBe(37)
    expect(f.guard.hp).toBe(37)
  })
  it('refits after a saved death return completes, with no early revival or failed-save mutation', () => {
    const f = defenseAcceptanceFixture()
    f.town.acceptMission('veteran-town-defense-01')
    f.town.player.dead = true
    const next = cloneCareerProfile(f.town.profile); next.activeMission = undefined
    f.storage.failWrites = true
    expect(f.town.commit(next)).toBe(false)
    expect(f.guard.dead).toBe(true)
    f.storage.failWrites = false
    expect(f.town.commit(next)).toBe(true)
    expect(f.guard.dead).toBe(true); expect(f.town.player.dead).toBe(true)
    Object.assign(f.town, {
      temporaryMounts: { cleanup: vi.fn() }, careerMounts: { restInTown: vi.fn() }, inventory: { sheathAll: vi.fn() },
      spectator: null, hp: { setFill: vi.fn() }, stamina: { setFill: vi.fn() }, quiver: { setArrowCount: vi.fn() },
    })
    Object.assign(f.town.player, { restoreForTown: () => { expect(f.guard.dead).toBe(true); f.town.player.dead = false } })
    f.town.restPlayerInTown()
    expect(f.guard.dead).toBe(false); expect(f.guard.hp).toBe(100)
    expect(f.store.load()?.townCommandSquad?.members?.[f.spec.id]).toMatchObject({ hp: 100, ammo: 30, shieldImpact: 8 })
  })

})
