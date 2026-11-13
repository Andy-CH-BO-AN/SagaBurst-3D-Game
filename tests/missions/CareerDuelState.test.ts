import { Box3, Vector3, type Scene } from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CareerDuelArenaScene } from '../../src/arena/CareerDuelArenaScene'
import { type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { careerDuelClassOptions, resolveCareerDuelClass } from '../../src/career/CareerDuelClasses'
import { CareerDuelController, duelLoadout, persistsDuelTravel, selectCareerDuelRoster, type CareerDuelOpponentRequest, type CareerDuelVenue } from '../../src/career/CareerDuelController'
import { CAREER_DUEL_TEMPLATE_ID, careerDuelArena, careerDuelOpponentHealth, createCareerDuelMission, createCareerTutorialDuelMission, duelCombatSeconds, isCareerDuelUnlocked, isIllegalUnarmedDuelDamage, isUnarmedDuelUnlocked, resolveCareerDuelOutcome, type CareerDuelTier } from '../../src/career/CareerDuelState'
import { acceptsCareerMissionStat } from '../../src/career/CareerMissionState'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { townCommanderSpec } from '../../src/town/TownCommanderIdentity'
import { DUEL_ARENA_HALF_SIZE, findTownDuelArena, townDuelAreaClear } from '../../src/town/TownDuelArena'
import { TOWN_CITY_ROADS, TOWN_DUEL_CENTER, TOWN_LOCAL_ROADS, TOWN_MOUNTED_MISSION_MUSTER } from '../../src/town/TownLayout'
import { townRoster, townSitePoint, type TownActorSpec } from '../../src/town/TownRules'
import type { TownWorld } from '../../src/town/TownWorld'
import type { Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'
import { Faction } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'
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

/** A plain-object NPC port: position, health, equipment and order calls only (no 3D actor). */
function makeActor(id: string, x: number, z: number) {
  const position = new Vector3(x, getTerrainHeight(x, z), z)
  const body = { combatantId: id, combatPosition: position, group: { position, rotation: { y: 0 } },
    dead: false, hp: 100, maxHp: 200, characterFaction: 'roman', characterTier: 3, combatAmmo: 30, loadout: {}, target: undefined as Vector3 | undefined,
    duelUnarmed: false, setUnarmedDuel: vi.fn((enabled: boolean) => { body.duelUnarmed = enabled }),
    setDuelHostility: vi.fn(), restoreCombatLoadout: vi.fn(), restoreOrdinaryTier: vi.fn(),
    restoreForTown: vi.fn(), restoreCombatAmmo: vi.fn(),
    applyTemporaryOrdinaryTier: vi.fn(), restoreCombatHealth: vi.fn(), setTacticalOrder: vi.fn(),
    applyTemporaryCombatLoadout: vi.fn(), dismountFromMount: vi.fn(),
    assignFollowTarget: vi.fn(), assignFormationTarget: vi.fn((_id: number, point: Vector3) => { body.target = point.clone() }) }
  return body
}

/** Real controller/checkpoints and navigation; only position/order ports, no 3D actors. */
function travelingDuel(phase: 'ASSEMBLING' | 'MARCHING' | 'RESULT' | 'RETURNING', createOpponent?: (request: CareerDuelOpponentRequest) => NPC | null, venue?: CareerDuelVenue) {
  const captain = makeActor('captain', -30, 20), opponent = makeActor('soldier-1', -60, 0)
  const makeSpec = (actor: typeof captain, role: TownActorSpec['role'], duty: TownActorSpec['duty']): TownActorSpec => ({
    id: actor.combatantId, role, duty, tier: 2, index: 0, mounted: false, training: duty === 'training',
    assaultObjective: false, x: actor.combatPosition.x, z: actor.combatPosition.z })
  const residents = [{ spec: makeSpec(captain, 'captain', 'service'), npc: captain as unknown as NPC },
    { spec: makeSpec(opponent, 'archer_infantry', 'training'), npc: opponent as unknown as NPC }]
  const position = new Vector3(-90, getTerrainHeight(-90, 10) + .9, 10)
  const player = { group: { position, rotation: { y: 0 } }, combatPosition: position, dead: false,
    hp: 100, staminaValue: 100, faceDirection: vi.fn(), currentMount: null as Mount | null, unarmedDuelOnly: false,
    clearTownAction: vi.fn(), dismountFromMount: vi.fn(() => { player.currentMount = null }), mountVehicle: vi.fn((mount: Mount) => { player.currentMount = mount }),
    setHp: vi.fn((hp: number) => { player.hp = hp }), setStamina: vi.fn((stamina: number) => { player.staminaValue = stamina }) }
  let profile = duel(createCareerProfile('roman'), 'roman_archer', 1, 'travel-duel')
  if (phase === 'RESULT' || phase === 'RETURNING') profile = claimCareerMission(profile, 'travel-duel', 'victory', stats).profile
  profile.activeMission!.phase = phase
  let saveAllowed = true
  const navigation = new NavigationWorld({ minX: -150, maxX: 170, minZ: -140, maxZ: 120, cellSize: 4 })
  navigation.sync([])
  const query = vi.spyOn(navigation, 'queryPath'); onTestFinished(() => query.mockRestore())
  const controller = new CareerDuelController(null as unknown as Scene, { obstacles: [] } as unknown as TownWorld,
    navigation, residents, null as unknown as Mount, () => player as unknown as Player, () => profile,
    next => { if (!saveAllowed) return false; profile = next; return true }, undefined, createOpponent, venue)
  onTestFinished(() => controller.dispose())
  return { controller, captain, opponent, player, query, residents, read: () => profile,
    allowSave: (allowed: boolean) => { saveAllowed = allowed } }
}

describe('Career Duel physical travel and preparation', () => {
  it('accepts a Recruit practice challenge against the actual Captain without unlocking formal tiers or replacing another activity', () => {
    const profile = createCareerProfile('roman')
    expect(isCareerDuelUnlocked(profile, 'roman_sword_cavalry', 4)).toBe(false)
    const mission = createCareerTutorialDuelMission(profile, 'roman_sword_cavalry', 'captain', 'ranger')
    expect(mission).toMatchObject({ kind: 'duel', duelTier: 4, duelOpponentActorId: 'captain',
      duelRefereeActorId: 'ranger', duelTutorialCareerId: profile.tutorial!.careerId })
    expect(profile.duelHighestDefeatedTierByPreset).toBeUndefined()
    expect(profile.activeMission).toBeUndefined()
    expect(createCareerTutorialDuelMission(profile, 'roman_sword_cavalry', 'soldier-1', 'ranger')).toBeNull()
    profile.activeMission = mission!
    expect(createCareerTutorialDuelMission(profile, 'roman_sword_cavalry', 'captain', 'ranger')).toBeNull()
  })

  it('saves and resumes tutorial Captain, referee and player travel from the durable physical checkpoint', () => {
    const h = travelingDuel('MARCHING')
    h.opponent.combatantId = 'ranger'
    h.residents[1].spec.id = 'ranger'; h.residents[1].spec.role = 'ranger'
    const current = h.read(); delete current.activeMission
    current.activeMission = createCareerTutorialDuelMission(current, 'roman_sword_cavalry', 'captain', 'ranger')!
    h.read().activeMission!.phase = 'MARCHING'
    expect(h.controller.startActiveMission()).toBe(true)
    h.captain.combatPosition.set(91, getTerrainHeight(91, -31), -31)
    h.opponent.combatPosition.set(95, getTerrainHeight(95, -29), -29)
    h.player.combatPosition.set(88, getTerrainHeight(88, -27) + .9, -27)
    const expectedCaptain = h.captain.combatPosition.clone(), expectedReferee = h.opponent.combatPosition.clone()
    const expectedPlayer = h.player.combatPosition.clone()
    h.controller.persistRuntimeProgress(true)
    const parsed = parseCareerProfile(JSON.parse(JSON.stringify(h.read())))!
    expect(Object.keys(parsed.activeMission!.duelTravel!.actors).sort()).toEqual(['captain', 'ranger'])
    expect(parsed.activeMission!.duelTravel!.player).toMatchObject({ x: 88, z: -27 })
    h.controller.cleanupMission()
    Object.assign(h.read(), parsed)
    h.captain.combatPosition.set(-30, getTerrainHeight(-30, 20), 20)
    h.opponent.combatPosition.set(-60, getTerrainHeight(-60, 0), 0)
    h.player.combatPosition.set(-90, getTerrainHeight(-90, 10) + .9, 10)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.captain.combatPosition).toEqual(expectedCaptain)
    expect(h.opponent.combatPosition).toEqual(expectedReferee)
    expect(h.player.combatPosition).toEqual(expectedPlayer)
    expect(h.read().duelHighestDefeatedTierByPreset).toBeUndefined()
  })

  it('maps ordinary Duel identity HP by faction and tier without healing injuries or zero HP', () => {
    const expected = { roman: [100, 150, 200], viking: [90, 135, 180] } as const
    for (const faction of ['roman', 'viking'] as const) for (const tier of [1, 2, 3] as const) {
      const maxHp = expected[faction][tier - 1]
      expect(careerDuelOpponentHealth(faction, tier, 100, 200)).toEqual({ maxHp, hp: maxHp / 2 })
      expect(careerDuelOpponentHealth(faction, tier, 0, 200)).toEqual({ maxHp, hp: 0 })
    }
  })

  it('resumes a tiered opponent checkpoint without rescaling twice and restores borrowed identity on cleanup', () => {
    const h = travelingDuel('MARCHING')
    Object.assign(h.read().activeMission!, { duelTier: 2, duelOpponentHp: 45, duelOpponentMaxHp: 150 })
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.opponent.applyTemporaryOrdinaryTier).toHaveBeenCalledWith(2)
    expect(h.opponent.restoreCombatHealth).toHaveBeenCalledWith(45)
    expect(h.opponent.applyTemporaryCombatLoadout.mock.calls[0][1]).toBe(2)
    expect(h.captain.applyTemporaryOrdinaryTier).not.toHaveBeenCalled()
    h.controller.cleanupMission()
    expect(h.opponent.restoreOrdinaryTier).toHaveBeenCalledOnce()
    expect(h.opponent.restoreCombatLoadout).toHaveBeenCalledOnce()
  })

  it('starts an accepted or legacy assembling Duel from the Captain actual position without a barracks rendezvous', () => {
    const { controller, captain, opponent, player, query } = travelingDuel('ASSEMBLING')
    const captainStart = captain.combatPosition.clone(), opponentStart = opponent.combatPosition.clone(), playerStart = player.combatPosition.clone()
    expect(player.combatPosition.distanceTo(captain.combatPosition)).toBeGreaterThan(12)
    expect(controller.startActiveMission()).toBe(true)
    expect(controller.phase).toBe('MARCHING')
    expect(opponent.applyTemporaryOrdinaryTier).toHaveBeenCalledWith(1)
    expect(opponent.restoreCombatHealth).toHaveBeenCalledWith(50)
    expect(opponent.applyTemporaryCombatLoadout.mock.calls[0][1]).toBe(1)
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

  it('commits return before routing to the Captain service home, supports checkpoint recovery, and replans safely', () => {
    const h = travelingDuel('RESULT')
    expect(h.controller.startActiveMission()).toBe(true)
    const captainStart = h.captain.combatPosition.clone(), opponentStart = h.opponent.combatPosition.clone()
    const playerStart = h.player.combatPosition.clone(), result = structuredClone(h.read().activeMission!.result)
    h.allowSave(false)
    expect(h.controller.beginReturn()).toBe(false)
    expect(h.controller.phase).toBe('RESULT')
    expect(h.query).not.toHaveBeenCalled()
    h.allowSave(true)
    expect(h.controller.beginReturn()).toBe(true)
    const home = h.residents[0].spec, target = new Vector3(home.x, getTerrainHeight(home.x, home.z), home.z)
    expect(h.controller.guideTarget).toEqual(target)
    expect(h.query.mock.calls[0]).toEqual([captainStart, target])
    expect(h.captain.combatPosition).toEqual(captainStart)
    expect(h.opponent.combatPosition).toEqual(opponentStart)
    expect(h.player.combatPosition).toEqual(playerStart)
    expect(h.read().activeMission!.result).toEqual(result)
    h.captain.combatPosition.copy(target); h.player.combatPosition.copy(target)
    expect(h.controller.returnComplete).toBe(false)
    h.opponent.combatPosition.copy(target).add(new Vector3(3, 0, 0))
    expect(h.controller.returnComplete).toBe(true)
  })
})

describe('Career Duel independent arena', () => {
  it('saves the chosen arena through storage, keeps legacy and tutorial duels in Town, and refuses or drops unknown arenas', () => {
    const profile = { ...createCareerProfile('viking'), tutorial: undefined }
    const mission = createCareerDuelMission(profile, 'viking_berserker', 1, 'soldier-1', 'captain', 'arena-duel', 'captain', 'armed', undefined, 'roman-colosseum')!
    expect(careerDuelArena(mission)).toBe('roman-colosseum')
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save({ ...profile, activeMission: mission })).toBe(true)
    expect(careerDuelArena(store.load()!.activeMission)).toBe('roman-colosseum')
    // A pre-arena save resumes in the Town forecourt; a corrupted ID falls back the same way.
    const legacy = createCareerDuelMission(profile, 'viking_berserker', 1, 'soldier-1', 'captain', 'legacy-duel')!
    expect(careerDuelArena(legacy)).toBeNull()
    const raw = JSON.parse(storage.getItem(CAREER_STORAGE_KEY)!)
    raw.activeMission.duelArenaId = 'forum'
    expect(careerDuelArena(parseCareerProfile(raw)!.activeMission)).toBeNull()
    expect(createCareerDuelMission(profile, 'viking_berserker', 1, 'soldier-1', 'captain', 'bad', 'captain', 'armed', undefined, 'forum' as never)).toBeNull()
    expect(careerDuelArena({ ...mission, duelTutorialCareerId: 'career-1' })).toBeNull()
  })

  it('places an accepted arena duel on its fixed slots and saves PREPARING without a march, or starts nothing when that save fails', () => {
    const venue: CareerDuelVenue = { area: new Vector3(), player: { x: 0, y: 0, z: -9, yaw: 0 },
      opponent: { x: 0, y: 0, z: 9, yaw: Math.PI }, referee: { x: 16, y: 0, z: 0, yaw: -Math.PI / 2 } }
    const refused = travelingDuel('ASSEMBLING', undefined, venue)
    refused.allowSave(false)
    expect(refused.controller.startActiveMission()).toBe(false)
    expect(refused.read().activeMission!.phase).toBe('ASSEMBLING')
    const { controller, captain, opponent, player, query, read } = travelingDuel('ASSEMBLING', undefined, venue)
    expect(controller.startActiveMission()).toBe(true)
    expect(read().activeMission!.phase).toBe('PREPARING')
    expect(query).not.toHaveBeenCalled()
    expect(controller.guideTarget).toBeNull()
    expect([opponent.target!.x, opponent.target!.z]).toEqual([0, 9])
    expect([captain.target!.x, captain.target!.z]).toEqual([16, 0])
    expect(player.group.position.toArray()).toEqual([0, 0.9, -9])
    controller.update(5)
    expect(controller.phase).toBe('ENGAGING')
    expect(controller.beginReturn()).toBe(false)
  })

  it('freezes combat on the decided result after a failed settlement save and retries that same settlement once', () => {
    const exitPointerLock = vi.fn()
    vi.stubGlobal('document', { exitPointerLock })
    onTestFinished(() => { vi.unstubAllGlobals() })
    // The real arena update/settlement methods on a plain host: no renderer, scene, actor or DOM is built.
    const scene = CareerDuelArenaScene.prototype as unknown as {
      settleFrame(this: object, outcome: 'victory' | null): void
      update(this: object, dt: number): void
    }
    const panels: string[] = []
    let retry: (() => void) | null = null, failSave = true
    const live = { player: { ...stats }, squads: [] }
    const player = { hp: 150, clearTownAction: vi.fn(), update: () => { throw new Error('player combat ran while frozen') } }
    const base = { ...createCareerProfile('roman'), tutorial: undefined }
    const host = Object.assign(Object.create(CareerDuelArenaScene.prototype) as object, {
      profile: duel(base, 'roman_heavy_infantry', 1, 'arena-settle'),
      store: { save: () => !failSave },
      disposed: false, settled: false, pendingSettlement: null, skillsDirty: false, elapsed: 0,
      duel: { snapshot: () => live, update: () => { throw new Error('duel clock ran while frozen') } },
      // An arrow still in flight: it would hit the player if shots advanced.
      shots: [{ arrow: { update() { player.hp -= 60 } } }],
      arena: { update: vi.fn() }, damageNumbers: { update: vi.fn() }, camera: {},
      input: { clear: vi.fn() }, player,
      openPanel(title: string) { panels.push(title) }, closePanel() {},
      button(_label: string, action: () => void) { retry = action },
      openResult(result: { outcome: string }) { panels.push(`result:${result.outcome}`) },
    }) as { profile: CareerProfile; input: { clear: () => void }; arena: { update: () => void } }
    const merit = host.profile.totalMerit
    const expected = claimCareerMission(cloneCareerProfile(host.profile), 'arena-settle', 'victory', { ...stats }).meritAwarded
    scene.settleFrame.call(host, 'victory')
    // The failed save releases the pointer and held input and opens one stable panel.
    expect([panels, exitPointerLock.mock.calls.length, vi.mocked(host.input.clear).mock.calls.length]).toEqual([['單挑結算尚未保存'], 1, 1])
    live.player.survived = false // A later hit would change the live stats; the frozen claim must not.
    for (let frame = 0; frame < 30; frame++) {
      scene.update.call(host, 1 / 60)
      scene.settleFrame.call(host, 'victory')
    }
    expect(player.hp).toBe(150) // No shot, AI or player combat advanced.
    expect(vi.mocked(host.arena.update).mock.calls.length).toBe(30) // Presentation still moves.
    expect(panels).toEqual(['單挑結算尚未保存'])
    expect([host.profile.totalMerit, host.profile.activeMission!.result, host.profile.claimedBattleIds]).toEqual([merit, undefined, []])
    failSave = false
    retry!()
    for (let frame = 0; frame < 30; frame++) scene.settleFrame.call(host, 'victory')
    expect(panels).toEqual(['單挑結算尚未保存', 'result:victory'])
    expect(host.profile.claimedBattleIds).toEqual(['arena-settle'])
    expect(host.profile.activeMission!.result!.stats.survived).toBe(true) // The decided snapshot, not the later one.
    expect(host.profile.totalMerit - merit).toBe(expected)
    expect(expected).toBeGreaterThan(0)
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
      duelHighestDefeatedTierByPreset: { viking_sword_cavalry: 4 } }, 'viking_sword_cavalry', 5, 'commander-duel')
    const commander = townCommanderSpec({ x: 0, z: 0, yaw: 0 })
    const roster = selectCareerDuelRoster([
      { spec: { ...commander, id: 'captain', role: 'captain' }, npc: { dead: false } as NPC },
      { spec: commander, npc: { dead: false } as NPC },
    ], null as unknown as Mount, profile.activeMission!.duelPresetId!, 5)
    expect(roster?.loadout).toMatchObject({ shieldId: 'viking_berserker_shield_t5', meleeWeaponId: 'paladin_mace_t4',
      rangedWeaponId: null, mountId: 'black-cat' })
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
    expect(restored.duelHighestDefeatedTierByPreset).toEqual({ viking_sword_cavalry: 5 })
    expect(restored.townCommanderRecovery).toEqual({ faction: 'viking', hp: 712, ammo: 13 })
    expect(restored.careerMissionCompletionsByTier).toBeUndefined()
  })

  it('settles tutorial Captain sparring once without official unlocks, mission statistics or a second outcome award', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'tutorial-sparring', templateId: CAREER_DUEL_TEMPLATE_ID, kind: 'duel', targetCampId: -1,
      phase: 'ENGAGING', targetActorIds: ['captain'], friendlyActorIds: ['ranger'], acceptedAt: 1,
      duelTier: 4, duelPresetId: 'roman_sword_cavalry', duelOpponentActorId: 'captain', duelCaptainActorId: 'captain', duelRefereeActorId: 'ranger',
      duelTutorialCareerId: profile.tutorial!.careerId }
    const claim = claimCareerMission(profile, 'tutorial-sparring', 'failure', { ...stats, survived: false })
    expect(claim.meritAwarded).toBe(20)
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(claim.profile)).toBe(true)
    const loaded = store.load()!
    expect(loaded.activeMission?.duelTutorialCareerId).toBe(profile.tutorial!.careerId)
    expect(loaded.tutorial?.duelOutcome).toBe('defeat')
    expect(loaded.tutorial?.rewards.duel).toBe(20)
    expect(loaded.totalMerit).toBe(20)
    expect(loaded.lifetimeStats).toEqual(profile.lifetimeStats)
    expect(loaded.duelHighestDefeatedTierByPreset).toBeUndefined()
    expect(loaded.tutorial?.settledMissionIds).toEqual([])
    expect(loaded.skills).toEqual(profile.skills)
    expect(claimCareerMission(loaded, 'tutorial-sparring', 'victory', stats).meritAwarded).toBe(0)
    const replay = clearCareerMission(loaded, 'tutorial-sparring')
    replay.activeMission = { ...profile.activeMission, id: 'tutorial-sparring-replay' }
    expect(claimCareerMission(replay, 'tutorial-sparring-replay', 'victory', stats).profile.totalMerit).toBe(20)
    const stale = structuredClone(profile)
    stale.activeMission!.duelTutorialCareerId = 'another-career'
    expect(store.save(stale)).toBe(false)
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
    Object.assign(profile.activeMission!, { phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11, duelOpponentMaxHp: 100,
      duelOpponentMountHp: 8, duelOpponentDead: false, playerStats: { ...stats }, playerDead: true, followVoicePlayed: true })
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    expect(storage.getItem(CAREER_STORAGE_KEY)).not.toBeNull()
    const loaded = store.load()!
    expect(loaded.activeMission).toMatchObject({ id: 'resume-duel', templateId: CAREER_DUEL_TEMPLATE_ID, kind: 'duel', targetCampId: -1,
      duelTier: 1, duelPresetId: 'roman_archer', duelOpponentActorId: 'soldier-1', duelCaptainActorId: 'captain', duelRefereeActorId: 'captain',
      phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 24.6, duelOpponentHp: 11, duelOpponentMaxHp: 100, duelOpponentMountHp: 8,
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

function duelDamage(method: 'melee' | 'projectile' | 'mount-impact' = 'melee', weaponId = 'unarmed'): CombatEvent {
  return { type: 'damage_applied', source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
    target: { targetId: 'soldier-1', targetType: 'npc', name: 'opponent' }, method, weaponId,
    attackSource: weaponId === 'unarmed' && method === 'melee' ? 'unarmed' : undefined,
    contactKind: 'body', requestedDamage: 5, appliedDamage: 5 }
}

describe('Unarmed Duel authority and persistence', () => {
  it('空手勝利只解鎖自己的下一 Tier，舊存檔預設武裝模式且不取得空手進度', () => {
    const profile = createCareerProfile('roman')
    expect(isUnarmedDuelUnlocked(profile, 2)).toBe(false)
    expect(createCareerDuelMission(profile, 'roman_archer', 2, 'soldier-1', 'captain', 'locked', 'captain', 'unarmed')).toBeNull()
    profile.activeMission = createCareerDuelMission(profile, 'roman_archer', 1, 'soldier-1', 'captain', 'boxing', 'captain', 'unarmed')!
    profile.activeMission.phase = 'ENGAGING'
    const claimed = claimCareerMission(profile, 'boxing', 'victory', stats)
    expect(claimed.profile.unarmedDuelHighestDefeatedTier).toBe(1)
    expect(claimed.profile.duelHighestDefeatedTierByPreset).toBeUndefined()
    expect(isUnarmedDuelUnlocked(claimed.profile, 2)).toBe(true)
    expect(isCareerDuelUnlocked(claimed.profile, 'roman_archer', 2)).toBe(false)
    expect(claimCareerMission(claimed.profile, 'boxing', 'victory', stats).alreadyClaimed).toBe(true)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(claimed.profile)))!.unarmedDuelHighestDefeatedTier).toBe(1)
    const legacy = duel(createCareerProfile('roman'), 'roman_archer', 1)
    delete legacy.activeMission!.duelMode
    expect(parseCareerProfile(JSON.parse(JSON.stringify(legacy)))!.activeMission!.duelMode).toBe('armed')
    expect(parseCareerProfile(JSON.parse(JSON.stringify(legacy)))!.unarmedDuelHighestDefeatedTier).toBeUndefined()
  })
  it('空手 90 秒、武裝 30 秒且倒數仍 5 秒；空手剩餘時間可存檔恢復', () => {
    const h = travelingDuel('MARCHING')
    Object.assign(h.read().activeMission!, { duelMode: 'unarmed', phase: 'PREPARING', duelCombatElapsed: 45 })
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.countdownRemaining).toBe(5)
    h.controller.update(4.9)
    expect(h.controller.phase).toBe('PREPARING')
    h.controller.update(.1)
    expect(h.controller.phase).toBe('ENGAGING')
    expect(h.controller.combatRemaining).toBe(45)
    h.controller.persistRuntimeProgress(true)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(h.read())))!.activeMission!.duelCombatElapsed).toBe(45)
    expect(duelCombatSeconds('unarmed')).toBe(90)
    expect(duelCombatSeconds()).toBe(30)
    expect(resolveCareerDuelOutcome(false, false, 89.99, 'unarmed')).toBeNull()
    expect(resolveCareerDuelOutcome(false, false, 90, 'unarmed')).toBe('failure')
    expect(resolveCareerDuelOutcome(false, false, 30)).toBe('failure')
  })
  it('空手與 T5、教學對戰保存實體移動 checkpoint；武裝 T1-T4 不保存', () => {
    expect(persistsDuelTravel({ duelMode: 'unarmed', duelTier: 2 })).toBe(true)
    expect(persistsDuelTravel({ duelTier: 5 })).toBe(true)
    expect(persistsDuelTravel({ duelTutorialCareerId: 'x' })).toBe(true)
    expect(persistsDuelTravel({ duelTier: 3 })).toBe(false)
    expect(persistsDuelTravel({ duelMode: 'armed', duelTier: 4 })).toBe(false)
  })
  it('空手借用裝備與坐騎後還原原始資源，玩家存檔偏好不被清空', () => {
    const h = travelingDuel('MARCHING')
    const mount = { dead: false } as Mount
    h.player.currentMount = mount
    Object.assign(h.read().activeMission!, { duelMode: 'unarmed', duelPlayerWasMounted: true,
      duelCommanderHome: { hp: 123, ammo: 17 } })
    const equipment = JSON.stringify(h.read().equipment)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.player.currentMount).toBeNull()
    expect(h.player.unarmedDuelOnly).toBe(true)
    expect(h.opponent.setUnarmedDuel).toHaveBeenCalledWith(true)
    expect(h.opponent.applyTemporaryCombatLoadout.mock.calls[0][0]).toEqual({ meleeWeaponId: null, rangedWeaponId: null, shieldId: null })
    h.controller.cleanupMission()
    expect(h.opponent.setUnarmedDuel).toHaveBeenLastCalledWith(false)
    expect(h.opponent.restoreCombatHealth).toHaveBeenLastCalledWith(123)
    expect(h.opponent.restoreCombatAmmo).toHaveBeenLastCalledWith(17)
    expect(h.player.unarmedDuelOnly).toBe(false)
    expect(h.player.currentMount).toBe(mount)
    expect(JSON.stringify(h.read().equipment)).toBe(equipment)
    const returned = clearCareerMission(h.read(), h.read().activeMission!.id)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(returned)))!.townDuelResidentRecovery).toEqual({ hp: 123, ammo: 17, faction: 'roman', actorId: 'soldier-1' })
  })
  it('違規攻擊（武器、私兵）對對手造成有效傷害立即判負，致命違規優先於勝利且不能重複結算', () => {
    for (const [method, weaponId, owned] of [
      ['melee', 'steel_sword', false],
      ['melee', 'unarmed', true],
    ] as const) {
      const h = travelingDuel('MARCHING')
      Object.assign(h.read().activeMission!, { duelMode: 'unarmed', phase: 'ENGAGING' })
      expect(h.controller.startActiveMission()).toBe(true)
      const event = duelDamage(method, weaponId)
      if (owned) event.source = { ...event.source, actorType: 'npc', actorId: 'private-1', ownership: 'player-personal' }
      h.opponent.dead = true
      h.controller.recordCombatEvent(event)
      expect(h.read().activeMission!.duelFailureReason).toBe('illegal_attack')
      expect(h.controller.combatEnabled).toBe(false)
      expect(h.controller.evaluate()).toBe('failure')
      const loaded = parseCareerProfile(JSON.parse(JSON.stringify(h.read())))!
      expect(loaded.activeMission!.duelFailureReason).toBe('illegal_attack')
      const claim = claimCareerMission(loaded, loaded.activeMission!.id, 'victory', stats)
      expect(claim.profile.activeMission!.result!.outcome).toBe('failure')
      expect(claim.profile.unarmedDuelHighestDefeatedTier).toBeUndefined()
      expect(claimCareerMission(claim.profile, loaded.activeMission!.id, 'victory', stats).alreadyClaimed).toBe(true)
    }
  })
  it('存檔失敗時鎖定違規結算，重試保存前不能用致命傷害結算勝利', () => {
    const h = travelingDuel('MARCHING')
    Object.assign(h.read().activeMission!, { duelMode: 'unarmed', phase: 'ENGAGING' })
    h.controller.startActiveMission()
    h.allowSave(false); h.opponent.dead = true
    h.controller.recordCombatEvent(duelDamage('melee', 'steel_sword'))
    expect(h.controller.combatEnabled).toBe(false)
    expect(h.controller.evaluate()).toBeNull()
    expect(h.read().activeMission!.duelFailureReason).toBeUndefined()
    h.allowSave(true)
    expect(h.controller.evaluate()).toBe('failure')
    expect(h.read().activeMission!.duelFailureReason).toBe('illegal_attack')
  })
  it('合法拳擊可勝利；空揮、零傷格擋與 NPC 打玩家不觸發違規', () => {
    const h = travelingDuel('MARCHING')
    Object.assign(h.read().activeMission!, { duelMode: 'unarmed', phase: 'ENGAGING' })
    h.controller.startActiveMission()
    const legal = duelDamage()
    expect(isIllegalUnarmedDuelDamage(h.read().activeMission!, legal)).toBe(false)
    const zero = duelDamage('projectile', 'bow_t1')
    if (zero.type === 'damage_applied') zero.appliedDamage = 0
    h.controller.recordCombatEvent(zero)
    h.controller.recordCombatEvent({ ...legal, source: { ...legal.source, actorType: 'npc', actorId: 'soldier-1', allegiance: Faction.TOWN },
      target: { targetId: 'player', targetType: 'player', name: 'player' } })
    h.controller.recordCombatEvent(legal)
    h.opponent.dead = true
    expect(h.controller.evaluate()).toBe('victory')
    expect(h.read().activeMission!.duelFailureReason).toBeUndefined()
  })
})

