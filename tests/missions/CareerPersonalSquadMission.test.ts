import { followLocalOffset } from '../../src/battle/FollowOrder'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { completeNpcDeployment, gameplayNpcSpawnDriver, NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERSONAL_SQUAD_ID, squadCommandTarget } from '../../src/battle/CommandTarget'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { DefenseCampaignRuntime } from '../../src/campaign/DefenseCampaignRuntime'
import { createDefenseCampaignWaveConfig } from '../../src/campaign/DefenseCampaignLaunch'
import { applyCampaignBreachOrders } from '../../src/campaign/CampaignGate'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventStream, createNpcCombatActorRef, type CombatActorRef } from '../../src/combat/CombatAttribution'
import { careerMissionCommandMeritPolicy, createActiveCareerMission, createTownDefenseMission } from '../../src/career/CareerMissionState'
import { snapshotPersonalMission, clonePersonalMission, personalMissionSourcePolicy } from '../../src/career/CareerPersonalSquadMission'
import { PersonalSquadRuntime, type spawnPersonalSquadActor } from '../../src/career/PersonalSquadRuntime'
import { claimCareerMission, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptCareerOutpost, acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCaptainPatrolCommandMission } from '../../src/career/CaptainMissionCatalog'
import { TownScene } from '../../src/town/TownScene'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { acceptVeteranMission } from '../../src/career/VeteranMission'
import { acceptEnemyTownAssault } from '../../src/career/EnemyTownAssault'
import { acceptCavalrySweep } from '../../src/career/CavalrySweep'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import type { Player } from '../../src/player/Player'
import { Faction, type NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'

function owned(count = 3): CareerProfile {
  return { ...createCareerProfile('roman'), rank: 'captain', totalMerit: 6000, availableMerit: 6000,
    personalSquad: { members: Array.from({ length: count }, (_, i) => ({ id: `personal:test-${i}`,
      type: (['soldier', 'captain', 'ranger'] as const)[i % 3] })) } }
}

function runtimeHarness(sceneKey = 'town-home', hasHR = true, scheduler?: NpcSpawnScheduler, count = 3) {
  const profile = owned(count), scene = new THREE.Scene()
  const player = { group: new THREE.Group(), dead: false, get combatPosition() { return this.group.position } } as Player
  const spawn: typeof spawnPersonalSquadActor = vi.fn((_scene, member, _faction, slot) => {
    const group = new THREE.Group(); group.position.set(slot.x, 0, slot.z); group.rotation.y = slot.yaw
    const mount = member.type === 'soldier' ? undefined : {
      group: group.clone(), currentHp: 100, maxHp: 100, disposed: false,
      get dead() { return this.currentHp === 0 }, takeDamage(amount: number) { this.currentHp = Math.max(0, this.currentHp - amount) },
      restoreForTown() { this.currentHp = 100 },
      dispose: vi.fn(),
    }
    const npc = {
      combatantId: member.id, squadId: PERSONAL_SQUAD_ID, combatOwnership: 'player-personal',
      faction: Faction.PLAYER, characterFaction: 'roman', group, hp: 100, maxHp: 100, combatAmmo: 30, combatAmmoCapacity: 30,
      shield: { shieldImpactRemaining: 100, shieldImpactMax: 100 }, mount: mount ?? null,
      tacticalOrder: 'attack', activeFollowTarget: null, formation: undefined as any,
      get dead() { return this.hp === 0 }, get combatPosition() { return this.mount?.group.position ?? group.position },
      get isMounted() { return Boolean(this.mount && !this.mount.dead) },
      get formationCommandId() { return this.formation?.commandId ?? null },
      get combatFormationCheckpoint() { return this.formation },
      restoreCombatHealth(hp: number) { this.hp = Math.max(0, Math.min(100, hp)) },
      restoreCombatAmmo(ammo: number) { this.combatAmmo = ammo },
      refitCombat() { this.hp = 100; this.combatAmmo = 30; this.shield.shieldImpactRemaining = 100 },
      mountVehicle(value: NonNullable<typeof mount>) { this.mount = value },
      setTacticalOrder(order: string) { this.tacticalOrder = order; this.formation = undefined; this.activeFollowTarget = null },
      assignFollowTarget(target: any) { this.setTacticalOrder('follow'); this.activeFollowTarget = target },
      assignFormationTarget(commandId: number, point: THREE.Vector3, facing: THREE.Vector3, speedLimit?: number, arrivalOrder?: string, reached = false) {
        this.setTacticalOrder(arrivalOrder ?? 'formation')
        this.formation = { commandId, position: { x: point.x, z: point.z, yaw: Math.atan2(facing.x, facing.z) }, reached, speedLimit, arrivalOrder }
      },
      isFormationTargetReached() { return this.formation?.reached ?? false },
      dismountFromMount() { this.mount = null }, dispose: vi.fn(),
    }
    return { npc: npc as unknown as NPC, mount: mount as unknown as Mount | undefined }
  })
  const slots = profile.personalSquad!.members.map((_member, i) => ({ x: i * 6, z: -20, yaw: 0 }))
  const runtime = new PersonalSquadRuntime(scene, slots, () => profile, () => player, spawn, { sceneKey, hasHR, scheduler })
  const accept = () => {
    const mission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'personal-mission')
    mission.personalSquad = runtime.captureForMission(snapshotPersonalMission(profile)!)
    profile.activeMission = mission; runtime.bindMission(mission.personalSquad)
    return mission
  }
  return { runtime, profile, player, spawn, slots, accept,
    restore: (key = sceneKey, hr = hasHR) => new PersonalSquadRuntime(scene, slots, () => profile, () => player, spawn, { sceneKey: key, hasHR: hr, scheduler }) }
}

