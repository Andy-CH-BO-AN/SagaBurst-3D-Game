import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from './CareerProfile'
import { acceptCareerOutpostRelief, claimCareerOutpost, clearCareerOutpost, isCareerOutpostReliefUnlocked } from './CareerOutpostMission'
import { CareerProfileStore, parseCareerProfile } from './CareerProfileStore'
import { createCareerOutpostLaunch } from './CareerOutpostLaunch'
import { CareerReliefMarchController, createCareerReliefSpawnPlan, initializeCareerReliefBattlefield } from './CareerOutpostRelief'
import { DefenseCampaignRuntime } from '../campaign/DefenseCampaignRuntime'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../campaign/CampaignOutpost'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { AIType, Faction, NPC } from '../world/NPC'
import { MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import { ArmyCommandController } from '../battle/ArmyCommandController'
import type { ArmyCommandUI } from '../ui/ArmyCommandUI'
import type { PlayerInput } from '../player/PlayerInput'
import { InventoryManager } from '../rpg/InventoryManager'
import { Game } from '../Game'
import { calculateMerit } from './MeritCalculator'

function ready(faction: 'roman' | 'viking' = 'roman'): CareerProfile {
  return { ...createCareerProfile(faction), rank: 'soldier', totalMerit: 300, availableMerit: 300,
    completedOutpostStages: [1, 2, 3], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }
}
function launch(faction: 'roman' | 'viking' = 'roman') { return createCareerOutpostLaunch(acceptCareerOutpostRelief(ready(faction), 'relief')!) }
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } as Storage
}
afterEach(() => vi.unstubAllGlobals())

describe('Career relief unlock and owned mounts', () => {
  it('requires all three Career victories, legal ownership, and an idle mission slot', () => {
    for (const stage of [1, 2, 3]) expect(isCareerOutpostReliefUnlocked({ ...ready(), completedOutpostStages: ready().completedOutpostStages!.filter(id => id !== stage) })).toBe(false)
    expect(acceptCareerOutpostRelief({ ...ready(), rank: 'recruit' })).toBeNull()
    expect(acceptCareerOutpostRelief({ ...ready(), ownedHorseTiers: [], ownedMounts: [] })).toBeNull()
    const current = acceptCareerOutpostRelief(ready(), 'one')!
    expect(acceptCareerOutpostRelief(current, 'two')).toBeNull()
    expect(acceptCareerOutpostRelief({ ...ready(), townEvent: { id: 'hostile', state: 'hostile' } })).toBeNull()
  })
  it('preserves a legal selection and falls back without granting ownership', () => {
    const profile = { ...ready(), ownedHorseTiers: [1, 2] as (1 | 2)[], selectedMountId: 'horse-t2' as const }
    const accepted = acceptCareerOutpostRelief(profile)!
    expect(accepted.selectedMountId).toBe('horse-t2')
    expect(createCareerOutpostLaunch(accepted)).toMatchObject({ playerLoadout: { startMounted: true, mountId: 'horse' }, playerMountAppearanceVariant: 1 })
    const fallback = acceptCareerOutpostRelief({ ...profile, selectedMountId: 'corgi', ownedMounts: ['corgi'] })!
    expect(fallback.selectedMountId).toBe('horse-t1')
    expect(fallback.ownedMounts).toEqual(['corgi'])
    expect(fallback.ownedHorseTiers).toEqual([1, 2])
    expect(profile.selectedMountId).toBe('horse-t2')
    expect(() => createCareerOutpostLaunch({ ...fallback, ownedHorseTiers: [], ownedMounts: [] })).toThrow('owned legal mount')
  })
})

