import { Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import { personalSquadFixture } from '../helpers/personalSquadFixture'
import { standbyHarness } from '../helpers/personalSquadRuntimeHarness'
import { parsePersonalMission, returnPersonalMissionToHR, type PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { EagleLandingQueue } from '../../src/world/EagleLandingQueue'
import { PersonalSquadRuntime } from '../../src/career/PersonalSquadRuntime'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'

import * as HighTierEquipment from '../../src/world/HighTierEquipment'
import { HumanoidAssetRegistry } from '../../src/world/HumanoidAssetRegistry'
import { ARMORS } from '../../src/rpg/ArmorDatabase'
import type { NPC } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import * as PaladinEquipment from '../../src/world/PaladinEquipment'

it('keeps a newly recruited hero pending until assets load and propagates asset failure without materialization', async () => {
    let rejectAsset!: (error: Error) => void
    const assetLoad = new Promise<void>((_, reject) => { rejectAsset = reject })
    const spies = [vi.spyOn(HumanoidAssetRegistry, 'preload').mockResolvedValue(),
      vi.spyOn(HumanoidAssetRegistry, 'preloadAsset').mockReturnValue(assetLoad),
      vi.spyOn(HighTierEquipment, 'preloadHighTierEquipment').mockResolvedValue(),
      vi.spyOn(PaladinEquipment, 'preloadPaladinEquipment').mockResolvedValue()]
    const profile = createCareerProfile('roman')
    profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:new-hero', type: 'commander', characterTier: 5, heroArchetype: 'commander',
      equipment: { melee: 'gladius_standard', ranged: null, shield: 'scutum_t2', mount: 'horse' } }])
    const scheduler = new NpcSpawnScheduler()
    const player = { dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }
    // The built-in factory preloads assets before scheduling; a rejected load never reaches the scene.
    const runtime = new PersonalSquadRuntime({} as never, [{ x: 0, z: 0, yaw: 0 }], () => profile, () => player as never, undefined, { scheduler })
    try {
      expect(runtime.follow()).toBe(true)
      expect(runtime.hudPendingIds).toEqual(['personal:new-hero'])
      expect(scheduler.pending).toBe(0)
      const error = new Error('Commander asset unavailable')
      rejectAsset(error)
      await Promise.allSettled([assetLoad])
      await Promise.resolve()
      await expect(runtime.waitForSpawns()).rejects.toBe(error)
      // A formal deployment failure stays a deployment error; it is not an HR standby failure.
      expect([runtime.error, runtime.standbyError]).toEqual([error, undefined])
      expect(runtime.ready).toBe(false)
      expect(runtime.actors).toHaveLength(0)
      expect(scheduler.pending).toBe(0)
    } finally {
      runtime.cancelPendingSpawns()
      for (const spy of spies) spy.mockRestore()
    }
  })

it('restores a formal HR return without actors and queues the full equipped reserve only once on Follow', () => {
    const saved = returnPersonalMissionToHR({ squadId: 'personal', sceneKey: 'battle', state: 'ACTIVE',
      memberIds: ['personal:foot', 'personal:cat', 'personal:eagle'], contribution: emptyPersonalContribution(),
      members: { 'personal:foot': { status: 'dead', hp: 0 }, 'personal:cat': { status: 'deployed', hp: 7, ammo: 0 },
        'personal:eagle': { status: 'deployed', hp: 9, eaglePadId: 'private-eagle-pad:1' } } })!
    const h = standbyHarness([{ id: 'personal:foot' }, { id: 'personal:cat', mount: 'black-cat' }, { id: 'personal:eagle', mount: 'xongkoro' }], { saved })
    const equipment = structuredClone(h.profile.personalSquad)
    try {
      h.runtime.restoreMission(saved)
      expect(h.runtime.checkpoint()).toMatchObject({ state: 'RESERVE', members: {
        'personal:foot': { status: 'reserve' }, 'personal:cat': { status: 'reserve' },
        'personal:eagle': { status: 'reserve', eaglePadId: 'private-eagle-pad:1' },
      } })
      expect(h.scheduler.pending).toBe(0)
      expect(h.runtime.actors).toHaveLength(0)
      expect(h.runtime.mounts).toHaveLength(0)
      expect(h.runtime.follow()).toBe(true)
      expect(h.runtime.follow()).toBe(true)
      expect(h.runtime.hudPendingIds).toEqual(['personal:foot', 'personal:cat', 'personal:eagle'])
      expect(h.scheduler.pending).toBe(3)
      expect(h.runtime.checkpoint()?.state).toBe('DEPLOYING')
      expect(h.profile.personalSquad).toEqual(equipment)
    } finally { h.runtime.cancelPendingSpawns() }
  })

