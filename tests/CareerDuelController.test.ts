import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ROMAN_PRESET_IDS, UNIT_PRESETS, VIKING_PRESET_IDS, type UnitLoadout, type UnitPresetId, type UnitTier } from '../src/battle/UnitPresetCatalog'
import { applyHeroIncomingDamage } from '../src/battle/T4HeroCatalog'
import { CareerDuelController, selectCareerDuelRoster, type CareerDuelResident } from '../src/career/CareerDuelController'
import { createCareerProfile, type CareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import type { CareerMissionPhase } from '../src/career/CareerMissionState'
import type { NavigationWorld } from '../src/navigation/NavigationWorld'
import type { Player } from '../src/player/Player'
import type { TownWorld } from '../src/town/TownWorld'
import { TownEvent, townRoster, townMilitaryEquipment } from '../src/town/TownRules'
import type { Mount } from '../src/world/Mount'
import { Faction, type NPC } from '../src/world/NPC'

function mountStub() {
  const mount = {
    group: new THREE.Group(), dead: false, currentHp: 100, maxHp: 100, riderNpc: null as unknown,
    catVisual: { setEquipmentVisible: vi.fn() },
    releaseRider: vi.fn(() => { mount.riderNpc = null }),
    takeDamage: vi.fn((amount: number) => { mount.currentHp = Math.max(0, mount.currentHp - amount); mount.dead = mount.currentHp === 0; if (mount.dead) mount.riderNpc = null }),
  }
  return mount as unknown as Mount
}

function actorStub(id: string, presetId?: UnitPresetId, canonical: UnitLoadout = {}) {
  const npc = {
    combatantId: id, name: id, faction: Faction.TOWN, characterFaction: 'roman', presetId,
    group: new THREE.Group(), dead: false, hp: 100, maxHp: 100, mount: null as Mount | null, respawnEnabled: false,
    loadout: { ...canonical }, equipped: { ...canonical }, duelHostile: false, townHostile: false, combatAmmo: canonical.rangedWeaponId ? 30 : 0,
    combatProfileId: id === 'captain' ? 'praetorian' as const : undefined,
    get combatPosition() { return this.mount ? this.mount.group.position : this.group.position },
    setDuelHostility: vi.fn((active: boolean) => { npc.duelHostile = active }),
    applyTemporaryCombatLoadout: vi.fn((loadout: UnitLoadout) => { npc.equipped = { ...loadout } }),
    restoreCombatLoadout: vi.fn(() => { npc.equipped = { ...npc.loadout } }),
    restoreCombatAmmo: vi.fn((ammo: number) => { npc.combatAmmo = Math.max(0, Math.floor(ammo)) }),
    setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(),
    mountVehicle: vi.fn((mount: Mount) => { npc.mount = mount; mount.riderNpc = npc as unknown as NPC }),
    dismountFromMount: vi.fn(() => { if (npc.mount) npc.mount.releaseRider(); npc.mount = null }),
    takeDamage: vi.fn((amount: number) => { npc.hp = Math.max(0, npc.hp - applyHeroIncomingDamage(amount, npc.combatProfileId)); npc.dead = npc.hp === 0; if (npc.dead) npc.dismountFromMount() }),
  }
  return npc as unknown as NPC
}

function harness(faction: 'roman' | 'viking' = 'roman', initial?: CareerProfile) {
  const blackCat = mountStub()
  const residents: CareerDuelResident[] = townRoster().filter(spec => spec.role !== 'cat').map(spec => {
    const equipment = townMilitaryEquipment(faction, spec.role)
    const loadout = spec.role === 'ranger' ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: 'maki-ranger-bow-ranged', shieldId: null, mountId: null } : equipment.loadout
    const npc = actorStub(spec.id, equipment.presetId, loadout)
    npc.group.position.set(spec.x, 0, spec.z)
    const homeMount = spec.role.includes('cavalry') || spec.role === 'captain' ? mountStub() : undefined
    if (homeMount) { homeMount.group.position.copy(npc.group.position); npc.mountVehicle(homeMount) }
    return { spec, npc, homeMount }
  })
  const playerGroup = new THREE.Group()
  const player = {
    group: playerGroup, dead: false, hp: 100, staminaValue: 100, currentMount: null as Mount | null,
    get combatPosition() { return this.currentMount ? this.currentMount.group.position : this.group.position },
    faceDirection: vi.fn(), syncMountTransform: vi.fn(),
    setHp: vi.fn(function (this: { hp: number }, hp: number) { this.hp = hp }),
    setStamina: vi.fn(function (this: { staminaValue: number }, stamina: number) { this.staminaValue = stamina }),
  } as unknown as Player
  let profile = initial ?? { ...createCareerProfile(faction), duelHighestDefeatedTierByPreset: Object.fromEntries((faction === 'roman' ? ROMAN_PRESET_IDS : VIKING_PRESET_IDS).map(id => [id, 4])) }
  let saving = true
  const commit = vi.fn((next: CareerProfile) => { if (!saving) return false; profile = next; return true })
  const world = { obstacles: [], camps: [] } as unknown as TownWorld
  const navigation = {
    beginFrame: vi.fn(), areConnected: vi.fn(() => true), queryPath: vi.fn(() => ({ status: 'path', path: [] })),
    grid: { findNearestWalkableCell: vi.fn(), cellToWorld: vi.fn() },
  } as unknown as NavigationWorld
  const controller = new CareerDuelController(new THREE.Scene(), world, navigation, residents, blackCat, () => player, () => profile, commit)
  const start = (preset: UnitPresetId = `${faction}_archer`, tier: UnitTier = 1, phase: CareerMissionPhase = 'PREPARING') => {
    const mission = controller.createMission(preset, tier)
    if (!mission) throw new Error('test mission unavailable')
    profile = { ...profile, activeMission: { ...mission, phase } }
    expect(controller.startActiveMission()).toBe(true)
    return profile.activeMission!
  }
  return { controller, residents, player, blackCat, world, navigation, commit, start,
    get profile() { return profile },
    setProfile(next: CareerProfile) { profile = next },
    setSaving(next: boolean) { saving = next },
  }
}