describe('Fresh Career acceptance versus same-mission reload', () => {
  const runtimes: PersonalSquadRuntime[] = []
  afterEach(() => { runtimes.splice(0).reverse().forEach(runtime => runtime.cleanup()) })

  function acceptanceHarness() {
    // Three recording actors at most; no real NPC, Mount, TownWorld or official armies.
    const driver = new NpcSpawnTestDriver(), scheduler = driver.scheduler, h = runtimeHarness('town-home', true, scheduler)
    h.profile.personalSquad!.members[0].type = 'captain'
    h.profile.completedOutpostStages = [1, 2, 3]
    h.profile.ownedMounts = ['horse']; h.profile.selectedMountId = 'horse'
    const values = new Map<string, string>()
    let failSave = false
    const store = new CareerProfileStore({ getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (failSave) throw new Error('storage full'); values.set(key, value) },
      get length() { return values.size }, key: index => [...values.keys()][index] ?? null,
      clear: () => values.clear(), removeItem: key => { values.delete(key) },
    })
    // Narrow seam for the private production commit entry; all transition logic is real.
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile: h.profile, personalSquad: h.runtime, player: h.player, world: { faction: 'roman' },
      skills: { skillState: h.profile.skills }, store, careerSkillSaveTimer: null,
    }) as { profile: CareerProfile; commit(next: CareerProfile): boolean }
    runtimes.push(h.runtime)
    const restore = (saved: ReturnType<typeof snapshotPersonalMission>, key = 'outpost:new', hasHR = false) => {
      const runtime = h.restore(key, hasHR); runtimes.push(runtime)
      driver.complete(() => { runtime.restoreMission(saved); runtime.restoreMission(saved) })
      return runtime
    }
    return { ...h, scheduler, driver, store, town, restore, failSave: (value: boolean) => { failSave = value } }
  }

  const acceptances: [string, (profile: CareerProfile) => CareerProfile | null][] = [
    ...([1, 2, 3] as const).map(stage => [`Outpost Duty ${stage}`, (profile: CareerProfile) => acceptCareerOutpost(profile, stage, `outpost-${stage}`)] as [string, (profile: CareerProfile) => CareerProfile | null]),
    ['Outpost Relief', profile => acceptCareerOutpostRelief(profile, 'relief')],
    ['Veteran field', profile => acceptVeteranMission(profile, 'veteran-dread-outpost', { missionId: 'veteran' })],
    ['Captain patrol', profile => ({ ...profile, activeMission: createCaptainPatrolCommandMission(profile, ['patrol-1'], 'captain') })],
  ]

  it.each(acceptances)('%s deploys returned, returning and reserve members with only returned members refitted', (_name, accept) => {
    const h = acceptanceHarness(), saved = snapshotPersonalMission(h.profile)!
    saved.state = 'RETURNING'
    saved.members['personal:test-0'] = { status: 'exited', hp: 9, ammo: 1, shieldImpact: 2,
      mount: { hp: 0, mounted: false, position: { x: 900, z: 900, yaw: 1 } } }
    saved.members['personal:test-1'] = { status: 'deployed', hp: 40, ammo: 5, shieldImpact: 6,
      position: { x: 800, z: 800, yaw: 1 }, order: 'formation',
      formation: { commandId: -1001, position: h.slots[1], reached: false },
      mount: { hp: 30, mounted: false, position: { x: 800, z: 800, yaw: 1 } } }
    h.runtime.restoreMission(saved); h.driver.advanceFrame()
    const returning = h.runtime.actors[0], before = h.runtime.checkpoint()!
    const next = accept(h.profile)!
    expect(next).not.toBeNull(); expect(h.town.commit(next)).toBe(true)
    const accepted = h.store.load()!
    const roster = (accepted.activeMission ?? accepted.activeOutpostMission)!.personalSquad!
    expect(roster.memberIds).toEqual(['personal:test-0', 'personal:test-1', 'personal:test-2'])
    expect(roster.members['personal:test-0']).toEqual({ status: 'reserve' })
    expect(roster.members['personal:test-1']).toMatchObject({ status: 'deployed', hp: 40, ammo: 5, shieldImpact: 6, mount: { hp: 30, mounted: false } })
    expect(roster.state).not.toBe('RETURNING')
    expect(roster.members['personal:test-1'].formation).toBeUndefined()
    expect(returning.tacticalOrder).toBe('defend'); expect(returning.formationCommandId).toBeNull()
    expect(returning.hp).toBe(before.members['personal:test-1'].hp)
    h.runtime.cleanup()
    h.profile.personalSquad!.members.push({ id: 'personal:later', type: 'soldier' })
    const field = h.restore(roster)
    expect(field.actors.map(actor => actor.combatantId)).toEqual(['personal:test-0', 'personal:test-1', 'personal:test-2'])
    expect(new Set(field.actors.map(actor => actor.combatantId)).size).toBe(3)
    expect(field.actors.map(actor => actor.hp)).toEqual([100, 40, 100])
    expect(field.actors.map(actor => actor.combatAmmo)).toEqual([30, 5, 30])
    expect(field.actors.map(actor => actor.shield.shieldImpactRemaining)).toEqual([100, 6, 100])
    expect(field.mounts.map(mount => mount.currentHp)).toEqual([100, 30, 100])
    expect(field.actors[0].isMounted).toBe(true); expect(field.actors[1].isMounted).toBe(false)
    expect(field.actors.every(actor => actor.tacticalOrder === 'defend' && actor.formationCommandId === null)).toBe(true)
    expect(h.spawn).toHaveBeenCalledTimes(4)
    for (const actor of field.actors) expect(actor.combatPosition.z).toBe(-20)
  })

  it('reloads dead, exited and wounded deployed members without reviving or adding hires', () => {
    const h = acceptanceHarness(), next = acceptCareerOutpost(h.profile, 1, 'same')!
    const roster = next.activeOutpostMission!.personalSquad!
    roster.sceneKey = 'outpost:new'; roster.state = 'ACTIVE'
    roster.members['personal:test-0'] = { status: 'dead', hp: 0 }
    roster.members['personal:test-1'] = { status: 'exited', hp: 12 }
    roster.members['personal:test-2'] = { status: 'deployed', hp: 40, ammo: 5, shieldImpact: 6,
      position: { x: 50, z: 60, yaw: .5 }, mount: { hp: 30, mounted: true, position: { x: 50, z: 60, yaw: .5 } } }
    expect(h.store.save(next)).toBe(true)
    const parsed = h.store.load()!.activeOutpostMission!.personalSquad!
    h.profile.personalSquad!.members.push({ id: 'personal:later', type: 'soldier' })
    const field = h.restore(parsed)
    expect(field.actors.map(actor => actor.combatantId)).toEqual(['personal:test-2'])
    expect(field.checkpoint()!.members['personal:test-0']).toEqual({ status: 'dead', hp: 0 })
    expect(field.checkpoint()!.members['personal:test-1']).toEqual({ status: 'exited', hp: 12 })
    expect(field.actors[0]).toMatchObject({ hp: 40, combatAmmo: 5, shield: { shieldImpactRemaining: 6 } })
    expect(field.mounts[0].currentHp).toBe(30)
    expect(field.actors[0].combatPosition).toMatchObject({ x: 50, z: 60 })
    expect(h.spawn).toHaveBeenCalledOnce()
  })

  it('failed acceptance preserves Town return orders, checkpoints and pending jobs for retry', () => {
    const h = acceptanceHarness()
    h.runtime.follow(); h.driver.advanceFrame()
    h.runtime.actors[0].restoreCombatHealth(40)
    h.runtime.dismiss()
    const before = h.runtime.checkpoint()!, next = acceptCareerOutpost(h.profile, 1, 'retry')!
    h.failSave(true)
    expect(h.town.commit(next)).toBe(false)
    expect(h.town.profile).toBe(h.profile); expect(h.store.load()).toBeNull()
    expect(h.runtime.checkpoint()).toEqual(before)
    expect(h.runtime.actors[0].formationCommandId).toBe(-1001)
    expect(h.runtime.state).toBe('RETURNING'); expect(h.scheduler.pending).toBe(0)
    h.failSave(false)
    expect(h.town.commit(next)).toBe(true)
    expect(h.runtime.state).not.toBe('RETURNING')
    h.runtime.updateLifecycle()
    expect(h.runtime.actors).toHaveLength(1); expect(h.runtime.actors[0].hp).toBe(40)
    h.runtime.cleanup()
    const field = h.restore(h.store.load()!.activeOutpostMission!.personalSquad)
    expect(field.actors).toHaveLength(3); expect(field.actors[0].hp).toBe(40)
    expect(new Set(field.actors.map(actor => actor.combatantId)).size).toBe(3)
  })

  it('refits a ground arrival waiting for the last returning member only after acceptance saves', () => {
    const h = acceptanceHarness()
    h.driver.complete(() => h.runtime.follow())
    const [arrived, returning] = h.runtime.actors
    for (const actor of [arrived, returning]) {
      actor.restoreCombatHealth(40); actor.restoreCombatAmmo(5); actor.shield.shieldImpactRemaining = 6
    }
    arrived.mount!.takeDamage(999); arrived.dismountFromMount()
    h.runtime.dismiss()
    // Recording movement boundary reports one completed HR target; no locomotion claim.
    arrived.assignFormationTarget(-1001, new THREE.Vector3(h.slots[0].x, 0, h.slots[0].z), new THREE.Vector3(0, 0, 1), undefined, undefined, true)
    h.runtime.updateLifecycle()
    const before = h.runtime.checkpoint()!, next = acceptCareerOutpost(h.profile, 1, 'ground-arrival')!
    h.failSave(true)
    expect(h.town.commit(next)).toBe(false)
    expect(h.runtime.checkpoint()).toEqual(before); expect(h.runtime.mounts[0].dead).toBe(true)
    h.failSave(false)
    expect(h.town.commit(next)).toBe(true)
    expect(arrived).toMatchObject({ hp: 100, combatAmmo: 30, shield: { shieldImpactRemaining: 100 } })
    expect(h.runtime.mounts[0].currentHp).toBe(100); expect(arrived.isMounted).toBe(true)
    expect(returning.hp).toBe(40)
    const saved = h.store.load()!.activeOutpostMission!.personalSquad!
    expect(saved.members['personal:test-0']).toEqual({ status: 'reserve' })
    expect(saved.members['personal:test-1'].hp).toBe(40)
  })

  it('keeps casualties and queued IDs across fresh save/reload, cancelling the previous owner without duplicate jobs', () => {
    const h = acceptanceHarness()
    h.runtime.follow(); h.driver.advanceFrame()
    h.runtime.actors[0].restoreCombatHealth(0)
    h.runtime.resumeCommand('follow')
    const before = h.runtime.checkpoint()!, next = acceptCareerOutpost(h.profile, 1, 'queued')!
    h.failSave(true)
    expect(h.town.commit(next)).toBe(false)
    expect(h.runtime.checkpoint()).toEqual(before); expect(h.scheduler.pending).toBe(2)
    h.failSave(false)
    expect(h.town.commit(next)).toBe(true)
    const saved = h.store.load()!.activeOutpostMission!.personalSquad!
    expect(saved.pendingMemberIds).toEqual(['personal:test-1', 'personal:test-2'])
    expect(saved.members['personal:test-0']).toMatchObject({ status: 'dead', hp: 0 })
    h.driver.advanceFrame()
    expect(h.runtime.actors[1].tacticalOrder).toBe('defend')
    expect(h.runtime.actors[1].activeFollowTarget).toBeNull()
    h.runtime.cleanup(); expect(h.scheduler.pending).toBe(0)
    const field = h.restore(saved)
    expect(field.actors.map(actor => actor.combatantId)).toEqual(['personal:test-1', 'personal:test-2'])
    expect(field.hudPendingIds).toEqual([])
    expect(h.spawn).toHaveBeenCalledTimes(4)
    expect(h.scheduler.pending).toBe(0)
  })
})

