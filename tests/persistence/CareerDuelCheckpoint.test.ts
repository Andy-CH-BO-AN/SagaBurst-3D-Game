import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { CareerDuelController, type CareerDuelResident } from '../../src/career/CareerDuelController'
import type { CareerDuelTier } from '../../src/career/CareerDuelState'
import type { CareerMissionPhase } from '../../src/career/CareerMissionState'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { townCommanderSpec } from '../../src/town/TownCommander'
import { townRoster } from '../../src/town/TownRules'
import type { TownWorld } from '../../src/town/TownWorld'
import type { Mount } from '../../src/world/Mount'
import { Faction, type NPC } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'

// Persistence policy only: four resident data doubles, no real NPC/Mount, TownWorld, navigation or asset builds.
// Positions are assigned inputs; these doubles do not test locomotion or combat damage calculation.
function residentState(id: string) {
  const state = {
    combatantId: id, name: id, faction: Faction.TOWN, characterFaction: 'roman',
    presetId: 'roman_archer' as UnitPresetId, loadout: { ...UNIT_PRESETS.roman_archer.tierLoadouts[1] },
    group: new THREE.Group(), mount: null, hp: 100, dead: false, combatAmmo: 30,
    get combatPosition() { return state.group.position },
    setDuelHostility: vi.fn(), setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(),
    applyTemporaryCombatLoadout: (_loadout: UnitLoadout) => {}, restoreCombatLoadout: () => {}, dismountFromMount: () => {},
    restoreCombatHealth: (hp: number) => { state.hp = hp; state.dead = hp <= 0 },
    restoreCombatAmmo: (ammo: number) => { state.combatAmmo = ammo },
    takeDamage: (amount: number) => { state.hp = Math.max(0, state.hp - amount); state.dead = state.hp === 0 },
    restoreForTown: () => { state.hp = 100; state.dead = false },
  }
  return state
}

function fixture(tier: CareerDuelTier = 5, phase: CareerMissionPhase = 'ENGAGING', storage = new MemoryStorage()) {
  const store = new CareerProfileStore(storage)
  let profile = store.load() ?? { ...createCareerProfile('roman'), rank: 'commander' as const,
    duelHighestDefeatedTierByPreset: { roman_archer: 4, roman_heavy_infantry: 4 } }
  const specs = [townRoster().find(spec => spec.duty === 'training' && !spec.mounted)!,
    townRoster().find(spec => spec.role === 'captain')!, townRoster().find(spec => spec.role === 'ranger')!,
    townCommanderSpec({ x: 20, z: 20, yaw: 0 })]
  const states = specs.map(spec => residentState(spec.id))
  // Narrow actor boundary: only the fields consumed by Duel setup, flow and checkpointing are provided.
  const residents: CareerDuelResident[] = specs.map((spec, index) => ({ spec, npc: states[index] as unknown as NPC }))
  const playerState = {
    group: new THREE.Group(), hp: 100, staminaValue: 100, dead: false, currentMount: null,
    get combatPosition() { return playerState.group.position },
    setHp: (hp: number) => { playerState.hp = hp }, setStamina: (value: number) => { playerState.staminaValue = value },
    faceDirection: () => {},
  }
  const commit = vi.fn((next: CareerProfile) => {
    if (!store.save(next)) return false
    profile = next
    return true
  })
  const controller = new CareerDuelController(new THREE.Scene(), { obstacles: [] } as unknown as TownWorld,
    { areConnected: () => true } as unknown as NavigationWorld, residents, { dead: false } as Mount,
    () => playerState as unknown as Player, () => profile, commit)
  onTestFinished(() => controller.dispose())
  if (!profile.activeMission) {
    const preset = tier === 4 ? 'roman_heavy_infantry' : 'roman_archer'
    const mission = controller.createMission(preset, tier)
    if (!mission) throw new Error(`Unavailable T${tier} checkpoint fixture`)
    profile = { ...profile, activeMission: { ...mission, phase } }
    expect(store.save(profile)).toBe(true)
  }
  expect(controller.startActiveMission()).toBe(true)
  // Equipment application initializes the borrowed opponent's ammo; acknowledge that resource event before measuring cadence.
  controller.persistRuntimeProgress()
  commit.mockClear()
  const opponent = states.find(state => state.combatantId === controller.opponent!.combatantId)!
  return { controller, player: playerState, opponent, commit, store, storage, read: () => profile }
}