describe('Career Duel existing actor and loadout selection', () => {
  for (const faction of ['roman', 'viking'] as const) {
    it.each(faction === 'roman' ? ROMAN_PRESET_IDS : VIKING_PRESET_IDS)(`${faction} %s reuses exact T1–T3 catalog gear and existing cavalry mounts`, preset => {
      for (const tier of [1, 2, 3] as const) {
        const h = harness(faction)
        const roster = selectCareerDuelRoster(h.residents, h.blackCat, preset, tier)!
        expect(roster.opponent.spec.role).toContain('_')
        expect(roster.opponent.spec.role).not.toBe('captain')
        const canonical = { ...roster.opponent.npc.loadout }
        h.start(preset, tier)
        expect(roster.opponent.npc.applyTemporaryCombatLoadout).toHaveBeenCalledWith(UNIT_PRESETS[preset].tierLoadouts[tier])
        expect(roster.opponent.npc.loadout).toEqual(canonical)
        if (UNIT_PRESETS[preset].tierLoadouts[tier].mountId) {
          expect(h.controller.opponent!.mount).toBe(roster.opponent.homeMount)
          expect(h.controller.opponent!.mount).not.toBe(h.blackCat)
        } else expect(h.controller.opponent!.mount).toBeNull()
        expect(h.controller.referee).toBe(h.controller.captain)
      }
    })
  }

  it.each(['roman_heavy_infantry', 'roman_spearman', 'roman_javelin_infantry', 'viking_berserker', 'viking_spearman'] as const)('T4 %s uses dismounted Captain with Maki referee and preserves hero identity', preset => {
    const h = harness(UNIT_PRESETS[preset].faction)
    h.start(preset, 4)
    expect(h.controller.opponent).toBe(h.controller.captain)
    expect(h.controller.opponent!.mount).toBeNull()
    expect(h.controller.referee!.combatantId).toBe('ranger')
    expect(h.profile.activeMission?.duelRefereeActorId).toBe('ranger')
    expect(h.controller.opponent!.applyTemporaryCombatLoadout).toHaveBeenCalledWith(UNIT_PRESETS[preset].tierLoadouts[3])
    expect(h.controller.opponent!.combatProfileId).toBe('praetorian')
  })

  it.each(['roman_sword_cavalry', 'roman_lancer', 'viking_sword_cavalry', 'viking_lancer'] as const)('T4 %s retains Captain own mount', preset => {
    const h = harness(UNIT_PRESETS[preset].faction)
    const captain = h.residents.find(resident => resident.spec.role === 'captain')!
    h.start(preset, 4)
    expect(h.controller.opponent).toBe(captain.npc)
    expect(h.controller.opponent!.mount).toBe(captain.homeMount)
    expect(h.controller.referee!.combatantId).toBe('ranger')
  })

  it.each(['roman_archer', 'viking_archer', 'roman_horse_archer', 'viking_horse_archer'] as const)('T4 %s reuses Maki Ranger; Horse Archer uses existing Black Cat', preset => {
    const h = harness(UNIT_PRESETS[preset].faction)
    const ranger = h.residents.find(resident => resident.spec.role === 'ranger')!.npc
    h.start(preset, 4)
    expect(h.controller.opponent).toBe(ranger)
    expect(h.controller.referee).toBe(h.controller.captain)
    expect(ranger.applyTemporaryCombatLoadout).toHaveBeenCalledWith(ranger.loadout)
    expect(ranger.mount).toBe(preset.endsWith('horse_archer') ? h.blackCat : null)
  })

  it('revalidates the requested tier during acceptance', () => {
    const h = harness('roman', createCareerProfile('roman'))
    expect(h.controller.createMission('roman_archer', 2)).toBeNull()
    expect(h.controller.createMission('viking_archer', 1)).toBeNull()
    expect(h.controller.createMission('unknown' as UnitPresetId, 1)).toBeNull()
    expect(h.controller.createMission('roman_archer', 7 as UnitTier)).toBeNull()
    expect(h.controller.createMission('roman_archer', 1)).not.toBeNull()
  })
})

