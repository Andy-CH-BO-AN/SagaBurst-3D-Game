import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { AIType, Faction } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { cloneCareerProfile, CAREER_RANKS, type CareerProfile } from './CareerProfile'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'

export const VETERAN_MISSION_IDS = [
  'veteran-dread-outpost',
  'veteran-scout-hunters',
  'veteran-village-intercept',
  'veteran-outpost-assault',
  'veteran-spear-line-hunt',
  'veteran-tragedy-of-the-scouts',
] as const
export type VeteranMissionTemplateId = typeof VETERAN_MISSION_IDS[number]
export type VeteranMissionKind = 'veteran-field' | 'veteran-outpost-defense' | 'veteran-outpost-assault'
export type VeteranTownRole = 'captain' | 'ranger' | 'melee_cavalry' | 'lancer_cavalry' | 'ranged_cavalry'
export type VeteranMissionObjective = { kind: 'eliminate-all' } | { kind: 'survive'; seconds: 120 }

export interface VeteranMissionDefinition {
  id: VeteranMissionTemplateId
  kind: VeteranMissionKind
  name: string
  briefing: string
  friendlyCombatants: number
  enemyCombatants: number
  reinforcementCombatants: number
  squadSizes: readonly number[]
  requiresMount: boolean
  objective: VeteranMissionObjective
  minRank: 'veteran'
}

export interface VeteranRosterUnit {
  actorId: string
  presetId: UnitPresetId
  tier: 3 | 4
  squadId: number
  leader: boolean
  source: 'town' | 'temporary' | 'mission'
  townRole?: VeteranTownRole
  heroRole?: 'captain' | 'ranger'
  mounted: boolean
}

export interface VeteranMissionRoster {
  playerIncluded: true
  friendlyTotal: number
  enemyTotal: number
  reinforcementTotal: number
  squadSizes: number[]
  friendly: VeteranRosterUnit[]
  enemy: VeteranRosterUnit[]
  reinforcements: VeteranRosterUnit[]
}

export interface VeteranMissionAvailability {
  unlocked: boolean
  reason?: '軍階未達Veteran' | '前置任務未完成' | '需要坐騎'
}

export interface AcceptVeteranMissionOptions { missionId?: string; acceptedAt?: number }

const definition = (
  id: VeteranMissionTemplateId,
  kind: VeteranMissionKind,
  name: string,
  briefing: string,
  friendlyCombatants: number,
  enemyCombatants: number,
  reinforcementCombatants: number,
  squadSizes: readonly number[],
  requiresMount: boolean,
  objective: VeteranMissionObjective = { kind: 'eliminate-all' },
): VeteranMissionDefinition => ({ id, kind, name, briefing, friendlyCombatants, enemyCombatants, reinforcementCombatants, squadSizes, requiresMount, objective, minRank: 'veteran' })

export const VETERAN_MISSION_CATALOG: readonly VeteranMissionDefinition[] = [
  definition(VETERAN_MISSION_IDS[0], 'veteran-outpost-defense', 'Dread Outpost · 恐怖前哨防禦', '守住 Campaign Outpost，擊退 50 名敵方 T4 騎兵；第 90 秒後援軍從敵軍後方趕到。', 100, 50, 50, [25, 25, 25, 25], false),
  definition(VETERAN_MISSION_IDS[1], 'veteran-field', 'Scout Hunters · 獵殺斥候', '跟隨四隊騎兵出擊，殲滅敵方斥候。', 100, 40, 0, [25, 25, 25, 25], true),
  definition(VETERAN_MISSION_IDS[2], 'veteran-field', 'Village Intercept · 村外截擊', '與兩隊騎兵在村外截住敵軍，保護村莊。', 50, 100, 0, [25, 25], true),
  definition(VETERAN_MISSION_IDS[3], 'veteran-outpost-assault', 'Outpost Assault · 強攻前哨', '從敵方 Outpost 外發起攻勢，攻破城門並殲滅守軍。', 100, 100, 0, [25, 25, 25, 25], true),
  definition(VETERAN_MISSION_IDS[4], 'veteran-field', 'Spear Line Hunt · 槍林清剿', '率領兩隊弓騎兵清剿敵方槍兵主力。', 50, 100, 0, [25, 25], true),
  definition(VETERAN_MISSION_IDS[5], 'veteran-field', 'Tragedy of the Scouts · 斥候的悲劇', '以 20 人斥候隊在敵方騎兵主力下生存 02:00。', 20, 100, 0, [10, 10], true, { kind: 'survive', seconds: 120 }),
]