describe('Career Duel runtime checkpoint policy', () => {
  it.each([1, 2, 3, 4, 5] as const)('T%s saves elapsed combat time at five seconds and reloads through storage', tier => {
    const h = fixture(tier)
    h.controller.update(4.99)
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.store.load()!.activeMission!.duelCombatElapsed).toBe(0)
    h.controller.update(.01)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission!.duelCombatElapsed).toBe(5)
    const reload = fixture(tier, 'ENGAGING', h.storage)
    expect(reload.controller.combatRemaining).toBe(25)
    reload.controller.update(4.99)
    expect(reload.commit).not.toHaveBeenCalled()
    reload.controller.update(.01)
    expect(reload.store.load()!.activeMission!.duelCombatElapsed).toBe(10)
  })

  it('bounds moving, sprinting and recovering T5 saves to the five-second cadence after actor updates', () => {
    const h = fixture()
    for (let frame = 1; frame <= 1024; frame++) {
      h.controller.update(1 / 64, true)
      h.opponent.group.position.set(frame, 4, frame + 2)
      h.player.group.position.set(frame + 3, 2, frame + 5)
      h.player.staminaValue = frame <= 512 ? 100 - frame / 8 : 36 + (frame - 512) / 8
      h.controller.persistRuntimeProgress()
      // Town's later projectile checkpoint must not save the same frame again.
      h.controller.persistRuntimeProgress()
    }
    expect(h.commit).toHaveBeenCalledTimes(3)
    const saved = h.store.load()!.activeMission!
    expect(saved).toMatchObject({ duelCombatElapsed: 15, duelPlayerStamina: 92,
      duelTravel: { actors: { commander: { x: 960, y: 4, z: 962 } }, player: { x: 963, y: 2, z: 965 } } })
    const reload = fixture(5, 'ENGAGING', h.storage)
    expect(reload.opponent.group.position.toArray()).toEqual([960, 4, 962])
    expect(reload.player.group.position.toArray()).toEqual([963, 2, 965])
    expect(reload.player.staminaValue).toBe(92)
  })

  it.each([
    ['player health', (h: ReturnType<typeof fixture>) => { h.player.hp = 41 }, { duelPlayerHp: 41 }],
    ['opponent health', (h: ReturnType<typeof fixture>) => { h.opponent.hp = 37 }, { duelOpponentHp: 37 }],
    ['opponent ammunition', (h: ReturnType<typeof fixture>) => { h.opponent.combatAmmo = 9 }, { duelOpponentAmmo: 9 }],
    ['player death', (h: ReturnType<typeof fixture>) => { h.player.dead = true }, { playerDead: true }],
    ['opponent death', (h: ReturnType<typeof fixture>) => { h.opponent.dead = true }, { duelOpponentDead: true, deadTargetActorIds: ['commander'] }],
  ] as const)('saves %s immediately with the latest movement and timer', (_name, change, expected) => {
    const h = fixture()
    h.controller.update(.25, true)
    h.player.group.position.set(18, 2, 24)
    change(h)
    h.controller.persistRuntimeProgress()
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission).toMatchObject({ ...expected, duelCombatElapsed: .25,
      duelTravel: { player: { x: 18, y: 2, z: 24 } } })
    h.controller.persistRuntimeProgress()
    expect(h.commit).toHaveBeenCalledOnce()
  })

  it('saves the exact timeout immediately rather than waiting for another periodic interval', () => {
    const h = fixture()
    h.controller.update(29.9)
    h.controller.update(.1)
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.store.load()!.activeMission!.duelCombatElapsed).toBe(30)
    expect(h.controller.outcome).toBe('failure')
    const reload = fixture(5, 'ENGAGING', h.storage)
    expect(reload.controller.outcome).toBe('failure')
    expect(reload.controller.combatEnabled).toBe(false)
  })

  it('retries a failed periodic save with current values and resets its clock only after success', () => {
    const h = fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    h.controller.update(4.99)
    h.storage.failWrites = true
    h.controller.update(.01)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission!.duelCombatElapsed).toBe(0)
    h.opponent.group.position.set(17, 4, 20)
    h.player.staminaValue = 47
    h.storage.failWrites = false
    h.controller.persistRuntimeProgress()
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.store.load()!.activeMission).toMatchObject({ duelCombatElapsed: 5, duelPlayerStamina: 47,
      duelTravel: { actors: { commander: { x: 17, y: 4, z: 20 } } } })
    h.controller.update(4.99)
    expect(h.commit).toHaveBeenCalledTimes(2)
    h.controller.update(.01)
    expect(h.commit).toHaveBeenCalledTimes(3)
  })

  it('reloads the last successful resources after a failed event save and retries the latest HP and ammo', () => {
    const h = fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    h.controller.update(2)
    h.player.hp = 41
    h.opponent.hp = 73
    h.opponent.combatAmmo = 9
    h.storage.failWrites = true
    h.controller.persistRuntimeProgress()
    expect(h.commit).toHaveBeenCalledOnce()
    const beforeRetry = fixture(5, 'ENGAGING', h.storage)
    expect(beforeRetry.player.hp).toBe(100)
    expect(beforeRetry.opponent.hp).toBe(100)
    expect(beforeRetry.opponent.combatAmmo).toBe(30)
    expect(beforeRetry.controller.combatRemaining).toBe(30)
    h.player.hp = 19
    h.opponent.hp = 53
    h.opponent.combatAmmo = 4
    h.storage.failWrites = false
    h.controller.persistRuntimeProgress()
    expect(h.commit).toHaveBeenCalledTimes(2)
    const afterRetry = fixture(5, 'ENGAGING', h.storage)
    expect(afterRetry.player.hp).toBe(19)
    expect(afterRetry.opponent.hp).toBe(53)
    expect(afterRetry.opponent.combatAmmo).toBe(4)
    expect(afterRetry.controller.combatRemaining).toBe(28)
  })

  it('commits the countdown phase immediately and starts the next five-second interval at that success', () => {
    const h = fixture(5, 'PREPARING')
    h.controller.update(4.99)
    expect(h.commit).not.toHaveBeenCalled()
    h.controller.update(.01)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission).toMatchObject({ phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 0 })
    h.controller.update(4.99)
    expect(h.commit).toHaveBeenCalledOnce()
    h.controller.update(.01)
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.store.load()!.activeMission).toMatchObject({ phase: 'ENGAGING', duelCountdownElapsed: 5, duelCombatElapsed: 5 })
  })

  it('flushes changed periodic state on force without writing unchanged snapshots', () => {
    const h = fixture()
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).not.toHaveBeenCalled()
    h.controller.update(.25)
    h.player.staminaValue = 53
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission).toMatchObject({ duelCombatElapsed: .25, duelPlayerStamina: 53 })
    h.controller.persistRuntimeProgress(true)
    expect(h.commit).toHaveBeenCalledOnce()
  })

  it('gives a restarted controller a full new interval instead of reusing unsaved elapsed time', () => {
    const h = fixture()
    h.controller.update(4.99)
    expect(h.controller.startActiveMission()).toBe(true)
    h.controller.update(.01)
    expect(h.commit).not.toHaveBeenCalled()
    h.controller.update(4.99)
    expect(h.commit).toHaveBeenCalledOnce()
    expect(h.store.load()!.activeMission!.duelCombatElapsed).toBe(5)
  })
})
