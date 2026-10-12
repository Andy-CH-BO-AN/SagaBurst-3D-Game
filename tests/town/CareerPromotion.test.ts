import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { Player } from '../../src/player/Player'
import { Mount, MountType } from '../../src/world/Mount'
import { HumanoidAssetRegistry } from '../../src/world/HumanoidAssetRegistry'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { resolveCareerHeroAsset, resolveCareerPlayerMaxHp } from '../../src/career/CareerPlayerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import { TownEquipment } from '../../src/town/TownEquipment'
import { grantStarter } from '../../src/town/TownRules'
import { SkillManager } from '../../src/rpg/SkillManager'
import { ThirdPersonCamera } from '../../src/camera/ThirdPersonCamera'
import { MemoryStorage } from '../helpers/memoryStorage'
import { setScenePlayableWorldBound } from '../../src/world/Terrain'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Exercises the real promotion, Player, shield, mount ownership and JSON save paths.
// No TownWorld, NPCs, WebGL renderer or GLB payload is constructed.
type PromotionTown = Pick<TownScene, 'player' | 'profile' | 'scene' | 'camera'> & {
  acceptCareerPromotion(): Promise<boolean>
  commit(profile: CareerProfile): boolean
  closePanel(): void
  disposed: boolean
  panel: { remove(): void } | null
  orbit: ThirdPersonCamera
  skills: SkillManager
  inventory: TownEquipment
  notice: string
}

