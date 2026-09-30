import * as THREE from 'three'
import { applyCivilianAppearance } from '../src/world/CivilianAppearance'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, enlistmentMerit, promoteCareer } from '../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../src/career/CareerProfileStore'
import { TownEvent, townRoster, settleTown, grantStarter, TOWN_PRODUCTS, productStatus, updateRangerMount, townCampaignTarget, townCaptainProfile, stableHorsePositions, TOWN_SITES } from '../src/town/TownRules'
import { TownEquipment, canUseCareerEquipment } from '../src/town/TownEquipment'
import { NPC, AIType, Faction } from '../src/world/NPC'
import { Mount, MountType } from '../src/world/Mount'
import { damageNpc } from '../src/combat/DamageRouter'
import { DamageableObstacle } from '../src/world/DamageableObstacle'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { ArrowProjectile } from '../src/world/ArrowProjectile'
import { TownScene } from '../src/town/TownScene'
import { Player } from '../src/player/Player'
import { installCorgiTestAsset } from './helpers/corgiAsset'
beforeAll(() => installCorgiTestAsset())

function memory() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } as unknown as Storage
}
function civilian() { return new NPC(new THREE.Scene(), 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Civilian', 2, false, { meleeWeaponId: null, rangedWeaponId: null, shieldId: null }, undefined, undefined, 'civilian', undefined, undefined, undefined, undefined, 'civilian') }
function enlist() { const p = grantStarter(createCareerProfile('roman'), 'gladius_rusty'); p.totalMerit = 22000; p.availableMerit = 180; p.rank = 'commander'; p.townEvent = { id: 'event-1', state: 'hostile' }; return p }

describe('Town population and civilian combat', () => {
  it('uses faction T4 captains with their own hero mount and five stable horses in mixed existing coats', () => {
    expect(townCaptainProfile('roman')).toMatchObject({ visualAssetId: 'roman-hero-t4', combatProfileId: 'praetorian', mountOverride: 'corgi' })
    expect(townCaptainProfile('viking')).toMatchObject({ visualAssetId: 'viking-hero-t4', combatProfileId: 'varangian', mountOverride: 'black-cat' })
    const stalls = stableHorsePositions(); expect(stalls).toHaveLength(5); expect(new Set(stalls.map(s => s.variant)).size).toBe(3)
    expect(stalls.every(s => s.x > -39.5 && s.x < -28.5 && s.z > 13 && s.z < 27)).toBe(true)
    for (const site of Object.values(TOWN_SITES)) expect(Math.sin(site.yaw) * -site.x + Math.cos(site.yaw) * -site.z).toBeGreaterThan(0)
    const roster = townRoster(); expect(roster.find(r => r.role === 'captain')).toMatchObject({ x: 25, z: 11, yaw: -Math.PI / 2 }); expect(roster.find(r => r.role === 'merchant')).toMatchObject({ x: -21.5, yaw: Math.PI / 2 })
  })
  it('keeps Viking civilian wool/trousers and armor hiding consistent across LODs without changing shared Roman materials', () => {
    const cloth = new THREE.MeshStandardMaterial({ color: 0xff2222 }), skin = new THREE.MeshStandardMaterial({ color: 0xffccaa })
    const create = () => { const group = new THREE.Group(); for (const [name, material] of [['Tunic_1', cloth], ['RomanUndertunic_l', cloth], ['New_legs', skin], ['New_head', skin], ['Armour_top', cloth], ['Full_figure_42_T_pose', cloth], ['Helmet3', cloth]] as const) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, .8, .2), material); mesh.name = name; group.add(mesh) } return group }
    const lods = [create(), create(), create()]
    lods.forEach(level => applyCivilianAppearance(level, 'viking'))
    for (const level of lods) {
      expect(level.getObjectByName('Tunic_1')!.visible).toBe(true)
      expect((level.getObjectByName('Tunic_1') as THREE.Mesh).material).not.toBe(cloth)
      expect((level.getObjectByName('New_legs') as THREE.Mesh).material).not.toBe(skin)
      expect((level.getObjectByName('New_head') as THREE.Mesh).material).toBe(skin)
      for (const name of ['Armour_top', 'Full_figure_42_T_pose', 'Helmet3']) expect(level.getObjectByName(name)!.visible).toBe(false)
    }
    expect((lods[0].getObjectByName('Tunic_1') as THREE.Mesh).material).toBe((lods[2].getObjectByName('Tunic_1') as THREE.Mesh).material)
    const roman = create(); applyCivilianAppearance(roman, 'roman')
    expect((roman.getObjectByName('Tunic_1') as THREE.Mesh).material).toBe(cloth)
    expect(cloth.color.getHex()).toBe(0xff2222)
  })
  it('registers exactly 85 unique principals, with 60 garrison and 20 additional pedestrians', () => {
    const roster = townRoster(), counts = Object.fromEntries([...new Set(roster.map(r => r.role))].map(role => [role, roster.filter(r => r.role === role).length]))
    expect(counts).toMatchObject({ melee_cavalry: 10, ranged_cavalry: 10, ranged_infantry: 20, melee_infantry: 20, civilian: 20, merchant: 1, cat: 1, ranger: 1, captain: 1, deployment: 1 })
    const e = new TownEvent(); roster.forEach(r => e.register(r.id, { dead: false })); e.complete(); expect(e.actors.size).toBe(85)
    expect(() => e.register('cat', { dead: false })).toThrow()
    expect(Object.keys(UNIT_PRESETS).some(p => p.includes('civilian'))).toBe(false)
    expect(TOWN_PRODUCTS.some(p => p.id.includes('civilian'))).toBe(false)
  })
  it('uses HP 50, no squad or weapon in peace; arms once with catalog gladius after hostility', () => {
    const npc = civilian(); npc.setTownPeaceful()
    expect(npc.maxHp).toBe(50); expect(npc.hp).toBe(50); expect(npc.squadId).toBeUndefined(); expect(npc.meleeWeaponId).toBeNull()
    expect((npc as any).swordPivot.visible).toBe(false)
    npc.takeDamage(1); npc.beginTownHostility()
    expect(npc.meleeWeaponId).toBe('gladius_rusty'); expect(npc.hp).toBe(49); expect((npc as any).swordPivot.visible).toBe(true)
    const children = [...(npc as any).swordGripPivot.children]; npc.beginTownHostility(); expect((npc as any).swordGripPivot.children).toEqual(children)
  })
  it('does not arm a civilian killed by the first hit', () => { const npc = civilian(); npc.setTownPeaceful(); npc.takeDamage(100); npc.beginTownHostility(); expect(npc.dead).toBe(true); expect(npc.meleeWeaponId).toBeNull() })
  it('peace animation never acquires targets or spends arrows', () => {
    const npc = civilian(), find = vi.spyOn(npc as any, '_getTarget'), hp = npc.hp
    for (let i = 0; i < 20; i++) npc.updateTownPeace(.1, 50, false, false)
    expect(find).not.toHaveBeenCalled(); expect(npc.hp).toBe(hp)
  })
  it('visual-only training projectiles cannot hit player, NPCs or structures even after hostility', () => {
    const scene = new THREE.Scene(), player = new Player(scene), npc = civilian(), damage = vi.fn(), hit = vi.fn()
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 0, 1), 20, 999, Faction.ENEMY)
    arrow.update(.016, player, [npc], [], hit, damage, hit, true)
    npc.beginTownHostility(); arrow.update(.016, player, [npc], [], hit, damage, hit, true)
    expect(damage).not.toHaveBeenCalled(); expect(hit).not.toHaveBeenCalled(); expect(npc.hp).toBe(50)
  })
})
describe('Ranger and unique cat relationship', () => {
  function pair() {
    const cat = { dead: false, currentHp: 37 } as Mount
    const ranger = { dead: false, mount: null as Mount | null, mountVehicle: vi.fn((m: Mount) => { ranger.mount = m }), dismountFromMount: vi.fn(() => { ranger.mount = null }) }
    return { ranger, cat }
  }
  it('approaches and mounts exactly the existing cat once without healing', () => {
    const { ranger, cat } = pair(); expect(updateRangerMount(ranger, cat, 5)).toBe('approach'); expect(updateRangerMount(ranger, cat, 1)).toBe('mounted'); updateRangerMount(ranger, cat, 0)
    expect(ranger.mountVehicle).toHaveBeenCalledTimes(1); expect(ranger.mount).toBe(cat); expect(cat.currentHp).toBe(37)
  })
  it.each(['cat', 'ranger'] as const)('%s dying first cancels mounting and releases a mounted pair', who => {
    const { ranger, cat } = pair(); Object.defineProperty(who === 'cat' ? cat : ranger, 'dead', { value: true })
    expect(updateRangerMount(ranger, cat, 1)).toBe('foot'); expect(ranger.mountVehicle).not.toHaveBeenCalled()
    ranger.mount = cat; updateRangerMount(ranger, cat, 0); expect(ranger.mount).toBeNull()
  })
  it('ordinary mount death dismounts but does not kill the rider', () => {
    const npc = civilian(), mount = new Mount(new THREE.Scene(), MountType.CORGI, 0, 0); mount.reservedForTown = true; npc.mountVehicle(mount)
    expect(mount.availableForPlayer).toBe(false); damageNpc(npc, 9999); expect(npc.dead).toBe(false); expect(npc.mount).toBeNull(); expect(mount.dead).toBe(true)
  })
})
describe('Town settlement, persistence and appointments', () => {
  it('waits for registration, requires hostility, and prioritizes simultaneous player death', () => {
    const e = new TownEvent(); expect(e.evaluate(false)).toBeNull(); e.hostile = true; expect(e.evaluate(false)).toBeNull()
    townRoster().forEach(r => e.register(r.id, { dead: true })); expect(e.evaluate(false)).toBeNull(); e.complete(); expect(e.evaluate(false)).toBe('town_defeated'); expect(e.evaluate(true)).toBe('player_defeated')
  })
  it.each([0, 20, 180])('deducts once from available merit %s, preserving history and rank', available => {
    const p = enlist(); p.availableMerit = available; const before = JSON.stringify(p), next = settleTown(p, 'event-1', 'player_defeated')
    expect(next.availableMerit).toBe(Math.max(0, available - 100)); expect(next.totalMerit).toBe(p.totalMerit); expect(next.rank).toBe('commander'); expect(next.ownedWeapons).toEqual(p.ownedWeapons); expect(JSON.stringify(p)).toBe(before)
    expect(settleTown(next, 'event-1', 'player_defeated')).toEqual(next)
  })
  it('switches once, resets enlistment and retains collections, histories and balances', () => {
    const p = enlist(); p.ownedWeapons.push('gladius_fine'); p.claimedBattleIds.push('battle'); const next = settleTown(p, 'event-1', 'town_defeated')
    expect(next.faction).toBe('viking'); expect(next.rank).toBe('recruit'); expect(enlistmentMerit(next)).toBe(0); expect(promoteCareer(next)).toBeNull()
    expect(next.ownedWeapons).toEqual(p.ownedWeapons); expect(next.claimedBattleIds).toEqual(p.claimedBattleIds); expect(next.lifetimeStats).toEqual(p.lifetimeStats); expect(next.availableMerit).toBe(p.availableMerit)
    expect(settleTown(next, 'event-1', 'town_defeated')).toEqual(next)
  })
  it('round-trips hostile and settled state; invalid saves remain distinguishable from missing saves', () => {
    const storage = memory(), store = new CareerProfileStore(storage), p = enlist(); expect(store.loadChecked()).toEqual({ profile: null }); expect(store.save(p)).toBe(true)
    expect(store.loadChecked().profile?.townEvent?.state).toBe('hostile'); store.save(settleTown(p, 'event-1', 'player_defeated')); expect(store.load()?.availableMerit).toBe(80)
    storage.setItem('sagaburst_career_v1', '{broken'); expect(store.loadChecked().error).toBeTruthy(); expect(storage.getItem('sagaburst_career_v1')).toBe('{broken')
  })
  it('save failures do not mutate the current profile', () => {
    const p = enlist(), before = JSON.stringify(p), store = new CareerProfileStore({ setItem: () => { throw new Error('quota') } } as unknown as Storage)
    expect(store.save(settleTown(p, 'event-1', 'player_defeated'))).toBe(false); expect(JSON.stringify(p)).toBe(before)
  })
  it('preserves a legitimate lower appointment when loading and promotes only one step without payment', () => {
    const p = enlist(); p.rank = 'recruit'; const parsed = parseCareerProfile(p)!; expect(parsed.rank).toBe('recruit')
    const next = promoteCareer(parsed)!; expect(next.rank).toBe('soldier'); expect(next.totalMerit).toBe(p.totalMerit); expect(next.availableMerit).toBe(p.availableMerit); expect(next.ownedWeapons).toEqual(p.ownedWeapons)
    const old = { ...p } as any; delete old.enlistmentMeritBase; expect(parseCareerProfile(old)?.enlistmentMeritBase).toBe(0)
    p.enlistmentMeritBase = p.totalMerit; p.rank = 'commander'; expect(parseCareerProfile(p)?.rank).toBe('recruit')
  })
  it('shop display is pure and appointed rank controls the four states', () => {
    const p = enlist(), item = TOWN_PRODUCTS.find(i => i.id === 'horse-t2')!, before = JSON.stringify(p)
    p.ownedHorseTiers = [1]
    const unchanged = JSON.stringify(p)
    expect(productStatus(p, item)).toBe('已解鎖・餘額不足'); expect(JSON.stringify(p)).toBe(unchanged); expect(before).not.toBe(unchanged); p.availableMerit = 1000; expect(productStatus(p, item)).toBe('已解鎖・餘額足夠'); p.rank = 'recruit'; expect(productStatus(p, item)).toBe('軍階未解鎖'); p.ownedHorseTiers.push(2); p.ownedMounts.push('horse'); expect(productStatus(p, item)).toBe('已擁有')
    expect(townCampaignTarget('roman')).toEqual({ defenderFaction: 'roman', stageId: 1 }); expect(townCampaignTarget('viking')).toEqual({ defenderFaction: 'viking', stageId: 1 })
  })
  it('removes collision and invalidates navigation only once when a building is destroyed', () => {
    const root = new THREE.Group(), hp = new DamageableObstacle({ kind: 'tent', maxHp: 100, root }), obstacles = [{ box: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 5, 5)), isBarricade: false, damageable: hp }], nav = new NavigationWorld(), cb = vi.fn(() => obstacles.splice(0, 1))
    hp.onDestroyed(cb); nav.sync(obstacles); const rev = nav.revision; hp.takeDamage(10); expect(nav.sync(obstacles)).toBe(false); hp.takeDamage(100); nav.sync(obstacles); expect(nav.revision).toBe(rev + 1); hp.takeDamage(100); expect(cb).toHaveBeenCalledTimes(1); expect(nav.sync(obstacles)).toBe(false)
  })
})
describe('Town temporary sheathing and equipment eligibility', () => {
  it('grants one weapon once and no default ranged, shield, mount or hero', () => {
    const p = grantStarter(createCareerProfile('roman'), 'gladius_rusty'); expect(grantStarter(p, 'viking_axe_t1')).toEqual(p)
    const inv = new TownEquipment(() => p, () => true); expect(inv.inventoryStacks.map(s => s.item.id)).toEqual(['gladius_rusty']); expect(inv.meleeEnabled).toBe(false); expect(inv.rangedEnabled).toBe(false); expect(inv.shieldEnabled).toBe(false); expect(p.ownedMounts).toEqual([])
  })
  it('preserves selected IDs, draws only owned eligible gear, and sheathes on every new instance', () => {
    let p = enlist(); p.rank = 'recruit'; p.equipment = { melee: 'gladius_rusty' }; const before = JSON.stringify(p)
    const inv = new TownEquipment(() => p, next => { p = next; return true }); expect(JSON.stringify(p)).toBe(before); expect(inv.isEquipped('gladius_rusty')).toBe(false)
    expect(inv.equipWeapon('gladius_rusty')).toBe(true); expect(inv.meleeEnabled).toBe(true); expect(inv.isEquipped('gladius_rusty')).toBe(true); expect(inv.equipWeapon('steel_lance')).toBe(false)
    const another = new TownEquipment(() => p, () => true); expect(another.meleeEnabled).toBe(false); expect(p.equipment.melee).toBe('gladius_rusty')
  })
  it('retained higher-tier equipment cannot be drawn after changing faction, even through stale UI', () => {
    let p = enlist(); p.ownedWeapons.push('steel_lance'); const inv = new TownEquipment(() => p, next => { p = next; return true }); p = settleTown(p, 'event-1', 'town_defeated')
    expect(canUseCareerEquipment(p, 'steel_lance')).toBe(false); expect(inv.equipWeapon('steel_lance')).toBe(false); expect(inv.meleeEnabled).toBe(false)
  })
  it('failed equipment preference save does not draw or alter ownership', () => { const p = enlist(), inv = new TownEquipment(() => p, () => false); expect(inv.equipWeapon('gladius_rusty')).toBe(false); expect(inv.meleeEnabled).toBe(false); expect(p.equipment).toBeUndefined() })
})


