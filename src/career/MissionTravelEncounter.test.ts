import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { NPC } from '../world/NPC'
import type { Player } from '../player/Player'
import { Faction } from '../combat/CombatFaction'
import { SpatialGrid } from '../world/SpatialGrid'
import { MissionTravelEncounter } from './MissionTravelEncounter'

function npc(id: string, x: number, z = 0, faction = Faction.TOWN): NPC {
  const actor = {
    combatantId: id, combatPosition: new THREE.Vector3(x, 0, z), dead: false, faction,
    hostileToPlayer: faction === Faction.BANDIT || faction === Faction.ENEMY,
    encounterAggroState: 'alerted', tacticalOrder: 'follow', formationCommandId: null as number | null,
    clearEncounter: vi.fn(),
    setTacticalOrder: vi.fn((order: string) => { actor.tacticalOrder = order; actor.formationCommandId = null }),
    assignFormationTarget: vi.fn((id: number) => { actor.tacticalOrder = 'formation'; actor.formationCommandId = id }),
  }
  return actor as unknown as NPC
}
function fixture(count = 3) {
  const members = Array.from({ length: count }, (_, i) => npc('mission-' + i, -i * 3))
  const player = npc('player', 0, 0, Faction.PLAYER) as unknown as Player
  const bandits = [npc('bandit-a', 10, 0, Faction.BANDIT), npc('bandit-b', 12, 0, Faction.BANDIT)]
  const cavalry = [npc('cavalry-a', 18, 0, Faction.ENEMY)]
  const actors = [...bandits, ...cavalry]
  const runtime = { owns: (actor: NPC) => actors.includes(actor), squadMembersFor: (actor: NPC) => bandits.includes(actor) ? bandits : [actor] }
  const grid = new SpatialGrid<NPC>(8)
  const encounter = new MissionTravelEncounter()
  const frame = (dt = .35) => {
    grid.clear(); actors.filter(actor => !actor.dead).forEach(actor => grid.insert(actor))
    encounter.prepareFrame(dt, members, player, grid, runtime)
  }
  return { members, player, bandits, cavalry, actors, runtime, grid, encounter, frame }
}

