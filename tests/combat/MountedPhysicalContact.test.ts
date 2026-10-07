import { installHorseTestAsset } from '../helpers/horseAsset'
import { installCorgiTestAsset } from '../helpers/corgiAsset'
import { installBlackCatTestAsset } from '../helpers/blackCatAsset'
import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ShieldCollider, WeaponSweep, traceCombatSegment, type CombatContact } from '../../src/combat/ShieldBlocking'
import { damageMount, damageNpc, damagePlayer } from '../../src/combat/DamageRouter'
import { createPlayerCombatActorRef, type CombatDamageContext, type CombatEvent } from '../../src/combat/CombatAttribution'
import { resolveSkillProgressionAward } from '../../src/rpg/CombatSkillProgression'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { Player } from '../../src/player/Player'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'
import { CareerMountController, ownedCareerMountIds } from '../../src/career/CareerMountController'
import { createCareerProfile, clearCareerMission } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { TownScene } from '../../src/town/TownScene'
import { createTownCombatFixture } from '../helpers/townCombatFixture'

beforeAll(async () => { await Promise.all([installHorseTestAsset(), installCorgiTestAsset(), installBlackCatTestAsset()]) })

const hp = { setFill: vi.fn() } as any
const disposables: Array<{ dispose(): void }> = []
afterEach(() => { disposables.splice(0).forEach(object => object.dispose()); vi.unstubAllGlobals() })
function fixture(type = MountType.HORSE) {
  const scene = new THREE.Scene(), player = new Player(scene)
  const rider = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Rider', 1, false)
  const mount = new Mount(scene, type, 0, 0, 50)
  rider.mountVehicle(mount)
  disposables.push(rider, player, mount)
  return { scene, player, rider, mount }
}
function ctx(player: Player, kind: CombatContact['kind'], mount?: Mount, method: CombatDamageContext['method'] = 'melee', events: CombatEvent[] = []): CombatDamageContext {
  return { source: createPlayerCombatActorRef(player), method, weaponId: 'steel_sword',
    contact: { kind, mount, time: .1 }, emit: event => events.push(event) }
}