describe.each(['roman', 'viking'] as const)('%s relief battlefield and march', faction => {
  it('spawns 20 T2 defenders + 60 T2 enemies + 47 T2 rescue riders, two heroes and one independent Player', () => {
    const config = launch(faction), plan = createCareerReliefSpawnPlan(config)
    const rescue = plan.npcSpecs.filter(spec => spec.squadId)
    const enemy = plan.npcSpecs.filter(spec => spec.characterFaction !== faction)
    const garrison = plan.npcSpecs.filter(spec => spec.characterFaction === faction && !spec.squadId)
    expect(plan.npcSpecs).toHaveLength(129)
    expect(garrison).toHaveLength(20)
    expect(garrison.every(spec => spec.tier === 2)).toBe(true)
    expect(garrison.filter(spec => spec.aiType === AIType.MELEE)).toHaveLength(16)
    expect(garrison.filter(spec => spec.aiType === AIType.RANGED)).toHaveLength(4)
    expect(rescue).toHaveLength(49)
    const squadA = rescue.filter(spec => spec.squadId === 1), squadB = rescue.filter(spec => spec.squadId === 2)
    expect(squadA.length + 1).toBe(25); expect(squadB.length).toBe(25)
    expect(squadA.length + 1).toBeLessThanOrEqual(MAX_COMMAND_SQUAD_SIZE)
    expect(squadB.length).toBeLessThanOrEqual(MAX_COMMAND_SQUAD_SIZE)
    expect(rescue.every(spec => spec.cavalry && spec.loadout?.mountId && !spec.respawnEnabled)).toBe(true)
    expect(rescue.filter(spec => spec.tier === 4)).toHaveLength(2)
    expect(rescue.filter(spec => spec.name === 'Captain')).toHaveLength(1)
    expect(rescue.filter(spec => spec.name === 'Maki')).toHaveLength(1)
    expect(rescue.find(spec => spec.name === 'Captain')).toMatchObject({ tier: 4, visualAssetId: faction === 'roman' ? 'roman-hero-t4' : 'viking-hero-t4' })
    expect(rescue.find(spec => spec.name === 'Maki')).toMatchObject({ tier: 4, visualAssetId: 'maki-archer-t4', specialCombatProfile: 'maki-ranger' })
    expect(rescue.filter(spec => spec.tier === 2)).toHaveLength(47)
    expect(enemy).toHaveLength(60); expect(enemy.every(spec => spec.tier === 2)).toBe(true)
    const frontline = enemy.filter(spec => !spec.cavalry && spec.aiType === AIType.MELEE)
    const ranged = enemy.filter(spec => !spec.cavalry && spec.aiType === AIType.RANGED)
    expect([frontline.length, ranged.length, enemy.filter(spec => spec.presetId?.endsWith('sword_cavalry')).length,
      enemy.filter(spec => spec.presetId?.endsWith('lancer')).length, enemy.filter(spec => spec.presetId?.endsWith('horse_archer')).length]).toEqual([24, 12, 12, 6, 6])
    if (faction === 'viking') {
      expect(enemy.filter(spec => spec.presetId === 'roman_archer')).toHaveLength(6)
      expect(enemy.filter(spec => spec.presetId === 'roman_javelin_infantry')).toHaveLength(6)
    }
    const positions = [...plan.npcSpecs, plan.playerSpawn]
    for (let index = 0; index < positions.length; index++) for (let other = index + 1; other < positions.length; other++) {
      expect(Math.hypot(positions[index].x - positions[other].x, positions[index].z - positions[other].z)).toBeGreaterThan(2)
    }
    const front = getCampaignOutpostPlacement(faction).frontZ
    expect(Math.abs(plan.playerSpawn.z - front)).toBeGreaterThan(300)
  })
  it('destroys real gate geometry and collision, opens navigation and starts breach combat', () => {
    const scene = new THREE.Scene(), obstacles: NonNullable<Parameters<typeof createCampaignOutpost>[2]>['obstacles'] = []
    const outpost = createCampaignOutpost(scene, faction, { obstacles, obstacleMeshes: [] })
    const navigation = new NavigationWorld(); navigation.sync(obstacles)
    const revision = navigation.revision
    const plan = createCareerReliefSpawnPlan(launch(faction))
    const npcs = plan.npcSpecs.map(spec => ({ ...spec, dead: false, setTacticalOrder: vi.fn() }))
    initializeCareerReliefBattlefield(outpost.gateController, npcs as unknown as NPC[])
    expect(outpost.gateController.state).toBe('destroyed'); expect(outpost.breachController.breached).toBe(true)
    expect(outpost.gate.root.visible).toBe(false); expect(outpost.gate.root.parent).toBeNull()
    expect(obstacles.some(obstacle => obstacle.damageable === outpost.gate)).toBe(false)
    expect(navigation.sync(obstacles)).toBe(true); expect(navigation.revision).toBeGreaterThan(revision)
    const front = getCampaignOutpostPlacement(faction).frontZ
    expect(navigation.queryPath({ x: 0, z: front - 12 }, { x: 0, z: front + 12 }).status).toBe('path')
    for (const npc of npcs) expect(npc.setTacticalOrder).toHaveBeenCalledWith(npc.characterFaction === faction || npc.aiType === AIType.RANGED ? 'attack' : 'charge')
  })
  it('persists the charge checkpoint and resumes both squads without repeating voice or march', () => {
    const profile = acceptCareerOutpostRelief(ready(faction), 'reload')!
    profile.activeOutpostMission!.reliefPhase = 'charge'
    const store = new CareerProfileStore(storage()); expect(store.save(profile)).toBe(true)
    const config = createCareerOutpostLaunch(store.load()!)
    const plan = createCareerReliefSpawnPlan(config)
    const rescue = plan.npcSpecs.filter(spec => spec.squadId).map(spec => ({ ...spec, dead: false,
      combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn() }))
    const breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const captain = rescue.find(npc => npc.name === 'Captain')!
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(300)
    const follow = vi.fn(), charge = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, vi.fn(), charge, config.careerReliefPhase === 'charge', { chargeAfterFollow: true })
    controller.start(); controller.start(); controller.update(); controller.update()
    expect(controller.hasCharged).toBe(true)
    expect(follow).not.toHaveBeenCalled(); expect(charge).not.toHaveBeenCalled()
    for (const rider of rescue) {
      expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
      expect(rider.assignFollowTarget).not.toHaveBeenCalled()
      expect(rider.assignFormationTarget).not.toHaveBeenCalled()
    }
  })
  it.each(['Captain', 'Maki'])('saves Charge when %s dies beyond 50m and reloads without replaying march or voice', leader => {
    const profile = acceptCareerOutpostRelief(ready(faction), 'leader-death')!
    const store = new CareerProfileStore(storage()); expect(store.save(profile)).toBe(true)
    const config = createCareerOutpostLaunch(profile)
    const makeRescue = (currentConfig: typeof config) => createCareerReliefSpawnPlan(currentConfig).npcSpecs.filter(spec => spec.squadId).map(spec => ({
      ...spec, dead: false, combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn(),
    }))
    const rescue = makeRescue(config)
    const breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const captain = rescue.find(npc => npc.name === 'Captain')!
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(50)
    const game = Object.assign(Object.create(Game.prototype), {
      careerStore: store, careerProfile: profile, defenseCampaignConfig: config, _showNotify: vi.fn(),
    }) as { _persistCareerReliefCharge: () => void; careerProfile: CareerProfile }
    const persist = vi.fn(() => game._persistCareerReliefCharge()), follow = vi.fn(), charge = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, persist, charge, false, { chargeAfterFollow: true })
    controller.start()
    rescue.find(npc => npc.name === leader)!.dead = true
    controller.update(); controller.update()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(charge).toHaveBeenCalledTimes(leader === 'Captain' ? 0 : 1)
    expect(store.load()!.activeOutpostMission!.reliefPhase).toBe('charge')
    expect(game.careerProfile.activeOutpostMission!.reliefPhase).toBe('charge')
    for (const rider of rescue.filter(npc => !npc.dead)) expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')

    const reloadedConfig = createCareerOutpostLaunch(store.load()!), reloadedRescue = makeRescue(reloadedConfig)
    const reloadFollow = vi.fn(), reloadPersist = vi.fn(), reloadCharge = vi.fn()
    const reloaded = new CareerReliefMarchController(reloadedRescue as unknown as NPC[], breach, reloadFollow, reloadPersist, reloadCharge, reloadedConfig.careerReliefPhase === 'charge', { chargeAfterFollow: true })
    reloaded.start(); reloaded.update()
    expect(reloadFollow).not.toHaveBeenCalled(); expect(reloadPersist).not.toHaveBeenCalled(); expect(reloadCharge).not.toHaveBeenCalled()
    for (const rider of reloadedRescue) {
      expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
      expect(rider.assignFormationTarget).not.toHaveBeenCalled(); expect(rider.assignFollowTarget).not.toHaveBeenCalled()
    }
  })
  it('marches using mount speed and charges both squads exactly once when Follow finishes, regardless of distance', () => {
    const plan = createCareerReliefSpawnPlan(launch(faction))
    const rescue = plan.npcSpecs.filter(spec => spec.squadId).map(spec => ({ ...spec, dead: false,
      combatPosition: new THREE.Vector3(spec.x, 0, spec.z), mount: { baseSpeed: 12 },
      assignFormationTarget: vi.fn(), assignFollowTarget: vi.fn(), setTacticalOrder: vi.fn() }))
    const captain = rescue.find(npc => npc.name === 'Captain')!, maki = rescue.find(npc => npc.name === 'Maki')!
    const follow = vi.fn(), charge = vi.fn(), breach = new THREE.Vector3(0, 0, getCampaignOutpostPlacement(faction).frontZ)
    const triggered = vi.fn()
    const controller = new CareerReliefMarchController(rescue as unknown as NPC[], breach, follow, triggered, charge, false, { chargeAfterFollow: true })
    controller.start(); controller.start()
    expect(follow).toHaveBeenCalledTimes(1)
    expect(captain.combatPosition.distanceTo(breach)).toBeGreaterThan(300)
    expect(captain.assignFormationTarget.mock.calls[0][3]).toBe(12)
    expect(maki.assignFollowTarget.mock.calls[0][0]).toBe(captain)
    expect(maki.assignFollowTarget.mock.calls[0][2].x).toBe(28)
    for (const rider of rescue.filter(npc => npc !== captain && npc !== maki)) {
      expect(rider.assignFollowTarget.mock.calls[0][0]).toBe(rider.squadId === 1 ? captain : maki)
      expect(rider.assignFollowTarget.mock.calls[0][3]).toBe(12)
    }
    captain.combatPosition.copy(breach).add(new THREE.Vector3(0, 0, 50.1)); controller.update()
    expect(charge).not.toHaveBeenCalled()
    captain.combatPosition.copy(breach); controller.update()
    expect(charge).not.toHaveBeenCalled()
    captain.combatPosition.copy(breach).add(new THREE.Vector3(0, 0, 300))
    follow.mock.calls[0][0]!()
    controller.update(); controller.update()
    expect(triggered).toHaveBeenCalledTimes(1)
    expect(charge).toHaveBeenCalledTimes(1); expect(controller.hasCharged).toBe(true)
    for (const rider of rescue) expect(rider.setTacticalOrder).toHaveBeenCalledExactlyOnceWith('charge')
  })
})

