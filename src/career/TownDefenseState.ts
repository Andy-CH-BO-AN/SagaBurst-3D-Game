import * as THREE from 'three'
import type { TownActorSpec, TownRole } from '../town/TownRules'

export const TOWN_DEFENSE_TEMPLATE_ID = 'recruit-town-defense-01'
export const TOWN_DEFENSE_CIVILIAN_LIMIT = 10
export const TOWN_DEFENSE_PREPARATION_SECONDS = 45

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
  cavalryReserve: { x: 25, z: -4, facingX: 0, facingZ: 1 },
  rangerFlank: { x: -28, z: -28, facingX: -1, facingZ: 0 },
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

/** Interleave members across the rows so each ring has room to fight and move. */
export function concentricDefenseSlots(count: number, radii: readonly number[], phase = 0): THREE.Vector3[] {
  const center = TOWN_DEFENSE_LAYOUT.civilianShelter
  const rows = radii.map((radius, row) => ({ radius, count: Math.floor(count / radii.length) + (row < count % radii.length ? 1 : 0) }))
  const used = rows.map(() => 0)
  return Array.from({ length: count }, (_, index) => {
    const row = index % radii.length
    const ordinal = used[row]++
    const angle = phase + (ordinal + row * .25) * Math.PI * 2 / rows[row].count
    return new THREE.Vector3(center.x + Math.sin(angle) * rows[row].radius, 0, center.z + Math.cos(angle) * rows[row].radius)
  })
}

export function formationSlots(anchor: TownDefenseAnchor, count: number, mounted = false): THREE.Vector3[] {
  const columns = mounted ? 2 : 5
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
  return Array.from({ length: count }, (_, index) => {
    const group = Math.floor(index / 5)
    const within = index % 5
    const groupAngle = group * Math.PI / 2 + Math.PI / 4
    const angle = groupAngle + (within - 2) * .14
    const radius = 4.5 + within % 2 * 1.2
    return new THREE.Vector3(center.x + Math.sin(angle) * radius, 0, center.z + Math.cos(angle) * radius)
  })
}

export type EnemyCavalryKind = 'melee' | 'lancer' | 'horse-archer'
export interface TownDefenseAttackGroup { id: 'south' | 'west' | 'east'; approach: keyof typeof TOWN_DEFENSE_LAYOUT; composition: Record<EnemyCavalryKind, number> }

export const TOWN_DEFENSE_ATTACK_GROUPS: readonly TownDefenseAttackGroup[] = [
  { id: 'south', approach: 'southApproach', composition: { melee: 11, lancer: 6, 'horse-archer': 4 } },
  { id: 'west', approach: 'westStableApproach', composition: { melee: 10, lancer: 4, 'horse-archer': 7 } },
  { id: 'east', approach: 'eastBarracksApproach', composition: { melee: 7, lancer: 11, 'horse-archer': 10 } },
]

export function townDefenseEnemyTotals(): Record<EnemyCavalryKind, number> {
  return TOWN_DEFENSE_ATTACK_GROUPS.reduce((total, group) => {
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
