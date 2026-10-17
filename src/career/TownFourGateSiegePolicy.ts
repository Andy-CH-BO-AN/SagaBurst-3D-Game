import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { AIType, Faction } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { getTerrainHeight, getWalkRampHeight, type ObstacleData, type WalkRampSurface } from '../world/Terrain'
import { SIEGE_RAMP, type SiegeRampAssignment, type SiegeRampPlacement, type TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import { TOWN_CITY, TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townRampartHeight, TOWN_RAMPART, type TownRampartLayout } from '../town/TownRamparts'
import type { TownDockSite } from '../town/TownDockPassages'

export const TOWN_SIEGE_DOCK_INWARD = TOWN_RAMPART.inward - TOWN_RAMPART.width / 2 + .9

export interface TownSiegeRampAssignment extends SiegeRampAssignment<TownSiegeRampId> { gateId: TownGateId }
export interface TownSiegeRampPlacement extends SiegeRampPlacement<TownSiegeRampId> { gateId: TownGateId; passage: TownDockSite; clearance: THREE.Box3 }
export interface TownSiegeCrewSlot { gateId: TownGateId; side: -1 | 1; role: 'pusher' | 'assault'; spec: NpcSpawnSpec }
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

function placementAt(layout: TownRampartLayout, gateId: TownGateId, side: -1 | 1, lateral: number): TownSiegeRampPlacement | null {
  const { gate, inward } = townSiegeFrame(gateId)
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
  // Forty metres of real pushing before the dock; the run/crew also fit inside bounds.
  const start = dock.clone().addScaledVector(inward, -40)
  const startRear = rear.clone().addScaledVector(inward, -40)
  start.y = getTerrainHeight(startRear.x, startRear.z) + .04 + y - surface.startY
  const clearance = new THREE.Box3().setFromPoints([startRear.clone().addScaledVector(inward, -5.5), dock])
    .expandByVector(new THREE.Vector3(Math.abs(inward.z) * 3.1, 0, Math.abs(inward.x) * 3.1))
  clearance.min.y = -Infinity; clearance.max.y = Infinity
  if (Math.max(Math.abs(clearance.min.x), Math.abs(clearance.max.x), Math.abs(clearance.min.z), Math.abs(clearance.max.z)) > TOWN_PLAYABLE_WORLD_BOUND - 2) return null
  // Validate the entire bridge width against the authored crown, not a gate-centre offset.
  const tangent = townSiegeFrame(gateId).tangent
  for (const offset of [-2.5, 0, 2.5]) {
    const sample = deckConnection.clone().addScaledVector(tangent, offset)
    const height = townRampartHeight(layout, sample.x, sample.z)
    if (height === null || Math.abs(height - y) > .2) return null
  }
  // Rigid terrain following must retain the original maximum slope over its complete sweep.
  for (let travel = 0; travel <= 40; travel += 1) {
    const r = startRear.clone().addScaledVector(inward, travel)
    const top = getTerrainHeight(r.x, r.z) + .04 + y - surface.startY
    if (Math.abs(top - (getTerrainHeight(r.x, r.z) + .04)) / length > SIEGE_RAMP.maxSlope + 1e-6) return null
  }
  const id = townSiegeRampId(gateId, side)
  return { id, gateId, side, start, dock, surface, deckConnection, dirX: inward.x, dirZ: inward.z, clearance,
    passage: { rampId: id, gateId, point: new THREE.Vector3(center.x, y, center.z), halfWidth: SIEGE_RAMP.halfWidth + .35 } }
}

/** All-or-nothing deterministic search over actual wall surfaces and the built Town's obstacles. */
export function planTownSiegeRamps(layout: TownRampartLayout, obstacles: readonly ObstacleData[],
  isPassageRail: (obstacle: ObstacleData) => boolean = () => false): TownSiegeRampPlacement[] {
  const plan: TownSiegeRampPlacement[] = []
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
      const p = placementAt(layout, gate.id, side, lateral)
      if (!p || plan.some(other => other.clearance.intersectsBox(p.clearance))) continue
      if (obstacles.some(o => !o.walkSurface && !isPassageRail(o) && o.box.intersectsBox(p.clearance))) continue
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
