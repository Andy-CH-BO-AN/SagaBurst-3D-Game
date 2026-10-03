import { createTownCombatFixture } from './townCombatFixture'
import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAssaultRoster, createEnemyTownAssaultMission, careerTownFaction, prepareEnemyTownAssaultEquipment, resolveAssaultOutcome } from '../src/career/EnemyTownAssault'
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
import { TownEquipment } from '../src/town/TownEquipment'
import { CareerMountController } from '../src/career/CareerMountController'
import { installCorgiTestAsset } from './helpers/corgiAsset'
import { combatFixture } from './helpers/townMissionCombat'

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
  const town = createTownCombatFixture() as any
  Object.assign(town, { profile: f.profile(), defense: f.controller, player: f.player, camera: new THREE.PerspectiveCamera(), orbit: { cameraYaw: 0 }, world: { obstacles: [] }, navigation: f.navigation,
    grid: new SpatialGrid(4), defenseEnemyGrid: new SpatialGrid(8), defenseTownGrid: new SpatialGrid(8), neighbors: [], hp: { setFill: vi.fn() },
    inventory: { shieldEnabled: false }, careerMounts: { activeMount: null, update: vi.fn() }, cat: new Mount(f.scene, MountType.BLACK_CAT, -34, 20), elapsed: 0, shots: [], updateCareerCommandCue: vi.fn(), damageNumbers: { spawn: vi.fn() } })
  dispose.push(() => town.cat.dispose())
  return town
}

