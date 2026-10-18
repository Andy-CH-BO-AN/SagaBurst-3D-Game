import type { BattleConfig } from '../battle/BattleConfig'
import type { BattleSpawnPlan } from '../battle/BattleSpawner'
import { COMMANDER_BRIDGEHEAD_ID, createBridgeheadRoster } from './CommanderMissionCatalog'
import { careerCombatPlayerLoadout } from './CaptainBattleLaunch'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { claimCareerMission, clearCareerMission, type CareerProfile } from './CareerProfile'
import type { CareerProfileStore } from './CareerProfileStore'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { BRIDGEHEAD_PREPARATION_SECONDS, resolveCareerMissionOutcome, type ActiveCareerMission, type BridgeBattleDeployment } from './CareerMissionState'
import { commanderActorConfirmedDead } from './CommanderOutpost'
import { stageMissionReturnRebuild } from './CareerMissionReturnRecovery'
import { townRoster } from '../town/TownRules'
import { legacyPersonalEquipment } from './CareerInventory'

/** A trusted Career launch, separate from Campaign stages and untrusted free battle config. */
export interface CareerBridgeBattleLaunch {
  type: 'career-bridge-battle'
  careerMissionId: string
  battle: BattleConfig
}

export function isCareerBridgeBattle(mission: ActiveCareerMission | undefined): boolean {
  return mission?.templateId === COMMANDER_BRIDGEHEAD_ID && mission.kind === 'commander-bridgehead-battle'
}

/** Only a durably claimed mission can leave the battlefield on reload. */
export function recoverClaimedCareerBridgeBattle(profile: CareerProfile,
  store: Pick<CareerProfileStore, 'save'>): 'resume' | 'return-to-town' | 'save-failed' {
  const mission = profile.activeMission
  if (!isCareerBridgeBattle(mission) || !mission || !profile.claimedBattleIds.includes(mission.id)) return 'resume'
  return store.save(clearCareerBridgeBattle(profile, mission.id)) ? 'return-to-town' : 'save-failed'
}

/** Carry battle-worn HR checkpoints through the same atomic save that clears the mission. */
export function clearCareerBridgeBattle(profile: CareerProfile, missionId: string): CareerProfile {
  const mission = profile.activeMission
  const next = clearCareerMission(profile, missionId)
  if (mission?.id !== missionId || !isCareerBridgeBattle(mission)
    || !mission.result && !profile.claimedBattleIds.includes(missionId)) return next
  return stageMissionReturnRebuild(next, townRoster().map(spec => ({ spec })), mission.personalSquad)
}

export function createCareerBridgeBattleLaunch(profile: CareerProfile): CareerBridgeBattleLaunch {
  const mission = profile.activeMission
  if (!isCareerBridgeBattle(mission) || !mission || profile.rank !== 'commander'
    || mission.officialSquad?.commandRank !== 'commander' || mission.officialSquad.missionId !== mission.id
    || mission.friendlyActorIds.length !== 200 || mission.targetActorIds.length !== 200) {
    throw new Error('Expected saved Commander Bridgehead mission')
  }
  return { type: 'career-bridge-battle', careerMissionId: mission.id, battle: {
    mode: 'formation', commandGrouping: 'squad', playerFaction: profile.faction,
    playerHeroId: resolveCareerHeroAsset(profile), playerLoadout: careerCombatPlayerLoadout(profile),
    roman: {}, viking: {}, rules: { respawnEnabled: false, includeCamps: false },
  } }
}

/** Older in-progress battles resume their existing assault rather than gaining another preparation period. */
export function resolveCareerBridgeDeployment(mission: ActiveCareerMission): BridgeBattleDeployment {
  if (mission.bridgeDeployment) return { ...mission.bridgeDeployment }
  const phase = mission.commanderMission?.deploymentComplete || mission.bridgeBattle?.ready ? 'assault'
    : mission.targetActorIds.some(id => {
      const actor = mission.bridgeBattle?.actors[id]
      return actor && actor.status !== 'reserve'
    }) ? 'spawning' : 'preparing'
  return { phase, preparationRemainingSeconds: phase === 'preparing' ? BRIDGEHEAD_PREPARATION_SECONDS : 0 }
}

export function createCareerBridgeSpawnPlan(profile: CareerProfile, wave: 'initial' | 'attackers' = 'initial'): BattleSpawnPlan {
  createCareerBridgeBattleLaunch(profile)
  const mission = profile.activeMission!
  const roster = createBridgeheadRoster(mission, profile.faction)
  const alive = (id: string) => !commanderActorConfirmedDead(mission, id)
    && mission.bridgeBattle?.actors[id]?.status !== 'dead' && mission.bridgeBattle?.actors[id]?.hp !== 0
  const enemy = resolveCareerBridgeDeployment(mission).phase !== 'preparing' ? roster.enemy : []
  return { playerSpawn: { x: 0, z: -108 }, horseSpecs: [], pickupSpecs: [],
    npcSpecs: [...(wave === 'initial' ? roster.friendly : []), ...enemy].filter(spec => alive(spec.actorId!)) }
}

