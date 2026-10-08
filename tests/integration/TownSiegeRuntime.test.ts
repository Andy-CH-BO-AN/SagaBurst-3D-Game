import { advanceNpcFrame, completeNpcDeployment, gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { createTownFortifications } from '../../src/town/TownFortifications'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { siegeRoster, siegeDefensePlans, siegePoint, siegeNearestGate, siegeOutward } from '../../src/career/TownSiege'
import { townAssaultObjectiveRoster } from '../../src/town/TownRules'
import { createTownCombatFixture } from '../helpers/townCombatFixture'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import { CAREER_RANK_THRESHOLDS, claimCareerMission, createCareerProfile, clearCareerMission } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { townCaptainProfile, townMilitaryEquipment, townRoster } from '../../src/town/TownRules'
import { TOWN_GATES, type TownGateId } from '../../src/town/TownLayout'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { createTownDefenseMission } from '../../src/career/CareerMissionState'
import { VETERAN_TOWN_DEFENSE_TEMPLATE_ID } from '../../src/career/TownDefenseState'
import { damageNpc } from '../../src/combat/DamageRouter'
import { createNpcCombatActorRef, createPlayerCombatActorRef } from '../../src/combat/CombatAttribution'
import { calculateMerit } from '../../src/career/MeritCalculator'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { combatFixture } from '../helpers/townMissionCombat'
import { CampaignGateController } from '../../src/campaign/CampaignGate'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'

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
}

/** The full battlefield owns census/placement/readiness. Checkpoint tests supply
 * only the residents they observe; omitted attacker slots are saved casualties,
 * so restoration still uses the real 119/120-slot roster and spawn controller. */
function siegeFixture({ faction = 'roman', assault = true, residentIds = checkpointResidentIds,
  attackerSlots = [2, 3, 4, 5], includeRanger = true, includeOfficerAttackers = false,
  fullBattlefield = false, deferStart = false }: CheckpointFixtureOptions & { fullBattlefield?: boolean; deferStart?: boolean } = {}) {
  const rank = 'veteran', templateId = VETERAN_TOWN_DEFENSE_TEMPLATE_ID
  const scene = new THREE.Scene()
  let profile = createCareerProfile(faction)
  profile.rank = rank; profile.totalMerit = CAREER_RANK_THRESHOLDS[rank]
  const townFaction = assault ? faction === 'roman' ? 'viking' : 'roman' : faction
  const sampledIds = new Set(residentIds)
  const roster = townRoster().filter(spec => spec.role !== 'cat' && spec.role !== 'merchant'
    && (fullBattlefield || sampledIds.has(spec.id)))
  const constructionStart = npcConstruction.count
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
  const material = new THREE.MeshBasicMaterial()
  onTestFinished(() => material.dispose())
  const city = fullBattlefield
    ? createTownFortifications(townFaction, obstacles, { stone: material, wood: material, dark: material, snow: material })
    : sampledGates(townFaction, obstacles)
  scene.add(city.root)
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.sync(obstacles)
  const patrol = new TownCavalryPatrolController(residents)
  profile.activeMission = assault ? createEnemyTownAssaultMission('assault-test') : createTownDefenseMission(
    townAssaultObjectiveRoster(residents.map(r => r.spec)).map(r => r.id), residents.filter(r => r.spec.role === 'civilian').map(r => r.spec.id), 'defense-test', templateId, rank)
  let attackerCount = assault ? 119 : 120
  if (!fullBattlefield) {
    // A minimal resident contract has its own explicit objective IDs. Fresh
    // battlefield census is checked separately, rather than faked with actors.
    if (assault) profile.activeMission!.targetActorIds = townAssaultObjectiveRoster(roster).map(spec => spec.id)
    const active = profile.activeMission!, siege = active.siege!
    const attackers = siegeRoster(assault ? faction : townFaction === 'roman' ? 'viking' : 'roman', assault)
    siege.rosterCreated = true
    siege.attackerIds = attackers.map((_, index) => `${active.id}:siege:${index}`)
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
    attackerCount = survivors.size
  }
  const controller = new TownDefenseController(scene, residents, () => player, () => profile, p => { profile = p; return true }, cat, navigation, { gates: city.gates, obstacles, patrol, closureBodies: () => [] })
  onTestFinished(() => controller.dispose())
  if (!deferStart) {
    expect(completeNpcDeployment(() => controller.startActiveMission(), gameplayNpcSpawnDriver)).toBe(true)
    // Count actual constructors, including callers restoring authoritative slots.
    expect(npcConstruction.count - constructionStart).toBe(residents.length + attackerCount)
    expect(residents).toHaveLength(fullBattlefield ? 223 : residentIds.length)
  }
  return { controller, player, cat, residents, navigation, scene, attackerCount, gates: city.gates, obstacles, patrol, profile: () => profile, setProfile: (p: typeof profile) => { controller.dispose(); profile = p } }
}

