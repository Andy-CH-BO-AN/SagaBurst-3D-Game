import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../helpers/veteranFieldFixture'
import { createVeteranMissionProfile } from '../helpers/veteranFieldBuilders'
import { Faction } from '../../src/world/NPC'
import { createVeteranSpawnSpec } from '../../src/career/VeteranMission'
import { claimCareerMission } from '../../src/career/CareerProfile'
import { VETERAN_FIELD_LAYOUT } from '../../src/career/BanditMissionController'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../../src/town/TownBounds'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class {
  update(): void {}
  hide(): void {}
  dispose(): void {}
} }))

const fixtures: VeteranFieldFixture[] = []
afterEach(() => {
  fixtures.splice(0).reverse().forEach(fixture => fixture.dispose())
  vi.restoreAllMocks()
})
function field(options: VeteranFieldFixtureOptions) {
  const fixture = createVeteranFieldFixture(options)
  fixtures.push(fixture)
  return fixture
}

function finishField(setup: VeteranFieldFixture) {
  setup.enemies.forEach(npc => npc.takeDamage(999999))
  const stats = { damageDealt: 40, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
  const result = claimCareerMission(setup.profile(), setup.profile().activeMission!.id, 'victory', stats)
  Object.assign(setup.profile(), result.profile)
}

describe('VeteranFieldCheckpoint', () => {
  it.each(['veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'restores the same reequipped residents, mounts, and shortages after reloading %s', templateId => {
      const setup = field({ templateId })
      const borrowed = setup.residents.filter(({ spec }) => spec.role.endsWith('_cavalry'))
      expect(borrowed).toHaveLength(47)
      for (const { npc, homeMount } of borrowed) {
        expect(npc.mount).toBe(homeMount)
        expect(npc.temporaryTier).toBe(3)
        expect(npc.temporaryLoadout).toEqual(createVeteranSpawnSpec(setup.roster.friendly.find(unit => unit.actorId === npc.combatantId)!, 'roman').loadout)
      }
      borrowed[0].npc.hp = 37
      const savedPosition = borrowed[0].npc.combatPosition.clone()
      expect(setup.controller.persistRuntimeProgress(true)).toBe(true)
      setup.controller.cleanupMission()
      for (const { npc, homeMount } of borrowed) {
        expect(npc.temporaryLoadout).toBeUndefined()
        expect(npc.tier).toBe(2)
        expect(npc.mount).toBe(homeMount)
        expect(npc.respawnEnabled).toBe(true)
      }
      const reloaded = field({ templateId, profile: setup.profile(), residents: setup.residents, player: setup.player })
      expect(reloaded.start).toBe(true)
      expect(reloaded.actors.filter(npc => borrowed.some(resident => resident.npc === npc))).toHaveLength(47)
      expect(borrowed[0].npc.hp).toBe(37)
      expect(borrowed[0].npc.combatPosition.x).toBe(savedPosition.x)
      expect(borrowed[0].npc.combatPosition.z).toBe(savedPosition.z)
      expect(reloaded.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)).toHaveLength(templateId === 'veteran-village-intercept' ? 0 : 1)
    })

  it('preserves the latest Player mount checkpoint through charge and two reloads', () => {
    const setup = field({ templateId: 'veteran-scout-hunters' })
    expect(setup.start).toBe(true)
    setup.controller.onMarchStarted = vi.fn()
    setup.controller.onSweepCharge = vi.fn()
    const captain = setup.actors.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)!.actorId)!
    setup.assemble()
    expect(setup.controller.onMarchStarted).toHaveBeenCalledTimes(1)
    const mission = setup.profile().activeMission!
    expect(mission.phase).toBe('MARCHING')
    expect(mission.followVoicePlayed).toBe(true)
    mission.mountState = { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] }
    const captainAgain = setup.actors.find(npc => npc.combatantId === captain.combatantId)!
    captainAgain.combatPosition.set(VETERAN_FIELD_LAYOUT.enemy.x - 59, 0, VETERAN_FIELD_LAYOUT.enemy.z)
    setup.advanceUntil(() => setup.controller.phase === 'ENGAGING', {
      failureMessage: 'Approaching the enemy must engage all four squads',
    })
    expect(setup.controller.onSweepCharge).toHaveBeenCalledTimes(1)
    expect(setup.profile().activeMission).toMatchObject({ phase: 'ENGAGING', chargedSquadIds: [1, 2, 3, 4], followVoicePlayed: true,
      mountState: { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] } })
    setup.controller.cleanupMission()
    const reloadSetup = field({ templateId: 'veteran-scout-hunters', profile: setup.profile(), residents: setup.residents, player: setup.player, autoStart: false })
    reloadSetup.controller.onMarchStarted = vi.fn()
    reloadSetup.controller.onSweepCharge = vi.fn()
    expect(reloadSetup.deploy()).toBe(true)
    expect(reloadSetup.profile().activeMission?.phase).toBe('ENGAGING')
    expect(reloadSetup.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(reloadSetup.controller.onSweepCharge).not.toHaveBeenCalled()
    expect(reloadSetup.profile().activeMission).toMatchObject({ phase: 'ENGAGING', chargedSquadIds: [1, 2, 3, 4],
      mountState: { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] } })
    reloadSetup.controller.cleanupMission()
    const finalReload = field({ templateId: 'veteran-scout-hunters', profile: reloadSetup.profile(), residents: reloadSetup.residents, player: reloadSetup.player, autoStart: false })
    finalReload.controller.onMarchStarted = vi.fn()
    finalReload.controller.onSweepCharge = vi.fn()
    expect(finalReload.deploy()).toBe(true)
    expect(finalReload.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(finalReload.controller.onSweepCharge).not.toHaveBeenCalled()
  })

  it('avoids the old world edge when restoring a legacy mountedMarchPosition', () => {
    const setup = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    const profile = setup.profile()
    profile.activeMission = {
      ...profile.activeMission!, phase: 'MARCHING', mountedMarchPosition: { x: 110, z: -275 }, actorPositions: undefined,
    }
    expect(setup.deploy()).toBe(true)
    for (const actor of setup.actors) {
      expect(Math.abs(actor.combatPosition.x)).toBeLessThan(280)
      expect(Math.abs(actor.combatPosition.z)).toBeLessThan(280)
    }
    for (const enemy of setup.enemies) {
      expect(Math.abs(enemy.combatPosition.x)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
      expect(Math.abs(enemy.combatPosition.z)).toBeLessThan(TOWN_PLAYABLE_WORLD_BOUND - 20)
    }
  })

  it('restores legacy MARCHING borrowed actors around the saved mounted march anchor', () => {
    const setup = field({ templateId: 'veteran-scout-hunters', autoStart: false })
    const profile = setup.profile()
    profile.activeMission = {
      ...profile.activeMission!, phase: 'MARCHING', mountedMarchPosition: { x: 100, z: 100 }, actorPositions: undefined,
    }
    expect(setup.deploy()).toBe(true)
    const captain = setup.actors.find(npc => npc.combatantId === 'captain')!
    expect(captain.combatPosition.x).toBeCloseTo(100)
    expect(captain.combatPosition.z).toBeCloseTo(100)
  })

  it('returns the surviving Scout Hunters party from its current position and resumes its in-memory checkpoint', () => {
    const setup = field({ templateId: 'veteran-scout-hunters' })
    setup.actors[1].takeDamage(999999)
    const leader = setup.leader!
    leader.combatPosition.set(170, 0, 20)
    finishField(setup)
    const merit = setup.profile().totalMerit
    expect(setup.controller.startReturning()).toBe(true)
    expect(setup.controller.phase).toBe('RETURNING')
    expect(leader.combatPosition.x).toBe(170)
    const home = leader.formationTarget!.position.clone()
    const followers = setup.actors.filter(npc => !npc.dead && npc !== setup.leader)
    expect(followers.every(npc => npc.followTarget === leader)).toBe(true)
    leader.combatPosition.set(80, 0, 20)
    leader.hp = 37
    setup.controller.updateFlow(5, 0)
    setup.controller.persistRuntimeProgress(true)
    setup.controller.cleanupMission()
    const reload = field({ templateId: 'veteran-scout-hunters', profile: setup.profile(), residents: setup.residents, player: setup.player, autoStart: false })
    reload.controller.onMarchStarted = vi.fn()
    reload.controller.onSweepCharge = vi.fn()
    expect(reload.deploy()).toBe(true)
    expect(reload.controller.phase).toBe('RETURNING')
    expect(reload.enemies).toHaveLength(0)
    expect(reload.actors.filter(npc => !npc.dead)).toHaveLength(setup.roster.friendly.length - 1)
    const restoredLeader = reload.leader!
    expect(restoredLeader.combatPosition.x).toBe(80)
    expect(restoredLeader.hp).toBe(37)
    expect(restoredLeader.formationTarget!.position).toEqual(home)
    reload.stepFrame()
    expect(reload.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(reload.controller.onSweepCharge).not.toHaveBeenCalled()
    expect(reload.profile().totalMerit).toBe(merit)
    restoredLeader.combatPosition.copy(home)
    reload.player.group.position.set(170, 0, 20)
    expect(reload.controller.partyReturned).toBe(true)
    expect(reload.controller.returnComplete).toBe(false)
    reload.player.group.position.copy(home)
    reload.advanceUntil(() => reload.controller.returnComplete, { failureMessage: 'Player and party must arrive home' })
    expect(reload.controller.returnComplete).toBe(true)
  })

  it.each([
    ['veteran-village-intercept', 'captain', 49, 0],
    ['veteran-spear-line-hunt', 'ranger', 48, 1],
  ] as const)('wires %s RETURNING checkpoint to its own leader, resident sources and support', (templateId, leaderId, borrowedCount, supportCount) => {
    // The full victory -> return -> save -> cleanup -> restore -> arrival flow is owned by Scout Hunters above.
    // Other roster/source variants enter at the saved RETURNING boundary; this is an in-memory checkpoint.
    const accepted = createVeteranMissionProfile(templateId)
    const stats = { damageDealt: 40, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
    const profile = claimCareerMission(accepted, accepted.activeMission!.id, 'victory', stats).profile
    const active = profile.activeMission!
    const fallenId = active.friendlyActorIds[1]
    active.phase = 'RETURNING'
    active.deadFriendlyActorIds = [fallenId]
    active.actorPositions = { [leaderId]: { x: 80, z: 20, yaw: .3 } }
    active.actorHealth = { [leaderId]: { hp: 37 } }
    const merit = profile.totalMerit
    const setup = field({ templateId, profile, autoStart: false })
    setup.controller.onMarchStarted = vi.fn()
    setup.controller.onSweepCharge = vi.fn()

    expect(setup.deploy()).toBe(true)

    expect(setup.controller.phase).toBe('RETURNING')
    expect(setup.enemies).toHaveLength(0)
    expect(setup.actors.filter(npc => !npc.dead)).toHaveLength(48)
    expect(setup.actors.find(npc => npc.combatantId === fallenId)!.dead).toBe(true)
    expect(setup.residents).toHaveLength(borrowedCount)
    expect(setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)).toHaveLength(supportCount)
    for (const resident of setup.residents) {
      expect(setup.actors.find(npc => npc.combatantId === resident.npc.combatantId)).toBe(resident.npc)
    }
    const leader = setup.leader!
    expect(leader.combatantId).toBe(leaderId)
    expect(leader.combatPosition.x).toBe(80)
    expect(leader.combatPosition.z).toBe(20)
    expect(leader.hp).toBe(37)
    expect(leader.formationTarget!.position.x).toBeCloseTo(18)
    expect(leader.formationTarget!.position.z).toBeCloseTo(16)
    expect(setup.actors.filter(npc => !npc.dead && npc !== leader).every(npc => npc.followTarget === leader)).toBe(true)
    setup.stepFrame()
    expect(setup.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(setup.controller.onSweepCharge).not.toHaveBeenCalled()
    expect(setup.profile().totalMerit).toBe(merit)
  })

  it('restores wounded actors and mounts while preserving casualty IDs and the dead Player checkpoint', () => {
    const setup = field({ templateId: 'veteran-scout-hunters', initialCheckpoint: { phase: 'ENGAGING' } })
    const wounded = setup.actors.find(actor => actor.combatantId === 'captain')!
    const fallen = setup.actors.find(actor => actor.combatantId === 'ranger')!
    const enemy = setup.enemies[0]
    wounded.takeDamage(63)
    wounded.mount!.takeDamage(57)
    fallen.takeDamage(100)
    enemy.takeDamage(100)
    setup.player.dead = true
    setup.player.hp = 0
    setup.player.staminaValue = 18
    expect(setup.controller.persistRuntimeProgress(true)).toBe(true)
    const saved = structuredClone(setup.profile())
    expect(saved.activeMission).toMatchObject({
      phase: 'ENGAGING', playerDead: true, playerHp: 0, playerStamina: 18,
      deadFriendlyActorIds: [fallen.combatantId], deadTargetActorIds: [enemy.combatantId],
      actorHealth: { captain: { hp: 37, mountHp: 43 } },
    })
    setup.controller.cleanupMission()
    const reload = field({ templateId: 'veteran-scout-hunters', profile: saved })
    const restored = reload.actors.find(actor => actor.combatantId === wounded.combatantId)!
    expect(restored).not.toBe(wounded)
    expect(restored.hp).toBe(37)
    expect(restored.mount!.currentHp).toBe(43)
    expect(reload.actors.find(actor => actor.combatantId === fallen.combatantId)!.dead).toBe(true)
    expect(reload.enemies.some(actor => actor.combatantId === enemy.combatantId)).toBe(false)
    expect(reload.controller.phase).toBe('ENGAGING')
    expect(reload.profile().activeMission!.playerDead).toBe(true)
    expect(reload.controller.evaluate(true)).toBeNull()
  })

  it('leaves an unchanged field checkpoint and claimed result idempotent across save attempts', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    expect(setup.controller.persistRuntimeProgress(true)).toBe(true)
    const checkpoint = structuredClone(setup.profile().activeMission)
    expect(setup.controller.persistRuntimeProgress(true)).toBe(false)
    expect(setup.profile().activeMission).toEqual(checkpoint)
    finishField(setup)
    const claimed = structuredClone(setup.profile())
    const stats = claimed.activeMission!.result!.stats
    const retry = claimCareerMission(claimed, claimed.activeMission!.id, 'victory', stats)
    expect(retry.profile).toEqual(claimed)
    expect(setup.controller.persistRuntimeProgress(true)).toBe(false)
    expect(setup.profile()).toEqual(claimed)
  })
})