it('restores an off-base eagle boarding target, follows the moving eagle, boards only once grounded and in live contact, then resumes the squad order', () => {
  const saved: PersonalSquadMission = {
    squadId: 'personal', sceneKey: 'town-home', layoutVersion: 3, state: 'ACTIVE',
    memberIds: ['personal:eagle'], contribution: emptyPersonalContribution(),
    members: { 'personal:eagle': { status: 'deployed', boarding: true, hp: 49,
      eaglePadId: 'private-eagle-pad:1', position: { x: -85, y: 0, z: 54, yaw: 0 },
      mount: { hp: 73, mounted: false, position: { x: 20, y: 0, z: 30, yaw: 0 },
        flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } } } } },
  }
  const h = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }], { saved })
  h.runtime.restoreMission(saved); h.flush()
  const [rider] = h.actors, [eagle] = h.mounts
  // The rider walks to where its saved eagle actually stands, not to the reserved home pad.
  expect([rider.mount, rider.formationTarget?.toArray()]).toEqual([undefined, [20, 0, 30]])
  eagle.group.position.set(24, 3, 31)
  h.runtime.updateLifecycle()
  expect([rider.mount, rider.formationTarget?.toArray()]).toEqual([undefined, [24, 3, 31]])
  // Contact with an eagle that is still airborne does not board it.
  rider.group.position.set(23, 3, 31)
  eagle.isAirborne = true; eagle.flight.phase = 'takeoff'
  h.runtime.updateLifecycle()
  expect(rider.mount).toBeUndefined()
  // The save holds no squad command; a Defend issued from the command UI while boarding keeps the rider boarding first.
  rider.setTacticalOrder('defend'); h.runtime.resumeCommand('defend')
  expect([rider.mount, rider.formationTarget?.toArray()]).toEqual([undefined, [24, 3, 31]])
  eagle.isAirborne = false; eagle.flight.phase = 'grounded'
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  // Saved wounds carry over and the boarded rider carries out the squad's Defend.
  expect([rider.hp, eagle.currentHp, rider.tacticalOrder]).toEqual([49, 73, 'defend'])
})

it('locks HR reserves and refit in the final stand without replacing casualties or advancing return cleanup', () => {
  const mission: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RETURNING',
    memberIds: ['personal:fallen'], contribution: emptyPersonalContribution(),
    members: { 'personal:fallen': { status: 'dead', hp: 0 } } }
  const h = standbyHarness([{ id: 'personal:fallen' }], { saved: mission })
  const runtime = h.runtime
  try {
    runtime.restoreMission(mission)
    expect(runtime.canRefit).toBe(true)
    const savedBefore = runtime.checkpoint()!
    h.profile.careerRetirement = { version: 1, phase: 'final-stand', acceptedAt: 1, combatElapsedSeconds: 12 }
    expect(runtime.follow()).toBe(false)
    expect(runtime.canRefit).toBe(false)
    expect(h.scheduler.pending).toBe(0)
    expect(runtime.checkpoint()?.members).toEqual(savedBefore.members)
    runtime.updateLifecycle()
    expect(runtime.checkpoint()?.members).toEqual(savedBefore.members)
    expect(runtime.checkpoint()?.state).toBe('ACTIVE')
    expect(h.profile.personalSquad!.members).toHaveLength(1)
  } finally { runtime.cancelPendingSpawns() }
})

/* ───────── HR standby: hire → standby → Follow → Dismiss → standby ───────── */