describe('Mission party travel interruption', () => {
  it('uses one throttled broad-phase query for 30 allies and 60 roaming actors', () => {
    const f = fixture(30)
    f.actors.push(...Array.from({ length: 57 }, (_, i) => npc('extra-' + i, 250, i, Faction.BANDIT)))
    const query = vi.spyOn(f.grid, 'getNearbyInto')
    f.frame(0)
    expect(query).toHaveBeenCalledTimes(1)
    expect(f.encounter.active).toBe(true)
    for (const member of f.members) expect(member.setTacticalOrder).toHaveBeenCalledWith('charge')
    for (let i = 0; i < 6; i++) f.frame(.05)
    expect(query).toHaveBeenCalledTimes(1)
    f.frame(.06)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('wakes the entire party immediately at the tail hit, even when the victim dies', () => {
    const f = fixture()
    f.members[2].combatPosition.set(90, 0, 0)
    Object.assign(f.members[2], { dead: true })
    f.bandits.forEach(actor => actor.combatPosition.set(92, 0, 0))
    expect(f.encounter.noteHit(f.members[2], f.bandits[0], f.members, f.player, f.runtime)).toBe(true)
    expect(f.encounter.engagementOrigin?.x).toBe(90)
    for (const member of f.members.slice(0, 2)) expect(member.assignFormationTarget).toHaveBeenCalled()
    expect(f.members[2].setTacticalOrder).not.toHaveBeenCalled()
  })

  it('uses the first detecting member, rather than the captain, as sensor origin', () => {
    const f = fixture()
    f.members[2].combatPosition.set(100, 0, 0)
    f.bandits.forEach(actor => actor.combatPosition.set(102, 0, 0))
    f.cavalry[0].combatPosition.set(250, 0, 0)
    f.frame()
    expect(f.encounter.engagementOrigin?.x).toBe(100)
    expect(f.members[0].tacticalOrder).toBe('formation')
    f.members[0].combatPosition.set(80, 0, 0)
    f.frame(.01)
    expect(f.members[0].tacticalOrder).toBe('charge')
  })

  it('supports a detached Player and keeps the original origin after subsequent remote hits', () => {
    const f = fixture()
    f.player.combatPosition.set(200, 0, 0)
    f.bandits.forEach(actor => actor.combatPosition.set(205, 0, 0))
    f.encounter.noteHit(f.player, f.bandits[0], f.members, f.player, f.runtime)
    expect(f.encounter.engagementOrigin?.x).toBe(200)
    for (const member of f.members) expect(member.tacticalOrder).toBe('formation')
    f.player.combatPosition.set(-200, 0, 0)
    f.cavalry[0].combatPosition.set(-198, 0, 0)
    f.encounter.noteHit(f.player, f.cavalry[0], f.members, f.player, f.runtime)
    expect(f.encounter.engagementOrigin?.x).toBe(200)
    expect(f.encounter.hostileActors).not.toContain(f.cavalry[0])
  })

  it('does not mistake allied roaming cavalry for a Player hostile', () => {
    const f = fixture()
    f.actors.length = 0
    const ally = npc('allied-cavalry', 5)
    f.actors.push(ally)
    expect(f.encounter.noteHit(f.player, ally, f.members, f.player, f.runtime)).toBe(false)
    f.frame()
    expect(f.encounter.active).toBe(false)
  })

  it('rejects friendly, unowned and non-party contacts', () => {
    const f = fixture()
    expect(f.encounter.noteHit(npc('patrol', 0), f.bandits[0], f.members, f.player, f.runtime)).toBe(false)
    expect(f.encounter.noteHit(f.members[0], npc('formal-enemy', 1, 0, Faction.ENEMY), f.members, f.player, f.runtime)).toBe(false)
    const ally = npc('ally', 1); f.actors.push(ally)
    expect(f.encounter.noteHit(f.members[0], ally, f.members, f.player, f.runtime)).toBe(false)
    expect(f.encounter.active).toBe(false)
  })

  it('keeps a second hostile squad in the same encounter after the first dies', () => {
    const f = fixture()
    f.frame()
    const origin = f.encounter.engagementOrigin
    Object.assign(f.members[0], { dead: true })
    f.bandits.forEach(actor => { Object.assign(actor, { dead: true }) })
    f.frame(.01)
    expect(f.encounter.active).toBe(true)
    expect(f.encounter.engagementOrigin).toEqual(origin)
    f.cavalry[0].returnFromEncounter = vi.fn()
    Object.assign(f.cavalry[0], { encounterAggroState: 'returning' })
    f.frame(.01)
    expect(f.encounter.active).toBe(false)
    expect(f.members[0].dead).toBe(true)
  })

  it('finishes without gathering remote supporters and allows the next fight afterward', () => {
    const f = fixture()
    f.members[0].combatPosition.set(-150, 0, 0)
    f.frame()
    expect(f.members[0].tacticalOrder).toBe('formation')
    f.bandits.forEach(actor => { Object.assign(actor, { dead: true }) })
    f.cavalry[0].combatPosition.set(250, 0, 0)
    f.frame(.01)
    expect(f.encounter.active).toBe(false)
    expect(f.members[0].combatPosition.x).toBe(-150)
    f.player.combatPosition.set(250, 0, 0)
    f.frame(.01)
    expect(f.encounter.active).toBe(true)
    expect(f.encounter.engagementOrigin?.x).toBe(250)
  })

  it('ends a hit-triggered encounter outside the strict leash without a hold timer', () => {
    const f = fixture()
    f.actors.forEach(actor => actor.combatPosition.set(100, 0, 0))
    f.encounter.noteHit(f.members[0], f.bandits[0], f.members, f.player, f.runtime)
    expect(f.encounter.active).toBe(true)
    f.frame(0)
    expect(f.encounter.active).toBe(false)
  })
})
