import { createCavalrySweepMission } from '../src/career/CavalrySweep'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanditMissionController } from '../src/career/BanditMissionController'
import { TownDefenseController } from '../src/career/TownDefenseController'
import { createActiveCareerMission, createTownDefenseMission, resolveCareerMissionOutcome } from '../src/career/CareerMissionState'
import { resolveTownDefenseOutcome, TOWN_DEFENSE_ATTACK_GROUPS, townDefenseEnemyTotals } from '../src/career/TownDefenseState'
import { claimCareerMission, createCareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { TownScene } from '../src/town/TownScene'
import { SpectatorCameraController } from '../src/camera/SpectatorCameraController'
import { Player } from '../src/player/Player'

afterEach(() => vi.unstubAllGlobals())

function fieldFixture(kind: 'bandit' | 'patrol' = 'bandit') {
  let profile = createCareerProfile('roman')
  profile.activeMission = createActiveCareerMission(kind === 'patrol' ? 'recruit-patrol-01' : 'recruit-bandits-01', 0, kind === 'patrol' ? 4 : 3, 0, 'death-mission', kind, 'captain')
  profile.activeMission.phase = 'ENGAGING'
  const player = { dead: true, combatPosition: new THREE.Vector3(400, 0, 400) }
  const leader = { dead: false, combatantId: 'captain', combatPosition: new THREE.Vector3(), tacticalOrder: 'charge', assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn() }
  const targets = profile.activeMission.targetActorIds.map(combatantId => ({ dead: false, combatantId, combatPosition: new THREE.Vector3(500, 0, 500), encounterIsAlerted: false }))
  const controller = Object.create(BanditMissionController.prototype) as any
  Object.assign(controller, {
    readProfile: () => profile, commit: (next: typeof profile) => { profile = next; return true }, player: () => player,
    camps: [{ id: 0, center: new THREE.Vector3(120, 0, 120), ambient: [], mission: targets }],
    friendlies: [leader], leader, world: { obstacles: [] }, navigation: { beginFrame: vi.fn(), queryPath: vi.fn(() => ({ status: 'blocked' })) },
    guide: { hide: vi.fn(), update: vi.fn() }, route: [], routeIndex: 0, tracker: null, statsCheckpointElapsed: 0, perceptionElapsed: 0,
  })
  return { controller, player, leader, targets, profile: () => profile, reload: () => { profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))! } }
}