export function getVeteranMissionDefinition(templateId: string): VeteranMissionDefinition | null {
  return VETERAN_MISSION_CATALOG.find(mission => mission.id === templateId) ?? null
}

export function getVeteranMissionAvailability(profile: CareerProfile, templateId: string): VeteranMissionAvailability {
  const index = VETERAN_MISSION_IDS.indexOf(templateId as VeteranMissionTemplateId)
  if (index < 0) return { unlocked: false, reason: '前置任務未完成' }
  if (CAREER_RANKS.indexOf(profile.rank) < CAREER_RANKS.indexOf('veteran')) return { unlocked: false, reason: '軍階未達Veteran' }
  const mission = VETERAN_MISSION_CATALOG[index]
  if (mission.requiresMount && !resolveCareerReliefMount(profile)) return { unlocked: false, reason: '需要坐騎' }
  const completed = profile.completedCareerMissionTemplateIds ?? []
  const previouslyCompleted = completed.includes(mission.id)
  if (index > 0 && !previouslyCompleted && !completed.includes(VETERAN_MISSION_IDS[index - 1])) {
    return { unlocked: false, reason: '前置任務未完成' }
  }
  return { unlocked: true }
}

function oppositeFaction(faction: CharacterFaction): CharacterFaction { return faction === 'roman' ? 'viking' : 'roman' }
function preset(faction: CharacterFaction, role: 'spearman' | 'heavy_infantry' | 'archer' | 'lancer' | 'sword_cavalry' | 'horse_archer'): UnitPresetId {
  if (role === 'heavy_infantry') return faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  return `${faction}_${role}` as UnitPresetId
}
function mountedFor(presetId: UnitPresetId): boolean {
  return presetId.includes('cavalry') || presetId.endsWith('_lancer') || presetId.endsWith('_horse_archer')
}

function unit(
  missionId: string,
  _faction: CharacterFaction,
  presetId: UnitPresetId,
  tier: 3 | 4,
  squadId: number,
  source: VeteranRosterUnit['source'],
  sequence: number,
  options: { leader?: boolean; townRole?: VeteranTownRole; heroRole?: 'captain' | 'ranger'; mounted?: boolean } = {},
  namespace: 'friendly' | 'enemy' | 'reinforcement' = 'friendly',
): VeteranRosterUnit {
  const actorId = options.townRole
    ? options.townRole === 'captain' || options.townRole === 'ranger' ? options.townRole : `${options.townRole}-${sequence}`
    : `${missionId}:${source === 'mission' ? 'mission' : source}:${namespace}:${sequence}`
  return { actorId, presetId, tier, squadId, leader: options.leader === true, source, ...(options.townRole ? { townRole: options.townRole } : {}), ...(options.heroRole ? { heroRole: options.heroRole } : {}), mounted: options.mounted ?? mountedFor(presetId) }
}

interface LeaderPlan { presetId: UnitPresetId; heroRole: 'captain' | 'ranger'; source: VeteranRosterUnit['source']; townRole?: VeteranTownRole }
interface OrdinaryPlan { role: 'spearman' | 'heavy_infantry' | 'archer' | 'lancer' | 'sword_cavalry' | 'horse_archer'; count: number; borrowRole?: VeteranTownRole; borrowCount?: number }