it('materializes only saved hires at distinct HR muster slots as standby, parks eagles on their pads and never duplicates', () => {
  const h = standbyHarness(Array.from({ length: 29 }, (_, i) => ({ id: `personal:m${i}`, ...(i === 3 ? { mount: 'xongkoro' as const } : {}) })))
  // A rejected save leaves the profile, so nothing materializes for that attempt.
  const before = h.profile
  expect(recruitPersonalSquadMember(before, 'soldier', () => false, () => 'personal:late')).toMatchObject({ recruited: false, reason: 'save-failed' })
  h.runtime.materializeStandby(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(29)
  // The 30th hire is saved, so the next standby pass queues exactly that member.
  const saved = recruitPersonalSquadMember(before, 'soldier', () => true, () => 'personal:late')
  expect(saved.recruited).toBe(true)
  h.profile = saved.profile
  h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(30)
  h.flush()
  h.runtime.materializeStandby(); h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(30)
  expect(new Set(h.spawned.map(s => `${s.slot.x},${s.slot.z}`)).size).toBe(30)
  expect(h.runtime.state).toBe('RESERVE')
  // Standby holds its own slot on the floor; nobody received a Follow order.
  for (const actor of h.actors) {
    expect(actor.assignFollowTarget).not.toHaveBeenCalled()
    const target = actor.formationTarget!
    expect(h.spawned.some(s => s.id === actor.combatantId && s.slot.x === target.x && s.slot.z === target.z)).toBe(true)
    expect(target.y).toBe(2.1)
  }
  // The eagle rider stands at HR; its eagle is parked on the reserved pad instead of being boarded.
  expect(h.spawned.find(s => s.id === 'personal:m3')).toMatchObject({ pad: { x: h.pad.x, z: h.pad.z } })
  expect(h.runtime.checkpoint()).toMatchObject({ state: 'RESERVE', members: { 'personal:m3': { status: 'deployed', eaglePadId: h.pad.id } } })
  expect(recruitPersonalSquadMember(h.profile, 'soldier', () => true, () => 'personal:over').reason).toBe('squad-full')
})

it('keeps the same wounded actors through Follow, Dismiss and HR arrival without reviving casualties or spawning again', () => {
  const h = standbyHarness([{ id: 'personal:a' }, { id: 'personal:b' }, { id: 'personal:c' }])
  h.runtime.materializeStandby(); h.flush()
  const [a, b, c] = h.actors
  expect(h.runtime.follow()).toBe(true)
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.state).toBe('DEPLOYING')
  expect(a.assignFollowTarget).toHaveBeenCalledOnce()
  a.hp = 40; b.dead = true; b.hp = 0
  h.runtime.updateLifecycle()
  expect(h.runtime.dismiss()).toBe(true)
  expect(h.runtime.state).toBe('RETURNING')
  // A ground member walks back to its own HR slot at the HR floor height, not the terrain below it.
  const home = h.spawned.find(spawn => spawn.id === 'personal:a')!.slot
  expect([a.tacticalOrder, a.missionMovement, a.formationTarget?.toArray()]).toEqual(['formation', true, [home.x, 2.1, home.z]])
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RETURNING')
  a.arrived = c.arrived = true
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.actors.map(actor => actor.disposed)).toEqual([false, false, false])
  expect(a.hp).toBe(40)
  // The casualty stays dead in HR until a refit; standby never respawns it.
  h.runtime.updateLifecycle(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.checkpoint()?.members).toMatchObject({ 'personal:a': { status: 'deployed', hp: 40 }, 'personal:b': { status: 'dead', hp: 0 } })
  expect(h.runtime.follow()).toBe(true)
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(3)
  expect(a.assignFollowTarget).toHaveBeenCalledTimes(2)
})

it('reloads a saved HR standby as RESERVE with its wounds and fills only the members that had no actor', () => {
  const saved: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
    memberIds: ['personal:wounded', 'personal:fresh'], contribution: emptyPersonalContribution(),
    members: { 'personal:wounded': { status: 'deployed', hp: 35, order: 'defend', position: { x: -75.5, y: 2.1, z: 20, yaw: 0 } },
      'personal:fresh': { status: 'reserve' } } }
  const h = standbyHarness([{ id: 'personal:wounded' }, { id: 'personal:fresh' }], { saved })
  h.runtime.restoreMission(saved)
  expect(h.scheduler.pending).toBe(1)
  h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(2)
  h.flush()
  h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.actors.map(actor => [actor.combatantId, actor.hp])).toEqual([['personal:wounded', 35], ['personal:fresh', 100]])
  expect(h.actors.every(actor => actor.assignFollowTarget.mock.calls.length === 0)).toBe(true)
})

