/**
 * Pure data and rules for the four heavy-cavalry Career battles (Soldier, Veteran,
 * Captain and Commander VII). Nothing here touches Three.js, NPCs or the scene:
 * rosters, tactical triggers and the Veteran caltrop defence are plain data so the
 * runtime and the tests share one owner.
 */
import type { CombatEvent } from '../combat/CombatAttribution'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'

export const SOLDIER_IRON_ENCOUNTER_ID = 'soldier-iron-encounter'
export const VETERAN_IRON_TIDE_ID = 'veteran-iron-tide'
export const CAPTAIN_STEEL_AVALANCHE_ID = 'captain-steel-avalanche'
export const COMMANDER_IRON_LEGION_ID = 'commander-iron-legion'
export const COMMANDER_IRON_LEGION_KIND = 'commander-iron-legion' as const
export const HEAVY_FIELD_KIND = 'heavy-cavalry-field' as const

export const HEAVY_FIELD_MISSION_IDS = [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID, CAPTAIN_STEEL_AVALANCHE_ID] as const
export type HeavyFieldMissionId = typeof HEAVY_FIELD_MISSION_IDS[number]

/** Horizontal distance at which the counter-charge fires, measured between actual front-line units. */
export const HEAVY_COUNTER_CHARGE_METERS = 20
/** Every deployment starts with the two front lines farther apart than this. */
export const HEAVY_MIN_START_DISTANCE_METERS = 200

export type HeavyRole = 'spear' | 'melee' | 'archer' | 'heavy_cavalry'
export type HeavyTier = 2 | 3 | 4 | 5
export interface HeavyRosterGroup { role: HeavyRole; tier: HeavyTier; count: number }
export type HeavySide = 'friendly' | 'enemy'

const sum = (groups: readonly HeavyRosterGroup[]) => groups.reduce((total, group) => total + group.count, 0)
export const heavyGroupsTotal = sum

/** Official friendly rosters INCLUDE the player's slot; `HEAVY_PLAYER_SLOT` names which group it occupies. */
export const SOLDIER_FRIENDLY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'spear', tier: 2, count: 26 }, { role: 'spear', tier: 3, count: 3 }, { role: 'spear', tier: 4, count: 1 },
  { role: 'melee', tier: 2, count: 23 }, { role: 'melee', tier: 3, count: 3 },
  { role: 'archer', tier: 2, count: 16 }, { role: 'archer', tier: 3, count: 3 },
]
export const SOLDIER_ENEMY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'heavy_cavalry', tier: 3, count: 50 }, { role: 'heavy_cavalry', tier: 4, count: 9 }, { role: 'heavy_cavalry', tier: 5, count: 1 },
]
export const VETERAN_FRIENDLY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'spear', tier: 3, count: 98 }, { role: 'spear', tier: 4, count: 2 },
  { role: 'melee', tier: 3, count: 98 }, { role: 'melee', tier: 4, count: 2 },
  { role: 'archer', tier: 3, count: 98 }, { role: 'archer', tier: 4, count: 2 },
]
export const VETERAN_ENEMY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'heavy_cavalry', tier: 3, count: 70 }, { role: 'heavy_cavalry', tier: 4, count: 25 }, { role: 'heavy_cavalry', tier: 5, count: 5 },
]
export const CAPTAIN_FRIENDLY_GROUPS: readonly HeavyRosterGroup[] = [{ role: 'heavy_cavalry', tier: 4, count: 30 }]
export const CAPTAIN_ENEMY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'melee', tier: 3, count: 98 }, { role: 'melee', tier: 4, count: 2 },
  { role: 'archer', tier: 3, count: 98 }, { role: 'archer', tier: 4, count: 2 },
]
export const IRON_LEGION_ENEMY_GROUPS: readonly HeavyRosterGroup[] = [
  { role: 'heavy_cavalry', tier: 4, count: 210 }, { role: 'heavy_cavalry', tier: 5, count: 90 },
]
/** The group whose slot the player occupies; the player is never spawned as an NPC. */
export const HEAVY_PLAYER_SLOT: Record<HeavyFieldMissionId, { role: HeavyRole; tier: HeavyTier }> = {
  [SOLDIER_IRON_ENCOUNTER_ID]: { role: 'melee', tier: 2 },
  [VETERAN_IRON_TIDE_ID]: { role: 'melee', tier: 3 },
  [CAPTAIN_STEEL_AVALANCHE_ID]: { role: 'heavy_cavalry', tier: 4 },
}

