import * as THREE from 'three'
import { type CareerRank } from './CareerProfile'

export const TOWN_DEFENSE_TEMPLATE_ID = 'recruit-town-defense-01'
export const SOLDIER_TOWN_DEFENSE_TEMPLATE_ID = 'soldier-town-defense-01'
export const VETERAN_TOWN_DEFENSE_TEMPLATE_ID = 'veteran-town-defense-01'
export const TOWN_DEFENSE_CIVILIAN_LIMIT = 10
export const TOWN_DEFENSE_PREPARATION_SECONDS = 20

export type TownDefensePhase = 'PREPARING' | 'ATTACKING' | 'VICTORY_LOCKED' | 'FAILURE_LOCKED' | 'RESULT' | 'RESET'

export interface TownDefenseAnchor {
  x: number
  z: number
  facingX: number
  facingZ: number
}

export const TOWN_DEFENSE_LAYOUT = {
  civilianShelter: { x: 0, z: -3, facingX: 0, facingZ: 1 },
  playerRallyPoint: { x: 0, z: 51, facingX: 0, facingZ: 1 },
} as const satisfies Record<string, TownDefenseAnchor>

export function civilianShelterSlots(count = 20): THREE.Vector3[] {
  const center = TOWN_DEFENSE_LAYOUT.civilianShelter
  const rows = Math.ceil(count / 5)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 5)
    const column = index % 5 - (Math.min(5, count - row * 5) - 1) / 2
    return new THREE.Vector3(center.x + column * 2, 0, center.z + (row - (rows - 1) / 2) * 2)
  })
}

export function townDefenseEnemyCount(_templateId = VETERAN_TOWN_DEFENSE_TEMPLATE_ID, _rank: CareerRank = 'veteran'): number { return 120 }

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