function makeFriendlyArmy(
  missionId: string,
  faction: CharacterFaction,
  squadSizes: readonly number[],
  leaders: readonly LeaderPlan[],
  ordinary: readonly OrdinaryPlan[],
  playerIncluded = true,
  namespace: 'friendly' | 'reinforcement' = 'friendly',
): VeteranRosterUnit[] {
  const output: VeteranRosterUnit[] = []
  const used = squadSizes.map((_, index) => index === 0 && playerIncluded ? 1 : 0)
  let actorSequence = 0
  leaders.forEach((leader, index) => {
    const squadId = index + 1
    output.push(unit(missionId, faction, leader.presetId, 4, squadId, leader.source, actorSequence++, {
      leader: true, heroRole: leader.heroRole, townRole: leader.townRole, mounted: true,
    }, namespace))
    used[index] += 1
  })
  let nextSquad = 0
  const addOrdinary = (presetId: UnitPresetId, source: VeteranRosterUnit['source'], townRole?: VeteranTownRole, townSequence = 0) => {
    for (let tries = 0; tries < squadSizes.length; tries++) {
      const squadIndex = nextSquad++ % squadSizes.length
      if (used[squadIndex] >= squadSizes[squadIndex]) continue
      const squadId = squadIndex + 1
      const sequence = townRole ? townSequence : actorSequence++
      output.push(unit(missionId, faction, presetId, 3, squadId, source, sequence, {
        townRole, mounted: mountedFor(presetId),
      }, namespace))
      used[squadIndex] += 1
      return
    }
    throw new Error(`Veteran friendly roster exceeds Squad capacity for ${missionId}`)
  }
  for (const block of ordinary) {
    const presetId = preset(faction, block.role)
    const borrowedCount = Math.min(block.count, block.borrowCount ?? 0)
    for (let index = 0; index < borrowedCount; index++) {
      addOrdinary(presetId, 'town', block.borrowRole, index)
    }
    for (let index = borrowedCount; index < block.count; index++) addOrdinary(presetId, 'temporary')
  }
  if (used.some((size, index) => size !== squadSizes[index])) throw new Error(`Veteran friendly roster does not fill all squad slots for ${missionId}`)
  return output
}

interface EnemyGroupPlan { leaderRole: 'lancer' | 'archer' | 'sword_cavalry' | 'spearman'; leaderHeroRole: 'captain' | 'ranger'; count: number; mounted?: boolean; blocks: readonly { role: OrdinaryPlan['role']; tier: 3 | 4; count: number; heroRole?: 'captain' | 'ranger'; mounted?: boolean }[] }
function makeEnemyGroups(missionId: string, faction: CharacterFaction, groups: readonly EnemyGroupPlan[]): VeteranRosterUnit[] {
  const output: VeteranRosterUnit[] = []
  let actorSequence = 0
  let nextSquadId = 1
  groups.forEach(group => {
    const squadSizes = Array.from({ length: Math.ceil(group.count / 25) }, (_, index) => Math.min(25, group.count - index * 25))
    const groupSquadIds = squadSizes.map((_, index) => nextSquadId + index)
    nextSquadId += squadSizes.length
    const squadMembers = squadSizes.map((_, index) => index === 0 ? 1 : 0)
    const leaderPreset = group.leaderHeroRole === 'ranger' ? preset(faction, 'archer') : preset(faction, group.leaderRole)
    const groupStart = output.length
    output.push(unit(missionId, faction, leaderPreset, 4, groupSquadIds[0], 'mission', actorSequence++, { leader: true, heroRole: group.leaderHeroRole, mounted: group.mounted ?? (group.leaderHeroRole === 'ranger' ? false : mountedFor(leaderPreset)) }, 'enemy'))
    const availableSquadIndex = () => squadMembers.findIndex((size, index) => size < squadSizes[index])
    for (const block of group.blocks) {
      for (let n = 0; n < block.count; n++) {
        const subgroupIndex = availableSquadIndex()
        if (subgroupIndex < 0) throw new Error(`Veteran enemy group exceeds Squad capacity for ${missionId}`)
        const heroRole = block.tier === 4 ? block.heroRole ?? group.leaderHeroRole : undefined
        const presetId = block.tier === 4 && heroRole === 'ranger' ? preset(faction, 'archer') : preset(faction, block.role)
        const sequence = actorSequence++
        output.push(unit(missionId, faction, presetId, block.tier, groupSquadIds[subgroupIndex], 'mission', sequence, {
          leader: false, heroRole, mounted: block.mounted ?? (heroRole ? group.mounted ?? mountedFor(presetId) : mountedFor(presetId)),
        }, 'enemy'))
        squadMembers[subgroupIndex] += 1
      }
    }
    if (output.length - groupStart !== group.count || squadMembers.some((size, index) => size !== squadSizes[index])) {
      throw new Error(`Veteran enemy group size mismatch for ${missionId}`)
    }
  })
  return output
}