describe('Career objectives take priority over player death', () => {
  it.each([
    [true, 1, 1, null], [true, 1, 0, 'victory'], [true, 0, 1, 'failure'],
    [false, 0, 1, null], [true, 0, 0, 'victory'],
  ] as const)('Bandit dead=%s allies=%s targets=%s => %s', (dead, allies, targets, expected) => {
    expect(resolveCareerMissionOutcome(dead, true, targets, allies)).toBe(expected)
    const f = fieldFixture()
    f.player.dead = dead; f.leader.dead = allies === 0
    f.targets.forEach((npc, index) => { npc.dead = index >= targets })
    expect(f.controller.evaluate(dead)).toBe(expected)
  })

  it('waits for the complete target roster and excludes unrelated living NPCs from failure counts', () => {
    const f = fieldFixture()
    f.targets.length = 0
    expect(f.controller.evaluate(true)).toBeNull()
    f.leader.dead = true
    expect(f.controller.evaluate(true)).toBeNull()
    f.targets.push({ dead: false, combatantId: f.profile().activeMission!.targetActorIds[0], combatPosition: new THREE.Vector3(), encounterIsAlerted: false })
    f.controller.friendlies.push({ dead: false, combatantId: 'ambient-civilian' })
    expect(f.controller.evaluate(true)).toBe('failure')
  })

  it('claims dead-player victory once across reload and retains personal contribution without survival bonus', () => {
    const f = fieldFixture()
    f.controller.updateFlow(.1, 0)
    f.reload()
    expect(f.profile().activeMission?.playerDead).toBe(true)
    expect(f.profile().activeMission?.result).toBeUndefined()
    const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
    const first = claimCareerMission(f.profile(), 'death-mission', 'victory', stats)
    expect(first.profile.activeMission?.result).toMatchObject({ outcome: 'victory', stats: { survived: false }, merit: { damage: 10, kills: 12, contribution: 0, total: 22 } })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(first.profile)))!
    const second = claimCareerMission(loaded, 'death-mission', 'victory', stats)
    expect(second.meritAwarded).toBe(0)
    expect(second.profile.totalMerit).toBe(first.profile.totalMerit)
    expect(second.profile.lifetimeStats.deaths).toBe(1)
  })

  it('Patrol continues every remaining route objective with a living leader after Player death and reload', () => {
    const f = fieldFixture('patrol')
    f.targets.forEach(npc => { npc.dead = true })
    f.controller.updateFlow(.1, 0)
    expect(f.profile().activeMission?.phase).toBe('MARCHING')
    expect(f.controller.evaluate(true)).toBeNull()
    const template = { routeId: 'south-road' }
    const objectives = f.controller.patrolWaypoints(template, f.controller.camps[0].center)
    for (let stage = 0; stage < objectives.length; stage++) {
      f.leader.combatPosition.copy(objectives[stage])
      f.controller.updateFlow(.1, 0)
      f.reload()
      expect(f.profile().activeMission?.playerDead).toBe(true)
      expect(f.profile().activeMission?.patrolStage).toBe(stage + 1)
      expect(f.controller.evaluate(true)).toBe(stage === objectives.length - 1 ? 'victory' : null)
    }
  })

  it('Patrol fails only when Player and the mission roster are dead before route completion', () => {
    const f = fieldFixture('patrol')
    f.targets.forEach(npc => { npc.dead = true })
    f.leader.dead = true
    expect(f.controller.evaluate(true)).toBe('failure')
    f.player.dead = false
    f.profile().activeMission!.phase = 'ASSEMBLING'
    f.controller.updateFlow(.1, 0)
    expect(f.controller.evaluate(false)).toBeNull()
    expect(f.profile().activeMission?.phase).toBe('MARCHING')
    const objectives = f.controller.patrolWaypoints({ routeId: 'south-road' }, f.controller.camps[0].center)
    for (const point of objectives) { f.player.combatPosition.copy(point); f.controller.updateFlow(.1, 0) }
    expect(f.controller.evaluate(false)).toBe('victory')
  })

  it('Patrol can leave assembly after Player death without requiring the corpse to reach its leader', () => {
    const f = fieldFixture('patrol')
    f.profile().activeMission!.phase = 'ASSEMBLING'
    f.controller.updateFlow(.1, 0)
    expect(f.profile().activeMission?.phase).toBe('MARCHING')
    expect(f.leader.assignFormationTarget).toHaveBeenCalled()
    expect(f.controller.evaluate(true)).toBeNull()
  })

  it.each([
    [false, 1, 0, 5, 'victory'], [true, 1, 0, 5, 'victory'],
    [true, 0, 0, 10, 'victory'], [true, 0, 0, 11, 'failure'],
    [false, 1, 0, 11, 'failure'], [true, 0, 10, 5, 'failure'],
    [true, 1, 10, 5, null], [false, 0, 10, 5, null],
  ] as const)('Town Defense dead=%s military=%s enemies=%s civilians=%s => %s', (dead, military, enemies, civilians, expected) => {
    expect(resolveTownDefenseOutcome(dead, civilians, true, enemies, military)).toBe(expected)
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], ['civilian'], 'defense-death')
    profile.activeMission.phase = 'ATTACKING'
    const controller = Object.create(TownDefenseController.prototype) as any
    Object.assign(controller, {
      readProfile: () => profile, groups: [],
      enemies: profile.activeMission.targetActorIds.map((combatantId, index) => ({ combatantId, dead: index >= enemies })),
      residents: [
        { spec: { role: 'captain' }, npc: { combatantId: 'captain', dead: military === 0 } },
        { spec: { role: 'merchant' }, npc: { dead: false } },
        ...Array.from({ length: 20 }, (_, index) => ({ spec: { role: 'civilian' }, npc: { dead: index < civilians } })),
      ],
    })
    expect(controller.evaluate(dead)).toBe(expected)
  })

  it('civilian failure lock continues until combat resolves, including checkpoint reload', () => {
    let profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission(['captain'], Array.from({ length: 20 }, (_, i) => `civilian-${i}`), 'defense-lock')
    profile.activeMission.phase = 'ATTACKING'
    const controller = Object.create(TownDefenseController.prototype) as any
    Object.assign(controller, {
      readProfile: () => profile, commit: (next: typeof profile) => { profile = next; return true },
      player: () => ({ dead: true, combatPosition: new THREE.Vector3() }), blackCat: { dead: false },
      enemies: profile.activeMission.targetActorIds.map(combatantId => ({ combatantId, dead: false })), groups: [],
      residents: [ { spec: { role: 'captain' }, npc: { combatantId: 'captain', dead: false } },
        ...Array.from({ length: 20 }, (_, i) => ({ spec: { role: 'civilian' }, npc: { combatantId: `civilian-${i}`, dead: i < 11 } })) ],
      preparationElapsed: 45, attackElapsed: 0, statsCheckpointElapsed: 0, reserveCharged: false, tracker: null, guide: { updateTownDefense: vi.fn() },
    })
    controller.updateFlow(.1, 0)
    expect(profile.activeMission.phase).toBe('FAILURE_LOCKED')
    expect(controller.evaluate(true)).toBeNull()
    profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
    expect(profile.activeMission?.playerDead).toBe(true)
    expect(profile.activeMission?.deadCivilianActorIds).toHaveLength(11)
    controller.enemies.forEach((npc: any) => { npc.dead = true })
    controller.updateFlow(.1, 0)
    expect(profile.activeMission?.phase).toBe('FAILURE_LOCKED')
    expect(controller.evaluate(true)).toBe('failure')
  })

  it('has 70 attackers with exact three-lane composition', () => {
    expect(TOWN_DEFENSE_ATTACK_GROUPS.map(group => group.composition)).toEqual([
      { melee: 11, lancer: 6, 'horse-archer': 4 }, { melee: 10, lancer: 4, 'horse-archer': 7 }, { melee: 7, lancer: 11, 'horse-archer': 10 },
    ])
    expect(townDefenseEnemyTotals()).toEqual({ melee: 28, lancer: 21, 'horse-archer': 21 })
  })
})

