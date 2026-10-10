import { TownScene } from '../../src/town/TownScene'
import { TownCommandSquadController } from '../../src/town/TownCommandSquadController'
import { createArmyCommandHarness } from '../helpers/armyCommandHarness'
import { ArmyCommandController } from '../../src/battle/ArmyCommandController'
import { FormationController } from '../../src/battle/FormationController'
import type { PlayerInput } from '../../src/player/PlayerInput'
import type { ArmyCommandUI } from '../../src/ui/ArmyCommandUI'
import { CAPTAIN_GATE_DEFENSE_ID, CAPTAIN_SIEGE_COMMAND_ID } from '../../src/career/CaptainMissionCatalog'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { completeNpcDeployment, gameplayNpcSpawnDriver, NpcSpawnTestDriver } from '../helpers/npcSpawnFrames'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { siegeRoster, siegeDefensePlans, siegePoint, siegeNearestGate, siegeOutward } from '../../src/career/TownSiege'
import { townAssaultObjectiveRoster } from '../../src/town/TownRules'
import { createTownCombatFixture } from '../helpers/townCombatFixture'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { acceptCaptainSiegeCommand, createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { CAREER_RANK_THRESHOLDS, claimCareerMission, createCareerProfile, clearCareerMission } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { townCaptainProfile, townMilitaryEquipment, townRoster } from '../../src/town/TownRules'
import { TOWN_GATES, type TownGateId } from '../../src/town/TownLayout'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { TownOutskirtsWarfareController } from '../../src/town/TownOutskirtsWarfareController'
import type { CombatEvent, CombatEventSink } from '../../src/combat/CombatAttribution'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { TownDefenseController, type TownDefenseResident } from '../../src/career/TownDefenseController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../../src/career/TownDefenseState'
import { damageNpc, damageObstacle } from '../../src/combat/DamageRouter'
import { createNpcCombatActorRef, createPlayerCombatActorRef } from '../../src/combat/CombatAttribution'
import { calculateMerit } from '../../src/career/MeritCalculator'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { combatFixture } from '../helpers/townMissionCombat'
import { CampaignGateController } from '../../src/campaign/CampaignGate'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'

// Equipment GLB parsing has its own asset owner; Siege keeps real combat and movement.
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))

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
vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class { hide = vi.fn(); dispose = vi.fn(); updateTownDefense = vi.fn() } }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Real gate HP/lifecycle and collision input; wall meshes belong to the complete
 * fortification integration, not the shared relief/countdown rule matrix. */
function sampledGates(faction: 'roman' | 'viking', obstacles: ObstacleData[]) {
  const root = new THREE.Group(), gates = new Map<TownGateId, CampaignGateController>()
  for (const gate of TOWN_GATES) {
    const leaves = new THREE.Group(), leftHinge = new THREE.Group(), rightHinge = new THREE.Group()
    leaves.position.set(gate.x, getTerrainHeight(gate.x, gate.z), gate.z)
    leaves.rotation.y = gate.yaw; leaves.add(leftHinge, rightHinge); root.add(leaves)
    leaves.updateMatrixWorld(true)
    const box = new THREE.Box3(new THREE.Vector3(-7, -1, -.5), new THREE.Vector3(7, 8, .5)).applyMatrix4(leaves.matrixWorld)
    const damageable = new DamageableObstacle({ kind: 'gate', maxHp: 2080, root: leaves, ownerFaction: faction })
    const obstacle: ObstacleData = { box, isBarricade: false, damageable }; obstacles.push(obstacle)
    gates.set(gate.id, new CampaignGateController({ defenderFaction: faction, damageable, obstacle, obstacles,
      leftHinge, rightHinge, openRotationY: Math.PI / 2, initialState: 'open' }))
  }
  return { root, gates }
}

const checkpointResidentIds = ['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain',
  'gate:north:0', 'gate:south:0', 'gate:east:0', 'gate:west:0', 'civilian-0'] as const
interface CheckpointFixtureOptions {
  faction?: 'roman' | 'viking'
  assault?: boolean
  residentIds?: readonly string[]
  attackerSlots?: readonly number[]
  includeRanger?: boolean
  includeOfficerAttackers?: boolean
  freshDeployment?: boolean
  beforeDeployment?: (controller: TownDefenseController, residents: TownDefenseResident[], player: Player) => void
  captain?: boolean
  /** Persisted borrowed IDs exercise reload identity without materializing its former roaming squad. */
  attackerIds?: Readonly<Record<number, string>>
}

/** Real movement/damage/mount cases supply only the roles they observe.
 * Omitted attacker slots are saved casualties, preserving the production roster
 * producer without materializing unrelated actors. Spawn protocol and official
 * census belong to SiegeSpawnIntegration and TownSiegePolicy. */
function siegeFixture({ faction = 'roman', assault = true, residentIds = checkpointResidentIds,
  attackerSlots = [2, 3, 4, 5], includeRanger = true, includeOfficerAttackers = false,
  freshDeployment = false, captain = false, attackerIds, beforeDeployment }: CheckpointFixtureOptions = {}) {
  const rank = captain ? 'captain' : 'veteran', templateId = captain ? CAPTAIN_GATE_DEFENSE_ID : VETERAN_TOWN_DEFENSE_TEMPLATE_ID
  const scene = new THREE.Scene()
  let profile = createCareerProfile(faction)
  profile.rank = rank; profile.totalMerit = CAREER_RANK_THRESHOLDS[rank]
  const townFaction = assault ? faction === 'roman' ? 'viking' : 'roman' : faction
  const sampledIds = new Set(residentIds)
  const roster = townRoster().filter(spec => spec.role !== 'cat' && spec.role !== 'merchant'
    && sampledIds.has(spec.id))
  const residents = roster.map(spec => {
    const civilian = spec.role === 'civilian', ranger = spec.role === 'ranger'
    const military = townMilitaryEquipment(townFaction, spec)
    const hero = spec.role === 'captain' ? townCaptainProfile(townFaction) : undefined
    const npc = new NPC(scene, spec.x, spec.z, assault ? Faction.ENEMY : Faction.TOWN, townFaction,
      ranger || spec.unitKind === 'ranged' || spec.unitKind === 'archer' || spec.unitKind === 'horse_archer' ? AIType.RANGED : AIType.MELEE, spec.id, ranger || hero ? 4 : 2,
      spec.mounted,
      civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow' } : military.loadout,
      military.presetId, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : hero?.visualAssetId,
      ranger ? 'ranger' : hero?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, townFaction)
    onTestFinished(() => npc.dispose())
    npc.setTownPeaceful()
    return { spec, npc }
  })
  const player = new Player(scene, faction)
  onTestFinished(() => player.dispose())
  const cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  onTestFinished(() => cat.dispose())
  const obstacles: ObstacleData[] = []
  const city = sampledGates(townFaction, obstacles)
  scene.add(city.root)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(obstacles)
  const patrol = new TownCavalryPatrolController(residents)
  if (assault && captain) profile = acceptCaptainSiegeCommand(profile, 'assault-test')!
  else profile.activeMission = assault ? createEnemyTownAssaultMission('assault-test') : createTownDefenseMission(
    townAssaultObjectiveRoster(residents.map(r => r.spec)).map(r => r.id), residents.filter(r => r.spec.role === 'civilian').map(r => r.spec.id), 'defense-test', templateId, rank)
  if (assault) profile.activeMission!.targetActorIds = townAssaultObjectiveRoster(roster).map(spec => spec.id)
  const active = profile.activeMission!, siege = active.siege!
  const attackers = siegeRoster(assault ? faction : townFaction === 'roman' ? 'viking' : 'roman', assault)
  siege.rosterCreated = !freshDeployment
  siege.attackerIds = attackers.map((_, index) => attackerIds?.[index] ?? `${active.id}:siege:${index}`)
  const survivors = new Set(attackers.flatMap(({ spec }, index) =>
    attackerSlots.includes(index) || includeRanger && spec.combatProfileId === 'ranger' || includeOfficerAttackers && spec.tier === 4 ? [index] : []))
  const casualties = siege.attackerIds.filter((_, index) => !survivors.has(index))
  if (assault) active.deadFriendlyActorIds = casualties
  else active.deadTargetActorIds = casualties
  siege.defensePlans = siegeDefensePlans(townRoster()).map(plan => ({ ...plan,
    infantry: plan.infantry.filter(id => sampledIds.has(id)),
    cavalry: plan.cavalry.filter(id => sampledIds.has(id)),
    leaderId: plan.leaderId && sampledIds.has(plan.leaderId) ? plan.leaderId : undefined,
  }))
  if (captain && !assault) {
    active.templateId = CAPTAIN_GATE_DEFENSE_ID
    active.officialSquad = { type: 'mission-official', missionId: active.id, townFaction: faction, squadId: 1,
      actorIds: assault ? siege.attackerIds.slice(0, 29) : residents.filter(r => r.spec.gateId === 'north').map(r => r.spec.id), contribution: emptyPersonalContribution() }
  }
  const attackerCount = survivors.size
  const controller = new TownDefenseController(scene, residents, () => player, () => profile, p => { profile = p; return true }, cat, navigation, { gates: city.gates, obstacles, patrol, closureBodies: () => [] })
  onTestFinished(() => controller.dispose())
  completeNpcDeployment(() => { const started = controller.startActiveMission(); beforeDeployment?.(controller, residents, player); return started }, gameplayNpcSpawnDriver)
  return { controller, player, cat, residents, navigation, scene, attackerCount, gates: city.gates, obstacles, patrol, profile: () => profile, setProfile: (p: typeof profile) => { controller.dispose(); profile = p } }
}

