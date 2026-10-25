import { getOrdinarySoldierHp } from '../combat/OrdinarySoldierProfile'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { Faction } from '../combat/CombatFaction'
import { resolveSkillAdjustedMaxHp } from '../rpg/CombatSkillProgression'
import { townRoster, townMilitaryEquipment, townActorHeroProfile, isCivilian } from '../town/TownRules'
import { outskirtsSquadSpecs } from '../town/TownOutskirtsRules'
import type { TownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import { createVeteranRoster, createVeteranSpawnSpec, getVeteranMissionDefinition, restoreVeteranTownCavalryReserveRoster } from './VeteranMission'
import { createLastStandRoster, createBridgeheadRoster } from './CommanderMissionCatalog'
import { createCommanderFourGateDefenseRoster } from './CommanderFourGateDefenseRoster'
import { siegeRoster, siegeRosterVersion, siegeActorCharacterTier } from './TownSiege'
import { BattleSpawner, type NpcSpawnSpec } from '../battle/BattleSpawner'
import { createDefenseCampaignWaveConfig, createDefaultDefensePlayerLoadout, type DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { createCareerOutpostDefenderArmy, careerOutpostActorId } from './CareerOutpostRoster'
import { createCareerReliefSpawnPlan } from './CareerOutpostRelief'
import { createCaptainFrontlineLaunch } from './CaptainBattleLaunch'
import { createSweepRoster } from './CavalrySweep'
import { resolveCareerPlayerMaxHp } from './CareerPlayerProfile'
import type { CareerProfile } from './CareerProfile'

type Culture = CareerProfile['faction']
type OrdinaryIdentity = { faction: Culture; tier: 1 | 2 | 3 }
type HealthRecord = { hp?: number; dead?: boolean; status?: string }
const opposite = (faction: Culture): Culture => faction === 'roman' ? 'viking' : 'roman'

/** A versioned, parsed Career save has a known legacy 200 ordinary base.
 * Only identified ordinary people migrate; mounts, gates and heroes are never traversed. */
export function migrateCareerHealth(profile: CareerProfile): void {
  if (profile.healthRulesVersion === 1) return
  const visited = new WeakSet<object>()
  const convert = (record: HealthRecord | undefined, oldMax: number, newMax: number) => {
    if (!record || visited.has(record)) return
    visited.add(record)
    if (typeof record.hp !== 'number' || !Number.isFinite(record.hp)) return
    record.hp = record.dead || record.status === 'dead' ? 0
      : Math.min(newMax, Math.max(0, record.hp / oldMax * newMax))
  }
  const oldPlayerMax = resolveSkillAdjustedMaxHp(COMBAT_BALANCE.hp.playerDefault, profile.skills)
  const newPlayerMax = resolveCareerPlayerMaxHp(profile, COMBAT_BALANCE.hp.playerDefault)
  const ordinaryPlayer = profile.rank === 'recruit' || profile.rank === 'soldier' || profile.rank === 'veteran'
  const player = (record: HealthRecord | undefined) => { if (ordinaryPlayer) convert(record, oldPlayerMax, newPlayerMax) }
  const identities = new Map<string, OrdinaryIdentity>()
  const add = (id: string, faction: Culture, tier: number) => {
    if (tier === 1 || tier === 2 || tier === 3) identities.set(id, { faction, tier })
    else identities.delete(id)
  }
  const addSpec = (spec: NpcSpawnSpec, id = spec.actorId) => {
    if (!id) return
    if (spec.faction === Faction.BANDIT || spec.combatProfileId || spec.specialCombatProfile || spec.visualAssetId) identities.delete(id)
    else add(id, spec.characterFaction, spec.tier)
  }
  const addTown = (faction: Culture, prefix = '') => {
    for (const spec of townRoster()) {
      if (isCivilian(spec.role) || spec.role === 'cat' || spec.role === 'ranger' || spec.role === 'eagle-trainer' || townActorHeroProfile(faction, spec)) continue
      add(`${prefix}${spec.id}`, faction, townMilitaryEquipment(faction, spec).level)
    }
  }
  addTown(profile.faction)
  addTown(opposite(profile.faction), 'enemy-town:')
  const townIdentities = new Map(identities)
  for (const member of profile.personalSquad?.members ?? []) if (member.type === 'soldier') add(member.id, profile.faction, 2)
  const actor = (id: string, record: HealthRecord | undefined, identity = identities.get(id)) => {
    if (identity) convert(record, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(identity.faction, identity.tier))
  }
  const actors = (records: Record<string, HealthRecord> | undefined) => {
    for (const [id, record] of Object.entries(records ?? {})) actor(id, record)
  }
  const outskirts = (checkpoint: TownOutskirtsCheckpoint | undefined, townFaction: Culture) => {
    const cavalryIds = new Set(outskirtsSquadSpecs().filter(s => s.kind === 'cavalry').map(s => s.id))
    for (const squad of checkpoint?.squads ?? []) {
      if (!cavalryIds.has(squad.id) || squad.cavalryTier === 4) continue
      for (const [id, record] of Object.entries(squad.members)) actor(id, record, { faction: opposite(townFaction), tier: 2 })
    }
  }
  const mission = profile.activeMission
  if (mission) {
    if (mission.kind === 'captain-eagle-battle') {
      for (const id of mission.friendlyActorIds) add(id, profile.faction, 3)
      for (const id of mission.targetActorIds) add(id, opposite(profile.faction), 3)
    }
    if (mission.kind === 'captain-outpost-defense') {
      const launch = createCaptainFrontlineLaunch(profile)
      for (const wave of ['initial', 'attackers', 'reinforcement'] as const) {
        // Frontline placement changes coordinates/squads, not spawn order or identity.
        const plan = BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, wave === 'initial' ? 'defenders' : wave))
        plan.npcSpecs.forEach((spec, index) => addSpec(spec, careerOutpostActorId(mission.id, wave, index)))
      }
    }
    if (mission.kind === 'cavalry-sweep') {
      const residentIds = new Set(townRoster().flatMap(spec => [spec.id, `enemy-town:${spec.id}`]))
      createSweepRoster(profile.faction).forEach((spec, index) => {
        const id = mission.friendlyActorIds[index]
        if (id && !residentIds.has(id)) addSpec(spec, id)
      })
    }
    const veteran = getVeteranMissionDefinition(mission.templateId)
    if (veteran) {
      const roster = createVeteranRoster(veteran.id, profile.faction, mission.id, mission.veteranRosterVersion ?? 1,
        mission.borrowedActorIds)
      restoreVeteranTownCavalryReserveRoster(roster, mission)
      for (const unit of [...roster.friendly, ...roster.reinforcements]) {
        // Field missions borrow the live resident: temporary equipment never changes
        // its formal tier. Outpost battles instead materialize every roster spec.
        if (veteran.kind === 'veteran-field' && unit.source === 'town') continue
        addSpec(createVeteranSpawnSpec(unit, profile.faction))
      }
      for (const unit of roster.enemy) addSpec(createVeteranSpawnSpec(unit, profile.faction, 'enemy'))
    }
    if (mission.kind === 'commander-outpost-last-stand' || mission.kind === 'commander-bridgehead-battle') {
      const roster = mission.kind === 'commander-bridgehead-battle' ? createBridgeheadRoster(mission, profile.faction) : createLastStandRoster(mission, profile.faction)
      for (const spec of [...roster.friendly, ...roster.enemy]) addSpec(spec)
    }
    if (mission.fourGateDefense) for (const spec of createCommanderFourGateDefenseRoster(mission.id, opposite(profile.faction)).all) addSpec(spec)
    if (mission.siege) {
      const assault = mission.kind === 'enemy-town-assault'
      const faction = assault ? profile.faction : opposite(profile.faction)
      siegeRoster(faction, assault, siegeRosterVersion(mission.siege)).forEach(({ spec }, index) => {
        const id = mission.siege!.attackerIds[index]
        if (id) {
          addSpec(spec, id)
          const identity = identities.get(id)
          if (identity) add(id, identity.faction, siegeActorCharacterTier(id, spec.tier))
        }
      })
    }
    // Duels only change a resident's equipment; its Town formal tier remains authoritative.
  }
  const outpost = profile.activeOutpostMission
  if (outpost?.battle) {
    const relief = outpost.kind === 'outpost-relief'
    const launch: DefenseCampaignLaunchConfig = {
      type: 'defense', defenderFaction: profile.faction, stageId: outpost.stageId,
      careerMissionId: outpost.id, careerMissionKind: outpost.kind,
      defenderArmy: createCareerOutpostDefenderArmy(profile.faction, outpost),
      playerLoadout: createDefaultDefensePlayerLoadout(profile.faction),
      capabilities: { reinforcementsEnabled: !relief, playerCommandsEnabled: false, gateControlEnabled: false, attackerHeroesEnabled: false },
    }
    for (const wave of ['initial', 'attackers', 'reinforcement'] as const) {
      if (relief && wave === 'reinforcement') continue
      const plan = relief && wave === 'initial' ? createCareerReliefSpawnPlan(launch)
        : BattleSpawner.createSpawnPlan(createDefenseCampaignWaveConfig(launch, wave === 'initial' ? 'defenders' : wave))
      plan.npcSpecs.forEach((spec, index) => addSpec(spec, careerOutpostActorId(outpost.id, wave, index)))
    }
  }
  player(profile.playerAerialState)
  player(profile.racePlayerState)
  player(profile.activeRace?.player)
  if (profile.activeRace && profile.activeRace.opponent.actorId === `race:${profile.activeRace.id}`)
    convert(profile.activeRace.opponent, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(profile.faction, 1))
  player(profile.retirementRuntime?.player)
  actors(profile.personalSquadRuntime?.members)
  const nativeActors = (records: Record<string, HealthRecord> | undefined, faction: Culture) => {
    for (const [id, record] of Object.entries(records ?? {})) {
      const identity = townIdentities.get(id.replace(/^enemy-town:/, ''))
      if (identity) actor(id, record, { ...identity, faction })
    }
  }
  nativeActors(profile.townCommandSquad?.members, profile.townCommandSquad?.townFaction ?? profile.faction)
  nativeActors(profile.retirementTowerGuards, profile.faction)
  for (const faction of ['roman', 'viking'] as const) {
    // Rider HP is separate from the eagle mount checkpoint in both owners.
    for (const pair of profile.enemyEaglePatrols?.[faction]?.pairs ?? [])
      convert(pair.member, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(opposite(faction), 3))
    for (const pair of profile.townEagleGarrisons?.[faction]?.pairs ?? [])
      convert(pair, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(faction, 3))
    outskirts(profile.townOutskirts?.[faction], faction)
    for (const squad of profile.townPatrols?.[faction]?.squads ?? []) {
      for (const [id, record] of Object.entries(squad.members)) {
        const identity = townIdentities.get(id.replace(/^enemy-town:/, ''))
        if (identity) actor(id, record, { ...identity, faction })
      }
    }
  }
  const battle = (checkpoint: NonNullable<CareerProfile['activeOutpostMission']>['battle']) => {
    if (!checkpoint) return
    player(checkpoint.player)
    actors(checkpoint.actors)
    for (const [id, saved] of Object.entries(checkpoint.actors)) actor(id, saved.checkpoint)
  }
  battle(outpost?.battle)
  actors(outpost?.officialSquad?.members)
  actors(outpost?.personalSquad?.members)
  if (mission) {
    if (ordinaryPlayer) {
      if (mission.playerHp !== undefined) { const saved = { hp: mission.playerHp, dead: mission.playerDead }; player(saved); mission.playerHp = saved.hp }
      if (mission.duelPlayerHp !== undefined) { const saved = { hp: mission.duelPlayerHp, dead: mission.playerDead }; player(saved); mission.duelPlayerHp = saved.hp }
    }
    if (mission.duelOpponentHp !== undefined && mission.duelOpponentActorId) {
      const saved = { hp: mission.duelOpponentHp, dead: mission.duelOpponentDead }; actor(mission.duelOpponentActorId, saved); mission.duelOpponentHp = saved.hp
    }
    actors(mission.actorHealth)
    actors(mission.officialSquad?.members)
    actors(mission.patrolAmbient?.members)
    actors(mission.personalSquad?.members)
    outskirts(mission.patrolOutskirts, profile.faction)
    battle(mission.battle)
    actors(mission.fourGateDefense?.siege?.actors)
    for (const checkpoint of [mission.eagleBattle, mission.bridgeBattle, mission.fourGateDefense]) {
      player(checkpoint?.player)
      actors(checkpoint?.actors)
    }
  }
  profile.healthRulesVersion = 1
}
