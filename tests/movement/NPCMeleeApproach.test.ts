import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { HumanoidAssetRegistry, resolveHumanoidAnimationClips } from '../../src/world/HumanoidAssetRegistry'
import { calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../../src/world/EquipmentAttachmentContract'
// @ts-expect-error diagnostic loader parses the shipped GLB without browser image decoding.
import { loadRig, readGlb } from '../../tools/lib/humanoid-glb.mjs'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { Mount, MountType } from '../../src/world/Mount'
import type { CombatContact } from '../../src/combat/ShieldBlocking'
import { calculateLanceChargeDamage } from '../../src/combat/CombatBalance'
import { resolveEntityCollision } from '../../src/world/Terrain'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
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

// Install the shipped rigs through the registry's test seam, so NPC construction,
// attachment calibration and animation layering follow the production path.
const savedTemplates = HumanoidAssetRegistry._snapshotTemplatesForTesting()
beforeAll(async () => {
  const templates = HumanoidAssetRegistry._snapshotTemplatesForTesting()
  for (const faction of ['viking', 'roman'] as const) {
    const base = `public/models/characters/v2/${faction}`
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
    templates.set(faction, { manifest, levels, animationClips: resolveHumanoidAnimationClips(levels.map(level => level.animations)) })
  }
  HumanoidAssetRegistry._restoreTemplatesForTesting(templates)
})
afterAll(() => HumanoidAssetRegistry._restoreTemplatesForTesting(savedTemplates))

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  cleanup.splice(0).reverse().forEach(dispose => dispose())
})

const weapons = ['gladius_standard', 'steel_sword', 'viking_axe_t2', 'steel_lance'] as const
const bodyContact: CombatContact = { kind: 'body', time: 0 }

function harness(weaponId: string, targetKind: 'player' | 'npc' = 'player', physicalCollision = false) {
  const scene = new THREE.Scene()
  const attacker = new NPC(scene, 0, 0, Faction.ENEMY, weaponId === 'steel_lance' || weaponId.startsWith('gladius') ? 'roman' : 'viking', AIType.MELEE, 'attacker', 2, false, {
    meleeWeaponId: weaponId, rangedWeaponId: null, shieldId: null, mountId: null,
  })
  const player = new Player(scene)
  const target = targetKind === 'player'
    ? player
    : new NPC(scene, 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'stationary target', 2, false, {
      meleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: null, mountId: null,
    })
  cleanup.push(() => attacker.dispose())
  if (target instanceof NPC) cleanup.push(() => target.dispose())
  const npcs = target instanceof NPC ? [attacker, target] : [attacker]
  if (target !== player) player.setPosition(100, attacker.combatPosition.y, 100)
  attacker.state = AIState.CHASE
  const starts = vi.spyOn((attacker as any).animator, 'start')
  const hit = vi.fn()
  const targetBodyPosition = () => target instanceof NPC && target.mount ? target.mount.group.position : target.group.position
  const moveTarget = (distance: number) => {
    targetBodyPosition().set(0, attacker.combatPosition.y - (target.isMounted ? 0 : target.bodyBaseOffset ?? 0), distance)
    if (target instanceof NPC && target.mount) (target as any)._syncToMount()
    scene.updateMatrixWorld(true)
  }
  const distance = () => Math.hypot(
    target.combatPosition.x - attacker.combatPosition.x,
    target.combatPosition.z - attacker.combatPosition.z,
  )
  const step = (frames = 1) => {
    for (let frame = 0; frame < frames; frame++) {
      // Isolate horizontal approach from terrain slope/target gravity.
      targetBodyPosition().y = attacker.combatPosition.y - (target.isMounted ? 0 : target.bodyBaseOffset ?? 0)
      if (target instanceof NPC && target.mount) (target as any)._syncToMount()
      scene.updateMatrixWorld(true)
      attacker.update(1 / 60, player, npcs, physicalCollision ? npcs : [], [], null as any, hit, () => {}, !physicalCollision)
      if (physicalCollision) {
        resolveEntityCollision(
          { position: attacker.combatPosition, radius: attacker.isMounted ? 1 : .5, height: attacker.isMounted ? 2.6 : 2.3, bottomOffset: 0 },
          { position: targetBodyPosition(), radius: target.isMounted ? 1 : targetKind === 'player' ? .38 : .5, height: target.isMounted ? 2.6 : targetKind === 'player' ? 1.9 : 2.3, bottomOffset: target.isMounted ? 0 : -(target.bodyBaseOffset ?? 0), anchored: true },
          [],
        )
        if (attacker.mount) (attacker as any)._syncToMount()
        const bodySpacing = (attacker.isMounted ? 1 : .5) + (target.isMounted ? 1 : targetKind === 'player' ? .38 : .5)
        expect(distance()).toBeGreaterThanOrEqual(bodySpacing - .001)
      }
    }
  }
  const until = (condition: () => boolean, maxFrames = 600) => {
    for (let frame = 0; frame < maxFrames && !condition(); frame++) step()
    expect(condition(), 'condition was not reached within the simulation window').toBe(true)
  }
  const nominalContactDistance = () => Math.min(
    attacker.meleeAttackRadius,
    attacker.getWeaponGripPosition(new THREE.Vector3()).distanceTo(attacker.getWeaponTipPosition()) + .2,
  )
  return { scene, attacker, player, target, hit, starts, moveTarget, distance, step, until, nominalContactDistance }
}

