import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { Player } from '../../src/player/Player'
import { Mount, MountType } from '../../src/world/Mount'
import { TrainingDummy } from '../../src/training/TrainingDummy'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { resolveMountImpacts } from '../../src/combat/MountImpact'
import { damageReceiver } from '../../src/combat/DamageRouter'
import { WeaponSweep } from '../../src/combat/ShieldBlocking'
import { createPlayerCombatActorRef } from '../../src/combat/CombatAttribution'
import { resolveSkillProgressionAward } from '../../src/rpg/CombatSkillProgression'
import { Faction } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'
import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { advanceUntil } from '../helpers/simulation'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual },
}))

function fixture() {
  const scene = new THREE.Scene(), player = new Player(scene)
  onTestFinished(() => player.dispose())
  const dummy = new TrainingDummy(scene, { x: 100, z: 40, distance: 0 })
  onTestFinished(() => dummy.dispose())
  return { scene, player, dummy, ...createCombatEventRecorder(onTestFinished) }
}

describe('Formal combat contacts to training receivers', () => {
  it.each(['arrow', 'pilum'] as const)('%s from an elevated origin hits the dummy via the normal ballistic projectile and actual damage event', kind => {
    const h = fixture(), ground = getTerrainHeight(100, 40)
    const origin = new THREE.Vector3(100, ground + 6, 44)
    const arrow = new ArrowProjectile(h.scene, origin, new THREE.Vector3(0, -5, -4), 40, 37.5, Faction.PLAYER, true, kind,
      { source: createPlayerCombatActorRef(h.player), weaponId: kind === 'arrow' ? 'elven_runebow' : 'legionary_pilum', emit: h.stream.emit })
    onTestFinished(() => arrow.destroy())
    const onHit = vi.fn()
    advanceUntil(() => !arrow.isAlive, () => arrow.update(1 / 60, h.player, [], [], onHit, () => { throw new Error('No enemy projectile') }, undefined, false, [], [h.dummy]), { maxFrames: 60, failureMessage: 'elevated training projectile' })
    expect(onHit).toHaveBeenCalledWith(37.5, expect.any(THREE.Vector3), '0m Dummy · 假人', 1, false, undefined, false)
    expect(h.events).toEqual([expect.objectContaining({ type: 'damage_applied', appliedDamage: 37.5, method: 'projectile', contactKind: 'body', target: h.dummy.damageTarget })])
    expect(resolveSkillProgressionAward(h.events[0])).toBeNull()
  })

  it('an obstacle before the receiver wins first contact and prevents damage', () => {
    const h = fixture(), y = h.dummy.group.position.y
    const arrow = new ArrowProjectile(h.scene, new THREE.Vector3(100, y + 1, 42), new THREE.Vector3(0, 0, -1), 100, 75, Faction.PLAYER, true, 'arrow', { source: createPlayerCombatActorRef(h.player), emit: h.stream.emit })
    onTestFinished(() => arrow.destroy())
    arrow.update(.03, h.player, [], [{ box: new THREE.Box3(new THREE.Vector3(99, y, 41), new THREE.Vector3(101, y + 3, 41.2)), isBarricade: true }], () => {}, () => { throw new Error('No player damage') }, undefined, false, [], [h.dummy])
    expect(arrow.isStuck).toBe(true)
    expect(h.events).toHaveLength(0)
  })

  it('the same weapon sweep contacts a static dummy without an NPC collision adapter', () => {
    const h = fixture(), p = h.dummy.group.position
    const sweep = new WeaponSweep()
    sweep.capture(new THREE.Vector3(p.x, p.y + 1, p.z + 1), new THREE.Vector3(p.x, p.y + 1, p.z - 1))
    const contact = sweep.traceFirst([h.dummy])!
    expect(contact).toMatchObject({ kind: 'body', target: h.dummy })
    const result = damageReceiver(h.dummy, 25, { source: createPlayerCombatActorRef(h.player), method: 'melee', weaponId: 'steel_sword', contact, emit: h.stream.emit })
    expect(result.appliedDamage).toBe(25)
    expect(h.events[0]).toMatchObject({ method: 'melee', contactKind: 'body', target: { targetType: 'training' } })
  })

  it('the formal player mount impact route includes receivers, preserves its speed formula and per-target cooldown', () => {
    const h = fixture(), p = h.dummy.group.position
    const mount = new Mount(h.scene, MountType.HORSE, p.x, p.z + 2)
    onTestFinished(() => mount.dispose())
    h.player.mountVehicle(mount)
    mount.previousPosition.copy(p).z += 2
    mount.group.position.copy(p).z -= 1
    mount.movementSpeed = 12; mount.isSprinting = true
    const options = { receivers: [h.dummy], combatEvents: h.stream.emit, onDamagePlayer: () => { throw new Error('No NPCs') } }
    resolveMountImpacts([mount], h.player, [], 1, options)
    // Official balance: round(8 + 12 * 1.5 * 1.5) = 35.
    expect(h.events[0]).toMatchObject({ method: 'mount-impact', appliedDamage: 35, target: { targetType: 'training' } })
    resolveMountImpacts([mount], h.player, [], 1, options)
    expect(h.events).toHaveLength(1)
  })
})