describe('Mounted physical first contact', () => {
  it.each(Object.values(MountType))('%s: low segments hit the mount, high segments hit the rider', type => {
    const { rider, mount } = fixture(type), contact: CombatContact = { kind: 'body', time: Infinity }
    expect(traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), contact)).toBe(true)
    expect(contact.kind).toBe('mount'); expect(contact.mount).toBe(mount)
    const y = rider.group.position.y + 1.2
    expect(traceCombatSegment(rider, new THREE.Vector3(0, y, 3), new THREE.Vector3(0, y, -3), contact)).toBe(true)
    expect(contact.kind).toBe('body'); expect(contact.mount).toBeUndefined()
  })
  it.each([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])('follows mount heading %s, parent scale and proxy offset', heading => {
    const { mount } = fixture()
    mount.group.rotation.y = heading
    mount.group.scale.set(1.2, 1, 1.1)
    mount.group.updateWorldMatrix(true, true)
    const local = (x: number, y: number, z: number) => mount.group.localToWorld(new THREE.Vector3(x, y, z))
    const contact: CombatContact = { kind: 'body', time: Infinity }
    expect(traceCombatSegment(mount, local(0, .8, 3), local(0, .8, -3), contact)).toBe(true)
    expect(contact.time).toBeCloseTo(.3); expect(contact.kind).toBe('mount')
    expect(traceCombatSegment(mount, local(.7, .8, 3), local(.7, .8, -3), contact)).toBe(false)
  })
  it('compares shield, rider and mount rather than giving shield implicit priority', () => {
    const { scene, rider, mount } = fixture()
    const pivot = new THREE.Group(); scene.add(pivot)
    pivot.position.set(0, 50.8, 1.6)
    rider.shieldCollider = new ShieldCollider(pivot, rider.shield); rider.shieldCollider.setModel('scutum_t1')
    const out: CombatContact = { kind: 'body', time: Infinity }
    traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), out)
    expect(out.kind).toBe('shield')
    pivot.position.z = .2
    traceCombatSegment(rider, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 50.8, -3), out)
    expect(out.kind).toBe('mount'); expect(out.mount).toBe(mount)
  })
  it.each(['sword', 'lance'])('%s sweep consumes the first mount/body contact across targets', weapon => {
    const { rider, mount } = fixture(), sweep = new WeaponSweep()
    const length = weapon === 'lance' ? 3.9 : 1.8
    for (const [y, expected] of [[50.8, 'mount'], [rider.group.position.y + 1.2, 'body']] as const) {
      sweep.reset()
      sweep.capture(new THREE.Vector3(-length / 2, y, 3), new THREE.Vector3(length / 2, y, 3))
      sweep.capture(new THREE.Vector3(-length / 2, y, -3), new THREE.Vector3(length / 2, y, -3))
      expect(sweep.traceFirst([rider], [mount])?.kind).toBe(expected)
    }
  })
  it.each(['arrow', 'pilum'] as const)('fast %s stops at mount or rider without damaging both', kind => {
    for (const high of [false, true]) {
      const { scene, player, rider, mount } = fixture()
      rider.shield.shieldImpactRemaining = 0
      player.position.set(100, 50, 100)
      const before = rider.hp
      const y = high ? rider.group.position.y + 1.2 : 50.8
      const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, y, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true, kind)
      arrow.update(.03, player, [rider], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])
      expect(arrow.isAlive).toBe(false)
      expect(rider.hp).toBe(high ? before - 30 : before)
      expect(mount.currentHp).toBe(high ? 100 : 70)
      expect(arrow.mesh.position.z).toBeGreaterThan(-.4)
    }
  })
  it('released allied mounts still stop projectiles aimed at enemies behind them', () => {
    const { scene, player, rider, mount } = fixture()
    rider.dismountFromMount(); rider.group.position.set(0, 50, -3)
    mount.combatOwner = createPlayerCombatActorRef(player)
    player.position.set(20, 50, 0)
    const before = rider.hp
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50.8, 3), new THREE.Vector3(0, 0, -1), 200, 30, Faction.PLAYER, true)
    arrow.update(.05, player, [rider], [], () => {}, () => { throw new Error('Player hit') }, undefined, false, [mount])
    expect(mount.riderNpc).toBeNull(); expect(mount.currentHp).toBe(70); expect(rider.hp).toBe(before)
  })
  it.each(['mount', 'rider', 'dismounted'] as const)('Town foot lance applies anti-cavalry only to physical cavalry contacts: %s', target => {
    const { rider, mount, player } = fixture()
    rider.shield.shieldImpactRemaining = 0
    if (target === 'dismounted') {
      rider.dismountFromMount(); rider.group.position.set(0, 50, 0); mount.group.position.x = 20
    }
    const y = target === 'mount' ? 50.8 : rider.group.position.y + 1.2
    player.setPosition(0, 50.9, 3)
    player.weaponSweep.capture(new THREE.Vector3(-1, y, 3), new THREE.Vector3(1, y, 3))
    player.weaponSweep.capture(new THREE.Vector3(-1, y, -3), new THREE.Vector3(1, y, -3))
    vi.spyOn(player, 'isHitFrame').mockReturnValue(true)
    const town = createTownCombatFixture(), weapon = WEAPONS.steel_lance
    town.player = player; town.inventory = { meleeEnabled: true, equippedMelee: weapon, shieldEnabled: false }
    town.skills = { getMultiplier: () => 1 }; town.previousTip = new THREE.Vector3()
    town.world = { buildings: [], targets: [] }; town.residents = []
    town.mission = { ambientBandits: [], missionBandits: [rider] }; town.defense = { playerEnemies: [] }
    town.combatMountGrid.insert(mount)
    town.hitBattlefieldMount = (horse: Mount, amount: number) => damageMount(horse, amount)
    town.hitFieldNpc = (npc: NPC, amount: number, _method: string, _source: NPC, contact: CombatContact) => damageNpc(npc, amount, ctx(player, contact.kind, contact.mount))
    const riderHp = rider.hp
    town.melee()
    const expected = weapon.damageMax * (target === 'dismounted' ? 1 : 2)
    expect(mount.currentHp).toBe(target === 'mount' ? 100 - expected : 100)
    expect(rider.hp).toBe(target === 'mount' ? riderHp : riderHp - expected)
  })
})

