import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { AIType } from '../world/NPC'
import { getTerrainHeight, type WalkRampSurface } from '../world/Terrain'
import type { DefenseCampaignLaunchConfig } from './DefenseCampaignLaunch'
import type { OutpostWalkwayLayout, OutpostWalkwaySide } from './CampaignOutpostWalkways'

export const SIEGE_RAMP = {
  halfWidth: 2.5,
  platformLength: 6,
  maxSlope: .25,
  speed: 2,
  approachDistance: 45,
  bridgeLength: 4,
  dockSeconds: 1.5,
} as const

export type SiegeRampId = 'siege-ramp-left' | 'siege-ramp-right'
export interface SiegeRampAssignment {
  id: SiegeRampId
  side: OutpostWalkwaySide
  pusherIds: string[]
  assaultIds: string[]
}
export interface SiegeRampPlacement {
  id: SiegeRampId
  side: OutpostWalkwaySide
  start: THREE.Vector3
  dock: THREE.Vector3
  surface: WalkRampSurface
  deckConnection: THREE.Vector3
  dirZ: number
}

export function isMobileSiegeRampEnabled(config: DefenseCampaignLaunchConfig | undefined): boolean {
  return !!config && !config.careerMissionId && !config.careerMissionKind
    && !config.careerVeteranOutpost && !config.careerPersonalSquad && !config.careerReliefPhase
}

/** Allocates existing identities only. Missing/duplicate identities are invalid input. */
export function allocateSiegeRampCrews(specs: readonly NpcSpawnSpec[]): SiegeRampAssignment[] {
  const ids = new Set<string>()
  for (const spec of specs) {
    if (!spec.actorId || ids.has(spec.actorId)) throw new Error('Siege roster requires unique actor IDs')
    ids.add(spec.actorId)
  }
  const infantry = specs.filter(spec => !spec.cavalry && !spec.loadout?.mountId
    && spec.aiType === AIType.MELEE && spec.tier !== 4)
  return ([-1, 1] as const).slice(0, Math.min(2, Math.floor(infantry.length / 10))).map((side, i) => ({
    id: side < 0 ? 'siege-ramp-left' : 'siege-ramp-right', side,
    pusherIds: infantry.slice(i * 10, i * 10 + 4).map(spec => spec.actorId!),
    assaultIds: infantry.slice(i * 10 + 4, i * 10 + 10).map(spec => spec.actorId!),
  }))
}

/** Flat platform stops outside the wall. A separate bridge reaches the deck centre. */
export function getSiegeRampPlacement(layout: OutpostWalkwayLayout, side: OutpostWalkwaySide): SiegeRampPlacement {
  const deck = layout.decks.find(candidate => candidate.side === side)!
  const x = (deck.slab.min.x + deck.slab.max.x) / 2
  const deckZ = (deck.slab.min.z + deck.slab.max.z) / 2
  const dockZ = deckZ - layout.zSign * SIEGE_RAMP.bridgeLength
  const dockY = deck.topY
  let length = 28
  for (let i = 0; i < 12; i++) {
    const rearZ = dockZ - layout.zSign * (SIEGE_RAMP.platformLength + length)
    // Reserve enough length for the full approach terrain, not just the final pose.
    let ground = Infinity
    for (let d = 0; d <= SIEGE_RAMP.approachDistance; d += 2) {
      ground = Math.min(ground, getTerrainHeight(x, rearZ - layout.zSign * d))
    }
    length = Math.max(length, (dockY - ground + .1) / SIEGE_RAMP.maxSlope)
  }
  const rearZ = dockZ - layout.zSign * (SIEGE_RAMP.platformLength + length)
  const surface: WalkRampSurface = {
    startX: x, startZ: rearZ, dirX: 0, dirZ: layout.zSign,
    halfWidth: SIEGE_RAMP.halfWidth, length, landing: SIEGE_RAMP.platformLength,
    startY: getTerrainHeight(x, rearZ) + .04, topY: dockY,
  }
  const dock = new THREE.Vector3(x, dockY, dockZ)
  const start = dock.clone().add(new THREE.Vector3(0, 0, -layout.zSign * SIEGE_RAMP.approachDistance))
  return {
    id: side < 0 ? 'siege-ramp-left' : 'siege-ramp-right', side, start, dock, surface,
    deckConnection: new THREE.Vector3(x, dockY, deckZ), dirZ: layout.zSign,
  }
}

/** Placement is applied to spawn data before actor construction/registration. */
export function placeSiegeRampCrew(specs: NpcSpawnSpec[], crew: SiegeRampAssignment, placement: SiegeRampPlacement): void {
  const dz = placement.start.z - placement.dock.z
  const byId = new Map(specs.map(spec => [spec.actorId, spec]))
  for (const [index, id] of crew.assaultIds.entries()) {
    const spec = byId.get(id)!
    spec.x = placement.start.x + (index % 2 === 0 ? -1 : 1)
    spec.z = placement.start.z - placement.dirZ * (1 + Math.floor(index / 2) * 1.5)
    spec.spawnY = placement.start.y
    spec.siegeRamp = { id: crew.id, role: 'assault' }
  }
  for (const [index, id] of crew.pusherIds.entries()) {
    const spec = byId.get(id)!
    spec.x = placement.start.x + (index % 2 === 0 ? -1 : 1)
    spec.z = placement.surface.startZ + dz - placement.dirZ * (1.6 + Math.floor(index / 2) * 1.6)
    spec.spawnY = getTerrainHeight(spec.x, spec.z)
    spec.siegeRamp = { id: crew.id, role: 'pusher' }
  }
}