describe('Career personal mission membership and authority', () => {
  it('freezes accepted IDs, preserves legacy empty rosters, and never includes a later hire', () => {
    const profile = owned(30), accepted = acceptCareerOutpost(profile, 1, 'outpost')!
    expect(accepted.activeOutpostMission!.personalSquad!.memberIds).toHaveLength(30)
    expect(new Set(accepted.activeOutpostMission!.personalSquad!.memberIds).size).toBe(30)
    profile.personalSquad!.members[0].id = 'personal:later'
    expect(accepted.activeOutpostMission!.personalSquad!.memberIds).not.toContain('personal:later')
    const legacy = owned(); legacy.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    expect(parseCareerProfile(legacy)?.activeMission?.personalSquad).toBeUndefined()
    const h = runtimeHarness(); h.profile.activeMission = legacy.activeMission
    expect(completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)).toBe(false); expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each([1, 2, 3] as const)('keeps Outpost %s official/enemy/reinforcement counts identical with zero or thirty private members', stage => {
    const noPrivate = owned(0), thirty = owned(30)
    for (const profile of [noPrivate, thirty]) profile.completedOutpostStages = [1, 2]
    const a = createCareerOutpostLaunch(acceptCareerOutpost(noPrivate, stage, 'a')!)
    const b = createCareerOutpostLaunch(acceptCareerOutpost(thirty, stage, 'b')!)
    for (const wave of ['defenders', 'attackers', 'reinforcement'] as const) {
      const counts = (launch: typeof a) => BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, wave)).npcSpecs
        .map(spec => [spec.presetId, spec.tier, spec.squadId, spec.faction])
      expect(counts(b)).toEqual(counts(a))
    }
    expect(b.capabilities!.playerCommandsEnabled).toBe(false)
    expect(b.careerPersonalSquad!.squadId).toBe('personal')
  })

  it('keeps Veteran official IDs disjoint from the additional private roster', () => {
    const a = acceptVeteranMission(owned(0), 'veteran-dread-outpost', { missionId: 'same' })!
    const b = acceptVeteranMission(owned(30), 'veteran-dread-outpost', { missionId: 'same' })!
    expect(b.activeMission!.targetActorIds).toEqual(a.activeMission!.targetActorIds)
    expect(b.activeMission!.friendlyActorIds).toEqual(a.activeMission!.friendlyActorIds)
    expect(b.activeMission!.reinforcementActorIds).toEqual(a.activeMission!.reinforcementActorIds)
    expect(b.activeMission!.personalSquad!.memberIds.every(id => !b.activeMission!.friendlyActorIds.includes(id))).toBe(true)
    expect(squadCommandTarget('personal')).not.toBe(squadCommandTarget(8))
  })
  it.each(['sweep', 'siege'] as const)('keeps %s official, borrowed and target rosters unchanged with thirty private members', kind => {
    const accept = (count: number) => {
      const profile = owned(count); profile.ownedMounts = ['horse']; profile.selectedMountId = 'horse'; profile.completedOutpostRelief = true
      return kind === 'sweep' ? acceptCavalrySweep(profile, 'same', ['captain', 'patrol-1']) : acceptEnemyTownAssault(profile, 'same')
    }
    const a = accept(0)!, b = accept(30)!
    expect(a).not.toBeNull(); expect(b).not.toBeNull()
    expect(b.activeMission!.friendlyActorIds).toEqual(a.activeMission!.friendlyActorIds)
    expect(b.activeMission!.targetActorIds).toEqual(a.activeMission!.targetActorIds)
    expect(b.activeMission!.borrowedActorIds).toEqual(a.activeMission!.borrowedActorIds)
    expect(b.activeMission!.friendlyActorIds).toHaveLength(kind === 'siege' ? 119 : 59)
    expect(b.activeMission!.personalSquad!.memberIds).toHaveLength(30)
  })

  it('requires actual private identity, ownership and accepted ID, not faction or a hero alone', () => {
    const mission = { personalSquad: snapshotPersonalMission(owned()) }
    const accepts = personalMissionSourcePolicy(mission)
    const valid: CombatActorRef = { actorType: 'npc', actorId: 'personal:test-1', ownership: 'player-personal',
      allegiance: Faction.PLAYER, characterFaction: 'roman', squadId: 'personal' }
    expect(accepts(valid)).toBe(true)
    for (const source of [{ ...valid, actorId: 'personal:later' }, { ...valid, squadId: 1 as const },
      { ...valid, ownership: undefined }, { ...valid, actorType: 'player' as const }]) expect(accepts(source)).toBe(false)
  })

  it('does not let an official gate breach replace personal commands', () => {
    const personal = { dead: false, combatOwnership: 'player-personal', characterFaction: 'roman', setTacticalOrder: vi.fn() }
    applyCampaignBreachOrders([personal as unknown as NPC], 'viking')
    expect(personal.setTacticalOrder).not.toHaveBeenCalled()
  })
})