export interface HeavyFieldSpec {
  friendly: readonly HeavyRosterGroup[]
  enemy: readonly HeavyRosterGroup[]
  friendlyOrder: TacticalOrder
  enemyOrder: TacticalOrder
  /** Any effective hit on a mission enemy (rider or mount) releases the whole enemy army. */
  enemyChargeOnAnyDamage: boolean
  /** Which side receives Charge when the real front lines close to 20m. */
  counterCharge: 'friendly' | 'enemy'
  /** Soldier only: the friendly column marches behind its captain until the ambush point. */
  startsMarching: boolean
  /** Official command squads the player may command (empty = no command authority). */
  friendlySquadSizes: readonly number[]
}

export const HEAVY_FIELD_SPECS: Record<HeavyFieldMissionId, HeavyFieldSpec> = {
  [SOLDIER_IRON_ENCOUNTER_ID]: { friendly: SOLDIER_FRIENDLY_GROUPS, enemy: SOLDIER_ENEMY_GROUPS, friendlyOrder: 'follow', enemyOrder: 'attack',
    enemyChargeOnAnyDamage: true, counterCharge: 'friendly', startsMarching: true, friendlySquadSizes: [] },
  [VETERAN_IRON_TIDE_ID]: { friendly: VETERAN_FRIENDLY_GROUPS, enemy: VETERAN_ENEMY_GROUPS, friendlyOrder: 'formation', enemyOrder: 'attack',
    enemyChargeOnAnyDamage: true, counterCharge: 'friendly', startsMarching: false, friendlySquadSizes: [] },
  [CAPTAIN_STEEL_AVALANCHE_ID]: { friendly: CAPTAIN_FRIENDLY_GROUPS, enemy: CAPTAIN_ENEMY_GROUPS, friendlyOrder: 'defend', enemyOrder: 'defend',
    enemyChargeOnAnyDamage: false, counterCharge: 'enemy', startsMarching: false, friendlySquadSizes: [29] },
}

export function isHeavyFieldMissionId(id: string): id is HeavyFieldMissionId {
  return (HEAVY_FIELD_MISSION_IDS as readonly string[]).includes(id)
}

/** NPC groups: the player's slot is removed from the official roster. */
export function heavyNpcGroups(missionId: HeavyFieldMissionId, side: HeavySide): HeavyRosterGroup[] {
  const groups = HEAVY_FIELD_SPECS[missionId][side]
  const slot = HEAVY_PLAYER_SLOT[missionId]
  return side === 'friendly'
    ? groups.map(group => group.role === slot.role && group.tier === slot.tier ? { ...group, count: group.count - 1 } : group).filter(group => group.count > 0)
    : [...groups]
}

export function heavyActorIds(missionId: string, side: HeavySide, groups: readonly HeavyRosterGroup[]): string[] {
  return groups.flatMap(group => Array.from({ length: group.count }, (_, index) => `${missionId}:${side}:t${group.tier}:${group.role}:${index}`))
}

/** Captain's player is the 30th rider; everything else uses the official total directly. */
export function heavyFriendlyActorIds(missionId: HeavyFieldMissionId): string[] { return heavyActorIds(missionId, 'friendly', heavyNpcGroups(missionId, 'friendly')) }
export function heavyEnemyActorIds(missionId: HeavyFieldMissionId): string[] { return heavyActorIds(missionId, 'enemy', heavyNpcGroups(missionId, 'enemy')) }

export function heavyPresetId(faction: CharacterFaction, role: HeavyRole): UnitPresetId {
  if (role === 'heavy_cavalry') return `${faction}_heavy_cavalry`
  if (role === 'spear') return `${faction}_spearman`
  if (role === 'archer') return `${faction}_archer`
  return faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
}

/** Iron Legion keeps the six-cat army and swaps only the enemy: T4 210 + T5 90 heavy cavalry. */
export function ironLegionEnemyActorIds(missionId: string): string[] { return heavyActorIds(missionId, 'enemy', IRON_LEGION_ENEMY_GROUPS) }
export function ironLegionVanguardActorId(missionId: string): string { return `${missionId}:enemy:t5:heavy_cavalry:0` }

// ---------------------------------------------------------------------------
// Tactical state
// ---------------------------------------------------------------------------

