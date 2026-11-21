import { Vector3 } from 'three'
import { expect, it } from 'vitest'
import { getOutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { PursuitBlockList } from '../../src/navigation/PursuitBlockList'

interface Quarry { combatPosition: Vector3 }

function outpostWorld(): NavigationWorld {
  const world = new NavigationWorld({ minX: -24, maxX: 24, minZ: -24, maxZ: 32 })
  world.setOutpostWalkways(getOutpostWalkwayLayout({ centerX: 0, halfWidth: 44, frontZ: 0, backZ: 72, gateWidth: 8, stakeLineZ: -7 }))
  return world
}

function sideGap(world: NavigationWorld): void {
  world.outpostNav!.entrances.set({ id: 'side-gap', type: 'palisade', position: new Vector3(44, 0, 12),
    approach: new Vector3(47, 0, 12), exit: new Vector3(41, 0, 12), mounted: true, walkable: true, faction: null, connectionId: 'side-gap' })
}

it('不可達目標在原地形、入口與雙方位置不變時保持封鎖，任何一項改變即釋放，且無導航世界時不下判斷', () => {
  const world = outpostWorld(), from = new Vector3(0, 0, -4), list = new PursuitBlockList<Quarry>()
  const quarry: Quarry = { combatPosition: new Vector3(0, 0, 12) }
  const other: Quarry = { combatPosition: new Vector3(0, 0, 12) }
  const defer = () => list.defer(quarry, from, world)
  defer()
  expect(list.size).toBe(1)
  expect(list.allows(quarry, from, world)).toBe(false)
  expect(list.allows(other, from, world)).toBe(true)
  // Within 4 m of where the quarry stood and 8 m of where the pursuer stood the verdict still holds.
  quarry.combatPosition.set(4, 0, 12)
  expect(list.allows(quarry, new Vector3(0, 0, -4 + 8), world)).toBe(false)
  expect(list.allows(quarry, from, null)).toBe(true)
  expect(list.size).toBe(1)

  const lapses: Array<[string, () => boolean]> = [
    ['quarry moved', () => { quarry.combatPosition.set(4.1, 0, 12); return list.allows(quarry, from, world) }],
    ['pursuer moved', () => list.allows(quarry, new Vector3(0, 0, -4 + 8.1), world)],
    ['navigation topology rebuilt', () => { world.rebuild([]); return list.allows(quarry, from, world) }],
    ['outpost entrance opened', () => { sideGap(world); return list.allows(quarry, from, world) }],
  ]
  for (const [reason, lapse] of lapses) {
    quarry.combatPosition.set(0, 0, 12)
    defer()
    expect(list.allows(quarry, from, world), reason).toBe(false)
    expect(lapse(), reason).toBe(true)
    expect(list.size, reason).toBe(0)
  }
  defer()
  list.clear()
  expect(list.size).toBe(0)
  expect(list.allows(quarry, from, world)).toBe(true)
})