it('finishes an eagle return at HR standby with the same rider and parked eagle, then boards that eagle again on Follow', () => {
  const h = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }, { id: 'personal:foot' }])
  h.runtime.materializeStandby(); h.flush()
  const [rider, foot] = h.actors, [eagle] = h.mounts
  const onPad = () => [eagle.group.position.x, eagle.group.position.z]
  expect(onPad()).toEqual([h.pad.x, h.pad.z])
  // Follow walks the rider to its parked eagle; live contact boards it.
  expect(h.runtime.follow()).toBe(true)
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  // Dismiss: the eagle lands on its own pad, the rider dismounts and walks to its HR slot.
  expect(h.runtime.dismiss()).toBe(true)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBeUndefined()
  expect(h.runtime.state).toBe('RETURNING')
  // Arrival on the same frame as the transfer pass must not issue a new walk order.
  rider.arrived = foot.arrived = true
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.scheduler.pending).toBe(0)
  expect([h.actors.length, h.mounts.length, rider.disposed]).toEqual([2, 1, false])
  expect(onPad()).toEqual([h.pad.x, h.pad.z])
  expect(h.runtime.checkpoint()?.members['personal:eagle']).toMatchObject({ status: 'deployed', eaglePadId: h.pad.id, mount: { mounted: false } })
  // The next Follow boards the same parked eagle.
  expect(h.runtime.follow()).toBe(true)
  expect(rider.formationTarget?.toArray()).toEqual(eagle.group.position.toArray())
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  expect(h.actors).toHaveLength(2)
})

it('turns a Charge issued while an eagle rider walks home into boarding its parked eagle, then charges mounted', () => {
  const h = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }])
  h.runtime.materializeStandby(); h.flush()
  const [rider] = h.actors, [eagle] = h.mounts
  expect(h.runtime.follow()).toBe(true)
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(h.runtime.dismiss()).toBe(true)
  h.runtime.updateLifecycle()
  expect([rider.mount, h.runtime.state]).toEqual([undefined, 'RETURNING'])
  // The command UI sets Charge on live actors before the squad records it.
  rider.setTacticalOrder('charge'); h.runtime.resumeCommand('charge')
  expect(rider.formationTarget?.toArray()).toEqual(eagle.group.position.toArray())
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect([rider.mount, rider.tacticalOrder]).toEqual([eagle, 'charge'])
})

it('deploys an HR standby eagle rider into a mission field already in the saddle', () => {
  const home = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }])
  home.runtime.materializeStandby(); home.flush()
  const saved = home.runtime.checkpoint()!
  expect(saved.members['personal:eagle'].mount?.mounted).toBe(false)
  const field = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }], { field: true })
  field.runtime.restoreMission(saved); field.flush()
  const [rider] = field.actors, [eagle] = field.mounts
  expect([rider.mount, rider.tacticalOrder]).toEqual([eagle, 'defend'])
  expect([eagle.group.position.x, eagle.group.position.z]).toEqual([field.pad.x, field.pad.z])
})

