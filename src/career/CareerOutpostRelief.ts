import * as THREE from 'three'
import { BattleSpawner, type BattleSpawnPlan, type NpcSpawnSpec } from '../battle/BattleSpawner'
import { createEmptyRomanArmyConfig, createEmptyVikingArmyConfig } from '../battle/BattleConfig'
import { returnFollowLocalOffset, followSlotWorldPosition } from '../battle/FollowOrder'
import { createDefenseCampaignWaveConfig, positionDefenseCampaignReinforcements, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { getCampaignOutpostPlacement, getCampaignDefenderFacingYaw } from '../campaign/CampaignOutpost'
import { resolveCampaignRolePreset } from '../campaign/CampaignConfig'
import { applyCampaignBreachOrders, type CampaignGateController } from '../campaign/CampaignGate'
import { AIType, type NPC } from '../world/NPC'

export const RELIEF_CHARGE_DISTANCE = 50
const SECOND_SQUAD_OFFSET = new THREE.Vector3(28, 0, -4.4)
export function reliefFollowOffset(index: number): THREE.Vector3 {
  return returnFollowLocalOffset(index, 24, true, 5)
}

/** Use the authoritative Campaign roles, tier loadouts and T4 hero factory. */
export function createCareerReliefSpawnPlan(launch: DefenseCampaignLaunchConfig): BattleSpawnPlan {
  if (launch.careerMissionKind !== 'outpost-relief') throw new Error('Expected Career relief launch')
  const defenders = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'defenders'))
  const attackers = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, 'attackers'))
  const rescueConfig = createDefenseCampaignWaveConfig(launch, 'defenders')
  rescueConfig.viking = createEmptyVikingArmyConfig()
  rescueConfig.roman = createEmptyRomanArmyConfig()
  const cavalry = resolveCampaignRolePreset(launch.defenderFaction, 'sword_cavalry')
  const ranger = launch.defenderFaction === 'roman' ? 'roman_archer' : 'viking_archer'
  Object.assign(rescueConfig[launch.defenderFaction], {
    [cavalry]: { 1: 47, 2: 0, 3: 0, 4: 1 },
    [ranger]: { 1: 0, 2: 0, 3: 0, 4: 1 },
  })
  const rescue = BattleSpawner.createSpawnPlan(rescueConfig).npcSpecs
  const captain = rescue.find(spec => spec.tier === 4 && spec.specialCombatProfile !== 'maki-ranger')!
  const maki = rescue.find(spec => spec.specialCombatProfile === 'maki-ranger')!
  captain.name = 'Captain'; captain.squadId = 1
  maki.name = 'Maki'; maki.squadId = 2
  maki.cavalry = true
  maki.loadout = { ...maki.loadout!, mountId: 'black-cat' }
  const soldiers = rescue.filter(spec => spec.tier === 1)
  // Squad A has 24 NPCs + Player. Squad B has 25 NPCs.
  soldiers.forEach((spec, index) => { spec.squadId = index < 23 ? 1 : 2 })
  positionDefenseCampaignReinforcements([captain], launch.defenderFaction)
  const yaw = getCampaignDefenderFacingYaw(launch.defenderFaction) + Math.PI
  captain.x = -14 * Math.cos(yaw)
  const captainPosition = new THREE.Vector3(captain.x, 0, captain.z)
  const makiPosition = followSlotWorldPosition(captainPosition, yaw, SECOND_SQUAD_OFFSET)
  maki.x = makiPosition.x; maki.z = makiPosition.z
  const playerPosition = followSlotWorldPosition(captainPosition, yaw, reliefFollowOffset(0))
  let slotA = 1, slotB = 0
  for (const spec of soldiers) {
    const position = followSlotWorldPosition(spec.squadId === 1 ? captainPosition : makiPosition, yaw, reliefFollowOffset(spec.squadId === 1 ? slotA++ : slotB++))
    spec.x = position.x; spec.z = position.z
  }
  const outpost = getCampaignOutpostPlacement(launch.defenderFaction)
  const inward = Math.sign(outpost.backZ - outpost.frontZ)
  // Initial melee fighting is inside the breach corridor; bows fire from the outside.
  const positionNearBreach = (specs: NpcSpawnSpec[], inside: boolean) => {
    specs.forEach((spec, index) => {
      spec.x = ((index % 5) - 2) * 3.5
      spec.z = outpost.frontZ + inward * (inside ? 7 + Math.floor(index / 5) * 4 : -8 - Math.floor(index / 5) * 4)
    })
  }
  positionNearBreach(defenders.npcSpecs, true)
  for (const spec of defenders.npcSpecs) spec.z += inward * 19
  positionNearBreach(attackers.npcSpecs.filter(spec => !spec.cavalry && spec.aiType !== AIType.RANGED), true)
  positionNearBreach(attackers.npcSpecs.filter(spec => spec.cavalry || spec.aiType === AIType.RANGED), false)
  // Reload preserves the march/charge transition so an existing mission cannot
  // replay Captain's command. The shared Outpost reload still rebuilds combatants.
  if (launch.careerReliefPhase === 'charge') {
    const shiftX = -captain.x
    const shiftZ = outpost.frontZ - inward * RELIEF_CHARGE_DISTANCE - captain.z
    for (const spec of rescue) { spec.x += shiftX; spec.z += shiftZ }
    playerPosition.x += shiftX; playerPosition.z += shiftZ
  }
  for (const spec of [...defenders.npcSpecs, ...attackers.npcSpecs]) spec.squadId = undefined
  return {
    playerSpawn: { x: playerPosition.x, z: playerPosition.z },
    npcSpecs: [...defenders.npcSpecs, ...attackers.npcSpecs, captain, maki, ...soldiers],
    horseSpecs: [], pickupSpecs: [],
  }
}

