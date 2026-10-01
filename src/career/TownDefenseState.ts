import * as THREE from 'three'
import type { TownActorSpec, TownRole } from '../town/TownRules'
import { CAREER_RANKS, type CareerRank } from './CareerProfile'

export const TOWN_DEFENSE_TEMPLATE_ID = 'recruit-town-defense-01'
export const SOLDIER_TOWN_DEFENSE_TEMPLATE_ID = 'soldier-town-defense-01'
export const TOWN_DEFENSE_CIVILIAN_LIMIT = 10
export const TOWN_DEFENSE_PREPARATION_SECONDS = 20

export type TownDefensePhase = 'PREPARING' | 'ATTACKING' | 'VICTORY_LOCKED' | 'FAILURE_LOCKED' | 'RESULT' | 'RESET'
export type TownDefenseGroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type TownDefenseOrder = 'ATTACK' | 'DEFEND' | 'SKIRMISH' | 'CHARGE'

export interface TownDefenseAnchor {
  x: number
  z: number
  facingX: number
  facingZ: number
}

export const TOWN_DEFENSE_LAYOUT = {
  southApproach: { x: 0, z: 145, facingX: 0, facingZ: -1 },
  westStableApproach: { x: -145, z: 20, facingX: 1, facingZ: 0 },
  eastBarracksApproach: { x: 145, z: 45, facingX: -1, facingZ: 0 },
  cavalryReserve: { x: -27, z: 30, facingX: 0, facingZ: 1 },
  horseArcherLine: { x: 27, z: 22, facingX: 1, facingZ: 0 },
  rangerFlank: { x: -20, z: 5, facingX: -1, facingZ: 0 },
  townCenter: { x: 0, z: 0, facingX: 0, facingZ: 1 },
  civilianShelter: { x: 0, z: -3, facingX: 0, facingZ: 1 },
  playerRallyPoint: { x: 0, z: 51, facingX: 0, facingZ: 1 },
} as const satisfies Record<string, TownDefenseAnchor>

export interface TownDefenseGroupPlan {
  id: TownDefenseGroupId
  actorIds: string[]
  role: 'melee-ring' | 'ranged-ring' | 'reserve' | 'outer-screen'
  initialOrder: TownDefenseOrder
  mounted: boolean
}

const takeRole = (roster: readonly TownActorSpec[], role: TownRole): string[] => (
  roster.filter(actor => actor.role === role).sort((a, b) => a.index - b.index).map(actor => actor.id)
)

export function createTownDefenseGroups(roster: readonly TownActorSpec[]): TownDefenseGroupPlan[] {
  const melee = takeRole(roster, 'melee_infantry')
  const spearmen = takeRole(roster, 'spearman_infantry')
  const ranged = takeRole(roster, 'ranged_infantry')
  const cavalry = [...takeRole(roster, 'melee_cavalry'), ...takeRole(roster, 'lancer_cavalry')]
  const horseArchers = takeRole(roster, 'ranged_cavalry')
  return [
    { id: 'A', actorIds: melee, role: 'melee-ring', initialOrder: 'DEFEND', mounted: false },
    { id: 'B', actorIds: spearmen, role: 'melee-ring', initialOrder: 'DEFEND', mounted: false },
    { id: 'C', actorIds: ranged.slice(0, 10), role: 'ranged-ring', initialOrder: 'DEFEND', mounted: false },
    { id: 'D', actorIds: ranged.slice(10, 20), role: 'ranged-ring', initialOrder: 'DEFEND', mounted: false },
    { id: 'E', actorIds: cavalry, role: 'reserve', initialOrder: 'DEFEND', mounted: true },
    { id: 'F', actorIds: horseArchers, role: 'outer-screen', initialOrder: 'DEFEND', mounted: true },
  ]
}

/** Front and flank arcs leave the town-facing rear open behind the civilians. */
export function horseshoeDefenseSlots(count: number, radii: readonly number[]): THREE.Vector3[] {
  const center = TOWN_DEFENSE_LAYOUT.civilianShelter
  const rows = radii.map((radius, row) => ({ radius, count: Math.floor(count / radii.length) + (row < count % radii.length ? 1 : 0) }))
  const used = rows.map(() => 0)
  return Array.from({ length: count }, (_, index) => {
    const row = index % radii.length
    const ordinal = used[row]++
    const angle = rows[row].count === 1 ? 0 : -Math.PI / 2 + ordinal * Math.PI / (rows[row].count - 1)
    return new THREE.Vector3(center.x + Math.sin(angle) * rows[row].radius, 0, center.z + 4 + Math.cos(angle) * rows[row].radius)
  })
}

