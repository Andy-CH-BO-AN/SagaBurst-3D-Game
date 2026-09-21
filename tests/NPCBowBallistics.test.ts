import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AIType, Faction, NPC } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { WEAPONS } from '../src/rpg/WeaponDatabase'

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