function buildVeteranRoster(templateId: VeteranMissionTemplateId, faction: CharacterFaction, missionId: string): VeteranMissionRoster {
  const opposing = oppositeFaction(faction)
  let friendly: VeteranRosterUnit[] = []
  let enemy: VeteranRosterUnit[] = []
  let reinforcements: VeteranRosterUnit[] = []
  let squadSizes: number[] = []
  const capt = preset(faction, 'sword_cavalry')
  const maki = preset(faction, 'archer')

  switch (templateId) {
    case 'veteran-dread-outpost': {
      squadSizes = [25, 25, 25, 25]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: capt, heroRole: 'captain', source: 'mission' },
        { presetId: capt, heroRole: 'captain', source: 'mission' },
        { presetId: maki, heroRole: 'ranger', source: 'mission' },
        { presetId: maki, heroRole: 'ranger', source: 'mission' },
      ], [
        { role: 'spearman', count: 24 }, { role: 'heavy_infantry', count: 24 },
        { role: 'horse_archer', count: 24 }, { role: 'lancer', count: 23 },
      ])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'lancer', leaderHeroRole: 'captain', count: 25, blocks: [{ role: 'lancer', tier: 4, count: 24, heroRole: 'captain' }] },
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 25, mounted: true, blocks: [{ role: 'horse_archer', tier: 4, count: 24, heroRole: 'ranger', mounted: true }] },
      ])
      reinforcements = makeFriendlyArmy(missionId, faction, [25, 25], [
        { presetId: capt, heroRole: 'captain', source: 'temporary' },
        { presetId: maki, heroRole: 'ranger', source: 'temporary' },
      ], [{ role: 'lancer', count: 48 }], false, 'reinforcement')
      break
    }
    case 'veteran-scout-hunters': {
      squadSizes = [25, 25, 25, 25]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: capt, heroRole: 'captain', source: 'town', townRole: 'captain' },
        { presetId: maki, heroRole: 'ranger', source: 'town', townRole: 'ranger' },
        { presetId: preset(faction, 'lancer'), heroRole: 'captain', source: 'temporary' },
        { presetId: maki, heroRole: 'ranger', source: 'temporary' },
      ], [
        { role: 'lancer', count: 45, borrowRole: 'lancer_cavalry', borrowCount: 5 },
        { role: 'sword_cavalry', count: 25, borrowRole: 'melee_cavalry', borrowCount: 5 },
        { role: 'horse_archer', count: 25, borrowRole: 'ranged_cavalry', borrowCount: 10 },
      ])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'lancer', leaderHeroRole: 'captain', count: 20, blocks: [{ role: 'lancer', tier: 4, count: 19, heroRole: 'captain' }] },
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 20, mounted: true, blocks: [{ role: 'archer', tier: 4, count: 19, heroRole: 'ranger', mounted: true }] },
      ])
      break
    }
    case 'veteran-village-intercept': {
      squadSizes = [25, 25]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: capt, heroRole: 'captain', source: 'town', townRole: 'captain' },
        { presetId: maki, heroRole: 'ranger', source: 'town', townRole: 'ranger' },
      ], [{ role: 'lancer', count: 47, borrowRole: 'lancer_cavalry', borrowCount: 5 }])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 50, mounted: false, blocks: [{ role: 'archer', tier: 3, count: 49, mounted: false }] },
        { leaderRole: 'sword_cavalry', leaderHeroRole: 'captain', count: 50, mounted: false, blocks: [{ role: 'heavy_infantry', tier: 3, count: 49, mounted: false }] },
      ])
      break
    }
    case 'veteran-outpost-assault': {
      squadSizes = [25, 25, 25, 25]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: preset(faction, 'lancer'), heroRole: 'captain', source: 'mission' },
        { presetId: preset(faction, 'lancer'), heroRole: 'captain', source: 'mission' },
        { presetId: maki, heroRole: 'ranger', source: 'mission' },
        { presetId: maki, heroRole: 'ranger', source: 'mission' },
      ], [{ role: 'lancer', count: 95 }])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 50, mounted: false, blocks: [{ role: 'archer', tier: 3, count: 49, mounted: false }] },
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 50, mounted: true, blocks: [{ role: 'horse_archer', tier: 3, count: 49, mounted: true }] },
      ])
      break
    }
    case 'veteran-spear-line-hunt': {
      squadSizes = [25, 25]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: maki, heroRole: 'ranger', source: 'town', townRole: 'ranger' },
        { presetId: maki, heroRole: 'ranger', source: 'temporary' },
      ], [{ role: 'horse_archer', count: 47, borrowRole: 'ranged_cavalry', borrowCount: 10 }])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'spearman', leaderHeroRole: 'captain', count: 25, mounted: false, blocks: [{ role: 'spearman', tier: 3, count: 24, mounted: false }] },
        { leaderRole: 'spearman', leaderHeroRole: 'captain', count: 25, mounted: false, blocks: [{ role: 'spearman', tier: 3, count: 24, mounted: false }] },
        { leaderRole: 'spearman', leaderHeroRole: 'captain', count: 25, mounted: false, blocks: [{ role: 'spearman', tier: 3, count: 24, mounted: false }] },
        { leaderRole: 'spearman', leaderHeroRole: 'captain', count: 25, mounted: false, blocks: [{ role: 'spearman', tier: 3, count: 24, mounted: false }] },
      ])
      break
    }
    case 'veteran-tragedy-of-the-scouts': {
      squadSizes = [10, 10]
      friendly = makeFriendlyArmy(missionId, faction, squadSizes, [
        { presetId: capt, heroRole: 'captain', source: 'town', townRole: 'captain' },
        { presetId: maki, heroRole: 'ranger', source: 'town', townRole: 'ranger' },
      ], [
        { role: 'lancer', count: 8, borrowRole: 'lancer_cavalry', borrowCount: 5 },
        { role: 'sword_cavalry', count: 5, borrowRole: 'melee_cavalry', borrowCount: 5 },
        { role: 'horse_archer', count: 4, borrowRole: 'ranged_cavalry', borrowCount: 4 },
      ])
      enemy = makeEnemyGroups(missionId, opposing, [
        { leaderRole: 'lancer', leaderHeroRole: 'captain', count: 25, blocks: [{ role: 'lancer', tier: 3, count: 24 }] },
        { leaderRole: 'sword_cavalry', leaderHeroRole: 'captain', count: 25, blocks: [{ role: 'lancer', tier: 3, count: 22 }, { role: 'sword_cavalry', tier: 3, count: 2 }] },
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 25, mounted: true, blocks: [{ role: 'sword_cavalry', tier: 3, count: 23, mounted: true }, { role: 'horse_archer', tier: 3, count: 1, mounted: true }] },
        { leaderRole: 'archer', leaderHeroRole: 'ranger', count: 25, mounted: true, blocks: [{ role: 'horse_archer', tier: 3, count: 24, mounted: true }] },
      ])
      break
    }
  }
  return {
    playerIncluded: true,
    friendlyTotal: friendly.length + 1,
    enemyTotal: enemy.length,
    reinforcementTotal: reinforcements.length,
    squadSizes: [...squadSizes],
    friendly,
    enemy,
    reinforcements,
  }
}

