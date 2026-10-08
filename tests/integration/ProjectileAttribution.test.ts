import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { createNpcCombatActorRef } from '../../src/combat/CombatAttribution'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Faction } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'

function eventHarness() { return createCombatEventRecorder(onTestFinished) }

function mockNpc(options: {
  id?: string
  hp?: number
  maxHp?: number
  shieldId?: string | null
  faction?: Faction
  characterFaction?: 'viking' | 'roman'
  presetId?: string
  squadId?: number
  position?: THREE.Vector3
} = {}): any {
  let hp = options.hp ?? options.maxHp ?? 200
  const maxHp = options.maxHp ?? hp
  let dead = false
  let mount: any = null

  return {
    combatantId: options.id ?? 'npc-target',
    name: options.id ?? 'NPC Target',
    faction: options.faction ?? Faction.ENEMY,
    characterFaction: options.characterFaction ?? 'roman',
    presetId: options.presetId ?? 'roman_heavy_infantry',
    squadId: options.squadId,
    shieldId: options.shieldId ?? null,
    maxHp,
    combatPosition: options.position ?? new THREE.Vector3(0.5, 0, 0),
    group: { position: options.position ?? new THREE.Vector3(0.5, 0, 0) },
    get hp() { return hp },
    get hpRatio() { return maxHp > 0 ? hp / maxHp : 0 },
    get dead() { return dead },
    get isMounted() { return mount !== null && !mount.dead },
    get mount() { return mount },
    set mount(value) { mount = value },
    takeDamage(amount: number) {
      if (dead) return false
      hp = Math.max(0, hp - amount)
      if (hp <= 0) dead = true
      return true
    },
    dismountFromMount: vi.fn(() => { mount = null }),
  }
}

describe('Projectile attribution wiring', () => {
  it('stores a concrete shooter snapshot on a projectile', () => {
    const shooter = mockNpc({
      id: 'archer-3',
      faction: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_archer',
      squadId: 3,
    })
    const source = createNpcCombatActorRef(shooter)
    const arrow = new ArrowProjectile(
      new THREE.Scene(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      35,
      25,
      Faction.PLAYER,
      false,
      'arrow',
      { source, weaponId: 'recurve_longbow' },
    )

    shooter.squadId = 8
    expect(arrow.attribution).toMatchObject({
      source: {
        actorId: 'archer-3',
        squadId: 3,
        presetId: 'viking_archer',
      },
      weaponId: 'recurve_longbow',
    })
  })

  it('uses the retained projectile source when a delayed projectile hits', () => {
    const { events, stream } = eventHarness()
    const shooter = mockNpc({
      id: 'archer-delayed',
      faction: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_archer',
      squadId: 4,
    })
    const targetGroundY = getTerrainHeight(0, 0.3)
    const target = mockNpc({
      id: 'roman-delayed-target',
      faction: Faction.ENEMY,
      characterFaction: 'roman',
      presetId: 'roman_heavy_infantry',
      hp: 50,
      maxHp: 50,
      position: new THREE.Vector3(0, targetGroundY, 0.3),
    })
    const arrow = new ArrowProjectile(
      new THREE.Scene(),
      new THREE.Vector3(0, targetGroundY + 1, 0),
      new THREE.Vector3(0, 0, 1),
      35,
      25,
      Faction.PLAYER,
      false,
      'arrow',
      {
        source: createNpcCombatActorRef(shooter),
        weaponId: 'recurve_longbow',
        emit: stream.emit,
      },
    )

    arrow.update(
      0.01,
      {
        targetable: false,
        characterFaction: 'viking',
        combatPosition: new THREE.Vector3(50, 0, 50),
      } as any,
      [target],
      [],
      () => {},
      () => {
        throw new Error('player should not be hit')
      },
    )

    expect(events.find(event => event.type === 'damage_applied')).toMatchObject({
      source: {
        actorId: 'archer-delayed',
        squadId: 4,
      },
      target: { targetId: 'roman-delayed-target' },
      method: 'projectile',
      weaponId: 'recurve_longbow',
      appliedDamage: 25,
    })
  })
})