function townFixture() {
  const controls = { textContent: '', style: {} }
  const town = Object.create(TownScene.prototype) as any
  const player = new Player(new THREE.Scene(), 'roman')
  vi.stubGlobal('document', { getElementById: () => controls })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  const profile = createCareerProfile('roman')
  profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0, 'observer', 'bandit', 'captain')
  Object.assign(town, {
    profile, player, camera: new THREE.PerspectiveCamera(58, 1, .1, 400), spectator: null,
    event: { hostile: false, evaluate: vi.fn(() => null) }, input: { clear: vi.fn(), keys: {}, consumeMouseDelta: () => ({ dx: 0, dy: 0 }), consumeLeftClick: vi.fn(), consumeLeftClickRelease: vi.fn(), consumeKeyE: vi.fn() },
    equipment: { close: vi.fn(), open: vi.fn(), visible: false }, target: 'merchant', hasPreviousTip: true,
    commit: vi.fn((next: typeof profile) => { town.profile = next; return true }),
    orbit: { cameraYaw: 0, getAimPoint: () => new THREE.Vector3(), update: vi.fn() },
    hp: { setFill: vi.fn() }, stamina: { setFill: vi.fn() }, quiver: { setArrowCount: vi.fn() }, inventory: { meleeEnabled: true, rangedEnabled: false },
    panel: null, result: null, disposed: false, last: 0, elapsed: 0,
    defense: { active: false, fieldNpcs: [] }, mission: { evaluate: vi.fn(() => null), persistRuntimeProgress: vi.fn(), returnComplete: false, updateFlow: vi.fn() },
    stableHorses: [], mounts: [], cat: { dead: true }, serviceMarkers: new Map(), hud: { textContent: '', style: {} }, hint: { textContent: '', style: {} },
    damageNumbers: { update: vi.fn() }, renderer: { render: vi.fn() }, scene: new THREE.Scene(),
    updatePointerPrompt: vi.fn(), melee: vi.fn(), updateFieldCombat: vi.fn(), updateCareerHorseAudio: vi.fn(), updateShots: vi.fn(), updateAmbient: vi.fn(), finishMission: vi.fn(),
  })
  player.onPlayerDeath = () => town.enterMissionObserver()
  return { town, player, controls }
}

