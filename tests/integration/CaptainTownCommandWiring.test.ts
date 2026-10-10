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
