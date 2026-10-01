import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { acceptCavalrySweep, createCavalrySweepMission, createSweepRoster, CAVALRY_SWEEP_ID, SWEEP_CENTER, SWEEP_CAPTAIN_START, sweepBanditPosition, sweepPlayerSpawn } from '../src/career/CavalrySweep'
import { availableRecruitMissions } from '../src/career/CareerMissionCatalog'
import { CAREER_RANKS, claimCareerMission, clearCareerMission, createCareerProfile } from '../src/career/CareerProfile'
import { parseCareerProfile } from '../src/career/CareerProfileStore'
import { BanditMissionController } from '../src/career/BanditMissionController'
import { MountedMissionMarchController } from '../src/career/MountedMissionMarch'
import { MAX_COMMAND_SQUAD_SIZE } from '../src/battle/CommandTarget'
import { NPC, Faction } from '../src/world/NPC'
import { damageNpc } from '../src/combat/DamageRouter'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { NavigationWorld } from '../src/navigation/NavigationWorld'
import { TownWorld } from '../src/town/TownWorld'
import { installCorgiTestAsset } from './helpers/corgiAsset'
import { installBlackCatTestAsset } from './helpers/blackCatAsset'

vi.mock('../src/world/HorseAssetRegistry', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/HorseAssetRegistry')>()), HorseAssetRegistry: { ready: true, createInstance: () => {
  const root = new THREE.Group(), saddleSeat = new THREE.Object3D(); saddleSeat.position.y = 1.7; root.add(saddleSeat)
  return { root, saddleSeat, lod: new THREE.LOD(), skeleton: null, setLocomotion: vi.fn(), setAppearanceVariant: vi.fn(), playOnce: vi.fn(), playDeath: vi.fn(), update: vi.fn(), dispose: vi.fn() }
} } }))
vi.mock('../src/world/MakiRangerEquipment', async importOriginal => ({ ...(await importOriginal<typeof import('../src/world/MakiRangerEquipment')>()), createMakiRangerBowInstance: () => ({
  model: new THREE.Group(), topTip: new THREE.Vector3(0, .8, 0), bottomTip: new THREE.Vector3(0, -.8, 0),
  profile: { id: 'maki-ranger-bow', gripRadius: .02, gripLength: .2, visualScale: 1, gripCenterLocal: new THREE.Vector3(), shootingAxis: new THREE.Vector3(0, 0, -1), longitudinalAxis: new THREE.Vector3(0, 1, 0), contactNormal: new THREE.Vector3(1, 0, 0) }
}) }))

beforeAll(async () => { await installBlackCatTestAsset(); await installCorgiTestAsset() })
afterEach(() => vi.unstubAllGlobals())

function ready() { return { ...createCareerProfile('roman'), ownedHorseTiers: [1] as (1 | 2 | 3)[] } }
function fixture() {
  let profile = acceptCavalrySweep(ready(), 'sweep')!
  const player = { dead: false, combatPosition: sweepPlayerSpawn() }
  const controller = Object.create(BanditMissionController.prototype) as any
  Object.assign(controller, {
    scene: new THREE.Scene(), world: { obstacles: [] }, navigation: new NavigationWorld(),
    readProfile: () => profile, commit: vi.fn((next: typeof profile) => { profile = next; return true }), player: () => player,
    camps: [{ id: 0, center: new THREE.Vector3(), ambient: [], mission: [] }], friendlies: [], cavalryMounts: [],
    guide: { hide: vi.fn(), dispose: vi.fn() }, events: new CombatEventStream(), tracker: null, route: [], routeIndex: 0,
    statsCheckpointElapsed: 0, onMarchStarted: vi.fn(), onSweepCharge: vi.fn(), mountedMarch: null,
  })
  controller.startActiveMission()
  return { controller, player, profile: () => profile, reload: () => { profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!; controller.startActiveMission() } }
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
    expect(accepted.selectedMountId).toBe('horse-t1')
    expect(accepted.ownedHorseTiers).toEqual(profile.ownedHorseTiers)
    expect(accepted.ownedMounts).toEqual(profile.ownedMounts)
    expect(profile.selectedMountId).toBe('corgi')
    expect(acceptCavalrySweep({ ...ready(), selectedMountId: 'horse-t1' })!.selectedMountId).toBe('horse-t1')
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
  it('uses the existing terrain with a clear full-width charge lane and a single loose mob', () => {
    // Geometry-only validation; no browser or WebGL renderer is involved.
    const ctx = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => (target as any)[key] ?? (() => {}) })
    vi.stubGlobal('ImageData', class { constructor(public data: unknown, public width: number, public height: number) {} })
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) })
    const world = new TownWorld(faction, new THREE.Scene())
    const bandits = Array.from({ length: 40 }, (_, i) => sweepBanditPosition(i))
    expect(new Set(bandits.map(p => `${p.x},${p.z}`)).size).toBe(40)
    const lane = new THREE.Box3(new THREE.Vector3(-145, -100, -299), new THREE.Vector3(145, 100, -250))
    expect(world.obstacles.some(o => lane.intersectsBox(o.box))).toBe(false)
    for (const p of [...bandits, ...createSweepRoster(faction).map(s => new THREE.Vector3(s.x, 0, s.z))]) {
      expect(Math.abs(p.x)).toBeLessThan(300); expect(Math.abs(p.z)).toBeLessThan(300)
    }
    world.dispose()
  })
})

describe('Sweep runtime and checkpoint', () => {
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
    expect((captain as any).formationTarget.position.z).toBe(SWEEP_CAPTAIN_START.z)
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
  it.each(['Captain', 'Maki'])('persists Charge and casualties when %s falls; reload never follows or respawns them', leader => {
    const f = fixture(), c = f.controller
    const npc = c.friendlies.find((n: NPC) => n.name === leader)
    npc.takeDamage(999999)
    c.missionBandits[0].takeDamage(999999)
    f.player.dead = true
    c.updateFlow(.1, 0)
    expect(f.profile().activeMission).toMatchObject({ phase: 'ENGAGING', playerDead: true, deadFriendlyActorIds: [npc.combatantId] })
    expect(c.onSweepCharge).toHaveBeenCalledTimes(leader === 'Captain' ? 0 : 1)
    f.reload()
    expect(c.friendlies).toHaveLength(58); expect(c.missionBandits).toHaveLength(39)
    expect(c.friendlies.every((n: NPC) => n.tacticalOrder === 'charge')).toBe(true)
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
    expect(f.profile().activeMission!.mountedMarchProgress).toBe(60)
    expect(c.leader.combatPosition.x).toBe(SWEEP_CAPTAIN_START.x + 60)
    expect(c.tracker.checkpoint()).toEqual(checkpoint)
    expect(c.friendlies).toHaveLength(58); expect(c.missionBandits).toHaveLength(39)
    expect(c.onMarchStarted).toHaveBeenCalledOnce()
    c.dispose()
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
