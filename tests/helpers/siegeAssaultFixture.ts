import * as THREE from 'three'
import { onTestFinished } from 'vitest'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import { AIType, Faction, type NPC } from '../../src/world/NPC'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
import { FallingRider } from '../../src/movement/FallingRider'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { createOutpostWalkways } from '../../src/campaign/CampaignOutpostWalkways'
import { CampaignGateController, CampaignBreachController, applyCampaignBreachOrders } from '../../src/campaign/CampaignGate'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { positionDefenseCampaignAttackers } from '../../src/campaign/DefenseCampaignLaunch'
import { CampaignSiegeAssault } from '../../src/campaign/CampaignSiegeAssault'

/** Typed caller boundary, no real NPC/materialization/locomotion. Runtime movement has a separate owner. */
export function siegeActorRecord(spec: NpcSpawnSpec): NPC {
  const position = new THREE.Vector3(spec.x, spec.spawnY ?? getTerrainHeight(spec.x, spec.z), spec.z)
  const group = new THREE.Group(); group.position.copy(position)
  const actor = {
    combatantId: spec.actorId!, dead: false, group, position: group.position, combatPosition: group.position,
    characterFaction: spec.characterFaction, aiType: spec.aiType, isMounted: false,
    siegeTransport: null as string | null, siegeEvacuation: null as THREE.Vector3 | null,
    campaignEntranceId: null as string | null, campaignBreachCompleted: false, combatOwnership: 'battle',
    siegeObstacle: null as ObstacleData | null, tacticalOrder: 'attack',
    activeFollowTarget: null, hasFormationTarget: false, pendingFall: new FallingRider(),
    get hasSiegeObstacle() { return this.siegeObstacle !== null },
    assignSiegeObstacle(obstacle: ObstacleData | null) { this.siegeObstacle = obstacle },
    setTacticalOrder(order: string) { this.tacticalOrder = order },
  }
  // Only CampaignSiegeAssault's actor protocol is under test, never NPC internals.
  return actor as unknown as NPC
}

/** 0 NPCs, 0 Mounts, 0 full Outposts; real walkway producer + gate + navigation + siege owner. */
export function siegeAssaultFixture(faction: 'roman' | 'viking' = 'roman', rangedMain = false, deploy = true,
  options: { specs?: NpcSpawnSpec[]; prepare?: boolean; saved?: import('../../src/campaign/CampaignSiegeCheckpoint').CampaignSiegeCheckpoint; acceptsOrders?: (npc: NPC) => boolean } = {}) {
  const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial()
  const obstacles: ObstacleData[] = [], obstacleMeshes: THREE.Object3D[] = []
  const placement = getCampaignOutpostPlacement(faction)
  const walkways = createOutpostWalkways(placement, { obstacles, obstacleMeshes }, material, material, true)
  scene.add(walkways.root)
  const navigation = new NavigationWorld()
  navigation.setOutpostWalkways(walkways.layout)
  const box = new THREE.Box3(new THREE.Vector3(-4, -10, placement.frontZ - .4), new THREE.Vector3(4, 4, placement.frontZ + .4))
  const damageable = new DamageableObstacle({ kind: 'gate', maxHp: 2080, root: new THREE.Group(), ownerFaction: faction })
  const obstacle: ObstacleData = { box, isBarricade: true, damageable }
  obstacles.push(obstacle)
  const gate = new CampaignGateController({ defenderFaction: faction, damageable, obstacle, obstacles,
    leftHinge: new THREE.Group(), rightHinge: new THREE.Group(), openRotationY: 1 })
  const palisade = new DamageableObstacle({ kind: 'palisade', maxHp: 780, root: new THREE.Group(), ownerFaction: faction })
  palisade.root.name = 'front-palisade-test'
  const palisadeObstacle: ObstacleData = { box: new THREE.Box3(new THREE.Vector3(5, -10, placement.frontZ - .4),
    new THREE.Vector3(15, 4, placement.frontZ + .4)), isBarricade: true, damageable: palisade }
  obstacles.push(palisadeObstacle)
  const actors: NPC[] = []
  const breach = new CampaignBreachController()
  const owner = new CampaignSiegeAssault(scene, obstacles, walkways, navigation, gate, breach, () => actors, () => {}, () => {}, undefined, options.acceptsOrders)
  const off = breach.onBreach(() => { owner.refreshPhysicalEntrances(); applyCampaignBreachOrders(actors.filter(npc => options.acceptsOrders?.(npc) ?? true), gate.attackerFaction) })
  onTestFinished(() => {
    off(); owner.dispose()
    walkways.root.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose() })
    material.dispose(); scene.clear()
  })
  const specs: NpcSpawnSpec[] = options.specs ?? Array.from({ length: 21 }, (_, i) => ({ actorId: `attacker-${i}`, x: i, z: 0,
    faction: Faction.ENEMY, characterFaction: gate.attackerFaction, aiType: rangedMain && i === 20 ? AIType.RANGED : AIType.MELEE, name: `Actor ${i}`,
    tier: 2, cavalry: false, respawnEnabled: false }))
  if (!options.specs) positionDefenseCampaignAttackers(specs, faction)
  if (options.prepare !== false) owner.prepare(specs, options.saved)
  if (deploy) for (const spec of specs) { const npc = siegeActorRecord(spec); actors.push(npc); owner.register(npc, spec) }
  navigation.sync(obstacles)
  return { scene, owner, specs, actors, gate, breach, navigation, obstacles, walkways, palisade }
}
