import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { damageMount, damagePlayer } from '../../src/combat/DamageRouter'
import { createPlayerCombatActorRef, createNpcCombatActorRef, type CombatEvent } from '../../src/combat/CombatAttribution'
import { advanceUntil } from '../helpers/simulation'
import { resolveMountImpacts } from '../../src/combat/MountImpact'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import type { ProjectileFlightBudget } from '../../src/combat/ProjectileBallistics'
import { siegeRoster } from '../../src/career/TownSiege'

vi.mock('../../src/world/HorseAssetRegistry', async original => ({
  ...(await original<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual },
}))

vi.mock('../../src/world/XongkoroVisual', async () => ({
  XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble,
}))
vi.mock('../../src/world/MakiRangerEquipment', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/MakiRangerEquipment')>()),
  createMakiRangerBowInstance: () => ({
    model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
    profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1,
      gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1),
      longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) },
  }),
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
  it.each([
    { faction: 'viking', mounted: false, altitude: 40, range: 50 },
    { faction: 'roman', mounted: true, altitude: 20, range: 30 },
  ] as const)('a marching $faction bow mounted=$mounted can hit an eagle at $altitude m AGL and resumes its route when the threat leaves', ({ faction, mounted, altitude, range }) => {
    // Two real NPCs, one eagle and (only for the mounted branch) one horse.
    // This owns actual airborne-target acquisition, bow release and projectile contact;
    // siege roster counts and command transitions are covered by their cheaper callers.
    const { scene, npc: target, mount: eagle, placeAirborne } = fixture()
    const player = new Player(scene); onTestFinished(() => player.dispose())
    player.spectatorOnly = true
    const spec = siegeRoster(faction, true).find(({ spec }) => spec.tier === 3
      && spec.presetId === `${faction}_${mounted ? 'horse_archer' : 'archer'}`)!.spec
    const shooter = new NPC(scene, 0, -12, spec.faction, spec.characterFaction, spec.aiType,
      spec.name, spec.tier, spec.cavalry, spec.loadout, spec.presetId)
    onTestFinished(() => shooter.dispose())
    if (mounted) {
      const horse = new Mount(scene, MountType.HORSE, 0, -12)
      onTestFinished(() => horse.dispose())
      shooter.mountVehicle(horse)
    }
    expect(shooter.maxRangedAttackDistance).toBe(range)
    expect(shooter.rangedProjectileSpeed).toBe(65)
    placeAirborne(altitude + 2.8)
    expect(eagle.group.position.y).toBeCloseTo(altitude)
    const hostiles = new SpatialGrid<NPC>(16); hostiles.insert(target)
    const arrows: ArrowProjectile[] = [], firedAt: number[] = []
    let contacts = 0
    const tick = () => {
      hostiles.clear(); hostiles.insert(target)
      shooter.update(1 / 60, player, [target], [], [], { setFill() {} }, () => {}, (origin, direction, kind) => {
        firedAt.push(shooter.combatPosition.distanceTo(target.combatPosition))
        expect(kind).toBe('arrow')
        expect(direction.y).toBeGreaterThan(0)
        const arrow = new ArrowProjectile(scene, origin, direction, shooter.rangedProjectileSpeed,
          shooter.rangedDamage, shooter.faction, false, kind, { source: createNpcCombatActorRef(shooter) })
        onTestFinished(() => arrow.destroy())
        arrows.push(arrow)
      }, true, 0, null, hostiles)
      for (const arrow of arrows) arrow.update(1 / 60, player, [target], [], () => { contacts++ },
        () => { throw new Error('spectator must not be hit') }, undefined, false, [eagle])
    }
    shooter.missionMovement = true
    shooter.assignFormationTarget(1, shooter.combatPosition.clone(), new THREE.Vector3(0, 0, 1))
    // Other missions retain their 20m ground-contact interruption policy.
    for (let frame = 0; frame < 120; frame++) tick()
    expect(firedAt).toHaveLength(0)
    shooter.missionAerialDefense = true
    // Even opted-in siege archers keep the 20m interruption limit on grounded targets.
    eagle.group.position.set(0, 0, mounted ? 12 : 20)
    eagle.flight!.phase = 'grounded'
    target.updateTownPeace(0, 0, false, false)
    for (let frame = 0; frame < 120; frame++) tick()
    expect(firedAt).toHaveLength(0)
    eagle.group.position.z = 0
    placeAirborne(altitude + 2.8)
    const destination = new THREE.Vector3(0, 0, 80)
    shooter.assignFormationTarget(2, destination, new THREE.Vector3(0, 0, 1))
    const stopped = shooter.combatPosition.clone(), initialHp = target.hp, initialMountHp = eagle.currentHp
    advanceUntil(() => contacts > 0, tick, { maxSimulationSeconds: 4, failureMessage: 'Siege march anti-air projectile contact' })
    expect(firedAt.length).toBeGreaterThan(0)
    expect(firedAt.every(distance => distance > 20 && distance <= range)).toBe(true)
    expect(target.hp < initialHp || eagle.currentHp < initialMountHp).toBe(true)
    expect(shooter.combatPosition.distanceTo(stopped)).toBeLessThan(.01)
    expect(shooter.tacticalOrder).toBe('formation')
    expect(shooter.missionMovement).toBe(true)
    const shotsBeforeExit = firedAt.length
    placeAirborne(mounted ? 42.8 : 70)
    for (let frame = 0; frame < 60; frame++) tick()
    expect(firedAt).toHaveLength(shotsBeforeExit)
    expect(shooter.combatPosition.z).toBeGreaterThan(stopped.z + 1)
    placeAirborne(altitude + 2.8)
    advanceUntil(() => firedAt.length > shotsBeforeExit, tick, { maxSimulationSeconds: 4, failureMessage: 'Re-entered airborne threat' })
    target.takeDamage(10000)
    const resumed = shooter.combatPosition.clone(), shotsBeforeDeath = firedAt.length
    for (let frame = 0; frame < 60; frame++) tick()
    expect(firedAt).toHaveLength(shotsBeforeDeath)
    expect(shooter.combatPosition.z).toBeGreaterThan(resumed.z + 1)
    expect(shooter.tacticalOrder).toBe('formation')
  })

  it('damageMount detaches at the latest sampled feet position, survives 14m and does not clear pending fall on repeated cleanup', () => {
    const { npc, mount, placeAirborne } = fixture()
    placeAirborne(12)
    // The mount's pose can change after the last actor sync, before a projectile.
    mount.eagleVisual!.standingSocket.position.y += 2
    const start = mount.getRiderStandingSeatWorld(new THREE.Vector3())
    expect(npc.group.position.y).toBeCloseTo(12)
    expect(start.y).toBeCloseTo(14)
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
  it.each([['recurve_longbow', 22], ['pilum_standard', 22], ['elven_runebow', 390], ['maki-ranger-bow-ranged', 490]] as const)('the normal NPC update releases %s against a %dm target from its airborne weapon socket while flight continues', (ranged, distance) => {
    const { scene, npc, mount, placeAirborne } = fixture(ranged)
    const player = new Player(scene); onTestFinished(() => player.dispose())
    const startZ = distance > 300 ? -250 : 0
    mount.group.position.z = startZ
    player.group.position.set(0, -player.bodyBaseOffset, startZ + distance)
    placeAirborne(distance > 300 ? 30 : 8, new THREE.Vector3(0, 0, 48 / 3.6))
    const shots: Array<{ origin: THREE.Vector3; kind: string; budget?: ProjectileFlightBudget }> = []
    const before = mount.group.position.clone(), ammo = npc.combatAmmo
    for (let frame = 0; frame < 1800 && !shots.length; frame++) npc.update(1 / 60, player, [npc], [npc], [], { setFill() {} }, () => {},
      (origin, _direction, kind, budget) => shots.push({ origin: origin.clone(), kind, budget }), true)
    expect(shots.length, JSON.stringify({ weapon: ranged, position: npc.position, flight: mount.flight!.snapshot(), action: npc.combatAnimationAction, range: npc.maxRangedAttackDistance, ammo: npc.combatAmmo })).toBeGreaterThan(0)
    expect(shots[0].kind).toBe(ranged === 'pilum_standard' ? 'pilum' : 'arrow')
    expect(shots[0].origin.y).toBeGreaterThan(2)
    if (distance > 300) {
      expect(shots[0].origin.distanceTo(player.group.position)).toBeGreaterThan(300)
      expect(shots[0].budget?.maxLifetimeSeconds).toBeGreaterThan(5)
    }
    expect(mount.group.position.distanceTo(before)).toBeGreaterThan(1)
    expect(npc.combatAmmo).toBe(ammo - 1)
    expect(mount.flight!.speed).toBeGreaterThan(7)
  })
  it('RANGED_AIR independently leads a moving eagle with gravity and releases a non-tracking arrow', () => {
    // Two real mounts, one NPC and Player; render-only doubles retain actual flight and launch behavior.
    const { scene, npc, mount, placeAirborne } = fixture('elven_runebow')
    const player = new Player(scene); onTestFinished(() => player.dispose())
    const targetMount = new Mount(scene, MountType.XONGKORO, 0, 220, Math.PI / 2)
    onTestFinished(() => targetMount.dispose())
    player.mountVehicle(targetMount)
    targetMount.group.position.y = 30
    targetMount.flight!.restore({ phase: 'cruise', yaw: Math.PI / 2, pitch: 0, bank: 0, speed: 48 / 3.6, velocity: { x: 48 / 3.6, y: 0, z: 0 } })
    placeAirborne(32.8, new THREE.Vector3(0, 0, 48 / 3.6))
    let shot: { origin: THREE.Vector3; direction: THREE.Vector3; target: THREE.Vector3; velocity: THREE.Vector3; yaw: number } | undefined
    for (let frame = 0; frame < 600 && !shot; frame++) {
      targetMount.beginControlledFrame()
      targetMount.setFlightIntent({ yaw: Math.PI / 2, pitch: 0 })
      targetMount.finishControlledFrame(1 / 60, [])
      player.syncMountTransform()
      npc.update(1 / 60, player, [npc], [], [], { setFill() {} }, () => {}, (origin, direction) => {
        shot = { origin: origin.clone(), direction: direction.clone(), target: player.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
          velocity: targetMount.flight!.velocity.clone(), yaw: mount.flight!.yaw }
      }, true)
    }
    expect(shot).toBeDefined()
    const released = shot!
    expect(npc.eagleTactic).toBe('RANGED_AIR')
    const flightTime = (released.target.z - released.origin.z) / (released.direction.z * npc.rangedProjectileSpeed - released.velocity.z)
    const impact = released.origin.clone().addScaledVector(released.direction, npc.rangedProjectileSpeed * flightTime)
    impact.y -= 4.9 * flightTime ** 2
    expect(impact.distanceTo(released.target.clone().addScaledVector(released.velocity, flightTime))).toBeLessThan(1e-5)
    const shotYaw = Math.atan2(released.direction.x, released.direction.z)
    expect(Math.abs(shotYaw - released.yaw)).toBeGreaterThan(.01)
    expect(impact.x).toBeGreaterThan(released.target.x + 10)
    expect(mount.flight!.speed).toBeGreaterThan(7)
    const arrow = new ArrowProjectile(scene, released.origin, released.direction, npc.rangedProjectileSpeed, 20, Faction.ENEMY)
    onTestFinished(() => arrow.destroy())
    targetMount.setFlightIntent({ yaw: -Math.PI / 2, pitch: .4 })
    arrow.update(.1, player, [], [], () => {}, () => { throw new Error('no immediate target contact') }, undefined, true)
    expect(arrow.mesh.position.x).toBeCloseTo(released.origin.x + released.direction.x * 65 * .1)
    expect(arrow.mesh.position.z).toBeCloseTo(released.origin.z + released.direction.z * 65 * .1)
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

import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { SpatialGrid } from '../../src/world/SpatialGrid'

describe('NPC aerial orders and indexed physical neighbors', () => {
  it.each(['ground', 'air'] as const)('follows a %s leader at terrain cruise or the same airborne altitude without stacking height', leaderKind => {
    const { scene, npc, mount, placeAirborne } = fixture()
    const player = new Player(scene); onTestFinished(() => player.dispose())
    const leaderMount = leaderKind === 'air' ? new Mount(scene, MountType.XONGKORO, 0, 50, 0) : null
    if (leaderMount) {
      onTestFinished(() => leaderMount.dispose())
      player.mountVehicle(leaderMount)
      leaderMount.group.position.y = 35
      leaderMount.flight!.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } })
      player.syncMountTransform()
    } else player.group.position.set(0, -player.bodyBaseOffset, 50)
    placeAirborne(30)
    npc.assignFollowTarget(player, 0, new THREE.Vector3(0, 0, -25))
    const navigation = new NavigationWorld()
    for (let frame = 0; frame < 1800; frame++) npc.updateTownTravel(1 / 60, 0, [], [], navigation)
    expect(mount.isAirborne).toBe(true)
    expect(mount.group.position.y).toBeCloseTo(leaderKind === 'air' ? 35 : 30, 1)
    expect(npc.tacticalOrder).toBe('follow')
  })

  it('a grounded hold suppresses takeoff until released and explicit return lands without using ground navigation', () => {
    const { npc, mount } = fixture()
    const navigation = new NavigationWorld()
    const navigationRequests = vi.spyOn(navigation, 'queryPath')
    npc.setEagleFlightOrder({ kind: 'hold', cruiseAltitude: 25 })
    for (let frame = 0; frame < 120; frame++) npc.updateTownTravel(1 / 60, 0, [], [], navigation)
    expect(mount.isAirborne).toBe(false)
    npc.setEagleFlightOrder(null)
    for (let frame = 0; frame < 900; frame++) npc.updateTownTravel(1 / 60, 0, [], [], navigation)
    expect(mount.group.position.y).toBeGreaterThan(23)
    npc.setEagleFlightOrder({ kind: 'return', target: new THREE.Vector3(), landingYaw: 0 })
    advanceUntil(() => !mount.isAirborne, () => npc.updateTownTravel(1 / 60, 0, [], [], navigation),
      { maxSimulationSeconds: 120, failureMessage: 'Eagle return to assigned pad' })
    expect(mount.group.position.length()).toBeLessThan(3)
    expect(navigationRequests).not.toHaveBeenCalled()
  })

  it('idle uses the all-mount spatial index even when ground nearbyNPCs is empty', () => {
    const { scene, npc, mount, placeAirborne } = fixture()
    const other = new Mount(scene, MountType.XONGKORO, 7, 8, 0); onTestFinished(() => other.dispose())
    const grid = new SpatialGrid<Mount>(8)
    npc.combatMountGrid = grid
    placeAirborne(32.8, new THREE.Vector3(0, 0, 48 / 3.6))
    other.group.position.y = mount.group.position.y
    grid.insert(mount)
    const navigation = new NavigationWorld()
    npc.updateTownTravel(0, 0, [], [], navigation)
    const unobstructedYaw = mount.flight!.intent.yaw
    grid.insert(other)
    npc.updateTownTravel(.1, 0, [], [], navigation)
    expect(Math.abs(mount.flight!.intent.yaw - unobstructedYaw)).toBeGreaterThan(.2)
    expect(mount.flight!.yaw).toBeGreaterThanOrEqual(-.085 - 1e-6)
    expect(npc.eagleTactic).toBeNull()
  })

  it('a bow-equipped eagle shoots, dives into a moving enemy mount with arrows remaining, recovers and shoots again', () => {
    const { scene, npc, mount, placeAirborne } = fixture('elven_runebow')
    const player = new Player(scene); onTestFinished(() => player.dispose())
    const targetMount = new Mount(scene, MountType.XONGKORO, 0, 90, 0); onTestFinished(() => targetMount.dispose())
    player.mountVehicle(targetMount)
    targetMount.group.position.y = 15
    targetMount.flight!.restore({ phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 7, velocity: { x: 0, y: 0, z: 7 } })
    player.syncMountTransform()
    const grid = new SpatialGrid<Mount>(8); npc.combatMountGrid = grid
    placeAirborne(32.8, new THREE.Vector3(0, 0, 48 / 3.6))
    let elapsed = 0, contacts = 0, shots = 0
    const initialAmmo = npc.combatAmmo
    const tick = () => {
      elapsed += 1 / 60
      targetMount.beginControlledFrame()
      targetMount.setFlightIntent({ yaw: elapsed * .12, pitch: 0, brake: true, takeoff: true })
      targetMount.finishControlledFrame(1 / 60, [])
      player.syncMountTransform()
      grid.clear(); grid.insert(mount); grid.insert(targetMount)
      npc.update(1 / 60, player, [npc], [], [], { setFill() {} }, (amount, isPlayer) => {
        if (isPlayer) {
          const result = damagePlayer(player, amount, { setFill() {} }, null,
            { source: createNpcCombatActorRef(npc), method: 'melee', contact: npc.weaponSweep.contact })
          if (result.appliedDamage > 0) contacts++
        }
      }, () => { shots++ }, true)
    }
    advanceUntil(() => shots > 0, tick, { maxSimulationSeconds: 15, failureMessage: 'Initial armed eagle shot' })
    expect(npc.eagleTactic).toBe('RANGED_AIR')
    advanceUntil(() => targetMount.currentHp < 200, tick, { maxSimulationSeconds: 120, failureMessage: 'Moving aerial eagle interception' })
    expect(npc.eagleTactic).toBe('DIVE_AIR')
    expect(npc.combatAmmo).toBeGreaterThan(0)
    expect(npc.combatAmmo).toBe(initialAmmo - shots)
    expect(targetMount.currentHp).toBe(140)
    expect(npc.weaponSweep.contact.attackSource).toBe('xongkoro')
    advanceUntil(() => mount.group.position.y >= 29, tick, { maxSimulationSeconds: 20, failureMessage: 'Eagle post-strike climb' })
    expect(contacts).toBe(1)
    expect(targetMount.currentHp).toBe(140)
    expect(mount.isAirborne).toBe(true)
    const shotsBeforeRecovery = shots
    advanceUntil(() => shots > shotsBeforeRecovery, tick, { maxSimulationSeconds: 20, failureMessage: 'Armed eagle resumes firing after recovery' })
    expect(npc.eagleTactic).toBe('RANGED_AIR')
    expect(mount.group.position.y).toBeGreaterThanOrEqual(29)
    expect(npc.combatAmmo).toBe(initialAmmo - shots)
    expect(contacts).toBe(1)
  })
})

it.each(['coincident', 'head-on'] as const)('two allied eagles choose opposite physical escape paths from a %s collision using one mount index', scenario => {
  // Two real riders and two mounts are necessary to verify pairwise opposite steering.
  const { scene, npc, mount, placeAirborne } = fixture()
  const otherNpc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Other eagle rider', 1, false,
    { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: 'xongkoro' })
  onTestFinished(() => otherNpc.dispose())
  const other = new Mount(scene, MountType.XONGKORO, 0, scenario === 'head-on' ? 50 : 0, 0)
  onTestFinished(() => other.dispose())
  otherNpc.mountVehicle(other)
  placeAirborne(32.8, new THREE.Vector3(0, 0, 48 / 3.6))
  other.group.position.y = mount.group.position.y
  other.flight!.restore({ phase: 'cruise', yaw: scenario === 'head-on' ? Math.PI : 0, pitch: 0, bank: 0,
    speed: 48 / 3.6, velocity: { x: 0, y: 0, z: scenario === 'head-on' ? -48 / 3.6 : 48 / 3.6 } })
  const grid = new SpatialGrid<Mount>(8), navigation = new NavigationWorld()
  npc.combatMountGrid = grid; otherNpc.combatMountGrid = grid
  grid.insert(mount); grid.insert(other)
  npc.updateTownTravel(0, 0, [], [], navigation); otherNpc.updateTownTravel(0, 0, [], [], navigation)
  expect(Math.sin(mount.flight!.intent.yaw)).toBeLessThan(0)
  expect(Math.sin(other.flight!.intent.yaw)).toBeGreaterThan(0)
  let closest = Infinity
  for (let frame = 0; frame < 180; frame++) {
    grid.clear(); grid.insert(mount); grid.insert(other)
    npc.updateTownTravel(1 / 60, 0, [], [], navigation)
    otherNpc.updateTownTravel(1 / 60, 0, [], [], navigation)
    closest = Math.min(closest, mount.group.position.distanceTo(other.group.position))
  }
  expect(mount.group.position.distanceTo(other.group.position)).toBeGreaterThan(12)
  if (scenario === 'head-on') expect(closest).toBeGreaterThan(12)
})