describe('Career Duel phases, persistence, and damage isolation', () => {
  it('guides the player to assembly, the actual selected arena, and back to assembly', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ASSEMBLING')
    const assembly = h.controller.guideTarget!
    expect(assembly).not.toBeNull()
    h.player.group.position.copy(h.controller.captain!.combatPosition)
    h.controller.update(0)
    expect(h.controller.phase).toBe('MARCHING')
    const arena = h.controller.guideTarget!
    expect(arena.distanceTo(assembly)).toBeGreaterThan(20)
    h.controller.captain!.combatPosition.copy(arena)
    h.controller.opponent!.combatPosition.copy(arena)
    h.player.group.position.copy(arena)
    h.controller.update(0)
    expect(h.controller.phase).toBe('MARCHING')
    // Actors walk to their formation slots; arrival never moves them instantly.
    expect(h.controller.opponent!.combatPosition).toEqual(arena)
    expect(h.controller.captain!.combatPosition).toEqual(arena)
    for (const actor of h.controller.actors) {
      const command = vi.mocked(actor.assignFormationTarget).mock.calls.at(-1)!
      actor.combatPosition.copy(command[1])
    }
    h.controller.update(0)
    expect(h.controller.phase).toBe('PREPARING')
    expect(h.controller.guideTarget).toBeNull()
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, phase: 'RETURNING' } })
    expect(h.controller.guideTarget!.distanceTo(assembly)).toBe(0)
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, phase: 'RESULT' } })
    expect(h.controller.guideTarget).toBeNull()
  })

  it('saves each changed runtime snapshot immediately, retries current values, and does not force unchanged data', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ENGAGING')
    // Persist initial runtime fields before measuring unchanged writes.
    h.controller.persistRuntimeProgress()
    h.commit.mockClear()
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).not.toHaveBeenCalled()
    h.setSaving(false)
    h.player.setHp(60)
    h.controller.opponent!.restoreCombatAmmo(12)
    h.controller.update(.1)
    expect(h.profile.activeMission!.duelCombatElapsed).toBe(0)
    expect(h.profile.activeMission!.duelPlayerHp).toBe(100)
    h.player.setHp(41)
    h.player.setStamina(17)
    h.controller.opponent!.restoreCombatAmmo(9)
    h.setSaving(true)
    h.controller.persistRuntimeProgress()
    expect(h.profile.activeMission).toMatchObject({ duelCombatElapsed: .1, duelPlayerHp: 41, duelPlayerStamina: 17, duelOpponentAmmo: 9 })
    h.controller.update(.1)
    expect(h.profile.activeMission!.duelCombatElapsed).toBe(.2)
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).toHaveBeenCalledTimes(3)
  })

  it('blocks melee, projectile, and mount damage before the full five second countdown', () => {
    const h = harness()
    h.start('roman_lancer')
    const opponent = h.controller.opponent!, mount = opponent.mount!
    expect(h.controller.canDamageOpponent(opponent)).toBe(false)
    expect(h.controller.canDamageOpponent(mount)).toBe(false)
    expect(h.controller.canDamagePlayer(opponent)).toBe(false)
    h.controller.update(4.99)
    expect(h.controller.phase).toBe('PREPARING')
    expect(opponent.setDuelHostility).not.toHaveBeenCalledWith(true)
    h.controller.update(.01)
    expect(h.controller.phase).toBe('ENGAGING')
    expect(h.controller.canDamageOpponent(opponent)).toBe(true)
    expect(h.controller.canDamageOpponent(mount)).toBe(true)
    expect(opponent.setDuelHostility).toHaveBeenLastCalledWith(true)
  })

  it('times out at 30 seconds, gives player death immediate failure, and opponent death victory', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ENGAGING')
    h.controller.update(29.9)
    expect(h.controller.outcome).toBeNull()
    h.controller.update(.1)
    expect(h.controller.outcome).toBe('failure')
    expect(h.controller.combatEnabled).toBe(false)
    const death = harness()
    death.start('roman_archer', 1, 'ASSEMBLING')
    death.player.dead = true
    expect(death.controller.outcome).toBe('failure')
    const victory = harness()
    victory.start('roman_archer', 1, 'ENGAGING')
    victory.controller.opponent!.takeDamage(1000)
    expect(victory.controller.outcome).toBe('victory')
    victory.player.dead = true
    expect(victory.controller.outcome).toBe('failure')
  })

  it('continues the timer away from the arena and ignores external kills while accepting third-party opponent death', () => {
    const h = harness(); h.start('roman_archer', 1, 'ENGAGING')
    const id = h.controller.opponent!.combatantId
    h.controller.update(5)
    h.player.group.position.set(-250, 0, 250)
    const bandit = h.residents.find(resident => resident.spec.role === 'civilian')!.npc
    h.controller.events.emit({ type: 'actor_killed', source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: bandit.combatantId, targetType: 'npc', name: 'Bandit' }, method: 'melee' })
    bandit.takeDamage(1000)
    h.controller.update(10)
    expect(h.controller.combatRemaining).toBe(15)
    expect(h.controller.outcome).toBeNull()
    expect(h.profile.activeMission!.duelOpponentActorId).toBe(id)
    expect(h.controller.snapshot().player.kills).toBe(0)
    h.controller.opponent!.takeDamage(1000)
    expect(h.controller.outcome).toBe('victory')
    expect(h.controller.snapshot().player.kills).toBe(0)
  })

  it('temporarily fights with Captain and resumes the same march from his actual position', () => {
    const h = harness(); h.start('roman_archer', 1, 'MARCHING')
    const captain = h.controller.captain!, location = captain.combatPosition.clone()
    const previous = vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1].clone()
    h.controller.setExternalCombat(captain, true)
    h.controller.setExternalCombat(captain, true)
    expect(captain.setTacticalOrder).toHaveBeenLastCalledWith('attack')
    captain.combatPosition.x -= 8
    const afterFight = captain.combatPosition.clone()
    h.controller.update(1)
    h.controller.setExternalCombat(captain, false)
    expect(captain.combatPosition).toEqual(afterFight)
    expect(captain.combatPosition).not.toEqual(location)
    expect(vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1]).toEqual(previous)
    expect(h.controller.phase).toBe('MARCHING')
    h.controller.cleanupMission()
    expect(h.controller.isMissionActor(captain)).toBe(false)
    const calls = vi.mocked(captain.assignFormationTarget).mock.calls.length
    h.controller.setExternalCombat(captain, false)
    expect(vi.mocked(captain.assignFormationTarget).mock.calls).toHaveLength(calls)
  })

  it.each(['roman', 'viking'] as const)('%s replaces fallen march leaders with referee, then surviving opponent, without resetting the route', faction => {
    const h = harness(faction)
    h.start(`${faction}_archer`, 1, 'ASSEMBLING')
    // Use three distinct mission residents to cover both fallback priorities.
    const ranger = h.residents.find(resident => resident.spec.role === 'ranger')!.npc
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, duelRefereeActorId: ranger.combatantId } })
    h.controller.startActiveMission()
    const captain = h.controller.captain!, opponent = h.controller.opponent!
    vi.mocked(h.navigation.queryPath).mockReturnValue({ status: 'path', path: [{ x: 40, z: 16 }, { x: 60, z: 16 }] })
    vi.mocked(h.navigation.grid.cellToWorld).mockImplementation(cell => new THREE.Vector3(cell.x, 0, cell.z))
    h.player.group.position.copy(captain.combatPosition)
    h.controller.update(0)
    captain.combatPosition.copy(vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1])
    h.controller.update(0)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    const remainingTarget = vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1].clone()
    const queries = vi.mocked(h.navigation.queryPath).mock.calls.length
    h.controller.setExternalCombat(captain, true)
    captain.takeDamage(1000)
    const rangerPosition = ranger.combatPosition.clone()
    h.controller.update(0)
    expect(ranger.combatPosition).toEqual(rangerPosition)
    expect(vi.mocked(ranger.assignFormationTarget).mock.calls.at(-1)![1]).toEqual(remainingTarget)
    expect(vi.mocked(opponent.assignFollowTarget).mock.calls.at(-1)![0]).toBe(ranger)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    h.controller.setExternalCombat(ranger, true)
    ranger.takeDamage(1000)
    const opponentPosition = opponent.combatPosition.clone()
    h.controller.update(0)
    expect(opponent.combatPosition).toEqual(opponentPosition)
    expect(vi.mocked(opponent.assignFormationTarget).mock.calls.at(-1)![1]).toEqual(remainingTarget)
    expect(h.navigation.queryPath).toHaveBeenCalledTimes(queries)
    // Arrive along the remaining path, then walk into the assigned duel slot.
    opponent.combatPosition.copy(remainingTarget)
    h.controller.update(0)
    expect(h.profile.activeMission!.routeStage).toBe(2)
    const arena = h.controller.guideTarget!.clone()
    opponent.combatPosition.copy(arena)
    h.player.group.position.copy(arena)
    h.controller.update(0)
    opponent.combatPosition.copy(vi.mocked(opponent.assignFormationTarget).mock.calls.at(-1)![1])
    h.controller.update(0)
    expect(h.controller.phase).toBe('PREPARING')
    h.controller.update(5)
    expect(h.controller.phase).toBe('ENGAGING')
    expect(h.controller.outcome).toBeNull()
  })

  it('does not wait for dead NPCs at the arena when the whole march party is killed', () => {
    const h = harness(); h.start('roman_archer', 1, 'MARCHING')
    for (const actor of h.controller.actors) actor.takeDamage(1000)
    h.player.group.position.copy(h.controller.guideTarget!)
    h.controller.update(0)
    expect(h.controller.phase).toBe('PREPARING')
    h.controller.update(5)
    expect(h.controller.outcome).toBe('victory')
  })

  it('reload keeps countdown, combat clock, actor ids, opponent health and mount health', () => {
    const h = harness()
    h.start('roman_lancer', 2)
    h.controller.update(2.5)
    const prepareReload = harness('roman', JSON.parse(JSON.stringify(h.profile)))
    expect(prepareReload.controller.startActiveMission()).toBe(true)
    expect(prepareReload.controller.countdownRemaining).toBe(2.5)
    prepareReload.controller.update(2.5)
    prepareReload.controller.update(17.2)
    prepareReload.controller.opponent!.takeDamage(35)
    prepareReload.controller.opponent!.mount!.takeDamage(40)
    prepareReload.controller.persistRuntimeProgress()
    const combatReload = harness('roman', JSON.parse(JSON.stringify(prepareReload.profile)))
    expect(combatReload.controller.startActiveMission()).toBe(true)
    expect(combatReload.controller.combatRemaining).toBeCloseTo(12.8)
    expect(combatReload.controller.opponent!.combatantId).toBe(h.controller.opponent!.combatantId)
    expect(combatReload.controller.opponent!.hp).toBe(65)
    expect(combatReload.controller.opponent!.mount!.currentHp).toBe(60)
    expect(combatReload.profile.activeMission!.id).toBe(h.profile.activeMission!.id)
  })

  it('reload restores player health/stamina and opponent ammunition without free healing or rearming', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ENGAGING')
    h.player.setHp(41)
    h.player.setStamina(17)
    h.controller.opponent!.restoreCombatAmmo(9)
    h.controller.persistRuntimeProgress()
    expect(h.profile.activeMission).toMatchObject({ duelPlayerHp: 41, duelPlayerStamina: 17, duelOpponentAmmo: 9 })
    const restored = parseCareerProfile(JSON.parse(JSON.stringify(h.profile)))!
    const reload = harness('roman', restored)
    expect(reload.controller.startActiveMission()).toBe(true)
    expect(reload.player.hp).toBe(41)
    expect(reload.player.staminaValue).toBe(17)
    expect(reload.controller.opponent!.combatAmmo).toBe(9)
  })

  it('rejects nonfinite and negative persisted health/stamina/ammo while preserving zero', () => {
    const h = harness()
    h.start()
    const invalid = parseCareerProfile({ ...h.profile, activeMission: { ...h.profile.activeMission, duelPlayerHp: -1, duelPlayerStamina: Infinity, duelOpponentAmmo: '30' } })!.activeMission!
    expect(invalid.duelPlayerHp).toBeUndefined()
    expect(invalid.duelPlayerStamina).toBeUndefined()
    expect(invalid.duelOpponentAmmo).toBeUndefined()
    const zero = parseCareerProfile({ ...h.profile, activeMission: { ...h.profile.activeMission, duelPlayerHp: 0, duelPlayerStamina: 0, duelOpponentAmmo: 0 } })!.activeMission!
    expect(zero).toMatchObject({ duelPlayerHp: 0, duelPlayerStamina: 0, duelOpponentAmmo: 0 })
  })

  it('only saves ASSEMBLING → MARCHING once before Follow Me, with no reload voice', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ASSEMBLING')
    const follow = vi.fn(() => expect(h.profile.activeMission!.phase).toBe('MARCHING'))
    h.controller.onMarchStarted = follow
    h.player.group.position.copy(h.controller.captain!.combatPosition)
    h.setSaving(false)
    h.controller.update(.1)
    expect(follow).not.toHaveBeenCalled()
    expect(h.controller.phase).toBe('ASSEMBLING')
    h.setSaving(true)
    h.controller.update(.1)
    h.controller.update(.1)
    expect(follow).toHaveBeenCalledTimes(1)
    const reload = harness('roman', JSON.parse(JSON.stringify(h.profile)))
    const reloadFollow = vi.fn()
    reload.controller.onMarchStarted = reloadFollow
    reload.controller.startActiveMission()
    reload.controller.update(.1)
    expect(reloadFollow).not.toHaveBeenCalled()
  })

  it('holds the countdown gate when ENGAGING cannot be persisted', () => {
    const h = harness()
    h.start()
    h.setSaving(false)
    h.controller.update(5)
    expect(h.controller.phase).toBe('PREPARING')
    expect(h.controller.combatEnabled).toBe(false)
    expect(h.controller.canDamageOpponent(h.controller.opponent!)).toBe(false)
    h.setSaving(true)
    h.controller.update(.1)
    expect(h.controller.phase).toBe('ENGAGING')
    expect(h.profile.activeMission!.duelCountdownElapsed).toBe(5)
  })

  it('only opponent targets Player; Captain remains referee without TownEvent hostility', () => {
    const h = harness()
    const townEvent = new TownEvent(townRoster())
    h.start('roman_lancer', 1, 'ENGAGING')
    const opponent = h.controller.opponent!, captain = h.controller.captain!
    expect(opponent.setDuelHostility).toHaveBeenLastCalledWith(true)
    expect(captain.setDuelHostility).not.toHaveBeenCalledWith(true)
    expect(captain.setTacticalOrder).not.toHaveBeenCalledWith('charge')
    expect(h.controller.combatPeersFor(opponent)).toEqual([])
    expect(h.controller.canDamageOpponent(captain)).toBe(false)
    expect(h.controller.canDamagePlayer(captain)).toBe(false)
    expect(h.controller.canDamageOpponent(h.blackCat)).toBe(false)
    expect(h.controller.isMissionActor(h.residents.find(resident => resident.spec.role === 'civilian')!.npc)).toBe(false)
    expect(townEvent.hostile).toBe(false)
    expect((opponent as unknown as { townHostile: boolean }).townHostile).toBe(false)
  })

  it('tracks only Player↔opponent damage and kills, resumes persisted totals, and rejects referee/unrelated damage', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ENGAGING')
    const player = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'roman' as const }
    const opponent = { actorId: h.controller.opponent!.combatantId, actorType: 'npc' as const, allegiance: Faction.TOWN, characterFaction: 'roman' as const }
    const target = { targetId: opponent.actorId, targetType: 'npc' as const, name: 'Opponent' }
    h.controller.events.emit({ type: 'damage_applied', source: player, target, method: 'melee', requestedDamage: 20, appliedDamage: 20 })
    h.controller.events.emit({ type: 'damage_applied', source: opponent, target: { targetId: 'player', targetType: 'player', name: 'Player' }, method: 'projectile', requestedDamage: 10, appliedDamage: 10 })
    h.controller.events.emit({ type: 'actor_killed', source: player, target, method: 'melee' })
    h.controller.events.emit({ type: 'damage_applied', source: player, target: { ...target, targetId: 'civilian-0' }, method: 'melee', requestedDamage: 100, appliedDamage: 100 })
    h.controller.events.emit({ type: 'damage_applied', source: { ...opponent, actorId: 'captain' }, target: { targetId: 'player', targetType: 'player', name: 'Player' }, method: 'melee', requestedDamage: 100, appliedDamage: 100 })
    expect(h.controller.snapshot().player).toMatchObject({ damageDealt: 20, damageTaken: 10, kills: 1 })
    h.controller.persistRuntimeProgress()
    const reload = harness('roman', JSON.parse(JSON.stringify(h.profile)))
    reload.controller.startActiveMission()
    expect(reload.controller.snapshot().player).toMatchObject({ damageDealt: 20, damageTaken: 10, kills: 1 })
  })
})