it('clears real NPC follow/formation when charging and derives movement from mounted speed', () => {
  const scene = new THREE.Scene()
  const rider = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'Captain', 1, true)
  const movement = vi.fn((direction: THREE.Vector3, speed: number, dt: number) => { rider.mount!.group.position.addScaledVector(direction, speed * dt) })
  rider.mount = { group: new THREE.Group(), baseSpeed: 12, dead: false, addControlledMovement: movement } as unknown as NPC['mount']
  rider.assignFormationTarget(1, new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, 1), 12)
  const internal = rider as unknown as { _updateFormationMovement: (dt: number, peers: NPC[], obstacles: never[], skip: boolean, navigation: null) => void }
  internal._updateFormationMovement(.1, [], [], true, null)
  expect(movement).toHaveBeenCalled(); expect(movement.mock.calls[0][1]).toBe(12)
  for (let frame = 0; frame < 50; frame++) internal._updateFormationMovement(.1, [], [], true, null)
  expect(rider.combatPosition.z).toBeGreaterThan(50)
  const leader = new NPC(scene, 0, 100, Faction.PLAYER, 'roman', AIType.MELEE, 'Leader', 1, false)
  rider.assignFollowTarget(leader, 0)
  expect(rider.tacticalOrder).toBe('follow')
  rider.setTacticalOrder('charge')
  expect(rider.formationCommandId).toBeNull(); expect(rider.tacticalOrder).toBe('charge')
})

