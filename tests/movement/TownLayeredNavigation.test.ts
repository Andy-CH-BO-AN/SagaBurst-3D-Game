import * as THREE from 'three'
import { expect, it } from 'vitest'
import { AvailableBreachEntrances, type BreachEntrance } from '../../src/navigation/AvailableBreachEntrances'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { getTownRampartLayout, townRampartHeight, type TownRampartLayout } from '../../src/town/TownRamparts'
import {
  getTerrainHeight
} from '../../src/world/Terrain'

it('releases a descended Town actor to ground travel instead of recapturing the ramp entrance', () => {
  const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout)
  const ramp = layout.ramps.find(r => r.gateId === 'north')!, s = ramp.surface
  const goal = ramp.entrance.clone().add(new THREE.Vector3(0, 0, 12))
  goal.y = getTerrainHeight(goal.x, goal.z)
  const current = new THREE.Vector3(s.startX + s.dirX * 3,
    s.startY + (s.topY - s.startY) * 3 / s.length, s.startZ + s.dirZ * 3)
  const out = new THREE.Vector3()
  // The actual slope retains its dedicated descent, not a sideways ground exit.
  expect(nav.resolveMoveTarget(current, goal, out)).toEqual({ ground: false })
  expect(out).toEqual(ramp.entrance)
  current.copy(ramp.entrance)
  // Follow the real adapter's returned target in bounded mathematical steps.
  // Previously every few steps re-selected the entrance, keeping the actor
  // within 0.3m indefinitely even without a single dynamic blocker.
  for (let i = 0; i < 20; i++) {
    const step = nav.resolveMoveTarget(current, goal, out)
    if (!step) out.copy(goal)
    const direction = out.clone().sub(current).setY(0)
    const distance = direction.length()
    current.addScaledVector(direction.normalize(), Math.min(.2, distance))
    current.y = getTerrainHeight(current.x, current.z)
  }
  expect(current.z).toBeCloseTo(ramp.entrance.z + 4)
  expect(nav.resolveMoveTarget(current, goal, out)).toBeNull()
  // Re-entering the ramp still uses its existing aligned ground approach.
  expect(nav.resolveMoveTarget(current, ramp.landing, out)).toEqual({ ground: true })
  expect(out).toEqual(ramp.entrance)
})

it('walks real X-directed siege entrance in order and manages vehicle revocation/rerouting', () => {
    const nav = new TownLayeredNavigation(emptyTownLayout), entry = eastRamp('town-siege-ramp:east:left', 62), out = new THREE.Vector3(), goal = new THREE.Vector3(140, 10, 62)
    nav.siegeActive = true; nav.siegeEntrances.set(entry)
    expect(nav.resolveMoveTarget(new THREE.Vector3(184.2, 0, 62), goal, out, entry.id)).toEqual({ ground: false })
    expect(out.x).toBe(181); expect(out.y).toBeCloseTo(10 / 24); expect(out.z).toBe(62)
    expect(nav.resolveMoveTarget(new THREE.Vector3(158, 10, 62), goal, out, entry.id)).toEqual({ ground: false })
    expect(out.x).toBeCloseTo(152.3); expect(out.z).toBe(62)
    nav.resolveMoveTarget(new THREE.Vector3(152.2, 10, 62), goal, out, entry.id)
    expect(out.toArray()).toEqual([148, 10, 62])
    nav.siegeEntrances.remove(entry.id)
    const outside = new THREE.Vector3(180, 0, 62)
    expect(nav.resolveMoveTarget(outside, goal, out, entry.id)).toEqual({ ground: true, blocked: true })
    expect(out).toEqual(outside)
    // Revoking one vehicle retains reachable alternative and rejects unreachable reroutes
    const entries = new AvailableBreachEntrances(), left = eastRamp('town-siege-ramp:east:left', 62), right = eastRamp('town-siege-ramp:east:right', 25)
    entries.set(left); entries.set(right)
    const start = new THREE.Vector3(190, 0, 62)
    expect(entries.select(start, false, 'roman', () => true, left.id)?.id).toBe(left.id)
    entries.remove(left.id)
    expect(entries.select(start, false, 'roman', () => true, left.id)?.id).toBe(right.id)
    expect(entries.select(start, false, 'roman', () => false, left.id)).toBeNull()
    expect(entries.entries.has(right.id)).toBe(true)
  })

