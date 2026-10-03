import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HumanoidAssetRegistry, resolveHumanoidAnimationClips } from '../src/world/HumanoidAssetRegistry'
import { calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../src/world/EquipmentAttachmentContract'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'
import { UNIT_PRESETS } from '../src/battle/UnitPresetCatalog'
import { resolveEntityCollision } from '../src/world/Terrain'
// @ts-expect-error diagnostic loader reads shipped GLBs without browser image decoding.
import { loadRig, readGlb } from '../tools/lib/humanoid-glb.mjs'

vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: () => {
      const root = new THREE.Group(), saddleSeat = new THREE.Object3D()
      saddleSeat.position.y = 1.7
      root.add(saddleSeat)
      return {
        root, saddleSeat, lod: new THREE.LOD(), skeleton: null,
        setLocomotion: vi.fn(), setAppearanceVariant: vi.fn(), playOnce: vi.fn(),
        playDeath: vi.fn(), update: vi.fn(), dispose: vi.fn(),
      }
    },
  },
}))

type Template = NonNullable<ReturnType<typeof HumanoidAssetRegistry._snapshotTemplatesForTesting> extends Map<any, infer Value> ? Value : never>
const registryAssets = (HumanoidAssetRegistry as unknown as { assets: Map<string, Template> }).assets
const savedAssets = new Map(registryAssets)
const savedTemplates = HumanoidAssetRegistry._snapshotTemplatesForTesting()

beforeAll(async () => {
  const templates = HumanoidAssetRegistry._snapshotTemplatesForTesting()
  for (const faction of ['roman', 'viking'] as const) {
    for (const asset of [faction, `${faction}-hero-t4`]) {
      const base = `public/models/characters/v2/${asset}`
      const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'))
      const levels = await Promise.all([0, 1, 2].map(lod => loadRig(readGlb(`${base}/lod${lod}.glb`))))
      const left = Object.fromEntries(Object.entries(manifest.handGripFrames.left).map(([key, value]) => [
        key, Array.isArray(value) ? new THREE.Vector3(...value as [number, number, number]) : value,
      ])) as any
      levels[0].scene.updateMatrixWorld(true)
      const referenceHand = levels[0].scene.getObjectByName('hand_l')!
      levels.forEach((level, lod) => {
        level.scene.updateMatrixWorld(true)
        const frames = calibrateEquipmentFrames(manifest.swordGripFrames[`lod${lod}`], left, referenceHand, level.scene.getObjectByName('hand_l')!)
        level.scene.userData.equipmentGripFrames = frames
        level.scene.userData.equipmentFaction = faction
        calibrateLanceIdleAttachment(level.scene, level.animations.find((clip: THREE.AnimationClip) => clip.name === 'idle')!, frames.lanceRight)
      })
      const template = { manifest, levels, animationClips: resolveHumanoidAnimationClips(levels.map(level => level.animations)) }
      if (asset === faction) templates.set(faction, template)
      else registryAssets.set(asset, template)
    }
  }
  HumanoidAssetRegistry._restoreTemplatesForTesting(templates)
})
afterAll(() => {
  HumanoidAssetRegistry._restoreTemplatesForTesting(savedTemplates)
  registryAssets.clear()
  savedAssets.forEach((template, asset) => registryAssets.set(asset, template))
})

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  cleanup.splice(0).reverse().forEach(dispose => dispose())
})

function fixture(faction: 'roman' | 'viking', dt: number, cameraDistance: number, phase: number, distance = 2.7, targetKind: 'player' | 'npc' = 'npc', weaponId = 'heavy_lance') {
  const scene = new THREE.Scene()
  const attacker = new NPC(scene, 0, 0, Faction.ENEMY, faction, AIType.MELEE, `${faction} T4`, 4, false, {
    meleeWeaponId: weaponId, rangedWeaponId: null, shieldId: null, mountId: null,
  }, undefined, undefined, undefined, undefined, `${faction}-hero-t4`, faction === 'viking' ? 'varangian' : 'praetorian')
  const player = new Player(scene)
  const target = targetKind === 'player' ? player : new NPC(scene, 0, distance, Faction.PLAYER, 'roman', AIType.MELEE, 'stationary target', 2, false, {
    meleeWeaponId: 'gladius_standard', rangedWeaponId: null, shieldId: null, mountId: null,
  })
  if (target !== player) player.setPosition(100, attacker.position.y + .95, 100)
  cleanup.push(() => attacker.dispose(), () => player.dispose())
  if (target instanceof NPC) cleanup.push(() => target.dispose())
  target.position.set(0, attacker.combatPosition.y - (target.bodyBaseOffset ?? 0), distance)
  const npcs = target instanceof NPC ? [attacker, target] : [attacker]
  const animator = (attacker as any).animator
  const starts = vi.spyOn(animator, 'start')
  const hit = vi.fn()
  const trace = vi.spyOn(attacker.weaponSweep, 'trace')
  // Vary the real mixer's existing idle accumulator without changing attack time.
  if (phase > 0) (attacker as any).rig.animation.update(phase, cameraDistance)
  attacker.state = AIState.ATTACK
  const step = () => {
    target.position.y = attacker.combatPosition.y - (target.bodyBaseOffset ?? 0)
    scene.updateMatrixWorld(true)
    attacker.update(dt, player, npcs, target instanceof NPC ? [target] : [], [], null as any, hit, () => {}, false, cameraDistance)
    resolveEntityCollision(
      { position: attacker.combatPosition, radius: attacker.isMounted ? 1 : .5, height: attacker.isMounted ? 2.6 : 2.3, bottomOffset: 0 },
      { position: target.position, radius: targetKind === 'player' ? .38 : .5, height: targetKind === 'player' ? 1.9 : 2.3, bottomOffset: -(target.bodyBaseOffset ?? 0), anchored: true },
      [],
    )
    if (attacker.mount) (attacker as any)._syncToMount()
    const spacing = (attacker.isMounted ? 1 : .5) + (targetKind === 'player' ? .38 : .5)
    expect(Math.hypot(target.position.x - attacker.combatPosition.x, target.position.z - attacker.combatPosition.z)).toBeGreaterThanOrEqual(spacing - .001)
  }
  const firstAttack = () => {
    step()
    expect(starts).toHaveBeenCalledTimes(1)
    for (let frame = 0; frame < 60 && animator.busy; frame++) step()
    expect(animator.busy).toBe(false)
  }
  return { scene, attacker, target, animator, hit, trace, starts, step, firstAttack }
}

