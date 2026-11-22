import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { TownMissionCombat } from '../../src/town/TownMissionCombat'
import type { NPC } from '../../src/world/NPC'

type Inputs = ConstructorParameters<typeof TownMissionCombat>
/** Grid entries only read liveness and position; no actor or scene is built. */
const body = (x: number, dead = false) => ({ dead, combatPosition: new Vector3(x, 0, 0) }) as unknown as NPC

describe('Town runtime combat roster', () => {
  it('lets hostile actors acquire the living co-op partner through the shared warfare roster and grid', () => {
    const squadMember = body(4), partner = body(10)
    let partnerBody: NPC = partner
    const combat = new TownMissionCombat({
      field: { fieldNpcs: [], ambientBandits: [] }, defense: { fieldNpcs: [] },
      duel: { fieldNpcs: [], isParkedResident: () => false },
    } as unknown as Inputs[0], {
      residents: [], personalSquad: () => ({ actors: [squadMember] }), coopPartner: () => partnerBody,
    } as unknown as Inputs[1])
    combat['prepareOutskirtsFrame'](1 / 60)
    expect(combat.runtimeParticipants).toEqual([squadMember, partner])
    expect(combat.runtimeGrid.getNearby(partner.combatPosition, 1)).toEqual([partner])
    // A fallen partner leaves the roster on the next frame.
    partnerBody = body(10, true)
    combat['prepareOutskirtsFrame'](1 / 60)
    expect(combat.runtimeParticipants).toEqual([squadMember])
    expect(combat.runtimeGrid.getNearby(partner.combatPosition, 1)).toEqual([])
  })
})