function checkpointFixture(options: CheckpointFixtureOptions = {}) { return siegeFixture(options) }

describe('Siege faction and role wiring', () => {
  it.each([
    ['roman', true, 'roman', 'viking'], ['roman', false, 'viking', 'roman'],
    ['viking', true, 'viking', 'roman'], ['viking', false, 'roman', 'viking'],
  ] as const)('%s assault=%s wires army=%s residents=%s without repeating the shared flow', (faction, assault, armyFaction, residentFaction) => {
    // Two resident roles and two spawned roles exercise real allegiance/mount wiring.
    const f = checkpointFixture({ faction, assault, residentIds: ['captain', 'ranger'], attackerSlots: [0] })
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.preparationRemaining).toBe(10)
    expect(f.controller.enemies).toHaveLength(2)
    expect(f.controller.enemies.every(npc => npc.faction === (assault ? Faction.TOWN : Faction.ENEMY))).toBe(true)
    expect(f.controller.enemies.every(npc => npc.characterFaction === armyFaction)).toBe(true)
    expect(f.controller.enemies.every(npc => npc.presetId?.startsWith(`${armyFaction}_`))).toBe(true)
    expect(f.residents.every(({ npc }) => npc.characterFaction === residentFaction)).toBe(true)
    expect(f.residents.every(({ npc }) => npc.hostileToPlayer === assault)).toBe(true)
    expect(f.player.characterFaction).toBe(faction)
    expect(f.residents.every(({ npc }) => npc.faction === (assault ? Faction.ENEMY : Faction.TOWN))).toBe(true)
    expect(f.controller.playerEnemies).toHaveLength(2)
    const captains = f.controller.enemies.filter(npc => npc.combatProfileId !== 'ranger' && npc.visualAssetId)
    expect(captains).toHaveLength(1)
    for (const captain of captains) {
      expect(captain.combatProfileId).toBe(armyFaction === 'roman' ? 'praetorian' : 'varangian')
      expect(captain.visualAssetId).toBe(`${armyFaction}-hero-t4`)
      expect(captain.mount!.type).toBe(armyFaction === 'roman' ? MountType.CORGI : MountType.BLACK_CAT)
    }
    const ranger = f.controller.enemies.find(npc => npc.combatProfileId === 'ranger')!
    expect(ranger.visualAssetId).toBe('maki-archer-t4')
    expect(ranger.mount!.type).toBe(MountType.BLACK_CAT)
    const residentCaptain = f.controller.captain!
    expect(residentCaptain.combatProfileId).toBe(residentFaction === 'roman' ? 'praetorian' : 'varangian')
    expect(residentCaptain.visualAssetId).toBe(`${residentFaction}-hero-t4`)
    expect(f.controller.ranger!.combatProfileId).toBe('ranger')
    expect(f.controller.ranger!.mount).toBeDefined()
    expect(f.controller.ranger!.mount!.type).toBe(MountType.BLACK_CAT)
    f.controller.cleanupMission()
    expect([...f.gates.values()].every(gate => gate.state === 'open')).toBe(true)
    expect(f.controller.enemies).toHaveLength(0)
  })
})