/** Invoke the complete destruction lifecycle, including collision and breach observers. */
export function initializeCareerReliefBattlefield(gate: CampaignGateController, npcs: readonly NPC[]): void {
  gate.damageable.destroy()
  applyCampaignBreachOrders(npcs, gate.attackerFaction)
}

/** NPC commands only: Player remains an independent rider in Captain's squad. */
export class CareerReliefMarchController {
  private started = false
  private charged = false
  private readonly captain: NPC
  private readonly maki: NPC
  private readonly rescue: NPC[]
  constructor(
    npcs: readonly NPC[],
    private readonly breach: THREE.Vector3,
    private readonly followVoice: () => void,
    private readonly chargeVoice: () => void,
    private readonly resumeCharged = false,
  ) {
    this.rescue = npcs.filter(npc => npc.squadId === 1 || npc.squadId === 2)
    this.captain = this.rescue.find(npc => npc.name === 'Captain')!
    this.maki = this.rescue.find(npc => npc.name === 'Maki')!
    if (!this.captain?.mount || !this.maki?.mount) throw new Error('Relief requires mounted Captain and Maki')
  }
  start(): void {
    if (this.started) return
    this.started = true
    if (this.resumeCharged) {
      this.charged = true
      for (const npc of this.rescue) if (!npc.dead) npc.setTacticalOrder('charge')
      return
    }
    const speed = Math.min(...this.rescue.map(npc => npc.mount!.baseSpeed))
    const facing = this.breach.clone().sub(this.captain.combatPosition).setY(0).normalize()
    this.captain.assignFormationTarget(1, this.breach, facing, speed)
    this.maki.assignFollowTarget(this.captain, 0, SECOND_SQUAD_OFFSET, speed)
    let slotA = 1, slotB = 0
    for (const npc of this.rescue) {
      if (npc === this.captain || npc === this.maki) continue
      const leader = npc.squadId === 1 ? this.captain : this.maki
      const slot = npc.squadId === 1 ? slotA++ : slotB++
      npc.assignFollowTarget(leader, slot, reliefFollowOffset(slot), speed)
    }
    this.followVoice()
  }
  update(): void {
    if (!this.started || this.charged) return
    const distance = Math.hypot(this.captain.combatPosition.x - this.breach.x, this.captain.combatPosition.z - this.breach.z)
    // Release survivors if either leader falls before reaching the charge point.
    if (distance > RELIEF_CHARGE_DISTANCE && !this.captain.dead && !this.maki.dead) return
    this.charged = true
    for (const npc of this.rescue) if (!npc.dead) npc.setTacticalOrder('charge')
    if (!this.captain.dead) this.chargeVoice()
  }
  get hasCharged(): boolean { return this.charged }
}
