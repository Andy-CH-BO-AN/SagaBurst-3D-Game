import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { HEAVY_T4_HERO, T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { getT5ProfileForFaction, getT5ProfileForPreset, resolveT5UnitLoadout } from '../battle/T5HeroCatalog'
import { UNIT_PRESETS, type BaseUnitTier, type UnitLoadout, type UnitPresetId, type UnitTier } from '../battle/UnitPresetCatalog'
import { parseDuelArenaId, type DuelArenaId } from '../arena/DuelArenaCatalog'
import type { CharacterTier } from '../combat/CharacterIdentity'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import { CAREER_RANKS, type CareerProfile, type CareerRank } from './CareerProfile'
import { createCareerMissionId, type ActiveCareerMission, type CareerMissionOutcome } from './CareerMissionState'

/**
 * Arena Squad Trials: same-culture team skirmishes in a Duel arena. A trial is an ordinary Career
 * mission with its own template IDs; it never touches formal mission tiers, 1v1 or race progress.
 * Troop mix and command are decided here only, so rebalancing never touches global rules.
 */
export const ARENA_TRIAL_TEMPLATE_PREFIX = 'career-arena-trial'
export const ARENA_TRIAL_TIERS = [1, 2, 3, 4, 5] as const
export type ArenaTrialTier = typeof ARENA_TRIAL_TIERS[number]
export type ArenaTrialRole = 'melee' | 'spear' | 'archer'
/** Live combat is capped so a stuck fight can never lock the player in the arena. */
export const ARENA_TRIAL_TIME_LIMIT_SECONDS = 900
export const ARENA_TRIAL_COUNTDOWN_SECONDS = 5

export interface ArenaTrialGroup {
  readonly role: ArenaTrialRole
  /** Body, equipment and stats tier of these NPCs; the player's own rank and class are never rewritten. */
  readonly tier: CharacterTier
  /** The faction's heavy T4/T5 hero body instead of the ordinary one. */
  readonly heavy?: boolean
  readonly count: number
}

export interface ArenaTrialDefinition {
  readonly tier: ArenaTrialTier
  readonly label: string
  /** The same-rank Career qualification; no 1v1, race or earlier-trial victory is required. */
  readonly requiredRank: CareerRank
  /** Friendly NPCs only: the player fills the remaining slot of the stated team size. */
  readonly friendly: readonly ArenaTrialGroup[]
  readonly enemy: readonly ArenaTrialGroup[]
}

const sum = (groups: readonly ArenaTrialGroup[]): number => groups.reduce((total, group) => total + group.count, 0)

export const ARENA_TRIAL_DEFINITIONS: Readonly<Record<ArenaTrialTier, ArenaTrialDefinition>> = Object.freeze({
  1: { tier: 1, label: '新兵試煉', requiredRank: 'recruit',
    friendly: [{ role: 'melee', tier: 1, count: 10 }, { role: 'spear', tier: 1, count: 5 }, { role: 'archer', tier: 1, count: 4 }],
    enemy: [{ role: 'melee', tier: 2, count: 5 }, { role: 'spear', tier: 2, count: 3 }, { role: 'archer', tier: 2, count: 2 }] },
  2: { tier: 2, label: '士兵試煉', requiredRank: 'soldier',
    friendly: [{ role: 'melee', tier: 2, count: 7 }, { role: 'spear', tier: 2, count: 4 }, { role: 'archer', tier: 2, count: 3 }],
    enemy: [{ role: 'melee', tier: 3, count: 4 }, { role: 'spear', tier: 3, count: 2 }, { role: 'archer', tier: 3, count: 2 }] },
  3: { tier: 3, label: '老兵試煉', requiredRank: 'veteran',
    friendly: [{ role: 'melee', tier: 3, count: 4 }, { role: 'spear', tier: 3, count: 2 }, { role: 'archer', tier: 3, count: 1 }],
    enemy: [{ role: 'melee', tier: 2, count: 10 }, { role: 'spear', tier: 2, count: 6 }, { role: 'archer', tier: 2, count: 4 }] },
  4: { tier: 4, label: '隊長試煉', requiredRank: 'captain',
    friendly: [{ role: 'melee', tier: 4, heavy: true, count: 4 }, { role: 'melee', tier: 4, count: 6 }, { role: 'spear', tier: 4, count: 5 }, { role: 'archer', tier: 4, count: 4 }],
    enemy: [{ role: 'melee', tier: 5, heavy: true, count: 2 }, { role: 'melee', tier: 5, count: 3 }] },
  5: { tier: 5, label: '指揮官試煉', requiredRank: 'commander',
    friendly: [{ role: 'melee', tier: 5, heavy: true, count: 2 }, { role: 'melee', tier: 5, count: 2 }],
    enemy: [{ role: 'melee', tier: 4, heavy: true, count: 4 }, { role: 'melee', tier: 4, count: 6 }, { role: 'spear', tier: 4, count: 6 }, { role: 'archer', tier: 4, count: 4 }] },
})

const ROLE_LABELS: Record<ArenaTrialRole, string> = { melee: '近戰', spear: '長矛', archer: '弓手' }
/** One line per team for the Sergeant's trial board, e.g. `T1 近戰 ×10、T1 長矛 ×5`. */
export function arenaTrialGroupsLabel(groups: readonly ArenaTrialGroup[]): string {
  return groups.map(group => `T${group.tier}${group.heavy ? ' 重甲' : ''}${ROLE_LABELS[group.role]} ×${group.count}`).join('、')
}

/** Team sizes as the player sees them: the friendly side includes the player. */
export function arenaTrialTeamSizes(tier: ArenaTrialTier): { friendly: number; enemy: number } {
  const definition = ARENA_TRIAL_DEFINITIONS[tier]
  return { friendly: sum(definition.friendly) + 1, enemy: sum(definition.enemy) }
}

export function isArenaTrialTier(value: unknown): value is ArenaTrialTier {
  return typeof value === 'number' && (ARENA_TRIAL_TIERS as readonly number[]).includes(value)
}

export function arenaTrialTemplateId(tier: ArenaTrialTier): string { return `${ARENA_TRIAL_TEMPLATE_PREFIX}-t${tier}` }

export function arenaTrialTierFromTemplateId(templateId: unknown): ArenaTrialTier | null {
  const tier = ARENA_TRIAL_TIERS.find(candidate => arenaTrialTemplateId(candidate) === templateId)
  return tier ?? null
}

export function isArenaTrialUnlocked(profile: Pick<CareerProfile, 'rank'>, tier: ArenaTrialTier): boolean {
  return CAREER_RANKS.indexOf(profile.rank) >= CAREER_RANKS.indexOf(ARENA_TRIAL_DEFINITIONS[tier].requiredRank)
}

/** Why a trial cannot start now; null means it may be accepted. */
export function arenaTrialBlocker(profile: CareerProfile, tier: ArenaTrialTier): string | null {
  if (!isArenaTrialUnlocked(profile, tier)) return '軍階尚未達到此試煉資格。'
  if (profile.activeMission || profile.activeOutpostMission || profile.activeRace) return '目前已有進行中的任務或賽事。'
  if (profile.townEvent?.state === 'hostile') return '小鎮正處於敵對狀態。'
  return null
}

/* ───────── saved trial state ───────── */

export type ArenaTrialStage = 'deploying' | 'engaged'
export interface ArenaTrialActorState {
  /** Knocked-out actors stay out of the roster on reload; nothing here is a casualty. */
  status: 'active' | 'knocked'
  hp: number
  x: number
  z: number
  yaw: number
  /** Standing height, remaining ammo and shield durability. Older saves lack them; 0 is a real value (spent / broken), never "missing". */
  y?: number
  ammo?: number
  shieldImpact?: number
}
export interface ArenaTrialPlayerState {
  knocked: boolean; hp: number; stamina: number; x: number; z: number; yaw: number
  y?: number; ammo?: number; shieldImpact?: number
  /** Per-shield remaining durability, so swapping shields in the arena survives a reload too. */
  shieldDurability?: Record<string, number>
}
export interface ArenaTrialState {
  version: 1
  tier: ArenaTrialTier
  arenaId: DuelArenaId
  /** deploying: no blow has landed, a reload simply re-forms the lines. engaged: `actors` is authoritative. */
  stage: ArenaTrialStage
  combatElapsed: number
  actors: Record<string, ArenaTrialActorState>
  player?: ArenaTrialPlayerState
  /** Why a lost trial ended; saved with the result so the result screen reads the same after a reload. */
  endReason?: ArenaTrialEndReason
}
export type ArenaTrialEndReason = 'timeout' | 'eliminated'

/* ───────── roster ───────── */

export interface ArenaTrialRosterEntry { actorId: string; team: 'friendly' | 'enemy'; group: ArenaTrialGroup }

/** Stable per-mission identities: heavy and ordinary groups interleave exactly as the definition lists them. */
export function arenaTrialRoster(missionId: string, tier: ArenaTrialTier): ArenaTrialRosterEntry[] {
  const definition = ARENA_TRIAL_DEFINITIONS[tier]
  const entries: ArenaTrialRosterEntry[] = []
  for (const team of ['friendly', 'enemy'] as const) {
    let index = 0
    for (const group of definition[team]) {
      for (let i = 0; i < group.count; i++) entries.push({ actorId: `${missionId}:${team}:${index++}`, team, group })
    }
  }
  return entries
}

const FOOT_PRESET: Record<ArenaTrialRole, (faction: CharacterFaction) => UnitPresetId> = {
  melee: faction => faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker',
  spear: faction => `${faction}_spearman`,
  archer: faction => `${faction}_archer`,
}
const ROLE_LABEL: Record<ArenaTrialRole, string> = { melee: '近戰', spear: '長矛', archer: '弓手' }

/**
 * One NPC body built from the existing Tier factories (ordinary presets, T4 profiles, T5 profiles).
 * Everyone fights on foot. `allegiance` is the trial team (PLAYER / ENEMY); `faction` is only the look.
 */
export function arenaTrialUnitSpec(actorId: string, faction: CharacterFaction, allegiance: Faction.PLAYER | Faction.ENEMY,
  group: ArenaTrialGroup, x = 0, z = 0): NpcSpawnSpec {
  const presetId = FOOT_PRESET[group.role](faction)
  const foot = (loadout: UnitLoadout): UnitLoadout => ({ ...loadout, mountId: null })
  let loadout: UnitLoadout
  let identity: Pick<NpcSpawnSpec, 'visualAssetId' | 'combatProfileId' | 'specialCombatProfile' | 'heroArchetype'> = {}
  if (group.tier <= 3) loadout = foot({ ...UNIT_PRESETS[presetId].tierLoadouts[group.tier as BaseUnitTier] })
  else if (group.tier === 4) {
    const profile = T4_UNIT_PROFILES[presetId]
    const heavy = group.heavy && profile.combatProfileId !== 'ranger' ? HEAVY_T4_HERO[faction] : undefined
    loadout = foot(resolveT4UnitLoadout(presetId))
    identity = { visualAssetId: heavy?.visualAssetId ?? profile.visualAssetId, combatProfileId: heavy?.combatProfileId ?? profile.combatProfileId,
      ...(profile.specialCombatProfile ? { specialCombatProfile: profile.specialCombatProfile } : {}),
      heroArchetype: profile.combatProfileId === 'ranger' ? 'ranger' : 'captain' }
  } else {
    const profile = group.heavy ? getT5ProfileForPreset(`${faction}_heavy_cavalry`, faction) : getT5ProfileForFaction(faction)
    loadout = foot(resolveT5UnitLoadout(presetId))
    identity = { visualAssetId: profile.visualAssetId, combatProfileId: profile.combatProfileId, heroArchetype: 'commander' }
  }
  return {
    actorId, x, z, faction: allegiance, characterFaction: faction,
    aiType: loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    name: `T${group.tier}${group.heavy ? ' 重甲' : ''}${ROLE_LABEL[group.role]}`,
    tier: Math.min(group.tier, 4) as UnitTier, characterTier: group.tier,
    cavalry: false, respawnEnabled: false, presetId, loadout, ...identity,
  }
}

/** Assets a trial must have loaded before its first body is built. */
export function arenaTrialPreloadPlan(tier: ArenaTrialTier, faction: CharacterFaction): { heroAssets: NonNullable<NpcSpawnSpec['visualAssetId']>[]; equipmentIds: string[] } {
  const heroAssets = new Set<NonNullable<NpcSpawnSpec['visualAssetId']>>(), equipmentIds = new Set<string>()
  for (const { actorId, group } of arenaTrialRoster('preload', tier)) {
    const spec = arenaTrialUnitSpec(actorId, faction, Faction.PLAYER, group)
    if (spec.visualAssetId) heroAssets.add(spec.visualAssetId)
    for (const id of [spec.loadout?.meleeWeaponId, spec.loadout?.secondaryMeleeWeaponId, spec.loadout?.shieldId]) if (id) equipmentIds.add(id)
  }
  return { heroAssets: [...heroAssets], equipmentIds: [...equipmentIds] }
}

/* ───────── mission ───────── */

export function createArenaTrialMission(profile: CareerProfile, tier: ArenaTrialTier, arenaId: DuelArenaId,
  id = createCareerMissionId(arenaTrialTemplateId(tier))): ActiveCareerMission | null {
  if (!isArenaTrialTier(tier) || !parseDuelArenaId(arenaId) || !id.trim() || arenaTrialBlocker(profile, tier)) return null
  const roster = arenaTrialRoster(id.trim(), tier)
  return {
    id: id.trim(), templateId: arenaTrialTemplateId(tier), kind: 'arena-squad-trial', targetCampId: -1, phase: 'ASSEMBLING',
    targetActorIds: roster.filter(entry => entry.team === 'enemy').map(entry => entry.actorId),
    friendlyActorIds: roster.filter(entry => entry.team === 'friendly').map(entry => entry.actorId),
    arenaTrial: { version: 1, tier, arenaId, stage: 'deploying', combatElapsed: 0, actors: {} },
    acceptedAt: Date.now(),
  }
}

export function careerArenaTrial(mission: Pick<ActiveCareerMission, 'kind' | 'arenaTrial'> | undefined): ArenaTrialState | null {
  return mission?.kind === 'arena-squad-trial' && mission.arenaTrial ? mission.arenaTrial : null
}

/* ───────── knockout accounting ───────── */

export interface ArenaTrialCounts { friendlyActive: number; enemyActive: number; playerKnocked: boolean }

/**
 * A knocked-out body is out of the fight and the count, never a casualty. The player falling does not end
 * the trial while any friendly NPC still stands; the trial is lost only when the whole friendly side is out.
 */
export function resolveArenaTrialOutcome(counts: ArenaTrialCounts, combatElapsed: number): CareerMissionOutcome | null {
  return resolveArenaTrialEnd(counts, combatElapsed)?.outcome ?? null
}

/** The outcome together with why a lost trial ended: the whole friendly side out, or the clock running out. */
export function resolveArenaTrialEnd(counts: ArenaTrialCounts, combatElapsed: number): { outcome: CareerMissionOutcome; reason?: ArenaTrialEndReason } | null {
  if (counts.enemyActive <= 0) return { outcome: 'victory' }
  if (counts.friendlyActive <= 0 && counts.playerKnocked) return { outcome: 'failure', reason: 'eliminated' }
  return combatElapsed >= ARENA_TRIAL_TIME_LIMIT_SECONDS ? { outcome: 'failure', reason: 'timeout' } : null
}

export function arenaTrialCounts(mission: Pick<ActiveCareerMission, 'friendlyActorIds' | 'targetActorIds'>,
  state: Pick<ArenaTrialState, 'actors' | 'player'>, knockedNow: ReadonlySet<string> = new Set()): ArenaTrialCounts {
  const active = (id: string): boolean => !knockedNow.has(id) && state.actors[id]?.status !== 'knocked'
  return {
    friendlyActive: mission.friendlyActorIds.filter(active).length,
    enemyActive: mission.targetActorIds.filter(active).length,
    playerKnocked: state.player?.knocked === true,
  }
}

/** Actors a reload may build: knocked ones are never recreated. Deploying trials re-form every actor fresh. */
export function arenaTrialRestorablePlan(mission: Pick<ActiveCareerMission, 'friendlyActorIds' | 'targetActorIds'>,
  state: ArenaTrialState): { actorId: string; saved?: ArenaTrialActorState }[] {
  return [...mission.friendlyActorIds, ...mission.targetActorIds].flatMap(actorId => {
    const saved = state.stage === 'engaged' ? state.actors[actorId] : undefined
    return saved?.status === 'knocked' ? [] : [{ actorId, ...(saved ? { saved } : {}) }]
  })
}

/* ───────── saved-state parsing ───────── */

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const optionalFinite = (value: unknown): boolean => value === undefined || finite(value)
const optionalCount = (value: unknown): boolean => value === undefined || (finite(value) && value >= 0)

export function parseArenaTrialState(value: unknown, mission: { friendlyActorIds: readonly string[]; targetActorIds: readonly string[] }): ArenaTrialState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const arenaId = parseDuelArenaId(raw.arenaId)
  if (raw.version !== 1 || !isArenaTrialTier(raw.tier) || !arenaId || (raw.stage !== 'deploying' && raw.stage !== 'engaged')
    || !finite(raw.combatElapsed) || raw.combatElapsed < 0 || !raw.actors || typeof raw.actors !== 'object') return undefined
  const known = new Set([...mission.friendlyActorIds, ...mission.targetActorIds])
  const actors: Record<string, ArenaTrialActorState> = {}
  for (const [id, entry] of Object.entries(raw.actors as Record<string, unknown>)) {
    const actor = entry as Record<string, unknown> | null
    if (!known.has(id) || !actor || (actor.status !== 'active' && actor.status !== 'knocked')
      || ![actor.hp, actor.x, actor.z, actor.yaw].every(finite) || (actor.hp as number) < 0) return undefined
    if (!optionalFinite(actor.y) || !optionalCount(actor.ammo) || !optionalCount(actor.shieldImpact)) return undefined
    actors[id] = { status: actor.status, hp: actor.hp as number, x: actor.x as number, z: actor.z as number, yaw: actor.yaw as number,
      ...(actor.y !== undefined ? { y: actor.y as number } : {}), ...(actor.ammo !== undefined ? { ammo: actor.ammo as number } : {}),
      ...(actor.shieldImpact !== undefined ? { shieldImpact: actor.shieldImpact as number } : {}) }
  }
  let player: ArenaTrialPlayerState | undefined
  if (raw.player !== undefined) {
    const p = raw.player as Record<string, unknown> | null
    if (!p || typeof p.knocked !== 'boolean' || ![p.hp, p.stamina, p.x, p.z, p.yaw].every(finite) || (p.hp as number) < 0) return undefined
    if (!optionalFinite(p.y) || !optionalCount(p.ammo) || !optionalCount(p.shieldImpact)) return undefined
    let shieldDurability: Record<string, number> | undefined
    if (p.shieldDurability !== undefined) {
      if (!p.shieldDurability || typeof p.shieldDurability !== 'object' || !Object.values(p.shieldDurability).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return undefined
      shieldDurability = { ...(p.shieldDurability as Record<string, number>) }
    }
    player = { knocked: p.knocked, hp: p.hp as number, stamina: p.stamina as number, x: p.x as number, z: p.z as number, yaw: p.yaw as number,
      ...(p.y !== undefined ? { y: p.y as number } : {}), ...(p.ammo !== undefined ? { ammo: p.ammo as number } : {}),
      ...(p.shieldImpact !== undefined ? { shieldImpact: p.shieldImpact as number } : {}), ...(shieldDurability ? { shieldDurability } : {}) }
  }
  if (raw.endReason !== undefined && raw.endReason !== 'timeout' && raw.endReason !== 'eliminated') return undefined
  return { version: 1, tier: raw.tier, arenaId, stage: raw.stage, combatElapsed: raw.combatElapsed, actors, ...(player ? { player } : {}),
    ...(raw.endReason ? { endReason: raw.endReason } : {}) }
}