export function formationSlots(anchor: TownDefenseAnchor, count: number, mounted = false, columns = mounted ? 2 : 5): THREE.Vector3[] {
  const spacing = mounted ? 4.2 : 2.2
  const forward = new THREE.Vector3(anchor.facingX, 0, anchor.facingZ).normalize()
  const right = new THREE.Vector3(forward.z, 0, -forward.x)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns - (Math.min(columns, count - row * columns) - 1) / 2
    return new THREE.Vector3(anchor.x, 0, anchor.z)
      .addScaledVector(right, column * spacing)
      .addScaledVector(forward, -row * spacing)
  })
}

export function civilianShelterSlots(count = 20): THREE.Vector3[] {
  const center = TOWN_DEFENSE_LAYOUT.civilianShelter
  const rows = Math.ceil(count / 5)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 5)
    const column = index % 5 - (Math.min(5, count - row * 5) - 1) / 2
    return new THREE.Vector3(center.x + column * 2, 0, center.z + (row - (rows - 1) / 2) * 2)
  })
}

export type EnemyCavalryKind = 'melee' | 'lancer' | 'horse-archer'
export interface TownDefenseAttackGroup { id: 'south' | 'west' | 'east'; approach: keyof typeof TOWN_DEFENSE_LAYOUT; composition: Record<EnemyCavalryKind, number> }

export const TOWN_DEFENSE_ATTACK_GROUPS: readonly TownDefenseAttackGroup[] = [
  { id: 'south', approach: 'southApproach', composition: { melee: 11, lancer: 6, 'horse-archer': 4 } },
  { id: 'west', approach: 'westStableApproach', composition: { melee: 10, lancer: 4, 'horse-archer': 7 } },
  { id: 'east', approach: 'eastBarracksApproach', composition: { melee: 7, lancer: 11, 'horse-archer': 10 } },
]

const RECRUIT_TOWN_DEFENSE_ATTACK_GROUPS: readonly TownDefenseAttackGroup[] = [
  { id: 'south', approach: 'southApproach', composition: { melee: 8, lancer: 4, 'horse-archer': 3 } },
  { id: 'west', approach: 'westStableApproach', composition: { melee: 7, lancer: 3, 'horse-archer': 5 } },
  { id: 'east', approach: 'eastBarracksApproach', composition: { melee: 5, lancer: 8, 'horse-archer': 7 } },
]

export function townDefenseEnemyCount(templateId = TOWN_DEFENSE_TEMPLATE_ID, rank: CareerRank = 'soldier'): number {
  if (templateId === TOWN_DEFENSE_TEMPLATE_ID) return 50
  if (templateId === SOLDIER_TOWN_DEFENSE_TEMPLATE_ID) return Math.round(50 * 1.1 ** Math.max(1, CAREER_RANKS.indexOf(rank)))
  throw new Error('Unknown Town Defense mission: ' + templateId)
}

/** The accepted roster fixes difficulty; reload must not derive it from a new rank. */
export function townDefenseAttackGroups(enemyCount = 70): readonly TownDefenseAttackGroup[] {
  if (enemyCount === 50) return RECRUIT_TOWN_DEFENSE_ATTACK_GROUPS
  if (enemyCount === 70) return TOWN_DEFENSE_ATTACK_GROUPS // Preserve already accepted legacy rosters.
  const apportion = (count: number, weights: number[]): number[] => {
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const exact = weights.map(weight => count * weight / total)
    const result = exact.map(Math.floor)
    const order = exact.map((value, index) => ({ index, fraction: value - result[index] })).sort((a, b) => b.fraction - a.fraction)
    const remainder = count - result.reduce((sum, value) => sum + value, 0)
    for (let index = 0; index < remainder; index++) result[order[index].index]++
    return result
  }
  const laneCounts = apportion(enemyCount, [15, 15, 20])
  return RECRUIT_TOWN_DEFENSE_ATTACK_GROUPS.map((group, index) => {
    const [melee, lancer, archers] = apportion(laneCounts[index], Object.values(group.composition))
    return { ...group, composition: { melee, lancer, 'horse-archer': archers } }
  })
}

export function townDefenseEnemyTotals(enemyCount = 70): Record<EnemyCavalryKind, number> {
  return townDefenseAttackGroups(enemyCount).reduce((total, group) => {
    total.melee += group.composition.melee
    total.lancer += group.composition.lancer
    total['horse-archer'] += group.composition['horse-archer']
    return total
  }, { melee: 0, lancer: 0, 'horse-archer': 0 })
}

export function resolveTownDefenseOutcome(playerDead: boolean, civilianDeaths: number, registrationComplete: boolean, enemiesRemaining: number, combatDefendersAlive: number = 0): 'victory' | 'failure' | null {
  if (registrationComplete && enemiesRemaining === 0) {
    return civilianDeaths <= TOWN_DEFENSE_CIVILIAN_LIMIT ? 'victory' : 'failure'
  }
  if (playerDead && combatDefendersAlive === 0 && enemiesRemaining > 0) return 'failure'
  return null
}

export function townDefenseFailureLocked(civilianDeaths: number): boolean {
  return civilianDeaths > TOWN_DEFENSE_CIVILIAN_LIMIT
}
