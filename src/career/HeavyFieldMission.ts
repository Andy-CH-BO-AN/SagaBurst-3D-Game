import type { BattleConfig } from '../battle/BattleConfig'
import type { BattleSpawnPlan, NpcSpawnSpec } from '../battle/BattleSpawner'
import { Faction } from '../world/NPC'
import { careerCombatPlayerLoadout } from './CaptainBattleLaunch'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { MAX_CUSTOM_BATTLE_COMMAND_SQUADS as MAX_COMMAND_SQUADS, MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE as MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import { createMissionCommandAuthority, type OfficialCommandSquad } from './CareerCommandAuthority'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { snapshotPersonalMission } from './CareerPersonalSquadMission'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { CAREER_RANKS, cloneCareerProfile, type CareerProfile, type CareerRank } from './CareerProfile'
import {
  CAPTAIN_STEEL_AVALANCHE_ID, HEAVY_ENEMY_FRONT_ABS_Z, HEAVY_FIELD_KIND, HEAVY_FIELD_MISSION_IDS, HEAVY_PLAYER_SLOT,
  SOLDIER_AMBUSH_ABS_Z, SOLDIER_COLUMN_FRONT_ABS_Z, SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID,
  createHeavyFieldState, heavyActorIds, heavyBlockPositions, heavyEnemyActorIds, heavyFriendlyActorIds, heavyFriendlyZSign, heavyNpcGroups,
  isHeavyFieldMissionId, planVeteranCaltropDefense, veteranSlotWorldPosition,
  type HeavyFieldMissionId, type HeavyPoint, type HeavyRosterGroup,
} from './HeavyCavalryMissions'
import { heavyUnitSpec } from './HeavyCavalrySpawn'

export interface HeavyFieldMissionDefinition {
  id: HeavyFieldMissionId
  kind: typeof HEAVY_FIELD_KIND
  name: string
  briefing: string
  friendlyCombatants: number
  enemyCombatants: number
  risk: '極高'
  minRank: Extract<CareerRank, 'soldier' | 'veteran' | 'captain'>
  requiresCompletions: 0
  requiresEnlistmentMerit: 0
  storyOnce: false
}

const definition = (id: HeavyFieldMissionId, name: string, briefing: string, friendly: number, enemy: number,
  minRank: HeavyFieldMissionDefinition['minRank']): HeavyFieldMissionDefinition => ({
  id, kind: HEAVY_FIELD_KIND, name, briefing, friendlyCombatants: friendly, enemyCombatants: enemy, risk: '極高', minRank,
  requiresCompletions: 0, requiresEnlistmentMerit: 0, storyOnce: false })

export const HEAVY_FIELD_MISSION_CATALOG: readonly HeavyFieldMissionDefinition[] = [
  definition(SOLDIER_IRON_ENCOUNTER_ID, 'Iron Encounter · 遭遇鐵騎',
    '75 名步兵（含玩家；T2 65、T3 9、T4 隊長 1）跟隨隊長行軍，在預定位置列陣，迎戰 60 名重騎兵（T3 50、T4 9、T5 指揮官 1）。任一敵軍騎士或坐騎受傷後敵軍全軍衝鋒；敵軍前鋒距離 20m 時隊長下令全軍反衝鋒。', 75, 60, 'soldier'),
  definition(VETERAN_IRON_TIDE_ID, 'Iron Tide · 鐵騎破陣',
    '300 名步兵（含玩家；長槍、刀斧、弓兵各 100）已在零散拒馬後列陣，迎戰 100 名重騎兵（T3 70、T4 25、T5 5）。任一敵軍受傷後敵軍全軍衝鋒；前鋒距離 20m 時我方全軍反衝鋒。', 300, 100, 'veteran'),
  definition(CAPTAIN_STEEL_AVALANCHE_ID, 'Steel Avalanche · 鋼鐵雪崩',
    '指揮 29 名 T4 重騎兵（含玩家共 30 人），可額外攜帶私兵，進攻已列陣防守的 200 名步兵（刀斧 100、弓兵 100）。何時進攻由你決定；我方前鋒進入 20m 後敵軍全軍反衝鋒。', 30, 200, 'captain'),
]

export function getHeavyFieldMissionDefinition(id: string): HeavyFieldMissionDefinition | null {
  return HEAVY_FIELD_MISSION_CATALOG.find(definitionEntry => definitionEntry.id === id) ?? null
}

export function heavyFieldMissionsForRank(profile: Pick<CareerProfile, 'rank'>, minRank: HeavyFieldMissionDefinition['minRank']): HeavyFieldMissionDefinition[] {
  return HEAVY_FIELD_MISSION_CATALOG.filter(entry => entry.minRank === minRank)
    .filter(() => CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(minRank))
}

export function getHeavyFieldMissionAvailability(profile: CareerProfile, templateId: string): { unlocked: boolean; reason?: string } {
  const entry = getHeavyFieldMissionDefinition(templateId)
  if (!entry || CAREER_RANKS.indexOf(profile.rank) < CAREER_RANKS.indexOf(entry.minRank)) return { unlocked: false, reason: `需要 ${entry?.minRank ?? '更高'} 軍階。` }
  if (profile.activeRace || profile.activeMission || profile.activeOutpostMission) return { unlocked: false, reason: '請先完成目前的正式任務。' }
  if (profile.townEvent?.state === 'hostile') return { unlocked: false, reason: '城鎮敵對事件中無法接受任務。' }
  if (templateId === CAPTAIN_STEEL_AVALANCHE_ID && !resolveCareerReliefMount(profile)) return { unlocked: false, reason: '需要可使用的已購買坐騎。' }
  return { unlocked: true }
}

export function availableHeavyFieldMissions(profile: CareerProfile): HeavyFieldMissionDefinition[] {
  return HEAVY_FIELD_MISSION_CATALOG.filter(entry => getHeavyFieldMissionAvailability(profile, entry.id).unlocked)
}

export function createHeavyFieldMission(profile: CareerProfile, templateId: string, id = createCareerMissionId(templateId)): ActiveCareerMission | null {
  const entry = getHeavyFieldMissionDefinition(templateId)
  if (!entry || !isHeavyFieldMissionId(templateId) || !getHeavyFieldMissionAvailability(profile, templateId).unlocked) return null
  const friendlyActorIds = heavyActorIds(id, 'friendly', heavyNpcGroups(templateId, 'friendly'))
  const targetActorIds = heavyActorIds(id, 'enemy', heavyNpcGroups(templateId, 'enemy'))
  const officialSquad = heavyOfficialAuthority(profile, id, friendlyActorIds)
  return {
    id, templateId, kind: HEAVY_FIELD_KIND, targetCampId: -1, phase: 'PREPARING', targetActorIds, friendlyActorIds, acceptedAt: Date.now(),
    commanderMission: { version: 1, kind: HEAVY_FIELD_KIND, deploymentComplete: false, heavyField: createHeavyFieldState(templateId) },
    ...(officialSquad ? { officialSquad } : {}),
    // Captain and Commander may bring private troops into any of these battles.
    ...(heavyRankCommands(profile.rank) ? { personalSquad: snapshotPersonalMission(profile) } : {}),
  }
}

/** Command follows the player's rank, not the mission: Soldier / Veteran command nobody. */
export function heavyRankCommands(rank: CareerRank): boolean { return rank === 'captain' || rank === 'commander' }

/** Same squad limits as custom battles (50 per squad, 10 squads): Captain commands one squad, Commander commands the whole force. */
function heavyOfficialAuthority(profile: CareerProfile, missionId: string, friendlyActorIds: readonly string[]) {
  if (!heavyRankCommands(profile.rank)) return undefined
  const squads: OfficialCommandSquad[] = []
  const size = MAX_COMMAND_SQUAD_SIZE
  const count = profile.rank === 'commander' ? MAX_COMMAND_SQUADS : 1
  for (let index = 0; index < count && index * size < friendlyActorIds.length; index++) {
    squads.push({ squadId: index + 1 as OfficialCommandSquad['squadId'], actorIds: friendlyActorIds.slice(index * size, (index + 1) * size) })
  }
  const authority = createMissionCommandAuthority(missionId, profile.faction, profile.rank, squads[0].actorIds, squads)
  if (authority.squads) authority.commandedSquadIds = authority.squads.map(squad => squad.squadId)
  return authority
}

export function acceptHeavyFieldMission(profile: CareerProfile, templateId: string, id?: string): CareerProfile | null {
  const mission = createHeavyFieldMission(profile, templateId, id)
  if (!mission) return null
  const next = cloneCareerProfile(profile)
  next.activeMission = mission
  return next
}

export function isCareerHeavyFieldBattle(mission: ActiveCareerMission | undefined): mission is ActiveCareerMission & { kind: typeof HEAVY_FIELD_KIND; templateId: HeavyFieldMissionId } {
  return mission?.kind === HEAVY_FIELD_KIND && isHeavyFieldMissionId(mission.templateId)
}

export function careerHeavyFieldMissionRankOk(profile: Pick<CareerProfile, 'rank'>, templateId: string): boolean {
  const entry = getHeavyFieldMissionDefinition(templateId)
  return Boolean(entry) && CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(entry!.minRank)
}

export interface CareerHeavyBattleLaunch { type: 'career-feline-battle'; careerMissionId: string; battle: BattleConfig }

export function createCareerHeavyBattleLaunch(profile: CareerProfile): CareerHeavyBattleLaunch {
  const mission = profile.activeMission
  if (!isCareerHeavyFieldBattle(mission) || !careerHeavyFieldMissionRankOk(profile, mission.templateId)
    || mission.friendlyActorIds.length !== heavyFriendlyActorIds(mission.templateId).length
    || mission.targetActorIds.length !== heavyEnemyActorIds(mission.templateId).length) throw new Error('Expected saved heavy cavalry field mission')
  return { type: 'career-feline-battle', careerMissionId: mission.id, battle: {
    careerFelineMissionId: mission.id, mode: 'formation', commandGrouping: 'squad', playerFaction: profile.faction,
    playerHeroId: resolveCareerHeroAsset(profile), playerLoadout: careerCombatPlayerLoadout(profile),
    roman: {}, viking: {}, rules: { respawnEnabled: false, includeCamps: false },
  } }
}

// ---------------------------------------------------------------------------
// Deployment plan
// ---------------------------------------------------------------------------

interface SlotQueue { role: HeavyRosterGroup['role']; tier: HeavyRosterGroup['tier']; ids: string[] }

/** Actor ids are unique per mission; a group's ids are consumed in order. */
function queues(missionId: HeavyFieldMissionId, side: 'friendly' | 'enemy', ids: readonly string[]): SlotQueue[] {
  let offset = 0
  return heavyNpcGroups(missionId, side).map(group => {
    const slice = ids.slice(offset, offset + group.count)
    offset += group.count
    return { role: group.role, tier: group.tier, ids: [...slice] }
  })
}

function layoutSpecs(missionId: HeavyFieldMissionId, side: 'friendly' | 'enemy', faction: CareerProfile['faction'],
  ids: readonly string[], positions: readonly HeavyPoint[], squadId?: NpcSpawnSpec['squadId']): NpcSpawnSpec[] {
  const allegiance = side === 'friendly' ? Faction.PLAYER : Faction.ENEMY
  let cursor = 0
  return queues(missionId, side, ids).flatMap(group => group.ids.map(actorId => {
    const at = positions[cursor++]
    return heavyUnitSpec(actorId, faction, allegiance, group.role, group.tier, side === 'friendly' ? squadId : undefined, at.x, at.z)
  }))
}

export interface HeavyFieldDeployment {
  plan: BattleSpawnPlan
  /** Where the formation line forms (Soldier) or the front of the existing formation. */
  ambushPoint: HeavyPoint
  /** Marching captain (Soldier only): the T4 spearman who leads the column. */
  captainActorId?: string
  /** Slots each friendly actor holds once Formation is ordered. */
  formationSlots: Record<string, HeavyPoint>
}

export function createHeavyFieldDeployment(profile: CareerProfile): HeavyFieldDeployment {
  const mission = profile.activeMission
  if (!isCareerHeavyFieldBattle(mission)) throw new Error('Expected heavy cavalry field mission')
  const templateId = mission.templateId
  const faction = profile.faction, enemyFaction = faction === 'roman' ? 'viking' : 'roman'
  const friendlySign = heavyFriendlyZSign(faction), enemySign = (friendlySign * -1) as 1 | -1
  let friendlyPositions: HeavyPoint[], playerSpawn: HeavyPoint = { x: 0, z: 0 }
  let enemyPositions: HeavyPoint[]
  let ambushPoint: HeavyPoint = { x: 0, z: friendlySign * SOLDIER_AMBUSH_ABS_Z }
  let formationSlots: HeavyPoint[] = []
  const friendlyCount = mission.friendlyActorIds.length

  if (templateId === SOLDIER_IRON_ENCOUNTER_ID) {
    const column = heavyBlockPositions(friendlyCount + 1, { columns: 10, gapX: 2.4, gapZ: 2.6, frontAbsZ: SOLDIER_COLUMN_FRONT_ABS_Z, zSign: friendlySign })
    const playerIndex = 15
    playerSpawn = column[playerIndex]
    friendlyPositions = column.filter((_, index) => index !== playerIndex)
    // Captain (the only T4) leads from the front: he is placed first in the queue below.
    const line = heavyBlockPositions(friendlyCount + 1, { columns: 19, gapX: 2.2, gapZ: 2.4, frontAbsZ: SOLDIER_AMBUSH_ABS_Z, zSign: friendlySign })
    formationSlots = line.filter((_, index) => index !== playerIndex)
    enemyPositions = heavyBlockPositions(60, { columns: 10, gapX: 3.6, gapZ: 3.8, frontAbsZ: HEAVY_ENEMY_FRONT_ABS_Z, zSign: enemySign })
  } else if (templateId === VETERAN_IRON_TIDE_ID) {
    const layout = planVeteranCaltropDefense()
    const roleQueues = new Map<string, HeavyPoint[]>()
    for (const slot of layout.slots) {
      const key = `${slot.role}:${slot.tier}`
      if (slot.playerSlot) { playerSpawn = veteranSlotWorldPosition(slot, faction); continue }
      roleQueues.set(key, [...(roleQueues.get(key) ?? []), veteranSlotWorldPosition(slot, faction)])
    }
    friendlyPositions = queues(templateId, 'friendly', mission.friendlyActorIds).flatMap(group =>
      Array.from({ length: group.ids.length }, () => roleQueues.get(`${group.role === 'heavy_cavalry' ? 'melee' : group.role}:${group.tier}`)!.shift()!))
    formationSlots = friendlyPositions
    enemyPositions = heavyBlockPositions(100, { columns: 10, gapX: 3.6, gapZ: 3.8, frontAbsZ: HEAVY_ENEMY_FRONT_ABS_Z, zSign: enemySign })
    ambushPoint = { x: 0, z: friendlySign * 113 }
  } else {
    friendlyPositions = heavyBlockPositions(friendlyCount, { columns: 6, gapX: 3.6, gapZ: 3.8, frontAbsZ: HEAVY_ENEMY_FRONT_ABS_Z + 4, zSign: friendlySign })
    playerSpawn = { x: 0, z: friendlySign * (HEAVY_ENEMY_FRONT_ABS_Z + 4 + 6 * 3.8) }
    // Enemy infantry: ranks of swordsmen (and officers) in front, archers behind them.
    const melee = heavyBlockPositions(100, { columns: 20, gapX: 2.4, gapZ: 2.6, frontAbsZ: HEAVY_ENEMY_FRONT_ABS_Z, zSign: enemySign })
    const archers = heavyBlockPositions(100, { columns: 20, gapX: 2.4, gapZ: 2.6, frontAbsZ: HEAVY_ENEMY_FRONT_ABS_Z + 5 * 2.6 + 3, zSign: enemySign })
    enemyPositions = [...melee, ...archers]
    formationSlots = friendlyPositions
  }
  const friendly = layoutSpecs(templateId, 'friendly', faction, mission.friendlyActorIds, friendlyPositions, mission.officialSquad?.squads ? 1 : undefined)
  const enemyQueues = queues(templateId, 'enemy', mission.targetActorIds)
  const sortedEnemy = enemyQueues.flatMap(group => group.ids.map(actorId => ({ group, actorId })))
  // Captain enemies: melee queue first, then archers, matching the two position blocks above.
  const enemy = sortedEnemy.map(({ group, actorId }, index) => heavyUnitSpec(actorId, enemyFaction, Faction.ENEMY, group.role, group.tier, undefined,
    enemyPositions[index].x, enemyPositions[index].z))
  const captain = templateId === SOLDIER_IRON_ENCOUNTER_ID ? friendly.find(spec => spec.characterTier === 4) : undefined
  const slotByActor: Record<string, HeavyPoint> = {}
  friendly.forEach((spec, index) => { slotByActor[spec.actorId!] = formationSlots[index] })
  if (captain && friendly[0] !== captain) {
    // The captain leads the column and takes the centre of the front rank when the line forms.
    const first = friendly[0], line = slotByActor[captain.actorId!]
    ;[captain.x, first.x] = [first.x, captain.x]; [captain.z, first.z] = [first.z, captain.z]
    slotByActor[captain.actorId!] = slotByActor[first.actorId!]; slotByActor[first.actorId!] = line
  }
  // The marching captain spawns first so every follower can bind to him.
  if (captain) friendly.splice(0, friendly.length, captain, ...friendly.filter(spec => spec !== captain))
  return { plan: { playerSpawn, npcSpecs: [...friendly, ...enemy], pickupSpecs: [], horseSpecs: [] }, ambushPoint,
    ...(captain ? { captainActorId: captain.actorId! } : {}), formationSlots: slotByActor }
}

export function createCareerHeavySpawnPlan(profile: CareerProfile): BattleSpawnPlan { return createHeavyFieldDeployment(profile).plan }

export { HEAVY_FIELD_MISSION_IDS, HEAVY_PLAYER_SLOT }