it('disables commands and HUD but keeps weapon wheel switching', () => {
  let step = 1
  const input = { consumeWheelStep: () => { const value = step; step = 0; return value }, consumeKeyPress: vi.fn(() => true) }
  const ui = { setEnabled: vi.fn() }, inventory = new InventoryManager()
  const weapon = inventory.equippedMelee.id
  const config = launch()
  const controller = new ArmyCommandController([], 'roman', input as unknown as PlayerInput, ui as unknown as ArmyCommandUI,
    null, null, 'defend', null, inventory, 'preset', config.capabilities!.playerCommandsEnabled)
  controller.update()
  expect(ui.setEnabled).toHaveBeenCalledWith(false)
  expect(input.consumeKeyPress).not.toHaveBeenCalled(); expect(controller.wheelMode).toBe('weapon'); expect(controller.isSubmenuOpen).toBe(false)
  expect(inventory.equippedMelee.id).not.toBe(weapon)
})

describe('Relief result and Game integration', () => {
  const combat = { playerDead: true, originalDefendersAlive: 0, defendersAlive: 25, attackersAlive: 60, reinforcementSpawned: false }
  it('has no deployment or waves, continues after Player death and prioritizes annihilation victory', () => {
    const runtime = new DefenseCampaignRuntime({ reinforcementsEnabled: false, eliminationObjective: true })
    expect(runtime.getSnapshot()).toMatchObject({ activePhase: 'assault', deploymentRemainingSeconds: 0 })
    expect(runtime.update(500, combat)).toEqual([])
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'assault', assaultElapsedSeconds: 500, reinforcementTriggered: false })
    expect(runtime.update(1, { ...combat, attackersAlive: 0, defendersAlive: 0 })).toEqual(['battle_victory'])
    expect(runtime.update(1, combat)).toEqual([])
    const failure = new DefenseCampaignRuntime({ eliminationObjective: true })
    expect(failure.update(1, { ...combat, defendersAlive: 0, playerDead: false })).toEqual([])
    expect(failure.update(1, { ...combat, defendersAlive: 0 })).toEqual(['battle_defeat'])
    expect(failure.update(1, combat)).toEqual([])
  })
  it.each(['victory', 'defeat'] as const)('settles %s only once, persists dead-player stats, and clears active relief on return', outcome => {
    const persistence = storage(), store = new CareerProfileStore(persistence), profile = acceptCareerOutpostRelief(ready(), 'relief')!
    store.save(profile)
    vi.stubGlobal('window', { localStorage: persistence, location: { pathname: '/game/', href: '' } })
    const session = storage(); vi.stubGlobal('sessionStorage', session)
    const stats = { player: { damageDealt: 500, damageTaken: 100, kills: 5, survived: false, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 }, squads: [] }
    const config = createCareerOutpostLaunch(profile)
    let enemies = 60, allies = 49
    const game = Object.assign(Object.create(Game.prototype), {
      defenseCampaignConfig: config, defenseCampaignRuntime: new DefenseCampaignRuntime({ eliminationObjective: true, reinforcementsEnabled: false }),
      defenseCampaignHud: { showResult: vi.fn(), update: vi.fn(), updateGate: vi.fn() },
      reliefMarch: { update: vi.fn() }, careerStore: store, careerProfile: profile, careerMeritAwarded: 0,
      battleStats: { snapshot: () => stats }, npcs: [], player: { dead: true }, controlMode: 'spectator',
      campaignOriginalDefenders: [], campaignSpawnWave: null, campaignReinforcementSpawned: false, campaignAttackersStarted: true,
      _spawnNextDefenseCampaignNpc: vi.fn(), _queueDefenseCampaignWave: vi.fn(),
      _campaignFactionAlive: (faction: string) => faction === 'roman' ? allies : enemies,
    }) as any
    game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).not.toHaveBeenCalled()
    expect(game.reliefMarch.update).toHaveBeenCalled(); expect(game.defenseCampaignHud.update).toHaveBeenCalled()
    expect(game._queueDefenseCampaignWave).not.toHaveBeenCalled()
    if (outcome === 'victory') enemies = 0; else allies = 0
    game._updateDefenseCampaign(1); game._updateDefenseCampaign(1)
    expect(game.defenseCampaignHud.showResult).toHaveBeenCalledTimes(1)
    expect(game.defenseCampaignHud.showResult.mock.calls[0][0]).toBe(outcome)
    const saved = store.load()!
    expect(saved.outpostBattleRecords?.[0]).toMatchObject({ kind: 'outpost-relief', outcome, stats: { survived: false }, merit: { survival: 0 } })
    expect(saved.totalMerit).toBe(profile.totalMerit + calculateMerit(stats, outcome, 'defense', 'mission').total)
    expect(saved.completedOutpostStages).toEqual([1, 2, 3])
    expect(claimCareerOutpost(saved, 'relief', outcome, stats).alreadyClaimed).toBe(true)
    expect(parseCareerProfile(saved)?.outpostBattleRecords).toEqual(saved.outpostBattleRecords)
    game.defenseCampaignHud.showResult.mock.calls[0][2]()
    expect(store.load()?.activeOutpostMission).toBeUndefined()
    expect(store.load()?.totalMerit).toBe(saved.totalMerit)
    expect(session.getItem('sagaburst_career_town')).toBe('1')
    expect(clearCareerOutpost(saved).claimedBattleIds).toContain('relief')
  })
})
