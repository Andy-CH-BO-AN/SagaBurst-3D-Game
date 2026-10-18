import { BRIDGEHEAD_ENEMIES, BRIDGEHEAD_FRIENDLIES, BRIDGEHEAD_FRIENDLY_SQUADS, BRIDGEHEAD_SQUAD_SIZE, BRIDGEHEAD_ENEMY_SQUADS_PER_ROLE, bridgeheadEnemySquadsPerRole } from '../battle/BridgeheadRosterConfig'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { COMMANDER_FOUR_GATE_DEFENSE_ID, COMMANDER_FOUR_GATE_DEFENSE_ENEMIES, commanderFourGateDefenseActorIds } from './CommanderFourGateDefenseRoster'
import { createCommanderFourGateDefenseState } from './CommanderFourGateDefenseState'
export { COMMANDER_FOUR_GATE_DEFENSE_ID } from './CommanderFourGateDefenseRoster'
import { planNorthBankInfantryDeployment, planSouthBankCavalryStaging } from '../world/RiverCrossingBattlefield'
import { careerCommanderLoadout } from './CareerCommanderEquipment'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CombatEvent } from '../combat/CombatAttribution'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { AIType, Faction } from '../world/NPC'
import { townCommanderHeroAsset } from '../town/TownCommander'
import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import { townRoster } from '../town/TownRules'
import { createMissionCommandAuthority, officialMissionSourcePolicy, type OfficialCommandSquad } from './CareerCommandAuthority'
import { personalMissionSourcePolicy, snapshotPersonalMission } from './CareerPersonalSquadMission'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { BRIDGEHEAD_PREPARATION_SECONDS, createCareerMissionId, type ActiveCareerMission, type CareerMissionKind } from './CareerMissionState'

export const COMMANDER_SKY_RAID_ID = 'commander-sky-raid'
export const COMMANDER_DECAPITATION_ID = 'commander-operation-decapitation'
export const COMMANDER_BRIDGEHEAD_ID = 'commander-bridgehead-battle'
export const COMMANDER_LAST_STAND_ID = 'commander-outpost-last-stand'

export const COMMANDER_SKY_RAID_REQUIRED_KILLS = 100
export const COMMANDER_SKY_RAID_RANGERS = 50
export const COMMANDER_DECAPITATION_ESCORTS = 29
export const COMMANDER_LAST_STAND_FRIENDLIES = 120
export const COMMANDER_LAST_STAND_ENEMIES = 100
export const COMMANDER_FORMER_COMMANDER_SLOT = 'former-commander'

export interface CommanderMissionDefinition {
  id: typeof COMMANDER_SKY_RAID_ID | typeof COMMANDER_DECAPITATION_ID | typeof COMMANDER_LAST_STAND_ID | typeof COMMANDER_BRIDGEHEAD_ID | typeof COMMANDER_FOUR_GATE_DEFENSE_ID
  kind: Extract<CareerMissionKind, 'commander-sky-raid' | 'commander-decapitation' | 'commander-outpost-last-stand' | 'commander-bridgehead-battle' | 'commander-four-gate-defense'>
  name: string
  briefing: string
  friendlyCombatants: number
  enemyCombatants: number
  risk: '極高'
  minRank: 'commander'
  requiresCompletions: 0
  requiresEnlistmentMerit: 0
  storyOnce: false
}

const entry = (
  id: CommanderMissionDefinition['id'],
  kind: CommanderMissionDefinition['kind'],
  name: string,
  briefing: string,
  friendlyCombatants: number,
  enemyCombatants: number,
): CommanderMissionDefinition => ({
  id, kind, name, briefing, friendlyCombatants, enemyCombatants, risk: '極高', minRank: 'commander',
  requiresCompletions: 0, requiresEnlistmentMerit: 0, storyOnce: false,
})

