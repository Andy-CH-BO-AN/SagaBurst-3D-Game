import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVeteranFieldFixture, type VeteranFieldFixture, type VeteranFieldFixtureOptions } from '../../tests/helpers/veteranFieldFixture'
import { FieldTestNpc } from '../../tests/helpers/veteranFieldActors'
import { Faction, type NPC } from '../world/NPC'
import { SpatialGrid } from '../world/SpatialGrid'
import type { Player } from '../player/Player'

vi.mock('./MissionGuide', () => ({ MissionGuide: class {
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

describe('VeteranFieldEncounter', () => {
  it('persists a held enemy squad activation only after effective damage reaches a Veteran target', () => {
    const setup = field({ templateId: 'veteran-spear-line-hunt' })
    expect(setup.start).toBe(true)
    const enemy = setup.roster.enemy.find(unit => unit.squadId === 3)!
    const damage = (appliedDamage: number, targetId = enemy.actorId) => setup.controller.events.emit({
      type: 'damage_applied',
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId, targetType: 'npc', name: 'Veteran target', allegiance: Faction.ENEMY, characterFaction: 'viking', squadId: enemy.squadId as NPC['squadId'] },
      method: 'projectile', requestedDamage: 20, appliedDamage,
    })
    damage(0)
    expect(setup.profile().activeMission?.engagedEnemySquadIds ?? []).toEqual([])
    damage(12, 'unrelated-enemy')
    expect(setup.profile().activeMission?.engagedEnemySquadIds ?? []).toEqual([])

    damage(12)

    expect(setup.profile().activeMission?.engagedEnemySquadIds).toContain(enemy.squadId)
    expect(setup.profile().activeMission?.actorPositions).toBeDefined()
  })

  it('resumes the same mounted squads after incidental combat without adding ambient enemies to the objective', () => {
    const setup = field({ templateId: 'veteran-village-intercept' })
    setup.assemble()
    const leader = setup.leader!
    const destination = leader.formationTarget!.position.clone()
    const objectiveIds = [...setup.profile().activeMission!.targetActorIds]
    const borrowedIds = [...setup.profile().activeMission!.borrowedActorIds!]
    const roaming = setup.trackActor(new FieldTestNpc('ambient-raider', 'Raider', Faction.BANDIT))
    roaming.group.position.copy(leader.combatPosition)
    const source = roaming as unknown as NPC
    const threats = { owns: (actor: NPC) => actor === source }
    const grid = new SpatialGrid<NPC>()
    grid.insert(source)
    expect(setup.controller.noteTravelHit(leader as unknown as NPC, source, threats)).toBe(true)
    expect(setup.controller.travelEncounter.active).toBe(true)
    expect(setup.controller.phase).toBe('MARCHING')
    expect(setup.controller.isMissionTarget(source)).toBe(false)
    roaming.takeDamage(100)
    setup.controller.prepareTravelEncounter(.1, grid, threats)
    expect(setup.controller.travelEncounter.active).toBe(false)
    expect(setup.controller.phase).toBe('MARCHING')
    expect(setup.controller.missionLeader).toBe(leader)
    expect(leader.formationTarget!.position).toEqual(destination)
    expect(setup.profile().activeMission!.targetActorIds).toEqual(objectiveIds)
    expect(setup.profile().activeMission!.borrowedActorIds).toEqual(borrowedIds)
    expect(setup.controller.remainingEnemies).toBe(objectiveIds.length)
    expect(setup.controller.evaluate(false)).toBeNull()
    for (const actor of setup.actors.filter(actor => actor.squadId === leader.squadId && actor !== leader)) {
      expect(actor.followTarget).toBe(leader)
    }
  })

  it('hands incidental combat to formal engagement only after the field phase can be saved', () => {
    const setup = field({ templateId: 'veteran-scout-hunters' })
    setup.assemble()
    const roaming = setup.trackActor(new FieldTestNpc('ambient-raider', 'Raider', Faction.BANDIT))
    const source = roaming as unknown as NPC
    const threats = { owns: (actor: NPC) => actor === source }
    expect(setup.controller.noteTravelHit(setup.player as unknown as Player, source, threats)).toBe(true)
    setup.setSaving(false)
    setup.controller.engageFormalMission()
    expect(setup.controller.phase).toBe('MARCHING')
    expect(setup.controller.travelEncounter.active).toBe(true)
    setup.setSaving(true)
    setup.controller.engageFormalMission()
    expect(setup.controller.phase).toBe('ENGAGING')
    expect(setup.controller.travelEncounter.active).toBe(false)
    expect(setup.actors.every(actor => actor.dead || actor.tacticalOrder === 'charge')).toBe(true)
    expect(setup.profile().activeMission!.chargedSquadIds).toEqual([1, 2, 3, 4])
  })
})