describe('Independent HP, death, attribution and XP', () => {
  it('Case A: mount death leaves the rider alive at exactly the same HP', () => {
    const { rider, mount, player } = fixture()
    rider.restoreCombatHealth(100); mount.currentHp = 20
    const result = damageNpc(rider, 30, ctx(player, 'mount', mount))
    expect(result.appliedDamage).toBe(20); expect(mount.dead).toBe(true)
    expect(rider.hp).toBe(100); expect(rider.dead).toBe(false); expect(rider.mount).toBeNull()
  })
  it('Case B: rider death leaves a healthy, released horse which Player can ride and remount', () => {
    const { rider, mount, player } = fixture()
    rider.restoreCombatHealth(20)
    damageNpc(rider, 30, ctx(player, 'body'))
    expect(rider.dead).toBe(true); expect(mount.currentHp).toBe(100); expect(mount.dead).toBe(false)
    expect(mount.riderNpc).toBeNull(); expect(mount.riderFaction).toBeNull(); expect(mount.availableForPlayer).toBe(true)
    player.mountVehicle(mount); expect(player.currentMount).toBe(mount)
    player.dismountFromMount(); expect(mount.availableForPlayer).toBe(true)
    player.mountVehicle(mount); expect(player.isMounted).toBe(true)
  })
  it('shield fully blocks both HP pools; broken-shield overflow hurts only rider', () => {
    const { rider, mount, player } = fixture()
    const before = rider.hp
    expect(damageNpc(rider, 80, ctx(player, 'shield')).appliedDamage).toBe(0)
    rider.shield.shieldImpactRemaining = 1
    const hit = ctx(player, 'shield'); hit.weaponId = 'viking_axe_t3'
    expect(damageNpc(rider, 80, hit).appliedDamage).toBe(70)
    expect(rider.hp).toBe(before - 70); expect(mount.currentHp).toBe(100)
  })
  it('Player body/shield routing preserves riding and HUD; mount routing preserves Player HP', () => {
    const { rider, mount, player } = fixture(); rider.dismountFromMount(); player.mountVehicle(mount)
    const before = player.hp
    const eventList: CombatEvent[] = []
    damagePlayer(player, 30, hp, null, ctx(player, 'body', undefined, 'projectile', eventList))
    expect(player.hp).toBe(before - 30); expect(mount.currentHp).toBe(100); expect(player.currentMount).toBe(mount)
    damagePlayer(player, 30, hp, null, ctx(player, 'mount', mount, 'projectile', eventList))
    expect(player.hp).toBe(before - 30); expect(mount.currentHp).toBe(70)
    expect(eventList.map(e => 'target' in e && e.target.targetType)).toEqual(['player', 'mount'])
    const nodes = new Map<string, any>()
    for (const id of ['mount-hud', 'mount-name', 'mount-hp-fill']) nodes.set(id, { classList: { toggle: vi.fn() }, style: {} })
    vi.stubGlobal('document', { getElementById: (id: string) => nodes.get(id) ?? null })
    const town = createTownCombatFixture(); town.player = player
    ;(TownScene.prototype as any).updateMountHud.call(town)
    expect(nodes.get('mount-hud').classList.toggle).toHaveBeenLastCalledWith('visible', true)
    expect(nodes.get('mount-hp-fill').style.width).toBe('70%')
  })
  it('Player death releases the mount without altering its HP', () => {
    const { rider, mount, player } = fixture(); rider.dismountFromMount(); player.mountVehicle(mount)
    player.setHp(20)
    damagePlayer(player, 30, hp, null, ctx(player, 'body'))
    expect(player.dead).toBe(true); expect(mount.currentHp).toBe(100)
    expect(mount.riderPlayer).toBeNull(); expect(mount.availableForPlayer).toBe(true)
  })
  it('mount-impact ignores shield/contact, while unspecified scripted damage stays on the person', () => {
    const { rider, mount, player } = fixture()
    const before = rider.hp, shield = rider.shield.shieldImpactRemaining
    damageNpc(rider, 30, ctx(player, 'shield', undefined, 'mount-impact'))
    expect(mount.currentHp).toBe(70); expect(rider.hp).toBe(before); expect(rider.shield.shieldImpactRemaining).toBe(shield)
    damageNpc(rider, 20)
    expect(rider.hp).toBe(before - 20); expect(mount.currentHp).toBe(70)
    rider.dismountFromMount(); player.mountVehicle(mount)
    const pHp = player.hp
    damagePlayer(player, 20, hp, null)
    expect(player.hp).toBe(pHp - 20); expect(mount.currentHp).toBe(70)
    damagePlayer(player, 20, hp, null, ctx(player, 'body', undefined, 'mount-impact'))
    expect(player.hp).toBe(pHp - 20); expect(mount.currentHp).toBe(50)
  })
  it.each(['melee', 'projectile'] as const)('%s XP uses actual damage for both mount and NPC targets', method => {
    const { rider, mount, player } = fixture(), events: CombatEvent[] = []
    damageNpc(rider, 30, ctx(player, 'body', undefined, method, events))
    mount.currentHp = 20
    damageMount(mount, 30, ctx(player, 'mount', mount, method, events))
    expect(events.map(e => 'target' in e && e.target.targetType)).toEqual(['npc', 'mount'])
    expect(events.map(e => resolveSkillProgressionAward(e, WEAPONS.steel_sword, false)?.xp)).toEqual([30, 20])
  })
})

