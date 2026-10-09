import { completeNpcDeployment, NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { withMissionCheckpoint } from '../helpers/missionCheckpoint'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { acceptCavalrySweep, createCavalrySweepMission, createSweepRoster, CAVALRY_SWEEP_ID, SWEEP_CENTER, SWEEP_CAPTAIN_START, sweepBanditPosition, sweepPlayerSpawn } from '../../src/career/CavalrySweep'
import { availableRecruitMissions } from '../../src/career/CareerMissionCatalog'
import { CAREER_RANKS, claimCareerMission, clearCareerMission, createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { BanditMissionController, selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { MountedMissionMarchController } from '../../src/career/MountedMissionMarch'
import * as missionOutcomePolicy from '../../src/career/CareerMissionState'
import { MAX_COMMAND_SQUAD_SIZE } from '../../src/battle/CommandTarget'
import { NPC, Faction } from '../../src/world/NPC'
import { damageNpc } from '../../src/combat/DamageRouter'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownWorld } from '../../src/town/TownWorld'
import { townRoster, townMilitaryEquipment } from '../../src/town/TownRules'
import { Mount, MountType } from '../../src/world/Mount'
import { combatActor, combatFixture } from '../helpers/townMissionCombat'
import { advanceUntil } from '../helpers/simulation'
import type { Player } from '../../src/player/Player'
import { TownScene } from '../../src/town/TownScene'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: { ready: true, createInstance: () => {
  const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
  return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null, setLocomotion: vi.fn(), setAppearanceVariant: vi.fn(), playOnce: vi.fn(), playDeath: vi.fn(), update: vi.fn(), dispose: vi.fn() }
} } }))
vi.mock('../../src/world/MakiRangerEquipment', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/world/MakiRangerEquipment')>()), createMakiRangerBowInstance: () => ({
  model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1, gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1), longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) }
}) }))

afterEach(() => vi.unstubAllGlobals())

function ready() { return { ...createCareerProfile('roman'), ownedHorseTiers: [1] as (1 | 2 | 3)[] } }
interface SweepFixtureOptions {
  borrowedSlots?: number[]
  livingSlots?: number[]
  enemyCount?: number
  joinAssembly?: boolean
  deferStart?: boolean
}