export const COMMANDER_MISSION_CATALOG: readonly CommanderMissionDefinition[] = [
  entry(COMMANDER_SKY_RAID_ID, 'commander-sky-raid', 'Commander I · Sky Raid · 空襲敵城',
    `率領 ${COMMANDER_SKY_RAID_RANGERS} 名 T4 Ranger 與 xongkoro 從敵城外空降，擊敗 ${COMMANDER_SKY_RAID_REQUIRED_KILLS} 名不重複的敵城原生人員。`, 51, COMMANDER_SKY_RAID_REQUIRED_KILLS),
  entry(COMMANDER_DECAPITATION_ID, 'commander-decapitation', 'Commander II · Operation Decapitation · 斬首行動',
    '與前任 T5 Commander 及 29 名 T4 騎兵從合法邊界攻入敵城，擊敗唯一的敵方 T5 Commander。', 31, 1),
  entry(COMMANDER_LAST_STAND_ID, 'commander-outpost-last-stand', 'Commander III · Outpost Last Stand · 前哨決戰',
    '指揮 4 支步兵隊守衛 Outpost；60 秒部署後，歼滅同時進攻的 100 名敵方騎兵。', 121, COMMANDER_LAST_STAND_ENEMIES),
  entry(COMMANDER_BRIDGEHEAD_ID, 'commander-bridgehead-battle', 'Commander IV · Bridgehead Battle · 橋頭決戰',
    `率領${BRIDGEHEAD_FRIENDLIES}名步兵守衛北岸石橋。進場後有${BRIDGEHEAD_PREPARATION_SECONDS}秒部署時間，倒數結束後${BRIDGEHEAD_ENEMIES}名敵方騎兵（刀／斧騎兵與槍騎兵各${BRIDGEHEAD_ENEMY_SQUADS_PER_ROLE}隊，每隊1名T4隊長與${BRIDGEHEAD_SQUAD_SIZE - 1}名T3士兵）從南岸遠方出現並渡河進攻。我方${BRIDGEHEAD_FRIENDLY_SQUADS}支正式小隊各${BRIDGEHEAD_SQUAD_SIZE}人，包含1名T4隊長與${BRIDGEHEAD_SQUAD_SIZE - 1}名T3士兵。利用橋梁限制騎兵機動，發揮槍兵與遠程部隊的優勢。`, BRIDGEHEAD_FRIENDLIES, BRIDGEHEAD_ENEMIES),
  entry(COMMANDER_FOUR_GATE_DEFENSE_ID, 'commander-four-gate-defense', 'Commander V · Four-Gate Town Defense · 四門總攻守城戰',
    '防守所屬城鎮；守方部署完成後有180秒準備，之後敵軍才抵達。指揮原生八隊守軍與HR私兵，迎擊四門200名地面攻軍、八台攻城車及30名巨鷹騎射兵。正式攻擊後守住5分鐘且守方仍有人存活即可獲勝，也可提前殲滅全部230名攻軍。',
    commanderGateDefenseSlots().flatMap(squad => squad.actorIds).length + 1, COMMANDER_FOUR_GATE_DEFENSE_ENEMIES),
]

export function getCommanderMissionDefinition(id: string): CommanderMissionDefinition | null {
  return COMMANDER_MISSION_CATALOG.find(definition => definition.id === id) ?? null
}

export function isCommanderMission(mission: ActiveCareerMission | undefined): mission is ActiveCareerMission & {
  templateId: CommanderMissionDefinition['id']
  kind: CommanderMissionDefinition['kind']
} {
  const definition = mission && getCommanderMissionDefinition(mission.templateId)
  return Boolean(definition && mission?.kind === definition.kind)
}

export function isCommanderTownMission(mission: ActiveCareerMission | undefined): boolean {
  return mission?.kind === 'commander-sky-raid' || mission?.kind === 'commander-decapitation'
}

/** Returns the stable objective identity for a qualifying Commander mission kill.
 * Sky Raid counts native losses from any source; personal kills and merit retain their own attribution.
 */
export function commanderObjectiveDeathId(mission: ActiveCareerMission, event: CombatEvent): string | null {
  if (!isCommanderTownMission(mission) || event.type !== 'actor_killed' || event.target.targetType !== 'npc'
    || !mission.targetActorIds.includes(event.target.targetId)) return null
  // Objective losses describe the world; BattleStatsTracker separately validates kill/merit sources.
  if (mission.kind === 'commander-sky-raid') return event.target.targetId
  if (event.source.actorType === 'player') return event.target.targetId
  if (mission.officialSquad && officialMissionSourcePolicy(mission.officialSquad)(event.source)) return event.target.targetId
  if (mission.personalSquad && personalMissionSourcePolicy(mission)(event.source)) return event.target.targetId
  return null
}

/** Adds one new qualifying native death. Replayed or duplicated kill events are no-ops. */
export function recordCommanderObjectiveDeath(mission: ActiveCareerMission, event: CombatEvent): boolean {
  const targetId = commanderObjectiveDeathId(mission, event)
  if (!targetId || mission.deadTargetActorIds?.includes(targetId)) return false
  mission.deadTargetActorIds = [...(mission.deadTargetActorIds ?? []), targetId]
  return true
}

