import { preloadGameplayHumanoids } from '../helpers/preloadGameplayHumanoids'
import * as THREE from 'three'
import { expect, it, vi, onTestFinished, beforeAll, afterAll } from 'vitest'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { careerCommanderLoadout } from '../../src/career/CareerCommanderEquipment'
import { weaponShieldImpact } from '../../src/combat/ShieldBlocking'

// Only rendering assets are replaced. Real NPC targeting, animation clock,
// locomotion, attack selection, ammunition and hit callbacks run below.
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))
vi.mock('../../src/world/HighTierEquipment', async () => ({
  createT5Bow: (await import('../helpers/gameplayWeaponVisual')).createGameplayBowAsset,
}))
let restore: () => void
beforeAll(async () => { restore = await preloadGameplayHumanoids() })
afterAll(() => restore?.())


function fixture(faction: 'roman' | 'viking') {
  const scene = new THREE.Scene(), player = new Player(scene)
  const npc = new NPC(scene, 0, 0, Faction.ENEMY, faction, AIType.RANGED, 'Commander', 4, false,
    careerCommanderLoadout(faction), `${faction}_sword_cavalry`, undefined, 'commander')
  onTestFinished(() => { npc.dispose(); player.dispose() })
  const fire = vi.fn(), hit = vi.fn()
  const place = (distance: number) => player.group.position.set(npc.combatPosition.x, npc.combatPosition.y, npc.combatPosition.z + distance)
  const step = () => {
    player.group.position.y = npc.combatPosition.y - player.bodyBaseOffset
    scene.updateMatrixWorld(true)
    npc.update(1 / 60, player, [npc], [npc], [], { setFill() {} }, hit, fire, true)
  }
  const until = (condition: () => boolean, frames = 600) => {
    for (let frame = 0; frame < frames && !condition(); frame++) step()
    expect(condition(), `phase=${npc.currentState}, action=${npc.combatAnimationAction}, ammo=${npc.combatAmmo}, target=${player.position.toArray()}, position=${npc.position.toArray()}`).toBe(true)
  }
  return { npc, player, place, step, until, fire, hit }
}

it.each(['roman', 'viking'] as const)('%s Commander fires, cancels a draw for melee, pursues and hits, then returns to bow', faction => {
  const h = fixture(faction)
  h.place(18)
  h.until(() => h.fire.mock.calls.length > 0)
  expect(h.fire.mock.calls[0][2]).toBe('arrow')
  h.until(() => h.npc.combatAnimationAction === 'bowAim')
  const ammo = h.npc.combatAmmo, fired = h.fire.mock.calls.length
  h.place(5)
  const start = h.npc.position.clone()
  h.step()
  expect(h.npc.hasActiveRangedWeapon).toBe(false)
  expect(h.npc.combatAmmo).toBe(ammo)
  expect(h.npc.meleeWeaponId).toBe(faction === 'roman' ? 'paladin_sword_t4' : 'paladin_mace_t4')
  h.until(() => h.hit.mock.calls.length > 0)
  expect(h.npc.position.distanceTo(start)).toBeGreaterThan(.1)
  expect(h.fire).toHaveBeenCalledTimes(fired)
  h.place(8)
  for (let frame = 0; frame < 120; frame++) { h.place(8); h.step(); expect(h.npc.hasActiveRangedWeapon).toBe(false) }
  h.place(18)
  h.until(() => h.npc.hasActiveRangedWeapon)
  h.until(() => h.fire.mock.calls.length > fired)
  expect(h.npc.loadout).toEqual(careerCommanderLoadout(faction))
  expect(weaponShieldImpact(h.npc.meleeWeaponId!)).toBe(faction === 'roman' ? 1 : 12)
})

it.each(['roman', 'viking'] as const)('%s Commander with no ammunition chases and attacks instead of retrying empty shots', faction => {
  const h = fixture(faction)
  h.npc.restoreCombatAmmo(0)
  h.npc.setTacticalOrder('charge')
  h.place(12)
  const start = h.npc.position.clone()
  h.until(() => h.hit.mock.calls.length > 0)
  expect(h.npc.hasActiveRangedWeapon).toBe(false)
  expect(h.npc.combatAmmo).toBe(0)
  expect(h.npc.position.distanceTo(start)).toBeGreaterThan(1)
  expect(h.fire).not.toHaveBeenCalled()
})

it('uses a nearby second hostile to prevent return to bow and keeps Commander state independent', () => {
  const h = fixture('roman'), scene = new THREE.Scene()
  const second = new NPC(scene, 0, 0, Faction.ENEMY, 'viking', AIType.RANGED, 'Other Commander', 4, false, careerCommanderLoadout('viking'))
  const hostile = new NPC(scene, 0, 5, Faction.PLAYER, 'viking', AIType.MELEE, 'Threat', 1, false)
  onTestFinished(() => { second.dispose(); hostile.dispose() })
  h.place(5); h.npc.setTacticalOrder('charge'); h.step()
  h.npc.setMissionCombatTarget(h.player)
  h.place(18)
  hostile.group.position.copy(h.npc.combatPosition).add(new THREE.Vector3(0, 0, 5))
  h.npc.update(1 / 60, h.player, [hostile], [hostile], [], { setFill() {} }, h.hit, h.fire, true)
  expect(h.npc.hasActiveRangedWeapon).toBe(false)
  expect(second.hasActiveRangedWeapon).toBe(true)
  expect(second.combatAmmo).toBe(30)
})