describe('Career Duel hero class selection', () => {
  const classIds = (faction: 'roman' | 'viking', preset: UnitPresetId, tier: number) => careerDuelClassOptions(faction, preset, tier).map(option => option.combatProfileId)
  const heavyDuel = (extra: Record<string, unknown> = {}, createOpponent: (request: CareerDuelOpponentRequest) => NPC | null = () => null) => {
    const h = travelingDuel('MARCHING', createOpponent)
    Object.assign(h.captain, { combatProfileId: 'praetorian', dispose: vi.fn() }); Object.assign(h.captain.group, { visible: true })
    Object.assign(h.read().activeMission!, { duelTier: 4, duelPresetId: 'roman_heavy_infantry', duelOpponentActorId: 'captain', duelRefereeActorId: 'soldier-1',
      duelClassId: 'centurion', duelOpponentHp: 700, ...extra })
    return h
  }

  it('offers each faction elite classes and shields, leaving default classes on army shield', () => {
    expect(classIds('roman', 'roman_sword_cavalry', 4)).toEqual(['praetorian', 'centurion'])
    expect(classIds('roman', 'roman_sword_cavalry', 5)).toEqual(['roman-commander', 'byzantine-cataphract'])
    expect(classIds('viking', 'viking_berserker', 4)).toEqual(['varangian', 'dragon-oathguard'])
    expect(classIds('viking', 'viking_berserker', 5)).toEqual(['viking-commander', 'ironblood-warlord'])
    expect([classIds('roman', 'roman_archer', 4), classIds('roman', 'roman_sword_cavalry', 3), classIds('viking', 'roman_sword_cavalry', 4)]).toEqual([[], [], []])
    const profile = { ...createCareerProfile('roman'), duelHighestDefeatedTierByPreset: { roman_sword_cavalry: 3 as CareerDuelTier } }
    const create = (classId?: Parameters<typeof createCareerDuelMission>[8], preset: UnitPresetId = 'roman_sword_cavalry', mode: 'armed' | 'unarmed' = 'armed') =>
      createCareerDuelMission(profile, preset, 4, 'captain', 'captain', 'class-duel', 'ranger', mode, classId)
    expect(create()).toMatchObject({ duelClassId: 'praetorian' })
    const mission = create('centurion')!
    expect(mission.duelClassId).toBe('centurion')
    expect([create('ironblood-warlord'), create('centurion', 'roman_archer'), create('centurion', 'roman_sword_cavalry', 'unarmed')]).toEqual([null, null, null])
    const won = clearCareerMission(claimCareerMission({ ...profile, activeMission: mission }, 'class-duel', 'victory', stats).profile, 'class-duel')
    expect(won.duelHighestDefeatedTierByPreset).toEqual({ roman_sword_cavalry: 4 })
    expect(isCareerDuelUnlocked(won, 'roman_sword_cavalry', 5)).toBe(true)

    const shield = (preset: UnitPresetId, tier: 4 | 5, id: Parameters<typeof resolveCareerDuelClass>[3]) =>
      duelLoadout(preset, tier, resolveCareerDuelClass(preset.startsWith('roman') ? 'roman' : 'viking', preset, tier, id)).shieldId
    expect([shield('roman_heavy_infantry', 4, 'centurion'), shield('viking_berserker', 4, 'dragon-oathguard'),
      shield('roman_heavy_infantry', 5, 'byzantine-cataphract'), shield('roman_heavy_cavalry', 5, 'byzantine-cataphract')])
      .toEqual(['centurion_aquila_shield_t4', 'viking_dragonward_shield_t4', 'byzantine_eagle_shield_t5', 'byzantine_eagle_shield_t5'])
    expect([shield('roman_heavy_infantry', 4, 'praetorian'), shield('viking_berserker', 4, 'varangian'), shield('viking_berserker', 5, 'ironblood-warlord')])
      .toEqual(['roman_officer_shield_t4', 'paladin_shield_t4', 'viking_berserker_shield_t5'])
    expect(shield('roman_spearman', 4, 'centurion')).toBeNull()
  })
  it('persists the chosen class through save and reload, and an old or illegal record falls back to the original class', () => {
    const profile: CareerProfile = { ...createCareerProfile('roman'), duelHighestDefeatedTierByPreset: { roman_sword_cavalry: 3 } }
    const mission = createCareerDuelMission(profile, 'roman_sword_cavalry', 4, 'captain', 'captain', 'class-duel', 'ranger', 'armed', 'centurion')!
    const reload = (duelClassId?: string) => {
      const { duelClassId: _drop, ...rest } = mission
      return parseCareerProfile(JSON.parse(JSON.stringify({ ...profile, activeMission: { ...rest, ...(duelClassId ? { duelClassId } : {}) } })))!.activeMission!
    }
    expect(reload('centurion').duelClassId).toBe('centurion')
    expect(reload().duelClassId).toBeUndefined()
    expect(reload('ironblood-warlord').duelClassId).toBeUndefined()
  })

  it('fights the chosen class in a temporary body while the resident stays parked, unchanged, and returns on cleanup', () => {
    const dispose = vi.fn(), body = Object.assign(makeActor('captain', -30, 20), { combatProfileId: 'centurion', dispose })
    const requests: CareerDuelOpponentRequest[] = []
    const h = heavyDuel({}, request => { requests.push(request); return body as unknown as NPC }), { controller } = h
    expect(controller.startActiveMission()).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ presetId: 'roman_heavy_infantry', hero: { combatProfileId: 'centurion', visualAssetId: 'roman-centurion-t4' } })
    expect([controller.opponent, controller.captain]).toEqual([body, body])
    expect(controller.actors).not.toContain(h.captain)
    expect((h.captain.group as { visible?: boolean }).visible).toBe(false)
    expect(controller.isParkedResident(h.captain as unknown as NPC)).toBe(true)
    expect(h.captain.applyTemporaryCombatLoadout).not.toHaveBeenCalled()
    expect(body.restoreCombatHealth).toHaveBeenCalledWith(700)
    // The parked resident is never touched; the temporary body is the real, damageable target.
    expect(h.captain.restoreCombatHealth).not.toHaveBeenCalled()
    expect(controller.isParkedResident(body as unknown as NPC)).toBe(false)
    Object.assign(h.read().activeMission!, { phase: 'ENGAGING' })
    expect(controller.canDamageOpponent(body as unknown as NPC)).toBe(true)
    expect(controller.canDamageOpponent(h.captain as unknown as NPC)).toBe(false)
    expect(h.captain.hp).toBe(100)
    controller.cleanupMission()
    expect(dispose).toHaveBeenCalledOnce()
    expect(controller.isParkedResident(h.captain as unknown as NPC)).toBe(false)
    expect((h.captain.group as { visible?: boolean }).visible).toBe(true)
    expect(h.captain.restoreForTown).not.toHaveBeenCalled()
  })

  it('borrows the resident for its own class, and a body that cannot be built starts no duel and hides nothing', () => {
    const native = heavyDuel({ duelClassId: 'praetorian' })
    expect(native.controller.startActiveMission()).toBe(true)
    expect(native.controller.opponent).toBe(native.captain)
    expect(native.captain.applyTemporaryCombatLoadout).toHaveBeenCalledOnce()
    const failed = heavyDuel()
    expect(failed.controller.startActiveMission()).toBe(false)
    expect((failed.captain.group as { visible?: boolean }).visible).toBe(true)
    expect(failed.controller.opponent).toBeNull()
  })
})

