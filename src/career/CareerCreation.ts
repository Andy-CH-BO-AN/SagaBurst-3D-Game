import { createCareerProfile, type CareerProfile } from './CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { grantStarter, STARTER_WEAPONS } from '../town/TownRules'

/** Single-save creation transaction, shared by ordinary creation and confirmed ending replacement.
 * Nothing is deleted first, so cancellation and a refused write retain the previous save.
 */
export function createAndSaveCareer(
  current: CareerProfile | null,
  faction: CharacterFaction,
  starterWeapon: string,
  replaceCompleted: boolean,
  save: (profile: CareerProfile) => boolean,
): CareerProfile | null {
  if (current && (!replaceCompleted || current.careerRetirement?.phase !== 'completed')) return null
  if (!STARTER_WEAPONS.includes(starterWeapon as typeof STARTER_WEAPONS[number])) return null
  const next = grantStarter(createCareerProfile(faction), starterWeapon)
  return save(next) ? next : null
}