describe('Career temporary battlefield mounts', () => {
  it.each([false, true])('save/reload/return preserve ownership, owns Black Cat=%s', purchased => {
    const { scene, rider, mount, player } = fixture()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'temporary-test')
    if (purchased) { profile.ownedMounts = ['black-cat']; profile.selectedMountId = 'black-cat' }
    const values = new Map<string, string>()
    const store = new CareerProfileStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } })
    const controller = new CareerMountController(scene, () => player, () => profile, next => { profile = next; return store.save(next) }, () => [], () => [])
    disposables.push(controller)
    if (purchased) expect(controller.activate('black-cat')).toBe(true)
    const owned = controller.activeMount
    const service = new Mount(scene, MountType.HORSE, 10, 10, 50); service.reservedForTown = true; disposables.push(service)
    const temporary = new TemporaryBattlefieldMounts(); temporary.track(mount, profile.activeMission!.id)
    rider.restoreCombatHealth(20); damageNpc(rider, 30, ctx(player, 'body'))
    player.mountVehicle(mount)
    expect(player.currentMount).toBe(mount); expect(controller.activeMount).toBe(owned)
    player.dismountFromMount(); player.mountVehicle(mount)
    controller.update(.016); expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(ownedCareerMountIds(loaded)).toEqual(purchased ? ['black-cat'] : [])
    expect(loaded.selectedMountId).toBe(purchased ? 'black-cat' : undefined)
    expect(loaded.activeMission?.mountState?.activeMountId).not.toBe('horse')
    expect(JSON.stringify(loaded)).not.toContain(mount.group.uuid)
    temporary.cleanup()
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(true)
    expect(owned?.disposed ?? false).toBe(false); expect(service.disposed).toBe(false)
    profile = clearCareerMission(profile, profile.activeMission!.id)
    store.save(profile)
    expect(ownedCareerMountIds(store.load()!)).toEqual(purchased ? ['black-cat'] : [])
  })
  it('Town cavalry released in combat can be ridden with E and stays reserved when peace returns', () => {
    const { rider, mount, player } = fixture()
    mount.reservedForTown = true
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.townEvent = { id: 'town-combat', state: 'hostile' }
    town.player = player; town.mounts = [mount]; town.residents = [{ npc: rider, homeMount: mount }]
    town.event = { hostile: true }; town.equipment = { visible: false }; town.stableHorses = []
    town.hint = { style: {} }; town.commit = vi.fn(next => { town.profile = next; return true })
    town.openPanel = vi.fn(); town.button = vi.fn()
    damageNpc(rider, 9999, ctx(player, 'body'))
    player.position.set(0, 50.9, 1)
    town.refreshCombatMounts(); town.interaction()
    expect(mount.temporaryCombatId).toBe('town-combat'); expect(mount.availableForPlayer).toBe(true)
    const key = { code: 'KeyE', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    town.key(key); expect(player.currentMount).toBe(mount)
    town.key(key); expect(player.isMounted).toBe(false)
    town.interaction(); town.key(key); expect(player.currentMount).toBe(mount)
    town.finish('player_defeated')
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(false)
    expect(mount.temporaryCombatId).toBeNull(); expect(mount.availableForPlayer).toBe(false)
    expect(town.profile.ownedMounts).toEqual([])
  })
  it('Town combat cleanup removes released battlefield horses without touching services or owned mounts', () => {
    const { scene, rider, mount, player } = fixture()
    const service = new Mount(scene, MountType.HORSE, 10, 10, 50), owned = new Mount(scene, MountType.BLACK_CAT, 20, 10, 50)
    disposables.push(service, owned); service.reservedForTown = true
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.ownedMounts = ['black-cat']; town.profile.selectedMountId = 'black-cat'
    town.profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'temporary-test')
    town.player = player; town.mounts = [service]; town.residents = []
    town.mission = { battlefieldMounts: [mount, service, owned], fieldNpcs: [rider], freezeStats: vi.fn() }
    town.careerMounts = { activeMount: owned }; town.event = { hostile: false }; town.stableHorses = [service]
    town.refreshCombatMounts()
    expect([...town.temporaryMounts.all]).toEqual([mount])
    damageNpc(rider, 9999, ctx(player, 'body')); player.mountVehicle(mount)
    town.missionSettlement = { finish: () => ({ status: 'saved', result: {} }) }; town.openMissionResult = vi.fn()
    town.finishMission('victory')
    expect(town.mission.freezeStats).toHaveBeenCalledOnce()
    expect(mount.disposed).toBe(true); expect(player.isMounted).toBe(false)
    expect(service.disposed).toBe(false); expect(owned.disposed).toBe(false)
    expect(town.profile.selectedMountId).toBe('black-cat'); expect(town.profile.ownedMounts).toEqual(['black-cat'])
  })
  it('failed Town settlement save preserves temporary riding until retry succeeds', () => {
    const { rider, mount, player } = fixture()
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.townEvent = { id: 'town-combat', state: 'hostile' }
    town.player = player; town.openPanel = vi.fn(); town.button = vi.fn()
    town.temporaryMounts.track(mount, 'town-combat'); damageNpc(rider, 9999, ctx(player, 'body')); player.mountVehicle(mount)
    town.commit = vi.fn(() => false); town.finish('player_defeated')
    expect(player.currentMount).toBe(mount); expect(mount.disposed).toBe(false)
    town.commit.mockReturnValue(true); town.finish('player_defeated')
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(true)
  })
})