/** Rider death does not remove a surviving, dismounted mount from the saved battlefield. */
export function createCareerBridgeOrphanMountPlan(profile: CareerProfile) {
  const mission = profile.activeMission!
  const enemy = createBridgeheadRoster(mission, profile.faction).enemy.flatMap(spec => {
    const actor = mission.bridgeBattle?.actors[spec.actorId!]
    return actor?.mount && actor.mount.hp > 0 && (commanderActorConfirmedDead(mission, spec.actorId!) || actor.status === 'dead' || actor.hp === 0)
      ? [{ actorId: spec.actorId!, mountId: spec.loadout!.mountId!, stableKey: spec.actorId!, saved: actor.mount }] : []
  })
  const personal = (profile.personalSquad?.members ?? []).flatMap(member => {
    if (!mission.personalSquad?.memberIds.includes(member.id)) return []
    const actor = mission.personalSquad.members[member.id]
    const mountId = (member.equipment ?? legacyPersonalEquipment(member.type, profile.faction)).mount
    return mountId && actor?.status === 'dead' && actor.mount && actor.mount.hp > 0
      ? [{ actorId: member.id, mountId, stableKey: `personal:${member.id}`, saved: actor.mount }] : []
  })
  return [...enemy, ...personal]
}

/** Stable objective accounting. Missing/queued actors remain alive; mount IDs never enter these sets. */
export class CareerBridgeBattleRuntime {
  private deploymentState: BridgeBattleDeployment
  get deployment(): Readonly<BridgeBattleDeployment> { return this.deploymentState }
  readonly friendlyIds: Set<string>
  readonly targetIds: Set<string>
  readonly deadFriendly: Set<string>
  readonly deadTargets: Set<string>
  friendlyAlive = 200
  enemyAlive = 200

  constructor(mission: ActiveCareerMission) {
    this.deploymentState = resolveCareerBridgeDeployment(mission)
    this.friendlyIds = new Set(mission.friendlyActorIds)
    this.targetIds = new Set(mission.targetActorIds)
    this.deadFriendly = new Set(mission.deadFriendlyActorIds)
    this.deadTargets = new Set(mission.deadTargetActorIds)
    for (const id of [...this.friendlyIds, ...this.targetIds]) {
      const saved = mission.bridgeBattle?.actors[id]
      if (commanderActorConfirmedDead(mission, id) || saved?.status === 'dead' || saved?.hp === 0) this.recordDeath(id)
    }
    this.updateCounts(mission)
  }

  /** Only the live gameplay caller advances this clock; loading and queued spawns consume no preparation time. */
  advancePreparation(dt: number): void {
    if (this.deploymentState.phase === 'preparing' && Number.isFinite(dt)) {
      this.deploymentState.preparationRemainingSeconds = Math.max(0, this.deploymentState.preparationRemainingSeconds - Math.max(0, dt))
    }
  }

  beginEnemyDeployment(save: (state: BridgeBattleDeployment) => boolean): boolean {
    if (this.deploymentState.phase !== 'preparing' || this.deploymentState.preparationRemainingSeconds > 0) return false
    return this.transition('spawning', save)
  }

  completeEnemyDeployment(deploymentReady: boolean, save: (state: BridgeBattleDeployment) => boolean): boolean {
    if (!deploymentReady || this.deploymentState.phase !== 'spawning') return false
    return this.transition('assault', save)
  }

  private transition(phase: BridgeBattleDeployment['phase'], save: (state: BridgeBattleDeployment) => boolean): boolean {
    const next = { phase, preparationRemainingSeconds: 0 }
    if (!save(next)) return false
    this.deploymentState = next
    return true
  }

  recordDeath(actorId: string): void {
    if (this.targetIds.has(actorId)) this.deadTargets.add(actorId)
    else if (this.friendlyIds.has(actorId)) this.deadFriendly.add(actorId)
  }

  observe(mission: ActiveCareerMission, actors: readonly { combatantId: string; dead: boolean }[]): void {
    for (const actor of actors) if (actor.dead) this.recordDeath(actor.combatantId)
    this.updateCounts(mission)
  }

  private updateCounts(mission: ActiveCareerMission): void {
    this.friendlyAlive = mission.friendlyActorIds.reduce((n, id) => n + Number(!this.deadFriendly.has(id)), 0)
    this.enemyAlive = mission.targetActorIds.reduce((n, id) => n + Number(!this.deadTargets.has(id)), 0)
  }

  outcome(playerDead: boolean, deploymentReady: boolean, personalAlive = 0) {
    if (!deploymentReady || this.deploymentState.phase !== 'assault') return null
    return resolveCareerMissionOutcome(playerDead, true, this.enemyAlive, this.friendlyAlive + personalAlive)
  }
}

/** Result publication is acknowledged only after the complete reward/claim transaction saves. */
export function commitCareerBridgeBattleResult(store: Pick<CareerProfileStore, 'loadChecked' | 'save'>,
  missionId: string, stats: BattleStatsSnapshot) {
  const profile = store.loadChecked().profile
  const mission = profile?.activeMission
  if (!profile || !mission || mission.id !== missionId || !isCareerBridgeBattle(mission)) return null
  const runtime = new CareerBridgeBattleRuntime(mission)
  const personalAlive = mission.personalSquad?.memberIds.filter(id => {
    const actor = mission.personalSquad!.members[id]
    return actor && actor.hp !== 0 && (actor.status === 'deployed'
      || actor.status === 'reserve' && mission.personalSquad!.pendingMemberIds?.includes(id))
  }).length ?? 0
  const outcome = mission.result?.outcome ?? runtime.outcome(mission.playerDead === true,
    mission.commanderMission?.deploymentComplete === true && mission.bridgeBattle?.ready === true, personalAlive)
  if (!outcome) return null
  const claim = claimCareerMission(profile, missionId, outcome, stats.player, stats.meritPlayer)
  return store.save(claim.profile) ? claim : null
}
