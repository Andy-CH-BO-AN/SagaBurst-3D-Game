import { createCommanderCavalryEscort } from '../../src/career/CommanderCavalryEscort'
import { describe,expect,it,vi } from 'vitest'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY,CareerProfileStore,parseCareerProfile } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import { advanceCommanderFourGateDefensePreparation } from '../../src/career/CommanderFourGateDefenseState'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import type { NPC } from '../../src/world/NPC'

function fixture() {
  let profile = createCareerProfile('roman')
  profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'checkpoint', 'bandit', 'captain')
  let saving = true
  let stage = 0
  const read = vi.fn(() => profile)
  const commit = vi.fn((next: CareerProfile) => { if (!saving) return false; profile = next; return true })
  const checkpoint = new CareerMissionCheckpoint(read, commit)
  const snapshot = vi.fn(() => ({ ...profile.activeMission!, routeStage: stage }))
  return { checkpoint, read, commit, snapshot,
    get profile() { return profile },
    setStage(value: number) { stage = value },
    setSaving(value: boolean) { saving = value },
    setProfile(value: CareerProfile) { profile = value },
  }
}

describe('CareerMissionCheckpoint', () => {
  it('waits five seconds for periodic changes and restarts the clock only after saving', () => {
    const h = fixture(), periodic = { immediate: false, periodic: true }
    h.setStage(1)
    h.checkpoint.advance(4.99)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(false)
    expect(h.read).not.toHaveBeenCalled()
    expect(h.snapshot).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    h.checkpoint.advance(.01)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(true)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    h.setStage(2)
    h.checkpoint.advance(4.99)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(false)
    h.checkpoint.advance(.01)
    expect(h.checkpoint.persist(h.snapshot, periodic)).toBe(true)
    expect(h.profile.activeMission!.routeStage).toBe(2)
  })

  it('saves immediate changes with the complete current snapshot and resets the periodic clock', () => {
    const h = fixture()
    h.checkpoint.advance(4)
    const snapshot = () => ({ ...h.profile.activeMission!, routeStage: 3,
      mountedMarchPosition: { x: 12, z: 34 },
      playerStats: { damageDealt: 90, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    })
    expect(h.checkpoint.persist(snapshot, { immediate: true })).toBe(true)
    expect(h.profile.activeMission).toMatchObject({ routeStage: 3, mountedMarchPosition: { x: 12, z: 34 }, playerStats: { damageDealt: 90, kills: 1 } })
    h.checkpoint.advance(1)
    expect(h.checkpoint.persist(h.snapshot, { immediate: false, periodic: true })).toBe(false)
    expect(h.commit).toHaveBeenCalledOnce()
  })

  it('isolates profile mutations and preserves unrelated Career state across a snapshot commit', () => {
    const h = fixture()
    h.setProfile({ ...h.profile, totalMerit: 25, availableMerit: 25, claimedBattleIds: ['battle'],
      ownedWeapons: ['gladius_rusty'], activeMission: { ...h.profile.activeMission!,
        mountState: { activeMountId: 'horse', hp: { horse: 43 }, unavailable: ['corgi'] },
      } })
    const before = h.profile
    h.setStage(3)
    h.checkpoint.persist(h.snapshot, { immediate: true })
    expect(h.profile).toEqual({ ...before, activeMission: { ...before.activeMission!, routeStage: 3 } })
    expect(h.profile).not.toBe(before)
    h.profile.ownedWeapons.push('longsword')
    h.profile.claimedBattleIds.push('another-battle')
    expect(before.ownedWeapons).toEqual(['gladius_rusty'])
    expect(before.claimedBattleIds).toEqual(['battle'])
    expect(before.activeMission!.routeStage).toBeUndefined()
  })

  it('resets elapsed time for a new mission and does not advance it for negative dt', () => {
    const h = fixture(), reason = { immediate: false, periodic: true }
    h.checkpoint.advance(4)
    h.checkpoint.reset()
    h.checkpoint.advance(-10)
    h.checkpoint.advance(1)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(false)
    h.checkpoint.advance(4)
    expect(h.checkpoint.persist(h.snapshot, reason)).toBe(true)
  })

  it('acknowledges fresh native deployment with the actual HR service resident without cancelling the mission', () => {
    let profile = createFourGateDefenseProfile('PREPARING')
    const active = profile.activeMission!, state = active.fourGateDefense!
    active.phase = 'DEPLOYING'; state.phase = 'DEPLOYING'
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    const npc = { combatantId: 'hr-officer', hp: 100, dead: false,
      combatPosition: { x: 20, y: 0, z: 30 }, group: { rotation: { y: 0 } },
      combatAmmo: 0, shield: { shieldImpactRemaining: 0 }, tacticalOrder: 'defend', mount: null }
    const player = { hp: 85, dead: false, staminaValue: 70, position: { x: 12, y: 10, z: 18 },
      facingYaw: .5, arrowCount: 7, shield: { shieldImpactRemaining: 2 }, currentMount: null }
    // All native identity rows remain real saved data. Only the service actor's
    // snapshot dependency is needed to reproduce the first-entry parser boundary.
    const controller = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as
      Pick<CommanderFourGateDefenseController, 'completeInitialDeployment' | 'snapshotActiveMission'>, {
      readProfile: () => profile, player: () => player, state, startedMissionId: active.id,
      residents: [{ spec: { id: 'hr-officer', role: 'hr-officer' }, npc },
        ...active.civilianActorIds!.map(id => ({ spec: { id, role: 'civilian' }, npc: { ...npc, combatantId: id } }))], enemies: [],
      personalActors: () => [], actorMounts: new Map(), playerIssuedCommands: new Set(), tracker: null,
      checkpoint: new CareerMissionCheckpoint(() => profile, next => {
        if (!store.save(next)) return false
        profile = next; return true
      }),
    })
    controller.completeInitialDeployment()
    const restored = store.load()!.activeMission!
    expect(restored.id).toBe(active.id)
    expect(restored.fourGateDefense).toMatchObject({ phase: 'PREPARING', preparationRemainingSeconds: 180,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [],
      actors: { 'hr-officer': { status: 'deployed', hp: 100, position: { x: 20, y: 0, z: 30 } } } })
    expect(restored.friendlyActorIds).not.toContain('hr-officer')
    expect(restored.officialSquad!.actorIds).not.toContain('hr-officer')
  })

  it('retries a failed first-attack save with current actor intent in both checkpoints before publishing combat', () => {
    const legacy = createFourGateDefenseProfile('PREPARING', { legacyPrepared: true })
    legacy.activeMission!.fourGateDefense!.preparationRemainingSeconds = 37.5
    let profile = parseCareerProfile(legacy)!
    expect(profile.activeMission!.fourGateDefense!.preparationRemainingSeconds).toBe(37.5)
    const state = advanceCommanderFourGateDefensePreparation(profile.activeMission!.fourGateDefense!, 37.5, true)
    profile.activeMission!.fourGateDefense = state; profile.activeMission!.phase = 'SPAWNING'
    profile.activeMission!.commanderMission!.deploymentComplete = false
    const initial = profile
    const archerId = 'four-gate-save:east:archer:t3:1', lancerId = 'four-gate-save:east:lancer:t3:1'
    // Only dependencies read by the real snapshot owner; no actor, mount or scene constructor.
    const dataActor = (id: string, saved: PersonalActorCheckpoint): NPC => ({
      combatantId: id, hp: saved.hp, dead: false, combatPosition: { ...saved.position },
      group: { rotation: { y: saved.position!.yaw } }, combatAmmo: saved.ammo,
      shield: { shieldImpactRemaining: saved.shieldImpact }, tacticalOrder: 'defend',
      hasActiveRangedWeapon: id === archerId, siegeTransport: null,
      mount: saved.mount ? { dead: false, currentHp: saved.mount.hp,
        group: { position: { ...saved.mount.position }, rotation: { y: saved.mount.position.yaw } } } : null,
    } as unknown as NPC)
    const enemies = [dataActor(archerId, state.actors[archerId]), dataActor(lancerId, state.actors[lancerId])]
    state.actors[archerId].order = 'defend'; state.actors[lancerId].order = 'defend'
    state.siege!.actors[archerId].order = 'defend'; state.siege!.actors[lancerId].order = 'defend'
    const player = { hp: 85, dead: false, staminaValue: 70, position: { x: 12, y: 10, z: 18 },
      facingYaw: .5, arrowCount: 7, shield: { shieldImpactRemaining: 2 }, currentMount: null }
    const residents = profile.activeMission!.civilianActorIds!.map(id => ({ spec: { id, role: 'civilian' }, npc: dataActor(id, state.actors[id]) }))
    const controller = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as Pick<CommanderFourGateDefenseController, 'snapshotActiveMission' | 'combatEnabled'>, {
      readProfile: () => profile, player: () => player, enemies, personalActors: () => [],
      residents,
      actorMounts: new Map(), tracker: null, startedMissionId: profile.activeMission!.id,
      spawnBatch: { pending: 0, ready: true },
      fourGateSiege: { ready: true, snapshot: () => structuredClone(state.siege!) },
      state: { ...state, registeredTargetActorIds: [] },
    })
    // Reload may finish the attacker batch before native/player finalization saves.
    // The actual snapshot owner must acknowledge that full roster even while still SPAWNING.
    const readySnapshot = controller.snapshotActiveMission()
    expect(readySnapshot.fourGateDefense).toMatchObject({ phase: 'SPAWNING', deploymentComplete: false })
    expect(readySnapshot.fourGateDefense!.registeredTargetActorIds).toHaveLength(230)
    const liveState = { ...readySnapshot.fourGateDefense!, phase: 'ATTACKING' as const, attackStarted: true, deploymentComplete: true }
    Object.assign(controller, { state: liveState })
    // The same production snapshot must withhold the new escort's initial Charge,
    // then stage its durable one-shot release in both actor owners.
    liveState.cavalryEscort = createCommanderCavalryEscort(profile.activeMission!.id)
    const held = controller.snapshotActiveMission().fourGateDefense!
    expect(held.actors[lancerId].order).toBe('defend')
    expect(held.siege!.actors[lancerId].order).toBe('defend')
    Object.assign(controller, { pendingEscortReleases: [lancerId] })
    const storage = new MemoryStorage({ failWrites: true })
    // This case owns snapshot ordering and checkpoint acknowledgement, not the
    // profile-store parser matrix. The real legacy parser above covers decoding;
    // a narrow storage boundary preserves throwing writes and exact durable bytes.
    const checkpoint = new CareerMissionCheckpoint(() => profile, next => {
      try { storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next)) } catch { return false }
      profile = next
      return true
    })
    checkpoint.advance(5)
    let attempted: ReturnType<typeof controller.snapshotActiveMission> | undefined
    const snapshot = () => (attempted = controller.snapshotActiveMission())
    expect(checkpoint.persist(snapshot, { immediate: false, periodic: true })).toBe(false)
    const released = attempted!.fourGateDefense!
    expect(released.actors[lancerId].order).toBe('charge')
    expect(released.siege!.actors[lancerId].order).toBe('charge')
    expect(released.actors[lancerId].formation).toBeUndefined()
    Object.assign(controller, { pendingEscortReleases: undefined })
    delete liveState.cavalryEscort
    expect(profile).toBe(initial)
    expect(profile.activeMission!.phase).toBe('SPAWNING')
    expect(controller.combatEnabled).toBe(false)
    expect(state.siege!.actors[archerId].order).toBe('defend')
    expect(storage.length).toBe(0)
    player.hp = 70
    storage.failWrites = false
    expect(checkpoint.persist(snapshot, { immediate: false, periodic: true })).toBe(true)
    expect(Array.from({ length: storage.length }, (_, index) => storage.key(index))).toEqual([CAREER_STORAGE_KEY])
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!)).toMatchObject({ version: 1, activeMission: { id: 'four-gate-save', phase: 'ATTACKING' } })
    // Inspect durable bytes from the successful retry, including the fresh actor intent.
    const saved = (JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!) as CareerProfile).activeMission!.fourGateDefense!
    expect(saved).toMatchObject({ phase: 'ATTACKING', attackStarted: true, preparationRemainingSeconds: 0, player: { hp: 70 } })
    expect(saved.actors[archerId].order).toBe('attack')
    expect(saved.siege!.actors[archerId].order).toBe('attack')
    expect(saved.actors[lancerId].order).toBe('charge')
    expect(saved.siege!.actors[lancerId].order).toBe('charge')
    expect(controller.combatEnabled).toBe(true)
    // The live final-frame snapshot, not a caller-supplied result, owns the
    // survival receipt. These are plain actor ports for the canonical full roster.
    enemies.push(...profile.activeMission!.targetActorIds.filter(id => id !== archerId && id !== lancerId)
      .map(id => dataActor(id, state.actors[id])))
    liveState.combatElapsedSeconds = 300
    expect(controller.snapshotActiveMission().fourGateDefense!.victoryReason).toBe('survival')
    player.dead = true; player.hp = 0
    for (const resident of residents) Object.assign(resident.npc, { dead: true, hp: 0 })
    liveState.victoryReason = 'survival'
    expect(controller.snapshotActiveMission().fourGateDefense!.victoryReason).toBeUndefined()

  })

  it('saves spawning intent before enqueueing and holds combat through reload, incomplete deployment and failed attack commit', () => {
    let profile = createFourGateDefenseProfile('ATTACKING')
    // One materialization dependency set serves the later scheduler completion.
    // The accepted preparation itself contains only native data, never these enemies/ramps.
    const materialized = profile.activeMission!.fourGateDefense!
    profile.activeMission!.phase = 'PREPARING'; profile.activeMission!.commanderMission!.deploymentComplete = false
    profile.activeMission!.fourGateDefense = { ...materialized, phase: 'PREPARING', preparationRemainingSeconds: .25,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [], siege: undefined,
      actors: Object.fromEntries([...profile.activeMission!.friendlyActorIds, ...profile.activeMission!.civilianActorIds!]
        .map(id => [id, materialized.actors[id]])) }
    const before = JSON.stringify(profile)
    const storage = new MemoryStorage({ failWrites: true, initialValues: [[CAREER_STORAGE_KEY, before]] })
    const store = new CareerProfileStore(storage)
    let batches = 0, releases = 0, rejectAttack = false
    const commit = (next: CareerProfile) => {
      if (rejectAttack && next.activeMission!.phase === 'ATTACKING') return false
      try { storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next)) } catch { return false }
      profile = next; return true
    }
    type FlowEntry = Pick<CommanderFourGateDefenseController, 'updateFlow' | 'combatEnabled' | 'setPreparationElapsed'> & {
      state: NonNullable<NonNullable<CareerProfile['activeMission']>['fourGateDefense']>
      spawnBatch?: { pending: number; ready: boolean; status: string }
      fourGateSiege?: { ready: boolean }
    }
    // Rendering/materialization and actor snapshot production are dependencies here;
    // real updateFlow, readiness, checkpoint cadence and storage acknowledgement decide the
    // transition. The single partial-deployment reload below exercises the real store parser.
    const controller = Object.assign(Object.create(CommanderFourGateDefenseController.prototype) as FlowEntry, {
      readProfile: () => profile, player: () => ({ dead: false }), startedMissionId: profile.activeMission!.id,
      friendlyReady: true, state: structuredClone(profile.activeMission!.fourGateDefense!),
      checkpoint: new CareerMissionCheckpoint(() => profile, commit),
      beginAttackers(this: FlowEntry) { batches++; this.spawnBatch = { pending: 1, ready: false, status: 'pending' }; this.fourGateSiege = { ready: false } },
      releaseCombat() { releases++ },
      snapshotActiveMission(this: FlowEntry) {
        const state = this.state.phase === 'ATTACKING'
          ? { ...this.state, actors: materialized.actors, siege: materialized.siege }
          : this.state
        return { ...profile.activeMission!, phase: state.phase, fourGateDefense: state,
          commanderMission: { ...profile.activeMission!.commanderMission!, deploymentComplete: state.deploymentComplete } }
      },
    })
    controller.updateFlow(.25, 0)
    expect(batches).toBe(0); expect(releases).toBe(0)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(before)
    expect(profile.activeMission!.phase).toBe('PREPARING')
    expect(controller.state).toMatchObject({ phase: 'PREPARING', preparationRemainingSeconds: 0, attackStarted: false })
    storage.failWrites = false
    controller.updateFlow(0, 0)
    expect(batches).toBe(1)
    expect(profile.activeMission!.fourGateDefense).toMatchObject({ phase: 'SPAWNING', preparationRemainingSeconds: 0,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [] })
    expect(profile.activeMission!.fourGateDefense!.siege).toBeUndefined()
    expect(profile.activeMission!.targetActorIds.some(id => profile.activeMission!.fourGateDefense!.actors[id])).toBe(false)

    const target = 'four-gate-save:east:lancer:t3:1'
    const partialActor: PersonalActorCheckpoint = { status: 'deployed', hp: 43, order: 'defend',
      position: { x: 190, y: 0, z: 60, yaw: 0 },
      mount: { hp: 0, mounted: false, position: { x: 189, y: 0, z: 60, yaw: 0 } } }
    controller.state.registeredTargetActorIds = [target]; controller.state.actors[target] = partialActor
    controller.updateFlow(5, 0)
    profile = store.load()!
    controller.state = structuredClone(profile.activeMission!.fourGateDefense!)
    expect(controller.state.actors[target]).toEqual(partialActor)
    expect(controller.state.registeredTargetActorIds).toEqual([target])
    controller.updateFlow(1, 0)
    expect(controller.state).toMatchObject({ phase: 'SPAWNING', preparationRemainingSeconds: 0 })
    expect(batches).toBe(1); expect(releases).toBe(0); expect(controller.combatEnabled).toBe(false)

    materialized.actors[target] = partialActor
    materialized.siege!.actors[target] = { ...partialActor, entranceId: null, breachCompleted: false }
    controller.spawnBatch!.pending = 0; controller.spawnBatch!.ready = true; controller.fourGateSiege!.ready = true
    rejectAttack = true
    controller.updateFlow(0, 0)
    expect(profile.activeMission!.phase).toBe('SPAWNING')
    expect(controller.state.phase).toBe('SPAWNING'); expect(controller.combatEnabled).toBe(false); expect(releases).toBe(0)
    rejectAttack = false
    controller.updateFlow(8, 0)
    expect(controller.state.combatElapsedSeconds).toBe(0)
    controller.setPreparationElapsed(0)
    controller.updateFlow(20, 0)
    expect(controller.state.combatElapsedSeconds).toBe(0)
    controller.setPreparationElapsed(12.5)
    controller.updateFlow(.05, 0)
    expect(controller.state.combatElapsedSeconds).toBe(12.5)
    expect(profile.activeMission!.fourGateDefense!.combatElapsedSeconds).toBe(12.5)
    expect(profile.activeMission!.phase).toBe('ATTACKING')
    expect(profile.activeMission!.fourGateDefense!.registeredTargetActorIds).toHaveLength(230)
    expect(controller.combatEnabled).toBe(true)
    expect(batches).toBe(1); expect(releases).toBe(1)
  })
})
