import { describe, expect, it } from 'vitest'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import { AIType, Faction } from '../../src/world/NPC'
import { allocateSiegeRampCrews, getSiegeRampPlacement, placeSiegeRampCrew, isMobileSiegeRampEnabled } from '../../src/campaign/MobileSiegeRampPolicy'
import { getOutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { createDefaultDefensePlayerLoadout } from '../../src/campaign/DefenseCampaignLaunch'
import { MobileSiegeRampController } from '../../src/campaign/MobileSiegeRampController'

function roster(count: number): NpcSpawnSpec[] {
  return Array.from({ length: count }, (_, i) => ({ actorId: `infantry-${i}`, x: i * 2, z: 0,
    faction: Faction.ENEMY, characterFaction: 'viking', aiType: AIType.MELEE, name: `Infantry ${i}`,
    tier: 2, cavalry: false, respawnEnabled: false }))
}

describe('Mobile siege roster and lifecycle (zero actors)', () => {
  it.each([[0, 0], [9, 0], [10, 1], [19, 1], [20, 2], [40, 2]])('allocates %i infantry into %i complete crews without changing IDs or counts', (count, vehicles) => {
    const specs = roster(count)
    const before = structuredClone(specs)
    const assignments = allocateSiegeRampCrews(specs)
    expect(assignments).toHaveLength(vehicles)
    const ids = assignments.flatMap(crew => {
      expect(crew.pusherIds).toHaveLength(4); expect(crew.assaultIds).toHaveLength(6)
      return [...crew.pusherIds, ...crew.assaultIds]
    })
    expect(new Set(ids).size).toBe(vehicles * 10)
    expect(ids).toEqual(Array.from({ length: vehicles * 10 }, (_, i) => `infantry-${i}`))
    expect(allocateSiegeRampCrews(specs)).toEqual(assignments)
    expect(specs).toEqual(before)
  })

  it('excludes cavalry, ranged and hero roles; rejects duplicate identities', () => {
    const specs = roster(20)
    specs[0].cavalry = true; specs[1].aiType = AIType.RANGED; specs[2].tier = 4
    expect(allocateSiegeRampCrews(specs)).toHaveLength(1)
    expect(allocateSiegeRampCrews(specs)[0].pusherIds[0]).toBe('infantry-3')
    specs[1].actorId = specs[0].actorId
    expect(() => allocateSiegeRampCrews(specs)).toThrow('unique actor IDs')
  })

  it('uses mirrored layout geometry and materializes six elevated assault slots per vehicle', () => {
    for (const faction of ['roman', 'viking'] as const) {
      const layout = getOutpostWalkwayLayout(getCampaignOutpostPlacement(faction))
      const specs = roster(40)
      const original = structuredClone(specs)
      for (const crew of allocateSiegeRampCrews(specs)) {
        const placement = getSiegeRampPlacement(layout, crew.side)
        placeSiegeRampCrew(specs, crew, placement)
        expect(placement.surface.halfWidth * 2).toBeGreaterThanOrEqual(4)
        expect(Math.abs(placement.surface.topY - placement.surface.startY) / placement.surface.length).toBeLessThanOrEqual(.25)
        expect((placement.dock.z - placement.start.z) * layout.zSign).toBe(45)
        expect(placement.deckConnection.y).toBe(layout.decks.find(d => d.side === crew.side)!.topY)
        const assault = specs.filter(s => s.siegeRamp?.id === crew.id && s.siegeRamp.role === 'assault')
        expect(assault).toHaveLength(6)
        expect(new Set(assault.map(s => `${s.x}/${s.z}`)).size).toBe(6)
        for (const spec of assault) expect(spec.spawnY).toBe(placement.start.y)
      }
      expect(specs.map(s => s.actorId)).toEqual(original.map(s => s.actorId))
      expect(specs.slice(20)).toEqual(original.slice(20))
    }
  })

  it('isolates standard Campaign from Career and unrelated scenes', () => {
    const config = { type: 'defense' as const, defenderFaction: 'roman' as const, stageId: 1 as const,
      defenderArmy: {}, playerLoadout: createDefaultDefensePlayerLoadout('roman') }
    expect(isMobileSiegeRampEnabled(config)).toBe(true)
    expect(isMobileSiegeRampEnabled(undefined)).toBe(false)
    expect(isMobileSiegeRampEnabled({ ...config, careerMissionId: 'outpost' })).toBe(false)
    expect(isMobileSiegeRampEnabled({ ...config, careerMissionKind: 'captain-outpost-defense' })).toBe(false)
  })

  it('waits for all ten registrations and scales speed through all four fixed pushers without replacements', () => {
    const assignment = allocateSiegeRampCrews(roster(10))[0]
    const records = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false }))
    const states: string[] = []
    const controller = new MobileSiegeRampController(assignment, 100, state => states.push(state))
    for (const actor of records.slice(0, 9)) controller.register(actor)
    expect(controller.advance(1)).toBe(0)
    controller.register(records[9])
    for (let alive = 4; alive >= 1; alive--) {
      expect(controller.advance(1)).toBe(alive * .5)
      expect(controller.currentSpeed).toBe(alive * .5)
      records[4 - alive].dead = true
    }
    expect(controller.advance(1)).toBe(0)
    expect(controller.state).toBe('ABANDONED')
    records[0].dead = false
    expect(controller.advance(100)).toBe(0)
    expect(controller.state).toBe('ABANDONED')
    expect(() => controller.register(records[0])).toThrow()
    controller.destroy(); expect(controller.advance(100)).toBe(0)
    expect(states).toEqual(['PUSHING', 'ABANDONED', 'DESTROYED'])
    controller.dispose()
  })

  it('docks once; pusher deaths after Dock never abandon it; destruction is terminal', () => {
    const assignment = allocateSiegeRampCrews(roster(10))[0]
    const records = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false }))
    const states: string[] = []
    const controller = new MobileSiegeRampController(assignment, 2, state => states.push(state))
    records.forEach(record => controller.register(record))
    controller.advance(1); expect(controller.state).toBe('DOCKING')
    controller.advance(1.49); expect(controller.state).toBe('DOCKING')
    controller.advance(.01); expect(controller.state).toBe('DOCKED')
    records.forEach(record => { record.dead = true })
    controller.advance(100); expect(controller.state).toBe('DOCKED')
    controller.destroy(); controller.destroy(); controller.advance(100)
    expect(states).toEqual(['PUSHING', 'DOCKING', 'DOCKED', 'DESTROYED'])
    controller.dispose(); expect(controller.alivePushers).toBe(0)
  })
})