it('keeps an airborne eagle on its return order while it closes on the pad, holds a stalled one for retry, and never reports it home', () => {
  const queue = new EagleLandingQueue(10, 3)
  const h = standbyHarness([{ id: 'personal:eagle', mount: 'xongkoro' }], { queue })
  h.runtime.materializeStandby(); h.flush()
  const [rider] = h.actors, [eagle] = h.mounts
  expect(h.runtime.follow()).toBe(true)
  rider.group.position.copy(eagle.group.position)
  h.runtime.updateLifecycle()
  expect(rider.mount).toBe(eagle)
  // Dismiss is issued from cruise, far from the pad.
  eagle.isAirborne = true; eagle.flight.phase = 'cruise'; eagle.flight.speed = 13
  eagle.group.position.set(h.pad.x, 30, h.pad.z + 100)
  expect(h.runtime.dismiss()).toBe(true)
  expect(rider.flightOrder).toBe('return')
  // 20 s of real closure: twice the queue window, yet the approach is never reset to Hold.
  for (let step = 0; step < 5; step++) {
    queue.beginFrame(4)
    eagle.group.position.z -= 15
    h.runtime.updateLifecycle()
    expect([rider.flightOrder, rider.mount, h.runtime.state]).toEqual(['return', eagle, 'RETURNING'])
  }
  // No further progress: the permission lapses to Hold, then the same eagle may try again.
  queue.beginFrame(11)
  h.runtime.updateLifecycle()
  expect([rider.flightOrder, rider.mount, h.runtime.state]).toEqual(['hold', eagle, 'RETURNING'])
  queue.beginFrame(3)
  h.runtime.updateLifecycle()
  expect([rider.flightOrder, rider.mount, h.runtime.state]).toEqual(['return', eagle, 'RETURNING'])
})