describe('Private deployment, wounds and refit lifecycle', () => {
  it('keeps the same wounded instances, command and position when accepting in Town', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)
    const [actor] = h.runtime.actors; actor.restoreCombatHealth(17); actor.restoreCombatAmmo(2)
    actor.shield.shieldImpactRemaining = 7; actor.setTacticalOrder('attack')
    const position = actor.combatPosition.clone(), mission = h.accept()
    expect(h.runtime.actors[0]).toBe(actor); expect(actor.combatPosition).toEqual(position)
    expect(mission.personalSquad!.members[actor.combatantId]).toMatchObject({ hp: 17, ammo: 2, shieldImpact: 7, order: 'attack' })
    completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); expect(h.spawn).toHaveBeenCalledTimes(3)
  })

  it('resets old-map context to Defend, while same-map reload restores command, position and lost mounts', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); h.accept()
    const [soldier, captain, ranger] = h.runtime.actors
    soldier.restoreCombatHealth(11); captain.restoreCombatHealth(22); ranger.restoreCombatAmmo(1)
    captain.mount!.takeDamage(999); captain.dismountFromMount()
    soldier.assignFormationTarget(-55, new THREE.Vector3(3, 0, 9), new THREE.Vector3(1, 0, 0))
    const saved = h.runtime.checkpoint()!, copy = clonePersonalMission(saved)
    const reload = h.restore(); completeNpcDeployment(() => reload.restoreMission(saved), gameplayNpcSpawnDriver)
    expect(reload.actors[0]).toMatchObject({ hp: 11, tacticalOrder: 'formation', formationCommandId: -55 })
    expect(reload.actors[0].combatPosition).toEqual(soldier.combatPosition)
    expect(reload.actors[1].mount).toBeNull(); expect(reload.mounts[0].dead).toBe(true)
    const outpost = h.restore('outpost:new', false); completeNpcDeployment(() => outpost.restoreMission(copy), gameplayNpcSpawnDriver)
    expect(outpost.actors.every(actor => actor.tacticalOrder === 'defend' && actor.formationCommandId === null)).toBe(true)
    expect(outpost.actors.map(actor => actor.hp)).toEqual([11, 22, 100])
    expect(outpost.actors[2].combatAmmo).toBe(1); expect(outpost.actors[1].mount).toBeNull()
    for (const order of ['attack', 'charge', 'defend'] as const) {
      outpost.actors[0].setTacticalOrder(order)
      expect(outpost.dismiss()).toBe(false)
      expect(outpost.actors[0].tacticalOrder).toBe(order)
    }
    reload.cleanup(); outpost.cleanup(); h.runtime.cleanup()
  })

  it('never revives dead or exited members by Follow, Dismiss, reload or a later hire', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); h.accept()
    h.runtime.actors[0].restoreCombatHealth(0)
    expect(h.runtime.aliveCombatants).toBe(2)
    h.runtime.dismiss(); expect(h.runtime.aliveCombatants).toBe(2)
    for (const actor of h.runtime.actors.slice(1)) (actor as any).formation.reached = true
    h.runtime.updateLifecycle()
    const saved = h.runtime.checkpoint()!
    expect(saved.members['personal:test-0'].status).toBe('dead')
    expect(saved.members['personal:test-1'].status).toBe('exited')
    expect(completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)).toBe(false)
    h.profile.personalSquad!.members.push({ id: 'personal:later', type: 'soldier' })
    const reloaded = h.restore(); completeNpcDeployment(() => reloaded.restoreMission(saved), gameplayNpcSpawnDriver)
    expect(reloaded.actors).toHaveLength(0); expect(completeNpcDeployment(() => reloaded.follow(), gameplayNpcSpawnDriver)).toBe(false)
    expect(h.spawn).toHaveBeenCalledTimes(3)
  })

  it('preserves slow-return wounds until explicit Dismiss reaches HR; direct return refits immediately', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); h.accept()
    const actors = [...h.runtime.actors]
    actors[0].restoreCombatHealth(0); actors[1].restoreCombatHealth(9); actors[2].restoreCombatAmmo(2)
    actors[1].shield.shieldImpactRemaining = 4; actors[1].mount!.takeDamage(999); actors[1].dismountFromMount()
    h.profile.activeMission = undefined; h.runtime.endMission(false); h.runtime.updateLifecycle()
    expect(h.runtime.actors).toEqual(actors)
    completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(actors[1].hp).toBe(9); expect(actors[2].combatAmmo).toBe(2)
    const saved = h.runtime.checkpoint()!; h.profile.personalSquadRuntime = saved
    expect(parseCareerProfile(h.profile)!.personalSquadRuntime!.members['personal:test-1']).toMatchObject({ hp: 9, mount: { hp: 0 } })
    h.runtime.dismiss()
    for (const actor of actors.slice(1)) (actor as any).formation.reached = true
    h.runtime.updateLifecycle(); expect(h.runtime.state).toBe('RESERVE')
    completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); expect(h.runtime.actors.every(actor => !actor.dead && actor.hp === 100 && actor.combatAmmo === 30)).toBe(true)
    expect(h.runtime.actors[1].mount!.currentHp).toBe(100)
    h.runtime.endMission(true); expect(h.runtime.actors).toHaveLength(0); expect(h.runtime.state).toBe('RESERVE')
    expect(h.profile.personalSquad!.members).toHaveLength(3)
  })

  it('holds Follow at the dead Player last position without acquiring an official Captain', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); h.accept()
    h.player.group.position.set(100, 0, 120); h.runtime.updateLifecycle(); h.player.dead = true
    h.runtime.updateLifecycle()
    for (const actor of h.runtime.actors) {
      expect(actor.tacticalOrder).toBe('defend'); expect(actor.activeFollowTarget).toBeNull()
      expect(Math.abs(actor.combatFormationCheckpoint!.position.x - 100)).toBeLessThan(20)
      expect(Math.abs(actor.combatFormationCheckpoint!.position.z - 120)).toBeLessThan(20)
    }
  })
  it('allows the next deployment after mission end when Dismiss already completed HR return during the mission', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); h.accept()
    h.runtime.actors[0].restoreCombatHealth(0)
    h.runtime.dismiss()
    for (const actor of h.runtime.actors.slice(1)) (actor as any).formation.reached = true
    h.runtime.updateLifecycle()
    expect(h.runtime.state).toBe('RESERVE'); expect(completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)).toBe(false)
    h.profile.activeMission = undefined; h.runtime.endMission(false)
    expect(h.runtime.checkpoint()).toBeUndefined()
    expect(completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)).toBe(true)
    expect(h.runtime.actors).toHaveLength(3)
    expect(h.runtime.actors.every(actor => !actor.dead && actor.hp === 100)).toBe(true)
  })
})