describe('Town mission death observer orchestration', () => {
  it('enters the existing spectator controller immediately, leaves Player dead and blocks equipment, interaction and collision', () => {
    const { town, player, controls } = townFixture()
    player.takeDamage(99999, town.hp)
    expect(player.dead).toBe(true)
    expect(player.hp).toBe(0)
    expect(town.spectator).toBeInstanceOf(SpectatorCameraController)
    expect(town.profile.activeMission.playerDead).toBe(true)
    expect(town.profile.activeMission.result).toBeUndefined()
    expect(town.panel).toBeNull()
    expect(controls.textContent).toContain('Space')
    for (const code of ['Tab', 'KeyE', 'KeyQ', 'KeyG']) {
      const event = { code, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
      town.key(event)
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
    }
    expect(town.equipment.open).not.toHaveBeenCalled()
    town.talk('merchant')
    town.interaction()
    expect(town.target).toBeNull()
    // These calls return before accessing combat or collision dependencies.
    TownScene.prototype['melee'].call(town)
    town.resolveBodies()
    town.fire(new THREE.Vector3(), new THREE.Vector3(), 10, 10, true, false, 'arrow')
    expect(player.targetable).toBe(false)
    player.dispose()
  })

  it.each(['bandit', 'cavalry-sweep'])('keeps %s AI, mission updates and projectiles running while observer moves; shows result only on outcome', kind => {
    const { town, player } = townFixture()
    player.takeDamage(99999, town.hp)
    if (kind === 'cavalry-sweep') town.profile.activeMission = createCavalrySweepMission('observer')
    const npc = { update: vi.fn(), combatPosition: new THREE.Vector3(), group: new THREE.Group(), dead: false }
    town.mission.friendlies = []; town.mission.cavalryMounts = []; town.mission.fieldNpcs = [npc]; town.mission.combatPeersFor = () => []; town.mission.ambientBandits = []; town.mission.missionBandits = []
    town.residents = []; town.externalThreatActors = new Set(); town.world = { obstacles: [] }
    town.navigation = { sync: vi.fn(), beginFrame: vi.fn() }
    town.grid = { clear: vi.fn(), insert: vi.fn(), getNearbyInto: () => [] }; town.neighbors = []
    town.careerMounts = { activeMount: null, update: vi.fn() }
    if (kind === 'cavalry-sweep') {
      const bandit = { update: vi.fn(), combatPosition: new THREE.Vector3(), group: new THREE.Group(), dead: false, faction: 'BANDIT' }
      const mount = { group: new THREE.Group(), previousPosition: new THREE.Vector3(-1, 0, 0), movementSpeed: 15, isSprinting: true, canImpact: vi.fn(() => true), setCameraDistance: vi.fn(), riderNpc: npc, dead: false }
      mount.group.position.x = 1
      Object.assign(npc, { mount })
      town.mission.friendlies = [npc]; town.mission.cavalryMounts = [mount]
      town.mission.fieldNpcs = [npc, bandit]; town.mission.missionBandits = [bandit]
      town.grid.getNearby = () => [bandit]
      town.hitFieldNpc = vi.fn()
    }
    town.updateCareerCommandCue = vi.fn(); town.updateExternalThreatAssignments = vi.fn()
    town.updateFieldCombat = TownScene.prototype['updateFieldCombat']
    const projectile = { isAlive: true, mesh: { position: new THREE.Vector3(0, 5, 0) }, update: vi.fn(), destroy: vi.fn() }
    town.shots = [{ arrow: projectile, training: true, age: 0 }]
    town.updateShots = vi.fn(TownScene.prototype['updateShots'])
    town.input.keys = { KeyW: true, Space: true, ShiftLeft: true }
    const before = town.camera.position.clone()
    town.frame(16)
    expect(town.camera.position.distanceTo(before)).toBeGreaterThan(0)
    expect(town.orbit.update).not.toHaveBeenCalled()
    expect(town.melee).not.toHaveBeenCalled()
    expect(npc.update).toHaveBeenCalledOnce()
    if (kind === 'cavalry-sweep') expect(town.hitFieldNpc).toHaveBeenCalledWith(town.mission.missionBandits[0], expect.any(Number), 'mount-impact', npc)
    expect(town.mission.updateFlow).toHaveBeenCalledOnce()
    expect(town.updateShots).toHaveBeenCalledOnce()
    expect(projectile.update).toHaveBeenCalledOnce()
    expect(town.finishMission).not.toHaveBeenCalled()
    expect(town.hud.textContent).toContain('你已戰死 · 戰鬥仍在繼續')
    expect(player.dead).toBe(true)
    expect(player.hp).toBe(0)
    town.mission.evaluate.mockReturnValue('victory')
    town.frame(32)
    expect(town.finishMission).toHaveBeenCalledExactlyOnceWith('victory')
    player.dispose()
  })

  it('reload restores a dead active mission into observer without claiming or healing', () => {
    const { town, player } = townFixture()
    town.profile.activeMission.playerDead = true
    town.profile = parseCareerProfile(JSON.parse(JSON.stringify(town.profile)))!
    town.mission.startActiveMission = vi.fn()
    town.inventory.prepareForCombat = vi.fn()
    town.careerMounts = { restoreActiveMount: vi.fn() }
    town.restoreActiveCareerMission()
    expect(town.mission.startActiveMission).toHaveBeenCalledOnce()
    expect(town.spectator).toBeInstanceOf(SpectatorCameraController)
    expect(player.dead).toBe(true)
    expect(player.hp).toBe(0)
    expect(town.profile.activeMission.result).toBeUndefined()
    player.dispose()
  })

  it('restores normal Player and camera controls only after returning to town', () => {
    const { town, player, controls } = townFixture()
    player.takeDamage(99999, town.hp)
    town.careerMounts = { restInTown: vi.fn() }
    town.inventory.sheathAll = vi.fn()
    town.restPlayerInTown()
    expect(player.dead).toBe(false)
    expect(player.hp).toBe(player.maxHp)
    expect(town.spectator).toBeNull()
    expect(town.orbit.update).toHaveBeenCalledOnce()
    expect(controls.textContent).toContain('Tab')
    player.dispose()
  })
})
