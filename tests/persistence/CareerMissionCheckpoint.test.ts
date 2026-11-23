import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { acceptCommanderMission, COMMANDER_DECAPITATION_ID } from '../../src/career/CommanderMissionCatalog'
import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds } from '../../src/career/CommanderFourGateDefenseState'
import { commanderFourGateGarrisonSlots } from '../../src/career/CommanderFourGateDefenseRoster'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { Faction, type NPC } from '../../src/world/NPC'
import { ActorDouble, asMount, asNpc, asPlayer, MountDouble, PlayerDouble, recordingActorFactory, residentSpec } from '../helpers/careerActorDoubles'
import { fourGateDefenseRuntime } from '../helpers/fourGateDefenseRuntime'
import { createCommanderCavalryEscort } from '../../src/career/CommanderCavalryEscort'
import { CommanderFourGateDefenseController } from '../../src/career/CommanderFourGateDefenseController'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import { CivilianCommandSquadController } from '../../src/town/CivilianCommandSquadController'
import { TownCommandSquadController } from '../../src/town/TownCommandSquadController'
import { freshCommanderFourGateDefenseEntry } from '../../src/career/CommanderFourGateDefenseEntry'

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
      inventory: { version: 1 as const, quantities: Object.fromEntries(['gladius_rusty'].map(id => [id, 1])) }, ownedWeapons: ['gladius_rusty'], activeMission: { ...h.profile.activeMission!,
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

  it('acknowledges death only after save and renews that acknowledgement for a new mission or reset', () => {
    const h = fixture()
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, playerDead: true, playerHp: 0 } })
    const death = () => ({ immediate: false, deathMissionId: h.profile.activeMission!.id })
    h.setSaving(false)
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(false)
    h.setSaving(true)
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(true)
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(false)
    expect(h.commit).toHaveBeenCalledTimes(2)
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, id: 'next-checkpoint' } })
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(true)
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(false)
    h.checkpoint.reset()
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(true)
    expect(h.checkpoint.persist(h.snapshot, death())).toBe(false)
    expect(h.commit).toHaveBeenCalledTimes(4)
  })


  it('lazily captures Commander Town death after combat and retries fresh state before returning to the periodic cadence', () => {
    const base = createCareerProfile('roman')
    Object.assign(base, careerRankFixture(base.faction, 'commander')); base.totalMerit = 20_000
    let profile = acceptCommanderMission(base, COMMANDER_DECAPITATION_ID, 'town-death')!
    profile.activeMission!.commanderMission!.deploymentComplete = true
    let saving = true, commits = 0
    const scheduler = new NpcSpawnScheduler(), player = Object.assign(new PlayerDouble(), { hp: 85, staminaValue: 70 })
    const commander = new ActorDouble('commander', { faction: Faction.ENEMY, characterFaction: 'viking', x: 20, z: 30 })
    // Real deployment, objective stats and checkpoint cadence; actor bodies and spawn frames are the only doubles.
    const controller = new CommanderTownMissionController(recordingActorFactory(), [{ spec: residentSpec('commander', 'commander'), npc: asNpc(commander) }],
      () => asPlayer(player), () => profile, next => { commits++; if (!saving) return false; profile = next; return true },
      new NavigationWorld({ minX: -4, maxX: 4, minZ: -4, maxZ: 4 }), scheduler)
    onTestFinished(() => controller.dispose())
    expect(controller.startActiveMission()).toBe(true)
    for (let frame = 1; scheduler.pending > 0; frame++) scheduler.tick(frame)
    const deployed = commits
    const hit = (damage: number) => controller.events.emit({ type: 'damage_applied', method: 'melee', requestedDamage: damage, appliedDamage: damage,
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: 'commander', targetType: 'npc', name: 'commander', allegiance: Faction.ENEMY, characterFaction: 'viking' } })
    hit(20)
    controller.updateFlow(4.99, 0)
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed)
    // Early cadence saves death before final hits. playerDead cannot acknowledge
    // the complete snapshot later in this frame, including after a failed write.
    player.hp = 0
    controller.updateFlow(.01, 0)
    expect(commits).toBe(deployed + 1)
    expect(profile.activeMission).toMatchObject({ playerDead: true, actorHealth: { commander: { hp: 100 } } })
    const early = profile
    commander.hp = 61; commander.group.position.x = 40; hit(25); saving = false
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 2)
    expect(profile).toBe(early)
    commander.hp = 37; commander.group.position.x = 55; hit(25); saving = true
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 3)
    expect(profile.activeMission).toMatchObject({ playerDead: true, playerHp: 0,
      actorHealth: { commander: { hp: 37 } }, actorPositions: { commander: { x: 55 } },
      playerStats: { damageDealt: 70 } })
    controller.persistRuntimeProgress()
    controller.updateFlow(4.99, 0)
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 3)
    commander.hp = 19
    controller.updateFlow(.01, 0)
    expect(commits).toBe(deployed + 4)
    expect(profile.activeMission!.actorHealth!.commander.hp).toBe(19)
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 4)
  })

  it('acknowledges fresh native deployment with the actual HR service resident without cancelling the mission', () => {
    const profile = createFourGateDefenseProfile('PREPARING'), active = profile.activeMission!
    active.phase = 'DEPLOYING'; active.fourGateDefense!.phase = 'DEPLOYING'
    const store = new CareerProfileStore(new MemoryStorage())
    // Every native identity row is real saved data; the HR officer is one of the deployed natives.
    const h = fourGateDefenseRuntime(profile, next => store.save(next))
    onTestFinished(() => h.controller.dispose())
    expect(h.controller.startActiveMission()).toBe(true)
    h.controller.completeInitialDeployment()
    const restored = store.load()!.activeMission!
    expect(restored.id).toBe(active.id)
    expect(restored.fourGateDefense).toMatchObject({ phase: 'PREPARING', preparationRemainingSeconds: 180,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [],
      actors: { 'hr-officer': { status: 'deployed', hp: 100, position: { x: 20, z: 30 } } } })
    expect(restored.friendlyActorIds).toContain('hr-officer')
    expect(restored.officialSquad!.squads!.find(squad => squad.squadId === 8)!.actorIds).toContain('hr-officer')
  })

  it('captures Four-gate death after an early save and forces a fresh exit snapshot without reviving the player', () => {
    let commits = 0
    const h = fourGateDefenseRuntime(createFourGateDefenseProfile('PREPARING'), () => { commits++; return true }), controller = h.controller
    onTestFinished(() => controller.dispose())
    const actorId = h.profile().activeMission!.friendlyActorIds[0], actor = h.residents.get(actorId)!
    Object.assign(h.player, { hp: 85, staminaValue: 70, arrowCount: 7 })
    expect(controller.startActiveMission()).toBe(true)
    controller.completeInitialDeployment()
    const deployed = commits
    controller.updateFlow(4.99, 0)
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed)
    h.player.hp = 0
    controller.updateFlow(.01, 0)
    expect(commits).toBe(deployed + 1)
    expect(h.profile().activeMission!.playerDead).toBe(true)
    actor.hp = 43; actor.group.position.x = 44; h.player.arrowCount = 3
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 2)
    expect(h.profile().activeMission!.fourGateDefense).toMatchObject({ actors: { [actorId]: { hp: 43, position: { x: 44 } } },
      player: { dead: true, hp: 0, ammo: 3 } })
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(h.profile())).toBe(true)
    expect(store.load()!.activeMission!.fourGateDefense).toMatchObject({
      actors: { [actorId]: { hp: 43, position: { x: 44 } } }, player: { dead: true, hp: 0, ammo: 3 } })
    // Exit snapshots bypass the acknowledgement even in the same frame.
    actor.hp = 26
    controller.persistRuntimeProgress(true, { hp: { horse: 12 }, unavailable: [] })
    expect(commits).toBe(deployed + 3)
    expect(h.profile().activeMission!.fourGateDefense!.actors[actorId].hp).toBe(26)
    expect(h.profile().activeMission!.mountState).toEqual({ hp: { horse: 12 }, unavailable: [] })
    // The controller must still let the checkpoint owner deduplicate ordinary dead-player updates.
    controller.persistRuntimeProgress()
    controller.updateFlow(1, 0)
    controller.persistRuntimeProgress()
    expect(commits).toBe(deployed + 3)
  })

  it('retries a failed first-attack save with current actor intent in both checkpoints before publishing combat', () => {
    const initialProfile = createFourGateDefenseProfile('ATTACKING')
    const acceptedTargetIds = [...initialProfile.activeMission!.targetActorIds].sort()
    Object.assign(initialProfile.activeMission!.fourGateDefense!, { phase: 'SPAWNING', deploymentComplete: false, attackStarted: false, combatElapsedSeconds: 0 })
    for (const ramp of initialProfile.activeMission!.fourGateDefense!.siege!.ramps) ramp.state = 'DEPLOYING'
    initialProfile.activeMission!.phase = 'SPAWNING'
    initialProfile.activeMission!.commanderMission!.deploymentComplete = false
    let profile = parseCareerProfile(initialProfile)!
    const state = profile.activeMission!.fourGateDefense!
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
      residents, reinforcements: [],
      actorMounts: new Map(), tracker: null, startedMissionId: profile.activeMission!.id,
      spawnBatch: { pending: 0, ready: true },
      fourGateSiege: { ready: true, snapshot: () => structuredClone(state.siege!) },
      state: { ...state, registeredTargetActorIds: [] },
    })
    // Reload may finish the attacker batch before native/player finalization saves.
    // The actual snapshot owner must acknowledge that full roster even while still SPAWNING.
    const readySnapshot = controller.snapshotActiveMission()
    expect(readySnapshot.fourGateDefense).toMatchObject({ phase: 'SPAWNING', deploymentComplete: false })
    expect([...readySnapshot.fourGateDefense!.registeredTargetActorIds].sort()).toEqual(acceptedTargetIds)
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
    expect(JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!)).toMatchObject({ version: 2, activeMission: { id: 'four-gate-save', phase: 'ATTACKING' } })
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
    liveState.combatElapsedSeconds = survivalSeconds
    expect(controller.snapshotActiveMission().fourGateDefense!.victoryReason).toBe('survival')
    player.dead = true; player.hp = 0
    for (const resident of residents) Object.assign(resident.npc, { dead: true, hp: 0 })
    liveState.victoryReason = 'survival'
    expect(controller.snapshotActiveMission().fourGateDefense!.victoryReason).toBeUndefined()

  })

  it('saves spawning intent before enqueueing and holds combat through reload, incomplete deployment and failed attack commit', () => {
    let profile = createFourGateDefenseProfile('ATTACKING')
    const acceptedTargetIds = [...profile.activeMission!.targetActorIds].sort()
    // One materialization dependency set serves the later scheduler completion.
    // The accepted preparation itself contains only native data, never these enemies/ramps.
    const materialized = profile.activeMission!.fourGateDefense!
    profile.activeMission!.phase = 'PREPARING'; profile.activeMission!.commanderMission!.deploymentComplete = false
    profile.activeMission!.fourGateDefense = { ...materialized, phase: 'PREPARING', preparationRemainingSeconds: .25,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [], siege: undefined,
      actors: Object.fromEntries([...profile.activeMission!.friendlyActorIds, ...(materialized.autonomousActorIds ?? []),
        ...commanderFourGateGarrisonSlots(profile.activeMission!.id).map(slot => slot.actorId), ...profile.activeMission!.civilianActorIds!]
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
    expect([...profile.activeMission!.fourGateDefense!.registeredTargetActorIds].sort()).toEqual(acceptedTargetIds)
    expect(controller.combatEnabled).toBe(true)
    expect(batches).toBe(1); expect(releases).toBe(1)
  })

  it('spawns mounted and foot civilians at Town Center refuge posts on fresh four-gate start and preserves them across pre-mission squad handoff', () => {
    let profile = createFourGateDefenseProfile('PREPARING')
    const active = profile.activeMission!
    active.phase = 'DEPLOYING'; active.fourGateDefense!.phase = 'DEPLOYING'
    const civilianIds = active.civilianActorIds!
    expect(civilianIds).toContain('merchant')
    for (const id of civilianIds) delete active.fourGateDefense!.actors[id]
    profile.civilianCommandSquad = {
      type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: [...civilianIds],
      owners: Object.fromEntries(civilianIds.map(id => [id, 'daily' as const])),
      members: Object.fromEntries(civilianIds.map(id => [id, {
        status: 'deployed' as const, hp: 100, order: 'attack' as const,
        position: { x: 60, y: 0, z: 20, yaw: 0 },
        ...(id === civilianIds[0] ? { mount: { hp: 100, mounted: true, position: { x: 60, y: 0, z: 20, yaw: 0 } } } : {}),
      }])),
    }
    const h = fourGateDefenseRuntime(profile, next => { profile = next; return true }, {
      civilianRefuge: count => Array.from({ length: count }, (_, index) => ({ x: -2 + index * 2, y: 1, z: -8, yaw: Math.PI })),
    })
    onTestFinished(() => h.controller.dispose())
    const mountedCiv = h.residents.get(civilianIds[0])!, footCiv = h.residents.get(civilianIds[1])!, merchant = h.residents.get('merchant')!
    const merchantPostX = -2 + civilianIds.indexOf('merchant') * 2
    const horse = new MountDouble('horse', 60, 20)
    mountedCiv.mountVehicle(horse); mountedCiv.group.position.set(60, 0, 20)
    footCiv.group.position.set(55, 0, 15)
    merchant.group.position.set(45, 0, 10)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(mountedCiv.group.position.toArray()).toEqual([-2, 1, -8])
    expect(horse.group.position.toArray()).toEqual([-2, 1, -8])
    expect(footCiv.group.position.toArray()).toEqual([0, 1, -8])
    expect(merchant.group.position.toArray()).toEqual([merchantPostX, 1, -8])
    expect(mountedCiv.formationCommandId).toBe(-4802)
    expect(mountedCiv.formationTarget?.toArray()).toEqual([-2, 1, -8])
    expect(footCiv.formationCommandId).toBe(-4803)
    expect(footCiv.formationTarget?.toArray()).toEqual([0, 1, -8])

    const civilianCommand = new CivilianCommandSquadController(
      civilianIds.map(id => ({
        spec: residentSpec(id, id === 'merchant' ? 'merchant' : 'civilian'), npc: asNpc(h.residents.get(id)!),
        ...(id === civilianIds[0] ? { homeMount: asMount(horse) } : {}),
      })),
      () => asPlayer(h.player), () => profile, next => { profile = next; return true },
      { sceneKey: 'town:roman', townFaction: 'roman' },
    )
    expect(civilianCommand.restore()).toBe(true)
    expect(mountedCiv.group.position.toArray()).toEqual([-2, 1, -8])
    expect(horse.group.position.toArray()).toEqual([-2, 1, -8])
    expect(footCiv.group.position.toArray()).toEqual([0, 1, -8])
    expect(merchant.group.position.toArray()).toEqual([merchantPostX, 1, -8])
    expect(profile.civilianCommandSquad?.missionId).toBe(active.id)
    expect(profile.civilianCommandSquad?.owners[civilianIds[0]]).toBe('evacuation')
    expect(profile.civilianCommandSquad?.owners.merchant).toBe('evacuation')
    expect(profile.civilianCommandSquad?.members[civilianIds[0]].position).toMatchObject({ x: -2, y: 1, z: -8 })
  })

  it('keeps civilians at Town Center refuge posts on restore when pre-restart commit already stamped missionId before initial deployment completes', () => {
    let profile = createFourGateDefenseProfile('PREPARING')
    const active = profile.activeMission!
    active.phase = 'DEPLOYING'; active.fourGateDefense!.phase = 'DEPLOYING'
    active.fourGateDefense!.deploymentComplete = false
    const civilianIds = active.civilianActorIds!
    for (const id of civilianIds) delete active.fourGateDefense!.actors[id]
    profile.civilianCommandSquad = {
      type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      missionId: active.id,
      actorIds: [...civilianIds],
      owners: Object.fromEntries(civilianIds.map(id => [id, 'evacuation' as const])),
      members: Object.fromEntries(civilianIds.map(id => [id, {
        status: 'deployed' as const, hp: 100, order: 'attack' as const,
        position: { x: 40, y: 0, z: 12, yaw: 0 },
        ...(id === civilianIds[0] ? { mount: { hp: 100, mounted: true, position: { x: 40, y: 0, z: 12, yaw: 0 } } } : {}),
      }])),
    }
    const h = fourGateDefenseRuntime(profile, next => { profile = next; return true }, {
      civilianRefuge: count => Array.from({ length: count }, (_, index) => ({ x: -2 + index * 2, y: 1, z: -8, yaw: Math.PI })),
    })
    onTestFinished(() => h.controller.dispose())
    const mountedCiv = h.residents.get(civilianIds[0])!, footCiv = h.residents.get(civilianIds[1])!
    const horse = new MountDouble('horse', 40, 12)
    mountedCiv.mountVehicle(horse); mountedCiv.group.position.set(40, 0, 12)
    footCiv.group.position.set(40, 0, 12)
    expect(h.controller.startActiveMission()).toBe(true)

    const controller = () => new CivilianCommandSquadController(
      civilianIds.map(id => ({
        spec: residentSpec(id, 'civilian'), npc: asNpc(h.residents.get(id)!),
        ...(id === civilianIds[0] ? { homeMount: asMount(horse) } : {}),
      })),
      () => asPlayer(h.player), () => profile, next => { profile = next; return true },
      { sceneKey: 'town:roman', townFaction: 'roman' },
    )
    const initialRestore = controller()
    expect(initialRestore.restore()).toBe(true)
    expect(mountedCiv.group.position.toArray()).toEqual([-2, 1, -8])
    expect(horse.group.position.toArray()).toEqual([-2, 1, -8])
    expect(footCiv.group.position.toArray()).toEqual([0, 1, -8])
    expect(initialRestore.checkpoint()?.members[civilianIds[0]].position).toMatchObject({ x: -2, y: 1, z: -8 })

    active.fourGateDefense!.deploymentComplete = true
    expect(controller().restore()).toBe(true)
    expect(mountedCiv.group.position.toArray()).toEqual([40, 0, 12])
    expect(horse.group.position.toArray()).toEqual([40, 0, 12])
    expect(footCiv.group.position.toArray()).toEqual([40, 0, 12])
  })

  it('does not carry prior Town soldier, civilian, or merchant deaths into a fresh four-gate entry while preserving mid-mission reload deaths', () => {
    let profile = createFourGateDefenseProfile('PREPARING')
    const active = profile.activeMission!
    active.deadFriendlyActorIds = ['melee_infantry-0']
    active.deadCivilianActorIds = ['civilian-0']
    freshCommanderFourGateDefenseEntry(active)
    expect(active.deadFriendlyActorIds).toBeUndefined()
    expect(active.deadCivilianActorIds).toBeUndefined()

    active.phase = 'DEPLOYING'
    active.fourGateDefense!.phase = 'DEPLOYING'
    active.fourGateDefense!.deploymentComplete = false
    const [civId, merchantId] = active.civilianActorIds!
    const soldierId = active.friendlyActorIds[0]
    const civ = new ActorDouble(civId, { faction: Faction.TOWN, townCategory: 'civilian', x: -2, y: 1, z: -8 })
    const merchant = Object.assign(
      new ActorDouble(merchantId, { faction: Faction.TOWN, townCategory: 'civilian', x: 0, y: 1, z: -8 }),
      { disarmTownCivilian() { this.armedWith = undefined }, setTownPeaceful() {} },
    )
    const soldier = new ActorDouble(soldierId, { faction: Faction.TOWN, x: 4, y: 1, z: -80 })
    const player = new PlayerDouble()

    profile.civilianCommandSquad = {
      type: 'civilian-command', squadId: 'civilians', townFaction: 'roman', sceneKey: 'town:roman',
      actorIds: [civId, merchantId],
      owners: { [civId]: 'daily', [merchantId]: 'daily' },
      members: {
        [civId]: { status: 'dead', hp: 0, order: 'defend', position: { x: 60, y: 0, z: 20, yaw: 0 } },
        [merchantId]: { status: 'dead', hp: 0, order: 'defend', position: { x: 62, y: 0, z: 20, yaw: 0 } },
      },
    }
    profile.townCommandSquad = {
      type: 'town-command', squadId: 1, townFaction: 'roman', sceneKey: 'town-home', commandRank: 'commander',
      state: 'TRAINING', authorized: false, actorIds: [soldierId],
      contribution: structuredClone(active.officialSquad!.contribution),
      members: {
        [soldierId]: { status: 'dead', hp: 0, ammo: 0, shieldImpact: 0, order: 'defend', position: { x: 20, y: 0, z: 10, yaw: 0 } },
      },
    }

    const townCommand = new TownCommandSquadController(
      [{ spec: residentSpec(soldierId, 'melee_infantry'), npc: asNpc(soldier) }],
      () => asPlayer(player), () => profile, next => { profile = next; return true },
      { sceneKey: 'town-home' },
    )
    expect(townCommand.restore()).toBe(true)
    expect(townCommand.hasCheckpoint).toBe(true)
    expect(soldier.dead).toBe(false)
    expect(soldier.hp).toBe(100)

    const createCivCommand = () => new CivilianCommandSquadController(
      [
        { spec: residentSpec(civId, 'civilian'), npc: asNpc(civ) },
        { spec: residentSpec(merchantId, 'merchant'), npc: asNpc(merchant) },
      ],
      () => asPlayer(player), () => profile, next => { profile = next; return true },
      { sceneKey: 'town:roman', townFaction: 'roman' },
    )
    const freshCiv = createCivCommand()
    expect(freshCiv.restore()).toBe(true)
    expect(civ.dead).toBe(false)
    expect(civ.hp).toBe(100)
    expect(merchant.dead).toBe(false)
    expect(merchant.hp).toBe(100)
    expect(freshCiv.checkpoint()?.members[civId].status).toBe('deployed')
    expect(freshCiv.checkpoint()?.members[merchantId].status).toBe('deployed')

    // Mid-mission reload (same missionId + deploymentComplete) must still restore mid-mission civilian casualties.
    profile.activeMission!.fourGateDefense!.deploymentComplete = true
    profile.civilianCommandSquad!.members[civId] = {
      status: 'dead', hp: 0, order: 'defend', position: { x: -2, y: 1, z: -8, yaw: 0 },
    }
    expect(createCivCommand().restore()).toBe(true)
    expect(civ.dead).toBe(true)
    expect(civ.hp).toBe(0)
  })

  it('accepts legacy 20-civilian four-gate saves without merchant while still rejecting tampered civilian rosters', () => {
    const legacy = createFourGateDefenseProfile('ATTACKING')
    const active = legacy.activeMission!
    active.civilianActorIds = active.civilianActorIds!.filter(id => id !== 'merchant')
    delete active.fourGateDefense!.actors.merchant

    const parsed = parseCareerProfile(JSON.parse(JSON.stringify(legacy)))
    expect(parsed).not.toBeNull()
    expect(parsed!.activeMission!.civilianActorIds).toHaveLength(20)
    expect(parsed!.activeMission!.civilianActorIds).not.toContain('merchant')

    const missing = structuredClone(legacy)
    missing.activeMission!.civilianActorIds = missing.activeMission!.civilianActorIds!.filter(id => id !== 'civilian-0')
    expect(parseCareerProfile(JSON.parse(JSON.stringify(missing)))).toBeNull()

    const unknown = structuredClone(legacy)
    unknown.activeMission!.civilianActorIds = unknown.activeMission!.civilianActorIds!.map(id => id === 'civilian-0' ? 'unknown' : id)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(unknown)))).toBeNull()
  })
})