describe('Command merit without personal-stat or skill pollution', () => {
  it('keeps actual deployed and subsequently returned private members in their own starting and survivor totals', () => {
    const h = runtimeHarness(), mission = h.accept(), events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    const field = Object.assign(Object.create(TownDefenseController.prototype), { tracker }) as TownDefenseController
    completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver)
    for (const actor of h.runtime.actors) field.registerPersonalActor(actor)
    h.runtime.actors[0].restoreCombatHealth(0)
    h.runtime.dismiss()
    for (const actor of h.runtime.actors.slice(1)) (actor as any).formation.reached = true
    h.runtime.updateLifecycle(); mission.personalSquad = h.runtime.checkpoint()
    expect(tracker.snapshot([], h.player).squads).toEqual([expect.objectContaining({ squadId: 'personal', startingMembers: 3, survivors: 2, casualties: 1 })])
    tracker.dispose()
  })

  it.each(['melee', 'projectile', 'mount-impact', 'siege'] as const)('credits true private %s damage exactly once, rejects official/roaming sources and survives reload', method => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); const mission = h.accept(); mission.phase = 'ENGAGING'
    const events = new CombatEventStream()
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    const source = createNpcCombatActorRef(h.runtime.actors[1]), target = { targetId: mission.targetActorIds[0], targetType: 'npc' as const, name: 'Enemy' }
    const emit = (actor = source, targetId = target.targetId) => events.emit({ type: 'damage_applied', source: actor,
      target: { ...target, targetId }, method, requestedDamage: 100, appliedDamage: 17 })
    emit(); emit({ ...source, squadId: 1 }); emit(source, 'roaming'); emit({ ...source, ownership: undefined })
    events.emit({ type: 'actor_killed', source, target, method })
    h.runtime.actors[1].restoreCombatHealth(0); emit() // A released arrow retains its source snapshot.
    expect(tracker.checkpoint().damageDealt).toBe(0); expect(tracker.checkpoint().kills).toBe(0)
    expect(tracker.commandCheckpoint()).toMatchObject({ damageDealt: 34, kills: 1 })
    const player = { ...h.player, dead: true } as Player
    const snapshot = tracker.snapshot([], player)
    expect(snapshot.meritPlayer).toMatchObject({ damageDealt: 34, kills: 1, damageTaken: 0, survived: false })
    const claimed = claimCareerMission(h.profile, mission.id, 'victory', snapshot.player, snapshot.meritPlayer)
    expect(claimed.profile.lifetimeStats).toMatchObject({ damage: 0, kills: 0, structureDamage: 0, breaches: 0 })
    expect(claimed.profile.activeMission!.result!.merit.total).toBeGreaterThan(0)
    tracker.freeze(); emit(); expect(tracker.commandCheckpoint().damageDealt).toBe(34)
    expect(claimCareerMission(claimed.profile, mission.id, 'victory', snapshot.player, snapshot.meritPlayer).alreadyClaimed).toBe(true)
    mission.personalSquad!.contribution = tracker.commandCheckpoint()
    const resumed = new BattleStatsTracker(new CombatEventStream(), true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    expect(resumed.commandCheckpoint()).toEqual(tracker.commandCheckpoint())
    tracker.dispose(); resumed.dispose()
  })

  it('credits a gate destruction once and rejects owned structures, without adding lifetime breaches', () => {
    const h = runtimeHarness(); completeNpcDeployment(() => h.runtime.follow(), gameplayNpcSpawnDriver); const mission = h.accept()
    mission.kind = 'enemy-town-assault'; mission.phase = 'ATTACKING'
    const events = new CombatEventStream(), tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    const source = createNpcCombatActorRef(h.runtime.actors[1])
    const target = { targetId: 'gate', targetType: 'structure' as const, name: 'Gate', structureKind: 'gate' as const, characterFaction: 'viking' as const }
    events.emit({ type: 'structure_damaged', source, target, method: 'siege', requestedDamage: 1000, appliedDamage: 23, hpRatio: 0 })
    events.emit({ type: 'structure_destroyed', source, target, method: 'siege' })
    events.emit({ type: 'structure_destroyed', source, target: { ...target, characterFaction: 'roman' }, method: 'siege' })
    expect(tracker.commandCheckpoint()).toMatchObject({ structureDamage: 23, structuresDestroyed: 1, gateBreaches: 1 })
    expect(tracker.checkpoint()).toMatchObject({ structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 })
    tracker.dispose()
  })
})

