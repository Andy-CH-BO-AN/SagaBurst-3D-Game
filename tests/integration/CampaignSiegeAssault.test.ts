import { describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { getTerrainHeight, projectileObstacleEntryFraction, resolveObstacleCollision } from '../../src/world/Terrain'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Faction } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { siegeAssaultFixture } from '../helpers/siegeAssaultFixture'

describe('Unified campaign assault producer wiring', () => {
  it.each(['gate', 'palisade'] as const)('%s breach preserves both ten-person convoy assignments and ranged loadout intent', type => {
    const h = siegeAssaultFixture('roman', true)
    const ranged = h.actors[20]
    if (type === 'gate') h.gate.destroy()
    else h.palisade.destroy()
    h.breach.trigger(); h.owner.update(.1)
    expect(h.owner.entrances.hasWalkable).toBe(true)
    expect(ranged.tacticalOrder).toBe('attack')
    expect(ranged.campaignEntranceId).toBe(type === 'gate' ? 'gate' : 'front-palisade-test')
    for (const ramp of h.owner.ramps) {
      expect(ramp.controller.state).toBe('PUSHING')
      expect(ramp.controller.distance).toBeGreaterThan(0)
      for (const actor of ramp.crew.values()) expect(actor.siegeTransport).toBe(ramp.assignment.id)
    }
  })

  it.each([-1, 1] as const)('side %i docks first, leaves the other convoy pushing and never changes closed gate HP/state', side => {
    const h = siegeAssaultFixture()
    const first = h.owner.ramps.find(r => r.assignment.side === side)!
    const other = h.owner.ramps.find(r => r !== first)!
    // Drive the real vehicle only; typed actors here record caller state and carrier transforms.
    for (let i = 0; i < 260; i++) first.update(.1, h.actors)
    expect(first.controller.state).toBe('DOCKED')
    h.owner.update(.1)
    expect(h.gate.state).toBe('closed'); expect(h.gate.damageable.currentHp).toBe(2080)
    expect(h.breach.breached).toBe(true)
    expect(h.owner.entrances.entries.has('gate')).toBe(false)
    const gateCenter = h.gate.siegeObstacle.box.getCenter(new THREE.Vector3())
    gateCenter.y = getTerrainHeight(gateCenter.x, gateCenter.z)
    const previous = gateCenter.clone().add(new THREE.Vector3(0, 0, -h.walkways.layout.zSign * 1.1))
    const attempted = previous.clone().add(new THREE.Vector3(0, 0, h.walkways.layout.zSign * .6))
    resolveObstacleCollision(attempted, previous, 0, true, .5, 1.8, 0, h.obstacles, { walkSurfaces: true })
    expect((attempted.z - gateCenter.z) * h.walkways.layout.zSign).toBeLessThan(-.85)
    expect(h.owner.entrances.entries.has(first.assignment.id)).toBe(true)
    expect(h.actors[20].campaignEntranceId).toBe(first.assignment.id)
    expect(other.controller.state).toBe('PUSHING')
    for (const npc of other.crew.values()) {
      expect(npc.siegeTransport).toBe(other.assignment.id)
      expect(npc.tacticalOrder).toBe('attack')
    }
    for (const npc of first.crew.values()) {
      expect(npc.siegeTransport).toBeNull(); expect(npc.tacticalOrder).toBe('charge')
    }
    const chosen = h.actors[20].campaignEntranceId
    for (let i = 0; i < 260; i++) other.update(.1, h.actors)
    h.owner.update(.1)
    expect(h.owner.entrances.entries.size).toBe(2)
    expect(h.actors[20].campaignEntranceId).toBe(chosen)
    first.damageable.destroy(); h.owner.update(.1)
    expect(h.owner.entrances.entries.has(first.assignment.id)).toBe(false)
    expect(h.actors[20].campaignEntranceId).toBe(other.assignment.id)
    other.damageable.destroy(); h.owner.update(.1)
    expect(h.owner.entrances.hasWalkable).toBe(false)
    expect(h.breach.breached).toBe(true)
    expect(h.actors[20].siegeObstacle).toBe(h.gate.siegeObstacle)
  })

  it('moves collider hits with the carrier, loses support without teleporting and cleans owned resources', () => {
    const h = siegeAssaultFixture()
    const ramp = h.owner.ramps[0]
    const npc = h.actors.find(actor => ramp.assignment.assaultIds.includes(actor.combatantId))!
    const original = npc.position.clone()
    const relative = original.clone().sub(ramp.position)
    for (let i = 0; i < 30; i++) h.owner.update(.1)
    expect(npc.position.clone().sub(ramp.position).distanceTo(relative)).toBeLessThan(1e-8)
    expect(npc.position.distanceTo(original)).toBeGreaterThan(5)
    const top = ramp.position.y
    const start = new THREE.Vector3(ramp.position.x, top + 2, ramp.position.z - ramp.placement.dirZ * 2)
    const end = start.clone().setY(top - 2)
    expect(ramp.obstacles.some(obstacle => projectileObstacleEntryFraction(obstacle, start, end) !== null)).toBe(true)
    // Actual projectile producer and damage consumer, with no targetable actor graph.
    const player = { targetable: false, currentMount: null, characterFaction: 'roman' } as Player
    for (const visual of ['arrow', 'pilum'] as const) {
      const projectile = new ArrowProjectile(h.scene, start, new THREE.Vector3(0, -1, 0), 40, 25, Faction.PLAYER, true, visual)
      onTestFinished(() => projectile.destroy())
      projectile.update(.1, player, [], h.obstacles, () => {}, () => { throw new Error('unexpected actor hit') })
      expect(projectile.isStuck).toBe(true)
    }
    expect(ramp.damageable.currentHp).toBe(470)
    const beforeDestroy = npc.position.clone()
    ramp.damageable.takeDamage(520)
    expect(ramp.controller.state).toBe('DESTROYED')
    expect(npc.position.equals(beforeDestroy)).toBe(true)
    expect(npc.pendingFall.active).toBe(true)
    expect(ramp.obstacles.some(obstacle => h.obstacles.includes(obstacle))).toBe(false)
    h.owner.update(.1)
    expect(npc.siegeObstacle).toBe(h.gate.siegeObstacle)
    h.owner.dispose()
    expect(h.owner.ramps).toHaveLength(0)
    expect(h.owner.entrances.entries.size).toBe(0)
    expect(h.actors.every(actor => actor.siegeTransport === null)).toBe(true)
  })
})