const timings = [60, 30, 20].flatMap(fps => [0, 1 / 24].map(phase => ({ fps, dt: 1 / fps, phase })))

describe.each(['roman', 'viking'] as const)('%s T4 lance physical-contact timing', faction => {
  it.each(timings)('hits at 2.7m on the first thrust at $fps fps, mixer phase $phase, both near and far from the camera', ({ dt, phase }) => {
    for (const cameraDistance of [0, 60]) {
      const h = fixture(faction, dt, cameraDistance, phase)
      h.firstAttack()

      expect(h.hit, `first-thrust damage at camera distance ${cameraDistance}`).toHaveBeenCalledTimes(1)
      expect(h.trace.mock.results.some(result => result.value?.kind === 'body')).toBe(true)
      expect(h.hit).toHaveBeenLastCalledWith(expect.any(Number), false, h.target)
    }
  })

  it.each(timings)('hits a Player body on the first thrust at $fps fps, mixer phase $phase, both near and far from the camera', ({ dt, phase }) => {
    for (const cameraDistance of [0, 60]) {
      const h = fixture(faction, dt, cameraDistance, phase, 2.7, 'player')
      h.firstAttack()

      expect(h.hit, `first-thrust Player damage at camera distance ${cameraDistance}`).toHaveBeenCalledTimes(1)
      expect(h.trace.mock.results.some(result => result.value?.kind === 'body')).toBe(true)
      expect(h.hit).toHaveBeenLastCalledWith(expect.any(Number), true, undefined)
    }
  })

  it('keeps the lance contact attachment when a mounted Captain switches to lance, dismounts, then restores the original blade and remounts', () => {
    const swordId = UNIT_PRESETS[`${faction}_sword_cavalry`].tierLoadouts[3].meleeWeaponId!
    const h = fixture(faction, 1 / 60, 0, 0, 2.7, 'player', swordId)
    h.attacker.state = AIState.IDLE
    const mount = new Mount(h.scene, MountType.HORSE, 0, 0)
    cleanup.push(() => mount.dispose())
    h.attacker.mountVehicle(mount)
    h.animator.setLocomotion(0, true)
    h.animator.update(1 / 60)
    const pivot = (h.attacker as any).swordPivot as THREE.Group
    expect(pivot.userData.swordAttachmentOwned).toBe(true)
    pivot.updateMatrix()
    const originalMountedSwordMatrix = pivot.matrix.clone()

    h.attacker.applyTemporaryCombatLoadout({
      meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null, mountId: null,
    })
    pivot.updateMatrix()
    const lanceAttachmentMatrix = pivot.matrix.clone()
    h.attacker.dismountFromMount()
    pivot.updateMatrix()
    expect(pivot.matrix.elements, 'dismount must retain the newly calibrated lance attachment').toEqual(lanceAttachmentMatrix.elements)
    h.target.position.set(h.attacker.position.x, h.attacker.position.y - (h.target.bodyBaseOffset ?? 0), h.attacker.position.z + 2.7)
    h.attacker.state = AIState.ATTACK
    h.firstAttack()

    expect(h.hit).toHaveBeenCalledTimes(1)
    expect(h.trace.mock.results.some(result => result.value?.kind === 'body')).toBe(true)
    expect(pivot.userData.equipmentAttachmentOwned).toBe('lance')
    expect(pivot.userData.swordAttachmentOwned).not.toBe(true)

    h.attacker.restoreCombatLoadout()
    expect(h.attacker.meleeWeaponId).toBe(swordId)
    h.attacker.mountVehicle(mount)
    h.animator.setLocomotion(0, true)
    pivot.updateMatrix()
    expect(pivot.userData.swordAttachmentOwned).toBe(true)
    pivot.matrix.elements.forEach((value, index) => expect(value).toBeCloseTo(originalMountedSwordMatrix.elements[index], 5))
  })

  it.each(timings)('approaches a stationary target and physically hits at $fps fps, mixer phase $phase, and 60m camera distance', ({ dt, phase }) => {
    const h = fixture(faction, dt, 60, phase, 4.4)
    h.attacker.state = AIState.CHASE
    for (let frame = 0; frame < Math.ceil(6 / dt) && !h.hit.mock.calls.length; frame++) h.step()

    expect(h.hit).toHaveBeenCalledTimes(1)
    expect(h.trace.mock.results.some(result => result.value?.kind === 'body')).toBe(true)
    expect(h.attacker.position.z).toBeGreaterThan(.5)
  })
})