export function getCommanderMissionAvailability(profile: CareerProfile, templateId: string): { unlocked: boolean; reason?: string } {
  if (!getCommanderMissionDefinition(templateId) || profile.rank !== 'commander') {
    return { unlocked: false, reason: '需要正式任命為 Commander；單有 20,000 軍功不算完成任命。' }
  }
  if (profile.activeRace || profile.activeMission || profile.activeOutpostMission) return { unlocked: false, reason: '請先完成目前的正式任務。' }
  if (profile.townEvent?.state === 'hostile') return { unlocked: false, reason: '城鎮敵對事件中無法接受任務。' }
  return { unlocked: true }
}

export function availableCommanderMissions(profile: CareerProfile): CommanderMissionDefinition[] {
  return COMMANDER_MISSION_CATALOG.filter(definition => getCommanderMissionAvailability(profile, definition.id).unlocked)
}

function officialIds(missionId: string, count: number, label: string): string[] {
  return Array.from({ length: count }, (_, index) => `${missionId}:${label}:${index}`)
}

function commandSquads(ids: readonly string[], sizes: readonly number[]): OfficialCommandSquad[] {
  let offset = 0
  return sizes.map((size, index) => {
    const actorIds = ids.slice(offset, offset + size)
    offset += size
    return { squadId: index + 1 as OfficialCommandSquad['squadId'], actorIds }
  })
}

/** Stable native identities; the runtime may append conquest residents before the first checkpoint. */
export function skyRaidNativeActorIds(): string[] {
  return [...new Set([...townRoster().filter(spec => spec.role !== 'cat').map(spec => spec.id), TOWN_COMMANDER_ID])]
}

export function createCommanderMission(profile: CareerProfile, templateId: string,
  id = createCareerMissionId(templateId)): ActiveCareerMission | null {
  const definition = getCommanderMissionDefinition(templateId)
  if (!definition || !getCommanderMissionAvailability(profile, templateId).unlocked) return null

  let friendlyActorIds: string[]
  let targetActorIds: string[]
  let squads: OfficialCommandSquad[]
  if (templateId === COMMANDER_FOUR_GATE_DEFENSE_ID) {
    squads = commanderGateDefenseSlots()
    friendlyActorIds = squads.flatMap(squad => squad.actorIds)
    targetActorIds = commanderFourGateDefenseActorIds(id)
  } else if (templateId === COMMANDER_SKY_RAID_ID) {
    friendlyActorIds = officialIds(id, COMMANDER_SKY_RAID_RANGERS, 'ranger')
    targetActorIds = skyRaidNativeActorIds()
    squads = commandSquads(friendlyActorIds, [25, 25])
  } else if (templateId === COMMANDER_DECAPITATION_ID) {
    friendlyActorIds = [`${id}:${COMMANDER_FORMER_COMMANDER_SLOT}`, ...officialIds(id, COMMANDER_DECAPITATION_ESCORTS, 'escort')]
    targetActorIds = [TOWN_COMMANDER_ID]
    squads = commandSquads(friendlyActorIds, [30])
  } else if (templateId === COMMANDER_BRIDGEHEAD_ID) {
    friendlyActorIds = officialIds(id, BRIDGEHEAD_FRIENDLIES, 'infantry')
    targetActorIds = officialIds(id, BRIDGEHEAD_ENEMIES, 'cavalry')
    squads = commandSquads(friendlyActorIds, Array(BRIDGEHEAD_FRIENDLY_SQUADS).fill(BRIDGEHEAD_SQUAD_SIZE))
  } else {
    friendlyActorIds = officialIds(id, COMMANDER_LAST_STAND_FRIENDLIES, 'defender')
    targetActorIds = officialIds(id, COMMANDER_LAST_STAND_ENEMIES, 'attacker')
    squads = commandSquads(friendlyActorIds, [30, 30, 30, 30])
  }
  return {
    id, templateId, kind: definition.kind, targetCampId: -1, phase: templateId === COMMANDER_FOUR_GATE_DEFENSE_ID ? 'DEPLOYING' : 'PREPARING',
    targetActorIds, friendlyActorIds, acceptedAt: Date.now(),
    commanderMission: { version: 1, kind: definition.kind, deploymentComplete: false },
    ...(templateId === COMMANDER_FOUR_GATE_DEFENSE_ID ? {
      fourGateDefense: createCommanderFourGateDefenseState(),
      civilianActorIds: townRoster().filter(actor => actor.role === 'civilian').map(actor => actor.id),
    } : {}),
    ...(templateId === COMMANDER_BRIDGEHEAD_ID ? {
      bridgeDeployment: { phase: 'preparing' as const, preparationRemainingSeconds: BRIDGEHEAD_PREPARATION_SECONDS },
    } : {}),
    officialSquad: createMissionCommandAuthority(id, profile.faction, profile.rank, friendlyActorIds, squads),
    personalSquad: snapshotPersonalMission(profile),
  }
}