it('沿已接牆坡道由城牆下降至城外，地面追擊不被原攻門入口拉回', () => {
    const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout, () => true)
    const entry = eastRamp('town-siege-ramp:east:left', 62), out = new THREE.Vector3()
    // The synthetic carrier meets the real ring's mathematical support height.
    const top = townRampartHeight(layout, entry.exit.x, entry.exit.z)!
    entry.exit.y = top; entry.position.y = top
    entry.surface!.topY = top; entry.bridgeSurface!.startY = top; entry.bridgeSurface!.topY = top
    nav.siegeActive = true; nav.siegeEntrances.set(entry)
    const goal = new THREE.Vector3(210, 0, 62)
    expect(nav.resolveMoveTarget(entry.exit, goal, out, entry.id, true, 'east')).toEqual({ ground: false })
    expect(out).toEqual(entry.position)
    expect(nav.resolveMoveTarget(entry.position, goal, out, entry.id, true, 'east')).toEqual({ ground: false })
    expect(out).toEqual(entry.approach)
    const middle = new THREE.Vector3(170, top / 2, 62)
    nav.resolveMoveTarget(middle, goal, out, entry.id, true, 'east')
    expect(out).toEqual(entry.approach)
    expect(nav.resolveMoveTarget(entry.approach, goal, out, entry.id, true, 'east')).toBeNull()
  })

it('下降只選仍然可走、允許騎乘且寬度足夠的接牆入口，入口失效後回到合法城內坡道', () => {
    const layout = getTownRampartLayout(), nav = new TownLayeredNavigation(layout, () => true)
    const entry = eastRamp('town-siege-ramp:east:left', 62), out = new THREE.Vector3()
    const top = townRampartHeight(layout, entry.exit.x, entry.exit.z)!
    entry.exit.y = top; entry.position.y = top
    entry.surface!.topY = top; entry.bridgeSurface!.startY = top; entry.bridgeSurface!.topY = top
    const current = entry.exit.clone(), goal = new THREE.Vector3(210, 0, 62)
    nav.siegeActive = true
    // MOVING has not published an entrance; the native stairs remain authoritative.
    nav.resolveMoveTarget(current, goal, out, entry.id, true, 'east')
    expect(out.equals(entry.position)).toBe(false)
    nav.siegeEntrances.set(entry)
    entry.mounted = false
    nav.resolveMoveTarget(current, goal, out, entry.id, true, 'east')
    expect(out.equals(entry.position)).toBe(false)
    nav.resolveMoveTarget(current, goal, out, entry.id, false, 'east')
    expect(out).toEqual(entry.position)
    entry.mounted = true; entry.surface!.halfWidth = 1
    nav.resolveMoveTarget(current, goal, out, entry.id, true, 'east')
    expect(out.equals(entry.position)).toBe(false)
    entry.surface!.halfWidth = 2.5
    nav.resolveMoveTarget(current, goal, out, entry.id, true, 'east')
    expect(out).toEqual(entry.position)
    nav.siegeEntrances.remove(entry.id)
    nav.resolveMoveTarget(current, goal, out, entry.id, true, 'east')
    expect(out.equals(entry.position)).toBe(false)
  })

