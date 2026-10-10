import { describe, expect, it } from 'vitest'
import { SquadRefitSafety, refitTownCommandForSceneChange } from '../../src/career/SquadRefit'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import type { Player } from '../../src/player/Player'
import type { NPC } from '../../src/world/NPC'
import { Faction } from '../../src/world/NPC'

// Data boundaries only: these cases own service policy and saved map transitions, not actor lifecycle.
const player = { dead: false, swinging: false, isAiming: false, combatAnimationAction: 'idle' } as Player
const guard = { combatantId: 'guard', dead: false, inCombat: false } as NPC

describe('peace-only squad refit policy', () => {
  it.each(['attack', 'charge'] as const)('rejects %s orders even without recent damage', order => {
    expect(new SquadRefitSafety().allows(player, [guard], [order], 10000)).toBe(false)
  })
  it('blocks attacking, aiming, engaged soldiers and either side of a recent hit, then permits peace', () => {
    const safety = new SquadRefitSafety()
    expect(safety.allows({ ...player, swinging: true } as Player, [guard], [], 10000)).toBe(false)
    expect(safety.allows({ ...player, isAiming: true } as Player, [guard], [], 10000)).toBe(false)
    expect(safety.allows(player, [{ ...guard, inCombat: true } as NPC], [], 10000)).toBe(false)
    safety.note({ type: 'damage_applied', source: { actorId: 'guard', actorType: 'npc', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: 'player', targetType: 'player', name: 'Player' }, method: 'melee', requestedDamage: 4, appliedDamage: 4 }, 10000)
    expect(safety.allows(player, [], ['defend'], 14999)).toBe(false)
    expect(safety.allows(player, [guard], ['follow'], 15000)).toBe(true)
    safety.note({ type: 'damage_applied', source: { actorId: 'enemy', actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'viking' },
      target: { targetId: 'horse', targetType: 'mount', ownerActorId: 'guard', name: 'Horse' }, method: 'projectile', requestedDamage: 4, appliedDamage: 4 }, 15000)
    expect(safety.allows(player, [guard], ['formation'], 19999)).toBe(false)
  })
  it('refits the saved home roster only at an explicit map transition and preserves permanent membership', () => {
    const profile = createCareerProfile('roman')
    profile.townCommandSquad = { type: 'town-command', squadId: 1, actorIds: ['guard'], townFaction: 'roman', sceneKey: 'town-home',
      state: 'FOLLOWING', authorized: true, contribution: emptyPersonalContribution(), members: { guard: { status: 'dead', hp: 0, ammo: 0, shieldImpact: 0 } } }
    expect(parseCareerProfile(JSON.parse(JSON.stringify(profile)))?.townCommandSquad?.members?.guard.hp).toBe(0)
    const next = refitTownCommandForSceneChange(profile)
    const reloaded = parseCareerProfile(JSON.parse(JSON.stringify(next)))!.townCommandSquad!
    expect(reloaded.actorIds).toEqual(['guard']); expect(reloaded.authorized).toBe(true)
    expect(reloaded.members?.guard).toEqual({ status: 'reserve' })
    expect(reloaded.state).toBe('TRAINING')
    expect(profile.townCommandSquad.members?.guard.hp).toBe(0)
  })
})
