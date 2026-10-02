import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../src/town/TownScene'
import { NPC, AIType, Faction } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { Player } from '../src/player/Player'
import { ArrowProjectile } from '../src/world/ArrowProjectile'
import { getTerrainHeight } from '../src/world/Terrain'
import { createCareerProfile } from '../src/career/CareerProfile'
import { createCareerDuelMission } from '../src/career/CareerDuelState'
import { getUnitPresetsForFaction, UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { installCorgiTestAsset } from './helpers/corgiAsset'

beforeAll(() => installCorgiTestAsset())

const audio = vi.hoisted(() => ({ playCareerMissionVoice: vi.fn(), playSwordHit: vi.fn(), playProjectileImpact: vi.fn(), playHorseImpact: vi.fn() }))
vi.mock('../src/audio/SoundManager', () => ({ SoundManager: class {
  playCareerMissionVoice = audio.playCareerMissionVoice
  playSwordHit = audio.playSwordHit
  playProjectileImpact = audio.playProjectileImpact
  playHorseImpact = audio.playHorseImpact
} }))

function harness() {
  const town = Object.assign(Object.create(TownScene.prototype), {
    profile: createCareerProfile('roman'), player: { dead: false, combatantId: 'player', characterFaction: 'roman', heroAssetId: null },
    event: { hostile: false }, inventory: { prepareForCombat: vi.fn(), sheathAll: vi.fn(), equippedMelee: { id: 'gladius_rusty' } },
    mission: { events: { emit: vi.fn() }, cleanupMission: vi.fn() }, defense: { active: false },
    openPanel: vi.fn(() => ({})), closePanel: vi.fn(), button: vi.fn(), clearMissionCombatShots: vi.fn(),
    disposed: false, externalThreatActors: new Set(), residents: [],
  }) as any
  town.store = { load: () => town.profile }
  town.commit = vi.fn(next => { town.profile = next; return true })
  town.duel = {
    createMission: vi.fn((preset, tier) => createCareerDuelMission(town.profile, preset, tier, 'melee_0', 'captain', 'duel-integration')),
    startActiveMission: vi.fn(() => true), cleanupMission: vi.fn(), persistRuntimeProgress: vi.fn(), actors: [],
    events: { emit: vi.fn() },
    get active() { return town.profile.activeMission?.kind === 'duel' ? town.profile.activeMission : undefined },
    get phase() { return town.profile.activeMission?.phase },
    get combatEnabled() { return town.duel.active?.phase === 'ENGAGING' && !town.duel.active?.result },
    canDamageOpponent: (npc: NPC) => town.duel.combatEnabled && town.duel.opponent === npc,
    canDamagePlayer: (npc: NPC) => town.duel.combatEnabled && town.duel.opponent === npc,
    isMissionTarget: (npc: NPC) => town.duel.opponent === npc,
    startReturning: vi.fn(() => {
      if (town.profile.activeMission.phase === 'RETURNING') return false
      town.profile.activeMission.phase = 'RETURNING'; town.playMissionVoice('return'); return true
    }),
  }
  return town
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('Town Duel acceptance and voices', () => {
  it('revalidates preset unlock against the saved profile before accepting', () => {
    const town = harness()
    town.acceptDuel('roman_archer', 2)
    expect(town.commit).not.toHaveBeenCalled()
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    town.acceptDuel('viking_archer', 1)
    expect(town.commit).not.toHaveBeenCalled()
  })
  it('plays existing Mission Accepted after saving exactly once', () => {
    const town = harness()
    town.acceptDuel('roman_archer', 1); town.acceptDuel('roman_archer', 1)
    expect(town.commit).toHaveBeenCalledOnce()
    expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith('roman', 'missionAccepted')
    expect(town.commit.mock.invocationCallOrder[0]).toBeLessThan(audio.playCareerMissionVoice.mock.invocationCallOrder[0])
    expect(town.inventory.prepareForCombat).toHaveBeenCalledOnce()
  })
  it('does not speak or deploy when saving fails', () => {
    const town = harness(); town.commit.mockReturnValue(false)
    town.acceptDuel('roman_archer', 1)
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    expect(town.duel.startActiveMission).not.toHaveBeenCalled()
  })
  it('reload restores the duel controller without replaying Mission Accepted or Follow Me', () => {
    const town = harness()
    town.profile.activeMission = createCareerDuelMission(town.profile, 'roman_archer', 1, 'melee_0', 'captain')
    town.profile.activeMission.phase = 'PREPARING'; town.profile.activeMission.duelCountdownElapsed = 3.2
    town.careerMounts = { restoreActiveMount: vi.fn() }
    town.restoreActiveCareerMission()
    expect(town.duel.startActiveMission).toHaveBeenCalledOnce()
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    expect(town.profile.activeMission.duelCountdownElapsed).toBe(3.2)
  })
  it('voices only one valid physical return and keeps both existing result actions', () => {
    const town = harness(); town.acceptDuel('roman_archer', 1)
    audio.playCareerMissionVoice.mockClear()
    const result = { outcome: 'victory', stats: { survived: true, damageDealt: 50, kills: 1 }, merit: { total: 1, damage: 1, kills: 0, contribution: 0 } }
    town.profile.activeMission.result = result; town.profile.activeMission.phase = 'RESULT'
    town.openMissionResult(result, false)
    const actions = new Map(town.button.mock.calls.map((call: any[]) => [call[1], call[2]])) as Map<string, () => void>
    expect(actions.has('返回 Career Town')).toBe(true)
    actions.get('跟隊長走回去')!(); actions.get('跟隊長走回去')!()
    expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith('roman', 'return')
  })
})

describe('Town Duel combat isolation', () => {
  it.each(['melee', 'projectile', 'mount-impact'] as const)('blocks %s before FIGHT and attributes opponent hits without Town retaliation', method => {
    const town = harness(); town.acceptDuel('roman_archer', 1)
    const opponent = new NPC(new THREE.Scene(), 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Opponent', 2, false, { meleeWeaponId: 'gladius_standard', rangedWeaponId: null, shieldId: null }, 'roman_heavy_infantry', undefined, 'melee_0')
    town.duel.opponent = opponent; town.damageNumbers = { spawn: vi.fn() }
    town.prepareDamage = vi.fn(); town.activateHostility = vi.fn(); town.persistCasualties = vi.fn()
    const before = opponent.hp
    town.profile.activeMission.phase = 'PREPARING'
    town.hitFieldNpc(opponent, 10, method)
    expect(opponent.hp).toBe(before)
    town.profile.activeMission.phase = 'ENGAGING'
    town.hitFieldNpc(opponent, 10, method)
    expect(opponent.hp).toBe(before - 10)
    expect(town.duel.events.emit).toHaveBeenCalled()
    expect(town.mission.events.emit).not.toHaveBeenCalled()
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
    expect(town.persistCasualties).not.toHaveBeenCalled()
    expect(town.profile.townEvent).toBeUndefined()
    expect(town.event.hostile).toBe(false)
    opponent.dispose()
  })
  it('protects the referee, civilians, unrelated mounts and buildings without counting Duel damage', () => {
    const town = harness(); town.acceptDuel('roman_archer', 1); town.profile.activeMission.phase = 'ENGAGING'
    town.prepareDamage = vi.fn(); town.activateHostility = vi.fn()
    const scene = new THREE.Scene(), referee = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Captain', 4, false)
    const cat = Object.assign(Object.create(Mount.prototype), { currentHp: 100 }) as Mount
    const before = referee.hp, mountHp = cat.currentHp
    town.hitFieldNpc(referee, 100, 'melee'); town.hitResident(referee, 100); town.hitResident(cat, 100)
    town.damageBuilding(0, 100)
    expect(referee.hp).toBe(before); expect(cat.currentHp).toBe(mountHp)
    expect(town.prepareDamage).not.toHaveBeenCalled(); expect(town.activateHostility).not.toHaveBeenCalled()
    expect(town.duel.events.emit).not.toHaveBeenCalled()
    referee.dispose()
  })
  it('rejects opponent/referee projectiles during preparation before creating shots', () => {
    const town = harness(); town.acceptDuel('roman_archer', 1); town.profile.activeMission.phase = 'PREPARING'
    town.shots = []
    town.fire(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 10, 20, true, false, 'arrow')
    town.fire(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 10, 20, false, false, 'arrow', {})
    expect(town.shots).toHaveLength(0)
  })

  it.each([false, true])('a real T1 Archer projectile hits the stationary Duel player (mounted=%s)', mounted => {
    const town = harness(); town.acceptDuel('roman_archer', 1)
    const scene = new THREE.Scene(), player = new Player(scene, 'roman')
    player.setPosition(60, getTerrainHeight(60, 104) + .95, 104)
    const mount = mounted ? new Mount(scene, MountType.CORGI, 60, 104) : null
    if (mount) player.mountVehicle(mount)
    const opponent = new NPC(scene, 60, 120, Faction.TOWN, 'roman', AIType.MELEE, 'Town soldier', 2,
      false, UNIT_PRESETS.roman_heavy_infantry.tierLoadouts[2], 'roman_heavy_infantry')
    opponent.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_archer.tierLoadouts[1])
    opponent.setDuelHostility(true)
    town.player = player; town.duel.opponent = opponent; town.profile.activeMission.phase = 'ENGAGING'
    town.world = { buildings: [], targets: [] }; town.hp = { setFill: vi.fn() }; town.shots = []
    const playerHp = player.hp, mountHp = mount?.currentHp
    const fire = (origin: THREE.Vector3, direction: THREE.Vector3, kind: 'arrow' | 'pilum') => {
      town.shots.push({ arrow: new ArrowProjectile(scene, origin, direction, opponent.rangedProjectileSpeed,
        opponent.rangedDamage, Faction.TOWN, false, kind), source: opponent, player: false, training: false, age: 0 })
    }
    for (let frame = 0; frame < 200 && (mount ? mount.currentHp === mountHp : player.hp === playerHp); frame++) {
      opponent.update(.02, player, [], [], [], town.hp, vi.fn(), fire, true)
      town.updateShots(.02)
    }
    expect(opponent.combatAmmo).toBeLessThan(30)
    if (mount) {
      expect(mount.currentHp).toBeLessThan(mountHp!)
      expect(player.hp).toBe(playerHp)
    } else expect(player.hp).toBeCloseTo(playerHp - opponent.rangedDamage)
    expect(town.duel.events.emit).toHaveBeenCalled()
    expect(town.event.hostile).toBe(false)
    expect(town.profile.townEvent).toBeUndefined()
    opponent.dispose(); player.dispose(); mount?.dispose()
  })
})

class ElementStub {
  children: ElementStub[] = []
  textContent = ''; disabled = false; className = ''; style = {}; onclick?: () => void
  attributes: Record<string, string> = {}
  append(...children: ElementStub[]) { this.children.push(...children) }
  setAttribute(key: string, value: string) { this.attributes[key] = value }
}

describe('Duel unit/tier page', () => {
  it.each(['roman', 'viking'] as const)('shows every %s catalog preset with its own tier statuses', faction => {
    vi.stubGlobal('document', { createElement: () => new ElementStub() })
    const town = harness(); town.profile = createCareerProfile(faction)
    town.profile.duelHighestDefeatedTierByPreset = faction === 'roman' ? { roman_archer: 3 } : { viking_archer: 3 }
    town.duelPresetId = faction === 'roman' ? 'roman_archer' : 'viking_archer'
    const panel = new ElementStub(); town.openDuelPage(panel)
    const unitRows = panel.children[1].children
    expect(unitRows).toHaveLength(getUnitPresetsForFaction(faction).length)
    expect(unitRows.filter(row => row.children[1].textContent.includes('T2 已解鎖'))).toHaveLength(1)
    expect(unitRows.every(row => row.children[1].textContent.includes('T1 已解鎖'))).toBe(true)
    const tiers = panel.children.slice(3)
    expect(tiers).toHaveLength(4)
    expect(tiers.every(row => !row.children[2].disabled)).toBe(true)
  })
})

describe('Duel restoration through existing Town lifecycle', () => {
  it('direct return uses the existing clear, dispose and restart path', () => {
    const town = harness(); town.acceptDuel('roman_archer', 1)
    town.dispose = vi.fn(); town.onRestart = vi.fn()
    town.fastReturnFromMission()
    expect(town.profile.activeMission).toBeUndefined()
    expect(town.duel.cleanupMission).toHaveBeenCalledOnce()
    expect(town.inventory.sheathAll).toHaveBeenCalledOnce()
    expect(town.dispose).toHaveBeenCalledOnce(); expect(town.onRestart).toHaveBeenCalledExactlyOnceWith(town.profile)
  })
  it('physical return restores residents, home mounts, Black Cat and player through existing helpers', () => {
    const town = harness(); town.acceptDuel('roman_archer', 1)
    town.profile.activeMission.phase = 'RETURNING'
    const npc = { dismountFromMount: vi.fn(), restoreForTown: vi.fn(), mountVehicle: vi.fn(), group: { rotation: { y: 0 } } }
    const homeMount = { restoreForTown: vi.fn() }
    town.residents = [{ spec: { x: 5, z: 6 }, npc, homeMount, cycle: 4, walkTime: 3 }]
    town.duel.actors = [npc]; town.cat = { restoreForTown: vi.fn(), catVisual: { setEquipmentVisible: vi.fn() } }
    town.restPlayerInTown = vi.fn()
    town.settleReturnedMissionInPlace()
    expect(npc.restoreForTown).toHaveBeenCalledOnce()
    expect(homeMount.restoreForTown).toHaveBeenCalledExactlyOnceWith(5, 6, Math.PI)
    expect(npc.mountVehicle).toHaveBeenCalledWith(homeMount)
    expect(town.cat.restoreForTown).toHaveBeenCalledOnce()
    expect(town.restPlayerInTown).toHaveBeenCalledOnce()
    expect(town.clearMissionCombatShots).toHaveBeenCalledTimes(2)
    expect(town.profile.activeMission).toBeUndefined()
  })
})
