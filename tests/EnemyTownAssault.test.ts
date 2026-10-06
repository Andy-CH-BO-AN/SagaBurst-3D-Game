import { advanceNpcFrame, completeNpcDeployment } from './helpers/npcSpawnFrames'
import { createTownFortifications } from '../src/town/TownFortifications'
import { TownCavalryPatrolController } from '../src/town/TownCavalryPatrolController'
import { TOWN_NAVIGATION_BOUNDS } from '../src/town/TownBounds'
import { siegeRoster, siegeDefensePlans, siegePoint, siegeNearestGate, siegeOutward } from '../src/career/TownSiege'
import { townAssaultObjectiveRoster } from '../src/town/TownRules'
import { createTownCombatFixture } from './townCombatFixture'
import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAssaultRoster, createEnemyTownAssaultMission, careerTownFaction, prepareEnemyTownAssaultEquipment, resolveAssaultOutcome } from '../src/career/EnemyTownAssault'
import { MAX_COMMAND_SQUAD_SIZE } from '../src/battle/CommandTarget'
import { CAREER_RANK_THRESHOLDS, claimCareerMission, createCareerProfile, clearCareerMission, type CareerRank } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { townCaptainProfile, townMilitaryEquipment, townRoster } from '../src/town/TownRules'
import { TOWN_CITY } from '../src/town/TownLayout'
import { townWartimeHostile, civilianWartimeWeapon } from '../src/town/TownWartime'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { Player } from '../src/player/Player'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { createTownDefenseMission } from '../src/career/CareerMissionState'
import { TOWN_DEFENSE_TEMPLATE_ID, SOLDIER_TOWN_DEFENSE_TEMPLATE_ID, VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../src/career/TownDefenseState'
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
const npcConstruction = vi.hoisted(() => ({ count: 0 }))
vi.mock('../src/world/NPC', async original => {
  const actual = await original<typeof import('../src/world/NPC')>()
  return { ...actual, NPC: class extends actual.NPC {
    constructor(...args: ConstructorParameters<typeof actual.NPC>) { super(...args); npcConstruction.count++ }
  } }
})
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

function fixture(faction: 'roman' | 'viking', assault = true, templateId = VETERAN_TOWN_DEFENSE_TEMPLATE_ID, rank: CareerRank = 'veteran', deferStart = false) {
  const scene = new THREE.Scene()
  let profile = createCareerProfile(faction)
  profile.rank = rank; profile.totalMerit = CAREER_RANK_THRESHOLDS[rank]
  const townFaction = assault ? faction === 'roman' ? 'viking' : 'roman' : faction
  const roster = townRoster().filter(spec => spec.role !== 'cat' && spec.role !== 'merchant')
  const residents = roster.map(spec => {
    const civilian = spec.role === 'civilian', ranger = spec.role === 'ranger'
    const military = townMilitaryEquipment(townFaction, spec)
    const hero = spec.role === 'captain' ? townCaptainProfile(townFaction) : undefined
    const npc = new NPC(scene, spec.x, spec.z, assault ? Faction.ENEMY : Faction.TOWN, townFaction,
      ranger || spec.unitKind === 'ranged' || spec.unitKind === 'archer' || spec.unitKind === 'horse_archer' ? AIType.RANGED : AIType.MELEE, spec.id, ranger || hero ? 4 : 2,
      spec.mounted,
      civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow' } : military.loadout,
      military.presetId, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : hero?.visualAssetId,
      ranger ? 'ranger' : hero?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, townFaction)
    npc.setTownPeaceful()
    return { spec, npc }
  })
  const player = new Player(scene, faction)
  const cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  const obstacles: any[] = []
  const material = new THREE.MeshBasicMaterial()
  const city = createTownFortifications(townFaction, obstacles, { stone: material, wood: material, dark: material, snow: material })
  scene.add(city.root)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(obstacles)
  const patrol = new TownCavalryPatrolController(residents)
  profile.activeMission = assault ? createEnemyTownAssaultMission('assault-test') : createTownDefenseMission(
    townAssaultObjectiveRoster(residents.map(r => r.spec)).map(r => r.id), residents.filter(r => r.spec.role === 'civilian').map(r => r.spec.id), 'defense-test', templateId, rank)
  const controller = new TownDefenseController(scene, residents, () => player, () => profile, p => { profile = p; return true }, cat, navigation, { gates: city.gates, obstacles, patrol, closureBodies: () => [] })
  if (!deferStart) expect(completeNpcDeployment(() => controller.startActiveMission())).toBe(true)
  dispose.push(() => { controller.dispose(); residents.forEach(r => r.npc.dispose()); player.dispose(); cat.dispose() })
  return { controller, player, residents, navigation, scene, gates: city.gates, obstacles, patrol, profile: () => profile, setProfile: (p: typeof profile) => { controller.dispose(); profile = p } }
}


for (const faction of ['roman', 'viking'] as const) describe(`${faction} shared four-gate Siege`, () => {
  it('uses four squads with four T4 officers and counts Player inside the Assault roster', () => {
    for (const assault of [false, true]) {
      const roster = siegeRoster(faction, assault)
      expect(roster).toHaveLength(assault ? 119 : 120)
      expect(roster.filter(s => s.spec.tier === 4)).toHaveLength(4)
      expect(roster.filter(s => s.spec.combatProfileId === 'ranger')).toHaveLength(1)
      expect(roster.find(s => s.spec.combatProfileId === 'ranger')!.spec.loadout?.mountId).toBe('black-cat')
      for (const id of ['north', 'south', 'east', 'west']) expect(roster.filter(s => s.gateId === id).length + (assault && id === 'north' ? 1 : 0)).toBe(30)
      expect(roster.every(s => s.spec.tier === 4 || s.spec.tier === 3)).toBe(true)
    }
    const objective = createEnemyTownAssaultMission().targetActorIds
    expect(objective).toHaveLength(203)
    expect(objective.filter(id => id.startsWith('gate:'))).toHaveLength(40)
    expect(objective.filter(id => id.startsWith('town-patrol:'))).toHaveLength(40)
    expect(objective.some(id => id.startsWith('civilian'))).toBe(false)
  })

  it.each([true, false])('deploys the whole battlefield during loading and waits ten seconds, assault=%s', assault => {
    const f = fixture(faction, assault)
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.preparationRemaining).toBe(10)
    expect([...f.gates.values()].every(g => g.state === 'closed')).toBe(true)
    expect(f.controller.releasedEnemies).toHaveLength(0)
    for (const [npc, point] of (f.controller as any).orders as Map<NPC, THREE.Vector3>) {
      expect(npc.combatPosition.distanceTo(point)).toBeLessThan(.01)
      expect((npc as any)._findTarget(f.player, f.controller.fieldNpcs)).toBeNull()
    }
    f.controller.updateFlow(9.9, 0)
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.releasedEnemies).toHaveLength(0)
    f.controller.updateFlow(.1, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    expect(f.controller.releasedEnemies).toHaveLength(assault ? 119 : 120)
  })

  it.each([true, false])('resumes the remaining countdown without repositioning or reinforcing, assault=%s', assault => {
    const f = fixture(faction, assault)
    f.controller.updateFlow(4, 0)
    const defender = f.controller.military.find(npc => !npc.isMounted)!
    defender.group.position.add(new THREE.Vector3(2, 0, 2))
    const position = defender.combatPosition.clone()
    f.controller.enemies[2].takeDamage(999999)
    f.gates.get('west')!.destroy()
    f.controller.persistRuntimeProgress(true)
    f.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!)
    completeNpcDeployment(() => f.controller.startActiveMission())
    expect(f.controller.preparationRemaining).toBe(6)
    expect(defender.combatPosition.x).toBeCloseTo(position.x)
    expect(defender.combatPosition.z).toBeCloseTo(position.z)
    expect(f.controller.enemies).toHaveLength(assault ? 118 : 119)
    expect(f.gates.get('west')!.state).toBe('destroyed')
    f.controller.updateFlow(5.9, 0)
    expect(f.controller.phase).toBe('PREPARING')
    f.controller.updateFlow(.1, 0)
    expect(f.controller.phase).toBe('ATTACKING')
  }, 15000)

  it('applies outward doorway clearance when a preparation checkpoint restores open gates', () => {
    const f = fixture(faction, false)
    f.player.group.position.copy(siegePoint('north', 0, 0))
    f.controller.updateFlow(3, 0)
    f.controller.persistRuntimeProgress(true)
    f.gates.get('north')!.restoreOpen()
    const context = (f.controller as any).siegeContext
    context.closureBodies = () => [{ position: f.player.combatPosition, radius: .5, moveTo: (point: THREE.Vector3) => f.player.group.position.copy(point) }]
    const hp = f.player.hp
    f.controller.dispose(); completeNpcDeployment(() => f.controller.startActiveMission())
    expect(f.gates.get('north')!.state).toBe('closed')
    expect(f.player.combatPosition.clone().sub(siegePoint('north', 0, 0)).dot(siegeOutward('north'))).toBeGreaterThan(.5)
    expect(f.player.hp).toBe(hp)
    expect(f.controller.preparationRemaining).toBe(7)
  })

  it('stages every cavalry reserve nearest its assigned gate', () => {
    const f = fixture(faction)
    for (const group of f.controller.groups) for (const npc of group.cavalry) {
      expect(siegeNearestGate(npc.combatPosition)).toBe(group.id)
      expect(npc.combatPosition.distanceTo(siegePoint(group.id, 0, 0))).toBeLessThan(75)
    }
  })

  it.each(['north', 'south', 'east', 'west'] as const)('keeps %s relief focused on its own breach and returns when that threat leaves', gateId => {
    const f = fixture(faction)
    f.controller.updateFlow(10, 0)
    const group = f.controller.groups.find(g => g.id === gateId)!
    const otherGate = gateId === 'west' ? 'north' : 'west'
    const [enemy, distraction] = f.controller.enemies.slice(2, 4)
    const place = (npc: NPC, point: THREE.Vector3) => { npc.group.position.copy(point); npc.mount?.group.position.copy(point) }
    place(enemy, siegePoint(gateId, 0, 5))
    place(distraction, siegePoint(otherGate, 0, 5))
    f.player.group.position.copy(siegePoint(otherGate, 0, 5))
    f.gates.get(gateId)!.destroy()
    for (const npc of [...group.members, ...group.cavalry]) {
      expect(npc.missionMovement).toBe(false)
      expect((npc as any)._getTarget(.05, f.player, f.controller.enemies)?.npc).toBe(enemy)
      expect((npc as any)._trySwitchToVisibleRangedTarget(f.player, [distraction], null, [])).toBe(false)
    }
    const guard = group.cavalry[0]
    const start = guard.combatPosition.clone()
    guard.update(.05, f.player, [enemy, distraction], [], [], null as never, () => {}, () => {}, true)
    expect(guard.combatPosition.distanceTo(start)).toBeGreaterThan(0)
    place(enemy, siegePoint(otherGate, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._getTarget(.05, f.player, [enemy, distraction])).toBeNull()
    expect(guard.missionMovement).toBe(true)
    expect(siegeNearestGate((f.controller as any).orders.get(guard))).toBe(gateId)
    f.player.group.position.copy(siegePoint(gateId, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._getTarget(.05, f.player, [])?.isPlayer).toBe(true)
    f.controller.cleanupMission()
    expect((guard as any).missionCombatTarget).toBeUndefined()
  })

  it('still defends its own breach against nearby ambient Bandits', () => {
    const f = fixture(faction, false)
    const point = siegePoint('east', 0, 5)
    const bandit = new NPC(f.scene, point.x, point.z, Faction.BANDIT, faction, AIType.MELEE, 'Ambient bandit')
    dispose.push(() => bandit.dispose())
    const context = (f.controller as any).siegeContext
    context.ambientEnemies = () => [bandit]
    f.controller.updateFlow(10, 0)
    f.gates.get('east')!.destroy()
    const guard = f.controller.groups.find(g => g.id === 'east')!.cavalry[0]
    expect((guard as any)._getTarget(.05, f.player, [bandit])?.npc).toBe(bandit)
  })

  it('keeps gate guards local, balances infantry and assigns four existing cavalry officers', () => {
    const plans = siegeDefensePlans(townRoster())
    expect(plans.map(p => p.infantry.length).sort()).toEqual([25, 25, 25, 26])
    expect(plans.map(p => p.cavalry.length).sort()).toEqual([25, 25, 26, 26])
    for (const p of plans) expect(p.infantry.filter(id => id.startsWith('gate:')).every(id => id.startsWith(`gate:${p.gateId}:`))).toBe(true)
    expect(plans.map(p => p.leaderId)).toEqual(['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain'])
  })

  it('releases only breached reserves, preserves casualties and breaches across repeated reloads', () => {
    const f = fixture(faction)
    expect(f.controller.enemies.find(n => n.combatProfileId === 'ranger')!.mount!.type).toBe(MountType.BLACK_CAT)
    f.controller.updateFlow(10, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    f.controller.noteEffectiveFriendlyDamage(f.controller.military[0])
    expect(f.controller.reserveHasCharged).toBe(false)
    f.gates.get('north')!.destroy(); f.gates.get('west')!.destroy()
    const assertBreachOrders = () => {
      for (const group of (f.controller as any).groups) {
        const released = group.id === 'north' || group.id === 'west'
        for (const npc of [...group.members, ...group.cavalry] as NPC[]) {
          if (npc.dead) continue
          expect(npc.missionMovement).toBe(true)
          expect(npc.tacticalOrder).toBe('formation')
          if (released) expect((npc as any).missionCombatTarget).toBeNull()
        }
      }
    }
    assertBreachOrders()
    const deadId = f.controller.enemies[2].combatantId
    f.controller.enemies[2].takeDamage(999999)
    const footId = f.controller.enemies[3].combatantId
    f.controller.enemies[3].mount!.takeDamage(999999); f.controller.enemies[3].dismountFromMount()
    f.controller.military[0].takeDamage(999999)
    f.controller.civilians[0].takeDamage(999999)
    f.controller.persistRuntimeProgress(true)
    for (let i = 0; i < 2; i++) {
      const saved = parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!
      expect(saved.activeMission!.siege!.releasedReserveGateIds.sort()).toEqual(['north', 'west'])
      expect(saved.activeMission!.actorHealth![footId].mountHp).toBe(0)
      f.setProfile(saved)
      expect(completeNpcDeployment(() => f.controller.startActiveMission())).toBe(true)
      expect(f.controller.enemies).toHaveLength(118)
      expect(f.controller.enemies.find(n => n.combatProfileId === 'ranger')!.mount!.type).toBe(MountType.BLACK_CAT)
      expect(f.controller.enemies.some(n => n.combatantId === deadId)).toBe(false)
      expect(f.controller.enemies.find(n => n.combatantId === footId)!.isMounted).toBe(false)
      expect(f.gates.get('north')!.state).toBe('destroyed')
      expect(f.gates.get('east')!.state).toBe('closed')
      expect(f.controller.civilianDeaths).toBe(1)
      assertBreachOrders()
    }
    f.controller.cleanupMission()
    expect([...f.gates.values()].every(g => g.state === 'open')).toBe(true)
  })

  it('does not erase saved Player death while the restored scene is still initializing', () => {
    const f = fixture(faction)
    const saved = f.profile()
    saved.activeMission!.playerDead = true
    f.setProfile(saved)
    expect(f.player.dead).toBe(false)
    completeNpcDeployment(() => f.controller.startActiveMission())
    expect(f.profile().activeMission!.playerDead).toBe(true)
  })

  it('never reinforces preparation losses and keeps objective-based outcomes after Player death', () => {
    const f = fixture(faction)
    f.controller.enemies[0].takeDamage(999999)
    f.controller.updateFlow(30, 0)
    expect(f.controller.enemies).toHaveLength(119)
    expect(f.controller.remainingEnemies).toBe(118)
    expect(f.controller.evaluate(true)).toBeNull()
    f.controller.enemies.forEach(n => n.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe('failure')
    f.controller.military.forEach(n => n.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe('victory')
  })

  it('does not abandon North for an East breach, replaces dead leaders, and only clears after crossing North', () => {
    const f = fixture(faction)
    expect((f.controller as any).attackGroups.every((g: any) => g.leader.tier === 4)).toBe(true)
    f.controller.updateFlow(10, 0)
    const group = (f.controller as any).attackGroups.find((g: any) => g.id === 'north')
    group.leader.takeDamage(999999)
    f.gates.get('east')!.destroy()
    const npc: NPC = group.members[2]
    const tick = () => npc.update(.05, f.player, [npc], [], [], null as never, () => {}, () => {}, true)
    tick()
    expect(npc.sprinting).toBe(true)
    expect(npc.visualMovementSpeed).toBeGreaterThanOrEqual(npc.mount!.baseSpeed * 2)
    const approach = siegePoint('north', 0, -12)
    npc.group.position.copy(approach); npc.mount?.group.position.copy(approach)
    f.controller.updateFlow(.02, 0)
    expect(group.leader.dead).toBe(false)
    expect(npc.hasSiegeObstacle).toBe(true)
    expect((npc as any).assignedSiegeObstacle).toBe(f.gates.get('north')!.siegeObstacle)
    tick()
    expect(npc.visualMovementSpeed).toBeGreaterThanOrEqual(npc.mount!.baseSpeed)
    f.gates.get('north')!.destroy(); f.controller.updateFlow(.02, 0)
    expect(npc.hasSiegeObstacle).toBe(false)
    expect(f.profile().activeMission!.siege!.crossedActorIds).not.toContain(npc.combatantId)
    const inside = siegePoint('north', 0, 12)
    npc.group.position.copy(inside); npc.mount?.group.position.copy(inside)
    f.controller.updateFlow(.02, 0); f.controller.persistRuntimeProgress(true)
    expect(f.profile().activeMission!.siege!.crossedActorIds).toContain(npc.combatantId)
    expect(npc.missionMovement).toBe(false)
  })
})

function townHarness(f: ReturnType<typeof fixture>) {
  const town = createTownCombatFixture() as any
  Object.assign(town, { profile: f.profile(), defense: f.controller, player: f.player, camera: new THREE.PerspectiveCamera(), orbit: { cameraYaw: 0 }, world: { obstacles: [] }, navigation: f.navigation,
    grid: new SpatialGrid(4), defenseEnemyGrid: new SpatialGrid(8), defenseTownGrid: new SpatialGrid(8), neighbors: [], hp: { setFill: vi.fn() },
    inventory: { shieldEnabled: false }, careerMounts: { activeMount: null, update: vi.fn() }, cat: new Mount(f.scene, MountType.BLACK_CAT, -34, 20), elapsed: 0, shots: [], updateCareerCommandCue: vi.fn(), damageNumbers: { spawn: vi.fn() } })
  dispose.push(() => town.cat.dispose())
  return town
}


describe('Siege retained combat and settlement contracts', () => {
  it.each([true, false])('sounds the alarm only after the ready battlefield has rendered a frame, assault=%s', assault => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
    const frame = vi.fn(), alert = vi.fn()
    const town = Object.assign(createTownCombatFixture(), {
      disposed: false, siegeOpeningPending: true, defense: { assault }, profile: { activeMission: { id: 'ready-assault' } }, frame, playAssaultAlert: alert, playTownDefenseAlert: alert,
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
    expect(f.controller.military.filter(n => !n.dead)).toHaveLength(203)
    const claim = claimCareerMission(f.profile(), 'assault-test', 'victory', { ...stats, survived: false })
    expect(claim.meritAwarded).toBe(calculateMerit({ player: { ...stats, survived: false }, squads: [] }, 'victory', 'offense', 'mission').total)
    const reload = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(claimCareerMission(reload, 'assault-test', 'victory', stats).meritAwarded).toBe(0)
    expect(clearCareerMission(reload, 'assault-test')).toMatchObject({ faction: 'roman', totalMerit: f.profile().totalMerit + claim.meritAwarded })
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

  it('allows Tab equipment immediately while retaining dead-player restrictions', () => {
    const f = fixture('roman'), town = townHarness(f)
    vi.stubGlobal('document', { exitPointerLock: vi.fn() })
    town.input = { clear: vi.fn() }
    town.skills = {}; town.equipment = { visible: false, open: vi.fn() }
    const key = (code: string) => ({ code, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() })
    const tab = key('Tab'); town.key(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(town.equipment.open).toHaveBeenCalledWith(town.skills, town.inventory, expect.any(Function), town.careerMounts, expect.objectContaining({ render: expect.any(Function) }))
    town.equipment.visible = true; town.closePanel = vi.fn()
    town.key(key('Tab')); expect(town.closePanel).toHaveBeenCalledOnce()
    town.equipment.visible = false; town.equipment.open.mockClear()
    f.player.takeDamage(999999, town.hp)
    town.key(key('Tab')); expect(town.equipment.open).not.toHaveBeenCalled()
  })
})


describe('Siege actual constructor frame budget', () => {
  it.each([false, true])('creates the complete four-gate army one per frame before consuming preparation time, assault=%s', assault => {
    const h = fixture('roman', assault, VETERAN_TOWN_DEFENSE_TEMPLATE_ID, 'veteran', true)
    const before = npcConstruction.count, total = assault ? 119 : 120
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(npcConstruction.count).toBe(before)
    for (let i = 1; i <= total; i++) {
      advanceNpcFrame(); expect(npcConstruction.count - before).toBe(i)
      if (i < total) {
        expect(h.controller.ready).toBe(false); h.controller.updateFlow(100, 0)
        expect(h.controller.preparationRemaining).toBe(10)
        expect(h.controller.evaluate()).toBeNull()
      }
    }
    expect(h.controller.ready).toBe(true); expect(h.controller.enemies).toHaveLength(total)
    expect(h.controller.enemies.filter(npc => npc.isMounted).every(npc => npc.mount?.riderNpc === npc)).toBe(true)
    expect(h.controller.preparationRemaining).toBe(10)
  })
})
