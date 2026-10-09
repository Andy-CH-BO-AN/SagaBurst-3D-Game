import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { CombatEventStream, type CombatDamageContext, type CombatEventSink } from '../../src/combat/CombatAttribution'
import { damageNpc, damageObstacle, damagePlayer } from '../../src/combat/DamageRouter'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'

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

function mockPlayer(hp = 200): any {
  let currentHp = hp
  let dead = false
  return {
    characterFaction: 'viking',
    spectatorOnly: false,
    isMounted: false,
    currentMount: null,
    targetable: true,
    position: new THREE.Vector3(),
    get hp() { return currentHp },
    get hpRatio() { return currentHp / hp },
    get dead() { return dead },
    takeDamage(amount: number) {
      if (dead) return false
      currentHp = Math.max(0, currentHp - amount)
      if (currentHp <= 0) dead = true
      return true
    },
    dismountFromMount: vi.fn(),
  }
}

function sourceContext(
  stream: CombatEventStream,
  overrides: Partial<CombatDamageContext> = {},
): CombatDamageContext {
  return {
    source: {
      actorId: 'attacker',
      actorType: 'npc',
      allegiance: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_archer',
      squadId: 3,
    },
    method: 'melee',
    emit: stream.emit,
    ...overrides,
  }
}

describe('Combat attribution foundation', () => {
  it('routes nested NPC event scopes once and restores the original sink after ordered or repeated releases', () => {
    // One real foot NPC, no Mount, Player constructor, TownWorld or GLB; actual melee observes routing.
    const original = vi.fn<CombatEventSink>(), first = vi.fn<CombatEventSink>(), second = vi.fn<CombatEventSink>()
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 80, Faction.PLAYER, 'viking', AIType.MELEE, 'Scoped attacker', 1, false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null }, undefined, undefined, 'scoped-attacker', original)
    let disposed = false
    onTestFinished(() => { if (!disposed) npc.dispose() })
    npc.group.position.y = getTerrainHeight(0, 80)
    const gate = new DamageableObstacle({ kind: 'gate', maxHp: 5000, root: new THREE.Object3D(), ownerFaction: 'roman' })
    const obstacle: ObstacleData = { isBarricade: false, damageable: gate,
      box: new THREE.Box3(new THREE.Vector3(-1, -100, 80.5), new THREE.Vector3(1, 100, 81.5)) }
    const player = { targetable: false, dead: false, isMounted: false } as unknown as Player
    npc.setTacticalOrder('attack'); npc.assignSiegeObstacle(obstacle)
    const hit = (expected: ReturnType<typeof vi.fn<CombatEventSink>>) => {
      const beforeHp = gate.currentHp, before = [original.mock.calls.length, first.mock.calls.length, second.mock.calls.length]
      for (let frame = 0; frame < 80 && gate.currentHp === beforeHp; frame++) {
        npc.update(.05, player, [npc], [], [obstacle], { setFill() {} }, vi.fn(), vi.fn(), true)
      }
      expect(gate.currentHp, 'scoped attacker must hit the structure within 4 simulated seconds').toBeLessThan(beforeHp)
      expect([original, first, second].map((sink, index) => sink.mock.calls.length - before[index])).toEqual(
        [original, first, second].map(sink => sink === expected ? 1 : 0))
      expect(expected).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'structure_damaged', source: expect.objectContaining({ actorId: 'scoped-attacker' }) }))
    }
    hit(original)
    const releaseFirst = npc.bindCombatEventSink(first)
    hit(first)
    const releaseSecond = npc.bindCombatEventSink(second)
    hit(second)
    releaseFirst(); releaseFirst()
    hit(second)
    releaseSecond(); releaseSecond()
    hit(original)
    const releaseOuter = npc.bindCombatEventSink(first), releaseInner = npc.bindCombatEventSink(second)
    hit(second)
    releaseInner()
    hit(first)
    releaseOuter()
    hit(original)
    const releaseAtDisposal = npc.bindCombatEventSink(first)
    npc.dispose(); disposed = true
    expect(() => { releaseAtDisposal(); releaseAtDisposal() }).not.toThrow()
    expect(() => npc.bindCombatEventSink(second)).toThrow('Cannot bind combat events to a disposed NPC')
  })

  it('counts actual HP loss instead of requested overkill and emits one kill', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ hp: 3, maxHp: 200 })
    const context = sourceContext(stream)

    const result = damageNpc(npc, 80, context)

    expect(result.requestedDamage).toBe(80)
    expect(result.appliedDamage).toBe(3)
    expect(result.killed).toBe(true)
    expect(result.targetId).toBe('npc-target')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      requestedDamage: 80,
      appliedDamage: 3,
      target: { targetId: 'npc-target' },
    })
    expect(events[1]).toMatchObject({
      type: 'actor_killed',
      source: { actorId: 'attacker', squadId: 3 },
      target: { targetId: 'npc-target' },
    })

    const eventCount = events.length
    const second = damageNpc(npc, 80, context)
    expect(second.hitSuccess).toBe(false)
    expect(second.appliedDamage).toBe(0)
    expect(second.killed).toBe(false)
    expect(events).toHaveLength(eventCount)
  })

  it('does not reduce body damage just because a shield is equipped', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ hp: 200, maxHp: 200, shieldId: 'round_shield_t1' })

    const result = damageNpc(npc, 100, sourceContext(stream))

    expect(result.requestedDamage).toBe(100)
    expect(result.appliedDamage).toBe(100)
    expect(result.killed).toBe(false)
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      requestedDamage: 100,
      appliedDamage: 100,
    })
  })

  it('attributes player death with actual damage and never double-counts it', () => {
    const { events, stream } = eventHarness()
    const player = mockPlayer(5)
    const hpBar = { setFill: vi.fn() } as any

    const result = damagePlayer(player, 25, hpBar, null, sourceContext(stream))

    expect(result.appliedDamage).toBe(5)
    expect(result.killed).toBe(true)
    expect(events.map(event => event.type)).toEqual(['damage_applied', 'actor_killed'])
    expect(events[1]).toMatchObject({ target: { targetId: 'player', targetType: 'player' } })

    damagePlayer(player, 25, hpBar, null, sourceContext(stream))
    expect(events).toHaveLength(2)
  })

  it('attributes mount damage to the rider target without turning mount death into an actor kill', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ id: 'mounted-target', hp: 200 })
    const mount = {
      currentHp: 5,
      maxHp: 100,
      dead: false,
      displayName: '戰馬', mountDisplayName: '戰馬坐騎',
      group: new THREE.Group(),
      takeDamage(amount: number) {
        if (this.dead) return false
        this.currentHp = Math.max(0, this.currentHp - amount)
        if (this.currentHp <= 0) this.dead = true
        return true
      },
    }
    npc.mount = mount

    const result = damageNpc(npc, 50, sourceContext(stream, { contact: { kind: 'mount', time: .1 } }))

    expect(result.isMountHit).toBe(true)
    expect(result.appliedDamage).toBe(5)
    expect(result.killed).toBe(true)
    expect(result.mountDied).toBe(true)
    expect(npc.dismountFromMount).toHaveBeenCalledOnce()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      target: {
        targetType: 'mount',
        ownerActorId: 'mounted-target',
      },
      appliedDamage: 5,
    })
  })

  it('emits structure damage and destruction exactly once using applied damage', () => {
    const { events, stream } = eventHarness()
    const gate = new DamageableObstacle({
      kind: 'gate',
      maxHp: 5,
      root: new THREE.Object3D(),
      ownerFaction: 'roman',
    })
    const context = sourceContext(stream, { method: 'siege' })

    const first = damageObstacle(gate, 50, context)

    expect(first.appliedDamage).toBe(5)
    expect(first.destroyed).toBe(true)
    expect(events.map(event => event.type)).toEqual([
      'structure_damaged',
      'structure_destroyed',
    ])
    expect(events[0]).toMatchObject({
      requestedDamage: 50,
      appliedDamage: 5,
      target: { structureKind: 'gate' },
    })

    damageObstacle(gate, 50, context)
    expect(events).toHaveLength(2)
  })
})