export interface HeavyFieldState {
  version: 1
  /** Soldier: the captain has halted the column and ordered Formation. */
  formationIssued: boolean
  /** Soldier: the enemy holds its ground until our line is formed, then switches to Attack. */
  enemyReleased: boolean
  /** Soldier / Veteran: first effective hit on a mission enemy has released their Charge. */
  enemyChargeTriggered: boolean
  /** 20m counter-charge, for whichever side the mission names. Fires once. */
  counterChargeTriggered: boolean
}

export function createHeavyFieldState(missionId: HeavyFieldMissionId): HeavyFieldState {
  return { version: 1, formationIssued: !HEAVY_FIELD_SPECS[missionId].startsMarching, enemyReleased: !HEAVY_FIELD_SPECS[missionId].startsMarching, enemyChargeTriggered: false, counterChargeTriggered: false }
}

export function parseHeavyFieldState(raw: unknown, missionId: HeavyFieldMissionId): HeavyFieldState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || typeof value.formationIssued !== 'boolean' || typeof value.enemyReleased !== 'boolean' || typeof value.enemyChargeTriggered !== 'boolean'
    || typeof value.counterChargeTriggered !== 'boolean') return undefined
  if (!HEAVY_FIELD_SPECS[missionId].startsMarching && !value.formationIssued) return undefined
  return { version: 1, formationIssued: value.formationIssued, enemyReleased: value.enemyReleased, enemyChargeTriggered: value.enemyChargeTriggered, counterChargeTriggered: value.counterChargeTriggered }
}

/** What a side should be doing right now; also used to restore orders after Reload. */
export function heavyTacticalOrder(missionId: HeavyFieldMissionId, side: HeavySide, state: HeavyFieldState): TacticalOrder {
  const spec = HEAVY_FIELD_SPECS[missionId]
  if (side === 'friendly') {
    if (spec.counterCharge === 'friendly' && state.counterChargeTriggered) return 'charge'
    if (spec.startsMarching && !state.formationIssued) return 'follow'
    return spec.startsMarching ? 'formation' : spec.friendlyOrder
  }
  if (state.enemyChargeTriggered || spec.counterCharge === 'enemy' && state.counterChargeTriggered) return 'charge'
  return spec.startsMarching && !state.enemyReleased ? 'defend' : spec.enemyOrder
}

/** Effective damage on a mission enemy's rider or mount. Blocks, misses and zero-damage hits never count. */
export function isEffectiveHeavyEnemyDamage(event: CombatEvent, enemyActorIds: ReadonlySet<string>): boolean {
  if (event.type !== 'damage_applied' || !(event.appliedDamage > 0)) return false
  const target = event.target
  if (target.targetType === 'npc') return enemyActorIds.has(target.targetId)
  return target.targetType === 'mount' && target.ownerActorId !== undefined && enemyActorIds.has(target.ownerActorId)
}

export function shouldTriggerHeavyEnemyCharge(missionId: HeavyFieldMissionId, state: HeavyFieldState, event: CombatEvent,
  enemyActorIds: ReadonlySet<string>): boolean {
  return HEAVY_FIELD_SPECS[missionId].enemyChargeOnAnyDamage && !state.enemyChargeTriggered && isEffectiveHeavyEnemyDamage(event, enemyActorIds)
}

export interface HeavyPoint { x: number; z: number }

/** Closest horizontal approach of two living, deployed forces (their front lines, not their centres). */
export function heavyFrontlineDistance(a: readonly HeavyPoint[], b: readonly HeavyPoint[]): number {
  let best = Infinity
  for (const p of a) for (const q of b) {
    const d = Math.hypot(p.x - q.x, p.z - q.z)
    if (d < best) best = d
  }
  return best
}

export function shouldTriggerHeavyCounterCharge(state: HeavyFieldState, frontlineDistance: number): boolean {
  return !state.counterChargeTriggered && state.formationIssued && frontlineDistance <= HEAVY_COUNTER_CHARGE_METERS
}

/** Soldier: the captain halts and forms up once the column reaches the ambush point. */
export const HEAVY_FORMATION_TRIGGER_METERS = 12
export function shouldIssueHeavyFormation(state: HeavyFieldState, captain: HeavyPoint, ambush: HeavyPoint): boolean {
  return !state.formationIssued && Math.hypot(captain.x - ambush.x, captain.z - ambush.z) <= HEAVY_FORMATION_TRIGGER_METERS
}

// ---------------------------------------------------------------------------
// Veteran defence: scattered caltrops, spear lanes through three archer rows
// ---------------------------------------------------------------------------