it('fans mixed attackers through a wide destroyed gate after both ramps disappear without reversing at the approach', () => {
    const nav = new TownLayeredNavigation(emptyTownLayout, () => true)
    nav.siegeActive = true
    const left = eastRamp('town-siege-ramp:east:left', 62), right = eastRamp('town-siege-ramp:east:right', 25)
    nav.siegeEntrances.set(left); nav.siegeEntrances.set(right)
    // Destruction removes both walk surfaces. The destroyed gate is the sole route.
    nav.siegeEntrances.remove(left.id); nav.siegeEntrances.remove(right.id)
    const gate: BreachEntrance = { id: 'town-siege-gate:east', gateId: 'east', type: 'gate',
      position: new THREE.Vector3(150, 0, 45), approach: new THREE.Vector3(155, 0, 45), exit: new THREE.Vector3(145, 0, 45),
      portal: { halfWidth: 7, halfDepth: 1.2 }, walkable: true, mounted: true, faction: null, connectionId: 'east' }
    nav.siegeEntrances.set(gate)
    const goal = new THREE.Vector3(130, 0, 90), lanes = [new Set<number>(), new Set<number>()]
    for (let i = 0; i < 16; i++) {
      const mounted = i >= 8, radius = mounted ? 1.25 : .6, id = `battle:east:${mounted ? 'lancer' : 'crew'}:${i}`
      const out = new THREE.Vector3(), start = new THREE.Vector3(164, 0, 45)
      const entry = nav.siegeEntrances.select(start, mounted, 'viking', () => true, left.id, e => e.gateId === 'east')!
      expect(entry.id).toBe(gate.id)
      nav.resolveMoveTarget(start, goal, out, entry.id, mounted, 'east', id)
      expect(out.x).toBe(155)
      expect(Math.abs(out.z - 45) + radius).toBeLessThanOrEqual(6.65 + 1e-9)
      lanes[Number(mounted)].add(out.z)
      const lane = out.z
      // ID-based routing remains identical after reload, independent of roster order.
      nav.resolveMoveTarget(start, goal, out, entry.id, mounted, 'east', id)
      expect(out.z).toBe(lane)
      for (const x of [155, 153.5, 151, 150, 149, ...(mounted ? [148] : [])]) {
        const current = new THREE.Vector3(x, 0, lane)
        expect(nav.resolveMoveTarget(current, goal, out, entry.id, mounted, 'east', id)).toEqual({ ground: true })
        expect(out.x).toBe(145); expect(out.x).toBeLessThan(current.x); expect(out.z).toBe(lane)
        expect(nav.hasClearedSiegeGate(current, entry.id, mounted)).toBe(false)
      }
      // Still straddling the 2.4m physical jamb at the old wall-slab threshold.
      expect(nav.hasClearedSiegeGate(new THREE.Vector3(mounted ? 147.7 : 148.4, 0, lane), entry.id, mounted)).toBe(false)
      const inside = new THREE.Vector3(147, 0, lane)
      expect(nav.hasClearedSiegeGate(inside, entry.id, mounted)).toBe(true)
      expect(nav.resolveMoveTarget(inside, goal, out, null, mounted, 'east', id)).toBeNull()
    }
    // Once ownership is released, an unrelated interior pursuit must not select
    // the portal again merely because its lateral distance is outside the opening.
    expect(nav.resolveMoveTarget(new THREE.Vector3(130, 0, 90), new THREE.Vector3(120, 0, 80),
      new THREE.Vector3(), null, true, 'east', 'released-rider')).toBeNull()
    const legacyInside = new THREE.Vector3(130, 0, 90)
    expect(nav.hasClearedSiegeGate(legacyInside, gate.id, true)).toBe(true)
    expect(nav.resolveMoveTarget(legacyInside, goal, new THREE.Vector3(), gate.id, true, 'east', 'legacy-rider')).toBeNull()
    expect(lanes[0].size).toBeGreaterThanOrEqual(4)
    expect(lanes[1].size).toBeGreaterThanOrEqual(3)
  })

it('admits an unassigned follower only through a proven reachable entrance in its allowed sector', () => {
    let reachable = false
    const nav = new TownLayeredNavigation(emptyTownLayout, () => reachable), entry = eastRamp('town-siege-ramp:east:left', 62)
    nav.siegeActive = true; nav.siegeEntrances.set(entry)
    const current = new THREE.Vector3(184.2, 0, 62), goal = new THREE.Vector3(140, 10, 62), out = new THREE.Vector3()
    nav.resolveMoveTarget(current, goal, out, null, false, 'east'); expect(out).toEqual(current)
    reachable = true
    nav.resolveMoveTarget(current, goal, out, null, false, 'north'); expect(out).toEqual(current)
    nav.resolveMoveTarget(current, goal, out, null, false, 'east'); expect(out.x).toBe(181)
    expect(out.z).toBe(62)
  })

const emptyTownLayout: TownRampartLayout = { decks: [], ramps: [], corners: [], lengths: [], perimeter: 1, wallSpans: [] }
function eastRamp(id: string, z: number): BreachEntrance {
  const surface = { startX: 182, startZ: z, startY: 0, topY: 10, dirX: -1, dirZ: 0, length: 24, landing: 6, halfWidth: 2.5 }
  return { id, gateId: 'east', type: 'siege-ramp', position: new THREE.Vector3(152, 10, z), approach: new THREE.Vector3(184.2, 0, z),
    exit: new THREE.Vector3(148, 10, z), surface, bridgeSurface: { ...surface, startX: 152, startY: 10, length: 4, landing: 0 },
    faction: null, walkable: true, mounted: true, connectionId: id }
}
