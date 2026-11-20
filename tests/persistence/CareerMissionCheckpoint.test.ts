import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CareerMissionCheckpoint } from '../../src/career/CareerMissionCheckpoint'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { createFourGateDefenseProfile } from '../helpers/commanderFourGateDefenseFixture'
import { CommanderTownMissionController } from '../../src/career/CommanderTownMissionController'
import { acceptCommanderMission, COMMANDER_DECAPITATION_ID } from '../../src/career/CommanderMissionCatalog'
import { COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS as survivalSeconds } from '../../src/career/CommanderFourGateDefenseState'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { Faction } from '../../src/world/NPC'
import { ActorDouble, asNpc, asPlayer, PlayerDouble, recordingActorFactory, residentSpec } from '../helpers/careerActorDoubles'
import { fourGateDefenseRuntime } from '../helpers/fourGateDefenseRuntime'
import { commanderCavalryEscortAssignments } from '../../src/career/CommanderCavalryEscort'
import { SpatialGrid } from '../../src/world/SpatialGrid'
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

  /** Native deployment saved through a storage boundary that can fail writes or reject the first attack commit. */
  function spawningRuntime(phase: 'PREPARING' | 'SPAWNING', preparationSeconds = 0) {
    const initial = createFourGateDefenseProfile(phase)
    initial.activeMission!.fourGateDefense!.preparationRemainingSeconds = preparationSeconds
    const storage = new MemoryStorage(), gate = { rejectAttack: false }
    const h = fourGateDefenseRuntime(initial, next => {
      if (gate.rejectAttack && next.activeMission!.phase === 'ATTACKING') return false
      try { storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next)) } catch { return false }
      return true
    })
    onTestFinished(() => h.controller.dispose())
    expect(h.controller.startActiveMission()).toBe(true)
    h.controller.completeInitialDeployment()
    const durable = () => (JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!) as CareerProfile).activeMission!.fourGateDefense!
    return { ...h, storage, gate, durable }
  }

  it('saves spawning intent before enqueueing and keeps a partial attacker batch out of the checkpoint', () => {
    const h = spawningRuntime('PREPARING', .25), controller = h.controller
    const deployed = h.storage.getItem(CAREER_STORAGE_KEY)
    h.storage.failWrites = true
    controller.updateFlow(.25, 0)
    expect(h.factory.actors.size).toBe(0)
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(deployed)
    expect(h.profile().activeMission!.phase).toBe('PREPARING')
    expect(controller.preparationRemaining).toBe(0)
    h.storage.failWrites = false
    controller.updateFlow(0, 0)
    const spawning = h.durable()
    expect(spawning).toMatchObject({ phase: 'SPAWNING', preparationRemainingSeconds: 0,
      deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [] })
    expect(spawning.siege).toBeUndefined()
    // Partial scheduler work is transient: the periodic checkpoint keeps only the durable arrival intent.
    h.materialize(40)
    expect(h.factory.actors.size).toBe(40)
    controller.updateFlow(5, 0)
    const partial = h.durable()
    expect(partial.phase).toBe('SPAWNING')
    expect([...h.factory.actors.keys()].filter(id => partial.actors[id])).toEqual([])
    expect(partial.registeredTargetActorIds).toEqual([])
    expect(controller.combatEnabled).toBe(false)
  })

  it('publishes the first attack and each escort release only after their saves, with current actor intent in both checkpoints', () => {
    // Reloaded after the arrival intent was saved: attackers are queued again on start.
    const h = spawningRuntime('SPAWNING'), controller = h.controller
    h.materialize()
    const archerId = 'four-gate-save:east:archer:t3:1', lancerId = 'four-gate-save:east:lancer:t3:1'
    const archer = h.factory.actors.get(archerId)!
    h.gate.rejectAttack = true
    controller.updateFlow(0, 0)
    expect(h.profile().activeMission!.phase).toBe('SPAWNING')
    expect(controller.combatEnabled).toBe(false)
    expect(archer.tacticalOrder).toBe('defend')
    h.gate.rejectAttack = false
    controller.updateFlow(8, 0)
    expect(controller.combatEnabled).toBe(true)
    expect(archer.tacticalOrder).toBe('attack')
    // Durable bytes of the retried start carry the fresh intent in both actor owners; escorts stay held.
    const started = h.durable()
    expect(started).toMatchObject({ phase: 'ATTACKING', attackStarted: true, preparationRemainingSeconds: 0, combatElapsedSeconds: 0 })
    expect(started.registeredTargetActorIds).toHaveLength(280)
    expect([started.actors[archerId].order, started.siege!.actors[archerId].order]).toEqual(['attack', 'attack'])
    expect([started.actors[lancerId].order, started.siege!.actors[lancerId].order]).toEqual(['defend', 'defend'])
    // Loading time cannot be earned; only released combat time counts.
    controller.setPreparationElapsed(0)
    controller.updateFlow(20, 0)
    expect(controller.survivalRemaining).toBe(survivalSeconds)
    controller.setPreparationElapsed(survivalSeconds)
    controller.updateFlow(.05, 0)
    expect(controller.survivalRemaining).toBe(0)
    // The live frame's snapshot, not a caller-supplied result, owns the saved survival receipt.
    expect(h.profile().activeMission!.fourGateDefense!.victoryReason).toBe('survival')

    // An escort release is a one-shot receipt in the same checkpoint: a refused save keeps the
    // escort holding, and the retried frame releases the group once.
    const rampId = 'town-siege-ramp:north:left', ramp = h.ramps.get(rampId)!
    const group = commanderCavalryEscortAssignments(h.profile().activeMission!.id).filter(a => a.rampId === rampId).map(a => a.actorId)
    const escort = h.factory.actors.get(group[0])!
    for (const id of ramp.assignment.pusherIds) h.factory.actors.get(id)!.hp = 0 // Its carrier is abandoned.
    const frame = () => { controller.updateFlow(.1, 0); controller.updateSiege(.1, new SpatialGrid<NPC>()) }
    h.gate.rejectAttack = true
    frame()
    expect(escort.tacticalOrder).not.toBe('charge')
    expect(controller.isEscorting(asNpc(escort))).toBe(true)
    const committed = () => h.profile().activeMission!.fourGateDefense!
    expect(committed().cavalryEscort!.groups[rampId].releaseReason).toBeUndefined()
    h.gate.rejectAttack = false
    frame()
    const released = committed()
    expect(released.cavalryEscort!.groups[rampId].releaseReason).toBe('ramp-abandoned')
    expect(group.map(id => [released.actors[id].order, released.siege!.actors[id]?.order ?? 'charge'])).toEqual(group.map(() => ['charge', 'charge']))
    expect([escort.tacticalOrder, escort.missionCombatTarget, escort.missionMovement]).toEqual(['charge', undefined, false])
    escort.setTacticalOrder('defend')
    frame()
    expect(escort.tacticalOrder).toBe('defend') // Delivered once: a later frame never re-releases the group.
  })
})
