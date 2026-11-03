import { resolveCharacterIdentity, type CharacterIdentity, type CharacterIdentityInput } from '../combat/CharacterIdentity'

export type BorrowedCharacterIdentities = Record<string, CharacterIdentity>

/** A rebuilt borrowed actor uses its native receipt; a new mission slot uses its authored identity. */
export function resolveBorrowedCharacterIdentity(actorId: string, source: CharacterIdentityInput,
  identities?: BorrowedCharacterIdentities): CharacterIdentity {
  return resolveCharacterIdentity(identities?.[actorId] ?? source)
}

/** A receipt describes the native body, never the mission's temporary equipment. */
export function captureBorrowedCharacterIdentities(
  actors: readonly { combatantId: string; characterIdentity: CharacterIdentity }[],
  actorIds: readonly string[],
  previous: BorrowedCharacterIdentities = {},
): BorrowedCharacterIdentities {
  const byId = new Map(actors.map(actor => [actor.combatantId, actor.characterIdentity]))
  return Object.fromEntries(actorIds.flatMap(id => {
    const identity = previous[id] ?? byId.get(id)
    return identity ? [[id, { ...resolveCharacterIdentity(identity) }]] : []
  }))
}

/** Validate durable receipts before any factory restores HP or equipment. */
export function parseBorrowedCharacterIdentities(value: unknown, actorIds: readonly string[]): BorrowedCharacterIdentities | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid borrowed character identities')
  const accepted = new Set(actorIds)
  return Object.fromEntries(Object.entries(value).map(([id, value]) => {
    if (!accepted.has(id) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid borrowed actor identity')
    const raw = value as Record<string, unknown>
    if ((raw.characterFaction !== 'roman' && raw.characterFaction !== 'viking')
      || ![1, 2, 3, 4, 5].includes(raw.characterTier as number)
      || raw.specialCombatProfile !== undefined && raw.specialCombatProfile !== 'maki-ranger') throw new Error('Invalid borrowed character identity')
    // This serialization adapter is the sole untyped boundary; the shared resolver
    // rejects conflicting tiers, hero archetypes, assets and combat profiles.
    return [id, resolveCharacterIdentity(raw as unknown as CharacterIdentity)]
  }))
}

/** Compatibility only: pre-receipt siege saves encoded the native T2 rider in its ID.
 * New acceptance captures the actual NPC and never uses this inference. */
export function legacySiegeCharacterTier(actorId: string, rosterTier: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  return rosterTier === 3 && /^outskirts:cavalry:[abc]:[0-9](?::wave:[1-9]\d*)?$/.test(actorId) ? 2 : rosterTier
}