export function createVeteranRoster(templateId: VeteranMissionTemplateId, faction: CharacterFaction, missionId: string = templateId): VeteranMissionRoster {
  if (!getVeteranMissionDefinition(templateId)) throw new Error(`Unknown Veteran mission template: ${templateId}`)
  return buildVeteranRoster(templateId, faction, missionId)
}

export function createVeteranSpawnSpec(unitSpec: VeteranRosterUnit, playerFaction: CharacterFaction, side: 'friendly' | 'enemy' = 'friendly'): NpcSpawnSpec {
  const characterFaction = side === 'enemy' ? oppositeFaction(playerFaction) : playerFaction
  const presetId = unitSpec.presetId
  const hero = unitSpec.tier === 4 ? T4_UNIT_PROFILES[presetId] : undefined
  const ranged = unitSpec.heroRole === 'ranger' || presetId.endsWith('_archer') || presetId.endsWith('_horse_archer')
  const loadout = { ...UNIT_PRESETS[presetId].tierLoadouts[3] }
  if (unitSpec.mounted) loadout.mountId = unitSpec.heroRole === 'ranger' ? 'black-cat' : hero?.mountOverride ?? loadout.mountId ?? 'horse'
  else loadout.mountId = null
  return {
    actorId: unitSpec.actorId,
    x: 0,
    z: 0,
    characterFaction,
    faction: side === 'enemy' ? Faction.ENEMY : Faction.TOWN,
    aiType: ranged ? AIType.RANGED : AIType.MELEE,
    name: unitSpec.heroRole === 'captain' ? 'Captain' : unitSpec.heroRole === 'ranger' ? 'Maki / Mounted Ranger' : 'Veteran Cavalry',
    tier: unitSpec.tier,
    cavalry: unitSpec.mounted,
    respawnEnabled: false,
    presetId,
    loadout,
    ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId, specialCombatProfile: hero.specialCombatProfile } : {}),
    ...(unitSpec.heroRole === 'ranger' ? { visualAssetId: 'maki-archer-t4' as const, combatProfileId: 'ranger' as const, specialCombatProfile: 'maki-ranger' as const } : {}),
    squadId: unitSpec.squadId as NpcSpawnSpec['squadId'],
  }
}

