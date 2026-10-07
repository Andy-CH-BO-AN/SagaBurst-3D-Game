import { advanceNpcFrame, completeNpcDeployment, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { withMissionCheckpoint } from '../helpers/missionCheckpoint'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { acceptCavalrySweep, createCavalrySweepMission, createSweepRoster, CAVALRY_SWEEP_ID, SWEEP_CENTER, SWEEP_CAPTAIN_START, sweepBanditPosition, sweepPlayerSpawn } from '../../src/career/CavalrySweep'
import { availableRecruitMissions } from '../../src/career/CareerMissionCatalog'
import { CAREER_RANKS, claimCareerMission, clearCareerMission, createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { BanditMissionController, selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { MountedMissionMarchController } from '../../src/career/MountedMissionMarch'
import { MAX_COMMAND_SQUAD_SIZE } from '../../src/battle/CommandTarget'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { damageNpc } from '../../src/combat/DamageRouter'
import { CombatEventStream } from '../../src/combat/CombatAttribution'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownWorld } from '../../src/town/TownWorld'
import { townRoster, townMilitaryEquipment } from '../../src/town/TownRules'
import { Mount, MountType } from '../../src/world/Mount'
import { TownScene } from '../../src/town/TownScene'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const npcConstruction = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../src/world/NPC', async original => {
  const actual = await original<typeof import('../../src/world/NPC')>()
  return { ...actual, NPC: class extends actual.NPC {
    constructor(...args: ConstructorParameters<typeof actual.NPC>) { super(...args); npcConstruction.count++ }
  } }
})
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
function fixture(garrisonCount = 0, joinAssembly = true, deferStart = false) {
  const scene = new THREE.Scene(), roster = createSweepRoster('roman')
  const townSpecs = townRoster(), cavalrySpecs = townSpecs.filter(spec => spec.role.includes('cavalry'))
  const residents = Array.from({ length: garrisonCount }, (_, index) => {
    const spec = { ...(index === 0 ? townSpecs.find(spec => spec.role === 'captain')! : index === 1 ? townSpecs.find(spec => spec.role === 'ranger')! : cavalrySpecs[(index - 2) % cavalrySpecs.length]), id: `garrison:${index}` }
    const spawn = roster[index === 1 ? 29 : index]
    const military = spec.role === 'ranger' ? null : townMilitaryEquipment('roman', spec.role)
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', spawn.aiType, spec.id, military?.level ?? spawn.tier, true, military?.loadout ?? spawn.loadout, spawn.presetId, undefined, spec.id)
    const mount = new Mount(scene, spec.role === 'ranger' ? MountType.BLACK_CAT : MountType.HORSE, spec.x, spec.z)
    onTestFinished(() => mount.dispose())
    npc.setTownPeaceful(); npc.mountVehicle(mount)
    return { spec, npc, homeMount: mount }
  })
  let profile = acceptCavalrySweep(ready(), 'sweep', selectMissionCavalryActorIds(residents, 59))!
  const player = { dead: false, combatPosition: sweepPlayerSpawn() }
  const controller = withMissionCheckpoint(Object.create(BanditMissionController.prototype)) as any
  Object.assign(controller, {
    scene, residents, world: { obstacles: [], camps: [{ spawnPoints: [new THREE.Vector3()] }] }, navigation: new NavigationWorld(),
    readProfile: () => profile, commit: vi.fn((next: typeof profile) => { profile = next; return true }), player: () => player,
    camps: [{ id: 0, center: new THREE.Vector3(), ambient: [], mission: [] }], friendlies: [], cavalryMounts: [], temporaryCavalry: [], departingCavalry: [], commandId: 1,
    veteranSurvivalElapsed: 0, veteranTargetActorIds: new Set(), veteranFriendlyActorIds: new Set(), borrowedMissionActors: new Set(),
    borrowedRespawnEnabled: new Map(), borrowedTemporaryMounts: [], fieldActorMounts: new Map(), veteranEnemies: [],
    veteranEnemySquadList: [], veteranMusterPositions: new Map(), veteranSupportEntryPositions: new Map(), veteranEnemyTownActorIds: new Set(),
    veteranEnemySquadByActorId: new Map(), veteranDamageActivationUnsubscribe: null,
    guide: { hide: vi.fn(), update: vi.fn(), dispose: vi.fn() }, events: new CombatEventStream(), tracker: null, route: [], routeIndex: 0,
    onMarchStarted: vi.fn(), onSweepCharge: vi.fn(), mountedMarch: null, veteranFieldFactories: {},
  })
  if (!deferStart) completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver)
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
  return { controller, player, residents, assemble, profile: () => profile, reload: () => { controller.dispose(); profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!; completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver) } }
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