export function acceptCommanderMission(profile: CareerProfile, templateId: string, id?: string): CareerProfile | null {
  const mission = createCommanderMission(profile, templateId, id)
  if (!mission) return null
  const next = cloneCareerProfile(profile)
  if (mission.kind === 'commander-bridgehead-battle') mission.officialSquad!.commandedSquadIds = mission.officialSquad!.squads!.map(squad => squad.squadId)
  next.activeMission = mission
  return next
}

function preset(faction: CareerProfile['faction'], role: 'melee' | 'spear' | 'archer' | 'lancer' | 'sword' | 'horse_archer'): UnitPresetId {
  if (role === 'melee') return faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  if (role === 'spear') return `${faction}_spearman`
  if (role === 'archer') return `${faction}_archer`
  if (role === 'sword') return `${faction}_sword_cavalry`
  return `${faction}_${role}`
}

function specForTier(
  actorId: string,
  faction: CareerProfile['faction'],
  allegiance: Faction,
  presetId: UnitPresetId,
  tier: 3 | 4,
  squadId: NpcSpawnSpec['squadId'],
  x = 0,
  z = 0,
  forcedMount?: 'horse' | 'black-cat' | 'corgi' | 'xongkoro' | null,
): NpcSpawnSpec {
  const ranged = UNIT_PRESETS[presetId].traits.includes('bow_fire') || UNIT_PRESETS[presetId].traits.includes('javelin_throw')
  const hero = tier === 4 ? T4_UNIT_PROFILES[presetId] : undefined
  const loadout = tier === 4 ? resolveT4UnitLoadout(presetId) : { ...UNIT_PRESETS[presetId].tierLoadouts[3] }
  if (forcedMount !== undefined) loadout.mountId = forcedMount
  return {
    actorId, x, z, faction: allegiance, characterFaction: faction,
    aiType: ranged ? AIType.RANGED : AIType.MELEE, name: actorId.split(':').at(-1) ?? actorId,
    tier, cavalry: Boolean(loadout.mountId), respawnEnabled: false, presetId, squadId, loadout,
    ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId,
      ...(hero.specialCombatProfile ? { specialCombatProfile: hero.specialCombatProfile } : {}) } : {}),
  }
}

export function createSkyRaidRoster(mission: ActiveCareerMission, faction: CareerProfile['faction']): NpcSpawnSpec[] {
  if (mission.kind !== 'commander-sky-raid' || mission.friendlyActorIds.length !== COMMANDER_SKY_RAID_RANGERS) return []
  const presetId = preset(faction, 'archer')
  return mission.friendlyActorIds.map((actorId, index) => specForTier(actorId, faction, Faction.TOWN,
    presetId, 4, index < 25 ? 1 : 2, 0, 0, 'xongkoro'))
}

export function createDecapitationRoster(mission: ActiveCareerMission, faction: CareerProfile['faction']): NpcSpawnSpec[] {
  if (mission.kind !== 'commander-decapitation' || mission.friendlyActorIds.length !== 30) return []
  const canonicalMount = faction === 'roman' ? 'corgi' : 'black-cat'
  return mission.friendlyActorIds.map((actorId, index) => {
    if (index === 0) {
      const presetId = preset(faction, 'sword')
      const asset = townCommanderHeroAsset(faction)
      return { ...specForTier(actorId, faction, Faction.TOWN, presetId, 4, 1, 0, 0, canonicalMount),
        name: `Former ${faction === 'roman' ? 'Roman' : 'Viking'} Commander`, visualAssetId: asset,
        aiType: AIType.RANGED, loadout: { ...careerCommanderLoadout(faction), mountId: canonicalMount },
        combatProfileId: HERO_COMBAT_PROFILE_BY_ASSET[asset] }
    }
    const escortIndex = index - 1
    const role = escortIndex < 10 ? 'lancer' : escortIndex < 20 ? 'sword' : 'horse_archer'
    return specForTier(actorId, faction, Faction.TOWN, preset(faction, role), 4, 1, 0, 0, canonicalMount)
  })
}

