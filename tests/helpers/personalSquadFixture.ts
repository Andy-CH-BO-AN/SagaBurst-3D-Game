import type { CareerPersonalSquadMember, PersonalSquadMemberType } from '../../src/career/CareerPersonalSquad'
import type { CareerProfile } from '../../src/career/CareerProfile'
import { defaultPersonalRecruitmentChoice, resolvePersonalRecruitment } from '../../src/career/CareerRecruitmentCatalog'
import { syncCareerOwnership } from '../../src/career/CareerInventory'
import { allocatedTownEquipment } from '../../src/career/CareerTownEquipmentState'

type MemberFixture = Pick<CareerPersonalSquadMember, 'id' | 'type'> & Partial<CareerPersonalSquadMember>

/** Complete current catalog identities and explicit owned stock for data-only HR fixtures. */
export function personalSquadFixture(profile: CareerProfile, specs: readonly MemberFixture[]): { members: CareerPersonalSquadMember[] } {
  const members = specs.map(spec => {
    const faction = spec.characterFaction ?? profile.faction
    const choice = { ...defaultPersonalRecruitmentChoice(spec.type as PersonalSquadMemberType, faction),
      ...(spec.characterTier ? { characterTier: spec.characterTier } : {}),
      ...(spec.heroArchetype ? { heroArchetype: spec.heroArchetype } : {}),
      ...(spec.recruitmentRole ? { recruitmentRole: spec.recruitmentRole } : {}),
      ...(spec.visualAssetId ? { visualAssetId: spec.visualAssetId } : {}),
    }
    const product = resolvePersonalRecruitment(faction, choice)
    if (!product) throw new Error('Invalid fixture recruitment choice')
    return { ...spec, characterFaction: faction, characterTier: product.characterTier,
      ...(product.heroArchetype ? { heroArchetype: product.heroArchetype } : {}),
      recruitmentRole: product.recruitmentRole, originalHirePrice: product.price,
      equipment: { ...(spec.equipment ?? product.equipment) },
    }
  })
  const demand: Record<string, number> = {}
  for (const member of members) for (const id of Object.values(member.equipment)) if (id) demand[id] = (demand[id] ?? 0) + 1
  for (const [id, quantity] of Object.entries(demand)) {
    const outside = Object.values(profile.equipment ?? {}).filter(value => value === id).length
      + Number(profile.selectedMountId === id) + allocatedTownEquipment(profile, id)
    profile.inventory!.quantities[id] = Math.max(profile.inventory!.quantities[id] ?? 0, outside + quantity)
  }
  syncCareerOwnership(profile)
  return { members }
}