describe('Sweep runtime and checkpoint', () => {
  it('reserves the existing Captain and Maki slots, including an unmounted Maki with her home cat', () => {
    const f = fixture(21, false)
    const captain = f.residents[0], maki = f.residents[1]
    maki.npc.dismountFromMount()
    const ids = selectMissionCavalryActorIds(f.residents, 59)
    expect(ids[0]).toBe(captain.npc.combatantId)
    expect(ids[29]).toBe(maki.npc.combatantId)
    expect(ids.filter(Boolean)).toHaveLength(21)
    expect(new Set(ids.filter(Boolean)).size).toBe(21)
    f.controller.disposeMissionEntities()
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(maki.npc.mount).toBe(maki.homeMount)
    expect(f.controller.friendlies[29]).toBe(maki.npc)
    expect(f.controller.temporaryCavalry.some(({ npc }: { npc: NPC }) => npc.name === 'Captain' || npc.name === 'Maki')).toBe(false)
    f.controller.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('temporarily equips borrowed riders and restores their equipment, tier, squad and respawn setting', () => {
    const f = fixture(21, false), c = f.controller
    const rider = f.residents[2].npc
    c.disposeMissionEntities()
    const original = { weapon: rider.meleeWeaponId, ranged: rider.rangedWeaponId, shield: rider.shieldId, tier: rider.tier, squad: rider.squadId }
    const equip = vi.spyOn(rider, 'applyTemporaryCombatLoadout')
    rider.respawnEnabled = true
    completeNpcDeployment(() => c.startActiveMission(), gameplayNpcSpawnDriver)
    expect(equip).toHaveBeenCalledWith(expect.objectContaining({ meleeWeaponId: expect.any(String) }), undefined, 1)
    expect(rider.meleeWeaponId).not.toBe(original.weapon)
    expect(rider.tier).toBe(original.tier)
    expect(rider.respawnEnabled).toBe(false)
    c.dispose()
    expect({ weapon: rider.meleeWeaponId, ranged: rider.rangedWeaponId, shield: rider.shieldId, tier: rider.tier, squad: rider.squadId }).toEqual(original)
    expect(rider.respawnEnabled).toBe(true)
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('spawns only missing riders far outside town, then sends them through the entry before muster', () => {
    const f = fixture(21, false), c = f.controller
    const support = c.temporaryCavalry.map(({ npc }: { npc: NPC }) => npc)
    expect(support).toHaveLength(38)
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
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('departs at 90 percent of living riders and lets the remaining riders catch up', () => {
    const f = fixture(59, false), c = f.controller
    const required = Math.ceil(c.friendlies.length * .9)
    for (const npc of c.friendlies.slice(0, required - 1)) {
      npc.mount.group.position.copy(npc.formationTarget.position); npc.formationTarget.reached = true
    }
    for (const npc of c.friendlies.slice(required - 1)) npc.mount.group.position.set(-200, 0, 0)
    f.player.combatPosition.set(-200, 0, 200)
    c.updateFlow(.1, 0)
    expect(c.phase).toBe('ASSEMBLING')
    expect(c.onMarchStarted).not.toHaveBeenCalled()
    const arrival = c.friendlies[required - 1]
    arrival.mount.group.position.copy(arrival.formationTarget.position); arrival.formationTarget.reached = true
    const stragglers = c.friendlies.slice(required), positions = stragglers.map((npc: NPC) => npc.combatPosition.clone())
    c.updateFlow(.1, 0)
    expect(c.phase).toBe('MARCHING')
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    expect(stragglers.map((npc: NPC) => npc.combatPosition)).toEqual(positions)
    expect(stragglers.every((npc: NPC) => npc.activeFollowTarget)).toBe(true)
    c.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('restores each borrowed and temporary rider at its checkpoint rather than a leader-relative formation', () => {
    const f = fixture(21), c = f.controller
    const riders = [c.friendlies[0], c.friendlies[1], c.friendlies[29], c.friendlies[58]] as NPC[]
    riders.forEach((npc, index) => npc.mount!.group.position.set(20 + index * 13, 0, -90 - index * 17))
    const positions = new Map(riders.map(npc => [npc.combatantId, npc.combatPosition.clone()]))
    c.persistRuntimeProgress(true)
    f.reload()
    for (const [id, point] of positions) {
      const npc = c.friendlies.find((npc: NPC) => npc.combatantId === id)
      expect(npc.combatPosition.x).toBe(point.x); expect(npc.combatPosition.z).toBe(point.z)
    }
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    c.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('accepts a sweep in place, saves the borrowed roster and keeps the existing Town scene', () => {
    const f = fixture(21, false), town = Object.create(TownScene.prototype) as any
    town.profile = ready(); town.store = { load: () => town.profile }; town.residents = f.residents
    town.event = { hostile: false }; town.player = { dead: false, group: new THREE.Group(), faceDirection: vi.fn() }
    town.mission = { fieldNpcs: [], startActiveMission: vi.fn(() => true) }
    town.commit = vi.fn(next => { town.profile = next; return true })
    town.careerMounts = { activate: vi.fn() }; town.inventory = { prepareForCombat: vi.fn() }
    town.closePanel = vi.fn(); town.dispose = vi.fn(); town.onRestart = vi.fn()
    const position = town.player.group.position.clone()
    town.acceptMission(CAVALRY_SWEEP_ID)
    const selected = selectMissionCavalryActorIds(f.residents, 59)
    selected.forEach((id, slot) => { if (id) expect(town.profile.activeMission.friendlyActorIds[slot]).toBe(id) })
    expect(town.profile.activeMission.borrowedActorIds).toEqual(selected.filter(Boolean))
    expect(town.mission.startActiveMission).toHaveBeenCalledOnce()
    expect(town.careerMounts.activate).toHaveBeenCalledWith('horse')
    expect(town.closePanel).toHaveBeenCalledOnce()
    expect(town.player.group.position).toEqual(position)
    expect(town.dispose).not.toHaveBeenCalled(); expect(town.onRestart).not.toHaveBeenCalled()
    f.controller.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('walks existing cavalry from their home positions to muster and departs without waiting for Player', () => {
    const f = fixture(21, false), c = f.controller
    expect(f.profile().activeMission!.phase).toBe('ASSEMBLING')
    for (const resident of f.residents) expect(resident.npc.combatPosition).toEqual(new THREE.Vector3(resident.spec.x, resident.homeMount.group.position.y, resident.spec.z))
    expect(c.onMarchStarted).not.toHaveBeenCalled()
    f.player.combatPosition.set(-200, 0, 200)
    for (const npc of c.friendlies) {
      const target = (npc as any).formationTarget
      npc.mount.group.position.copy(target.position); target.reached = true
    }
    c.updateFlow(.1, 0)
    expect(f.profile().activeMission!.phase).toBe('ASSEMBLING')
    f.assemble(false)
    expect(f.player.combatPosition.distanceTo(c.leader.combatPosition)).toBeGreaterThan(12)
    expect(f.profile().activeMission!.phase).toBe('MARCHING')
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    expect((c.leader as any).formationTarget.position).toEqual(SWEEP_CENTER)
    c.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it.each([21, 59])('borrows %s mounted garrison actors and creates only the missing cavalry', count => {
    const f = fixture(count), c = f.controller
    expect(c.friendlies).toHaveLength(59)
    expect(c.temporaryCavalry).toHaveLength(59 - count)
    expect(c.cavalryMounts).toHaveLength(59 - count)
    for (const resident of f.residents) {
      expect(c.friendlies).toContain(resident.npc)
      expect(resident.npc.mount).toBe(resident.homeMount)
    }
    expect(c.leader).toBe(f.residents.find(resident => resident.spec.role === 'captain')!.npc)
    const leader = c.leader
    expect(c.friendlies.every((npc: NPC) => npc === leader || npc.activeFollowTarget !== null)).toBe(true)
    const ids = [...f.profile().activeMission!.friendlyActorIds]
    const casualty = c.friendlies.find((npc: NPC) => npc !== leader && f.residents.some(resident => resident.npc === npc))
    casualty.takeDamage(999999); c.updateFlow(5, 0); f.reload()
    expect(f.profile().activeMission!.friendlyActorIds).toEqual(ids)
    expect(f.profile().activeMission!.deadFriendlyActorIds).toContain(casualty.combatantId)
    expect(casualty.dead).toBe(true)
    expect(c.friendlies.filter((npc: NPC) => npc.combatantId === casualty.combatantId)).toEqual([casualty])
    c.dispose()
    expect(f.residents.every(resident => resident.npc.group.parent === c.scene && resident.homeMount.group.parent === c.scene)).toBe(true)
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('uses Bandit cleanup while borrowed actors remain and temporary cavalry leave before disposal', () => {
    const f = fixture(21), c = f.controller
    const borrowed = f.residents.map(resident => resident.npc)
    const temporary = [...c.temporaryCavalry]
    c.commit(clearCareerMission(f.profile(), 'sweep'))
    completeNpcDeployment(() => c.cleanupMission(0, true), gameplayNpcSpawnDriver)
    expect(c.missionBandits).toHaveLength(0); expect(c.ambientBandits).toHaveLength(2)
    expect(c.friendlies).toHaveLength(0); expect(c.departingNpcs).toHaveLength(38)
    expect(temporary.every(rider => rider.npc.group.parent === c.scene && rider.npc.tacticalOrder === 'formation')).toBe(true)
    expect(borrowed.every(npc => npc.group.parent === c.scene)).toBe(true)
    expect(c.combatPeersFor(temporary[0].npc)).toEqual([])
    for (const rider of temporary) rider.mount.group.position.x = -285
    c.updateDepartingCavalry()
    expect(c.departingNpcs).toHaveLength(0); expect(c.cavalryMounts).toHaveLength(0)
    expect(temporary.every(rider => rider.npc.group.parent === null && rider.mount.group.parent === null)).toBe(true)
    c.dispose()
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it('spawns exactly 40 existing Bandits with hammers and 59 mounted cavalry, then alerts the whole mob once', () => {
    const f = fixture(), c = f.controller
    expect(c.missionBandits).toHaveLength(40); expect(c.friendlies).toHaveLength(59); expect(c.cavalryMounts).toHaveLength(59)
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
    f.reload()
    expect(c.friendlies.every((npc: NPC) => npc.tacticalOrder === 'charge')).toBe(true)
    expect(c.onMarchStarted).toHaveBeenCalledOnce(); expect(c.onSweepCharge).toHaveBeenCalledOnce()
    c.dispose()
  })
  it.each(['Captain', 'Maki'])('replaces %s during travel and preserves casualties and march intent on reload', leader => {
    const f = fixture(), c = f.controller
    const npc = c.friendlies.find((n: NPC) => n.name === leader)
    npc.takeDamage(999999)
    c.missionBandits[0].takeDamage(999999)
    f.player.dead = true
    c.updateFlow(.1, 0)
    expect(f.profile().activeMission).toMatchObject({ phase: 'MARCHING', playerDead: true, deadFriendlyActorIds: [npc.combatantId] })
    expect(c.onSweepCharge).not.toHaveBeenCalled()
    f.reload()
    expect(c.friendlies).toHaveLength(58); expect(c.missionBandits).toHaveLength(39)
    expect(c.friendlies.every((n: NPC) => n.tacticalOrder === 'formation' || n.tacticalOrder === 'follow')).toBe(true)
    expect(c.friendlies.some((n: NPC) => n.combatantId === npc.combatantId)).toBe(false)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    expect(f.profile().activeMission!.playerDead).toBe(true)
    c.dispose()
  })
  it('restores march progress, stats and dead actors without replaying Follow', () => {
    const f = fixture(), c = f.controller
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
    expect(c.friendlies).toHaveLength(58); expect(c.missionBandits).toHaveLength(39)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    c.dispose()
  })
  it('reloads encounter casualties, rider health and positions without persisting temporary threats or replacing lost mounts', () => {
    const f = fixture(), c = f.controller
    const member = c.friendlies[1], casualty = c.friendlies[2]
    const source = new NPC(new THREE.Scene(), member.combatPosition.x + 3, member.combatPosition.z, Faction.BANDIT, 'roman', AIType.MELEE, 'roaming', 1, false)
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
    source.dispose(); c.dispose()
  })
  it('reuses the Bandit return route after victory and reloads the surviving party without respawning enemies', () => {
    const f = fixture(21), c = f.controller
    c.leader.mount.group.position.copy(SWEEP_CENTER)
    c.missionBandits.forEach((npc: NPC) => npc.takeDamage(999999))
    c.friendlies[1].takeDamage(999999)
    c.persistRuntimeProgress(true)
    const claimed = claimCareerMission(f.profile(), 'sweep', 'victory', { damageDealt: 20, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true })
    c.commit(claimed.profile)
    f.reload()
    expect(c.phase).toBe('RESULT'); expect(c.missionBandits).toHaveLength(0)
    expect(c.friendlies.filter((npc: NPC) => !npc.dead)).toHaveLength(58)
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
    for (const resident of f.residents) { resident.npc.dispose(); resident.homeMount.dispose() }
  })
  it.each([[true, 1, 1, null], [true, 0, 1, 'failure'], [false, 0, 1, null], [true, 0, 0, 'victory'], [false, 1, 0, 'victory']] as const)('objective priority: dead=%s cavalry=%s bandits=%s => %s', (dead, allies, enemies, expected) => {
    const f = fixture(), c = f.controller
    f.player.dead = dead
    c.friendlies.forEach((n: NPC, i: number) => { if (i >= allies) n.takeDamage(999999) })
    c.missionBandits.forEach((n: NPC, i: number) => { if (i >= enemies) n.takeDamage(999999) })
    expect(c.evaluate(dead)).toBe(expected)
    c.dispose()
  })
  it('claims offense merit once, records dead-player victory, and cleans all temporary mounts', () => {
    const f = fixture(), c = f.controller
    const stats = { damageDealt: 200, damageTaken: 100, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
    const first = claimCareerMission(f.profile(), 'sweep', 'victory', stats)
    expect(first.profile.activeMission!.result).toMatchObject({ outcome: 'victory', stats: { survived: false } })
    const loaded = parseCareerProfile(JSON.parse(JSON.stringify(first.profile)))!
    const second = claimCareerMission(loaded, 'sweep', 'victory', stats)
    expect(second.meritAwarded).toBe(0); expect(second.profile.totalMerit).toBe(first.profile.totalMerit)
    const next = clearCareerMission(second.profile, 'sweep')
    expect(next.ownedHorseTiers).toEqual(ready().ownedHorseTiers); expect(next.activeMission).toBeUndefined()
    const mounts = [...c.cavalryMounts], npcs = [...c.friendlies, ...c.missionBandits]
    c.dispose()
    expect(mounts.every(m => m.group.parent === null)).toBe(true)
    expect(npcs.every(n => n.group.parent === null)).toBe(true)
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


describe('Sweep queued deployment readiness', () => {
  it('queues forty enemies and fifty-six missing riders, reuses three Town actors and delays departure readiness', () => {
    const h = fixture(3, false, true), before = npcConstruction.count
    const active = h.profile().activeMission!, borrowed = new Set(active.borrowedActorIds)
    const queuedIds = [...active.targetActorIds, ...active.friendlyActorIds.filter(id => !borrowed.has(id))]
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(npcConstruction.count).toBe(before)
    expect(h.controller.spawnBatches.flatMap((batch: { actors: Map<string, unknown> }) => [...batch.actors.keys()])).toEqual(queuedIds)
    expect(queuedIds).toHaveLength(96)
    expect(h.controller.friendlies).toEqual(expect.arrayContaining(h.residents.map(r => r.npc)))
    expect(h.controller.ready).toBe(false); expect(h.controller.evaluate(true)).toBeNull()
    h.controller.updateFlow(100, 0); expect(h.profile().activeMission!.phase).toBe('ASSEMBLING')

    advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(h.controller.missionBandits).toHaveLength(1)
    expect(h.controller.ready).toBe(false); expect(h.controller.evaluate(true)).toBeNull()
    // Scheduler cadence is owned centrally; this caller checks its last missing rider readiness gate.
    for (let remaining = 2; remaining < queuedIds.length; remaining++) advanceNpcFrame(gameplayNpcSpawnDriver)
    expect(h.controller.friendlies).toHaveLength(58)
    expect(h.controller.missionBandits).toHaveLength(40)
    expect(h.controller.ready).toBe(false); expect(h.controller.evaluate(true)).toBeNull()
    h.controller.updateFlow(100, 0); expect(h.profile().activeMission!.phase).toBe('ASSEMBLING')
    advanceNpcFrame(gameplayNpcSpawnDriver)

    expect(npcConstruction.count - before).toBe(96)
    expect(h.controller.ready).toBe(true); expect(h.controller.friendlies).toHaveLength(59)
    expect(h.controller.missionBandits).toHaveLength(40)
    expect(h.controller.friendlies.map((npc: NPC) => npc.combatantId)).toEqual(active.friendlyActorIds)
    expect(h.controller.missionBandits.map((npc: NPC) => npc.combatantId)).toEqual(active.targetActorIds)
    h.residents.forEach(r => expect(h.controller.friendlies).toContain(r.npc))
    expect(h.controller.friendlies.every((npc: NPC) => npc.mount?.riderNpc === npc)).toBe(true)
    h.controller.dispose(); h.residents.forEach(r => { r.npc.dispose(); r.homeMount.dispose() })
  })
})
