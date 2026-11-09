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
import { HERO_COMBAT_PROFILES } from '../battle/HeroCombatProfile'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import type { CareerProfile } from './CareerProfile'

type Culture = CareerProfile['faction']
type HealthIdentity = { faction: Culture; tier: 1 | 2 | 3 | 'commander' }
type HealthRecord = { hp?: number; dead?: boolean; status?: string }
const opposite = (faction: Culture): Culture => faction === 'roman' ? 'viking' : 'roman'

/** Convert identified human wounds once; mounts and gates retain their own health.
 * Ordinary saves used a 200 base; Viking Commander saves used a 950 base. */
export function migrateCareerHealth(profile: CareerProfile): void {
  const ordinaryMigration = profile.healthRulesVersion !== 1
  const commanderMigration = profile.commanderHealthVersion !== 1
  if (!ordinaryMigration && !commanderMigration) return
  const visited = new WeakSet<object>()
  const convert = (record: HealthRecord | undefined, oldMax: number, newMax: number) => {
    if (!record || visited.has(record)) return
    visited.add(record)
    if (typeof record.hp !== 'number' || !Number.isFinite(record.hp)) return
    record.hp = record.dead || record.status === 'dead' ? 0
      : Math.min(newMax, Math.max(0, record.hp / oldMax * newMax))
  }
  const commanderPlayer = profile.faction === 'viking' && profile.rank === 'commander'
  const oldPlayerMax = resolveSkillAdjustedMaxHp(commanderPlayer ? 950 : COMBAT_BALANCE.hp.playerDefault, profile.skills)
  const newPlayerMax = resolveCareerPlayerMaxHp(profile, COMBAT_BALANCE.hp.playerDefault)
  const ordinaryPlayer = profile.rank === 'recruit' || profile.rank === 'soldier' || profile.rank === 'veteran'
  const migratePlayer = ordinaryPlayer && ordinaryMigration || commanderPlayer && commanderMigration
  const player = (record: HealthRecord | undefined) => { if (migratePlayer) convert(record, oldPlayerMax, newPlayerMax) }
  const identities = new Map<string, HealthIdentity>()
  const add = (id: string, faction: Culture, tier: number | 'commander') => {
    if (tier === 1 || tier === 2 || tier === 3 || tier === 'commander') identities.set(id, { faction, tier })
    else identities.delete(id)
  }
  const addSpec = (spec: NpcSpawnSpec, id = spec.actorId) => {
    if (!id) return
    if (spec.combatProfileId === 'viking-commander' || spec.combatProfileId === 'roman-commander') add(id, spec.characterFaction, 'commander')
    else if (spec.faction === Faction.BANDIT || spec.combatProfileId || spec.specialCombatProfile || spec.visualAssetId) identities.delete(id)
    else add(id, spec.characterFaction, spec.characterTier ?? spec.tier)
  }
  const addTown = (faction: Culture, prefix = '') => {
    for (const spec of townRoster()) {
      if (spec.role === 'commander') { add(`${prefix}${spec.id}`, faction, 'commander'); continue }
      if (isCivilian(spec.role) || spec.role === 'cat' || spec.role === 'ranger' || spec.role === 'eagle-trainer' || townActorHeroProfile(faction, spec)) continue
      add(`${prefix}${spec.id}`, faction, townMilitaryEquipment(faction, spec).level)
    }
    // The Commander is conditionally spawned outside townRoster's authored residents.
    add(`${prefix}${TOWN_COMMANDER_ID}`, faction, 'commander')
  }
  addTown(profile.faction)
  addTown(opposite(profile.faction), 'enemy-town:')
  const townIdentities = new Map(identities)
  for (const member of profile.personalSquad?.members ?? []) {
    if (member.type === 'soldier') add(member.id, member.characterFaction ?? profile.faction, member.characterTier ?? 2)
    if (member.type === 'commander') add(member.id, member.characterFaction ?? profile.faction, 'commander')
  }
  const actor = (id: string, record: HealthRecord | undefined, identity = identities.get(id)) => {
    if (!identity) return
    if (identity.tier === 'commander') {
      if (commanderMigration && identity.faction === 'viking') convert(record, 950, HERO_COMBAT_PROFILES['viking-commander'].maxHp)
    } else if (ordinaryMigration) convert(record, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(identity.faction, identity.tier))
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
    if (mission.fourGateDefense) for (const spec of createCommanderFourGateDefenseRoster(mission.id, opposite(profile.faction), mission.fourGateDefense.enemyRosterVersion === 2 ? 2 : 1).all) addSpec(spec)
    if (mission.siege) {
      const assault = mission.kind === 'enemy-town-assault'
      const faction = assault ? profile.faction : opposite(profile.faction)
      siegeRoster(faction, assault, siegeRosterVersion(mission.siege)).forEach(({ spec }, index) => {
        const id = mission.siege!.attackerIds[index]
        if (id) {
          addSpec(spec, id)
          const identity = identities.get(id)
          if (identity) add(id, mission.borrowedActorIdentities?.[id]?.characterFaction ?? identity.faction,
            mission.borrowedActorIdentities?.[id]?.characterTier ?? siegeActorCharacterTier(id, spec.tier))
        }
      })
    }
    for (const [id, identity] of Object.entries(mission.borrowedActorIdentities ?? {})) {
      add(id, identity.characterFaction, identity.characterTier)
    }
    // Receiptless legacy Duel wounds use the native body. Modern temporary-tier
    // Duel saves carry their measured max HP and bypass that legacy conversion.
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
  if (profile.activeRace?.opponent.actorId === 'commander') {
    actor('commander', profile.activeRace.opponent)
    actor('commander', profile.activeRace.opponentHome)
  }
  if (profile.activeRace && profile.activeRace.opponent.actorId === `race:${profile.activeRace.id}`)
    if (ordinaryMigration) convert(profile.activeRace.opponent, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(profile.faction, 1))
  player(profile.retirementRuntime?.player)
  if (profile.townCommanderRecovery) actor('commander', profile.townCommanderRecovery,
    { faction: profile.townCommanderRecovery.faction, tier: 'commander' })
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
    for (const pair of ordinaryMigration ? profile.enemyEaglePatrols?.[faction]?.pairs ?? [] : [])
      convert(pair.member, COMBAT_BALANCE.hp.npcDefault, getOrdinarySoldierHp(opposite(faction), 3))
    for (const pair of ordinaryMigration ? profile.townEagleGarrisons?.[faction]?.pairs ?? [] : [])
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
    if (migratePlayer) {
      if (mission.playerHp !== undefined) { const saved = { hp: mission.playerHp, dead: mission.playerDead }; player(saved); mission.playerHp = saved.hp }
      if (mission.duelPlayerHp !== undefined) { const saved = { hp: mission.duelPlayerHp, dead: mission.playerDead }; player(saved); mission.duelPlayerHp = saved.hp }
    }
    if (mission.duelOpponentHp !== undefined && mission.duelOpponentActorId && mission.duelOpponentMaxHp === undefined) {
      const saved = { hp: mission.duelOpponentHp, dead: mission.duelOpponentDead }; actor(mission.duelOpponentActorId, saved); mission.duelOpponentHp = saved.hp
    }
    if (mission.duelTier === 5 && mission.duelOpponentActorId) actor(mission.duelOpponentActorId, mission.duelCommanderHome)
    actors(mission.actorHealth)
    actors(mission.officialSquad?.members)
    actors(mission.patrolAmbient?.members)
    actors(mission.personalSquad?.members)
    outskirts(mission.patrolOutskirts, profile.faction)
    battle(mission.battle)
    actors(mission.fourGateDefense?.siege?.actors)
    for (const checkpoint of [mission.eagleBattle, mission.bridgeBattle, mission.felineBattle, mission.fourGateDefense]) {
      player(checkpoint?.player)
      actors(checkpoint?.actors)
    }
  }
  profile.healthRulesVersion = 1
  profile.commanderHealthVersion = 1
}