// Cost is explicit: one NPC/Mount per borrowed or surviving friendly slot, plus enemyCount NPCs.
// Real startSweep requires 59/40 saved IDs. Omitted actors are saved casualties, never spawned/killed.
// No TownWorld/GLB; one NavigationWorld. Selection, restore, spawn and controller methods stay real.
function fixture({ borrowedSlots = [0], livingSlots = [0, 1], enemyCount = 0,
  joinAssembly = true, deferStart = false }: SweepFixtureOptions = {}) {
  const driver = new NpcSpawnTestDriver()
  const scene = new THREE.Scene(), roster = createSweepRoster('roman')
  const townSpecs = townRoster(), cavalrySpecs = townSpecs.filter(spec => spec.role.includes('cavalry'))
  const residents = borrowedSlots.map(index => {
    const spec = { ...(index === 0 ? townSpecs.find(spec => spec.role === 'captain')! : index === 29 ? townSpecs.find(spec => spec.role === 'ranger')! : cavalrySpecs[(index - 1) % cavalrySpecs.length]), id: `garrison:${index}` }
    const spawn = roster[index]
    const military = spec.role === 'ranger' ? null : townMilitaryEquipment('roman', spec.role)
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', spawn.aiType, spec.id, military?.level ?? spawn.tier, true, military?.loadout ?? spawn.loadout, spawn.presetId, undefined, spec.id)
    onTestFinished(() => npc.dispose())
    const mount = new Mount(scene, spec.role === 'ranger' ? MountType.BLACK_CAT : MountType.HORSE, spec.x, spec.z)
    onTestFinished(() => mount.dispose())
    npc.setTownPeaceful(); npc.mountVehicle(mount)
    return { spec, npc, homeMount: mount, cycle: -1, walkTime: 0 }
  })
  // Exact slot assignment is fixture input; production selection has its own zero-spawn owner.
  const selected = Array.from({ length: 59 }, (_, slot) => borrowedSlots.includes(slot) ? `garrison:${slot}` : undefined)
  let profile = acceptCavalrySweep(ready(), 'sweep', selected)!
  profile.activeMission!.deadFriendlyActorIds = profile.activeMission!.friendlyActorIds.filter((_, slot) => !livingSlots.includes(slot))
  profile.activeMission!.deadTargetActorIds = profile.activeMission!.targetActorIds.slice(enemyCount)
  const player = { dead: false, combatPosition: sweepPlayerSpawn() }
  const controller = withMissionCheckpoint(Object.create(BanditMissionController.prototype)) as any
  Object.assign(controller, {
    scheduler: driver.scheduler, scene, residents, world: { obstacles: [], camps: [{ spawnPoints: [new THREE.Vector3()] }] }, navigation: new NavigationWorld(),
    readProfile: () => profile, commit: vi.fn((next: typeof profile) => { profile = next; return true }), player: () => player,
    camps: [{ id: 0, center: new THREE.Vector3(), ambient: [], mission: [] }], friendlies: [], cavalryMounts: [], temporaryCavalry: [], departingCavalry: [], commandId: 1,
    veteranSurvivalElapsed: 0, veteranTargetActorIds: new Set(), veteranFriendlyActorIds: new Set(), borrowedMissionActors: new Set(),
    borrowedRespawnEnabled: new Map(), borrowedTemporaryMounts: [], fieldActorMounts: new Map(), veteranEnemies: [],
    plannedFriendlyPositions: [], veteranEnemySquadList: [], veteranMusterPositions: new Map(), veteranSupportEntryPositions: new Map(), veteranEnemyTownActorIds: new Set(),
    veteranEnemySquadByActorId: new Map(), veteranDamageActivationUnsubscribe: null,
    guide: { hide: vi.fn(), update: vi.fn(), dispose: vi.fn() }, events: new CombatEventStream(), tracker: null, route: [], routeIndex: 0,
    onMarchStarted: vi.fn(), onSweepCharge: vi.fn(), mountedMarch: null, veteranFieldFactories: {},
  })
  onTestFinished(() => controller.dispose())
  if (!deferStart) completeNpcDeployment(() => controller.startActiveMission(), driver)
  const assemble = (joinPlayer = true) => {
    for (let stage = 0; stage < 2 && profile.activeMission?.phase === 'ASSEMBLING'; stage++) {
      for (const npc of controller.friendlies) {
        const target = (npc as any).formationTarget
        if (!target || npc.dead) continue
        npc.mount?.group.position.copy(target.position); npc.group.position.copy(target.position); target.reached = true
      }
      if (joinPlayer) player.combatPosition.copy(controller.leader.combatPosition).add(new THREE.Vector3(0, 0, 6))
      controller.updateFlow(.1, 0)
    }
  }
  if (joinAssembly) assemble()
  return { controller, player, residents, assemble, driver, profile: () => profile, reload: () => { controller.dispose(); profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!; completeNpcDeployment(() => controller.startActiveMission(), driver) } }
}

describe('Cavalry Sweep eligibility', () => {
  it.each(CAREER_RANKS)('%s needs only a usable owned mount', rank => {
    const profile = { ...ready(), rank, totalMerit: 0, availableMerit: 0, careerMissionCompletions: 0 }
    expect(acceptCavalrySweep(profile)).not.toBeNull()
    expect(availableRecruitMissions(profile).some(m => m.id === CAVALRY_SWEEP_ID)).toBe(true)
    const noMount = { ...profile, ownedHorseTiers: [], ownedMounts: [] }
    expect(acceptCavalrySweep(noMount)).toBeNull()
    expect(availableRecruitMissions(noMount).some(m => m.id === CAVALRY_SWEEP_ID)).toBe(false)
  })
  it('falls back from an illegal selection without granting ownership or changing input', () => {
    const profile = { ...ready(), selectedMountId: 'corgi' as const, ownedMounts: ['corgi' as const] }
    const accepted = acceptCavalrySweep(profile)!
    expect(accepted.selectedMountId).toBe('horse')
    expect(accepted.ownedHorseTiers).toEqual(profile.ownedHorseTiers)
    expect(accepted.ownedMounts).toEqual(profile.ownedMounts)
    expect(profile.selectedMountId).toBe('corgi')
    expect(acceptCavalrySweep({ ...ready(), selectedMountId: 'horse-t1' })!.selectedMountId).toBe('horse')
  })
  it('rejects simultaneous missions or hostile Town events', () => {
    const profile = acceptCavalrySweep(ready())!
    expect(acceptCavalrySweep(profile)).toBeNull()
    expect(acceptCavalrySweep({ ...ready(), townEvent: { id: 'war', state: 'hostile' } })).toBeNull()
  })
})