describe('Side elimination remains distinct from official objectives', () => {
  it.each([true, false])('counts a deployed returning private survivor in Outpost, reinforcements=%s', reinforcementsEnabled => {
    const runtime = new DefenseCampaignRuntime({ reinforcementsEnabled })
    const state = { playerDead: true, originalDefendersAlive: 0, defendersAlive: 0, attackersAlive: 10,
      personalPlayerSideAlive: 1, reinforcementSpawned: false }
    expect(runtime.update(1, state)).not.toContain('defeat')
    expect(runtime.getSnapshot().phase).toBe('deployment')
    expect(runtime.update(0, { ...state, personalPlayerSideAlive: 0 })).toContain(reinforcementsEnabled ? 'defeat' : 'battle_defeat')
  })

  it('does not let a personal survivor override the Town civilian failure objective', () => {
    const profile = owned(); profile.activeMission = createTownDefenseMission([], ['civilian'], 'defense')
    const controller = Object.assign(Object.create(TownDefenseController.prototype), {
      readProfile: () => profile, residents: Array.from({ length: 20 }, () => ({ spec: { role: 'civilian' }, npc: { dead: true } })),
      enemies: profile.activeMission.targetActorIds.map(combatantId => ({ combatantId, dead: true })),
    }) as TownDefenseController
    expect(controller.evaluate(true, 30)).toBe('failure')
  })
})


