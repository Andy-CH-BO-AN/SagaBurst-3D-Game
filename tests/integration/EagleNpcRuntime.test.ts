import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { damageMount } from '../../src/combat/DamageRouter'
import { createPlayerCombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { advanceUntil } from '../helpers/simulation'
import { resolveMountImpacts } from '../../src/combat/MountImpact'

vi.mock('../../src/world/XongkoroVisual', async () => ({
  XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble,
}))
vi.mock('../../src/world/Terrain', async original => ({ ...(await original<typeof import('../../src/world/Terrain')>()), getTerrainHeight: () => 0 }))

/** Per case: one real rider and Mount, plus Player only where targeting/attribution is under test; zero GLBs. */
function fixture(rangedWeaponId: string | null = null, hero = false) {
  const scene = new THREE.Scene()
  const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', rangedWeaponId ? AIType.RANGED : AIType.MELEE, 'Eagle rider', hero ? 4 : 1, false,
    { meleeWeaponId: null, rangedWeaponId, shieldId: null, mountId: 'xongkoro' }, undefined, undefined, undefined, undefined, undefined, hero ? 'praetorian' : undefined)
  onTestFinished(() => npc.dispose())
  const mount = new Mount(scene, MountType.XONGKORO, 0, 0, 0)
  onTestFinished(() => mount.dispose())
  npc.respawnEnabled = false
  npc.mountVehicle(mount)
  const placeAirborne = (feetHeight: number, velocity = new THREE.Vector3()) => {
    mount.group.position.y = feetHeight - mount.getRiderStandingSeatWorld(new THREE.Vector3()).y + mount.group.position.y
    mount.flight!.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: velocity.length(), velocity })
    npc.updateTownPeace(0, 0, false, false)
  }
  return { scene, npc, mount, placeAirborne }
}

