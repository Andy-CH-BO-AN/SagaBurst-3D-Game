import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { initialPersonalEquipment } from '../src/career/CareerInventory'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile } from '../src/career/CareerProfile'
import { TownWorld } from '../src/town/TownWorld'
import { resolveTownHRLayout, hrOfficerSpec } from '../src/town/TownHRLayout'
import { TownPersonalSquadController } from '../src/town/TownPersonalSquadController'
import { TOWN_CITY } from '../src/town/TownLayout'
import { TOWN_SITES, isTownMilitary, townActorCaptainProfile, townAssaultObjectiveRoster, townSettlementRoster, settleTown } from '../src/town/TownRules'
import { NPC, AIState, AIType, Faction } from '../src/world/NPC'
import { MountType, mountTypeFromId } from '../src/world/Mount'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../src/town/TownBounds'
import { getTerrainHeight } from '../src/world/Terrain'
import { townWartimeHostile } from '../src/town/TownWartime'
import type { Player } from '../src/player/Player'
import { combatActor, combatFixture } from './helpers/townMissionCombat'
import { createTownCombatFixture } from './townCombatFixture'
import { careerMissionCommandMeritPolicy, createActiveCareerMission } from '../src/career/CareerMissionState'
import { snapshotPersonalMission } from '../src/career/CareerPersonalSquadMission'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'

vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: {
  ready: true, createInstance: () => {
    const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
    return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null, setLocomotion() {}, setAppearanceVariant() {}, playOnce() {}, playDeath() {}, update() {}, dispose() {} }
  },
} }))
vi.mock('../src/world/MakiRangerEquipment', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/MakiRangerEquipment')>()), createMakiRangerBowInstance: () => ({
  model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1,
    gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1),
    longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) },
}) }))
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals() })
function harness(faction: 'roman' | 'viking' = 'roman', count = 3) {
  const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
  vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
  const scene = new THREE.Scene(), world = new TownWorld(faction, scene)
  const profile = { ...createCareerProfile(faction), rank: 'captain' as const,
    personalSquad: { members: Array.from({ length: count }, (_, i) => ({ id: `personal:${i}`, type: (['soldier', 'captain', 'ranger'] as const)[i % 3] })) } }
  const player = { group: new THREE.Group(), get combatPosition() { return this.group.position }, dead: false } as Player
  player.group.position.set(35, getTerrainHeight(35, 60), 60)
  const controller = new TownPersonalSquadController(scene, world.hr, () => profile, () => player)
  cleanups.push(() => world.dispose(), () => controller.cleanup())
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS); navigation.sync(world.obstacles)
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      navigation.sync(world.obstacles); navigation.beginFrame()
      for (const actor of controller.actors) actor.updateTownTravel(.05, 30, controller.actors, world.obstacles, navigation)
      controller.updateLifecycle()
    }
  }
  return { scene, world, profile, player, controller, navigation, step }
}
describe('HR Center and personal runtime', () => {
  it.each(['roman', 'viking'] as const)('places %s hall behind Horse Shop with thirty clear mounted slots', faction => {
    const { world, navigation } = harness(faction)
    const hr = world.buildings.find(building => building.id === 'hr-center')!
    expect(hr).toBeDefined(); expect(hr.hp.maxHp).toBe(world.buildings.find(building => building.id === 'hall')!.hp.maxHp)
    expect((world.hr.site.x - TOWN_SITES.stable.x) * Math.sin(TOWN_SITES.stable.yaw)
      + (world.hr.site.z - TOWN_SITES.stable.z) * Math.cos(TOWN_SITES.stable.yaw)).toBeLessThan(0)
    expect(world.hr.site.x).toBeGreaterThan(TOWN_CITY.minX)
    for (const building of world.buildings.filter(building => building !== hr)) for (const obstacle of building.obstacles) {
      expect(obstacle.box.intersectsBox(hr.obstacles[0].box), building.id).toBe(false)
    }
    const actor = hrOfficerSpec(world.hr)
    expect(actor).toMatchObject({ id: 'hr-officer', duty: 'service', tier: 4, mounted: true, settlementObjective: false, assaultObjective: false })
    expect(isTownMilitary(actor)).toBe(false); expect(townAssaultObjectiveRoster([actor])).toHaveLength(0); expect(townSettlementRoster([actor])).toHaveLength(0)
    expect(mountTypeFromId(townActorCaptainProfile(faction, actor)!.mountOverride)).toBe(faction === 'roman' ? MountType.CORGI : MountType.BLACK_CAT)
    for (const slot of [world.hr.officer, ...world.hr.muster]) {
      const box = new THREE.Box3(new THREE.Vector3(slot.x - 1.8, -50, slot.z - 1.8), new THREE.Vector3(slot.x + 1.8, 50, slot.z + 1.8))
      expect(world.obstacles.some(obstacle => obstacle.box.intersectsBox(box))).toBe(false)
      expect(navigation.areConnected(slot, { x: 0, z: 0 })).toBe(true)
    }
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) expect(Math.hypot(world.hr.muster[i].x - world.hr.muster[j].x, world.hr.muster[i].z - world.hr.muster[j].z)).toBeGreaterThanOrEqual(4.4)
    expect(() => resolveTownHRLayout(faction, [{ box: new THREE.Box3(new THREE.Vector3(-500, -100, -500), new THREE.Vector3(500, 100, 500)), isBarricade: false }], world.roads)).toThrow()
  })
  it.each(['roman', 'viking'] as const)('spawns actual %s T2/T4 NPCs at HR and walks to a distant Player', faction => {
    const { controller, world, player, step } = harness(faction)
    expect(controller.actors).toHaveLength(0); expect(controller.state).toBe('RESERVE')
    controller.follow(); expect(controller.state).toBe('DEPLOYING')
    const original = [...controller.actors]
    for (const [index, npc] of original.entries()) {
      expect(npc.combatantId).toBe(`personal:${index}`); expect(npc.combatOwnership).toBe('player-personal')
      expect(npc.combatPosition.x).toBeCloseTo(world.hr.muster[index].x)
      expect(npc.combatPosition.distanceTo(player.combatPosition)).toBeGreaterThan(40)
      expect(npc.activeFollowTarget).toBe(player); expect(npc.respawnEnabled).toBe(false)
      expect(npc.tier).toBe(index === 0 ? 2 : 4)
      expect(npc.mount?.type ?? null).toBe(index === 0 ? null : MountType.HORSE)
    }
    expect(original[2]).toMatchObject({ aiType: AIType.RANGED, specialCombatProfile: 'maki-ranger', combatProfileId: 'ranger', visualAssetId: 'maki-archer-t4' })
    controller.follow(); expect(controller.actors).toEqual(original)
    step(1000)
    expect(controller.state).toBe('ACTIVE')
    for (const actor of controller.actors) expect(actor.combatPosition.distanceTo(player.combatPosition)).toBeLessThan(23)
    expect(controller.dismiss()).toBe(true); expect(controller.state).toBe('RETURNING')
    const commandIds = controller.actors.map(actor => actor.formationCommandId)
    expect(controller.dismiss()).toBe(false); expect(controller.actors.map(actor => actor.formationCommandId)).toEqual(commandIds)
    step(30); controller.follow(); expect(controller.state).toBe('ACTIVE'); expect(controller.actors).toEqual(original)
    expect(controller.actors.every(actor => actor.activeFollowTarget === player)).toBe(true)
    controller.dismiss(); step(1200)
    expect(controller.state).toBe('RESERVE'); expect(controller.actors).toHaveLength(0)
    expect(controller.mounts).toHaveLength(0); expect(controller.owns(original[0])).toBe(false)
  })
  it('preserves dead members until a full new deployment and refills HP, shield, arrows and horse', () => {
    const { controller, profile, step } = harness()
    controller.follow()
    const dead = controller.actors[0], captain = controller.actors[1], ranger = controller.actors[2]
    const shieldCapacity = captain.shield.shieldImpactRemaining
    dead.takeDamage(99999); captain.takeDamage(20); captain.mount!.takeDamage(20)
    captain.shield.absorb(100, 4); ranger.restoreCombatAmmo(0)
    controller.follow(); step(10)
    expect(dead.dead).toBe(true); expect(controller.actors[0]).toBe(dead)
    expect(profile.personalSquad.members).toHaveLength(3)
    controller.dismiss(); step(1200); expect(controller.state).toBe('RESERVE')
    controller.follow()
    for (const actor of controller.actors) { expect(actor.dead).toBe(false); expect(actor.hpRatio).toBe(1); if (actor.mount) expect(actor.mount.currentHp).toBe(actor.mount.maxHp) }
    expect(controller.actors[1].shield.shieldImpactRemaining).toBe(shieldCapacity)
    expect(controller.actors[2].combatAmmo).toBe(30)
    controller.actors.forEach(actor => actor.takeDamage(99999)); controller.updateLifecycle()
    expect(controller.state).toBe('RESERVE'); expect(controller.actors).toHaveLength(0)
    expect(profile.personalSquad.members).toHaveLength(3)
    controller.follow(); expect(controller.actors).toHaveLength(3)
  })
  it.each(['roman', 'viking'] as const)('holds %s personal Attack away from HR until Dismiss, including a targetless chase', faction => {
    const { controller, world, player, navigation, step } = harness(faction)
    controller.follow(); step(1000)
    const held = controller.actors.map(actor => actor.combatPosition.clone())
    for (const [index, actor] of controller.actors.entries()) {
      expect(held[index].distanceTo(new THREE.Vector3(world.hr.muster[index].x, held[index].y, world.hr.muster[index].z))).toBeGreaterThan(50)
      actor.setTacticalOrder('attack')
      // An ended chase must take the same no-target path as a fresh Attack order.
      actor.state = AIState.CHASE
    }
    const patrol = controller.actors.map(actor => vi.spyOn(actor as any, '_updatePatrol'))
    for (let frame = 0; frame < 300; frame++) {
      navigation.beginFrame()
      for (const actor of controller.actors) actor.update(.05, player, controller.actors, controller.actors, [],
        {} as any, () => {}, () => {}, true, 30, null, null, navigation)
      controller.updateLifecycle()
    }
    for (const [index, actor] of controller.actors.entries()) {
      expect(patrol[index].mock.calls.length).toBe(0)
      expect(Math.hypot(actor.combatPosition.x - held[index].x, actor.combatPosition.z - held[index].z)).toBeLessThan(.05)
      expect(actor.tacticalOrder).toBe('attack')
    }
    expect(controller.state).toBe('ACTIVE')
    controller.dismiss(); step(1200); expect(controller.state).toBe('RESERVE')
  })
  it.each(['roman', 'viking'] as const)('preserves member IDs through %s Town faction switch and rebuilds native gear for the new faction', faction => {
    const { controller, profile, scene, world, player } = harness(faction)
    const current = { ...profile, townEvent: { id: 'switch', state: 'hostile' as const } }
    const switched = settleTown(current, 'switch', 'town_defeated')
    const opposite = faction === 'roman' ? 'viking' : 'roman'
    expect(switched.faction).toBe(opposite); expect(switched.rank).toBe('recruit')
    expect(switched.personalSquad).toEqual(profile.personalSquad)
    const rebuilt = new TownPersonalSquadController(scene, world.hr, () => switched, () => player)
    cleanups.push(() => rebuilt.cleanup())
    controller.cleanup(); rebuilt.follow()
    expect(rebuilt.actors.map(actor => actor.combatantId)).toEqual(profile.personalSquad.members.map(member => member.id))
    expect(rebuilt.actors.every(actor => actor.characterFaction === opposite && actor.faction === Faction.PLAYER)).toBe(true)
    expect(rebuilt.actors[0].presetId).toBe(`${opposite}_${opposite === 'roman' ? 'heavy_infantry' : 'berserker'}`)
    expect(rebuilt.actors.slice(1).every(actor => actor.mount?.type === MountType.HORSE)).toBe(true)
  })
  it('redeploys real configured weapons after death, dismissal, reload and faction change without changing totals', () => {
    const { controller, profile, scene, world, player } = harness()
    const parsed = parseCareerProfile({ ...profile, totalMerit: 6000 })!
    parsed.inventory!.quantities.heavy_lance = 1
    parsed.personalSquad!.members[0].equipment!.melee = 'heavy_lance'
    parsed.personalSquad!.members[1].equipment!.mount = null
    const snapshot = JSON.stringify(parsed.inventory)
    const runtime = new TownPersonalSquadController(scene, world.hr, () => parsed, () => player)
    cleanups.push(() => runtime.cleanup()); runtime.follow()
    expect(runtime.actors[0]).toMatchObject({ tier: 2, meleeWeaponId: 'heavy_lance', isUsingLance: true })
    expect(runtime.actors[1]).toMatchObject({ tier: 4, combatProfileId: 'praetorian', isMounted: false })
    runtime.actors.forEach(actor => actor.takeDamage(99999)); runtime.updateLifecycle(); expect(runtime.state).toBe('RESERVE')
    expect(JSON.stringify(parsed.inventory)).toBe(snapshot)
    runtime.follow(); runtime.dismiss(); runtime.cleanup(); expect(JSON.stringify(parsed.inventory)).toBe(snapshot)
    const loaded = parseCareerProfile(parsed)!; loaded.faction = 'viking'
    const reloaded = new TownPersonalSquadController(scene, world.hr, () => loaded, () => player)
    cleanups.push(() => reloaded.cleanup()); reloaded.follow()
    expect(reloaded.actors[0].meleeWeaponId).toBe('heavy_lance'); expect(reloaded.actors[0].tier).toBe(2)
    expect(JSON.stringify(loaded.inventory)).toBe(snapshot)
    reloaded.cleanup(); loaded.personalSquad!.members = []; expect(reloaded.follow()).toBe(false)
  })
  it('uses a real melee backup with a bow and stops ranged-only attacks close up or out of ammo', () => {
    const { scene, world, player } = harness()
    const make = (melee: string | null) => new TownPersonalSquadController(scene, world.hr, () => ({ ...createCareerProfile('roman'),
      personalSquad: { members: [{ id: 'personal:bow', type: 'soldier', equipment: { ...initialPersonalEquipment('soldier', 'roman'), melee, ranged: 'recurve_longbow', shield: null } }] } }), () => player)
    const backup = make('gladius_standard'), onlyBow = make(null); cleanups.push(() => backup.cleanup(), () => onlyBow.cleanup())
    backup.follow(); onlyBow.follow()
    const enemy = new NPC(scene, 0, 3, Faction.BANDIT, 'viking', AIType.MELEE, 'enemy', 2); cleanups.push(() => enemy.dispose())
    for (const actor of [backup.actors[0], onlyBow.actors[0]]) {
      actor.group.position.set(0, getTerrainHeight(0, 0), 0); actor.setTacticalOrder('attack'); actor.state = AIState.CHASE
      const hit = vi.fn(), fire = vi.fn()
      for (let i = 0; i < 20; i++) actor.update(.05, player, [enemy], [enemy], [], {} as any, hit, fire, true, 30)
      expect(fire).not.toHaveBeenCalled()
      if (actor === onlyBow.actors[0]) { expect(hit).not.toHaveBeenCalled(); expect(actor.meleeWeaponId).toBeNull(); expect(actor.combatAmmo).toBe(30) }
      else expect(actor.hasActiveRangedWeapon).toBe(false)
    }
    const actor = onlyBow.actors[0]; actor.restoreCombatAmmo(0); actor.state = AIState.CHASE; enemy.group.position.z = 12
    const hit = vi.fn(), fire = vi.fn()
    for (let i = 0; i < 20; i++) actor.update(.05, player, [enemy], [enemy], [], {} as any, hit, fire, true, 30)
    expect(hit).not.toHaveBeenCalled(); expect(fire).not.toHaveBeenCalled()
    expect(onlyBow.dismiss()).toBe(true); expect(actor.tacticalOrder).toBe('formation')
  })
  it('keeps constructor patrol behavior for ordinary NPC Attack and still acquires hostiles for personal Attack', () => {
    const { controller, scene, player } = harness(); controller.follow()
    const ordinary = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'ordinary', 2)
    const enemy = new NPC(scene, 0, 3, Faction.BANDIT, 'viking', AIType.MELEE, 'enemy', 2)
    cleanups.push(() => ordinary.dispose(), () => enemy.dispose())
    const patrol = vi.spyOn(ordinary as any, '_updatePatrol')
    ordinary.update(.05, player, [], [], [], {} as any, () => {}, () => {}, true, 30)
    expect(patrol.mock.calls.length).toBe(1)
    const personal = controller.actors[0]
    personal.group.position.copy(ordinary.combatPosition); personal.setTacticalOrder('attack')
    personal.update(.05, player, [enemy], [enemy], [], {} as any, () => {}, () => {}, true, 30)
    expect(personal.state).toBe(AIState.ALERT)
  })
  it('reload resets thirty owned identities to reserve and mission start excludes deployment', () => {
    const { controller, world, scene, player, profile } = harness('roman', 30)
    controller.follow(); expect(controller.actors).toHaveLength(30)
    const originalIds = controller.actors.map(actor => actor.combatantId)
    controller.cleanup()
    const reloaded = new TownPersonalSquadController(scene, world.hr, () => profile, () => player)
    cleanups.push(() => reloaded.cleanup())
    expect(reloaded.state).toBe('RESERVE'); expect(reloaded.actors).toHaveLength(0)
    reloaded.follow(); expect(reloaded.actors.map(actor => actor.combatantId)).toEqual(originalIds)
    reloaded.cleanup(); Object.assign(profile, { activeMission: { id: 'formal' } })
    expect(reloaded.follow()).toBe(false); expect(reloaded.actors).toHaveLength(0)
  })
  it('uses actual NPC target selection for Town peace and Player-side hostility', () => {
    const { scene, controller, player } = harness()
    controller.follow()
    const personal = controller.actors[1], resident = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'resident', 2)
    resident.setTownPeaceful(); cleanups.push(() => resident.dispose())
    expect(townWartimeHostile(personal, resident)).toBe(false); expect(townWartimeHostile(resident, personal)).toBe(false)
    expect((personal as any)._findTarget(player, [resident])).toBeNull()
    expect((resident as any)._findTarget({ ...player, dead: true }, [personal])).toBeNull()
    resident.beginTownHostility()
    expect(townWartimeHostile(personal, resident)).toBe(true); expect(townWartimeHostile(resident, personal)).toBe(true)
    expect((personal as any)._findTarget(player, [resident])?.npc).toBe(resident)
    expect(personal.hostileToPlayer).toBe(false)
  })
  it('integrates personal NPCs once into free-play combat and actual return travel, not mission roster', () => {
    const { controller } = harness(); controller.follow()
    for (const npc of controller.actors) { vi.spyOn(npc, 'update').mockImplementation(() => {}); vi.spyOn(npc, 'updateTownTravel').mockImplementation(() => {}) }
    const enemy = combatActor('bandit', Faction.BANDIT)
    const fixture = combatFixture({ simulation: { personalSquad: () => controller } })
    fixture.field.ambientBandits.push(enemy)
    fixture.combat.update(.1, 0, 0)
    expect(fixture.field.friendlies).toHaveLength(0)
    expect(fixture.combat.runtimeParticipants).toContain(controller.actors[0])
    for (const npc of controller.actors) expect(npc.update).toHaveBeenCalledTimes(1)
    controller.dismiss(); fixture.combat.update(.1, 0, .1)
    for (const npc of controller.actors) expect(npc.updateTownTravel).toHaveBeenCalledTimes(1)
  })
  it('updates private actors exactly once in formal Defense without applying official civilian orders', () => {
    const { controller } = harness(); controller.follow()
    for (const npc of controller.actors) vi.spyOn(npc, 'update').mockImplementation(() => {})
    const f = combatFixture({ simulation: { personalSquad: () => controller } })
    f.defense.active = { kind: 'town-defense', phase: 'ATTACKING' } as any; f.defense.phase = 'ATTACKING'
    f.combat.update(.1, 0, 0)
    expect(f.defense.fieldNpcs).toHaveLength(0)
    for (const npc of controller.actors) expect(npc.update).toHaveBeenCalledTimes(1)
    for (const call of f.defense.updateCivilianOrder.mock.calls) expect(controller.actors).not.toContain(call[0])
  })
  it('binds an existing wounded party only after successfully saving a formal mission, preserving instances', () => {
    const { controller, profile, player } = harness(); controller.follow()
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, personalSquad: controller, personalCommands: { close: vi.fn() },
      personalCommandUI: { setEnabled: vi.fn() }, skills: { skillState: profile.skills },
      store: { save: vi.fn(() => false) }, clearCareerSkillSaveTimer: vi.fn(),
    })
    const next = { ...profile, activeMission: createActiveCareerMission('recruit-bandits-01', 0, 3, 0) }
    const original = [...controller.actors]
    original[0].takeDamage(20); original[2].restoreCombatAmmo(3)
    const position = original[0].combatPosition.clone(), hp = original[0].hp
    expect(town.commit(next)).toBe(false); expect(controller.actors).toHaveLength(3)
    town.store.save.mockReturnValue(true)
    expect(town.commit(next)).toBe(true); expect(controller.state).toBe('DEPLOYING')
    expect(controller.actors).toEqual(original); expect(original[0].combatPosition).toEqual(position)
    expect(original[0].hp).toBe(hp); expect(original[2].combatAmmo).toBe(3)
    expect(original.every(actor => actor.squadId === 'personal' && actor.activeFollowTarget === player)).toBe(true)
    expect(town.profile.activeMission.personalSquad.memberIds).toEqual(original.map(actor => actor.combatantId))
    expect(town.profile.personalSquad).toEqual(profile.personalSquad)
    expect(town.personalCommands.close).toHaveBeenCalledOnce()
  })
  it.each(['melee', 'projectile', 'mount-impact'] as const)('does not award Player XP for personal %s damage or kills', method => {
    const { controller, profile, player, scene } = harness(); controller.follow()
    const enemy = new NPC(scene, 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'bandit', 2)
    cleanups.push(() => enemy.dispose())
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, personalSquad: controller, event: { hostile: false }, residents: [],
      defense: { active: false }, mission: { events: { emit: vi.fn() }, alertGroupFor: vi.fn() },
      awardCareerSkillXp: vi.fn(), inventory: {},
    })
    const hp = enemy.hpRatio
    town.hitFieldNpc(enemy, 10, method, controller.actors[1], { kind: 'body', time: .5 })
    expect(enemy.hpRatio).toBeLessThan(hp)
    town.hitFieldNpc(enemy, 99999, method, controller.actors[1], { kind: 'body', time: .5 })
    expect(enemy.dead).toBe(true); expect(town.awardCareerSkillXp).not.toHaveBeenCalled()
    expect(town.mission.events.emit).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ actorType: 'npc', actorId: 'personal:1' }) }))
  })
  it('retains actual private projectile attribution after the shooter dies and its runtime is disposed', () => {
    const { controller, profile, player, scene } = harness(); controller.follow()
    const mission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    mission.phase = 'ENGAGING'; mission.personalSquad = controller.captureForMission(snapshotPersonalMission(profile)!)
    const events = new CombatEventStream(), observed: unknown[] = []
    events.subscribe(event => observed.push(event))
    const tracker = new BattleStatsTracker(events, true, undefined, {}, careerMissionCommandMeritPolicy(mission))
    cleanups.push(() => tracker.dispose())
    const enemy = new NPC(scene, 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'bandit', 2,
      false, { meleeWeaponId: 'viking_axe_t1', shieldId: null }, 'viking_berserker', undefined, mission.targetActorIds[0])
    enemy.restoreCombatHealth(17); cleanups.push(() => enemy.dispose())
    const town = Object.assign(createTownCombatFixture(), {
      scene, profile, player, personalSquad: controller, event: { hostile: false }, residents: [], shots: [],
      world: { obstacles: [], targets: [], buildings: [] }, defense: { active: false },
      mission: { events, friendlies: [], ambientBandits: [], missionBandits: [enemy], combatPeersFor: () => [enemy], alertGroupFor: vi.fn() },
      awardCareerSkillXp: vi.fn(), inventory: {},
    })
    const shooter = controller.actors[2], origin = enemy.combatPosition.clone().add(new THREE.Vector3(-2, 1, 0))
    town.fire(origin, new THREE.Vector3(1, 0, 0), 40, 100, false, false, 'arrow', shooter)
    expect(town.shots[0].sourceRef).toMatchObject({ actorType: 'npc', actorId: 'personal:2', squadId: 'personal', ownership: 'player-personal' })
    shooter.takeDamage(99999); controller.cleanup()
    shooter.combatOwnership = undefined
    town.updateShots(.1)
    expect(enemy.dead).toBe(true); expect(town.shots).toHaveLength(0)
    expect(observed).toHaveLength(2)
    expect(observed[0]).toMatchObject({ source: { actorType: 'npc', actorId: 'personal:2', squadId: 'personal', ownership: 'player-personal' }, appliedDamage: 17 })
    expect(tracker.commandCheckpoint()).toMatchObject({ damageDealt: 17, kills: 1 })
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, kills: 0 })
    expect(town.awardCareerSkillXp).not.toHaveBeenCalled()
  })
})