for (const faction of ['roman', 'viking'] as const) describe(`${faction} enemy Town assault`, () => {
  it('starting a new assault resets the same controller checkpoint clock without a one-second defense clock masking it', () => {
    const f = fixture(faction)
    f.controller.updateFlow(4.99, 0)
    expect(f.profile().activeMission!.playerStats).toBeUndefined()
    f.setProfile({ ...createCareerProfile(faction), activeMission: createEnemyTownAssaultMission('assault-next') })
    expect(f.controller.startActiveMission()).toBe(true)
    f.controller.events.emit({ type: 'damage_applied',
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: faction },
      target: { targetId: f.profile().activeMission!.targetActorIds[0], targetType: 'npc', name: 'Defender' },
      method: 'melee', requestedDamage: 100, appliedDamage: 100,
    })
    f.controller.updateFlow(.01, 0)
    expect(f.profile().activeMission!.playerStats).toBeUndefined()
    expect(f.controller.snapshot().player.damageDealt).toBe(100)
    f.controller.updateFlow(4.99, 0)
    expect(f.profile().activeMission).toMatchObject({ id: 'assault-next', phase: 'ATTACKING',
      defenseElapsed: 0, defensePreparationElapsed: 0, playerStats: { damageDealt: 100 },
    })
  })

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

  it('starts all three squads attacking immediately and never reissues the opening order', () => {
    const f = fixture(faction)
    expect(f.controller.phase).toBe('ATTACKING')
    expect(f.controller.preparationRemaining).toBe(0)
    expect(f.controller.enemies.every(npc => npc.tacticalOrder === 'attack')).toBe(true)
    const orders = f.controller.enemies.map(npc => vi.spyOn(npc, 'setTacticalOrder'))
    f.controller.updateFlow(.016, 0); f.controller.updateFlow(10, 0)
    orders.forEach(spy => expect(spy).not.toHaveBeenCalled())
    expect(f.controller.military.every(npc => npc.tacticalOrder === 'defend')).toBe(true)
  })

  it('automatically equips the highest legal owned shield and mount at the reserved Player slot', () => {
    const f = fixture(faction), town = townHarness(f)
    const p = f.profile(); p.rank = 'veteran'
    p.ownedWeapons = [faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1']
    p.starterWeaponId = p.ownedWeapons[0]
    p.ownedArmors = ['scutum_t1', 'round_shield_t3']
    p.ownedMounts = ['horse', 'corgi']; p.ownedHorseTiers = [1, 3]; p.selectedMountId = 'horse-t1'
    const ready = prepareEnemyTownAssaultEquipment(p)
    f.setProfile(ready); town.profile = ready
    town.commit = (next: typeof p) => { f.setProfile(next); town.profile = next; return true }
    town.inventory = new TownEquipment(() => town.profile, town.commit)
    town.careerMounts = new CareerMountController(f.scene, () => f.player, () => town.profile, town.commit, () => [], () => [])
    dispose.push(() => town.careerMounts.dispose())
    const anchor = f.player.combatPosition.clone()
    town.restoreActiveCareerMission()
    expect(town.inventory.equippedShield?.id).toBe('round_shield_t3')
    expect(town.inventory.shieldEnabled).toBe(true)
    expect(town.careerMounts.activeMountId).toBe('horse')
    expect(f.player.isMounted).toBe(true)
    expect(f.player.currentMount!.group.position.x).toBe(anchor.x)
    expect(f.player.currentMount!.group.position.z).toBe(anchor.z)
    expect(f.player.currentMount!.group.rotation.y).toBe(Math.PI)
    town.careerMounts.dismiss()
    town.restoreActiveCareerMission()
    expect(f.player.isMounted).toBe(false)
  })

  it('civilians flee, equip faction T1 only at close contact, and resume shelter instead of hunting', () => {
    const f = fixture(faction), civilian = f.controller.civilians[0], attacker = f.controller.enemies.find(npc => !npc.isMounted)!
    expect(civilian.tacticalOrder).toBe('formation')
    attacker.group.position.copy(civilian.combatPosition)
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

  it('reload keeps casualty roles distinct, the same mission ID and dead player', () => {
    const f = fixture(faction)
    f.controller.enemies[0].takeDamage(999999)
    f.controller.military[0].takeDamage(999999)
    f.controller.civilians[0].takeDamage(999999)
    f.controller.updateFlow(4, 0)
    f.player.takeDamage(999999, { setFill: vi.fn() } as any)
    f.controller.persistRuntimeProgress(true)
    const saved = parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!
    expect(saved.activeMission).toMatchObject({ id: 'assault-test', kind: 'enemy-town-assault', playerDead: true, phase: 'ATTACKING', defensePreparationElapsed: 0 })
    expect(saved.activeMission!.deadTargetActorIds).toHaveLength(1)
    expect(saved.activeMission!.deadFriendlyActorIds).toHaveLength(1)
    expect(saved.activeMission!.deadCivilianActorIds).toHaveLength(1)
    f.setProfile(saved)
    expect(f.controller.startActiveMission()).toBe(true)
    expect(f.controller.enemies).toHaveLength(88)
    expect(f.controller.preparationRemaining).toBe(0)
    expect(f.controller.evaluate(true)).toBeNull()
  })
})

describe('shared Town wartime and settlement', () => {
  it('sounds the assault alarm only after the ready battlefield has rendered a frame', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
    const frame = vi.fn(), alert = vi.fn()
    const town = Object.assign(createTownCombatFixture(), {
      disposed: false, defense: { assault: true }, profile: { activeMission: { id: 'ready-assault' } }, frame, playAssaultAlert: alert,
    })
    town.start()
    expect(alert).not.toHaveBeenCalled()
    callbacks.shift()!(performance.now())
    expect(frame).toHaveBeenCalledOnce()
    expect(alert).not.toHaveBeenCalled()
    callbacks.shift()!(performance.now())
    expect(alert).toHaveBeenCalledOnce()
  })

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
    expect(claim.meritAwarded).toBe(calculateMerit({ player: { ...stats, survived: false }, squads: [] }, 'victory', 'offense', 'mission').total)
    const reload = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(claimCareerMission(reload, 'assault-test', 'victory', stats).meritAwarded).toBe(0)
    expect(clearCareerMission(reload, 'assault-test')).toMatchObject({ faction: 'roman', totalMerit: claim.meritAwarded })
  })

  it('updates military and assault combat on the first frame and permits immediate damage', () => {
    const f = fixture('roman'), town = townHarness(f)
    const military = f.controller.military[0], civilian = f.controller.civilians[0], attacker = f.controller.enemies[0]
    const updateMilitary = vi.spyOn(military, 'update'), updateAttacker = vi.spyOn(attacker, 'update'), updateCivilian = vi.spyOn(civilian, 'update')
    const simulation = combatFixture({
      controllers: { defense: f.controller },
      simulation: {
        player: () => f.player, cameraPosition: town.camera.position, obstacles: town.world.obstacles,
        navigation: f.navigation, hp: town.hp, careerMounts: town.careerMounts,
        updateCommandCue: town.updateCareerCommandCue,
        hitNpc: (target, damage, method, source) => town.hitFieldNpc(target, damage, method, source),
        damagePlayer: (source, damage, method) => town.damagePlayerFromNpc(source, damage, method),
        fireNpc: (origin, direction, kind, source) => town.fire(origin, direction, source.rangedProjectileSpeed, source.rangedDamage, false, false, kind, source),
      },
    })
    simulation.combat.update(.016, town.orbit.cameraYaw, town.elapsed)
    expect(updateMilitary).toHaveBeenCalledOnce(); expect(updateAttacker).toHaveBeenCalledOnce(); expect(updateCivilian).toHaveBeenCalledOnce()
    const before = military.hp
    town.hitFieldNpc(military, 20, 'melee', attacker)
    expect(military.hp).toBeLessThan(before)
  })

  it('resumes legacy preparation saves immediately without losing casualties or progress', () => {
    const f = fixture('roman'), saved = f.profile()
    saved.activeMission!.phase = 'PREPARING'
    saved.activeMission!.defensePreparationElapsed = 4
    saved.activeMission!.deadFriendlyActorIds = [saved.activeMission!.friendlyActorIds[0]]
    f.setProfile(saved)
    expect(f.controller.startActiveMission()).toBe(true)
    expect(f.controller.phase).toBe('ATTACKING')
    expect(f.controller.preparationRemaining).toBe(0)
    expect(f.controller.enemies).toHaveLength(88)
    expect(f.controller.enemies.every(npc => npc.tacticalOrder === 'attack')).toBe(true)
    expect(f.profile().activeMission!.defensePreparationElapsed).toBe(4)
  })

  it('allows Tab equipment immediately while retaining dead-player restrictions', () => {
    const f = fixture('roman'), town = townHarness(f)
    vi.stubGlobal('document', { exitPointerLock: vi.fn() })
    town.input = { clear: vi.fn() }
    town.skills = {}; town.equipment = { visible: false, open: vi.fn() }
    const key = (code: string) => ({ code, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() })
    const tab = key('Tab'); town.key(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(town.equipment.open).toHaveBeenCalledWith(town.skills, town.inventory, expect.any(Function), town.careerMounts)
    town.equipment.visible = true; town.closePanel = vi.fn()
    town.key(key('Tab')); expect(town.closePanel).toHaveBeenCalledOnce()
    town.equipment.visible = false; town.equipment.open.mockClear()
    f.player.takeDamage(999999, town.hp)
    town.key(key('Tab')); expect(town.equipment.open).not.toHaveBeenCalled()
  })
})