describe('Private frame-driven deployment operations', () => {
  it.each([0, 30])('accepts %s members without constructing any on Follow, and deduplicates repeated intent', count => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler, count)
    const expectedIds = h.profile.personalSquad!.members.map(member => member.id)
    expect(h.runtime.follow()).toBe(count > 0); expect(h.spawn).not.toHaveBeenCalled()
    expect(h.runtime.follow()).toBe(count > 0)
    expect(scheduler.pending).toBe(count)
    if (count > 0) {
      expect(h.runtime.checkpoint()!.pendingMemberIds).toEqual(expectedIds)
      expect(h.runtime.ready).toBe(false); expect(h.runtime.state).toBe('DEPLOYING')
      scheduler.tick(16)
      expect(h.runtime.actors).toHaveLength(1)
      h.runtime.updateLifecycle(); expect(h.runtime.ready).toBe(false); expect(h.runtime.state).toBe('DEPLOYING')
      // Repeated timestamps/per-frame budget belong to NpcSpawnScheduler; Follow owns identities and readiness.
      for (let remaining = 2; remaining < count; remaining++) scheduler.tick(remaining * 16)
      expect(h.runtime.actors).toHaveLength(count - 1)
      expect(h.runtime.checkpoint()!.pendingMemberIds).toEqual(expectedIds.slice(-1))
      h.runtime.updateLifecycle(); expect(h.runtime.ready).toBe(false); expect(h.runtime.state).toBe('DEPLOYING')
      scheduler.tick(count * 16)
    } else expect(h.runtime.state).toBe('RESERVE')
    expect(h.runtime.actors.map(actor => actor.combatantId)).toEqual(expectedIds)
    expect(vi.mocked(h.spawn).mock.calls.map(([, member]) => member.id)).toEqual(expectedIds)
    expect(h.runtime.actors).toHaveLength(count); expect(h.runtime.ready).toBe(true)
    expect(scheduler.pending).toBe(0)
    expect(h.runtime.actors.filter(actor => actor.mount).every(actor => h.runtime.mounts.includes(actor.mount!))).toBe(true)
    h.runtime.cleanup()
  })

  it('Dismiss cancels new members as reserves while an existing wounded rider walks back to HR', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    h.runtime.follow(); scheduler.tick(16)
    const actor = h.runtime.actors[0]; actor.restoreCombatHealth(17)
    expect(h.runtime.dismiss()).toBe(true)
    for (const frame of [32, 48, 64]) scheduler.tick(frame)
    expect(h.spawn).toHaveBeenCalledOnce(); expect(h.runtime.actors).toEqual([actor])
    expect(actor.hp).toBe(17); expect(actor.tacticalOrder).toBe('formation')
    expect(h.runtime.checkpoint()!.members['personal:test-1'].status).toBe('reserve')
    h.runtime.updateLifecycle(); expect(h.runtime.state).toBe('RETURNING')
    actor.assignFormationTarget(-1001, actor.combatPosition, new THREE.Vector3(0, 0, 1), undefined, undefined, true)
    h.runtime.updateLifecycle(); expect(h.runtime.state).toBe('RESERVE')
    h.runtime.cleanup()
  })

  it('Dismiss with no HR is a complete no-op even before the first actor exists', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('outpost:new', false, scheduler)
    h.runtime.follow(); const before = h.runtime.checkpoint()
    expect(h.runtime.dismiss()).toBe(false); expect(h.runtime.checkpoint()).toEqual(before)
    for (const frame of [16, 32, 48]) scheduler.tick(frame)
    expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(h.runtime.actors.every(actor => actor.tacticalOrder === 'follow')).toBe(true)
    h.runtime.cleanup()
  })

  it('joins an accepted fixed mission roster during Follow without replacing or healing existing actors', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    h.runtime.follow(); scheduler.tick(16)
    const actor = h.runtime.actors[0]; actor.restoreCombatHealth(13); actor.setTacticalOrder('attack')
    const position = actor.combatPosition.clone(), mission = h.accept()
    h.profile.personalSquad!.members.push({ id: 'personal:later', type: 'soldier' })
    scheduler.tick(32); scheduler.tick(48)
    expect(h.runtime.actors[0]).toBe(actor); expect(actor.hp).toBe(13); expect(actor.combatPosition).toEqual(position)
    expect(actor.tacticalOrder).toBe('attack'); expect(mission.personalSquad!.memberIds).toHaveLength(3)
    expect(h.runtime.actors.map(actor => actor.combatantId)).toEqual(mission.personalSquad!.memberIds)
    expect(h.spawn).toHaveBeenCalledTimes(3); h.runtime.cleanup()
  })

  it('gives later actors the latest Attack, then stable formation reservations without rewriting existing members', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    h.runtime.follow(); scheduler.tick(16)
    const actor = h.runtime.actors[0]; actor.setTacticalOrder('attack'); h.runtime.resumeCommand('attack')
    scheduler.tick(32); expect(h.runtime.actors[1].tacticalOrder).toBe('attack')
    for (const npc of h.runtime.actors) npc.assignFormationTarget(80, new THREE.Vector3(20 + h.runtime.actors.indexOf(npc) * 5, 0, 40), new THREE.Vector3(0, 0, 1))
    h.runtime.resumeCommand('formation'); const existing = h.runtime.actors.map(actor => actor.combatFormationCheckpoint)
    scheduler.tick(48)
    expect(h.runtime.actors.slice(0, 2).map(actor => actor.combatFormationCheckpoint)).toEqual(existing)
    const last = h.runtime.actors[2]; expect(last.formationCommandId).toBe(80)
    expect(last.combatFormationCheckpoint!.position).not.toEqual(existing[0]!.position)
    expect(last.activeFollowTarget).toBeNull(); h.runtime.cleanup()
  })

  it('preserves unmaterialized health, ammo, shield, dead mounts and commands through partial checkpoint and reload', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    const saved = snapshotPersonalMission(h.profile)!; saved.state = 'ACTIVE'
    saved.members['personal:test-0'] = { status: 'deployed', hp: 11, ammo: 3, shieldImpact: 7, order: 'attack', position: h.slots[0] }
    saved.members['personal:test-1'] = { status: 'deployed', hp: 22, ammo: 2, order: 'defend', position: h.slots[1],
      mount: { hp: 0, mounted: false, position: h.slots[1] } }
    saved.members['personal:test-2'] = { status: 'deployed', hp: 33, ammo: 1, order: 'follow', position: h.slots[2] }
    h.runtime.restoreMission(saved); h.runtime.restoreMission(saved); scheduler.tick(16)
    const partial = h.runtime.checkpoint()!
    expect(partial.members['personal:test-1']).toEqual(saved.members['personal:test-1'])
    expect(partial.members['personal:test-2']).toEqual(saved.members['personal:test-2'])
    h.profile.personalSquadRuntime = partial
    const parsed = parseCareerProfile(JSON.parse(JSON.stringify(h.profile)))!.personalSquadRuntime!
    h.runtime.cleanup(); const restored = h.restore(); restored.restoreMission(parsed)
    for (const frame of [32, 48, 64]) scheduler.tick(frame)
    expect(restored.actors.map(actor => actor.hp)).toEqual([11, 22, 33])
    expect(restored.actors.map(actor => actor.combatAmmo)).toEqual([3, 2, 1])
    expect(restored.actors[0].shield.shieldImpactRemaining).toBe(7)
    expect(restored.actors[1].mount).toBeNull(); expect(restored.mounts[0].dead).toBe(true)
    expect(restored.actors.map(actor => actor.tacticalOrder)).toEqual(['attack', 'defend', 'follow'])
    expect(h.spawn).toHaveBeenCalledTimes(4); restored.cleanup()
  })

  it('saves pending HR departure before its first frame and restores the same intention', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    h.runtime.follow(); h.runtime.resumeCommand('defend')
    h.profile.personalSquadRuntime = h.runtime.checkpoint()
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(h.profile)))!.personalSquadRuntime!
    expect(saved.pendingMemberIds).toHaveLength(3)
    h.runtime.cleanup(); const restored = h.restore(); restored.restoreMission(saved)
    for (const frame of [16, 32, 48]) scheduler.tick(frame)
    expect(restored.actors).toHaveLength(3)
    expect(restored.actors.every(actor => actor.tacticalOrder === 'defend')).toBe(true)
    restored.cleanup()
  })

  it('holds new Follow actors at the last living Player position after death, and cancels callbacks on direct return', () => {
    const scheduler = new NpcSpawnScheduler(), h = runtimeHarness('town-home', true, scheduler)
    h.player.group.position.set(30, 0, 40); h.runtime.updateLifecycle(); h.runtime.follow()
    h.player.dead = true; h.player.group.position.set(200, 0, 200); scheduler.tick(16)
    expect(h.runtime.actors[0].activeFollowTarget).toBeNull()
    const offset = followLocalOffset(0, false)
    expect(h.runtime.actors[0].combatFormationCheckpoint!.position).toMatchObject({ x: 30 + offset.x, z: 40 + offset.z })
    h.runtime.endMission(true); scheduler.tick(32); scheduler.tick(48)
    expect(h.spawn).toHaveBeenCalledOnce(); expect(h.runtime.actors).toHaveLength(0)
  })
})
