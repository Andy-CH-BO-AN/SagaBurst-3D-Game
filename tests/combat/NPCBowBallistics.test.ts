import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { MountType, Mount } from '../../src/world/Mount'
import { eagleBowEngagementRange } from '../../src/combat/EagleRangedCombat'

import { InventoryManager } from '../../src/rpg/InventoryManager'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const GRAVITY = 9.8

function createRangedNpc(rangedWeaponId: string): NPC {
  return new NPC(
    new THREE.Scene(),
    0,
    0,
    Faction.ENEMY,
    'roman',
    AIType.RANGED,
    'BallisticsRanged',
    1,
    false,
    {
      meleeWeaponId: 'gladius_rusty',
      rangedWeaponId,
      shieldId: null,
      mountId: null,
    },
  )
}

function expectProjectileReaches(
  npc: NPC,
  target: THREE.Vector3,
  expectedTargetHeight = 1.4,
): void {
  ;(npc as any).bowVisual = undefined
  npc.group.position.set(0, 0, 0)

  const aimPoint = (npc as any)._getElevatedRangedAimPoint(target).clone()
  const origin = new THREE.Vector3(0, 1.0, 0)
  const direction = aimPoint.clone().sub(origin).normalize()
  const speed = npc.rangedProjectileSpeed

  const horizontalSpeed = Math.hypot(direction.x, direction.z) * speed
  const horizontalDistance = Math.hypot(target.x - origin.x, target.z - origin.z)
  const flightTime = horizontalDistance / horizontalSpeed
  const yAtTarget = origin.y
    + direction.y * speed * flightTime
    - 0.5 * GRAVITY * flightTime * flightTime

  expect(yAtTarget).toBeCloseTo(target.y + expectedTargetHeight, 5)
}

describe('NPC ranged ballistics', () => {
  it('uses realistic bow projectile speeds without changing the 50m AI engagement range', () => {
    const t1 = createRangedNpc('wooden_shortbow')
    const t2 = createRangedNpc('recurve_longbow')
    const t3 = createRangedNpc('elven_runebow')

    expect(t1.maxRangedAttackDistance).toBe(50)
    expect(t2.maxRangedAttackDistance).toBe(50)
    expect(t3.maxRangedAttackDistance).toBe(50)

    expect(t1.rangedProjectileSpeed).toBe(45)
    expect(t2.rangedProjectileSpeed).toBe(55)
    expect(t3.rangedProjectileSpeed).toBe(65)
  })

  it('uses realistic pilum projectile speeds without changing the 30m AI engagement range', () => {
    const t1 = createRangedNpc('pilum_basic')
    const t2 = createRangedNpc('pilum_standard')
    const t3 = createRangedNpc('legionary_pilum')

    expect(t1.maxRangedAttackDistance).toBe(30)
    expect(t2.maxRangedAttackDistance).toBe(30)
    expect(t3.maxRangedAttackDistance).toBe(30)

    expect(t1.rangedProjectileSpeed).toBe(18)
    expect(t2.rangedProjectileSpeed).toBe(24)
    expect(t3.rangedProjectileSpeed).toBe(30)
  })

  it('computes gravity-compensated trajectories at the authoritative AI ranges', () => {
    expectProjectileReaches(createRangedNpc('wooden_shortbow'), new THREE.Vector3(0, 0, 50))
    expectProjectileReaches(createRangedNpc('pilum_basic'), new THREE.Vector3(0, 0, 30))
  })

  it('player full-charge bow and pilum use the same WeaponDatabase max speeds as NPCs', () => {
    const player = new Player(new THREE.Scene(), 'viking')
    player.setArrowCount(10)
    const fire = vi.fn()
    player.onFireArrow = fire

    const bow = WEAPONS.recurve_longbow
    ;(player as any)._fireArrow(
      new THREE.Vector3(0, 1.4, 50),
      1,
      bow,
      bow.speedOrCharge,
    )
    expect(fire).toHaveBeenLastCalledWith(expect.objectContaining({
      speed: 55,
      visualKind: 'arrow',
    }))

    const pilum = WEAPONS.pilum_standard
    ;(player as any)._firePilum(
      new THREE.Vector3(0, 1.4, 30),
      1,
      pilum,
    )
    expect(fire).toHaveBeenLastCalledWith(expect.objectContaining({
      speed: 24,
      visualKind: 'pilum',
    }))
  })
})

/** Getter adapter only: no actor construction is needed for equipment/range policy. */
function rangePolicyNpc(weapon: string, mountType?: MountType, ranger = false): NPC {
  const npc = Object.create(NPC.prototype) as NPC
  Object.assign(npc, {
    rangedWeaponId: weapon,
    combatProfileId: ranger ? 'ranger' : undefined,
    // This getter reads only mount identity/liveness; it does not simulate a mount.
    mount: mountType ? { type: mountType, dead: false } as Mount : null,
  })
  return npc
}