describe('shared four-gate Siege runtime', () => {
  const faction = 'roman' as const
  it('places a fresh resident directly at its defense slot and resumes saved position, HP and Player order', () => {
    // One real resident and one pending attacker verify initial placement before readiness.
    const f = checkpointFixture({ assault: false, residentIds: ['gate:north:0'], attackerSlots: [2], includeRanger: false, freshDeployment: true, captain: true,
      beforeDeployment: (controller, residents) => {
        expect(controller.ready).toBe(false)
        const npc = residents[0].npc, slot = siegePoint('north', -3 * 2.6, 12)
        expect(npc.combatPosition.distanceTo(new THREE.Vector3(slot.x, npc.combatPosition.y, slot.z))).toBeLessThan(3)
        controller.persistRuntimeProgress(true)
        expect(controller.active?.actorPositions?.[npc.combatantId]).toMatchObject({ x: npc.combatPosition.x, z: npc.combatPosition.z })
        expect(controller.active?.actorPositions?.['defense-test:siege:2']).toBeUndefined()
      } })
    const guard = f.residents[0].npc
    const slot = siegePoint('north', -3 * 2.6, 12)
    expect(guard.combatPosition.distanceTo(new THREE.Vector3(slot.x, guard.combatPosition.y, slot.z))).toBeLessThan(3)
    expect(guard.missionMovement).toBe(false); expect(guard.tacticalOrder).toBe('defend')
    guard.group.position.set(90, guard.group.position.y, 80); guard.restoreCombatHealth(37); guard.setTacticalOrder('follow')
    f.controller.persistRuntimeProgress(true)
    f.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!)
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(guard.combatPosition.x).toBe(90); expect(guard.combatPosition.z).toBe(80)
    expect(guard.hp).toBe(37); expect(guard.tacticalOrder).toBe('follow'); expect(guard.missionMovement).toBe(false)
  })

  it.each(['player', 'resident', 'unattributed'] as const)('keeps %s-destroyed gates locked across reload and releases only the enemy-breached gate', source => {
    const f = siegeFixture({ assault: false, residentIds: ['gate:north:0', 'gate:west:0'], attackerSlots: [2], includeRanger: false })
    f.controller.updateFlow(10, 0)
    if (source === 'unattributed') f.gates.get('north')!.destroy()
    else damageObstacle(f.gates.get('north')!.damageable, 99999, { source: source === 'player' ? createPlayerCombatActorRef(f.player) : createNpcCombatActorRef(f.residents[0].npc), method: 'siege', emit: f.controller.events.emit })
    expect(f.controller.military.every(npc => npc.missionMovement)).toBe(true)
    f.controller.persistRuntimeProgress(true)
    f.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!)
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(f.gates.get('north')!.state).toBe('destroyed')
    expect(f.controller.military.every(npc => npc.missionMovement)).toBe(true)
    damageObstacle(f.gates.get('west')!.damageable, 99999, { source: createNpcCombatActorRef(f.controller.enemies[0]), method: 'siege', emit: f.controller.events.emit })
    expect(f.residents.find(r => r.spec.id === 'gate:north:0')!.npc.missionMovement).toBe(true)
    expect(f.residents.find(r => r.spec.id === 'gate:west:0')!.npc.missionMovement).toBe(false)
    f.controller.persistRuntimeProgress(true)
    expect(f.profile().activeMission!.siege!.releasedReserveGateIds).toEqual(['west'])
  })

  it.each([true, false])('resumes the remaining countdown without repositioning or reinforcing, assault=%s', assault => {
    const f = checkpointFixture({ faction, assault, residentIds: ['gate:north:0'], attackerSlots: [2, 3], includeRanger: false })
    // Separate allegiance from character appearance: Assault attackers are allies,
    // Defense attackers are enemies; residents have the opposite player relation.
    expect(f.controller.enemies.every(npc => npc.faction === (assault ? Faction.TOWN : Faction.ENEMY))).toBe(true)
    expect(f.controller.enemies.every(npc => npc.characterFaction === (assault ? faction : faction === 'roman' ? 'viking' : 'roman'))).toBe(true)
    expect(f.controller.playerEnemies).toHaveLength(assault ? f.controller.military.length + f.controller.civilians.length : f.attackerCount)
    f.controller.updateFlow(4, 0)
    const defender = f.controller.military.find(npc => !npc.isMounted)!
    defender.group.position.add(new THREE.Vector3(2, 0, 2))
    const position = defender.combatPosition.clone()
    f.controller.enemies[0].takeDamage(999999)
    f.gates.get('west')!.destroy()
    f.controller.persistRuntimeProgress(true)
    f.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!)
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(f.controller.preparationRemaining).toBe(6)
    expect(defender.combatPosition.x).toBeCloseTo(position.x)
    expect(defender.combatPosition.z).toBeCloseTo(position.z)
    expect(f.controller.enemies).toHaveLength(f.attackerCount - 1)
    expect(f.gates.get('west')!.state).toBe('destroyed')
    f.controller.updateFlow(5.9, 0)
    expect(f.controller.phase).toBe('PREPARING')
    f.controller.updateFlow(.1, 0)
    expect(f.controller.phase).toBe('ATTACKING')
  }, 15000)

  it('applies outward doorway clearance when a preparation checkpoint restores open gates', () => {
    const f = checkpointFixture({ faction, assault: false, residentIds: [], attackerSlots: [], includeRanger: false })
    f.player.group.position.copy(siegePoint('north', 0, 0))
    f.controller.updateFlow(3, 0)
    f.controller.persistRuntimeProgress(true)
    f.gates.get('north')!.restoreOpen()
    const context = (f.controller as any).siegeContext
    context.closureBodies = () => [{ position: f.player.combatPosition, radius: .5, moveTo: (point: THREE.Vector3) => f.player.group.position.copy(point) }]
    const hp = f.player.hp
    f.controller.dispose(); completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(f.gates.get('north')!.state).toBe('closed')
    expect(f.player.combatPosition.clone().sub(siegePoint('north', 0, 0)).dot(siegeOutward('north'))).toBeGreaterThan(.5)
    expect(f.player.hp).toBe(hp)
    expect(f.controller.preparationRemaining).toBe(7)
  })

  it('keeps the Ranger on an explicitly assigned NPC target and blocks ranged target switching', () => {
    const scene = new THREE.Scene()
    const ranger = new NPC(scene, 0, 0, Faction.ENEMY, 'viking', AIType.RANGED, 'Ranger', 4,
      false, { meleeWeaponId: 'maki-ranger-bow' }, undefined, undefined, 'ranger', undefined,
      'maki-archer-t4', 'ranger', 'maki-ranger')
    onTestFinished(() => ranger.dispose())
    ranger.setTownPeaceful()
    const enemy = new NPC(scene, 0, 20, Faction.TOWN, 'roman', AIType.MELEE, 'Assigned target', 3)
    onTestFinished(() => enemy.dispose())
    const distraction = new NPC(scene, 0, 10, Faction.TOWN, 'roman', AIType.MELEE, 'Visible distraction', 3)
    onTestFinished(() => distraction.dispose())
    const player = new Player(scene, 'roman')
    onTestFinished(() => player.dispose())
    player.group.position.set(300, 0, 300)
    // This observes the NPC forced-target interface without running another gate relief flow.
    const observer = ranger as unknown as {
      _getTarget(dt: number, player: Player, peers: NPC[]): { npc?: NPC; isPlayer: boolean } | null
      _trySwitchToVisibleRangedTarget(player: Player, peers: NPC[], grid: null, obstacles: ObstacleData[]): boolean
    }
    ranger.setMissionCombatTarget(enemy)
    expect(observer._getTarget(.05, player, [enemy, distraction])?.npc).toBe(enemy)
    expect(observer._trySwitchToVisibleRangedTarget(player, [distraction], null, [])).toBe(false)
    ranger.setMissionCombatTarget(null)
    expect(observer._getTarget(.05, player, [enemy, distraction])).toBeNull()
    ranger.setMissionCombatTarget(undefined)
    expect(observer._getTarget(.05, player, [])?.isPlayer).toBe(true)
  })

  it('still defends its own breach against nearby ambient Bandits', () => {
    const f = checkpointFixture({ faction, assault: false, residentIds: ['town-patrol:a:captain'], attackerSlots: [], includeRanger: false })
    const point = siegePoint('east', 0, 5)
    const bandit = new NPC(f.scene, point.x, point.z, Faction.BANDIT, faction, AIType.MELEE, 'Ambient bandit')
    onTestFinished(() => bandit.dispose())
    const context = (f.controller as any).siegeContext
    context.ambientEnemies = () => [bandit]
    f.controller.updateFlow(10, 0)
    damageObstacle(f.gates.get('east')!.damageable, 99999, { source: createNpcCombatActorRef(bandit), method: 'siege', emit: f.controller.events.emit })
    const guard = f.controller.groups.find(g => g.id === 'east')!.cavalry[0]
    expect((guard as any)._getTarget(.05, f.player, [bandit])?.npc).toBe(bandit)
  })

  it('releases only breached reserves, preserves casualties and breaches across repeated reloads', () => {
    const f = checkpointFixture({ faction, residentIds: ['captain', 'gate:north:0', 'civilian-0'], attackerSlots: [2, 3], includeRanger: false })
    f.controller.updateFlow(10, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    f.controller.noteEffectiveFriendlyDamage(f.controller.military[0])
    expect(f.controller.reserveHasCharged).toBe(false)
    for (const id of ['north', 'west'] as const) damageObstacle(f.gates.get(id)!.damageable, 99999, { source: createPlayerCombatActorRef(f.player), method: 'siege', emit: f.controller.events.emit })
    const assertBreachOrders = () => {
      for (const group of (f.controller as any).groups) {
        const released = group.id === 'north' || group.id === 'west'
        for (const npc of [...group.members, ...group.cavalry] as NPC[]) {
          if (npc.dead) continue
          expect(npc.missionMovement).toBe(!released)
          expect(npc.tacticalOrder).toBe(released ? 'charge' : 'formation')
          if (released) expect((npc as any).missionCombatTarget).toBeUndefined()
        }
      }
    }
    assertBreachOrders()
    const deadId = f.controller.enemies[0].combatantId
    f.controller.enemies[0].takeDamage(999999)
    const footId = f.controller.enemies[1].combatantId
    f.controller.enemies[1].mount!.takeDamage(999999); f.controller.enemies[1].dismountFromMount()
    f.controller.military[0].takeDamage(999999)
    f.controller.civilians[0].takeDamage(999999)
    f.controller.persistRuntimeProgress(true)
    for (let i = 0; i < 2; i++) {
      const saved = parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!
      expect(saved.activeMission!.siege!.releasedReserveGateIds.sort()).toEqual(['north', 'west'])
      expect(saved.activeMission!.actorHealth![footId].mountHp).toBe(0)
      f.setProfile(saved)
      expect(completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
      expect(f.controller.enemies).toHaveLength(f.attackerCount - 1)
      expect(f.controller.enemies.some(n => n.combatantId === deadId)).toBe(false)
      expect(f.controller.enemies.find(n => n.combatantId === footId)!.isMounted).toBe(false)
      expect(f.gates.get('north')!.state).toBe('destroyed')
      expect(f.gates.get('east')!.state).toBe('closed')
      expect(f.controller.civilianDeaths).toBe(1)
      assertBreachOrders()
    }
    f.controller.cleanupMission()
    expect([...f.gates.values()].every(g => g.state === 'open')).toBe(true)
  })

  it('does not erase saved Player death while the restored scene is still initializing', () => {
    const f = checkpointFixture({ faction, residentIds: [], attackerSlots: [], includeRanger: false })
    const saved = f.profile()
    saved.activeMission!.playerDead = true
    f.setProfile(saved)
    expect(f.player.dead).toBe(false)
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(f.profile().activeMission!.playerDead).toBe(true)
  })

  it('never reinforces preparation losses and keeps objective-based outcomes after Player death', () => {
    const f = checkpointFixture({ faction, residentIds: ['gate:north:0'], attackerSlots: [2, 3], includeRanger: false })
    f.controller.enemies[0].takeDamage(999999)
    f.controller.updateFlow(30, 0)
    expect(f.controller.enemies).toHaveLength(2)
    expect(f.controller.remainingEnemies).toBe(1)
    expect(f.controller.evaluate(true)).toBeNull()
    f.controller.enemies.forEach(n => n.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe('failure')
    f.controller.military.forEach(n => n.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe('victory')
  })

  it('does not abandon North for an East breach, replaces dead leaders, and only clears after crossing North', () => {
    const f = checkpointFixture({ faction, residentIds: [], attackerSlots: [2, 3], includeOfficerAttackers: true })
    expect((f.controller as any).attackGroups.every((g: any) => g.leader.tier === 4)).toBe(true)
    f.controller.updateFlow(10, 0)
    const group = (f.controller as any).attackGroups.find((g: any) => g.id === 'north')
    group.leader.takeDamage(999999)
    f.gates.get('east')!.destroy()
    const npc: NPC = group.members[2]
    const tick = () => npc.update(.05, f.player, [npc], [], [], null as never, () => {}, () => {}, true)
    tick()
    expect(npc.sprinting).toBe(true)
    expect(npc.visualMovementSpeed).toBeGreaterThanOrEqual(npc.mount!.baseSpeed * 2)
    const approach = siegePoint('north', 0, -12)
    npc.group.position.copy(approach); npc.mount?.group.position.copy(approach)
    f.controller.updateFlow(.02, 0)
    expect(group.leader.dead).toBe(false)
    expect(npc.hasSiegeObstacle).toBe(true)
    expect((npc as any).assignedSiegeObstacle).toBe(f.gates.get('north')!.siegeObstacle)
    tick()
    expect(npc.visualMovementSpeed).toBeGreaterThanOrEqual(npc.mount!.baseSpeed)
    f.gates.get('north')!.destroy(); f.controller.updateFlow(.02, 0)
    expect(npc.hasSiegeObstacle).toBe(false)
    expect(f.profile().activeMission!.siege!.crossedActorIds).not.toContain(npc.combatantId)
    const inside = siegePoint('north', 0, 12)
    npc.group.position.copy(inside); npc.mount?.group.position.copy(inside)
    f.controller.updateFlow(.02, 0); f.controller.persistRuntimeProgress(true)
    expect(f.profile().activeMission!.siege!.crossedActorIds).toContain(npc.combatantId)
    expect(npc.missionMovement).toBe(false)
  })
})

describe('Siege deployment and shared rule ownership', () => {
  it('places one infantry role and four cavalry officers in their gate sectors before releasing two attackers', () => {
    // Seven real NPCs: one infantry and four independent cavalry sectors need
    // native placement/target behavior; two attackers exercise release. Official
    // 203 military/20 civilian census is data-owned by TownSiegePolicy/TownHub.
    const f = siegeFixture({ residentIds: ['gate:north:0', 'captain', 'ranger',
      'town-patrol:a:captain', 'town-patrol:b:captain'], attackerSlots: [2, 3], includeRanger: false, freshDeployment: true })
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.preparationRemaining).toBe(10)
    expect([...f.gates.values()].every(g => g.state === 'closed')).toBe(true)
    expect(f.controller.releasedEnemies).toHaveLength(0)
    for (const group of f.controller.groups) for (const npc of group.cavalry) {
      expect(siegeNearestGate(npc.combatPosition)).toBe(group.id)
      expect(npc.combatPosition.distanceTo(siegePoint(group.id, 0, 0))).toBeLessThan(75)
    }
    for (const [npc, point] of (f.controller as any).orders as Map<NPC, THREE.Vector3>) {
      expect(npc.combatPosition.distanceTo(point)).toBeLessThan(.01)
      expect((npc as any)._findTarget(f.player, f.controller.fieldNpcs)).toBeNull()
    }
    f.controller.updateFlow(9.9, 0)
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.releasedEnemies).toHaveLength(0)
    f.controller.updateFlow(.1, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    expect(f.controller.releasedEnemies).toHaveLength(2)
  })

  it('frees breached gate infantry and cavalry to pursue threats across gate sectors', () => {
    const gateId: TownGateId = 'north'
    // Representative native placement belongs to the preceding deployment owner.
    // North leader + infantry, West defender, two independently placed threats.
    const f = checkpointFixture({ residentIds: ['captain', 'gate:north:0', 'gate:west:0'], attackerSlots: [2, 3], includeRanger: false })
    const guard = f.controller.captain!
    const mount = new Mount(f.scene, MountType.CORGI, guard.combatPosition.x, guard.combatPosition.z)
    onTestFinished(() => mount.dispose())
    guard.mountVehicle(mount)
    f.controller.updateFlow(10, 0)
    const group = f.controller.groups.find(g => g.id === gateId)!
    const otherGate = 'west'
    const [enemy, distraction] = f.controller.enemies
    const place = (npc: NPC, point: THREE.Vector3) => { npc.group.position.copy(point); npc.mount?.group.position.copy(point) }
    place(enemy, siegePoint(gateId, 0, 5))
    place(distraction, siegePoint(otherGate, 0, 5))
    f.player.group.position.copy(siegePoint(otherGate, 0, 5))
    expect(group.leader).toBe(f.controller.captain)
    expect(group.members).toHaveLength(1)
    expect(group.cavalry).toHaveLength(1)
    expect(group.members[0].isMounted).toBe(false)
    expect(guard.isMounted).toBe(true)
    const west = f.controller.groups.find(g => g.id === otherGate)!
    damageObstacle(f.gates.get(gateId)!.damageable, 99999, { source: createNpcCombatActorRef(enemy), method: 'siege', emit: f.controller.events.emit })
    f.controller.persistRuntimeProgress(true)
    expect(f.profile().activeMission!.siege!.releasedReserveGateIds).toEqual(['north'])
    expect(west.members[0].missionMovement).toBe(true)
    expect(west.members[0].tacticalOrder).toBe('formation')
    for (const npc of [...group.members, ...group.cavalry]) {
      expect(npc.missionMovement).toBe(false)
      expect(npc.tacticalOrder).toBe('charge')
      expect((npc as any)._getTarget(.05, f.player, f.controller.enemies)?.npc).toBe(enemy)
    }
    const start = guard.combatPosition.clone()
    guard.update(.05, f.player, [enemy, distraction], [], [], null as never, () => {}, () => {}, true)
    expect(guard.combatPosition.distanceTo(start)).toBeGreaterThan(0)
    place(enemy, siegePoint(otherGate, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._findTarget(f.player, [enemy, distraction])).not.toBeNull()
    expect(guard.missionMovement).toBe(false)
    expect(guard.tacticalOrder).toBe('charge')
    expect((f.controller as any).orders.has(guard)).toBe(false)
    f.player.group.position.copy(siegePoint(gateId, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._findTarget(f.player, [])?.isPlayer).toBe(true)
    f.controller.cleanupMission()
    expect((guard as any).missionCombatTarget).toBeUndefined()
  })
})

function townHarness(f: ReturnType<typeof siegeFixture>) {
  const town = createTownCombatFixture() as any
  Object.assign(town, { profile: f.profile(), defense: f.controller, player: f.player, camera: new THREE.PerspectiveCamera(), orbit: { cameraYaw: 0 }, world: { obstacles: [] }, navigation: f.navigation,
    grid: new SpatialGrid(4), defenseEnemyGrid: new SpatialGrid(8), defenseTownGrid: new SpatialGrid(8), neighbors: [], hp: { setFill: vi.fn() },
    inventory: { shieldEnabled: false }, careerMounts: { activeMount: null, update: vi.fn() }, cat: f.cat, elapsed: 0, shots: [], updateCareerCommandCue: vi.fn(), damageNumbers: { spawn: vi.fn() } })
  return town
}


describe('Siege retained combat and settlement contracts', () => {
  it.each([true, false])('sounds the alarm only after the ready battlefield has rendered a frame, assault=%s', assault => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length })
    const frame = vi.fn(), alert = vi.fn()
    const town = Object.assign(createTownCombatFixture(), {
      disposed: false, siegeOpeningPending: true, defense: { assault }, profile: { activeMission: { id: 'ready-assault' } }, frame, playAssaultAlert: alert, playTownDefenseAlert: alert,
    })
    town.start()
    expect(alert).not.toHaveBeenCalled()
    callbacks.shift()!(performance.now())
    expect(frame).toHaveBeenCalledOnce()
    expect(alert).not.toHaveBeenCalled()
    callbacks.shift()!(performance.now())
    expect(alert).toHaveBeenCalledOnce()
  })

  it('Defense civilian can kill last attacker without receiving Player credit', () => {
    const faction = 'roman'
    const f = checkpointFixture({ faction, assault: false, residentIds: ['gate:north:0', 'civilian-0'], attackerSlots: [2], includeRanger: false }), enemy = f.controller.enemies[0], civilian = f.controller.civilians[0]
    f.controller.updateFlow(45, 0)
    f.controller.enemies.slice(1).forEach(npc => npc.takeDamage(999999))
    enemy.dismountFromMount()
    damageNpc(enemy, 999999, { source: createNpcCombatActorRef(civilian), method: 'melee', emit: f.controller.events.emit })
    expect(f.controller.remainingEnemies).toBe(0)
    expect(f.controller.snapshot().player.kills).toBe(0)
    expect(f.controller.evaluate(true)).toBe('victory')
    expect(f.controller.peersFor(civilian)).not.toContain(f.controller.military[0])
  })

  it('feeds civilian death state through Defense evaluate at the policy boundary without spawning civilians', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = createTownDefenseMission([], [], 'civilian-wiring')
    profile.activeMission.phase = 'ATTACKING'
    profile.activeMission.deadTargetActorIds = [...profile.activeMission.targetActorIds]
    // evaluate reads role, dead and the registered IDs; render/AI state is irrelevant.
    const residents = Array.from({ length: 11 }, (_, index) => ({ spec: { role: 'civilian' }, npc: { dead: index < 10 } }))
    const controller: TownDefenseController = Object.assign(Object.create(TownDefenseController.prototype), {
      readProfile: () => profile, residents, enemies: [],
    })
    expect(controller.civilianDeaths).toBe(10)
    expect(controller.evaluate(true)).toBe('victory')
    residents[10].npc.dead = true
    expect(controller.civilianDeaths).toBe(11)
    expect(controller.evaluate(true)).toBe('failure')
  })

  it('living armed civilians do not prevent Defense failure after Player and all military die', () => {
    const f = checkpointFixture({ faction: 'viking', assault: false, residentIds: ['gate:north:0', 'civilian-0'], attackerSlots: [2], includeRanger: false })
    f.controller.military.forEach(npc => npc.takeDamage(999999))
    f.controller.civilians.forEach(npc => npc.armTownCivilian('viking_axe_t1'))
    expect(f.controller.evaluate(true)).toBe('failure')
  })

  it('tracks player civilian hits separately from the military objective, with offense Merit and one claim across reload', () => {
    const f = checkpointFixture({ residentIds: ['gate:north:0', 'civilian-0'], attackerSlots: [2], includeRanger: false }), civilian = f.controller.civilians[0]
    damageNpc(civilian, 999999, { source: createPlayerCombatActorRef(f.player), method: 'melee', emit: f.controller.events.emit })
    const stats = f.controller.snapshot().player
    expect(stats.kills).toBe(1)
    expect(f.controller.military.filter(n => !n.dead).map(n => n.combatantId)).toEqual(['gate:north:0'])
    const claim = claimCareerMission(f.profile(), 'assault-test', 'victory', { ...stats, survived: false })
    expect(claim.meritAwarded).toBe(calculateMerit({ player: { ...stats, survived: false }, squads: [] }, 'victory', 'offense', 'mission').total)
    const reload = parseCareerProfile(JSON.parse(JSON.stringify(claim.profile)))!
    expect(claimCareerMission(reload, 'assault-test', 'victory', stats).meritAwarded).toBe(0)
    expect(clearCareerMission(reload, 'assault-test')).toMatchObject({ faction: 'roman', totalMerit: f.profile().totalMerit + claim.meritAwarded })
  })

  it('updates military and assault combat on the first frame and permits immediate damage', () => {
    const f = checkpointFixture({ residentIds: ['gate:north:0', 'civilian-0'], attackerSlots: [2], includeRanger: false }), town = townHarness(f)
    const military = f.controller.military[0], civilian = f.controller.civilians[0], attacker = f.controller.enemies[0]
    const updateMilitary = vi.spyOn(military, 'update'), updateAttacker = vi.spyOn(attacker, 'update'), updateCivilian = vi.spyOn(civilian, 'update')
    const simulation = combatFixture({
      controllers: { defense: f.controller },
      simulation: {
        player: () => f.player, cameraPosition: town.camera.position, obstacles: town.world.obstacles,
        navigation: f.navigation, hp: town.hp, careerMounts: town.careerMounts,
        updateCommandCue: town.updateCareerCommandCue,
        hitNpc: (target, damage, method, source) => town.hitFieldNpc(target, damage, method, source),
        damagePlayer: (source, damage, method) => town.damagePlayerFromNpc(source, damage, method),
        fireNpc: (origin, direction, kind, source) => town.fire(origin, direction, source.rangedProjectileSpeed, source.rangedDamage, false, false, kind, source),
      },
    })
    simulation.combat.update(.016, town.orbit.cameraYaw, town.elapsed)
    expect(updateMilitary).toHaveBeenCalledOnce(); expect(updateAttacker).toHaveBeenCalledOnce(); expect(updateCivilian).toHaveBeenCalledOnce()
    const before = military.hp
    town.hitFieldNpc(military, 20, 'melee', attacker)
    expect(military.hp).toBeLessThan(before)
  })

  it('allows Tab equipment immediately while retaining dead-player restrictions', () => {
    const player = new Player(new THREE.Scene(), 'roman')
    onTestFinished(() => player.dispose())
    const profile = createCareerProfile('roman')
    profile.activeMission = createEnemyTownAssaultMission('input-assault')
    const town = Object.assign(createTownCombatFixture(), {
      profile, player, inventory: { shieldEnabled: false }, careerMounts: { activeMount: null }, hp: { setFill: vi.fn() },
    })
    expect(profile.activeMission.phase).toBe('PREPARING')
    vi.stubGlobal('document', { exitPointerLock: vi.fn() })
    town.input = { clear: vi.fn() }
    town.skills = {}; town.equipment = { visible: false, open: vi.fn() }
    const key = (code: string) => ({ code, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() })
    const tab = key('Tab'); town.key(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(town.equipment.open).toHaveBeenCalledWith(town.skills, town.inventory, expect.any(Function), town.careerMounts, expect.objectContaining({ render: expect.any(Function) }))
    town.equipment.visible = true; town.closePanel = vi.fn()
    town.key(key('Tab')); expect(town.closePanel).toHaveBeenCalledOnce()
    town.equipment.visible = false; town.equipment.open.mockClear()
    player.takeDamage(999999, town.hp)
    town.key(key('Tab')); expect(town.equipment.open).not.toHaveBeenCalled()
  })
})