it('pauses only a failed HR standby ID: the Town stays usable, a later hire still stands at HR, and retry adds the same ID once', () => {
  const h = standbyHarness([{ id: 'personal:ok' }, { id: 'personal:a' }], { failOnce: ['personal:a'] })
  h.runtime.materializeStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:ok'])
  // A standby failure is not a deployment failure: no lock, Follow/refit readiness intact.
  expect(h.runtime.standbyError).toBeInstanceOf(Error)
  expect(h.runtime.error).toBeUndefined()
  expect(h.runtime.ready).toBe(true)
  expect(h.runtime.hudPendingIds).toEqual([])
  // No automatic retry loop for A.
  h.runtime.updateLifecycle(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(0)
  // Without retrying A, a later hire B still materializes at HR.
  expect(recruitPersonalSquadMember(h.profile, 'soldier', next => { h.profile = next; return true }, () => 'personal:b').recruited).toBe(true)
  const merit = h.profile.availableMerit, roster = structuredClone(h.profile.personalSquad)
  h.runtime.materializeStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:ok', 'personal:b'])
  // Retry queues A's saved identity; a cancelled batch frees it for the next retry.
  h.runtime.retryStandby()
  expect(h.scheduler.pending).toBe(1)
  h.runtime.cancelPendingSpawns()
  h.runtime.retryStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:ok', 'personal:b', 'personal:a'])
  expect(h.runtime.standbyError).toBeUndefined()
  h.runtime.retryStandby(); h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(new Set(h.spawned.map(spawn => `${spawn.slot.x},${spawn.slot.z}`)).size).toBe(3)
  expect(h.profile.availableMerit).toBe(merit)
  expect(h.profile.personalSquad).toEqual(roster)
})

it('keeps a hire still loading when the old squad reaches HR as HR standby, so its failure never blocks the Town', () => {
  const h = standbyHarness([{ id: 'personal:old' }], { failOnce: ['personal:new'] })
  h.runtime.materializeStandby(); h.flush()
  const [old] = h.actors
  expect(h.runtime.follow()).toBe(true)
  expect(recruitPersonalSquadMember(h.profile, 'soldier', next => { h.profile = next; return true }, () => 'personal:new').recruited).toBe(true)
  const merit = h.profile.availableMerit
  h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(1)
  // The old member arrives first; the hire's load fails only afterwards.
  expect(h.runtime.dismiss()).toBe(true)
  old.arrived = true; h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  h.flush()
  expect(h.runtime.standbyError).toBeInstanceOf(Error)
  expect([h.runtime.error, h.runtime.ready]).toEqual([undefined, true])
  h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  h.runtime.retryStandby(); h.flush()
  expect(h.actors.map(actor => actor.combatantId)).toEqual(['personal:old', 'personal:new'])
  h.runtime.retryStandby(); h.runtime.updateLifecycle()
  expect(h.scheduler.pending).toBe(0)
  expect(h.actors).toHaveLength(2)
  expect(h.profile.availableMerit).toBe(merit)
})

it('keeps a squad dismissed to HR through an in-place mission return and reload without refit or revival', () => {
  const h = standbyHarness([{ id: 'personal:a' }, { id: 'personal:b' }])
  h.runtime.materializeStandby(); h.flush()
  const [a, b] = h.actors
  expect(h.runtime.follow()).toBe(true)
  a.hp = 40; b.dead = true; b.hp = 0
  expect(h.runtime.dismiss()).toBe(true)
  a.arrived = true; h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  // Same-scene arrival: no cleanup, no new actor for the casualty, wounds unchanged.
  h.runtime.endMission(false)
  h.runtime.updateLifecycle(); h.runtime.materializeStandby()
  expect([a.disposed, b.disposed, h.scheduler.pending, a.hp]).toEqual([false, false, 0, 40])
  const saved = parsePersonalMission(JSON.parse(JSON.stringify(h.runtime.checkpoint())))!
  expect(saved.members).toMatchObject({ 'personal:a': { status: 'deployed', hp: 40 }, 'personal:b': { status: 'dead', hp: 0 } })
  const r = standbyHarness([{ id: 'personal:a' }, { id: 'personal:b' }], { saved })
  r.runtime.restoreMission(saved); r.flush(); r.runtime.updateLifecycle()
  expect(r.scheduler.pending).toBe(0)
  expect(r.actors.map(actor => [actor.combatantId, actor.hp])).toEqual([['personal:a', 40]])
  expect(r.runtime.checkpoint()?.members['personal:b']).toMatchObject({ status: 'dead', hp: 0 })
})

it('stands a hire made while the old squad follows at its own HR slot without changing deployed orders, then deploys it on the next Follow', () => {
  const h = standbyHarness([{ id: 'personal:old' }])
  h.runtime.materializeStandby(); h.flush()
  const [old] = h.actors
  expect(h.runtime.follow()).toBe(true)
  const oldOrders = [old.assignFollowTarget.mock.calls.length, old.assignFormationTarget.mock.calls.length]
  // Back at HR the player hires again: the saved hire appears at once beside the deployed squad.
  expect(recruitPersonalSquadMember(h.profile, 'soldier', next => { h.profile = next; return true }, () => 'personal:new').recruited).toBe(true)
  h.runtime.materializeStandby(); h.runtime.materializeStandby()
  expect(h.scheduler.pending).toBe(1)
  expect(h.runtime.hudPendingIds).toEqual([])
  h.flush(); h.runtime.updateLifecycle()
  const recruit = h.actors[1]
  expect(recruit.combatantId).toBe('personal:new')
  expect(recruit.assignFollowTarget).not.toHaveBeenCalled()
  const slot = h.spawned[1].slot
  expect(slot).not.toEqual(h.spawned[0].slot)
  expect(recruit.formationTarget?.toArray()).toEqual([slot.x, 2.1, slot.z])
  expect(h.runtime.state).toBe('DEPLOYING')
  expect([old.assignFollowTarget.mock.calls.length, old.assignFormationTarget.mock.calls.length]).toEqual(oldOrders)
  expect([h.runtime.acceptsCommand(old as unknown as NPC), h.runtime.acceptsCommand(recruit as unknown as NPC)]).toEqual([true, false])
  const saved = parsePersonalMission(JSON.parse(JSON.stringify(h.runtime.checkpoint())))!
  expect(saved.members['personal:new']).toMatchObject({ status: 'deployed', standby: true })
  // Dismiss returns only the deployed member; the recruit is already home.
  const recruitWalks = recruit.assignFormationTarget.mock.calls.length
  expect(h.runtime.dismiss()).toBe(true)
  expect(recruit.assignFormationTarget.mock.calls.length).toBe(recruitWalks)
  expect(h.runtime.hudReturningIds).toEqual(['personal:old'])
  old.arrived = true; h.runtime.updateLifecycle()
  expect(h.runtime.state).toBe('RESERVE')
  expect(h.runtime.follow()).toBe(true)
  expect(recruit.assignFollowTarget).toHaveBeenCalledOnce()
  expect(h.actors).toHaveLength(2)
  // Reload keeps the recruit on standby while the deployed member resumes Follow.
  const r = standbyHarness([{ id: 'personal:old' }, { id: 'personal:new' }], { saved })
  r.runtime.restoreMission(saved); r.flush()
  const [restoredOld, restoredNew] = r.actors
  expect(restoredOld.assignFollowTarget).toHaveBeenCalledOnce()
  expect(restoredNew.assignFollowTarget).not.toHaveBeenCalled()
  expect(r.runtime.acceptsCommand(restoredNew as unknown as NPC)).toBe(false)
})

it('keeps an all-casualty HR squad through reload, in-place mission return and another reload without refilling it', () => {
  const ids = [{ id: 'personal:a' }, { id: 'personal:b' }]
  const fallen: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE', memberIds: ['personal:a', 'personal:b'],
    contribution: emptyPersonalContribution(), members: { 'personal:a': { status: 'dead', hp: 0 }, 'personal:b': { status: 'dead', hp: 0 } } }
  // Reload during the mission: casualties have no actors.
  const r = standbyHarness(ids, { saved: fallen })
  r.profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'qa-fallen')
  r.runtime.restoreMission(fallen); r.flush(); r.runtime.updateLifecycle()
  expect([r.actors.length, r.scheduler.pending]).toEqual([0, 0])
  // In-place settlement clears the mission; the casualty-only checkpoint stays authoritative.
  delete r.profile.activeMission
  r.runtime.endMission(false)
  r.runtime.updateLifecycle(); r.runtime.materializeStandby(); r.flush()
  expect([r.actors.length, r.scheduler.pending]).toEqual([0, 0])
  const saved = parsePersonalMission(JSON.parse(JSON.stringify(r.runtime.checkpoint())))!
  expect(saved.members).toEqual(fallen.members)
  // Another reload at home: still no revival until an explicit HR refit.
  const again = standbyHarness(ids, { saved })
  again.runtime.restoreMission(saved); again.runtime.updateLifecycle(); again.flush()
  expect([again.actors.length, again.scheduler.pending]).toEqual([0, 0])
  expect(again.runtime.checkpoint()?.members).toEqual(fallen.members)
})

