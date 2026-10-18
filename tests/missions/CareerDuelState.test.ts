import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Vector3, type Scene } from 'three'
import { CareerDuelController } from '../../src/career/CareerDuelController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { TownWorld } from '../../src/town/TownWorld'
import { townSitePoint, type TownActorSpec } from '../../src/town/TownRules'
import { getTerrainHeight } from '../../src/world/Terrain'
import { type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { CAREER_DUEL_TEMPLATE_ID, createCareerDuelMission, isCareerDuelUnlocked, type CareerDuelTier } from '../../src/career/CareerDuelState'
import { acceptsCareerMissionStat } from '../../src/career/CareerMissionState'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats = { damageDealt: 160, damageTaken: 20, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }

function duel(profile: CareerProfile, presetId: UnitPresetId, tier: CareerDuelTier, id = `${presetId}-${tier}`): CareerProfile {
  const activeMission = createCareerDuelMission(profile, presetId, tier, tier === 5 ? 'commander' : 'soldier-1', 'captain', id)
  expect(activeMission).not.toBeNull()
  return { ...profile, activeMission: activeMission! }
}

function win(profile: CareerProfile, presetId: UnitPresetId, tier: CareerDuelTier, id?: string): CareerProfile {
  const current = duel(profile, presetId, tier, id)
  const claim = claimCareerMission(current, current.activeMission!.id, 'victory', stats)
  return clearCareerMission(claim.profile, current.activeMission!.id)
}

/** Real controller/checkpoints and navigation; only position/order ports, no 3D actors. */
function travelingDuel(phase: 'ASSEMBLING' | 'MARCHING') {
  const makeActor = (id: string, x: number, z: number) => {
    const position = new Vector3(x, getTerrainHeight(x, z), z)
    const body = { combatantId: id, combatPosition: position, group: { position, rotation: { y: 0 } },
      dead: false, hp: 100, combatAmmo: 30, loadout: {}, target: undefined as Vector3 | undefined,
      setDuelHostility: vi.fn(), restoreCombatLoadout: vi.fn(), setTacticalOrder: vi.fn(),
      applyTemporaryCombatLoadout: vi.fn(), dismountFromMount: vi.fn(),
      assignFollowTarget: vi.fn(), assignFormationTarget: vi.fn((_id: number, point: Vector3) => { body.target = point.clone() }) }
    return body
  }
  const captain = makeActor('captain', -30, 20), opponent = makeActor('soldier-1', -60, 0)
  const makeSpec = (actor: typeof captain, role: TownActorSpec['role'], duty: TownActorSpec['duty']): TownActorSpec => ({
    id: actor.combatantId, role, duty, tier: 2, index: 0, mounted: false, training: duty === 'training',
    assaultObjective: false, x: actor.combatPosition.x, z: actor.combatPosition.z })
  const residents = [{ spec: makeSpec(captain, 'captain', 'service'), npc: captain as unknown as NPC },
    { spec: makeSpec(opponent, 'archer_infantry', 'training'), npc: opponent as unknown as NPC }]
  const position = new Vector3(-90, getTerrainHeight(-90, 10) + .9, 10)
  const player = { group: { position, rotation: { y: 0 } }, combatPosition: position, dead: false,
    hp: 100, staminaValue: 100, faceDirection: vi.fn() }
  let profile = duel(createCareerProfile('roman'), 'roman_archer', 1, 'travel-duel')
  profile.activeMission!.phase = phase
  const navigation = new NavigationWorld({ minX: -150, maxX: 170, minZ: -140, maxZ: 120, cellSize: 4 })
  navigation.sync([])
  const query = vi.spyOn(navigation, 'queryPath'); onTestFinished(() => query.mockRestore())
  const controller = new CareerDuelController(null as unknown as Scene, { obstacles: [] } as unknown as TownWorld,
    navigation, residents, null as unknown as Mount, () => player as unknown as Player, () => profile,
    next => { profile = next; return true })
  onTestFinished(() => controller.dispose())
  return { controller, captain, opponent, player, query }
}

describe('Career Duel physical travel and preparation', () => {
  it('starts an accepted or legacy assembling Duel from the Captain actual position without a barracks rendezvous', () => {
    const { controller, captain, opponent, player, query } = travelingDuel('ASSEMBLING')
    const captainStart = captain.combatPosition.clone(), opponentStart = opponent.combatPosition.clone(), playerStart = player.combatPosition.clone()
    expect(player.combatPosition.distanceTo(captain.combatPosition)).toBeGreaterThan(12)
    expect(controller.startActiveMission()).toBe(true)
    expect(controller.phase).toBe('MARCHING')
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0][0]).toEqual(captainStart)
    expect(query.mock.calls[0][1]).toEqual(controller.guideTarget)
    expect(captain.assignFormationTarget).toHaveBeenCalledOnce()
    const oldAssembly = townSitePoint('barracks', 0, 15)
    expect(Math.hypot(captain.target!.x - oldAssembly.x, captain.target!.z - oldAssembly.z)).toBeGreaterThan(4)
    expect(opponent.assignFollowTarget).toHaveBeenCalledWith(captain, 0, new Vector3(-3, 0, -5), 6)
    expect(captain.combatPosition).toEqual(captainStart)
    expect(opponent.combatPosition).toEqual(opponentStart)
    expect(player.combatPosition).toEqual(playerStart)
  })

  it('waits for grounded arena slots, then enters the unchanged countdown and combat after real arrival', () => {
    const { controller, captain, opponent, player } = travelingDuel('MARCHING')
    expect(controller.startActiveMission()).toBe(true)
    const area = controller.guideTarget!
    player.combatPosition.copy(area).add(new Vector3(0, .9, 0))
    captain.combatPosition.copy(area).add(new Vector3(-2, 0, 0))
    opponent.combatPosition.copy(area).add(new Vector3(-4, 0, 0))
    controller.update(0)
    expect(controller.phase).toBe('MARCHING')
    expect(captain.target!.y).toBe(getTerrainHeight(captain.target!.x, captain.target!.z))
    expect(Math.abs(captain.target!.y - area.y)).toBeGreaterThan(2) // Actual failing terrain, not an artificial height.
    opponent.combatPosition.copy(opponent.target!)
    controller.update(0)
    expect(controller.phase).toBe('MARCHING') // Referee has not reached the slot.
    captain.combatPosition.copy(captain.target!).add(new Vector3(0, 4, 0))
    controller.update(0)
    expect(controller.phase).toBe('MARCHING') // Same XZ on an invalid layer is insufficient.
    captain.combatPosition.copy(captain.target!)
    controller.update(0)
    expect(controller.phase).toBe('PREPARING')
    controller.update(4.9)
    expect(controller.phase).toBe('PREPARING')
    controller.update(.1)
    expect(controller.phase).toBe('ENGAGING')
    expect(opponent.setDuelHostility).toHaveBeenCalledWith(true)
    expect(captain.setDuelHostility).not.toHaveBeenCalledWith(true)
  })
})