describe('Captain Siege command ownership caller', () => {
  it.each(['formation', 'follow'] as const)('moves the guard on %s while attackers are pending and retains the command after deployment', order => {
    // One resident and one queued attacker isolate the late deployment finalizer.
    const f = siegeFixture({ captain: true, assault: false, residentIds: ['gate:north:0'], attackerSlots: [2], includeRanger: false,
      beforeDeployment: (defense, residents, player) => {
        expect(defense.ready).toBe(false)
        const guard = residents[0].npc
        defense.releasePlayerCommand(guard)
        guard.group.position.set(0, getTerrainHeight(0, 0), 0)
        if (order === 'formation') guard.assignFormationTarget(17, new THREE.Vector3(0, getTerrainHeight(0, 15), 15), new THREE.Vector3(0, 0, 1))
        else { player.group.position.set(0, getTerrainHeight(0, 25) + .9, 25); guard.assignFollowTarget(player, 0) }
        const initial = guard.combatPosition.clone()
        const combat = combatFixture({ controllers: { defense }, simulation: {
          player: () => player, residents: residents.map(r => ({ ...r, cycle: -1, walkTime: 0 })),
        } }).combat
        for (let frame = 0; frame < 30; frame++) combat.updateCommandTravel(.02, [guard])
        expect(guard.combatPosition.distanceTo(initial)).toBeGreaterThan(1)
        expect(defense.ready).toBe(false)
        expect(defense.preparationRemaining).toBe(10)
      } })
    const guard = f.residents[0].npc
    expect(f.controller.ready).toBe(true)
    expect(guard.tacticalOrder).toBe(order)
    if (order === 'formation') expect(guard.formationCommandId).toBe(17)
    expect(guard.combatPosition.z).toBeGreaterThan(1)
    expect(guard.missionMovement).toBe(false)
    expect(f.profile().activeMission?.officialSquad?.members?.[guard.combatantId]?.order).toBe(order)
  })

  it('moves the Captain guard to the confirmed Formation slot during preparation and completes into Defend', () => {
    // One real guard and one distant attacker; actual picking, scene callback and NPC locomotion.
    const f = siegeFixture({ captain: true, assault: false, residentIds: ['gate:north:0'], attackerSlots: [2], includeRanger: false })
    const guard = f.residents[0].npc
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile: f.profile(), player: f.player, commandActors: [guard], defense: f.controller,
    }) as { onPlayerCommandIssued: (order: 'formation', target: 'squad:1') => void;
      issuePartyOrder: (order: 'follow', target: 'squad:1') => boolean }
    guard.group.position.set(0, getTerrainHeight(0, 0), 0)
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 400)
    camera.position.set(0, 20, 25); camera.lookAt(0, 0, 15)
    camera.updateMatrixWorld(true)
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial())
    terrain.updateMatrixWorld(true)
    onTestFinished(() => { terrain.geometry.dispose(); terrain.material.dispose() })
    const formation = new FormationController(f.scene, camera, [guard], terrain, f.obstacles, f.navigation, TOWN_NAVIGATION_BOUNDS)
    onTestFinished(() => formation.cancelPlacement())
    const h = createArmyCommandHarness([guard])
    const command = new ArmyCommandController([guard], 'roman', h.input as unknown as PlayerInput, h.ui as unknown as ArmyCommandUI,
      formation, (order, target) => town.onPlayerCommandIssued(order as 'formation', target as 'squad:1'), 'defend', null, null, 'squad', true,
      undefined, { enabled: () => true, accepts: npc => f.controller.active!.officialSquad!.actorIds.includes(npc.combatantId),
        issue: (order, target) => town.issuePartyOrder(order as 'follow', target as 'squad:1') })
    const combat = combatFixture({ controllers: { defense: f.controller }, simulation: {
      player: () => f.player, residents: f.residents.map(r => ({ ...r, cycle: -1, walkTime: 0 })),
      navigation: f.navigation, obstacles: f.obstacles,
    } }).combat
    h.input.press('1'); command.update(); h.input.press('5'); command.update()
    h.input.press('1'); command.update(); h.input.press('4'); command.update(); h.input.pressE(); command.update()
    expect(guard.tacticalOrder).toBe('formation')
    const slot = guard.combatFormationCheckpoint!.position
    expect(slot.z).toBeCloseTo(15)
    for (let frame = 0; frame < 200 && guard.tacticalOrder === 'formation'; frame++) {
      combat.update(.02, 0, frame * .02); command.postUpdate()
    }
    expect(guard.combatPosition.distanceTo(new THREE.Vector3(slot.x, guard.combatPosition.y, slot.z))).toBeLessThan(1)
    expect(guard.tacticalOrder).toBe('defend')
    expect(f.controller.phase).toBe('PREPARING')
  })

  it('executes Follow and Attack through Town commands during preparation and retains squad authority after a Town checkpoint', () => {
    // One real guard + one enemy; real scene command callbacks, command UI and combat locomotion.
    const f = siegeFixture({ captain: true, assault: false, residentIds: ['gate:north:0'], attackerSlots: [2], includeRanger: false })
    const guard = f.residents[0].npc, enemy = f.controller.enemies[0]
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile: f.profile(), player: f.player, commandActors: [guard], defense: f.controller,
    }) as { profile: ReturnType<typeof f.profile>; issuePartyOrder: (order: 'follow', target: 'squad:1') => boolean;
      onPlayerCommandIssued: (order: 'attack', target: 'squad:1') => void }
    const owner = new TownCommandSquadController(f.residents, () => f.player, () => town.profile, () => true)
    town.profile.townCommandSquad = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: [guard.combatantId],
      authorized: false, sceneKey: 'town-home', state: 'TRAINING', contribution: emptyPersonalContribution(),
      members: { [guard.combatantId]: { status: 'reserve', hp: 100, order: 'defend' } } }
    owner.applySavedState(town.profile.townCommandSquad)
    expect(guard.squadId).toBe(1)
    const h = createArmyCommandHarness([guard])
    const command = new ArmyCommandController([guard], 'roman', h.input as unknown as PlayerInput, h.ui as unknown as ArmyCommandUI,
      null, (order, target) => town.onPlayerCommandIssued(order as 'attack', target as 'squad:1'), 'defend', null, null, 'squad', true,
      undefined, { enabled: () => true, accepts: npc => f.controller.active!.officialSquad!.actorIds.includes(npc.combatantId),
        issue: (order, target) => town.issuePartyOrder(order as 'follow', target as 'squad:1') })
    const combat = combatFixture({ controllers: { defense: f.controller }, simulation: {
      player: () => f.player, residents: f.residents.map(r => ({ ...r, cycle: -1, walkTime: 0 })),
      navigation: f.navigation, obstacles: f.obstacles,
    } }).combat
    guard.group.position.set(0, guard.combatPosition.y, 0)
    f.player.group.position.copy(guard.combatPosition).z += 25
    const initial = guard.combatPosition.clone()
    h.input.press('1'); command.update(); h.input.press('5'); command.update()
    for (let frame = 0; frame < 30; frame++) combat.update(.02, 0, frame * .02)
    expect(guard.tacticalOrder).toBe('follow')
    expect(guard.combatPosition.distanceTo(initial)).toBeGreaterThan(1)
    enemy.group.position.copy(guard.combatPosition).z += 18
    enemy.mount?.group.position.copy(enemy.group.position)
    enemy.setTacticalOrder('defend'); enemy.missionMovement = false
    const attackStart = guard.combatPosition.clone()
    h.input.press('1'); command.update(); h.input.press('1'); command.update()
    for (let frame = 0; frame < 60; frame++) combat.update(.02, 0, frame * .02)
    expect(f.controller.phase).toBe('PREPARING')
    expect(guard.tacticalOrder).toBe('attack')
    expect(guard.combatPosition.distanceTo(attackStart)).toBeGreaterThan(1)
    expect(guard.combatPosition.z).toBeGreaterThan(attackStart.z)
    f.controller.persistRuntimeProgress(true)
    f.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(f.profile())))!)
    completeNpcDeployment(() => f.controller.startActiveMission(), gameplayNpcSpawnDriver)
    const restoredEnemy = f.controller.enemies[0]
    restoredEnemy.group.position.copy(guard.combatPosition).z += 18
    restoredEnemy.mount?.group.position.copy(restoredEnemy.group.position)
    restoredEnemy.setTacticalOrder('defend'); restoredEnemy.missionMovement = false
    const restoredStart = guard.combatPosition.clone()
    for (let frame = 0; frame < 60; frame++) combat.update(.02, 0, frame * .02)
    expect(f.controller.phase).toBe('PREPARING')
    expect(guard.tacticalOrder).toBe('attack')
    expect(guard.combatPosition.z).toBeGreaterThan(restoredStart.z + 1)
  })

  it.each([
    { identity: 'new temporary roster', freshDeployment: true, attackerIds: undefined, expectedNorthId: 'assault-test:siege:2' },
    { identity: 'saved borrowed roster', freshDeployment: false, attackerIds: { 2: 'outskirts:roman:a:2' }, expectedNorthId: 'outskirts:roman:a:2' },
  ])('credits actual North damage and kills for $identity while excluding South and preserving reload totals', ({ freshDeployment, attackerIds, expectedNorthId }) => {
    // Four real NPCs: one source per army, one target per source. Other roster slots are saved casualties.
    const h = siegeFixture({ captain: true, assault: true, freshDeployment, attackerIds,
      residentIds: ['gate:north:0', 'gate:south:0'], attackerSlots: [2, 30], includeRanger: false })
    const north = h.controller.enemies.find(npc => npc.squadId === 1)!
    const south = h.controller.enemies.find(npc => npc.squadId === 2)!
    const [northTarget, southTarget] = h.controller.military
    northTarget.restoreCombatHealth(70); southTarget.restoreCombatHealth(70)
    expect(h.profile().activeMission!.templateId).toBe(CAPTAIN_SIEGE_COMMAND_ID)
    expect(north.combatantId).toBe(expectedNorthId)
    expect(h.profile().activeMission!.officialSquad!.actorIds).toContain(expectedNorthId)
    damageNpc(southTarget, 70, { source: createNpcCombatActorRef(south), method: 'melee', emit: h.controller.events.emit })
    expect(h.controller.snapshot().meritPlayer).toMatchObject({ damageDealt: 0, kills: 0 })
    damageNpc(northTarget, 20, { source: createNpcCombatActorRef(north), method: 'melee', emit: h.controller.events.emit })
    damageNpc(northTarget, 50, { source: createNpcCombatActorRef(north), method: 'melee', emit: h.controller.events.emit })
    const stats = h.controller.snapshot()
    expect(stats.player).toMatchObject({ damageDealt: 0, kills: 0 })
    expect(stats.meritPlayer).toMatchObject({ damageDealt: 70, kills: 1 })
    expect(stats.squads.find(squad => squad.squadId === 1)).toMatchObject({ damageDealt: 70, kills: 1 })
    h.controller.persistRuntimeProgress(true)
    h.setProfile(parseCareerProfile(JSON.parse(JSON.stringify(h.profile())))!)
    completeNpcDeployment(() => h.controller.startActiveMission(), gameplayNpcSpawnDriver)
    expect(h.controller.snapshot().meritPlayer).toMatchObject({ damageDealt: 70, kills: 1 })
    expect(h.controller.officialContribution).toMatchObject({ damageDealt: 70, kills: 1 })
    expect(h.profile().activeMission!.officialSquad!.actorIds).toContain(expectedNorthId)
  })
  it('releases the nearby closed gate when Player replaces Charge with Defend', () => {
    const h = siegeFixture({ captain: true, assault: true, residentIds: [], attackerSlots: [2], includeRanger: false })
    h.profile().activeMission!.phase = 'ATTACKING'
    const north = h.controller.enemies.find(npc => npc.squadId === 1)!
    const approach = siegePoint('north', 0, -12)
    north.group.position.copy(approach)
    north.mount?.group.position.copy(approach)
    north.setTacticalOrder('charge')
    h.controller.updateFlow(.1, 0)
    expect(north.hasSiegeObstacle).toBe(true)
    north.setTacticalOrder('defend')
    h.controller.updateFlow(.1, 0)
    expect(north.hasSiegeObstacle).toBe(false)
    expect(north.tacticalOrder).toBe('defend')
    expect(h.gates.get('north')!.state).toBe('closed')
  })
  it('leaves North attack formation intact across a breach while South still receives automatic attack orders', () => {
    const h = siegeFixture({ captain: true, assault: true, residentIds: [], attackerSlots: [2, 30], includeRanger: false })
    h.profile().activeMission!.phase = 'ATTACKING'
    const north = h.controller.enemies.find(npc => npc.squadId === 1)!
    const south = h.controller.enemies.find(npc => npc.squadId === 2)!
    const desired = siegePoint('north', 8, 24)
    north.assignFormationTarget(765, desired, new THREE.Vector3(0, 0, 1))
    h.gates.get('north')!.destroy()
    h.controller.updateFlow(.1, 0)
    expect(north.formationCommandId).toBe(765)
    expect(north.tacticalOrder).toBe('formation')
    expect(south.formationCommandId).not.toBeNull()
    expect(south.tacticalOrder).toBe('formation')
    expect(h.profile().activeMission!.officialSquad!.actorIds).toHaveLength(29)
  })
  it('leaves the authorized North infantry formation intact after defense reserve release', () => {
    const h = siegeFixture({ captain: true, assault: false, residentIds: ['gate:north:0'], attackerSlots: [2], includeRanger: false })
    const guard = h.residents[0].npc
    expect(guard.missionMovement).toBe(false)
    expect(guard.tacticalOrder).toBe('defend')
    h.profile().activeMission!.phase = 'ATTACKING'
    guard.assignFormationTarget(766, siegePoint('north', 8, 24), new THREE.Vector3(0, 0, 1))
    damageObstacle(h.gates.get('north')!.damageable, 99999, { source: createNpcCombatActorRef(h.controller.enemies[0]), method: 'siege', emit: h.controller.events.emit })
    h.controller.updateFlow(.1, 0)
    expect(guard.formationCommandId).toBe(766)
    expect(guard.tacticalOrder).toBe('formation')
    expect(guard.squadId).toBe(1)
  })
})

