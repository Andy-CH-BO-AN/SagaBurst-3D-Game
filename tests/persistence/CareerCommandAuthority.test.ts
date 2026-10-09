import { describe, expect, it } from 'vitest'
import { parseTownCommandSquad, officialMissionSourcePolicy, parseOfficialCommandAuthority } from '../../src/career/CareerCommandAuthority'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Faction } from '../../src/world/NPC'
import type { CombatActorRef } from '../../src/combat/CombatAttribution'

describe('Saved official command membership', () => {
  it('round-trips returning town members without refilling wounds or dead mounts', () => {
    const saved = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: ['town:training:0'],
      state: 'RETURNING', authorized: false, sceneKey: 'enemy-outskirts', contribution: emptyPersonalContribution(),
      members: { 'town:training:0': { status: 'deployed', hp: 13, ammo: 2, shieldImpact: 4, order: 'formation',
        position: { x: 10, y: 2, z: 20, yaw: 1 },
        mount: { hp: 0, mounted: false, position: { x: 9, y: 2, z: 20, yaw: 1 } },
        formation: { commandId: -20, position: { x: 0, y: 1, z: 0, yaw: 0 }, reached: false } } } }
    expect(parseTownCommandSquad(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })

  it('fails closed on duplicate or invalid authoritative IDs rather than granting current soldiers', () => {
    const base = { type: 'mission-official', missionId: 'mission', townFaction: 'viking', squadId: 1,
      actorIds: ['accepted'], contribution: emptyPersonalContribution() }
    expect(parseOfficialCommandAuthority({ ...base, actorIds: ['accepted', 'accepted'] })).toBeUndefined()
    expect(parseOfficialCommandAuthority({ ...base, actorIds: [''] })).toBeUndefined()
    const policy = officialMissionSourcePolicy(parseOfficialCommandAuthority(base)!)
    const source: CombatActorRef = { actorId: 'accepted', actorType: 'npc', allegiance: Faction.TOWN,
      characterFaction: 'viking', squadId: 1 }
    expect(policy(source)).toBe(true)
    expect(policy({ ...source, actorId: 'new-replacement' })).toBe(false)
    expect(policy({ ...source, squadId: 'personal', ownership: 'player-personal' })).toBe(false)
    expect(policy({ ...source, actorType: 'player' })).toBe(false)
  })
})
