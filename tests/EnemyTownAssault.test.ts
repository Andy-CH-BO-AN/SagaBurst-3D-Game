import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAssaultRoster, createEnemyTownAssaultMission, careerTownFaction, resolveAssaultOutcome } from '../src/career/EnemyTownAssault'
import { MAX_COMMAND_SQUAD_SIZE } from '../src/battle/CommandTarget'
import { claimCareerMission, createCareerProfile, clearCareerMission } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { townCaptainProfile, townMilitaryEquipment, townRoster } from '../src/town/TownRules'
import { townWartimeHostile, civilianWartimeWeapon } from '../src/town/TownWartime'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { Player } from '../src/player/Player'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { damageNpc } from '../src/combat/DamageRouter'
import { createNpcCombatActorRef, createPlayerCombatActorRef } from '../src/combat/CombatAttribution'
import { calculateMerit } from '../src/career/MeritCalculator'
import { TownScene } from '../src/town/TownScene'
import { SpatialGrid } from '../src/world/SpatialGrid'
import { installCorgiTestAsset } from './helpers/corgiAsset'

import { installBlackCatTestAsset } from './helpers/blackCatAsset'
vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: { ready: true, createInstance: () => {
  const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
  return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null, setLocomotion: vi.fn(), setAppearanceVariant: vi.fn(), playOnce: vi.fn(), playDeath: vi.fn(), update: vi.fn(), dispose: vi.fn() }
} } }))
vi.mock('../src/world/MakiRangerEquipment', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/MakiRangerEquipment')>()), createMakiRangerBowInstance: () => ({
  model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1, gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1), longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) }
}) }))
vi.mock('../src/career/MissionGuide', () => ({ MissionGuide: class { hide = vi.fn(); dispose = vi.fn(); updateTownDefense = vi.fn() } }))
beforeAll(async () => { await Promise.all([installCorgiTestAsset(), installBlackCatTestAsset()]) })
const dispose: (() => void)[] = []
afterEach(() => { dispose.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })

function fixture(faction: 'roman' | 'viking', assault = true) {
  const scene = new THREE.Scene()
  let profile = createCareerProfile(faction)
  const townFaction = assault ? faction === 'roman' ? 'viking' : 'roman' : faction
  const roster = townRoster().filter(spec => spec.role !== 'cat' && spec.role !== 'merchant')
  const residents = roster.map(spec => {
    const civilian = spec.role === 'civilian', ranger = spec.role === 'ranger'
    const military = townMilitaryEquipment(townFaction, spec.role)
    const hero = spec.role === 'captain' ? townCaptainProfile(townFaction) : undefined
    const npc = new NPC(scene, spec.x, spec.z, assault ? Faction.ENEMY : Faction.TOWN, townFaction,
      ranger || spec.role.startsWith('ranged') ? AIType.RANGED : AIType.MELEE, spec.id, ranger || hero ? 4 : 2,
      spec.role.includes('cavalry') || spec.role === 'captain',
      civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow' } : military.loadout,
      military.presetId, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : hero?.visualAssetId,
      ranger ? 'ranger' : hero?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, townFaction)
    npc.setTownPeaceful()
    return { spec, npc }
  })
  const player = new Player(scene, faction)
  const cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  const navigation = new NavigationWorld()
  navigation.sync([{ box: new THREE.Box3(new THREE.Vector3(-56, -10, 125), new THREE.Vector3(-49, 20, 138)), isBarricade: false }])
  profile.activeMission = assault ? createEnemyTownAssaultMission('assault-test') : createTownDefenseMission(
    residents.filter(r => r.spec.role !== 'civilian').map(r => r.spec.id), residents.filter(r => r.spec.role === 'civilian').map(r => r.spec.id), 'defense-test')
  const controller = new TownDefenseController(scene, residents, () => player, () => profile, p => { profile = p; return true }, cat, navigation)
  expect(controller.startActiveMission()).toBe(true)
  dispose.push(() => { controller.dispose(); residents.forEach(r => r.npc.dispose()); player.dispose(); cat.dispose() })
  return { controller, player, residents, navigation, scene, profile: () => profile, setProfile: (p: typeof profile) => { profile = p } }
}

