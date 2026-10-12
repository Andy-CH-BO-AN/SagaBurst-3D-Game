import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CareerDuelController, type CareerDuelResident } from '../../src/career/CareerDuelController'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { townCommanderSpec } from '../../src/town/TownCommander'
import { townMilitaryEquipment, townRoster, type TownActorSpec } from '../../src/town/TownRules'
import type { TownWorld } from '../../src/town/TownWorld'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { MemoryStorage } from '../helpers/memoryStorage'

vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))
vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/MakiRangerEquipment', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/MakiRangerEquipment')>()),
  // Only the rendered bow body is a double; NPC equipment and ammunition stay real.
  createMakiRangerBowInstance: () => ({
    model: new THREE.Group(),
    profile: {
      id: 'duel-test-bow', gripRadius: .028, gripLength: .14, visualScale: 1,
      gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1),
      longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(-1, 0, 0),
    },
    topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  }),
}))

/** Two real NPCs and three real mounts after start; zero TownWorlds, GLBs or real Players.
 * The arena needs a training location, represented by spec data plus an identity-only actor.
 * Navigation and Player are boundaries: these cases exercise mount binding/damage/ownership.
 */
function fixture(faction: 'roman' | 'viking', initial?: CareerProfile) {
  const resources: Array<{ dispose(): void }> = []
  onTestFinished(() => resources.reverse().forEach(resource => resource.dispose()))
  const own = <T extends { dispose(): void }>(resource: T): T => { resources.push(resource); return resource }
  const scene = new THREE.Scene(), roster = townRoster()
  const captainSpec = roster.find(spec => spec.role === 'captain')!
  const commanderSpec = townCommanderSpec({ x: 20, z: 20, yaw: 0 })
  const actor = (spec: TownActorSpec) => {
    const gear = townMilitaryEquipment(faction, spec)
    const profileId = spec.role === 'commander' ? `${faction}-commander` as const
      : faction === 'roman' ? 'praetorian' : 'varangian'
    return own(new NPC(scene, spec.x, spec.z, Faction.TOWN, faction, AIType.MELEE,
      spec.role, 4, false, gear.loadout, gear.presetId, undefined, spec.id, undefined, undefined, profileId))
  }
  const captain = actor(captainSpec), commander = actor(commanderSpec)
  const captainMount = own(new Mount(scene, MountType.HORSE, captainSpec.x, captainSpec.z))
  const serviceCat = own(new Mount(scene, MountType.BLACK_CAT, -10, -40))
  captainMount.reservedForTown = serviceCat.reservedForTown = true
  captain.mountVehicle(captainMount)
  const trainingSpec = roster.find(spec => spec.duty === 'training' && !spec.mounted)!
  const trainingMarker: Pick<NPC, 'combatantId'> = { combatantId: trainingSpec.id }
  const residents: CareerDuelResident[] = [
    { spec: captainSpec, npc: captain, homeMount: captainMount },
    { spec: commanderSpec, npc: commander },
    // No behavior of this out-of-duel actor is called; only its spec/identity locates the arena.
    { spec: trainingSpec, npc: trainingMarker as NPC },
  ]
  const playerGroup = new THREE.Group()
  let playerHp = 100, playerStamina = 100
  const player: Pick<Player, 'group' | 'dead' | 'hp' | 'staminaValue' | 'currentMount' | 'combatPosition'
    | 'setHp' | 'setStamina' | 'faceDirection' | 'syncMountTransform'> = {
    group: playerGroup, dead: false, currentMount: null,
    get hp() { return playerHp }, get staminaValue() { return playerStamina },
    get combatPosition() { return playerGroup.position },
    setHp(hp) { playerHp = hp }, setStamina(stamina) { playerStamina = stamina },
    faceDirection() {}, syncMountTransform() {},
  }
  const world: Pick<TownWorld, 'obstacles'> = { obstacles: [] }
  const navigation: Pick<NavigationWorld, 'areConnected'> = { areConnected: () => true }
  const store = new CareerProfileStore(new MemoryStorage())
  let profile = initial ?? { ...createCareerProfile(faction), rank: 'commander' as const }
  if (initial) expect(store.save(initial)).toBe(true)
  const commit = (next: CareerProfile) => {
    if (!store.save(next)) return false
    profile = next
    return true
  }
  // The controller only reads the explicitly supplied world/navigation/Player boundary above.
  const controller = own(new CareerDuelController(scene, world as TownWorld, navigation as NavigationWorld,
    residents, serviceCat, () => player as Player, () => profile, commit))
  return {
    scene, controller, commander, captain, captainMount, serviceCat, store,
    get profile() { return profile },
    accept(preset: UnitPresetId) {
      profile = { ...profile, duelHighestDefeatedTierByPreset: { [preset]: 4 } }
      const mission = controller.createMission(preset, 5)
      expect(mission).not.toBeNull()
      expect(commit({ ...profile, activeMission: { ...mission!, phase: 'ENGAGING' } })).toBe(true)
    },
  }
}