export const CALTROP_SEGMENT_LENGTH = 14
export const CALTROP_GAP_WIDTH = 8
export const CALTROP_SEGMENTS = 5
export const CALTROP_THICKNESS = 1.2
/** Narrowest gap a mounted heavy cavalryman can use once the body radius is subtracted. */
export const CALTROP_MIN_GAP_WIDTH = 6
export const CALTROP_BODY_CLEARANCE = 1.2
export const CALTROP_MIN_SLOT_SPACING = 1.2
export const CALTROP_LINE_ABS_Z = 113
const ARCHER_ROW_DEPTHS = [6, 9, 12] as const
const GAP_ROW_DEPTH = 2.5

export interface CaltropRect { minX: number; maxX: number; minDepth: number; maxDepth: number }
export interface CaltropSlot {
  role: 'spear' | 'melee' | 'archer'
  tier: 3 | 4
  /** Local lateral offset and depth behind the caltrop line (depth grows toward our rear). */
  x: number
  depth: number
  group: 'gap' | 'lane' | 'archer-front' | 'melee' | 'archer-rear'
  playerSlot?: boolean
}
export interface CaltropLayout {
  caltrops: CaltropRect[]
  gaps: { centerX: number; minX: number; maxX: number }[]
  slots: CaltropSlot[]
}

/** Deterministic, algorithmic layout. Officers (T4) take the first slot of their role. */
export function planVeteranCaltropDefense(): CaltropLayout {
  const total = CALTROP_SEGMENTS * CALTROP_SEGMENT_LENGTH + (CALTROP_SEGMENTS - 1) * CALTROP_GAP_WIDTH
  let cursor = -total / 2
  const caltrops: CaltropRect[] = [], gaps: CaltropLayout['gaps'] = []
  for (let i = 0; i < CALTROP_SEGMENTS; i++) {
    caltrops.push({ minX: cursor, maxX: cursor + CALTROP_SEGMENT_LENGTH, minDepth: -CALTROP_THICKNESS / 2, maxDepth: CALTROP_THICKNESS / 2 })
    cursor += CALTROP_SEGMENT_LENGTH
    if (i < CALTROP_SEGMENTS - 1) {
      gaps.push({ centerX: cursor + CALTROP_GAP_WIDTH / 2, minX: cursor, maxX: cursor + CALTROP_GAP_WIDTH })
      cursor += CALTROP_GAP_WIDTH
    }
  }
  const slots: CaltropSlot[] = []
  const counts = { spear: 100, melee: 100, archer: 100 }
  const officers = { spear: 2, melee: 2, archer: 2 }
  const push = (role: CaltropSlot['role'], x: number, depth: number, group: CaltropSlot['group']) => {
    if (counts[role] <= 0) return false
    const index = 100 - counts[role]
    counts[role]--
    slots.push({ role, tier: index < officers[role] ? 4 : 3, x: Math.round(x * 100) / 100, depth, group })
    return true
  }
  const laneColumns = [-2.4, 0, 2.4]
  // Gap spearmen first, then the lane continues behind every archer row and on into the reserve.
  const laneDepths = [GAP_ROW_DEPTH, ...ARCHER_ROW_DEPTHS]
  for (let depth = 15; laneDepths.length < 4 + 5; depth += 3) laneDepths.push(depth)
  for (const depth of laneDepths) for (const gap of gaps) for (const offset of laneColumns) {
    push('spear', gap.centerX + offset, depth, depth === GAP_ROW_DEPTH ? 'gap' : 'lane')
  }
  // Front archers: three rows along the caltrop segments, never inside a lane (1.5m margin).
  for (const depth of ARCHER_ROW_DEPTHS) for (const segment of caltrops) {
    for (let k = 0; k < 5; k++) push('archer', (segment.minX + segment.maxX) / 2 + (k - 2) * 2.2, depth, 'archer-front')
  }
  // Melee reserve behind the lane spears, then the remaining archers behind the melee.
  const meleeStart = laneDepths[laneDepths.length - 1] + 4
  let meleeIndex = 0
  while (counts.melee > 0) {
    const perRow = 41, row = Math.floor(meleeIndex / perRow), col = meleeIndex % perRow
    const slot = push('melee', (col - (perRow - 1) / 2) * 2.4, meleeStart + row * 2.6, 'melee')
    if (slot && meleeIndex === officers.melee) slots[slots.length - 1].playerSlot = true
    meleeIndex++
  }
  const rearStart = meleeStart + 3 * 2.6 + 2
  let rearIndex = 0
  while (counts.archer > 0) {
    const perRow = 25, row = Math.floor(rearIndex / perRow), col = rearIndex % perRow
    push('archer', (col - (perRow - 1) / 2) * 2.4, rearStart + row * 2.6, 'archer-rear')
    rearIndex++
  }
  return { caltrops, gaps, slots }
}

