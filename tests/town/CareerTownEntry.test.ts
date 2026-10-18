import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCaptainEagle, acceptCaptainFrontline, type CareerCombatLaunch } from '../../src/career/CaptainBattleLaunch'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptCareerOutpostRelief, CAREER_OUTPOST_SESSION_KEY } from '../../src/career/CareerOutpostMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { enterCareerTown, TOWN_ENTRY_KEY } from '../../src/town/CareerTownEntry'
import { TownScene } from '../../src/town/TownScene'
import { MemoryStorage } from '../helpers/memoryStorage'
import { claimCareerMission } from '../../src/career/CareerProfile'

vi.mock('../../src/town/TownScene', () => ({ TownScene: { create: vi.fn() } }))
vi.mock('../../src/town/TownUI', () => ({ installTownStyles: vi.fn(), starterThumbnails: vi.fn() }))

interface EntryElement {
  textContent: string; style: Record<string, string>; children: EntryElement[]
  onclick: null | (() => void); append(...children: EntryElement[]): void; remove: ReturnType<typeof vi.fn>
}
function element(): EntryElement {
  return { textContent: '', style: {}, children: [] as EntryElement[], onclick: null as null | (() => void), append(...children: EntryElement[]) { this.children.push(...children) }, remove: vi.fn() }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Town load failure recovery', () => {
  it('starts gameplay only after scene initialization and removal of the loading overlay', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = createCareerProfile('roman'); profile.starterWeaponId = 'gladius_rusty'; profile.ownedWeapons = ['gladius_rusty']
    new CareerProfileStore(local).save(profile)
    const start = vi.fn(() => expect(body.children[1].remove).toHaveBeenCalledOnce())
    vi.mocked(TownScene.create).mockImplementation(async () => {
      expect(start).not.toHaveBeenCalled()
      expect(body.children[1].remove).not.toHaveBeenCalled()
      return { start } as unknown as TownScene
    })
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
  })

  it('saves the castle refit before map launch and offers a retry if that save fails', async () => {
    // Zero scene/actor constructors: the entry callback owns durable transition ordering.
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const profile = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 20000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], completedOutpostStages: [1, 2, 3] as (1 | 2 | 3)[], ownedHorseTiers: [1] as (1 | 2 | 3)[] }
    profile.townCommandSquad = { type: 'town-command', squadId: 1, actorIds: ['guard'], townFaction: 'roman', sceneKey: 'town-home',
      state: 'FOLLOWING', authorized: true, contribution: emptyPersonalContribution(), members: { guard: { status: 'dead', hp: 0 } } }
    const store = new CareerProfileStore(local); store.save(profile)
    const start = vi.fn(), launch = vi.fn(async () => {
      expect(store.load()?.townCommandSquad?.members?.guard).toEqual({ status: 'reserve' })
    })
    vi.mocked(TownScene.create).mockResolvedValue({ start } as unknown as TownScene)
    enterCareerTown(element() as unknown as HTMLElement, launch, vi.fn())
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(store.load()?.townCommandSquad?.members?.guard.hp).toBe(0)
    local.failWrites = true
    vi.mocked(TownScene.create).mock.calls[0][2](createCareerOutpostLaunch(acceptCareerOutpostRelief(profile)!))
    expect(launch).not.toHaveBeenCalled()
    expect(store.load()?.townCommandSquad?.members?.guard.hp).toBe(0)
    local.failWrites = false
    body.children[1].children.find((child: ReturnType<typeof element>) => child.textContent === '重試轉場')!.onclick!()
    expect(launch).toHaveBeenCalledOnce()
  })
})


describe('Captain battlefield Career entry routing', () => {
  it('saves completed battlefield resident recovery before rebuilding town and retries a refused write', async () => {
    const local = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const fresh = { ...createCareerProfile('roman'), rank: 'commander' as const, totalMerit: 20000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'] }
    const accepted = acceptCaptainFrontline(fresh, 'completed-return')!
    const profile = claimCareerMission(accepted, accepted.activeMission!.id, 'victory', {
      damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true,
    }).profile
    profile.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: ['merchant'], owners: { merchant: 'player' }, members: { merchant: { status: 'dead', hp: 0 } } }
    const store = new CareerProfileStore(local); expect(store.save(profile)).toBe(true)
    const merit = profile.totalMerit
    vi.mocked(TownScene.create).mockImplementation(async (_container, restored) => {
      expect(store.load()?.activeMission).toBeUndefined()
      expect(restored.civilianCommandSquad?.actorIds).toHaveLength(21)
      expect(restored.civilianCommandSquad?.members.merchant).toMatchObject({ status: 'deployed', order: 'attack' })
      expect(restored.civilianCommandSquad?.members.merchant.hp).toBeUndefined() // New actor owns full default resources.
      return { start: vi.fn() } as unknown as TownScene
    })
    local.failWrites = true
    enterCareerTown(element() as unknown as HTMLElement, vi.fn(), vi.fn())
    await Promise.resolve()
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(store.load()?.civilianCommandSquad?.members.merchant).toMatchObject({ status: 'dead', hp: 0 })
    local.failWrites = false
    body.children[0].children.find(child => child.textContent === '重試返回小鎮')!.onclick!()
    await Promise.resolve()
    expect(TownScene.create).toHaveBeenCalledOnce()
    const returned = store.load()!
    expect(returned.totalMerit).toBe(merit)
    expect(returned.civilianCommandSquad?.owners.merchant).toBe('daily')
  })
  it.each(['frontline', 'eagle'] as const)('%s reload resumes the actual Captain battle before constructing a Town scene', async kind => {
    const local = new MemoryStorage(), session = new MemoryStorage(), body = element()
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('document', { body, createElement: () => element() })
    vi.stubGlobal('location', { search: '?nolock' }); vi.stubGlobal('window', {})
    const fresh = { ...createCareerProfile('roman'), rank: 'captain' as const, totalMerit: 5000, availableMerit: 5000,
      starterWeaponId: 'gladius_rusty', ownedWeapons: ['gladius_rusty'], ownedMounts: ['xongkoro' as const] }
    const accepted = kind === 'eagle' ? acceptCaptainEagle(fresh, 'resume-eagle')! : acceptCaptainFrontline(fresh, 'resume-frontline')!
    expect(new CareerProfileStore(local).save(accepted)).toBe(true)
    const launch = vi.fn(async (_config: CareerCombatLaunch) => {})
    enterCareerTown(element() as unknown as HTMLElement, launch, vi.fn())
    await Promise.resolve()
    expect(launch).toHaveBeenCalledOnce()
    expect(TownScene.create).not.toHaveBeenCalled()
    expect(launch.mock.calls[0][0]).toMatchObject(kind === 'eagle'
      ? { type: 'captain-eagle', careerMissionId: 'resume-eagle', battle: { careerEagleMissionId: 'resume-eagle' } }
      : { type: 'defense', careerMissionId: 'resume-frontline', careerMissionKind: 'captain-outpost-defense', stageId: 9 })
    expect(session.getItem(CAREER_OUTPOST_SESSION_KEY)).toBe(accepted.activeMission!.id)
    expect(session.getItem(TOWN_ENTRY_KEY)).toBeNull()
  })
})