function equipment(npc: NPC) {
  return { melee: npc.meleeWeaponId, ranged: npc.rangedWeaponId, shield: npc.shieldId, loadout: { ...npc.loadout } }
}

describe('Career T5 Duel real mount lifecycle', () => {
  it.each([
    { faction: 'roman', preset: 'roman_lancer', type: MountType.CORGI },
    { faction: 'viking', preset: 'viking_lancer', type: MountType.BLACK_CAT },
  ] as const)('$faction binds a private $type and cleanup restores the Commander without disposing borrowed mounts', ({ faction, preset, type }) => {
    const h = fixture(faction), homeEquipment = equipment(h.commander)
    h.commander.restoreCombatHealth(712)
    h.accept(preset)
    expect(h.commander.mount).toBeNull()
    expect(h.scene.children.filter(child => child.name.startsWith('mount_'))).toHaveLength(2)

    expect(h.controller.startActiveMission()).toBe(true)
    const mount = h.commander.mount!
    expect(mount).toBeInstanceOf(Mount)
    expect(mount.type).toBe(type)
    expect(mount).not.toBe(h.serviceCat)
    expect(mount).not.toBe(h.captainMount)
    expect(mount.riderNpc).toBe(h.commander)
    expect(mount.reservedForTown).toBe(true)
    expect(mount.availableForPlayer).toBe(false)
    expect(h.controller.actors).toEqual([h.captain, h.commander])
    expect(h.controller.allMounts).toEqual([h.captainMount, mount])
    expect(h.commander.meleeWeaponId).toBe('heavy_lance')
    h.commander.dismountFromMount()
    expect(mount.riderNpc).toBeNull()
    expect(mount.availableForPlayer).toBe(false)
    h.commander.mountVehicle(mount)
    const disposeTemporary = vi.spyOn(mount, 'dispose')
    const disposeCaptain = vi.spyOn(h.captain, 'dispose'), disposeCommander = vi.spyOn(h.commander, 'dispose')
    const disposeCaptainMount = vi.spyOn(h.captainMount, 'dispose'), disposeServiceCat = vi.spyOn(h.serviceCat, 'dispose')

    h.commander.takeDamage(100)
    h.controller.cleanupMission()
    h.controller.cleanupMission()

    expect(disposeTemporary).toHaveBeenCalledOnce()
    expect(mount.disposed).toBe(true)
    expect(mount.group.parent).toBeNull()
    expect(mount.riderNpc).toBeNull()
    expect(h.commander.mount).toBeNull()
    expect(h.commander.hp).toBe(712)
    expect(h.commander.combatAmmo).toBe(0)
    expect(equipment(h.commander)).toEqual(homeEquipment)
    expect(h.captain.mount).toBe(h.captainMount)
    expect(h.captainMount.riderNpc).toBe(h.captain)
    expect(disposeCaptain).not.toHaveBeenCalled()
    expect(disposeCommander).not.toHaveBeenCalled()
    expect(disposeCaptainMount).not.toHaveBeenCalled()
    expect(disposeServiceCat).not.toHaveBeenCalled()
    expect(h.controller.allMounts).toEqual([])
  })

  it('serialized reload keeps a surviving private mount damaged, bound and at its saved position', () => {
    const h = fixture('roman')
    h.commander.restoreCombatHealth(712)
    h.accept('roman_horse_archer')
    expect(h.controller.startActiveMission()).toBe(true)
    const mount = h.commander.mount!
    mount.takeDamage(37)
    mount.group.position.set(52, 3, -14)
    mount.group.rotation.y = .8
    h.commander.takeDamage(40)
    h.commander.restoreCombatAmmo(7)
    h.controller.persistRuntimeProgress()
    const saved = h.store.load()!
    expect(saved.activeMission).toMatchObject({
      duelOpponentMountHp: 63, duelOpponentHp: 692, duelOpponentAmmo: 7,
      duelTravel: { actors: { commander: { x: 52, y: 3, z: -14, yaw: .8 } } },
    })
    h.controller.cleanupMission()

    const reloaded = fixture('roman', saved)
    expect(reloaded.controller.startActiveMission()).toBe(true)
    const restoredMount = reloaded.commander.mount!

    expect(restoredMount).not.toBe(mount)
    expect(restoredMount).toMatchObject({ type: MountType.CORGI, currentHp: 63, dead: false, reservedForTown: true })
    expect(restoredMount.riderNpc).toBe(reloaded.commander)
    expect(restoredMount.combatOwner?.actorId).toBe('commander')
    expect(restoredMount.group.position.toArray()).toEqual([52, 3, -14])
    expect(restoredMount.group.rotation.y).toBe(.8)
    expect(reloaded.commander.combatPosition.toArray()).toEqual([52, 3, -14])
    expect(reloaded.commander.hp).toBe(692)
    expect(reloaded.commander.combatAmmo).toBe(7)
    reloaded.controller.persistRuntimeProgress(true)
    expect(reloaded.store.load()!.activeMission?.duelOpponentMountHp).toBe(63)
  })

  it.each(['mount', 'mount and Commander'] as const)('serialized reload preserves the dead %s until cleanup restores the service Commander', casualty => {
    const h = fixture('viking'), homeEquipment = equipment(h.commander)
    h.commander.restoreCombatHealth(712)
    h.accept('viking_horse_archer')
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.commander.rangedWeaponId).toBe('maki-ranger-bow-ranged')
    h.commander.restoreCombatAmmo(7)
    const mount = h.commander.mount!

    expect(mount.takeDamage(mount.currentHp)).toBe(true)
    expect(mount.dead).toBe(true)
    expect(mount.riderNpc).toBeNull()
    expect(h.commander.mount).toBeNull()
    if (casualty === 'mount and Commander') h.commander.takeDamage(10000)
    h.controller.persistRuntimeProgress()
    const saved = h.store.load()!
    expect(saved.activeMission).toMatchObject({
      duelOpponentMountHp: 0, duelOpponentAmmo: 7,
      duelOpponentDead: casualty === 'mount and Commander', duelCommanderHome: { hp: 712, ammo: 0 },
    })
    h.controller.cleanupMission()

    const reloaded = fixture('viking', saved)
    expect(reloaded.controller.startActiveMission()).toBe(true)
    const deadMount = reloaded.controller.allMounts.find(candidate => candidate !== reloaded.captainMount)!
    expect(deadMount).not.toBe(mount)
    expect(deadMount).toMatchObject({ dead: true, currentHp: 0, riderNpc: null, disposed: false })
    expect(deadMount.availableForPlayer).toBe(false)
    expect(reloaded.commander.mount).toBeNull()
    expect(reloaded.commander.dead).toBe(casualty === 'mount and Commander')
    expect(reloaded.commander.hp).toBe(casualty === 'mount and Commander' ? 0 : 712)
    expect(reloaded.commander.combatAmmo).toBe(7)
    const disposeTemporary = vi.spyOn(deadMount, 'dispose')

    reloaded.controller.cleanupMission()

    expect(disposeTemporary).toHaveBeenCalledOnce()
    expect(reloaded.commander.dead).toBe(false)
    expect(reloaded.commander.hp).toBe(712)
    expect(reloaded.commander.combatAmmo).toBe(0)
    expect(equipment(reloaded.commander)).toEqual(homeEquipment)
    expect(reloaded.captainMount.disposed).toBe(false)
    expect(reloaded.serviceCat.disposed).toBe(false)
    expect(reloaded.profile.ownedMounts).toEqual([])
  })
})