export interface CaltropValidation { ok: boolean; problems: string[] }

/** Cheap structural audit: every guarantee the spec lists for the Veteran formation. */
export function validateCaltropLayout(layout: CaltropLayout): CaltropValidation {
  const problems: string[] = []
  for (const gap of layout.gaps) {
    if (gap.maxX - gap.minX < CALTROP_MIN_GAP_WIDTH) problems.push(`gap ${gap.centerX} narrower than ${CALTROP_MIN_GAP_WIDTH}m`)
    const inLane = (slot: CaltropSlot) => slot.x > gap.minX && slot.x < gap.maxX
    for (const depth of [GAP_ROW_DEPTH, ...ARCHER_ROW_DEPTHS]) {
      if (!layout.slots.some(slot => slot.role === 'spear' && inLane(slot) && slot.depth === depth)) problems.push(`gap ${gap.centerX} has no spearman at depth ${depth}`)
    }
  }
  const inAnyLane = (x: number) => layout.gaps.some(gap => x > gap.minX - 1 && x < gap.maxX + 1)
  for (const slot of layout.slots) {
    if (slot.role === 'archer' && slot.group === 'archer-front' && inAnyLane(slot.x)) problems.push(`archer at ${slot.x} blocks a spear lane`)
    for (const rect of layout.caltrops) {
      if (slot.x > rect.minX - CALTROP_BODY_CLEARANCE && slot.x < rect.maxX + CALTROP_BODY_CLEARANCE
        && slot.depth > rect.minDepth - CALTROP_BODY_CLEARANCE && slot.depth < rect.maxDepth + CALTROP_BODY_CLEARANCE) problems.push(`slot ${slot.role}@${slot.x},${slot.depth} overlaps a caltrop`)
    }
  }
  const sorted = [...layout.slots].sort((a, b) => a.depth - b.depth || a.x - b.x)
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].depth - sorted[i].depth < CALTROP_MIN_SLOT_SPACING; j++) {
    if (Math.hypot(sorted[i].x - sorted[j].x, sorted[i].depth - sorted[j].depth) < CALTROP_MIN_SLOT_SPACING) problems.push(`slots overlap at ${sorted[i].x},${sorted[i].depth}`)
  }
  const countOf = (role: CaltropSlot['role']) => layout.slots.filter(slot => slot.role === role).length
  if (countOf('spear') !== 100 || countOf('melee') !== 100 || countOf('archer') !== 100) problems.push('role totals must be 100 / 100 / 100')
  const frontRows = new Set(layout.slots.filter(slot => slot.group === 'archer-front').map(slot => slot.depth))
  if (frontRows.size !== ARCHER_ROW_DEPTHS.length) problems.push('front archers must form exactly three rows')
  return { ok: problems.length === 0, problems }
}

/**
 * Coarse synthetic navigation grid: caltrops inflated by the body clearance block cells,
 * 1m resolution. Returns whether a heavy cavalryman can pass from open ground in front of the
 * line to the rear of the formation, and the narrowest passable corridor width found.
 */
export function caltropRouteExists(layout: CaltropLayout, bodyRadius = CALTROP_BODY_CLEARANCE): { reachable: boolean; minPassableWidth: number } {
  const half = 70, minDepth = -40, maxDepth = 45
  const width = half * 2, height = maxDepth - minDepth
  const blocked = (x: number, depth: number) => layout.caltrops.some(rect => x > rect.minX - bodyRadius && x < rect.maxX + bodyRadius
    && depth > rect.minDepth - bodyRadius && depth < rect.maxDepth + bodyRadius)
  const seen = new Uint8Array(width * height)
  const queue: number[] = []
  const at = (x: number, d: number) => (d - minDepth) * width + (x + half)
  for (let x = -half; x < half; x++) if (!blocked(x + .5, minDepth + .5)) { seen[at(x, minDepth)] = 1; queue.push(at(x, minDepth)) }
  let reachable = false
  while (queue.length) {
    const cell = queue.pop()!
    const cx = cell % width - half, cd = Math.floor(cell / width) + minDepth
    if (cd >= maxDepth - 1) { reachable = true; break }
    for (const [dx, dd] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, nd = cd + dd
      if (nx < -half || nx >= half || nd < minDepth || nd >= maxDepth || seen[at(nx, nd)] || blocked(nx + .5, nd + .5)) continue
      seen[at(nx, nd)] = 1; queue.push(at(nx, nd))
    }
  }
  const passable = layout.gaps.map(gap => Math.max(0, gap.maxX - gap.minX - 2 * bodyRadius))
  return { reachable, minPassableWidth: Math.min(...passable) }
}

