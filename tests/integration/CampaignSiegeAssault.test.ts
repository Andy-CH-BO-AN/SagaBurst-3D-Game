import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { BattleSpawner } from '../../src/battle/BattleSpawner'
import { createDefenseCampaignWaveConfig, positionDefenseCampaignAttackers } from '../../src/campaign/DefenseCampaignLaunch'
import { MemoryStorage } from '../helpers/memoryStorage'
import { AIType } from '../../src/world/NPC'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { getTerrainHeight, projectileObstacleEntryFraction, resolveObstacleCollision } from '../../src/world/Terrain'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { Faction } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { siegeActorRecord, siegeAssaultFixture } from '../helpers/siegeAssaultFixture'

describe('Unified campaign assault producer wiring', () => {
  it('holds both complete crews until the last ordinary attacker is registered, then advances at infantry walking speed', () => {
    const h = siegeAssaultFixture('roman', false, false)
    for (const spec of h.specs.slice(0, -1)) {
      const actor = siegeActorRecord(spec)
      h.actors.push(actor); h.owner.register(actor, spec)
    }
    h.owner.update(.1)
    for (const ramp of h.owner.ramps) expect(ramp.controller.distance).toBe(0)
    const last = h.specs.at(-1)!
    const actor = siegeActorRecord(last)
    h.actors.push(actor); h.owner.register(actor, last)
    h.owner.update(.1)
    for (const ramp of h.owner.ramps) {
      expect(ramp.controller.currentSpeed).toBe(4.8)
      expect(ramp.controller.distance).toBeCloseTo(.48)
    }
    expect(actor.siegeTransport).toBeNull()
  })

  it('gives an ordinary rear attacker a persistent side route until the moving convoy has been passed', () => {
    const h = siegeAssaultFixture()
    const ramp = h.owner.ramps[0], actor = h.actors[20]
    h.owner.update(.1)
    actor.position.set(ramp.position.x + 1, ramp.surface.startY, ramp.surface.startZ - ramp.placement.dirZ * 6)
    const original = actor.position.clone()
    h.owner.update(.1)
    expect(actor.position).toEqual(original)
    expect(actor.siegeBypassTarget!.x).toBeGreaterThan(ramp.position.x + 6)
    const sideX = actor.siegeBypassTarget!.x
    actor.position.x = sideX
    h.owner.update(.1)
    expect(actor.siegeBypassTarget!.x).toBe(sideX)
    expect((actor.siegeBypassTarget!.z - ramp.position.z) * ramp.placement.dirZ).toBeGreaterThan(5)
    actor.position.z = ramp.position.z + ramp.placement.dirZ * 7
    h.owner.update(.1)
    expect(actor.siegeBypassTarget).toBeNull()
  })

  it('only moving convoys scan collision candidates while docking and terminal states preserve lifecycle effects', () => {
    // Existing typed caller fixture: zero real NPCs/Mounts, no extra scene owner.
    const h = siegeAssaultFixture('roman', false, false)
    const [ramp, abandoned] = h.owner.ramps
    const staticScan = vi.spyOn(h.obstacles, 'some')
    const actorScan = vi.spyOn(h.actors, 'some')
    const blockers: [] = []
    const bodyScan = vi.spyOn(blockers, 'some')
    onTestFinished(() => { staticScan.mockRestore(); actorScan.mockRestore(); bodyScan.mockRestore() })
    const expectNoScan = () => {
      expect(staticScan).not.toHaveBeenCalled()
      expect(actorScan).not.toHaveBeenCalled()
      expect(bodyScan).not.toHaveBeenCalled()
    }
    const clearScans = () => { staticScan.mockClear(); actorScan.mockClear(); bodyScan.mockClear() }
    ramp.update(.1, h.actors, blockers)
    expect(ramp.controller.state).toBe('DEPLOYING')
    expectNoScan()
    for (const spec of h.specs) {
      const actor = siegeActorRecord(spec)
      h.actors.push(actor); h.owner.register(actor, spec)
    }
    ramp.update(.1, h.actors, blockers)
    expect(ramp.controller.distance).toBeGreaterThan(0)
    expect(staticScan).toHaveBeenCalled(); expect(actorScan).toHaveBeenCalled(); expect(bodyScan).toHaveBeenCalled()
    for (let frame = 0; frame < 600 && ramp.controller.state === 'PUSHING'; frame++) ramp.update(.1, h.actors)
    expect(ramp.controller.state, JSON.stringify({distance:ramp.controller.distance, travel:ramp.controller.travelDistance, pos:ramp.position, speed:ramp.controller.currentSpeed})).toBe('DOCKING')
    clearScans()
    const parked = ramp.position.clone()
    for (let frame = 0; frame < 20; frame++) ramp.update(.1, h.actors, blockers)
    expectNoScan()
    expect(ramp.controller.state).toBe('DOCKED')
    expect(ramp.controller.dockingProgress).toBe(1)
    expect(h.owner.entrances.entries.has(ramp.assignment.id)).toBe(true)
    expect(ramp.obstacles.every(obstacle => h.obstacles.includes(obstacle))).toBe(true)
    expect(ramp.position).toEqual(parked)
    for (const id of abandoned.assignment.pusherIds) {
      // Typed caller records expose NPC's readonly death observation, not its damage lifecycle.
      Object.defineProperty(abandoned.crew.get(id)!, 'dead', { value: true, configurable: true })
    }
    abandoned.update(.1, h.actors, blockers)
    expect(abandoned.controller.state).toBe('ABANDONED')
    const hp = abandoned.damageable.currentHp
    for (let frame = 0; frame < 3; frame++) abandoned.update(.1, h.actors, blockers)
    expectNoScan()
    expect(abandoned.damageable.currentHp).toBe(hp)
    expect(abandoned.obstacles.every(obstacle => h.obstacles.includes(obstacle))).toBe(true)
    let destructions = 0
    const off = ramp.damageable.onDestroyed(() => destructions++)
    onTestFinished(off)
    ramp.damageable.destroy()
    const revision = h.owner.entrances.revision
    for (let frame = 0; frame < 3; frame++) ramp.update(.1, h.actors, blockers)
    expectNoScan()
    expect(ramp.controller.state).toBe('DESTROYED')
    expect(destructions).toBe(1)
    expect(h.owner.entrances.revision).toBe(revision)
    expect(h.owner.entrances.entries.has(ramp.assignment.id)).toBe(false)
    expect(ramp.obstacles.some(obstacle => h.obstacles.includes(obstacle))).toBe(false)
    expect(ramp.position).toEqual(parked)
  })

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
    for (let i = 0; i < 600; i++) first.update(.1, h.actors)
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
    for (let i = 0; i < 600; i++) other.update(.1, h.actors)
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

  it('stops for overlapping foot/mounted bodies outside the deck edge, but permits bodies below it and assigned crew', () => {
    const h = siegeAssaultFixture()
    const ramp = h.owner.ramps[0], actor = h.actors[20]
    // One typed actor, reused across body sizes; no real NPC or Mount construction.
    actor.position.set(ramp.position.x + 2.8, ramp.position.y - 1, ramp.position.z - ramp.placement.dirZ * 3)
    ramp.update(.1, h.actors)
    expect(ramp.controller.distance).toBe(0)
    actor.position.x = 0
    const body = { position: new THREE.Vector3(ramp.position.x + 3.2, ramp.position.y - 1,
      ramp.position.z - ramp.placement.dirZ * 3), radius: 1, height: 2.6, bottomOffset: 0 }
    ramp.update(.1, h.actors, [body])
    expect(ramp.controller.distance).toBe(0)
    body.position.set(ramp.position.x, ramp.position.y - 4, ramp.position.z - ramp.placement.dirZ * 3)
    body.height = 1.8
    ramp.update(.1, h.actors, [body])
    expect(ramp.controller.distance).toBeCloseTo(.48)
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


describe('Career convoy checkpoint and faction integration', () => {
  it('mixed initial preparation selects only attacker infantry and waits only for the attacking wave', () => {
    const h = siegeAssaultFixture('roman', false, false, { prepare: false })
    const defender = { ...h.specs[0], actorId: 'defender', characterFaction: 'roman' as const, faction: Faction.PLAYER }
    const original = { ...defender }
    h.owner.prepare([defender, ...h.specs])
    expect(defender).toEqual(original)
    expect(h.owner.ramps.flatMap(ramp => [...ramp.assignment.pusherIds, ...ramp.assignment.assaultIds])).not.toContain('defender')
    // Defender registration cannot unlock or enter any convoy.
    const guard = siegeActorRecord(defender)
    h.actors.push(guard); h.owner.register(guard, defender)
    expect(guard.siegeTransport).toBeNull()
    for (const spec of h.specs.slice(0, -1)) {
      const actor = siegeActorRecord(spec); h.actors.push(actor); h.owner.register(actor, spec)
    }
    h.owner.update(.1)
    expect(h.owner.ramps.every(ramp => ramp.controller.distance === 0)).toBe(true)
    const last = siegeActorRecord(h.specs.at(-1)!)
    h.actors.push(last); h.owner.register(last, h.specs.at(-1)!)
    h.owner.update(.1)
    expect(h.owner.ramps.every(ramp => ramp.controller.distance > 0)).toBe(true)
  })

  it('zero infantry creates no vehicles or crew dependency and still assaults/breaches the gate', () => {
    const h = siegeAssaultFixture('viking', false, false, { prepare: false })
    const spec = { ...h.specs[0], cavalry: true, aiType: AIType.MELEE }
    h.owner.prepare([spec])
    const actor = siegeActorRecord(spec); h.actors.push(actor); h.owner.register(actor, spec)
    h.owner.update(.1)
    expect(h.owner.ramps).toHaveLength(0)
    expect(actor.siegeTransport).toBeNull()
    expect(actor.siegeObstacle).toBe(h.gate.siegeObstacle)
    expect(h.breach.breached).toBe(false)
    h.gate.destroy(); h.owner.update(.1)
    expect(actor.siegeObstacle).toBeNull()
    expect(actor.campaignEntranceId).toBe('gate')
    expect(actor.tacticalOrder).toBe('charge')
    expect(h.breach.breached).toBe(true)
  })

  it('entrance revisions leave an officially commanded attacker formation under player control', () => {
    const h = siegeAssaultFixture('roman', false, false, { prepare: false, acceptsOrders: npc => npc.combatantId !== 'commanded' })
    const spec = { ...h.specs[0], actorId: 'commanded', cavalry: true }
    h.owner.prepare([spec])
    const actor = siegeActorRecord(spec); actor.setTacticalOrder('formation')
    h.actors.push(actor); h.owner.register(actor, spec)
    h.gate.destroy(); h.owner.update(.1)
    expect(actor.tacticalOrder).toBe('formation')
    expect(actor.campaignEntranceId).toBeNull()
  })

  it.each(['PUSHING', 'DOCKED', 'DESTROYED', 'ABANDONED'] as const)('serialized %s convoy retains its carrier, casualties and one-shot breach', state => {
    const profile = acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier', totalMerit: 300 }, 1, 'saved-convoy')!
    const launch = createCareerOutpostLaunch(profile)
    const specs = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers')).npcSpecs
    specs.forEach((spec, i) => { spec.actorId = `saved-convoy:attackers:${i}` })
    positionDefenseCampaignAttackers(specs, 'roman')
    const h = siegeAssaultFixture('roman', false, true, { specs })
    const tower = h.owner.ramps[0]
    if (state === 'PUSHING' || state === 'ABANDONED') for (let i = 0; i < 20; i++) tower.update(.1, h.actors)
    else for (let i = 0; i < 600; i++) tower.update(.1, h.actors)
    if (state === 'DESTROYED') tower.damageable.destroy()
    const deadId = tower.assignment.pusherIds[0]
    for (const id of state === 'ABANDONED' ? tower.assignment.pusherIds : [deadId]) {
      Object.defineProperty(tower.crew.get(id)!, 'dead', { value: true, configurable: true })
    }
    if (state === 'ABANDONED') tower.update(.1, h.actors)
    const departed = tower.crew.get(tower.assignment.assaultIds[0])!
    if (state !== 'PUSHING') { departed.position.set(0, 0, 150); departed.campaignBreachCompleted = true }
    const before = tower.position.clone(), assignment = structuredClone(tower.assignment)
    const actors = Object.fromEntries(h.actors.map(actor => [actor.combatantId, {
      hp: actor.dead ? 0 : 73, x: actor.position.x, y: actor.position.y, z: actor.position.z, yaw: actor.group.rotation.y,
    }]))
    profile.activeOutpostMission!.battle = {
      runtime: { phase: 'assault', activePhase: 'assault', deploymentRemainingSeconds: 0, assaultElapsedSeconds: 20,
        reinforcementRemainingSeconds: 100, reinforcementTriggered: false, battleFinished: false },
      actors, player: { hp: 100, stamina: 100, dead: false, x: 0, z: 150, yaw: 0 },
      playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      wave: null, waveIndex: 0, attackersStarted: true, reinforcementsSpawned: false,
      gate: { hp: 2080, state: 'closed' }, outpostSiege: h.owner.snapshot(),
    }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(profile)).toBe(true)
    const saved = store.load()!.activeOutpostMission!.battle!
    expect(saved.outpostSiege?.ramps[0].assignment).toEqual(assignment)
    const reloadedSpecs = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers')).npcSpecs
    reloadedSpecs.forEach((spec, i) => { spec.actorId = `saved-convoy:attackers:${i}` })
    positionDefenseCampaignAttackers(reloadedSpecs, 'roman')
    const restored = siegeAssaultFixture('roman', false, false, { specs: reloadedSpecs, saved: saved.outpostSiege })
    let breaches = 0
    const off = restored.breach.onBreach(() => breaches++)
    onTestFinished(off)
    for (const spec of reloadedSpecs) {
      const checkpoint = saved.actors[spec.actorId!]
      spec.x = checkpoint.x; spec.z = checkpoint.z; spec.spawnY = checkpoint.y
      const actor = siegeActorRecord(spec)
      Object.defineProperty(actor, 'dead', { value: checkpoint.hp === 0, configurable: true })
      restored.actors.push(actor); restored.owner.register(actor, spec)
    }
    const recovered = restored.owner.ramps[0]
    expect(recovered.position).toEqual(before)
    expect(recovered.controller.state).toBe(state)
    expect(recovered.assignment).toEqual(assignment)
    expect(recovered.controller.alivePushers).toBe(state === 'ABANDONED' ? 0 : 3)
    expect(restored.actors.find(actor => actor.combatantId === deadId)!.dead).toBe(true)
    if (state === 'PUSHING') {
      recovered.update(.1, restored.actors)
      expect(recovered.controller.currentSpeed).toBeCloseTo(3.6)
    } else {
      const passenger = restored.actors.find(actor => actor.combatantId === departed.combatantId)!
      restored.owner.update(.1)
      expect(passenger.position).toEqual(departed.position)
      expect(passenger.siegeTransport).toBeNull()
      expect(passenger.campaignBreachCompleted).toBe(true)
      expect(recovered.position).toEqual(before)
      expect(breaches).toBe(0)
    }
    if (state === 'ABANDONED') {
      const aboard = restored.actors.find(actor => actor.combatantId === recovered.assignment.assaultIds[1])!
      expect(aboard.siegeEvacuation).toEqual(new THREE.Vector3(recovered.surface.startX, recovered.surface.startY,
        recovered.surface.startZ - recovered.surface.dirZ * 2))
      expect(restored.actors.find(actor => actor.combatantId === departed.combatantId)!.siegeEvacuation).toBeNull()
    }
    if (state === 'DESTROYED') {
      expect(recovered.damageable.currentHp).toBe(0)
      expect(recovered.obstacles.some(obstacle => restored.obstacles.includes(obstacle))).toBe(false)
      expect(restored.owner.entrances.entries.has(recovered.assignment.id)).toBe(false)
    }
    if (state === 'DOCKED') expect(restored.owner.entrances.entries.has(recovered.assignment.id)).toBe(true)
  })
})