describe('Career Duel progression per unit preset', () => {

  it('keeps concurrent Archer, Spearman and Cavalry progress independent, including through reload', () => {
    let profile = win(createCareerProfile('roman'), 'roman_archer', 1)
    profile = win(profile, 'roman_archer', 2)
    profile = win(profile, 'roman_archer', 3)
    profile = win(profile, 'roman_spearman', 1)
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(loaded.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: 3, roman_spearman: 1 })
    expect(isCareerDuelUnlocked(loaded, 'roman_archer', 4)).toBe(true)
    expect(isCareerDuelUnlocked(loaded, 'roman_spearman', 2)).toBe(true)
    expect(isCareerDuelUnlocked(loaded, 'roman_spearman', 3)).toBe(false)
    expect(isCareerDuelUnlocked(loaded, 'roman_sword_cavalry', 2)).toBe(false)
  })

  it('does not unlock on failure or reduce progress when replaying a lower tier', () => {
    let profile = win(createCareerProfile('viking'), 'viking_archer', 1)
    profile = win(profile, 'viking_archer', 2)
    profile = win(profile, 'viking_archer', 3)
    const failed = duel(profile, 'viking_spearman', 1, 'failed-spear')
    profile = clearCareerMission(claimCareerMission(failed, 'failed-spear', 'failure', { ...stats, survived: false }).profile, 'failed-spear')
    expect(isCareerDuelUnlocked(profile, 'viking_spearman', 2)).toBe(false)
    profile = win(profile, 'viking_archer', 1, 'repeat-archer')
    expect(profile.duelHighestDefeatedTierByPreset).toEqual({ viking_archer: 3 })
  })
})

