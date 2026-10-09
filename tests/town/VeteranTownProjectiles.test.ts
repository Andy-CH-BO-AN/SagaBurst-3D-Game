import { createTownCombatFixture } from '../helpers/townCombatFixture'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { Player } from '../../src/player/Player'
import { Faction, NPC } from '../../src/world/NPC'

function actor(id: string, faction: Faction, x = 0) {
  const npc = Object.create(NPC.prototype)
  Object.assign(npc, { combatantId: id, faction, group: new THREE.Group(), mount: null })
  Object.defineProperties(npc, { dead: { value: false }, hostileToPlayer: { value: faction === Faction.ENEMY } })
  npc.group.position.set(x, 39, 0)
  return npc as NPC
}
function shotFixture(enemyShot: boolean, onlyBystander = false, externalDefense = false) {
  const ally = actor('borrowed-ranger', Faction.TOWN)
  const enemy = actor('mission-ranger', Faction.ENEMY)
  const bystander = actor('town-resident', Faction.TOWN)
  const source = enemyShot ? enemy : externalDefense ? bystander : ally
  const missionTarget = enemyShot ? ally : enemy
  const target = enemyShot && externalDefense ? bystander : missionTarget
  if (enemyShot && externalDefense) ally.group.position.x = 100
  const arrow = {
    isAlive: true, damage: 25, mesh: { position: new THREE.Vector3(-2, 40, 0) },
    update: vi.fn(() => arrow.mesh.position.set(2, 40, 0)),
    destroy: vi.fn(() => { arrow.isAlive = false }),
  }
  const player = Object.create(Player.prototype)
  player.group = new THREE.Group(); player.group.position.set(100, 100, 100)
  Object.defineProperties(player, { dead: { value: false }, position: { value: new THREE.Vector3(100, 100, 100) } })
  const town = createTownCombatFixture() as any
  Object.assign(town, {
    shots: [{ arrow, training: false, player: false, source, age: 0 }],
    player,
    world: { buildings: [], targets: [], obstacles: [] },
    mission: { friendlies: [ally], missionBandits: [enemy], ambientBandits: [], combatPeersFor: () => onlyBystander ? [] : [missionTarget] },
    missionCombat: { enemyTownHostiles: [], externalDefenders: externalDefense ? [bystander] : [],
      isExternalThreatDefender: (npc: NPC) => externalDefense && npc === bystander },
    defense: { active: false }, residents: [{ npc: bystander }],
    hitFieldNpc: vi.fn(), damagePlayerFromNpc: vi.fn(), hitResident: vi.fn(),
  })
  town.updateShots(.05)
  return { town, arrow, target, source }
}

describe('Veteran field projectile routing', () => {
  it.each([true, false])('routes mission enemy and training defender arrows without roaming actors, enemyShot=%s', enemyShot => {
    const { town, arrow, target, source } = shotFixture(enemyShot, false, true)
    expect(town.hitFieldNpc).toHaveBeenCalledExactlyOnceWith(target, 25, 'projectile', source, expect.objectContaining({ kind: 'body' }))
    expect(arrow.destroy).toHaveBeenCalledOnce()
    expect(town.hitResident).not.toHaveBeenCalled()
  })
  it.each([true, false])('routes opposing-faction field arrows enemyShot=%s to mission peers', enemyShot => {
    const { town, arrow, target, source } = shotFixture(enemyShot)
    expect(town.hitFieldNpc).toHaveBeenCalledExactlyOnceWith(target, 25, 'projectile', source, expect.objectContaining({ kind: 'body' }))
    expect(arrow.destroy).toHaveBeenCalledOnce()
    expect(town.hitResident).not.toHaveBeenCalled()
  })
  it('does not target a nearby nonmission Town resident', () => {
    const { town } = shotFixture(true, true)
    expect(town.hitFieldNpc).not.toHaveBeenCalled()
    expect(town.hitResident).not.toHaveBeenCalled()
  })
})


describe('Town projectile flight budgets and first-contact cleanup', () => {
  it.each(['npc-eagle', 'player-eagle', 'player-ground'] as const)('%s formal fire path keeps only authorized long arrows after five seconds', source => {
    const { town } = shotFixture(false, true)
    town.shots.forEach((shot: { arrow: { destroy(): void } }) => shot.arrow.destroy())
    town.shots = []; town.scene = new THREE.Scene(); town.mounts = []; town.cat = undefined; town.defense.playerEnemies = []
    town.isProtectedTownAlly = () => false
    Object.defineProperty(town.player, 'isMounted', { value: source === 'player-eagle' })
    town.player.currentMount = source === 'player-eagle' ? { isFlyingMount: true } : null
    const budget = source === 'npc-eagle' ? { maxLifetimeSeconds: 9, maxTravelDistance: 1500 } : undefined
    town.fire(new THREE.Vector3(0, 100, -100), new THREE.Vector3(.8, .6, 0), 65, 25,
      source !== 'npc-eagle', false, 'arrow', source === 'npc-eagle' ? actor('eagle-source', Faction.TOWN) : undefined, budget)
    const shot = town.shots[0]
    if (source !== 'player-eagle') expect(shot.maxLifetimeSeconds).toBe(source === 'player-ground' ? 5 : 9)
    if (source === 'player-eagle') expect(shot.maxLifetimeSeconds).toBeGreaterThan(5)
    for (let frame = 0; frame < 306; frame++) town.updateShots(1 / 60)
    expect(shot.arrow.isAlive).toBe(source !== 'player-ground')
    town.clearMissionCombatShots(); expect(shot.arrow.isAlive).toBe(false); expect(town.shots).toHaveLength(0)
  })
  it('does not apply contacts after the actual projectile expires during its update', () => {
    const { town, arrow, target } = shotFixture(false, true)
    town.mission.combatPeersFor = () => [target]
    arrow.mesh.position.set(-2, 40, 0)
    arrow.update.mockImplementation(() => { arrow.isAlive = false; return arrow.mesh.position.set(2, 40, 0) })
    town.updateShots(.05)
    expect(town.hitFieldNpc).not.toHaveBeenCalled(); expect(town.shots).toHaveLength(0)
  })
  it('terrain before a body on the same swept segment stops the arrow without damage', () => {
    const { town, arrow, target } = shotFixture(false, true)
    town.mission.combatPeersFor = () => [target]
    target.group.position.set(0, -100, 0)
    arrow.mesh.position.set(-2, 40, 0)
    arrow.update.mockImplementation(() => arrow.mesh.position.set(0, -99, 0))
    town.updateShots(.05)
    expect(town.hitFieldNpc).not.toHaveBeenCalled(); expect(arrow.destroy).toHaveBeenCalledOnce()
  })
})
