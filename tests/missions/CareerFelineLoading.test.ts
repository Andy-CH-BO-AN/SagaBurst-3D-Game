import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { BlackCatVisual, type FelineMountVariant } from '../../src/world/BlackCatVisual'
import { CareerMountController } from '../../src/career/CareerMountController'
import { CareerRaceController } from '../../src/career/CareerRaceController'
import { careerFelineVariants } from '../../src/career/CareerFelinePreload'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'

// The Mount constructor needs rendered assets; this suite owns only the request lifecycle.
vi.mock('../../src/world/Mount', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/world/Mount')>()
  class StubMount {
    currentHp = 100; maxHp = 100; onDeathCallbacks: Array<() => void> = []
    group = { position: new Vector3() }; isAirborne = false; dead = false
    constructor(public scene: unknown, public type: string) {}
    dispose() {}
  }
  return { ...original, Mount: StubMount }
})

const loaded = new Set<FelineMountVariant>()
const gates = new Map<FelineMountVariant, { resolve(): void; reject(error: Error): void }>()
let preloadCalls: FelineMountVariant[] = []

beforeEach(() => {
  loaded.clear(); gates.clear(); preloadCalls = []
  vi.spyOn(BlackCatVisual, 'isPreloaded').mockImplementation((variant = 'black-cat') => loaded.has(variant))
  vi.spyOn(BlackCatVisual, 'preload').mockImplementation((variant = 'black-cat') => {
    preloadCalls.push(variant)
    return new Promise<void>((resolve, reject) => gates.set(variant, { resolve: () => { loaded.add(variant); resolve() }, reject }))
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function mountOwner() {
  let current = createCareerProfile('roman')
  for (const id of ['serval', 'orange-cat', 'white-cat'] as const) addCareerItem(current, id, 1)
  const player = { isFalling: false, currentMount: null, mountVehicle: vi.fn(), dismountFromMount: vi.fn(), isMounted: false,
    combatPosition: new Vector3(), facingYaw: 0 }
  const owner = Object.create(CareerMountController.prototype) as CareerMountController
  Object.assign(owner as unknown as object, {
    scene: {}, player: () => player, readProfile: () => current, commit: (next: CareerProfile) => { current = next; return true },
    obstacles: () => [], occupied: () => [], sceneKey: () => 'town-home', options: {},
    hp: new Map(), unavailable: new Set(), active: null, requestSeq: 0, pending: null, statusText: '',
  })
  return { owner, player, profile: () => current }
}

describe('feline mount activation under asynchronous asset loading', () => {
  it('reports loading as not-yet-activated, coalesces repeated clicks and ignores a superseded load', async () => {
    const { owner, profile } = mountOwner()
    expect(owner.activate('serval')).toBe(false)
    expect(owner.activate('serval')).toBe(false)
    expect(preloadCalls).toEqual(['serval'])
    // A newer choice supersedes the in-flight Serval request.
    expect(owner.activate('orange-cat')).toBe(false)
    gates.get('serval')!.resolve(); await flush()
    expect(owner.activeMountId).toBeNull()
    expect(profile().selectedMountId).toBeUndefined()
    gates.get('orange-cat')!.resolve(); await flush()
    expect(owner.activeMountId).toBe('orange-cat')
    expect(profile().selectedMountId).toBe('orange-cat')
  })

  it.each(['dismiss', 'release', 'dispose', 'restInTown', 'syncOwnership'] as const)('%s invalidates a pending load', async action => {
    const { owner } = mountOwner()
    expect(owner.activate('serval')).toBe(false)
    owner[action]('serval' as never)
    gates.get('serval')!.resolve(); await flush()
    expect(owner.activeMountId).toBeNull()
  })

  it('leaves no stale request after a failed load and allows an explicit retry', async () => {
    const { owner } = mountOwner()
    expect(owner.activate('white-cat')).toBe(false)
    gates.get('white-cat')!.reject(new Error('network')); await flush()
    expect(owner.activeMountId).toBeNull(); expect(owner.statusText).toContain('失敗')
    expect(owner.activate('white-cat')).toBe(false)
    expect(preloadCalls).toEqual(['white-cat', 'white-cat'])
    gates.get('white-cat')!.resolve(); await flush()
    expect(owner.activeMountId).toBe('white-cat')
  })
})

describe('Town startup feline preload set', () => {
  it('does not request merely owned felines for a profile riding a horse', () => {
    const profile = createCareerProfile('roman')
    for (const id of ['horse', 'white-cat', 'orange-cat', 'serval', 'caracal'] as const) addCareerItem(profile, id, 1)
    profile.ownedMounts = ['white-cat', 'orange-cat', 'serval', 'caracal']
    profile.selectedMountId = 'horse'
    expect([...careerFelineVariants(profile)]).toEqual(['black-cat'])
  })

  it('includes the selected mount, saved race opponent and mounts assigned to squad members', () => {
    const profile = createCareerProfile('roman')
    profile.selectedMountId = 'serval'
    profile.activeRace = { player: { mountId: 'serval' }, opponent: { mountId: 'caracal' } } as CareerProfile['activeRace']
    profile.personalSquad = { members: [{ id: 'm', type: 'commander', equipment: { mount: 'white-cat' } }] } as CareerProfile['personalSquad']
    expect([...careerFelineVariants(profile)].sort()).toEqual(['black-cat', 'caracal', 'serval', 'white-cat'])
  })
})

describe('Race opponent feline load failure recovery', () => {
  interface RaceInternals { session?: unknown; deploy(initial: boolean, restoring: boolean): void }
  function raceOwner() {
    const session = { id: 'race-session', opponent: { mountId: 'caracal', actorId: 'commander' } }
    const enqueueDeployment = vi.fn()
    const owner = Object.create(CareerRaceController.prototype) as CareerRaceController
    const internals = owner as unknown as RaceInternals
    Object.assign(internals, { session, enqueueDeployment, preloadInFlight: false, error: '' })
    return { owner, internals, session, enqueueDeployment }
  }

  it('keeps the persisted session and opponent, retries after the delay and deploys exactly once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0)
    const { owner, internals, session, enqueueDeployment } = raceOwner()
    internals.deploy(false, true)
    gates.get('caracal')!.reject(new Error('transient')); await flush()
    expect(owner.deploymentRetryPending).toBe(true)
    expect(owner.error).toContain('重試')
    expect(session.opponent.mountId).toBe('caracal')
    expect(enqueueDeployment).not.toHaveBeenCalled()

    owner.prepare(); expect(preloadCalls).toEqual(['caracal'])      // not yet due
    vi.setSystemTime(3001); owner.prepare()
    expect(preloadCalls).toEqual(['caracal', 'caracal'])
    gates.get('caracal')!.resolve(); await flush()
    expect(enqueueDeployment).toHaveBeenCalledExactlyOnceWith(session, false, true)
    expect(owner.deploymentRetryPending).toBe(false)
    owner.prepare(); expect(preloadCalls).toHaveLength(2)
  })

  it('drops the retry when the session is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0)
    const { owner, internals, enqueueDeployment } = raceOwner()
    internals.deploy(true, false)
    gates.get('caracal')!.reject(new Error('transient')); await flush()
    internals.session = undefined
    vi.setSystemTime(5000); owner.prepare()
    expect(owner.deploymentRetryPending).toBe(false)
    expect(enqueueDeployment).not.toHaveBeenCalled()
  })
})