describe.each(['roman', 'viking'] as const)('%s sweep roster', faction => {
  it('counts Player inside Squad A, all 59 mounted NPCs, and the existing T4 profiles', () => {
    const roster = createSweepRoster(faction)
    expect(roster).toHaveLength(59)
    expect(roster.filter(s => s.squadId === 1).length + 1).toBe(MAX_COMMAND_SQUAD_SIZE)
    expect(roster.filter(s => s.squadId === 2)).toHaveLength(MAX_COMMAND_SQUAD_SIZE)
    expect(roster.filter(s => s.squadId === 1 && s.tier !== 4)).toHaveLength(28)
    expect(roster.filter(s => s.squadId === 2 && s.tier !== 4)).toHaveLength(29)
    expect(roster.every(s => s.cavalry && s.loadout?.mountId && s.characterFaction === faction)).toBe(true)
    expect(roster.find(s => s.name === 'Captain')).toMatchObject({ tier: 4, visualAssetId: faction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4' })
    expect(roster.find(s => s.name === 'Maki')).toMatchObject({ tier: 4, visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger', loadout: { mountId: 'black-cat' } })
    const positions = [...roster.map(s => new THREE.Vector3(s.x, 0, s.z)), sweepPlayerSpawn()]
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) expect(positions[i].distanceTo(positions[j])).toBeGreaterThan(2)
  })
})

describe('Sweep shared terrain', () => {
  it('uses the existing terrain with a clear full-width charge lane and a single loose mob', () => {
    const faction = 'roman'
    // Geometry-only validation; no browser or WebGL renderer is involved.
    const ctx = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) })
    const world = new TownWorld(faction, new THREE.Scene())
    onTestFinished(() => world.dispose())
    const bandits = Array.from({ length: 40 }, (_, i) => sweepBanditPosition(i))
    expect(new Set(bandits.map(p => `${p.x},${p.z}`)).size).toBe(40)
    const lane = new THREE.Box3(new THREE.Vector3(-145, -100, SWEEP_CENTER.z - 14), new THREE.Vector3(145, 100, SWEEP_CENTER.z + 25))
    expect(world.obstacles.some(o => lane.intersectsBox(o.box))).toBe(false)
    for (const p of [...bandits, ...createSweepRoster(faction).map(s => new THREE.Vector3(s.x, 0, s.z))]) {
      expect(Math.abs(p.x)).toBeLessThan(350); expect(Math.abs(p.z)).toBeLessThan(350)
    }
  })
})

describe('Sweep reserve selection without materialization', () => {
  function candidates(count: number) {
    const specs = townRoster(), captain = specs.find(s => s.role === 'captain')!, maki = specs.find(s => s.role === 'ranger')!
    return [captain, maki, ...specs.filter(s => s.duty === 'training' && s.mounted)].slice(0, count).map(spec => {
      const mount = { dead: false, disposed: false, riderNpc: null, riderPlayer: null } as unknown as Mount
      return { spec, npc: { combatantId: spec.id, dead: false, mount: spec.role === 'ranger' ? null : mount } as NPC, homeMount: mount }
    })
  }
  it('reserves Captain and unmounted Maki identities in slots 0 and 29 using her available home cat', () => {
    const ids = selectMissionCavalryActorIds(candidates(2), 59)
    expect(ids[0]).toBe('captain'); expect(ids[29]).toBe('ranger')
    expect(ids.filter(Boolean)).toEqual(['captain', 'ranger'])
    expect(ids.filter(id => id === undefined)).toHaveLength(57)
  })
  it.each([21, 59])('assigns %s existing actors and only missing temporary IDs as data', count => {
    const selected = selectMissionCavalryActorIds(candidates(count), 59)
    const active = createCavalrySweepMission('policy-sweep', selected)
    expect(selected.filter(Boolean)).toHaveLength(count)
    expect(selected.filter(id => id === undefined)).toHaveLength(59 - count)
    expect(active.borrowedActorIds).toHaveLength(count)
    expect(active.friendlyActorIds.filter(id => id.startsWith('policy-sweep:cavalry:'))).toHaveLength(59 - count)
    expect(active.friendlyActorIds).toHaveLength(59)
    expect(new Set(active.friendlyActorIds).size).toBe(59)
  })
})