describe('Town input and isolation regressions', () => {
  it('empty hands cannot attack or aim, but owned drawing restores actual melee', () => {
    const scene = new THREE.Scene(), player = new Player(scene), p = grantStarter(createCareerProfile('roman'), 'gladius_rusty')
    const inv = new TownEquipment(() => p, () => true)
    const input = { keys: {}, isLocked: true, isRightMouseDown: true, isLeftMouseDown: true, consumeLeftClick: () => true, consumeLeftClickRelease: () => true } as any
    const bar = { setFill: () => {} } as any, quiver = { setArrowCount: () => {}, setAiming: () => {}, setShieldBlocked: () => {}, setChargeRatio: () => {} } as any
    const sound = { playBowRelease: () => {} } as any, arrow = vi.fn(); player.onFireArrow = arrow
    for (let i = 0; i < 10; i++) player.update(.05, input, 0, new THREE.Vector3(0, 1, 20), [], bar, quiver, sound, inv)
    expect(player.aiming).toBe(false); expect(player.isSwinging).toBe(false); expect(arrow).not.toHaveBeenCalled(); expect((player as any).swordPivot.visible).toBe(false); expect((player as any).bowPivot.visible).toBe(false)
    inv.equipWeapon('gladius_rusty'); input.isRightMouseDown = false
    player.update(.016, input, 0, new THREE.Vector3(0, 1, 20), [], bar, quiver, sound, inv)
    expect(player.isSwinging).toBe(true); expect((player as any).swordPivot.visible).toBe(true)
  })
  it('training bow animations release repeatedly without consuming combat ammunition', () => {
    const npc = new NPC(new THREE.Scene(), 40, 20, Faction.ENEMY, 'viking', AIType.RANGED, 'Training archer', 2, false, { meleeWeaponId: 'viking_axe_t2', rangedWeaponId: 'recurve_longbow', shieldId: null })
    const arrows = (npc as any).arrows, search = vi.spyOn(npc as any, '_getTarget'); let releases = 0
    for (let i = 0; i < 120; i++) if (npc.updateTownPeace(.05, 20, true, i % 60 === 0, 0, i % 60 * .05)) releases++
    expect(releases).toBeGreaterThan(0); expect((npc as any).arrows).toBe(arrows); expect(search).not.toHaveBeenCalled()
  })
  it('hides the held training pilum on release and restores it only for the next throw or combat order', () => {
    const npc = new NPC(new THREE.Scene(), 40, 20, Faction.ENEMY, 'roman', AIType.RANGED, 'Training javelin', 2, false, { meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'pilum_basic', shieldId: null })
    const arrows = (npc as any).arrows, pivot = (npc as any).bowPivot as THREE.Group
    let released = false
    for (let i = 0; i < 80; i++) {
      if (npc.updateTownPeace(.05, 20, true, i === 0, 0, i * .05)) { released = true; break }
    }
    expect(released).toBe(true); expect(pivot.visible).toBe(false); expect((npc as any).arrows).toBe(arrows)
    while ((npc as any).animator.busy) npc.updateTownPeace(.05, 20, true, false)
    expect(pivot.visible).toBe(false)
    npc.updateTownPeace(.05, 20, true, true); expect(pivot.visible).toBe(true)
    ;(npc as any).bowPivot.visible = false
    npc.assignFormationTarget(9, new THREE.Vector3(5, 0, 5), new THREE.Vector3(0, 0, 1)); expect(pivot.visible).toBe(true)
  })
  it('same-town residents never acquire each other and no player army command controller exists in Town', () => {
    const a = civilian(), b = civilian(), player = new Player(new THREE.Scene()); a.beginTownHostility(); b.beginTownHostility()
    const target = (a as any)._findTarget(player, [b]); expect(target.isPlayer).toBe(true); expect(target.npc).toBeUndefined(); expect(a.squadId).toBeUndefined()
  })
  it('a hostile reload restores only currently eligible owned preferences', () => {
    const p = enlist(); p.rank = 'recruit'; p.ownedWeapons.push('steel_lance'); p.equipment = { melee: 'steel_lance', ranged: 'wooden_shortbow', shield: 'scutum_t3' }
    const inv = new TownEquipment(() => p, () => true); inv.restoreForHostile(); expect(inv.meleeEnabled).toBe(false); expect(inv.rangedEnabled).toBe(false); expect(inv.shieldEnabled).toBe(false)
    p.equipment.melee = 'gladius_rusty'; inv.restoreForHostile(); expect(inv.meleeEnabled).toBe(true)
  })
  it('invalid enlistment baselines cannot grant high-rank privileges', () => {
    const p = enlist(); for (const base of [-1, null, '0']) expect(parseCareerProfile({ ...p, enlistmentMeritBase: base })?.rank).toBe('recruit')
  })
})


