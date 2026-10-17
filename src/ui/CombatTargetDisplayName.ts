import { Faction } from '../combat/CombatFaction'
import type { CareerPersonalSquadMember } from '../career/CareerPersonalSquad'
import type { TownActorSpec } from '../town/TownRules'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NPC } from '../world/NPC'
import { combatUnitDisplayName, personalUnitDisplayName } from './UnitDisplayName'

/** Presentation metadata follows the actor, without changing combat identity or attribution. */
const townActors = new WeakMap<object, { spec: TownActorSpec; faction: CharacterFaction }>()
const personalActors = new WeakMap<object, { member: CareerPersonalSquadMember; faction: CharacterFaction }>()

export function registerTownCombatDisplayName(npc: object, spec: TownActorSpec, faction: CharacterFaction): void {
  townActors.set(npc, { spec, faction })
}

export function registerPersonalCombatDisplayName(npc: object, member: CareerPersonalSquadMember, faction: CharacterFaction): void {
  personalActors.set(npc, { member, faction })
}

type CombatDisplayActor = Pick<NPC, 'characterFaction' | 'tier' | 'presetId' | 'combatProfileId'
  | 'specialCombatProfile' | 'townCategory' | 'faction' | 'generatedAsCavalry' | 'hostileToPlayer' | 'combatOwnership'>

/** Never fall back to NPC.name: it may be a stable internal runtime identifier. */
export function npcCombatDisplayName(npc: CombatDisplayActor): string {
  const personal = personalActors.get(npc)
  if (personal) return personalUnitDisplayName(personal.member, personal.faction, undefined, npc.tier)
  const town = townActors.get(npc)
  if (!town && npc.combatOwnership === 'player-personal') return '私兵 Private Soldier'
  return combatUnitDisplayName({
    faction: town?.faction ?? npc.characterFaction,
    tier: npc.tier,
    presetId: npc.presetId,
    combatProfileId: npc.combatProfileId ?? (npc.specialCombatProfile === 'maki-ranger' ? 'ranger' : undefined),
    civilian: npc.townCategory === 'civilian',
    bandit: npc.faction === Faction.BANDIT,
    mounted: npc.generatedAsCavalry,
    enemy: npc.hostileToPlayer || npc.faction === Faction.ENEMY || npc.faction === Faction.BANDIT,
    townSpec: town?.spec,
  })
}