describe('eagle bow engagement override consumes actual equipment', () => {
  it.each([['wooden_shortbow', 200], ['recurve_longbow', 300], ['elven_runebow', 400], ['maki-ranger-bow-ranged', 500]] as const)(
    '%s on xongkoro uses %dm without the Ranger range multiplier', (weapon, range) => {
      expect(rangePolicyNpc(weapon, MountType.XONGKORO, true).maxRangedAttackDistance).toBe(range)
    })
  it.each([undefined, MountType.HORSE, MountType.BLACK_CAT, MountType.CORGI])('retains ordinary bow/javelin and Ranger policies on mount=%s', mountType => {
    expect(rangePolicyNpc('elven_runebow', mountType).maxRangedAttackDistance).toBe(mountType ? 30 : 50)
    expect(rangePolicyNpc('elven_runebow', mountType, true).maxRangedAttackDistance).toBe(mountType ? 60 : 100)
    expect(rangePolicyNpc('legionary_pilum', mountType).maxRangedAttackDistance).toBe(mountType ? 15 : 30)
  })
  it('updates immediately after weapon changes and dismount, while a melee fallback never grants bow range', () => {
    const npc = rangePolicyNpc('wooden_shortbow', MountType.XONGKORO, true)
    expect(npc.maxRangedAttackDistance).toBe(200)
    npc.rangedWeaponId = 'elven_runebow'
    expect(npc.maxRangedAttackDistance).toBe(400)
    npc.mount = null
    expect(npc.maxRangedAttackDistance).toBe(100)
    expect(eagleBowEngagementRange('xongkoro', WEAPONS['maki-ranger-bow'])).toBeUndefined()
    expect(rangePolicyNpc('legionary_pilum', MountType.XONGKORO).maxRangedAttackDistance).toBe(15)
  })
})


// These caller checks intentionally use procedural visual fixtures, not GLBs.
// Asset pose/bow-facing coverage belongs to the asset pose integration owner.
// One real mount suffices for the ground-mounted launch branch; eagle interception
// and its separate projectile path remain owned by EagleNpcRuntime/PlayerEagleFlight.
describe('Commander mounted bow projectile callers', () => {
  it.each(['roman', 'viking'] as const)('%s Player release retains camera-target direction and consumes exactly one arrow', faction => {
    const scene = new THREE.Scene()
    const player = new Player(scene, faction, `${faction}-hero-t5`)
    onTestFinished(() => player.dispose())
    const mount = new Mount(scene, MountType.CORGI, 0, 0, 0)
    onTestFinished(() => mount.dispose())
    player.mountVehicle(mount)
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'elven_runebow', shieldId: null })
    const target = new THREE.Vector3(11, 5, 23)
    const launches: Array<{ origin: THREE.Vector3; direction: THREE.Vector3 }> = []
    player.onFireArrow = event => launches.push(event)
    const initialAmmo = player.arrowCount
    const controls = {
      keys: {}, isLeftMouseDown: true, isRightMouseDown: true,
      consumeLeftClick: () => false, consumeLeftClickRelease: () => false,
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    }
    const tick = () => player.update(1 / 60, controls, Math.atan2(11, 23), target, [],
      { setFill() {} } as Parameters<Player['update']>[5],
      { setAiming() {}, setChargeRatio() {}, setShieldBlocked() {} } as Parameters<Player['update']>[6],
      { playBowRelease() {}, playSwing() {}, playHit() {} } as Parameters<Player['update']>[7], inventory)
    for (let frame = 0; frame < 40; frame++) tick()
    expect(player.bowDrawRatio).toBeGreaterThan(0)
    controls.isLeftMouseDown = false
    controls.consumeLeftClickRelease = () => true
    tick()
    controls.consumeLeftClickRelease = () => false
    for (let frame = 0; frame < 60; frame++) tick()
    expect(launches).toHaveLength(1)
    expect(player.arrowCount).toBe(initialAmmo - 1)
    const shot = launches[0]
    expect(shot.direction.length()).toBeCloseTo(1, 7)
    expect(target.clone().sub(shot.origin).normalize().dot(shot.direction)).toBeGreaterThan(.999999)
  })

  it.each(['roman', 'viking'] as const)('%s NPC release retains gravity-compensated target direction while mounted', faction => {
    const scene = new THREE.Scene()
    const target = new Player(scene)
    onTestFinished(() => target.dispose())
    target.setPosition(11, 0, 23)
    const npc = new NPC(scene, 0, 0, Faction.ENEMY, faction, AIType.RANGED, 'Commander bow caller', 4, false,
      { meleeWeaponId: 'steel_sword', rangedWeaponId: 'elven_runebow', shieldId: null, mountId: null },
      undefined, undefined, undefined, undefined, `${faction}-hero-t5`, `${faction}-commander`)
    onTestFinished(() => npc.dispose())
    const mount = new Mount(scene, MountType.CORGI, 0, 0, 0)
    onTestFinished(() => mount.dispose())
    npc.mountVehicle(mount)
    const initialAmmo = npc.combatAmmo
    let shot: { origin: THREE.Vector3; direction: THREE.Vector3; target: THREE.Vector3; kind: string } | undefined
    for (let frame = 0; frame < 360 && !shot; frame++) {
      npc.update(1 / 60, target, [npc], [], [], { setFill() {} }, () => {}, (origin, direction, kind) => {
        shot = { origin: origin.clone(), direction: direction.clone(), target: target.position.clone().add(new THREE.Vector3(0, target.bodyBaseOffset + 1.4, 0)), kind }
      }, true)
    }
    expect(shot, `state=${npc.currentState}, action=${npc.combatAnimationAction}`).toBeDefined()
    const launched = shot!
    expect(launched.kind).toBe('arrow')
    expect(npc.combatAmmo).toBe(initialAmmo - 1)
    const distance = Math.hypot(launched.target.x - launched.origin.x, launched.target.z - launched.origin.z)
    const time = distance / (Math.hypot(launched.direction.x, launched.direction.z) * npc.rangedProjectileSpeed)
    const impact = launched.origin.clone().addScaledVector(launched.direction, npc.rangedProjectileSpeed * time)
    impact.y -= .5 * GRAVITY * time * time
    // Arrow centre starts ahead of the nock; retain a small physical tolerance.
    expect(impact.distanceTo(launched.target)).toBeLessThan(.05)
  })
})
