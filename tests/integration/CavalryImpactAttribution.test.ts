import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'

import { resolveMountImpacts } from '../../src/combat/MountImpact'
import { Faction } from '../../src/world/NPC'
import { MountState } from '../../src/world/Mount'

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

describe('Cavalry impact attribution wiring', () => {
  it('attributes NPC mount impact damage to the mounted rider and squad', () => {
    const { events, stream } = eventHarness()
    const rider = mockNpc({
      id: 'rider-7',
      faction: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_lancer',
      squadId: 7,
    })
    const target = mockNpc({
      id: 'roman-target',
      faction: Faction.ENEMY,
      characterFaction: 'roman',
      presetId: 'roman_heavy_infantry',
      hp: 200,
      maxHp: 200,
      position: new THREE.Vector3(0.5, 0, 0),
    })
    const mount: any = {
      state: MountState.CONTROLLED,
      dead: false,
      skipImpactThisFrame: false,
      movementSpeed: 12,
      isSprinting: false,
      previousPosition: new THREE.Vector3(0, 0, 0),
      group: { position: new THREE.Vector3(1, 0, 0) },
      riderFaction: Faction.PLAYER,
      riderNpc: rider,
      canImpact: () => true,
    }

    resolveMountImpacts(
      [mount],
      {
        currentMount: null,
        targetable: false,
        position: new THREE.Vector3(50, 0, 50),
        characterFaction: 'viking',
      } as any,
      [target],
      1,
      {
        combatEvents: stream.emit,
        onDamagePlayer: () => {
          throw new Error('player should not be hit')
        },
      },
    )

    const damage = events.find(event => event.type === 'damage_applied')
    expect(damage).toMatchObject({
      source: {
        actorId: 'rider-7',
        squadId: 7,
        presetId: 'viking_lancer',
      },
      target: { targetId: 'roman-target' },
      method: 'mount-impact',
    })
  })
})
