import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { AIType, Faction } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { SIEGE_RAMP, siegeRampDeckHeightAt, siegeRampRearHeightAt, type SiegeRampAssignment, type SiegeRampPlacement, type TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import { TOWN_CITY, TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townRampartHeight, TOWN_RAMPART, type TownRampartLayout } from '../town/TownRamparts'
import type { TownDockSite } from '../town/TownDockPassages'

export const TOWN_SIEGE_DOCK_INWARD = TOWN_RAMPART.inward - TOWN_RAMPART.width / 2 + .9
export type TownSiegeApproach = 'near-wall' | 'world-edge'
/** Optional mounted escort envelope behind the complete vehicle, including body radius. */
export interface TownSiegeEscortClearance {
  rear: number
  halfWidth: number
  /** Mounted escorts leave their rear-relative slots on entering this gate radius. */
  releaseDistance?: number
  bodyRadius?: number
  /** Signed offset along the vehicle's inward-facing tangent, matching escort slots. */
  lateralOffset?: number
}

export interface TownSiegeRampAssignment extends SiegeRampAssignment<TownSiegeRampId> { gateId: TownGateId }
export interface TownSiegeRampPlacement extends SiegeRampPlacement<TownSiegeRampId> {
  gateId: TownGateId
  passage: TownDockSite
  clearance: THREE.Box3
  /** Ground escort sweep ends before the wall; it is not a wider vehicle/platform. */
  escortClearance?: THREE.Box3
}
export interface TownSiegeCrewSlot { gateId: TownGateId; side: -1 | 1; role: 'pusher' | 'assault'; spec: NpcSpawnSpec }

/** Historical receipts record orders already delivered, not the actor's current mounted equipment/role. */
export function townSiegeSectorReceiptsMatch(
  sector: { gateId: TownGateId; wallActorIds: readonly string[]; cavalryActorIds: readonly string[] } | undefined,
  saved: { gateId: TownGateId; releasedWallActorIds: readonly string[]; releasedCavalryActorIds: readonly string[] },
  historicalRoles = false,
): boolean {
  if (!sector) return saved.releasedWallActorIds.length === 0 && saved.releasedCavalryActorIds.length === 0
  return sector.gateId === saved.gateId
    && saved.releasedWallActorIds.every(id => sector.wallActorIds.includes(id) || historicalRoles && sector.cavalryActorIds.includes(id))
    && saved.releasedCavalryActorIds.every(id => sector.cavalryActorIds.includes(id) || historicalRoles && sector.wallActorIds.includes(id))
}

export const townSiegeRampId = (gateId: TownGateId, side: -1 | 1): TownSiegeRampId => `town-siege-ramp:${gateId}:${side < 0 ? 'left' : 'right'}`
export function townSiegeFrame(gateId: TownGateId) {
  const gate = TOWN_GATES.find(g => g.id === gateId)!
  // Cardinal snapping avoids floating-point drift at ramp/bridge seam boundaries.
  const outward = new THREE.Vector3(Math.round(Math.sin(gate.yaw)), 0, Math.round(Math.cos(gate.yaw)))
  return { gate, outward, inward: outward.clone().negate(), tangent: new THREE.Vector3(outward.z, 0, -outward.x) }
}

/** A PR8 caller may provide its own identities; no roster slot is inferred from array order. */
export function allocateTownSiegeCrews(slots: readonly TownSiegeCrewSlot[]): TownSiegeRampAssignment[] {
  if (slots.length !== 80) throw new Error('Four-gate siege requires exactly eighty crew')
  const ids = new Set<string>()
  for (const { gateId, side, role, spec } of slots) {
    if (!TOWN_GATES.some(g => g.id === gateId) || ![-1, 1].includes(side) || !['pusher', 'assault'].includes(role)
      || !spec.actorId || ids.has(spec.actorId) || spec.cavalry || spec.loadout?.mountId || spec.aiType !== AIType.MELEE || spec.tier !== 4) throw new Error('Invalid Town siege crew')
    ids.add(spec.actorId)
  }
  return TOWN_GATES.flatMap(gate => ([-1, 1] as const).map(side => {
    const crew = slots.filter(slot => slot.gateId === gate.id && slot.side === side)
    const pushers = crew.filter(slot => slot.role === 'pusher'), assault = crew.filter(slot => slot.role === 'assault')
    const t5 = (spec: NpcSpawnSpec) => spec.visualAssetId === `${spec.characterFaction}-hero-t5`
      && spec.combatProfileId === `${spec.characterFaction}-commander`
    const t4 = (spec: NpcSpawnSpec) => spec.visualAssetId === `${spec.characterFaction}-hero-t4`
      && spec.combatProfileId === (spec.characterFaction === 'roman' ? 'praetorian' : 'varangian')
    if (pushers.length !== 4 || assault.length !== 6 || !pushers.every(s => t4(s.spec))
      || assault.filter(s => t5(s.spec)).length !== 1 || assault.filter(s => t4(s.spec)).length !== 5
      || new Set(crew.map(s => s.spec.characterFaction)).size !== 1) throw new Error('Invalid Town T4/T5 crew allocation')
    return { id: townSiegeRampId(gate.id, side), gateId: gate.id, side,
      pusherIds: pushers.map(s => s.spec.actorId!), assaultIds: assault.map(s => s.spec.actorId!) }
  }))
}

/** Preview/default mission plan: T5 is an existing hero profile, never UnitTier=5. */
export function createTownSiegeCrewSlots(faction: CharacterFaction): TownSiegeCrewSlot[] {
  const presetId = faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  const profile = T4_UNIT_PROFILES[presetId]
  return TOWN_GATES.flatMap(gate => ([-1, 1] as const).flatMap(side => Array.from({ length: 10 }, (_, slot) => {
    const t5 = slot === 9, visualAssetId = t5 ? `${faction}-hero-t5` as const : profile.visualAssetId
    const loadout = { ...resolveT4UnitLoadout(presetId), mountId: null, rangedWeaponId: null,
      ...(t5 ? { meleeWeaponId: faction === 'roman' ? 'sword_t5' : 'axe_t5' } : {}) }
    return { gateId: gate.id, side, role: slot < 4 ? 'pusher' as const : 'assault' as const, spec: {
      actorId: `${townSiegeRampId(gate.id, side)}:crew:${slot}`, x: 0, z: 0, faction: Faction.ENEMY,
      characterFaction: faction, aiType: AIType.MELEE, name: `${gate.id} ${side < 0 ? 'left' : 'right'} ${t5 ? 'T5' : 'T4'}`,
      tier: 4 as const, cavalry: false, respawnEnabled: false, presetId, loadout, visualAssetId,
      combatProfileId: HERO_COMBAT_PROFILE_BY_ASSET[visualAssetId],
    } }
  })))
}

function placementAt(layout: TownRampartLayout, gateId: TownGateId, side: -1 | 1, lateral: number,
  approach: TownSiegeApproach, escortClearance?: TownSiegeEscortClearance): TownSiegeRampPlacement | null {
  const { gate, inward } = townSiegeFrame(gateId)
  // Only the opt-in edge convoy reserves escort space. PR7/legacy approaches keep
  // their exact start and clearance geometry, including saved forty-metre journeys.
  const rearClearance = approach === 'world-edge' ? Math.max(5.5, escortClearance?.rear ?? 0) : 5.5
  const center = townGatePoint(gate, lateral, TOWN_RAMPART.inward), y = townRampartHeight(layout, center.x, center.z)
  if (y === null) return null
  // Bridge ends inside the real outer deck edge, beyond its 1.36m safety rail.
  const exit = townGatePoint(gate, lateral, TOWN_SIEGE_DOCK_INWARD)
  const deckConnection = new THREE.Vector3(exit.x, y, exit.z)
  const dock = deckConnection.clone().addScaledVector(inward, -SIEGE_RAMP.bridgeLength)
  let length = 24
  for (let i = 0; i < 40; i++) {
    const x = dock.x - inward.x * (SIEGE_RAMP.platformLength + length), z = dock.z - inward.z * (SIEGE_RAMP.platformLength + length)
    length = Math.max(length, (y - getTerrainHeight(x, z) + .04) / SIEGE_RAMP.maxSlope)
  }
  const rear = dock.clone().addScaledVector(inward, -SIEGE_RAMP.platformLength - length)
  const surface: WalkRampSurface = { startX: rear.x, startZ: rear.z, dirX: inward.x, dirZ: inward.z,
    startY: getTerrainHeight(rear.x, rear.z) + .04, topY: y, length, halfWidth: SIEGE_RAMP.halfWidth, landing: SIEGE_RAMP.platformLength }
  const id = townSiegeRampId(gateId, side)
  const p: TownSiegeRampPlacement = { id, gateId, side, start: dock.clone(), dock, surface, deckConnection,
    dirX: inward.x, dirZ: inward.z, clearance: new THREE.Box3(),
    passage: { rampId: id, gateId, point: new THREE.Vector3(center.x, y, center.z), halfWidth: SIEGE_RAMP.halfWidth + .35 } }
  if (approach === 'world-edge') {
    p.terrainAnchor = 'deck'
    // The complete vehicle, four ground pushers and any requested mounted escort
    // fit inside the real border with two metres beyond the reserved footprint.
    // Journey length is independent of this finite articulated ramp's length.
    let legal = false
    for (length = 24; length <= 40; length += 2) {
      surface.length = length
      surface.startX = dock.x - inward.x * (SIEGE_RAMP.platformLength + length)
      surface.startZ = dock.z - inward.z * (SIEGE_RAMP.platformLength + length)
      surface.startY = siegeRampRearHeightAt(p, surface.startX, surface.startZ)
      const frontBound = TOWN_PLAYABLE_WORLD_BOUND - Math.max(8, rearClearance + 2) - SIEGE_RAMP.platformLength - length
      p.start.copy(dock)
      if (inward.x) p.start.x = -inward.x * frontBound
      else p.start.z = -inward.z * frontBound
      p.start.y = siegeRampDeckHeightAt(p, p.start.x, p.start.z)
      const travel = Math.hypot(p.start.x - dock.x, p.start.z - dock.z)
      legal = true
      for (let step = 0; step <= Math.ceil(travel); step++) {
        const distance = Math.min(step, travel), x = p.start.x + inward.x * distance, z = p.start.z + inward.z * distance
        const rx = x - inward.x * (length + SIEGE_RAMP.platformLength), rz = z - inward.z * (length + SIEGE_RAMP.platformLength)
        const low = siegeRampRearHeightAt(p, rx, rz), high = siegeRampDeckHeightAt(p, x, z)
        // Small headroom covers terrain between the one-metre sweep samples.
        if (high <= low || (high - low) / length > SIEGE_RAMP.maxSlope - .01) { legal = false; break }
        for (let along = 1; along < length; along += 1) {
          const rampY = low + (high - low) * along / length
          if (rampY < siegeRampRearHeightAt(p, rx + inward.x * along, rz + inward.z * along) - .05) { legal = false; break }
        }
        if (!legal) break
      }
      if (legal) break
    }
    if (!legal) return null
  } else {
    // The original PR7/Campaign approach is unchanged unless explicitly opted in.
    p.start.addScaledVector(inward, -40)
    p.start.y = siegeRampDeckHeightAt(p, p.start.x, p.start.z)
  }
  const startRear = new THREE.Vector3(surface.startX + p.start.x - dock.x, 0, surface.startZ + p.start.z - dock.z)
  const clearance = new THREE.Box3().setFromPoints([startRear.clone().addScaledVector(inward, -5.5), dock])
    .expandByVector(new THREE.Vector3(Math.abs(inward.z) * 3.1, 0, Math.abs(inward.x) * 3.1))
  clearance.min.y = -Infinity; clearance.max.y = Infinity
  if (Math.max(Math.abs(clearance.min.x), Math.abs(clearance.max.x), Math.abs(clearance.min.z), Math.abs(clearance.max.z)) > TOWN_PLAYABLE_WORLD_BOUND - 2) return null
  if (approach === 'world-edge' && escortClearance) {
    // Ground escorts never occupy the slope or its wall connection. Reserve their
    // own swept footprint, rather than widening the vehicle through the crown.
    const end = new THREE.Vector3(surface.startX, 0, surface.startZ)
    const lateralOffset = escortClearance.lateralOffset ?? 0
    if (escortClearance.releaseDistance !== undefined) {
      const radius = escortClearance.bodyRadius ?? 0
      // townGatePoint uses the outward-facing tangent; rear slots face inward.
      const outerRiderLateral = Math.abs(lateral - lateralOffset) + escortClearance.halfWidth - radius
      if (outerRiderLateral < escortClearance.releaseDistance) {
        // Even if the nearer column died, the outermost surviving rider releases
        // at this circle intersection. Include its complete forward body radius.
        const stopBeforeGate = Math.sqrt(escortClearance.releaseDistance ** 2 - outerRiderLateral ** 2) - radius
        const current = (end.x - gate.x) * inward.x + (end.z - gate.z) * inward.z
        end.addScaledVector(inward, Math.min(0, -stopBeforeGate - current))
      }
    }
    p.escortClearance = new THREE.Box3().setFromPoints([startRear.clone().addScaledVector(inward, -rearClearance), end])
      .expandByVector(new THREE.Vector3(Math.abs(inward.z) * escortClearance.halfWidth, 0,
        Math.abs(inward.x) * escortClearance.halfWidth))
      .translate(new THREE.Vector3(inward.z * lateralOffset, 0, -inward.x * lateralOffset))
    p.escortClearance.min.y = -Infinity; p.escortClearance.max.y = Infinity
    if (Math.max(Math.abs(p.escortClearance.min.x), Math.abs(p.escortClearance.max.x),
      Math.abs(p.escortClearance.min.z), Math.abs(p.escortClearance.max.z)) > TOWN_PLAYABLE_WORLD_BOUND - 2) return null
  }
  // Validate the entire bridge width against the authored crown, not a gate-centre offset.
  const tangent = townSiegeFrame(gateId).tangent
  for (const offset of [-2.5, 0, 2.5]) {
    const sample = deckConnection.clone().addScaledVector(tangent, offset)
    const height = townRampartHeight(layout, sample.x, sample.z)
    if (height === null || Math.abs(height - y) > .2) return null
  }
  if (approach === 'near-wall' && Math.abs(y - surface.startY) / length > SIEGE_RAMP.maxSlope + 1e-6) return null
  p.clearance.copy(clearance)
  return p
}

/** All-or-nothing deterministic search over actual wall surfaces and the built Town's obstacles. */
export function planTownSiegeRamps(layout: TownRampartLayout, obstacles: readonly ObstacleData[],
  isPassageRail: (obstacle: ObstacleData) => boolean = () => false,
  approach: TownSiegeApproach = 'near-wall', escortClearance?: TownSiegeEscortClearance): TownSiegeRampPlacement[] {
  const plan: TownSiegeRampPlacement[] = []
  const clearances = (placement: TownSiegeRampPlacement) => placement.escortClearance
    ? [placement.clearance, placement.escortClearance] : [placement.clearance]
  for (const gate of TOWN_GATES) for (const side of [-1, 1] as const) {
    const frame = townSiegeFrame(gate.id)
    const candidates = layout.decks.filter(d => d.gateId === gate.id && d.id.startsWith(`${gate.id}:`))
      .flatMap(d => [0, .25, .5, .75, 1].map(t => {
        const s = d.surface, x = s.startX + s.dirX * s.length * t, z = s.startZ + s.dirZ * s.length * t
        return (x - gate.x) * frame.tangent.x + (z - gate.z) * frame.tangent.z
      })).filter(lateral => lateral * side >= TOWN_CITY.gateWidth / 2 + 10 && lateral * side <= 65)
      .sort((a, b) => Math.abs(a) - Math.abs(b))
    let chosen: TownSiegeRampPlacement | undefined
    for (const lateral of candidates) {
      if (layout.ramps.some(r => r.gateId === gate.id && Math.abs((r.connection.x - gate.x) * frame.tangent.x
        + (r.connection.z - gate.z) * frame.tangent.z - lateral) < 8)) continue
      const p = placementAt(layout, gate.id, side, lateral, approach, escortClearance)
      if (!p || plan.some(other => clearances(other).some(a => clearances(p).some(b => a.intersectsBox(b))))) continue
      if (obstacles.some(o => !o.walkSurface && !isPassageRail(o) && clearances(p).some(box => o.box.intersectsBox(box)))) continue
      const bridgeBox = new THREE.Box3().setFromPoints([p.dock, p.deckConnection])
        .expandByVector(new THREE.Vector3(Math.abs(frame.inward.z) * 2.5, 0, Math.abs(frame.inward.x) * 2.5))
      bridgeBox.min.y += .02; bridgeBox.max.y += 2.3
      if (obstacles.some(o => !o.walkSurface && !isPassageRail(o) && o.box.intersectsBox(bridgeBox))) continue
      chosen = p; break
    }
    if (!chosen) throw new Error(`No legal siege ramp placement: ${townSiegeRampId(gate.id, side)}`)
    plan.push(chosen)
  }
  return plan
}

/** Physical walk-surface contact is checked at Dock before publishing a topology edge. */
export function isTownSiegeDockConnected(layout: TownRampartLayout, bridge: WalkRampSurface, connection: THREE.Vector3): boolean {
  const endX = bridge.startX + bridge.dirX * bridge.length, endZ = bridge.startZ + bridge.dirZ * bridge.length
  if (Math.hypot(endX - connection.x, endZ - connection.z) > .02 || Math.abs(bridge.topY - connection.y) > .02) return false
  for (const side of [-bridge.halfWidth, 0, bridge.halfWidth]) {
    const x = endX + bridge.dirZ * side, z = endZ - bridge.dirX * side
    const deck = townRampartHeight(layout, x, z), top = getWalkRampHeight(bridge, x, z)
    if (deck === null || top === null || Math.abs(deck - top) > .2) return false
  }
  return true
}