/** World-space caltrop footprints for the obstacle list. `faction` selects the friendly side of the field. */
export function veteranCaltropWorldRects(layout: CaltropLayout, faction: CharacterFaction): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const zSign = faction === 'viking' ? 1 : -1, xSign = faction === 'viking' ? -1 : 1
  return layout.caltrops.map(rect => {
    const xs = [rect.minX * xSign, rect.maxX * xSign], zs = [zSign * (CALTROP_LINE_ABS_Z + rect.minDepth), zSign * (CALTROP_LINE_ABS_Z + rect.maxDepth)]
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
  })
}

export function veteranSlotWorldPosition(slot: Pick<CaltropSlot, 'x' | 'depth'>, faction: CharacterFaction): HeavyPoint {
  const zSign = faction === 'viking' ? 1 : -1, xSign = faction === 'viking' ? -1 : 1
  return { x: Math.round(slot.x * xSign * 100) / 100, z: Math.round(zSign * (CALTROP_LINE_ABS_Z + slot.depth) * 100) / 100 }
}

// ---------------------------------------------------------------------------
// Deterministic deployment blocks (all missions)
// ---------------------------------------------------------------------------

/** Friendly stands on -Z for Roman, +Z for Viking; the enemy takes the opposite side. */
export function heavyFriendlyZSign(faction: CharacterFaction): 1 | -1 { return faction === 'viking' ? 1 : -1 }

/** Rows grow toward the rear (|z| increases). Returns `count` positions row by row, centred on `centerX`. */
export function heavyBlockPositions(count: number, options: { columns: number; gapX: number; gapZ: number; frontAbsZ: number; zSign: 1 | -1; centerX?: number }): HeavyPoint[] {
  const out: HeavyPoint[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / options.columns), inRow = Math.min(options.columns, count - row * options.columns), col = i % options.columns
    out.push({ x: Math.round(((options.centerX ?? 0) + (col - (inRow - 1) / 2) * options.gapX) * 100) / 100,
      z: Math.round(options.zSign * (options.frontAbsZ + row * options.gapZ) * 100) / 100 })
  }
  return out
}

/** Soldier: the column starts here, marches to the ambush point, then forms a line at AMBUSH_ABS_Z. */
export const SOLDIER_COLUMN_FRONT_ABS_Z = 150
export const SOLDIER_AMBUSH_ABS_Z = 135
export const HEAVY_ENEMY_FRONT_ABS_Z = 125

/**
 * What an actor must actually be told. `hold` is the ONLY case that may use a Formation target
 * (which forces Defend): a Soldier / Veteran enemy that is still on Attack is `plain`, so it
 * really advances from >200m instead of idling at its spawn.
 */
export interface HeavyCommandPlan { order: TacticalOrder; kind: 'charge' | 'march' | 'hold' | 'plain' }

export function heavyCommandPlan(missionId: HeavyFieldMissionId, side: HeavySide, state: HeavyFieldState): HeavyCommandPlan {
  const order = heavyTacticalOrder(missionId, side, state)
  if (order === 'charge') return { order, kind: 'charge' }
  if (side === 'friendly' && HEAVY_FIELD_SPECS[missionId].startsMarching && !state.formationIssued) return { order, kind: 'march' }
  return { order, kind: order === 'defend' || order === 'formation' ? 'hold' : 'plain' }
}

/** Soldier: our line counts as formed once most actors stand on their slots, or after a hard time limit. */
export const HEAVY_FORMATION_ARRIVAL_METERS = 3
export const HEAVY_FORMATION_READY_FRACTION = .85
export const HEAVY_FORMATION_TIMEOUT_SECONDS = 25
export function isHeavyFormationComplete(distancesToSlots: readonly number[], secondsSinceIssued: number): boolean {
  if (secondsSinceIssued >= HEAVY_FORMATION_TIMEOUT_SECONDS) return true
  return distancesToSlots.length > 0
    && distancesToSlots.filter(d => d <= HEAVY_FORMATION_ARRIVAL_METERS).length / distancesToSlots.length >= HEAVY_FORMATION_READY_FRACTION
}