it('counts a borrowed North cavalry real siege hit once, excludes South and releases the borrowed event lease', () => {
  // Two real NPCs, three Mounts (two horses and the controller's cat), one Player, no TownWorld/GLB.
  // All unrelated siege slots are saved casualties.
  // Real NPC melee and damage routing remain intact, including the animation hit window.
  const scene = new THREE.Scene(), obstacles: ObstacleData[] = []
  const scheduler = new NpcSpawnScheduler(), driver = new NpcSpawnTestDriver(scheduler)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS), city = sampledGates('viking', obstacles)
  scene.add(city.root); navigation.sync(obstacles)
  const player = new Player(scene, 'roman'), cat = new Mount(scene, MountType.BLACK_CAT, -34, 20)
  let profile = acceptCaptainSiegeCommand({ ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000 }, 'borrowed-events')!
  const ids = Array.from({ length: 119 }, (_, index) => `borrowed-events:siege:${index}`)
  profile.activeMission!.deadFriendlyActorIds = ids.filter(id => id !== ids[30])
  const outskirts = new TownOutskirtsWarfareController(scene, 'viking', () => profile, obstacles, navigation,
    undefined, [], scheduler)
  const context = { gates: city.gates, obstacles, outskirts, patrol: new TownCavalryPatrolController([]), closureBodies: () => [] }
  const controller = new TownDefenseController(scene, [], () => player, () => profile, next => { profile = next; return true },
    cat, navigation, context, scheduler)
  onTestFinished(() => { controller.cleanupMission(); controller.dispose(); outskirts.dispose(); player.dispose(); cat.dispose(); expect(scheduler.pending).toBe(0) })
  for (const batch of outskirts.batches) if (!batch.actors.has('outskirts:cavalry:a:0')) batch.cancel()
  driver.advanceFrame()
  const north = outskirts.actors[0], horse = north.mount!
  const previousSink = vi.fn<CombatEventSink>(), releasePrevious = north.bindCombatEventSink(previousSink)
  const bind = north.bindCombatEventSink.bind(north), releases: ReturnType<typeof vi.fn>[] = []
  vi.spyOn(north, 'bindCombatEventSink').mockImplementation(sink => {
    const release = vi.fn(bind(sink)); releases.push(release); return release
  })
  const dispose = vi.spyOn(north, 'dispose')
  const position = north.combatPosition.clone()
  expect(controller.startActiveMission()).toBe(true)
  driver.drain()
  expect(controller.ready).toBe(true)
  expect(outskirts.owns(north)).toBe(false)
  expect(north.mount).toBe(horse)
  expect(north.combatPosition).toEqual(position)
  expect(controller.enemies.map(npc => npc.combatantId)).toEqual(['outskirts:cavalry:a:0', ids[30]])
  expect(profile.activeMission!.officialSquad!.actorIds).toContain(north.combatantId)
  expect(profile.activeMission!.officialSquad!.actorIds).not.toContain(ids[30])
  controller.updateFlow(10, 0)
  const emitted: CombatEvent[] = [], unsubscribe = controller.events.subscribe(event => emitted.push(event))
  onTestFinished(unsubscribe)

  const hitGate = (npc: NPC, gateId: TownGateId) => {
    const gate = city.gates.get(gateId)!
    // Arrange 17 remaining gate HP; the tested damage is exclusively produced by NPC.update.
    gate.damageable.takeDamage(gate.damageable.currentHp - 17)
    const point = siegePoint(gateId, 0, -1.5); point.y = getTerrainHeight(point.x, point.z)
    npc.group.position.copy(point); npc.mount!.group.position.copy(point)
    npc.missionMovement = false; npc.setTacticalOrder('attack'); npc.assignSiegeObstacle(gate.siegeObstacle)
    for (let frame = 0; frame < 80 && !gate.damageable.destroyed; frame++) {
      npc.update(.05, player, controller.enemies, [], obstacles, { setFill() {} }, vi.fn(), vi.fn(), true)
    }
    expect(gate.damageable.destroyed, `${npc.combatantId} must hit ${gateId} within 4 simulated seconds`).toBe(true)
    npc.update(.05, player, controller.enemies, [], obstacles, { setFill() {} }, vi.fn(), vi.fn(), true)
  }
  hitGate(north, 'north')
  expect(controller.snapshot().meritPlayer).toMatchObject({ structureDamage: 17, gateBreaches: 1 })
  expect(emitted.filter(event => event.source.actorId === north.combatantId).map(event => event.type)).toEqual(['structure_damaged', 'structure_destroyed'])
  expect(previousSink).not.toHaveBeenCalled()
  expect(controller.snapshot().player).toMatchObject({ structureDamage: 0, gateBreaches: 0 })
  expect(controller.officialContribution).toMatchObject({ structureDamage: 17, gateBreaches: 1 })
  hitGate(controller.enemies[1], 'south')
  expect(emitted.filter(event => event.source.actorId === ids[30]).map(event => event.type)).toEqual(['structure_damaged', 'structure_destroyed'])
  expect(controller.snapshot().meritPlayer).toMatchObject({ structureDamage: 17, gateBreaches: 1 })
  controller.persistRuntimeProgress(true)
  const saved = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
  expect(saved.activeMission!.officialSquad!.contribution).toMatchObject({ structureDamage: 17, gateBreaches: 1 })
  controller.cleanupMission()
  expect(releases).toHaveLength(1)
  expect(releases[0]).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
  expect(releases[0].mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0])
  releasePrevious()
})