describe('Sweep runtime and checkpoint', () => {
  it('remounts a borrowed Maki on her existing home cat without spawning other riders', () => {
    const f = fixture({ borrowedSlots: [29], livingSlots: [29], joinAssembly: false, deferStart: true })
    const maki = f.residents[0]
    maki.npc.dismountFromMount()
    expect(completeNpcDeployment(() => f.controller.startActiveMission(), f.driver)).toBe(true)
    expect(f.controller.friendlies).toEqual([maki.npc])
    expect(maki.npc.mount).toBe(maki.homeMount)
    expect(f.controller.temporaryCavalry).toHaveLength(0)
  })
  it('temporarily equips borrowed riders and restores their equipment, tier, squad and respawn setting', () => {
    const f = fixture({ borrowedSlots: [1], livingSlots: [1], joinAssembly: false, deferStart: true }), c = f.controller
    const rider = f.residents[0].npc
    const original = { weapon: rider.meleeWeaponId, ranged: rider.rangedWeaponId, shield: rider.shieldId, tier: rider.tier, squad: rider.squadId }
    const equip = vi.spyOn(rider, 'applyTemporaryCombatLoadout')
    rider.respawnEnabled = true
    completeNpcDeployment(() => c.startActiveMission(), f.driver)
    expect(equip).toHaveBeenCalledWith(expect.objectContaining({ meleeWeaponId: expect.any(String) }), undefined, 1)
    expect(rider.meleeWeaponId).not.toBe(original.weapon)
    expect(rider.tier).toBe(original.tier)
    expect(rider.respawnEnabled).toBe(false)
    c.dispose()
    expect({ weapon: rider.meleeWeaponId, ranged: rider.rangedWeaponId, shield: rider.shieldId, tier: rider.tier, squad: rider.squadId }).toEqual(original)
    expect(rider.respawnEnabled).toBe(true)
  })
  it('spawns only missing riders far outside town, then sends them through the entry before muster', () => {
    const f = fixture({ joinAssembly: false }), c = f.controller
    const support = c.temporaryCavalry.map(({ npc }: { npc: NPC }) => npc)
    expect(support).toHaveLength(1)
    expect(support.every((npc: NPC) => npc.combatPosition.x < -200)).toBe(true)
    expect(support.every((npc: NPC) => npc.formationCommandId === 9001)).toBe(true)
    const rider = support[0]
    rider.mount.group.position.x += 25
    const approachPosition = rider.combatPosition.clone()
    c.updateFlow(5, 0)
    f.reload()
    const restored = c.friendlies.find((npc: NPC) => npc.combatantId === rider.combatantId)
    expect(restored.combatPosition.x).toBe(approachPosition.x)
    expect(restored.combatPosition.z).toBe(approachPosition.z)
    expect(restored.formationCommandId).toBe(9001)
    const entry = restored.formationTarget.position.clone()
    restored.mount.group.position.copy(entry); restored.formationTarget.reached = true
    c.updateFlow(.1, 0)
    expect(restored.combatPosition.x).toBe(entry.x)
    expect(restored.combatPosition.z).toBe(entry.z)
    expect(restored.formationCommandId).toBe(9000)
    expect(restored.formationTarget.position.distanceTo(SWEEP_CAPTAIN_START)).toBeLessThan(100)
    c.dispose()
  })
  // The shared updateMountedAssembly 90% survivor boundary is owned by VeteranFieldFormation.
  it('restores each borrowed and temporary rider at its checkpoint rather than a leader-relative formation', () => {
    const f = fixture(), c = f.controller
    const riders = [c.friendlies[0], c.friendlies[1]] as NPC[]
    riders.forEach((npc, index) => npc.mount!.group.position.set(20 + index * 13, 0, -90 - index * 17))
    const positions = new Map(riders.map(npc => [npc.combatantId, npc.combatPosition.clone()]))
    c.persistRuntimeProgress(true)
    f.reload()
    expect(c.friendlies.map((npc: NPC) => npc.combatantId)).toEqual(['garrison:0', 'sweep:cavalry:1'])
    expect(c.friendlies[0]).toBe(f.residents[0].npc)
    expect(c.temporaryCavalry.map(({ npc }: { npc: NPC }) => npc.combatantId)).toEqual(['sweep:cavalry:1'])
    for (const [id, point] of positions) {
      const npc = c.friendlies.find((npc: NPC) => npc.combatantId === id)
      expect(npc.combatPosition.x).toBe(point.x); expect(npc.combatPosition.z).toBe(point.z)
    }
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    c.dispose()
  })
  it('accepts a sweep in place, saves the borrowed roster and keeps the existing Town scene', () => {
    const f = fixture({ livingSlots: [0], joinAssembly: false, deferStart: true }), town = Object.create(TownScene.prototype) as any
    town.profile = ready(); town.store = { load: () => town.profile }; town.residents = f.residents
    town.event = { hostile: false }; town.player = { dead: false, group: new THREE.Group(), faceDirection: vi.fn() }
    town.mission = { fieldNpcs: [], startActiveMission: vi.fn(() => true) }
    town.commit = vi.fn(next => { town.profile = next; return true })
    town.careerMounts = { activate: vi.fn() }; town.inventory = { prepareForCombat: vi.fn() }
    town.closePanel = vi.fn(); town.dispose = vi.fn(); town.onRestart = vi.fn()
    const position = town.player.group.position.clone()
    town.acceptMission(CAVALRY_SWEEP_ID)
    expect(town.profile.activeMission.friendlyActorIds[0]).toBe('garrison:0')
    expect(town.profile.activeMission.borrowedActorIds).toEqual(['garrison:0'])
    expect(town.mission.startActiveMission).toHaveBeenCalledOnce()
    expect(town.careerMounts.activate).toHaveBeenCalledWith('horse')
    expect(town.closePanel).toHaveBeenCalledOnce()
    expect(town.player.group.position).toEqual(position)
    expect(town.dispose).not.toHaveBeenCalled(); expect(town.onRestart).not.toHaveBeenCalled()
    f.controller.dispose()
  })
  it('walks two borrowed cavalry from home to muster and departs with Player far away', () => {
    const f = fixture({ borrowedSlots: [0, 1], livingSlots: [0, 1], joinAssembly: false }), c = f.controller
    const starts = f.residents.map(r => r.npc.combatPosition.clone())
    expect(c.phase).toBe('ASSEMBLING'); expect(c.onMarchStarted).not.toHaveBeenCalled()
    f.player.combatPosition.set(-200, 0, 200)
    const combat = combatFixture({ controllers: { field: c }, simulation: {
      player: () => f.player as unknown as Player, residents: f.residents, navigation: c.navigation,
      obstacles: [], cameraPosition: new THREE.Vector3(20, 30, -82),
    } }).combat
    let elapsed = 0
    advanceUntil(() => c.phase === 'MARCHING', () => { combat.update(.05, 0, elapsed); elapsed += .05 }, {
      maxSimulationSeconds: 90, secondsPerStep: .05, failureMessage: 'two Sweep riders must physically reach muster',
    })
    expect(f.residents.every((r, i) => r.npc.combatPosition.distanceTo(starts[i]) > 20)).toBe(true)
    expect(f.player.combatPosition.distanceTo(c.leader.combatPosition)).toBeGreaterThan(200)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
  })
  it('retains a borrowed casualty identity through checkpoint reload without replacing or disposing it', () => {
    const f = fixture({ borrowedSlots: [0, 1], livingSlots: [0, 1] }), c = f.controller
    const casualty = f.residents[1].npc, ids = [...f.profile().activeMission!.friendlyActorIds]
    casualty.takeDamage(999999); c.updateFlow(5, 0); f.reload()
    expect(f.profile().activeMission!.friendlyActorIds).toEqual(ids)
    expect(f.profile().activeMission!.deadFriendlyActorIds).toContain(casualty.combatantId)
    expect(casualty.dead).toBe(true)
    expect(c.friendlies.filter((npc: NPC) => npc.combatantId === casualty.combatantId)).toEqual([casualty])
    c.dispose()
    expect(f.residents.every(r => r.npc.group.parent === c.scene && r.homeMount.group.parent === c.scene)).toBe(true)
  })
  it('uses Bandit cleanup while borrowed actors remain and temporary cavalry leave before disposal', () => {
    const f = fixture(), c = f.controller
    const borrowed = f.residents.map(resident => resident.npc)
    const temporary = [...c.temporaryCavalry]
    c.commit(clearCareerMission(f.profile(), 'sweep'))
    completeNpcDeployment(() => c.cleanupMission(0, true), f.driver)
    expect(c.missionBandits).toHaveLength(0); expect(c.ambientBandits).toHaveLength(2)
    expect(c.friendlies).toHaveLength(0); expect(c.departingNpcs).toHaveLength(1)
    expect(temporary.every(rider => rider.npc.group.parent === c.scene && rider.npc.tacticalOrder === 'formation')).toBe(true)
    expect(borrowed.every(npc => npc.group.parent === c.scene)).toBe(true)
    expect(c.combatPeersFor(temporary[0].npc)).toEqual([])
    for (const rider of temporary) rider.mount.group.position.x = -285
    c.updateDepartingCavalry()
    expect(c.departingNpcs).toHaveLength(0); expect(c.cavalryMounts).toHaveLength(0)
    expect(temporary.every(rider => rider.npc.group.parent === null && rider.mount.group.parent === null)).toBe(true)
    c.dispose()
  })
  it('wires native Captain and Maki mounts, one follower per squad and the Bandit alert-to-charge transition', () => {
    // Four riders retain real mount/equipment/Follow/Charge behavior; full IDs/specs have data and recording owners.
    const f = fixture({ borrowedSlots: [], livingSlots: [0, 1, 29, 30], enemyCount: 1 }), c = f.controller
    expect(c.missionBandits).toHaveLength(1); expect(c.friendlies).toHaveLength(4); expect(c.cavalryMounts).toHaveLength(4)
    expect(c.missionBandits.every((npc: NPC) => npc.faction === Faction.BANDIT && npc.meleeWeaponId === 'rusty_dagger')).toBe(true)
    expect(c.friendlies.every((npc: NPC) => npc.isMounted)).toBe(true)
    const captain = c.friendlies.find((npc: NPC) => npc.name === 'Captain'), maki = c.friendlies.find((npc: NPC) => npc.name === 'Maki')
    expect(maki.activeFollowTarget).toBe(captain)
    for (const npc of c.friendlies.filter((n: NPC) => n !== captain && n !== maki)) expect(npc.activeFollowTarget).toBe(npc.squadId === 1 ? captain : maki)
    expect((captain as any).formationTarget.speedLimit).toBe(Math.min(...c.cavalryMounts.map((m: any) => m.baseSpeed)))
    expect((captain as any).formationTarget.speedLimit).toBeGreaterThan(7.5)
    expect((captain as any).formationTarget.position.z).toBe(SWEEP_CENTER.z)
    c.updateFlow(.1, 0)
    expect(c.missionBandits.every((npc: NPC) => !npc.encounterIsAlerted)).toBe(true)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    f.player.combatPosition.copy(SWEEP_CENTER.clone().add(new THREE.Vector3(-79, 0, 0)))
    c.updateFlow(.1, 0)
    expect(c.missionBandits.every((npc: NPC) => npc.encounterIsAlerted && (npc as any).alertSprite.visible)).toBe(true)
    c.missionBandits.forEach((npc: any) => { npc.alertSprite.visible = false })
    c.updateFlow(.1, 0)
    expect(c.missionBandits.every((npc: any) => !npc.alertSprite.visible)).toBe(true)
    captain.mount.group.position.copy(SWEEP_CENTER.clone().add(new THREE.Vector3(-60, 0, 0)))
    c.updateFlow(.1, 0); c.updateFlow(.1, 0)
    expect(f.profile().activeMission!.phase).toBe('ENGAGING')
    expect(c.onSweepCharge).toHaveBeenCalledOnce()
    expect(c.friendlies.every((npc: NPC) => npc.tacticalOrder === 'charge' && npc.activeFollowTarget === null)).toBe(true)
    expect(c.friendlies.map((npc: NPC) => npc.combatantId)).toEqual(['sweep:cavalry:0', 'sweep:cavalry:1', 'sweep:cavalry:29', 'sweep:cavalry:30'])
    expect(c.missionBandits.map((npc: NPC) => npc.combatantId)).toEqual(['sweep:bandit:0'])
    expect(maki.mount.type).toBe(MountType.BLACK_CAT)
    c.dispose()
  })
  it('reloads two charging riders without replaying Follow or Charge voices', () => {
    const f = fixture({ enemyCount: 1 }), c = f.controller
    c.leader.mount.group.position.copy(SWEEP_CENTER.clone().add(new THREE.Vector3(-60, 0, 0)))
    c.updateFlow(.1, 0)
    expect(c.phase).toBe('ENGAGING'); expect(c.onSweepCharge).toHaveBeenCalledOnce()
    f.reload()
    expect(c.friendlies).toHaveLength(2)
    expect(c.friendlies.every((npc: NPC) => npc.tacticalOrder === 'charge')).toBe(true)
    expect(c.onMarchStarted).toHaveBeenCalledOnce(); expect(c.onSweepCharge).toHaveBeenCalledOnce()
  })
  it.each(['Captain', 'Maki'])('replaces %s during travel and preserves casualties and march intent on reload', leader => {
    const f = fixture({ borrowedSlots: [], livingSlots: [0, 1, 29, 30], enemyCount: 1 }), c = f.controller
    const npc = c.friendlies.find((n: NPC) => n.name === leader)
    npc.takeDamage(999999)
    c.missionBandits[0].takeDamage(999999)
    f.player.dead = true
    c.updateFlow(.1, 0)
    expect(f.profile().activeMission).toMatchObject({ phase: 'MARCHING', playerDead: true })
    expect(f.profile().activeMission!.deadFriendlyActorIds).toContain(npc.combatantId)
    const replacement = c.friendlies.find((n: NPC) => !n.dead && n.squadId === npc.squadId)!
    if (leader === 'Captain') {
      expect(replacement.activeFollowTarget).toBeNull()
      expect(replacement.formationCommandId).toBe(1)
      expect(c.friendlies.find((n: NPC) => n.name === 'Maki').activeFollowTarget).toBe(replacement)
    } else expect(replacement.activeFollowTarget).toBe(c.friendlies.find((n: NPC) => n.name === 'Captain'))
    expect(c.onSweepCharge).not.toHaveBeenCalled()
    f.reload()
    expect(c.friendlies).toHaveLength(3); expect(c.missionBandits).toHaveLength(0)
    expect(c.friendlies.every((n: NPC) => n.tacticalOrder === 'formation' || n.tacticalOrder === 'follow')).toBe(true)
    expect(c.friendlies.some((n: NPC) => n.combatantId === npc.combatantId)).toBe(false)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    expect(f.profile().activeMission!.playerDead).toBe(true)
    c.dispose()
  })
  it('restores march progress, stats and dead actors without replaying Follow', () => {
    const f = fixture({ borrowedSlots: [], livingSlots: [0, 1], enemyCount: 1 }), c = f.controller
    c.leader.mount.group.position.x = SWEEP_CAPTAIN_START.x + 60
    c.friendlies[1].takeDamage(999999)
    damageNpc(c.missionBandits[0], 999999, { source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' }, method: 'melee', emit: c.events.emit })
    c.updateFlow(5, 0)
    const checkpoint = c.tracker.checkpoint()
    expect(checkpoint.damageDealt).toBeGreaterThan(0); expect(checkpoint.kills).toBe(1)
    f.reload()
    expect(f.profile().activeMission!.phase).toBe('MARCHING')
    expect(f.profile().activeMission!.mountedMarchPosition).toEqual({ x: SWEEP_CAPTAIN_START.x + 60, z: c.leader.combatPosition.z })
    expect(c.leader.combatPosition.x).toBe(SWEEP_CAPTAIN_START.x + 60)
    expect(c.tracker.checkpoint()).toEqual(checkpoint)
    expect(c.friendlies).toHaveLength(1); expect(c.missionBandits).toHaveLength(0)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    c.dispose()
  })
  it('reloads encounter casualties, rider health and positions without persisting temporary threats or replacing lost mounts', () => {
    const f = fixture({ borrowedSlots: [], livingSlots: [0, 1, 2] }), c = f.controller
    const member = c.friendlies[1], casualty = c.friendlies[2]
    const source = combatActor('roaming', Faction.BANDIT)
    source.group.position.copy(member.combatPosition).x += 3
    const lostMount = member.mount
    lostMount.takeDamage(999999)
    member.takeDamage(7); casualty.takeDamage(999999)
    c.noteTravelHit(member, source, { owns: (npc: NPC) => npc === source })
    expect(c.travelEncounter.active).toBe(true)
    c.persistRuntimeProgress(true)
    const position = member.combatPosition.clone(), hp = member.hp, actorId = member.combatantId
    expect(JSON.stringify(f.profile().activeMission)).not.toContain('engagementOrigin')
    expect(f.profile().activeMission.targetActorIds).not.toContain(source.combatantId)
    f.reload()
    const restored = c.friendlies.find((npc: NPC) => npc.combatantId === actorId)
    expect(c.travelEncounter.active).toBe(false)
    expect(c.phase).toBe('MARCHING')
    expect(restored.hp).toBe(hp)
    expect(restored.isMounted).toBe(false)
    expect(restored.combatPosition.x).toBeCloseTo(position.x)
    expect(restored.combatPosition.z).toBeCloseTo(position.z)
    expect(c.friendlies.some((npc: NPC) => npc.combatantId === casualty.combatantId)).toBe(false)
    c.dispose()
  })
  it('reuses the Bandit return route after victory and reloads the surviving party without respawning enemies', () => {
    const f = fixture(), c = f.controller
    c.leader.mount.group.position.copy(SWEEP_CENTER)
    c.missionBandits.forEach((npc: NPC) => npc.takeDamage(999999))
    c.persistRuntimeProgress(true)
    const claimed = claimCareerMission(f.profile(), 'sweep', 'victory', { damageDealt: 20, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true })
    c.commit(claimed.profile)
    f.reload()
    expect(c.phase).toBe('RESULT'); expect(c.missionBandits).toHaveLength(0)
    expect(c.friendlies.filter((npc: NPC) => !npc.dead)).toHaveLength(2)
    const leaderPosition = c.leader.combatPosition.clone()
    expect(c.startReturning()).toBe(true)
    expect(c.phase).toBe('RETURNING'); expect(c.leader.combatPosition).toEqual(leaderPosition)
    expect(c.friendlies.filter((npc: NPC) => !npc.dead && npc !== c.leader).every((npc: NPC) => npc.activeFollowTarget === c.leader)).toBe(true)
    const assembly = c.assemblyPoint()
    expect(c.leader.formationTarget.position).toEqual(assembly)
    c.leader.mount.group.position.set(80, 0, -140)
    c.updateFlow(5, 0)
    f.reload()
    expect(c.phase).toBe('RETURNING'); expect(c.missionBandits).toHaveLength(0)
    expect(c.leader.combatPosition.x).toBe(80); expect(c.leader.combatPosition.z).toBe(-140)
    expect(c.leader.formationTarget.position).toEqual(assembly)
    expect(c.onMarchStarted).toHaveBeenCalledOnce(); expect(c.onSweepCharge).not.toHaveBeenCalled()
    c.leader.mount.group.position.copy(assembly)
    f.player.combatPosition.copy(SWEEP_CENTER)
    expect(c.partyReturned).toBe(true); expect(c.returnComplete).toBe(false)
    f.player.combatPosition.copy(assembly)
    expect(c.returnComplete).toBe(true)
    c.dispose()
  })
  it('passes living cavalry, remaining Bandits and target registration to the shared outcome policy', () => {
    const outcome = vi.spyOn(missionOutcomePolicy, 'resolveCareerMissionOutcome')
    onTestFinished(() => outcome.mockRestore())
    const f = fixture({ livingSlots: [0], enemyCount: 1 }), c = f.controller
    f.player.dead = true
    expect(c.remainingEnemies).toBe(1)
    expect(c.evaluate(true)).toBeNull()
    expect(outcome).toHaveBeenLastCalledWith(true, true, 1, 1, true)

    // A not-yet-registered target must not become an apparent cleared objective.
    const unregistered: NPC = c.camps[0].mission.shift()
    try {
      expect(c.remainingEnemies).toBe(0)
      expect(c.evaluate(true)).toBeNull()
      expect(outcome).toHaveBeenLastCalledWith(true, false, 0, 1, true)
    } finally {
      c.camps[0].mission.unshift(unregistered)
    }
  })
  it('claims offense merit once and records dead-player victory without materializing actors', () => {
    const profile = acceptCavalrySweep(ready(), 'sweep')!
    const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
    const first = claimCareerMission(profile, 'sweep', 'victory', stats)
    expect(first.profile.activeMission!.result).toMatchObject({ outcome: 'victory', stats: { survived: false } })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(first.profile)))!
    const second = claimCareerMission(loaded, 'sweep', 'victory', stats)
    expect(second.meritAwarded).toBe(0); expect(second.profile.totalMerit).toBe(first.profile.totalMerit)
    const next = clearCareerMission(second.profile, 'sweep')
    expect(next.ownedHorseTiers).toEqual(ready().ownedHorseTiers); expect(next.activeMission).toBeUndefined()

  })
  it('retries Charge persistence before releasing either squad', () => {
    const roster = createSweepRoster('roman').map(s => ({ ...s, dead: false, mount: { baseSpeed: 10 }, combatPosition: SWEEP_CENTER.clone(), setTacticalOrder: vi.fn(), assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn() }))
    const commit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true), voice = vi.fn()
    const march = new MountedMissionMarchController(roster as any, SWEEP_CENTER, vi.fn(), commit, voice, false, { chargeDistance: 60, followerCount: 29 })
    march.start(); march.update()
    expect(march.hasCharged).toBe(false); expect(voice).not.toHaveBeenCalled()
    expect(roster.every(n => n.setTacticalOrder.mock.calls.length === 0)).toBe(true)
    march.update(); march.update()
    expect(march.hasCharged).toBe(true); expect(voice).toHaveBeenCalledOnce()
    expect(roster.every(n => n.setTacticalOrder.mock.calls.length === 1)).toBe(true)
  })
})