describe('NPC melee physical-contact approach', () => {
  for (const targetKind of ['player', 'npc'] as const) {
    it.each(weapons)('%s reaches physical contact with a stationary ' + targetKind + ' from the old attack boundary', weaponId => {
      const h = harness(weaponId, targetKind)
      const initialDistance = h.attacker.meleeAttackRadius - .05
      h.moveTarget(initialDistance)
      const trace = vi.spyOn(h.attacker.weaponSweep, 'trace')

      h.step()
      expect(h.hit).not.toHaveBeenCalled()
      h.until(() => h.hit.mock.calls.length > 0)

      expect(h.distance()).toBeLessThanOrEqual(initialDistance)
      expect(trace.mock.results.some(result => result.value?.kind === 'body')).toBe(true)
      expect(h.hit).toHaveBeenLastCalledWith(expect.any(Number), targetKind === 'player', targetKind === 'npc' ? h.target : undefined)
      expect(h.hit.mock.lastCall![0]).toBeGreaterThan(0)
    })
  }

  for (const targetKind of ['player', 'npc'] as const) {
    it.each(weapons)('%s reaches physical contact with a ' + targetKind + ' while boids and body collision remain enabled', weaponId => {
      const h = harness(weaponId, targetKind, true)
      const initialDistance = h.attacker.meleeAttackRadius + .5
      h.moveTarget(initialDistance)
      h.until(() => h.hit.mock.calls.length > 0)

      expect(h.distance()).toBeLessThan(initialDistance)
      expect(h.attacker.weaponSweep.contact.kind).toBe('body')
    })
  }

  it.each(weapons)('mounted %s physically hits a foot Player with body collision enabled', weaponId => {
    const h = harness(weaponId, 'player', true)
    // Match Town cavalry: Viking axemen carry a shield and use the one-handed arc.
    if (weaponId === 'viking_axe_t2') h.attacker.applyTemporaryCombatLoadout({
      meleeWeaponId: weaponId, rangedWeaponId: null, shieldId: 'round_shield_t2', mountId: null,
    })
    const mount = new Mount(h.scene, MountType.HORSE, 0, 0)
    cleanup.push(() => mount.dispose())
    h.attacker.mountVehicle(mount)
    h.attacker.setTacticalOrder('charge')
    h.moveTarget(4)
    h.until(() => h.hit.mock.calls.length > 0)
    expect(h.attacker.weaponSweep.contact.kind).toBe('body')
    expect(h.hit).toHaveBeenLastCalledWith(expect.any(Number), true, undefined)
  })

  it.each(weapons)('%s returns to approach after a complete miss before starting another attack', weaponId => {
    const h = harness(weaponId)
    h.moveTarget(h.attacker.meleeAttackRadius - .05)
    const trace = vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)
    h.until(() => h.starts.mock.calls.length === 1)
    const firstAttackDistance = h.distance()
    h.until(() => !(h.attacker as any).animator.busy)
    expect(h.hit).not.toHaveBeenCalled()
    expect(h.attacker.currentState).toBe(AIState.CHASE)

    trace.mockRestore()
    h.until(() => h.starts.mock.calls.length >= 2)
    expect(h.distance()).toBeLessThan(firstAttackDistance - .15)
    h.until(() => h.hit.mock.calls.length > 0)
  })

  it('pursues a retreating target during cooldown and does not start the next swing outside contact distance', () => {
    const h = harness('steel_sword')
    h.moveTarget(h.nominalContactDistance() - .05)
    const trace = vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(bodyContact)
    h.until(() => h.hit.mock.calls.length === 1)
    h.until(() => !(h.attacker as any).animator.busy)
    expect((h.attacker as any).attackTimer).toBeGreaterThan(0)
    h.target.group.position.z = h.attacker.combatPosition.z + h.attacker.meleeAttackRadius + .5
    const retreatDistance = h.distance()
    const attackCount = h.starts.mock.calls.length

    h.step(2)
    expect(h.distance()).toBeLessThan(retreatDistance)
    expect(h.starts).toHaveBeenCalledTimes(attackCount)
    trace.mockRestore()
    h.until(() => h.starts.mock.calls.length > attackCount)
    expect(h.distance()).toBeLessThanOrEqual(h.attacker.meleeAttackRadius)
    h.until(() => h.hit.mock.calls.length > 1)
    expect(h.attacker.weaponSweep.contact.kind).toBe('body')
  })

  it.each(weapons)('%s defend holds position instead of swinging indefinitely at the old range boundary', weaponId => {
    const h = harness(weaponId)
    h.moveTarget(h.attacker.meleeAttackRadius - .05)
    h.attacker.setTacticalOrder('defend')
    const position = h.attacker.combatPosition.clone()
    h.step(240)

    expect(h.attacker.combatPosition.distanceTo(position)).toBeLessThan(1e-6)
    expect(h.starts).not.toHaveBeenCalled()
    expect(h.hit).not.toHaveBeenCalled()
  })

  it('defend learns from a missed swing without abandoning its position or repeating the same miss', () => {
    const h = harness('steel_sword')
    h.moveTarget(h.nominalContactDistance() - .05)
    h.attacker.setTacticalOrder('defend')
    const position = h.attacker.combatPosition.clone()
    vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)
    h.step(240)

    expect(h.starts).toHaveBeenCalledTimes(1)
    expect(h.hit).not.toHaveBeenCalled()
    expect(h.attacker.combatPosition.distanceTo(position)).toBeLessThan(1e-6)
    expect(h.attacker.currentState).toBe(AIState.ALERT)
  })

  it('treats shield contact as a successful swing and keeps its current attack distance', () => {
    const h = harness('steel_sword')
    h.moveTarget(h.nominalContactDistance() - .05)
    vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue({ kind: 'shield', time: 0 })
    h.until(() => h.starts.mock.calls.length === 1)
    const firstAttackDistance = h.distance()
    h.until(() => h.starts.mock.calls.length >= 3)

    expect(h.hit.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(h.distance()).toBeCloseTo(firstAttackDistance, 6)
  })

  it.each(['steel_sword', 'viking_axe_t2'])('applying a temporary %s loadout clears learned distance, including a same-weapon rebuild', nextWeapon => {
    const h = harness('steel_sword')
    h.moveTarget(h.nominalContactDistance() - .05)
    const trace = vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)
    h.until(() => h.starts.mock.calls.length === 1)
    h.until(() => !(h.attacker as any).animator.busy)
    const position = h.attacker.combatPosition.clone()
    h.attacker.applyTemporaryCombatLoadout({
      meleeWeaponId: nextWeapon, rangedWeaponId: null, shieldId: null, mountId: null,
    })
    h.moveTarget(h.nominalContactDistance() - .05)
    h.attacker.state = AIState.CHASE
    trace.mockReturnValue(bodyContact)
    const attackCount = h.starts.mock.calls.length
    h.step(2)

    expect(h.starts).toHaveBeenCalledTimes(attackCount + 1)
    expect(h.attacker.combatPosition.distanceTo(position)).toBeLessThan(1e-6)
    expect(h.hit).not.toHaveBeenCalled()
  })

  it.each([
    { targetMounted: false, targetName: 'foot', hardBodySpacing: 1.5 },
    { targetMounted: true, targetName: 'mounted', hardBodySpacing: 2 },
  ])('repeated mounted misses still enter attack without crossing the $targetName target body spacing', ({ targetMounted, hardBodySpacing }) => {
    const h = harness('steel_lance', 'npc', true)
    const sourceMount = new Mount(h.scene, MountType.HORSE, 0, 0)
    cleanup.push(() => sourceMount.dispose())
    h.attacker.mountVehicle(sourceMount)
    if (targetMounted) {
      const targetMount = new Mount(h.scene, MountType.HORSE, 0, 3.6)
      cleanup.push(() => targetMount.dispose())
      ;(h.target as NPC).mountVehicle(targetMount)
    }
    h.moveTarget(3.6)
    h.attacker.state = AIState.CHASE
    vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)

    // Once misses have consumed the initial reach estimate, ATTACK must remain
    // possible beside the colliders; it cannot require occupying the other body.
    h.until(() => h.starts.mock.calls.length >= 8)
    expect(h.distance()).toBeGreaterThanOrEqual(hardBodySpacing - .001)
    expect(h.distance()).toBeLessThan(hardBodySpacing + .25)
    expect(h.hit).not.toHaveBeenCalled()
  })

  it('re-estimates contact distance when the same target mounts after previous misses', () => {
    const h = harness('steel_lance', 'npc', true)
    h.moveTarget(3.6)
    const trace = vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)
    h.until(() => h.starts.mock.calls.length === 1)
    const initialAttackDistance = h.distance()
    h.until(() => h.starts.mock.calls.length === 2)
    h.until(() => !(h.attacker as any).animator.busy)
    const previousAttackDistance = h.distance()
    expect(previousAttackDistance).toBeLessThan(initialAttackDistance - .15)

    const targetMount = new Mount(h.scene, MountType.HORSE, 0, h.attacker.combatPosition.z + initialAttackDistance)
    cleanup.push(() => targetMount.dispose())
    ;(h.target as NPC).mountVehicle(targetMount)
    trace.mockReturnValue(bodyContact)
    const attackCount = h.starts.mock.calls.length
    h.until(() => h.starts.mock.calls.length > attackCount)

    expect(h.distance()).toBeGreaterThan(previousAttackDistance + .15)
    h.until(() => h.hit.mock.calls.length > 0)
  })

  it('preserves the attack cooldown after a defend miss at minimum body spacing', () => {
    const h = harness('steel_sword', 'npc', true)
    h.moveTarget(1.01)
    h.attacker.setTacticalOrder('defend')
    vi.spyOn(h.attacker.weaponSweep, 'trace').mockReturnValue(undefined)
    h.until(() => h.starts.mock.calls.length === 1)
    h.until(() => !(h.attacker as any).animator.busy)
    const attackGap = (h.attacker as any).attackTimer as number
    expect(attackGap).toBeGreaterThan(.2)
    expect(h.attacker.currentState).toBe(AIState.ALERT)
    const heldDistance = h.distance()

    h.step(Math.floor(attackGap * 60) - 1)
    expect(h.starts).toHaveBeenCalledTimes(1)
    h.until(() => h.starts.mock.calls.length === 2, 30)
    expect(h.distance()).toBeCloseTo(heldDistance, 6)
    expect(h.hit).not.toHaveBeenCalled()
  })

  it('preserves a mounted lance charge through early active frames with no collision and consumes it on the hit', () => {
    const h = harness('steel_lance')
    const mount = new Mount(h.scene, MountType.HORSE, 0, 0)
    cleanup.push(() => mount.dispose())
    h.attacker.mountVehicle(mount)
    h.moveTarget(2)
    h.attacker.state = AIState.ATTACK
    h.attacker.pendingLanceChargeSpeed = 25
    const trace = vi.spyOn(h.attacker.weaponSweep, 'trace')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(bodyContact)

    h.until(() => trace.mock.calls.length === 1)
    expect(h.hit).not.toHaveBeenCalled()
    expect(h.attacker.pendingLanceChargeSpeed).toBe(25)
    h.until(() => trace.mock.calls.length === 2)
    expect(h.hit).not.toHaveBeenCalled()
    expect(h.attacker.pendingLanceChargeSpeed).toBe(25)
    h.until(() => h.hit.mock.calls.length === 1)

    expect(h.hit).toHaveBeenLastCalledWith(
      Math.round(calculateLanceChargeDamage(h.attacker.meleeDamage, 'lance', true, 25).damage),
      true, undefined,
    )
    expect(h.attacker.pendingLanceChargeSpeed).toBe(0)
  })
})