export function createLastStandRoster(mission: ActiveCareerMission, faction: CareerProfile['faction']): {
  friendly: NpcSpawnSpec[]
  enemy: NpcSpawnSpec[]
} {
  if (mission.kind !== 'commander-outpost-last-stand'
    || mission.friendlyActorIds.length !== COMMANDER_LAST_STAND_FRIENDLIES
    || mission.targetActorIds.length !== COMMANDER_LAST_STAND_ENEMIES) return { friendly: [], enemy: [] }
  const enemyFaction = faction === 'roman' ? 'viking' : 'roman'
  const friendlyRoles = ['melee', 'spear', 'archer', 'archer'] as const
  const friendly = mission.friendlyActorIds.map((actorId, index) => {
    const squadIndex = Math.floor(index / 30)
    const tier = index % 30 === 0 ? 4 : 3
    return specForTier(actorId, faction, Faction.PLAYER, preset(faction, friendlyRoles[squadIndex]), tier,
      squadIndex + 1 as NpcSpawnSpec['squadId'], 0, 0, null)
  })
  const enemy = mission.targetActorIds.map((actorId, index) => {
    const role = index < 50 ? 'lancer' : index < 75 ? 'sword' : 'horse_archer'
    const withinGroup = index < 50 ? index : index < 75 ? index - 50 : index - 75
    const t4 = role === 'lancer' ? withinGroup < 2 : withinGroup < 1
    const mount = t4 ? enemyFaction === 'roman' ? 'corgi' : 'black-cat' : 'horse'
    const squadId = role === 'lancer' ? 5 : role === 'sword' ? 6 : 7
    return specForTier(actorId, enemyFaction, Faction.ENEMY, preset(enemyFaction, role), t4 ? 4 : 3,
      squadId, 0, 0, mount)
  })
  return { friendly, enemy }
}

/** Exact saved identities, shared tier loadouts and deterministic production deployment points. */
export function createBridgeheadRoster(mission: ActiveCareerMission, faction: CareerProfile['faction']): {
  friendly: NpcSpawnSpec[]; enemy: NpcSpawnSpec[]
} {
  const enemySquadsPerRole = bridgeheadEnemySquadsPerRole(mission.targetActorIds.length)
  if (mission.kind !== 'commander-bridgehead-battle' || mission.friendlyActorIds.length !== BRIDGEHEAD_FRIENDLIES
    || enemySquadsPerRole === undefined) throw new Error('Invalid Bridgehead roster')
  const enemyFaction = faction === 'roman' ? 'viking' : 'roman'
  const friendly = planNorthBankInfantryDeployment(faction).flatMap(squad => squad.slots.map((slot, index) => {
    const role = squad.role
    const presetId: UnitPresetId = role === 'javelin' ? 'roman_javelin_infantry'
      : preset(faction, role === 'spearman' ? 'spear' : role === 'melee_infantry' ? 'melee' : 'archer')
    return specForTier(mission.friendlyActorIds[(squad.squadId - 1) * BRIDGEHEAD_SQUAD_SIZE + index], faction, Faction.PLAYER,
      presetId, index === 0 ? 4 : 3, squad.squadId as NpcSpawnSpec['squadId'], slot.x, slot.z, null)
  }))
  const enemy = planSouthBankCavalryStaging(230, enemySquadsPerRole).flatMap(squad => squad.slots.map((slot, index) =>
    specForTier(mission.targetActorIds[(squad.squadId - 1) * BRIDGEHEAD_SQUAD_SIZE + index], enemyFaction, Faction.ENEMY,
      preset(enemyFaction, squad.role === 'melee_cavalry' ? 'sword' : 'lancer'), index === 0 ? 4 : 3,
      // Enemy deployment groups beyond eight are not player command squads.
      squad.squadId <= 8 ? squad.squadId as NpcSpawnSpec['squadId'] : undefined, slot.x, slot.z,
      index === 0 ? enemyFaction === 'roman' ? 'corgi' : 'black-cat' : 'horse')))
  return { friendly, enemy }
}