function battlefieldFixture(assault = true, deferStart = false) {
  return siegeFixture({ fullBattlefield: true, assault, deferStart })
}
function checkpointFixture(options: CheckpointFixtureOptions = {}) { return siegeFixture(options) }

describe('Siege faction and role wiring', () => {
  it.each([
    ['roman', true, 'roman', 'viking'], ['roman', false, 'viking', 'roman'],
    ['viking', true, 'viking', 'roman'], ['viking', false, 'roman', 'viking'],
  ] as const)('%s assault=%s wires army=%s residents=%s without repeating the shared flow', (faction, assault, armyFaction, residentFaction) => {
    const f = checkpointFixture({ faction, assault, includeOfficerAttackers: true })
    expect(f.controller.phase).toBe('PREPARING')
    expect(f.controller.preparationRemaining).toBe(10)
    expect(f.controller.enemies).toHaveLength(8)
    expect(f.controller.enemies.every(npc => npc.faction === (assault ? Faction.TOWN : Faction.ENEMY))).toBe(true)
    expect(f.controller.enemies.every(npc => npc.characterFaction === armyFaction)).toBe(true)
    expect(f.controller.enemies.every(npc => npc.presetId?.startsWith(`${armyFaction}_`))).toBe(true)
    expect(f.residents.every(({ npc }) => npc.characterFaction === residentFaction)).toBe(true)
    expect(f.residents.every(({ npc }) => npc.hostileToPlayer === assault)).toBe(true)
    expect(f.controller.playerEnemies).toHaveLength(assault ? 9 : 8)
    const captains = f.controller.enemies.filter(npc => npc.combatProfileId !== 'ranger' && npc.visualAssetId)
    expect(captains).toHaveLength(3)
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
    f.gates.get('east')!.destroy()
    const guard = f.controller.groups.find(g => g.id === 'east')!.cavalry[0]
    expect((guard as any)._getTarget(.05, f.player, [bandit])?.npc).toBe(bandit)
  })

  it('releases only breached reserves, preserves casualties and breaches across repeated reloads', () => {
    const f = checkpointFixture({ faction, residentIds: ['gate:north:0', 'gate:south:0', 'gate:east:0', 'gate:west:0', 'civilian-0'], attackerSlots: [2, 3] })
    expect(f.controller.enemies.find(n => n.combatProfileId === 'ranger')!.mount!.type).toBe(MountType.BLACK_CAT)
    f.controller.updateFlow(10, 0)
    expect(f.controller.phase).toBe('ATTACKING')
    f.controller.noteEffectiveFriendlyDamage(f.controller.military[0])
    expect(f.controller.reserveHasCharged).toBe(false)
    f.gates.get('north')!.destroy(); f.gates.get('west')!.destroy()
    const assertBreachOrders = () => {
      for (const group of (f.controller as any).groups) {
        const released = group.id === 'north' || group.id === 'west'
        for (const npc of [...group.members, ...group.cavalry] as NPC[]) {
          if (npc.dead) continue
          expect(npc.missionMovement).toBe(true)
          expect(npc.tacticalOrder).toBe('formation')
          if (released) expect((npc as any).missionCombatTarget).toBeNull()
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
      expect(f.controller.enemies.find(n => n.combatProfileId === 'ranger')!.mount!.type).toBe(MountType.BLACK_CAT)
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
  it('deploys the complete battlefield and waits ten seconds', () => {
    const assault = true
    const f = battlefieldFixture(assault)
    expect(f.controller.military).toHaveLength(203)
    expect(f.controller.civilians).toHaveLength(20)
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
    expect(f.controller.releasedEnemies).toHaveLength(assault ? 119 : 120)
  })

  it('wires a fresh complete battlefield into shared breach relief', () => {
    const gateId: TownGateId = 'north'
    const f = battlefieldFixture()
    f.controller.updateFlow(10, 0)
    const group = f.controller.groups.find(g => g.id === gateId)!
    const otherGate = 'west'
    const [enemy, distraction] = f.controller.enemies.slice(2, 4)
    const place = (npc: NPC, point: THREE.Vector3) => { npc.group.position.copy(point); npc.mount?.group.position.copy(point) }
    place(enemy, siegePoint(gateId, 0, 5))
    place(distraction, siegePoint(otherGate, 0, 5))
    f.player.group.position.copy(siegePoint(otherGate, 0, 5))
    f.gates.get(gateId)!.destroy()
    for (const npc of [...group.members, ...group.cavalry]) {
      expect(npc.missionMovement).toBe(false)
      expect((npc as any)._getTarget(.05, f.player, f.controller.enemies)?.npc).toBe(enemy)
      expect((npc as any)._trySwitchToVisibleRangedTarget(f.player, [distraction], null, [])).toBe(false)
    }
    const guard = group.cavalry[0]
    const start = guard.combatPosition.clone()
    guard.update(.05, f.player, [enemy, distraction], [], [], null as never, () => {}, () => {}, true)
    expect(guard.combatPosition.distanceTo(start)).toBeGreaterThan(0)
    place(enemy, siegePoint(otherGate, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._getTarget(.05, f.player, [enemy, distraction])).toBeNull()
    expect(guard.missionMovement).toBe(true)
    expect(siegeNearestGate((f.controller as any).orders.get(guard))).toBe(gateId)
    f.player.group.position.copy(siegePoint(gateId, 0, 5))
    f.controller.updateFlow(.05, 0)
    expect((guard as any)._getTarget(.05, f.player, [])?.isPlayer).toBe(true)
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

  it.each([10, 11])('Defense keeps civilian death threshold %s', deaths => {
    const f = checkpointFixture({ assault: false, residentIds: Array.from({ length: 11 }, (_, index) => 'civilian-' + index),
      attackerSlots: [], includeRanger: false })
    f.controller.enemies.forEach(npc => npc.takeDamage(999999))
    f.controller.civilians.slice(0, deaths).forEach(npc => npc.takeDamage(999999))
    expect(f.controller.evaluate(true)).toBe(deaths === 10 ? 'victory' : 'failure')
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


describe('Siege actual constructor frame budget', () => {
  it('creates the complete four-gate army one per frame before consuming preparation time', () => {
    const assault = true
    const h = battlefieldFixture(assault, true)
    const before = npcConstruction.count, total = assault ? 119 : 120
    expect(h.controller.startActiveMission()).toBe(true)
    expect(h.controller.startActiveMission()).toBe(true)
    expect(npcConstruction.count).toBe(before)
    for (let i = 1; i <= total; i++) {
      advanceNpcFrame(gameplayNpcSpawnDriver); expect(npcConstruction.count - before).toBe(i)
      if (i < total) {
        expect(h.controller.ready).toBe(false); h.controller.updateFlow(100, 0)
        expect(h.controller.preparationRemaining).toBe(10)
        expect(h.controller.evaluate()).toBeNull()
      }
    }
    expect(h.controller.ready).toBe(true); expect(h.controller.enemies).toHaveLength(total)
    expect(h.controller.enemies.filter(npc => npc.isMounted).every(npc => npc.mount?.riderNpc === npc)).toBe(true)
    expect(h.controller.preparationRemaining).toBe(10)
  })
})