describe('NPC eagle lifecycle and combat caller wiring', () => {
  it('damageMount detaches at the current feet position, survives 14m and does not clear pending fall on repeated cleanup', () => {
    const { npc, mount, placeAirborne } = fixture()
    placeAirborne(14)
    const start = npc.group.position.clone()
    expect(mount.currentHp).toBe(200)
    damageMount(mount, 200)
    expect(npc.mount).toBeNull()
    expect(npc.dead).toBe(false)
    expect(npc.group.position.distanceTo(start)).toBeLessThan(1e-8)
    npc.dismountFromMount()
    expect(npc.pendingFall.highestFeetY).toBeCloseTo(14)
    advanceUntil(() => !npc.isFalling, () => npc.updateTownPeace(1 / 60, 0, false, false), { maxSimulationSeconds: 5, failureMessage: 'NPC 14m landing' })
    expect(npc.dead).toBe(false)
    expect(npc.hp).toBeCloseTo(npc.maxHp / 15, 7)
    expect(npc.group.position.y).toBe(0)
    expect(mount.dead).toBe(true)
  })
  it('a 15m attributed knockdown bypasses hero defense, emits one rider kill and keeps the dead eagle falling until contact', () => {
    const { scene, npc, mount, placeAirborne } = fixture(null, true)
    const player = new Player(scene); onTestFinished(() => player.dispose())
    const events: CombatEvent[] = [], deaths = vi.fn()
    npc.onDeathCallbacks.push(deaths)
    placeAirborne(15)
    damageMount(mount, 200, { source: createPlayerCombatActorRef(player), method: 'projectile', emit: event => events.push(event) })
    expect(npc.dead).toBe(false)
    mount.update(.1, [])
    expect(mount.group.position.y).toBeGreaterThan(0)
    expect(mount.deathTimer).toBe(3)
    advanceUntil(() => !npc.isFalling, () => npc.updateTownPeace(1 / 60, 0, false, false), { maxSimulationSeconds: 5, failureMessage: 'hero NPC 15m landing' })
    expect(npc.hp).toBe(0)
    expect(npc.dead).toBe(true)
    expect(deaths).toHaveBeenCalledTimes(1)
    expect(events.filter(event => event.type === 'actor_killed')).toHaveLength(1)
  })
  it.each(['airborne', 'grounded'] as const)('a %s rider killed first falls after the dead early-return without killing the eagle or notifying twice', phase => {
    const { npc, mount, placeAirborne } = fixture()
    const deaths = vi.fn(); npc.onDeathCallbacks.push(deaths)
    placeAirborne(20)
    if (phase === 'grounded') {
      mount.flight!.phase = 'grounded'; mount.flight!.velocity.set(0, 0, 0)
      mount.group.position.y = 0; npc.updateTownPeace(0, 0, false, false)
    }
    npc.takeDamage(10000)
    expect(npc.dead).toBe(true)
    expect(mount.dead).toBe(false)
    expect(npc.isFalling).toBe(true)
    const before = npc.position.y
    npc.updateTownPeace(.1, 0, false, false)
    expect(npc.position.y).toBeLessThan(before)
    advanceUntil(() => !npc.isFalling, () => npc.updateTownPeace(1 / 60, 0, false, false), { maxSimulationSeconds: 5, failureMessage: 'dead NPC presentation landing' })
    expect(deaths).toHaveBeenCalledTimes(1)
    expect(mount.riderNpc).toBeNull()
  })
  it.each(['recurve_longbow', 'pilum_standard'])('the normal NPC update releases %s from its airborne weapon socket while flight continues', ranged => {
    const { scene, npc, mount, placeAirborne } = fixture(ranged)
    const player = new Player(scene); onTestFinished(() => player.dispose())
    player.group.position.set(0, -player.bodyBaseOffset, 22)
    placeAirborne(8, new THREE.Vector3(0, 0, 48 / 3.6))
    const shots: Array<{ origin: THREE.Vector3; kind: string }> = []
    const before = mount.group.position.clone(), ammo = npc.combatAmmo
    for (let frame = 0; frame < 1800 && !shots.length; frame++) npc.update(1 / 60, player, [npc], [npc], [], { setFill() {} }, () => {},
      (origin, _direction, kind) => shots.push({ origin: origin.clone(), kind }), true)
    expect(shots.length, JSON.stringify({ weapon: ranged, position: npc.position, flight: mount.flight!.snapshot(), action: npc.combatAnimationAction, range: npc.maxRangedAttackDistance, ammo: npc.combatAmmo })).toBeGreaterThan(0)
    expect(shots[0].kind).toBe(ranged === 'pilum_standard' ? 'pilum' : 'arrow')
    expect(shots[0].origin.y).toBeGreaterThan(2)
    expect(mount.group.position.distanceTo(before)).toBeGreaterThan(1)
    expect(npc.combatAmmo).toBe(ammo - 1)
    expect(mount.flight!.speed).toBeGreaterThan(7)
  })
  it('a fast eagle never routes the passive MountImpact path', () => {
    const { scene, npc, mount, placeAirborne } = fixture()
    const player = new Player(scene); onTestFinished(() => player.dispose())
    placeAirborne(2.8, new THREE.Vector3(0, 0, 96 / 3.6))
    mount.previousPosition.set(0, 0, -5); mount.group.position.set(0, 0, 5); mount.movementSpeed = 96 / 3.6
    const hit = vi.fn()
    resolveMountImpacts([mount], player, [npc], 1, { onDamagePlayer: hit })
    expect(hit).not.toHaveBeenCalled()
    expect(player.hp).toBe(player.maxHp)
  })
  it.each(['player', 'npc'] as const)('an unarmed normal AI rider completes a swoop against %s outside a ground boid neighborhood', victimKind => {
    const { scene, npc, mount, placeAirborne } = fixture()
    const player = new Player(scene); onTestFinished(() => player.dispose())
    player.group.position.set(0, -player.bodyBaseOffset, 28)
    const victim = victimKind === 'npc' ? new NPC(scene, 0, 28, Faction.PLAYER, 'roman', AIType.MELEE, 'Ground target', 1, false) : null
    if (victim) { onTestFinished(() => victim.dispose()); player.spectatorOnly = true }
    placeAirborne(8, new THREE.Vector3(0, 0, 48 / 3.6))
    const hits: number[] = []
    for (let frame = 0; frame < 1800 && !hits.length; frame++) {
      npc.update(1 / 60, player, victim ? [npc, victim] : [npc], [], [], { setFill() {} },
        (damage, isPlayer, targetNpc) => { if (victim ? targetNpc === victim : isPlayer) hits.push(damage) }, () => {}, true)
    }
    expect(hits, JSON.stringify({ position: npc.position, flight: mount.flight!.snapshot(), action: npc.combatAnimationAction })).toEqual([60])
    expect(npc.weaponSweep.contact.attackSource).toBe('xongkoro')
    expect(npc.meleeWeaponId).toBeNull()
  })
})