describe('Town orchestration transitions', () => {
  it('the first close frontal house swing damages the wall and starts hostility even after the blade has swept sideways', () => {
    const town = Object.create(TownScene.prototype) as any
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: 100, root: new THREE.Group() })
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-5, -2, 1), new THREE.Vector3(5, 5, 10)), damageable: hp }
    town.world = { buildings: [{ ownerFaction: Faction.TOWN, hp, obstacles: [obstacle] }], obstacles: [obstacle], refreshDamage: vi.fn() }
    town.inventory = { meleeEnabled: true, equippedMelee: { range: 1.8, damageMax: 12, combatKind: 'sword' } }
    town.player = { position: new THREE.Vector3(0, .9, 0), facingYaw: 0, getSwordTipPosition: () => new THREE.Vector3(1.5, 1.2, .1), getWeaponGripPosition: () => new THREE.Vector3(.2, 1.2, .1), isHitFrame: () => true, markHitProcessed: vi.fn() }
    town.previousTip = new THREE.Vector3(); town.hasPreviousTip = false
    town.navigation = { sync: vi.fn() }; town.prepareDamage = vi.fn(() => true); town.persistCasualties = vi.fn()
    town.damageNumbers = { spawn: vi.fn() }
    town.event = new TownEvent(); town.equipment = { visible: false }; town.panel = null; town.residents = []
    town.melee()
    expect(hp.hpRatio).toBeCloseTo(.88); expect(town.event.hostile).toBe(true)
    expect(town.damageNumbers.spawn).toHaveBeenCalledWith(12, new THREE.Vector3(0, .9, 1))
    expect(town.player.markHitProcessed).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('hostility is broadcast once; captain dead=%s selects another soldier', captainDead => {
    const town = Object.create(TownScene.prototype) as any
    town.event = new TownEvent(); town.closePanel = vi.fn(); town.equipment = { visible: true }
    const captain = { dead: captainDead, beginTownHostility: vi.fn() }, infantry = { dead: false, beginTownHostility: vi.fn() }
    town.residents = [{ spec: { id: 'captain', role: 'captain' }, npc: captain }, { spec: { id: 'infantry', role: 'melee_infantry' }, npc: infantry }]
    town.activateHostility(false); town.activateHostility(false)
    expect(town.chargeSpeakerId).toBe(captainDead ? 'infantry' : 'captain'); expect(infantry.beginTownHostility).toHaveBeenCalledTimes(1); expect(town.closePanel).toHaveBeenCalledTimes(1)
  })
  it('first-hit persistence failure blocks damage; zero damage does not create an event', () => {
    const town = Object.create(TownScene.prototype) as any, npc = civilian()
    town.prepareDamage = vi.fn(() => false); town.activateHostility = vi.fn(); town.persistCasualties = vi.fn()
    town.hitResident(npc, 0); expect(town.prepareDamage).not.toHaveBeenCalled()
    town.hitResident(npc, 10); expect(npc.hp).toBe(50); expect(town.activateHostility).not.toHaveBeenCalled()
  })
  it('hostility preserves an active swing and held movement when no dialog is open', () => {
    const town = Object.create(TownScene.prototype) as any
    town.event = new TownEvent(); town.equipment = { visible: false }; town.panel = null
    town.closePanel = vi.fn(); town.residents = []
    town.activateHostility(false)
    expect(town.event.hostile).toBe(true); expect(town.closePanel).not.toHaveBeenCalled()
  })
  it('reserved bandit camp structures do not broadcast town crime', () => {
    const town = Object.create(TownScene.prototype) as any
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: 120, root: new THREE.Group() })
    town.world = { buildings: [{ ownerFaction: Faction.BANDIT, hp }], obstacles: [], refreshDamage: vi.fn() }
    town.navigation = { sync: vi.fn() }; town.prepareDamage = vi.fn(); town.activateHostility = vi.fn(); town.persistCasualties = vi.fn()
    town.damageNumbers = { spawn: vi.fn() }
    town.damageBuilding(0, 12)
    expect(hp.hpRatio).toBeCloseTo(.9); expect(town.prepareDamage).not.toHaveBeenCalled(); expect(town.activateHostility).not.toHaveBeenCalled()
  })
  it('building feedback uses remaining HP for overkill and ignores zero, invalid and repeated damage', () => {
    const town = Object.create(TownScene.prototype) as any
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: 7, root: new THREE.Group() })
    town.world = { buildings: [{ ownerFaction: Faction.TOWN, hp }], obstacles: [], refreshDamage: vi.fn() }
    town.navigation = { sync: vi.fn() }; town.prepareDamage = vi.fn(() => true); town.activateHostility = vi.fn(); town.persistCasualties = vi.fn()
    town.damageNumbers = { spawn: vi.fn() }
    for (const damage of [0, -1, NaN, Infinity]) town.damageBuilding(0, damage)
    expect(town.damageNumbers.spawn).not.toHaveBeenCalled(); expect(town.prepareDamage).not.toHaveBeenCalled()
    const hitPosition = new THREE.Vector3(2, 1, 3)
    town.damageBuilding(0, 1000, hitPosition); town.damageBuilding(0, 1000, hitPosition)
    expect(town.damageNumbers.spawn).toHaveBeenCalledExactlyOnceWith(7, hitPosition)
    expect(town.activateHostility).toHaveBeenCalledTimes(1)
  })
  it('persists casualties only on a death/destruction, preserving them across reload', () => {
    const town = Object.create(TownScene.prototype) as any, npc = { dead: false }, p = enlist()
    town.event = new TownEvent(); town.event.register('civilian-0', npc); town.profile = p; town.world = { buildings: [] }
    const store = new CareerProfileStore(memory()); town.commit = vi.fn((next: typeof p) => { town.profile = next; return store.save(next) })
    town.persistCasualties(); expect(town.commit).not.toHaveBeenCalled()
    npc.dead = true; town.persistCasualties(); town.persistCasualties(); expect(town.commit).toHaveBeenCalledTimes(1); expect(store.load()?.townEvent?.deadActorIds).toEqual(['civilian-0'])
  })
})
