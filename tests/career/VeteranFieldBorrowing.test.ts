import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../helpers/veteranFieldFixture'
import { buildVeteranResidents } from '../helpers/veteranFieldActors'
import { Faction } from '../../src/world/NPC'
import { createVeteranRoster } from '../../src/career/VeteranMission'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../../src/town/TownBounds'

vi.mock('../../src/career/MissionGuide', () => ({ MissionGuide: class {
  update(): void {}
  hide(): void {}
  dispose(): void {}
} }))

const fixtures: VeteranFieldFixture[] = []
afterEach(() => {
  fixtures.splice(0).reverse().forEach(fixture => fixture.dispose())
  vi.restoreAllMocks()
})
function field(options: VeteranFieldFixtureOptions) {
  const fixture = createVeteranFieldFixture(options)
  fixtures.push(fixture)
  return fixture
}

describe('VeteranFieldBorrowing', () => {
  it.each([
    ['veteran-scout-hunters', 100, 40, 22, 77, 40],
    ['veteran-village-intercept', 50, 100, 49, 0, 100],
    ['veteran-spear-line-hunt', 50, 100, 48, 1, 100],
    ['veteran-tragedy-of-the-scouts', 20, 100, 2, 17, 100],
  ] as const)('stages the exact Veteran roster for %s', (id, friendlyTotal, enemyTotal, borrowedCount, temporaryFriendlyCount, tempEnemyCount) => {
    const scout = id === 'veteran-scout-hunters'
    const setup = field({ templateId: id, autoStart: scout })
    if (scout) expect(setup.start).toBe(true)
    else {
      // These callers differ in borrowed/support identities, not in the scheduler's frame algorithm.
      const borrowed = setup.residents.map(({ npc }) => ({ npc, position: npc.combatPosition.clone() }))
      borrowed.forEach(({ npc }) => { npc.hp = 41 })
      expect(setup.controller.startActiveMission()).toBe(true)
      expect(setup.controller.startActiveMission()).toBe(true)
      expect(setup.npcFactories).toHaveLength(0)
      expect(setup.controller.ready).toBe(false)
      const queued = setup.controller.spawnBatches.flatMap(batch => [...batch.actors.keys()])
      expect(queued).toEqual([
        ...setup.roster.friendly.filter(unit => unit.source !== 'town').map(unit => unit.actorId),
        ...setup.roster.enemy.map(unit => unit.actorId),
      ])
      setup.controller.updateFlow(600, 0)
      expect(setup.controller.ready).toBe(false)
      expect(setup.controller.evaluate(true)).toBeNull()
      setup.spawnDriver.drain()
      expect(setup.controller.ready).toBe(true)
      borrowed.forEach(({ npc, position }) => {
        expect(setup.actors).toContain(npc)
        expect(npc.hp).toBe(41)
        if (id === 'veteran-tragedy-of-the-scouts') {
          expect(npc.combatPosition.z).toBeGreaterThan(TOWN_PLAYABLE_WORLD_BOUND - 60)
        } else {
          expect(npc.combatPosition.x).toBe(position.x)
          expect(npc.combatPosition.z).toBe(position.z)
        }
      })
    }
    expect(setup.actors).toHaveLength(friendlyTotal - 1)
    expect(setup.enemies).toHaveLength(enemyTotal)
    expect(setup.roster.friendly.filter(unit => unit.source === 'town')).toHaveLength(borrowedCount)
    expect(setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)).toHaveLength(temporaryFriendlyCount)
    expect(setup.npcFactories.filter(({ spec }) => spec.faction === Faction.ENEMY)).toHaveLength(tempEnemyCount)
    expect(setup.enemies.every(npc => npc.faction === Faction.ENEMY && npc.characterFaction === 'viking')).toBe(true)
    expect(setup.actors.filter(npc => npc.tier === 4)).toHaveLength(setup.roster.friendly.filter(unit => unit.tier === 4).length)
    expect(setup.actors.filter(npc => npc.tier === 3)).toHaveLength(setup.roster.friendly.filter(unit => unit.tier === 3).length)
    for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
      const actor = setup.actors.find(npc => npc.combatantId === unit.actorId)!
      expect(actor).toBe(setup.residents.find(resident => resident.npc === actor)?.npc)
      expect(actor.temporaryTier).toBe(unit.tier)
      expect(actor.temporarySquad).toBe(unit.squadId)
    }
    if (id === 'veteran-tragedy-of-the-scouts') expect(setup.enemies.every(npc => npc.tacticalOrder === 'charge')).toBe(true)
    setup.controller.cleanupMission()
    for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
      const actor = setup.residents.find(resident => resident.npc.combatantId === unit.actorId)!.npc
      expect(actor.tier).toBe(2)
      expect(actor.squadId).toBeUndefined()
      expect(actor.temporaryTier).toBeUndefined()
      expect(actor.disposed).toBe(false)
      expect(actor.restoreCombatLoadout).toHaveBeenCalledTimes(1)
    }
    expect(setup.npcFactories.every(({ npc }) => npc.disposed)).toBe(true)
    expect(setup.mountFactories.every(mount => mount.disposed)).toBe(true)
  })

  it('disposes a temporary substitute mount when a borrowed rider has no home mount', () => {
    const roster = createVeteranRoster('veteran-scout-hunters', 'roman', 'borrowed-mount')
    const residents = buildVeteranResidents(roster)
    const captain = residents.find(resident => resident.npc.combatantId === 'captain')!
    captain.homeMount?.dispose()
    captain.homeMount = undefined
    captain.npc.dismountFromMount()
    const setup = field({ templateId: 'veteran-scout-hunters', residents, ownResidents: true })
    expect(setup.start).toBe(true)
    const substitute = setup.mountFactories[0]
    expect(captain.npc.mount).not.toBeNull()
    setup.controller.cleanupMission()
    expect(substitute.disposed).toBe(true)
    expect(captain.npc.mount).toBeNull()
  })
})
