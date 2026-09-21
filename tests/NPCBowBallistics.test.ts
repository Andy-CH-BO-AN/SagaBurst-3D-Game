import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AIType, Faction, NPC } from '../src/world/NPC'

const GRAVITY = 9.8

function createBowNpc(rangedWeaponId: string): NPC {
  return new NPC(
    new THREE.Scene(),
    0,
    0,
    Faction.ENEMY,
    'roman',
    AIType.RANGED,
    'BallisticsArcher',
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

describe('NPC bow ballistics', () => {
  it('uses each bow weapon max projectile speed without changing AI engagement range', () => {
    const t1 = createBowNpc('wooden_shortbow')
    const t2 = createBowNpc('recurve_longbow')
    const t3 = createBowNpc('elven_runebow')

    expect(t1.maxRangedAttackDistance).toBe(50)
    expect(t2.maxRangedAttackDistance).toBe(50)
    expect(t3.maxRangedAttackDistance).toBe(50)

    expect(t1.rangedProjectileSpeed).toBe(32)
    expect(t2.rangedProjectileSpeed).toBe(48)
    expect(t3.rangedProjectileSpeed).toBe(65)
  })

  it('computes a gravity-compensated bow angle that reaches 50m', () => {
    const npc = createBowNpc('wooden_shortbow')

    ;(npc as any).bowVisual = undefined
    npc.group.position.set(0, 0, 0)

    const target = new THREE.Vector3(0, 0, 50)
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

    expect(yAtTarget).toBeCloseTo(target.y + 1.4, 5)
  })
})
