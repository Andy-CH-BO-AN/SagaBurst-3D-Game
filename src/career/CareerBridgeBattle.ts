import type { BattleConfig } from '../battle/BattleConfig'
import type { BattleSpawnPlan } from '../battle/BattleSpawner'
import { COMMANDER_BRIDGEHEAD_ID, createBridgeheadRoster } from './CommanderMissionCatalog'
import { careerCombatPlayerLoadout } from './CaptainBattleLaunch'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { claimCareerMission, type CareerProfile } from './CareerProfile'
import type { CareerProfileStore } from './CareerProfileStore'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { resolveCareerMissionOutcome, type ActiveCareerMission } from './CareerMissionState'
import { commanderActorConfirmedDead } from './CommanderOutpost'

/** A trusted Career launch, separate from Campaign stages and untrusted free battle config. */
export interface CareerBridgeBattleLaunch {
  type: 'career-bridge-battle'
  careerMissionId: string
  battle: BattleConfig
}

export function isCareerBridgeBattle(mission: ActiveCareerMission | undefined): boolean {
  return mission?.templateId === COMMANDER_BRIDGEHEAD_ID && mission.kind === 'commander-bridgehead-battle'
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

export function createCareerBridgeSpawnPlan(profile: CareerProfile): BattleSpawnPlan {
  createCareerBridgeBattleLaunch(profile)
  const mission = profile.activeMission!
  const roster = createBridgeheadRoster(mission, profile.faction)
  const alive = (id: string) => !commanderActorConfirmedDead(mission, id)
    && mission.bridgeBattle?.actors[id]?.status !== 'dead' && mission.bridgeBattle?.actors[id]?.hp !== 0
  return { playerSpawn: { x: 0, z: -108 }, horseSpecs: [], pickupSpecs: [],
    npcSpecs: [...roster.friendly, ...roster.enemy].filter(spec => alive(spec.actorId!)) }
}

/** Rider death does not remove a surviving, dismounted mount from the saved battlefield. */
export function createCareerBridgeOrphanMountPlan(profile: CareerProfile) {
  const mission = profile.activeMission!
  return createBridgeheadRoster(mission, profile.faction).enemy.flatMap(spec => {
    const actor = mission.bridgeBattle?.actors[spec.actorId!]
    return actor?.mount && actor.mount.hp > 0 && (commanderActorConfirmedDead(mission, spec.actorId!) || actor.status === 'dead' || actor.hp === 0)
      ? [{ actorId: spec.actorId!, mountId: spec.loadout!.mountId!, stableKey: `${spec.characterFaction}:${spec.name}:${spec.tier}`, saved: actor.mount }] : []
  })
}

/** Stable objective accounting. Missing/queued actors remain alive; mount IDs never enter these sets. */
export class CareerBridgeBattleRuntime {
  readonly friendlyIds: Set<string>
  readonly targetIds: Set<string>
  readonly deadFriendly: Set<string>
  readonly deadTargets: Set<string>
  readonly squadAlive = Array<number>(8).fill(25)
  friendlyAlive = 200
  enemyAlive = 200

  constructor(mission: ActiveCareerMission) {
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
    for (const squad of mission.officialSquad?.squads ?? []) {
      this.squadAlive[squad.squadId - 1] = squad.actorIds.reduce((n, id) => n + Number(!this.deadFriendly.has(id)), 0)
    }
  }

  outcome(playerDead: boolean, deploymentReady: boolean) {
    if (!deploymentReady) return null
    return resolveCareerMissionOutcome(playerDead, true, this.enemyAlive, this.friendlyAlive)
  }
}

/** Result publication is acknowledged only after the complete reward/claim transaction saves. */
export function commitCareerBridgeBattleResult(store: Pick<CareerProfileStore, 'loadChecked' | 'save'>,
  missionId: string, stats: BattleStatsSnapshot) {
  const profile = store.loadChecked().profile
  const mission = profile?.activeMission
  if (!profile || !mission || mission.id !== missionId || !isCareerBridgeBattle(mission)) return null
  const runtime = new CareerBridgeBattleRuntime(mission)
  const outcome = mission.result?.outcome ?? runtime.outcome(mission.playerDead === true,
    mission.commanderMission?.deploymentComplete === true && mission.bridgeBattle?.ready === true)
  if (!outcome) return null
  const claim = claimCareerMission(profile, missionId, outcome, stats.player, stats.meritPlayer)
  return store.save(claim.profile) ? claim : null
}