describe('Career Duel return and cleanup', () => {
  function result(h: ReturnType<typeof harness>, outcome: 'victory' | 'failure') {
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, phase: 'RESULT', result: {
      outcome, stats: h.controller.snapshot().player, merit: { damage: 0, kills: 0, contribution: 0, total: 0 }, claimed: true,
    } } })
  }

  it('plays Return only after valid saved physical return, once, and does not replay after reload', () => {
    const h = harness()
    h.start('roman_archer', 1, 'ENGAGING')
    expect(h.controller.startReturning()).toBe(false)
    result(h, 'failure')
    expect(h.controller.startReturning()).toBe(false)
    result(h, 'victory')
    const returned = vi.fn(() => expect(h.profile.activeMission!.phase).toBe('RETURNING'))
    h.controller.onReturnStarted = returned
    h.setSaving(false)
    expect(h.controller.startReturning()).toBe(false)
    expect(returned).not.toHaveBeenCalled()
    h.setSaving(true)
    expect(h.controller.startReturning()).toBe(true)
    expect(h.controller.startReturning()).toBe(false)
    expect(returned).toHaveBeenCalledTimes(1)
    const reload = harness('roman', JSON.parse(JSON.stringify(h.profile)))
    reload.controller.onReturnStarted = returned
    expect(reload.controller.startActiveMission()).toBe(true)
    expect(returned).toHaveBeenCalledTimes(1)
  })

  it('uses Maki to lead the return after defeating T4 Captain and leaves his corpse behind', () => {
    const h = harness()
    h.start('roman_heavy_infantry', 4, 'ENGAGING')
    const captain = h.controller.captain!, ranger = h.controller.referee!
    captain.takeDamage(1000)
    const captainFollowCalls = vi.mocked(captain.assignFollowTarget).mock.calls.length
    result(h, 'victory')
    expect(h.controller.startReturning()).toBe(true)
    expect(ranger.assignFormationTarget).toHaveBeenCalled()
    expect(vi.mocked(captain.assignFollowTarget).mock.calls.length).toBe(captainFollowCalls)
    expect(h.controller.returnComplete).toBe(false)
    const barracks = new THREE.Vector3(18, 0, 16)
    h.player.group.position.copy(barracks)
    ranger.group.position.copy(barracks)
    expect(h.controller.returnComplete).toBe(true)
  })

  it('reassigns the remaining return route when its leader is killed by an external enemy', () => {
    const h = harness(); h.start('roman_archer', 1, 'ENGAGING')
    const ranger = h.residents.find(resident => resident.spec.role === 'ranger')!.npc
    h.setProfile({ ...h.profile, activeMission: { ...h.profile.activeMission!, duelRefereeActorId: ranger.combatantId } })
    h.controller.startActiveMission()
    const captain = h.controller.captain!, opponent = h.controller.opponent!
    opponent.takeDamage(1000)
    result(h, 'victory')
    vi.mocked(h.navigation.queryPath).mockReturnValue({ status: 'path', path: [{ x: 70, z: 16 }, { x: 40, z: 16 }] })
    vi.mocked(h.navigation.grid.cellToWorld).mockImplementation(cell => new THREE.Vector3(cell.x, 0, cell.z))
    expect(h.controller.startReturning()).toBe(true)
    captain.combatPosition.copy(vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1])
    h.controller.update(0)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    const remainingTarget = vi.mocked(captain.assignFormationTarget).mock.calls.at(-1)![1].clone()
    const queries = vi.mocked(h.navigation.queryPath).mock.calls.length
    h.controller.setExternalCombat(captain, true)
    captain.takeDamage(1000)
    const rangerPosition = ranger.combatPosition.clone()
    h.controller.update(0)
    expect(ranger.combatPosition).toEqual(rangerPosition)
    expect(vi.mocked(ranger.assignFormationTarget).mock.calls.at(-1)![1]).toEqual(remainingTarget)
    expect(h.profile.activeMission!.routeStage).toBe(1)
    expect(h.navigation.queryPath).toHaveBeenCalledTimes(queries)
    ranger.combatPosition.copy(remainingTarget)
    h.controller.update(0)
    expect(h.profile.activeMission!.routeStage).toBe(2)
    ranger.combatPosition.copy(vi.mocked(ranger.assignFormationTarget).mock.calls.at(-1)![1])
    h.player.group.position.copy(h.controller.guideTarget!)
    h.controller.update(0)
    expect(h.controller.returnComplete).toBe(true)
  })

  it.each(['before', 'during'] as const)('lets Player complete return when all mission NPCs die %s the return starts', when => {
    const h = harness(); h.start('roman_heavy_infantry', 4, 'ENGAGING')
    result(h, 'victory')
    if (when === 'during') expect(h.controller.startReturning()).toBe(true)
    for (const actor of h.controller.actors) actor.takeDamage(1000)
    if (when === 'before') expect(h.controller.startReturning()).toBe(true)
    h.controller.update(0)
    expect(h.controller.returnComplete).toBe(false)
    h.player.group.position.copy(h.controller.guideTarget!)
    expect(h.controller.returnComplete).toBe(true)
  })

  it('restores RETURNING with no surviving NPC and still allows the player to finish', () => {
    const h = harness(); h.start('roman_heavy_infantry', 4, 'ENGAGING')
    result(h, 'victory')
    h.controller.opponent!.takeDamage(1000)
    h.controller.referee!.takeDamage(1000)
    expect(h.controller.startReturning()).toBe(true)
    const reload = harness('roman', JSON.parse(JSON.stringify(h.profile)))
    reload.residents.find(resident => resident.spec.role === 'ranger')!.npc.takeDamage(1000)
    expect(reload.controller.startActiveMission()).toBe(true)
    expect(reload.controller.actors.every(actor => actor.dead)).toBe(true)
    reload.controller.update(0)
    reload.player.group.position.copy(reload.controller.guideTarget!)
    expect(reload.controller.returnComplete).toBe(true)
  })

  it('cleanup restores canonical loadout and clears temporary hostility and movement without disposing Town actors or mounts', () => {
    const h = harness()
    h.start('roman_lancer', 1, 'ENGAGING')
    const actors = [...h.controller.actors], opponent = h.controller.opponent!, mount = opponent.mount!
    h.controller.cleanupMission()
    expect(opponent.restoreCombatLoadout).toHaveBeenCalled()
    expect((opponent as unknown as { equipped: UnitLoadout }).equipped).toEqual(opponent.loadout)
    for (const actor of actors) {
      expect(actor.setDuelHostility).toHaveBeenLastCalledWith(false)
      expect(actor.setTacticalOrder).toHaveBeenLastCalledWith('attack')
    }
    expect(h.controller.actors).toEqual([])
    expect(h.controller.allMounts).toEqual([])
    expect(h.controller.opponent).toBeNull()
    expect(h.controller.captain).toBeNull()
    expect(mount.dead).toBe(false)
    expect(actors.every(actor => !actor.dead)).toBe(true)
  })
})
