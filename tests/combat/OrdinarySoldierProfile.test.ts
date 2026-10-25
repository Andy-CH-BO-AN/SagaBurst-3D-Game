import { describe, expect, it } from 'vitest'
import { getOrdinarySoldierHp, resolveOrdinaryNpcHp, resolveOrdinaryPlayerBaseHp, resolveOrdinarySoldierTier } from '../../src/combat/OrdinarySoldierProfile'
import { resolveCareerCharacterTier, resolveCareerPlayerMaxHp, preserveHpRatio } from '../../src/career/CareerPlayerProfile'
import { createCareerProfile, promoteCareer } from '../../src/career/CareerProfile'
import { characterIdentityMaxHp, resolveCharacterIdentity } from '../../src/combat/CharacterIdentity'
import { personalMemberLoadout } from '../../src/career/PersonalSquadRuntime'

describe('Ordinary character health identity', () => {
  it.each([
    ['roman', 1, 100], ['roman', 2, 150], ['roman', 3, 200],
    ['viking', 1, 90], ['viking', 2, 135], ['viking', 3, 180],
  ] as const)('%s T%s gives players and ordinary NPCs the same %s base HP', (faction, tier, expected) => {
    expect(getOrdinarySoldierHp(faction, tier)).toBe(expected)
    expect(resolveOrdinaryPlayerBaseHp(faction, tier, { playerHp: 200, playerHpSource: 'default' })).toBe(expected)
    expect(resolveOrdinaryNpcHp({ faction, tier }, 200)).toBe(expected)
  })
  it('does not reinterpret civilian or special NPC profiles as ordinary soldiers', () => {
    expect(resolveOrdinaryNpcHp({ faction: 'roman', tier: 1, civilian: true }, 50)).toBe(50)
    expect(resolveOrdinaryNpcHp({ faction: 'viking', tier: 2, special: true }, 500)).toBe(500)
    expect(resolveOrdinaryNpcHp({ faction: 'viking', tier: 4 }, 200)).toBe(200)
  })
  it('uses appointed rank rather than earned eligibility or purchased weapons and preserves wounds on promotion', () => {
    const profile = createCareerProfile('roman')
    profile.totalMerit = profile.availableMerit = 1000
    profile.equipment = { melee: 'sword_t5', shield: 'commander_shield_t5' }
    expect(resolveCareerCharacterTier(profile)).toBe(1)
    expect(resolveCareerPlayerMaxHp(profile)).toBe(101)
    const promoted = promoteCareer(profile)!
    expect(resolveCareerCharacterTier(promoted)).toBe(2)
    const nextMax = resolveCareerPlayerMaxHp(promoted)
    expect(nextMax).toBe(151)
    expect(preserveHpRatio(50.5, 101, nextMax)).toBe(75.5)
    expect(preserveHpRatio(0, 100, nextMax)).toBe(0)
  })
  it('adds skills once to ordinary and retained hero health profiles', () => {
    const profile = createCareerProfile('viking')
    profile.skills!.oneHanded.level = 4
    expect(resolveCareerPlayerMaxHp(profile)).toBe(94)
    profile.rank = 'captain'
    expect(resolveCareerCharacterTier(profile)).toBe(4)
    expect(resolveCareerPlayerMaxHp(profile)).toBe(504)
    profile.rank = 'commander'
    expect(resolveCareerCharacterTier(profile)).toBe(5)
    expect(resolveCareerPlayerMaxHp(profile)).toBe(954)
    expect(resolveOrdinarySoldierTier()).toBe(2)
  })
  it('adapts a legacy Commander profile to T5 and rejects contradictory explicit body data', () => {
    const identity = resolveCharacterIdentity({ characterFaction: 'roman', tier: 4,
      visualAssetId: 'roman-hero-t5', combatProfileId: 'roman-commander' })
    expect(identity).toMatchObject({ characterTier: 5, heroArchetype: 'commander' })
    expect(characterIdentityMaxHp(identity)).toBe(850)
    expect(() => resolveCharacterIdentity({ ...identity, characterTier: 4 })).toThrow('Conflicting')
  })
  it.each([
    { type: 'captain', characterTier: 4, heroArchetype: 'captain', recruitmentRole: 'archer', melee: 'gladius_standard', ranged: 'recurve_longbow', profile: 'praetorian', hp: 500 },
    { type: 'ranger', characterTier: 4, heroArchetype: 'ranger', recruitmentRole: 'spearman', melee: 'steel_lance', ranged: null, profile: 'ranger', hp: 300 },
  ] as const)('keeps $heroArchetype identity when explicit equipment selects $recruitmentRole combat', ({ type, characterTier, heroArchetype, recruitmentRole, melee, ranged, profile, hp }) => {
    const member = { id: 'personal-identity', type, characterFaction: 'roman' as const, characterTier, heroArchetype, recruitmentRole,
      equipment: { melee, ranged, shield: null, mount: null } }
    const spec = personalMemberLoadout(member, 'roman')
    expect(spec.identity).toMatchObject({ characterTier: 4, heroArchetype, combatProfileId: profile })
    expect(characterIdentityMaxHp(spec.identity)).toBe(hp)
    expect(spec.loadout).toMatchObject({ meleeWeaponId: melee, rangedWeaponId: ranged })
    const upgraded = personalMemberLoadout({ ...member, equipment: { ...member.equipment, melee: 'sword_t5' } }, 'viking')
    expect(upgraded.identity).toEqual(spec.identity)
    expect(upgraded.presetId).toBe(ranged ? 'roman_archer' : 'roman_heavy_infantry')
  })
})
