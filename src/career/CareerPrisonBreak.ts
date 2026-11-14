import { PLAYER_RADIUS } from '../movement/MovementBalance'
import { prisonExitPlan } from '../arena/PrisonBreakLayout'
import { arenaTrialUnitSpec, parseArenaTrialState, type ArenaTrialState } from './CareerArenaTrials'
import { claimCareerMission, cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { ActiveCareerMission, CareerMissionOutcome } from './CareerMissionState'
import type { PlayerBattleStats } from '../combat/BattleStatsTracker'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { AIType, Faction } from '../world/NPC'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { getT5ProfileForFaction } from '../battle/T5HeroCatalog'
import { UNIT_PRESETS } from '../battle/UnitPresetCatalog'

export const PRISON_BREAK_DEFINITIONS = {
  'soldier-iron-encounter': { tier: 3, prisonerTier: 2, guardCount: 10, merit: 100, kind: 'heavy-cavalry-field' },
  'veteran-iron-tide': { tier: 4, prisonerTier: 3, guardCount: 5, merit: 200, kind: 'heavy-cavalry-field' },
  'commander-iron-legion': { tier: 5, prisonerTier: 4, guardCount: 5, merit: 400, kind: 'commander-iron-legion' },
} as const
export type PrisonBattleId = keyof typeof PRISON_BREAK_DEFINITIONS
export type PrisonRole = 'melee' | 'spear' | 'archer' | 'javelin'
export const PRISON_SWORD_ID = 'gladius_rusty'
export const PRISON_SWORD_COUNT = 6
export interface PrisonBreakState {
  version: 1 | 2
  /** Absent for captures that already committed to the original five guards. */
  rosterVersion?: 2
  missionId: string
  templateId: PrisonBattleId
  captor: CharacterFaction
  stage: 'captured' | 'escape' | 'result'
  combat: ArenaTrialState
  /** Sword index → player or permanent encounter actor ID; never an inventory grant. */
  swords: Record<string, string>
  gateOpen: boolean
  result?: { outcome: CareerMissionOutcome; merit: number; escapedBy?: string }
}
export interface PrisonRosterEntry {
  actorId: string; team: 'friendly' | 'enemy'; tier: 2 | 3 | 4 | 5; role: PrisonRole
}
function definition(id: string) { return Object.prototype.hasOwnProperty.call(PRISON_BREAK_DEFINITIONS, id) ? PRISON_BREAK_DEFINITIONS[id as PrisonBattleId] : undefined }
export function prisonGuardCount(state: Pick<PrisonBreakState, 'templateId' | 'rosterVersion'>): 5 | 10 {
  return state.rosterVersion === 2 ? PRISON_BREAK_DEFINITIONS[state.templateId].guardCount : 5
}
export function prisonRoster(state: Pick<PrisonBreakState, 'missionId' | 'templateId' | 'captor' | 'rosterVersion'>): PrisonRosterEntry[] {
  const spec = definition(state.templateId)!
  const guardRoles: PrisonRole[] = ['melee', 'melee', 'spear', 'archer', state.captor === 'roman' ? 'javelin' : 'archer']
  return [
    ...Array.from({ length: 30 }, (_, i): PrisonRosterEntry => ({ actorId: `${state.missionId}:prisoner:${i}`, team: 'friendly', tier: i === 0 ? spec.tier : spec.prisonerTier, role: 'melee' })),
    ...Array.from({ length: prisonGuardCount(state) }, (_, i): PrisonRosterEntry => ({
      actorId: `${state.missionId}:guard:${i}`, team: 'enemy', tier: spec.tier, role: guardRoles[i % guardRoles.length],
    })),
  ]
}
/** Identity comes from Tier factories; equipment is independently confiscated, even for hero bodies. */
export function prisonUnitSpec(state: PrisonBreakState, entry: PrisonRosterEntry, playerFaction: CharacterFaction, x = 0, z = 0): NpcSpawnSpec {
  const faction = entry.team === 'enemy' ? state.captor : playerFaction
  const spec = arenaTrialUnitSpec(entry.actorId, faction, entry.team === 'enemy' ? Faction.ENEMY : Faction.PLAYER,
    { role: entry.role === 'javelin' ? 'melee' : entry.role, tier: entry.tier, count: 1 }, x, z)
  if (entry.team === 'friendly') {
    const armed = Object.values(state.swords).includes(entry.actorId)
    spec.loadout = { meleeWeaponId: armed ? PRISON_SWORD_ID : null, rangedWeaponId: null, shieldId: null, mountId: null }
    spec.aiType = AIType.MELEE
    spec.name = `T${entry.tier} 友軍戰俘`
  } else if (entry.role === 'javelin') {
    // T5's generic ranged resolver upgrades every projectile to a bow. Keep the real pilum here.
    spec.presetId = 'roman_javelin_infantry'
    const commanderMelee = spec.loadout?.meleeWeaponId
    spec.loadout = entry.tier === 3 ? { ...UNIT_PRESETS.roman_javelin_infantry.tierLoadouts[3] }
      : { ...resolveT4UnitLoadout('roman_javelin_infantry') }
    if (entry.tier === 5) spec.loadout.meleeWeaponId = commanderMelee
    spec.loadout.rangedWeaponId = 'legionary_pilum'
    spec.loadout.mountId = null
    if (entry.tier === 4) Object.assign(spec, T4_UNIT_PROFILES.roman_javelin_infantry, { heroArchetype: 'captain' })
    if (entry.tier === 5) Object.assign(spec, getT5ProfileForFaction('roman'), { heroArchetype: 'commander' })
    spec.aiType = AIType.RANGED
    spec.name = `T${entry.tier} 羅馬標槍看守`
  }
  return spec
}
/** Called only by the formal field-battle result owner, never a death or cancel handler. */
export function claimCareerFieldResult(current: CareerProfile, missionId: string, outcome: CareerMissionOutcome,
  stats: PlayerBattleStats, meritStats: PlayerBattleStats, captor: CharacterFaction | undefined) {
  const claim = claimCareerMission(current, missionId, outcome, stats, meritStats)
  const mission = claim.profile.activeMission
  const spec = mission && definition(mission.templateId)
  if (!claim.alreadyClaimed && spec && mission.id === missionId && mission.kind === spec.kind && outcome === 'failure'
    && mission.result?.outcome === 'failure' && mission.result.claimed && captor) {
    mission.prisonBreak = { version: 2, rosterVersion: 2, missionId, templateId: mission.templateId as PrisonBattleId, captor, stage: 'captured',
      combat: { version: 1, tier: spec.tier, arenaId: captor === 'roman' ? 'roman-colosseum' : 'viking-valhalla', stage: 'deploying', combatElapsed: 0, actors: {} },
      swords: {}, gateOpen: false }
  }
  return claim
}
export function beginPrisonBreak(profile: CareerProfile, missionId = profile.activeMission?.id): CareerProfile | null {
  if (profile.activeMission?.id !== missionId || profile.activeMission?.prisonBreak?.stage !== 'captured') return null
  const next = cloneCareerProfile(profile)
  next.activeMission!.prisonBreak!.stage = 'escape'
  return next
}
/** A claim is committed before a hand or world sword is changed. */
export function claimPrisonSword(state: PrisonBreakState, index: number, actorId: string): PrisonBreakState | null {
  if (state.stage !== 'escape' || !Number.isInteger(index) || index < 0 || index >= PRISON_SWORD_COUNT
    || state.swords[index] !== undefined || Object.values(state.swords).includes(actorId)) return null
  if (actorId === 'player' ? state.combat.player?.knocked : !prisonRoster(state).some(entry => entry.team === 'friendly' && entry.actorId === actorId)
    || state.combat.actors[actorId]?.status === 'knocked') return null
  return { ...structuredClone(state), swords: { ...state.swords, [index]: actorId } }
}
/** Crossing an actual, floor-level aperture from inside → outside. Walls and other map edges cannot complete it. */
export function crossedPrisonExit(arenaId: ArenaTrialState['arenaId'], from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): boolean {
  const { crossingZ: z, halfWidth } = prisonExitPlan(arenaId)
  if (!(from.z > z && to.z <= z)) return false
  const t = (z - from.z) / (to.z - from.z)
  const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t
  return Math.abs(x) <= halfWidth - PLAYER_RADIUS && y >= 0.6 && y <= 2.1
}
export function prisonOutcome(progress: { playerDead: boolean; friendlyAlive: number; gateOpen: boolean; playerCrossed: boolean; friendlyCrossed: boolean }): CareerMissionOutcome | null {
  if (progress.gateOpen && (!progress.playerDead && progress.playerCrossed || progress.friendlyAlive > 0 && progress.friendlyCrossed)) return 'victory'
  return progress.playerDead && progress.friendlyAlive === 0 ? 'failure' : null
}
function livingPrisonEscaper(state: PrisonBreakState, escapedBy: string | undefined): boolean {
  if (!escapedBy) return false
  if (escapedBy === 'player') return Boolean(state.combat.player && !state.combat.player.knocked)
  return prisonRoster(state).some(entry => entry.team === 'friendly' && entry.actorId === escapedBy)
    && state.combat.actors[escapedBy]?.status === 'active'
}
function prisonTeamDown(state: PrisonBreakState): boolean {
  return state.combat.player?.knocked === true && prisonRoster(state).filter(entry => entry.team === 'friendly')
    .every(entry => state.combat.actors[entry.actorId]?.status === 'knocked')
}
export function prisonResultDescription(state: PrisonBreakState): string {
  if (state.result?.outcome !== 'victory') return state.version === 1 ? '你在穿過鐵門前倒下了。' : '你與所有友軍戰俘都在穿過鐵門前倒下了。'
  if (state.result.escapedBy && state.result.escapedBy !== 'player') return state.combat.player?.knocked
    ? '隊友成功逃脫，你未能逃出' : '隊友穿過了敵軍的鐵門。'
  return '你穿過了敵軍的鐵門。'
}
export function prisonTaunt(captor: CharacterFaction, gateOpen: boolean, standingGuards: number): string | null {
  return gateOpen || standingGuards <= 0 ? null : captor === 'roman'
    ? '你們以為撿了幾把劍，就能走出羅馬的門？' : '我還以為你們能讓我流點汗。'
}
/** One profile write owns both the escape receipt and its fixed reward. Original battle totals never change. */
export function settlePrisonBreak(current: CareerProfile, outcome: CareerMissionOutcome, save: (p: CareerProfile) => boolean, escapedBy?: string): CareerProfile | null {
  const state = current.activeMission?.prisonBreak
  if (!state || state.stage === 'captured') return null
  if (state.result) return cloneCareerProfile(current)
  if (outcome === 'victory' && (!state.gateOpen || !livingPrisonEscaper(state, escapedBy))
    || outcome === 'failure' && !prisonTeamDown(state)) return null
  const next = cloneCareerProfile(current), prison = next.activeMission!.prisonBreak!
  const merit = outcome === 'victory' ? definition(state.templateId)!.merit : 0
  prison.version = 2; prison.stage = 'result'; prison.result = { outcome, merit, ...(outcome === 'victory' ? { escapedBy } : {}) }
  next.totalMerit += merit; next.availableMerit += merit
  return save(next) ? next : null
}
/** Invalid new checkpoints fail closed. No field on an old save ever synthesizes capture. */
export function parsePrisonBreakState(value: unknown, mission: ActiveCareerMission): PrisonBreakState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as PrisonBreakState
  const spec = definition(mission.templateId)
  if (!spec || mission.kind !== spec.kind || mission.result?.outcome !== 'failure' || !mission.result.claimed
    || raw.version !== 1 && raw.version !== 2 || raw.rosterVersion !== undefined && (raw.rosterVersion !== 2 || raw.version !== 2)
    || raw.missionId !== mission.id || raw.templateId !== mission.templateId
    || !['roman', 'viking'].includes(raw.captor) || !['captured', 'escape', 'result'].includes(raw.stage)
    || typeof raw.gateOpen !== 'boolean' || !raw.swords || typeof raw.swords !== 'object' || Array.isArray(raw.swords)) return undefined
  const roster = prisonRoster(raw), friendlyActorIds = roster.filter(e => e.team === 'friendly').map(e => e.actorId)
  const targetActorIds = roster.filter(e => e.team === 'enemy').map(e => e.actorId)
  const combat = parseArenaTrialState(raw.combat, { friendlyActorIds, targetActorIds })
  if (!combat || combat.tier !== spec.tier || combat.arenaId !== (raw.captor === 'roman' ? 'roman-colosseum' : 'viking-valhalla')) return undefined
  const swords = Object.entries(raw.swords)
  if (swords.some(([i, owner]) => !/^[0-5]$/.test(i) || owner !== 'player' && !friendlyActorIds.includes(owner))
    || new Set(swords.map(([,owner]) => owner)).size !== swords.length) return undefined
  if (combat.stage === 'engaged' && (!combat.player || roster.some(e => !combat.actors[e.actorId]))) return undefined
  if (raw.stage === 'captured' && (combat.stage !== 'deploying' || raw.gateOpen || swords.length > 0 || combat.player)) return undefined
  if (combat.player && (combat.player.knocked !== (combat.player.hp === 0))) return undefined
  if (Object.values(combat.actors).some(actor => (actor.status === 'knocked') !== (actor.hp === 0))) return undefined
  const allGuardsDown = targetActorIds.every(id => combat.actors[id]?.status === 'knocked')
  if (raw.gateOpen && !allGuardsDown) return undefined
  if (raw.stage === 'result') {
    const legacy = raw.version === 1
    if (!raw.result || !['victory', 'failure'].includes(raw.result.outcome)
      || !legacy && (combat.stage !== 'engaged' || !combat.player)
      || raw.result.merit !== (raw.result.outcome === 'victory' ? spec.merit : 0)
      || raw.result.outcome === 'victory' && (!raw.gateOpen || (legacy ? combat.player?.knocked : !livingPrisonEscaper({ ...raw, combat }, raw.result.escapedBy)))
      || raw.result.outcome === 'failure' && (legacy ? !combat.player?.knocked : !prisonTeamDown({ ...raw, combat }))
      || raw.result.outcome === 'failure' && raw.result.escapedBy !== undefined) return undefined
  } else if (raw.result) return undefined
  // Unfinished v1 encounters adopt team escape. Sealed legacy receipts are never replayed or changed.
  return { version: raw.version === 1 && raw.stage === 'result' ? 1 : 2, ...(raw.rosterVersion === 2 ? { rosterVersion: 2 } : {}),
    missionId: raw.missionId, templateId: raw.templateId, captor: raw.captor, stage: raw.stage,
    combat, swords: Object.fromEntries(swords), gateOpen: raw.gateOpen, ...(raw.result ? { result: {
      outcome: raw.result.outcome, merit: raw.result.merit,
      ...(raw.version === 2 && raw.result.escapedBy ? { escapedBy: raw.result.escapedBy } : {}),
    } } : {}) }
}