describe('Career Duel settlement and safe storage', () => {

  it('saves T5 progress, original Commander resources and active travel through real storage and settlement', () => {
    const profile = duel({ ...createCareerProfile('viking'), rank: 'commander',
      duelHighestDefeatedTierByPreset: { viking_archer: 4 } }, 'viking_archer', 5, 'commander-duel')
    Object.assign(profile.activeMission!, { phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 19.25,
      duelOpponentHp: 48, duelOpponentAmmo: 7, duelCommanderHome: { hp: 712, ammo: 13 },
      duelTravel: { actors: { captain: { x: 1, y: 2, z: 3, yaw: .5 }, commander: { x: 4, y: 5, z: 6, yaw: 1 } },
        player: { x: 7, y: 8, z: 9, yaw: 2 }, staging: true } })
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission).toMatchObject({ duelTier: 5, duelOpponentActorId: 'commander', duelRefereeActorId: 'captain',
      duelCountdownElapsed: 5, duelCombatElapsed: 19.25, duelOpponentHp: 48, duelOpponentAmmo: 7,
      duelCommanderHome: { hp: 712, ammo: 13 }, duelTravel: profile.activeMission!.duelTravel })
    const copy = cloneCareerProfile(loaded)
    copy.activeMission!.duelTravel!.actors.commander.x = 999
    expect(loaded.activeMission!.duelTravel!.actors.commander.x).toBe(4)
    const settled = clearCareerMission(claimCareerMission(loaded, 'commander-duel', 'victory', stats).profile, 'commander-duel')
    expect(store.save(settled)).toBe(true)
    const restored = store.load()!
    expect(restored.activeMission).toBeUndefined()
    expect(restored.duelHighestDefeatedTierByPreset).toEqual({ viking_archer: 5 })
    expect(restored.townCommanderRecovery).toEqual({ faction: 'viking', hp: 712, ammo: 13 })
    expect(restored.careerMissionCompletionsByTier).toBeUndefined()
  })

  it('awards normal mission merit and lifetime stats once while preserving both mission board counters', () => {
    let profile = createCareerProfile('roman')
    profile.careerMissionCompletions = 12; profile.careerMissionCompletionsByTier = { 1: 7, 2: 5 }
    profile = duel(profile, 'roman_archer', 1, 'claim-duel')
    profile.activeMission!.phase = 'ENGAGING'
    const claimed = claimCareerMission(profile, 'claim-duel', 'victory', stats)
    expect(claimed.meritAwarded).toBe(26)
    expect(claimed.profile.totalMerit).toBe(26)
    expect(claimed.profile.availableMerit).toBe(26)
    expect(claimed.profile.lifetimeStats).toMatchObject({ battles: 1, victories: 1, damage: 160, kills: 1, deaths: 0 })
    expect(claimed.profile.careerMissionCompletions).toBe(12)
    expect(claimed.profile.careerMissionCompletionsByTier).toEqual({ 1: 7, 2: 5 })
    expect(claimed.profile.activeMission?.result).toMatchObject({ outcome: 'victory', claimed: true, stats, merit: { damage: 8, kills: 6, contribution: 12, total: 26 } })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(claimed.profile)))!
    const duplicate = claimCareerMission(loaded, 'claim-duel', 'victory', { ...stats, damageDealt: 999 })
    expect(duplicate.alreadyClaimed).toBe(true)
    expect(duplicate.meritAwarded).toBe(0)
    expect(duplicate.profile.totalMerit).toBe(26)
    expect(duplicate.profile.lifetimeStats.battles).toBe(1)
    expect(duplicate.profile.duelHighestDefeatedTierByPreset).toEqual({ roman_archer: 1 })
  })

  it('round-trips actor identity, countdown, combat time, health, deaths, stats and existing voice marker without refreshing them', () => {
    const profile = duel(createCareerProfile('roman'), 'roman_archer', 1, 'resume-duel')
    Object.assign(profile.activeMission!, { phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11,
      duelOpponentMountHp: 8, duelOpponentDead: false, playerStats: { ...stats }, playerDead: true, followVoicePlayed: true })
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    expect(storage.getItem(CAREER_STORAGE_KEY)).not.toBeNull()
    const loaded = store.load()!
    expect(loaded.activeMission).toMatchObject({ id: 'resume-duel', templateId: CAREER_DUEL_TEMPLATE_ID, kind: 'duel', targetCampId: -1,
      duelTier: 1, duelPresetId: 'roman_archer', duelOpponentActorId: 'soldier-1', duelCaptainActorId: 'captain', duelRefereeActorId: 'captain',
      phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11, duelOpponentMountHp: 8,
      playerDead: true, followVoicePlayed: true, playerStats: { damageDealt: 160, kills: 1 } })
    profile.activeMission!.phase = 'PREPARING'; profile.activeMission!.duelCountdownElapsed = 3.9
    expect(store.save(profile)).toBe(true)
    expect(store.load()?.activeMission?.duelCountdownElapsed).toBe(3.9)
  })
})

describe('Career Duel outcome and combat attribution', () => {

  it('accepts combat stats only during ENGAGING and only between the player and opponent', () => {
    const mission = duel(createCareerProfile('roman'), 'roman_archer', 1).activeMission!
    const event: CombatEvent = { type: 'damage_applied', source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: 'soldier-1', targetType: 'npc', name: 'Duel opponent' }, method: 'projectile', requestedDamage: 100, appliedDamage: 100 }
    mission.phase = 'PREPARING'
    expect(acceptsCareerMissionStat(mission, event)).toBe(false)
    mission.phase = 'ENGAGING'
    expect(acceptsCareerMissionStat(mission, event)).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { ...event.target, targetId: 'captain' } })).toBe(false)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { targetId: 'mount', targetType: 'mount', name: 'Horse', ownerActorId: 'soldier-1' } })).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...event, target: { targetId: 'mount', targetType: 'mount', name: 'Horse', ownerActorId: 'captain' } })).toBe(false)
    const incoming = { ...event, source: { ...event.source, actorId: 'soldier-1', actorType: 'npc' as const }, target: { targetId: 'player', targetType: 'player' as const, name: 'Player' } }
    expect(acceptsCareerMissionStat(mission, incoming)).toBe(true)
    expect(acceptsCareerMissionStat(mission, { ...incoming, source: { ...incoming.source, actorId: 'captain' } })).toBe(false)
  })
})