function townHarness(f: ReturnType<typeof fixture>) {
  const town = Object.create(TownScene.prototype) as any
  Object.assign(town, { profile: f.profile(), defense: f.controller, player: f.player, camera: new THREE.PerspectiveCamera(), orbit: { cameraYaw: 0 }, world: { obstacles: [] }, navigation: f.navigation,
    grid: new SpatialGrid(4), defenseEnemyGrid: new SpatialGrid(8), defenseTownGrid: new SpatialGrid(8), neighbors: [], hp: { setFill: vi.fn() },
    inventory: { shieldEnabled: false }, careerMounts: { activeMount: null, update: vi.fn() }, cat: new Mount(f.scene, MountType.BLACK_CAT, -34, 20), elapsed: 0, shots: [], updateCareerCommandCue: vi.fn(), damageNumbers: { spawn: vi.fn() } })
  dispose.push(() => town.cat.dispose())
  return town
}

for (const faction of ['roman', 'viking'] as const) describe(`${faction} enemy Town assault`, () => {
  it('creates exactly three squads of 30 including Player and uses real T4 heroes', () => {
    const roster = createAssaultRoster(faction)
    expect(roster).toHaveLength(89)
    expect(roster.filter(n => n.tier === 4)).toHaveLength(3)
    for (const squad of [1, 2, 3]) expect(roster.filter(n => n.squadId === squad).length + (squad === 1 ? 1 : 0)).toBe(MAX_COMMAND_SQUAD_SIZE)
    expect(roster.find(n => n.squadId === 1)).toMatchObject({ visualAssetId: townCaptainProfile(faction).visualAssetId, combatProfileId: townCaptainProfile(faction).combatProfileId, loadout: { mountId: townCaptainProfile(faction).mountOverride } })
    expect(roster.find(n => n.squadId === 2)).toMatchObject({ visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger', aiType: AIType.RANGED })
    expect(roster.find(n => n.squadId === 3)).toMatchObject({ visualAssetId: 'viking-hero-t4', combatProfileId: 'varangian', presetId: 'viking_berserker', loadout: { meleeWeaponId: 'viking_axe_t3' } })
    expect(roster.filter(n => n.tier === 2 && n.cavalry)).not.toHaveLength(0)
    expect(roster.some(n => n.tier === 2 && n.presetId?.endsWith('lancer'))).toBe(true)
    expect(roster.some(n => n.tier === 2 && n.presetId?.endsWith('horse_archer'))).toBe(true)
  })

  it('reuses exactly 60 garrison, Captain, Maki, Sergeant and 20 civilians; switches only map faction', () => {
    const p = createCareerProfile(faction); p.activeMission = createEnemyTownAssaultMission()
    expect(p.activeMission.targetActorIds).toHaveLength(63)
    expect(p.activeMission.targetActorIds).toEqual(expect.arrayContaining(['captain', 'ranger', 'deployment']))
    expect(p.activeMission.civilianActorIds).toHaveLength(20)
    expect(p.activeMission.friendlyActorIds).toHaveLength(89)
    expect(careerTownFaction(p)).not.toBe(faction)
    expect(careerTownFaction(clearCareerMission(p, p.activeMission.id))).toBe(faction)
  })

  it('deploys walkable separated slots, Player in A, and actual T4 runtime profiles', () => {
    const f = fixture(faction), army = f.controller.enemies
    expect(army).toHaveLength(89)
    expect(f.controller.military).toHaveLength(63)
    expect(f.controller.civilians).toHaveLength(20)
    const points = [...army.map(n => n.combatPosition), f.player.combatPosition]
    expect(points.every(p => p.z > 100 && !f.navigation.grid.isBlocked(f.navigation.grid.worldToCell(p)!))).toBe(true)
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) expect(points[i].clone().setY(0).distanceTo(points[j].clone().setY(0))).toBeGreaterThanOrEqual(2.9)
    expect(army.find(n => n.squadId === 3 && n.tier === 4)).toMatchObject({ maxHp: 500, visualAssetId: 'viking-hero-t4', combatProfileId: 'varangian', meleeWeaponId: 'viking_axe_t3' })
    expect(f.player.combatPosition.x).toBeLessThan(-30)
  })

  it('faction targets military and civilians in both directions, never its own side', () => {
    const f = fixture(faction), attacker = f.controller.enemies[0], military = f.controller.military[0], civilian = f.controller.civilians[0]
    expect(f.controller.peersFor(attacker)).toEqual(expect.arrayContaining([military, civilian]))
    expect(f.controller.peersFor(military)).toContain(attacker)
    expect(f.controller.peersFor(civilian)).toContain(attacker)
    for (const npc of f.controller.fieldNpcs) expect(f.controller.peersFor(npc).every(other => townWartimeHostile(npc, other))).toBe(true)
    expect(townWartimeHostile(attacker, f.controller.enemies[1])).toBe(false)
    expect((attacker as any)._findTarget(f.player, [civilian]).npc).toBe(civilian)
    f.player.group.position.set(400, 0, 400)
    expect((civilian as any)._findTarget(f.player, [attacker]).npc?.combatantId).toBe(attacker.combatantId)
  })

  it('prepares for ten seconds, holds all three squads and releases them once', () => {
    const f = fixture(faction), orders = f.controller.enemies.map(npc => vi.spyOn(npc, 'setTacticalOrder'))
    const attackVoice = vi.fn(); f.controller.onAssaultAttackStarted = attackVoice
    f.controller.updateFlow(9, 0)
    expect(f.controller.phase).toBe('PREPARING'); expect(f.controller.preparationRemaining).toBe(1)
    expect(f.controller.enemies.every(npc => npc.tacticalOrder === 'formation')).toBe(true)
    f.controller.updateFlow(1, 0); f.controller.updateFlow(1, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    expect(attackVoice).toHaveBeenCalledOnce()
    orders.forEach(spy => expect(spy).toHaveBeenCalledExactlyOnceWith('attack'))
    expect(f.controller.military.every(npc => npc.tacticalOrder === 'defend')).toBe(true)
  })

  it('civilians flee, equip faction T1 only at close contact, and resume shelter instead of hunting', () => {
    const f = fixture(faction), civilian = f.controller.civilians[0], attacker = f.controller.enemies.find(npc => !npc.isMounted)!
    expect(civilian.tacticalOrder).toBe('formation')
    attacker.group.position.copy(civilian.combatPosition)
    f.controller.updateCivilianOrder(civilian)
    expect(civilian.tacticalOrder).toBe('formation')
    f.controller.updateFlow(10, 0)
    f.controller.updateCivilianOrder(civilian)
    expect(civilian.tacticalOrder).toBe('attack')
    expect(civilian.meleeWeaponId).toBe(civilianWartimeWeapon(faction === 'roman' ? 'viking' : 'roman'))
    attacker.group.position.set(400, 0, 400)
    f.controller.updateCivilianOrder(civilian)
    expect(civilian.tacticalOrder).toBe('formation')
  })

  it.each(['player-melee', 'npc-projectile', 'npc-mount-impact'] as const)('reuses resident counterattack on effective %s damage and restores it after reload', method => {
    const f = fixture(faction), town = townHarness(f), military = f.controller.groups.find(g => g.id === 'A')!.members[0]
    const attacker = f.controller.enemies.find(npc => !npc.isMounted && npc.aiType === AIType.MELEE)!
    // Preparation still blocks hits and must not release defenders early.
    town.hitFieldNpc(military, 20, 'melee', attacker)
    expect(f.controller.reserveHasCharged).toBe(false)
    f.controller.updateFlow(10, 0)
    town.hitFieldNpc(f.controller.civilians[0], 20, 'melee', attacker)
    town.hitFieldNpc(military, 0, 'melee', attacker)
    expect(f.controller.reserveHasCharged).toBe(false)
    expect(military.tacticalOrder).toBe('defend')
    const orders = f.controller.military.map(npc => vi.spyOn(npc, 'setTacticalOrder'))
    town.hitFieldNpc(military, 20, method === 'npc-projectile' ? 'projectile' : method === 'npc-mount-impact' ? 'mount-impact' : 'melee', method === 'player-melee' ? undefined : attacker)
    expect(f.controller.reserveHasCharged).toBe(true)
    for (const group of f.controller.groups) expect(group.members.every(npc => npc.tacticalOrder === (group.id === 'E' ? 'charge' : 'attack'))).toBe(true)
    for (const leader of [f.controller.captain, f.controller.ranger, f.controller.sergeant]) expect(leader!.tacticalOrder).toBe('attack')
    town.hitFieldNpc(military, 20, 'melee', attacker)
    orders.forEach(spy => expect(spy).toHaveBeenCalledOnce())
    // Exercise actual NPC navigation, not just the issued order. Defend formation
    // formerly bypassed target acquisition and stayed motionless indefinitely.
    attacker.group.position.copy(military.group.position).x += 6
    const start = military.combatPosition.clone()
    for (let i = 0; i < 20; i++) military.update(.05, f.player, [attacker], [military, attacker], [], town.hp, vi.fn(), vi.fn(), false, 0, null, null, f.navigation)
    expect(military.combatPosition.distanceTo(start)).toBeGreaterThan(.1)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!
    expect(saved.activeMission!.defenseReserveCharged).toBe(true)
    f.setProfile(saved)
    expect(f.controller.startActiveMission()).toBe(true)
    expect(f.controller.military.every(npc => npc.tacticalOrder !== 'defend')).toBe(true)
    expect(f.controller.groups.find(g => g.id === 'E')!.members.every(npc => npc.tacticalOrder === 'charge')).toBe(true)
  })

  it('objectives ignore civilians, permit AI victory after death and prioritize mutual destruction', () => {
    const f = fixture(faction)
    f.controller.updateFlow(10, 0)
    expect(f.controller.evaluate(true)).toBeNull()
    f.controller.enemies.forEach(npc => npc.takeDamage(999999))
    f.controller.persistRuntimeProgress(true)
    expect(f.controller.evaluate(false)).toBeNull()
    expect(f.controller.evaluate(true)).toBe('failure')
    f.controller.military.forEach(npc => npc.takeDamage(999999))
    expect(f.controller.civilians.every(npc => !npc.dead)).toBe(true)
    f.controller.civilians.forEach(npc => { npc.armTownCivilian('gladius_rusty'); npc.setTacticalOrder('attack') })
    expect(f.controller.evaluate(true)).toBe('victory')
  })

  it('reload keeps casualty roles distinct, the same mission ID, dead player and elapsed preparation', () => {
    const f = fixture(faction)
    f.controller.enemies[0].takeDamage(999999)
    f.controller.military[0].takeDamage(999999)
    f.controller.civilians[0].takeDamage(999999)
    f.controller.updateFlow(4, 0)
    f.player.takeDamage(999999, { setFill: vi.fn() } as any)
    f.controller.persistRuntimeProgress(true)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!
    expect(saved.activeMission).toMatchObject({ id: 'assault-test', kind: 'enemy-town-assault', playerDead: true, defensePreparationElapsed: 4 })
    expect(saved.activeMission!.deadTargetActorIds).toHaveLength(1)
    expect(saved.activeMission!.deadFriendlyActorIds).toHaveLength(1)
    expect(saved.activeMission!.deadCivilianActorIds).toHaveLength(1)
    f.setProfile(saved)
    expect(f.controller.startActiveMission()).toBe(true)
    expect(f.controller.enemies).toHaveLength(88)
    expect(f.controller.preparationRemaining).toBe(6)
    expect(f.controller.evaluate(true)).toBeNull()
  })
})

describe('shared Town wartime and settlement', () => {
  it.each([
    [true, 0, 0, 'victory'], [false, 0, 0, 'victory'], [true, 1, 1, null],
    [true, 1, 0, 'failure'], [false, 1, 0, null],
  ] as const)('assault dead=%s military=%s NPC=%s => %s', (dead, military, allies, outcome) => {
    expect(resolveAssaultOutcome(dead, military, allies)).toBe(outcome)
  })

  it.each(['roman', 'viking'] as const)('Defense %s civilian can kill last attacker without receiving Player credit', faction => {
    const f = fixture(faction, false), enemy = f.controller.enemies[0], civilian = f.controller.civilians[0]
    f.controller.updateFlow(45, 0)
    f.controller.enemies.slice(1).forEach(npc => npc.takeDamage(999999))
    enemy.dismountFromMount()
    damageNpc(enemy, 999999, { source: createNpcCombatActorRef(civilian), method: 'melee', emit: f.controller.events.emit })
    expect(f.controller.remainingEnemies).toBe(0)
    expect(f.controller.snapshot().player.kills).toBe(0)
    expect(f.controller.evaluate(true)).toBe('victory')
    expect(f.controller.peersFor(civilian)).not.toContain(f.controller.military[0])
  })

  it.each([10, 11])('Defense keeps civilian death threshold %s', deaths => {
    const f = fixture('roman', false)
    f.controller.enemies.forEach(npc => npc.takeDamage(999999))
    f.controller.civilians.slice(0, deaths).forEach(npc => npc.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe(deaths === 10 ? 'victory' : 'failure')
  })

  it('living armed civilians do not prevent Defense failure after Player and all military die', () => {
    const f = fixture('viking', false)
    f.controller.military.forEach(npc => npc.takeDamage(999999))
    f.controller.civilians.forEach(npc => npc.armTownCivilian('viking_axe_t1'))
    expect(f.controller.evaluate(true)).toBe('failure')
  })

  it('tracks player civilian hits separately from the military objective, with offense Merit and one claim across reload', () => {
    const f = fixture('roman'), civilian = f.controller.civilians[0]
    damageNpc(civilian, 999999, { source: createPlayerCombatActorRef(f.player), method: 'melee', emit: f.controller.events.emit })
    const stats = f.controller.snapshot().player
    expect(stats.kills).toBe(1)
    expect(f.controller.military.filter(n => !n.dead)).toHaveLength(63)
    const claim = claimCareerMission(f.profile(), 'assault-test', 'victory', { ...stats, survived: false })
    expect(claim.meritAwarded).toBe(calculateMerit({ player: { ...stats, survived: false }, squads: [] }, 'victory', 'offense').total)
    const reload = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(claimCareerMission(reload, 'assault-test', 'victory', stats).meritAwarded).toBe(0)
    expect(clearCareerMission(reload, 'assault-test')).toMatchObject({ faction: 'roman', totalMerit: claim.meritAwarded })
  })

  it('preparation orchestration updates civilian movement while freezing military and blocks damage and projectiles', () => {
    const f = fixture('roman'), town = townHarness(f)
    const military = f.controller.military[0], civilian = f.controller.civilians[0], attacker = f.controller.enemies[0]
    const updateMilitary = vi.spyOn(military, 'update'), updateAttacker = vi.spyOn(attacker, 'update'), updateCivilian = vi.spyOn(civilian, 'update')
    town.updateDefenseCombat(1)
    expect(updateMilitary).not.toHaveBeenCalled(); expect(updateAttacker).not.toHaveBeenCalled(); expect(updateCivilian).toHaveBeenCalledOnce()
    town.input = { clear: vi.fn() }; town.preparationAnchor = new THREE.Vector3(-51, 0, 132)
    f.player.group.position.set(0, 0, 0)
    expect(town.enforceAssaultPreparationLock()).toBe(true)
    expect(f.player.group.position.x).toBe(-51)
    expect(f.player.group.position.z).toBe(132)
    expect(town.input.clear).toHaveBeenCalledOnce()
    const before = military.hp
    town.hitFieldNpc(military, 999999, 'melee', attacker)
    town.fire(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 20, 10, true, false, 'arrow')
    expect(military.hp).toBe(before); expect(town.shots).toHaveLength(0)
    f.controller.updateFlow(9, 0)
    expect(town.enforceAssaultPreparationLock()).toBe(false)
  })

  it('allows Tab equipment during preparation while retaining action locks and dead-player restrictions', () => {
    const f = fixture('roman'), town = townHarness(f)
    vi.stubGlobal('document', { exitPointerLock: vi.fn() })
    town.input = { clear: vi.fn() }
    town.skills = {}; town.equipment = { visible: false, open: vi.fn() }
    const key = (code: string) => ({ code, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() })
    for (const code of ['KeyE', 'KeyQ', 'KeyG']) {
      const e = key(code); town.key(e)
      expect(e.preventDefault).toHaveBeenCalledOnce()
      expect(town.equipment.open).not.toHaveBeenCalled()
    }
    const tab = key('Tab'); town.key(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(town.equipment.open).toHaveBeenCalledWith(town.skills, town.inventory, expect.any(Function), town.careerMounts)
    // Closing the modal is handled before preparation guards as in normal Town.
    town.equipment.visible = true; town.closePanel = vi.fn()
    town.key(key('Tab')); expect(town.closePanel).toHaveBeenCalledOnce()
    town.equipment.visible = false; town.equipment.open.mockClear()
    f.player.takeDamage(999999, town.hp)
    town.key(key('Tab')); expect(town.equipment.open).not.toHaveBeenCalled()
  })
})