function fixture(faction: CareerProfile['faction'] = 'roman', mounted = false, rank: CareerProfile['rank'] = 'captain') {
  const profile = grantStarter(createCareerProfile(faction), 'gladius_rusty')
  profile.totalMerit = 20000; profile.availableMerit = 432; profile.rank = rank
  addCareerItem(profile, 'scutum_t2', 2)
  profile.equipment = { melee: 'gladius_rusty', shield: 'scutum_t2' }
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  expect(store.save(profile)).toBe(true)
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera()
  setScenePlayableWorldBound(scene, 600)
  const old = new Player(scene, faction, resolveCareerHeroAsset(profile))
  old.setMaxHp(resolveCareerPlayerMaxHp(profile, 200)); old.setHp(old.maxHp * .4)
  old.setStamina(37); old.setArrowCount(11)
  const skills = new SkillManager(); skills.setSkillState(profile.skills ?? {})
  // The single unsafe cast exposes only this private caller's required collaborators.
  const town = Object.assign(Object.create(TownScene.prototype), {
    profile, player: old, scene, camera, skills, store,
    disposed: false, promotionAttempt: null, panel: { remove: vi.fn() },
    event: { hostile: false }, world: { obstacles: [], faction },
    hp: { setFill: vi.fn() }, stamina: { setFill: vi.fn() },
    quiver: { setShieldBlocked() {}, setAiming() {}, setChargeRatio() {} },
    input: { keys: {}, isLeftMouseDown: false, isRightMouseDown: false,
      consumeLeftClick: () => false, consumeLeftClickRelease: () => false, clear() {} },
    equipment: { close() {} }, careerSkillSaveTimer: null, careerSaveFailures: 0, notice: '',
  }) as PromotionTown
  town.inventory = new TownEquipment(() => town.profile, next => town.commit(next))
  town.inventory.restoreForHostile()
  old.rebuildShield('scutum_t2'); old.shield.absorb(10, 8)
  const mount = mounted ? new Mount(scene, MountType.CORGI, 15, 25) : null
  if (mount) old.mountVehicle(mount, .7)
  else old.group.position.set(15, 8, 25)
  old.faceDirection(Math.sin(.7), Math.cos(.7))
  town.orbit = new ThirdPersonCamera(camera, old); town.orbit.setYaw(1.2); town.orbit.setPitch(.4)
  const preload = vi.spyOn(HumanoidAssetRegistry, 'preloadAsset').mockResolvedValue()
  onTestFinished(() => { old.dispose(); if (town.player !== old) town.player.dispose(); mount?.dispose() })
  return { town, old, mount, storage, store, preload }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('Career appointment identity transaction', () => {
  it('accepting Captain at 20000 merit still uses T4 and grants no additional equipment', async () => {
    const { town, store, preload } = fixture('roman', false, 'veteran')
    const saved = store.load()!
    expect(await town.acceptCareerPromotion()).toBe(true)
    expect(town.player.heroAssetId).toBe('roman-hero-t4')
    expect(town.player.maxHp).toBe(501)
    expect(store.load()).toMatchObject({ rank: 'captain', ownedWeapons: saved.ownedWeapons, inventory: saved.inventory })
    expect(preload.mock.calls.map(([descriptor]) => descriptor.assetId)).toEqual(['roman-hero-t4'])
  })

  it.each(['roman', 'viking'] as const)('%s Commander preserves live state and survives JSON reload without replacing equipment', async faction => {
    const { town, old, mount, store } = fixture(faction, true)
    const position = old.group.position.clone(), inventory = town.inventory, skills = town.skills, orbit = town.orbit
    const persisted = store.load()!
    expect(resolveCareerHeroAsset(persisted)).toBe(`${faction}-hero-t4`)
    expect(await town.acceptCareerPromotion()).toBe(true)
    expect(town.player).not.toBe(old)
    expect(old.group.parent).toBeNull()
    expect(town.player.heroAssetId).toBe(`${faction}-hero-t5`)
    expect(town.player.maxHp).toBe(faction === 'roman' ? 851 : 951)
    expect(town.player.hpRatio).toBeCloseTo(.4)
    expect(town.player.staminaValue).toBe(37)
    expect(town.player.arrowCount).toBe(11)
    expect(town.player.group.position.toArray()).toEqual(position.toArray())
    expect(town.player.facingYaw).toBeCloseTo(.7)
    expect(town.orbit).toBe(orbit)
    expect(town.orbit.cameraYaw).toBe(1.2); expect(town.orbit.cameraPitch).toBe(.4)
    expect(town.player.currentMount).toBe(mount); expect(mount!.riderPlayer).toBe(town.player)
    expect(town.player.shield.shieldImpactRemaining).toBe(7)
    expect(town.inventory).toBe(inventory); expect(town.skills).toBe(skills)
    const loaded = store.load()!
    expect(loaded.rank).toBe('commander')
    expect(resolveCareerHeroAsset(loaded)).toBe(`${faction}-hero-t5`)
    for (const key of ['equipment', 'inventory', 'skills', 'ownedWeapons', 'ownedMounts', 'totalMerit', 'availableMerit', 'claimedBattleIds'] as const) {
      expect(loaded[key]).toEqual(persisted[key])
    }
  })

  it('asset failure leaves the saved Captain and actor intact, then allows a successful retry', async () => {
    const { town, old, store, preload } = fixture()
    preload.mockRejectedValueOnce(new Error('asset unavailable'))
    expect(await town.acceptCareerPromotion()).toBe(false)
    expect(town.player).toBe(old); expect(old.group.parent).toBe(town.scene)
    expect(store.load()!.rank).toBe('captain'); expect(town.profile.rank).toBe('captain')
    expect(town.notice).toContain('原有角色與軍階已保留')
    expect(await town.acceptCareerPromotion()).toBe(true)
    expect(store.load()!.rank).toBe('commander')
  })

  it('failed candidate initialization keeps the old actor and saved rank, disposing the candidate before retry', async () => {
    const { town, old, store } = fixture()
    const update = vi.spyOn(Player.prototype, 'update').mockImplementationOnce(() => { throw new Error('invalid rig') })
    const dispose = vi.spyOn(Player.prototype, 'dispose')
    expect(await town.acceptCareerPromotion()).toBe(false)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(town.player).toBe(old); expect(town.scene.children).toEqual([old.group])
    expect(store.load()!.rank).toBe('captain')
    update.mockRestore()
    expect(await town.acceptCareerPromotion()).toBe(true)
  })

  it('model construction failure never disposes the Captain or saves the new appointment', async () => {
    const { town, old, store } = fixture()
    const skeleton = new THREE.Skeleton([new THREE.Bone()]); skeleton.computeBoneTexture()
    const released = vi.fn(); skeleton.boneTexture!.addEventListener('dispose', released)
    const geometry = new THREE.BufferGeometry(), material = new THREE.MeshBasicMaterial()
    const geometryDisposed = vi.spyOn(geometry, 'dispose'), materialDisposed = vi.spyOn(material, 'dispose')
    onTestFinished(() => { skeleton.dispose(); geometry.dispose(); material.dispose() })
    const readiness = vi.spyOn(HumanoidAssetRegistry, 'ready', 'get').mockReturnValue(true)
    const create = vi.spyOn(HumanoidAssetRegistry, 'createCharacterVisual').mockImplementationOnce(root => {
      const mesh = new THREE.SkinnedMesh(geometry, material); mesh.bind(skeleton); root.add(mesh)
      throw new Error('invalid bones')
    })
    expect(await town.acceptCareerPromotion()).toBe(false)
    expect(released).toHaveBeenCalledOnce(); expect(skeleton.boneTexture).toBeNull()
    expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled()
    expect(town.player).toBe(old); expect(old.group.parent).toBe(town.scene)
    expect(store.load()!.rank).toBe('captain')
    create.mockRestore(); readiness.mockRestore()
    expect(await town.acceptCareerPromotion()).toBe(true)
  })

  it('failed save restores the mounted Captain and camera with no duplicate actor before retry', async () => {
    const { town, old, mount, storage, store } = fixture('roman', true)
    const orbit = town.orbit, position = old.group.position.clone()
    storage.failWrites = true
    expect(await town.acceptCareerPromotion()).toBe(false)
    expect(town.player).toBe(old); expect(town.orbit).toBe(orbit)
    expect(old.group.position.toArray()).toEqual(position.toArray())
    expect(old.currentMount).toBe(mount); expect(mount!.riderPlayer).toBe(old)
    expect(town.scene.children).toEqual(expect.arrayContaining([old.group, mount!.group]))
    expect(town.scene.children).toHaveLength(2)
    expect(old.shield.shieldImpactRemaining).toBe(7)
    expect(store.load()!.rank).toBe('captain'); expect(town.profile.rank).toBe('captain')
    storage.failWrites = false
    expect(await town.acceptCareerPromotion()).toBe(true)
  })

  it('deduplicates confirmation while loading and commits the current profile once ready', async () => {
    const { town, old, store, preload } = fixture()
    const loading = deferred(); preload.mockReturnValueOnce(loading.promise)
    const first = town.acceptCareerPromotion()
    expect(await town.acceptCareerPromotion()).toBe(false)
    expect(town.player).toBe(old); expect(store.load()!.rank).toBe('captain')
    town.profile.availableMerit = 123
    loading.resolve()
    expect(await first).toBe(true)
    expect(preload).toHaveBeenCalledTimes(1)
    expect(store.load()!.availableMerit).toBe(123)
  })

  it('the replacement retains the town movement boundary instead of the staging scene default', async () => {
    const { town } = fixture()
    expect(await town.acceptCareerPromotion()).toBe(true)
    town.player.group.position.set(350, 8, 25)
    town.player.update(0, { keys: {}, isLeftMouseDown: false, isRightMouseDown: false,
      consumeLeftClick: () => false, consumeLeftClickRelease: () => false }, 0, new THREE.Vector3(), [],
    { setFill() {} }, { setShieldBlocked() {}, setAiming() {}, setChargeRatio() {} }, { playBowRelease() {} }, town.inventory)
    expect(town.player.group.position.x).toBe(350)
  })

  it.each(['close', 'dispose'] as const)('ignores a late preload after %s without changing the actor or saved appointment', async cancel => {
    const { town, old, store, preload } = fixture()
    const loading = deferred(); preload.mockReturnValueOnce(loading.promise)
    const pending = town.acceptCareerPromotion()
    if (cancel === 'close') {
      vi.stubGlobal('location', { search: '?nolock' })
      town.closePanel()
    } else town.disposed = true
    loading.resolve()
    expect(await pending).toBe(false)
    expect(town.player).toBe(old); expect(store.load()!.rank).toBe('captain')
    expect(town.scene.children).toEqual([old.group])
  })

  it('an older cancelled load cannot supersede a new appointment attempt', async () => {
    const { town, store, preload } = fixture()
    const older = deferred(), newer = deferred()
    preload.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const abandoned = town.acceptCareerPromotion()
    vi.stubGlobal('location', { search: '?nolock' }); town.closePanel()
    town.panel = { remove() {} }
    const current = town.acceptCareerPromotion()
    older.resolve()
    expect(await abandoned).toBe(false)
    expect(store.load()!.rank).toBe('captain')
    expect(await town.acceptCareerPromotion()).toBe(false)
    newer.resolve()
    expect(await current).toBe(true)
    expect(store.load()!.rank).toBe('commander')
    expect(preload).toHaveBeenCalledTimes(2)
  })
})
