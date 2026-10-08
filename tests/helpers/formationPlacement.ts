import * as THREE from 'three'
import { vi } from 'vitest'
import { Faction, type NPC } from '../../src/world/NPC'
import { FormationController, type FormationRegion } from '../../src/battle/FormationController'
import type { ArmyCommandTarget } from '../../src/battle/CommandTarget'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'

/** Placement-only participant fields; no actor AI, HP, movement or mount lifecycle. */
export interface PlacementParticipantFixture {
  name: string
  faction: Faction
  presetId: string
  dead: boolean
  isMounted: boolean
  combatPosition: THREE.Vector3
  assignFormationTarget: ReturnType<typeof vi.fn<NPC['assignFormationTarget']>>
}

export function createFormationPlacementHarness(obstacles: Array<{ box: THREE.Box3; isBarricade: boolean }>, participants: PlacementParticipantFixture[], navigation: NavigationWorld | null = null, region: FormationRegion | null = null) {
  const formation = new FormationController(
    new THREE.Scene(), new THREE.PerspectiveCamera(), participants as unknown as NPC[], new THREE.Object3D(), obstacles, navigation, region,
  )
  // Private solver seam invokes the actual controller with placement-only records.
  const solver = formation as unknown as {
    resolvePlacement(center: THREE.Vector3, forward: THREE.Vector3, participants: readonly PlacementParticipantFixture[], target: ArmyCommandTarget): { center: THREE.Vector3; slots: THREE.Vector3[] } | null
  }
  const solve = (center: THREE.Vector3, target: ArmyCommandTarget = 'viking_spearman') =>
    solver.resolvePlacement(center, new THREE.Vector3(0, 0, 1), participants, target) as
      | { center: THREE.Vector3; slots: THREE.Vector3[] }
      | null
  return { formation, solve }
}

export function placementParticipant(name: string, x: number, mounted = false): PlacementParticipantFixture {
  return { name, faction: Faction.PLAYER, presetId: 'viking_spearman', dead: false,
    isMounted: mounted, combatPosition: new THREE.Vector3(x, 0, 0), assignFormationTarget: vi.fn<NPC['assignFormationTarget']>() }
}

export function blockingBox(minX: number, maxX: number, minZ: number, maxZ: number) {
  return { box: new THREE.Box3(new THREE.Vector3(minX, -10, minZ), new THREE.Vector3(maxX, 10, maxZ)), isBarricade: false }
}