export function acceptVeteranMission(current: CareerProfile, templateId: string, options: AcceptVeteranMissionOptions = {}): CareerProfile | null {
  const missionDefinition = getVeteranMissionDefinition(templateId)
  if (!missionDefinition || !getVeteranMissionAvailability(current, templateId).unlocked
    || current.activeMission || current.activeOutpostMission || current.townEvent?.state === 'hostile') return null
  const missionId = options.missionId ?? createCareerMissionId(missionDefinition.id)
  const roster = createVeteranRoster(missionDefinition.id, current.faction, missionId)
  const mount = missionDefinition.requiresMount ? resolveCareerReliefMount(current) : undefined
  if (missionDefinition.requiresMount && !mount) return null
  const profile = cloneCareerProfile(current)
  if (mount) profile.selectedMountId = mount
  const outpost = missionDefinition.kind === 'veteran-outpost-defense' || missionDefinition.kind === 'veteran-outpost-assault'
  const mission: ActiveCareerMission = {
    id: missionId,
    templateId: missionDefinition.id,
    kind: missionDefinition.kind,
    targetCampId: outpost ? -1 : 0,
    phase: outpost ? 'ATTACKING' : 'ASSEMBLING',
    targetActorIds: roster.enemy.map(unit => unit.actorId),
    friendlyActorIds: roster.friendly.map(unit => unit.actorId),
    deadTargetActorIds: [],
    deadFriendlyActorIds: [],
    playerDead: false,
    acceptedAt: options.acceptedAt ?? Date.now(),
    ...(mount ? { mountState: { activeMountId: mount, hp: {}, unavailable: [] } } : {}),
    borrowedActorIds: roster.friendly.filter(unit => unit.source === 'town').map(unit => unit.actorId),
    reinforcementActorIds: roster.reinforcements.map(unit => unit.actorId),
    reinforcementElapsed: 0,
    reinforcementSpawned: false,
    reinforcementArrived: false,
    chargedSquadIds: [],
    ...(missionDefinition.objective.kind === 'survive' ? { survivalElapsed: 0 } : {}),
    ...(missionDefinition.kind === 'veteran-outpost-defense' ? { outpostBattleState: {
      phase: 'assault', activePhase: 'assault', assaultElapsedSeconds: 0, deploymentRemainingSeconds: 0,
      reinforcementTriggered: false, reinforcementSpawned: false, reinforcementArrived: false,
      reinforcementQueueIndex: 0, assaultChargeTriggered: false, battleFinished: false,
    } } : {}),
  }
  profile.activeMission = mission
  return profile
}