it('keeps HR shield durability by requested id through a refit, an autosave and a reload while the GLB is still loading', () => {
  const probe = standbyHarness([{ id: 'personal:a' }])
  const shieldId = probe.profile.personalSquad!.members[0].equipment!.shield!
  const max = ARMORS[shieldId].shieldImpactMax
  // A reload of a saved partial (17/48 of the catalogue max) or 0 keeps that value for the requested shield until the model is actually equipped.
  const partial = Math.round(max * 17 / 48)
  for (const saved of [partial, 0]) {
    const mission: PersonalSquadMission = { squadId: 'personal', sceneKey: 'town-home', state: 'RESERVE',
      memberIds: ['personal:a'], contribution: emptyPersonalContribution(),
      members: { 'personal:a': { status: 'reserve', hp: 100, shieldImpact: saved } } }
    const h = standbyHarness([{ id: 'personal:a' }], { saved: mission, loadingShields: true })
    h.runtime.restoreMission(mission); h.runtime.updateLifecycle(); h.flush(); h.runtime.updateLifecycle()
    const [a] = h.actors
    expect(a.requestedShieldId).toBe(shieldId)
    a.shield.equip?.(shieldId)
    expect(a.shield.shieldImpactRemaining).toBe(saved)
  }
  // A refit while the shield is still loading saves and applies the full catalogue value, then survives autosave and reload.
  const first = standbyHarness([{ id: 'personal:a' }], { loadingShields: true })
  first.runtime.materializeStandby(); first.flush()
  expect(first.actors[0].shield.shieldImpactMax).toBe(0)
  expect(first.runtime.refit(() => true)).toBe(true)
  const autosave = parsePersonalMission(JSON.parse(JSON.stringify(first.runtime.checkpoint())))!
  expect(autosave.members['personal:a']).toMatchObject({ shieldImpact: max })
  const reloaded = standbyHarness([{ id: 'personal:a' }], { saved: autosave, loadingShields: true })
  reloaded.runtime.restoreMission(autosave); reloaded.runtime.updateLifecycle(); reloaded.flush(); reloaded.runtime.updateLifecycle()
  const [after] = reloaded.actors
  after.shield.equip?.(shieldId)
  expect(after.shield.shieldImpactRemaining).toBe(max)
})