it('keeps duel arena clear of unrelated residents, obstacles, riding roads and mounted muster', () => {
    const roster = townRoster(), navigation = { areConnected: () => true }
    const open = findTownDuelArena([], navigation, roster)
    expect(open).not.toBeNull()
    const visitor = { ...roster.find(s => s.role === 'civilian')!, id: 'civilian-visitor', x: TOWN_DUEL_CENTER.x, z: TOWN_DUEL_CENTER.z }
    expect(findTownDuelArena([], navigation, [...roster, visitor])).toBeNull()
    expect(findTownDuelArena([{ isBarricade: false, box: new Box3(new Vector3(-100, -100, -100), new Vector3(200, 100, 100)) }], navigation, roster)).toBeNull()

    const area = open!
    const box = (x: number, z: number, half: number) => new Box3(new Vector3(x - half, -100, z - half), new Vector3(x + half, 100, z + half))
    expect(townDuelAreaClear(box(area.x, area.z, DUEL_ARENA_HALF_SIZE))).toBe(true)
    for (const road of [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS]) {
      expect(townDuelAreaClear(box((road.ax + road.bx) / 2, (road.az + road.bz) / 2, 1))).toBe(false)
    }
    expect(townDuelAreaClear(box(TOWN_MOUNTED_MISSION_MUSTER.x, TOWN_MOUNTED_MISSION_MUSTER.z, 1))).toBe(false)
  })
